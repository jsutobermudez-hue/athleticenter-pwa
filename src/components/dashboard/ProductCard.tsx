'use client';

import React, { useMemo, useState } from 'react';
import type { Product } from '@/lib/definitions';
import { Card } from '@/components/ui/card';
import { ImageIcon, Minus, Plus, Maximize2, ShieldAlert, AlertTriangle, CheckCircle, Box } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useUser } from '@/firebase';
import { useDataSaving } from '@/hooks/use-data-saving';

interface ProductCardProps {
  product: Product;
  onSelect: (product: Product) => void;
  bcvDiscount?: number;
  quantityInCart?: number;
  onQuantityChange?: (product: Product, newQuantity: number, size?: string) => void;
}

/**
 * PRODUCT CARD v2.8.0
 * Saneado: Uso de etiqueta 'img' estándar para compatibilidad total con Firebase Storage.
 */
export function ProductCard({
  product,
  onSelect,
  bcvDiscount = 30,
  quantityInCart = 0,
  onQuantityChange,
}: ProductCardProps) {
  const { profile: currentUser } = useUser();
  const isStaff = Boolean(currentUser && ['superadmin', 'admin', 'gerencia', 'vendedor', 'deposito'].includes(currentUser.role));

  const { isDataSaving } = useDataSaving();
  const [imageLoaded, setImageLoaded] = useState(false);
  
  const stockValue = product.stockLevel ?? (product as any).stock ?? 0;
  const isOutOfStock = stockValue === 0;
  const isLowStock = stockValue > 0 && stockValue < 10;
  
  const pvpBCV = product.price || 0;
  
  let pvpCash = product.priceCashUSD || 0;
  if (pvpCash === 0 && pvpBCV > 0) {
    const discountFactor = 1 - (bcvDiscount / 100);
    pvpCash = pvpBCV * discountFactor;
  }

  const health = useMemo(() => {
    const cost = product.cost || 0;
    if (cost <= 0) return { status: 'unknown', color: 'bg-slate-300', label: 'Sin Costo Base' };
    
    const totalEstFees = pvpCash * 0.25;
    const netProfit = pvpCash - totalEstFees - cost;
    const margin = pvpCash > 0 ? (netProfit / pvpCash) * 100 : 0;

    if (margin >= 20) return { status: 'healthy', color: 'bg-emerald-500', label: `Saludable (${margin.toFixed(0)}%)`, icon: CheckCircle };
    if (margin >= 10) return { status: 'warning', color: 'bg-amber-500', label: `Margen Ajustado (${margin.toFixed(0)}%)`, icon: AlertTriangle };
    return { status: 'critical', color: 'bg-rose-500', label: `Riesgo de Pérdida (${margin.toFixed(0)}%)`, icon: ShieldAlert };
  }, [product.cost, pvpCash]);

  const handleIncrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onQuantityChange) return;
    if (product.hasSizes) { onQuantityChange(product, quantityInCart, undefined); return; }
    if (quantityInCart < stockValue) onQuantityChange(product, quantityInCart + 1);
  };

  const handleDecrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onQuantityChange) return;
    if (product.hasSizes) { onQuantityChange(product, quantityInCart, undefined); return; }
    if (quantityInCart > 0) onQuantityChange(product, quantityInCart - 1);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (product.hasSizes) return;
    const val = e.target.value === '' ? 0 : parseInt(e.target.value);
    if (isNaN(val)) return;
    const clampedVal = Math.max(0, Math.min(val, stockValue));
    if (onQuantityChange) onQuantityChange(product, clampedVal);
  };

  return (
    <Card
      className={cn(
        "group cursor-pointer transition-all duration-500 hover:shadow-2xl hover:-translate-y-2 border-slate-100 rounded-[2rem] p-4 flex flex-col gap-4 bg-white border relative overflow-hidden h-full min-h-[380px]",
        isOutOfStock && "opacity-70 grayscale",
        quantityInCart > 0 && "ring-2 ring-primary border-primary/20 bg-primary/5 shadow-2xl scale-[1.02]"
      )}
      onClick={() => onSelect(product)}
    >
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/5 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity" />

      <div className="flex justify-between items-start gap-2 relative z-10">
        <div className="flex gap-3 items-center min-w-0">
          <Dialog>
            <DialogTrigger asChild>
              <div 
                className="relative group/zoom shrink-0 cursor-zoom-in h-16 w-16 rounded-2xl overflow-hidden bg-slate-50 border border-primary/5 shadow-inner"
                onClick={(e) => e.stopPropagation()}
              >
                {isDataSaving ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-primary">
                        <Box className="h-6 w-6" />
                    </div>
                ) : (
                    <>
                        {product.imageUrl ? (
                            <img 
                                src={product.imageUrl} 
                                alt={product.name} 
                                className={cn(
                                    "w-full h-full object-cover transition-all duration-700 group-hover/zoom:scale-110",
                                    imageLoaded ? "opacity-100" : "opacity-0"
                                )}
                                onLoad={() => setImageLoaded(true)}
                            />
                        ) : (
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
                                <ImageIcon className="h-6 w-6 text-slate-200" />
                            </div>
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/zoom:opacity-100 transition-opacity flex items-center justify-center">
                          <Maximize2 className="h-4 w-4 text-white" />
                        </div>
                    </>
                )}
              </div>
            </DialogTrigger>
            <DialogContent className="max-w-[90vw] lg:max-w-3xl p-0 border-none bg-black/95 flex items-center justify-center rounded-[2.5rem] overflow-hidden shadow-2xl">
              <DialogHeader className="sr-only">
                <DialogTitle>Vista previa de {product.name}</DialogTitle>
              </DialogHeader>
              <div className="relative w-full aspect-square md:aspect-video flex items-center justify-center p-4">
                {product.imageUrl && !isDataSaving && (
                    <img src={product.imageUrl} alt={product.name} className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl" />
                )}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-8 py-3 rounded-full bg-white/10 backdrop-blur-md border border-white/10">
                  <p className="text-white font-black uppercase text-[11px] tracking-[0.4em] whitespace-nowrap">{product.brand} | {product.name}</p>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <div className="flex flex-col min-w-0">
            <span className="text-[8px] font-black text-primary uppercase tracking-[0.3em] leading-none mb-1">{product.brand || 'ATHLETIC PRO'}</span>
            <h3 className="text-[13px] font-black uppercase tracking-tight leading-tight text-slate-900 line-clamp-2">{product.name}</h3>
            <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[8px] font-mono font-bold text-slate-400 uppercase tracking-tighter bg-slate-50 px-1.5 py-0.5 rounded-md">{product.sku}</span>
                {isStaff && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="flex items-center gap-1 cursor-help" onClick={(e) => e.stopPropagation()}>
                                    <div className={cn("h-2 w-2 rounded-full animate-pulse", health.color)} />
                                    <span className={cn("text-[8px] font-black uppercase tracking-widest", health.color.replace('bg-', 'text-'))}>MARGEN</span>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent className="rounded-xl border-none shadow-xl bg-slate-900 text-white font-bold uppercase text-[9px]">
                                {health.label}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
            </div>
          </div>
        </div>
        <Badge variant="secondary" className="text-[7px] font-black uppercase bg-slate-900 text-white border-none px-2 h-5 shrink-0 rounded-lg shadow-sm">{product.discipline || 'ELITE'}</Badge>
      </div>

      <div className="relative z-10 border border-dashed border-slate-200 rounded-[2.2rem] p-4 space-y-3 bg-slate-50/50 backdrop-blur-sm group-hover:bg-white transition-colors group-hover:border-primary/20 shadow-inner group-hover:shadow-sm">
        <div className="flex flex-col items-center text-center">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.4em] mb-1">PRECIO BCV (SIN IVA)</span>
            <p className="text-4xl font-black text-slate-900 tracking-tighter leading-none">${pvpBCV.toFixed(2)}</p>
        </div>
        
        <div className="bg-emerald-600 cash-glow rounded-2xl p-3.5 flex justify-between items-center transition-transform group-hover:scale-[1.03]">
          <div className="flex flex-col">
            <span className="text-[8px] font-black text-emerald-100 uppercase tracking-[0.2em] leading-none mb-1">DIVISA CASH</span>
            <span className="text-[7px] font-bold text-emerald-200 uppercase leading-none">SIN IVA</span>
          </div>
          <span className="text-2xl font-black text-white tracking-tighter">${pvpCash.toFixed(2)}</span>
        </div>
        
        <p className="text-[8px] font-black text-center text-slate-400 uppercase tracking-[0.1em] mt-1 italic">PRECIOS NO INCLUYEN IVA (16%)</p>
      </div>

      <div className="flex justify-between items-center mt-auto pt-2 relative z-10">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <div className={cn("h-1.5 w-1.5 rounded-full", stockValue > 10 ? "bg-emerald-500" : stockValue > 0 ? "bg-amber-500 animate-pulse" : "bg-rose-500")} />
            <span className={cn("text-[8px] font-black uppercase tracking-widest", isLowStock ? "text-amber-600" : "text-slate-500")}>
                {isStaff 
                    ? `STOCK: ${stockValue}` 
                    : (stockValue > 10 ? "DISPONIBLE" : stockValue > 0 ? "ÚLTIMAS UNIDADES" : "SIN STOCK")
                }
            </span>
          </div>
          {quantityInCart > 0 && (
            <p className="text-[11px] font-black text-primary uppercase animate-in slide-in-from-left-2 duration-300">En Pedido: {quantityInCart}</p>
          )}
        </div>

        {onQuantityChange && !isOutOfStock ? (
          <div className="flex items-center gap-1 bg-white border-2 border-slate-100 rounded-2xl p-1 shadow-xl h-10 group-hover:border-primary/20 transition-all" onClick={(e) => e.stopPropagation()}>
            <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 active:scale-90 transition-all" 
                onClick={handleDecrement} 
                disabled={quantityInCart === 0 && !product.hasSizes}
            >
                <Minus className="h-3 w-3" />
            </Button>
            
            <Input 
                type="number"
                readOnly={product.hasSizes}
                className={cn(
                    "w-12 h-7 p-0 text-center text-xs font-black text-slate-900 bg-slate-50 border-none shadow-inner rounded-md [appearance:textfield] focus-visible:ring-1 focus-visible:ring-primary/20",
                    product.hasSizes && "cursor-pointer"
                )}
                value={quantityInCart}
                onChange={handleInputChange}
                onFocus={(e) => {
                    if (product.hasSizes) {
                        onQuantityChange(product, quantityInCart, undefined);
                    } else {
                        e.target.select();
                    }
                }}
                min={0}
                max={stockValue}
            />

            <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 rounded-lg text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 active:scale-90 transition-all" 
                onClick={handleIncrement} 
                disabled={quantityInCart >= stockValue}
            >
                <Plus className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <Badge className={cn("text-[8px] font-black uppercase px-3 h-6 rounded-xl border-none shadow-md transition-all group-hover:scale-105", stockValue > 10 ? "bg-emerald-100 text-emerald-700" : stockValue > 0 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700")}>
              {stockValue > 10 ? "DISPONIBLE" : stockValue > 0 ? "CRÍTICO" : "SIN STOCK"}
          </Badge>
        )}
      </div>
    </Card>
  );
}
