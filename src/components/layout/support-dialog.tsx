'use client';

import React, { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
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
import { Textarea } from '@/components/ui/textarea';
import { Loader2, LifeBuoy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirestore, useUser } from '@/firebase';
import { collection, serverTimestamp, addDoc } from 'firebase/firestore';
import { SidebarMenuButton } from '../ui/sidebar';
import { createAppNotifications } from '@/lib/notifications';

const supportSchema = z.object({
  subject: z.string().min(1, 'El asunto es requerido.'),
  message: z.string().min(10, 'El mensaje debe tener al menos 10 caracteres.'),
});

type SupportFormValues = z.infer<typeof supportSchema>;

export function SupportDialog({ useMenuItemTrigger = false }: { useMenuItemTrigger?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();
  const { profile } = useUser();

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<SupportFormValues>({
    resolver: zodResolver(supportSchema),
    defaultValues: { subject: '', message: '' },
  });

  const resetAndClose = () => {
    reset();
    setIsOpen(false);
  };

  const onSubmit = async (data: SupportFormValues) => {
    if (!firestore || !profile) return;

    try {
      const ticketsCollection = collection(firestore, 'supportTickets');
      await addDoc(ticketsCollection, {
        ...data,
        userId: profile.id,
        userName: profile.name,
        userEmail: profile.email,
        status: 'Abierto',
        createdAt: serverTimestamp(),
      });

      await createAppNotifications(firestore, {
        category: 'Soporte',
        title: `Nuevo Ticket de Soporte: ${data.subject.substring(0, 30)}...`,
        message: `De: ${profile.name}. Haz clic para ver los detalles.`,
        link: `/dashboard/settings`,
        initiatorId: profile.id,
        roles: ['superadmin', 'admin', 'gerencia'],
      });

      toast({ title: '¡Solicitud Enviada!', description: 'Te contactaremos pronto.' });
      resetAndClose();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo enviar la solicitud.' });
    }
  };
  
  const TriggerComponent = useMenuItemTrigger ? (
     <button className="w-full text-left relative flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground">
      Soporte
    </button>
  ) : (
      <SidebarMenuButton tooltip={{children: "Soporte"}} className="w-full font-bold text-[14px] h-11 px-4 text-white/90 hover:bg-white/10 hover:text-white">
        <LifeBuoy className="h-5 w-5" />
        <span>Soporte</span>
    </SidebarMenuButton>
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
         {TriggerComponent}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Contacto de Soporte</DialogTitle>
          <DialogDescription>¿Necesitas ayuda? Envíanos un mensaje.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="subject">Asunto</Label>
                <Controller name="subject" control={control} render={({ field }) => <Input id="subject" {...field} />} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="message">Mensaje</Label>
                <Controller name="message" control={control} render={({ field }) => <Textarea id="message" rows={5} {...field} />} />
            </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={resetAndClose}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Enviar Mensaje'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}