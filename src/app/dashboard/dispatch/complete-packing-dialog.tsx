'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Loader2, Box, Scale, PackageCheck, X } from 'lucide-react';
import type { Order } from '@/lib/definitions';
import { useToast } from '@/hooks/use-toast';
import { useFirestore, useUser, errorEmitter, FirestorePermissionError } from '@/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { createAppNotifications } from '@/lib/notifications';

type CompletePackingDialogProps = {
  order: Order;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CompletePackingDialog({ order, isOpen, onOpenChange }: CompletePackingDialogProps) {
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();
  const { profile: currentUser } = useUser();

  const [packageCount, setPackageCount] = useState(1);
  const [totalWeight, setTotalWeight] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setPackageCount(order.packageCount || 1);
      setTotalWeight(order.totalWeight || 0);
    }
  }, [isOpen, order]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!firestore || !currentUser) return;

    setIsPending(true);

    const updateData = {
      status: 'Completado' as const,
      packageCount: Number(packageCount),
      totalWeight: Number(totalWeight),
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.id
    };

    try {
      const orderRef = doc(firestore, 'orders', order.id);
      await updateDoc(orderRef, updateData);

      await createAppNotifications(firestore, {
        category: 'Despacho',
        title: `Embalaje Certificado #${order.id.substring(0, 6)}`,
        message: `Listo para despacho. Contenido: ${packageCount} bultos (${totalWeight}kg).`,
        link: `/dashboard/dispatch?orderId=${order.id}`,
        initiatorId: currentUser.id,
        roles: ['admin', 'gerencia', 'deposito'],
      });

      toast({ 
        title: '¡Embalaje Certificado!', 
        description: `El pedido ahora está listo para asignación de transporte.` 
      });
      onOpenChange(false);
    } catch (error: any) {
      const permissionError = new FirestorePermissionError({
        path: `orders/${order.id}`,
        operation: 'update',
        requestResourceData: updateData
      });
      errorEmitter.emit('permission-error', permissionError);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-md p-0 overflow-hidden rounded-[1.8rem] sm:rounded-[2.5rem] border-none shadow-2xl flex flex-col h-[70vh] sm:h-auto sm:max-h-[90vh]">
        <DialogHeader className="p-6 sm:p-8 bg-indigo-600 text-white shrink-0 relative">
          <div className="flex items-center gap-4">
            <div className="p-2.5 sm:p-3 rounded-xl sm:rounded-2xl bg-white/20 text-white shadow-xl shrink-0">
                <PackageCheck className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <div className="text-left flex-1 min-w-0">
                <DialogTitle className="text-lg sm:text-2xl font-black uppercase tracking-tighter leading-none truncate">Certificar Embalaje</DialogTitle>
                <DialogDescription className="text-indigo-100 font-medium mt-1 uppercase text-[8px] sm:text-[10px] tracking-widest truncate">Pedido #{order.id.substring(0,6)}</DialogDescription>
            </div>
          </div>
          <button onClick={() => onOpenChange(false)} className="absolute top-6 right-6 text-white/40 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 bg-white">
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 sm:p-8">
                <div className="space-y-6">
                    <h3 className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2 px-1">
                        <Box className="h-3.5 w-3.5 text-primary" /> Manifiesto de Carga
                    </h3>
                    
                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-1.5">
                            <Label className="text-[9px] font-black uppercase text-slate-500 px-1">Total Bultos</Label>
                            <div className="relative">
                                <Box className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <Input 
                                    type="number" 
                                    min="1" 
                                    value={packageCount} 
                                    onChange={(e) => setPackageCount(Number(e.target.value))} 
                                    required 
                                    className="h-12 pl-10 text-xl font-black rounded-xl bg-slate-50 border-none shadow-inner text-center" 
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[9px] font-black uppercase text-slate-500 px-1">Peso (kg)</Label>
                            <div className="relative">
                                <Scale className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <Input 
                                    type="number" 
                                    step="0.1" 
                                    min="0.1" 
                                    value={totalWeight} 
                                    onChange={(e) => setTotalWeight(Number(e.target.value))} 
                                    required 
                                    className="h-12 pl-10 text-xl font-black rounded-xl bg-slate-50 border-none shadow-inner text-center" 
                                />
                            </div>
                        </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100 flex items-start gap-3 mt-4">
                        <p className="text-[9px] font-bold text-blue-800 uppercase leading-relaxed">
                            Al certificar, el sistema generará automáticamente la numeración correlativa para las etiquetas QR.
                        </p>
                    </div>
                </div>
            </div>

            <DialogFooter className="p-6 sm:p-8 border-t border-slate-50 bg-slate-50 flex flex-col-reverse sm:flex-row items-center justify-between gap-4 shrink-0">
                <Button type="button" variant="ghost" className="font-black uppercase tracking-widest text-[9px] h-10 px-6 w-full sm:w-auto" onClick={() => onOpenChange(false)}>Cancelar</Button>
                <Button type="submit" disabled={isPending} className="h-12 px-10 rounded-xl font-black uppercase tracking-[0.2em] shadow-xl bg-indigo-600 hover:bg-indigo-700 transition-all active:scale-95 text-[10px] w-full sm:w-auto">
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />} SELLAR Y COMPLETAR
                </Button>
            </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
