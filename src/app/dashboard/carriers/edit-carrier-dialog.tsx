
'use client';

import React, { useEffect } from 'react';
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
import { Loader2, Save, Trash2, UserPlus, Edit } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirestore, useUser } from '@/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import type { Carrier } from '@/lib/definitions';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createAppNotifications } from '@/lib/notifications';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

const contactSchema = z.object({
  name: z.string().min(1, 'Nombre requerido'),
  position: z.string().min(1, 'Cargo requerido'),
  phone: z.string().optional(),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
});

const carrierEditSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido.'),
  contacts: z.array(contactSchema).min(1, 'Debe haber al menos un contacto.'),
  trackingUrlTemplate: z.string().url('URL no válida.').optional().or(z.literal('')),
  status: z.enum(['Activo', 'Inactivo']),
});

type CarrierEditFormValues = z.infer<typeof carrierEditSchema>;

export function EditCarrierDialog({ carrier }: { carrier: Carrier }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();
  const { profile: currentUser } = useUser();

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<CarrierEditFormValues>({
    resolver: zodResolver(carrierEditSchema),
    defaultValues: {
      name: carrier.name,
      contacts: carrier.contacts || [{ name: '', position: '', phone: '', email: '' }],
      trackingUrlTemplate: carrier.trackingUrlTemplate || '',
      status: carrier.status,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "contacts"
  });

  useEffect(() => {
    if (isOpen) {
        reset({
            name: carrier.name,
            contacts: carrier.contacts?.length > 0 ? carrier.contacts : [{ name: '', position: '', phone: '', email: '' }],
            trackingUrlTemplate: carrier.trackingUrlTemplate || '',
            status: carrier.status,
        });
    }
  }, [carrier, isOpen, reset]);

  const onSubmit = async (data: CarrierEditFormValues) => {
    if (!firestore || !currentUser || !carrier.id) return;

    try {
        const carrierRef = doc(firestore, 'carriers', carrier.id);
        await updateDoc(carrierRef, {
            ...data,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.id
        } as any);

        toast({ title: '¡Datos Actualizados!', description: `Perfil de ${data.name} guardado con éxito.` });

        await createAppNotifications(firestore, {
            category: 'Despacho',
            title: 'Transportista Actualizado',
            message: `${data.name} modificado por ${currentUser.name}.`,
            link: `/dashboard/carriers?carrier=${carrier.id}`,
            initiatorId: currentUser.id,
            roles: ['admin', 'gerencia', 'deposito']
        });

        setIsOpen(false);
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 font-black uppercase text-[9px] tracking-widest rounded-xl border-slate-200">
          <Edit className="mr-1.5 h-3.5 w-3.5" /> Modificar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl p-0 overflow-hidden rounded-[2rem]">
        <DialogHeader className="p-8 pb-4 bg-slate-50 border-b">
          <DialogTitle className="text-2xl font-black uppercase tracking-tighter">Modificar Transportista</DialogTitle>
          <DialogDescription className="italic font-medium">Actualización de parámetros operativos y agenda de contactos.</DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit(onSubmit)}>
            <ScrollArea className="max-h-[60vh]">
                <div className="p-8 space-y-8">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div className="space-y-1.5">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Nombre de la Empresa</Label>
                            <Controller name="name" control={control} render={({ field }) => <Input {...field} className="h-11 font-bold rounded-xl" />} />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Estado Operativo</Label>
                            <Controller name="status" control={control} render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <SelectTrigger className="h-11 rounded-xl font-bold"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Activo">ACTIVO</SelectItem>
                                        <SelectItem value="Inactivo">INACTIVO</SelectItem>
                                    </SelectContent>
                                </Select>
                            )} />
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="flex items-center justify-between px-1">
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2"><UserPlus className="h-4 w-4" /> Gestión de Agenda</h3>
                            <Button type="button" variant="ghost" size="sm" onClick={() => append({ name: '', position: '', phone: '', email: '' })} className="h-8 text-primary font-black uppercase text-[9px] tracking-widest hover:bg-primary/5">
                                + Añadir Contacto
                            </Button>
                        </div>
                        
                        <Separator className="bg-slate-100" />

                        <div className="space-y-4">
                            {fields.map((field, index) => (
                                <div key={field.id} className="p-5 rounded-2xl border bg-slate-50/30 relative">
                                    <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="absolute top-2 right-2 h-7 w-7 text-rose-500 hover:bg-rose-50 rounded-lg">
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                                        <div className="space-y-1"><Label className="text-[8px] font-black uppercase text-slate-400">Nombre</Label><Controller name={`contacts.${index}.name` as const} control={control} render={({ field }) => <Input {...field} className="h-9 font-bold bg-white text-xs" />} /></div>
                                        <div className="space-y-1"><Label className="text-[8px] font-black uppercase text-slate-400">Cargo</Label><Controller name={`contacts.${index}.position` as const} control={control} render={({ field }) => <Input {...field} className="h-9 font-bold bg-white text-xs" />} /></div>
                                        <div className="space-y-1"><Label className="text-[8px] font-black uppercase text-slate-400">Teléfono</Label><Controller name={`contacts.${index}.phone` as const} control={control} render={({ field }) => <Input {...field} className="h-9 font-bold bg-white text-xs" />} /></div>
                                        <div className="space-y-1"><Label className="text-[8px] font-black uppercase text-slate-400">Email</Label><Controller name={`contacts.${index}.email` as const} control={control} render={({ field }) => <Input {...field} className="h-9 font-bold bg-white text-xs" />} /></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-500">URL de Seguimiento</Label>
                        <Controller name="trackingUrlTemplate" control={control} render={({ field }) => <Input {...field} className="h-11 font-mono text-[10px] rounded-xl" />} />
                    </div>
                </div>
            </ScrollArea>

            <DialogFooter className="p-8 bg-slate-50 border-t flex justify-end">
                <Button type="submit" disabled={isSubmitting} className="font-black uppercase tracking-[0.2em] h-12 px-12 rounded-xl shadow-xl bg-primary hover:bg-primary/90 text-[10px]">
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Guardar Cambios
                </Button>
            </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
