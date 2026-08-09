'use client';

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm, Controller, useWatch, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useDoc, useFirestore, useMemoFirebase, useUser, useCollection } from '@/firebase';
import { doc, serverTimestamp, runTransaction, collection, getDoc, limit, query, addDoc } from 'firebase/firestore';
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
    ShieldCheck,
    Save,
    MapPin,
    AlertTriangle,
    Boxes,
    Plus,
    Trash2,
    Sparkles,
    Palette,
    Ruler,
    Landmark,
    Settings2
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { FinancialSettings, PricingStrategy, Product } from '@/lib/definitions';
import { ImageUploader } from '@/components/ui/image-uploader';
import { Switch } from '@/components/ui/switch';
import { generateProductDescription } from '@/ai/flows/generate-product-description';
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
import { Badge } from '@/components/ui/badge';
import { calculatePricingTier } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

const sizeVariantSchema = z.object({
  label: z.string().min(1, "Talla requerida"),
  stock: z.coerce.number().min(0, "Mínimo 0")
});

const importCalcSchema = z.object({
  sku: z.string().min(1, "SKU / Referencia Requerida"),
  name: z.string().min(1, "Nombre de Producto Requerido"),
  brand: z.string().min(1, "Marca Requerida"),
  model: z.string().optional().default(''),
  category: z.string().min(1, "Categoría Requerida"),
  discipline: z.string().optional().default(''),
  features: z.string().optional().default(''),
  colors: z.string().optional().default(''),
  imageUrl: z.string().optional().default(''),
  minStockThreshold: z.coerce.number().min(0).default(5),
  location: z.string().optional().default('PASILLO A-1'),
  hasSizes: z.boolean().default(false),
  sizeVariants: z.array(sizeVariantSchema).default([]),
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
  priceLocked: z.boolean().default(false),
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
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadedProductData, setLoadedProductData] = useState<Product | null>(null);

  // RESTRICCIÓN ESTRICTA DE ACCESO: SOLO SUPERADMIN, ADMIN Y GERENCIA
  const canAccessAndManage = !isUserLoading && currentUser && ['superadmin', 'admin', 'gerencia'].includes(currentUser.role);

  const settingsRef = useMemoFirebase(() => (firestore && canAccessAndManage ? doc(firestore, 'system', 'financials') : null), [firestore, canAccessAndManage]);
  const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);

  const productsQuery = useMemoFirebase(() => (firestore && canAccessAndManage ? query(collection(firestore, 'products'), limit(150)) : null), [firestore, canAccessAndManage]);
  const { data: allProducts } = useCollection<Product>(productsQuery);

  const { control, handleSubmit, setValue, reset, formState: { isSubmitting } } = useForm<ImportCalcValues>({
    resolver: zodResolver(importCalcSchema),
    defaultValues: {
      sku: '', name: '', brand: '', model: '', category: '', discipline: '', features: '', colors: '', imageUrl: '', minStockThreshold: 5,
      location: 'PASILLO A-1', hasSizes: false, sizeVariants: [], stockLevel: 0, factoryCost: 0, chinaShipping: 0, length: 10, width: 10, height: 10, unitsPerBox: 1,
      freightRatePerCBM: 450, otherExpenses: 0, targetMarginPercent: 60, useManualPVP: false, manualPVP: 0, priceLocked: false
    }
  });

  const { fields: sizeFields, append: appendSize, remove: removeSize } = useFieldArray({
    control,
    name: "sizeVariants"
  });

  const values = useWatch({ control });

  // CÁLCULO AUTOMÁTICO DE STOCK TOTAL SI TIENE TALLAS
  const calculatedTotalStock = useMemo(() => {
    if (!values.hasSizes || !values.sizeVariants || values.sizeVariants.length === 0) {
      return Number(values.stockLevel || 0);
    }
    return values.sizeVariants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
  }, [values.hasSizes, values.sizeVariants, values.stockLevel]);

  const results = useMemo(() => {
    return calculatePricingTier({
        costLanded: Number(values.factoryCost || 0) + Number(values.chinaShipping || 0),
        strategy: values.useManualPVP ? 'target_price' : 'target_margin',
        targetMarginPercent: Number(values.targetMarginPercent),
        targetPriceUSD: Number(values.manualPVP),
        useGlobalSettings: true
    }, globalSettings);
  }, [values, globalSettings]);

  const onGenerateDescription = async () => {
    if (!values.name || !values.category) {
        toast({ variant: 'destructive', title: 'Faltan datos básicos', description: 'Por favor ingresa Nombre y Categoría.' });
        return;
    }
    setIsGenerating(true);
    try {
        const result = await generateProductDescription({ 
            name: values.name || '', 
            brand: values.brand || '', 
            category: values.category || '', 
            discipline: values.discipline || '' 
        });
        setValue('features', result.description);
        toast({ title: '✨ IA Copywriter', description: 'Ficha técnica generada.' });
    } catch (e) {
        toast({ variant: 'destructive', title: 'Error IA', description: 'No se pudo generar la descripción.' });
    } finally {
        setIsGenerating(false);
    }
  };

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

            const existingSizes = p.sizes ? Object.entries(p.sizes).map(([label, stock]) => ({ label, stock: Number(stock) })) : [];
            
            reset({
                sku: p.sku, name: p.name, brand: p.brand, model: p.model || '', category: p.category,
                discipline: p.discipline || '', imageUrl: p.imageUrl || '',
                features: p.features || '',
                colors: (p as any).colors ? (Array.isArray((p as any).colors) ? (p as any).colors.join(', ') : (p as any).colors) : '',
                minStockThreshold: p.minStockThreshold || 5, 
                hasSizes: p.hasSizes || false,
                sizeVariants: existingSizes,
                location: (p as any).location || p.warehouseLocation || 'PASILLO A-1',
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
                manualPVP: p.price,
                priceLocked: (p as any).priceLocked || false
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

            const isExisting = productSnap.exists();
            const existingData = isExisting ? productSnap.data() : null;

            if (isExisting && existingData?.priceLocked && currentUser.role !== 'superadmin' && currentUser.role !== 'gerencia') {
                throw new Error("El precio de este producto está CONGELADO por Gerencia.");
            }

            const sizesMap: { [key: string]: number } = {};
            let stockFromSizes = 0;
            if (data.hasSizes && data.sizeVariants) {
                data.sizeVariants.forEach(v => {
                    const s = Math.max(0, Math.floor(Number(v.stock)));
                    sizesMap[v.label] = s;
                    stockFromSizes += s;
                });
            }

            const finalStock = data.hasSizes ? stockFromSizes : Math.max(0, Math.floor(Number(data.stockLevel)));
            const colorsArray = data.colors ? data.colors.split(',').map(c => c.trim()).filter(Boolean) : [];

            const productPayload = {
                id: data.sku,
                sku: data.sku, name: data.name, brand: data.brand, model: data.model,
                category: data.category, discipline: data.discipline, 
                features: data.features,
                colors: colorsArray,
                imageUrl: data.imageUrl,
                stockLevel: finalStock, 
                hasSizes: data.hasSizes, 
                sizes: data.hasSizes ? sizesMap : null,
                minStockThreshold: data.minStockThreshold,
                warehouseLocation: data.location || 'PASILLO A-1',
                priceLocked: data.priceLocked,
                price: results.priceListBCV, priceCashUSD: results.priceCashUSD,
                priceEarly7d: results.priceEarly7d, priceEarly15d: results.priceEarly15d,
                updatedAt: serverTimestamp(),
                createdAt: isExisting ? existingData?.createdAt : serverTimestamp(),
                createdBy: isExisting ? existingData?.createdBy : currentUser.id,
                userId: currentUser.id
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

        // REGISTRAR EN BITÁCORA DE AUDITORÍA
        await addDoc(collection(firestore, 'audit_logs'), {
            eventType: 'PRICE_REGISTRATION',
            sku: data.sku,
            productName: data.name,
            priceUSD: results.priceCashUSD,
            priceListBCV: results.priceListBCV,
            netMarginPercent: results.netMarginPercent,
            priceLocked: data.priceLocked,
            executorId: currentUser.id,
            executorName: currentUser.name,
            timestamp: serverTimestamp()
        });

        toast({ title: "Producto Registrado y Publicado", description: `Referencia ${data.sku} sincronizada en catálogo.` });
        router.push('/dashboard/inventory');
    } catch (e: any) {
        toast({ variant: 'destructive', title: "Operación Denegada", description: e.message });
    }
  };

  const isLowMargin = Number(results?.netMarginPercent || 0) < 15;

  if (isUserLoading || !currentUser) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>;

  if (!canAccessAndManage) {
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-8 text-center bg-slate-900 text-white rounded-[2.5rem] my-10 mx-4">
            <div className="p-6 rounded-full bg-rose-500/10 text-rose-500"><Lock className="h-16 w-16" /></div>
            <h1 className="text-2xl font-black uppercase tracking-tight">Acceso Exclusivo para Administración y Gerencia</h1>
            <p className="text-slate-400 text-xs max-w-md">El registro de productos y fijación de precios está restringido para garantizar la integridad financiera.</p>
            <Button onClick={() => router.push('/dashboard/inventory')} className="h-12 px-8 rounded-xl bg-white text-slate-900 font-black uppercase text-[10px]">Volver al Inventario</Button>
        </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1440px] mx-auto pb-32 px-4 sm:px-6 lg:px-10 animate-in fade-in-50 duration-500">
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-10 w-10 rounded-full hover:bg-slate-100"><ArrowLeft className="h-5 w-5" /></Button>
            <div>
                <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none">Estudio Unificado de Registro y Pricing</h1>
                <p className="text-muted-foreground text-[10px] sm:text-xs font-black italic uppercase tracking-[0.3em] opacity-60 mt-1">Registro Completo con Tallas, Colores, Ficha IA y Blindaje de Márgenes.</p>
            </div>
        </div>
        
        <Popover open={isSearchOpen} onOpenChange={setIsSearchOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" className="w-full sm:w-auto h-12 px-8 rounded-xl border-primary/20 font-black uppercase tracking-widest text-[10px] shadow-lg shadow-primary/5">
                    <Search className="mr-2 h-4 w-4 text-primary" /> BUSCAR O EDITAR EXISTENTE
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[350px] p-0 rounded-2xl shadow-2xl border-none overflow-hidden" align="end">
                <Command>
                    <CommandInput placeholder="Buscar por Nombre o SKU..." className="h-12 font-bold uppercase text-[10px]" />
                    <CommandList>
                        <CommandEmpty className="p-6 text-center italic font-bold uppercase text-[9px]">Sin coincidencias.</CommandEmpty>
                        <CommandGroup heading="CATÁLOGO EXISTENTE" className="p-2">
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
                {/* BLOQUE 1: DENTIDAD DEL PRODUCTO */}
                <Card className="border-none shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-slate-50/50 py-5 px-8 border-b">
                        <CardTitle className="text-[10px] font-black uppercase tracking-[0.3em] flex items-center gap-2 text-primary"><Tag className="h-4 w-4" /> 1. Datos de Identidad y Categoría</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-8 pt-8 px-8">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400 px-1">SKU / Referencia Única</Label><Controller name="sku" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} placeholder="EJ: CALZ-BAL-001" className="h-12 font-mono font-bold uppercase rounded-xl bg-slate-50 border-none shadow-inner text-lg" />} /></div>
                            <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400 px-1">Nombre Comercial</Label><Controller name="name" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} placeholder="Ej: Zapatilla Profesional Futsal" className="h-12 font-bold rounded-xl bg-slate-50 border-none shadow-inner" />} /></div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                            <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400 px-1">Marca</Label><Controller name="brand" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} placeholder="Ej: Molten, Penalty" className="h-11 rounded-xl bg-slate-50 border-none font-bold" />} /></div>
                            <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400 px-1">Categoría</Label><Controller name="category" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} placeholder="Ej: Calzado, Balones" className="h-11 rounded-xl bg-slate-50 border-none font-bold" />} /></div>
                            <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400 px-1">Disciplina</Label><Controller name="discipline" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} placeholder="Ej: Fútbol, Baloncesto" className="h-11 rounded-xl bg-slate-50 border-none font-bold" />} /></div>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[10px] font-black uppercase text-slate-400 px-1 flex items-center gap-1.5"><Palette className="h-3.5 w-3.5 text-primary" /> Colores Disponibles (Separados por coma)</Label>
                            <Controller name="colors" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} placeholder="Ej: Negro / Dorado, Rojo / Blanco, Azul" className="h-11 rounded-xl bg-slate-50 border-none font-bold" />} />
                        </div>
                    </CardContent>
                </Card>

                {/* BLOQUE 2: VARIANTES DE TALLAS Y DEPÓSITO */}
                <Card className="border-none shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-slate-50/50 py-5 px-8 border-b flex flex-row items-center justify-between">
                        <CardTitle className="text-[10px] font-black uppercase tracking-[0.3em] flex items-center gap-2 text-primary"><Ruler className="h-4 w-4" /> 2. Variantes de Talla y Almacén</CardTitle>
                        <div className="flex items-center gap-2">
                            <Label className="text-[9px] font-black uppercase text-slate-500">¿Tiene Tallas?</Label>
                            <Controller name="hasSizes" control={control} render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-8 pt-8 px-8">
                        {values.hasSizes ? (
                            <div className="space-y-6 animate-in fade-in duration-300">
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs font-black uppercase text-slate-700">Desglose de Inventario por Talla</Label>
                                    <Button 
                                        type="button" 
                                        size="sm" 
                                        onClick={() => appendSize({ label: '', stock: 0 })}
                                        className="h-8 px-3 rounded-xl bg-primary text-white font-black text-[9px] uppercase tracking-wider"
                                    >
                                        <Plus className="h-3.5 w-3.5 mr-1" /> Añadir Talla
                                    </Button>
                                </div>

                                {sizeFields.length > 0 ? (
                                    <div className="space-y-3">
                                        {sizeFields.map((fieldItem, index) => (
                                            <div key={fieldItem.id} className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200">
                                                <div className="flex-1">
                                                    <Controller 
                                                        name={`sizeVariants.${index}.label`} 
                                                        control={control} 
                                                        render={({ field }) => <Input {...field} placeholder="Ej: Talla 38, M, L" className="h-10 font-black uppercase bg-white rounded-xl text-xs" />} 
                                                    />
                                                </div>
                                                <div className="w-28">
                                                    <Controller 
                                                        name={`sizeVariants.${index}.stock`} 
                                                        control={control} 
                                                        render={({ field }) => <Input type="number" {...field} placeholder="Stock" className="h-10 font-black text-center bg-white rounded-xl text-xs" />} 
                                                    />
                                                </div>
                                                <Button type="button" variant="ghost" size="icon" onClick={() => removeSize(index)} className="h-9 w-9 rounded-xl text-rose-500 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></Button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="p-6 text-center border border-dashed border-slate-200 rounded-2xl text-xs font-bold text-slate-400 uppercase">
                                        Haz clic en "+ AÑADIR TALLA" para desglosar el stock por talla.
                                    </div>
                                )}

                                <div className="p-4 rounded-2xl bg-primary/10 flex justify-between items-center">
                                    <span className="text-xs font-black uppercase text-primary">Stock Total Acumulado:</span>
                                    <span className="text-xl font-black text-primary">{calculatedTotalStock} Unidades</span>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400 px-1">Stock Inicial (Unidades)</Label><Controller name="stockLevel" control={control} render={({ field }) => <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="h-11 rounded-xl bg-slate-50 border-none font-black text-center" />} /></div>
                                <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400 px-1">Umbral Stock Crítico</Label><Controller name="minStockThreshold" control={control} render={({ field }) => <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="h-11 rounded-xl bg-slate-50 border-none font-black text-center" />} /></div>
                                <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400 px-1">Ubicación Depósito</Label><Controller name="location" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} placeholder="PASILLO A-1" className="h-11 rounded-xl bg-slate-50 border-none font-bold text-center uppercase" />} /></div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* BLOQUE 3: FICHA TÉCNICA E IA COPYWRITER */}
                <Card className="border-none shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-slate-50/50 py-5 px-8 border-b flex flex-row items-center justify-between">
                        <CardTitle className="text-[10px] font-black uppercase tracking-[0.3em] flex items-center gap-2 text-primary"><Sparkles className="h-4 w-4" /> 3. Ficha Técnica e IA Copywriter</CardTitle>
                        <Button type="button" size="sm" onClick={onGenerateDescription} disabled={isGenerating} className="h-8 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[9px] uppercase tracking-wider">
                            {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />} Redactar con IA
                        </Button>
                    </CardHeader>
                    <CardContent className="space-y-8 pt-8 px-8">
                        <div className="space-y-1.5">
                            <Label className="text-[10px] font-black uppercase text-slate-400 px-1">Descripción y Ficha Técnica del Equipo</Label>
                            <Controller name="features" control={control} render={({ field }) => <Textarea {...field} value={field.value ?? ""} rows={4} placeholder="Características técnicas, materiales de fabricación, especificaciones..." className="rounded-xl bg-slate-50 border-none font-medium text-xs leading-relaxed" />} />
                        </div>
                        <ImageUploader folderPath="products" onImageUploaded={(url) => setValue('imageUrl', url)} initialImageUrl={values.imageUrl} label="Imagen Principal del Producto" />
                    </CardContent>
                </Card>

                {/* BLOQUE 4: ESTRUCTURA DE COSTOS Y BLINDAJE DE PRECIO */}
                <Card className="border-none shadow-sm rounded-[2.5rem] overflow-hidden bg-white">
                    <CardHeader className="bg-slate-50/50 py-5 px-8 border-b">
                        <CardTitle className="text-[10px] font-black uppercase tracking-[0.3em] flex items-center gap-2 text-primary"><Calculator className="h-4 w-4" /> 4. Ingeniería de Costos y Blindaje</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-8 pt-8 px-8">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 border-b border-slate-50 pb-8">
                            <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400">Costo Fábrica (USD)</Label><Controller name="factoryCost" control={control} render={({ field }) => <Input type="number" step="0.01" {...field} value={isNaN(field.value) ? "" : field.value} className="h-12 font-black text-xl rounded-xl bg-slate-50 border-none shadow-inner" />} /></div>
                            <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400">China Shipping (USD/un.)</Label><Controller name="chinaShipping" control={control} render={({ field }) => <Input type="number" step="0.01" {...field} value={isNaN(field.value) ? "" : field.value} className="h-12 font-black text-xl rounded-xl bg-slate-50 border-none shadow-inner" />} /></div>
                        </div>
                        
                        <div className="space-y-6 p-6 bg-slate-50 rounded-[2rem] border border-slate-200 shadow-inner">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs font-black uppercase text-primary">Protección PVP Manual</Label>
                                <Controller name="useManualPVP" control={control} render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
                            </div>
                            {values.useManualPVP ? (
                                <div className="space-y-4 animate-in slide-in-from-top-2">
                                    <div className="flex justify-between items-center px-1">
                                        <Label className="text-[10px] uppercase font-bold text-primary">Margen Neto Resultante</Label>
                                        <span className="text-xl font-black text-primary">{Number(results?.netMarginPercent || 0).toFixed(1)}%</span>
                                    </div>
                                    <Controller name="manualPVP" control={control} render={({ field }) => <Input type="number" step="0.01" {...field} value={isNaN(field.value) ? "" : field.value} className="h-16 text-4xl font-black bg-white border-primary/30 text-primary rounded-2xl text-center shadow-inner" />} />
                                </div>
                            ) : (
                                <div className="space-y-4 animate-in slide-in-from-bottom-2">
                                    <div className="flex justify-between items-center px-1">
                                        <Label className="text-[10px] uppercase font-bold text-primary">Margen Neto Deseado</Label>
                                        <span className="text-xl font-black text-primary">{values.targetMarginPercent}%</span>
                                    </div>
                                    <Controller name="targetMarginPercent" control={control} render={({ field }) => <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="h-16 bg-white border-primary/30 text-primary rounded-2xl text-center text-4xl font-black shadow-inner" />} />
                                </div>
                            )}
                        </div>

                        {/* CASILLA DE CONGELAMIENTO / BLOQUEO DE PRECIO */}
                        <div className="p-6 rounded-[2rem] bg-slate-900 text-white flex items-center justify-between shadow-xl">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <Lock className="h-4 w-4 text-amber-400" />
                                    <Label className="text-xs font-black uppercase text-white">🔒 Congelar / Bloquear Precio</Label>
                                </div>
                                <p className="text-[9px] text-slate-400">Impide que actualizaciones masivas o automatizadas alteren este precio.</p>
                            </div>
                            <Controller name="priceLocked" control={control} render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
                        </div>

                        {/* BANNER INFORMATIVO NODO ÚNICO DE TESORERÍA */}
                        <div className="p-5 rounded-[2rem] bg-slate-900 text-white border border-primary/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
                            <div className="space-y-1">
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary flex items-center gap-1.5"><Landmark className="h-3.5 w-3.5" /> Parámetros Activos de Tesorería</p>
                                <p className="text-[11px] font-medium text-slate-300 uppercase">
                                    Descuento: <span className="text-white font-black">{globalSettings?.defaultBcvDiscount || 25}%</span> | Comisiones Red: <span className="text-primary font-black">{(globalSettings?.defaultCommission || 5) + (globalSettings?.salesManagerCommission || 5) + (globalSettings?.adminCommission || 5)}%</span> | Overhead: <span className="text-white font-black">{globalSettings?.defaultOverhead || 10}%</span>
                                </p>
                            </div>
                            <Button asChild variant="outline" size="sm" className="h-9 px-4 rounded-xl border-white/20 text-white font-black uppercase text-[9px] hover:bg-white/10 shrink-0">
                                <Link href="/dashboard/treasury">
                                    <Settings2 className="mr-1.5 h-3.5 w-3.5 text-primary" /> TESORERÍA
                                </Link>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </form>
        </div>

        {/* COLUMNA DERECHA: AUDIT SCORECARD Y BOTÓN REGISTRAR */}
        <div className="lg:col-span-5 lg:sticky lg:top-24 space-y-8">
            <Card className="bg-slate-900 text-white border-none shadow-2xl overflow-hidden rounded-[3rem]">
                <CardHeader className="border-b border-white/10 p-8">
                    <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center justify-between">
                        <span className="flex items-center gap-2"><Lock className="h-4 w-4 text-primary" /> Audit Scorecard</span>
                        {values.priceLocked && <Badge className="bg-amber-500/20 text-amber-400 border-none font-black text-[8px] uppercase">🔒 PRECIO BLOQUEADO</Badge>}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-10 space-y-8">
                    <div className="bg-white/5 p-6 rounded-[2rem] border border-white/5 flex justify-between items-center shadow-inner">
                        <div className="space-y-1">
                            <span className="text-[10px] font-black uppercase text-primary tracking-[0.2em]">Costo Reposición Real</span>
                            <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Fábrica + China Shipping + OH</p>
                        </div>
                        <span className="text-4xl font-black text-white tracking-tighter">
                            ${(Number(results?.landedCost || 0) + Number(results?.adminOverheadUSD || 0)).toFixed(2)}
                        </span>
                    </div>

                    <div className="space-y-4 px-2">
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

                    <div className="space-y-6 pt-4 border-t border-white/10">
                        <div className="text-center space-y-2">
                            <span className="text-[10px] font-black uppercase text-slate-400 tracking-[0.3em]">Precio Efectivo Cash ($ USD)</span>
                            <p className="text-6xl font-black text-primary tracking-tighter leading-none">${Number(results?.priceCashUSD || 0).toFixed(2)}</p>
                        </div>
                        <div className="flex justify-between items-center bg-white p-5 rounded-[2rem] shadow-2xl">
                            <div className="space-y-0.5">
                                <span className="text-[10px] font-black uppercase text-slate-900 tracking-widest">Precio Lista BCV</span>
                                <p className="text-[8px] font-bold text-slate-400 uppercase italic">Base Imponible ($ USD)</p>
                            </div>
                            <span className="text-3xl font-black text-slate-900 tracking-tighter">${Number(results?.priceListBCV || 0).toFixed(2)}</span>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="p-10 bg-primary/10 border-t border-white/5">
                    <Button type="submit" form="full-calc-form" disabled={isSubmitting || !values.sku || !values.name} className="w-full h-16 text-sm font-black uppercase tracking-[0.2em] shadow-2xl rounded-2xl bg-primary hover:bg-primary/90 text-white">
                        {isSubmitting ? <Loader2 className="mr-3 h-6 w-6 animate-spin" /> : <Save className="mr-3 h-6 w-6" />} REGISTRAR Y PUBLICAR PRODUCTO
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