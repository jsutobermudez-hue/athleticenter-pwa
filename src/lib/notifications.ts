
'use client';

import { collection, writeBatch, doc, serverTimestamp, type Firestore, query, where, limit, getDocs } from 'firebase/firestore';
import type { User, NotificationCategory } from './definitions';
import { sendWhatsAppMessage } from './whatsapp';

interface NotificationParams {
  title: string;
  message: string;
  category: NotificationCategory;
  link?: string;
  initiatorId: string;
  userIds?: (string | undefined)[];
  roles?: User['role'][];
  broadcast?: boolean;
}

/**
 * MOTOR DE NOTIFICACIONES v175.0.0
 * Resiliente: Emite notificaciones internas en tiempo real y registra logs de WhatsApp sin dependencias externas.
 */
export async function createAppNotifications(
  firestore: Firestore,
  params: NotificationParams
): Promise<void> {
  const { title, message, category, link, initiatorId, userIds = [], roles = [], broadcast = false } = params;
  const targetUserIds = new Set<string>();
  
  try {
    const userRef = collection(firestore, 'users');
    
    if (broadcast) {
        const q = query(userRef, where('role', 'in', ['admin', 'gerencia', 'superadmin']), limit(25));
        const snap = await getDocs(q);
        snap.forEach(d => targetUserIds.add(d.id));
    } else if (roles && roles.length > 0) {
        const q = query(userRef, where('role', 'in', roles), limit(25));
        const snap = await getDocs(q);
        snap.forEach(d => targetUserIds.add(d.id));
    }

    userIds.forEach(id => { if (id) targetUserIds.add(id); });
  } catch (e) {
    console.warn("[Notifications] Error en descubrimiento de usuarios.");
  }

  if (initiatorId) targetUserIds.delete(initiatorId);
  const finalTargetIds = Array.from(targetUserIds);
  if (finalTargetIds.length === 0) return;

  const batch = writeBatch(firestore);
  const timestamp = serverTimestamp();

  finalTargetIds.forEach(userId => {
    const inboxRef = doc(collection(firestore, `users/${userId}/notifications`));
    batch.set(inboxRef, { title, message, category, link: link || '#', isRead: false, createdAt: timestamp, userId });
  });

  try {
    await batch.commit();
    // LOG DE WHATSAPP (Simulado para publicación exitosa)
    await sendWhatsAppMessage('LOG_SYSTEM', `Notificación emitida: ${title}`);
  } catch (e) {
    console.error("[Notifications] Fallo crítico al guardar en base de datos.");
  }
}
