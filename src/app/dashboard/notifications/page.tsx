'use client';

import React, { useMemo, useState, useEffect } from 'react';
import {
  useCollection,
  useFirestore,
  useMemoFirebase,
  useUser,
} from '@/firebase';
import { collection, orderBy, query, where, getDocs, writeBatch, limit, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import type { Notification, User as AppUser, Order } from '@/lib/definitions';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  CheckCheck, 
  Loader2, 
  Bell, 
  MessageSquare, 
  Inbox,
  Search,
  ExternalLink,
  ArrowLeft
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { OrderTimelineModal } from '@/components/dashboard/OrderTimelineModal';
import { ChatView } from './ChatView';

export default function NotificationsPage() {
  const { user, profile: currentUser } = useUser();
  const firestore = useFirestore();
  const router = useRouter();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'notifications' | 'chats'>('notifications');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('todos');
  const [onlyUnread, setOnlyUnread] = useState<boolean>(false);
  const [isMarking, setIsMarking] = useState(false);
  
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const [mobileDetailView, setMobileDetailView] = useState(false);

  // Modal para Traza 360° si se selecciona una orden
  const [timelineOrderId, setTimelineOrderId] = useState<string | null>(null);
  const [timelineOrder, setTimelineOrder] = useState<Order | null>(null);

  // Consulta de Notificaciones del Usuario
  const notificationsQuery = useMemoFirebase(
    () =>
      user && firestore
        ? query(
            collection(firestore, `users/${user.uid}/notifications`),
            orderBy('createdAt', 'desc'),
            limit(150)
          )
        : null,
    [user, firestore]
  );
  const { data: allNotifications, isLoading: isLoadingInbox } = useCollection<Notification>(notificationsQuery);

  // Consulta de Usuarios
  const allUsersQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser) return null;
    return query(collection(firestore, 'users'), limit(300));
  }, [firestore, currentUser]);
  const { data: allUsers } = useCollection<AppUser>(allUsersQuery);

  // Filtrado de Notificaciones
  const filteredNotifications = useMemo(() => {
    if (!allNotifications) return [];
    return allNotifications.filter(n => {
      const matchesSearch = n.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            n.message.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCat = categoryFilter === 'todos' || n.category === categoryFilter;
      const matchesUnread = !onlyUnread || !n.isRead;
      return matchesSearch && matchesCat && matchesUnread;
    });
  }, [allNotifications, searchTerm, categoryFilter, onlyUnread]);

  const unreadCount = useMemo(() => {
    if (!allNotifications) return 0;
    return allNotifications.filter(n => !n.isRead).length;
  }, [allNotifications]);

  const handleMarkAllAsRead = async () => {
    if (!user || !firestore || unreadCount === 0) return;
    setIsMarking(true);
    try {
      const q = query(
        collection(firestore, `users/${user.uid}/notifications`),
        where('isRead', '==', false),
        limit(400)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const batch = writeBatch(firestore);
        snap.forEach(d => batch.update(d.ref, { isRead: true }));
        await batch.commit();
        toast({ title: "Bandeja Limpia", description: "Notificaciones marcadas como leídas." });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: "Error", description: e.message });
    } finally {
      setIsMarking(false);
    }
  };

  const handleOpenNotificationDetail = async (n: Notification) => {
    setSelectedNotification(n);
    setMobileDetailView(true);
    if (!n.isRead && user && firestore && n.id) {
      try {
        const ref = doc(firestore, `users/${user.uid}/notifications`, n.id);
        await updateDoc(ref, { isRead: true });
      } catch (e) {
        console.warn("Error marking read:", e);
      }
    }
  };

  const handleOpenOrderModal = (orderId: string) => {
    setTimelineOrder({
      id: orderId,
      customerName: 'Pedido ' + orderId,
      customerId: '',
      salespersonId: '',
      salespersonName: '',
      totalAmount: 0,
      amountPaid: 0,
      status: 'Aprobado',
      createdAt: serverTimestamp() as any,
      orderDate: serverTimestamp() as any,
      customerPhone: '',
      items: [],
      paymentStatus: 'Pendiente'
    } as any);
    setTimelineOrderId(orderId);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 w-full overflow-hidden px-1">
      {/* HEADER PRINCIPAL RESPONSIVO */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900 text-white p-5 sm:p-7 rounded-[2rem] shadow-xl relative overflow-hidden w-full max-w-full">
        <div className="space-y-1 relative z-10 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-indigo-500/40 text-indigo-400 font-mono text-[9px] uppercase px-2.5 py-0.5">
              CENTRO OMNICANAL 360°
            </Badge>
            {unreadCount > 0 && (
              <Badge className="bg-rose-600 text-white font-mono text-[9px] font-black uppercase px-2 py-0.5 animate-pulse">
                {unreadCount} SIN LEER
              </Badge>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-black uppercase tracking-tight text-white truncate">
            Centro de Comunicaciones
          </h1>
          <p className="text-[11px] sm:text-xs text-slate-400 font-bold uppercase tracking-wider">
            Alertas del sistema y mensajería unificada (Directos y Grupos)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 relative z-10 shrink-0">
          {unreadCount > 0 && (
            <Button
              onClick={handleMarkAllAsRead}
              disabled={isMarking}
              variant="outline"
              className="bg-emerald-600 hover:bg-emerald-700 text-white border-none font-black text-[10px] sm:text-xs uppercase px-3.5 h-10 rounded-xl flex items-center gap-1.5 shadow-md"
            >
              {isMarking ? <Loader2 className="animate-spin h-4 w-4" /> : <CheckCheck className="h-4 w-4" />}
              Limpiar Bandeja
            </Button>
          )}
        </div>
      </div>

      {/* BARRA DE PESTAÑAS */}
      <div className="flex items-center gap-2 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
        <Button
          onClick={() => setActiveTab('notifications')}
          variant={activeTab === 'notifications' ? 'default' : 'ghost'}
          className={cn(
            'flex-1 font-black text-xs uppercase rounded-xl h-11 flex items-center justify-center gap-2 transition-all',
            activeTab === 'notifications' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'
          )}
        >
          <Bell className="h-4 w-4 text-indigo-400" />
          <span>Alertas del Sistema</span>
          {unreadCount > 0 && (
            <Badge className="bg-rose-500 text-white text-[9px] font-black h-5 px-1.5 rounded-full">{unreadCount}</Badge>
          )}
        </Button>

        <Button
          onClick={() => setActiveTab('chats')}
          variant={activeTab === 'chats' ? 'default' : 'ghost'}
          className={cn(
            'flex-1 font-black text-xs uppercase rounded-xl h-11 flex items-center justify-center gap-2 transition-all',
            activeTab === 'chats' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'
          )}
        >
          <MessageSquare className="h-4 w-4 text-emerald-400" />
          <span>Bandeja de Chats</span>
        </Button>
      </div>

      {/* VISTA 1: NOTIFICACIONES PWA DE SISTEMA */}
      {activeTab === 'notifications' && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
          {/* COLUMNA IZQUIERDA: LISTA CON FILTROS */}
          <div className={cn(
            "md:col-span-5 space-y-4 bg-white p-4 sm:p-5 rounded-[2rem] border border-slate-200/80 shadow-sm",
            mobileDetailView && "hidden md:block"
          )}>
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar alerta..."
                  className="pl-10 h-11 rounded-2xl bg-slate-50 border-slate-200 text-xs font-bold"
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="h-9 px-3 rounded-xl bg-slate-50 border border-slate-200 text-[10px] font-black uppercase text-slate-700 outline-none flex-1 min-w-0"
                >
                  <option value="todos">TODAS LAS CATEGORÍAS</option>
                  <option value="Pedidos">PEDIDOS</option>
                  <option value="Despacho">DESPACHO</option>
                  <option value="Facturación">FACTURACIÓN</option>
                  <option value="Inventario">INVENTARIO</option>
                  <option value="Clientes">CLIENTES</option>
                </select>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOnlyUnread(!onlyUnread)}
                  className={cn(
                    'h-9 text-[9px] font-black uppercase px-2.5 rounded-xl border-slate-200 shrink-0',
                    onlyUnread ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'text-slate-600'
                  )}
                >
                  Solo No Leídas
                </Button>
              </div>
            </div>

            {/* LISTADO DE NOTIFICACIONES */}
            <div className="space-y-2 max-h-[480px] overflow-y-auto custom-scrollbar pr-1">
              {isLoadingInbox ? (
                Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)
              ) : filteredNotifications.length === 0 ? (
                <div className="p-8 text-center space-y-2 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                  <Inbox className="h-8 w-8 text-slate-400 mx-auto" />
                  <p className="text-xs font-black uppercase text-slate-700">Sin Alertas</p>
                </div>
              ) : (
                filteredNotifications.map((n) => {
                  const isSelected = selectedNotification?.id === n.id;
                  let formattedTime = 'Reciente';
                  if (n.createdAt) {
                    const rawDate = typeof (n.createdAt as any)?.toDate === 'function' ? (n.createdAt as any).toDate() : (n.createdAt as any);
                    const d = rawDate instanceof Date ? rawDate : new Date(rawDate);
                    if (!isNaN(d.getTime())) formattedTime = format(d, 'dd MMM, hh:mm a', { locale: es }).toUpperCase();
                  }

                  return (
                    <div
                      key={n.id}
                      onClick={() => handleOpenNotificationDetail(n)}
                      className={cn(
                        'p-4 rounded-2xl border transition-all cursor-pointer space-y-2',
                        isSelected ? 'bg-indigo-50/80 border-indigo-300 ring-2 ring-indigo-500/20' : 'bg-white border-slate-200/80 hover:bg-slate-50/80',
                        !n.isRead && 'border-l-4 border-l-rose-500 font-bold'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="secondary" className="bg-slate-100 font-mono text-[8px] font-black uppercase text-slate-700">
                          {n.category || 'General'}
                        </Badge>
                        <span className="text-[9px] font-mono text-slate-400 font-bold">{formattedTime}</span>
                      </div>
                      <h4 className="text-xs font-black uppercase text-slate-900 truncate">{n.title}</h4>
                      <p className="text-[11px] font-bold text-slate-600 line-clamp-2 leading-tight">{n.message}</p>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* COLUMNA DERECHA: DETALLE DE LA NOTIFICACIÓN SELECCIONADA */}
          <div className={cn(
            "md:col-span-7 bg-white p-5 sm:p-7 rounded-[2rem] border border-slate-200/80 shadow-sm flex flex-col justify-between min-h-[300px]",
            !mobileDetailView && "hidden md:flex"
          )}>
            {selectedNotification ? (
              <div className="space-y-6">
                <div className="md:hidden">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setMobileDetailView(false)}
                    className="font-black text-xs uppercase rounded-xl border-slate-200 text-slate-700 flex items-center gap-2"
                  >
                    <ArrowLeft className="h-4 w-4 text-indigo-600" /> Volver a la Bandeja
                  </Button>
                </div>

                <div className="space-y-3 border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-indigo-600 text-white font-mono text-[9px] font-black uppercase px-2.5 py-0.5">
                      {selectedNotification.category || 'Aviso de Sistema'}
                    </Badge>
                  </div>
                  <h3 className="text-base sm:text-xl font-black uppercase text-slate-900 tracking-tight leading-snug">
                    {selectedNotification.title}
                  </h3>
                </div>

                <div className="bg-slate-50 p-5 sm:p-6 rounded-2xl border border-slate-100 space-y-3">
                  <p className="text-xs sm:text-sm font-bold text-slate-800 leading-relaxed uppercase">
                    {selectedNotification.message}
                  </p>
                </div>

                <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                  {selectedNotification.link && selectedNotification.link !== '#' && (
                    <Button
                      onClick={() => {
                        const match = selectedNotification.link?.match(/orderId=([A-Za-z0-9-]+)/);
                        if (match) {
                          handleOpenOrderModal(match[1]);
                        } else {
                          router.push(selectedNotification.link!);
                        }
                      }}
                      className="bg-slate-900 hover:bg-slate-800 text-white font-black text-xs uppercase px-4 h-10 rounded-xl flex items-center gap-2 shadow-sm w-full sm:w-auto"
                    >
                      <ExternalLink className="h-4 w-4 text-emerald-400" /> Abrir Módulo Afectado
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="my-auto text-center space-y-3 p-8 sm:p-12">
                <Inbox className="h-10 w-10 text-slate-300 mx-auto" />
                <h4 className="text-xs sm:text-sm font-black uppercase text-slate-700">Selecciona una Alerta</h4>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VISTA 2: NUEVO CENTRO DE CHATS */}
      {activeTab === 'chats' && (
        <ChatView allUsers={allUsers || []} />
      )}

      {timelineOrder && (
        <OrderTimelineModal
          order={timelineOrder}
          isOpen={!!timelineOrderId}
          onOpenChange={(open) => !open && setTimelineOrderId(null)}
        />
      )}
    </div>
  );
}
