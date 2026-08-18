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
  const processedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!firestore || !user) return;

    // Pedir permiso nativo del navegador si está en estado default
    if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'default') {
      window.Notification.requestPermission().catch(() => {});
    }

    // Escuchamos las notificaciones en tiempo real de la subcolección del usuario
    const q = query(
      collection(firestore, `users/${user.uid}/notifications`),
      limit(25)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          const id = change.doc.id;

          // Si es una notificación no leída que no se ha mostrado en esta sesión de escucha
          if (!processedIdsRef.current.has(id) && !data.isRead) {
            processedIdsRef.current.add(id);
            
            // 1. Mostrar Toast de UI (Shadcn Banner)
            toast({
              title: `🔔 ${data.title}`,
              description: data.message,
              duration: 10000,
              action: data.link && data.link !== '#' ? (
                <button 
                  className="text-[10px] font-black uppercase tracking-widest bg-primary text-white px-3 py-1 rounded-lg hover:bg-primary/90 transition-colors"
                  onClick={() => router.push(data.link)}
                >
                  VER
                </button>
              ) : undefined
            });

            // 2. Disparar Notificación Nativa del Navegador / Sistema
            try {
              if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted') {
                new window.Notification(data.title, {
                  body: data.message,
                  icon: '/icons/icon-192x192.png',
                  tag: id,
                  requireInteraction: false
                });
              }
            } catch (e) {
              console.warn("[Notifications] Error en notificación nativa de primer plano:", e);
            }
          }
        }
      });
    }, (error) => {
      console.warn("[Notifications] Error en suscripción de notificaciones:", error);
    });

    return () => unsubscribe();
  }, [firestore, user, toast, router]);

  return null;
}
