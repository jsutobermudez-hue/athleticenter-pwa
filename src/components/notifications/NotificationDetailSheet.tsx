'use client';

import React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Bell, 
  ExternalLink, 
  MessageSquare, 
  Clock, 
  CreditCard,
  Boxes,
  ShoppingCart,
  Truck,
  ClipboardList,
  Contact,
  Users,
  LifeBuoy,
  Download,
  FileText,
  Sparkles
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import type { Notification, NotificationCategory } from '@/lib/definitions';
import { useFirestore } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { cn } from '@/lib/utils';

const categoryConfig: Record<NotificationCategory, { icon: React.ElementType, color: string, priority: 'high' | 'medium' | 'low' }> = {
  'Facturación': { icon: CreditCard, color: 'text-rose-600 bg-rose-50 border-rose-100', priority: 'high' },
  'Inventario': { icon: Boxes, color: 'text-rose-600 bg-rose-50 border-rose-100', priority: 'high' },
  'Pedidos': { icon: ShoppingCart, color: 'text-blue-600 bg-blue-50 border-blue-100', priority: 'medium' },
  'Despacho': { icon: Truck, color: 'text-blue-600 bg-blue-50 border-blue-100', priority: 'medium' },
  'Cotizaciones': { icon: ClipboardList, color: 'text-blue-600 bg-blue-50 border-blue-100', priority: 'medium' },
  'Clientes': { icon: Contact, color: 'text-slate-500 bg-slate-50 border-slate-100', priority: 'low' },
  'Usuarios': { icon: Users, color: 'text-slate-500 bg-slate-50 border-slate-100', priority: 'low' },
  'Soporte': { icon: LifeBuoy, color: 'text-slate-500 bg-slate-50 border-slate-100', priority: 'low' },
};

interface NotificationDetailSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  notification: Notification | null;
  onReplyClick?: (notification: Notification) => void;
}

export function NotificationDetailSheet({
  isOpen,
  onOpenChange,
  notification,
  onReplyClick,
}: NotificationDetailSheetProps) {
  const router = useRouter();
  const firestore = useFirestore();

  if (!notification) return null;

  const config = categoryConfig[notification.category] || { icon: Bell, color: 'text-slate-400 bg-slate-50 border-slate-100', priority: 'low' };
  const Icon = config.icon;

  const formattedTime = notification.createdAt?.toDate 
    ? format(notification.createdAt.toDate(), "dd 'de' MMMM 'de' yyyy, hh:mm a", { locale: es }) 
    : 'Fecha Reciente';

  const isPdfReport = Boolean(
    notification.link?.includes('/api/reports') || 
    notification.link?.includes('pdf') || 
    notification.message.toLowerCase().includes('pdf') ||
    notification.title.toLowerCase().includes('cartera')
  );

  const handleMarkAsRead = () => {
    if (firestore && notification.userId && notification.id && !notification.isRead) {
      updateDoc(doc(firestore, `users/${notification.userId}/notifications`, notification.id), { isRead: true }).catch(() => {});
    }
  };

  const handleNavigate = () => {
    handleMarkAsRead();
    onOpenChange(false);
    if (notification.link && notification.link !== '#') {
      if (isPdfReport) {
        window.open(notification.link, '_blank');
      } else {
        router.push(notification.link);
      }
    }
  };

  const handleOpenReply = () => {
    handleMarkAsRead();
    onOpenChange(false);
    if (onReplyClick) {
      onReplyClick(notification);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl w-full p-0 bg-slate-50 border-l border-slate-200">
        <ScrollArea className="h-full">
          {/* ENCABEZADO MODERNO */}
          <div className="bg-slate-900 text-white p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <Badge className={cn(
                "text-[9px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-lg",
                config.priority === 'high' ? 'bg-rose-600 text-white' :
                config.priority === 'medium' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-white'
              )}>
                {notification.category} • {config.priority === 'high' ? '🔴 ALTA PRIORIDAD' : '🔵 NOTIFICACIÓN'}
              </Badge>
              <span className="text-[10px] font-mono font-bold text-slate-400 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-slate-400" /> {formattedTime}
              </span>
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-black uppercase tracking-tight text-white leading-snug break-words">
                {notification.title}
              </h2>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* CUERPO DEL MENSAJE */}
            <div className="p-6 rounded-3xl bg-white border border-slate-200/80 shadow-xs space-y-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-slate-500" /> Contenido del Aviso
              </span>
              <p className="text-sm font-semibold text-slate-800 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100">
                {notification.message}
              </p>
            </div>

            {/* BOTONES DE ACCIÓN DIRECTA */}
            <div className="space-y-3">
              {isPdfReport && notification.link && (
                <Button
                  onClick={handleNavigate}
                  className="w-full h-13 rounded-2xl font-black text-xs uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2"
                >
                  <Download className="h-4 w-4 text-emerald-200" /> Descargar Estado de Cartera PDF
                </Button>
              )}

              {onReplyClick && (
                <Button
                  onClick={handleOpenReply}
                  className="w-full h-13 rounded-2xl font-black text-xs uppercase tracking-wider bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
                >
                  <MessageSquare className="h-4 w-4" /> Responder / Abrir Chat Directo
                </Button>
              )}

              {notification.link && notification.link !== '#' && !isPdfReport && (
                <Button
                  onClick={handleNavigate}
                  variant="outline"
                  className="w-full h-13 rounded-2xl font-black text-xs uppercase tracking-wider border-slate-300 hover:bg-slate-100 text-slate-900 flex items-center justify-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" /> Ir a la Sección Afectada
                </Button>
              )}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
