'use client';

import React, { useState, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { 
    Loader2, 
    Send, 
    X, 
    User as UserIcon, 
    Zap, 
    Users, 
    Check, 
    Search,
    Briefcase,
    ChevronDown,
    ShieldAlert,
    MessageSquare
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUser, useFirestore } from '@/firebase';
import { writeBatch, doc, collection, serverTimestamp } from 'firebase/firestore';
import type { User } from '@/lib/definitions';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { ScrollArea } from '@/components/ui/scroll-area';

const roleTranslations: Record<string, { label: string, cargo: string }> = {
    superadmin: { label: 'Super Admin', cargo: 'Director General' },
    admin: { label: 'Admin', cargo: 'Administrador de Sistema' },
    gerencia: { label: 'Gerencia', cargo: 'Gerente Operativo' },
    ventas: { label: 'Ventas', cargo: 'Asesor Comercial' },
    deposito: { label: 'Depósito', cargo: 'Logística y Almacén' },
    cliente: { label: 'Cliente', cargo: 'Cuenta B2B' }
};

const messageSchema = z.object({
  recipients: z.array(z.object({ id: z.string(), name: z.string() })).min(1, 'Selecciona al menos un destinatario.'),
  subject: z.string().min(1, 'El asunto es requerido.'),
  body: z.string().min(1, 'Escribe un mensaje.'),
  isBroadcast: z.boolean().default(false),
});

type MessageFormValues = z.infer<typeof messageSchema>;

interface NewMessageDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    allUsers: User[];
}

export function NewMessageDialog({ isOpen, onOpenChange, allUsers }: NewMessageDialogProps) {
  const { toast } = useToast();
  const { profile: currentUser } = useUser();
  const firestore = useFirestore();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const {
    control,
    handleSubmit,
    setValue,
    reset,
    watch,
    formState: { isSubmitting, errors },
  } = useForm<MessageFormValues>({
    resolver: zodResolver(messageSchema),
    defaultValues: { recipients: [], subject: '', body: '', isBroadcast: false },
  });

  const selectedRecipients = watch('recipients') || [];
  const isBroadcast = watch('isBroadcast');
  const canBroadcast = ['superadmin', 'admin', 'gerencia'].includes(currentUser?.role || '');

  const onSubmit = (data: MessageFormValues) => {
    if (!firestore || !currentUser) return;
    
    const batch = writeBatch(firestore);
    const timestamp = serverTimestamp();
    
    const msgBase = {
        senderId: currentUser.id,
        senderName: currentUser.name,
        senderAvatarUrl: currentUser.avatarUrl || '',
        subject: data.isBroadcast ? `📢 DIFUSIÓN: ${data.subject}` : data.subject,
        body: data.body,
        isRead: false,
        createdAt: timestamp,
    };

    const notificationBase = {
        title: `💬 Mensaje de ${currentUser.name}`,
        message: data.subject,
        link: '/dashboard/notifications',
        isRead: false,
        category: 'Usuarios',
        createdAt: timestamp
    };

    const targetUsers = data.isBroadcast 
        ? allUsers.filter(u => u.id !== currentUser.id) 
        : data.recipients;

    targetUsers.forEach(u => {
        const msgRef = doc(collection(firestore, `users/${u.id}/directMessages`));
        batch.set(msgRef, { ...msgBase, userId: u.id });

        const notifyRef = doc(collection(firestore, `users/${u.id}/notifications`));
        batch.set(notifyRef, { ...notificationBase, userId: u.id });
    });

    if (currentUser.id) {
        const outboxRef = doc(collection(firestore, `users/${currentUser.id}/sentMessages`));
        batch.set(outboxRef, { 
            ...msgBase, 
            recipientSummary: data.isBroadcast ? "DIFUSIÓN GLOBAL" : `${data.recipients.length} destinatario(s)` 
        });
    }

    batch.commit()
        .then(() => {
            toast({ title: '¡Comunicación Distribuida!', description: `El mensaje ha sido notificado a la red de chats.` });
            onOpenChange(false);
            reset();
        })
        .catch(async (serverError) => {
            const permissionError = new FirestorePermissionError({
                path: `users/${currentUser.id}/sentMessages`,
                operation: 'write',
                requestResourceData: msgBase
            });
            errorEmitter.emit('permission-error', permissionError);
        });
  };

  const filteredAvailableUsers = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return allUsers.filter(u => {
        if (u.id === currentUser?.id) return false;
        const isSelected = selectedRecipients.some(r => r.id === u.id);
        if (isSelected) return false;
        return u.name.toLowerCase().includes(term) || u.role.toLowerCase().includes(term);
    });
  }, [allUsers, searchTerm, currentUser, selectedRecipients]);

  const toggleRecipient = (user: { id: string, name: string }, e?: React.MouseEvent) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    const exists = selectedRecipients.find(r => r.id === user.id);
    if (exists) setValue('recipients', selectedRecipients.filter(r => r.id !== user.id));
    else setValue('recipients', [...selectedRecipients, user]);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden rounded-[2.5rem] border-none shadow-2xl flex flex-col h-[90vh] sm:h-auto sm:max-h-[90vh]">
        <DialogHeader className="p-8 bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-primary/20 text-primary shadow-xl"><MessageSquare className="h-6 w-6" /></div>
            <div className="text-left">
                <DialogTitle className="text-2xl font-black uppercase tracking-tighter leading-none">Nueva Comunicación</DialogTitle>
                <DialogDescription className="text-slate-400 font-medium mt-1 uppercase text-[10px] tracking-widest">Inicia una conversación en la Bandeja de Chats.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        
        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 flex flex-col min-h-0 bg-white">
            <ScrollArea className="flex-1">
                <div className="p-8 space-y-8">
                    {canBroadcast && (
                        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <ShieldAlert className="h-5 w-5 text-amber-600" />
                                <div className="space-y-0.5">
                                    <Label className="text-xs font-black uppercase text-amber-900">Modo Difusión Global</Label>
                                    <p className="text-[8px] font-bold text-amber-700 uppercase">Enviar a toda la red de usuarios activos</p>
                                </div>
                            </div>
                            <Controller name="isBroadcast" control={control} render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
                        </div>
                    )}

                    {!isBroadcast && (
                        <div className="space-y-3">
                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-1">Vincular Destinatarios</Label>
                            <div className="flex flex-wrap gap-2 p-3 rounded-[1.5rem] bg-slate-50 border border-slate-100 min-h-[50px] shadow-inner">
                                {selectedRecipients.map(r => (
                                    <Badge key={r.id} className="bg-slate-900 text-white font-black uppercase text-[8px] h-8 px-3 gap-3 rounded-lg animate-in zoom-in-95">
                                        {r.name}
                                        <button 
                                            type="button" 
                                            onClick={(e) => toggleRecipient(r, e)} 
                                            className="h-6 w-6 flex items-center justify-center hover:text-rose-400 transition-colors rounded-full hover:bg-white/10"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </Badge>
                                ))}
                                <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
                                    <PopoverTrigger asChild>
                                        <Button variant="ghost" size="sm" className="h-8 text-[9px] font-black uppercase text-primary hover:bg-primary/5 rounded-lg border border-dashed border-primary/20 transition-all active:scale-95">
                                            <Users className="h-3 w-3 mr-1.5" /> Añadir Personal <ChevronDown className="ml-1.5 h-3 w-3" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[320px] p-0 shadow-2xl border-none overflow-hidden rounded-2xl" align="start" style={{ zIndex: 100 }}>
                                        <Command className="bg-white">
                                            <div className="flex items-center border-b px-3 h-12 bg-slate-50">
                                                <Search className="h-4 w-4 mr-2 text-slate-400" />
                                                <Input placeholder="BUSCAR POR NOMBRE O ROL..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="h-8 border-none focus-visible:ring-0 text-[10px] font-black uppercase bg-transparent" />
                                            </div>
                                            <CommandList className="max-h-[250px] p-2">
                                                <CommandEmpty className="p-6 text-center text-[9px] font-bold uppercase text-slate-400">Sin coincidencias.</CommandEmpty>
                                                <CommandGroup heading="PERSONAL DE LA RED" className="px-1 text-[8px] font-black uppercase text-slate-400 tracking-widest">
                                                    {filteredAvailableUsers.map(u => (
                                                        <CommandItem key={u.id} value={u.name} onSelect={() => toggleRecipient({ id: u.id, name: u.name })} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors mb-1 border border-transparent hover:border-slate-100">
                                                            <Avatar className="h-9 w-9 rounded-lg border shadow-sm">
                                                                <AvatarImage src={u.avatarUrl} className="object-cover" />
                                                                <AvatarFallback className="bg-primary/5 text-primary text-[10px] font-black">{u.name.charAt(0)}</AvatarFallback>
                                                            </Avatar>
                                                            <div className="flex flex-col flex-1 min-w-0">
                                                                <span className="font-black text-[11px] uppercase truncate text-slate-900 leading-none">{u.name}</span>
                                                                <span className="text-[8px] font-bold text-primary uppercase mt-1.5 tracking-tighter">{roleTranslations[u.role]?.cargo || 'COLABORADOR'}</span>
                                                            </div>
                                                            <Check className={cn("h-4 w-4 text-emerald-500 opacity-0", selectedRecipients.some(r => r.id === u.id) && "opacity-100")} />
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                            </div>
                            {errors.recipients && <p className="text-[9px] text-rose-500 font-bold uppercase px-1">{errors.recipients.message}</p>}
                        </div>
                    )}
                    
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase text-slate-400 px-1">Asunto de la Conversación</Label>
                            <Controller name="subject" control={control} render={({ field }) => <Input {...field} placeholder="Ej. Duda sobre despacho #123..." className="h-12 bg-slate-50 border-none font-black uppercase text-xs rounded-xl shadow-inner" />} />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase text-slate-400 px-1">Cuerpo del Mensaje</Label>
                            <Controller name="body" control={control} render={({ field }) => <Textarea {...field} placeholder="Escribe aquí tu consulta o soporte..." rows={6} className="bg-slate-50 border-none font-medium text-sm rounded-[1.5rem] p-5 shadow-inner leading-relaxed" />} />
                        </div>
                    </div>
                </div>
            </ScrollArea>

            <DialogFooter className="p-8 border-t bg-slate-50 flex items-center justify-between shrink-0">
                <Button type="button" variant="ghost" className="font-black uppercase tracking-widest text-[9px] h-10 px-6 text-slate-400 transition-all active:scale-95" onClick={() => onOpenChange(false)}>Cancelar</Button>
                <Button type="submit" disabled={isSubmitting || (!isBroadcast && selectedRecipients.length === 0)} className="h-12 px-10 rounded-xl font-black uppercase tracking-[0.2em] bg-primary hover:bg-primary/90 shadow-xl shadow-primary/20 transition-all active:scale-95 text-[10px]">
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} {isBroadcast ? "EMITIR DIFUSIÓN" : "ENVIAR CHAT"}
                </Button>
            </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
