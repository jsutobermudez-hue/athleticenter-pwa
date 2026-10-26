'use client';

import React, { useState, useMemo } from 'react';
import { useUser, useFirestore } from '@/firebase';
import { collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import type { User as AppUser, ChatRoom } from '@/lib/definitions';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Search, Users, X, Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export function NewChatModal({ isOpen, onOpenChange, allUsers, onChatCreated }: { isOpen: boolean, onOpenChange: (open: boolean) => void, allUsers: AppUser[], onChatCreated: (roomId: string) => void }) {
  const { profile: currentUser } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<AppUser[]>([]);
  const [groupName, setGroupName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredUsers = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return allUsers.filter(u => u.id !== currentUser?.id && u.name.toLowerCase().includes(term));
  }, [allUsers, searchTerm, currentUser]);

  const toggleUser = (u: AppUser) => {
    if (selectedUsers.find(x => x.id === u.id)) {
      setSelectedUsers(selectedUsers.filter(x => x.id !== u.id));
    } else {
      setSelectedUsers([...selectedUsers, u]);
    }
  };

  const handleCreate = async () => {
    if (!firestore || !currentUser || selectedUsers.length === 0) return;
    setIsSubmitting(true);
    
    try {
      const batch = writeBatch(firestore);
      const roomId = doc(collection(firestore, 'chats')).id;
      const roomRef = doc(firestore, 'chats', roomId);
      const isGroup = selectedUsers.length > 1;

      if (isGroup && !groupName.trim()) {
        toast({ variant: 'destructive', title: 'Error', description: 'Por favor, dale un nombre al grupo.' });
        setIsSubmitting(false);
        return;
      }

      const allParticipants = [currentUser, ...selectedUsers];
      const participantIds = allParticipants.map(u => u.id);
      const participantNames = allParticipants.map(u => u.name);

      const newRoom: Partial<ChatRoom> = {
        id: roomId,
        type: isGroup ? 'group' : 'direct',
        participants: participantIds,
        participantNames,
        createdBy: currentUser.id,
        createdAt: serverTimestamp() as any,
      };

      if (isGroup) newRoom.name = groupName.trim();

      batch.set(roomRef, newRoom);

      // Welcome message for groups
      if (isGroup) {
        const msgRef = doc(collection(firestore, `chats/${roomId}/messages`));
        batch.set(msgRef, {
          id: msgRef.id,
          roomId,
          senderId: 'system',
          senderName: 'Sistema',
          body: `${currentUser.name} creó el grupo "${groupName}".`,
          isSystemMessage: true,
          readBy: [currentUser.id],
          createdAt: serverTimestamp()
        });
      }

      await batch.commit();
      onChatCreated(roomId);
      setSelectedUsers([]);
      setGroupName('');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden rounded-[2.5rem] border-none shadow-2xl">
        <DialogHeader className="p-6 bg-slate-900 text-white">
          <DialogTitle className="text-xl font-black uppercase">Nuevo Chat</DialogTitle>
        </DialogHeader>

        <div className="p-6 space-y-4">
          {selectedUsers.length > 1 && (
            <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2">
              <Label className="text-[10px] font-black uppercase text-slate-400">Nombre del Grupo</Label>
              <Input 
                value={groupName} 
                onChange={e => setGroupName(e.target.value)} 
                placeholder="Ej. Soporte Ventas Norte" 
                className="bg-slate-50 font-bold uppercase text-xs rounded-xl h-11 border-slate-200"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-[10px] font-black uppercase text-slate-400">Participantes seleccionados</Label>
            <div className="flex flex-wrap gap-2 min-h-[40px] p-2 bg-slate-50 rounded-2xl border border-slate-100">
              {selectedUsers.length === 0 ? <span className="text-[10px] font-bold text-slate-400 p-1">Ninguno seleccionado</span> : null}
              {selectedUsers.map(u => (
                <Badge key={u.id} className="bg-slate-900 text-white pl-1 pr-2 py-1 rounded-xl text-[9px] uppercase flex items-center gap-1.5">
                  <Avatar className="h-4 w-4"><AvatarImage src={u.avatarUrl} /><AvatarFallback>{u.name.charAt(0)}</AvatarFallback></Avatar>
                  {u.name.split(' ')[0]}
                  <button onClick={() => toggleUser(u)} className="ml-1 hover:text-rose-400"><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input 
              placeholder="Buscar contactos..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 bg-slate-50 border-none rounded-xl text-xs font-bold"
            />
          </div>

          <ScrollArea className="h-[250px] border border-slate-100 rounded-2xl">
            <div className="p-2 space-y-1">
              {filteredUsers.map(u => {
                const isSelected = selectedUsers.some(x => x.id === u.id);
                return (
                  <div 
                    key={u.id}
                    onClick={() => toggleUser(u)}
                    className={cn(
                      "flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-colors",
                      isSelected ? "bg-primary/5" : "hover:bg-slate-50"
                    )}
                  >
                    <Avatar className="h-8 w-8"><AvatarImage src={u.avatarUrl} /><AvatarFallback>{u.name.charAt(0)}</AvatarFallback></Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-black uppercase text-slate-900 truncate">{u.name}</p>
                      <p className="text-[9px] font-bold text-primary uppercase">{u.role}</p>
                    </div>
                    {isSelected && <Check className="h-4 w-4 text-primary" />}
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className="p-4 border-t bg-slate-50">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-[10px] font-black uppercase">Cancelar</Button>
          <Button 
            onClick={handleCreate} 
            disabled={selectedUsers.length === 0 || (selectedUsers.length > 1 && !groupName.trim()) || isSubmitting}
            className="rounded-xl bg-primary text-white text-[10px] font-black uppercase px-6"
          >
            {isSubmitting && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
            {selectedUsers.length > 1 ? 'Crear Grupo' : 'Iniciar Chat'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
