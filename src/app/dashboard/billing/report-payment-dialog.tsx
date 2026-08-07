'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
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
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { 
    Loader2, 
    ShieldCheck, 
    Landmark, 
    Receipt, 
    Calculator, 
    CheckCircle, 
    TrendingDown, 
    Info, 
    Smartphone,
    Building2,
    Send as LucideSend,
    Banknote,
    X,
    FileText,
    FileCheck,
    Coins,
    DollarSign,
    Clock,
    ArrowRightLeft,
    Sparkles
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirestore, useUser, useDoc, useMemoFirebase } from '@/firebase';
import { doc, collection, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { ImageUploader } from '@/components/ui/image-uploader';
import { cn } from '@/lib/utils';
import type { Invoice, Order, FinancialSettings, Payment } from '@/lib/definitions';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { differenceInDays } from 'date-fns';

const paymentReportSchema = z.object({
  amount: z.coerce.number().min(0.01, 'El monto debe ser mayor a cero.'),
  paymentDate: z.string().min(1, 'La fecha es requerida.'),
  method: z.string().min(1, 'Selecciona un método de pago.'),
  referenceNumber: z.string().min(1, 'El número de referencia es obligatorio.'),
  notes: z.string().optional(),
  documentType: z.enum(['nota', 'factura']).default('nota'),
  accountingBase: z.enum(['bcv', 'cash']).default('bcv'),
  earlyPaymentType: z.enum(['none', '7days', '15days']).default('none'),
  inputMode: z.enum(['debt', 'receipt']).default('debt'),
});

type PaymentReportValues = z.infer<typeof paymentReportSchema>;

function getElapsedDays(orderDate: any, paymentDateStr: string): number {
  if (!orderDate) return 0;
  try {
    let oDate: Date;
    if (typeof orderDate.toDate === 'function') oDate = orderDate.toDate();
    else if (orderDate.seconds) oDate = new Date(orderDate.seconds * 1000);
    else oDate = new Date(orderDate);

    const pDate = paymentDateStr ? new Date(paymentDateStr + 'T12:00:00') : new Date();
    if (isNaN(oDate.getTime()) || isNaN(pDate.getTime())) return 0;
    
    return Math.max(0, differenceInDays(pDate, oDate));
  } catch (e) {
    return 0;
  }
}

export function ReportPaymentDialog({ invoice, mode = 'partial' }: { invoice: Invoice, mode?: 'partial' | 'total' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const { toast } = useToast();
  const firestore = useFirestore();
  const { user: authUser, profile: currentUser } = useUser();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => { 
    setIsMounted(true); 
  }, []);

  const isTotalMode = mode === 'total';

  const financialRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
  const { data: globalSettingsRaw } = useDoc<FinancialSettings>(financialRef);

  const globalSettings = useMemo(() => {
    return globalSettingsRaw || {
        bcvRate: 1,
        ivaPercent: 16,
        defaultBcvDiscount: 35,
        earlyPayment7Days: 5,
        earlyPayment15Days: 3
    } as FinancialSettings;
  }, [globalSettingsRaw]);

  const orderRef = useMemoFirebase(() => (firestore && invoice?.id) ? doc(firestore, 'orders', invoice.id) : null, [firestore, invoice?.id]);
  const { data: orderData } = useDoc<Order>(orderRef);

  const { control, handleSubmit, formState: { isSubmitting, errors }, reset, setValue, watch } = useForm<PaymentReportValues>({
    resolver: zodResolver(paymentReportSchema),
    defaultValues: { 
        amount: 0, 
        paymentDate: '', 
        method: '',
        referenceNumber: '',
        notes: '',
        documentType: 'nota',
        accountingBase: 'bcv',
        earlyPaymentType: 'none',
        inputMode: 'debt'
    },
  });

  const selectedMethod = watch('method');
  const inputAmount = watch('amount');
  const documentType = watch('documentType');
  const accountingBase = watch('accountingBase');
  const paymentDateInput = watch('paymentDate');
  const earlyPaymentType = watch('earlyPaymentType');
  const inputMode = watch('inputMode');

  const metodosNacionales = useMemo(() => [
    { 
        id: 'Pago Móvil', 
        label: 'Pago Móvil', 
        sub: 'VES / BCV', 
        icon: Smartphone, 
        data: { 
            entidad: 'BANESCO / MERCANTIL', 
            telefono: '0412-1234567', 
            identidad: 'J-12345678-0', 
            guia: 'Abono inmediato en Bolívares (VES) a tasa oficial BCV.' 
        } 
    },
    { 
        id: 'Transferencia Bancaria', 
        label: 'Transferencia', 
        sub: 'USD Local', 
        icon: Building2, 
        data: { 
            entidad: 'BANESCO CUENTA CORRIENTE', 
            cuenta: '0134-0000-00-0000000000', 
            identidad: 'J-12345678-0', 
            guia: 'Reporte su número de referencia bancaria exacto para validación.' 
        } 
    },
    { 
        id: 'Zelle', 
        label: 'Zelle', 
        sub: 'Manual LLC', 
        icon: LucideSend, 
        data: { 
            correo: 'pagos@athleticenter.com', 
            titular: 'CORPORACIÓN ATHLETICENTER LLC', 
            guia: 'Abono manual vía Zelle.' 
        } 
    },
    { 
        id: 'Efectivo', 
        label: 'Efectivo', 
        sub: 'Taquilla', 
        icon: Banknote, 
        data: { 
            sede: 'ALMACÉN CENTRAL / TAQUILLA', 
            guia: 'Entrega física verificada por el cajero en sede.' 
        } 
    },
  ], []);

  const currentInstructions = useMemo(() => {
    return metodosNacionales.find(m => m.id === selectedMethod)?.data;
  }, [selectedMethod, metodosNacionales]);

  useEffect(() => {
    if (isOpen && isMounted && invoice) {
        setValue('paymentDate', new Date().toISOString().split('T')[0]);
        if (isTotalMode) setValue('amount', Number((invoice.remainingBalance || 0).toFixed(2)));
        else setValue('amount', 0);
    }
  }, [isOpen, isMounted, isTotalMode, invoice?.remainingBalance, setValue]);

  const elapsedDays = useMemo(() => {
    return getElapsedDays(orderData?.orderDate || (invoice as any)?.createdAt, paymentDateInput);
  }, [orderData?.orderDate, invoice, paymentDateInput]);

  const is7DaysEligible = elapsedDays <= 7;
  const is15DaysEligible = elapsedDays <= 15;

  useEffect(() => {
    if (earlyPaymentType === '7days' && !is7DaysEligible) {
      setValue('earlyPaymentType', is15DaysEligible ? '15days' : 'none');
    } else if (earlyPaymentType === '15days' && !is15DaysEligible) {
      setValue('earlyPaymentType', 'none');
    }
  }, [elapsedDays, is7DaysEligible, is15DaysEligible, earlyPaymentType, setValue]);

  // LÓGICA DE CÁLCULO BI-DIRECCIONAL EN TIEMPO REAL v8.3 (RESILIENTE)
  const calculation = useMemo(() => {
    const bcvDiscountFactor = (globalSettings.defaultBcvDiscount || 35) / 100;
    const ivaFactor = (globalSettings.ivaPercent || 16) / 100;
    const early7Factor = (globalSettings.earlyPayment7Days || 5) / 100;
    const early15Factor = (globalSettings.earlyPayment15Days || 3) / 100;

    const currentBalance = invoice?.remainingBalance || 0;
    const rawVal = Number(inputAmount || 0);

    let cashDiscountPct = accountingBase === 'cash' ? bcvDiscountFactor : 0;
    let earlyDiscountPct = 0;
    let discountType: Payment['discountType'] = 'none';

    if (accountingBase === 'cash') discountType = 'cash';

    if (earlyPaymentType === '7days' && is7DaysEligible) {
      earlyDiscountPct = early7Factor;
      if (discountType === 'none') discountType = '7days';
    } else if (earlyPaymentType === '15days' && is15DaysEligible) {
      earlyDiscountPct = early15Factor;
      if (discountType === 'none') discountType = '15days';
    }

    const totalDiscountPct = cashDiscountPct + earlyDiscountPct;
    const effectiveDiscountMultiplier = 1 - totalDiscountPct;

    let baseAmountToPay = 0;
    let finalAmountToTransfer = 0;

    if (inputMode === 'debt') {
        baseAmountToPay = isTotalMode ? currentBalance : Math.min(rawVal, currentBalance);
        const subtotalAfterIncentives = Math.max(0, baseAmountToPay * effectiveDiscountMultiplier);
        const taxAmount = documentType === 'factura' ? Number((subtotalAfterIncentives * ivaFactor).toFixed(2)) : 0;
        finalAmountToTransfer = subtotalAfterIncentives + taxAmount;
    } else {
        finalAmountToTransfer = rawVal;
        const taxDivisor = documentType === 'factura' ? (1 + ivaFactor) : 1;
        const subtotalAfterIncentives = finalAmountToTransfer / taxDivisor;
        baseAmountToPay = effectiveDiscountMultiplier > 0 ? (subtotalAfterIncentives / effectiveDiscountMultiplier) : subtotalAfterIncentives;
        baseAmountToPay = Math.min(baseAmountToPay, currentBalance);
    }

    const cashDiscountAmount = Number((baseAmountToPay * cashDiscountPct).toFixed(2));
    const earlyDiscountAmount = Number((baseAmountToPay * earlyDiscountPct).toFixed(2));
    const totalDiscountAmount = cashDiscountAmount + earlyDiscountAmount;
    const subtotal = Math.max(0, baseAmountToPay - totalDiscountAmount);
    const taxAmount = documentType === 'factura' ? Number((subtotal * ivaFactor).toFixed(2)) : 0;

    return { 
        baseAmount: Number(baseAmountToPay.toFixed(2)), 
        discountAmount: Number(totalDiscountAmount.toFixed(2)),
        cashDiscountAmount,
        earlyDiscountAmount,
        taxAmount,
        finalAmount: Number(finalAmountToTransfer.toFixed(2)), 
        discountType 
    };
  }, [globalSettings, inputAmount, accountingBase, documentType, earlyPaymentType, is7DaysEligible, is15DaysEligible, invoice?.remainingBalance, isTotalMode, inputMode]);

  useEffect(() => {
      if (selectedMethod && !['Zelle', 'Efectivo'].includes(selectedMethod)) {
          setValue('accountingBase', 'bcv');
      }
  }, [selectedMethod, setValue]);

  const onSubmit = async (data: PaymentReportValues) => {
    if (!invoice?.id) {
      toast({ variant: 'destructive', title: 'Error de Orden', description: 'No se encontró la factura asociada.' });
      return;
    }

    if (!firestore || !authUser) {
      toast({ variant: 'destructive', title: 'Error de Autenticación', description: 'Por favor inicie sesión nuevamente.' });
      return;
    }

    if (!selectedMethod) {
      toast({ variant: 'destructive', title: 'Método Requerido', description: 'Por favor seleccione un método de pago.' });
      return;
    }

    if (!data.referenceNumber) {
      toast({ variant: 'destructive', title: 'Referencia Requerida', description: 'Por favor ingrese el número de referencia.' });
      return;
    }

    let safePaymentDate: Date = new Date();
    if (data.paymentDate) {
      const parsed = new Date(data.paymentDate + 'T12:00:00');
      if (!isNaN(parsed.getTime())) safePaymentDate = parsed;
    }
    
    const paymentRef = doc(collection(firestore, 'orders', invoice.id, 'payments'));
    const registeredByName = currentUser?.name || authUser.displayName || authUser.email || 'Cliente';

    const cleanPayload = { 
      method: data.method || 'Transferencia Bancaria',
      amount: isNaN(Number(calculation.finalAmount)) ? 0 : Number(calculation.finalAmount), 
      orderId: invoice.id || '', 
      status: 'pending_verification', 
      registeredBy: authUser.uid || '', 
      registeredByName: registeredByName || 'Cliente', 
      imageUrl: uploadedImageUrl || '', 
      paymentDate: safePaymentDate, 
      createdAt: serverTimestamp(), 
      baseAmount: isNaN(Number(calculation.baseAmount)) ? 0 : Number(calculation.baseAmount), 
      discountAmount: isNaN(Number(calculation.discountAmount)) ? 0 : Number(calculation.discountAmount), 
      taxAmount: isNaN(Number(calculation.taxAmount)) ? 0 : Number(calculation.taxAmount),
      discountType: calculation.discountType || 'none', 
      incentivesApplied: Boolean(calculation.discountAmount && calculation.discountAmount > 0), 
      documentType: data.documentType || 'nota', 
      accountingBase: data.accountingBase || 'bcv',
      referenceNumber: data.referenceNumber || '',
      notes: data.notes || ''
    };

    try {
      await setDoc(paymentRef, cleanPayload);
      
      // 2. Actualización de estatus del pedido a "En Verificación"
      try {
        await updateDoc(doc(firestore, 'orders', invoice.id), {
          status: 'En Verificación',
          updatedAt: serverTimestamp()
        });
      } catch (orderUpdateErr: any) {
        console.warn("Aviso: Pago guardado, actualización de orden diferida:", orderUpdateErr);
      }

      toast({ 
        title: '¡Abono Reportado Exitosamente!', 
        description: 'Administración verificará su comprobante pronto.' 
      });
      setIsOpen(false);
      reset();
      setUploadedImageUrl(null);
    } catch (saveErr: any) {
      console.error("Error al guardar reporte de pago:", saveErr);
      toast({ 
        variant: 'destructive', 
        title: 'Fallo al Guardar Reporte', 
        description: saveErr?.message || 'Error de conexión con la base de datos.' 
      });
    }
  };

  if (!isMounted || !invoice) return null;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className={cn("font-black uppercase tracking-widest text-[9px] h-10 rounded-xl shadow-lg transition-all active:scale-95", isTotalMode ? "bg-emerald-600 hover:bg-emerald-700" : "bg-primary hover:bg-primary/90")}>
            {isTotalMode ? <CheckCircle className="mr-1.5 h-4 w-4" /> : <Calculator className="mr-1.5 h-4 w-4" />}
            {isTotalMode ? "Liquidar Factura" : "Reportar Pago"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] sm:max-w-5xl p-0 overflow-hidden rounded-[2.5rem] border-none shadow-2xl flex flex-col h-[90vh]">
        <DialogHeader className={cn("p-6 sm:p-8 text-white shrink-0", isTotalMode ? "bg-emerald-600" : "bg-slate-900")}>
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-white/20 text-white shadow-xl shrink-0">
                {isTotalMode ? <CheckCircle className="h-6 w-6" /> : <Receipt className="h-6 w-6" />}
            </div>
            <div className="text-left min-w-0 flex-1">
                <DialogTitle className="text-xl sm:text-2xl font-black uppercase tracking-tighter leading-none truncate">Terminal de Cobranza Dinámica</DialogTitle>
                <DialogDescription className="text-white/60 font-medium mt-1 uppercase text-[8px] sm:text-[10px] tracking-widest">#{invoice.id.substring(0,7)} | Saldo Pendiente: ${(invoice.remainingBalance || 0).toFixed(2)}</DialogDescription>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-white/40 hover:text-white transition-colors"><X className="h-6 w-6" /></button>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="bg-white flex-1 flex flex-col min-h-0 overflow-hidden">
            <ScrollArea className="flex-1 min-h-0">
                <div className="p-6 sm:p-8 space-y-10">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                        <div className="lg:col-span-7 space-y-10">
                            {/* SECCIÓN 1: RÉGIMEN FISCAL */}
                            <section className="space-y-6">
                                <div className="flex items-center gap-2 px-1">
                                    <FileCheck className="h-4 w-4 text-primary" />
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Régimen de Operación</h3>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div 
                                        className={cn(
                                            "p-4 rounded-2xl border-2 transition-all cursor-pointer flex flex-col items-center gap-2 text-center",
                                            documentType === 'nota' ? "border-primary bg-primary/5" : "border-slate-100 hover:bg-slate-50"
                                        )}
                                        onClick={() => setValue('documentType', 'nota')}
                                    >
                                        <FileText className={cn("h-6 w-6", documentType === 'nota' ? "text-primary" : "text-slate-300")} />
                                        <span className="text-[10px] font-black uppercase">Nota de Entrega</span>
                                        <span className="text-[7px] font-bold text-slate-400 uppercase">SIN IVA / SOLO BASE</span>
                                    </div>
                                    <div 
                                        className={cn(
                                            "p-4 rounded-2xl border-2 transition-all cursor-pointer flex flex-col items-center gap-2 text-center",
                                            documentType === 'factura' ? "border-primary bg-primary/5" : "border-slate-100 hover:bg-slate-50"
                                        )}
                                        onClick={() => setValue('documentType', 'factura')}
                                    >
                                        <Receipt className={cn("h-6 w-6", documentType === 'factura' ? "text-primary" : "text-slate-300")} />
                                        <span className="text-[10px] font-black uppercase">Factura Fiscal</span>
                                        <span className="text-[7px] font-bold text-primary uppercase">INCLUYE IVA (16%)</span>
                                    </div>
                                </div>
                            </section>

                            {/* SECCIÓN 2: BASE DE PAGO */}
                            <section className="space-y-6">
                                <div className="flex items-center gap-2 px-1">
                                    <Coins className="h-4 w-4 text-primary" />
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Base de Cálculo</h3>
                                </div>
                                <RadioGroup 
                                    defaultValue="bcv" 
                                    value={accountingBase} 
                                    onValueChange={(v) => setValue('accountingBase', v as any)}
                                    className="grid grid-cols-2 gap-4"
                                >
                                    <div className={cn(
                                        "flex items-center justify-between p-4 rounded-2xl border-2 cursor-pointer transition-all",
                                        accountingBase === 'bcv' ? "border-primary bg-primary/5 shadow-sm" : "border-slate-100 hover:bg-slate-50"
                                    )} onClick={() => setValue('accountingBase', 'bcv')}>
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-[10px] font-black uppercase">Base BCV / BS</span>
                                            <span className="text-[7px] font-bold text-slate-400 uppercase">Monto Nominal (Sin Ahorro)</span>
                                        </div>
                                        <RadioGroupItem value="bcv" />
                                    </div>
                                    
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div className={cn(
                                                    "flex items-center justify-between p-4 rounded-2xl border-2 cursor-pointer transition-all",
                                                    accountingBase === 'cash' ? "border-emerald-500 bg-emerald-50 shadow-sm" : "border-slate-100 hover:bg-slate-50",
                                                    !['Zelle', 'Efectivo'].includes(selectedMethod) && "opacity-40 cursor-not-allowed grayscale"
                                                )} onClick={() => {
                                                    if (['Zelle', 'Efectivo'].includes(selectedMethod)) setValue('accountingBase', 'cash');
                                                }}>
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[10px] font-black uppercase">Incentivo CASH</span>
                                                        <span className="text-[7px] font-bold text-emerald-600 uppercase">Aplica Ahorro Red (~35%)</span>
                                                    </div>
                                                    <RadioGroupItem value="cash" disabled={!['Zelle', 'Efectivo'].includes(selectedMethod)} />
                                                </div>
                                            </TooltipTrigger>
                                            {!['Zelle', 'Efectivo'].includes(selectedMethod) && (
                                                <TooltipContent className="bg-slate-900 text-white font-bold text-[9px] uppercase">
                                                    El incentivo requiere método de pago: Zelle o Efectivo.
                                                </TooltipContent>
                                            )}
                                        </Tooltip>
                                    </TooltipProvider>
                                </RadioGroup>
                            </section>

                            {/* SECCIÓN 3: SELECTOR MANUAL DE PRONTO PAGO CON BLOQUEO */}
                            <section className="space-y-4">
                                <div className="flex items-center gap-2 px-1">
                                    <Clock className="h-4 w-4 text-primary" />
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Descuento de Pronto Pago (Manual)</h3>
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    <div 
                                        className={cn(
                                            "p-3.5 rounded-2xl border-2 cursor-pointer text-center transition-all flex flex-col justify-between h-22",
                                            earlyPaymentType === 'none' ? "border-primary bg-primary/5 shadow-sm" : "border-slate-100 hover:bg-slate-50"
                                        )}
                                        onClick={() => setValue('earlyPaymentType', 'none')}
                                    >
                                        <span className="text-[9px] font-black uppercase">Sin Pronto Pago</span>
                                        <span className="text-[7px] font-bold text-slate-400 uppercase">0% Descuento</span>
                                    </div>

                                    <div 
                                        className={cn(
                                            "p-3.5 rounded-2xl border-2 text-center transition-all flex flex-col justify-between h-22",
                                            earlyPaymentType === '7days' ? "border-emerald-500 bg-emerald-50 shadow-sm" : "border-slate-100",
                                            is7DaysEligible ? "cursor-pointer hover:bg-slate-50" : "opacity-40 cursor-not-allowed bg-slate-100 grayscale"
                                        )}
                                        onClick={() => {
                                            if (is7DaysEligible) setValue('earlyPaymentType', '7days');
                                        }}
                                    >
                                        <div className="flex flex-col">
                                            <span className="text-[9px] font-black uppercase">Pronto Pago 7 Días</span>
                                            <span className="text-[7px] font-bold text-emerald-600 uppercase">{globalSettings?.earlyPayment7Days || 5}% OFF</span>
                                        </div>
                                        <span className="text-[7px] font-black uppercase flex items-center justify-center gap-1">
                                            {is7DaysEligible ? '🟢 Disponible' : `🔒 Vencido (${elapsedDays}d)`}
                                        </span>
                                    </div>

                                    <div 
                                        className={cn(
                                            "p-3.5 rounded-2xl border-2 text-center transition-all flex flex-col justify-between h-22",
                                            earlyPaymentType === '15days' ? "border-emerald-500 bg-emerald-50 shadow-sm" : "border-slate-100",
                                            is15DaysEligible ? "cursor-pointer hover:bg-slate-50" : "opacity-40 cursor-not-allowed bg-slate-100 grayscale"
                                        )}
                                        onClick={() => {
                                            if (is15DaysEligible) setValue('earlyPaymentType', '15days');
                                        }}
                                    >
                                        <div className="flex flex-col">
                                            <span className="text-[9px] font-black uppercase">Pronto Pago 15 Días</span>
                                            <span className="text-[7px] font-bold text-emerald-600 uppercase">{globalSettings?.earlyPayment15Days || 3}% OFF</span>
                                        </div>
                                        <span className="text-[7px] font-black uppercase flex items-center justify-center gap-1">
                                            {is15DaysEligible ? '🟢 Disponible' : `🔒 Vencido (${elapsedDays}d)`}
                                        </span>
                                    </div>
                                </div>
                            </section>

                            <section className="space-y-6">
                                <div className="flex items-center gap-2 px-1">
                                    <Landmark className="h-4 w-4 text-primary" />
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Métodos de Pago</h3>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    {metodosNacionales.map((m) => {
                                        const IconComp = m.icon;
                                        return (
                                            <div 
                                                key={m.id} 
                                                className={cn(
                                                    "flex items-center gap-4 p-4 rounded-2xl border-2 transition-all cursor-pointer group shadow-sm", 
                                                    selectedMethod === m.id ? "border-primary bg-primary/5 shadow-md" : "border-slate-100 hover:border-slate-200 hover:bg-slate-50"
                                                )} 
                                                onClick={() => setValue('method', m.id, { shouldValidate: true })}
                                            >
                                                <div className={cn(
                                                    "p-2.5 rounded-xl transition-transform group-hover:scale-110", 
                                                    selectedMethod === m.id ? "bg-primary text-white" : "bg-slate-100 text-slate-400"
                                                )}>
                                                    <IconComp className="h-5 w-5" />
                                                </div>
                                                <div className="flex flex-col flex-1 min-w-0">
                                                    <Label className="cursor-pointer text-[12px] font-black uppercase leading-none truncate">{m.label}</Label>
                                                    <span className="text-[8px] font-bold text-slate-400 uppercase mt-1.5 tracking-widest truncate">{m.sub}</span>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>

                                {currentInstructions && (
                                    <div className="p-6 rounded-[2rem] bg-slate-900 text-white space-y-4 animate-in slide-in-from-top-4 shadow-2xl">
                                        <div className="flex items-center gap-2 text-primary font-black text-[9px] uppercase tracking-widest">
                                            <Info className="h-3 w-3" /> Instrucciones de Pago
                                        </div>
                                        <div className="space-y-3 relative z-10">
                                            {currentInstructions.entidad && <div className="flex justify-between border-b border-white/10 pb-2"><span className="text-[10px] text-slate-400 uppercase">Banco</span><span className="text-xs font-black">{currentInstructions.entidad}</span></div>}
                                            {currentInstructions.telefono && <div className="flex justify-between border-b border-white/10 pb-2"><span className="text-[10px] text-slate-400 uppercase">Teléfono</span><span className="text-xs font-black">{currentInstructions.telefono}</span></div>}
                                            {currentInstructions.identidad && <div className="flex justify-between border-b border-white/10 pb-2"><span className="text-[10px] text-slate-400 uppercase">Identidad</span><span className="text-xs font-black">{currentInstructions.identidad}</span></div>}
                                            <p className="text-[10px] font-medium text-slate-400 italic pt-2 leading-relaxed">{currentInstructions.guia}</p>
                                        </div>
                                    </div>
                                )}
                            </section>

                            <section className="space-y-6">
                                <div className="flex items-center justify-between px-1">
                                    <div className="flex items-center gap-2 text-primary">
                                        <ShieldCheck className="h-4 w-4" />
                                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Datos del Reporte</h3>
                                    </div>
                                    <div className="flex items-center bg-slate-100 p-1 rounded-xl gap-1">
                                        <button 
                                            type="button" 
                                            onClick={() => setValue('inputMode', 'debt')} 
                                            className={cn("px-2.5 py-1 text-[8px] font-black uppercase rounded-lg transition-all", inputMode === 'debt' ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600")}
                                        >
                                            Por Deuda
                                        </button>
                                        <button 
                                            type="button" 
                                            onClick={() => setValue('inputMode', 'receipt')} 
                                            className={cn("px-2.5 py-1 text-[8px] font-black uppercase rounded-lg transition-all", inputMode === 'receipt' ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600")}
                                        >
                                            Por Banco
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <Label className="text-[9px] font-black uppercase text-slate-500 px-1 flex items-center justify-between">
                                            <span>{inputMode === 'debt' ? "Monto a Abonar a Deuda ($)" : "Monto Transferido en Comprobante ($)"}</span>
                                            <span className="text-primary text-[7px]">{inputMode === 'debt' ? "Saldar Deuda" : "Cifra de Banco"}</span>
                                        </Label>
                                        <Controller name="amount" control={control} render={({ field }) => (
                                            <Input {...field} type="number" step="0.01" readOnly={isTotalMode && inputMode === 'debt'} className="h-12 font-black text-xl rounded-xl bg-slate-50 border-none shadow-inner" />
                                        )} />
                                        <p className="text-[7px] font-bold text-slate-400 uppercase px-1">
                                            {inputMode === 'debt' 
                                                ? "VALOR NOMINAL QUE SE DESCONTARÁ DE SU SALDO DEUDA." 
                                                : "MONTO EXACTO QUE DICE SU COMPROBANTE DE PAGO BANCARIO."}
                                        </p>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[9px] font-black uppercase text-slate-500 px-1">Referencia</Label>
                                        <Controller name="referenceNumber" control={control} render={({ field }) => (
                                            <Input {...field} placeholder="Nro de Confirmación..." className="h-12 font-mono font-bold rounded-xl bg-slate-50 border-none shadow-inner" />
                                        )} />
                                        {errors.referenceNumber && <p className="text-[9px] font-bold text-rose-500">{errors.referenceNumber.message}</p>}
                                    </div>
                                </div>
                                <ImageUploader 
                                    folderPath="payment-receipts" 
                                    onImageUploaded={setUploadedImageUrl} 
                                    label="Captura del Comprobante" 
                                />
                            </section>
                        </div>

                        <div className="lg:col-span-5">
                            <Card className={cn(
                                "text-white border-none shadow-2xl rounded-[2.5rem] overflow-hidden sticky top-0", 
                                isTotalMode ? "bg-emerald-900" : "bg-slate-900"
                            )}>
                                <CardHeader className="border-b border-white/10 pb-4">
                                    <CardTitle className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center justify-between">
                                        <span className="flex items-center gap-2"><Calculator className="h-3.5 w-3.5" /> Monitor de Liquidación</span>
                                        <Badge variant="outline" className="text-[7px] text-white/60 border-white/20 uppercase font-mono">v8.3 Alta Resiliencia</Badge>
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-8 space-y-8">
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center text-white/60">
                                            <span className="text-[9px] font-black uppercase">Abono al Saldo (Deuda BCV)</span>
                                            <span className="text-sm font-bold text-white">${calculation.baseAmount.toFixed(2)}</span>
                                        </div>
                                        
                                        {calculation.cashDiscountAmount > 0 && (
                                            <div className="flex justify-between items-center text-emerald-400 animate-in slide-in-from-left-2">
                                                <span className="text-[9px] font-black uppercase flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Incentivo CASH (~35% OFF)</span>
                                                <span className="text-sm font-black">-${calculation.cashDiscountAmount.toFixed(2)}</span>
                                            </div>
                                        )}

                                        {calculation.earlyDiscountAmount > 0 && (
                                            <div className="flex justify-between items-center text-emerald-400 animate-in slide-in-from-left-2">
                                                <span className="text-[9px] font-black uppercase flex items-center gap-1"><Clock className="h-3 w-3" /> Pronto Pago ({earlyPaymentType === '7days' ? '7d' : '15d'})</span>
                                                <span className="text-sm font-black">-${calculation.earlyDiscountAmount.toFixed(2)}</span>
                                            </div>
                                        )}

                                        {calculation.taxAmount > 0 && (
                                            <div className="flex justify-between items-center text-amber-400 animate-in slide-in-from-right-2">
                                                <span className="text-[9px] font-black uppercase flex items-center gap-1">IVA Percibido (16%)</span>
                                                <span className="text-sm font-black">+${calculation.taxAmount.toFixed(2)}</span>
                                            </div>
                                        )}

                                        <Separator className="bg-white/10" />
                                        
                                        <div className="text-center pt-4">
                                            <p className="text-[10px] font-black uppercase text-primary tracking-[0.3em] mb-2">Total a Transferir (Banco)</p>
                                            <p className={cn(
                                                "text-5xl sm:text-6xl font-black tracking-tighter leading-none transition-all",
                                                calculation.discountAmount > 0 ? "text-emerald-400" : "text-white"
                                            )}>${calculation.finalAmount.toFixed(2)}</p>
                                            <p className="text-[8px] font-bold text-white/40 uppercase mt-4">ESTE ES EL MONTO EXACTO QUE DEBE FIGURAR EN SU COMPROBANTE.</p>
                                        </div>
                                    </div>
                                </CardContent>
                                <CardFooter className="p-8 bg-white/5">
                                    <Button 
                                        type="submit" 
                                        disabled={isSubmitting} 
                                        className="w-full h-14 rounded-2xl font-black uppercase tracking-[0.2em] shadow-xl bg-primary hover:bg-primary/90 text-[11px] transition-all active:scale-95"
                                    >
                                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LucideSend className="mr-2 h-4 w-4" />} NOTIFICAR AL MANDO
                                    </Button>
                                </CardFooter>
                            </Card>
                        </div>
                    </div>
                </div>
            </ScrollArea>
        </form>
      </DialogContent>
    </Dialog>
  );
}