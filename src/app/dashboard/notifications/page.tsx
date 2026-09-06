'use client';

import React, { useMemo, useState, useEffect } from 'react';
import {
  useCollection,
  useFirestore,
  useMemoFirebase,
  useUser,
} from '@/firebase';
import { collection, orderBy, query, where, getDocs, writeBatch, limit, doc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import type { Notification, DirectMessage, User as AppUser, GroupChannel, Order } from '@/lib/definitions';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
  LifeBuoy,
  Search,
  ExternalLink,
  ArrowLeft,
  Clock,
  User as UserIcon,
  ChevronRight,
  Inbox,
  Users,
  PlusCircle,
  Hash,
  Package
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { NewMessageDialog } from './NewMessageDialog';
import { DirectMessageThreadDialog, type ChatContact } from './DirectMessageThreadDialog';
import { GroupChatWindow } from '@/components/dashboard/GroupChatWindow';
import { CreateGroupDialog } from '@/components/dashboard/CreateGroupDialog';
import { OrderTimelineModal } from '@/components/dashboard/OrderTimelineModal';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

const DEFAULT_SYSTEM_GROUPS: Omit<GroupChannel, 'id'>[] = [
  { name: '#general-anuncios', description: 'Comunicados corporativos para todo el equipo', iconName: 'Bell', isSystemDefault: true },
  { name: '#equipo-ventas', description: 'Cotizaciones, ventas y atención a clientes B2B', iconName: 'ShoppingCart', isSystemDefault: true },
  { name: '#almacen-despacho', description: 'Picking, empaque, rótulos QR y encomiendas', iconName: 'Truck', isSystemDefault: true },
  { name: '#cobranzas-tesoreria', description: 'Verificación de pagos, facturación y finanzas', iconName: 'CreditCard', isSystemDefault: true },
  { name: '#gerencia-superadmin', description: 'Canal de decisiones estratégicas y auditoría', iconName: 'ShieldAlert', isSystemDefault: true },
];

export default function NotificationsPage() {
  const { user, profile: currentUser } = useUser();
  const firestore = useFirestore();
  const router = useRouter();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'notifications' | 'dms' | 'groups'>('notifications');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('todos');
  const [onlyUnread, setOnlyUnread] = useState<boolean>(false);
  const [isMarking, setIsMarking] = useState(false);
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);

  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupChannel | null>(null);
  const [activeThreadContact, setActiveThreadContact] = useState<ChatContact | null>(null);
  const [isThreadOpen, setIsThreadOpen] = useState(false);

  // Modal para Traza 360° si se selecciona una orden
  const [timelineOrderId, setTimelineOrderId] = useState<string | null>(null);
  const [timelineOrder, setTimelineOrder] = useState<Order | null>(null);

  const [mobileDetailView, setMobileDetailView] = useState(false);

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

  // Consulta de Canales Grupales
  const groupsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'group_channels'), orderBy('name', 'asc'), limit(50));
  }, [firestore]);
  const { data: dbGroups } = useCollection<GroupChannel>(groupsQuery);

  // Inicializar grupos predeterminados si la colección está vacía
  useEffect(() => {
    if (firestore && dbGroups && dbGroups.length === 0 && currentUser?.role === 'superadmin') {
      DEFAULT_SYSTEM_GROUPS.forEach(async (g) => {
        const id = g.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
        await setDoc(doc(firestore, 'group_channels', id), {
          ...g,
          id,
          membersCount: 1,
          createdAt: serverTimestamp()
        });
      });
    }
  }, [firestore, dbGroups, currentUser?.role]);

  // Consulta de Usuarios para Mensajería Directa
  const allUsersQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser) return null;
    return query(collection(firestore, 'users'), limit(300));
  }, [firestore, currentUser]);
  const { data: allUsers } = useCollection<AppUser>(allUsersQuery);

  // Seleccionar automáticamente la primera notificación al cargar
  useEffect(() => {
    if (allNotifications && allNotifications.length > 0 && !selectedNotification) {
      setSelectedNotification(allNotifications[0]);
    }
  }, [allNotifications, selectedNotification]);

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

  const handleStartDirectChat = (contactUser: AppUser) => {
    setActiveThreadContact({
      id: contactUser.id,
      name: contactUser.name,
      avatarUrl: contactUser.avatarUrl,
      role: contactUser.role,
      email: contactUser.email
    });
    setIsThreadOpen(true);
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
      createdAt: serverTimestamp(),
      orderDate: serverTimestamp(),
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
            Notificaciones & Chat de Equipo
          </h1>
          <p className="text-[11px] sm:text-xs text-slate-400 font-bold uppercase tracking-wider">
            Comunicación instantánea, alertas de pedidos, chats directos y canales grupales
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 relative z-10 shrink-0">
          <Button
            onClick={() => setIsNewMessageOpen(true)}
            className="bg-white/10 hover:bg-white/20 text-white border border-white/20 font-black text-[10px] sm:text-xs uppercase px-3.5 h-10 rounded-xl flex items-center gap-1.5 shadow-sm"
          >
            <MessageSquarePlus className="h-4 w-4 text-emerald-400" /> Mensaje Directo
          </Button>

          <Button
            onClick={() => setIsCreateGroupOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[10px] sm:text-xs uppercase px-3.5 h-10 rounded-xl flex items-center gap-1.5 shadow-md"
          >
            <PlusCircle className="h-4 w-4" /> Crear Grupo
          </Button>

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

      {/* BARRA DE PESTAÑAS DE NAVEGACIÓN ADAPTATIVA */}
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
          <span>Notificaciones PWA</span>
          {unreadCount > 0 && (
            <Badge className="bg-rose-500 text-white text-[9px] font-black h-5 px-1.5 rounded-full">{unreadCount}</Badge>
          )}
        </Button>

        <Button
          onClick={() => setActiveTab('dms')}
          variant={activeTab === 'dms' ? 'default' : 'ghost'}
          className={cn(
            'flex-1 font-black text-xs uppercase rounded-xl h-11 flex items-center justify-center gap-2 transition-all',
            activeTab === 'dms' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'
          )}
        >
          <MessageSquare className="h-4 w-4 text-emerald-400" />
          <span>Chats Directos (1-a-1)</span>
        </Button>

        <Button
          onClick={() => setActiveTab('groups')}
          variant={activeTab === 'groups' ? 'default' : 'ghost'}
          className={cn(
            'flex-1 font-black text-xs uppercase rounded-xl h-11 flex items-center justify-center gap-2 transition-all',
            activeTab === 'groups' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'
          )}
        >
          <Users className="h-4 w-4 text-amber-400" />
          <span>Canales & Grupos</span>
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
                  placeholder="Buscar notificación..."
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
                  <p className="text-xs font-black uppercase text-slate-700">Sin Notificaciones</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase">No hay elementos que coincidan con la búsqueda</p>
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
                {/* BOTÓN VOLVER EN MÓVIL */}
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

                {/* ACCIONES AL PIE */}
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

                  <Button
                    onClick={() => setActiveTab('dms')}
                    variant="outline"
                    className="border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100 font-black text-xs uppercase px-4 h-10 rounded-xl flex items-center gap-2 w-full sm:w-auto"
                  >
                    <MessageSquare className="h-4 w-4 text-indigo-600" /> Abrir Chat Directo
                  </Button>
                </div>
              </div>
            ) : (
              <div className="my-auto text-center space-y-3 p-8 sm:p-12">
                <Inbox className="h-10 w-10 text-slate-300 mx-auto" />
                <h4 className="text-xs sm:text-sm font-black uppercase text-slate-700">Selecciona una Notificación</h4>
                <p className="text-[11px] text-slate-400 uppercase font-bold max-w-xs mx-auto">
                  Elige cualquier aviso de la lista para inspeccionar sus detalles e interactuar.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VISTA 2: MENSAJERÍA DIRECTA 1-A-1 */}
      {activeTab === 'dms' && (
        <div className="bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-200/80 shadow-sm space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-lg font-black uppercase text-slate-900 tracking-tight flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-emerald-600" /> Directorio de Mensajería Directa
              </h3>
              <p className="text-xs text-slate-500 font-bold uppercase mt-0.5">
                Chatea en privado de 1-a-1 con cualquier asesor, almacenista o superadministrador
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {allUsers?.map((u) => {
              if (u.id === currentUser?.id) return null;
              return (
                <div
                  key={u.id}
                  onClick={() => handleStartDirectChat(u)}
                  className="p-4 rounded-2xl border border-slate-200/80 hover:border-emerald-500/50 hover:bg-emerald-50/30 transition-all cursor-pointer flex items-center justify-between gap-3 group shadow-sm"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-11 w-11 rounded-2xl border border-slate-200 shrink-0">
                      <AvatarImage src={u.avatarUrl} />
                      <AvatarFallback className="bg-slate-900 text-white font-black text-xs">
                        {u.name.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>

                    <div className="min-w-0">
                      <h4 className="text-xs font-black uppercase text-slate-900 truncate group-hover:text-emerald-700 transition-colors">
                        {u.name}
                      </h4>
                      <Badge variant="secondary" className="text-[8px] font-mono font-black uppercase px-2 h-4 bg-slate-100">
                        {u.role}
                      </Badge>
                    </div>
                  </div>

                  <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-emerald-600 transition-transform group-hover:translate-x-1 shrink-0" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VISTA 3: CANALES GRUPALES Y DEPARTAMENTOS */}
      {activeTab === 'groups' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[550px]">
          {/* LISTA DE GRUPOS */}
          <div className="lg:col-span-4 bg-white p-5 rounded-[2rem] border border-slate-200/80 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black uppercase text-slate-900 flex items-center gap-2">
                <Users className="h-4 w-4 text-indigo-600" /> Canales de Equipo
              </h3>
              <Button
                size="sm"
                onClick={() => setIsCreateGroupOpen(true)}
                className="h-8 text-[9px] font-black uppercase px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                + Nuevo
              </Button>
            </div>

            <div className="space-y-2 max-h-[480px] overflow-y-auto custom-scrollbar">
              {dbGroups?.map((g) => {
                const isSelected = selectedGroup?.id === g.id;
                return (
                  <div
                    key={g.id}
                    onClick={() => setSelectedGroup(g)}
                    className={cn(
                      'p-4 rounded-2xl border transition-all cursor-pointer space-y-1',
                      isSelected ? 'bg-indigo-50/80 border-indigo-300 ring-2 ring-indigo-500/20' : 'bg-white border-slate-200/80 hover:bg-slate-50'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-black uppercase text-slate-900 flex items-center gap-1.5">
                        <Hash className="h-3.5 w-3.5 text-indigo-600" /> {g.name}
                      </span>
                      {g.isSystemDefault && (
                        <Badge variant="outline" className="text-[7px] font-mono font-black uppercase px-1.5 h-4 border-indigo-200 text-indigo-700">
                          OFICIAL
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase line-clamp-1">{g.description}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* VENTANA DEL CANAL SELECCIONADO */}
          <div className="lg:col-span-8 min-h-[500px]">
            {selectedGroup ? (
              <GroupChatWindow
                channel={selectedGroup}
                onSelectOrderRef={(orderId) => handleOpenOrderModal(orderId)}
              />
            ) : (
              <div className="bg-white p-12 rounded-[2rem] border border-slate-200/80 h-full flex flex-col items-center justify-center text-center space-y-3">
                <Users className="h-12 w-12 text-slate-300" />
                <h4 className="text-sm font-black uppercase text-slate-800">Selecciona un Canal Grupal</h4>
                <p className="text-xs text-slate-400 font-bold uppercase max-w-xs">
                  Elige un canal corporativo de la izquierda para ver los mensajes del equipo y colaborar.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* DIÁLOGO MODAL PARA MENSAJE DIRECTO 1-A-1 */}
      {isThreadOpen && activeThreadContact && (
        <DirectMessageThreadDialog
          isOpen={isThreadOpen}
          onOpenChange={setIsThreadOpen}
          contact={activeThreadContact}
        />
      )}

      {/* DIÁLOGO PARA NUEVO MENSAJE */}
      <NewMessageDialog
        isOpen={isNewMessageOpen}
        onOpenChange={setIsNewMessageOpen}
        allUsers={allUsers || []}
        onMessageSent={(contactUser) => handleStartDirectChat(contactUser)}
      />

      {/* DIÁLOGO PARA CREAR GRUPO */}
      <CreateGroupDialog
        isOpen={isCreateGroupOpen}
        onOpenChange={setIsCreateGroupOpen}
        onGroupCreated={(id) => {
          const newG = dbGroups?.find(g => g.id === id);
          if (newG) setSelectedGroup(newG);
        }}
      />

      {/* MODAL DE TRAZA 360° SI SE MENCIONA UN PEDIDO */}
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
