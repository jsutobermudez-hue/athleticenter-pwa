'use client';

import React from 'react';
import Link from 'next/link';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Bell, Loader2 } from 'lucide-react';
import {
  useCollection,
  useFirestore,
  useMemoFirebase,
  useUser,
} from '@/firebase';
import { collection, orderBy, query, limit } from 'firebase/firestore';
import type { Notification } from '@/lib/definitions';
import { ScrollArea } from '../ui/scroll-area';
import { NotificationItem } from '../notifications/NotificationItem';

export function NotificationsPopover() {
  const { user } = useUser();
  const firestore = useFirestore();

  const notificationsQuery = useMemoFirebase(
    () =>
      user && firestore
        ? query(
            collection(firestore, `users/${user.uid}/notifications`),
            orderBy('createdAt', 'desc'),
            limit(20) // Obligatorio para reglas de seguridad
          )
        : null,
    [user, firestore]
  );

  const { data: notifications, isLoading } = useCollection<Notification>(notificationsQuery);
  const unreadCount = React.useMemo(() => notifications?.filter(n => !n.isRead).length || 0, [notifications]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="relative h-9 w-9">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-xs font-bold text-destructive-foreground">
              {unreadCount}
            </span>
          )}
          <span className="sr-only">Abrir notificaciones</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-2" align="end">
        <div className="space-y-2">
          <div className="flex items-center justify-between px-2">
            <h4 className="font-medium leading-none">Notificaciones</h4>
            <Button variant="link" size="sm" asChild className="h-auto p-0 text-xs">
              <Link href="/dashboard/notifications">Ver todas</Link>
            </Button>
          </div>
          <ScrollArea className="h-80">
            <div className="p-2">
              {isLoading ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : notifications && notifications.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {notifications.slice(0, 10).map((n) => (
                    <NotificationItem key={n.id} notification={n} />
                  ))}
                </div>
              ) : (
                <div className="flex h-40 items-center justify-center">
                  <p className="text-center text-sm text-muted-foreground">
                    No tienes notificaciones.
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </PopoverContent>
    </Popover>
  );
}