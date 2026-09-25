import { addDays, differenceInDays, subDays, startOfDay, isSameDay } from 'date-fns';
import { Timestamp, doc, collection, writeBatch, serverTimestamp, getDoc } from 'firebase/firestore';
import type { Order, Invoice, StockMovement, CommissionRecord } from './definitions';

export function roundCurrency(value: number): number {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function getEffectiveCashReceived(o: Order): number {
    if (!o) return 0;
    
    let sumPayments = 0;
    if (Array.isArray((o as any).payments) && (o as any).payments.length > 0) {
        sumPayments = (o as any).payments.reduce((s: number, p: any) => {
            if (p.status === 'verified' || !p.status) {
                return s + (Number(p.amount || p.monto || p.amountUSD) || 0);
            }
            return s;
        }, 0);
    }
    
    if (sumPayments > 0) {
        return roundCurrency(sumPayments);
    }

    const discountPct = (o as any).bcvDiscountSnapshot ?? o.treasurySnapshot?.bcvDiscountPercent ?? 25;
    const isNet = (o as any).incentivesApplied === true || (o as any).isNetPrice === true;

    if (o.status === 'Pagado' || (o as any).isPaid === true || (o as any).paymentStatus === 'Pagado') {
        const netVal = isNet ? o.totalAmount : (o.totalAmount || 0) * (1 - (discountPct / 100));
        return roundCurrency(netVal > 0 ? netVal : o.totalAmount || 0);
    }

    const cash = typeof o.totalCashReceived === 'number' && o.totalCashReceived > 0 ? o.totalCashReceived : 0;
    const paid = typeof o.amountPaid === 'number' && o.amountPaid > 0 ? o.amountPaid : 0;
    const altPaid = (o as any).paidAmount || (o as any).totalPaid || (o as any).montoPagado || 0;
    const numAltPaid = typeof altPaid === 'number' && altPaid > 0 ? altPaid : 0;

    const explicitCash = Math.max(cash, paid, numAltPaid);
    if (explicitCash > 0) {
        if (explicitCash >= (o.totalAmount || 0) && (o.totalAmount || 0) > 0) {
            const netVal = isNet ? o.totalAmount : (o.totalAmount || 0) * (1 - (discountPct / 100));
            return roundCurrency(netVal);
        }
        return roundCurrency(explicitCash);
    }

    return 0;
}

export function getCashDate(o: Order): Date {
    if (!o) return new Date(0);
    const raw = (o as any).paidAt || (o as any).paymentDate || (o as any).fechaPago || o.updatedAt || o.approvalDate || o.receptionDate || o.createdAt || o.orderDate;
    if (!raw) return new Date(0);
    return typeof (raw as any).toDate === 'function' ? (raw as any).toDate() : new Date(raw as any);
}

export function getSalesDate(o: Order): Date {
    if (!o) return new Date(0);
    const raw = o.receptionDate || o.approvalDate || o.createdAt || o.orderDate;
    if (!raw) return new Date(0);
    return typeof (raw as any).toDate === 'function' ? (raw as any).toDate() : new Date(raw as any);
}

export function getSalespersonKey(o: Order): string {
    if (!o) return 'direct_system';
    if (o.salespersonId && o.salespersonId.trim() !== '') {
        return o.salespersonId.trim();
    }
    if ((o as any).customerAssignedSalespersonId && String((o as any).customerAssignedSalespersonId).trim() !== '') {
        return String((o as any).customerAssignedSalespersonId).trim();
    }
    const name = o.salespersonName || (o as any).vendedor || (o as any).customerAssignedSalespersonName || '';
    if (name.trim() !== '') {
        return name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/z/g, 's');
    }
    return 'direct_system';
}

export function getSalespersonDisplayName(o: Order): string {
    if (!o) return 'Ventas Directas / Oficina Central';
    const name = o.salespersonName || (o as any).vendedor || (o as any).customerAssignedSalespersonName;
    if (name && typeof name === 'string' && name.trim() !== '') {
        return name.trim();
    }
    return 'Ventas Directas / Oficina Central';
}

export function isOrderInMoraCritica(order: Order, referenceDate: Date = new Date()): boolean {
    if (!order || order.status === 'Pagado' || order.status === 'Cancelado' || order.status === 'Rechazado' || order.status === 'Borrador') {
        return false;
    }
    const inv = getInvoiceFromOrder(order);
    if (!inv || inv.remainingBalance <= 0.05 || inv.status === 'Pagado') return false;

    if (Math.abs(referenceDate.getTime() - new Date().getTime()) < 86400000) {
        return inv.status === 'Vencido';
    }

    const sDate = getSalesDate(order);
    if (!sDate || isNaN(sDate.getTime())) return false;
    const extension = typeof order.extensionDays === 'number' && order.extensionDays > 0 ? order.extensionDays : 0;
    const dueDate = addDays(sDate, 30 + extension);
    return referenceDate >= dueDate;
}

export function getMoraCriticaAmount(order: Order, referenceDate: Date = new Date()): number {
    if (!isOrderInMoraCritica(order, referenceDate)) return 0;
    const inv = getInvoiceFromOrder(order);
    if (inv) return inv.remainingBalance;
    const cashPaid = getEffectiveCashReceived(order);
    return Math.max(0, (order.totalAmount || 0) - cashPaid);
}

/**
 * Calcula la Mora Crítica exacta de una orden en una fecha pasada específica.
 * A diferencia de getMoraCriticaAmount, esta función aísla los pagos
 * que sucedieron estrictamente ANTES o DURANTE el targetDate.
 */
export function getHistoricalMoraAsOfDate(order: Order, targetDate: Date): number {
    if (!order || ['Cancelado', 'Rechazado', 'Borrador'].includes(order.status)) {
        return 0;
    }

    const sDate = getSalesDate(order);
    if (!sDate || isNaN(sDate.getTime())) return 0;

    // Si la orden no existía aún
    if (startOfDay(sDate) > startOfDay(targetDate)) return 0;

    const extension = typeof order.extensionDays === 'number' && order.extensionDays > 0 ? order.extensionDays : 0;
    const dueDate = addDays(sDate, 30 + extension);

    // Si para esa fecha la factura aún no estaba vencida
    if (startOfDay(targetDate) <= startOfDay(dueDate)) return 0;

    // Calcular efectivo recibido estrictamente hasta la fecha objetivo
    let amountPaidAsOfDate = 0;
    if (Array.isArray((order as any).payments) && (order as any).payments.length > 0) {
        (order as any).payments.forEach((p: any) => {
            if (p.status === 'verified' || !p.status) {
                const pDateRaw = p.paymentDate || p.createdAt || p.date;
                const pDate = pDateRaw ? (typeof pDateRaw.toDate === 'function' ? pDateRaw.toDate() : new Date(pDateRaw)) : null;
                if (pDate && startOfDay(pDate) <= startOfDay(targetDate)) {
                    amountPaidAsOfDate += (Number(p.amount || p.monto) || 0);
                }
            }
        });
    } else {
        const cDate = getCashDate(order);
        if (cDate && startOfDay(cDate) <= startOfDay(targetDate)) {
            amountPaidAsOfDate = getEffectiveCashReceived(order);
        }
    }

    const roundedTotal = roundCurrency(order.totalAmount || 0);
    const remaining = Math.max(0, roundedTotal - amountPaidAsOfDate);

    // Si quedaban centavos o ya estaba pagada
    if (remaining <= 0.50) return 0;

    return remaining;
}

export const FOREIGN_CURRENCY_PAYMENT_METHODS = [
    'Efectivo USD',
    'Efectivo $',
    'Zelle',
    'Binance Pay / USDT',
    'Binance Pay',
    'Binance',
    'USDT',
    'Transferencia USD',
    'Banesco Panamá',
    'Mercantil Panamá',
    'Cuenta Custodia USD',
    'PayPal',
    'Wire Transfer USD',
    'Divisas'
];

export function isForeignCurrencyPaymentMethod(method?: string): boolean {
    if (!method) return true;
    const normalized = method.trim().toLowerCase();
    if (normalized.includes('bcv') || normalized.includes('pago móvil') || normalized.includes('pago movil') || normalized.includes('ves') || normalized.includes('bolivar')) {
        return false;
    }
    return true;
}

export function getOrderCommercialDiscountPercent(order: Order, paymentMethod?: string, fallbackTreasuryDiscount: number = 25): number {
    if (!order) return fallbackTreasuryDiscount;
    if (paymentMethod && !isForeignCurrencyPaymentMethod(paymentMethod)) {
        return 0;
    }
    // 1. Custodia inmutable por snapshot de Tesorería grabado al emitir la orden
    if (typeof (order as any).bcvDiscountSnapshot === 'number') {
        return (order as any).bcvDiscountSnapshot;
    }
    if (typeof order.treasurySnapshot?.bcvDiscountPercent === 'number') {
        return order.treasurySnapshot.bcvDiscountPercent;
    }
    // 2. Fallback dinámico entregado desde Tesorería viva (FinancialSettings)
    return fallbackTreasuryDiscount;
}

export function getInvoiceFromOrder(order: Order, fallbackTreasuryDiscount: number = 25): Invoice | null {
    if (!['Entregado', 'En Verificación', 'Pagado', 'Despachado', 'Completado', 'En Preparación', 'Aprobado'].includes(order.status)) {
        return null;
    }
    
    const rawDate = order.receptionDate || order.approvalDate || order.orderDate || order.createdAt;
    if (!rawDate) {
        return null;
    }

    const creditStartDate = typeof (rawDate as any).toDate === 'function' 
        ? (rawDate as Timestamp).toDate() 
        : new Date(rawDate as any);

    if (isNaN(creditStartDate.getTime()) || creditStartDate.getTime() === 0) {
        return null;
    }
    
    const extension = typeof order.extensionDays === 'number' && order.extensionDays > 0 ? order.extensionDays : 0;
    const dueDate = addDays(creditStartDate, 30 + extension);
    const today = new Date();
    const remainingDays = differenceInDays(dueDate, today);
    const amountPaid = getEffectiveCashReceived(order);
    const commercialDiscountPercent = getOrderCommercialDiscountPercent(order, undefined, fallbackTreasuryDiscount);
    
    const hasFractionalNetDecimals = (order.totalAmount % 1 !== 0) && (order.totalAmount.toString().split('.')[1]?.length > 2);
    const isAlreadyNetOrDiscounted = (order as any).incentivesApplied === true || (order as any).isNetPrice === true || hasFractionalNetDecimals;
    const effectiveCommDiscount = isAlreadyNetOrDiscounted ? 0 : commercialDiscountPercent;

    const discountAmount = (order.totalAmount * effectiveCommDiscount) / 100;
    const netPayableTotal = Math.max(0, order.totalAmount - discountAmount);
    const isExplicitlyPaid = order.status === 'Pagado';
    
    // Base Deuda Bruta a Lista BCV (sin doble descuento)
    const roundedTotal = roundCurrency(order.totalAmount);
    const grossRemainingBalance = isExplicitlyPaid ? 0 : Math.max(0, roundedTotal - amountPaid);
    const netCashBalance = isExplicitlyPaid ? 0 : Math.max(0, roundCurrency(netPayableTotal) - amountPaid);
    const remainingBalance = grossRemainingBalance;

    let status: Invoice['status'] = 'Por Vencer';
    let statusText = `Vence en ${remainingDays} días`;
    let discount = 10;
    
    // Tolerancia por Redondeo de Centavos ($0.50 USD / ~20 Bs)
    const PENNY_TOLERANCE = 0.50;
    
    if (isExplicitlyPaid || grossRemainingBalance <= PENNY_TOLERANCE) {
        status = 'Pagado';
        statusText = grossRemainingBalance > 0 ? 'Pagado (Ajuste Centavos)' : 'Totalmente Pagado';
        discount = 0;
    } else if (order.status === 'En Verificación') {
        status = 'En Verificación';
        statusText = 'Abono en Verificación';
        discount = 0;
    } else if (remainingDays <= 0) {
        // CORRECCIÓN LÓGICA V8.1: Si los días llegaron a 0 o menos, es VENCIDO (Deuda Crítica), tenga o no abonos parciales
        status = 'Vencido';
        statusText = remainingDays === 0 ? 'Vence Hoy' : `Vencido hace ${Math.abs(remainingDays)} días`;
        discount = 0;
    } else if (amountPaid > 0) {
        status = 'Por Vencer';
        statusText = `Abono Parcial ($${amountPaid.toFixed(2)}) • ${remainingDays}d restantes`;
        discount = 0;
    } else {
        status = 'Por Vencer';
        statusText = `Vence en ${remainingDays} días`;
        discount = 10;
    }

    return {
        id: order.id || '',
        orderId: order.id || '',
        customerName: order.customerName,
        customerId: order.customerId,
        salespersonId: order.salespersonId,
        salespersonName: order.salespersonName,
        customerPhone: order.customerPhone || '',
        amountTotal: roundedTotal,
        amountPaid: amountPaid,
        remainingBalance: remainingBalance,
        netCashBalance: netCashBalance,
        dueDate: dueDate,
        status: status,
        statusText: statusText,
        remainingCreditDays: remainingDays,
        discountPercentage: discount,
        commercialDiscountPercentage: effectiveCommDiscount,
        currency: 'USD',
        createdAt: (order.createdAt || rawDate) as Timestamp,
        creditStartDate: creditStartDate,
    } as any;
}

/**
 * FÓRMULA OFICIAL DE DESCUENTO EN CASCADA (SUCESIVO) ATHLETICENTER
 * 1. Descuento Divisas/Contado (25%) aplicado al total de lista.
 * 2. Descuento Pronto Pago (10% a 7D ó 5% a 15D) aplicado SOBRE el subtotal de contado resultante.
 * 3. Si el pago ocurre en Mora (>30 días), 0% Descuento (100% Lista).
 */
export function calculateCascadePaymentDetails(order: Order, paymentDate: Date = new Date()): {
    listTotalUSD: number;
    cashSubtotalUSD: number;
    earlyPaymentDiscountPercent: number;
    finalNetPayableUSD: number;
    savingsUSD: number;
    tierName: string;
    isOverdue: boolean;
} {
    const listTotalUSD = roundCurrency(order.totalAmount || 0);
    if (listTotalUSD <= 0) {
        return { listTotalUSD: 0, cashSubtotalUSD: 0, earlyPaymentDiscountPercent: 0, finalNetPayableUSD: 0, savingsUSD: 0, tierName: 'N/A', isOverdue: false };
    }

    const hasFractionalNetDecimals = ((order.totalAmount || 0) % 1 !== 0) && ((order.totalAmount || 0).toString().split('.')[1]?.length > 2);

    if ((order as any).isNetPrice === true || (order as any).incentivesApplied === true || hasFractionalNetDecimals) {
        return {
            listTotalUSD,
            cashSubtotalUSD: listTotalUSD,
            earlyPaymentDiscountPercent: 0,
            finalNetPayableUSD: listTotalUSD,
            savingsUSD: 0,
            tierName: 'Precio Neto Fijo Registrado',
            isOverdue: false
        };
    }

    const salesDate = getSalesDate(order);
    const extension = typeof order.extensionDays === 'number' && order.extensionDays > 0 ? order.extensionDays : 0;
    const dueDate = addDays(salesDate, 30 + extension);
    const daysSinceSales = differenceInDays(paymentDate, salesDate);

    if (paymentDate > dueDate) {
        return {
            listTotalUSD,
            cashSubtotalUSD: listTotalUSD,
            earlyPaymentDiscountPercent: 0,
            finalNetPayableUSD: listTotalUSD,
            savingsUSD: 0,
            tierName: 'Tarifa Plena de Lista (Mora Crítica)',
            isOverdue: true
        };
    }

    const bcvDiscountPct = (order as any).bcvDiscountSnapshot ?? order.treasurySnapshot?.bcvDiscountPercent ?? 25;
    const cashSubtotalUSD = roundCurrency(listTotalUSD * (1 - (bcvDiscountPct / 100)));

    let earlyPct = 0;
    let tierName = 'Contado Base (16 a 30 Días)';

    if (daysSinceSales <= 7) {
        earlyPct = (order as any).earlyPayment7dSnapshot ?? 10;
        tierName = 'Pronto Pago 7 Días (Contado + 10% OFF)';
    } else if (daysSinceSales <= 15) {
        earlyPct = (order as any).earlyPayment15dSnapshot ?? 5;
        tierName = 'Pronto Pago 15 Días (Contado + 5% OFF)';
    }

    const finalNetPayableUSD = roundCurrency(cashSubtotalUSD * (1 - (earlyPct / 100)));
    const savingsUSD = roundCurrency(listTotalUSD - finalNetPayableUSD);

    return {
        listTotalUSD,
        cashSubtotalUSD,
        earlyPaymentDiscountPercent: earlyPct,
        finalNetPayableUSD,
        savingsUSD,
        tierName,
        isOverdue: false
    };
}

export function getPaymentSimulation(
    order: Order, 
    bcvRate: number = 78.50,
    treasurySettings?: { defaultBcvDiscount?: number; earlyPayment7Days?: number; earlyPayment15Days?: number }
) {
    if (!order) return null;
    const amountPaid = getEffectiveCashReceived(order);
    const grossTotal = order.totalAmount || 0;
    const grossRemaining = order.status === 'Pagado' ? 0 : Math.max(0, grossTotal - amountPaid);
    
    const cascadeDetails = calculateCascadePaymentDetails(order, new Date());
    const netTotal = cascadeDetails.finalNetPayableUSD;
    const netCashRemaining = order.status === 'Pagado' ? 0 : Math.max(0, netTotal - amountPaid);

    const early7Pct = (order as any).earlyPayment7dSnapshot ?? treasurySettings?.earlyPayment7Days ?? 10;
    const early15Pct = (order as any).earlyPayment15dSnapshot ?? treasurySettings?.earlyPayment15Days ?? 5;

    const rawDate = order.receptionDate || order.approvalDate || order.orderDate || order.createdAt;
    let creditDays = 0;
    if (rawDate) {
        const startDate = typeof (rawDate as any).toDate === 'function' ? (rawDate as any).toDate() : new Date(rawDate as any);
        if (!isNaN(startDate.getTime())) {
            creditDays = Math.max(0, differenceInDays(new Date(), startDate));
        }
    }

    const isOverdue = creditDays > 30 || (order.status as string) === 'Vencido';
    
    let prontoPago7d = netCashRemaining;
    let prontoPago15d = netCashRemaining;
    
    if (!isOverdue && netCashRemaining > 0) {
        prontoPago7d = Math.max(0, netCashRemaining * (1 - early7Pct / 100));
        prontoPago15d = Math.max(0, netCashRemaining * (1 - early15Pct / 100));
    }

    return {
        grossBcvUsd: grossRemaining,
        grossBcvVes: grossRemaining * bcvRate,
        netCashUsd: isOverdue ? grossRemaining : netCashRemaining,
        prontoPago7dUsd: isOverdue ? grossRemaining : prontoPago7d,
        prontoPago15dUsd: isOverdue ? grossRemaining : prontoPago15d,
        creditDays,
        isOverdue,
        appliedDiscountPercent: cascadeDetails.earlyPaymentDiscountPercent
    };
}

export function calculateGlobalFinancialMetrics(
    orders: Order[] | null,
    periodFilter: 'today' | '7d' | 'this_month' | 'last_month' | 'all' = 'all'
) {
    if (!orders || orders.length === 0) {
        return {
            totalRevenue: 0,
            totalDebts: 0,
            grossBcvDebt: 0,
            netCashDebt: 0,
            recaudadoCash: 0,
            cashBreakdown: { totalCash: 0, cashUsd: 0, zelle: 0, bcv: 0, custodia: 0, other: 0, payments: [] },
            vencido: 0,
            porVencer: 0,
            enVerificacion: 0,
            effectiveSalesCount: 0,
            pendingOrdersCount: 0,
            totalOrdersCount: 0,
            totalOrdersAmount: 0,
            liquidadosCount: 0,
            liquidadosAmount: 0
        };
    }

    const now = new Date();
    const VALID_SALES_STATUSES = ['Entregado', 'Completado', 'Despachado', 'Pagado', 'Aprobado', 'En Preparación', 'En Verificación'];

    const matchesPeriod = (d: Date) => {
        if (periodFilter === 'all') return true;
        if (periodFilter === 'today') {
            return isSameDay(d, now);
        }
        if (periodFilter === '7d') {
            return d >= startOfDay(subDays(now, 6));
        }
        if (periodFilter === 'this_month') {
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }
        if (periodFilter === 'last_month') {
            const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear();
        }
        return true;
    };

    let totalRevenue = 0;
    let totalDebts = 0;
    let grossBcvDebt = 0;
    let netCashDebt = 0;
    let recaudadoCash = 0;
    let vencido = 0;
    let porVencer = 0;
    let enVerificacion = 0;
    let effectiveSalesCount = 0;
    let pendingOrdersCount = 0;
    let totalOrdersCount = 0;
    let totalOrdersAmount = 0;
    let liquidadosCount = 0;
    let liquidadosAmount = 0;

    orders.forEach(order => {
        if (!order || order.status === 'Cancelado' || order.status === 'Rechazado' || order.status === 'Borrador') {
            return;
        }

        const salesDate = getSalesDate(order);
        const cashDate = getCashDate(order);

        if (matchesPeriod(salesDate)) {
            totalOrdersCount++;
            totalOrdersAmount += (order.totalAmount || 0);

            const isSalesStatus = VALID_SALES_STATUSES.includes(order.status);
            if (isSalesStatus) {
                totalRevenue += (order.totalAmount || 0);
                effectiveSalesCount++;
            }

            if (['Pendiente', 'Aprobado', 'En Preparación'].includes(order.status)) {
                pendingOrdersCount++;
            }

            const isDispatched = ['Despachado', 'Entregado', 'Completado'].includes(order.status);
            const invoice = getInvoiceFromOrder(order);
            const isFullyPaid = order.status === 'Pagado' || (invoice && invoice.remainingBalance <= 0.05);

            if (isDispatched && isFullyPaid) {
                liquidadosCount++;
                liquidadosAmount += (order.totalAmount || 0);
            }
        }

        if (matchesPeriod(cashDate)) {
            const cashReceived = getEffectiveCashReceived(order);
            recaudadoCash += cashReceived;
        }

        const invoice = getInvoiceFromOrder(order);
        if (invoice) {
            const amountPaid = getEffectiveCashReceived(order);
            const isPaid = order.status === 'Pagado' || invoice.remainingBalance <= 0.05;
            
            const grossRemaining = isPaid ? 0 : Math.max(0, order.totalAmount - amountPaid);
            const netRemaining = isPaid ? 0 : ((invoice as any).netCashBalance !== undefined ? (invoice as any).netCashBalance : Math.max(0, ((invoice as any).netPayableTotal || order.totalAmount) - amountPaid));

            // Si coincide con el periodo O si es deuda viva no pagada, se acumula para reflejar el estado real de cartera
            if (matchesPeriod(salesDate) || grossRemaining > 0.05) {
                grossBcvDebt += grossRemaining;
                netCashDebt += netRemaining;
                totalDebts += grossRemaining;

                if (invoice.status === 'Vencido') vencido += grossRemaining;
                if (invoice.status === 'Por Vencer') porVencer += grossRemaining;
                
                const hasPendingPaymentInSubcollection = Array.isArray((order as any).payments) && (order as any).payments.some((p: any) => p.status === 'pending_verification');
                if (invoice.status === 'En Verificación' || order.status === 'En Verificación' || hasPendingPaymentInSubcollection) {
                    enVerificacion += grossRemaining;
                }
            }
        }
    });

    return {
        totalRevenue,
        totalDebts,
        grossBcvDebt,
        netCashDebt,
        recaudadoCash,
        cashBreakdown: getCashBreakdown(orders, periodFilter),
        vencido,
        porVencer,
        enVerificacion,
        effectiveSalesCount,
        pendingOrdersCount,
        totalOrdersCount,
        totalOrdersAmount,
        liquidadosCount,
        liquidadosAmount
    };
}

export interface PaymentItem {
    id: string;
    orderId: string;
    customerName: string;
    customerRif?: string;
    customerPhone?: string;
    salespersonName?: string;
    registeredBy?: string;
    date: Date;
    method: string;
    amount: number;
    reference?: string;
    receiptUrl?: string;
    bankStatementUrl?: string;
    orderStatus?: string;
    rawOrder?: Order;
}

export function getCashBreakdown(
    orders: Order[] | null,
    periodFilter: 'today' | '7d' | 'this_month' | 'last_month' | 'custom' | 'all' = 'all',
    startDate?: string,
    endDate?: string
) {
    if (!orders || orders.length === 0) {
        return {
            totalCash: 0,
            cashUsd: 0,
            zelle: 0,
            binance: 0,
            bcv: 0,
            custodia: 0,
            other: 0,
            payments: [] as any[]
        };
    }

    const now = new Date();

    const matchesPeriod = (d: Date) => {
        if (!d || isNaN(d.getTime()) || d.getTime() === 0) return false;

        if (periodFilter === 'custom') {
            const startObj = startDate ? new Date(`${startDate}T00:00:00`) : null;
            const endObj = endDate ? new Date(`${endDate}T23:59:59`) : null;
            if (startObj && !isNaN(startObj.getTime()) && d < startObj) return false;
            if (endObj && !isNaN(endObj.getTime()) && d > endObj) return false;
            return true;
        }
        if (periodFilter === 'all') return true;
        if (periodFilter === 'today') return isSameDay(d, now);
        if (periodFilter === '7d') return d >= startOfDay(subDays(now, 6));
        if (periodFilter === 'this_month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        if (periodFilter === 'last_month') {
            const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear();
        }
        return true;
    };

    let totalCash = 0;
    let cashUsd = 0;
    let zelle = 0;
    let binance = 0;
    let bcv = 0;
    let custodia = 0;
    let other = 0;
    const payments: any[] = [];

    orders.forEach(o => {
        const cashAmt = getEffectiveCashReceived(o);
        if (cashAmt <= 0) return;

        const cashDate = getCashDate(o);
        if (!matchesPeriod(cashDate)) return;

        const orderPayments = Array.isArray((o as any).payments) && (o as any).payments.length > 0 
            ? (o as any).payments 
            : null;

        if (orderPayments) {
            orderPayments.forEach((p: any) => {
                const pAmt = Number(p.amount || p.monto || 0);
                if (pAmt <= 0) return;

                let pMethod = (p.method || p.paymentMethod || p.metodoPago || (o as any).paymentMethod || (o as any).metodoPago || '').trim();
                const pRef = (p.referenceNumber || p.reference || p.referencia || '').trim();
                const normRef = pRef.toLowerCase();

                if (!pMethod) {
                    if (normRef.startsWith('zel') || normRef.startsWith('wfct') || normRef.includes('zelle')) pMethod = 'Zelle';
                    else if (normRef.includes('binance') || normRef.includes('usdt')) pMethod = 'Binance Pay / USDT';
                    else if (normRef.includes('pm') || normRef.includes('pago movil')) pMethod = 'Pago Móvil';
                    else pMethod = 'Efectivo USD';
                }

                const normMethod = pMethod.toLowerCase();

                totalCash += pAmt;
                if (normMethod.includes('binance') || normMethod.includes('usdt') || normRef.includes('binance') || normRef.includes('usdt')) {
                    binance += pAmt;
                } else if (normMethod.includes('zelle') || normRef.includes('zelle') || normRef.startsWith('wfct')) {
                    zelle += pAmt;
                } else if (normMethod.includes('bcv') || normMethod.includes('pago móvil') || normMethod.includes('pago movil') || normMethod.includes('transferencia ves') || normMethod.includes('bolivar')) {
                    bcv += pAmt;
                } else if (normMethod.includes('custodia') || normMethod.includes('panamá') || normMethod.includes('panama')) {
                    custodia += pAmt;
                } else {
                    cashUsd += pAmt;
                }

                let pDate = cashDate;
                if (p.paymentDate) {
                    pDate = typeof (p.paymentDate as any).toDate === 'function' ? (p.paymentDate as any).toDate() : new Date(p.paymentDate);
                }

                payments.push({
                    id: p.id || `${o.id}_${payments.length}`,
                    orderId: `#${(o.id || '').substring(0, 8).toUpperCase()}`,
                    customerName: o.customerName || 'Cliente General',
                    customerRif: o.customerRif || '',
                    customerPhone: o.customerPhone || '',
                    salespersonName: o.salespersonName || 'Directo',
                    registeredBy: p.registeredByName || p.registeredBy || (o as any).registeredByName || o.salespersonName || 'Sistema / Caja',
                    date: pDate,
                    method: pMethod,
                    amount: pAmt,
                    reference: pRef,
                    receiptUrl: p.imageUrl || p.paymentReceiptUrl || p.comprobanteUrl || p.receiptUrl || p.retentionImageUrl || '',
                    orderStatus: o.status,
                    rawOrder: o
                });
            });
        } else {
            let method = ((o as any).paymentMethod || (o as any).metodoPago || (o as any).method || (o as any).paymentWay || '').trim();
            const ref = ((o as any).paymentReference || (o as any).referencia || (o as any).reference || '').trim();
            const normRef = ref.toLowerCase();

            if (!method) {
                if (normRef.startsWith('zel') || normRef.startsWith('wfct') || normRef.includes('zelle')) method = 'Zelle';
                else if (normRef.includes('pm') || normRef.includes('pago movil')) method = 'Pago Móvil';
                else method = 'Efectivo USD';
            }

            const normMethod = method.toLowerCase();

            totalCash += cashAmt;
            if (normMethod.includes('zelle') || normRef.includes('zelle') || normRef.startsWith('wfct')) {
                zelle += cashAmt;
            } else if (normMethod.includes('bcv') || normMethod.includes('pago móvil') || normMethod.includes('pago movil') || normMethod.includes('transferencia ves') || normMethod.includes('bolivar')) {
                bcv += cashAmt;
            } else if (normMethod.includes('custodia') || normMethod.includes('panamá') || normMethod.includes('panama')) {
                custodia += cashAmt;
            } else {
                cashUsd += cashAmt;
            }

            payments.push({
                id: o.id,
                orderId: `#${(o.id || '').substring(0, 8).toUpperCase()}`,
                customerName: o.customerName || 'Cliente General',
                customerRif: o.customerRif || '',
                customerPhone: o.customerPhone || '',
                salespersonName: o.salespersonName || 'Directo',
                registeredBy: (o as any).registeredByName || (o as any).registeredBy || o.salespersonName || 'Sistema / Caja',
                date: cashDate,
                method: method,
                amount: cashAmt,
                reference: ref,
                receiptUrl: (o as any).paymentReceiptUrl || (o as any).comprobanteUrl || (o as any).receiptUrl || (o as any).imageUrl || (o as any).paymentProofUrl || (o as any).voucherUrl || (o as any).voucher || (o as any).comprobante || (o as any).screenshot || (o as any).retentionImageUrl || '',
                orderStatus: o.status,
                rawOrder: o
            });
        }
    });

    payments.sort((a, b) => b.date.getTime() - a.date.getTime());

    return {
        totalCash,
        cashUsd,
        zelle,
        bcv,
        custodia,
        other,
        payments
    };
}

/**
 * REBAJA AUTOMÁTICA DE INVENTARIO Y REGISTRO EN LIBRO DE TRAZABILIDAD (stockMovements)
 */
export async function processStockDeductionForOrder(
    firestore: any,
    order: Order,
    orderItems: any[],
    actorName: string = 'Sistema'
): Promise<boolean> {
    if (!firestore || !order || (order as any).stockDeducted === true) {
        return false;
    }

    try {
        const batch = writeBatch(firestore);
        const invoiceNum = order.historicalInvoiceNumber || `#FACT-${(order.id || '').substring(0, 8).toUpperCase()}`;

        for (const item of orderItems) {
            const pId = item.productId || item.id;
            if (!pId) continue;
            
            const pRef = doc(firestore, 'products', pId);
            const pSnap = await getDoc(pRef);
            if (!pSnap.exists()) continue;

            const productData = pSnap.data();
            const currentStock = typeof productData.stockLevel === 'number' ? productData.stockLevel : 0;
            const qty = Number(item.quantity || 1);
            const newStock = Math.max(0, currentStock - qty);
            const unitCost = Number(productData.cost || productData.priceCashUSD * 0.6 || 0);
            const unitPrice = Number(item.unitPrice || productData.priceCashUSD || 0);

            // Actualizar stock de producto
            batch.update(pRef, { 
                stockLevel: newStock,
                lastSoldAt: serverTimestamp(),
                totalSold: (productData.totalSold || 0) + qty
            });

            // Registrar movimiento de trazabilidad inmutable
            const movRef = doc(collection(firestore, 'stockMovements'));
            batch.set(movRef, {
                id: movRef.id,
                productId: pId,
                sku: productData.sku || 'S/SKU',
                productName: productData.name || item.productName || 'Producto',
                type: 'ORDER_DEDUCTION',
                quantity: -qty,
                previousStock: currentStock,
                newStock: newStock,
                unitCostUSD: unitCost,
                totalCostImpactUSD: qty * unitCost,
                unitPriceUSD: unitPrice,
                totalValuationImpactUSD: qty * unitPrice,
                orderId: order.id,
                invoiceNumber: invoiceNum,
                salespersonId: getSalespersonKey(order),
                salespersonName: getSalespersonDisplayName(order),
                timestamp: serverTimestamp(),
                createdBy: actorName
            });
        }

        // Marcar la orden como descontada
        const orderRef = doc(firestore, 'orders', order.id);
        batch.update(orderRef, { stockDeducted: true });

        await batch.commit();
        return true;
    } catch (e) {
        console.error("Error procesando rebaja automática de inventario:", e);
        return false;
    }
}

/**
 * GENERACIÓN AUTOMÁTICA DE COMISIONES POR COBRANZA BAJADA
 */
export async function processAutomaticCommissionsForPayment(
    firestore: any,
    order: Order,
    paymentAmountUSD: number,
    paymentId: string,
    settings: any,
    actorName: string = 'Sistema',
    paymentMethod: string = 'CASH'
): Promise<boolean> {
    if (!firestore || !order || paymentAmountUSD <= 0) return false;

    try {
        const batch = writeBatch(firestore);
        const bcvRate = settings?.bcvRate || 36.5;
        const paymentAmountBS = roundCurrency(paymentAmountUSD * bcvRate);
        const invoiceNum = order.historicalInvoiceNumber || `#FACT-${(order.id || '').substring(0, 8).toUpperCase()}`;

        // Porcentajes dinámicos desde Tesorería / Perfil de Vendedor
        const salespersonRate = typeof order.salespersonCommissionRate === 'number' ? order.salespersonCommissionRate : (settings?.defaultCommission ?? 5);
        const managerRate = settings?.salesManagerCommission ?? 5;
        const adminRate = settings?.adminCommission ?? 0;

        const spKey = getSalespersonKey(order);
        const spName = getSalespersonDisplayName(order);
        const clientNameStr = order.customerName || 'Cliente B2B';

        // 1. Comisión Vendedor Directo
        if (salespersonRate > 0) {
            const spCommUSD = roundCurrency(paymentAmountUSD * (salespersonRate / 100));
            const commRef = doc(collection(firestore, 'commissions'));
            batch.set(commRef, {
                id: commRef.id,
                orderId: order.id,
                orderNumber: order.id,
                invoiceNumber: invoiceNum,
                paymentId: paymentId,
                customerName: clientNameStr,
                clientName: clientNameStr,
                salespersonId: spKey,
                salespersonName: spName,
                recipientUserId: spKey,
                recipientName: spName,
                recipientRole: 'SALESPERSON',
                commissionType: 'vendedor',
                paymentAmountUSD,
                invoiceAmount: paymentAmountUSD,
                paymentAmountBS,
                bcvRate,
                rateApplied: salespersonRate,
                commissionPercent: salespersonRate,
                salespersonCommissionAmount: spCommUSD,
                commissionAmountUSD: spCommUSD,
                commissionAmountBS: roundCurrency(spCommUSD * bcvRate),
                commissionDate: serverTimestamp(),
                collectionDate: serverTimestamp(),
                currency: 'USD',
                paymentMethod: paymentMethod || 'CASH',
                status: 'pendiente',
                createdAt: serverTimestamp(),
                createdBy: actorName
            });
        }

        // 2. Comisión Gerencia de Ventas (Jsutobermudez / Override Global)
        if (managerRate > 0) {
            const mgrCommUSD = roundCurrency(paymentAmountUSD * (managerRate / 100));
            const mgrCommRef = doc(collection(firestore, 'commissions'));
            batch.set(mgrCommRef, {
                id: mgrCommRef.id,
                orderId: order.id,
                orderNumber: order.id,
                invoiceNumber: invoiceNum,
                paymentId: paymentId,
                customerName: clientNameStr,
                clientName: clientNameStr,
                salespersonId: 'GERENCIA_SALES_MANAGER',
                salespersonName: '👔 Jsutobermudez (Gerente de Ventas - Override)',
                recipientUserId: 'gerencia_ventas_override',
                recipientName: '👔 Jsutobermudez (Gerente de Ventas - Override)',
                recipientRole: 'SALES_MANAGER',
                commissionType: 'gerencia',
                paymentAmountUSD,
                invoiceAmount: paymentAmountUSD,
                paymentAmountBS,
                bcvRate,
                rateApplied: managerRate,
                commissionPercent: managerRate,
                salespersonCommissionAmount: mgrCommUSD,
                commissionAmountUSD: mgrCommUSD,
                commissionAmountBS: roundCurrency(mgrCommUSD * bcvRate),
                commissionDate: serverTimestamp(),
                collectionDate: serverTimestamp(),
                currency: 'USD',
                paymentMethod: paymentMethod || 'CASH',
                status: 'pendiente',
                createdAt: serverTimestamp(),
                createdBy: actorName
            });
        }

        // 3. Comisión Administración (Si aplica en Tesorería)
        if (adminRate > 0) {
            const admCommUSD = roundCurrency(paymentAmountUSD * (adminRate / 100));
            const admCommRef = doc(collection(firestore, 'commissions'));
            batch.set(admCommRef, {
                id: admCommRef.id,
                orderId: order.id,
                orderNumber: order.id,
                invoiceNumber: invoiceNum,
                paymentId: paymentId,
                customerName: clientNameStr,
                clientName: clientNameStr,
                salespersonId: 'ADMINISTRACION',
                salespersonName: '🏢 Administración / Gestión de Cobranza',
                recipientUserId: 'admin_override',
                recipientName: '🏢 Administración / Gestión de Cobranza',
                recipientRole: 'ADMIN',
                commissionType: 'admin',
                paymentAmountUSD,
                invoiceAmount: paymentAmountUSD,
                paymentAmountBS,
                bcvRate,
                rateApplied: adminRate,
                commissionPercent: adminRate,
                salespersonCommissionAmount: admCommUSD,
                commissionAmountUSD: admCommUSD,
                commissionAmountBS: roundCurrency(admCommUSD * bcvRate),
                commissionDate: serverTimestamp(),
                collectionDate: serverTimestamp(),
                currency: 'USD',
                paymentMethod: paymentMethod || 'CASH',
                status: 'pendiente',
                createdAt: serverTimestamp(),
                createdBy: actorName
            });
        }

        await batch.commit();
        return true;
    } catch (e) {
        console.error("Error al generar comisiones automáticas:", e);
        return false;
    }
}

/**
 * CÁLCULO MULTI-VARIABLE POR DISCIPLINA DEPORTIVA (Ventas, Cobranzas, Mora y Top Vendedor)
 */
export function calculateMetricsByDiscipline(orders: Order[], products?: any[]): Array<{
    discipline: string;
    ventas: number;
    cobranzas: number;
    moraCritica: number;
    pending: number;
    totalUnits: number;
    topSalespersonName: string;
    topSalespersonAmount: number;
    efficiencyPct: number;
}> {
    if (!orders || orders.length === 0) return [];

    const productDisciplineMap = new Map<string, string>();
    if (products) {
        products.forEach(p => {
            if (p.id && p.discipline) productDisciplineMap.set(p.id, p.discipline.trim());
            if (p.sku && p.discipline) productDisciplineMap.set(p.sku, p.discipline.trim());
        });
    }

    const disciplineMap = new Map<string, {
        discipline: string;
        ventas: number;
        cobranzas: number;
        moraCritica: number;
        pending: number;
        totalUnits: number;
        salespersonSales: Map<string, number>;
    }>();

    const VALID_STATUSES = ['Entregado', 'Completado', 'Despachado', 'Pagado', 'Aprobado', 'En Preparación', 'En Verificación'];

    orders.forEach(order => {
        if (!VALID_STATUSES.includes(order.status)) return;

        const orderTotal = order.totalAmount || 1;
        const cashPaid = getEffectiveCashReceived(order);
        const cashRatio = Math.min(1, cashPaid / orderTotal);
        const isMora = isOrderInMoraCritica(order);
        const spName = getSalespersonDisplayName(order);

        const items = Array.isArray((order as any).items) ? (order as any).items : [];

        if (items.length > 0) {
            items.forEach((item: any) => {
                const disc = item.discipline || productDisciplineMap.get(item.productId) || productDisciplineMap.get(item.sku) || productDisciplineMap.get(item.id) || 'General / Multideporte';
                const itemTotal = Number(item.unitPrice || 0) * Number(item.quantity || 1);
                const itemCash = itemTotal * cashRatio;
                const itemPending = Math.max(0, itemTotal - itemCash);
                const itemMora = isMora ? itemPending : 0;
                const qty = Number(item.quantity || 1);

                if (!disciplineMap.has(disc)) {
                    disciplineMap.set(disc, {
                        discipline: disc,
                        ventas: 0,
                        cobranzas: 0,
                        moraCritica: 0,
                        pending: 0,
                        totalUnits: 0,
                        salespersonSales: new Map<string, number>()
                    });
                }

                const entry = disciplineMap.get(disc)!;
                entry.ventas += itemTotal;
                entry.cobranzas += itemCash;
                entry.pending += itemPending;
                entry.moraCritica += itemMora;
                entry.totalUnits += qty;

                const currentSpSales = entry.salespersonSales.get(spName) || 0;
                entry.salespersonSales.set(spName, currentSpSales + itemTotal);
            });
        } else {
            const disc = 'General / Multideporte';
            const itemTotal = orderTotal;
            const itemCash = cashPaid;
            const itemPending = Math.max(0, itemTotal - itemCash);
            const itemMora = isMora ? itemPending : 0;

            if (!disciplineMap.has(disc)) {
                disciplineMap.set(disc, {
                    discipline: disc,
                    ventas: 0,
                    cobranzas: 0,
                    moraCritica: 0,
                    pending: 0,
                    totalUnits: 0,
                    salespersonSales: new Map<string, number>()
                });
            }

            const entry = disciplineMap.get(disc)!;
            entry.ventas += itemTotal;
            entry.cobranzas += itemCash;
            entry.pending += itemPending;
            entry.moraCritica += itemMora;

            const currentSpSales = entry.salespersonSales.get(spName) || 0;
            entry.salespersonSales.set(spName, currentSpSales + itemTotal);
        }
    });

    return Array.from(disciplineMap.values()).map(d => {
        let topSpName = 'Sin Datos';
        let topSpAmt = 0;

        d.salespersonSales.forEach((amt, name) => {
            if (amt > topSpAmt) {
                topSpAmt = amt;
                topSpName = name;
            }
        });

        const eff = d.ventas > 0 ? (d.cobranzas / d.ventas) * 100 : 0;

        return {
            discipline: d.discipline,
            ventas: roundCurrency(d.ventas),
            cobranzas: roundCurrency(d.cobranzas),
            moraCritica: roundCurrency(d.moraCritica),
            pending: roundCurrency(d.pending),
            totalUnits: d.totalUnits,
            topSalespersonName: topSpName,
            topSalespersonAmount: roundCurrency(topSpAmt),
            efficiencyPct: roundCurrency(eff)
        };
    }).sort((a, b) => b.ventas - a.ventas);
}

/**
 * CÁLCULO MULTI-VARIABLE POR VENDEDOR / ASESOR COMERCIAL
 */
export function calculateMetricsBySalesperson(orders: Order[]): Array<{
    salespersonKey: string;
    salespersonName: string;
    ventas: number;
    cobranzas: number;
    moraCritica: number;
    pending: number;
    orderCount: number;
    efficiencyPct: number;
}> {
    if (!orders || orders.length === 0) return [];

    const map = new Map<string, {
        salespersonKey: string;
        salespersonName: string;
        ventas: number;
        cobranzas: number;
        moraCritica: number;
        pending: number;
        orderCount: number;
    }>();

    const VALID_STATUSES = ['Entregado', 'Completado', 'Despachado', 'Pagado', 'Aprobado', 'En Preparación', 'En Verificación'];

    orders.forEach(order => {
        if (!VALID_STATUSES.includes(order.status)) return;

        const spKey = getSalespersonKey(order);
        const spName = getSalespersonDisplayName(order);
        const total = order.totalAmount || 0;
        const cash = getEffectiveCashReceived(order);
        const rem = Math.max(0, total - cash);
        const mora = isOrderInMoraCritica(order) ? rem : 0;

        if (!map.has(spKey)) {
            map.set(spKey, {
                salespersonKey: spKey,
                salespersonName: spName,
                ventas: 0,
                cobranzas: 0,
                moraCritica: 0,
                pending: 0,
                orderCount: 0
            });
        }

        const entry = map.get(spKey)!;
        entry.ventas += total;
        entry.cobranzas += cash;
        entry.pending += rem;
        entry.moraCritica += mora;
        entry.orderCount += 1;
    });

    return Array.from(map.values()).map(sp => {
        const eff = sp.ventas > 0 ? (sp.cobranzas / sp.ventas) * 100 : 0;
        return {
            salespersonKey: sp.salespersonKey,
            salespersonName: sp.salespersonName,
            ventas: roundCurrency(sp.ventas),
            cobranzas: roundCurrency(sp.cobranzas),
            moraCritica: roundCurrency(sp.moraCritica),
            pending: roundCurrency(sp.pending),
            orderCount: sp.orderCount,
            efficiencyPct: roundCurrency(eff)
        };
    }).sort((a, b) => b.ventas - a.ventas);
}


