'use client';

import React, { useMemo, useState } from 'react';
import {
  useCollection,
  useFirestore,
  useMemoFirebase,
  useUser,
} from '@/firebase';
import { collection, orderBy, query, where, getDocs, writeBatch, limit, doc } from 'firebase/firestore';
import type { Notification, SentMessage, DirectMessage, User as AppUser } from '@/lib/definitions';
import { Skeleton } from '@/components/ui/skeleton';
import { NotificationItem } from '@/components/notifications/NotificationItem';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  CheckCheck, 
  Loader2, 
  MessageSquarePlus, 
  Trash2, 
  Bell, 
  MessageSquare, 
  Send, 
  CheckCircle2, 
  ShieldAlert, 
  Info, 
  Filter, 
  Sparkles, 
  FileText, 
  Download,
  Boxes,
  CreditCard,
  ShoppingCart,
  Truck,
  LifeBuoy
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NewMessageDialog } from './NewMessageDialog';
import { DirectMessageItem } from './DirectMessageItem';
import { DirectMessageThreadDialog, type ChatContact } from './DirectMessageThreadDialog';
import { NotificationDetailSheet } from '@/components/notifications/NotificationDetailSheet';
import { NotificationDetailDialog } from '@/components/notifications/NotificationDetailDialog';
import { Card, CardContent } from '@/components/ui/card';
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
            limit(100)
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
            limit(100)
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
            limit(100)
          )
        : null,
    [user, firestore]
  );
  const { data: sentMessages } = useCollection<SentMessage>(sentMessagesQuery);

  const allUsersQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser) return null;
    return query(collection(firestore, 'users'), limit(300));
  }, [firestore, currentUser]);

  const { data: allUsers } = useCollection<AppUser>(allUsersQuery);

  const unreadNotificationsCount = useMemo(() => allNotifications?.filter(n => !n.isRead).length || 0, [allNotifications]);
  const unreadDMsCount = useMemo(() => directMessages?.filter(n => !n.isRead).length || 0, [directMessages]);
  const reportsCount = useMemo(() => allNotifications?.filter(n => n.title.toLowerCase().includes('cartera') || n.link?.includes('/api/reports')).length || 0, [allNotifications]);

  const handleOpenNotificationDetail = (n: Notification) => {
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

  const filteredNotifications = useMemo(() => {
    if (!allNotifications) return [];
    return allNotifications.filter(n => {
      const matchesCategory = categoryFilter === 'todos' || n.category === categoryFilter;
      const matchesUnread = !onlyUnread || !n.isRead;
      return matchesCategory && matchesUnread;
    });
  }, [allNotifications, categoryFilter, onlyUnread]);

  const handleMarkAllAsRead = async () => {
    if (!firestore || !user || !allNotifications) return;
    setIsMarking(true);
    try {
      const unread = allNotifications.filter(n => !n.isRead);
      if (unread.length === 0) return;
      const batch = writeBatch(firestore);
      unread.forEach(n => {
        const ref = doc(firestore, `users/${user.uid}/notifications`, n.id);
        batch.update(ref, { isRead: true });
      });
      await batch.commit();
      toast({ title: 'Avisos marcados como leídos' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error al marcar leídos' });
    } finally {
      setIsMarking(false);
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
    setActiveThreadSubject(subject || 'Conversación Directa');
    setIsThreadOpen(true);
  };

  return (
    <div className="w-full max-w-[1440px] mx-auto flex flex-col gap-8 pb-32 px-4 animate-in fade-in-50 duration-500">
      {/* ENCABEZADO DE TERMINAL */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="terminal-header flex items-center gap-3">
            <Bell className="h-9 w-9 text-primary" /> Centro de Comunicaciones
          </h1>
          <p className="tech-label opacity-60">Consola unificada de notificaciones de sistema y mensajería en 2 vías.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            onClick={() => setIsNewMessageOpen(true)}
            className="h-12 px-6 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black text-xs uppercase tracking-wider shadow-lg shadow-primary/20"
          >
            <MessageSquarePlus className="h-4 w-4 mr-2" /> Nuevo Mensaje
          </Button>
          {unreadNotificationsCount > 0 && (
            <Button 
              onClick={handleMarkAllAsRead} 
              variant="outline"
              disabled={isMarking}
              className="h-12 px-4 rounded-2xl border-slate-200 bg-white hover:bg-slate-50 font-black text-xs uppercase text-slate-700 shadow-xs"
            >
              {isMarking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4 mr-1 text-emerald-600" />}
              Marcar Leídos
            </Button>
          )}
        </div>
      </header>

      {/* TARJETAS DE MÉTRICAS KPI Y ESTADO DE RED */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="rounded-[2rem] border-slate-200/80 shadow-md bg-white">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-rose-50 border border-rose-100 text-rose-600 flex items-center justify-center font-black">
              <Bell className="h-6 w-6" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest block">Avisos Sin Leer</span>
              <span className="text-2xl font-black text-slate-900">{unreadNotificationsCount}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[2rem] border-slate-200/80 shadow-md bg-white">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center font-black">
              <MessageSquare className="h-6 w-6" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest block">Chats Pendientes</span>
              <span className="text-2xl font-black text-slate-900">{unreadDMsCount}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[2rem] border-slate-200/80 shadow-md bg-white">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center font-black">
              <FileText className="h-6 w-6" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest block">Reportes de Cartera</span>
              <span className="text-2xl font-black text-slate-900">{reportsCount}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* PESTAÑAS PRINCIPALES Y CHIPS DE FILTRO */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <TabsList className="bg-white/70 p-1 h-12 rounded-xl shadow-xs border border-slate-200/80">
            <TabsTrigger value="inbox" className="rounded-lg font-black uppercase text-[10px] px-6">
              Avisos del Sistema ({filteredNotifications.length})
            </TabsTrigger>
            <TabsTrigger value="dms" className="rounded-lg font-black uppercase text-[10px] px-6">
              Chats Directos ({directMessages?.length || 0})
            </TabsTrigger>
          </TabsList>

          {/* PÍLDORAS DE FILTRO POR CATEGORÍA */}
          {activeTab === 'inbox' && (
            <div className="flex flex-wrap items-center gap-1.5 bg-white p-2 rounded-2xl border border-slate-200/80 shadow-xs">
              {[
                { id: 'todos', label: '🌐 Todos' },
                { id: 'Facturación', label: '💳 Facturación' },
                { id: 'Inventario', label: '📦 Inventario' },
                { id: 'Pedidos', label: '🛒 Pedidos' },
                { id: 'Despacho', label: '🚚 Despacho' },
                { id: 'Soporte', label: '🎧 Soporte' },
              ].map(chip => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setCategoryFilter(chip.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all border cursor-pointer",
                    categoryFilter === chip.id
                      ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                      : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 font-bold"
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <TabsContent value="inbox" className="mt-0">
          <div className="space-y-3">
            {isLoadingInbox ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-[2rem]" />)
            ) : filteredNotifications.length > 0 ? (
              filteredNotifications.map(n => (
                <NotificationItem 
                  key={n.id} 
                  notification={n} 
                  onOpenDetail={handleOpenNotificationDetail} 
                />
              ))
            ) : (
              <Card className="rounded-[2.5rem] p-12 text-center bg-white border-slate-200">
                <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
                <h3 className="text-lg font-black uppercase tracking-tight text-slate-800">Bandeja de Avisos Al Día</h3>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">No hay notificaciones pendientes en esta categoría.</p>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* DIÁLOGO Y SHEET DE DETALLE */}
      <NotificationDetailSheet
        isOpen={isDetailOpen}
        onOpenChange={setIsDetailOpen}
        notification={activeNotificationDetail}
        onReplyClick={handleReplyFromNotification}
      />

      <NewMessageDialog 
        isOpen={isNewMessageOpen} 
        onOpenChange={setIsNewMessageOpen} 
        allUsers={allUsers || []} 
        onMessageSent={handleMessageSentSuccess} 
      />

      {activeThreadContact && (
        <DirectMessageThreadDialog 
          isOpen={isThreadOpen} 
          onOpenChange={setIsThreadOpen} 
          contact={activeThreadContact} 
          initialSubject={activeThreadSubject} 
        />
      )}
    </div>
  );
}
