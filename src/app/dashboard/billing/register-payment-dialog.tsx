'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useForm, Controller, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { 
    Card, 
    CardContent, 
    CardHeader, 
    CardTitle, 
    CardFooter 
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
    Loader2, 
    DollarSign, 
    CheckCircle, 
    XCircle, 
    ShieldCheck, 
    ShieldAlert,
    Receipt, 
    Eye, 
    Calculator, 
    TrendingDown, 
    ArrowRight, 
    Lock, 
    Info, 
    Printer,
    Layers,
    Wallet
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc, errorEmitter, FirestorePermissionError } from '@/firebase';
import type { Payment, Order, FinancialSettings, OrderItem, OrderItemClient, CompanyProfile, Product, Customer } from '@/lib/definitions';
import { doc, writeBatch, collection, serverTimestamp, query, where, limit, runTransaction, getDocs, increment, getDoc } from 'firebase/firestore';
import Image from 'next/image';
import { createAppNotifications } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { generateOrderPDF, generatePaymentReceiptPDF } from '@/lib/pdf-generator';
import { dispatchUniversalWhatsApp } from '@/lib/whatsapp-universal';
import { processStockDeductionForOrder } from '@/lib/billing';
import { paymentReceiptMessage, computeOrderBalanceForWhatsApp } from '@/lib/whatsapp-templates';
import { executeMultiInvoiceReconciliation, rejectMultiInvoiceBatch } from '@/lib/multi-invoice-reconcile';
import type { MultiInvoiceAllocationResult, MultiInvoiceAllocationRow } from '@/lib/multi-invoice-payment';

const paymentSchema = z.object({
  amount: z.coerce.number().min(0.01, 'El monto debe ser mayor a cero.'),
  paymentDate: z.string().min(1, 'La fecha de pago es requerida.'),
  method: z.string(),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
  accountingBase: z.enum(['bcv', 'cash']).default('bcv'),
  documentType: z.enum(['nota', 'factura']).default('nota'),
});

type PaymentFormValues = z.infer<typeof paymentSchema>;

export function ConfirmPaymentDialog({ order }: { order: Order }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();
  const { user: authUser, profile: currentUser } = useUser();
  const [showImageFull, setShowImageFull] = useState<'payment' | 'retention' | null>(null);

  const financialRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
  const { data: globalSettings } = useDoc<FinancialSettings>(financialRef);

  const companyProfileRef = useMemoFirebase(() => firestore ? doc(firestore, 'companyProfile', 'main') : null, [firestore]);
  const { data: companyProfile } = useDoc<CompanyProfile>(companyProfileRef);

  const paymentsQuery = useMemoFirebase(() => {
    if (!firestore || !isOpen) return null;
    return query(
        collection(firestore, `orders/${order.id}/payments`),
        where('status', '==', 'pending_verification'),
        limit(1)
    );
  }, [firestore, isOpen, order.id]);

  const { data: pendingPayments, isLoading: isLoadingPayment } = useCollection<Payment>(paymentsQuery);
  const reportedPayment = useMemo(() => pendingPayments?.[0], [pendingPayments]);

  const [batchSiblingOrders, setBatchSiblingOrders] = useState<Record<string, Order>>({});
  const [batchSiblingPayments, setBatchSiblingPayments] = useState<Record<string, Payment>>({});
  const [batchCustomerDoc, setBatchCustomerDoc] = useState<Customer | null>(null);
  const [isLoadingBatch, setIsLoadingBatch] = useState(false);

  const isBatchReport = Boolean(
    reportedPayment?.batchPaymentId &&
      Array.isArray(reportedPayment.batchOrderIds) &&
      reportedPayment.batchOrderIds.length > 1
  );

  useEffect(() => {
    if (!isOpen || !firestore || !reportedPayment?.batchPaymentId || !reportedPayment.batchOrderIds?.length) {
      setBatchSiblingOrders({});
      setBatchSiblingPayments({});
      setBatchCustomerDoc(null);
      return;
    }

    let active = true;
    setIsLoadingBatch(true);

    const loadBatch = async () => {
      try {
        const orderIds = reportedPayment.batchOrderIds || [];
        const batchId = reportedPayment.batchPaymentId as string;

        const [orderSnaps, paySnaps, custSnap] = await Promise.all([
          Promise.all(orderIds.map((oid) => getDoc(doc(firestore, 'orders', oid)))),
          Promise.all(
            orderIds.map((oid) =>
              getDocs(
                query(
                  collection(firestore, 'orders', oid, 'payments'),
                  where('batchPaymentId', '==', batchId),
                  limit(1)
                )
              )
            )
          ),
          order.customerId ? getDoc(doc(firestore, 'customers', order.customerId)) : Promise.resolve(null),
        ]);

        if (!active) return;

        const ordersMap: Record<string, Order> = {};
        orderSnaps.forEach((snap) => {
          if (snap.exists()) {
            ordersMap[snap.id] = { id: snap.id, ...(snap.data() as any) };
          }
        });

        const paymentsMap: Record<string, Payment> = {};
        paySnaps.forEach((qs, idx) => {
          const oid = orderIds[idx];
          if (!qs.empty) {
            const pDoc = qs.docs[0];
            paymentsMap[oid] = { id: pDoc.id, ...(pDoc.data() as any) };
          }
        });

        setBatchSiblingOrders(ordersMap);
        setBatchSiblingPayments(paymentsMap);
        setBatchCustomerDoc(custSnap?.exists() ? ({ id: custSnap.id, ...(custSnap.data() as any) } as Customer) : null);
      } catch (err) {
        console.warn('[ConfirmPaymentDialog] Error loading batch details:', err);
      } finally {
        if (active) setIsLoadingBatch(false);
      }
    };

    loadBatch();
    return () => {
      active = false;
    };
  }, [isOpen, firestore, reportedPayment?.batchPaymentId, reportedPayment?.batchOrderIds, order.customerId]);

  const { control, handleSubmit, formState: { isSubmitting }, reset, setValue } = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      amount: 0,
      paymentDate: new Date().toISOString().split('T')[0],
      method: 'Transferencia Bancaria',
      referenceNumber: '',
      notes: '',
      accountingBase: 'bcv',
      documentType: 'nota'
    },
  });

  const watchedValues = useWatch({ control });

  useEffect(() => {
    const m = (watchedValues?.method || '').toLowerCase();
    if (m.includes('zelle') || m.includes('efectivo') || m.includes('cash')) {
      setValue('accountingBase', 'cash');
    } else if (m.includes('bcv') || m.includes('pago móvil') || m.includes('pago movil') || m.includes('transferencia')) {
      setValue('accountingBase', 'bcv');
    }
  }, [watchedValues?.method, setValue]);

  useEffect(() => {
    if (reportedPayment) {
      reset({
        amount: reportedPayment.amount,
        paymentDate: (reportedPayment.paymentDate as any)?.toDate?.().toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
        method: reportedPayment.method,
        referenceNumber: reportedPayment.referenceNumber || '',
        notes: reportedPayment.notes || '',
        accountingBase: (reportedPayment as any).accountingBase || 'bcv',
        documentType: reportedPayment.documentType || 'nota'
      });
    }
  }, [reportedPayment, reset]);

  const handleRejectPayment = () => {
    if (!firestore || !authUser || !reportedPayment || !currentUser) return;
    setIsRejecting(true);
    
    const batch = writeBatch(firestore);
    batch.update(doc(firestore, `orders/${order.id}/payments`, reportedPayment.id), {
      status: 'rejected',
      rejectedByUserId: currentUser.id,
      rejectedByName: currentUser.name || authUser.displayName || 'Administración',
      rejectedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    batch.update(doc(firestore, 'orders', order.id), { status: 'Entregado', updatedAt: serverTimestamp() });

    const auditRef = doc(collection(firestore, 'auditLogs'));
    batch.set(auditRef, {
      id: auditRef.id,
      timestamp: serverTimestamp(),
      userId: currentUser.id,
      userName: currentUser.name || authUser.displayName || 'Administración',
      action: 'REJECT_PAYMENT',
      details: `Abono de ${reportedPayment.amount} en pedido #${order.id} rechazado. Ref: ${reportedPayment.referenceNumber || 'N/A'}`
    });

    batch.commit()
        .then(() => {
            createAppNotifications(firestore, {
                category: 'Facturación',
                title: 'Abono Rechazado',
                message: `Tu reporte para #${order.id.substring(0, 7)} fue rechazado por inconsistencias.`,
                link: `/dashboard/billing?orderId=${order.id}`,
                initiatorId: authUser.uid,
                userIds: [reportedPayment.registeredBy],
            });
            toast({ title: 'Abono Rechazado' });
            setIsOpen(false);
        })
        .catch(async (serverError) => {
            console.error("Error rejecting payment:", serverError);
            toast({ variant: 'destructive', title: 'Error al Rechazar Pago', description: serverError?.message || 'Error de permisos' });
        })
        .finally(() => {
            setIsRejecting(false);
        });
  };

  const handleRejectBatch = async () => {
    if (!firestore || !authUser || !currentUser || !reportedPayment?.batchPaymentId) return;
    const siblingList = Object.values(batchSiblingPayments);
    if (siblingList.length === 0) {
      handleRejectPayment();
      return;
    }
    setIsRejecting(true);
    try {
      await rejectMultiInvoiceBatch(firestore, {
        authUser,
        currentUser,
        batchPaymentId: reportedPayment.batchPaymentId,
        payments: siblingList,
      });
      toast({
        title: 'Lote Multi-Factura Rechazado',
        description: `Se rechazaron ${siblingList.length} abonos vinculados al comprobante ${reportedPayment.batchPaymentId}.`,
      });
      setIsOpen(false);
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error al Rechazar Lote',
        description: err?.message || 'Error de permisos',
      });
    } finally {
      setIsRejecting(false);
    }
  };

  const handleReconcileBatch = async (data: PaymentFormValues) => {
    if (!firestore || !authUser || !currentUser || !reportedPayment?.batchPaymentId || isProcessing) return;
    const orderIds = reportedPayment.batchOrderIds || [];
    const batchPaymentsList = orderIds.map((oid) => batchSiblingPayments[oid]).filter(Boolean);
    if (batchPaymentsList.length <= 1) {
      await onSubmit(data);
      return;
    }

    setIsProcessing(true);
    try {
      const rows: MultiInvoiceAllocationRow[] = orderIds
        .map((oid) => {
          const sibOrd = batchSiblingOrders[oid];
          const sibPay = batchSiblingPayments[oid];
          if (!sibPay) return null;
          const totalOrd = Number(sibOrd?.totalAmount || 0);
          const alreadyPaid = Number(sibOrd?.totalCashReceived ?? sibOrd?.amountPaid ?? 0);
          const prevBal = Math.max(0, totalOrd - alreadyPaid);
          const baseAmt = Number(sibPay.baseAmount || sibPay.amount || 0);
          const remAfter = Math.max(0, prevBal - baseAmt);
          return {
            orderId: oid,
            customerId: sibOrd?.customerId || order.customerId || '',
            customerName: sibOrd?.customerName || order.customerName || 'Cliente',
            salespersonId: sibOrd?.salespersonId || order.salespersonId || '',
            salespersonName: sibOrd?.salespersonName || order.salespersonName || 'Directo',
            invoiceDateMs: Date.now(),
            elapsedDays: 0,
            isOverdue: false,
            isNetOrPromotional: false,
            remainingBalanceBefore: prevBal,
            cashDiscountPct: 0,
            earlyDiscountPct: 0,
            ivaPct: data.documentType === 'factura' ? (globalSettings?.ivaPercent || 16) : 0,
            netCashToSettle: Number(sibPay.amount || 0),
            appliedCash: Number(sibPay.amount || 0),
            baseAmount: baseAmt,
            cashDiscountAmount: 0,
            earlyDiscountAmount: 0,
            discountAmount: Number(sibPay.discountAmount || 0),
            taxAmount: Number(sibPay.taxAmount || 0),
            discountType: (sibPay.discountType as any) || 'none',
            remainingAfterPayment: remAfter <= 0.5 ? 0 : remAfter,
            willFullySettle: remAfter <= 0.5,
          };
        })
        .filter((r): r is MultiInvoiceAllocationRow => Boolean(r));

      const totalCashInput = Number(reportedPayment.batchTotalAmount || rows.reduce((s, r) => s + r.appliedCash, 0));
      const totalAppliedCash = rows.reduce((s, r) => s + r.appliedCash, 0);
      const surplus = Math.max(0, Number(reportedPayment.batchSurplusAmount ?? (totalCashInput - totalAppliedCash)));

      const allocation: MultiInvoiceAllocationResult = {
        rows,
        totalPreviousDebt: rows.reduce((s, r) => s + r.remainingBalanceBefore, 0),
        totalNetToSettle: totalAppliedCash,
        totalCashInput,
        totalAppliedCash,
        totalBaseSettled: rows.reduce((s, r) => s + r.baseAmount, 0),
        totalDiscountGranted: rows.reduce((s, r) => s + r.discountAmount, 0),
        totalTaxCharged: rows.reduce((s, r) => s + r.taxAmount, 0),
        surplusToCreditBalance: surplus,
        overAllocatedBy: 0,
        isValid: true,
      };

      const res = await executeMultiInvoiceReconciliation(firestore, {
        authUser,
        currentUser,
        customerId: order.customerId,
        customerName: order.customerName,
        customerRif: batchCustomerDoc?.rif || (order as any).customerRif || '',
        customerPhone: batchCustomerDoc?.phone || (order as any).customerPhone || '',
        customerEmail: batchCustomerDoc?.email || (order as any).customerEmail || '',
        allocation,
        paymentMeta: {
          paymentDate: data.paymentDate,
          method: data.method,
          referenceNumber: data.referenceNumber || reportedPayment.referenceNumber || '',
          notes: data.notes || reportedPayment.notes || '',
          imageUrl: reportedPayment.imageUrl || '',
          documentType: data.documentType,
          accountingBase: data.accountingBase,
        },
        globalSettings,
        companyProfile,
        existingBatchPaymentId: reportedPayment.batchPaymentId,
        existingPaymentsByOrderId: batchSiblingPayments,
        downloadPdf: true,
      });

      toast({
        title: `🎉 ¡Lote de ${res.itemsSummary.length} Facturas Conciliado!`,
        description:
          res.surplusCredited > 0.01
            ? `Recibo PDF emitido y $${res.surplusCredited.toFixed(2)} acreditados a saldo a favor.`
            : 'Todas las facturas del lote quedaron actualizadas y el recibo consolidado fue emitido.',
      });
      setIsOpen(false);
    } catch (err: any) {
      console.error('[ConfirmPaymentDialog] Batch reconcile error:', err);
      toast({
        variant: 'destructive',
        title: 'Error al Conciliar Lote',
        description: err?.message || 'No se pudo conciliar el lote multi-factura.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const onSubmit = async (data: PaymentFormValues) => {
    if (!firestore || !authUser || !currentUser || isProcessing) return;
    setIsProcessing(true);
    
    try {
      const result = await runTransaction(firestore, async (transaction) => {
        const orderRef = doc(firestore, 'orders', order.id);
        const customerRef = doc(firestore, 'customers', order.customerId);
        
        const paymentRef = reportedPayment
          ? doc(firestore, `orders/${order.id}/payments`, reportedPayment.id)
          : doc(collection(firestore, `orders/${order.id}/payments`));

        const [orderSnap, paymentSnap] = await Promise.all([
          transaction.get(orderRef),
          reportedPayment ? transaction.get(paymentRef) : Promise.resolve(null)
        ]);

        if (!orderSnap.exists()) throw new Error("Pedido no encontrado.");
        
        const currentOrder = orderSnap.data() as Order;
        if (currentOrder.status === 'Pagado') throw new Error("Esta factura ya ha sido liquidada.");

        if (paymentSnap && paymentSnap.exists() && paymentSnap.data()?.status === 'verified') {
          throw new Error("Este abono ya ha sido verificado previamente.");
        }

        const currentPaid = (currentOrder.totalCashReceived ?? currentOrder.amountPaid ?? 0);
        
        const baseAbono = reportedPayment?.baseAmount || data.amount;
        const actualCash = reportedPayment?.amount || data.amount; 
        const commissionFee = (reportedPayment as any)?.bankCommission || 0;
        const effectiveAbono = baseAbono + commissionFee;
        
        const orderTotal = currentOrder.totalAmount || order.totalAmount || 0;
        const newTotalPaid = currentPaid + effectiveAbono;
        const isFullyPaid = newTotalPaid >= (orderTotal - 0.50);
        const surplusAmount = Math.max(0, newTotalPaid - orderTotal);

        const cleanPaymentPayload = {
          ...data,
          referenceNumber: data.referenceNumber || '',
          notes: data.notes || '',
          surplusAmount: surplusAmount > 0 ? surplusAmount : 0,
          status: 'verified',
          verifiedByUserId: currentUser.id,
          verifiedByName: currentUser.name || authUser.displayName || authUser.email || 'Administración Central',
          bankStatementUrl: (reportedPayment as any)?.bankStatementUrl || (reportedPayment as any)?.imageUrl || '',
          updatedAt: serverTimestamp()
        };

        transaction.set(paymentRef, cleanPaymentPayload, { merge: true });

        const nextStatus = isFullyPaid 
          ? 'Pagado' 
          : (currentOrder.status === 'En Verificación' ? 'Entregado' : currentOrder.status);

        transaction.update(orderRef, { 
            amountPaid: newTotalPaid,
            totalCashReceived: newTotalPaid,
            paidAmount: newTotalPaid,
            status: nextStatus,
            paymentStatus: isFullyPaid ? 'Pagado' : 'Abono Parcial',
            lastPaymentDate: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        // ACTUALIZACIÓN DE CRÉDITO Y BILLETERA DE SALDO A FAVOR DEL CLIENTE
        const customerUpdates: any = {
            creditUsed: increment(-baseAbono),
            updatedAt: serverTimestamp()
        };
        if (surplusAmount > 0) {
            customerUpdates.creditBalance = increment(surplusAmount);
        }

        transaction.update(customerRef, customerUpdates);

        const bcvRate = globalSettings?.bcvRate || 36.5;
        const invoiceNum = order.historicalInvoiceNumber || `#FACT-${(order.id || '').substring(0, 8).toUpperCase()}`;

        // 1. COMISIÓN DEL ASESOR COMERCIAL DE LA VENTA (NORMALIZA FRACCIÓN O PORCENTAJE)
        const rawSpRate = typeof order.salespersonCommissionRate === 'number' 
          ? order.salespersonCommissionRate 
          : (globalSettings?.defaultCommission ?? 5);
        const spRatePct = rawSpRate <= 1 && rawSpRate > 0 ? rawSpRate * 100 : rawSpRate;
        const spRateFrac = spRatePct / 100;
        const commAmount = actualCash * spRateFrac;

        const salespersonId = order.salespersonId || '';
        const salespersonName = order.salespersonName || 'Venta Directa / Oficina Central';

        if (commAmount > 0) {
            const commRef = doc(collection(firestore, 'commissions'));
            transaction.set(commRef, {
                orderId: order.id,
                paymentId: paymentRef.id,
                invoiceNumber: invoiceNum,
                commissionDate: serverTimestamp(),
                collectionDate: serverTimestamp(),
                invoiceAmount: actualCash,
                paymentAmountUSD: actualCash,
                paymentAmountBS: actualCash * bcvRate,
                bcvRate,
                salespersonId,
                salespersonName,
                recipientUserId: salespersonId,
                recipientName: salespersonName,
                recipientRole: 'SALESPERSON',
                salespersonCommissionAmount: commAmount,
                commissionAmountUSD: commAmount,
                commissionAmountBS: commAmount * bcvRate,
                commissionPercent: spRatePct,
                status: 'pendiente',
                currency: 'USD',
                commissionType: 'vendedor',
                orderNumber: invoiceNum,
                customerName: order.customerName || 'Cliente B2B',
                paymentMethod: data.method || 'CASH',
                rateApplied: spRatePct,
                createdAt: serverTimestamp()
            });
        }

        // 2. COMISIÓN DE GERENCIA DE VENTAS (OVERRIDE DINÁMICO DESDE TESORERÍA)
        const managerRatePct = globalSettings?.salesManagerCommission ?? 5;
        const managerRateFrac = managerRatePct / 100;
        const managerCommAmount = actualCash * managerRateFrac;
        if (managerCommAmount > 0) {
            const managerCommRef = doc(collection(firestore, 'commissions'));
            transaction.set(managerCommRef, {
                orderId: order.id,
                paymentId: paymentRef.id,
                invoiceNumber: invoiceNum,
                commissionDate: serverTimestamp(),
                collectionDate: serverTimestamp(),
                invoiceAmount: actualCash,
                paymentAmountUSD: actualCash,
                paymentAmountBS: actualCash * bcvRate,
                bcvRate,
                salespersonId: 'GERENCIA_SALES_MANAGER',
                salespersonName: '👔 Jsutobermudez (Gerencia de Ventas - Override)',
                recipientUserId: 'gerencia_ventas_override',
                recipientName: '👔 Jsutobermudez (Gerencia de Ventas - Override)',
                recipientRole: 'SALES_MANAGER',
                salespersonCommissionAmount: managerCommAmount,
                commissionAmountUSD: managerCommAmount,
                commissionAmountBS: managerCommAmount * bcvRate,
                commissionPercent: managerRatePct,
                status: 'pendiente',
                currency: 'USD',
                commissionType: 'gerencia',
                orderNumber: invoiceNum,
                customerName: order.customerName || 'Cliente B2B',
                paymentMethod: data.method || 'CASH',
                rateApplied: managerRatePct,
                createdAt: serverTimestamp()
            });
        }

        // 3. COMISIÓN DE ADMINISTRACIÓN (DINÁMICA DESDE TESORERÍA)
        const adminRatePct = globalSettings?.adminCommission ?? 0;
        const adminRateFrac = adminRatePct / 100;
        const adminCommAmount = actualCash * adminRateFrac;
        if (adminCommAmount > 0) {
            const adminCommRef = doc(collection(firestore, 'commissions'));
            transaction.set(adminCommRef, {
                orderId: order.id,
                paymentId: paymentRef.id,
                invoiceNumber: invoiceNum,
                commissionDate: serverTimestamp(),
                collectionDate: serverTimestamp(),
                invoiceAmount: actualCash,
                paymentAmountUSD: actualCash,
                paymentAmountBS: actualCash * bcvRate,
                bcvRate,
                salespersonId: 'ADMINISTRACION',
                salespersonName: '🏢 Administración / Gestión de Cobranza',
                recipientUserId: 'admin_override',
                recipientName: '🏢 Administración / Gestión de Cobranza',
                recipientRole: 'ADMIN',
                salespersonCommissionAmount: adminCommAmount,
                commissionAmountUSD: adminCommAmount,
                commissionAmountBS: adminCommAmount * bcvRate,
                commissionPercent: adminRatePct,
                status: 'pendiente',
                currency: 'USD',
                commissionType: 'admin',
                orderNumber: invoiceNum,
                customerName: order.customerName || 'Cliente B2B',
                paymentMethod: data.method || 'CASH',
                rateApplied: adminRatePct,
                createdAt: serverTimestamp()
            });
        }

        return { isFullyPaid, actualCash, newTotalPaid };
      });

      const isFullyPaid = result?.isFullyPaid || false;
      const actualCash = result?.actualCash || data.amount;
      const newTotalPaid = result?.newTotalPaid || data.amount;
      const postPayBalance = isFullyPaid
        ? { pendingListUSD: 0, pendingDivisasUSD: 0 }
        : computeOrderBalanceForWhatsApp({
            ...order,
            amountPaid: newTotalPaid,
            totalCashReceived: newTotalPaid,
            status: order.status,
          });
      const remainingAfterPay = isFullyPaid ? 0 : postPayBalance.pendingListUSD;

        try {
            const receiptPdfBase64 = await generatePaymentReceiptPDF({
                payment: {
                    amount: reportedPayment?.amount || data.amount,
                    method: data.method as any,
                    referenceNumber: data.referenceNumber,
                    registeredByName: currentUser?.name || authUser.displayName || authUser.email || 'Caja Central',
                    paymentDate: new Date(),
                    imageUrl: (reportedPayment as any)?.imageUrl || ''
                },
                order,
                companyProfile: companyProfile || undefined,
                bcvRate: globalSettings?.bcvRate || 65.50
            });

            const custPhone = (order as any).customerPhone || (order as any).phone || (order as any).telefono;
            if (custPhone) {
                const payMsg = paymentReceiptMessage({
                  customerName: order.customerName,
                  orderId: order.id,
                  amountPaid: reportedPayment?.amount || data.amount,
                  method: data.method,
                  referenceNumber: data.referenceNumber,
                  isFullyPaid,
                  remainingListUSD: postPayBalance.pendingListUSD,
                  remainingDivisasUSD: postPayBalance.pendingDivisasUSD,
                  hasPdfAttachment: true,
                });

                dispatchUniversalWhatsApp({
                  phone: custPhone,
                  message: payMsg,
                  pdfBase64: receiptPdfBase64,
                  fileName: `Recibo_Pago_${order.id.substring(0,8)}.pdf`,
                  orderId: order.id,
                  module: 'billing'
                }).catch(e => console.warn('[Payment WA] Error:', e));
            }
        } catch (pdfErr) {
            console.error("Error generating payment receipt PDF:", pdfErr);
        }

        try {
            const { sendPaymentReceiptEmailAction } = await import('@/app/actions');
            const { getCurrentIdToken } = await import('@/lib/auth-fetch');
            await sendPaymentReceiptEmailAction({
                idToken: (await getCurrentIdToken()) || undefined,
                toEmail: (order as any).customerEmail || (order as any).email || currentUser?.email || authUser?.email || '',
                customerName: order.customerName,
                receiptId: `#REC-${(order.id || '').replace('#','').substring(0,8)}-1`,
                orderId: order.id,
                amountPaidUSD: actualCash,
                paymentMethod: data.method,
                referenceNumber: data.referenceNumber,
                remainingBalanceUSD: remainingAfterPay,
                isFullyPaid
            });
        } catch (emailErr) {
            console.warn("Aviso: Envío de correo de recibo diferido:", emailErr);
        }

        await createAppNotifications(firestore, {
            category: 'Facturación',
            title: isFullyPaid ? `🎉 ¡Pedido Pagado al 100%! #${order.id.substring(0, 8)}` : `💵 ¡Abono Conciliado! #${order.id.substring(0, 8)}`,
            message: isFullyPaid 
                ? `El pedido #${order.id} de ${order.customerName} quedó pagado al 100% por $${actualCash.toFixed(2)}. Saldo: $0.00.`
                : `Se verificó un abono de $${actualCash.toFixed(2)} para el pedido #${order.id} (${order.customerName}). Saldo restante (BCV): $${remainingAfterPay.toFixed(2)}.`,
            link: `/dashboard/billing?orderId=${order.id}`,
            initiatorId: currentUser.id,
            salespersonId: order.salespersonId,
            customerId: order.customerId,
            roles: ['admin', 'gerencia', 'deposito'],
        });

        toast({ title: isFullyPaid ? '🎉 ¡Pedido Pagado al 100%!' : '¡Abono Conciliado!', description: `Deuda actualizada y Recibo Oficial PDF emitido.` });
        setIsOpen(false);
    } catch (serverError: any) {
      console.error("Error al conciliar abono:", serverError);
      toast({ variant: 'destructive', title: 'Fallo de Conciliación', description: serverError?.message || 'Error al procesar abono.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const canReconcile = currentUser && ['superadmin', 'admin', 'gerencia'].includes(currentUser.role);

  if (!canReconcile) {
    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="font-black uppercase tracking-widest text-[9px] h-8 rounded-xl border-slate-200 bg-slate-50 text-slate-400">
            <ShieldAlert className="mr-1.5 h-3.5 w-3.5 text-amber-500" /> Conciliar Abono
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md p-8 rounded-[2.5rem] bg-white border-none shadow-2xl">
          <DialogHeader className="text-center space-y-3">
            <div className="mx-auto p-4 rounded-2xl bg-amber-50 text-amber-600 w-fit">
              <ShieldAlert className="h-10 w-10" />
            </div>
            <DialogTitle className="text-xl font-black uppercase text-slate-900 tracking-tight">Acción Restringida por Seguridad</DialogTitle>
            <DialogDescription className="text-xs text-slate-500 font-medium leading-relaxed">
              La conciliación bancaria y la aprobación oficial de abonos están reservadas <strong>exclusivamente para los usuarios Superadministradores y Administradores</strong>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button onClick={() => setIsOpen(false)} className="w-full h-12 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-black uppercase text-[10px] tracking-wider">
              Entendido / Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="font-black uppercase tracking-widest text-[9px] h-8 rounded-xl bg-primary hover:bg-primary/90 shadow-lg">
          <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Verificar Abono
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] sm:max-w-5xl p-0 overflow-hidden rounded-2xl sm:rounded-[2.5rem] border-none shadow-2xl flex flex-col h-[90dvh] max-h-[90dvh]">
        <DialogHeader className="p-6 sm:p-8 bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-emerald-500/20 text-emerald-400 shrink-0"><Receipt className="h-6 w-6" /></div>
            <div className="text-left flex-1 min-w-0">
                <DialogTitle className="text-xl sm:text-2xl font-black uppercase tracking-tighter leading-none truncate">Auditoría de Abono</DialogTitle>
                <DialogDescription className="text-slate-400 font-medium mt-1 uppercase text-[8px] sm:text-[10px] tracking-widest truncate">
                    MÉTODO: {watchedValues.method} | BASE: {watchedValues.accountingBase?.toUpperCase()}
                </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {isLoadingPayment ? <div className="p-20 text-center"><Loader2 className="animate-spin h-10 w-10 mx-auto text-primary" /></div> : (
            <form onSubmit={handleSubmit(onSubmit)} className="bg-white flex-1 flex flex-col min-h-0 overflow-hidden">
                <ScrollArea className="flex-1 min-h-0">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
                        <div className="lg:col-span-4 bg-slate-50 p-6 sm:p-8 border-r border-slate-100 space-y-8">
                            <div className="space-y-4">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2"><DollarSign className="h-3.5 w-3.5 text-primary" /> Comprobante</h3>
                                {reportedPayment?.imageUrl ? (
                                    <div className="relative rounded-2xl overflow-hidden shadow-xl aspect-square bg-slate-200 cursor-zoom-in group" onClick={() => setShowImageFull('payment')}>
                                        <Image src={reportedPayment.imageUrl} alt="Pago" fill className="object-cover" />
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center"><Eye className="text-white" /></div>
                                    </div>
                                ) : <div className="p-10 border-2 border-dashed rounded-2xl text-center opacity-30"><DollarSign className="mx-auto" /></div>}
                            </div>
                        </div>

                        <div className="lg:col-span-8 p-6 sm:p-10 space-y-8">
                            {isBatchReport && (
                                <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 text-emerald-900">
                                            <Layers className="h-4 w-4 text-emerald-600" />
                                            <span className="text-xs font-black uppercase">
                                                Pago Consolidado Multi-Factura ({reportedPayment?.batchOrderIds?.length || 0} Facturas)
                                            </span>
                                        </div>
                                        <Badge className="bg-emerald-600 text-white font-black text-[10px]">
                                            Total Banco: ${(reportedPayment?.batchTotalAmount || 0).toFixed(2)} USD
                                        </Badge>
                                    </div>
                                    {isLoadingBatch ? (
                                        <div className="flex items-center gap-2 text-xs text-emerald-700 font-bold">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando desglose del lote...
                                        </div>
                                    ) : (
                                        <div className="rounded-xl bg-white border border-emerald-100 overflow-hidden">
                                            <table className="w-full text-[11px]">
                                                <thead className="bg-emerald-900/5 text-emerald-900 text-[9px] uppercase font-black">
                                                    <tr>
                                                        <th className="py-2 px-3 text-left">Factura</th>
                                                        <th className="py-2 px-3 text-right">Base Deuda</th>
                                                        <th className="py-2 px-3 text-right">Aplicado</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-emerald-100">
                                                    {(reportedPayment?.batchOrderIds || []).map((oid) => {
                                                        const sibPay = batchSiblingPayments[oid];
                                                        return (
                                                            <tr key={oid}>
                                                                <td className="py-2 px-3 font-mono font-black text-primary">#{oid.substring(0, 8)}</td>
                                                                <td className="py-2 px-3 text-right font-bold text-slate-700">${(sibPay?.baseAmount || 0).toFixed(2)}</td>
                                                                <td className="py-2 px-3 text-right font-black text-emerald-700">${(sibPay?.amount || 0).toFixed(2)}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                    {(reportedPayment?.batchSurplusAmount || 0) > 0.01 && (
                                        <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-800">
                                            <Wallet className="h-4 w-4 text-emerald-600 shrink-0" />
                                            Incluye excedente de ${(reportedPayment?.batchSurplusAmount || 0).toFixed(2)} USD que se acreditará al saldo a favor del cliente.
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-6">
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2"><Calculator className="h-3.5 w-3.5 text-primary" /> Desglose Sincerado</h3>
                                    <div className="space-y-3 bg-slate-50 p-6 rounded-[2rem] border border-slate-100 shadow-inner">
                                        <div className="flex justify-between items-center text-[10px] font-bold">
                                            <span className="text-slate-400 uppercase">Abono a Deuda (Base)</span>
                                            <span className="text-slate-900 font-black">${(reportedPayment?.baseAmount ?? watchedValues.amount ?? 0).toFixed(2)}</span>
                                        </div>
                                        
                                        {reportedPayment?.discountAmount! > 0 && (
                                            <div className="flex justify-between items-center text-[10px] font-bold text-emerald-600">
                                                <span className="uppercase">Incentivo Aplicado</span>
                                                <span>-${reportedPayment?.discountAmount?.toFixed(2)}</span>
                                            </div>
                                        )}

                                        {watchedValues.documentType === 'factura' && (reportedPayment?.taxAmount ?? 0) > 0 && (
                                            <div className="flex justify-between items-center text-[10px] font-bold text-amber-600">
                                                <span className="uppercase">IVA (16%)</span>
                                                <span>+${reportedPayment?.taxAmount?.toFixed(2)}</span>
                                            </div>
                                        )}
                                        
                                        <Separator className="my-2" />
                                        <div className="flex justify-between items-end">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] font-black uppercase text-primary">Ingreso Neto Real</span>
                                                <p className="text-[8px] font-bold text-slate-400 uppercase">Lo que debe estar en banco</p>
                                            </div>
                                            <span className="text-3xl font-black text-slate-900 tracking-tighter">
                                                ${(reportedPayment?.amount ?? watchedValues.amount ?? 0).toFixed(2)}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2 px-1"><ShieldCheck className="h-3.5 w-3.5 text-primary" /> Validación Final</h3>
                                    <div className="space-y-4">
                                        <div className="space-y-1.5">
                                            <Label className="text-[9px] font-black text-slate-500 uppercase">Fecha de Efectividad</Label>
                                            <Controller name="paymentDate" control={control} render={({ field }) => <Input type="date" {...field} className="h-11 font-bold rounded-xl bg-slate-50 border-none" />} />
                                        </div>
                                        <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 flex items-start gap-2">
                                            <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                                            <p className="text-[9px] font-bold text-blue-700 uppercase leading-relaxed">
                                                Al conciliar, se actualizará el "Crédito en Uso" del cliente restando el monto base (${(reportedPayment?.baseAmount ?? watchedValues.amount ?? 0).toFixed(2)}).
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </ScrollArea>

                <DialogFooter className="p-8 bg-slate-50 border-t flex flex-col sm:flex-row gap-4 shrink-0">
                    {isBatchReport && Object.keys(batchSiblingPayments).length > 1 ? (
                        <>
                            <Button type="button" variant="outline" onClick={handleRejectBatch} disabled={isSubmitting || isRejecting || isProcessing || isLoadingBatch} className="h-14 flex-1 rounded-2xl border-rose-200 text-rose-600 hover:bg-rose-50 font-black uppercase text-[10px]">
                                {isRejecting ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : <XCircle className="mr-2 h-4 w-4" />} Rechazar Lote Completo
                            </Button>
                            <Button type="button" onClick={handleSubmit(handleReconcileBatch)} disabled={isSubmitting || isRejecting || isProcessing || isLoadingBatch} className="h-14 flex-[1.5] rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xl font-black uppercase text-[10px] tracking-[0.15em]">
                                {(isSubmitting || isProcessing) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Layers className="mr-2 h-4 w-4" />} CONCILIAR LOTE COMPLETO ({Object.keys(batchSiblingPayments).length} FACTURAS)
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button type="button" variant="outline" onClick={handleRejectPayment} disabled={isSubmitting || isRejecting || isProcessing} className="h-14 flex-1 rounded-2xl border-rose-200 text-rose-600 hover:bg-rose-50 font-black uppercase text-[10px]">
                                {isRejecting ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : <XCircle className="mr-2 h-4 w-4" />} Rechazar Reporte
                            </Button>
                            <Button type="submit" disabled={isSubmitting || isRejecting || isProcessing} className="h-14 flex-[1.5] rounded-2xl bg-slate-900 hover:bg-slate-800 shadow-2xl font-black uppercase text-[10px] tracking-[0.2em]">
                                {(isSubmitting || isProcessing) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4 text-emerald-400" />} CONCILIAR ABONO
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </form>
        )}
      </DialogContent>

      <Dialog open={!!showImageFull} onOpenChange={() => setShowImageFull(null)}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 border-none bg-black/90 flex items-center justify-center">
            {showImageFull === 'payment' && reportedPayment?.imageUrl && (<img src={reportedPayment.imageUrl} alt="Pago Full" className="max-w-full max-h-[90vh] object-contain" />)}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
