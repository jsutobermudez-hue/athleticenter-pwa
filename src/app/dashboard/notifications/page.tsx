'use client';

import React, { useMemo, useState } from 'react';
import {
  useCollection,
  useFirestore,
  useMemoFirebase,
  useUser,
  errorEmitter,
  FirestorePermissionError,
} from '@/firebase';
import { collection, orderBy, query, where, getDocs, writeBatch, limit } from 'firebase/firestore';
import type { Notification, SentMessage, DirectMessage, User as AppUser } from '@/lib/definitions';
import { notificationCategories } from '@/lib/definitions';
import { Skeleton } from '@/components/ui/skeleton';
import { NotificationItem } from '@/components/notifications/NotificationItem';
import { SentMessageItem } from '@/components/notifications/SentMessageItem';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCheck, Loader2, MessageSquarePlus, Trash2, Bell, MessageSquare, Send, CheckCircle2, ShieldAlert, Info, FilterX } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NewMessageDialog } from './NewMessageDialog';
import { DirectMessageItem } from './DirectMessageItem';
import { DirectMessageThreadDialog, type ChatContact } from './DirectMessageThreadDialog';
import { NotificationDetailDialog } from '@/components/notifications/NotificationDetailDialog';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export default function NotificationsPage() {
  const { user, profile: currentUser } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<string>('inbox');
  const [categoryFilter, setCategoryFilter] = useState<string>('todos');
  const [onlyUnread, setOnlyUnread] = useState<boolean>(false);
  const [isMarking, setIsMarking] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);

  const [activeThreadContact, setActiveThreadContact] = useState<ChatContact | null>(null);
  const [activeThreadSubject, setActiveThreadSubject] = useState<string>('Conversación de Soporte');
  const [isThreadOpen, setIsThreadOpen] = useState(false);

  const [activeNotificationDetail, setActiveNotificationDetail] = useState<Notification | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const notificationsQuery = useMemoFirebase(
    () =>
      user && firestore
        ? query(
            collection(firestore, `users/${user.uid}/notifications`),
            orderBy('createdAt', 'desc'),
            limit(50)
          )
        : null,
    [user, firestore]
  );
  const { data: allNotifications, isLoading: isLoadingInbox } = useCollection<Notification>(notificationsQuery);
  
  const directMessagesQuery = useMemoFirebase(
    () =>
      user && firestore
        ? query(
            collection(firestore, `users/${user.uid}/directMessages`),
            orderBy('createdAt', 'desc'),
            limit(50)
          )
        : null,
    [user, firestore]
  );
  const { data: directMessages, isLoading: isLoadingDMs } = useCollection<DirectMessage>(directMessagesQuery);
  
  const sentMessagesQuery = useMemoFirebase(
    () =>
      user && firestore
        ? query(
            collection(firestore, `users/${user.uid}/sentMessages`),
            orderBy('createdAt', 'desc'),
            limit(50)
          )
        : null,
    [user, firestore]
  );
  const { data: sentMessages, isLoading: isLoadingSent } = useCollection<SentMessage>(sentMessagesQuery);

  const allUsersQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser) return null;
    return query(collection(firestore, 'users'), limit(300));
  }, [firestore, currentUser]);

  const { data: allUsers } = useCollection<AppUser>(allUsersQuery);

  const unreadCount = useMemo(() => (allNotifications?.filter(n => !n.isRead).length || 0) + (directMessages?.filter(n => !n.isRead).length || 0), [allNotifications, directMessages]);

  const handleOpenThread = (dm: DirectMessage) => {
    const contactUser = allUsers?.find(u => u.id === dm.senderId);
    setActiveThreadContact({
      id: dm.senderId || 'unknown',
      name: dm.senderName || contactUser?.name || 'Contacto',
      avatarUrl: dm.senderAvatarUrl || contactUser?.avatarUrl || '',
      role: contactUser?.role || '',
      email: contactUser?.email || ''
    });
    setActiveThreadSubject(dm.subject || 'Conversación de Soporte');
    setIsThreadOpen(true);
  };

  const handleOpenNotificationDetail = (n: Notification) => {
    // Si la alerta es de tipo usuario/soporte o incluye nombre de usuario, abrir directamente el chat 2-way
    if (n.category === 'Usuarios' || n.category === 'Soporte' || n.title.toLowerCase().includes('mensaje') || n.title.toLowerCase().includes('chat')) {
      handleReplyFromNotification(n);
    } else {
      setActiveNotificationDetail(n);
      setIsDetailOpen(true);
    }
  };

  const handleReplyFromNotification = (n: Notification) => {
    const matchedUser = allUsers?.find(u => 
      u.name.toLowerCase().includes(n.title.toLowerCase()) || 
      n.message.toLowerCase().includes(u.name.toLowerCase()) ||
      u.role === 'admin' || u.role === 'superadmin' || u.role === 'ventas'
    ) || allUsers?.[0];

    if (matchedUser) {
      setActiveThreadContact({
        id: matchedUser.id,
        name: matchedUser.name,
        avatarUrl: matchedUser.avatarUrl || '',
        role: matchedUser.role,
        email: matchedUser.email
      });
      setActiveThreadSubject(`Consulta sobre: ${n.title}`);
      setIsThreadOpen(true);
    } else {
      setIsNewMessageOpen(true);
    }
  };

  const handleMessageSentSuccess = (contactUser: AppUser, subject: string) => {
    setActiveTab('dms');
    setActiveThreadContact({
      id: contactUser.id,
      name: contactUser.name,
      avatarUrl: contactUser.avatarUrl || '',
      role: contactUser.role,
      email: contactUser.email
    });
    setActiveThreadSubject(subject || 'Conversación de Soporte');
    setIsThreadOpen(true);
  };

  const filteredNotifications = useMemo(() => {
    if (!allNotifications) return [];
    let items = allNotifications;
    if (categoryFilter !== 'todos') {
      items = items.filter(n => n.category === categoryFilter);
    }
    if (onlyUnread) {
      items = items.filter(n => !n.isRead);
    }
    return items;
  }, [allNotifications, categoryFilter, onlyUnread]);

  const handleMarkAllAsRead = () => {
    if (!user || !firestore || unreadCount === 0) return;
    setIsMarking(true);
    
    const unreadNotificationsQuery = query(collection(firestore, `users/${user.uid}/notifications`), where('isRead', '==', false), limit(50));
    const unreadDMsQuery = query(collection(firestore, `users/${user.uid}/directMessages`), where('isRead', '==', false), limit(50));
    
    Promise.all([
        getDocs(unreadNotificationsQuery),
        getDocs(unreadDMsQuery)
    ]).then(([notificationsSnapshot, dmsSnapshot]) => {
        const batch = writeBatch(firestore);
        notificationsSnapshot.forEach(docSnap => batch.update(docSnap.ref, { isRead: true }));
        dmsSnapshot.forEach(docSnap => batch.update(docSnap.ref, { isRead: true }));
        
        batch.commit()
            .then(() => {
                toast({ title: "Bandeja sincronizada", description: "Todos los mensajes se han marcado como leídos." });
                setIsMarking(false);
            })
            .catch(async () => {
                errorEmitter.emit('permission-error', new FirestorePermissionError({
                    path: `users/${user.uid}/notifications_batch`,
                    operation: 'write'
                }));
                setIsMarking(false);
            });
    }).catch(() => {
        setIsMarking(false);
    });
  };

  const handleClearInbox = () => {
    if (!user || !firestore) return;
    setIsClearing(true);
    
    getDocs(query(collection(firestore, `users/${user.uid}/notifications`), limit(50)))
        .then((snapshot) => {
            const batch = writeBatch(firestore);
            snapshot.forEach(docSnap => batch.delete(docSnap.ref));
            batch.commit()
                .then(() => {
                    toast({ title: "Alertas eliminadas", description: "Se ha limpiado el historial de avisos automáticos." });
                    setIsClearing(false);
                })
                .catch(async () => {
                    errorEmitter.emit('permission-error', new FirestorePermissionError({
                        path: `users/${user.uid}/notifications_clear`,
                        operation: 'write'
                    }));
                    setIsClearing(false);
                });
        })
        .catch(() => {
            setIsClearing(false);
        });
  };

  return (
    <>
    <div className="flex flex-col gap-8 max-w-5xl mx-auto pb-32 animate-in fade-in-50 duration-500 px-4 sm:px-6">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 px-1">
        <div className="space-y-1">
            <h1 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none italic">Centro de Comunicaciones</h1>
            <p className="text-[10px] text-muted-foreground font-black italic uppercase tracking-[0.4em] opacity-60">Sincronización táctica de alertas y soporte directo.</p>
        </div>
        <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="text-rose-500 font-black uppercase tracking-widest text-[9px] hover:bg-rose-50 h-10 px-4 rounded-xl" onClick={handleClearInbox} disabled={isClearing}>
                {isClearing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />} Limpiar
            </Button>
            <Button size="sm" className="h-11 px-6 rounded-xl shadow-xl shadow-primary/20 font-black uppercase tracking-[0.15em] bg-primary hover:bg-primary/90 transition-all active:scale-95 text-[10px]" onClick={() => setIsNewMessageOpen(true)}>
                <MessageSquarePlus className="h-4 w-4 mr-2" /> Redactar Chat
            </Button>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-10">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 bg-white/40 backdrop-blur-md p-4 rounded-[2.5rem] ring-1 ring-primary/5 shadow-sm">
            <TabsList className="h-12 bg-slate-100/50 p-1.5 rounded-2xl border-none shadow-inner">
                <TabsTrigger value="inbox" className="px-6 rounded-xl font-black uppercase text-[9px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-lg data-[state=active]:text-primary">
                    <Bell className="h-4 w-4 mr-2" /> Alertas
                </TabsTrigger>
                <TabsTrigger value="dms" className="px-6 rounded-xl font-black uppercase text-[9px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-lg data-[state=active]:text-primary">
                    <MessageSquare className="h-4 w-4 mr-2" /> Chats {unreadCount > 0 && <Badge className="ml-2 bg-primary text-white text-[8px] h-4 px-1">{unreadCount}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="sent" className="px-6 rounded-xl font-black uppercase text-[9px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-lg data-[state=active]:text-primary">
                    <Send className="h-4 w-4 mr-2" /> Enviados
                </TabsTrigger>
            </TabsList>

            <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant={onlyUnread ? "default" : "outline"}
                  size="sm"
                  onClick={() => setOnlyUnread(!onlyUnread)}
                  className={cn(
                    "h-10 rounded-xl font-black uppercase text-[9px] tracking-widest transition-all",
                    onlyUnread ? "bg-slate-900 text-white" : "bg-white border-none text-slate-600 shadow-sm"
                  )}
                >
                  {onlyUnread ? "● No Leídos" : "Todas las Alertas"}
                </Button>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="h-10 w-full sm:w-44 rounded-xl bg-white border-none shadow-sm font-black uppercase text-[9px]">
                        <SelectValue placeholder="Filtrar Alertas" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-none shadow-2xl">
                        <SelectItem value="todos" className="text-[9px] font-black uppercase">TODAS LAS CATEGORÍAS</SelectItem>
                        {notificationCategories.map(c => <SelectItem key={c} value={c} className="text-[9px] font-black uppercase">{c.toUpperCase()}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Button variant="outline" size="sm" className="h-10 flex-1 sm:flex-none rounded-xl border-none bg-white shadow-sm font-black uppercase text-[9px] tracking-widest hover:bg-emerald-50 hover:text-emerald-600 transition-all" onClick={handleMarkAllAsRead} disabled={isMarking || unreadCount === 0}>
                    {isMarking ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-500" />} Marcar Todo
                </Button>
            </div>
        </div>
        
        <TabsContent value="inbox" className="mt-0 outline-none space-y-4 pb-20">
            {isLoadingInbox ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-[2rem]" />)
            ) : filteredNotifications.length > 0 ? (
                filteredNotifications.map((n) => (
                    <NotificationItem 
                        key={n.id} 
                        notification={n} 
                        onOpenDetail={(notif) => handleOpenNotificationDetail(notif)}
                    />
                ))
            ) : (
                <div className="p-24 text-center opacity-30 flex flex-col items-center gap-6 border-2 border-dashed rounded-[3rem] bg-slate-50/50">
                    <Bell className="h-16 w-16 text-slate-300" />
                    <p className="text-[11px] font-black uppercase tracking-[0.4em] text-slate-400">Sin alertas de sistema registradas</p>
                </div>
            )}
        </TabsContent>
        
        <TabsContent value="dms" className="mt-0 outline-none space-y-4 pb-20">
            {isLoadingDMs ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-[2rem]" />)
            ) : directMessages && directMessages.length > 0 ? (
                directMessages.map((dm) => (
                    <DirectMessageItem 
                        key={dm.id} 
                        message={dm} 
                        onOpenThread={(message) => handleOpenThread(message)}
                    />
                ))
            ) : (
                <div className="p-24 text-center opacity-30 flex flex-col items-center gap-6 border-2 border-dashed rounded-[3rem] bg-slate-50/50">
                    <MessageSquare className="h-16 w-16 text-slate-300" />
                    <div className="space-y-2">
                        <p className="text-[11px] font-black uppercase tracking-[0.4em] text-slate-400">Tu bandeja de chats está vacía</p>
                        <Button size="sm" variant="outline" className="h-9 rounded-xl font-black text-[9px] uppercase border-primary/20 text-primary hover:bg-primary hover:text-white transition-all" onClick={() => setIsNewMessageOpen(true)}>Iniciar Conversación</Button>
                    </div>
                </div>
            )}
        </TabsContent>

        <TabsContent value="sent" className="mt-0 outline-none space-y-4 pb-20">
            {isLoadingSent ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-[2rem]" />)
            ) : sentMessages && sentMessages.length > 0 ? (
                sentMessages.map((msg) => <SentMessageItem key={msg.id} message={msg} />)
            ) : (
                <div className="p-24 text-center opacity-30 flex flex-col items-center gap-6 border-2 border-dashed rounded-[3rem] bg-slate-50/50">
                    <Send className="h-16 w-16 text-slate-300" />
                    <p className="text-[11px] font-black uppercase tracking-[0.4em] text-slate-400">No has emitido mensajes todavía</p>
                </div>
            )}
        </TabsContent>
      </Tabs>
    </div>
    <NewMessageDialog 
        isOpen={isNewMessageOpen}
        onOpenChange={setIsNewMessageOpen}
        allUsers={allUsers || []}
        onMessageSent={(contactUser, subject) => handleMessageSentSuccess(contactUser, subject)}
    />
    <DirectMessageThreadDialog
        isOpen={isThreadOpen}
        onOpenChange={setIsThreadOpen}
        contact={activeThreadContact}
        initialSubject={activeThreadSubject}
    />
    <NotificationDetailDialog
        isOpen={isDetailOpen}
        onOpenChange={setIsDetailOpen}
        notification={activeNotificationDetail}
        onReplyClick={(notif) => handleReplyFromNotification(notif)}
    />
    </>
  );
}
