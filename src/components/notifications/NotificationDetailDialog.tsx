'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Bell, 
  ExternalLink, 
  MessageSquare, 
  CheckCircle2, 
  Clock, 
  ShieldAlert,
  CreditCard,
  Boxes,
  ShoppingCart,
  Truck,
  ClipboardList,
  Contact,
  Users,
  LifeBuoy,
  Download,
  FileText
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

interface NotificationDetailDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  notification: Notification | null;
  onReplyClick?: (notification: Notification) => void;
}

export function NotificationDetailDialog({
  isOpen,
  onOpenChange,
  notification,
  onReplyClick,
}: NotificationDetailDialogProps) {
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
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl sm:max-w-2xl w-[94vw] md:w-full p-0 rounded-[2.5rem] overflow-hidden border-none shadow-2xl bg-white">
        {/* ENCABEZADO AMPLIO RESPONSIVO */}
        <DialogHeader className="p-6 sm:p-8 bg-slate-900 text-white relative">
          <div className="flex items-start gap-4 w-full min-w-0">
            <div className={cn("h-14 w-14 rounded-2xl border flex items-center justify-center shadow-lg shrink-0", config.color)}>
              <Icon className="h-7 w-7" />
            </div>
            <div className="space-y-2 flex-1 min-w-0 pr-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="bg-white/10 text-white font-black text-[9px] uppercase tracking-widest px-2.5 py-0.5 border-none">
                  {notification.category}
                </Badge>
                {config.priority === 'high' && (
                  <Badge variant="destructive" className="bg-rose-500 font-black text-[8px] uppercase tracking-widest px-2.5 py-0.5">
                    Prioridad Alta
                  </Badge>
                )}
              </div>
              <DialogTitle className="text-lg sm:text-2xl font-black uppercase tracking-tight text-white leading-snug break-words w-full">
                {notification.title}
              </DialogTitle>
            </div>
          </div>
        </DialogHeader>

        {/* CONTENIDO SCROLLABLE */}
        <div className="p-6 sm:p-8 space-y-6 bg-white max-h-[60vh] overflow-y-auto">
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-primary" /> Emitido: {formattedTime}
            </p>
            <div className="p-5 rounded-3xl bg-slate-50 border border-slate-100 text-slate-800 font-semibold text-sm leading-relaxed shadow-inner">
              {notification.message}
            </div>
          </div>
        </div>

        {/* PIE DE BOTONES ADAPTATIVO SIN CORTES */}
        <DialogFooter className="p-6 sm:p-8 bg-slate-50 border-t border-slate-100 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto h-12 px-6 rounded-xl font-black text-xs uppercase tracking-widest text-slate-500 hover:bg-slate-200"
          >
            Cerrar
          </Button>

          <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
            {onReplyClick && (
              <Button
                onClick={handleOpenReply}
                size="sm"
                className="w-full sm:w-auto h-12 px-6 rounded-xl font-black text-xs uppercase tracking-wider bg-primary hover:bg-primary/90 text-white shadow-md flex items-center justify-center gap-2"
              >
                <MessageSquare className="h-4 w-4" /> Chat Directo
              </Button>
            )}

            {notification.link && notification.link !== '#' && (
              isPdfReport ? (
                <Button
                  onClick={handleNavigate}
                  size="sm"
                  className="w-full sm:w-auto h-12 px-6 rounded-xl font-black text-xs uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white shadow-md flex items-center justify-center gap-2"
                >
                  <Download className="h-4 w-4 text-emerald-200" /> Descargar Estado de Cartera PDF
                </Button>
              ) : (
                <Button
                  onClick={handleNavigate}
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto h-12 px-6 rounded-xl font-black text-xs uppercase tracking-wider border-slate-300 hover:bg-slate-100 text-slate-900 flex items-center justify-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" /> Ver Sección
                </Button>
              )
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
