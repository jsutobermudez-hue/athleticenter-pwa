
'use client';

import { doc, updateDoc, arrayUnion, getDoc, serverTimestamp, type Firestore } from 'firebase/firestore';

/**
 * MOTOR DE PWA Y NOTIFICACIONES v310.0.0
 * Saneado: Sincronización conservadora con guardas de ancho de banda.
 * Solo actualiza la base de datos si la suscripción es estrictamente nueva para evitar Code 8 (Resource Exhausted).
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BOAAEb9tcEEZuTSSNO8OsoJWp87wO39QWvolzi673xi4ASoutIUe1PwL4AtQxnsZX0YSGv3xAifRl_syu6qv-2U'; 
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function checkServiceWorkerStatus() {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';
    try {
        const registration = await navigator.serviceWorker.getRegistration();
        return (registration && registration.active) ? 'active' : 'missing';
    } catch (e) {
        return 'missing';
    }
}

export async function getCurrentPushSubscription() {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
    try {
        const registration = await navigator.serviceWorker.ready;
        return await registration.pushManager.getSubscription();
    } catch (e) {
        return null;
    }
}

export async function initializePushNotifications(userId: string, firestore: Firestore) {
  if (typeof window === 'undefined') return;

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn("[Push] El navegador no soporta notificaciones nativas.");
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js');
    await navigator.serviceWorker.ready;
    
    // Solo pedir permisos si es necesario
    if (window.Notification && window.Notification.permission === 'default') {
        await window.Notification.requestPermission();
    }

    if (window.Notification.permission === 'granted') {
        await subscribeUserToPush(registration, userId, firestore);
    }
  } catch (error: any) {
    console.warn("[Push] Inicialización diferida por red o estado de registro.");
    throw error; // Lanzar para que el layout maneje el reintento
  }
}

async function subscribeUserToPush(registration: ServiceWorkerRegistration, userId: string, firestore: Firestore) {
  try {
    const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    let subscription = await registration.pushManager.getSubscription();
    
    if (!subscription) {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey
        });
    }
    
    if (subscription) {
        await saveSubscription(subscription, userId, firestore);
    }
  } catch (error) {
    console.warn("[Push] Fallo al negociar suscripción en este ciclo.");
  }
}

async function saveSubscription(subscription: PushSubscription, userId: string, firestore: Firestore) {
  const userDocRef = doc(firestore, 'users', userId);
  const subscriptionObject = JSON.parse(JSON.stringify(subscription));
  
  try {
      // Optimizamos: Una sola lectura para verificar existencia antes de intentar escribir
      const snap = await getDoc(userDocRef);
      if (snap.exists()) {
          const userData = snap.data();
          const currentSubs = userData.pushSubscriptions || [];
          
          // COMPARACIÓN PROFUNDA: El endpoint es la clave de unicidad absoluta
          const exists = currentSubs.some((s: any) => s.endpoint === subscriptionObject.endpoint);
          
          if (!exists) {
              await updateDoc(userDocRef, {
                pushSubscriptions: arrayUnion(subscriptionObject),
                lastPushUpdate: serverTimestamp() // Auditamos la actualización
              });
              console.log("[Push] Nuevo dispositivo vinculado a la red de Athleticenter.");
          }
      }
  } catch (error: any) {
    if (error.code === 'resource-exhausted') {
        console.error("[Push] Límite de ancho de banda alcanzado en Firestore. Escritura abortada.");
    } else {
        console.warn("[Push] Fallo de persistencia silencioso:", error.message);
    }
  }
}
