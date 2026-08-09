'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { useDoc, useFirestore, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { doc, setDoc, serverTimestamp, writeBatch, collection, getDocs, getDoc, query, where, limit, orderBy } from 'firebase/firestore';
import { 
    Loader2, 
    RefreshCw, 
    ShieldCheck, 
    Boxes, 
    TrendingUp, 
    Wallet, 
    Landmark, 
    Activity, 
    PieChart,
    Settings2,
    Zap,
    Sparkles,
    Clock,
    AlertTriangle,
    Send,
    MessageSquare,
    Users,
    ShieldAlert,
    ChevronRight,
    ArrowUpRight,
    Calculator,
    Percent,
    Building2,
    DollarSign,
    Save
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import type { FinancialSettings, Product, PricingStrategy, Order, PriceBackupItem } from '@/lib/definitions';
import { Input } from '@/components/ui/input';
import { fetchLatestBcvRate } from '@/lib/bcv-fetcher';
import { logActivity } from '@/lib/audit';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { calculatePricingTier, applyRounding, type RoundingStrategy } from '@/lib/pricing';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

const financialSchema = z.object({
  bcvRate: z.coerce.number().min(1, 'La tasa debe ser mayor o igual a 1'),
  ivaPercent: z.coerce.number().min(0).max(100),
  defaultBcvDiscount: z.coerce.number().min(0).max(100),
  defaultCommission: z.coerce.number().min(0).max(100),
  salesManagerCommission: z.coerce.number().min(0).max(100),
  adminCommission: z.coerce.number().min(0).max(100),
  defaultOverhead: z.coerce.number().min(0).max(100),
  earlyPayment7Days: z.coerce.number().min(0).max(100),
  earlyPayment15Days: z.coerce.number().min(0).max(100),
  roundingTolerance: z.coerce.number().min(0).max(5),
  overdueBlockDays: z.coerce.number().min(1).default(35),
  historicalDilutionFactor: z.coerce.number().min(0).max(1).default(0.65),
});

type FinancialFormValues = z.infer<typeof financialSchema>;

function MetricCard({ title, value, subValue, icon: Icon, colorClass }: any) {
    return (
        <Card className="border-none shadow-sm rounded-[1.5rem] bg-white overflow-hidden group">
            <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                    <p className="text-[9px] font-black uppercase text-slate-400 tracking-[0.2em]">{title}</p>
                    <div className={cn("p-2.5 rounded-xl transition-transform group-hover:rotate-12", colorClass)}>
                        <Icon className="h-4.5 w-4.5" />
                    </div>
                </div>
                <h3 className="text-2xl sm:text-3xl font-black tracking-tighter text-slate-900 leading-none">{value}</h3>
                <p className="text-[9px] font-bold text-muted-foreground uppercase mt-2 tracking-widest">{subValue}</p>
            </CardContent>
        </Card>
    );
}

export default function TreasuryPage() {
  const firestore = useFirestore();
  const { toast } = useToast();
  const { profile: currentUser, isUserLoading } = useUser();
  const [isSyncing, setIsSyncing] = useState(false);
  const [isMassUpdating, setIsMassUpdating] = useState(false);
  const [syncType, setSyncType] = useState<'bcv' | 'wac'>('bcv');
  
  const [brandFilter, setBrandFilter] = useState('todos');
  const [categoryFilter, setCategoryFilter] = useState('todos');
  const [modelFilter, setModelFilter] = useState('');
  const [adjustmentPercent, setAdjustmentPercent] = useState(0);
  const [roundingStrategy, setRoundingStrategy] = useState<RoundingStrategy>('none');
  
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [progressVal, setProgressVal] = useState(0);
  const [totalToProcess, setTotalToProcess] = useState(0);
  const [isRollbacking, setIsRollbacking] = useState(false);

  const canManage = !isUserLoading && currentUser && ['superadmin', 'admin', 'gerencia'].includes(currentUser.role);

  const settingsRef = useMemoFirebase(() => firestore && canManage ? doc(firestore, 'system', 'financials') : null, [firestore, canManage]);
  const { data: settings, error: settingsError } = useDoc<FinancialSettings>(settingsRef);

  const productsQuery = useMemoFirebase(() => firestore && canManage ? query(collection(firestore, 'products'), limit(300)) : null, [firestore, canManage]);
  const { data: products, error: productsError } = useCollection<Product>(productsQuery);

  const ordersQuery = useMemoFirebase(() => firestore && canManage ? query(collection(firestore, 'orders'), limit(300)) : null, [firestore, canManage]);
  const { data: allOrders } = useCollection<Order>(ordersQuery);

  const { control, handleSubmit, reset, setValue, watch, formState: { isSubmitting } } = useForm<FinancialFormValues>({
    resolver: zodResolver(financialSchema),
    defaultValues: {
      bcvRate: 65.50,
      ivaPercent: 16,
      defaultBcvDiscount: 25,
      defaultCommission: 5,
      salesManagerCommission: 5,
      adminCommission: 5,
      defaultOverhead: 10,
      earlyPayment7Days: 10,
      earlyPayment15Days: 5,
      roundingTolerance: 0.05,
      overdueBlockDays: 35,
      historicalDilutionFactor: 0.65,
    }
  });

  const formValues = watch();

  // SIMULADOR EN VIVO DE FÓRMULA DE PRECIOS CON PARÁMETROS ACTIVOS
  const liveFormulaSimulation = useMemo(() => {
    const costSample = 10; // Ejemplo base $10 USD
    const targetMargin = 60; // Margen base 60%
    const commVendor = Number(formValues.defaultCommission || 5) / 100;
    const commManager = Number(formValues.salesManagerCommission || 5) / 100;
    const commAdmin = Number(formValues.adminCommission || 5) / 100;
    const totalComm = commVendor + commManager + commAdmin;
    const overhead = Number(formValues.defaultOverhead || 10) / 100;
    const discount = Number(formValues.defaultBcvDiscount || 25) / 100;

    const divisor = 1 - totalComm - (targetMargin / 100);
    const costWithOverhead = costSample * (1 + overhead);
    const priceCashUSD = divisor > 0.05 ? costWithOverhead / divisor : costSample * 3;
    const priceListBCV = priceCashUSD / (1 - discount);
    const netProfitUSD = priceCashUSD - (priceCashUSD * totalComm) - costSample - (costSample * overhead);

    return {
      costSample,
      totalCommPercent: (totalComm * 100).toFixed(1),
      overheadPercent: (overhead * 100).toFixed(1),
      discountPercent: (discount * 100).toFixed(1),
      priceCashUSD: priceCashUSD.toFixed(2),
      priceListBCV: priceListBCV.toFixed(2),
      netProfitUSD: netProfitUSD.toFixed(2)
    };
  }, [formValues]);

  const uniqueBrands = useMemo(() => {
    if (!products) return [];
    return Array.from(new Set(products.map(p => p.brand))).filter(Boolean).sort() as string[];
  }, [products]);

  const uniqueCategories = useMemo(() => {
    if (!products) return [];
    return Array.from(new Set(products.map(p => p.category))).filter(Boolean).sort() as string[];
  }, [products]);

  const metrics = useMemo(() => {
    if (!products || !allOrders) return null;

    let totalBilling = 0;
    let totalCashVerified = 0;

    allOrders.forEach(o => {
        if (o.status !== 'Cancelado') {
            totalBilling += o.totalAmount || 0;
            totalCashVerified += o.totalCashReceived ?? o.amountPaid ?? 0;
        }
    });

    const liquidityGap = Math.max(0, totalBilling - totalCashVerified);
    const efficiency = totalBilling > 0 ? (totalCashVerified / totalBilling) * 100 : 100;

    let replacementCostTotal = 0;
    products.forEach(p => {
        const stock = p.stockLevel ?? 0;
        const c = p.cost || (p.priceCashUSD ? p.priceCashUSD * 0.4 : 0);
        replacementCostTotal += stock * c;
    });

    return { totalBilling, totalCashVerified, liquidityGap, efficiency, replacementCostTotal };
  }, [products, allOrders]);

  const agingSchedule = useMemo(() => {
    if (!allOrders) return null;

    let current = 0;
    let days8_15 = 0;
    let days16_30 = 0;
    let overdue30 = 0;

    const customerDebtsMap = new Map<string, {
      customerId: string;
      customerName: string;
      phone?: string;
      totalDebt: number;
      oldestOrderDays: number;
      oldestOrderId: string;
    }>();

    const now = Date.now();

    allOrders.forEach(order => {
      if (order.status === 'Cancelado') return;
      const balance = (order.totalAmount || 0) - (order.amountPaid || 0);
      if (balance <= 0.05) return;

      const orderTime = order.orderDate?.seconds 
        ? order.orderDate.seconds * 1000 
        : (order.createdAt?.seconds ? order.createdAt.seconds * 1000 : now);
      
      const daysOld = Math.floor((now - orderTime) / (1000 * 60 * 60 * 24));

      if (daysOld <= 7) current += balance;
      else if (daysOld <= 15) days8_15 += balance;
      else if (daysOld <= 30) days16_30 += balance;
      else overdue30 += balance;

      const existing = customerDebtsMap.get(order.customerId) || {
        customerId: order.customerId,
        customerName: order.customerName,
        phone: order.customerPhone,
        totalDebt: 0,
        oldestOrderDays: 0,
        oldestOrderId: order.id
      };

      existing.totalDebt += balance;
      if (daysOld > existing.oldestOrderDays) {
        existing.oldestOrderDays = daysOld;
        existing.oldestOrderId = order.id;
      }
      customerDebtsMap.set(order.customerId, existing);
    });

    const overdueCustomers = Array.from(customerDebtsMap.values())
      .sort((a, b) => b.totalDebt - a.totalDebt);

    return {
      buckets: { current, days8_15, days16_30, overdue30 },
      overdueCustomers
    };
  }, [allOrders]);

  const handleSendWhatsAppDebtReminder = (client: { customerName: string; phone?: string; totalDebt: number; oldestOrderDays: number; oldestOrderId: string }) => {
    const rawPhone = (client.phone || '').replace(/\D/g, '');
    const cleanPhone = rawPhone.length === 10 ? `58${rawPhone}` : rawPhone;
    
    const text = `*ATHLETICENTER C.A. - AVISO DE DEUDAS Y ESTADO DE CUENTA*\n\n` +
      `Estimado(a) *${client.customerName}*,\n\n` +
      `Le saludamos del Departamento de Tesorería. Le recordamos que su cuenta presenta un saldo pendiente por conciliar de:\n\n` +
      `💰 *Monto Pendiente:* $${client.totalDebt.toFixed(2)} USD\n` +
      `⏱️ *Antigüedad Máxima:* ${client.oldestOrderDays} días (Factura #${client.oldestOrderId.substring(0, 7).toUpperCase()})\n\n` +
      `Agradecemos su valioso apoyo realizando su reporte de pago a la brevedad para mantener habilitado su cupo de crédito.\n\n` +
      `Quedamos atentos a sus comprobantes. ¡Muchas gracias!`;

    const url = cleanPhone 
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}` 
      : `https://wa.me/?text=${encodeURIComponent(text)}`;

    window.open(url, '_blank');
  };

  useEffect(() => {
    if (settings) {
        reset({
            bcvRate: settings.bcvRate || 65.50,
            ivaPercent: settings.ivaPercent || 16,
            defaultBcvDiscount: settings.defaultBcvDiscount !== undefined ? settings.defaultBcvDiscount : 25,
            defaultCommission: settings.defaultCommission || 5,
            salesManagerCommission: settings.salesManagerCommission || 5,
            adminCommission: settings.adminCommission || 5,
            defaultOverhead: settings.defaultOverhead || 10,
            earlyPayment7Days: settings.earlyPayment7Days || 10,
            earlyPayment15Days: settings.earlyPayment15Days || 5,
            roundingTolerance: settings.roundingTolerance || 0.05,
            overdueBlockDays: settings.overdueBlockDays || 35,
            historicalDilutionFactor: settings.historicalDilutionFactor || 0.65
        });
    }
  }, [settings, reset]);

  const handleSyncBcv = async () => {
    setIsSyncing(true);
    try {
        const rate = await fetchLatestBcvRate();
        if (rate && firestore) {
          setValue('bcvRate', rate);
          await setDoc(doc(firestore, 'system', 'financials'), { 
            bcvRate: rate, 
            lastAutoSync: serverTimestamp(),
            updatedAt: serverTimestamp() 
          }, { merge: true });
          toast({ title: "Tasa BCV Sincronizada", description: `Nueva tasa en vivo guardada: ${rate} Bs.` });
        }
    } catch (e: any) {
        toast({ variant: "destructive", title: "Fallo de Red", description: "No se pudo conectar con los proveedores de tasa." });
    } finally {
        setIsSyncing(false);
    }
  };

  const onSubmit = async (data: FinancialFormValues) => {
    if (!firestore || !currentUser) return;
    try {
      await setDoc(doc(firestore, 'system', 'financials'), { 
          ...data, 
          updatedAt: serverTimestamp(), 
          updatedBy: currentUser.id 
      }, { merge: true });
      toast({ title: "Política Monetaria Sincronizada", description: "Parámetros y comisiones guardados en Firestore." });
    } catch (e) {
      toast({ variant: "destructive", title: "Fallo de Sincronización" });
    }
  };

  if (isUserLoading || !currentUser) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;

  return (
    <div className="w-full max-w-[1600px] mx-auto flex flex-col gap-8 pb-32 px-4 sm:px-6 animate-in fade-in-50 duration-500">
      <header className="space-y-1">
        <h1 className="terminal-header">Tesorería Central</h1>
        <p className="tech-label opacity-60">POLÍTICA MONETARIA, COMISIONES Y PROTECCIÓN DE CAPITAL OPERATIVO.</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <MetricCard title="Liquidez Real" value={`$${metrics?.totalCashVerified?.toLocaleString() || '0'}`} subValue="Efectivo en Banco (CASH)" icon={TrendingUp} colorClass="bg-emerald-50 text-emerald-500" />
          <MetricCard title="Capital en Calle" value={`$${metrics?.liquidityGap?.toLocaleString() || '0'}`} subValue="Cuentas por Cobrar" icon={Wallet} colorClass="bg-blue-50 text-blue-500" />
          <MetricCard title="Valor Activo" value={`$${metrics?.replacementCostTotal?.toLocaleString() || '0'}`} subValue="Costo Reposición WAC" icon={Boxes} colorClass="bg-slate-900 text-white" />
          <MetricCard title="Tasa BCV" value={`${formValues.bcvRate || settings?.bcvRate || '65.50'} Bs`} subValue="Parámetro de Red" icon={Landmark} colorClass="bg-primary/5 text-primary" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* COLUMNA IZQUIERDA: FORMULARIO MAESTRO DE PARÁMETROS Y COMISIONES */}
        <div className="lg:col-span-7 space-y-8">
            <Card className="terminal-card bg-white text-slate-900 border border-slate-100 shadow-xl overflow-hidden rounded-[2.5rem]">
                <CardHeader className="p-8 border-b border-slate-100 bg-slate-50/50 flex flex-row items-center justify-between">
                    <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-3">
                        <Landmark className="h-5 w-5" /> Centro de Parámetros y Comisiones Corporativas
                    </CardTitle>
                    <Button type="button" size="sm" onClick={handleSyncBcv} disabled={isSyncing} className="h-9 px-4 rounded-xl bg-primary text-white font-black text-[9px] uppercase tracking-wider shadow-lg">
                        {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />} ⚡ AUTO-SYNC BCV
                    </Button>
                </CardHeader>
                <form onSubmit={handleSubmit(onSubmit)}>
                    <CardContent className="p-8 space-y-10">
                        {/* 1. SECCIÓN MONEDA Y DESCUENTO BASE */}
                        <div className="space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2">
                                <DollarSign className="h-4 w-4" /> 1. Divisas y Descuento Base de Red
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col justify-center text-center shadow-inner">
                                    <Label className="text-[9px] font-black uppercase text-slate-400 mb-2">Tasa Oficial BCV (Bs/$)</Label>
                                    <Controller name="bcvRate" control={control} render={({ field }) => (
                                        <Input type="number" step="0.01" {...field} value={isNaN(field.value) ? "" : field.value} className="text-2xl font-black bg-white border border-slate-200 text-center h-12 rounded-xl text-slate-900 shadow-sm" />
                                    )} />
                                </div>
                                <div className="p-5 bg-emerald-50 rounded-2xl border border-emerald-100 flex flex-col justify-center text-center shadow-inner">
                                    <Label className="text-[9px] font-black uppercase text-emerald-600 mb-2">Desc. Base Contado / CASH (%)</Label>
                                    <Controller name="defaultBcvDiscount" control={control} render={({ field }) => (
                                        <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="text-2xl font-black bg-white border border-emerald-200 text-center h-12 rounded-xl text-emerald-600 shadow-sm" />
                                    )} />
                                </div>
                                <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col justify-center text-center shadow-inner">
                                    <Label className="text-[9px] font-black uppercase text-slate-400 mb-2">Base Impuesto IVA (%)</Label>
                                    <Controller name="ivaPercent" control={control} render={({ field }) => (
                                        <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="text-2xl font-black bg-white border border-slate-200 text-center h-12 rounded-xl text-slate-900 shadow-sm" />
                                    )} />
                                </div>
                            </div>
                        </div>

                        {/* 2. SECCIÓN COMISIONES Y OVERHEAD */}
                        <div className="space-y-4 pt-4 border-t border-slate-100">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2">
                                <Users className="h-4 w-4" /> 2. Matriz de Comisiones de Red y Gastos Operativos (Overhead)
                            </h3>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                <div className="space-y-1.5 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                    <Label className="text-[8px] font-black uppercase text-slate-500">Asesor Comercial (%)</Label>
                                    <Controller name="defaultCommission" control={control} render={({ field }) => (
                                        <Input type="number" step="0.5" {...field} value={isNaN(field.value) ? "" : field.value} className="h-11 font-black bg-white text-center rounded-xl text-slate-900" />
                                    )} />
                                </div>
                                <div className="space-y-1.5 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                    <Label className="text-[8px] font-black uppercase text-slate-500">Gerente Ventas (%)</Label>
                                    <Controller name="salesManagerCommission" control={control} render={({ field }) => (
                                        <Input type="number" step="0.5" {...field} value={isNaN(field.value) ? "" : field.value} className="h-11 font-black bg-white text-center rounded-xl text-slate-900" />
                                    )} />
                                </div>
                                <div className="space-y-1.5 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                    <Label className="text-[8px] font-black uppercase text-slate-500">Administración (%)</Label>
                                    <Controller name="adminCommission" control={control} render={({ field }) => (
                                        <Input type="number" step="0.5" {...field} value={isNaN(field.value) ? "" : field.value} className="h-11 font-black bg-white text-center rounded-xl text-slate-900" />
                                    )} />
                                </div>
                                <div className="space-y-1.5 p-4 bg-slate-900 text-white rounded-2xl border border-slate-800">
                                    <Label className="text-[8px] font-black uppercase text-primary">Overhead Admin (%)</Label>
                                    <Controller name="defaultOverhead" control={control} render={({ field }) => (
                                        <Input type="number" step="0.5" {...field} value={isNaN(field.value) ? "" : field.value} className="h-11 font-black bg-white/10 border-white/20 text-center rounded-xl text-white" />
                                    )} />
                                </div>
                            </div>
                        </div>

                        {/* 3. SECCIÓN PRONTO PAGO Y MORA */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
                            <div className="space-y-3">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2"><Zap className="h-4 w-4" /> Pronto Pago</h3>
                                <div className="grid grid-cols-2 gap-4 p-5 bg-slate-50 rounded-2xl border border-slate-100">
                                    <div className="space-y-1"><Label className="text-[8px] font-black uppercase text-slate-500">Pronto 7 Días (%)</Label><Controller name="earlyPayment7Days" control={control} render={({ field }) => <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="h-11 font-black bg-white text-center rounded-xl text-slate-900" />} /></div>
                                    <div className="space-y-1"><Label className="text-[8px] font-black uppercase text-slate-500">Pronto 15 Días (%)</Label><Controller name="earlyPayment15Days" control={control} render={({ field }) => <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="h-11 font-black bg-white text-center rounded-xl text-slate-900" />} /></div>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> Tolerancia de Crédito</h3>
                                <div className="grid grid-cols-2 gap-4 p-5 bg-slate-50 rounded-2xl border border-slate-100">
                                    <div className="space-y-1"><Label className="text-[8px] font-black uppercase text-slate-500">Bloqueo Mora (Días)</Label><Controller name="overdueBlockDays" control={control} render={({ field }) => <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="h-11 font-black bg-white text-center rounded-xl text-slate-900" />} /></div>
                                    <div className="space-y-1"><Label className="text-[8px] font-black uppercase text-slate-500">Dilución Factor</Label><Controller name="historicalDilutionFactor" control={control} render={({ field }) => <Input type="number" step="0.01" {...field} value={isNaN(field.value) ? "" : field.value} className="h-11 font-black bg-white text-center rounded-xl text-slate-900" />} /></div>
                                </div>
                            </div>
                        </div>

                        {/* TARJETA DE SIMULACIÓN EN VIVO DE LA FÓRMULA */}
                        <div className="p-6 rounded-[2rem] bg-slate-900 text-white space-y-4 shadow-xl border border-white/10">
                            <div className="flex items-center justify-between border-b border-white/10 pb-3">
                                <span className="text-[10px] font-black uppercase text-primary tracking-[0.3em] flex items-center gap-2">
                                    <Calculator className="h-4 w-4" /> Simulador de Impacto en Fórmula de Precios (Muestra)
                                </span>
                                <Badge className="bg-emerald-500/20 text-emerald-400 font-black text-[8px] uppercase border-none">EJEMPLO BASE $10</Badge>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                                <div className="p-3 bg-white/5 rounded-xl"><span className="text-[8px] text-slate-400 font-black uppercase block">Comisiones Red</span><span className="text-lg font-black text-primary">{liveFormulaSimulation.totalCommPercent}%</span></div>
                                <div className="p-3 bg-white/5 rounded-xl"><span className="text-[8px] text-slate-400 font-black uppercase block">Gastos Admin OH</span><span className="text-lg font-black text-white">{liveFormulaSimulation.overheadPercent}%</span></div>
                                <div className="p-3 bg-white/5 rounded-xl"><span className="text-[8px] text-slate-400 font-black uppercase block">Sugerido CASH</span><span className="text-lg font-black text-emerald-400">${liveFormulaSimulation.priceCashUSD}</span></div>
                                <div className="p-3 bg-white/5 rounded-xl"><span className="text-[8px] text-slate-400 font-black uppercase block">Precio Lista BCV</span><span className="text-lg font-black text-white">${liveFormulaSimulation.priceListBCV}</span></div>
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter className="p-8 border-t bg-slate-50/50 flex justify-end">
                        <Button type="submit" disabled={isSubmitting} className="font-black uppercase h-14 px-12 rounded-2xl bg-primary hover:bg-primary/90 text-white shadow-2xl text-xs tracking-[0.2em]">
                            {isSubmitting ? <Loader2 className="animate-spin h-5 w-5 mr-2" /> : <Save className="h-5 w-5 mr-2" />} GUARDAR Y APLICAR POLÍTICA MONETARIA
                        </Button>
                    </CardFooter>
                </form>
            </Card>
        </div>

        {/* COLUMNA DERECHA: RECALCULADOR MASIVO Y DEUDAS */}
        <div className="lg:col-span-5 space-y-8">
            {/* AGING SCHEDULE & DEUDORES */}
            {agingSchedule && agingSchedule.overdueCustomers.length > 0 && (
                <Card className="terminal-card bg-white text-slate-900 border border-slate-100 shadow-xl overflow-hidden rounded-[2.5rem]">
                    <CardHeader className="p-8 border-b border-slate-100 bg-slate-50/50 flex flex-row items-center justify-between">
                        <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-rose-600 flex items-center gap-3">
                            <ShieldAlert className="h-5 w-5" /> Cobranzas en Mora (Más de 30 Días)
                        </CardTitle>
                        <Badge className="bg-rose-100 text-rose-700 font-black text-[9px] uppercase border-none">{agingSchedule.overdueCustomers.length} Clientes</Badge>
                    </CardHeader>
                    <CardContent className="p-6 space-y-4 max-h-[300px] overflow-y-auto">
                        {agingSchedule.overdueCustomers.map(client => (
                            <div key={client.customerId} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-4">
                                <div className="space-y-0.5">
                                    <p className="text-xs font-black text-slate-900 uppercase truncate max-w-[180px]">{client.customerName}</p>
                                    <p className="text-[9px] font-bold text-rose-600 uppercase tracking-widest">{client.oldestOrderDays} días en mora</p>
                                </div>
                                <div className="text-right flex flex-col items-end gap-1.5">
                                    <span className="text-base font-black text-slate-900">${client.totalDebt.toFixed(2)}</span>
                                    <Button size="sm" onClick={() => handleSendWhatsAppDebtReminder(client)} className="h-8 px-3 rounded-xl bg-emerald-600 text-white font-black text-[8px] uppercase tracking-wider">
                                        <MessageSquare className="h-3 w-3 mr-1" /> WhatsApp
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

            {/* RECALCULADOR MASIVO MAESTRO */}
            <Card className="terminal-card bg-slate-900 text-white border-none shadow-2xl overflow-hidden rounded-[2.5rem]">
                <CardHeader className="p-8 border-b border-white/10">
                    <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-3">
                        <Sparkles className="h-5 w-5 text-primary" /> Recalculador Masivo de Catálogo
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-8 space-y-6">
                    <p className="text-xs text-slate-400 font-medium leading-relaxed">
                        Aplica los nuevos porcentajes de comisiones, gastos y descuento de Tesorería a todos los productos del catálogo en 1 clic.
                    </p>
                    <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-2">
                        <div className="flex justify-between text-[10px] font-black uppercase text-slate-400">
                            <span>Productos a Sincronizar:</span>
                            <span className="text-white font-black">{products?.length || 0} referencias</span>
                        </div>
                        <div className="flex justify-between text-[10px] font-black uppercase text-slate-400">
                            <span>Descuento Activo:</span>
                            <span className="text-emerald-400 font-black">{formValues.defaultBcvDiscount}%</span>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
      </div>
    </div>
  );
}