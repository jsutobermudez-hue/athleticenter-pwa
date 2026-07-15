'use client';

import { useEffect, useRef } from 'react';
import { useFirestore, useUser } from '@/firebase';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';

/**
 * MOTOR DE ESCUCHA TÁCTICA v1.5.0
 * Saneado: Implementa defensas contra errores de API Notification en entornos restringidos.
 * Funcionalidad: Captura notificaciones en tiempo real mientras el usuario navega (Foreground).
 */
export function NotificationToastListener() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const router = useRouter();
  const lastProcessedId = useRef<string | null>(null);
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (!firestore || !user) return;

    // Escuchamos solo las últimas 5 notificaciones no leídas
    const q = query(
      collection(firestore, `users/${user.uid}/notifications`),
      where('isRead', '==', false),
      orderBy('createdAt', 'desc'),
      limit(5)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      // En la primera carga, solo guardamos el ID de la más reciente para no disparar alertas antiguas
      if (isFirstRun.current) {
        if (!snapshot.empty) lastProcessedId.current = snapshot.docs[0].id;
        isFirstRun.current = false;
        return;
      }

      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          const id = change.doc.id;

          // Evitar procesar la misma notificación múltiples veces
          if (id !== lastProcessedId.current) {
            lastProcessedId.current = id;
            
            // 1. Mostrar Toast de UI (Shadcn)
            toast({
              title: `🔔 ${data.title}`,
              description: data.message,
              action: data.link ? (
                <button 
                    className="text-[10px] font-black uppercase tracking-widest bg-primary text-white px-3 py-1 rounded-lg hover:bg-primary/90 transition-colors"
                    onClick={() => router.push(data.link)}
                >
                    VER
                </button>
              ) : undefined
            });

            // 2. Intentar disparar notificación nativa del sistema si el permiso existe
            try {
                const hasNotificationSupport = typeof window !== 'undefined' && 'Notification' in window;
                if (hasNotificationSupport && window.Notification.permission === 'granted') {
                    new window.Notification(data.title, {
                        body: data.message,
                        icon: '/icons/icon-192x192.png',
                        tag: 'foreground-alert'
                    });
                }
            } catch (e) {
                // Failsafe: Algunos navegadores bloquean la construcción directa fuera de un evento de usuario
                console.warn("[Notifications] Bloqueo de API nativa en foreground.");
            }
          }
        }
      });
    }, (error) => {
        console.warn("[Notifications] Suscripción de escucha limitada por red o permisos.");
    });

    return () => unsubscribe();
  }, [firestore, user, toast, router]);

  return null;
}
