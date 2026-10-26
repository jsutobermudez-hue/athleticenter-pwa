'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, orderBy, doc, setDoc, serverTimestamp, updateDoc, arrayUnion } from 'firebase/firestore';
import type { ChatRoom, ChatMessage, User as AppUser } from '@/lib/definitions';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Search, Send, Loader2, Users, ArrowLeft, MessageSquare, CheckCheck, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { NewChatModal } from './NewChatModal';

export function ChatView({ allUsers }: { allUsers: AppUser[] }) {
  const { user, profile: currentUser } = useUser();
  const firestore = useFirestore();

  const [searchTerm, setSearchTerm] = useState('');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Query rooms where user is participant
  const roomsQuery = useMemoFirebase(() => {
    if (!firestore || !user) return null;
    return query(
      collection(firestore, 'chats'),
      where('participants', 'array-contains', user.uid),
      orderBy('lastMessageAt', 'desc')
    );
  }, [firestore, user]);

  const { data: chatRooms, isLoading: isLoadingRooms } = useCollection<ChatRoom>(roomsQuery);

  // Query messages for active room
  const messagesQuery = useMemoFirebase(() => {
    if (!firestore || !activeRoomId) return null;
    return query(
      collection(firestore, `chats/${activeRoomId}/messages`),
      orderBy('createdAt', 'asc')
    );
  }, [firestore, activeRoomId]);

  const { data: messages, isLoading: isLoadingMessages } = useCollection<ChatMessage>(messagesQuery);

  const activeRoom = useMemo(() => chatRooms?.find(r => r.id === activeRoomId), [chatRooms, activeRoomId]);

  // Filtrado
  const filteredRooms = useMemo(() => {
    if (!chatRooms) return [];
    const term = searchTerm.toLowerCase();
    return chatRooms.filter(r => {
      if (!term) return true;
      const matchName = r.name?.toLowerCase().includes(term);
      const matchParticipants = r.participantNames?.some(pn => pn.toLowerCase().includes(term));
      return matchName || matchParticipants;
    });
  }, [chatRooms, searchTerm]);

  // Mark as read
  useEffect(() => {
    if (!firestore || !currentUser || !activeRoomId || !messages) return;
    messages.forEach(msg => {
      if (!msg.readBy?.includes(currentUser.id) && msg.senderId !== currentUser.id) {
        updateDoc(doc(firestore, `chats/${activeRoomId}/messages`, msg.id), {
          readBy: arrayUnion(currentUser.id)
        }).catch(() => {});
      }
    });
  }, [messages, firestore, currentUser, activeRoomId]);

  // Auto scroll
  useEffect(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
      }
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!replyText.trim() || !activeRoomId || !currentUser || !firestore || isSending) return;
    const body = replyText.trim();
    setReplyText('');
    setIsSending(true);

    try {
      const msgId = Date.now().toString();
      const msgRef = doc(firestore, `chats/${activeRoomId}/messages`, msgId);
      const ts = serverTimestamp() as any;

      await setDoc(msgRef, {
        id: msgId,
        roomId: activeRoomId,
        senderId: currentUser.id,
        senderName: currentUser.name,
        senderAvatarUrl: currentUser.avatarUrl || '',
        body,
        readBy: [currentUser.id],
        createdAt: ts
      });

      // Update room lastMessage
      await updateDoc(doc(firestore, 'chats', activeRoomId), {
        lastMessage: body,
        lastMessageAt: ts
      });
    } catch (error) {
      console.error("Error sending message", error);
    } finally {
      setIsSending(false);
    }
  };

  const getRoomTitle = (room: ChatRoom) => {
    if (room.type === 'group' && room.name) return room.name;
    const otherParticipantId = room.participants.find(p => p !== currentUser?.id);
    const otherUser = allUsers.find(u => u.id === otherParticipantId);
    return otherUser ? otherUser.name : 'Usuario Desconocido';
  };

  const getRoomAvatar = (room: ChatRoom) => {
    if (room.type === 'group') return <Users className="h-5 w-5" />;
    const otherParticipantId = room.participants.find(p => p !== currentUser?.id);
    const otherUser = allUsers.find(u => u.id === otherParticipantId);
    return otherUser?.avatarUrl ? <AvatarImage src={otherUser.avatarUrl} /> : <span className="font-black text-xs">{getRoomTitle(room).charAt(0)}</span>;
  };

  return (
    <div className="h-[750px] bg-white rounded-[2.5rem] border border-slate-200/80 shadow-xl overflow-hidden flex relative animate-in fade-in">
      
      {/* SIDEBAR DE CHATS */}
      <div className={cn(
        "w-full lg:w-[400px] flex flex-col border-r border-slate-100 shrink-0",
        activeRoomId ? "hidden lg:flex" : "flex"
      )}>
        <div className="p-4 border-b border-slate-100 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-900">Mensajes</h2>
            <Button size="sm" onClick={() => setIsNewChatOpen(true)} className="rounded-xl h-8 text-[10px] uppercase font-bold bg-primary/10 text-primary hover:bg-primary/20">
              + Nuevo
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input 
              placeholder="Buscar chats..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 pl-9 bg-slate-50 border-none rounded-xl text-xs font-bold"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {isLoadingRooms ? (
            <div className="p-4 flex justify-center"><Loader2 className="animate-spin h-5 w-5 text-slate-400" /></div>
          ) : filteredRooms.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs font-bold uppercase">No tienes chats.</div>
          ) : (
            filteredRooms.map(room => {
              const isActive = activeRoomId === room.id;
              return (
                <div 
                  key={room.id}
                  onClick={() => setActiveRoomId(room.id)}
                  className={cn(
                    "flex items-center gap-3 p-4 cursor-pointer transition-colors border-b border-slate-50",
                    isActive ? "bg-slate-50" : "hover:bg-slate-50/50"
                  )}
                >
                  <Avatar className="h-10 w-10 border shadow-sm flex items-center justify-center bg-slate-100 text-slate-500">
                    {getRoomAvatar(room)}
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-0.5">
                      <span className="font-black text-[11px] uppercase truncate text-slate-900">
                        {getRoomTitle(room)}
                      </span>
                      {room.lastMessageAt && (
                        <span className="text-[9px] font-bold text-slate-400 shrink-0">
                           {room.lastMessageAt?.toDate ? format(room.lastMessageAt.toDate(), "HH:mm") : '...'}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] font-medium text-slate-500 truncate">
                      {room.lastMessage || 'Nuevo chat iniciado'}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </ScrollArea>
      </div>

      {/* CHAT ROOM PRINCIPAL */}
      <div className={cn(
        "flex-1 flex-col bg-slate-50/30",
        !activeRoomId ? "hidden lg:flex" : "flex w-full"
      )}>
        {activeRoomId && activeRoom ? (
          <>
            {/* HEADER SALA */}
            <div className="h-16 border-b border-slate-100 bg-white flex items-center px-4 gap-3 shrink-0">
              <Button variant="ghost" size="icon" onClick={() => setActiveRoomId(null)} className="lg:hidden rounded-full">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Avatar className="h-9 w-9 border flex items-center justify-center bg-slate-100 text-slate-500">
                {getRoomAvatar(activeRoom)}
              </Avatar>
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 leading-none">{getRoomTitle(activeRoom)}</h3>
                {activeRoom.type === 'group' && (
                  <span className="text-[9px] font-bold text-slate-400 uppercase">{activeRoom.participants.length} miembros</span>
                )}
              </div>
            </div>

            {/* MENSAJES */}
            <ScrollArea ref={scrollRef} className="flex-1 p-4">
              {isLoadingMessages ? (
                <div className="flex justify-center p-4"><Loader2 className="animate-spin h-5 w-5 text-slate-400" /></div>
              ) : (
                <div className="space-y-4 py-2">
                  {messages?.map(msg => {
                    const isMine = msg.senderId === currentUser?.id;
                    const isReadByOthers = msg.readBy && msg.readBy.length > 1; // Leído por al menos alguien más
                    return (
                      <div key={msg.id} className={cn("flex flex-col max-w-[80%]", isMine ? "ml-auto items-end" : "mr-auto items-start")}>
                        {activeRoom.type === 'group' && !isMine && (
                          <span className="text-[9px] font-black uppercase text-primary ml-1 mb-1">{msg.senderName}</span>
                        )}
                        <div className={cn(
                          "px-4 py-2.5 rounded-2xl text-sm font-medium shadow-sm",
                          isMine ? "bg-slate-900 text-white rounded-br-none" : "bg-white border border-slate-100 rounded-bl-none"
                        )}>
                          {msg.body}
                        </div>
                        <div className="flex items-center gap-1 mt-1 px-1">
                           <span className="text-[9px] font-bold text-slate-400">
                             {msg.createdAt?.toDate ? format(msg.createdAt.toDate(), 'HH:mm') : '...'}
                           </span>
                           {isMine && (
                             <CheckCheck className={cn("h-3 w-3", isReadByOthers ? "text-sky-500" : "text-slate-300")} />
                           )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>

            {/* INPUT DE MENSAJE */}
            <div className="p-4 bg-white border-t border-slate-100 flex items-end gap-2 shrink-0">
              <Textarea 
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
                }}
                placeholder="Escribe un mensaje..."
                className="min-h-[44px] max-h-[120px] resize-none border-none bg-slate-50 rounded-2xl"
                rows={1}
              />
              <Button 
                onClick={handleSendMessage}
                disabled={!replyText.trim() || isSending}
                className="h-11 w-11 rounded-full bg-primary text-white shrink-0"
              >
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center opacity-40">
             <MessageSquare className="h-16 w-16 mb-4 text-slate-400" />
             <h3 className="text-sm font-black uppercase">Selecciona un Chat</h3>
          </div>
        )}
      </div>

      <NewChatModal 
        isOpen={isNewChatOpen} 
        onOpenChange={setIsNewChatOpen} 
        allUsers={allUsers}
        onChatCreated={(roomId) => {
          setIsNewChatOpen(false);
          setActiveRoomId(roomId);
        }}
      />
    </div>
  );
}
