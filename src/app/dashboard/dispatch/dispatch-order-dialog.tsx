'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Truck, Box, Scale, ShieldCheck, X } from 'lucide-react';
import type { Order, Carrier } from '@/lib/definitions';
import { useToast } from '@/hooks/use-toast';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { doc, Timestamp, collection, query, where, updateDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { createAppNotifications } from '@/lib/notifications';
import { ImageUploader } from '@/components/ui/image-uploader';

type DispatchOrderDialogProps = {
  order: Order;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DispatchOrderDialog({ order, isOpen, onOpenChange }: DispatchOrderDialogProps) {
  const [isPending, setIsPending] = useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();
  const { user: authUser, profile: currentUser } = useUser();

  const carriersQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'carriers'), where('status', '==', 'Activo'));
  }, [firestore]);

  const { data: carriers, isLoading: isLoadingCarriers } = useCollection<Carrier>(carriersQuery);

  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [pickupDate, setPickupDate] = useState('');
  const [packageCount, setPackageCount] = useState(1);
  const [totalWeight, setTotalWeight] = useState(0);
  const [dispatchImageUrl, setDispatchImageUrl] = useState<string | null>(null);
  
   useEffect(() => {
    if (isOpen) {
      setCarrier(order.carrier || '');
      setTracking(order.trackingNumber || '');
      setPickupDate(new Date().toISOString().split('T')[0]);
      setPackageCount(order.packageCount || 1);
      setTotalWeight(order.totalWeight || 0);
      setDispatchImageUrl(null);
    }
  }, [isOpen, order]);

  const generateInternalTracking = () => {
    const razonSocial = order.customerName || 'Cliente';
    const words = razonSocial.trim().split(/\s+/);
    const p1 = words[0]?.substring(0, 3).toUpperCase().padEnd(3, 'X') || 'XXX';
    const stamp = Date.now().toString().slice(-8);
    return `G-${p1}-${stamp}`;
  };

  const selectedCarrierData = useMemo(() => {
    return carriers?.find(c => c.name === carrier);
  }, [carriers, carrier]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!firestore || !authUser || !currentUser) return;
    
    if (!carrier || !tracking) {
        toast({ variant: 'destructive', title: 'Faltan datos', description: 'Define transportista y número de guía.' });
        return;
    }

    if (!dispatchImageUrl) {
        toast({ variant: 'destructive', title: 'Evidencia Requerida', description: 'Debe cargar una foto de los bultos entregados al transportista.' });
        return;
    }
    
    setIsPending(true);

    try {
        const internalTracking = generateInternalTracking();

        const updatedData = {
          status: 'Despachado' as const,
          carrier: carrier,
          carrierId: selectedCarrierData?.id || '',
          trackingNumber: tracking,
          internalTrackingNumber: internalTracking,
          pickupDate: Timestamp.fromDate(new Date(pickupDate)),
          trackingUrlTemplate: selectedCarrierData?.trackingUrlTemplate || '',
          packageCount: Number(packageCount),
          totalWeight: Number(totalWeight),
          dispatchImageUrl: dispatchImageUrl,
          updatedAt: serverTimestamp(),
          updatedBy: authUser.uid
        };
        
        await updateDoc(doc(firestore, 'orders', order.id), updatedData);

        await createAppNotifications(firestore, {
            category: 'Despacho',
            title: `¡Pedido en Camino! #${order.id.substring(0, 6)}`,
            message: `Guía Interna Única: ${internalTracking}. Transportista: ${carrier}.`,
            link: `/dashboard/dispatch?orderId=${order.id}`,
            initiatorId: authUser.uid,
            salespersonId: order.salespersonId,
            customerId: order.customerId,
            roles: ['admin', 'gerencia', 'deposito'],
        });
        
        toast({ title: 'Despacho Sincronizado', description: `Guía Interna ${internalTracking} generada.` });
        onOpenChange(false);
    } catch (error: any) {
        setIsPending(false);
        toast({ variant: 'destructive', title: 'Error de Red', description: 'Fallo al certificar la salida del equipo.' });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl p-0 overflow-hidden rounded-[1.8rem] sm:rounded-[2.5rem] border-none shadow-2xl flex flex-col h-[90vh] sm:h-auto sm:max-h-[90vh]">
        <DialogHeader className="p-6 sm:p-8 bg-slate-900 text-white shrink-0 relative">
          <div className="flex items-center gap-4">
            <div className="p-2.5 sm:p-3 rounded-xl sm:rounded-2xl bg-primary/20 text-primary shadow-xl shrink-0">
                <Truck className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <div className="text-left flex-1 min-w-0">
                <DialogTitle className="text-lg sm:text-2xl font-black uppercase tracking-tighter leading-none truncate">Certificar Despacho</DialogTitle>
                <DialogDescription className="text-slate-400 font-medium mt-1 uppercase text-[8px] sm:text-[10px] tracking-widest truncate">Sincronización de Salida</DialogDescription>
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
                            <Truck className="h-3.5 w-3.5 text-primary" /> Datos del Operador
                        </h3>
                        <div className="space-y-1.5">
                            <Label className="text-[9px] font-black uppercase text-slate-500 px-1">Transportista</Label>
                            <Select onValueChange={setCarrier} value={carrier} required>
                                <SelectTrigger className="h-11 rounded-xl bg-slate-50 border-none shadow-inner font-bold text-xs">
                                    <SelectValue placeholder="Elegir empresa..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {carriers?.map((c) => (<SelectItem key={c.id} value={c.name} className="font-bold uppercase text-[10px]">{c.name.toUpperCase()}</SelectItem>))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[9px] font-black uppercase text-slate-500 px-1">Nro Guía Externa</Label>
                            <Input value={tracking} onChange={(e) => setTracking(e.target.value)} required placeholder="ID de Seguimiento..." className="h-11 font-mono font-bold bg-slate-50 border-none shadow-inner rounded-xl text-sm" />
                        </div>
                        
                        <div className="pt-2">
                            <ImageUploader 
                                folderPath="dispatch-evidence" 
                                onImageUploaded={setDispatchImageUrl} 
                                label="Evidencia Fotográfica de Bultos" 
                            />
                        </div>
                    </div>

                    <div className="space-y-6">
                        <h3 className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2 px-1">
                            <Box className="h-3.5 w-3.5 text-primary" /> Certificación de Carga
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label className="text-[9px] font-black uppercase text-slate-500 px-1">Total Bultos</Label>
                                <Input type="number" min="1" value={packageCount} onChange={(e) => setPackageCount(Number(e.target.value))} className="h-11 font-black text-center text-lg bg-slate-50 border-none shadow-inner rounded-xl" />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-[9px] font-black uppercase text-slate-500 px-1">Peso (kg)</Label>
                                <Input type="number" step="0.1" value={totalWeight} onChange={(e) => setTotalWeight(Number(e.target.value))} className="h-11 font-black text-center text-lg bg-slate-50 border-none shadow-inner rounded-xl" />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[9px] font-black uppercase text-slate-500 px-1">Fecha de Retiro</Label>
                            <Input type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} required className="h-11 font-bold bg-slate-50 border-none shadow-inner rounded-xl text-sm" />
                        </div>
                        
                        <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-100 space-y-2 mt-4">
                            <div className="flex items-center gap-2 text-indigo-700">
                                <ShieldCheck className="h-3.5 w-3.5" />
                                <p className="text-[9px] font-black uppercase">Seguridad Logística</p>
                            </div>
                            <p className="text-[8px] text-indigo-600 uppercase leading-relaxed font-bold">
                                Al confirmar salida, se generará un folio de auditoría único y se notificará al cliente del arribo estimado.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <DialogFooter className="p-6 sm:p-8 border-t border-slate-50 bg-slate-50 flex flex-col-reverse sm:flex-row items-center justify-between gap-4 shrink-0">
                <Button type="button" variant="ghost" className="font-black uppercase tracking-widest text-[9px] h-10 px-6 w-full sm:w-auto" onClick={() => onOpenChange(false)}>Cancelar</Button>
                <Button type="submit" disabled={isPending || isLoadingCarriers} className="h-12 px-10 rounded-xl font-black uppercase tracking-[0.2em] shadow-xl bg-primary hover:bg-primary/90 transition-all active:scale-95 text-[10px] w-full sm:w-auto">
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />} CONFIRMAR SALIDA
                </Button>
            </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
