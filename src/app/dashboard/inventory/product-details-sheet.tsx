'use client';

import React, { useMemo, useState } from 'react';
import type { Product, Offer, StockHistory } from '@/lib/definitions';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { 
    ImageIcon, 
    DollarSign, 
    Archive, 
    TrendingUp, 
    History, 
    Lock, 
    Clock, 
    CheckCircle2, 
    Package, 
    ArrowRight, 
    Trash2, 
    Loader2, 
    Info, 
    ShieldCheck, 
    Landmark, 
    Activity, 
    Zap, 
    Box,
    MapPin,
    Maximize2
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EditProductDialog } from './edit-product-dialog';
import { AdjustStockDialog } from './adjust-stock-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUser, useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface ProductDetailsSheetProps {
  product: Product | null;
  allOffers: Offer[] | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  canManageInventory: boolean;
  canDelete: boolean;
  onDelete: (product: Product) => void;
}

const getStatus = (stock: number | null | undefined) => {
    if (typeof stock !== 'number') return 'Desconocido';
    if (stock === 0) return 'Agotado';
    if (stock < 10) return 'Pocas existencias';
    return 'En stock';
};

/**
 * FICHA DE DETALLES v5.0.0 - REVERSIÓN ESTABLE
 * Sincronización: Retorno a sistema de fotografía única para máxima velocidad de red.
 */
export function ProductDetailsSheet({ product, allOffers, isOpen, onOpenChange, canManageInventory, canDelete, onDelete }: ProductDetailsSheetProps) {
  const { profile: currentUser } = useUser();
  const firestore = useFirestore();
  
  const isStaff = currentUser && ['superadmin', 'admin', 'gerencia', 'deposito'].includes(currentUser.role);
  const canSeeCost = currentUser && ['admin', 'superadmin', 'gerencia'].includes(currentUser.role);

  const historyQuery = useMemoFirebase(() => (firestore && product && isOpen && isStaff) ? query(
    collection(firestore, `products/${product.id}/stockHistory`),
    orderBy('createdAt', 'desc'),
    limit(50)
  ) : null, [firestore, product, isOpen, isStaff]);

  const { data: stockHistory, isLoading: isLoadingHistory } = useCollection<StockHistory>(historyQuery);

  if (!product) return null;

  const stockValue = product.stockLevel ?? (product as any).stock ?? 0;
  const status = getStatus(stockValue);
  
  const pvpBCV = product.price || 0;
  const pvpCash = (product.priceCashUSD && product.priceCashUSD > 0) ? product.priceCashUSD : (pvpBCV * 0.65);
  
  const price7d = (product.priceEarly7d && product.priceEarly7d > 0) ? product.priceEarly7d : (pvpBCV * 0.90);
  const price15d = (product.priceEarly15d && product.priceEarly15d > 0) ? product.priceEarly15d : (pvpBCV * 0.95);

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl lg:max-w-2xl p-0 flex flex-col border-none rounded-l-[2.5rem] shadow-2xl overflow-hidden">
        <SheetHeader className="p-8 pb-4 bg-slate-50 border-b shrink-0">
            <div className='flex items-center gap-5'>
                <Dialog>
                    <DialogTrigger asChild>
                        <div className="relative h-20 w-20 rounded-[1.5rem] border shadow-xl cursor-zoom-in group bg-white overflow-hidden shrink-0">
                            {product.imageUrl ? (
                                <img src={product.imageUrl} alt={product.name} className="object-cover w-full h-full transition-transform group-hover:scale-110 duration-500" />
                            ) : (
                                <div className="h-full w-full flex items-center justify-center bg-muted text-slate-300">
                                    <ImageIcon className="h-10 w-10" />
                                </div>
                            )}
                            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <Maximize2 className="text-white h-4 w-4" />
                            </div>
                        </div>
                    </DialogTrigger>
                    <DialogContent className="max-w-[90vw] lg:max-w-3xl bg-black/95 border-none shadow-none p-4 rounded-[2.5rem] flex items-center justify-center">
                        <DialogHeader className="sr-only">
                            <DialogTitle>Imagen de {product.name}</DialogTitle>
                        </DialogHeader>
                        {product.imageUrl && <img src={product.imageUrl} alt={product.name} className="max-w-full max-h-[85vh] rounded-2xl object-contain shadow-2xl" />}
                    </DialogContent>
                </Dialog>

                <div className='flex-1 space-y-1 text-left'>
                    <SheetTitle className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-tight">{product.name || 'Producto'}</SheetTitle>
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono font-bold text-primary border-primary/20 bg-primary/5 uppercase text-[9px] tracking-widest h-5 px-2">SKU: {product.sku || 'N/A'}</Badge>
                        <Badge variant="secondary" className="text-[8px] font-black uppercase bg-slate-900 text-white border-none px-2 h-5 rounded-lg shadow-sm">{product.discipline || 'ELITE'}</Badge>
                    </div>
                </div>
            </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
            <div className="p-8 space-y-8">
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 flex items-center gap-3 animate-in slide-in-from-top-2">
                    <Info className="h-5 w-5 text-amber-600 shrink-0" />
                    <p className="text-[10px] font-black uppercase text-amber-800 tracking-widest leading-relaxed">
                        Precios representan la <span className="text-amber-950 font-black">BASE IMPONIBLE</span>. El IVA (16%) se sumará al conciliar pagos fiscales.
                    </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-5 rounded-[1.8rem] border border-slate-100 bg-white shadow-sm space-y-1 group hover:border-primary/20 transition-all">
                        <div className="flex items-center justify-between text-slate-400">
                            <div className="flex items-center gap-2">
                                <Landmark className="h-4 w-4 text-primary" />
                                <p className="text-[9px] font-black uppercase tracking-widest">Precio Lista (BCV)</p>
                            </div>
                        </div>
                        <p className="font-black text-3xl text-slate-900 tracking-tighter leading-none">${pvpBCV.toFixed(2)}</p>
                        <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest pt-1">Base Imponible Ofic.</p>
                    </div>

                    <div className="p-5 rounded-[1.8rem] border border-emerald-100 bg-emerald-50/30 shadow-sm space-y-1 group hover:bg-emerald-50 transition-all">
                        <div className="flex items-center justify-between text-emerald-600">
                            <div className="flex items-center gap-2">
                                <DollarSign className="h-4 w-4" />
                                <p className="text-[9px] font-black uppercase tracking-widest">Divisa CASH (USD)</p>
                            </div>
                            <Zap className="h-3 w-3 animate-pulse" />
                        </div>
                        <p className="font-black text-3xl text-emerald-700 tracking-tighter leading-none">${pvpCash.toFixed(2)}</p>
                        <p className="text-[8px] font-bold text-emerald-600 uppercase tracking-widest pt-1">Incentivo Red Aplicado</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-5 rounded-[1.8rem] border border-slate-100 bg-white shadow-sm space-y-1">
                        <div className="flex items-center gap-2 text-slate-400">
                            <Box className="h-4 w-4" />
                            <p className="text-[9px] font-black uppercase tracking-widest">{isStaff ? 'Existencias Almacén' : 'Disponibilidad B2B'}</p>
                        </div>
                        <div className="flex items-baseline gap-2 pt-1">
                            <p className="font-black text-2xl text-slate-900 tracking-tighter leading-none">
                                {isStaff ? stockValue : (stockValue > 10 ? 'DISPONIBLE' : stockValue > 0 ? 'ÚLTIMAS UNIDADES' : 'SIN STOCK')}
                            </p>
                            {isStaff && <span className="text-[9px] font-bold text-slate-400 uppercase">Unidades</span>}
                        </div>
                        <Badge className={cn("mt-2 text-[8px] font-black uppercase border-none px-2 h-5 shadow-none", stockValue > 10 ? 'bg-emerald-100 text-emerald-700' : stockValue > 0 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700')}>
                            {stockValue > 10 ? (isStaff ? 'EN STOCK' : 'ENTREGA INMEDIATA') : stockValue > 0 ? 'ALERTA STOCK' : 'AGOTADO'}
                        </Badge>
                    </div>

                    {isStaff ? (
                        <div className="p-5 rounded-[1.8rem] border border-slate-100 bg-white shadow-sm space-y-1">
                            <div className="flex items-center gap-2 text-slate-400">
                                <MapPin className="h-4 w-4" />
                                <p className="text-[9px] font-black uppercase tracking-widest">Ubicación Depósito</p>
                            </div>
                            <p className="font-black text-lg text-slate-700 tracking-tight uppercase truncate">{product.warehouseLocation || 'Sin Asignar'}</p>
                            <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest pt-1">Referencia Picking</p>
                        </div>
                    ) : (
                        <div className="p-5 rounded-[1.8rem] border border-slate-100 bg-white shadow-sm space-y-1">
                            <div className="flex items-center gap-2 text-slate-400">
                                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                                <p className="text-[9px] font-black uppercase tracking-widest">Garantía Corporativa</p>
                            </div>
                            <p className="font-black text-lg text-slate-900 tracking-tight uppercase truncate">ATHLETICENTER C.A.</p>
                            <p className="text-[8px] font-bold text-emerald-600 uppercase tracking-widest pt-1">Despacho Certificado B2B</p>
                        </div>
                    )}
                </div>

                <Tabs defaultValue="info" className="w-full">
                    <TabsList className={cn("grid w-full h-11 bg-slate-100 p-1 rounded-xl mb-8", isStaff ? "grid-cols-2" : "grid-cols-1")}>
                        <TabsTrigger value="info" className="rounded-lg font-black uppercase text-[9px] tracking-widest">Especificaciones</TabsTrigger>
                        {isStaff && <TabsTrigger value="audit" className="rounded-lg font-black uppercase text-[9px] tracking-widest">Auditoría</TabsTrigger>}
                    </TabsList>

                    <TabsContent value="info" className="space-y-8 mt-0 animate-in fade-in-0 duration-500">
                        {canSeeCost && (
                            <div className="p-6 rounded-[2.5rem] bg-slate-900 text-white flex justify-between items-center relative overflow-hidden group shadow-xl">
                                <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:rotate-12 transition-transform duration-1000"><Activity className="h-20 w-20" /></div>
                                <div className="space-y-1 relative z-10">
                                    <p className="text-[10px] font-black uppercase text-primary tracking-[0.3em]">Costo Promedio (WAC)</p>
                                    <p className="text-4xl font-black text-white tracking-tighter">${(product.cost || 0).toFixed(2)}</p>
                                    <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest italic">Sincerado mediante Protocolo de Red</p>
                                </div>
                                <Badge className="bg-primary text-white font-black uppercase text-[8px] tracking-widest border-none px-3 h-6 relative z-10 shadow-lg">ACTIVO AUDITADO</Badge>
                            </div>
                        )}

                        <div className="p-6 rounded-[2.5rem] bg-emerald-50 border border-emerald-100 space-y-4 shadow-inner">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-700 flex items-center gap-2 px-1"><Zap className="h-4 w-4 animate-pulse" /> Escala de Ahorro Pronto Pago</h3>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-white p-5 rounded-2xl shadow-sm border border-emerald-100 flex flex-col items-center gap-1">
                                    <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">Tier 1 (0-7 DÍAS)</span>
                                    <p className="text-2xl font-black text-emerald-700 tracking-tighter">${price7d.toFixed(2)}</p>
                                    <Badge className="bg-emerald-100 text-emerald-700 border-none text-[7px] font-black uppercase">-10% DESCUENTO</Badge>
                                </div>
                                <div className="bg-white p-5 rounded-2xl shadow-sm border border-emerald-100 flex flex-col items-center gap-1">
                                    <span className="text-[8px] font-black text-blue-500 uppercase tracking-widest">Tier 2 (8-15 DÍAS)</span>
                                    <p className="text-2xl font-black text-blue-700 tracking-tighter">${price15d.toFixed(2)}</p>
                                    <Badge className="bg-blue-100 text-blue-700 border-none text-[7px] font-black uppercase">-5% DESCUENTO</Badge>
                                </div>
                            </div>
                        </div>

                        {product.features && (
                            <div className="space-y-4">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400 flex items-center gap-2 px-1"><Info className="h-3.5 w-3.5" /> DESCRIPCIÓN TÉCNICA</h3>
                                <div className="p-6 rounded-[2rem] border bg-slate-50/50 relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform"><Box className="h-12 w-12" /></div>
                                    <p className="text-xs sm:text-sm text-slate-600 whitespace-pre-wrap leading-relaxed font-medium relative z-10">{product.features}</p>
                                </div>
                            </div>
                        )}
                    </TabsContent>

                    {isStaff && (
                        <TabsContent value="audit" className="mt-0 animate-in slide-in-from-right-2 duration-500">
                            <div className="space-y-4">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400 flex items-center gap-2 px-1"><History className="h-4 w-4" /> BITÁCORA DE MOVIMIENTOS</h3>
                                <div className="rounded-[2rem] border border-slate-100 overflow-hidden shadow-sm">
                                    {isLoadingHistory ? (
                                        <div className="p-12 text-center"><Loader2 className="animate-spin h-8 w-8 mx-auto text-primary" /></div>
                                    ) : stockHistory && stockHistory.length > 0 ? (
                                        <div className="divide-y divide-slate-50 bg-white">
                                            {stockHistory.map((log) => (
                                                <div key={log.id} className="p-5 space-y-2 group hover:bg-slate-50 transition-colors">
                                                    <div className="flex justify-between items-start">
                                                        <div className="space-y-0.5">
                                                            <p className="text-xs font-black uppercase text-slate-900">{log.reason}</p>
                                                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{log.userName} • {log.createdAt ? format(log.createdAt.toDate(), 'dd MMM, HH:mm', { locale: es }).toUpperCase() : '---'}</p>
                                                        </div>
                                                        <Badge className={cn("font-black text-[10px] h-6 rounded-lg border-none shadow-none", log.change > 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
                                                            {log.change > 0 ? '+' : ''}{log.change}
                                                        </Badge>
                                                    </div>
                                                    <div className="flex items-center gap-4 text-[9px] font-bold uppercase tracking-tighter text-slate-400">
                                                        <span className="flex items-center gap-1.5"><Archive className="h-3 w-3" /> ANTES: {log.previousStock}</span>
                                                        <ArrowRight className="h-2 w-2" />
                                                        <span className="text-slate-900 flex items-center gap-1.5"><ShieldCheck className="h-3 w-3 text-primary" /> FINAL: {log.newStock}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="p-16 text-center flex flex-col items-center gap-3 opacity-30">
                                            <History className="h-10 w-10 text-slate-300" />
                                            <p className="text-[10px] font-black uppercase tracking-[0.3em]">Sin movimientos registrados para este SKU</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </TabsContent>
                    )}
                </Tabs>
            </div>
        </ScrollArea>

        {canManageInventory && (
             <SheetFooter className="p-8 border-t bg-slate-50 shrink-0">
                <div className="w-full flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-3">
                        <EditProductDialog product={product} useTriggerButton={true} />
                        <AdjustStockDialog product={product} useTriggerButton={true} />
                    </div>
                    {canDelete && (
                        <Button variant="outline" className="h-12 border-rose-200 text-rose-600 hover:bg-rose-50 font-black uppercase text-[10px] tracking-widest rounded-xl shadow-sm transition-all active:scale-95" onClick={() => onDelete(product)}>
                            <Trash2 className="mr-2 h-4 w-4" /> Eliminar Registro
                        </Button>
                    )}
                </div>
            </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
