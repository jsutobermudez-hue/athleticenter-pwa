import { addDays, differenceInDays, subDays, startOfDay, isSameDay } from 'date-fns';
import { Timestamp } from 'firebase/firestore';
import type { Order, Invoice } from './definitions';

export function getEffectiveCashReceived(o: Order): number {
    if (!o) return 0;
    if (typeof o.totalCashReceived === 'number' && o.totalCashReceived > 0) return o.totalCashReceived;
    if (typeof o.amountPaid === 'number' && o.amountPaid > 0) return o.amountPaid;
    const altPaid = (o as any).paidAmount || (o as any).totalPaid || (o as any).montoPagado;
    if (typeof altPaid === 'number' && altPaid > 0) return altPaid;
    if (Array.isArray((o as any).payments)) {
        const sumPayments = (o as any).payments.reduce((s: number, p: any) => s + (p.amount || p.monto || 0), 0);
        if (sumPayments > 0) return sumPayments;
    }
    if (o.status === 'Pagado' || (o as any).isPaid === true || (o as any).paymentStatus === 'Pagado') return o.totalAmount || 0;
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

export const CUTOFF_DISCOUNT_DATE = new Date('2026-08-02T00:00:00.000Z');

/**
 * LISTA DE MÉTODOS DE PAGO EN DIVISAS VÁLIDOS PARA EL DESCUENTO DE CONTADO/PRONTO PAGO
 */
export const FOREIGN_CURRENCY_PAYMENT_METHODS = [
    'Efectivo USD',
    'Efectivo $',
    'Zelle',
    'Transferencia USD',
    'Banesco Panamá',
    'Mercantil Panamá',
    'Cuenta Custodia USD',
    'Binance / USDT',
    'PayPal',
    'Wire Transfer USD',
    'Divisas'
];

export function isForeignCurrencyPaymentMethod(method?: string): boolean {
    if (!method) return true; // Por defecto asumimos divisas en cotizaciones/órdenes estándar en USD
    const normalized = method.trim().toLowerCase();
    
    // Si contiene bolivares, bcv, pago movil -> Es VES
    if (normalized.includes('bcv') || normalized.includes('pago móvil') || normalized.includes('pago movil') || normalized.includes('ves') || normalized.includes('bolivar')) {
        return false;
    }
    return true;
}

/**
 * Retorna el Porcentaje de Descuento Comercial Base aplicado a la Orden.
 * 1. Si el pago es en Bolívares (VES/BCV) -> 0% Descuento Divisas (Se liquida a Precio Lista BCV).
 * 2. Si es en Divisas (Efectivo USD, Zelle, Banesco Panamá, Binance, etc.):
 *    - Si el pedido tiene congelado `order.appliedDiscountPercent`, usa ese valor.
 *    - Pedidos creados ANTES del 02/08/2026 -> 35% de Descuento Divisas
 *    - Pedidos creados el 02/08/2026 o DESPUÉS -> 25% de Descuento Divisas
 */
export function getOrderCommercialDiscountPercent(order: Order, paymentMethod?: string, defaultCurrentDiscount: number = 25): number {
    if (!order) return defaultCurrentDiscount;

    // Si se especifica un método de pago en Bolívares, no aplica descuento de contado en divisas
    if (paymentMethod && !isForeignCurrencyPaymentMethod(paymentMethod)) {
        return 0;
    }

    if (typeof (order as any).appliedDiscountPercent === 'number') {
        return (order as any).appliedDiscountPercent;
    }
    
    const rawDate = order.createdAt || order.orderDate || order.receptionDate;
    if (!rawDate) return defaultCurrentDiscount;

    const orderDate = typeof (rawDate as any).toDate === 'function' 
        ? (rawDate as Timestamp).toDate() 
        : new Date(rawDate as any);

    if (isNaN(orderDate.getTime())) return defaultCurrentDiscount;

    if (orderDate.getTime() < CUTOFF_DISCOUNT_DATE.getTime()) {
        return 35; // 35% de descuento histórico en Divisas previo al 2 de Agosto de 2026
    }
    
    return defaultCurrentDiscount; // 25% activo en Divisas desde el 2 de Agosto de 2026
}

export function getInvoiceFromOrder(order: Order): Invoice | null {
    if (!['Entregado', 'En Verificación', 'Pagado', 'Despachado', 'Completado', 'En Preparación', 'Aprobado'].includes(order.status)) {
        return null;
    }
    
    const rawDate = order.receptionDate || order.approvalDate || order.orderDate;
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
    const remainingBalance = Math.max(0, order.totalAmount - amountPaid);
    const commercialDiscountPercent = getOrderCommercialDiscountPercent(order);

    let status: Invoice['status'] = 'Por Vencer';
    let statusText = `Vence en ${remainingDays} días`;
    let discount = 10;
    
    if (order.status === 'Pagado' || remainingBalance <= 0.05) {
        status = 'Pagado';
        statusText = 'Totalmente Pagado';
        discount = 0;
    } else if (order.status === 'En Verificación') {
        status = 'En Verificación';
        statusText = 'Abono en Verificación';
        discount = 0;
    } else if (remainingDays <= 0) {
        status = 'Vencido';
        statusText = `Vencido hace ${Math.abs(remainingDays)} días`;
        discount = 0;
    } else if (remainingDays <= 7) {
        discount = 0;
    } else if (remainingDays <= 15) {
        discount = 5;
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
        dueDate: dueDate,
        status: status,
        statusText: statusText,
        remainingCreditDays: remainingDays,
        discountPercentage: discount,
        commercialDiscountPercentage: commercialDiscountPercent,
        currency: 'USD',
        createdAt: (order.createdAt || rawDate) as Timestamp,
        creditStartDate: creditStartDate,
    } as any;
}

export function calculateGlobalFinancialMetrics(
    orders: Order[] | null,
    periodFilter: 'today' | '7d' | 'this_month' | 'last_month' | 'all' = 'all'
) {
    if (!orders || orders.length === 0) {
        return {
            totalRevenue: 0,
            totalDebts: 0,
            recaudadoCash: 0,
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

        // 1. Pedidos Realizados (Todas las fases activas)
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

        // 2. Cobranzas Cash
        if (matchesPeriod(cashDate)) {
            const cashReceived = getEffectiveCashReceived(order);
            recaudadoCash += cashReceived;
        }

        // 3. Deuda Activa
        const invoice = getInvoiceFromOrder(order);
        if (invoice && matchesPeriod(salesDate)) {
            if (invoice.status === 'Vencido') vencido += invoice.remainingBalance;
            if (invoice.status === 'Por Vencer') porVencer += invoice.remainingBalance;
            if (invoice.status === 'En Verificación') enVerificacion += invoice.remainingBalance;

            if (invoice.remainingBalance > 0.05 && invoice.status !== 'Pagado') {
        totalDebts += invoice.remainingBalance;
            }
        }
    });

    const cashBreakdown = getCashBreakdown(orders, periodFilter);

    return {
        totalRevenue,
        totalDebts,
        recaudadoCash,
        vencido,
        porVencer,
        enVerificacion,
        effectiveSalesCount,
        pendingOrdersCount,
        totalOrdersCount,
        totalOrdersAmount,
        liquidadosCount,
        liquidadosAmount,
        cashBreakdown
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
    orderStatus?: string;
    rawOrder?: Order;
}

export function getCashBreakdown(
    orders: Order[] | null,
    periodFilter: 'today' | '7d' | 'this_month' | 'last_month' | 'custom' | 'all' = 'all',
    customStartDate?: string,
    customEndDate?: string
) {
    if (!orders || orders.length === 0) {
        return {
            totalCash: 0,
            cashUsd: 0,
            zelle: 0,
            bcv: 0,
            custodia: 0,
            other: 0,
            payments: [] as PaymentItem[]
        };
    }

    const now = new Date();
    const startObj = customStartDate ? new Date(`${customStartDate}T00:00:00`) : null;
    const endObj = customEndDate ? new Date(`${customEndDate}T23:59:59`) : null;

    const matchesPeriod = (d: Date) => {
        if (periodFilter === 'all') return true;
        if (periodFilter === 'custom') {
            if (startObj && !isNaN(startObj.getTime()) && d < startObj) return false;
            if (endObj && !isNaN(endObj.getTime()) && d > endObj) return false;
            return true;
        }
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
    let bcv = 0;
    let custodia = 0;
    let other = 0;
    const payments: PaymentItem[] = [];

    orders.forEach(o => {
        const cashAmt = getEffectiveCashReceived(o);
        if (cashAmt <= 0) return;

        const cashDate = getCashDate(o);
        if (!matchesPeriod(cashDate)) return;

        totalCash += cashAmt;
        const method = ((o as any).paymentMethod || (o as any).metodoPago || 'Efectivo USD').trim();
        const normMethod = method.toLowerCase();

        if (normMethod.includes('zelle')) {
            zelle += cashAmt;
        } else if (normMethod.includes('efectivo') || normMethod.includes('cash') || normMethod.includes('divisas')) {
            cashUsd += cashAmt;
        } else if (normMethod.includes('bcv') || normMethod.includes('pago móvil') || normMethod.includes('pago movil') || normMethod.includes('transferencia ves') || normMethod.includes('bolivar')) {
            bcv += cashAmt;
        } else if (normMethod.includes('custodia') || normMethod.includes('panamá') || normMethod.includes('panama')) {
            custodia += cashAmt;
        } else {
            other += cashAmt;
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
            reference: (o as any).paymentReference || (o as any).referencia || '',
            receiptUrl: (o as any).paymentReceiptUrl || (o as any).comprobanteUrl || (o as any).receiptUrl || (o as any).imageUrl || (o as any).paymentProofUrl || (o as any).voucherUrl || (o as any).voucher || (o as any).comprobante || (o as any).screenshot || (o as any).retentionImageUrl || '',
            orderStatus: o.status,
            rawOrder: o
        });
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
