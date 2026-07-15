
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, RefreshCw } from 'lucide-react';
import type { Quote, QuoteStatus } from '@/lib/definitions';
import { useToast } from '@/hooks/use-toast';
import { useFirestore, useUser, errorEmitter, FirestorePermissionError } from '@/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { createAppNotifications } from '@/lib/notifications';

const getAvailableStatuses = (currentStatus: QuoteStatus): QuoteStatus[] => {
    switch (currentStatus) {
        case 'Borrador':
            return ['Enviada', 'Cancelada'];
        case 'Enviada':
            return ['Aceptada', 'Vencida', 'Cancelada'];
        case 'Aceptada':
            return ['Cancelada'];
        case 'Vencida':
            return ['Cancelada'];
        case 'Convertida':
        case 'Cancelada':
        default:
            return [];
    }
};

export function UpdateQuoteStatusDialog({ quote, onStatusUpdate }: { quote: Quote, onStatusUpdate?: () => void; }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();
  const { profile: currentUser } = useUser();

  const [status, setStatus] = useState(quote.status);
  
  const statuses = getAvailableStatuses(quote.status);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!firestore || !currentUser) return;
    
    if (status === quote.status) {
        setIsOpen(false);
        return;
    }

    setIsPending(true);
    const quoteRef = doc(firestore, 'quotes', quote.id);
    const updatedData = { 
        status: status,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.id
    };

    updateDoc(quoteRef, updatedData)
        .then(async () => {
            const updaterName = currentUser.name || "Sistema";
            await createAppNotifications(firestore, {
                category: 'Cotizaciones',
                title: `Estado Actualizado #${quote.id.substring(0,6)}`,
                message: `Nuevo estado: ${status}. Por ${updaterName}.`,
                link: `/dashboard/quotes?quote=${quote.id}`,
                initiatorId: currentUser.id,
                userIds: [quote.salespersonId],
                roles: ['admin', 'gerencia'],
            });

            toast({ title: '¡Estado Sincronizado!', description: `Presupuesto actualizado a "${status}".` });
            onStatusUpdate?.();
            setIsOpen(false);
        })
        .catch(async (serverError) => {
            const permissionError = new FirestorePermissionError({
                path: quoteRef.path,
                operation: 'update',
                requestResourceData: updatedData
            });
            errorEmitter.emit('permission-error', permissionError);
        })
        .finally(() => {
            setIsPending(false);
        });
  };
  
  const resetAndClose = () => {
    setIsOpen(false);
    setStatus(quote.status);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open ? resetAndClose() : setIsOpen(true)}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full h-12 rounded-xl font-black uppercase tracking-widest text-[9px] border-slate-200">
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Gestionar Estado
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md rounded-[2.5rem]">
        <DialogHeader>
          <DialogTitle className="text-xl font-black uppercase tracking-tighter">Modificar Estado</DialogTitle>
          <DialogDescription className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Expediente #{quote.id}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 pt-4">
          <div className="space-y-2">
            <Label htmlFor="status" className="text-[10px] font-black uppercase px-1">Nueva Fase Comercial</Label>
            <Select onValueChange={(value) => setStatus(value as QuoteStatus)} defaultValue={quote.status}>
              <SelectTrigger id="status" className="h-12 rounded-xl bg-slate-50 border-none shadow-inner font-bold uppercase text-[10px]">
                <SelectValue placeholder="Seleccionar nuevo estado" />
              </SelectTrigger>
              <SelectContent>
                 {statuses.length > 0 ? (
                    statuses.map((s) => (
                      <SelectItem key={s} value={s} className="font-bold text-[10px] uppercase">{s.toUpperCase()}</SelectItem>
                    ))
                 ) : (
                    <div className="p-4 text-center text-[10px] font-black text-slate-400 uppercase">Sin transiciones disponibles.</div>
                 )}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" className="font-black uppercase text-[10px]" onClick={resetAndClose}>Cancelar</Button>
            <Button type="submit" disabled={isPending || statuses.length === 0 || status === quote.status} className="h-11 px-8 rounded-xl bg-primary hover:bg-primary/90 font-black uppercase tracking-widest text-[10px] shadow-lg">
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Guardar Cambios'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
