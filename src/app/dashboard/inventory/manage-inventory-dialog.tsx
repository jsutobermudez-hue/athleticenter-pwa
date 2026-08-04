'use client';

import React, { useState, useMemo } from 'react';
import { useForm, Controller, useWatch, useFieldArray } from 'react-hook-form';
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
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, PlusCircle, Tag, Boxes, Calculator, Zap, ShieldCheck, Save, Trash2, MapPin, X, Box, ImageIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Product, FinancialSettings, PricingStrategy } from '@/lib/definitions';
import { useDoc, useFirestore, useUser, useMemoFirebase } from '@/firebase';
import { doc, runTransaction, serverTimestamp, collection } from 'firebase/firestore';
import { ImageUploader } from '@/components/ui/image-uploader';
import { createAppNotifications } from '@/lib/notifications';
import { generateProductDescription } from '@/ai/flows/generate-product-description';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { calculatePricingTier } from '@/lib/pricing';

const productSchema = z.object({
  sku: z.string().min(1, 'El SKU es requerido.').max(50).transform(s => s.trim().toUpperCase()),
  name: z.string().min(1, 'El nombre es requerido.'),
  brand: z.string().min(1, 'La marca es requerida.'),
  model: z.string().optional().default(''),
  category: z.string().min(1, 'La categoría es requerida.'),
  discipline: z.string().min(1, 'La disciplina es requerida.'),
  warehouseLocation: z.string().optional().default(''),
  features: z.string().optional().default(''),
  imageUrl: z.string().optional().default(''),
  stockLevel: z.coerce.number().min(0, 'Mínimo 0.'),
  minStockThreshold: z.coerce.number().min(0).default(5),
  hasSizes: z.boolean().default(false),
  sizeVariants: z.array(z.object({
    label: z.string().min(1, 'Talla requerida'),
    stock: z.coerce.number().min(0)
  })).optional().default([]),
  factoryCost: z.coerce.number().min(0).default(0),
  chinaShipping: z.coerce.number().min(0).default(0),
  length: z.coerce.number().default(10),
  width: z.coerce.number().default(10),
  height: z.coerce.number().default(10),
  unitsPerBox: z.coerce.number().default(1),
  freightRatePerCBM: z.coerce.number().default(450),
  otherExpenses: z.coerce.number().default(0),
  targetMarginPercent: z.coerce.number().default(60),
});

type ProductFormValues = z.infer<typeof productSchema>;

export function NewProductDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();
  const { user: authUser, profile: currentUser } = useUser();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const settingsRef = useMemoFirebase(() => (firestore ? doc(firestore, 'system', 'financials') : null), [firestore]);
  const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);
  
  const { control, handleSubmit, setValue, formState: { errors }, reset } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      sku: '', name: '', brand: '', model: '', category: '', discipline: '', warehouseLocation: '',
      features: '', imageUrl: '', stockLevel: 0, minStockThreshold: 5, hasSizes: false,
      sizeVariants: [{ label: 'M', stock: 0 }],
      factoryCost: 0, chinaShipping: 0, length: 10, width: 10, height: 10,
      unitsPerBox: 1, freightRatePerCBM: 450, otherExpenses: 0, targetMarginPercent: 60
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "sizeVariants" });
  const values = useWatch({ control });

  const results = useMemo(() => {
    const safeVal = (v: any) => {
        const n = parseFloat(v);
        return isNaN(n) || !isFinite(n) ? 0 : n;
    };

    const pricingStrategy: Partial<PricingStrategy> = {
        costLanded: safeVal(values.factoryCost) + safeVal(values.chinaShipping),
        strategy: 'smart_import',
        targetMarginPercent: safeVal(values.targetMarginPercent || 60),
        importDetails: { 
            factoryCost: safeVal(values.factoryCost), 
            chinaShipping: safeVal(values.chinaShipping),
            dimensions: { length: safeVal(values.length), width: safeVal(values.width), height: safeVal(values.height) },
            unitsPerBox: safeVal(values.unitsPerBox) || 1,
            freightRatePerCBM: safeVal(values.freightRatePerCBM),
            otherExpenses: safeVal(values.otherExpenses)
        } as any,
        useGlobalSettings: true
    };
    return calculatePricingTier(pricingStrategy, globalSettings);
  }, [values, globalSettings]);
 
  const resetAndClose = () => { 
    reset(); 
    setIsSyncing(false);
    setIsOpen(false); 
  };
  
  const onGenerateDescription = async () => {
    setIsGenerating(true);
    try {
        const result = await generateProductDescription({ 
            name: values.name || '', 
            brand: values.brand || '', 
            category: values.category || '', 
            discipline: values.discipline || '' 
        });
        setValue('features', result.description);
        toast({ title: 'IA Copywriter', description: 'Descripción técnica generada.' });
    } catch (e) {
        toast({ variant: 'destructive', title: 'Error IA', description: 'No se pudo generar la descripción.' });
    } finally {
        setIsGenerating(false);
    }
  };

  const onSubmit = async (data: ProductFormValues) => {
    if (!authUser || !firestore || !currentUser || !results) {
        toast({ variant: 'destructive', title: 'Error Crítico', description: 'Fallo de motor financiero.' });
        return;
    }
    
    setIsSyncing(true);

    try {
        const cleanNumber = (val: any) => isNaN(parseFloat(val)) ? 0 : parseFloat(val);

        const sizesMap: { [key: string]: number } = {};
        let totalStockFromSizes = 0;
        if (data.hasSizes && data.sizeVariants) {
            data.sizeVariants.forEach((v: any) => {
                const s = Math.floor(cleanNumber(v.stock));
                sizesMap[v.label] = s;
                totalStockFromSizes += s;
            });
        }

        const stockVal = data.hasSizes ? totalStockFromSizes : Math.floor(cleanNumber(data.stockLevel));

        await runTransaction(firestore, async (transaction) => {
            const productRef = doc(firestore, 'products', data.sku);
            const pricingRef = doc(firestore, `products/${data.sku}/private/pricing`);
            
            const productDoc = await transaction.get(productRef);
            if (productDoc.exists()) throw new Error(`El SKU '${data.sku}' ya existe.`);

            const productPayload = { 
                id: data.sku, 
                sku: data.sku, 
                name: data.name, 
                brand: data.brand, 
                model: data.model || '', 
                category: data.category, 
                discipline: data.discipline, 
                warehouseLocation: data.warehouseLocation || '',
                features: data.features || '', 
                imageUrl: data.imageUrl || '',
                stockLevel: stockVal, 
                stock: stockVal,
                minStockThreshold: Math.floor(cleanNumber(data.minStockThreshold)) || 5, 
                hasSizes: !!data.hasSizes, 
                sizes: data.hasSizes ? sizesMap : null,
                price: results.priceListBCV, 
                priceCashUSD: results.priceCashUSD, 
                priceEarly7d: results.priceEarly7d, 
                priceEarly15d: results.priceEarly15d, 
                cost: results.landedCost, 
                userId: authUser.uid, 
                createdAt: serverTimestamp(), 
                updatedAt: serverTimestamp() 
            };
            
            transaction.set(productRef, productPayload);
            transaction.set(pricingRef, { 
                landedCost: results.landedCost, 
                netProfit: results.netProfitUSD, 
                strategyDetails: {
                    ...data,
                    sku: data.sku,
                    calculated: results
                }, 
                updatedAt: serverTimestamp(), 
                updatedBy: authUser.uid 
            });
        });

        toast({ title: '¡Producto Sincronizado!' });
        
        try {
            await createAppNotifications(firestore, {
                category: 'Inventario',
                title: `📦 Nuevo Producto: ${data.name}`,
                message: `Se ha registrado el nuevo producto "${data.name}" (SKU: ${data.sku}) en el catálogo con un stock de ${stockVal} un.`,
                link: `/dashboard/inventory?sku=${data.sku}`,
                initiatorId: authUser.uid,
                roles: ['admin', 'gerencia', 'ventas', 'deposito', 'cliente']
            });
        } catch (e) {
            console.warn("[Notifications] Error al notificar nuevo producto:", e);
        }

        resetAndClose();
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Fallo de Persistencia', description: error.message });
        setIsSyncing(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isSyncing && setIsOpen(open)}>
      <DialogTrigger asChild>
        <Button className="font-black uppercase tracking-widest px-8 h-12 rounded-xl shadow-2xl bg-primary hover:bg-primary/90 transition-all active:scale-95">
            <PlusCircle className="mr-2 h-5 w-5" /> Registrar Producto
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] lg:max-w-6xl p-0 overflow-hidden rounded-[2.5rem] border-none shadow-2xl flex flex-col h-full sm:h-[90vh] min-h-0 bg-white">
        <DialogHeader className="p-8 pb-4 bg-slate-900 text-white shrink-0 relative">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-primary/20 text-primary shadow-xl"><Boxes className="h-6 w-6" /></div>
            <div className="text-left">
                <DialogTitle className="text-2xl font-black uppercase tracking-tighter leading-none">Alta de Activos</DialogTitle>
                <DialogDescription className="text-slate-400 font-medium mt-1 uppercase text-[10px] tracking-widest">Sincronización de Catálogo Maestro</DialogDescription>
            </div>
          </div>
          <button onClick={() => !isSyncing && setIsOpen(false)} className="absolute top-8 right-8 text-white/40 hover:text-white transition-colors"><X className="h-6 w-6" /></button>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
            <form onSubmit={handleSubmit(onSubmit)} id="new-product-form" className="p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
                <div className="lg:col-span-4 space-y-10">
                    <section className="space-y-6">
                        <h3 className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-2 px-1"><Tag className="h-4 w-4" /> Identidad Visual</h3>
                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <Label className="text-[10px] font-black uppercase text-slate-500 px-1">SKU / Referencia Técnica</Label>
                                <Controller name="sku" control={control} render={({ field }) => (
                                    <Input {...field} value={field.value ?? ""} className="h-12 border-2 font-mono font-bold uppercase rounded-xl shadow-sm" />
                                )} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-[10px] font-black uppercase text-slate-500 px-1">Nombre Comercial</Label>
                                <Controller name="name" control={control} render={({ field }) => (
                                    <Input {...field} value={field.value ?? ""} className="h-12 bg-slate-50 border-none font-bold rounded-xl shadow-inner" />
                                )} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400 px-1">Marca</Label><Controller name="brand" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} className="h-11 bg-slate-50 border-none font-bold rounded-xl shadow-inner" />} /></div>
                                <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400 px-1">Modelo</Label><Controller name="model" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} className="h-11 bg-slate-50 border-none font-bold rounded-xl shadow-inner" />} /></div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400 px-1">Categoría</Label><Controller name="category" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} className="h-11 bg-slate-50 border-none font-bold rounded-xl shadow-inner" />} /></div>
                                <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-slate-400 px-1">Disciplina</Label><Controller name="discipline" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} className="h-11 bg-slate-50 border-none font-bold rounded-xl shadow-inner" />} /></div>
                            </div>

                            <Separator className="my-4" />
                            
                            <div className="space-y-4">
                                <Label className="text-[10px] font-black uppercase text-primary tracking-[0.4em] flex items-center gap-2 px-1"><ImageIcon className="h-3.5 w-3.5" /> Fotografía Principal</Label>
                                <Controller name="imageUrl" control={control} render={({ field }) => (
                                    <ImageUploader folderPath="products" initialImageUrl={field.value} onImageUploaded={field.onChange} label="Imagen del Equipo" />
                                )} />
                            </div>
                        </div>
                    </section>
                </div>

                <div className="lg:col-span-4 space-y-10">
                    <section className="p-6 sm:p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100 space-y-8 h-full">
                        <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-900 flex items-center gap-2"><Boxes className="h-4 w-4" /> Logística</h3>
                        
                        <div className="space-y-1.5">
                            <Label className="text-[10px] font-black uppercase text-primary flex items-center gap-1.5 px-1"><MapPin className="h-3 w-3" /> Ubicación (Picking)</Label>
                            <Controller name="warehouseLocation" control={control} render={({ field }) => (
                                <Input {...field} value={field.value ?? ""} placeholder="Ej. PASILLO A - ESTANTE 4" className="h-12 bg-white border-primary/20 rounded-xl font-black uppercase text-xs shadow-sm" />
                            )} />
                        </div>

                        <div className="p-5 bg-white rounded-[1.8rem] border-2 border-dashed border-slate-200 flex items-center justify-between shadow-sm group">
                            <Label className="text-xs font-black uppercase tracking-tighter text-slate-700 group-hover:text-primary transition-colors">Gestionar por Variantes (Talla)</Label>
                            <Controller name="hasSizes" control={control} render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
                        </div>

                        {values.hasSizes ? (
                            <div className="space-y-4 animate-in zoom-in-95 duration-300">
                                <Label className="text-[10px] font-black uppercase text-slate-500 px-1">Curva de Tallas e Inventario</Label>
                                <div className="space-y-3">
                                    {fields.map((field, index) => (
                                        <div key={field.id} className="flex gap-3 items-center animate-in slide-in-from-left-2">
                                            <Controller name={`sizeVariants.${index}.label`} control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} placeholder="Talla" className="h-10 font-black text-center w-20 sm:w-24 rounded-xl shadow-inner bg-white border-slate-200" />} />
                                            <Controller name={`sizeVariants.${index}.stock`} control={control} render={({ field }) => <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} placeholder="Cant." className="h-10 font-black text-center flex-1 rounded-xl shadow-inner bg-white border-slate-200" />} />
                                            <Button type="button" variant="ghost" size="icon" className="h-10 w-10 text-rose-500 hover:bg-rose-50 rounded-xl" onClick={() => remove(index)}><Trash2 className="h-4 w-4" /></Button>
                                        </div>
                                    ))}
                                    <Button type="button" variant="outline" size="sm" onClick={() => append({ label: '', stock: 0 })} className="w-full h-11 rounded-xl border-dashed font-black uppercase text-[9px] tracking-widest text-primary hover:bg-primary/5 transition-all">
                                        <PlusCircle className="mr-1.5 h-4 w-4" /> Añadir Nueva Variante
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] font-black uppercase text-slate-500 px-1">Stock Inicial</Label>
                                    <Controller name="stockLevel" control={control} render={({ field }) => <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="h-16 text-3xl font-black text-center rounded-2xl bg-white border-none shadow-inner" />} />
                                </div>
                            </div>
                        )}

                        <div className="space-y-3">
                            <div className="flex items-center justify-between px-1">
                                <Label className="text-[10px] font-black uppercase text-slate-500">Descripción Técnica</Label>
                                <Button type="button" variant="ghost" size="sm" onClick={onGenerateDescription} disabled={isGenerating} className="h-8 text-[9px] font-black uppercase tracking-widest text-primary hover:bg-primary/5 transition-all">
                                    {isGenerating ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Zap className="h-3 w-3 mr-1.5 animate-pulse" />} Redactar IA
                                </Button>
                            </div>
                            <Controller name="features" control={control} render={({ field }) => <Textarea {...field} value={field.value ?? ""} placeholder="Describe el material, agarre..." className="min-h-[160px] rounded-[1.8rem] bg-white border-slate-200 font-medium text-sm leading-relaxed p-5 shadow-sm" />} />
                        </div>
                    </section>
                </div>

                <div className="lg:col-span-4 h-full">
                    <div className="p-8 bg-slate-900 text-white rounded-[2.5rem] shadow-2xl flex flex-col h-full relative group">
                        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform duration-700 pointer-events-none"><Calculator className="h-32 w-32" /></div>
                        <div className="relative z-10 space-y-10 h-full flex flex-col">
                            <h3 className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-2 relative z-10"><Zap className="h-4 w-4" /> Smart Pricing Studio</h3>
                            <Separator className="bg-white/10 relative z-10" />
                            
                            <div className="space-y-8 relative z-10 flex-1">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5"><Label className="text-[9px] font-bold uppercase text-slate-400 px-1">Costo Fábrica (USD)</Label><Controller name="factoryCost" control={control} render={({ field }) => <Input type="number" step="0.01" {...field} value={isNaN(field.value) ? "" : field.value} className="h-11 bg-white/5 border-white/10 font-bold rounded-xl text-white" />} /></div>
                                    <div className="space-y-1.5"><Label className="text-[9px] font-bold uppercase text-slate-400 px-1">Flete un. (USD)</Label><Controller name="chinaShipping" control={control} render={({ field }) => <Input type="number" step="0.01" {...field} value={isNaN(field.value) ? "" : field.value} className="h-11 bg-white/5 border-white/10 font-bold rounded-xl text-white" />} /></div>
                                </div>
                                <div className="space-y-3 pt-2">
                                    <div className="flex justify-between items-center px-1">
                                        <Label className="text-[9px] font-bold uppercase text-slate-400">Margen Neto Objetivo</Label>
                                        <span className="text-primary font-black text-xl">{values.targetMarginPercent}%</span>
                                    </div>
                                    <Controller name="targetMarginPercent" control={control} render={({ field }) => <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="h-14 bg-white/10 border-none text-3xl font-black text-primary rounded-2xl text-center shadow-inner" />} />
                                </div>
                            </div>

                            <div className="mt-auto space-y-8 pt-6 border-t border-white/10 relative z-10">
                                <div className="flex justify-between items-center px-1">
                                    <div className="space-y-0.5"><p className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Landed Cost</p><p className="text-2xl font-black text-white tracking-tighter">${Number(results?.landedCost || 0).toFixed(2)}</p></div>
                                    <div className="text-right space-y-0.5"><p className="text-[10px] font-black uppercase text-emerald-500 tracking-widest">Utilidad Est.</p><p className="text-2xl font-black text-emerald-400 tracking-tighter">+${Number(results?.netProfitUSD || 0).toFixed(2)}</p></div>
                                </div>
                                <div className="space-y-2">
                                    <div className="bg-white p-6 rounded-[2.2rem] shadow-2xl text-center border-none transition-transform group-hover:scale-[1.03]">
                                        <p className="text-[10px] font-black uppercase text-slate-400 tracking-[0.3em] mb-1">Sugerido Divisa (CASH)</p>
                                        <p className="text-5xl sm:text-6xl font-black text-slate-900 tracking-tighter leading-none">${Number(results?.priceCashUSD || 0).toFixed(2)}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </form>
        </ScrollArea>

        <DialogFooter className="p-8 bg-slate-50 border-t flex flex-col sm:flex-row items-center justify-between gap-6 shrink-0">
            <div className="hidden sm:flex items-center gap-3 text-slate-400">
                <ShieldCheck className="h-6 w-6 text-emerald-500" />
                <p className="text-[10px] font-black uppercase tracking-[0.2em]">Protocolo de Red Athleticenter Certificado</p>
            </div>
            <div className="flex items-center gap-4 w-full sm:w-auto">
                <Button variant="ghost" onClick={resetAndClose} className="font-black uppercase tracking-widest h-14 px-8 text-xs text-slate-400 hover:text-slate-900 transition-all">Cancelar</Button>
                <Button 
                    type="submit" 
                    form="new-product-form" 
                    disabled={isSyncing || !results} 
                    className="font-black uppercase tracking-[0.25em] h-14 px-12 rounded-2xl shadow-2xl bg-primary shadow-primary/20 hover:bg-primary/90 transition-all active:scale-95 text-sm sm:text-lg flex-1 sm:flex-none"
                >
                    {isSyncing ? <Loader2 className="animate-spin h-6 w-6 mr-3" /> : <Save className="h-6 w-6 mr-3" />} REGISTRAR EN RED
                </Button>
            </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}