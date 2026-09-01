import { addDays, differenceInDays, subDays, startOfDay, isSameDay } from 'date-fns';
import { Timestamp } from 'firebase/firestore';
import type { Order, Invoice } from './definitions';

export function roundCurrency(value: number): number {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function getEffectiveCashReceived(o: Order): number {
    if (!o) return 0;
    if (o.status === 'Pagado' || (o as any).isPaid === true || (o as any).paymentStatus === 'Pagado') {
        return o.totalAmount || 0;
    }
    const cash = typeof o.totalCashReceived === 'number' && o.totalCashReceived > 0 ? o.totalCashReceived : 0;
    const paid = typeof o.amountPaid === 'number' && o.amountPaid > 0 ? o.amountPaid : 0;
    const altPaid = (o as any).paidAmount || (o as any).totalPaid || (o as any).montoPagado || 0;
    const numAltPaid = typeof altPaid === 'number' && altPaid > 0 ? altPaid : 0;
    
    let sumPayments = 0;
    if (Array.isArray((o as any).payments)) {
        sumPayments = (o as any).payments.reduce((s: number, p: any) => s + (Number(p.amount || p.monto) || 0), 0);
    }
    
    const effectivePaid = Math.max(cash, paid, numAltPaid, sumPayments);
    return Math.min(effectivePaid, o.totalAmount || effectivePaid);
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
    
    const dueDate = addDays(creditStartDate, 30);
    const today = new Date();
    const remainingDays = differenceInDays(dueDate, today);
    const amountPaid = getEffectiveCashReceived(order);
    const commercialDiscountPercent = getOrderCommercialDiscountPercent(order, undefined, fallbackTreasuryDiscount);
    
    const isAlreadyNetOrDiscounted = (order as any).incentivesApplied === true || (order as any).isNetPrice === true;
    const effectiveCommDiscount = isAlreadyNetOrDiscounted ? 0 : commercialDiscountPercent;

    const discountAmount = (order.totalAmount * effectiveCommDiscount) / 100;
    const netPayableTotal = Math.max(0, order.totalAmount - discountAmount);
    const isExplicitlyPaid = order.status === 'Pagado';
    
    // Base Deuda Bruta a Lista BCV (sin doble descuento)
    const grossRemainingBalance = isExplicitlyPaid ? 0 : Math.max(0, order.totalAmount - amountPaid);
    const netCashBalance = isExplicitlyPaid ? 0 : Math.max(0, netPayableTotal - amountPaid);
    const remainingBalance = grossRemainingBalance;

    let status: Invoice['status'] = 'Por Vencer';
    let statusText = `Vence en ${remainingDays} días`;
    let discount = 10;
    
    if (isExplicitlyPaid || grossRemainingBalance <= 0.05) {
        status = 'Pagado';
        statusText = 'Totalmente Pagado';
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
        amountTotal: order.totalAmount,
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

export function getPaymentSimulation(
    order: Order, 
    bcvRate: number = 78.50,
    treasurySettings?: { defaultBcvDiscount?: number; earlyPayment7Days?: number; earlyPayment15Days?: number }
) {
    if (!order) return null;
    const amountPaid = getEffectiveCashReceived(order);
    const grossTotal = order.totalAmount || 0;
    const grossRemaining = order.status === 'Pagado' ? 0 : Math.max(0, grossTotal - amountPaid);
    
    const fallbackDiscount = treasurySettings?.defaultBcvDiscount !== undefined ? treasurySettings.defaultBcvDiscount : 25;
    const commDiscountPercent = getOrderCommercialDiscountPercent(order, undefined, fallbackDiscount);

    // PREVENCIÓN DE DOBLE DESCUENTO: Si la orden ya trae incentivos aplicados o fue guardada a tarifa neta
    const isAlreadyNetOrDiscounted = (order as any).incentivesApplied === true || (order as any).isNetPrice === true;
    const effectiveCommDiscount = isAlreadyNetOrDiscounted ? 0 : commDiscountPercent;

    const netTotal = Math.max(0, grossTotal - (grossTotal * effectiveCommDiscount / 100));
    const netCashRemaining = order.status === 'Pagado' ? 0 : Math.max(0, netTotal - amountPaid);

    // Pronto pago dinámico de Tesorería (Custodia por snapshot o fallback)
    const early7Pct = order.treasurySnapshot?.earlyPayment7dPercent ?? treasurySettings?.earlyPayment7Days ?? 10;
    const early15Pct = order.treasurySnapshot?.earlyPayment15dPercent ?? treasurySettings?.earlyPayment15Days ?? 5;

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
        appliedDiscountPercent: effectiveCommDiscount
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
                if (invoice.status === 'En Verificación') enVerificacion += grossRemaining;
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
