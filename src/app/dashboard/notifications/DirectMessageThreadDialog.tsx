'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Send, 
  Loader2, 
  User as UserIcon, 
  MessageSquare, 
  CheckCheck, 
  Clock, 
  ShieldCheck,
  Sparkles,
  ArrowLeft
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy, limit, doc, setDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { triggerPushNotificationAction } from '@/app/actions';
import type { DirectMessage, SentMessage } from '@/lib/definitions';
import { cn } from '@/lib/utils';

export interface ChatContact {
  id: string;
  name: string;
  avatarUrl?: string;
  role?: string;
  email?: string;
}

interface DirectMessageThreadDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  contact: ChatContact | null;
  initialSubject?: string;
}

interface MergedThreadMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatarUrl?: string;
  body: string;
  subject?: string;
  createdAt: any;
  isMine: boolean;
  isRead?: boolean;
}

export function DirectMessageThreadDialog({
  isOpen,
  onOpenChange,
  contact,
  initialSubject = 'Conversación de Soporte',
}: DirectMessageThreadDialogProps) {
  const { profile: currentUser } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Consulta de mensajes recibidos de este contacto
  const inboxQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser || !contact) return null;
    return query(
      collection(firestore, `users/${currentUser.id}/directMessages`),
      orderBy('createdAt', 'asc'),
      limit(100)
    );
  }, [firestore, currentUser, contact]);
  const { data: inboxMessages } = useCollection<DirectMessage>(inboxQuery);

  // Consulta de mensajes enviados a este contacto
  const sentQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser || !contact) return null;
    return query(
      collection(firestore, `users/${currentUser.id}/sentMessages`),
      orderBy('createdAt', 'asc'),
      limit(100)
    );
  }, [firestore, currentUser, contact]);
  const { data: sentMessages } = useCollection<SentMessage>(sentQuery);

  // Marcar como leídos los mensajes no leídos del contacto en este hilo
  useEffect(() => {
    if (!firestore || !currentUser || !contact || !inboxMessages) return;
    inboxMessages.forEach(msg => {
      if (!msg.isRead && (msg.senderId === contact.id || msg.userId === currentUser.id)) {
        const msgRef = doc(firestore, `users/${currentUser.id}/directMessages`, msg.id);
        updateDoc(msgRef, { isRead: true }).catch(() => {});
      }
    });
  }, [firestore, currentUser, contact, inboxMessages]);

  // Consolidar y ordenar cronológicamente la conversación bidireccional
  const threadMessages = useMemo(() => {
    if (!contact || !currentUser) return [];

    const merged: MergedThreadMessage[] = [];

    // Mensajes recibidos de este contacto
    (inboxMessages || []).forEach(m => {
      if (m.senderId === contact.id || m.userId === currentUser.id) {
        merged.push({
          id: m.id,
          senderId: m.senderId || contact.id,
          senderName: m.senderName || contact.name,
          senderAvatarUrl: m.senderAvatarUrl || contact.avatarUrl,
          body: m.body,
          subject: m.subject,
          createdAt: m.createdAt,
          isMine: false,
          isRead: m.isRead,
        });
      }
    });

    // Mensajes enviados por mí
    (sentMessages || []).forEach(m => {
      merged.push({
        id: m.id,
        senderId: currentUser.id,
        senderName: currentUser.name,
        senderAvatarUrl: currentUser.avatarUrl,
        body: m.body,
        subject: m.subject,
        createdAt: m.createdAt,
        isMine: true,
        isRead: true,
      });
    });

    // Desduplicar por ID y ordenar ascendente
    const uniqueMap = new Map<string, MergedThreadMessage>();
    merged.forEach(item => uniqueMap.set(item.id, item));
    const result = Array.from(uniqueMap.values());

    result.sort((a, b) => {
      const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
      const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
      return timeA - timeB;
    });

    return result;
  }, [inboxMessages, sentMessages, contact, currentUser]);

  // Auto-scroll al fondo al recibir o enviar mensaje
  useEffect(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
      }
    }
  }, [threadMessages, isOpen]);

  const handleSendReply = async () => {
    if (!replyText.trim() || !contact || !currentUser || !firestore || isSending) return;

    const messageContent = replyText.trim();
    setReplyText('');
    setIsSending(true);

    try {
      const timestamp = serverTimestamp();
      const msgId = Date.now().toString();

      const subjectLine = initialSubject.startsWith('Re:') ? initialSubject : `Re: ${initialSubject}`;

      // 1. Escribir en la bandeja de entrada del destinatario
      const recipientMsgRef = doc(firestore, `users/${contact.id}/directMessages`, msgId);
      await setDoc(recipientMsgRef, {
        id: msgId,
        senderId: currentUser.id,
        senderName: currentUser.name,
        senderAvatarUrl: currentUser.avatarUrl || '',
        userId: contact.id,
        subject: subjectLine,
        body: messageContent,
        isRead: false,
        createdAt: timestamp,
      }, { merge: true });

      // 2. Crear notificación emergente para el destinatario
      const notificationRef = doc(firestore, `users/${contact.id}/notifications`, `notif-${msgId}`);
      await setDoc(notificationRef, {
        id: `notif-${msgId}`,
        userId: contact.id,
        title: `💬 Respuesta de ${currentUser.name}`,
        message: messageContent.substring(0, 100),
        link: '/dashboard/notifications',
        isRead: false,
        category: 'Usuarios',
        createdAt: timestamp,
      }, { merge: true });

      // 3. Escribir en la bandeja de salida propia (sentMessages)
      const outboxRef = doc(firestore, `users/${currentUser.id}/sentMessages`, msgId);
      await setDoc(outboxRef, {
        id: msgId,
        senderId: currentUser.id,
        senderName: currentUser.name,
        senderAvatarUrl: currentUser.avatarUrl || '',
        subject: subjectLine,
        body: messageContent,
        recipientSummary: contact.name,
        createdAt: timestamp,
      }, { merge: true });

      // 4. Disparar Push Notification en tiempo real al dispositivo/navegador del contacto
      triggerPushNotificationAction([contact.id], {
        title: `💬 ${currentUser.name}`,
        body: messageContent,
        url: '/dashboard/notifications',
      }).catch(() => {});

      toast({
        title: "Mensaje Enviado",
        description: `Tu respuesta a ${contact.name} ha sido transmitida en tiempo real.`,
      });
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Error al responder",
        description: e?.message || "No se pudo entregar la respuesta.",
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendReply();
    }
  };

  if (!contact) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-full p-0 rounded-[2.5rem] overflow-hidden border-none shadow-2xl bg-white flex flex-col h-[85vh] max-h-[750px]">
        {/* Encabezado del Chat */}
        <DialogHeader className="p-6 bg-slate-900 text-white flex flex-row items-center justify-between space-y-0 shrink-0">
          <div className="flex items-center gap-4">
            <Avatar className="h-12 w-12 border-2 border-primary/30 shadow-md">
              <AvatarImage src={contact.avatarUrl} alt={contact.name} className="object-cover" />
              <AvatarFallback className="bg-primary/20 text-primary font-black uppercase text-sm">
                <UserIcon className="h-5 w-5" />
              </AvatarFallback>
            </Avatar>
            <div className="space-y-0.5">
              <DialogTitle className="text-lg font-black uppercase tracking-tight text-white leading-none">
                {contact.name}
              </DialogTitle>
              <div className="flex items-center gap-2">
                {contact.role && (
                  <Badge variant="secondary" className="bg-white/10 text-white border-none font-black text-[8px] uppercase tracking-widest px-2 py-0.5">
                    {contact.role}
                  </Badge>
                )}
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Conversación Directa</span>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Cuerpo del Hilo de Mensajes */}
        <div className="flex-1 min-h-0 bg-slate-50/50 p-4 sm:p-6 overflow-hidden relative">
          <ScrollArea ref={scrollRef} className="h-full pr-4">
            {threadMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-12 opacity-40 space-y-3 my-auto">
                <MessageSquare className="h-12 w-12 text-slate-400" />
                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-500">
                  Inicia la conversación con {contact.name}
                </p>
              </div>
            ) : (
              <div className="space-y-4 py-2">
                {threadMessages.map((msg) => {
                  const formattedTime = msg.createdAt?.toDate 
                    ? format(msg.createdAt.toDate(), 'hh:mm a') 
                    : (msg.createdAt?.seconds ? format(new Date(msg.createdAt.seconds * 1000), 'hh:mm a') : 'Ahora');

                  return (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex flex-col max-w-[80%] space-y-1 transition-all animate-in fade-in duration-300",
                        msg.isMine ? "ml-auto items-end" : "mr-auto items-start"
                      )}
                    >
                      <div
                        className={cn(
                          "p-4 rounded-3xl text-sm leading-relaxed shadow-sm relative group",
                          msg.isMine
                            ? "bg-primary text-white rounded-br-none"
                            : "bg-white text-slate-800 border border-slate-100 rounded-bl-none shadow-slate-100"
                        )}
                      >
                        {msg.subject && !msg.isMine && (
                          <p className="text-[10px] font-black uppercase text-primary tracking-wider mb-1.5 opacity-90 border-b border-primary/10 pb-1">
                            {msg.subject}
                          </p>
                        )}
                        <p className="whitespace-pre-wrap font-medium">{msg.body}</p>
                      </div>
                      <div className="flex items-center gap-1.5 px-2">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                          {formattedTime}
                        </span>
                        {msg.isMine && (
                          <CheckCheck 
                            className={cn(
                              "h-3.5 w-3.5 transition-all duration-300", 
                              msg.isRead ? "text-sky-400 font-bold drop-shadow-sm scale-110" : "text-slate-400 opacity-70"
                            )} 
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Footer con Caja de Respuesta Rápida */}
        <div className="p-4 sm:p-5 bg-white border-t border-slate-100 shrink-0 space-y-3">
          <div className="flex items-end gap-3">
            <Textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Escribe tu respuesta para ${contact.name}... (Enter para enviar)`}
              rows={2}
              className="resize-none rounded-2xl border-slate-200 focus-visible:ring-primary/20 text-xs font-medium p-3 min-h-[50px]"
            />
            <Button
              onClick={handleSendReply}
              disabled={!replyText.trim() || isSending}
              className="h-12 w-12 rounded-2xl bg-primary hover:bg-primary/90 text-white shrink-0 shadow-lg shadow-primary/20 transition-all active:scale-95 flex items-center justify-center p-0"
            >
              {isSending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </Button>
          </div>
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider text-right pr-1">
            Presiona Enter para responder • Shift + Enter para salto de línea
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
