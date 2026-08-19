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

/**
 * UTILIDAD UNIVERSAL DE FACTURACIÓN v183.0.0
 * Centraliza el cálculo de vencimientos, descuentos y saldos para UI y Agentes IA.
 */
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
        currency: 'USD',
        createdAt: (order.createdAt || rawDate) as Timestamp,
        creditStartDate: creditStartDate,
    }
}
