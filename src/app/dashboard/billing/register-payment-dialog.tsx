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
    Receipt, 
    Eye, 
    Calculator, 
    TrendingDown, 
    ArrowRight, 
    Lock, 
    Info, 
    Printer 
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc, errorEmitter, FirestorePermissionError } from '@/firebase';
import type { Payment, Order, FinancialSettings, OrderItem, OrderItemClient, CompanyProfile, Product, Customer } from '@/lib/definitions';
import { doc, writeBatch, collection, serverTimestamp, query, where, limit, runTransaction, getDocs, increment, getDoc } from 'firebase/firestore';
import Image from 'next/image';
import { createAppNotifications } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { generateOrderPDF } from '@/lib/pdf-generator';

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

  const { control, handleSubmit, formState: { isSubmitting }, reset } = useForm<PaymentFormValues>({
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
    batch.delete(doc(firestore, `orders/${order.id}/payments`, reportedPayment.id));
    batch.update(doc(firestore, 'orders', order.id), { status: 'Entregado', updatedAt: serverTimestamp() });

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

  const onSubmit = (data: PaymentFormValues) => {
    if (!firestore || !authUser || !currentUser) return;
    
    runTransaction(firestore, async (transaction) => {
        const orderRef = doc(firestore, 'orders', order.id);
        const customerRef = doc(firestore, 'customers', order.customerId);
        
        const orderSnap = await transaction.get(orderRef);
        if (!orderSnap.exists()) throw new Error("Pedido no encontrado.");
        
        const currentOrder = orderSnap.data() as Order;
        if (currentOrder.status === 'Pagado') throw new Error("Esta factura ya ha sido liquidada.");

        const currentPaid = currentOrder.amountPaid || 0;
        
        const baseAbono = reportedPayment?.baseAmount || data.amount;
        const actualCash = reportedPayment?.amount || data.amount; 
        
        const newTotalPaid = currentPaid + baseAbono;
        const isFullyPaid = newTotalPaid >= (order.totalAmount - 0.05);

        const paymentRef = reportedPayment
          ? doc(firestore, `orders/${order.id}/payments`, reportedPayment.id)
          : doc(collection(firestore, `orders/${order.id}/payments`));

        const cleanPaymentPayload = {
          ...data,
          referenceNumber: data.referenceNumber || '',
          notes: data.notes || '',
          status: 'verified',
          updatedAt: serverTimestamp()
        };

        transaction.set(paymentRef, cleanPaymentPayload, { merge: true });

        transaction.update(orderRef, { 
            amountPaid: newTotalPaid,
            totalCashReceived: increment(actualCash),
            status: isFullyPaid ? 'Pagado' : 'Entregado',
            updatedAt: serverTimestamp()
        });

        transaction.update(customerRef, {
            creditUsed: increment(-baseAbono),
            updatedAt: serverTimestamp()
        });

        const rate = order.salespersonCommissionRate || 0.05;
        const commAmount = actualCash * rate;

        const salespersonId = order.salespersonId || '';
        const salespersonName = order.salespersonName || 'Venta Directa / Oficina Central';

        if (commAmount > 0) {
            const commRef = doc(collection(firestore, 'commissions'));
            transaction.set(commRef, {
                orderId: order.id,
                paymentId: paymentRef.id,
                commissionDate: serverTimestamp(),
                invoiceAmount: actualCash,
                salespersonId,
                salespersonName,
                salespersonCommissionAmount: commAmount,
                status: 'pendiente',
                createdAt: serverTimestamp()
            });
        }
    })
    .then(async () => {
        const itemsSnap = await getDocs(collection(firestore, `orders/${order.id}/orderItems`));
        const itemDocs = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() } as OrderItem));
        
        const customerSnap = await getDoc(doc(firestore, 'customers', order.customerId));
        const customerData = customerSnap.exists() ? customerSnap.data() as Customer : null;

        const fullItems = await Promise.all(itemDocs.map(async (item) => {
            const pSnap = await getDoc(doc(firestore, 'products', item.productId));
            const pData = pSnap.exists() ? pSnap.data() as Product : { name: 'Producto No Encontrado', sku: 'N/A', price: 0 } as any;
            return { ...item, product: pData } as OrderItemClient;
        }));

        if (fullItems.length > 0) {
            generateOrderPDF({
                customerName: order.customerName,
                customerRif: order.customerRif || customerData?.rif,
                customerAddress: customerData?.address || '',
                orderItems: fullItems,
                salespersonName: order.salespersonName || 'Ventas Directas',
                orderId: order.id,
                createdAt: new Date(),
                companyProfile: companyProfile || undefined,
                documentType: data.documentType,
                globalSettings: globalSettings || undefined,
                bcvRate: globalSettings?.bcvRate || 1
            });
        }

        await createAppNotifications(firestore, {
            category: 'Facturación',
            title: `¡Abono Conciliado! #${order.id.substring(0, 6)}`,
            message: `Se ha verificado un abono por $${(reportedPayment?.baseAmount || data.amount).toFixed(2)} para ${order.customerName}.`,
            link: `/dashboard/billing?orderId=${order.id}`,
            initiatorId: currentUser.id,
            salespersonId: order.salespersonId,
            customerId: order.customerId,
            roles: ['admin', 'gerencia'],
        });

        toast({ title: '¡Abono Conciliado!', description: `Deuda actualizada y documento generado.` });
        setIsOpen(false);
    })
    .catch(async (serverError: any) => {
        console.error("Error al conciliar abono:", serverError);
        toast({ variant: 'destructive', title: 'Fallo de Conciliación', description: serverError?.message || 'Error al procesar abono.' });
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="font-black uppercase tracking-widest text-[9px] h-8 rounded-xl bg-primary hover:bg-primary/90 shadow-lg">
          <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Verificar Abono
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] sm:max-w-5xl p-0 overflow-hidden rounded-[2.5rem] border-none shadow-2xl flex flex-col h-[90vh]">
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

                        <div className="lg:col-span-8 p-6 sm:p-10 space-y-10">
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
                    <Button type="button" variant="outline" onClick={handleRejectPayment} disabled={isSubmitting || isRejecting} className="h-14 flex-1 rounded-2xl border-rose-200 text-rose-600 hover:bg-rose-50 font-black uppercase text-[10px]">
                        {isRejecting ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : <XCircle className="mr-2 h-4 w-4" />} Rechazar Reporte
                    </Button>
                    <Button type="submit" disabled={isSubmitting || isRejecting} className="h-14 flex-[1.5] rounded-2xl bg-slate-900 hover:bg-slate-800 shadow-2xl font-black uppercase text-[10px] tracking-[0.2em]">
                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4 text-emerald-400" />} CONCILIAR ABONO
                    </Button>
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
