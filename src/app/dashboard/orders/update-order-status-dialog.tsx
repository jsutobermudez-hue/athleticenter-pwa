
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, ArrowRight, FileWarning } from 'lucide-react';
import type { Order, User, OrderStatus } from '@/lib/definitions';
import { ALL_ORDER_STATUSES } from '@/lib/definitions';
import { useToast } from '@/hooks/use-toast';
import { useFirestore, useUser, errorEmitter, FirestorePermissionError } from '@/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { handleWhatsAppStatusUpdate } from '@/app/actions';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { createAppNotifications } from '@/lib/notifications';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { statusConfig } from '@/lib/status-config';

const statusTransitions: Record<OrderStatus, OrderStatus[]> = {
    'Borrador': ['Pendiente', 'Cancelado'],
    'Pendiente': ['Aprobado', 'Cancelado', 'Rechazado'],
    'Aprobado': ['Pendiente', 'En Preparación', 'Cancelado'],
    'En Preparación': ['Aprobado', 'Completado', 'Cancelado'],
    'Completado': ['En Preparación', 'Despachado', 'Cancelado'],
    'Despachado': ['Completado', 'Entregado', 'Cancelado'],
    'Entregado': ['Despachado', 'En Verificación', 'Pagado'],
    'En Verificación': ['Entregado', 'Pagado'],
    'Pagado': [],
    'Cancelado': [],
    'Rechazado': ['Pendiente', 'Cancelado']
};

const getAvailableStatuses = (currentStatus: OrderStatus, userRole: User['role'] | undefined): OrderStatus[] => {
    if (!userRole) return [];
    
    if (['superadmin', 'admin', 'gerencia'].includes(userRole)) {
        return ALL_ORDER_STATUSES.filter(s => s !== currentStatus);
    }

    return statusTransitions[currentStatus] || [];
};

type UpdateOrderStatusDialogProps = {
  order: Order;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export function UpdateOrderStatusDialog({ order, isOpen, onOpenChange }: UpdateOrderStatusDialogProps) {
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();
  const { profile: currentUser } = useUser();

  const [status, setStatus] = useState(order.status);

  useEffect(() => {
    if (isOpen) {
      setStatus(order.status);
    }
  }, [isOpen, order]);
  
  const statuses = getAvailableStatuses(order.status, currentUser?.role);
  const newStatusConfig = statusConfig[status];

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!firestore || !currentUser) return;
    
    if (status === order.status) {
        onOpenChange(false);
        return;
    }

    setIsPending(true);
    const orderRef = doc(firestore, 'orders', order.id);
    const updatedData = { 
        status,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.id
    };
    
    updateDoc(orderRef, updatedData)
        .then(async () => {
            const updaterName = currentUser.name || "Sistema";
            
            toast({ 
                title: '¡Estado Actualizado!', 
                description: `El pedido ${order.id.substring(0, 6)} ha pasado a "${status}".`
            });

            await createAppNotifications(firestore, {
                category: 'Pedidos',
                title: `Estado Actualizado #${order.id.substring(0,6)}`,
                message: `Nuevo estado: ${status}. Por: ${updaterName}.`,
                link: `/dashboard/orders?order=${order.id}`,
                initiatorId: currentUser.id,
                salespersonId: order.salespersonId,
                customerId: order.customerId,
                roles: ['admin', 'gerencia', 'deposito'],
            });
            
            if (order.customerPhone && !['En Verificación', 'Pagado'].includes(status)) {
                handleWhatsAppStatusUpdate({
                    customerName: order.customerName,
                    orderId: order.id.substring(0, 6),
                    newStatus: status,
                }).then(result => {
                    if (result.success && result.data) sendWhatsAppMessage(order.customerPhone!, result.data.message);
                });
            }
            onOpenChange(false);
        })
        .catch(async (serverError) => {
            const permissionError = new FirestorePermissionError({
                path: orderRef.path,
                operation: 'update',
                requestResourceData: updatedData
            });
            errorEmitter.emit('permission-error', permissionError);
        })
        .finally(() => {
            setIsPending(false);
        });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg rounded-[2rem]">
        <DialogHeader>
          <DialogTitle className="text-xl font-black uppercase tracking-tighter">Actualizar Estado</DialogTitle>
           <DialogDescription className="text-xs font-medium uppercase text-slate-400">
            Modificando expediente #{order.id.substring(0, 8)}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
             <div className="flex items-center justify-center gap-6 text-center">
                <div className='flex flex-col items-center gap-1.5'>
                    <Label className="text-[8px] font-black uppercase text-slate-400 tracking-widest">Actual</Label>
                    <Badge className={cn(statusConfig[order.status]?.color, "border-none text-[9px] font-black uppercase")}>{order.status}</Badge>
                </div>
                <ArrowRight className="h-5 w-5 text-slate-200 mt-4" />
                 <div className='flex flex-col items-center gap-1.5'>
                    <Label className="text-[8px] font-black uppercase text-slate-400 tracking-widest">Objetivo</Label>
                     <Badge className={cn(statusConfig[status]?.color, 'transition-colors border-none text-[9px] font-black uppercase')}>{status}</Badge>
                </div>
             </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="status" className="text-[10px] font-black uppercase px-1">Nuevo Punto de Control</Label>
                <Select onValueChange={(value) => setStatus(value as OrderStatus)} defaultValue={order.status}>
                  <SelectTrigger id="status" className="h-12 rounded-xl bg-slate-50 border-none shadow-inner font-bold uppercase text-[10px]">
                    <SelectValue placeholder="Seleccionar nuevo estado" />
                  </SelectTrigger>
                  <SelectContent>
                     {statuses.length > 0 ? (
                        statuses.map((s) => {
                          const Icon = statusConfig[s]?.icon;
                          return (
                          <SelectItem key={s} value={s} className="font-bold text-[10px] uppercase">
                             <div className="flex items-center gap-2">
                                {Icon && <Icon className="h-3.5 w-3.5" />}
                                <span>{s}</span>
                             </div>
                          </SelectItem>
                        )})
                     ) : (
                        <div className="p-4 text-center text-[10px] font-black text-slate-400 uppercase">
                            No hay transiciones válidas disponibles.
                        </div>
                     )}
                  </SelectContent>
                </Select>
              </div>

               {status !== order.status && newStatusConfig && (
                <div className="flex items-start gap-3 rounded-2xl border-none bg-amber-50 p-4 text-[10px] font-medium text-amber-800 animate-in fade-in-50">
                    <FileWarning className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>Esta acción moverá el pedido a la fase "{status}". {newStatusConfig.description}</span>
                </div>
               )}
              
              <DialogFooter className="pt-4 gap-2 sm:gap-0">
                <Button type="button" variant="ghost" className="font-black uppercase text-[10px]" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isPending || statuses.length === 0 || status === order.status} className="h-11 px-8 rounded-xl bg-primary hover:bg-primary/90 font-black uppercase tracking-widest text-[10px] shadow-lg">
                  {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Confirmar Cambio'}
                </Button>
              </DialogFooter>
            </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
