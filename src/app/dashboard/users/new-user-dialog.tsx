'use client';

import React, { useEffect, useState, useMemo } from 'react';
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
import { 
    Loader2, 
    PlusCircle, 
    Eye, 
    EyeOff, 
    User as UserIcon, 
    Lock, 
    Building2,
    Check,
    MapPin,
    Users,
    Search,
    ChevronDown,
    ShieldCheck,
    X
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "cmdk";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { User, Customer } from '@/lib/definitions';
import { useFirestore, useUser, useCollection, useMemoFirebase } from '@/firebase';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { initializeApp, deleteApp } from 'firebase/app';
import { firebaseConfig } from '@/firebase/config';
import { doc, collection, query, serverTimestamp, runTransaction, limit } from 'firebase/firestore';
import { ImageUploader } from '@/components/ui/image-uploader';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

const roles: User['role'][] = ['superadmin', 'admin', 'gerencia', 'deposito', 'ventas', 'cliente'];

const newUserSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido.'),
  email: z.string().email('Email inválido.'),
  password: z.string().min(6, 'Mínimo 6 caracteres.'),
  role: z.enum(roles as any),
  avatarUrl: z.string().optional(),
  phone: z.string().optional().default(''),
  address: z.string().optional().default(''),
  isLinkingToExisting: z.boolean().default(false),
  associatedCustomerId: z.string().optional(),
  razonSocial: z.string().optional(),
  rif: z.string().optional(),
  assignedSalespersonId: z.string().optional(),
  creditLimit: z.coerce.number().min(0).default(0),
}).superRefine((data, ctx) => {
    if (data.role === 'cliente') {
        if (data.isLinkingToExisting) {
            if (!data.associatedCustomerId) {
                ctx.addIssue({ 
                    code: 'custom', 
                    message: 'Selecciona una empresa existente.', 
                    path: ['associatedCustomerId'] 
                });
            }
        } else {
            if (!data.razonSocial) {
                ctx.addIssue({ 
                    code: 'custom', 
                    message: 'Razón social requerida para nuevas cuentas.', 
                    path: ['razonSocial'] 
                });
            }
            if (!data.rif) {
                ctx.addIssue({ 
                    code: 'custom', 
                    message: 'RIF requerido.', 
                    path: ['rif'] 
                });
            }
        }
    }
});

type NewUserFormValues = z.infer<typeof newUserSchema>;

export function NewUserDialog({ buttonLabel = "Crear Usuario", defaultRole = 'ventas' }: { buttonLabel?: string; defaultRole?: User['role']; }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isCustomerPopoverOpen, setIsCustomerPopoverOpen] = useState(false);
  const { toast } = useToast();
  const firestore = useFirestore();
  const { user: authUser } = useUser();

  const usersQuery = useMemoFirebase(() => (firestore && authUser) ? query(collection(firestore, 'users'), limit(500)) : null, [firestore, authUser]);
  const { data: allUsers } = useCollection<User>(usersQuery);

  const customersQuery = useMemoFirebase(() => (firestore && authUser) ? query(collection(firestore, 'customers'), limit(200)) : null, [firestore, authUser]);
  const { data: allCustomers } = useCollection<Customer>(customersQuery);

  const staffMembers = useMemo(() => {
    if (!allUsers) return [];
    return allUsers.filter(u => u.role !== 'cliente').sort((a, b) => a.name.localeCompare(b.name));
  }, [allUsers]);

  const { control, handleSubmit, formState: { errors, isSubmitting }, reset, watch, setValue } = useForm<NewUserFormValues>({
    resolver: zodResolver(newUserSchema),
    defaultValues: { 
        role: defaultRole, 
        name: '', 
        email: '', 
        password: '', 
        avatarUrl: '', 
        phone: '', 
        address: '', 
        isLinkingToExisting: false, 
        associatedCustomerId: '', 
        razonSocial: '', 
        rif: '', 
        assignedSalespersonId: '', 
        creditLimit: 0 
    }
  });
  
  const watchedRole = watch("role");
  const isLinking = watch("isLinkingToExisting");
  const selectedCustomerId = watch("associatedCustomerId");

  const selectedCustomerData = useMemo(() => 
    allCustomers?.find(c => c.id === selectedCustomerId), 
  [allCustomers, selectedCustomerId]);

  const resetAndClose = () => { 
    reset(); 
    setIsOpen(false); 
  };

  const onSubmit = async (data: NewUserFormValues) => {
    if (!firestore || !authUser) return;
    
    const tempApp = initializeApp(firebaseConfig, `creation-${Date.now()}`);
    try {
        const tempAuth = getAuth(tempApp);
        const userCredential = await createUserWithEmailAndPassword(tempAuth, data.email, data.password);
        const newUserUid = userCredential.user.uid;

        await runTransaction(firestore, async (transaction) => {
            const finalCustomerId = data.role === 'cliente' 
                ? (data.isLinkingToExisting ? data.associatedCustomerId : newUserUid)
                : null;

            transaction.set(doc(firestore, "users", newUserUid), { 
                id: newUserUid,
                name: data.name, 
                email: data.email, 
                role: data.role, 
                status: 'Activo', 
                associatedCustomerId: finalCustomerId,
                avatarUrl: data.avatarUrl || '', 
                phone: data.phone || '', 
                address: data.address || '',
                createdAt: serverTimestamp(), 
                updatedAt: serverTimestamp()
            });

            if (data.role === 'cliente' && !data.isLinkingToExisting) {
                const sp = staffMembers.find(s => s.id === data.assignedSalespersonId);
                transaction.set(doc(firestore, 'customers', newUserUid), { 
                    id: newUserUid,
                    razonSocial: data.razonSocial || '', 
                    rif: data.rif || '', 
                    address: data.address || '', 
                    email: data.email, 
                    phone: data.phone || '', 
                    creditLimit: data.creditLimit || 0, 
                    creditUsed: 0,
                    assignedSalespersonId: data.assignedSalespersonId || '', 
                    assignedSalespersonName: sp?.name || 'Personal Staff', 
                    status: 'Activo', 
                    createdAt: serverTimestamp(), 
                    createdBy: authUser.uid 
                });
            }
        });

        toast({ title: '¡Registro Exitoso!', description: 'El acceso de red y el expediente han sido sincronizados.' });
        resetAndClose();
    } catch (error: any) {
        toast({ 
            variant: 'destructive', 
            title: 'Fallo de Registro', 
            description: error.message || 'Error inesperado.' 
        });
    } finally {
        await deleteApp(tempApp);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="font-black uppercase tracking-widest text-[10px] h-11 rounded-xl shadow-lg bg-primary hover:bg-primary/90 transition-all active:scale-95">
            <PlusCircle className="mr-2 h-4 w-4" /> {buttonLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl p-0 rounded-[2.5rem] border-none shadow-2xl flex flex-col h-[95vh] sm:max-h-[90vh] overflow-hidden">
        <DialogHeader className="p-8 pb-4 bg-slate-900 text-white shrink-0 relative">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-primary/20 text-primary shadow-xl">
                <UserIcon className="h-6 w-6" />
            </div>
            <div className="text-left">
                <DialogTitle className="text-2xl font-black uppercase tracking-tighter leading-none">Alta de Identidad</DialogTitle>
                <DialogDescription className="text-slate-400 font-medium mt-1 uppercase text-[10px] tracking-widest">Protocolo de Acceso Athleticenter v6.0</DialogDescription>
            </div>
          </div>
          <button onClick={() => !isSubmitting && setIsOpen(false)} className="absolute top-8 right-8 text-white/40 hover:text-white transition-colors">
            <X className="h-6 w-6" />
          </button>
        </DialogHeader>
        
        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 flex flex-col min-h-0 bg-white overflow-hidden">
            <ScrollArea className="flex-1 min-h-0">
                <div className="p-8 space-y-10">
                    <section className="space-y-6">
                        <div className="flex items-center gap-2 px-1 text-primary">
                            <Lock className="h-4 w-4" />
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Configuración de Acceso</h3>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase text-slate-400 px-1">Rol Operativo</Label>
                                <Controller name="role" control={control} render={({ field }) => (
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <SelectTrigger className="h-11 rounded-xl bg-slate-50 border-none shadow-inner font-bold">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent position="popper" className="z-[200]">
                                            {roles.map(r => (
                                                <SelectItem key={r} value={r} className="text-[10px] font-bold uppercase">{r.toUpperCase()}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )} />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase text-slate-400 px-1">Email de Usuario</Label>
                                <Controller name="email" control={control} render={({ field }) => (
                                    <Input type="email" {...field} placeholder="ejemplo@athleticenter.com" className="h-11 font-bold rounded-xl bg-slate-50 border-none shadow-inner" />
                                )} />
                                {errors.email && <p className="text-[9px] text-rose-500 font-bold uppercase px-1">{errors.email.message}</p>}
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase text-slate-400 px-1">Contraseña Temporal</Label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <Controller name="password" control={control} render={({ field }) => (
                                    <Input type={showPassword ? 'text' : 'password'} {...field} placeholder="Mínimo 6 caracteres" className="pl-10 h-11 rounded-xl bg-slate-50 border-none shadow-inner font-bold" />
                                )} />
                                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-primary transition-colors" onClick={() => setShowPassword(!showPassword)}>
                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                            {errors.password && <p className="text-[9px] text-rose-500 font-bold uppercase px-1">{errors.password.message}</p>}
                        </div>
                    </section>

                    {watchedRole === 'cliente' && (
                        <section className="p-6 bg-slate-900 text-white rounded-[2rem] space-y-6 animate-in zoom-in-95 shadow-2xl">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-primary">
                                    <Building2 className="h-4 w-4" />
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Expediente Comercial</h3>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Label className="text-[9px] font-black uppercase text-slate-400">Vincular Existente</Label>
                                    <Controller name="isLinkingToExisting" control={control} render={({ field }) => (
                                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                                    )} />
                                </div>
                            </div>

                            {isLinking ? (
                                <div className="space-y-4 animate-in fade-in-0 slide-in-from-top-2">
                                    <Label className="text-[10px] font-black uppercase text-slate-400 px-1">Seleccionar Empresa de la Red</Label>
                                    <Popover open={isCustomerPopoverOpen} onOpenChange={setIsCustomerPopoverOpen}>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" className="w-full h-12 bg-white/10 border-white/20 text-white font-bold justify-between rounded-xl hover:bg-white/20 transition-all">
                                                {selectedCustomerData ? selectedCustomerData.razonSocial : "BUSCAR RIF O NOMBRE..."}
                                                <ChevronDown className="h-4 w-4 opacity-50" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-[350px] p-0 rounded-2xl shadow-2xl overflow-hidden border-none" align="start" style={{ zIndex: 300 }}>
                                            <Command>
                                                <CommandInput placeholder="Filtrar clientes..." className="h-11 font-bold uppercase text-[10px]" />
                                                <CommandList>
                                                    <CommandEmpty className="p-4 text-center italic text-xs uppercase font-bold text-slate-400">Sin registros.</CommandEmpty>
                                                    <CommandGroup className="p-2">
                                                        {allCustomers?.map(c => (
                                                            <CommandItem key={c.id} value={c.razonSocial + " " + c.rif} onSelect={() => { setValue('associatedCustomerId', c.id!); setIsCustomerPopoverOpen(false); }} className="rounded-xl p-3 cursor-pointer">
                                                                <div className="flex flex-col">
                                                                    <span className="font-black text-[11px] uppercase text-slate-900 leading-none">{c.razonSocial}</span>
                                                                    <span className="text-[9px] font-mono font-bold text-slate-400 mt-1.5 uppercase">RIF: {c.rif}</span>
                                                                </div>
                                                                <Check className={cn("ml-auto h-4 w-4 text-emerald-500", selectedCustomerId === c.id ? "opacity-100" : "opacity-0")} />
                                                            </CommandItem>
                                                        ))}
                                                    </CommandGroup>
                                                </CommandList>
                                            </Command>
                                        </PopoverContent>
                                    </Popover>
                                </div>
                            ) : (
                                <div className="space-y-6 animate-in fade-in-0 slide-in-from-bottom-2">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label className="text-[9px] font-black uppercase text-slate-400 px-1">Razón Social Completa</Label>
                                            <Controller name="razonSocial" control={control} render={({ field }) => (
                                                <Input {...field} placeholder="EJ. TIENDA DEPORTIVA C.A." className="h-10 bg-white/5 border-none text-xs font-black rounded-lg uppercase shadow-inner" />
                                            )} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-[9px] font-black uppercase text-slate-400 px-1">RIF Fiscal</Label>
                                            <Controller name="rif" control={control} render={({ field }) => (
                                                <Input {...field} placeholder="J-00000000-0" className="h-10 bg-white/5 border-none font-mono text-xs font-bold rounded-lg uppercase shadow-inner" />
                                            )} />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[9px] font-black uppercase text-slate-400 px-1">Asesor Responsable (Personal Staff)</Label>
                                        <Controller name="assignedSalespersonId" control={control} render={({ field }) => (
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <SelectTrigger className="h-10 bg-white/10 border-none rounded-lg text-[10px] font-bold uppercase text-white">
                                                    <SelectValue placeholder="ELEGIR ASESOR..." />
                                                </SelectTrigger>
                                                <SelectContent position="popper" className="z-[200]">
                                                    {staffMembers.map(s => (
                                                        <SelectItem key={s.id} value={s.id} className="text-[10px] font-bold uppercase">{s.name.toUpperCase()}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        )} />
                                    </div>
                                </div>
                            )}
                        </section>
                    )}

                    <section className="space-y-6">
                        <div className="flex items-center gap-2 px-1 text-primary">
                            <UserIcon className="h-4 w-4" />
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Datos Personales del Contacto</h3>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase text-slate-400 px-1">Nombre Completo</Label>
                                <Controller name="name" control={control} render={({ field }) => (
                                    <Input {...field} placeholder="Nombre y Apellido" className="h-11 font-bold rounded-xl bg-slate-50 border-none shadow-inner" />
                                )} />
                                {errors.name && <p className="text-[9px] text-rose-500 font-bold uppercase px-1">{errors.name.message}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black uppercase text-slate-400 px-1">Teléfono Directo</Label>
                                <Controller name="phone" control={control} render={({ field }) => (
                                    <Input {...field} placeholder="04XX-0000000" className="h-11 font-bold rounded-xl bg-slate-50 border-none shadow-inner" />
                                )} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-2 px-1">
                                <MapPin className="h-3 w-3" /> Dirección de Notificación
                            </Label>
                            <Controller name="address" control={control} render={({ field }) => (
                                <Textarea {...field} placeholder="Ingresa la dirección detallada o ciudad..." className="rounded-xl bg-slate-50 border-none shadow-inner min-h-[80px] font-medium text-sm leading-relaxed" />
                            )} />
                        </div>
                        <div className="pt-4">
                            <Controller name="avatarUrl" control={control} render={({ field }) => (
                                <ImageUploader 
                                    folderPath="user-avatars" 
                                    initialImageUrl={field.value} 
                                    onImageUploaded={field.onChange} 
                                    label="Imagen de Perfil" 
                                    variant="avatar" 
                                />
                            )} />
                        </div>
                    </section>
                </div>
            </ScrollArea>
            <DialogFooter className="p-8 border-t border-slate-50 bg-slate-50 shrink-0">
                <div className="flex flex-col sm:flex-row items-center justify-between w-full gap-6">
                    <div className="hidden sm:flex items-center gap-2 text-slate-400">
                        <ShieldCheck className="h-5 w-5 text-emerald-500" />
                        <span className="text-[9px] font-black uppercase tracking-widest">Protocolo Seguro de Red</span>
                    </div>
                    <div className="flex gap-4 w-full sm:w-auto">
                        <Button type="button" variant="ghost" className="font-black uppercase tracking-widest text-[9px] h-10 px-6 text-slate-400" onClick={resetAndClose}>Cancelar</Button>
                        <Button type="submit" disabled={isSubmitting} className="h-12 px-10 rounded-xl font-black uppercase tracking-[0.2em] shadow-xl bg-primary hover:bg-primary/90 transition-all active:scale-95 text-[10px] flex-1 sm:flex-none">
                            {isSubmitting ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : "REGISTRAR EN RED"}
                        </Button>
                    </div>
                </div>
            </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
