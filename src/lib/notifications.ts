
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
  salespersonId?: string;
  customerId?: string;
}

/**
 * MOTOR DE NOTIFICACIONES v300.0.0
 * Resiliente y Completo: Garantiza que el Superadministrador reciba una notificación
 * por TODAS las acciones realizadas en la app por cualquier usuario, y que cada rol
 * (vendedor, cliente, depósito, gerencia) reciba los avisos correspondientes.
 */
export async function createAppNotifications(
  firestore: Firestore,
  params: NotificationParams
): Promise<void> {
  const { 
    title, 
    message, 
    category, 
    link, 
    initiatorId, 
    userIds = [], 
    roles = [], 
    broadcast = false,
    salespersonId,
    customerId
  } = params;

  const targetUserIds = new Set<string>();
  const superadminIds = new Set<string>();
  
  try {
    const userRef = collection(firestore, 'users');
    
    // 1. GARANTÍA SUPERADMINISTRADOR: Descubrir e incluir siempre a todos los superadministradores
    try {
      const sq = query(userRef, where('role', '==', 'superadmin'), limit(20));
      const sSnap = await getDocs(sq);
      sSnap.forEach(d => {
        targetUserIds.add(d.id);
        superadminIds.add(d.id);
      });
    } catch (err) {
      console.warn("[Notifications] Error al buscar superadministradores:", err);
    }

    if (broadcast) {
      const q = query(userRef, where('role', 'in', ['admin', 'gerencia', 'superadmin', 'ventas', 'deposito', 'cliente']), limit(500));
      const snap = await getDocs(q);
      snap.forEach(d => targetUserIds.add(d.id));
    } else {
      if (roles && roles.length > 0) {
        const q = query(userRef, where('role', 'in', roles), limit(500));
        const snap = await getDocs(q);
        snap.forEach(d => targetUserIds.add(d.id));
      }
    }

    // 2. Destinatarios explícitos (Vendedores, Clientes, etc.)
    userIds.forEach(id => { if (id) targetUserIds.add(id); });
    if (salespersonId) targetUserIds.add(salespersonId);

    // 3. Resolución automática de usuarios del Cliente
    if (customerId) {
      targetUserIds.add(customerId);
      try {
        const cq = query(userRef, where('associatedCustomerId', '==', customerId), limit(20));
        const cSnap = await getDocs(cq);
        cSnap.forEach(d => targetUserIds.add(d.id));
      } catch (err) {
        console.warn("[Notifications] Error al asociar usuarios de cliente:", err);
      }
    }
  } catch (e) {
    console.warn("[Notifications] Error en descubrimiento de usuarios:", e);
  }

  // 4. Filtrado del iniciador: Se elimina el iniciador ÚNICAMENTE si no es Superadministrador.
  // Los superadministradores conservan siempre la notificación en su bandeja para fines de auditoría completa.
  if (initiatorId && !superadminIds.has(initiatorId)) {
    targetUserIds.delete(initiatorId);
  }

  const finalTargetIds = Array.from(targetUserIds);
  if (finalTargetIds.length === 0) return;

  const batch = writeBatch(firestore);
  const timestamp = serverTimestamp();

  finalTargetIds.forEach(userId => {
    const inboxRef = doc(collection(firestore, `users/${userId}/notifications`));
    batch.set(inboxRef, { 
      title, 
      message, 
      category, 
      link: link || '#', 
      isRead: false, 
      createdAt: timestamp, 
      userId 
    });
  });

  try {
    await batch.commit();
    // LOG DE WHATSAPP (Simulado para auditoría interna)
    await sendWhatsAppMessage('LOG_SYSTEM', `Notificación emitida: ${title}`);
    
    // Disparar notificaciones Push nativas en segundo plano (WebPush)
    try {
      const { triggerPushNotificationAction } = await import('@/app/actions');
      await triggerPushNotificationAction(finalTargetIds, {
        title,
        body: message,
        url: link || '#'
      });
    } catch (pushErr) {
      console.warn("[Notifications] Error al invocar la acción de envío push:", pushErr);
    }
  } catch (e) {
    console.error("[Notifications] Fallo crítico al guardar notificaciones en base de datos:", e);
  }
}
