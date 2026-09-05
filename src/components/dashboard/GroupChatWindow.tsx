'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy, limit, doc, addDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { GroupChannel, GroupChatMessage, Order } from '@/lib/definitions';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Send,
  Loader2,
  Users,
  MessageSquare,
  Package,
  Sparkles,
  ArrowLeft,
  Clock,
  User as UserIcon,
  ShieldCheck,
  Tag,
  Paperclip,
  CheckCheck
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface GroupChatWindowProps {
  channel: GroupChannel;
  onBackMobile?: () => void;
  onSelectOrderRef?: (orderId: string) => void;
}

export function GroupChatWindow({ channel, onBackMobile, onSelectOrderRef }: GroupChatWindowProps) {
  const { profile: currentUser } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messagesQuery = useMemoFirebase(() => {
    if (!firestore || !channel?.id) return null;
    return query(
      collection(firestore, `group_channels/${channel.id}/messages`),
      orderBy('createdAt', 'asc'),
      limit(150)
    );
  }, [firestore, channel?.id]);
  const { data: messages, isLoading } = useCollection<GroupChatMessage>(messagesQuery);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputText.trim() || !firestore || !currentUser || !channel) return;
    setIsSending(true);

    try {
      const text = inputText.trim();
      const messagesRef = collection(firestore, `group_channels/${channel.id}/messages`);

      // Detectar menciones a pedidos (#P-XXXX o #BORR-XXXX)
      const orderMatch = text.match(/#(P-[A-Z0-9-]+|BORR-[A-Z0-9-]+)/i);
      const orderIdRef = orderMatch ? orderMatch[1] : undefined;

      await addDoc(messagesRef, {
        channelId: channel.id,
        senderId: currentUser.id,
        senderName: currentUser.name || 'Usuario',
        senderRole: currentUser.role || 'ventas',
        senderAvatarUrl: currentUser.avatarUrl || '',
        body: text,
        orderIdRef: orderIdRef || null,
        createdAt: serverTimestamp()
      });

      // Actualizar último mensaje en el canal
      const channelRef = doc(firestore, 'group_channels', channel.id);
      await updateDoc(channelRef, {
        lastMessage: `${currentUser.name}: ${text.substring(0, 40)}...`,
        lastMessageAt: serverTimestamp()
      });

      setInputText('');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al enviar', description: e.message });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-3xl overflow-hidden border border-slate-200/80 shadow-sm">
      {/* HEADER DEL CANAL */}
      <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {onBackMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBackMobile}
              className="text-white hover:bg-white/10 sm:hidden shrink-0 rounded-xl"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}

          <div className="h-10 w-10 rounded-2xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400 font-bold shrink-0">
            <Users className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm sm:text-base font-black uppercase text-white tracking-tight truncate">
                {channel.name}
              </h3>
              <Badge variant="outline" className="border-indigo-500/40 text-indigo-300 font-mono text-[9px] uppercase px-2 h-5">
                CANAL GRUPAL
              </Badge>
            </div>
            <p className="text-[10px] text-slate-400 uppercase font-bold truncate">
              {channel.description}
            </p>
          </div>
        </div>
      </div>

      {/* ÁREA DE MENSAJES CON SCROLL AUTO */}
      <div ref={scrollRef} className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-4 custom-scrollbar bg-slate-50/50">
        {isLoading ? (
          <div className="p-8 text-center space-y-2">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-600 mx-auto" />
            <p className="text-xs font-bold text-slate-400 uppercase">Cargando conversación del grupo...</p>
          </div>
        ) : !messages || messages.length === 0 ? (
          <div className="p-12 text-center space-y-3 bg-white rounded-3xl border border-slate-200/80 my-8">
            <MessageSquare className="h-10 w-10 text-indigo-400 mx-auto" />
            <h4 className="text-sm font-black uppercase text-slate-900">Inicio del Canal {channel.name}</h4>
            <p className="text-xs text-slate-500 font-bold uppercase max-w-sm mx-auto">
              Escribe el primer mensaje para coordinar la operación en tiempo real con todo el equipo.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = msg.senderId === currentUser?.id;
            let formattedTime = 'Hace un momento';
            if (msg.createdAt) {
              const d = typeof msg.createdAt.toDate === 'function' ? msg.createdAt.toDate() : new Date(msg.createdAt);
              if (!isNaN(d.getTime())) formattedTime = format(d, 'hh:mm a', { locale: es }).toUpperCase();
            }

            return (
              <div key={msg.id} className={cn('flex items-start gap-3', isMine && 'flex-row-reverse')}>
                <Avatar className="h-8 w-8 rounded-xl shrink-0 border border-slate-200">
                  <AvatarImage src={msg.senderAvatarUrl} />
                  <AvatarFallback className="bg-indigo-50 text-indigo-700 font-black text-xs">
                    {msg.senderName.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>

                <div className={cn('max-w-[85%] sm:max-w-[70%] space-y-1', isMine ? 'text-right' : 'text-left')}>
                  <div className="flex items-center gap-2 flex-wrap text-[10px] text-slate-500 font-bold uppercase">
                    <strong className="text-slate-900">{msg.senderName}</strong>
                    <Badge variant="secondary" className="text-[8px] font-mono font-black uppercase px-1.5 h-4 bg-slate-200/80">
                      {msg.senderRole}
                    </Badge>
                    <span>{formattedTime}</span>
                  </div>

                  <div className={cn(
                    'p-3.5 rounded-2xl text-xs font-bold leading-relaxed shadow-sm',
                    isMine ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white text-slate-900 border border-slate-200/80 rounded-tl-none'
                  )}>
                    {msg.body}

                    {/* TARJETA INTERACTIVA SI MENCIONA UN PEDIDO */}
                    {msg.orderIdRef && (
                      <div
                        onClick={() => onSelectOrderRef && onSelectOrderRef(msg.orderIdRef!)}
                        className="mt-2.5 p-2.5 rounded-xl bg-black/10 border border-white/20 flex items-center justify-between gap-2 cursor-pointer hover:bg-black/20 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 text-emerald-400" />
                          <span className="font-mono text-[10px] font-black uppercase">Mención a Pedido #{msg.orderIdRef}</span>
                        </div>
                        <Badge className="bg-emerald-500 text-white text-[8px] font-black uppercase">Ver Traza</Badge>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* FOOTER - ENTRADA DE TEXTO Y BOTÓN ENVIAR */}
      <div className="p-3 sm:p-4 bg-white border-t border-slate-200 shrink-0">
        <div className="flex items-center gap-2">
          <Textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder={`Escribir en ${channel.name}... (Ej. Menciona un pedido con #P-MUS-17)`}
            className="flex-1 min-h-[44px] max-h-[120px] rounded-2xl bg-slate-50 border-slate-200 text-xs font-bold resize-none py-3"
          />
          <Button
            onClick={handleSendMessage}
            disabled={isSending || !inputText.trim()}
            className="h-11 px-5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase shrink-0"
          >
            {isSending ? <Loader2 className="animate-spin h-4 w-4" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
