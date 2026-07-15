'use client';

import React, { useState, useMemo, useEffect } from 'react';
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
import { Loader2, User as UserIcon, Lock, Building2, MapPin, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { User, Customer } from '@/lib/definitions';
import { useFirestore, useUser, useDoc, useCollection, useMemoFirebase } from '@/firebase';
import { doc, collection, query, serverTimestamp, runTransaction, limit } from 'firebase/firestore';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ImageUploader } from '@/components/ui/image-uploader';

const roles: User['role'][] = ['superadmin', 'admin', 'gerencia', 'deposito', 'ventas', 'cliente'];

const editUserSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido.'),
  email: z.string().email('Email inválido.'),
  role: z.enum(roles as any),
  avatarUrl: z.string().optional(),
  phone: z.string().min(1, 'Teléfono requerido.'),
  address: z.string().min(5, 'La dirección debe tener al menos 5 caracteres.'),
  razonSocial: z.string().optional(),
  rif: z.string().optional(),
  assignedSalespersonId: z.string().optional(),
  creditLimit: z.coerce.number().min(0).optional(),
  status: z.enum(['Activo', 'Inactivo', 'Pendiente']),
});

type EditUserFormValues = z.infer<typeof editUserSchema>;

interface EditUserDialogProps {
  user: User;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
}

export function EditUserDialog({ user, isOpen, onOpenChange, title, description }: EditUserDialogProps) {
  const { toast } = useToast();
  const firestore = useFirestore();
  const { user: authUser } = useUser();

  const customerRef = useMemoFirebase(() => (firestore && user.role === 'cliente') ? doc(firestore, 'customers', user.id) : null, [firestore, user.id, user.role]);
  const { data: customerDoc } = useDoc<Customer>(customerRef);

  const usersQuery = useMemoFirebase(() => (firestore && authUser) ? query(collection(firestore, 'users'), limit(500)) : null, [firestore, authUser]);
  const { data: allUsers } = useCollection<User>(usersQuery);

  const salespeople = useMemo(() => {
    if (!allUsers) return [];
    return allUsers
        .filter(u => u.role && u.role !== 'cliente')
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [allUsers]);

  const { control, handleSubmit, formState: { errors, isSubmitting }, reset, watch } = useForm<EditUserFormValues>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      name: user.name,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl,
      phone: user.phone,
      address: user.address,
      razonSocial: '',
      rif: '',
      assignedSalespersonId: '',
      creditLimit: 0,
      status: (user.status as any) || 'Activo',
    },
  });

  const watchedRole = watch("role");

  useEffect(() => {
    if (isOpen) {
      reset({
        name: user.name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl || '',
        phone: user.phone || '',
        address: user.address || '',
        razonSocial: customerDoc?.razonSocial || '',
        rif: customerDoc?.rif || '',
        assignedSalespersonId: customerDoc?.assignedSalespersonId || '',
        creditLimit: customerDoc?.creditLimit || 0,
        status: (user.status as any) || 'Activo',
      });
    }
  }, [user, customerDoc, isOpen, reset]);

  const onSubmit = async (data: EditUserFormValues) => {
    if (!firestore || !authUser) return;
    try {
      await runTransaction(firestore, async (transaction) => {
        const userRef = doc(firestore, "users", user.id);
        transaction.update(userRef, {
          name: data.name,
          email: data.email,
          role: data.role,
          status: data.status,
          avatarUrl: data.avatarUrl || '',
          phone: data.phone || '',
          address: data.address || '',
          updatedAt: serverTimestamp()
        });

        if (data.role === 'cliente') {
          const sp = salespeople.find(s => s.id === data.assignedSalespersonId);
          const cRef = doc(firestore, 'customers', user.id);
          transaction.set(cRef, {
            razonSocial: data.razonSocial || '',
            rif: data.rif || '',
            address: data.address,
            email: data.email,
            phone: data.phone || '',
            creditLimit: data.creditLimit || 0,
            assignedSalespersonId: data.assignedSalespersonId || '',
            assignedSalespersonName: sp?.name || 'Sin Asignar',
            status: data.status,
            updatedAt: serverTimestamp(),
          }, { merge: true });
        }
      });
      toast({ title: '¡Expediente Actualizado!' });
      onOpenChange(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 rounded-[2.5rem] border-none shadow-2xl flex flex-col h-[95vh] sm:max-h-[90vh] overflow-hidden">
        <DialogHeader className="p-8 pb-4 bg-slate-900 text-white shrink-0 relative">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-primary/20 text-primary shadow-xl"><UserIcon className="h-6 w-6" /></div>
            <div className="text-left">
              <DialogTitle className="text-2xl font-black uppercase tracking-tighter leading-none">{title || 'Editar Perfil'}</DialogTitle>
              <DialogDescription className="text-slate-400 font-medium mt-1 uppercase text-[10px] tracking-widest">Sincronización de Identidad</DialogDescription>
            </div>
          </div>
          <button onClick={() => !isSubmitting && onOpenChange(false)} className="absolute top-8 right-8 text-white/40 hover:text-white transition-colors">
            <X className="h-6 w-6" />
          </button>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 flex flex-col min-h-0 bg-white overflow-hidden">
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-8 space-y-10">
              <section className="space-y-6">
                <div className="flex items-center gap-2 px-1 text-primary"><Lock className="h-4 w-4" /><h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Acceso de Red</h3></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-slate-400 px-1">Rol Operativo</Label>
                    <Controller name="role" control={control} render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}><SelectTrigger className="h-11 rounded-xl bg-slate-50 border-none shadow-inner font-bold"><SelectValue /></SelectTrigger><SelectContent position="popper" className="z-[200]">{roles.map(r => <SelectItem key={r} value={r} className="text-[10px] font-bold uppercase">{r.toUpperCase()}</SelectItem>)}</SelectContent></Select>
                    )} />
                    {errors.role && <p className="text-[10px] text-rose-500 font-bold uppercase px-1">{errors.role.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-slate-400 px-1">Email Usuario</Label>
                    <Controller name="email" control={control} render={({ field }) => <Input type="email" {...field} className="h-11 font-bold rounded-xl bg-slate-50 border-none shadow-inner" />} />
                    {errors.email && <p className="text-[10px] text-rose-500 font-bold uppercase px-1">{errors.email.message}</p>}
                  </div>
                </div>
              </section>

              {watchedRole === 'cliente' && (
                <section className="space-y-6 animate-in fade-in-0 duration-500">
                  <div className="flex items-center gap-2 px-1 text-primary"><Building2 className="h-4 w-4" /><h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Expediente B2B</h3></div>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-[10px] font-black uppercase text-slate-400 px-1">Razón Social</Label>
                          <Controller name="razonSocial" control={control} render={({ field }) => <Input {...field} className="h-11 font-bold rounded-xl bg-slate-50 border-none shadow-inner" />} />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[10px] font-black uppercase text-slate-400 px-1">RIF Fiscal</Label>
                          <Controller name="rif" control={control} render={({ field }) => <Input {...field} className="h-11 font-mono font-bold rounded-xl bg-slate-50 border-none shadow-inner" />} />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase text-slate-400 px-1">Asesor Asignado (Personal Staff)</Label>
                        <Controller name="assignedSalespersonId" control={control} render={({ field }) => (
                            <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger className="h-11 rounded-xl bg-slate-50 border-none shadow-inner font-bold"><SelectValue placeholder="Sin Asignar" /></SelectTrigger>
                                <SelectContent position="popper" className="z-[200]">
                                    {salespeople.map(s => <SelectItem key={s.id} value={s.id} className="text-[10px] font-bold uppercase">{s.name.toUpperCase()}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        )} />
                    </div>
                  </div>
                </section>
              )}

              <section className="space-y-6">
                <div className="flex items-center gap-2 px-1 text-primary"><UserIcon className="h-4 w-4" /><h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Identidad Personal</h3></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-slate-400 px-1">Nombre</Label>
                    <Controller name="name" control={control} render={({ field }) => <Input {...field} className="h-11 font-bold rounded-xl bg-slate-50 border-none shadow-inner" />} />
                    {errors.name && <p className="text-[10px] text-rose-500 font-bold uppercase px-1">{errors.name.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-slate-400 px-1">Teléfono</Label>
                    <Controller name="phone" control={control} render={({ field }) => <Input {...field} className="h-11 font-bold rounded-xl bg-slate-50 border-none shadow-inner" />} />
                  </div>
                </div>
                <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-2 px-1"><MapPin className="h-3 w-3" /> Dirección Fiscal</Label>
                    <Controller name="address" control={control} render={({ field }) => <Textarea {...field} className="rounded-xl bg-slate-50 border-none shadow-inner min-h-[80px]" />} />
                    {errors.address && <p className="text-[10px] text-rose-500 font-bold uppercase px-1">{errors.address.message}</p>}
                </div>
                <div className="pt-4">
                    <Controller name="avatarUrl" control={control} render={({ field }) => <ImageUploader folderPath="user-avatars" initialImageUrl={field.value} onImageUploaded={field.onChange} label="Imagen de Perfil" variant="avatar" />} />
                </div>
              </section>
            </div>
          </ScrollArea>
          <DialogFooter className="p-8 border-t border-slate-50 bg-slate-50 shrink-0">
            <Button variant="ghost" className="font-black uppercase tracking-widest text-[9px] h-10 px-6 text-slate-400" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting} className="h-12 px-10 rounded-xl font-black uppercase tracking-[0.2em] shadow-xl bg-primary shadow-primary/20 hover:bg-primary/90 transition-all active:scale-95 text-[10px]">GUARDAR CAMBIOS</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
