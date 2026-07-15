
'use client';

import type { Notification, NotificationCategory } from '@/lib/definitions';
import { useFirestore } from '@/firebase';
import { useRouter } from 'next/navigation';
import { doc, updateDoc } from 'firebase/firestore';
import { cn } from '@/lib/utils';
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
  ArrowRight
} from 'lucide-react';
import React from 'react';

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

export function NotificationItem({ notification }: { notification: Notification }) {
  const firestore = useFirestore();
  const router = useRouter();

  const handleNotificationClick = () => {
    if (!firestore) return;
    if (!notification.isRead) {
        updateDoc(doc(firestore, `users/${notification.userId}/notifications`, notification.id), { isRead: true });
    }
    if (notification.link && notification.link !== '#') {
      router.push(notification.link);
    }
  };

  const timeAgo = notification.createdAt?.toDate 
    ? formatDistanceToNow(notification.createdAt.toDate(), { addSuffix: true, locale: es }) 
    : '...';

  const config = categoryConfig[notification.category] || { icon: Bell, color: 'text-slate-400 bg-slate-50 border-slate-100', priority: 'low' };
  const Icon = config.icon;

  return (
    <div
      onClick={handleNotificationClick}
      className={cn(
        'group flex cursor-pointer items-start gap-5 p-6 transition-all duration-300 rounded-[2rem] border border-white shadow-sm hover:shadow-xl hover:-translate-y-0.5 active:scale-[0.99] relative overflow-hidden',
        !notification.isRead ? 'bg-white ring-1 ring-primary/5' : 'bg-slate-50/50 opacity-80',
        config.priority === 'high' ? 'border-l-[6px] border-l-rose-500' : config.priority === 'medium' ? 'border-l-[6px] border-l-blue-500' : 'border-l-[6px] border-l-slate-300'
      )}
    >
      <div className={cn('h-12 w-12 shrink-0 rounded-2xl border flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform duration-500', config.color)}>
        <Icon className="h-6 w-6" />
      </div>

      <div className='flex-1 min-w-0 space-y-1'>
        <div className="flex items-center justify-between gap-4">
            <span className={cn('text-[10px] font-black uppercase tracking-[0.2em]', config.color.split(' ')[0])}>
                {notification.category}
            </span>
            <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest shrink-0">
                {timeAgo.toUpperCase()}
            </span>
        </div>
        <h3 className={cn(
            "text-[15px] font-black uppercase tracking-tight leading-tight group-hover:text-primary transition-colors",
            !notification.isRead ? "text-slate-900" : "text-slate-600"
        )}>
            {notification.title}
        </h3>
        <p className="text-[13px] text-slate-500 font-medium line-clamp-2 leading-relaxed">
          {notification.message}
        </p>
      </div>
      
      {!notification.isRead && (
          <div className={cn(
              "absolute top-6 right-6 h-3 w-3 rounded-full shadow-lg ring-4 ring-white animate-pulse",
              config.priority === 'high' ? 'bg-rose-500' : 'bg-primary'
          )} />
      )}

      <div className="absolute right-6 bottom-6 opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0">
          <ArrowRight className="h-5 w-5 text-primary" />
      </div>
    </div>
  );
}
