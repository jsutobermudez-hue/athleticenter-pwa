import {
  collection,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { CompanyProfile, FinancialSettings, Order, Payment } from './definitions';
import {
  generateBatchPaymentId,
  type MultiInvoiceAllocationResult,
} from './multi-invoice-payment';
import { roundCurrency } from './billing';
import { createAppNotifications } from './notifications';
import { logActivity } from './audit';
import { generateConsolidatedPaymentReceiptPDF } from './pdf-generator';
import { dispatchUniversalWhatsApp } from './whatsapp-universal';
import { multiInvoicePaymentReceiptMessage } from './whatsapp-templates';

export interface MultiInvoicePaymentMeta {
  paymentDate: string;
  method: string;
  referenceNumber: string;
  notes?: string;
  imageUrl?: string | null;
  documentType: 'nota' | 'factura';
  accountingBase: 'bcv' | 'cash';
}

export interface MultiInvoiceItemSummary {
  orderId: string;
  previousBalance: number;
  discountAmount: number;
  taxAmount: number;
  baseAmount: number;
  appliedCash: number;
  remainingAfter: number;
  isFullyPaid: boolean;
}

function toSafePaymentDate(dateStr?: string): Date {
  if (dateStr) {
    const normalized = dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`;
    const parsed = new Date(normalized);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/**
 * Envía un reporte de pago consolidado (multi-factura) en estado 'pending_verification'.
 * Apto para todos los roles (incluyendo clientes y vendedores), respetando estrictamente
 * las reglas de seguridad de Firestore (en orders/{id} solo cambia status y updatedAt).
 */
export async function submitMultiInvoiceReport(
  firestore: Firestore,
  params: {
    authUser: { uid: string; displayName?: string | null; email?: string | null };
    currentUser: { id: string; name?: string | null; role?: string } | null;
    customerId: string;
    customerName: string;
    allocation: MultiInvoiceAllocationResult;
    paymentMeta: MultiInvoicePaymentMeta;
  }
): Promise<{ batchPaymentId: string; orderIds: string[] }> {
  const { authUser, currentUser, customerId, customerName, allocation, paymentMeta } = params;
  const activeRows = allocation.rows.filter((r) => r.appliedCash > 0.005);
  if (activeRows.length === 0) {
    throw new Error('Debe asignar monto positivo al menos a una factura.');
  }

  const batchPaymentId = generateBatchPaymentId();
  const batchOrderIds = activeRows.map((r) => r.orderId);
  const safePaymentDate = toSafePaymentDate(paymentMeta.paymentDate);
  const registeredByName =
    currentUser?.name || authUser.displayName || authUser.email || 'Cliente';

  const batch = writeBatch(firestore);

  activeRows.forEach((row, idx) => {
    const isLast = idx === activeRows.length - 1;
    const paymentRef = doc(collection(firestore, 'orders', row.orderId, 'payments'));

    batch.set(paymentRef, {
      orderId: row.orderId,
      method: paymentMeta.method || 'Transferencia Bancaria',
      amount: roundCurrency(row.appliedCash),
      baseAmount: roundCurrency(row.baseAmount),
      discountAmount: roundCurrency(row.discountAmount),
      taxAmount: roundCurrency(row.taxAmount),
      discountType: row.discountType || 'none',
      incentivesApplied: row.discountAmount > 0,
      documentType: paymentMeta.documentType || 'nota',
      accountingBase: paymentMeta.accountingBase || 'bcv',
      referenceNumber: paymentMeta.referenceNumber || '',
      notes: paymentMeta.notes || '',
      imageUrl: paymentMeta.imageUrl || '',
      paymentDate: safePaymentDate,
      status: 'pending_verification',
      registeredBy: authUser.uid,
      registeredByName,
      batchPaymentId,
      batchTotalAmount: roundCurrency(allocation.totalCashInput),
      batchOrderIds,
      batchSurplusAmount: roundCurrency(allocation.surplusToCreditBalance),
      surplusAmount: isLast ? roundCurrency(allocation.surplusToCreditBalance) : 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Regla crítica para rol 'cliente': solo tocar status y updatedAt
    batch.update(doc(firestore, 'orders', row.orderId), {
      status: 'En Verificación',
      updatedAt: serverTimestamp(),
    });
  });

  await batch.commit();

  const shortIds = batchOrderIds.map((id) => `#${id.substring(0, 7)}`).join(', ');
  const surplusNote =
    allocation.surplusToCreditBalance > 0.01
      ? ` (incluye $${allocation.surplusToCreditBalance.toFixed(2)} USD a saldo a favor)`
      : '';

  try {
    await createAppNotifications(firestore, {
      category: 'Facturación',
      title: `📥 Pago Multi-Factura Reportado (${batchOrderIds.length} facturas)`,
      message: `${customerName} reportó un pago único de $${allocation.totalCashInput.toFixed(2)} (${paymentMeta.method}) para ${shortIds}${surplusNote}. Ref: ${paymentMeta.referenceNumber}.`,
      link: `/dashboard/billing?orderId=${batchOrderIds[0]}`,
      initiatorId: currentUser?.id || authUser.uid,
      salespersonId: activeRows[0]?.salespersonId || '',
      customerId,
      roles: ['admin', 'gerencia', 'deposito'],
    });
  } catch (err) {
    console.warn('[MultiInvoiceReport] Notification error:', err);
  }

  try {
    await logActivity(firestore, {
      userId: currentUser?.id || authUser.uid || 'system',
      userName: registeredByName,
      userRole: currentUser?.role,
      action: 'REGISTER_MULTI_INVOICE_PAYMENT',
      resource: 'invoices',
      module: 'billing',
      resourceId: batchPaymentId,
      severity: 'info',
      details: `Reporte consolidado ${batchPaymentId} por $${allocation.totalCashInput.toFixed(2)} USD (${paymentMeta.method}, Ref #${paymentMeta.referenceNumber}) aplicado a ${batchOrderIds.length} facturas: ${shortIds}${surplusNote}.`,
    });
  } catch (err) {
    console.warn('[MultiInvoiceReport] Audit log error:', err);
  }

  return { batchPaymentId, orderIds: batchOrderIds };
}

/**
 * Ejecuta la conciliación bancaria atómica de un pago único distribuido en N facturas.
 * Soporta tanto conciliación directa (sin reporte previo) como verificación 1-clic de un lote reportado.
 * Acredita automáticamente cualquier excedente a customers/{customerId}.creditBalance.
 */
export async function executeMultiInvoiceReconciliation(
  firestore: Firestore,
  params: {
    authUser: { uid: string; displayName?: string | null; email?: string | null };
    currentUser: { id: string; name?: string | null; role?: string };
    customerId: string;
    customerName: string;
    customerRif?: string;
    customerPhone?: string;
    customerEmail?: string;
    allocation: MultiInvoiceAllocationResult;
    paymentMeta: MultiInvoicePaymentMeta;
    globalSettings?: Partial<FinancialSettings> | null;
    companyProfile?: Partial<CompanyProfile> | null;
    existingBatchPaymentId?: string;
    existingPaymentsByOrderId?: Record<string, Payment>;
    downloadPdf?: boolean;
  }
): Promise<{
  batchPaymentId: string;
  pdfBase64: string;
  itemsSummary: MultiInvoiceItemSummary[];
  surplusCredited: number;
}> {
  const {
    authUser,
    currentUser,
    customerId,
    customerName,
    customerRif,
    customerPhone,
    allocation,
    paymentMeta,
    globalSettings,
    companyProfile,
    existingBatchPaymentId,
    existingPaymentsByOrderId,
    downloadPdf = true,
  } = params;

  const activeRows = allocation.rows.filter((r) => r.appliedCash > 0.005);
  if (activeRows.length === 0) {
    throw new Error('No hay facturas con monto asignado para conciliar.');
  }

  const batchPaymentId = existingBatchPaymentId || generateBatchPaymentId();
  const batchOrderIds = activeRows.map((r) => r.orderId);
  const safePaymentDate = toSafePaymentDate(paymentMeta.paymentDate);
  const verifierName =
    currentUser.name || authUser.displayName || authUser.email || 'Administración Central';
  const bcvRate = Number(globalSettings?.bcvRate || 65.5);

  const txResult = await runTransaction(firestore, async (transaction) => {
    const orderRefs = activeRows.map((r) => doc(firestore, 'orders', r.orderId));
    const paymentRefs = activeRows.map((r) => {
      const existing = existingPaymentsByOrderId?.[r.orderId];
      return existing?.id
        ? doc(firestore, 'orders', r.orderId, 'payments', existing.id)
        : doc(collection(firestore, 'orders', r.orderId, 'payments'));
    });
    const customerRef = customerId ? doc(firestore, 'customers', customerId) : null;

    // 1. Lecturas previas obligatorias en Firestore Transaction
    const [orderSnaps, paymentSnaps, customerSnap] = await Promise.all([
      Promise.all(orderRefs.map((ref) => transaction.get(ref))),
      Promise.all(paymentRefs.map((ref) => transaction.get(ref))),
      customerRef ? transaction.get(customerRef) : Promise.resolve(null),
    ]);

    const itemsSummary: MultiInvoiceItemSummary[] = [];
    let totalBaseSettledTx = 0;

    for (let idx = 0; idx < activeRows.length; idx++) {
      const row = activeRows[idx];
      const orderSnap = orderSnaps[idx];
      const paymentSnap = paymentSnaps[idx];
      const existingPay = existingPaymentsByOrderId?.[row.orderId];

      if (!orderSnap.exists()) {
        throw new Error(`El pedido #${row.orderId.substring(0, 8)} no fue encontrado.`);
      }

      const currentOrder = orderSnap.data() as Order;
      if (currentOrder.status === 'Pagado') {
        throw new Error(`La factura #${row.orderId.substring(0, 8)} ya figura como Pagada.`);
      }

      if (paymentSnap.exists() && paymentSnap.data()?.status === 'verified') {
        throw new Error(`El abono de #${row.orderId.substring(0, 8)} ya fue verificado previamente.`);
      }

      const currentPaid = Number(currentOrder.totalCashReceived ?? currentOrder.amountPaid ?? 0);
      const commissionFee = Number((existingPay as any)?.bankCommission || 0);
      const effectiveAbono = roundCurrency(row.baseAmount + commissionFee);
      const actualCash = roundCurrency(row.appliedCash);
      const orderTotal = Number(currentOrder.totalAmount || 0);
      const previousBalance = roundCurrency(Math.max(0, orderTotal - currentPaid));
      const newTotalPaid = roundCurrency(currentPaid + effectiveAbono);
      const isFullyPaid = newTotalPaid >= orderTotal - 0.5;
      const remainingAfter = isFullyPaid ? 0 : roundCurrency(Math.max(0, orderTotal - newTotalPaid));
      const isLast = idx === activeRows.length - 1;

      totalBaseSettledTx = roundCurrency(totalBaseSettledTx + row.baseAmount);

      const paymentPayload: Record<string, unknown> = {
        orderId: row.orderId,
        amount: actualCash,
        baseAmount: roundCurrency(row.baseAmount),
        discountAmount: roundCurrency(row.discountAmount),
        taxAmount: roundCurrency(row.taxAmount),
        discountType: row.discountType || 'none',
        incentivesApplied: row.discountAmount > 0,
        documentType: paymentMeta.documentType || 'nota',
        accountingBase: paymentMeta.accountingBase || 'bcv',
        paymentDate: safePaymentDate,
        method: paymentMeta.method || 'Transferencia Bancaria',
        referenceNumber: paymentMeta.referenceNumber || '',
        notes: paymentMeta.notes || '',
        imageUrl: paymentMeta.imageUrl || (existingPay as any)?.imageUrl || '',
        bankStatementUrl:
          (existingPay as any)?.bankStatementUrl ||
          paymentMeta.imageUrl ||
          (existingPay as any)?.imageUrl ||
          '',
        status: 'verified',
        verifiedByUserId: currentUser.id,
        verifiedByName: verifierName,
        batchPaymentId,
        batchTotalAmount: roundCurrency(allocation.totalCashInput),
        batchOrderIds,
        batchSurplusAmount: roundCurrency(allocation.surplusToCreditBalance),
        surplusAmount: isLast ? roundCurrency(allocation.surplusToCreditBalance) : 0,
        updatedAt: serverTimestamp(),
      };

      if (!paymentSnap.exists()) {
        paymentPayload.registeredBy = existingPay?.registeredBy || authUser.uid;
        paymentPayload.registeredByName = existingPay?.registeredByName || verifierName;
        paymentPayload.createdAt = serverTimestamp();
      }

      transaction.set(paymentRefs[idx], paymentPayload, { merge: true });

      const nextStatus = isFullyPaid
        ? 'Pagado'
        : currentOrder.status === 'En Verificación'
          ? 'Entregado'
          : currentOrder.status;

      const orderUpdate: Record<string, any> = {
        amountPaid: newTotalPaid,
        totalCashReceived: newTotalPaid,
        paidAmount: newTotalPaid,
        status: nextStatus,
        paymentStatus: isFullyPaid ? 'Pagado' : 'Abono Parcial',
        isPaid: isFullyPaid,
        lastPaymentDate: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (isFullyPaid) {
        orderUpdate.paidAt = serverTimestamp();
      }

      transaction.update(orderRefs[idx], orderUpdate);

      // Comisiones proporcionales al cash efectivo ingresado en ESTA factura (nunca sobre el excedente)
      const invoiceNum =
        currentOrder.historicalInvoiceNumber ||
        `#FACT-${(row.orderId || '').substring(0, 8).toUpperCase()}`;

      const rawSpRate =
        typeof currentOrder.salespersonCommissionRate === 'number'
          ? currentOrder.salespersonCommissionRate
          : globalSettings?.defaultCommission ?? 5;
      const spRatePct = rawSpRate <= 1 && rawSpRate > 0 ? rawSpRate * 100 : rawSpRate;
      const spCommAmount = roundCurrency(actualCash * (spRatePct / 100));
      const salespersonId = currentOrder.salespersonId || row.salespersonId || '';
      const salespersonName =
        currentOrder.salespersonName || row.salespersonName || 'Venta Directa / Oficina Central';

      if (spCommAmount > 0) {
        const commRef = doc(collection(firestore, 'commissions'));
        transaction.set(commRef, {
          orderId: row.orderId,
          paymentId: paymentRefs[idx].id,
          batchPaymentId,
          invoiceNumber: invoiceNum,
          commissionDate: serverTimestamp(),
          collectionDate: serverTimestamp(),
          invoiceAmount: actualCash,
          paymentAmountUSD: actualCash,
          paymentAmountBS: roundCurrency(actualCash * bcvRate),
          bcvRate,
          salespersonId,
          salespersonName,
          recipientUserId: salespersonId,
          recipientName: salespersonName,
          recipientRole: 'SALESPERSON',
          salespersonCommissionAmount: spCommAmount,
          commissionAmountUSD: spCommAmount,
          commissionAmountBS: roundCurrency(spCommAmount * bcvRate),
          commissionPercent: spRatePct,
          status: 'pendiente',
          currency: 'USD',
          commissionType: 'vendedor',
          orderNumber: invoiceNum,
          customerName: currentOrder.customerName || customerName,
          paymentMethod: paymentMeta.method || 'CASH',
          rateApplied: spRatePct,
          createdAt: serverTimestamp(),
        });
      }

      const managerRatePct = globalSettings?.salesManagerCommission ?? 5;
      const managerCommAmount = roundCurrency(actualCash * (managerRatePct / 100));
      if (managerCommAmount > 0) {
        const managerCommRef = doc(collection(firestore, 'commissions'));
        transaction.set(managerCommRef, {
          orderId: row.orderId,
          paymentId: paymentRefs[idx].id,
          batchPaymentId,
          invoiceNumber: invoiceNum,
          commissionDate: serverTimestamp(),
          collectionDate: serverTimestamp(),
          invoiceAmount: actualCash,
          paymentAmountUSD: actualCash,
          paymentAmountBS: roundCurrency(actualCash * bcvRate),
          bcvRate,
          salespersonId: 'GERENCIA_SALES_MANAGER',
          salespersonName: '👔 Jsutobermudez (Gerencia de Ventas - Override)',
          recipientUserId: 'gerencia_ventas_override',
          recipientName: '👔 Jsutobermudez (Gerencia de Ventas - Override)',
          recipientRole: 'SALES_MANAGER',
          salespersonCommissionAmount: managerCommAmount,
          commissionAmountUSD: managerCommAmount,
          commissionAmountBS: roundCurrency(managerCommAmount * bcvRate),
          commissionPercent: managerRatePct,
          status: 'pendiente',
          currency: 'USD',
          commissionType: 'gerencia',
          orderNumber: invoiceNum,
          customerName: currentOrder.customerName || customerName,
          paymentMethod: paymentMeta.method || 'CASH',
          rateApplied: managerRatePct,
          createdAt: serverTimestamp(),
        });
      }

      const adminRatePct = globalSettings?.adminCommission ?? 0;
      const adminCommAmount = roundCurrency(actualCash * (adminRatePct / 100));
      if (adminCommAmount > 0) {
        const adminCommRef = doc(collection(firestore, 'commissions'));
        transaction.set(adminCommRef, {
          orderId: row.orderId,
          paymentId: paymentRefs[idx].id,
          batchPaymentId,
          invoiceNumber: invoiceNum,
          commissionDate: serverTimestamp(),
          collectionDate: serverTimestamp(),
          invoiceAmount: actualCash,
          paymentAmountUSD: actualCash,
          paymentAmountBS: roundCurrency(actualCash * bcvRate),
          bcvRate,
          salespersonId: 'ADMINISTRACION',
          salespersonName: '🏢 Administración / Gestión de Cobranza',
          recipientUserId: 'admin_override',
          recipientName: '🏢 Administración / Gestión de Cobranza',
          recipientRole: 'ADMIN',
          salespersonCommissionAmount: adminCommAmount,
          commissionAmountUSD: adminCommAmount,
          commissionAmountBS: roundCurrency(adminCommAmount * bcvRate),
          commissionPercent: adminRatePct,
          status: 'pendiente',
          currency: 'USD',
          commissionType: 'admin',
          orderNumber: invoiceNum,
          customerName: currentOrder.customerName || customerName,
          paymentMethod: paymentMeta.method || 'CASH',
          rateApplied: adminRatePct,
          createdAt: serverTimestamp(),
        });
      }

      itemsSummary.push({
        orderId: row.orderId,
        previousBalance,
        discountAmount: roundCurrency(row.discountAmount),
        taxAmount: roundCurrency(row.taxAmount),
        baseAmount: roundCurrency(row.baseAmount),
        appliedCash: actualCash,
        remainingAfter,
        isFullyPaid,
      });
    }

    const surplusCredited = roundCurrency(allocation.surplusToCreditBalance);
    if (customerRef && customerSnap?.exists()) {
      const customerUpdates: Record<string, any> = {
        creditUsed: increment(-totalBaseSettledTx),
        updatedAt: serverTimestamp(),
      };
      if (surplusCredited > 0.01) {
        customerUpdates.creditBalance = increment(surplusCredited);
      }
      transaction.update(customerRef, customerUpdates);
    }

    return { itemsSummary, surplusCredited };
  });

  let pdfBase64 = '';
  try {
    pdfBase64 = await generateConsolidatedPaymentReceiptPDF({
      batchPaymentId,
      customerName,
      customerRif,
      totalAmountReceived: roundCurrency(allocation.totalCashInput),
      method: paymentMeta.method,
      referenceNumber: paymentMeta.referenceNumber,
      paymentDate: safePaymentDate,
      registeredByName: verifierName,
      items: txResult.itemsSummary.map((item) => ({
        orderId: item.orderId,
        previousBalance: item.previousBalance,
        discountAmount: item.discountAmount,
        appliedCash: item.appliedCash,
        remainingAfter: item.remainingAfter,
        isFullyPaid: item.isFullyPaid,
      })),
      surplusToCreditBalance: txResult.surplusCredited,
      companyProfile: companyProfile || undefined,
      bcvRate,
      download: downloadPdf,
    });
  } catch (pdfErr) {
    console.error('[MultiInvoiceReconcile] Error generating consolidated PDF:', pdfErr);
  }

  if (customerPhone) {
    const waMsg = multiInvoicePaymentReceiptMessage({
      customerName,
      batchPaymentId,
      totalAmountReceived: roundCurrency(allocation.totalCashInput),
      method: paymentMeta.method,
      referenceNumber: paymentMeta.referenceNumber,
      items: txResult.itemsSummary.map((item) => ({
        orderId: item.orderId,
        appliedCash: item.appliedCash,
        isFullyPaid: item.isFullyPaid,
        remainingListUSD: item.remainingAfter,
      })),
      surplusToCreditBalance: txResult.surplusCredited,
      hasPdfAttachment: Boolean(pdfBase64),
    });

    dispatchUniversalWhatsApp({
      phone: customerPhone,
      message: waMsg,
      pdfBase64: pdfBase64 || undefined,
      fileName: `Recibo_Consolidado_${batchPaymentId}.pdf`,
      orderId: batchOrderIds[0],
      module: 'billing',
    }).catch((err) => console.warn('[MultiInvoice WA] Error:', err));
  }

  const shortList = batchOrderIds.map((id) => `#${id.substring(0, 7)}`).join(', ');
  const surplusText =
    txResult.surplusCredited > 0.01
      ? ` Excedente de $${txResult.surplusCredited.toFixed(2)} acreditado a saldo a favor.`
      : '';

  try {
    await createAppNotifications(firestore, {
      category: 'Facturación',
      title: `💳 Conciliación Multi-Factura (${batchOrderIds.length} facturas)`,
      message: `Se conciliaron ${batchOrderIds.length} facturas (${shortList}) de ${customerName} con un pago único de $${allocation.totalCashInput.toFixed(2)} USD.${surplusText}`,
      link: `/dashboard/billing?orderId=${batchOrderIds[0]}`,
      initiatorId: currentUser.id,
      salespersonId: activeRows[0]?.salespersonId || '',
      customerId,
      roles: ['admin', 'gerencia', 'deposito'],
    });
  } catch (err) {
    console.warn('[MultiInvoiceReconcile] Notification error:', err);
  }

  try {
    await logActivity(firestore, {
      userId: currentUser.id,
      userName: verifierName,
      userRole: currentUser.role,
      action: 'RECONCILE_MULTI_INVOICE_PAYMENT',
      resource: 'invoices',
      module: 'billing',
      resourceId: batchPaymentId,
      severity: 'critical',
      details: `Conciliación consolidada ${batchPaymentId} por $${allocation.totalCashInput.toFixed(2)} USD (${paymentMeta.method}, Ref #${paymentMeta.referenceNumber}) aplicada a ${shortList}.${surplusText}`,
    });
  } catch (err) {
    console.warn('[MultiInvoiceReconcile] Audit error:', err);
  }

  return {
    batchPaymentId,
    pdfBase64,
    itemsSummary: txResult.itemsSummary,
    surplusCredited: txResult.surplusCredited,
  };
}

/**
 * Rechaza en 1 clic todas las porciones pendientes de un lote multi-factura.
 */
export async function rejectMultiInvoiceBatch(
  firestore: Firestore,
  params: {
    authUser: { uid: string; displayName?: string | null; email?: string | null };
    currentUser: { id: string; name?: string | null; role?: string };
    batchPaymentId: string;
    payments: Payment[];
  }
): Promise<void> {
  const { authUser, currentUser, batchPaymentId, payments } = params;
  if (!payments || payments.length === 0) return;

  const verifierName =
    currentUser.name || authUser.displayName || authUser.email || 'Administración';
  const batch = writeBatch(firestore);
  const touchedOrderIds: string[] = [];

  for (const p of payments) {
    if (!p.orderId || !p.id) continue;
    touchedOrderIds.push(p.orderId);
    batch.update(doc(firestore, 'orders', p.orderId, 'payments', p.id), {
      status: 'rejected',
      rejectedByUserId: currentUser.id,
      rejectedByName: verifierName,
      rejectedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(firestore, 'orders', p.orderId), {
      status: 'Entregado',
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();

  const registrantId = payments[0]?.registeredBy;
  if (registrantId) {
    try {
      await createAppNotifications(firestore, {
        category: 'Facturación',
        title: `Abono Multi-Factura Rechazado`,
        message: `Tu reporte consolidado (${batchPaymentId}) por $${(payments[0]?.batchTotalAmount || payments[0]?.amount || 0).toFixed(2)} fue rechazado por inconsistencias.`,
        link: `/dashboard/billing?orderId=${touchedOrderIds[0] || ''}`,
        initiatorId: authUser.uid,
        userIds: [registrantId],
      });
    } catch (err) {
      console.warn('[MultiInvoiceReject] Notification error:', err);
    }
  }

  try {
    await logActivity(firestore, {
      userId: currentUser.id,
      userName: verifierName,
      userRole: currentUser.role,
      action: 'REJECT_MULTI_INVOICE_PAYMENT',
      resource: 'invoices',
      module: 'billing',
      resourceId: batchPaymentId,
      severity: 'warning',
      details: `Se rechazó el lote de pago multi-factura ${batchPaymentId} (${touchedOrderIds.map((id) => `#${id.substring(0, 7)}`).join(', ')}).`,
    });
  } catch (err) {
    console.warn('[MultiInvoiceReject] Audit error:', err);
  }
}
