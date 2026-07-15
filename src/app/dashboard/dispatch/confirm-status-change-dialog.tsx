'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ShieldCheck, AlertTriangle, X } from 'lucide-react';
import type { Order, User } from '@/lib/definitions';
import { useToast } from '@/hooks/use-toast';
import { useFirestore, useUser } from '@/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { createAppNotifications } from '@/lib/notifications';
import { ScrollArea } from '@/components/ui/scroll-area';

type ConfirmStatusChangeDialogProps = {
  order: Order;
  newStatus?: Order['status'];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ConfirmStatusChangeDialog({ order, newStatus, isOpen, onOpenChange }: ConfirmStatusChangeDialogProps) {
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();
  const { profile: currentUser } = useUser();

  const handleConfirm = async () => {
    if (!firestore || !currentUser || !newStatus) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se puede procesar la solicitud en este momento.' });
      return;
    }
    
    setIsPending(true);
    const orderRef = doc(firestore, 'orders', order.id);
    
    try {
        await updateDoc(orderRef, { 
            status: newStatus,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.id
        });
      
        toast({
            title: '¡Punto de Control Actualizado!',
            description: `El pedido ha pasado a la fase: ${newStatus}.`,
        });

        onOpenChange(false);

        const isBillingStatus = newStatus === 'Entregado';
        const notificationTitle = isBillingStatus
            ? `Ciclo de Cobro Iniciado: Pedido #${order.id.substring(0, 6)}`
            : `Pedido #${order.id.substring(0, 6)} en fase: ${newStatus}`;
        
        const notificationMessage = isBillingStatus
            ? `El pedido de ${order.customerName} fue entregado y está listo para facturación.`
            : `El equipo de ${order.customerName} ahora está: ${newStatus}.`;
        
        const notificationLink = isBillingStatus
            ? `/dashboard/billing?orderId=${order.id}`
            : `/dashboard/dispatch?orderId=${order.id}`;

        createAppNotifications(firestore, {
            category: isBillingStatus ? 'Facturación' : 'Pedidos',
            title: notificationTitle,
            message: notificationMessage,
            link: notificationLink,
            initiatorId: currentUser.id,
            userIds: [order.salespersonId, order.customerId], 
            roles: ['admin', 'gerencia', 'deposito'], 
        }).catch(err => console.warn("[Notifications] Fallo en disparo de alertas secundarias."));

    } catch (error: any) {
        console.error("Error updating status:", error);
        toast({ 
            variant: 'destructive', 
            title: 'Fallo de Red', 
            description: 'No se pudo sincronizar el estado. Verifica tu conexión.' 
        });
    } finally {
        setIsPending(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-md rounded-[1.8rem] sm:rounded-[2.5rem] border-none shadow-2xl p-0 overflow-hidden flex flex-col">
        <DialogHeader className="p-6 sm:p-8 bg-slate-900 text-white shrink-0 relative">
          <div className="flex items-center gap-4">
            <div className="p-2.5 sm:p-3 rounded-xl sm:rounded-2xl bg-primary/20 text-primary shadow-xl shrink-0">
                <ShieldCheck className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <div className="text-left flex-1 min-w-0">
                <DialogTitle className="text-lg sm:text-xl font-black uppercase tracking-tighter leading-none truncate">Confirmar Operación</DialogTitle>
                <DialogDescription className="text-slate-400 font-medium mt-1 uppercase text-[8px] sm:text-[9px] tracking-widest truncate">
                    Expediente #{order.id.substring(0, 8)}
                </DialogDescription>
            </div>
          </div>
          <button onClick={() => onOpenChange(false)} className="absolute top-6 right-6 text-white/40 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </DialogHeader>

        <div className="p-6 sm:p-8 space-y-6">
            <div className="p-5 rounded-2xl bg-blue-50 border border-blue-100 flex flex-col items-center text-center gap-3">
                <p className="text-[9px] sm:text-[10px] font-black uppercase text-blue-400 tracking-widest leading-none">Nueva Fase Operativa</p>
                <p className="text-xl sm:text-2xl font-black text-blue-700 tracking-tighter uppercase leading-none">{newStatus}</p>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 border border-slate-100">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[8px] sm:text-[9px] font-bold text-slate-500 uppercase leading-relaxed">
                    Al confirmar, el sistema notificará a todos los departamentos vinculados y se generará una marca de tiempo en la bitácora de auditoría.
                </p>
            </div>
        </div>

        <DialogFooter className="p-6 sm:p-8 bg-slate-50 border-t flex flex-col-reverse sm:flex-row gap-3 shrink-0">
          <Button type="button" variant="ghost" className="font-black uppercase tracking-widest text-[9px] w-full sm:w-auto" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button 
            type="button" 
            onClick={handleConfirm} 
            disabled={isPending}
            className="h-12 flex-1 rounded-xl bg-primary hover:bg-primary/90 shadow-xl font-black uppercase tracking-[0.2em] text-[10px] w-full sm:w-auto"
          >
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Sincronizar Estado'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}