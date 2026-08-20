import { addDays, differenceInDays } from 'date-fns';
import { Timestamp } from 'firebase/firestore';
import type { Order, Invoice } from './definitions';

export function getEffectiveCashReceived(o: Order): number {
    if (!o) return 0;
    if (typeof o.totalCashReceived === 'number' && o.totalCashReceived > 0) return o.totalCashReceived;
    if (typeof o.amountPaid === 'number' && o.amountPaid > 0) return o.amountPaid;
    const altPaid = (o as any).paidAmount || (o as any).totalPaid || (o as any).montoPagado;
    if (typeof altPaid === 'number' && altPaid > 0) return altPaid;
    if (o.status === 'Pagado' || (o as any).isPaid === true || (o as any).paymentStatus === 'Pagado') return o.totalAmount || 0;
    return 0;
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

export function calculateGlobalFinancialMetrics(orders: Order[] | null) {
    if (!orders || orders.length === 0) {
        return {
            totalRevenue: 0,
            totalDebts: 0,
            recaudadoCash: 0,
            vencido: 0,
            porVencer: 0,
            enVerificacion: 0,
            effectiveSalesCount: 0,
            pendingOrdersCount: 0
        };
    }

    const VALID_SALES_STATUSES = ['Entregado', 'Completado', 'Despachado', 'Pagado', 'Aprobado', 'En Preparación', 'En Verificación'];

    let totalRevenue = 0;
    let totalDebts = 0;
    let recaudadoCash = 0;
    let vencido = 0;
    let porVencer = 0;
    let enVerificacion = 0;
    let effectiveSalesCount = 0;
    let pendingOrdersCount = 0;

    orders.forEach(order => {
        if (!order || order.status === 'Cancelado' || order.status === 'Rechazado' || order.status === 'Borrador') {
            return;
        }

        const isSalesStatus = VALID_SALES_STATUSES.includes(order.status);
        if (isSalesStatus) {
            totalRevenue += (order.totalAmount || 0);
            effectiveSalesCount++;
        }

        const cashReceived = getEffectiveCashReceived(order);
        recaudadoCash += cashReceived;

        if (['Pendiente', 'Aprobado', 'En Preparación'].includes(order.status)) {
            pendingOrdersCount++;
        }

        const invoice = getInvoiceFromOrder(order);
        if (invoice) {
            if (invoice.status === 'Vencido') vencido += invoice.remainingBalance;
            if (invoice.status === 'Por Vencer') porVencer += invoice.remainingBalance;
            if (invoice.status === 'En Verificación') enVerificacion += invoice.remainingBalance;

            if (invoice.remainingBalance > 0.05 && invoice.status !== 'Pagado') {
                totalDebts += invoice.remainingBalance;
            }
        }
    });

    return {
        totalRevenue,
        totalDebts,
        recaudadoCash,
        vencido,
        porVencer,
        enVerificacion,
        effectiveSalesCount,
        pendingOrdersCount
    };
}
