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
import { Loader2, Camera, ShieldCheck, CheckCircle, X } from 'lucide-react';
import type { Order } from '@/lib/definitions';
import { useToast } from '@/hooks/use-toast';
import { useFirestore, useUser, errorEmitter, FirestorePermissionError } from '@/firebase';
import { doc, Timestamp, writeBatch, serverTimestamp } from 'firebase/firestore';
import { createAppNotifications } from '@/lib/notifications';
import { Textarea } from '@/components/ui/textarea';
import { ImageUploader } from '@/components/ui/image-uploader';

export function ConfirmDeliveryDialog({ order, isOpen, onOpenChange }: { order: Order; isOpen: boolean; onOpenChange: (open: boolean) => void; }) {
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();
  const { user: authUser, profile: currentUser } = useUser();

  const [receptionDate, setReceptionDate] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [deliveryImageUrl, setDeliveryImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setReceptionDate(new Date().toISOString().split('T')[0]);
      setDeliveryNotes('');
      setDeliveryImageUrl(null);
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!firestore || !authUser || !currentUser) return;
    
    setIsPending(true);
    const batch = writeBatch(firestore);
    const updateData = {
        status: 'Entregado',
        receptionDate: Timestamp.fromDate(new Date(receptionDate)),
        deliveryNotes: deliveryNotes,
        deliveryImageUrl: deliveryImageUrl || '',
        updatedAt: serverTimestamp(),
        updatedBy: authUser.uid
    };

    batch.update(doc(firestore, 'orders', order.id), updateData);

    batch.commit()
        .then(() => {
            createAppNotifications(firestore, {
                category: 'Facturación',
                title: `¡Pedido Entregado! #${order.id.substring(0, 6)}`,
                message: `El pedido de ${order.customerName} ha sido entregado exitosamente.`,
                link: `/dashboard/billing?orderId=${order.id}`,
                initiatorId: authUser.uid,
                userIds: [order.salespersonId, order.customerId],
                roles: ['admin', 'gerencia'],
            });

            toast({ title: '¡Entrega Sincronizada!', description: 'Evidencia digital guardada.' });
            onOpenChange(false);
        })
        .catch(async (serverError) => {
            const permissionError = new FirestorePermissionError({
                path: `orders/${order.id}`,
                operation: 'update',
                requestResourceData: updateData
            });
            errorEmitter.emit('permission-error', permissionError);
        })
        .finally(() => {
            setIsPending(false);
        });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-xl p-0 overflow-hidden rounded-[1.8rem] sm:rounded-[2.5rem] border-none shadow-2xl flex flex-col h-[90vh] sm:h-auto sm:max-h-[90vh]">
        <DialogHeader className="p-6 sm:p-8 bg-emerald-600 text-white shrink-0 relative">
          <div className="flex items-center gap-4">
            <div className="p-2.5 sm:p-3 rounded-xl sm:rounded-2xl bg-white/20 text-white shadow-xl shrink-0">
                <CheckCircle className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <div className="text-left flex-1 min-w-0">
                <DialogTitle className="text-lg sm:text-2xl font-black uppercase tracking-tighter leading-none truncate">Confirmar Recepción</DialogTitle>
                <DialogDescription className="text-emerald-100 font-medium mt-1 uppercase text-[8px] sm:text-[10px] tracking-widest truncate">Pedido #{order.id.substring(0,6)}</DialogDescription>
            </div>
          </div>
          <button onClick={() => onOpenChange(false)} className="absolute top-6 right-6 text-white/40 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 bg-white">
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 sm:p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-6">
                        <h3 className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2 px-1">
                            <Camera className="h-3.5 w-3.5 text-primary" /> Evidencia de Entrega
                        </h3>
                        <ImageUploader 
                            folderPath="delivery-evidence" 
                            onImageUploaded={setDeliveryImageUrl} 
                            label="Foto del Paquete / Guía Firmada" 
                        />
                    </div>

                    <div className="space-y-6">
                        <h3 className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2 px-1">
                            <CheckCircle className="h-3.5 w-3.5 text-primary" /> Detalles Finales
                        </h3>
                        <div className="space-y-1.5">
                            <Label className="text-[9px] font-black uppercase text-slate-500 px-1">Fecha de Recepción Real</Label>
                            <Input type="date" value={receptionDate} onChange={(e) => setReceptionDate(e.target.value)} required className="h-11 font-bold rounded-xl bg-slate-50 border-none shadow-inner text-sm" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[9px] font-black uppercase text-slate-500 px-1">Notas de Entrega</Label>
                            <Textarea value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} placeholder="Ej. Entregado en recepción..." className="rounded-xl bg-slate-50 border-none shadow-inner min-h-[120px] text-sm" />
                        </div>
                    </div>
                </div>
            </div>

            <DialogFooter className="p-6 sm:p-8 border-t border-slate-50 bg-slate-50 flex flex-col-reverse sm:flex-row items-center justify-between gap-4 shrink-0">
                <Button type="button" variant="ghost" className="font-black uppercase tracking-widest text-[9px] h-10 px-6 w-full sm:w-auto" onClick={() => onOpenChange(false)}>Cancelar</Button>
                <Button type="submit" disabled={isPending} className="h-12 px-10 rounded-xl font-black uppercase tracking-[0.2em] shadow-xl bg-emerald-600 hover:bg-emerald-700 transition-all active:scale-95 text-[10px] w-full sm:w-auto">
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />} FINALIZAR CICLO
                </Button>
            </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
