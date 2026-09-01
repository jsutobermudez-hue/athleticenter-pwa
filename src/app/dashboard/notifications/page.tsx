'use client';

import React, { useMemo, useState, useEffect } from 'react';
import {
  useCollection,
  useFirestore,
  useMemoFirebase,
  useUser,
} from '@/firebase';
import { collection, orderBy, query, where, getDocs, writeBatch, limit, doc, updateDoc } from 'firebase/firestore';
import type { Notification, SentMessage, DirectMessage, User as AppUser } from '@/lib/definitions';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  Inbox
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { NewMessageDialog } from './NewMessageDialog';
import { DirectMessageThreadDialog, type ChatContact } from './DirectMessageThreadDialog';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

export default function NotificationsPage() {
  const { user, profile: currentUser } = useUser();
  const firestore = useFirestore();
  const router = useRouter();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('todos');
  const [onlyUnread, setOnlyUnread] = useState<boolean>(false);
  const [isMarking, setIsMarking] = useState(false);
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);

  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const [replyText, setReplyText] = useState<string>('');
  const [isSendingReply, setIsSendingReply] = useState<boolean>(false);

  const [activeThreadContact, setActiveThreadContact] = useState<ChatContact | null>(null);
  const [activeThreadSubject, setActiveThreadSubject] = useState<string>('Conversación de Soporte');
  const [isThreadOpen, setIsThreadOpen] = useState(false);

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

  // Contadores Inteligentes
  const unreadCount = useMemo(() => allNotifications?.filter(n => !n.isRead).length || 0, [allNotifications]);
  const reportsCount = useMemo(() => allNotifications?.filter(n => n.title.toLowerCase().includes('cartera') || n.link?.includes('/api/reports')).length || 0, [allNotifications]);

  // Filtrado Multidimensional de Avisos
  const filteredNotifications = useMemo(() => {
    if (!allNotifications) return [];
    const term = searchTerm.toLowerCase().trim();
    return allNotifications.filter(n => {
      const matchesCategory = categoryFilter === 'todos' || n.category === categoryFilter;
      const matchesUnread = !onlyUnread || !n.isRead;
      const matchesSearch = !term || 
        n.title.toLowerCase().includes(term) || 
        n.message.toLowerCase().includes(term) ||
        n.category.toLowerCase().includes(term);
      return matchesCategory && matchesUnread && matchesSearch;
    });
  }, [allNotifications, categoryFilter, onlyUnread, searchTerm]);

  // Marcar individual como leído al seleccionar
  const handleSelectNotification = (n: Notification) => {
    setSelectedNotification(n);
    if (firestore && user && n.id && !n.isRead) {
      updateDoc(doc(firestore, `users/${user.uid}/notifications`, n.id), { isRead: true }).catch(() => {});
    }
  };

  // Marcar todos como leídos (Limpieza Atómica del 100% en Firestore)
  const handleMarkAllAsRead = async () => {
    if (!firestore || !user) return;
    setIsMarking(true);
    try {
      const unreadSnap = await getDocs(
        query(
          collection(firestore, `users/${user.uid}/notifications`),
          where('isRead', '==', false)
        )
      );

      if (unreadSnap.empty) {
        toast({ title: '✅ No tienes avisos sin leer' });
        setIsMarking(false);
        return;
      }

      const docs = unreadSnap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = writeBatch(firestore);
        const chunk = docs.slice(i, i + 400);
        chunk.forEach(d => {
          batch.update(d.ref, { isRead: true });
        });
        await batch.commit();
      }

      toast({ title: '🎉 ¡Todas las notificaciones marcadas como leídas!', description: `Se actualizaron ${docs.length} avisos en sistema.` });
    } catch (e: any) {
      console.error("Error marking all notifications read:", e);
      toast({ variant: 'destructive', title: 'Error al actualizar avisos', description: e?.message });
    } finally {
      setIsMarking(false);
    }
  };

  // Abrir hilo de chat directo desde la notificación
  const handleOpenChatFromSelected = () => {
    if (!selectedNotification) return;
    const n = selectedNotification;
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

  // Descargar PDF de Cartera con Autenticación Directa
  const handleDownloadPdfReport = () => {
    if (!selectedNotification?.link) return;
    window.open(selectedNotification.link, '_blank');
  };

  const handleMessageSentSuccess = (contactUser: AppUser, subject: string) => {
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
    <div className="w-full max-w-[1600px] mx-auto flex flex-col gap-6 pb-32 px-2 sm:px-6 animate-in fade-in-50 duration-500">
      {/* BARRA SUPERIOR DE CONSOLA V9.0 */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-[2.5rem] border border-slate-200/80 shadow-lg">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black shadow-md">
              <Bell className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
                Centro de Comunicaciones <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg bg-primary/10 text-primary">v9.0 Executive</span>
              </h1>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Consola Maestro de Notificaciones y Mensajería Directa.</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button 
            onClick={() => setIsNewMessageOpen(true)}
            className="h-12 px-6 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black text-xs uppercase tracking-wider shadow-lg shadow-primary/20"
          >
            <MessageSquarePlus className="h-4 w-4 mr-2" /> Nuevo Mensaje Directo
          </Button>

          {unreadCount > 0 && (
            <Button 
              onClick={handleMarkAllAsRead} 
              variant="outline"
              disabled={isMarking}
              className="h-12 px-4 rounded-2xl border-slate-200 bg-slate-50 hover:bg-slate-100 font-black text-xs uppercase text-slate-800 shadow-xs"
            >
              {isMarking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4 mr-1.5 text-emerald-600" />}
              Marcar Todos Leídos ({unreadCount})
            </Button>
          )}
        </div>
      </header>

      {/* LAYOUT PRINCIPAL DE 2 COLUMNAS ESTILO WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* COLUMNA IZQUIERDA: BANDEJA EN VIVO Y FILTROS (4 COLUMNAS LG / 360PX) */}
        <div className={cn(
          "lg:col-span-4 flex flex-col gap-4 bg-white p-4 sm:p-5 rounded-[2.5rem] border border-slate-200/80 shadow-xl min-h-[750px]",
          selectedNotification && "hidden lg:flex"
        )}>
          {/* BUSCADOR SPOTLIGHT */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Buscar por título, categoría o mensaje..."
              className="h-11 pl-10 rounded-xl bg-slate-50 border-slate-200 font-bold text-xs"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* PÍLDORAS DE FILTRO RÁPIDO */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {[
              { id: 'todos', label: '🌐 Todos' },
              { id: 'unread', label: `🔴 Sin Leer (${unreadCount})` },
              { id: 'Facturación', label: '💳 Facturas' },
              { id: 'Despacho', label: '🚚 Envíos' },
              { id: 'Inventario', label: '📦 Stock' },
            ].map(chip => (
              <button
                key={chip.id}
                type="button"
                onClick={() => {
                  if (chip.id === 'unread') {
                    setOnlyUnread(!onlyUnread);
                  } else {
                    setCategoryFilter(chip.id);
                    setOnlyUnread(false);
                  }
                }}
                className={cn(
                  "px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all border shrink-0 cursor-pointer",
                  (chip.id === 'unread' && onlyUnread) || categoryFilter === chip.id
                    ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                    : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 font-bold"
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* LISTA DE TARJETAS DE NOTIFICACIÓN */}
          <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[620px] pr-1">
            {isLoadingInbox ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)
            ) : filteredNotifications.length > 0 ? (
              filteredNotifications.map(n => {
                const isSelected = selectedNotification?.id === n.id;
                const isPdf = n.title.toLowerCase().includes('cartera') || n.link?.includes('/api/reports');

                return (
                  <div
                    key={n.id}
                    onClick={() => handleSelectNotification(n)}
                    className={cn(
                      "p-4 rounded-2xl border transition-all cursor-pointer relative group flex flex-col gap-1.5",
                      isSelected 
                        ? "bg-slate-900 text-white border-slate-900 shadow-xl" 
                        : n.isRead 
                          ? "bg-slate-50/60 border-slate-200/80 hover:bg-slate-100/80" 
                          : "bg-white border-primary/20 ring-1 ring-primary/10 shadow-sm"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge className={cn(
                        "text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md",
                        isSelected 
                          ? "bg-white/10 text-white" 
                          : n.category === 'Facturación' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'
                      )}>
                        {n.category}
                      </Badge>

                      <span className={cn(
                        "text-[9px] font-mono font-bold",
                        isSelected ? "text-slate-400" : "text-slate-400"
                      )}>
                        {n.createdAt?.toDate ? format(n.createdAt.toDate(), "dd/MM HH:mm") : 'Reciente'}
                      </span>
                    </div>

                    <h3 className={cn(
                      "text-xs font-black uppercase tracking-tight leading-snug line-clamp-1",
                      isSelected ? "text-white" : "text-slate-900"
                    )}>
                      {n.title}
                    </h3>

                    <p className={cn(
                      "text-[11px] font-medium line-clamp-2 leading-relaxed",
                      isSelected ? "text-slate-300" : "text-slate-500"
                    )}>
                      {n.message}
                    </p>

                    {!n.isRead && (
                      <span className="absolute top-4 right-4 h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                    )}
                  </div>
                );
              })
            ) : (
              <div className="h-60 text-center flex flex-col items-center justify-center gap-2 opacity-50">
                <Inbox className="h-10 w-10 text-slate-400" />
                <p className="text-xs font-black uppercase text-slate-500">Sin avisos en esta categoría.</p>
              </div>
            )}
          </div>
        </div>

        {/* COLUMNA DERECHA: LECTOR INMERSIVO DE DETALLE Y ACCIONES (8 COLUMNAS LG) */}
        <div className={cn(
          "lg:col-span-8 bg-white rounded-[2.5rem] border border-slate-200/80 shadow-xl min-h-[750px] flex flex-col overflow-hidden",
          !selectedNotification && "hidden lg:flex"
        )}>
          {selectedNotification ? (
            <div className="flex-1 flex flex-col h-full">
              
              {/* BOTÓN VOLVER EN MÓVILES */}
              <div className="p-4 border-b border-slate-100 lg:hidden bg-slate-50 flex items-center gap-2">
                <Button 
                  size="sm" 
                  variant="ghost" 
                  onClick={() => setSelectedNotification(null)}
                  className="font-black text-xs uppercase"
                >
                  <ArrowLeft className="h-4 w-4 mr-2" /> Volver a la Bandeja
                </Button>
              </div>

              {/* ENCABEZADO DEL LECTOR MAESTRO */}
              <div className="bg-slate-900 text-white p-8 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-primary text-white font-black text-[9px] uppercase tracking-widest px-3 py-1 rounded-lg">
                      {selectedNotification.category}
                    </Badge>
                    <span className="text-[10px] font-mono font-bold text-slate-400 flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" /> 
                      {selectedNotification.createdAt?.toDate 
                        ? format(selectedNotification.createdAt.toDate(), "dd 'de' MMMM 'de' yyyy, hh:mm a", { locale: es }) 
                        : 'Fecha Reciente'}
                    </span>
                  </div>
                </div>

                <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-white leading-snug break-words">
                  {selectedNotification.title}
                </h2>
              </div>

              {/* CUERPO PRINCIPAL DEL MENSAJE */}
              <div className="flex-1 p-8 space-y-6 overflow-y-auto">
                <Card className="rounded-3xl border-slate-200/80 shadow-xs bg-slate-50/50">
                  <CardContent className="p-6 space-y-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                      <FileText className="h-4 w-4 text-slate-500" /> Resumen del Documento / Alerta
                    </span>
                    <div className="p-5 rounded-2xl bg-white border border-slate-200/80 text-slate-800 font-semibold text-sm leading-relaxed shadow-sm">
                      {selectedNotification.message}
                    </div>
                  </CardContent>
                </Card>

                {/* ACCIÓN PRINCIPAL DE DESCARGA DIRECTA DE PDF */}
                {(selectedNotification.link?.includes('/api/reports') || selectedNotification.title.toLowerCase().includes('cartera')) && (
                  <Card className="rounded-3xl border-emerald-200 bg-emerald-50/60 p-6 shadow-sm">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="space-y-1">
                        <h4 className="text-sm font-black uppercase text-emerald-950 flex items-center gap-2">
                          <FileText className="h-5 w-5 text-emerald-600" /> Estado de Cartera en PDF Disponible
                        </h4>
                        <p className="text-xs font-bold text-emerald-700">El reporte oficial consolidado de cuentas por cobrar está listo para descarga.</p>
                      </div>

                      <Button
                        onClick={handleDownloadPdfReport}
                        className="h-13 px-8 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider shadow-lg shadow-emerald-600/20 shrink-0 flex items-center gap-2"
                      >
                        <Download className="h-4 w-4 text-emerald-200" /> Descargar Estado de Cartera PDF
                      </Button>
                    </div>
                  </Card>
                )}

                {/* ACCIÓN SECUNDARIA NAVEGACIÓN A SECCIÓN AFECTADA */}
                {selectedNotification.link && selectedNotification.link !== '#' && !selectedNotification.link.includes('/api/reports') && (
                  <Button
                    onClick={() => selectedNotification.link && router.push(selectedNotification.link)}
                    variant="outline"
                    className="h-12 px-6 rounded-2xl border-slate-300 font-black text-xs uppercase tracking-wider text-slate-900 hover:bg-slate-100 flex items-center gap-2"
                  >
                    <ExternalLink className="h-4 w-4" /> Ir a la Sección Afectada ({selectedNotification.category})
                  </Button>
                )}
              </div>

              {/* BARRA INFERIOR DE CHAT E INTERACCIÓN EN 2 VÍAS */}
              <div className="p-6 bg-slate-50 border-t border-slate-200/80 flex items-center gap-3">
                <Button
                  onClick={handleOpenChatFromSelected}
                  className="w-full h-13 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black text-xs uppercase tracking-wider shadow-md flex items-center justify-center gap-2"
                >
                  <MessageSquare className="h-5 w-5" /> Abrir Chat Directo en 2 Vías con Asesor
                </Button>
              </div>

            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center opacity-40 gap-3">
              <Bell className="h-16 w-16 text-slate-400" />
              <h3 className="text-lg font-black uppercase text-slate-700">Seleccione un aviso para inspeccionar</h3>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest max-w-sm">Haga clic en cualquier elemento de la columna izquierda para abrir su vista inmersiva.</p>
            </div>
          )}
        </div>

      </div>

      {/* DIÁLOGOS DE MENSAJERÍA DIRECTA */}
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
