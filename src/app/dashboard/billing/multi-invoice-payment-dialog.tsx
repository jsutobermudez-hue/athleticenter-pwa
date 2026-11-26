'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertCircle,
  Banknote,
  Building2,
  Calculator,
  CheckCircle2,
  Coins,
  FileCheck,
  FileText,
  Layers,
  Loader2,
  Receipt,
  Send as LucideSend,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import { useDoc, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { ImageUploader } from '@/components/ui/image-uploader';
import { cn } from '@/lib/utils';
import type { CompanyProfile, Customer, FinancialSettings, Invoice, Order } from '@/lib/definitions';
import {
  computeMultiInvoiceAllocation,
  validateSameCustomer,
  type MultiInvoiceItemInput,
} from '@/lib/multi-invoice-payment';
import {
  executeMultiInvoiceReconciliation,
  submitMultiInvoiceReport,
} from '@/lib/multi-invoice-reconcile';

export interface MultiInvoicePaymentDialogProps {
  allInvoices: Invoice[];
  allOrders?: Order[];
  preselectedInvoiceIds?: string[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

const PAYMENT_METHODS = [
  { id: 'Pago Móvil', label: 'Pago Móvil', sub: 'VES / BCV', icon: Smartphone, isCash: false },
  { id: 'Transferencia Bancaria', label: 'Transferencia', sub: 'USD / BS BCV', icon: Building2, isCash: false },
  { id: 'Zelle', label: 'Zelle', sub: 'Divisas USD', icon: LucideSend, isCash: true },
  { id: 'Binance Pay / USDT', label: 'Binance Pay', sub: 'USDT', icon: Wallet, isCash: true },
  { id: 'Efectivo', label: 'Efectivo', sub: 'Divisas Taquilla', icon: Banknote, isCash: true },
] as const;

export function MultiInvoicePaymentDialog({
  allInvoices,
  allOrders = [],
  preselectedInvoiceIds,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  trigger,
  onSuccess,
}: MultiInvoicePaymentDialogProps) {
  const { toast } = useToast();
  const firestore = useFirestore();
  const { user: authUser, profile: currentUser } = useUser();

  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = typeof controlledOpen === 'boolean';
  const isOpen = isControlled ? controlledOpen : internalOpen;
  const setIsOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    controlledOnOpenChange?.(next);
  };

  const isManager = Boolean(
    currentUser && ['superadmin', 'admin', 'gerencia'].includes(currentUser.role)
  );
  const isClientRole = currentUser?.role === 'cliente';

  const financialRef = useMemoFirebase(
    () => (firestore ? doc(firestore, 'system', 'financials') : null),
    [firestore]
  );
  const { data: globalSettingsRaw } = useDoc<FinancialSettings>(financialRef);
  const globalSettings = useMemo<FinancialSettings>(
    () =>
      globalSettingsRaw ||
      ({
        bcvRate: 65.5,
        ivaPercent: 16,
        defaultBcvDiscount: 25,
        earlyPayment7Days: 10,
        earlyPayment15Days: 5,
      } as FinancialSettings),
    [globalSettingsRaw]
  );

  const companyProfileRef = useMemoFirebase(
    () => (firestore ? doc(firestore, 'companyProfile', 'main') : null),
    [firestore]
  );
  const { data: companyProfile } = useDoc<CompanyProfile>(companyProfileRef);

  const pendingInvoices = useMemo(
    () =>
      (allInvoices || []).filter(
        (inv) => inv.remainingBalance > 0.05 && inv.status !== 'Pagado'
      ),
    [allInvoices]
  );

  const customerGroups = useMemo(() => {
    const map = new Map<
      string,
      { customerId: string; customerName: string; count: number; totalDebt: number }
    >();
    pendingInvoices.forEach((inv) => {
      const cid = (inv.customerId || '').trim();
      if (!cid) return;
      const existing = map.get(cid);
      if (existing) {
        existing.count += 1;
        existing.totalDebt += inv.remainingBalance;
      } else {
        map.set(cid, {
          customerId: cid,
          customerName: inv.customerName || 'Cliente',
          count: 1,
          totalDebt: inv.remainingBalance,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => {
      if ((b.count >= 2 ? 1 : 0) !== (a.count >= 2 ? 1 : 0)) {
        return (b.count >= 2 ? 1 : 0) - (a.count >= 2 ? 1 : 0);
      }
      return b.totalDebt - a.totalDebt;
    });
  }, [pendingInvoices]);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [executionMode, setExecutionMode] = useState<'reconcile' | 'report'>('report');
  const [allocationMode, setAllocationMode] = useState<'auto' | 'manual'>('auto');
  const [manualOverrides, setManualOverrides] = useState<Record<string, number>>({});

  const [documentType, setDocumentType] = useState<'nota' | 'factura'>('nota');
  const [accountingBase, setAccountingBase] = useState<'bcv' | 'cash'>('cash');
  const [earlyPaymentMode, setEarlyPaymentMode] = useState<'auto' | 'none' | '7days' | '15days'>('auto');
  const [isDiscountOverridden, setIsDiscountOverridden] = useState(false);
  const [method, setMethod] = useState<string>('Zelle');
  const [paymentDate, setPaymentDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [totalCashInputStr, setTotalCashInputStr] = useState<string>('');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const customerDocRef = useMemoFirebase(
    () => (firestore && isOpen && selectedCustomerId ? doc(firestore, 'customers', selectedCustomerId) : null),
    [firestore, isOpen, selectedCustomerId]
  );
  const { data: customerDoc } = useDoc<Customer>(customerDocRef);

  // Inicialización al abrir el modal
  useEffect(() => {
    if (!isOpen) return;
    setExecutionMode(isManager ? 'reconcile' : 'report');
    setAllocationMode('auto');
    setManualOverrides({});
    setPaymentDate(new Date().toISOString().split('T')[0]);
    setTotalCashInputStr('');
    setReferenceNumber('');
    setNotes('');
    setUploadedImageUrl(null);
    setIsDiscountOverridden(false);

    if (preselectedInvoiceIds && preselectedInvoiceIds.length > 0) {
      const preInvoices = pendingInvoices.filter((i) => preselectedInvoiceIds.includes(i.id));
      const check = validateSameCustomer(preInvoices);
      if (check.ok && check.customerId) {
        setSelectedCustomerId(check.customerId);
        setCheckedIds(preInvoices.map((i) => i.id));
        return;
      }
    }

    if (isClientRole) {
      const ownCid =
        currentUser?.associatedCustomerId ||
        currentUser?.id ||
        pendingInvoices[0]?.customerId ||
        '';
      setSelectedCustomerId(ownCid);
      setCheckedIds(
        pendingInvoices.filter((i) => i.customerId === ownCid).map((i) => i.id)
      );
      return;
    }

    const defaultCid = customerGroups[0]?.customerId || '';
    setSelectedCustomerId(defaultCid);
    setCheckedIds(
      pendingInvoices.filter((i) => i.customerId === defaultCid).map((i) => i.id)
    );
  }, [isOpen, isManager, isClientRole, currentUser?.associatedCustomerId, currentUser?.id]);

  const customerPendingInvoices = useMemo(
    () => pendingInvoices.filter((i) => i.customerId === selectedCustomerId),
    [pendingInvoices, selectedCustomerId]
  );

  const handleCustomerChange = (cid: string) => {
    setSelectedCustomerId(cid);
    const matching = pendingInvoices.filter((i) => i.customerId === cid).map((i) => i.id);
    setCheckedIds(matching);
    setManualOverrides({});
  };

  const toggleInvoiceCheck = (id: string) => {
    setCheckedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleMethodSelect = (mId: string) => {
    setMethod(mId);
    const found = PAYMENT_METHODS.find((m) => m.id === mId);
    setAccountingBase(found?.isCash ? 'cash' : 'bcv');
  };

  const selectedItems = useMemo<MultiInvoiceItemInput[]>(() => {
    return customerPendingInvoices
      .filter((inv) => checkedIds.includes(inv.id))
      .map((inv) => ({
        invoice: inv,
        order: allOrders.find((o) => o.id === inv.id) || null,
      }));
  }, [customerPendingInvoices, checkedIds, allOrders]);

  const totalCashInput = useMemo(() => {
    const parsed = parseFloat(totalCashInputStr);
    return isNaN(parsed) || parsed < 0 ? 0 : parsed;
  }, [totalCashInputStr]);

  const allocation = useMemo(
    () =>
      computeMultiInvoiceAllocation(selectedItems, {
        totalCashInput,
        paymentDate,
        accountingBase,
        documentType,
        earlyPaymentMode,
        isDiscountOverridden: isManager && isDiscountOverridden,
        globalSettings,
        manualCashOverrides: allocationMode === 'manual' ? manualOverrides : null,
      }),
    [
      selectedItems,
      totalCashInput,
      paymentDate,
      accountingBase,
      documentType,
      earlyPaymentMode,
      isManager,
      isDiscountOverridden,
      globalSettings,
      allocationMode,
      manualOverrides,
    ]
  );

  const switchAllocationMode = (nextMode: 'auto' | 'manual') => {
    if (nextMode === 'manual') {
      const seeded: Record<string, number> = {};
      allocation.rows.forEach((r) => {
        seeded[r.orderId] = r.appliedCash;
      });
      setManualOverrides(seeded);
    }
    setAllocationMode(nextMode);
  };

  const selectedCustomerName = useMemo(() => {
    return (
      customerDoc?.razonSocial ||
      customerGroups.find((g) => g.customerId === selectedCustomerId)?.customerName ||
      selectedItems[0]?.invoice.customerName ||
      'Cliente'
    );
  }, [customerDoc?.razonSocial, customerGroups, selectedCustomerId, selectedItems]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firestore || !authUser || !currentUser || isSubmitting) return;

    if (selectedItems.length < 2) {
      toast({
        variant: 'destructive',
        title: 'Selecciona al menos 2 facturas',
        description: 'Para un pago individual usa el botón normal de la factura.',
      });
      return;
    }

    if (!referenceNumber.trim()) {
      toast({
        variant: 'destructive',
        title: 'Referencia Obligatoria',
        description: 'Ingresa el número de referencia o confirmación del pago.',
      });
      return;
    }

    if (!allocation.isValid) {
      toast({
        variant: 'destructive',
        title: 'Monto Inválido',
        description:
          allocation.overAllocatedBy > 0.01
            ? `La suma asignada supera en $${allocation.overAllocatedBy.toFixed(2)} al monto total recibido.`
            : 'Ingresa un monto recibido mayor a cero.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const paymentMeta = {
        paymentDate,
        method,
        referenceNumber: referenceNumber.trim(),
        notes: notes.trim(),
        imageUrl: uploadedImageUrl || '',
        documentType,
        accountingBase,
      };

      if (isManager && executionMode === 'reconcile') {
        const res = await executeMultiInvoiceReconciliation(firestore, {
          authUser,
          currentUser,
          customerId: selectedCustomerId,
          customerName: selectedCustomerName,
          customerRif: customerDoc?.rif || (selectedItems[0]?.order as any)?.customerRif || '',
          customerPhone:
            customerDoc?.phone || (selectedItems[0]?.order as any)?.customerPhone || '',
          customerEmail: customerDoc?.email || (selectedItems[0]?.order as any)?.customerEmail || '',
          allocation,
          paymentMeta,
          globalSettings,
          companyProfile,
          downloadPdf: true,
        });

        toast({
          title: `🎉 ¡${res.itemsSummary.length} Facturas Conciliadas en 1 Lote!`,
          description:
            res.surplusCredited > 0.01
              ? `Recibo PDF descargado y enviado. Excedente de $${res.surplusCredited.toFixed(2)} acreditado a saldo a favor.`
              : `Recibo consolidado PDF descargado y enviado por WhatsApp al cliente.`,
        });
      } else {
        const res = await submitMultiInvoiceReport(firestore, {
          authUser,
          currentUser,
          customerId: selectedCustomerId,
          customerName: selectedCustomerName,
          allocation,
          paymentMeta,
        });

        toast({
          title: `📥 Pago Multi-Factura Reportado (${res.orderIds.length} facturas)`,
          description:
            allocation.surplusToCreditBalance > 0.01
              ? `Enviado a auditoría de caja. Incluye $${allocation.surplusToCreditBalance.toFixed(2)} para saldo a favor al aprobarse.`
              : 'Administración verificará tu comprobante único para liquidar las facturas.',
        });
      }

      setIsOpen(false);
      onSuccess?.();
    } catch (err: any) {
      console.error('[MultiInvoicePaymentDialog] Submit error:', err);
      toast({
        variant: 'destructive',
        title: 'Error al Procesar Pago Multi-Factura',
        description: err?.message || 'No se pudo completar la operación.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-[96vw] sm:max-w-5xl p-0 overflow-hidden rounded-2xl sm:rounded-[2.5rem] border-none shadow-2xl flex flex-col h-[92dvh] max-h-[92dvh]">
        <DialogHeader className="p-5 sm:p-7 bg-slate-900 text-white shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="p-3 rounded-2xl bg-emerald-500/20 text-emerald-400 shrink-0">
                <Layers className="h-6 w-6" />
              </div>
              <div className="text-left min-w-0">
                <DialogTitle className="text-lg sm:text-2xl font-black uppercase tracking-tight leading-none truncate">
                  Conciliación y Pago Multi-Factura
                </DialogTitle>
                <DialogDescription className="text-slate-400 font-medium mt-1 uppercase text-[9px] sm:text-[10px] tracking-widest truncate">
                  Un solo monto y comprobante para 2 o más facturas • Excedente va a saldo a favor
                </DialogDescription>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-white/50 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="bg-white flex-1 flex flex-col min-h-0 overflow-hidden">
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-5 sm:p-7 space-y-6">
              {/* SELECTOR DE CLIENTE + MODO GERENCIA */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <div className={cn('space-y-1.5', isManager ? 'lg:col-span-7' : 'lg:col-span-12')}>
                  <Label className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                    Cliente a Conciliar / Pagar
                  </Label>
                  {isClientRole ? (
                    <div className="h-11 px-4 rounded-xl bg-white border border-slate-200 flex items-center justify-between">
                      <span className="font-black text-xs uppercase text-slate-900 truncate">
                        {selectedCustomerName}
                      </span>
                      {(customerDoc?.creditBalance || 0) > 0 && (
                        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[9px] font-black uppercase">
                          Saldo a favor: ${(customerDoc?.creditBalance || 0).toFixed(2)}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <Select value={selectedCustomerId} onValueChange={handleCustomerChange}>
                      <SelectTrigger className="h-11 rounded-xl bg-white border-slate-200 font-bold text-xs uppercase">
                        <SelectValue placeholder="Selecciona un cliente..." />
                      </SelectTrigger>
                      <SelectContent>
                        {customerGroups.map((g) => (
                          <SelectItem key={g.customerId} value={g.customerId} className="text-xs font-bold uppercase">
                            {g.customerName} ({g.count} fact. • ${g.totalDebt.toFixed(2)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {isManager && (
                  <div className="lg:col-span-5 space-y-1.5">
                    <Label className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                      Acción al Guardar
                    </Label>
                    <div className="grid grid-cols-2 gap-1.5 bg-white p-1 rounded-xl border border-slate-200">
                      <button
                        type="button"
                        onClick={() => setExecutionMode('reconcile')}
                        className={cn(
                          'h-9 rounded-lg text-[9px] font-black uppercase transition-all',
                          executionMode === 'reconcile'
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-800'
                        )}
                      >
                        ⚡ Conciliar Ya
                      </button>
                      <button
                        type="button"
                        onClick={() => setExecutionMode('report')}
                        className={cn(
                          'h-9 rounded-lg text-[9px] font-black uppercase transition-all',
                          executionMode === 'report'
                            ? 'bg-amber-500 text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-800'
                        )}
                      >
                        📥 Enviar a Revisión
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* PASO 1: FACTURAS PENDIENTES DEL CLIENTE */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-primary" />
                    1. Facturas Seleccionadas ({checkedIds.length} de {customerPendingInvoices.length})
                  </h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[9px] font-black uppercase"
                    onClick={() =>
                      setCheckedIds(
                        checkedIds.length === customerPendingInvoices.length
                          ? []
                          : customerPendingInvoices.map((i) => i.id)
                      )
                    }
                  >
                    {checkedIds.length === customerPendingInvoices.length
                      ? 'Deseleccionar Todas'
                      : 'Seleccionar Todas'}
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {customerPendingInvoices.map((inv) => {
                    const isChecked = checkedIds.includes(inv.id);
                    return (
                      <div
                        key={inv.id}
                        onClick={() => toggleInvoiceCheck(inv.id)}
                        className={cn(
                          'p-3.5 rounded-2xl border-2 cursor-pointer transition-all flex items-start gap-3',
                          isChecked
                            ? 'border-emerald-500 bg-emerald-50/40 shadow-sm'
                            : 'border-slate-100 hover:border-slate-200 bg-white'
                        )}
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => toggleInvoiceCheck(inv.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs font-black text-primary">
                              #{inv.id.substring(0, 8)}
                            </span>
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[8px] font-black uppercase px-1.5 py-0',
                                inv.status === 'Vencido'
                                  ? 'border-rose-300 text-rose-600 bg-rose-50'
                                  : 'border-blue-200 text-blue-600 bg-blue-50'
                              )}
                            >
                              {inv.status}
                            </Badge>
                          </div>
                          <p className="text-sm font-black text-slate-900 mt-1">
                            ${inv.remainingBalance.toFixed(2)} USD
                          </p>
                          <p className="text-[9px] font-bold text-slate-400 uppercase truncate">
                            {inv.statusText}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* PASO 2: DATOS ÚNICOS DEL PAGO */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7 space-y-5">
                  <div className="flex items-center gap-2">
                    <Coins className="h-4 w-4 text-primary" />
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                      2. Datos del Pago Único
                    </h3>
                  </div>

                  {/* Régimen & Base */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setDocumentType('nota')}
                      className={cn(
                        'p-3 rounded-xl border-2 text-center transition-all',
                        documentType === 'nota'
                          ? 'border-primary bg-primary/5'
                          : 'border-slate-100 hover:bg-slate-50'
                      )}
                    >
                      <FileText className="h-4 w-4 mx-auto mb-1 text-primary" />
                      <span className="block text-[9px] font-black uppercase">Nota Entrega</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDocumentType('factura')}
                      className={cn(
                        'p-3 rounded-xl border-2 text-center transition-all',
                        documentType === 'factura'
                          ? 'border-primary bg-primary/5'
                          : 'border-slate-100 hover:bg-slate-50'
                      )}
                    >
                      <Receipt className="h-4 w-4 mx-auto mb-1 text-primary" />
                      <span className="block text-[9px] font-black uppercase">Factura +16%</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAccountingBase('cash')}
                      className={cn(
                        'p-3 rounded-xl border-2 text-center transition-all',
                        accountingBase === 'cash'
                          ? 'border-emerald-500 bg-emerald-50'
                          : 'border-slate-100 hover:bg-slate-50'
                      )}
                    >
                      <Sparkles className="h-4 w-4 mx-auto mb-1 text-emerald-600" />
                      <span className="block text-[9px] font-black uppercase">Base Divisas</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAccountingBase('bcv')}
                      className={cn(
                        'p-3 rounded-xl border-2 text-center transition-all',
                        accountingBase === 'bcv'
                          ? 'border-primary bg-primary/5'
                          : 'border-slate-100 hover:bg-slate-50'
                      )}
                    >
                      <FileCheck className="h-4 w-4 mx-auto mb-1 text-slate-600" />
                      <span className="block text-[9px] font-black uppercase">Base BCV</span>
                    </button>
                  </div>

                  {/* Métodos */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {PAYMENT_METHODS.map((m) => {
                      const Icon = m.icon;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => handleMethodSelect(m.id)}
                          className={cn(
                            'p-3 rounded-xl border-2 flex items-center gap-2.5 text-left transition-all',
                            method === m.id
                              ? 'border-primary bg-primary/5 shadow-sm'
                              : 'border-slate-100 hover:bg-slate-50'
                          )}
                        >
                          <Icon
                            className={cn(
                              'h-4 w-4 shrink-0',
                              method === m.id ? 'text-primary' : 'text-slate-400'
                            )}
                          />
                          <div className="min-w-0">
                            <span className="block text-[10px] font-black uppercase truncate">
                              {m.label}
                            </span>
                            <span className="block text-[8px] font-bold text-slate-400 uppercase truncate">
                              {m.sub}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Monto, Referencia, Fecha, Pronto Pago */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-[9px] font-black uppercase text-slate-500">
                          Monto Único Recibido ($ USD)
                        </Label>
                        {allocation.totalNetToSettle > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setTotalCashInputStr(allocation.totalNetToSettle.toFixed(2))
                            }
                            className="text-[9px] font-black uppercase text-emerald-600 hover:underline"
                          >
                            Exacto: ${allocation.totalNetToSettle.toFixed(2)}
                          </button>
                        )}
                      </div>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={totalCashInputStr}
                        onChange={(e) => setTotalCashInputStr(e.target.value)}
                        className="h-12 font-black text-xl rounded-xl bg-slate-50 border-slate-200"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[9px] font-black uppercase text-slate-500">
                        N° Referencia Bancaria / Confirmación *
                      </Label>
                      <Input
                        placeholder="Ej: 492018 o WFCT..."
                        value={referenceNumber}
                        onChange={(e) => setReferenceNumber(e.target.value)}
                        className="h-12 font-mono font-bold rounded-xl bg-slate-50 border-slate-200"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[9px] font-black uppercase text-slate-500">
                        Fecha del Pago
                      </Label>
                      <Input
                        type="date"
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        className="h-11 font-bold rounded-xl bg-slate-50 border-slate-200"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[9px] font-black uppercase text-slate-500">
                        Pronto Pago
                      </Label>
                      <Select
                        value={earlyPaymentMode}
                        onValueChange={(v) => setEarlyPaymentMode(v as any)}
                      >
                        <SelectTrigger className="h-11 rounded-xl bg-slate-50 border-slate-200 font-bold text-xs uppercase">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto" className="text-xs font-bold uppercase">
                            Automático por antigüedad
                          </SelectItem>
                          <SelectItem value="7days" className="text-xs font-bold uppercase">
                            Pronto Pago 7 Días (-{globalSettings.earlyPayment7Days || 10}%)
                          </SelectItem>
                          <SelectItem value="15days" className="text-xs font-bold uppercase">
                            Pronto Pago 15 Días (-{globalSettings.earlyPayment15Days || 5}%)
                          </SelectItem>
                          <SelectItem value="none" className="text-xs font-bold uppercase">
                            Sin Pronto Pago (0%)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {isManager && (
                    <label className="flex items-center gap-2 text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-3.5 py-2.5 rounded-xl cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isDiscountOverridden}
                        onChange={(e) => setIsDiscountOverridden(e.target.checked)}
                      />
                      Excepción Gerencial: forzar pronto pago aunque alguna factura exceda los días límite
                    </label>
                  )}

                  <div className="space-y-1.5">
                    <Label className="text-[9px] font-black uppercase text-slate-500">
                      Observaciones (Opcional)
                    </Label>
                    <Input
                      placeholder="Nota interna o detalle del abono consolidado..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="h-10 rounded-xl bg-slate-50 border-slate-200 text-xs"
                    />
                  </div>
                </div>

                {/* COMPROBANTE */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                      3. Comprobante Único
                    </h3>
                  </div>
                  <ImageUploader
                    folderPath="payment-receipts"
                    onImageUploaded={setUploadedImageUrl}
                    label="Captura del Comprobante Bancario"
                  />

                  <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-2.5">
                    <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                      <span>Deuda Lista Seleccionada:</span>
                      <span className="text-white">${allocation.totalPreviousDebt.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-[10px] font-bold text-emerald-400 uppercase">
                      <span>Neto para Liquidar Todo:</span>
                      <span>${allocation.totalNetToSettle.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase border-t border-white/10 pt-2">
                      <span>Descuentos Aplicados:</span>
                      <span className="text-amber-300">-${allocation.totalDiscountGranted.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-xs font-black uppercase pt-1">
                      <span>Aplicado a Facturas:</span>
                      <span className="text-emerald-400">${allocation.totalAppliedCash.toFixed(2)} USD</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* PASO 3: TABLA DE DISTRIBUCIÓN FIFO / MANUAL */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-primary" />
                    4. Distribución Automática / Manual por Factura
                  </h3>
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                    <button
                      type="button"
                      onClick={() => switchAllocationMode('auto')}
                      className={cn(
                        'px-3 py-1 rounded-lg text-[9px] font-black uppercase transition-all',
                        allocationMode === 'auto'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-500'
                      )}
                    >
                      Automático (Más antigua)
                    </button>
                    <button
                      type="button"
                      onClick={() => switchAllocationMode('manual')}
                      className={cn(
                        'px-3 py-1 rounded-lg text-[9px] font-black uppercase transition-all',
                        allocationMode === 'manual'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-500'
                      )}
                    >
                      Manual por factura
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-900 text-white text-[9px] uppercase">
                      <tr>
                        <th className="py-3 px-4 text-left font-black">Factura</th>
                        <th className="py-3 px-3 text-right font-black">Saldo Lista</th>
                        <th className="py-3 px-3 text-right font-black">Desc. / Ahorro</th>
                        <th className="py-3 px-3 text-right font-black">Neto Exigible</th>
                        <th className="py-3 px-3 text-right font-black">Monto Aplicado</th>
                        <th className="py-3 px-3 text-right font-black">Saldo Final</th>
                        <th className="py-3 px-4 text-center font-black">Resultado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {allocation.rows.map((row) => (
                        <tr key={row.orderId} className="hover:bg-slate-50/80">
                          <td className="py-3 px-4 font-mono font-black text-primary">
                            #{row.orderId.substring(0, 8)}
                            <span className="block text-[9px] font-sans font-bold text-slate-400">
                              {row.elapsedDays}d transcurridos
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-bold text-slate-700">
                            ${row.remainingBalanceBefore.toFixed(2)}
                          </td>
                          <td className="py-3 px-3 text-right font-bold text-emerald-600">
                            {row.discountAmount > 0 ? `-$${row.discountAmount.toFixed(2)}` : '$0.00'}
                          </td>
                          <td className="py-3 px-3 text-right font-black text-slate-900">
                            ${row.netCashToSettle.toFixed(2)}
                          </td>
                          <td className="py-3 px-3 text-right">
                            {allocationMode === 'manual' ? (
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                max={row.netCashToSettle}
                                value={manualOverrides[row.orderId] ?? row.appliedCash}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value);
                                  setManualOverrides((prev) => ({
                                    ...prev,
                                    [row.orderId]: isNaN(v) ? 0 : v,
                                  }));
                                }}
                                className="h-8 w-24 ml-auto text-right font-black text-xs"
                              />
                            ) : (
                              <span className="font-black text-emerald-700">
                                ${row.appliedCash.toFixed(2)}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-bold text-slate-700">
                            ${row.remainingAfterPayment.toFixed(2)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {row.willFullySettle ? (
                              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[9px] font-black uppercase">
                                ✅ Liquidada
                              </Badge>
                            ) : row.appliedCash > 0 ? (
                              <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[9px] font-black uppercase">
                                ⏳ Parcial
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[9px] font-bold text-slate-400 uppercase">
                                Sin cubrir
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {allocation.surplusToCreditBalance > 0.01 && (
                  <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center gap-3">
                    <Wallet className="h-5 w-5 text-emerald-600 shrink-0" />
                    <div className="text-xs text-emerald-900">
                      <span className="font-black uppercase block">
                        💰 Excedente a Saldo a Favor: ${allocation.surplusToCreditBalance.toFixed(2)} USD
                      </span>
                      <span className="text-[11px] font-medium">
                        {isManager && executionMode === 'reconcile'
                          ? 'Se acreditará automáticamente en la billetera del cliente (creditBalance) para futuros pedidos.'
                          : 'Al aprobarse el pago en caja, este excedente quedará acreditado como saldo a favor del cliente.'}
                      </span>
                    </div>
                  </div>
                )}

                {allocation.overAllocatedBy > 0.01 && (
                  <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-center gap-3 text-rose-800 text-xs font-bold">
                    <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
                    La distribución manual supera por ${allocation.overAllocatedBy.toFixed(2)} USD el monto ingresado. Ajusta los montos o aumenta el monto recibido.
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="p-5 sm:p-6 bg-slate-50 border-t flex flex-col sm:flex-row gap-3 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={isSubmitting}
              className="h-12 rounded-2xl font-black uppercase text-[10px]"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || selectedItems.length < 2 || !allocation.isValid}
              className={cn(
                'h-12 flex-1 rounded-2xl font-black uppercase text-[10px] tracking-[0.15em] shadow-xl',
                isManager && executionMode === 'reconcile'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-slate-900 hover:bg-slate-800 text-white'
              )}
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              {isManager && executionMode === 'reconcile'
                ? `CONCILIAR ${allocation.rows.filter((r) => r.appliedCash > 0).length} FACTURAS ($${allocation.totalCashInput.toFixed(2)})`
                : `REPORTAR PAGO PARA ${allocation.rows.filter((r) => r.appliedCash > 0).length} FACTURAS ($${allocation.totalCashInput.toFixed(2)})`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
