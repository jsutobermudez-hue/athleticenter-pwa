'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Edit, Save, Calculator, Zap, Lock, ShieldCheck, Tag, Boxes, MapPin, X, Box, DollarSign, ImageIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Product, FinancialSettings, PricingStrategy } from '@/lib/definitions';
import { useDoc, useFirestore, useUser, useMemoFirebase } from '@/firebase';
import { ImageUploader } from '@/components/ui/image-uploader';
import { doc, serverTimestamp, runTransaction, getDoc, collection } from 'firebase/firestore';
import { generateProductDescription } from '@/ai/flows/generate-product-description';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { calculatePricingTier } from '@/lib/pricing';
import { createAppNotifications } from '@/lib/notifications';

const productEditSchema = z.object({
    name: z.string().min(1, "El nombre es requerido."),
    brand: z.string().min(1, "La marca es requerida."),
    model: z.string().optional().default(''),
    features: z.string().optional().default(''),
    category: z.string().min(1, "La categoría es requerida."),
    discipline: z.string().min(1, "La disciplina es requerida."),
    warehouseLocation: z.string().optional().default(''),
    imageUrl: z.string().optional().default(''),
    stockLevel: z.coerce.number().min(0, "Mínimo 0"),
    minStockThreshold: z.coerce.number().min(0).default(5),
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

type ProductEditFormValues = z.infer<typeof productEditSchema>;

export function EditProductDialog({ product, useTriggerButton = false }: { product: Product; useTriggerButton?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();
  const { profile: currentUser } = useUser();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingPrivate, setIsLoadingPrivate] = useState(false);

  const canManageFinance = ['superadmin', 'admin', 'gerencia'].includes(currentUser?.role || '');

  const settingsRef = useMemoFirebase(() => (firestore ? doc(firestore, 'system', 'financials') : null), [firestore]);
  const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);

  const { control, handleSubmit, reset, setValue, formState: { isSubmitting, errors } } = useForm<ProductEditFormValues>({
      resolver: zodResolver(productEditSchema),
      defaultValues: {
          name: product.name, 
          brand: product.brand || '', 
          model: product.model || '', 
          features: product.features || '',
          category: product.category, 
          discipline: product.discipline || '', 
          imageUrl: product.imageUrl || '',
          stockLevel: product.stockLevel ?? (product as any).stock ?? 0, 
          minStockThreshold: product.minStockThreshold || 5,
          warehouseLocation: product.warehouseLocation || '',
          factoryCost: 0, 
          chinaShipping: 0, 
          length: 10, 
          width: 10, 
          height: 10, 
          unitsPerBox: 1,
          freightRatePerCBM: 450, 
          otherExpenses: 0, 
          targetMarginPercent: 60, 
          useManualPVP: true, 
          manualPVP: product.price || 0
      }
  });

  const values = useWatch({ control });

  const results = useMemo(() => {
    const safeVal = (v: any) => {
        const n = parseFloat(v);
        return isNaN(n) || !isFinite(n) ? 0 : n;
    };

    const strategy: Partial<PricingStrategy> = {
        costLanded: safeVal(values.factoryCost) + safeVal(values.chinaShipping),
        strategy: values.useManualPVP ? 'target_price' : 'target_margin',
        targetMarginPercent: safeVal(values.targetMarginPercent),
        targetPriceUSD: safeVal(values.manualPVP),
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
    return calculatePricingTier(strategy, globalSettings);
  }, [values, globalSettings]);

  useEffect(() => {
    if (isOpen && firestore) {
        setIsLoadingPrivate(true);
        const pricingRef = doc(firestore, `products/${product.id}/private/pricing`);
        getDoc(pricingRef).then(snap => {
            const commonData = {
                name: product.name,
                brand: product.brand || '',
                model: product.model || '',
                features: product.features || '',
                category: product.category,
                discipline: product.discipline || '',
                warehouseLocation: product.warehouseLocation || '',
                imageUrl: product.imageUrl || '',
                stockLevel: Number(product.stockLevel ?? (product as any).stock ?? 0),
                minStockThreshold: product.minStockThreshold || 5,
            };

            if (snap.exists() && canManageFinance) {
                const p = snap.data();
                const s = p.strategyDetails;
                reset({
                    ...commonData,
                    factoryCost: s?.importDetails?.factoryCost || 0,
                    chinaShipping: s?.importDetails?.chinaShipping || 0,
                    length: s?.importDetails?.dimensions?.length || 10,
                    width: s?.importDetails?.dimensions?.width || 10,
                    height: s?.importDetails?.dimensions?.height || 10,
                    unitsPerBox: s?.importDetails?.unitsPerBox || 1,
                    freightRatePerCBM: s?.importDetails?.freightRatePerCBM || 450,
                    otherExpenses: s?.importDetails?.otherExpenses || 0,
                    targetMarginPercent: s?.targetMarginPercent || 60,
                    useManualPVP: true,
                    manualPVP: product.price || 0
                });
            } else {
                reset({
                    ...commonData,
                    factoryCost: product.cost || 0,
                    chinaShipping: 0,
                    useManualPVP: true,
                    manualPVP: product.price || 0,
                    targetMarginPercent: 60
                });
            }
            setIsLoadingPrivate(false);
        }).catch(() => setIsLoadingPrivate(false));
    }
  }, [isOpen, product, firestore, canManageFinance, reset]);

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
        toast({ title: 'IA Copywriter', description: 'Descripción técnica actualizada.' });
    } catch (e) {
        toast({ variant: 'destructive', title: 'Error de IA', description: 'No se pudo generar el texto.' });
    } finally {
        setIsGenerating(false);
    }
  };

  const onSubmit = async (data: ProductEditFormValues) => {
    if (!firestore || !currentUser || !results) return;
    try {
        const cleanNumber = (val: any) => isNaN(parseFloat(val)) ? 0 : parseFloat(val);
        let stockIncreased = false;
        let diff = 0;

        await runTransaction(firestore, async (transaction) => {
            const productRef = doc(firestore, 'products', product.id!);
            const pricingRef = doc(firestore, `products/${product.id}/private/pricing`);
            
            const prodSnap = await transaction.get(productRef);
            if (!prodSnap.exists()) throw new Error("Producto no encontrado.");

            const oldStockVal = prodSnap.data()?.stockLevel || 0;
            const stockVal = Math.floor(cleanNumber(data.stockLevel));
            diff = stockVal - oldStockVal;
            if (diff > 0) {
                stockIncreased = true;
            }

            const productPayload = {
                name: data.name,
                brand: data.brand,
                model: data.model,
                features: data.features,
                category: data.category,
                discipline: data.discipline,
                warehouseLocation: data.warehouseLocation,
                imageUrl: data.imageUrl || '',
                stockLevel: stockVal,
                stock: stockVal,
                minStockThreshold: Math.floor(cleanNumber(data.minStockThreshold)),
                price: results.priceListBCV,
                priceCashUSD: results.priceCashUSD,
                priceEarly7d: results.priceEarly7d,
                priceEarly15d: results.priceEarly15d,
                cost: results.landedCost, 
                updatedAt: serverTimestamp(),
                updatedBy: currentUser.id
            };

            if (canManageFinance) {
                const pricingPayload = {
                    landedCost: results.landedCost,
                    netProfit: results.netProfitUSD,
                    strategyDetails: {
                        ...data,
                        strategy: data.useManualPVP ? 'target_price' : 'smart_import',
                        calculated: results
                    },
                    updatedAt: serverTimestamp(),
                    updatedBy: currentUser.id
                };
                transaction.set(pricingRef, pricingPayload, { merge: true });
            }

            const oldPrice = prodSnap.data()?.price || 0;
            const newPrice = results.priceListBCV;
            if (Math.abs(oldPrice - newPrice) > 0.001) {
                const historyRef = doc(collection(firestore, `products/${product.id}/priceHistory`));
                transaction.set(historyRef, {
                    previousPrice: oldPrice,
                    newPrice,
                    previousCashPrice: prodSnap.data()?.priceCashUSD || 0,
                    newCashPrice: results.priceCashUSD,
                    updatedBy: currentUser.id,
                    updatedByName: currentUser.name || 'Admin',
                    timestamp: serverTimestamp()
                });
            }

            transaction.update(productRef, productPayload as any);
        });

        toast({ title: '¡Producto Sincronizado!' });

        try {
            const { logActivity } = await import('@/lib/audit');
            const oldPrice = product.price || 0;
            const newPrice = results.priceListBCV;
            const isPriceChange = Math.abs(oldPrice - newPrice) > 0.001;

            await logActivity(firestore, {
                userId: currentUser.id,
                userName: currentUser.name || 'Admin',
                userRole: currentUser.role,
                action: isPriceChange ? 'EDIT_PRODUCT_PRICE' : 'CREATE_PRODUCT',
                resource: 'products',
                module: 'inventory',
                resourceId: product.id,
                severity: isPriceChange ? 'warning' : 'info',
                details: isPriceChange 
                    ? `Se actualizó el precio de "${data.name}" (SKU: ${product.sku}) de $${oldPrice.toFixed(2)} USD a $${newPrice.toFixed(2)} USD.`
                    : `Se actualizaron los datos del producto "${data.name}" (SKU: ${product.sku}, Stock: ${data.stockLevel} un.).`,
                previousState: { price: oldPrice, stock: product.stockLevel },
                newState: { price: newPrice, stock: data.stockLevel }
            });
        } catch (auditErr) {
            console.warn("[Audit] Error al registrar auditoría de producto:", auditErr);
        }

        if (stockIncreased) {
            try {
                await createAppNotifications(firestore, {
                    category: 'Inventario',
                    title: `📈 Reposición de Stock: ${data.name}`,
                    message: `Se ha repuesto el inventario de "${data.name}" (SKU: ${product.sku}). Ingreso de +${diff} un. (Stock total actual: ${data.stockLevel} un.).`,
                    link: `/dashboard/inventory?sku=${product.sku}`,
                    initiatorId: currentUser.id,
                    roles: ['admin', 'gerencia', 'ventas', 'deposito', 'cliente']
                });
            } catch (notifyErr) {
                console.warn("[Notifications] Error al notificar reposición de stock:", notifyErr);
            }
        }

        setIsOpen(false);
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {useTriggerButton ? (
            <Button variant="outline" className="h-12 border-slate-200 font-black uppercase text-[10px] tracking-widest rounded-xl transition-all active:scale-95 shadow-sm">
                <Edit className="mr-2 h-4 w-4 text-primary" /> Modificar Ficha
            </Button>
        ) : (
            <button className="w-full text-left p-2 text-sm hover:bg-accent rounded-md">Editar Producto</button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] lg:max-w-6xl p-0 overflow-hidden rounded-[2.5rem] h-full sm:h-[90vh] border-none shadow-2xl flex flex-col min-h-0">
        <div className="flex flex-col h-full bg-white min-h-0">
            <DialogHeader className="p-8 pb-4 bg-slate-900 text-white shrink-0 text-left relative">
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-white/10 text-white shadow-xl"><Edit className="h-6 w-6" /></div>
                    <div className="space-y-0.5">
                        <DialogTitle className="text-2xl sm:text-3xl font-black uppercase tracking-tighter leading-none">Editor de Catálogo Maestro</DialogTitle>
                        <DialogDescription className="italic font-medium text-[10px] uppercase text-slate-400 tracking-widest mt-1">Sincronizando SKU: {product.sku}</DialogDescription>
                    </div>
                </div>
                <button onClick={() => setIsOpen(false)} className="absolute top-8 right-8 text-white/40 hover:text-white transition-colors"><X className="h-6 w-6" /></button>
            </DialogHeader>

            <ScrollArea className="flex-1 min-h-0">
                <form onSubmit={handleSubmit(onSubmit)} id="edit-product-form" className="p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
                    <div className="lg:col-span-4 space-y-10">
                        <section className="space-y-6">
                            <h3 className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-2 px-1"><Tag className="h-4 w-4" /> Identidad Visual</h3>
                            <div className="space-y-4">
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase font-bold text-slate-500 px-1">Nombre Comercial</Label>
                                    <Controller name="name" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} className="h-11 font-bold rounded-xl bg-slate-50 border-none shadow-inner" />} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5"><Label className="text-[10px] uppercase font-bold text-slate-500 px-1">Marca</Label><Controller name="brand" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} className="h-11 rounded-xl bg-slate-50 border-none font-bold" />} /></div>
                                    <div className="space-y-1.5"><Label className="text-[10px] uppercase font-bold text-slate-500 px-1">Modelo</Label><Controller name="model" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} className="h-11 rounded-xl bg-slate-50 border-none font-bold" />} /></div>
                                </div>

                                <Separator className="my-4" />

                                <div className="space-y-4">
                                    <Label className="text-[10px] font-black uppercase tracking-[0.4em] text-primary flex items-center gap-2 px-1"><ImageIcon className="h-3.5 w-3.5" /> Fotografía Principal</Label>
                                    <Controller name="imageUrl" control={control} render={({ field }) => (
                                        <ImageUploader folderPath="products" initialImageUrl={field.value} onImageUploaded={field.onChange} label="Imagen del Equipo" />
                                    )} />
                                </div>
                            </div>
                        </section>
                    </div>

                    <div className="lg:col-span-4 space-y-10">
                        <section className="p-6 sm:p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100 space-y-8">
                            <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-900 flex items-center gap-2"><Boxes className="h-4 w-4" /> Almacén</h3>
                            <div className="space-y-1.5">
                                <Label className="text-[10px] font-black uppercase text-primary flex items-center gap-1.5 px-1"><MapPin className="h-3 w-3" /> Ubicación (Picking)</Label>
                                <Controller name="warehouseLocation" control={control} render={({ field }) => <Input {...field} value={field.value ?? ""} placeholder="PASILLO / ESTANTE" className="h-12 border-primary/20 bg-white font-black uppercase text-xs rounded-xl shadow-sm" />} />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase font-bold text-slate-500 px-1">Existencias</Label>
                                    <Controller name="stockLevel" control={control} render={({ field }) => <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="h-14 text-2xl font-black text-center rounded-2xl bg-white border-none shadow-inner" />} />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase font-bold text-slate-500 px-1">Mínimo Alerta</Label>
                                    <Controller name="minStockThreshold" control={control} render={({ field }) => <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="h-14 text-2xl font-black text-center rounded-2xl bg-white border-none shadow-inner" />} />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between px-1">
                                    <Label className="text-[10px] uppercase font-bold text-slate-500">Descripción Técnica</Label>
                                    <Button type="button" variant="ghost" size="sm" onClick={onGenerateDescription} disabled={isGenerating} className="h-8 text-[9px] font-black uppercase text-primary tracking-widest hover:bg-primary/5">
                                        {isGenerating ? <Loader2 className="animate-spin h-3 w-3 mr-1.5" /> : <Zap className="h-3 w-3 mr-1.5 animate-pulse" />} IA Copywriter
                                    </Button>
                                </div>
                                <Controller name="features" control={control} render={({ field }) => <Textarea {...field} value={field.value ?? ""} className="min-h-[220px] rounded-2xl bg-white border-slate-200 text-sm font-medium" />} />
                            </div>
                        </section>
                    </div>

                    <div className="lg:col-span-4 h-full">
                        {canManageFinance ? (
                            <div className="p-8 bg-slate-900 text-white rounded-[2.5rem] shadow-2xl h-full flex flex-col gap-8 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform duration-700 pointer-events-none"><Calculator className="h-32 w-32" /></div>
                                <h3 className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-2 relative z-10"><Zap className="h-4 w-4" /> Smart Pricing Studio</h3>
                                <Separator className="bg-white/10 relative z-10" />
                                
                                {isLoadingPrivate ? (
                                    <div className="flex-1 flex flex-col items-center justify-center gap-4 animate-pulse"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Recuperando Estrategia...</p></div>
                                ) : (
                                    <div className="space-y-8 relative z-10 flex-1 flex flex-col">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1.5"><Label className="text-[9px] uppercase text-slate-400 px-1">Costo Fábrica (USD)</Label><Controller name="factoryCost" control={control} render={({ field }) => <Input type="number" step="0.01" {...field} value={isNaN(field.value) ? "" : field.value} className="h-11 bg-white/5 border-white/10 text-white font-bold rounded-xl" />} /></div>
                                            <div className="space-y-1.5"><Label className="text-[9px] uppercase text-slate-400 px-1">Flete un. (USD)</Label><Controller name="chinaShipping" control={control} render={({ field }) => <Input type="number" step="0.01" {...field} value={isNaN(field.value) ? "" : field.value} className="h-11 bg-white/5 border-white/10 text-white font-bold rounded-xl" />} /></div>
                                        </div>
                                        <div className="space-y-6 p-6 bg-white/5 rounded-[2rem] border border-white/10 shadow-inner">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-xs font-black uppercase text-primary">Protección PVP Manual</Label>
                                                <Controller name="useManualPVP" control={control} render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
                                            </div>
                                            {values.useManualPVP ? (
                                                <div className="space-y-4 animate-in slide-in-from-top-2">
                                                    <div className="flex justify-between items-center px-1">
                                                        <Label className="text-[10px] uppercase font-bold text-primary">Margen Neto Deseado</Label>
                                                        <span className="text-xl font-black text-primary">{Number(results?.netMarginPercent || 0).toFixed(1)}%</span>
                                                    </div>
                                                    <Controller name="manualPVP" control={control} render={({ field }) => <Input type="number" step="0.01" {...field} value={isNaN(field.value) ? "" : field.value} className="h-16 text-4xl font-black bg-white/10 border-primary/30 text-primary rounded-2xl text-center shadow-inner" />} />
                                                </div>
                                            ) : (
                                                <div className="space-y-4 animate-in slide-in-from-bottom-2">
                                                    <div className="flex justify-between items-center px-1">
                                                        <Label className="text-[10px] uppercase font-bold text-primary">Margen Neto Deseado</Label>
                                                        <span className="text-xl font-black text-primary">{values.targetMarginPercent}%</span>
                                                    </div>
                                                    <Controller name="targetMarginPercent" control={control} render={({ field }) => <Input type="number" {...field} value={isNaN(field.value) ? "" : field.value} className="h-16 bg-white/10 border-primary/30 text-primary rounded-2xl text-center text-4xl font-black shadow-inner" />} />
                                                </div>
                                            )}
                                        </div>

                                        <div className="mt-auto pt-6 border-t border-white/10 space-y-5">
                                            <div className="flex justify-between items-end">
                                                <div className="space-y-0.5"><p className="text-[9px] uppercase text-slate-500 font-black tracking-widest">Landed Cost</p><p className="text-2xl font-black text-white tracking-tighter">${results.landedCost.toFixed(2)}</p></div>
                                                <div className="text-right space-y-0.5"><p className="text-[9px] uppercase text-emerald-500 font-black tracking-widest">Utilidad Neta</p><p className={cn("text-2xl font-black", (results?.netProfitUSD ?? 0) < 0 ? "text-rose-400" : "text-emerald-400")}>${results.netProfitUSD.toFixed(2)}</p></div>
                                            </div>
                                            <div className="bg-white p-6 rounded-[2.2rem] shadow-2xl text-center border-none">
                                                <p className="text-[10px] font-black uppercase text-slate-400 tracking-[0.3em] mb-1">Divisa CASH (Sugerido)</p>
                                                <p className="text-5xl sm:text-6xl font-black text-slate-900 tracking-tighter leading-none">${results.priceCashUSD.toFixed(2)}</p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="p-12 border-2 border-dashed rounded-[2.5rem] flex flex-col items-center justify-center text-center gap-6 bg-muted/5 opacity-50 h-full">
                                <Lock className="h-16 w-16 text-muted-foreground" />
                                <div className="space-y-2"><p className="text-sm font-black uppercase tracking-widest text-slate-400">Acceso Financiero Denegado</p><p className="text-[10px] font-bold text-slate-300 uppercase leading-relaxed">Requiere Rol: Admin o Gerencia</p></div>
                            </div>
                        )}
                    </div>
                </form>
            </ScrollArea>

            <DialogFooter className="p-8 bg-slate-50 border-t flex flex-col sm:flex-row items-center justify-between gap-6 shrink-0">
                <div className="hidden sm:flex items-center gap-3 text-slate-400">
                    <ShieldCheck className="h-5 w-5 text-emerald-500" />
                    <p className="text-[9px] font-black uppercase tracking-widest">Protocolo de Red Athleticenter v6.0 Certificado</p>
                </div>
                <div className="flex gap-4 w-full sm:w-auto">
                    <Button variant="ghost" onClick={() => setIsOpen(false)} className="font-black uppercase tracking-widest h-14 px-10 text-xs text-slate-400">Cancelar</Button>
                    <Button type="submit" form="edit-product-form" disabled={isSubmitting || isLoadingPrivate} className="font-black uppercase tracking-[0.25em] h-14 px-12 rounded-2xl shadow-2xl bg-primary hover:bg-primary/90 transition-all active:scale-95 text-sm sm:text-lg flex-1 sm:flex-none">
                        {isSubmitting ? <Loader2 className="animate-spin h-6 w-6 mr-3" /> : <Save className="h-6 w-6 mr-3" />} SINCRONIZAR CAMBIOS
                    </Button>
                </div>
            </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}