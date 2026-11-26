import assert from 'node:assert/strict';
import type { Invoice, Order } from '../definitions';
import {
  computeMultiInvoiceAllocation,
  validateSameCustomer,
  type MultiInvoiceItemInput,
} from '../multi-invoice-payment';
import { multiInvoicePaymentReceiptMessage } from '../whatsapp-templates';

function makeInvoice(
  id: string,
  customerId: string,
  remainingBalance: number,
  daysAgo: number,
  extra: Partial<Invoice> & Record<string, any> = {}
): MultiInvoiceItemInput {
  const createdDate = new Date('2026-11-26T12:00:00');
  createdDate.setDate(createdDate.getDate() - daysAgo);

  const invoice: Invoice = {
    id,
    orderId: id,
    customerId,
    customerName: extra.customerName || 'Deportes El Golazo C.A.',
    salespersonId: 'sp-1',
    salespersonName: 'Carlos Vendedor',
    amountTotal: remainingBalance,
    amountPaid: 0,
    currency: 'USD',
    dueDate: new Date(createdDate.getTime() + 30 * 86400000),
    status: daysAgo > 30 ? 'Vencido' : 'Por Vencer',
    remainingBalance,
    remainingCreditDays: Math.max(0, 30 - daysAgo),
    discountPercentage: 10,
    statusText: 'Por Vencer',
    creditStartDate: createdDate,
    createdAt: createdDate as any,
    updatedAt: createdDate as any,
    createdBy: 'system',
    ...extra,
  };

  const order: Partial<Order> = {
    id,
    customerId,
    customerName: invoice.customerName,
    totalAmount: remainingBalance,
    amountPaid: 0,
    status: 'Entregado',
    salespersonId: 'sp-1',
    salespersonName: 'Carlos Vendedor',
    orderDate: createdDate as any,
    ...(extra.isNetPrice ? { isNetPrice: true } : {}),
  };

  return { invoice, order: order as Order };
}

const paymentDate = '2026-11-26';
const defaultSettings = {
  bcvRate: 65.5,
  ivaPercent: 16,
  defaultBcvDiscount: 25,
  earlyPayment7Days: 10,
  earlyPayment15Days: 5,
};

// 1. FIFO exacto sobre 2 facturas con Divisas (25%) + Pronto Pago 7D (10%) -> multiplicador 0.75 * 0.9 = 0.675
{
  const items = [
    makeInvoice('ORD-NEW', 'cust-1', 200, 3), // 200 * 0.675 = 135.00
    makeInvoice('ORD-OLD', 'cust-1', 100, 5), // 100 * 0.675 = 67.50 (más antigua -> va 1ro)
  ];

  const res = computeMultiInvoiceAllocation(items, {
    totalCashInput: 202.5,
    paymentDate,
    accountingBase: 'cash',
    documentType: 'nota',
    earlyPaymentMode: 'auto',
    globalSettings: defaultSettings,
  });

  assert.equal(res.isValid, true);
  assert.equal(res.rows[0].orderId, 'ORD-OLD', 'Debe ordenar FIFO (más antigua primero)');
  assert.equal(res.rows[1].orderId, 'ORD-NEW');
  assert.equal(res.rows[0].appliedCash, 67.5);
  assert.equal(res.rows[0].willFullySettle, true);
  assert.equal(res.rows[1].appliedCash, 135);
  assert.equal(res.rows[1].willFullySettle, true);
  assert.equal(res.surplusToCreditBalance, 0);
}

// 2. Pago parcial: liquida la factura #1 completa y hace abono parcial a la factura #2
{
  const items = [
    makeInvoice('ORD-1', 'cust-1', 100, 6), // neto = 67.50
    makeInvoice('ORD-2', 'cust-1', 200, 2), // neto = 135.00
  ];

  const res = computeMultiInvoiceAllocation(items, {
    totalCashInput: 100, // 67.50 para ORD-1, quedan 32.50 para ORD-2
    paymentDate,
    accountingBase: 'cash',
    documentType: 'nota',
    earlyPaymentMode: 'auto',
    globalSettings: defaultSettings,
  });

  assert.equal(res.isValid, true);
  assert.equal(res.rows[0].appliedCash, 67.5);
  assert.equal(res.rows[0].willFullySettle, true);
  assert.equal(res.rows[1].appliedCash, 32.5);
  assert.equal(res.rows[1].willFullySettle, false);
  // Base descontada de ORD-2 = 32.50 / 0.675 = 48.15 -> saldo restante 151.85
  assert.equal(res.rows[1].baseAmount, 48.15);
  assert.equal(res.rows[1].remainingAfterPayment, 151.85);
  assert.equal(res.surplusToCreditBalance, 0);
}

// 3. Pago con excedente: liquida ambas y envía el sobrante exacto a saldo a favor (creditBalance)
{
  const items = [
    makeInvoice('ORD-1', 'cust-1', 100, 5), // neto 67.50
    makeInvoice('ORD-2', 'cust-1', 100, 4), // neto 67.50
  ];

  const res = computeMultiInvoiceAllocation(items, {
    totalCashInput: 150, // neto total 135.00 -> excedente 15.00
    paymentDate,
    accountingBase: 'cash',
    documentType: 'nota',
    earlyPaymentMode: 'auto',
    globalSettings: defaultSettings,
  });

  assert.equal(res.isValid, true);
  assert.equal(res.totalAppliedCash, 135);
  assert.equal(res.surplusToCreditBalance, 15);
  assert.equal(res.rows[0].willFullySettle, true);
  assert.equal(res.rows[1].willFullySettle, true);
}

// 4. Modo manual con sobre-asignación -> detecta error (isValid === false)
{
  const items = [
    makeInvoice('ORD-1', 'cust-1', 100, 5),
    makeInvoice('ORD-2', 'cust-1', 100, 4),
  ];

  const badRes = computeMultiInvoiceAllocation(items, {
    totalCashInput: 80,
    paymentDate,
    accountingBase: 'cash',
    documentType: 'nota',
    earlyPaymentMode: 'auto',
    globalSettings: defaultSettings,
    manualCashOverrides: { 'ORD-1': 50, 'ORD-2': 50 },
  });

  assert.equal(badRes.isValid, false);
  assert.equal(badRes.overAllocatedBy, 20);
}

// 5. Factura promocional neta mezclada con factura estándar
{
  const items = [
    makeInvoice('ORD-PROMO', 'cust-1', 100, 2, { isNetPrice: true }), // 0% desc -> 100.00
    makeInvoice('ORD-STD', 'cust-1', 100, 2), // 25% + 10% -> 67.50
  ];

  const res = computeMultiInvoiceAllocation(items, {
    totalCashInput: 167.5,
    paymentDate,
    accountingBase: 'cash',
    documentType: 'nota',
    earlyPaymentMode: 'auto',
    globalSettings: defaultSettings,
  });

  assert.equal(res.isValid, true);
  assert.equal(res.rows.find((r) => r.orderId === 'ORD-PROMO')?.netCashToSettle, 100);
  assert.equal(res.rows.find((r) => r.orderId === 'ORD-STD')?.netCashToSettle, 67.5);
  assert.equal(res.surplusToCreditBalance, 0);
}

// 6. Pago BCV con Factura Fiscal (+16% IVA) y sin pronto pago
{
  const items = [
    makeInvoice('ORD-BCV-1', 'cust-1', 100, 20), // >15d, sin pronto pago, BCV + 16% = 116
    makeInvoice('ORD-BCV-2', 'cust-1', 50, 18),  // BCV + 16% = 58
  ];

  const res = computeMultiInvoiceAllocation(items, {
    totalCashInput: 174,
    paymentDate,
    accountingBase: 'bcv',
    documentType: 'factura',
    earlyPaymentMode: 'auto',
    globalSettings: defaultSettings,
  });

  assert.equal(res.isValid, true);
  assert.equal(res.totalNetToSettle, 174);
  assert.equal(res.totalTaxCharged, 24);
  assert.equal(res.rows[0].willFullySettle, true);
  assert.equal(res.rows[1].willFullySettle, true);
}

// 7. validateSameCustomer acepta 1 cliente y rechaza clientes mixtos
{
  const sameCheck = validateSameCustomer([
    makeInvoice('A', 'cust-1', 50, 1).invoice,
    makeInvoice('B', 'cust-1', 50, 2).invoice,
  ]);
  assert.equal(sameCheck.ok, true);
  assert.equal(sameCheck.customerId, 'cust-1');

  const mixedCheck = validateSameCustomer([
    makeInvoice('A', 'cust-1', 50, 1).invoice,
    makeInvoice('B', 'cust-2', 50, 2).invoice,
  ]);
  assert.equal(mixedCheck.ok, false);
  assert.equal(mixedCheck.customerCount, 2);
}

// 8. Plantilla WhatsApp consolidada con y sin saldo a favor
{
  const msgNoSurplus = multiInvoicePaymentReceiptMessage({
    customerName: 'Deportes El Golazo',
    batchPaymentId: 'BATCH-1234',
    totalAmountReceived: 202.5,
    method: 'Zelle',
    referenceNumber: 'WFCT9988',
    items: [
      { orderId: 'ORD-OLD-001', appliedCash: 67.5, isFullyPaid: true, remainingListUSD: 0 },
      { orderId: 'ORD-NEW-002', appliedCash: 135, isFullyPaid: true, remainingListUSD: 0 },
    ],
    hasPdfAttachment: true,
  });
  assert.ok(msgNoSurplus.includes('BATCH-1234'));
  assert.ok(msgNoSurplus.includes('ORD-OLD-'));
  assert.ok(!msgNoSurplus.includes('Saldo a favor acreditado'));

  const msgWithSurplus = multiInvoicePaymentReceiptMessage({
    customerName: 'Deportes El Golazo',
    batchPaymentId: 'BATCH-5678',
    totalAmountReceived: 150,
    method: 'Efectivo',
    items: [
      { orderId: 'ORD-1', appliedCash: 67.5, isFullyPaid: true, remainingListUSD: 0 },
      { orderId: 'ORD-2', appliedCash: 67.5, isFullyPaid: false, remainingListUSD: 40 },
    ],
    surplusToCreditBalance: 15,
    hasPdfAttachment: true,
  });
  assert.ok(msgWithSurplus.includes('Saldo a favor acreditado'));
  assert.ok(msgWithSurplus.includes('15.00'));
}

console.log('✅ OK: Motor multi-factura, validaciones, excedente a saldo a favor y plantilla WhatsApp verificados.');
