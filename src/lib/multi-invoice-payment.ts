import { differenceInDays } from 'date-fns';
import type { FinancialSettings, Invoice, Order, Payment } from './definitions';
import { roundCurrency } from './billing';

export interface MultiInvoiceItemInput {
  invoice: Invoice;
  order?: Order | null;
}

export interface MultiInvoiceCalcOptions {
  totalCashInput: number;
  paymentDate: string | Date;
  accountingBase: 'bcv' | 'cash';
  documentType: 'nota' | 'factura';
  earlyPaymentMode: 'auto' | 'none' | '7days' | '15days';
  isDiscountOverridden?: boolean;
  globalSettings?: Partial<FinancialSettings> | null;
  manualCashOverrides?: Record<string, number> | null;
}

export interface MultiInvoiceAllocationRow {
  orderId: string;
  customerId: string;
  customerName: string;
  salespersonId: string;
  salespersonName: string;
  invoiceDateMs: number;
  elapsedDays: number;
  isOverdue: boolean;
  isNetOrPromotional: boolean;
  remainingBalanceBefore: number;
  cashDiscountPct: number;
  earlyDiscountPct: number;
  ivaPct: number;
  netCashToSettle: number;
  appliedCash: number;
  baseAmount: number;
  cashDiscountAmount: number;
  earlyDiscountAmount: number;
  discountAmount: number;
  taxAmount: number;
  discountType: NonNullable<Payment['discountType']>;
  remainingAfterPayment: number;
  willFullySettle: boolean;
}

export interface MultiInvoiceAllocationResult {
  rows: MultiInvoiceAllocationRow[];
  totalPreviousDebt: number;
  totalNetToSettle: number;
  totalCashInput: number;
  totalAppliedCash: number;
  totalBaseSettled: number;
  totalDiscountGranted: number;
  totalTaxCharged: number;
  surplusToCreditBalance: number;
  overAllocatedBy: number;
  isValid: boolean;
}

export function generateBatchPaymentId(): string {
  return `BATCH-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function validateSameCustomer(invoices: Invoice[]): {
  ok: boolean;
  customerId: string;
  customerName: string;
  customerCount: number;
} {
  const uniqueCustomers = new Map<string, string>();
  for (const inv of invoices) {
    const cid = (inv.customerId || '').trim();
    if (!cid) continue;
    if (!uniqueCustomers.has(cid)) {
      uniqueCustomers.set(cid, inv.customerName || 'Cliente');
    }
  }
  const entries = Array.from(uniqueCustomers.entries());
  return {
    ok: entries.length === 1,
    customerId: entries[0]?.[0] || '',
    customerName: entries[0]?.[1] || '',
    customerCount: entries.length,
  };
}

function toTimestampMs(raw: unknown): number {
  if (!raw) return 0;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? 0 : raw.getTime();
  if (typeof (raw as { toDate?: () => Date }).toDate === 'function') {
    const d = (raw as { toDate: () => Date }).toDate();
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }
  if (typeof (raw as { seconds?: number }).seconds === 'number') {
    return (raw as { seconds: number }).seconds * 1000;
  }
  const d = new Date(raw as string | number);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function parsePaymentDate(paymentDate: string | Date): Date {
  if (paymentDate instanceof Date) {
    return isNaN(paymentDate.getTime()) ? new Date() : paymentDate;
  }
  if (typeof paymentDate === 'string' && paymentDate.trim()) {
    const normalized = paymentDate.includes('T') ? paymentDate : `${paymentDate.trim()}T12:00:00`;
    const parsed = new Date(normalized);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

export function sortInvoicesFIFO(items: MultiInvoiceItemInput[]): MultiInvoiceItemInput[] {
  return [...items].sort((a, b) => {
    const msA =
      toTimestampMs(a.invoice.creditStartDate) ||
      toTimestampMs(a.order?.receptionDate) ||
      toTimestampMs(a.order?.approvalDate) ||
      toTimestampMs(a.order?.orderDate) ||
      toTimestampMs(a.invoice.createdAt);
    const msB =
      toTimestampMs(b.invoice.creditStartDate) ||
      toTimestampMs(b.order?.receptionDate) ||
      toTimestampMs(b.order?.approvalDate) ||
      toTimestampMs(b.order?.orderDate) ||
      toTimestampMs(b.invoice.createdAt);

    if (msA !== msB) return msA - msB;
    return (a.invoice.id || '').localeCompare(b.invoice.id || '');
  });
}

export function computeMultiInvoiceAllocation(
  items: MultiInvoiceItemInput[],
  options: MultiInvoiceCalcOptions
): MultiInvoiceAllocationResult {
  const sortedItems = sortInvoicesFIFO(items);
  const effectivePaymentDate = parsePaymentDate(options.paymentDate);
  const totalCashInput = roundCurrency(Math.max(0, Number(options.totalCashInput) || 0));
  const settings = options.globalSettings || {};
  const ivaPctValue = Number(settings.ivaPercent ?? 16);
  const ivaFactor = options.documentType === 'factura' ? ivaPctValue / 100 : 0;

  let remainingCashPool = totalCashInput;

  const rows: MultiInvoiceAllocationRow[] = sortedItems.map(({ invoice, order }) => {
    const orderId = invoice.id || invoice.orderId;
    const remainingBalanceBefore = roundCurrency(Math.max(0, Number(invoice.remainingBalance) || 0));

    const startMs =
      toTimestampMs(invoice.creditStartDate) ||
      toTimestampMs(order?.receptionDate) ||
      toTimestampMs(order?.approvalDate) ||
      toTimestampMs(order?.orderDate) ||
      toTimestampMs(invoice.createdAt);

    const startDate = startMs > 0 ? new Date(startMs) : effectivePaymentDate;
    const elapsedDays = Math.max(0, differenceInDays(effectivePaymentDate, startDate));
    const extensionDays = typeof order?.extensionDays === 'number' && order.extensionDays > 0 ? order.extensionDays : 0;
    const isOverdue = elapsedDays > 30 + extensionDays || invoice.status === 'Vencido';

    const ordAny = order as Record<string, unknown> | null | undefined;
    const invAny = invoice as unknown as Record<string, unknown>;
    const isNetOrPromotional =
      ordAny?.incentivesApplied === true ||
      ordAny?.isNetPrice === true ||
      Boolean(ordAny?.promoName) ||
      invAny?.incentivesApplied === true ||
      invAny?.isNetPrice === true ||
      Boolean(invAny?.promoName);

    const bcvDiscountPctRaw =
      order?.treasurySnapshot?.bcvDiscountPercent ??
      (ordAny?.bcvDiscountSnapshot as number | undefined) ??
      settings.defaultBcvDiscount ??
      25;

    const early7PctRaw =
      order?.treasurySnapshot?.earlyPayment7dPercent ??
      (ordAny?.earlyPayment7dSnapshot as number | undefined) ??
      settings.earlyPayment7Days ??
      10;

    const early15PctRaw =
      order?.treasurySnapshot?.earlyPayment15dPercent ??
      (ordAny?.earlyPayment15dSnapshot as number | undefined) ??
      settings.earlyPayment15Days ??
      5;

    const cashDiscountFrac =
      options.accountingBase === 'cash' && !isNetOrPromotional && !isOverdue
        ? Number(bcvDiscountPctRaw) / 100
        : 0;

    let earlyDiscountFrac = 0;
    let appliedEarlyTier: 'none' | '7days' | '15days' = 'none';

    if (!isNetOrPromotional && (!isOverdue || options.isDiscountOverridden)) {
      if (options.earlyPaymentMode === 'auto') {
        if (elapsedDays <= 7) {
          earlyDiscountFrac = Number(early7PctRaw) / 100;
          appliedEarlyTier = '7days';
        } else if (elapsedDays <= 15) {
          earlyDiscountFrac = Number(early15PctRaw) / 100;
          appliedEarlyTier = '15days';
        }
      } else if (options.earlyPaymentMode === '7days' && (elapsedDays <= 7 || options.isDiscountOverridden)) {
        earlyDiscountFrac = Number(early7PctRaw) / 100;
        appliedEarlyTier = '7days';
      } else if (options.earlyPaymentMode === '15days' && (elapsedDays <= 15 || options.isDiscountOverridden)) {
        earlyDiscountFrac = Number(early15PctRaw) / 100;
        appliedEarlyTier = '15days';
      }
    }

    const cascadingMultiplier = (1 - cashDiscountFrac) * (1 - earlyDiscountFrac);
    const netCashToSettle = roundCurrency(remainingBalanceBefore * cascadingMultiplier * (1 + ivaFactor));

    let appliedCash = 0;
    if (options.manualCashOverrides) {
      const rawManual = Number(options.manualCashOverrides[orderId] ?? 0);
      appliedCash = roundCurrency(Math.min(Math.max(0, rawManual), netCashToSettle));
    } else {
      appliedCash = roundCurrency(Math.min(remainingCashPool, netCashToSettle));
      remainingCashPool = roundCurrency(Math.max(0, remainingCashPool - appliedCash));
    }

    let baseAmount = 0;
    let cashDiscountAmount = 0;
    let earlyDiscountAmount = 0;
    let discountAmount = 0;
    let taxAmount = 0;
    let remainingAfterPayment = remainingBalanceBefore;
    let willFullySettle = false;

    if (appliedCash > 0.005 && remainingBalanceBefore > 0) {
      if (appliedCash >= netCashToSettle - 0.01) {
        baseAmount = remainingBalanceBefore;
        willFullySettle = true;
        remainingAfterPayment = 0;
        cashDiscountAmount = roundCurrency(baseAmount * cashDiscountFrac);
        const afterCash = Math.max(0, baseAmount - cashDiscountAmount);
        earlyDiscountAmount = roundCurrency(afterCash * earlyDiscountFrac);
        discountAmount = roundCurrency(cashDiscountAmount + earlyDiscountAmount);
        const subtotal = Math.max(0, baseAmount - discountAmount);
        taxAmount = options.documentType === 'factura' ? roundCurrency(subtotal * ivaFactor) : 0;
      } else {
        const subtotalAfterIncentives = appliedCash / (1 + ivaFactor);
        const rawBase = cascadingMultiplier > 0 ? subtotalAfterIncentives / cascadingMultiplier : subtotalAfterIncentives;
        baseAmount = Math.min(remainingBalanceBefore, roundCurrency(rawBase));
        cashDiscountAmount = roundCurrency(baseAmount * cashDiscountFrac);
        const afterCash = Math.max(0, baseAmount - cashDiscountAmount);
        earlyDiscountAmount = roundCurrency(afterCash * earlyDiscountFrac);
        discountAmount = roundCurrency(cashDiscountAmount + earlyDiscountAmount);
        const subtotal = Math.max(0, baseAmount - discountAmount);
        taxAmount = options.documentType === 'factura' ? roundCurrency(subtotal * ivaFactor) : 0;
        willFullySettle = baseAmount >= remainingBalanceBefore - 0.50;
        remainingAfterPayment = willFullySettle ? 0 : roundCurrency(Math.max(0, remainingBalanceBefore - baseAmount));
      }
    }

    const discountType: NonNullable<Payment['discountType']> =
      appliedEarlyTier !== 'none'
        ? appliedEarlyTier
        : cashDiscountFrac > 0
          ? 'cash'
          : 'none';

    return {
      orderId,
      customerId: invoice.customerId || order?.customerId || '',
      customerName: invoice.customerName || order?.customerName || 'Cliente',
      salespersonId: invoice.salespersonId || order?.salespersonId || '',
      salespersonName: invoice.salespersonName || order?.salespersonName || 'Venta Directa / Oficina Central',
      invoiceDateMs: startMs,
      elapsedDays,
      isOverdue,
      isNetOrPromotional,
      remainingBalanceBefore,
      cashDiscountPct: roundCurrency(cashDiscountFrac * 100),
      earlyDiscountPct: roundCurrency(earlyDiscountFrac * 100),
      ivaPct: options.documentType === 'factura' ? ivaPctValue : 0,
      netCashToSettle,
      appliedCash,
      baseAmount,
      cashDiscountAmount,
      earlyDiscountAmount,
      discountAmount,
      taxAmount,
      discountType,
      remainingAfterPayment,
      willFullySettle,
    };
  });

  const totalPreviousDebt = roundCurrency(rows.reduce((s, r) => s + r.remainingBalanceBefore, 0));
  const totalNetToSettle = roundCurrency(rows.reduce((s, r) => s + r.netCashToSettle, 0));
  const totalAppliedCash = roundCurrency(rows.reduce((s, r) => s + r.appliedCash, 0));
  const totalBaseSettled = roundCurrency(rows.reduce((s, r) => s + r.baseAmount, 0));
  const totalDiscountGranted = roundCurrency(rows.reduce((s, r) => s + r.discountAmount, 0));
  const totalTaxCharged = roundCurrency(rows.reduce((s, r) => s + r.taxAmount, 0));

  const overAllocatedBy = roundCurrency(Math.max(0, totalAppliedCash - totalCashInput));
  const surplusToCreditBalance = roundCurrency(Math.max(0, totalCashInput - totalAppliedCash));
  const isValid = totalCashInput > 0 && rows.some((r) => r.appliedCash > 0) && overAllocatedBy <= 0.01;

  return {
    rows,
    totalPreviousDebt,
    totalNetToSettle,
    totalCashInput,
    totalAppliedCash,
    totalBaseSettled,
    totalDiscountGranted,
    totalTaxCharged,
    surplusToCreditBalance,
    overAllocatedBy,
    isValid,
  };
}
