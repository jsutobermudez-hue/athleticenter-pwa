
'use client';

import React from 'react';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
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
import { Loader2, PlusCircle, Trash2, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirestore, useUser } from '@/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import type { Carrier } from '@/lib/definitions';
import { createAppNotifications } from '@/lib/notifications';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

const contactSchema = z.object({
  name: z.string().min(1, 'Nombre requerido'),
  position: z.string().min(1, 'Cargo requerido'),
  phone: z.string().optional(),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
});

const carrierSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido.'),
  contacts: z.array(contactSchema).min(1, 'Debe registrar al menos un contacto.'),
  trackingUrlTemplate: z.string().url('URL no válida.').optional().or(z.literal('')),
});

type CarrierFormValues = z.infer<typeof carrierSchema>;

export function NewCarrierDialog() {
  const [isOpen, setIsOpen] = React.useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();
  const { profile: currentUser } = useUser();

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setValue,
    watch
  } = useForm<CarrierFormValues>({
    resolver: zodResolver(carrierSchema),
    defaultValues: {
      name: '',
      contacts: [{ name: '', position: '', phone: '', email: '' }],
      trackingUrlTemplate: '',
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "contacts"
  });

  const resetAndClose = () => {
    reset();
    setIsOpen(false);
  };

  const onSubmit = async (data: CarrierFormValues) => {
    if (!firestore || !currentUser) {
        toast({ variant: 'destructive', title: 'Error', description: 'Servicio no disponible.' });
        return;
    }
    
    try {
        const newCarrier: Omit<Carrier, 'id'> = {
          ...data,
          status: 'Activo',
          createdAt: serverTimestamp() as any,
        };

        const docRef = await addDoc(collection(firestore, 'carriers'), newCarrier as any);

        toast({ title: '¡Transportista Registrado!', description: `${data.name} ha sido añadido con ${data.contacts.length} contactos.` });

        await createAppNotifications(firestore, {
            category: 'Despacho',
            title: 'Nuevo Transportista',
            message: `${data.name} fue registrado por ${currentUser.name}.`,
            link: `/dashboard/carriers`,
            initiatorId: currentUser.id,
            roles: ['admin', 'gerencia', 'deposito']
        });
        
        resetAndClose();
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => open ? setIsOpen(true) : resetAndClose()}>
      <DialogTrigger asChild>
        <Button className="font-black uppercase tracking-widest text-[10px] h-11 rounded-xl shadow-xl">
          <PlusCircle className="mr-2 h-4 w-4" /> Registrar Transportista
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl p-0 overflow-hidden rounded-[2rem]">
        <DialogHeader className="p-8 pb-4 bg-slate-50 border-b">
          <DialogTitle className="text-2xl font-black uppercase tracking-tighter">Registrar Empresa de Envío</DialogTitle>
          <DialogDescription className="italic font-medium">Define el perfil corporativo y su cartera de contactos logísticos.</DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit(onSubmit)}>
            <ScrollArea className="max-h-[60vh]">
                <div className="p-8 space-y-8">
                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Nombre de la Empresa</Label>
                        <Controller name="name" control={control} render={({ field }) => <Input {...field} placeholder="Ej. MRW, Zoom, Tealca..." className="h-12 font-bold rounded-xl bg-slate-50 border-none shadow-inner" />} />
                        {errors.name && <p className="text-[10px] text-destructive font-bold uppercase">{errors.name.message}</p>}
                    </div>

                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2"><UserPlus className="h-4 w-4" /> Cartera de Contactos</h3>
                            <Button type="button" variant="outline" size="sm" onClick={() => append({ name: '', position: '', phone: '', email: '' })} className="h-8 rounded-lg font-black uppercase text-[9px] tracking-widest border-primary/20 text-primary hover:bg-primary/5">
                                <PlusCircle className="mr-1.5 h-3 w-3" /> Añadir Contacto
                            </Button>
                        </div>
                        
                        <Separator className="bg-slate-100" />

                        <div className="space-y-6">
                            {fields.map((field, index) => (
                                <div key={field.id} className="p-6 rounded-2xl border bg-slate-50/30 relative animate-in fade-in-0 slide-in-from-top-2">
                                    {fields.length > 1 && (
                                        <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="absolute top-2 right-2 h-7 w-7 text-rose-500 hover:bg-rose-50 rounded-lg">
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    )}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <Label className="text-[9px] font-bold uppercase text-slate-400">Nombre Completo</Label>
                                            <Controller name={`contacts.${index}.name` as const} control={control} render={({ field }) => <Input {...field} className="h-10 font-bold bg-white rounded-lg" />} />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-[9px] font-bold uppercase text-slate-400">Cargo / Posición</Label>
                                            <Controller name={`contacts.${index}.position` as const} control={control} render={({ field }) => <Input {...field} placeholder="Ej. Gerente, Conductor..." className="h-10 font-bold bg-white rounded-lg" />} />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-[9px] font-bold uppercase text-slate-400">Teléfono</Label>
                                            <Controller name={`contacts.${index}.phone` as const} control={control} render={({ field }) => <Input {...field} className="h-10 font-bold bg-white rounded-lg" />} />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-[9px] font-bold uppercase text-slate-400">Email Corporativo</Label>
                                            <Controller name={`contacts.${index}.email` as const} control={control} render={({ field }) => <Input {...field} type="email" className="h-10 font-bold bg-white rounded-lg" />} />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Plantilla URL de Seguimiento</Label>
                        <Controller name="trackingUrlTemplate" control={control} render={({ field }) => <Input {...field} placeholder="https://ejemplo.com/track?id={trackingNumber}" className="h-11 font-mono text-[10px] rounded-xl bg-slate-50 border-none shadow-inner" />} />
                        <p className="text-[8px] text-muted-foreground font-bold uppercase">USA {'{trackingNumber}'} COMO COMODÍN PARA EL ENLACE AUTOMÁTICO.</p>
                    </div>
                </div>
            </ScrollArea>

            <DialogFooter className="p-8 bg-slate-50 border-t flex justify-end">
                <div className="flex gap-3">
                    <Button type="button" variant="ghost" onClick={resetAndClose} className="font-black uppercase tracking-widest text-[10px] h-12 px-6">Cancelar</Button>
                    <Button type="submit" disabled={isSubmitting} className="font-black uppercase tracking-[0.2em] h-12 px-10 rounded-xl shadow-xl bg-primary hover:bg-primary/90 text-[10px]">
                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Sincronizar Transportista'}
                    </Button>
                </div>
            </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
