'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useFirestore, useUser } from '@/firebase';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Users, Sparkles, Hash } from 'lucide-react';

interface CreateGroupDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onGroupCreated?: (groupId: string) => void;
}

export function CreateGroupDialog({ isOpen, onOpenChange, onGroupCreated }: CreateGroupDialogProps) {
  const firestore = useFirestore();
  const { profile: currentUser } = useUser();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({ variant: 'destructive', title: 'Nombre requerido', description: 'Por favor ingresa un nombre para el grupo.' });
      return;
    }
    if (!firestore || !currentUser) return;

    setIsSubmitting(true);
    try {
      const cleanSlug = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '-');
      const channelId = `group-${cleanSlug}-${Date.now().toString().slice(-4)}`;
      const channelRef = doc(firestore, 'group_channels', channelId);

      await setDoc(channelRef, {
        id: channelId,
        name: name.trim().startsWith('#') ? name.trim() : `#${name.trim()}`,
        description: description.trim() || 'Canal de chat de equipo',
        iconName: 'Users',
        createdBy: currentUser.id,
        isSystemDefault: false,
        membersCount: 1,
        lastMessage: 'Grupo creado por ' + (currentUser.name || 'Usuario'),
        lastMessageAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });

      toast({ title: 'Grupo Creado', description: `El canal ${name} ha sido creado exitosamente.` });
      setName('');
      setDescription('');
      onOpenChange(false);
      if (onGroupCreated) onGroupCreated(channelId);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al crear grupo', description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-3xl p-6 bg-white shadow-2xl border-none">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <Users className="h-5 w-5" />
            </div>
            <DialogTitle className="text-xl font-black uppercase text-slate-900 tracking-tight">
              Crear Nuevo Grupo de Chat
            </DialogTitle>
          </div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Crea un canal de comunicación para tu departamento o proyecto
          </p>
        </DialogHeader>

        <div className="space-y-4 py-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-black uppercase text-slate-700">Nombre del Canal / Grupo</Label>
            <div className="relative">
              <Hash className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ej. equipo-maracaibo o proyecto-spartan"
                className="pl-10 h-11 rounded-xl bg-slate-50 font-bold border-slate-200 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-black uppercase text-slate-700">Descripción u Objetivo</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe el propósito de este grupo de trabajo..."
              className="rounded-xl bg-slate-50 font-bold border-slate-200 text-xs min-h-[80px]"
            />
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-xl font-black text-xs uppercase">
            Cancelar
          </Button>
          <Button
            onClick={handleCreate}
            disabled={isSubmitting}
            className="rounded-xl font-black text-xs uppercase bg-indigo-600 hover:bg-indigo-700 text-white px-6"
          >
            {isSubmitting ? <Loader2 className="animate-spin h-4 w-4" /> : 'Crear Grupo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
