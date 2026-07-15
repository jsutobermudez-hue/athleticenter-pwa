'use client';

import React, { useState } from 'react';
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
import { Loader2, Minus, Plus, ShieldCheck, AlertTriangle, Edit } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Product, StockHistory } from '@/lib/definitions';
import { useFirestore, useUser } from '@/firebase';
import { doc, collection, serverTimestamp, runTransaction } from 'firebase/firestore';
import { createAppNotifications } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { InventoryService } from '@/lib/inventory-service';

type AdjustStockDialogProps = {
  product: Product;
  useTriggerButton?: boolean;
};

export function AdjustStockDialog({ product, useTriggerButton = false }: AdjustStockDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [activeOp, setActiveOp] = useState<'add' | 'subtract' | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('Reposición de inventario');
  const { toast } = useToast();
  const firestore = useFirestore();
  const { user: authUser, profile: currentUser } = useUser();

  const resetState = () => {
    setIsOpen(false);
    setIsPending(false);
    setActiveOp(null);
    setQuantity(1);
    setReason('Reposición de inventario');
  };
  
  const handleStockAdjustment = async (operation: 'add' | 'subtract') => {
    if (isPending || !product.id || !firestore || !authUser || !currentUser) return;
    
    setIsPending(true);
    setActiveOp(operation);

    const change = Math.floor(Math.abs(quantity)) * (operation === 'add' ? 1 : -1);
    
    try {
        await runTransaction(firestore, async (transaction) => {
            await InventoryService.updateStockInTransaction(
                transaction,
                firestore,
                product.id!,
                change,
                currentUser.id,
                currentUser.name,
                reason,
                null // Ajuste global
            );
        });
        
        await createAppNotifications(firestore, {
            category: 'Inventario',
            title: `Ajuste Certificado: ${product.sku}`,
            message: `${operation === 'add' ? 'Ingreso' : 'Egreso'} de ${Math.abs(change)} un. por ${currentUser.name}.`,
            link: `/dashboard/inventory?sku=${product.sku}`,
            initiatorId: authUser.uid,
            broadcast: true,
        });

        toast({ title: '¡Ajuste Sincronizado!' });
        resetState();
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Error de Ajuste', description: error.message });
        setIsPending(false);
        setActiveOp(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !isPending && setIsOpen(open)}>
      <DialogTrigger asChild>
        {useTriggerButton ? (
            <Button variant="outline" className="h-12 border-slate-200 font-black uppercase text-[10px] tracking-widest rounded-xl shadow-sm hover:bg-slate-50 transition-all active:scale-95">
                <Plus className="mr-2 h-4 w-4 text-primary" /> Ajustar Existencias
            </Button>
        ) : (
            <button className="w-full text-left p-2 text-sm font-bold uppercase text-[10px] hover:bg-accent rounded-md">Ajustar Stock</button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md rounded-[2.5rem] border-none shadow-2xl p-0 overflow-hidden">
        <DialogHeader className="p-8 bg-slate-900 text-white">
          <DialogTitle className="text-2xl font-black uppercase tracking-tighter">Ajuste de Inventario</DialogTitle>
          <DialogDescription className="text-slate-400 font-medium uppercase text-[10px] tracking-widest mt-1">SKU: {product.sku}</DialogDescription>
        </DialogHeader>
        
        {product.hasSizes ? (
            <div className="p-8 space-y-6 text-center">
                <div className="p-6 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col items-center gap-4">
                    <AlertTriangle className="h-10 w-10 text-amber-600" />
                    <div className="space-y-1">
                        <p className="text-sm font-black uppercase text-amber-900">Control de Variantes Activo</p>
                        <p className="text-[10px] font-medium text-amber-700 leading-relaxed uppercase">
                            Este equipo se gestiona por tallas. No se permite el ajuste global para evitar discrepancias.
                        </p>
                    </div>
                    <Button asChild className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white font-black uppercase text-[9px] rounded-xl shadow-lg">
                        <Link href={`/dashboard/inventory?sku=${product.sku}&edit=true`}>
                            <Edit className="mr-2 h-4 w-4" /> Modificar por Talla
                        </Link>
                    </Button>
                </div>
            </div>
        ) : (
            <div className="p-8 space-y-6">
                <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-slate-400 px-1">Cantidad a Transar</Label>
                    <div className="relative">
                        <Plus className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                        <Input 
                            type="number" 
                            min="1" 
                            value={quantity} 
                            onChange={(e) => setQuantity(Number(e.target.value))} 
                            disabled={isPending}
                            className="h-14 pl-10 text-2xl font-black rounded-xl bg-slate-50 border-none shadow-inner text-center"
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-slate-400 px-1">Motivo del Movimiento</Label>
                    <Input 
                        value={reason} 
                        onChange={(e) => setReason(e.target.value)} 
                        disabled={isPending}
                        placeholder="Ej. Reposición, Merma..." 
                        className="h-11 rounded-xl bg-slate-50 border-none shadow-inner font-bold text-xs uppercase"
                    />
                </div>

                <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10 flex items-start gap-3">
                    <ShieldCheck className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <p className="text-[9px] font-bold text-slate-500 uppercase leading-relaxed">
                        EL AJUSTE SE REFLEJARÁ EN TIEMPO REAL EN TODOS LOS PUNTOS DE VENTA.
                    </p>
                </div>
            </div>
        )}

        {!product.hasSizes && (
            <DialogFooter className="p-8 bg-slate-50 border-t flex flex-col sm:flex-row gap-3">
                <Button type="button" variant="ghost" className="font-black uppercase text-[10px]" onClick={resetState} disabled={isPending}>Cancelar</Button>
                <div className="flex gap-2 flex-1">
                    <Button 
                        variant="destructive" 
                        className="h-12 flex-1 rounded-xl font-black uppercase text-[10px] shadow-lg"
                        onClick={() => handleStockAdjustment('subtract')} 
                        disabled={isPending}
                    >
                        {isPending && activeOp === 'subtract' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Minus className="mr-2 h-4 w-4" />} Restar
                    </Button>
                    <Button 
                        className="h-12 flex-1 rounded-xl bg-primary hover:bg-primary/90 font-black uppercase text-[10px] shadow-lg"
                        onClick={() => handleStockAdjustment('add')} 
                        disabled={isPending}
                    >
                        {isPending && activeOp === 'add' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />} Sumar
                    </Button>
                </div>
            </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
