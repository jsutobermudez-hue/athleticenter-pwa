'use client';

import type { SentNotification, NotificationCategory } from '@/lib/definitions';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  ShoppingCart,
  ClipboardList,
  Contact,
  Boxes,
  CreditCard,
  Truck,
  Users,
  LifeBuoy,
  Bell,
  Send,
} from 'lucide-react';
import React from 'react';
import { cn } from '@/lib/utils';


const categoryIcons: Record<NotificationCategory, React.ElementType> = {
    'Pedidos': ShoppingCart,
    'Cotizaciones': ClipboardList,
    'Clientes': Contact,
    'Inventario': Boxes,
    'Facturación': CreditCard,
    'Despacho': Truck,
    'Usuarios': Users,
    'Soporte': LifeBuoy,
};

export function SentNotificationItem({ notification }: { notification: SentNotification }) {
  const router = useRouter();

  const handleNotificationClick = () => {
    if (notification.link && notification.link !== '#') {
      router.push(notification.link);
    }
  };

  const timeAgo = notification.createdAt?.toDate 
    ? formatDistanceToNow(notification.createdAt.toDate(), { addSuffix: true, locale: es }) 
    : '...';

  const Icon = categoryIcons[notification.category] || Bell;

  return (
    <div
      onClick={handleNotificationClick}
      className={cn(
        'flex cursor-pointer items-start gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50'
      )}
    >
      <Icon className={cn('h-5 w-5 shrink-0 text-muted-foreground mt-1')} />
      <div className='flex-1 space-y-1'>
        <div className="flex items-start justify-between gap-4">
            <p className="text-sm font-medium leading-none">
            {notification.title}
            </p>
            <p className="text-xs text-muted-foreground shrink-0">{timeAgo}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          {notification.message}
        </p>
        {notification.recipientSummary && (
            <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                <Send className="h-3 w-3" />
                <span>Enviado a: {notification.recipientSummary}</span>
            </div>
        )}
      </div>
    </div>
  );
}
