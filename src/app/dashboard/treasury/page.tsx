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
import { doc, setDoc, serverTimestamp, writeBatch, collection, getDocs, getDoc, query, where, limit } from 'firebase/firestore';
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
    Settings2
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import type { FinancialSettings, Product, PricingStrategy, Order } from '@/lib/definitions';
import { Input } from '@/components/ui/input';
import { fetchLatestBcvRate } from '@/lib/bcv-fetcher';
import { logActivity } from '@/lib/audit';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { calculatePricingTier } from '@/lib/pricing';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';

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
  const [inflationMultiplier, setInflationMultiplier] = useState(1.0);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const settingsRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
  const { data: settings, isLoading } = useDoc<FinancialSettings>(settingsRef);

  const productsRef = useMemoFirebase(() => firestore ? query(collection(firestore, 'products'), limit(300)) : null, [firestore]);
  const { data: products } = useCollection<Product>(productsRef);

  const ordersRef = useMemoFirebase(() => (firestore && isMounted) ? query(collection(firestore, 'orders'), limit(300)) : null, [firestore, isMounted]);
  const { data: allOrders } = useCollection<Order>(ordersRef);

  const uniqueBrands = useMemo(() => {
    if (!products) return [];
    return Array.from(new Set(products.map(p => p.brand || 'Otras'))).filter(Boolean).sort();
  }, [products]);

  const { control, handleSubmit, reset, setValue, formState: { isSubmitting } } = useForm<FinancialFormValues>({
    resolver: zodResolver(financialSchema),
    defaultValues: { 
        bcvRate: 1, ivaPercent: 16, defaultBcvDiscount: 35, 
        defaultCommission: 5, salesManagerCommission: 5, adminCommission: 5, 
        defaultOverhead: 10, earlyPayment7Days: 10, earlyPayment15Days: 5, 
        roundingTolerance: 0.05, overdueBlockDays: 35, historicalDilutionFactor: 0.65 
    }
  });

  const watchedValues = useWatch({ control });

  const metrics = useMemo(() => {
    if (!products || !settings || !isMounted || !allOrders) return null;
    
    const replacementCostTotal = products.reduce((sum, p) => sum + ((p.cost || 0) * (p.stockLevel || 0)), 0);
    const retailValueUSD = products.reduce((sum, p) => sum + ((p.priceCashUSD || 0) * (p.stockLevel || 0)), 0);
    
    const totalBilling = allOrders.filter(o => o.status !== 'Cancelado').reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const totalCashVerified = allOrders.reduce((sum, o) => sum + (o.totalCashReceived || 0), 0);
    const liquidityGap = totalBilling - totalCashVerified;
    const efficiency = totalBilling > 0 ? (totalCashVerified / totalBilling) * 100 : 0;

    return { replacementCostTotal, retailValueUSD, totalBilling, totalCashVerified, liquidityGap, efficiency };
  }, [products, settings, isMounted, allOrders]);

  const simulation = useMemo(() => {
    if (!products || !settings || !watchedValues.bcvRate || !isMounted) return null;
    let currentTotalVES = 0;
    let newTotalVES = 0;
    let inventoryCount = 0;
    const targetProducts = brandFilter === 'todos' ? products : products.filter(p => (p.brand || 'Otras') === brandFilter);
    targetProducts.forEach(p => {
        if (p.stockLevel > 0) {
            currentTotalVES += (p.price * p.stockLevel * settings.bcvRate);
            newTotalVES += (p.price * p.stockLevel * watchedValues.bcvRate * inflationMultiplier);
            inventoryCount++;
        }
    });
    const diff = newTotalVES - currentTotalVES;
    return { currentTotalVES, newTotalVES, diff, inventoryCount };
  }, [products, settings, watchedValues.bcvRate, brandFilter, inflationMultiplier, isMounted]);

  useEffect(() => {
    if (settings) {
        reset({
            bcvRate: settings.bcvRate || 1,
            ivaPercent: settings.ivaPercent || 16,
            defaultBcvDiscount: settings.defaultBcvDiscount || 35,
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
        if (rate) {
          setValue('bcvRate', rate);
          toast({ title: "Tasa BCV Sincronizada", description: `Nueva tasa detectada: ${rate} Bs.` });
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
      toast({ title: "Tesorería Actualizada" });
    } catch (e) {
      toast({ variant: "destructive", title: "Fallo de Sincronización" });
    }
  };

  const handleMassUpdate = async () => {
    if (!firestore || !currentUser || !settings) return;
    setIsMassUpdating(true);
    try {
        const q = brandFilter === 'todos' ? collection(firestore, 'products') : query(collection(firestore, 'products'), where('brand', '==', brandFilter));
        const productsSnap = await getDocs(q);
        const batch = writeBatch(firestore);
        let processedCount = 0;

        for (const productDoc of productsSnap.docs) {
            const pricingRef = doc(firestore, `products/${productDoc.id}/private/pricing`);
            const pricingSnap = await getDoc(pricingRef);
            
            if (pricingSnap.exists()) {
                const pricingData = pricingSnap.data();
                const strategy = pricingData.strategyDetails as PricingStrategy;
                if (strategy?.strategy === 'target_price') continue;
                
                const product = productDoc.data() as Product;
                const baseCost = (syncType === 'wac' && product.cost) ? product.cost : (strategy.importDetails?.factoryCost || 0);

                const adjustedStrategy = {
                    ...strategy,
                    importDetails: {
                        ...(strategy.importDetails || { dimensions: { length: 10, width: 10, height: 10 }, unitsPerBox: 1 }),
                        factoryCost: baseCost * inflationMultiplier,
                        chinaShipping: syncType === 'wac' ? 0 : (strategy.importDetails?.chinaShipping || 0)
                    }
                };

                const newCalc = calculatePricingTier(adjustedStrategy as any, watchedValues as any);
                batch.update(productDoc.ref, { price: newCalc.priceListBCV, priceCashUSD: newCalc.priceCashUSD, updatedAt: serverTimestamp() });
                batch.update(pricingRef, { landedCost: newCalc.landedCost, netProfit: newCalc.netProfitUSD, updatedAt: serverTimestamp() });
                processedCount++;
            }
        }
        await batch.commit();
        toast({ title: "Sincronización Completa", description: `${processedCount} productos actualizados.` });
    } catch (e: any) {
        toast({ variant: "destructive", title: "Error Masivo" });
    } finally { setIsMassUpdating(false); }
  }

  if (isUserLoading || !currentUser) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;

  return (
    <div className="w-full max-w-[1600px] mx-auto flex flex-col gap-8 pb-32 px-4 sm:px-6 animate-in fade-in-50 duration-500">
      <header className="space-y-1">
        <h1 className="terminal-header">Tesorería Central</h1>
        <p className="tech-label opacity-60">AUDITORÍA DE LIQUIDEZ Y PROTECCIÓN DE CAPITAL OPERATIVO.</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <MetricCard title="Liquidez Real" value={`$${metrics?.totalCashVerified.toLocaleString() || '0'}`} subValue="Efectivo en Banco (CASH)" icon={TrendingUp} colorClass="bg-emerald-50 text-emerald-500" />
          <MetricCard title="Capital en Calle" value={`$${metrics?.liquidityGap.toLocaleString() || '0'}`} subValue="Cuentas por Cobrar" icon={Wallet} colorClass="bg-blue-50 text-blue-500" />
          <MetricCard title="Valor Activo" value={`$${metrics?.replacementCostTotal.toLocaleString() || '0'}`} subValue="Costo Reposición WAC" icon={Boxes} colorClass="bg-slate-900 text-white" />
          <MetricCard title="Tasa BCV" value={`${settings?.bcvRate || '---'} Bs`} subValue="Parámetro de Red" icon={Landmark} colorClass="bg-primary/5 text-primary" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-12">
            <Card className="terminal-card bg-slate-900 text-white border-none shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-5"><PieChart className="h-48 w-48" /></div>
                <CardHeader className="p-8 border-b border-white/5">
                    <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-3">
                        <Activity className="h-5 w-5" /> Auditoría de Sinceración Financiera
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-8 grid grid-cols-1 md:grid-cols-3 gap-12">
                    <div className="space-y-6">
                        <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase text-slate-500">Facturación Nominal (En Libros)</p>
                            <p className="text-4xl font-black text-white tracking-tighter">${metrics?.totalBilling.toLocaleString()}</p>
                        </div>
                        <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2">
                            <p className="text-[8px] font-black uppercase text-slate-400">Estado de Conversión a Cash</p>
                            <Progress value={metrics?.efficiency || 0} className="h-2 bg-white/5" />
                            <div className="flex justify-between text-[9px] font-black uppercase"><span className="text-slate-500">Efficiency</span><span className="text-emerald-400">{metrics?.efficiency.toFixed(1)}%</span></div>
                        </div>
                    </div>

                    <div className="space-y-6 border-l border-white/5 pl-12">
                        <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase text-primary">Liquidez Real Verificada</p>
                            <p className="text-4xl font-black text-white tracking-tighter">${metrics?.totalCashVerified.toLocaleString()}</p>
                        </div>
                        <p className="text-[9px] font-medium text-slate-400 leading-relaxed uppercase">
                            VALOR TOTAL DEL EFECTIVO (CASH/ZELLE/VES) CONCILIADO POR ADMINISTRACIÓN TRAS DILUCIÓN DE INCENTIVOS.
                        </p>
                    </div>

                    <div className="space-y-6 border-l border-white/5 pl-12 flex flex-col justify-center">
                        <div className={cn(
                            "p-6 rounded-[2rem] flex flex-col items-center justify-center text-center gap-2 transition-all",
                            (metrics?.efficiency || 0) < 50 ? "bg-rose-500/10 border-2 border-rose-500/20" : "bg-emerald-500/10 border-2 border-emerald-500/20"
                        )}>
                            <p className="text-[10px] font-black uppercase text-slate-400">Gap de Cartera</p>
                            <p className="text-3xl font-black text-white tracking-tighter">-${metrics?.liquidityGap.toLocaleString()}</p>
                            <Badge variant="outline" className="border-white/10 text-[8px] font-black text-slate-500">DINERO PENDIENTE</Badge>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>

        <div className="lg:col-span-7 space-y-8">
            <Card className="terminal-card">
                <CardHeader className="bg-slate-50 py-6 px-8 flex flex-row items-center justify-between border-b">
                    <div className="flex items-center gap-3">
                        <Settings2 className="h-5 w-5 text-primary" />
                        <CardTitle className="text-xs font-black uppercase tracking-widest">Política de Red</CardTitle>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleSyncBcv} disabled={isSyncing} className="text-[9px] font-black uppercase h-9 rounded-xl border-slate-200">
                        {isSyncing ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <RefreshCw className="h-3 w-3 mr-2" />} Sync BCV
                    </Button>
                </CardHeader>
                <form onSubmit={handleSubmit(onSubmit)}>
                    <CardContent className="p-8 space-y-10">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col items-center text-center shadow-inner">
                                <Label className="text-[8px] font-black uppercase text-slate-400 mb-3">Tasa Maestra (Bs)</Label>
                                <Controller name="bcvRate" control={control} render={({ field }) => (
                                    <Input type="number" step="0.01" {...field} value={isNaN(field.value) ? "" : field.value} className="text-3xl font-black bg-transparent border-none text-center h-auto focus-visible:ring-0 text-slate-900" />
                                )} />
                            </div>
                            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col items-center text-center shadow-inner">
                                <Label className="text-[8px] font-black uppercase text-slate-400 mb-3">Impuesto IVA (%)</Label>
                                <Controller name="ivaPercent" control={control} render={({ field }) => (
                                    <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="text-3xl font-black bg-transparent border-none text-center h-auto focus-visible:ring-0 text-slate-900" />
                                )} />
                            </div>
                            <div className="p-6 bg-emerald-50 rounded-2xl border border-emerald-100 flex flex-col items-center text-center shadow-inner">
                                <Label className="text-[8px] font-black uppercase text-emerald-400 mb-3">Desc. CASH (%)</Label>
                                <Controller name="defaultBcvDiscount" control={control} render={({ field }) => (
                                    <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="text-3xl font-black bg-transparent border-none text-center h-auto focus-visible:ring-0 text-emerald-600" />
                                )} />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-6">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Hardening</h3>
                                <div className="space-y-4 p-6 bg-slate-50/50 rounded-[2rem] border border-slate-100">
                                    <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-slate-500">Bloqueo Mora (Días)</Label><Controller name="overdueBlockDays" control={control} render={({ field }) => <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="h-11 font-black bg-white rounded-xl" />} /></div>
                                    <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-slate-500">Dilución CASH (Factor)</Label><Controller name="historicalDilutionFactor" control={control} render={({ field }) => <Input type="number" step="0.01" {...field} value={isNaN(field.value) ? "" : field.value} className="h-11 font-black bg-white rounded-xl" />} /></div>
                                </div>
                            </div>
                            <div className="space-y-6">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2"><Zap className="h-4 w-4" /> Pronto Pago</h3>
                                <div className="grid grid-cols-2 gap-4 p-6 bg-slate-50/50 rounded-[2rem] border border-slate-100">
                                    <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-slate-500">Tier 7D (%)</Label><Controller name="earlyPayment7Days" control={control} render={({ field }) => <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="h-11 font-black bg-white text-center rounded-xl" />} /></div>
                                    <div className="space-y-1.5"><Label className="text-[9px] font-black uppercase text-slate-500">Tier 15D (%)</Label><Controller name="earlyPayment15Days" control={control} render={({ field }) => <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="h-11 font-black bg-white text-center rounded-xl" />} /></div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter className="p-8 border-t bg-slate-50/50 flex justify-end">
                        <Button type="submit" disabled={isSubmitting} className="font-black uppercase h-12 px-12 rounded-xl bg-slate-900 hover:bg-primary shadow-xl text-[10px]">Sincronizar Política</Button>
                    </CardFooter>
                </form>
            </Card>
        </div>

        <div className="lg:col-span-5 space-y-8">
            <Card className="terminal-card bg-slate-900 text-white border-none shadow-2xl overflow-hidden rounded-[2.5rem]">
                <CardHeader className="p-8 border-b border-white/5">
                    <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-3">
                        <Sparkles className="h-5 w-5" /> Sincronizador Maestro
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-8 space-y-8">
                    <div className="space-y-4">
                        <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Base de Recálculo</Label>
                        <div className="grid grid-cols-2 gap-3">
                            <Button variant={syncType === 'bcv' ? 'default' : 'outline'} onClick={() => setSyncType('bcv')} className={cn("text-[9px] font-black uppercase h-11 rounded-xl", syncType === 'bcv' ? "bg-primary text-white" : "text-white/60 border-white/10")}>Dinámica BCV</Button>
                            <Button variant={syncType === 'wac' ? 'default' : 'outline'} onClick={() => setSyncType('wac')} className={cn("text-[9px] font-black uppercase h-11 rounded-xl", syncType === 'wac' ? "bg-indigo-600 text-white" : "text-white/60 border-white/10")}>Costo Real WAC</Button>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Unidad de Negocio (Marca)</Label>
                        <Select value={brandFilter} onValueChange={setBrandFilter}>
                            <SelectTrigger className="h-12 bg-white/5 border-white/10 rounded-xl font-bold uppercase text-xs text-white"><SelectValue placeholder="TODA LA RED" /></SelectTrigger>
                            <SelectContent className="z-[200]">
                                <SelectItem value="todos" className="font-bold uppercase text-[10px]">TODA LA RED</SelectItem>
                                {uniqueBrands.map(b => <SelectItem key={b} value={b} className="font-bold uppercase text-[10px]">{b.toUpperCase()}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-3 p-6 bg-white/5 rounded-[2rem] border border-white/10 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-5"><TrendingUp className="h-12 w-12" /></div>
                        <Label className="text-[10px] font-black text-primary uppercase tracking-widest">Factor de Ajuste (Bump)</Label>
                        <div className="flex items-center gap-4">
                            <Input type="number" step="0.01" value={isNaN(inflationMultiplier) ? "" : inflationMultiplier} onChange={(e) => setInflationMultiplier(e.target.value === "" ? 1.0 : Number(e.target.value))} className="h-14 bg-transparent border-none text-4xl font-black text-white focus-visible:ring-0 p-0" />
                            <div className="text-right"><p className="text-[10px] font-black text-emerald-400">+{((inflationMultiplier - 1) * 100).toFixed(1)}%</p><p className="text-[7px] font-bold text-slate-500 uppercase">BUMP</p></div>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="p-8 bg-white/5 border-t border-white/5">
                    <Button onClick={handleMassUpdate} disabled={isMassUpdating || !simulation} className={cn("w-full h-16 font-black uppercase text-[11px] tracking-[0.25em] rounded-2xl shadow-2xl", syncType === 'wac' ? "bg-indigo-600" : "bg-primary")}>
                        {isMassUpdating ? <Loader2 className="mr-3 h-5 w-5 animate-spin" /> : "EJECUTAR SINCRONIZACIÓN"}
                    </Button>
                </CardFooter>
            </Card>
        </div>
      </div>
    </div>
  );
}