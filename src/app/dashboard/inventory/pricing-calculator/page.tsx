'use client';

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm, Controller, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useDoc, useFirestore, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, serverTimestamp, runTransaction, collection, getDoc, limit, query } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { 
    Calculator, 
    ArrowLeft, 
    DollarSign,
    Tag,
    Loader2,
    Search,
    Lock,
    Zap,
    ShieldCheck
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FinancialSettings, PricingStrategy, Product } from '@/lib/definitions';
import { ImageUploader } from '@/components/ui/image-uploader';
import { Switch } from '@/components/ui/switch';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "cmdk";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { calculatePricingTier } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

const importCalcSchema = z.object({
  sku: z.string().min(1, "SKU Requerido"),
  name: z.string().min(1, "Nombre Requerido"),
  brand: z.string().min(1, "Marca Requerida"),
  model: z.string().optional().default(''),
  category: z.string().min(1, "Categoría Requerida"),
  discipline: z.string().min(1, "Disciplina Requerida"),
  imageUrl: z.string().optional().default(''),
  minStockThreshold: z.coerce.number().min(0).default(5),
  hasSizes: z.boolean().default(false),
  stockLevel: z.coerce.number().min(0).default(0),
  factoryCost: z.coerce.number().min(0).default(0),
  chinaShipping: z.coerce.number().min(0).default(0),
  length: z.coerce.number().default(10),
  width: z.coerce.number().default(10),
  height: z.coerce.number().default(10),
  unitsPerBox: z.coerce.number().default(1),
  freightRatePerCBM: z.coerce.number().default(450),
  otherExpenses: z.coerce.number().default(0),
  targetMarginPercent: z.coerce.number().default(60),
  useManualPVP: z.boolean().default(false),
  manualPVP: z.coerce.number().default(0),
});

type ImportCalcValues = z.infer<typeof importCalcSchema>;

function PricingCalculatorContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const firestore = useFirestore();
  const { profile: currentUser, isUserLoading } = useUser();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isLoadingProduct, setIsLoadingProduct] = useState(false);
  const [loadedProductData, setLoadedProductData] = useState<Product | null>(null);

  const canRead = !isUserLoading && currentUser && ['superadmin', 'admin', 'gerencia'].includes(currentUser.role);

  const settingsRef = useMemoFirebase(() => (firestore && canRead ? doc(firestore, 'system', 'financials') : null), [firestore, canRead]);
  const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);

  const productsQuery = useMemoFirebase(() => (firestore && canRead ? query(collection(firestore, 'products'), limit(150)) : null), [firestore, canRead]);
  const { data: allProducts } = useCollection<Product>(productsQuery);

  const { control, handleSubmit, setValue, reset, formState: { isSubmitting } } = useForm<ImportCalcValues>({
    resolver: zodResolver(importCalcSchema),
    defaultValues: {
      sku: '', name: '', brand: '', model: '', category: '', discipline: '', imageUrl: '', minStockThreshold: 5,
      hasSizes: false, stockLevel: 0, factoryCost: 0, chinaShipping: 0, length: 10, width: 10, height: 10, unitsPerBox: 1,
      freightRatePerCBM: 450, otherExpenses: 0, targetMarginPercent: 60, useManualPVP: false, manualPVP: 0
    }
  });

  const values = useWatch({ control });

  const results = useMemo(() => {
    return calculatePricingTier({
        costLanded: Number(values.factoryCost || 0) + Number(values.chinaShipping || 0),
        strategy: values.useManualPVP ? 'target_price' : 'target_margin',
        targetMarginPercent: Number(values.targetMarginPercent),
        targetPriceUSD: Number(values.manualPVP),
        useGlobalSettings: true
    }, globalSettings);
  }, [values, globalSettings]);

  const loadProductData = async (sku: string) => {
    if (!firestore || !sku) return;
    setIsLoadingProduct(true);
    try {
        const productRef = doc(firestore, 'products', sku);
        const pricingRef = doc(firestore, `products/${sku}/private/pricing`);
        const [prodSnap, priceSnap] = await Promise.all([getDoc(productRef), getDoc(pricingRef)]);

        if (prodSnap.exists()) {
            const p = prodSnap.data() as Product;
            setLoadedProductData(p);
            const pricingData = priceSnap.exists() ? priceSnap.data() : null;
            const s = pricingData?.strategyDetails;
            
            reset({
                sku: p.sku, name: p.name, brand: p.brand, model: p.model || '', category: p.category,
                discipline: p.discipline || '', imageUrl: p.imageUrl || '',
                minStockThreshold: p.minStockThreshold || 5, hasSizes: p.hasSizes || false,
                stockLevel: p.stockLevel || 0,
                factoryCost: s?.importDetails?.factoryCost || 0,
                chinaShipping: s?.importDetails?.chinaShipping || 0,
                length: s?.importDetails?.dimensions?.length || 10,
                width: s?.importDetails?.dimensions?.width || 10,
                height: s?.importDetails?.dimensions?.height || 10,
                unitsPerBox: s?.importDetails?.unitsPerBox || 1,
                freightRatePerCBM: s?.importDetails?.freightRatePerCBM || 450,
                otherExpenses: s?.importDetails?.otherExpenses || 0,
                targetMarginPercent: s?.targetMarginPercent || 60,
                useManualPVP: s?.strategy === 'target_price',
                manualPVP: p.price
            });
        }
    } catch (e) {
        toast({ variant: "destructive", title: "Error de carga" });
    } finally {
        setIsLoadingProduct(false);
    }
  };

  const onSave = async (data: ImportCalcValues) => {
    if (!firestore || !currentUser || !results) return;
    try {
        await runTransaction(firestore, async (transaction) => {
            const productRef = doc(firestore, 'products', data.sku);
            const pricingRef = doc(firestore, `products/${data.sku}/private/pricing`);
            const productSnap = await transaction.get(productRef);

            const productPayload = {
                sku: data.sku, name: data.name, brand: data.brand, model: data.model,
                category: data.category, discipline: data.discipline, imageUrl: data.imageUrl,
                stockLevel: data.stockLevel, hasSizes: data.hasSizes, minStockThreshold: data.minStockThreshold,
                price: results.priceListBCV, priceCashUSD: results.priceCashUSD,
                priceEarly7d: results.priceEarly7d, priceEarly15d: results.priceEarly15d,
                updatedAt: serverTimestamp(),
                createdAt: productSnap.exists() ? productSnap.data()?.createdAt : serverTimestamp(),
            };

            const pricingPayload = {
                landedCost: results.landedCost,
                netProfit: results.netProfitUSD,
                strategyDetails: {
                    strategy: data.useManualPVP ? 'target_price' : 'smart_import',
                    targetMarginPercent: data.targetMarginPercent,
                    importDetails: {
                        factoryCost: data.factoryCost,
                        chinaShipping: data.chinaShipping,
                        dimensions: { length: data.length, width: data.width, height: data.height },
                        unitsPerBox: data.unitsPerBox,
                        freightRatePerCBM: data.freightRatePerCBM,
                        otherExpenses: data.otherExpenses
                    },
                    calculated: results
                },
                updatedAt: serverTimestamp(),
                updatedBy: currentUser.id
            };

            transaction.set(productRef, productPayload, { merge: true });
            transaction.set(pricingRef, pricingPayload, { merge: true });
        });
        toast({ title: "Sincronización Exitosa", description: `Producto ${data.sku} actualizado.` });
        router.push('/dashboard/inventory');
    } catch (e: any) {
        toast({ variant: 'destructive', title: "Error al guardar", description: e.message });
    }
  };

  const isLowMargin = Number(results?.netMarginPercent || 0) < 15;

  if (isUserLoading || !currentUser) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1440px] mx-auto pb-32 px-4 sm:px-6 lg:px-10 animate-in fade-in-50 duration-500">
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-10 w-10 rounded-full hover:bg-slate-100"><ArrowLeft className="h-5 w-5" /></Button>
            <div>
                <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none">Smart Pricing Studio</h1>
                <p className="text-muted-foreground text-[10px] sm:text-xs font-black italic uppercase tracking-[0.3em] opacity-60 mt-1">Ingeniería de Costos y Blindaje de Márgenes.</p>
            </div>
        </div>
        
        <Popover open={isSearchOpen} onOpenChange={setIsSearchOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" className="w-full sm:w-auto h-12 px-8 rounded-xl border-primary/20 font-black uppercase tracking-widest text-[10px] shadow-lg shadow-primary/5">
                    <Search className="mr-2 h-4 w-4 text-primary" /> BUSCAR PRODUCTO EXISTENTE
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[350px] p-0 rounded-2xl shadow-2xl border-none overflow-hidden" align="end">
                <Command>
                    <CommandInput placeholder="Nombre o SKU..." className="h-12 font-bold uppercase text-[10px]" />
                    <CommandList>
                        <CommandEmpty className="p-6 text-center italic font-bold uppercase text-[9px]">Sin resultados.</CommandEmpty>
                        <CommandGroup heading="CATÁLOGO MAESTRO" className="p-2">
                            {allProducts?.map(p => (
                                <CommandItem key={p.id} value={p.sku + " " + p.name} onSelect={() => { loadProductData(p.sku); setIsSearchOpen(false); }} className="rounded-xl p-3 cursor-pointer">
                                    <div className="flex items-center gap-3">
                                        <Avatar className="h-10 w-10 rounded-lg border shadow-sm"><AvatarImage src={p.imageUrl} className="object-cover" /><AvatarFallback className="bg-primary/5 text-primary text-[10px] font-black">{p.name.charAt(0)}</AvatarFallback></Avatar>
                                        <div className="flex flex-col flex-1 min-w-0"><span className="font-black text-[11px] uppercase truncate text-slate-900 leading-none">{p.name}</span><span className="text-[9px] font-mono font-bold text-slate-400 mt-1 uppercase">REF: {p.sku}</span></div>
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
      </header>

      <div className={cn("grid grid-cols-1 lg:grid-cols-12 gap-8 items-start transition-opacity duration-500", isLoadingProduct && "opacity-20")}>
        <div className="lg:col-span-7 space-y-8">
            <form onSubmit={handleSubmit(onSave)} id="full-calc-form" className="space-y-8">
                <Card className="border-none shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-slate-50/50 py-5 px-8 border-b">
                        <CardTitle className="text-[10px] font-black uppercase tracking-[0.3em] flex items-center gap-2 text-primary"><Tag className="h-4 w-4" /> Datos de Identidad</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-8 pt-8 px-8">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400 px-1">SKU / Referencia Técnica</Label><Controller name="sku" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} className="h-12 font-mono font-bold uppercase rounded-xl bg-slate-50 border-none shadow-inner text-lg" />} /></div>
                            <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400 px-1">Nombre Comercial</Label><Controller name="name" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} className="h-12 font-bold rounded-xl bg-slate-50 border-none shadow-inner" />} /></div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                            <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400 px-1">Marca</Label><Controller name="brand" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} className="h-11 rounded-xl bg-slate-50 border-none font-bold" />} /></div>
                            <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400 px-1">Categoría</Label><Controller name="category" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} className="h-11 rounded-xl bg-slate-50 border-none font-bold" />} /></div>
                            <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400 px-1">Disciplina</Label><Controller name="discipline" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} className="h-11 rounded-xl bg-slate-50 border-none font-bold" />} /></div>
                        </div>
                        <ImageUploader folderPath="products" onImageUploaded={(url) => setValue('imageUrl', url)} initialImageUrl={values.imageUrl} label="Imagen Principal del Equipo" />
                    </CardContent>
                </Card>

                <Card className="border-none shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-slate-50/50 py-5 px-8 border-b">
                        <CardTitle className="text-[10px] font-black uppercase tracking-[0.3em] flex items-center gap-2 text-primary"><Calculator className="h-4 w-4" /> Ingeniería de Importación</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-8 pt-8 px-8">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 border-b border-slate-50 pb-8">
                            <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400">Costo Fábrica (USD)</Label><Controller name="factoryCost" control={control} render={({ field }) => <Input type="number" step="0.01" {...field} value={isNaN(field.value) ? "" : field.value} className="h-12 font-black text-xl rounded-xl bg-slate-50 border-none shadow-inner" />} /></div>
                            <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400">China Shipping (USD/un.)</Label><Controller name="chinaShipping" control={control} render={({ field }) => <Input type="number" step="0.01" {...field} value={isNaN(field.value) ? "" : field.value} className="h-12 font-black text-xl rounded-xl bg-slate-50 border-none shadow-inner" />} /></div>
                        </div>
                        
                        <div className="p-8 bg-emerald-50 rounded-[2.5rem] border border-emerald-100 space-y-8">
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col">
                                    <Label className="text-base font-black uppercase text-emerald-700 flex items-center gap-2"><DollarSign className="h-5 w-5" /> Precio Final (PVP)</Label>
                                    <span className="text-[9px] font-bold text-emerald-600/60 uppercase tracking-widest mt-1">FIJAR PRECIO MANUAL BLINDA EL PRODUCTO</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Label className="text-[9px] font-black uppercase text-emerald-600">PRECIO FIJO</Label>
                                    <Controller name="useManualPVP" control={control} render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
                                </div>
                            </div>

                            {values.useManualPVP ? (
                                <div className="space-y-3 animate-in slide-in-from-top-2">
                                    <Label className="text-[10px] font-black text-emerald-700 uppercase px-1">Precio Lista Final (BCV) Deseado</Label>
                                    <div className="relative">
                                        <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 h-6 w-6 text-emerald-600" />
                                        <Controller name="manualPVP" control={control} render={({ field }) => <Input type="number" step="0.01" {...field} value={isNaN(field.value) ? "" : field.value} className="h-16 pl-12 text-4xl font-black bg-white border-emerald-300 rounded-2xl shadow-2xl" />} />
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4 animate-in slide-in-from-bottom-2">
                                    <div className="flex justify-between items-center px-1">
                                        <Label className="text-sm font-black uppercase text-slate-700">Margen Neto Deseado (%)</Label>
                                        <span className="text-2xl font-black text-emerald-600">{Number(values.targetMarginPercent || 0)}%</span>
                                    </div>
                                    <Controller name="targetMarginPercent" control={control} render={({ field }) => <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="h-14 font-black text-3xl text-emerald-700 bg-white border-emerald-200 rounded-2xl shadow-inner text-center" />} />
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </form>
        </div>

        <div className="lg:col-span-5 lg:sticky lg:top-24 space-y-8">
            <Card className="bg-slate-900 text-white border-none shadow-2xl overflow-hidden rounded-[3rem]">
                <CardHeader className="border-b border-white/10 p-8">
                    <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-3">
                        <Lock className="h-4 w-4 text-primary" /> Audit Scorecard (Protegido)
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-10 space-y-10">
                    <div className="bg-white/5 p-6 rounded-[2rem] border border-white/5 flex justify-between items-center shadow-inner">
                        <div className="space-y-1">
                            <span className="text-[10px] font-black uppercase text-primary tracking-[0.2em]">Landed Cost + OH</span>
                            <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Costo Reposición Real</p>
                        </div>
                        <span className="text-4xl font-black text-white tracking-tighter">
                            ${(Number(results?.landedCost || 0) + Number(results?.adminOverheadUSD || 0)).toFixed(2)}
                        </span>
                    </div>

                    <div className="space-y-6 px-2">
                        <div className="flex justify-between items-center text-slate-400">
                            <span className="text-[10px] font-black uppercase tracking-widest">Gastos Admin (OH)</span>
                            <span className="text-base font-bold text-white">${Number(results?.adminOverheadUSD || 0).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center text-slate-400">
                            <span className="text-[10px] font-black uppercase tracking-widest">Comisiones de Red</span>
                            <span className="text-base font-bold text-primary">-${Number(results?.totalCommissionsUSD || 0).toFixed(2)}</span>
                        </div>
                        <div className={cn(
                            "flex justify-between items-center p-6 border-2 rounded-[2rem] transition-all",
                            isLowMargin ? "bg-rose-500/10 border-rose-500/30" : "bg-emerald-500/10 border-emerald-500/20"
                        )}>
                            <div className="space-y-1">
                                <span className={cn("text-[10px] font-black uppercase tracking-[0.2em]", isLowMargin ? "text-rose-400" : "text-emerald-400")}>Utilidad Neta</span>
                                <p className="text-[8px] font-bold opacity-50 uppercase tracking-widest">GANANCIA REALIZADA</p>
                            </div>
                            <div className="text-right">
                                <p className={cn("text-3xl font-black", isLowMargin ? "text-rose-400" : "text-emerald-400")}>${Number(results?.netProfitUSD || 0).toFixed(2)}</p>
                                <p className="text-[10px] font-black opacity-70 tracking-widest">{Number(results?.netMarginPercent || 0).toFixed(1)}% MARGEN</p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-8 pt-4">
                        <div className="text-center space-y-2">
                            <div className="flex items-center justify-center gap-3">
                                <p className="text-[11px] font-black uppercase text-slate-500 tracking-[0.4em]">Sugerido CASH</p>
                                {values.useManualPVP && <Lock className="h-4 w-4 text-amber-500" />}
                            </div>
                            <p className="text-7xl font-black text-primary tracking-tighter leading-none">${Number(results?.priceCashUSD || 0).toFixed(2)}</p>
                        </div>
                        <div className="flex justify-between items-center bg-white p-6 rounded-[2rem] shadow-2xl">
                            <div className="space-y-0.5">
                                <span className="text-[10px] font-black uppercase text-slate-900 tracking-widest">Precio Lista</span>
                                <p className="text-[8px] font-bold text-slate-400 uppercase italic">Base Imponible BCV</p>
                            </div>
                            <span className="text-3xl font-black text-slate-900 tracking-tighter">${Number(results?.priceListBCV || 0).toFixed(2)}</span>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="p-10 bg-primary/10 border-t border-white/5">
                    <Button type="submit" form="full-calc-form" disabled={isSubmitting || !values.sku} className="w-full h-16 text-lg font-black uppercase tracking-[0.2em] shadow-2xl rounded-2xl bg-primary hover:bg-primary/90 text-white">
                        {isSubmitting ? <Loader2 className="mr-3 h-6 w-6 animate-spin" /> : <Save className="mr-3 h-6 w-6" />} Sincronizar Catálogo
                    </Button>
                </CardFooter>
            </Card>
        </div>
      </div>
    </div>
  );
}

export default function PricingCalculatorPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
            <PricingCalculatorContent />
        </Suspense>
    );
}