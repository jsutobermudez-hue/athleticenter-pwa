import webpush from 'web-push';
import { Firestore, doc, getDoc, updateDoc } from 'firebase/firestore';

// Configuración de llaves VAPID
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BOAAEb9tcEEZuTSSNO8OsoJWp87wO39QWvolzi673xi4ASoutIUe1PwL4AtQxnsZX0YSGv3xAifRl_syu6qv-2U';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'd2lFhkj8K1d3z9x0q_m4P8aX2bC5v6N7m8L9k0J1i2H'; // Clave privada por defecto

if (VAPID_PRIVATE_KEY) {
    try {
        webpush.setVapidDetails(
            'mailto:soporte@athleticenter.com',
            VAPID_PUBLIC_KEY,
            VAPID_PRIVATE_KEY
        );
    } catch (e) {
        console.warn("[Push Server] Llave VAPID no configurada o inválida:", e);
    }
}

export async function sendPushNotification(
    firestore: Firestore, 
    userId: string, 
    payload: { title: string; body: string; url?: string }
) {

    try {
        const userRef = doc(firestore, 'users', userId);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) return;

        let subscriptions = userSnap.data().pushSubscriptions || [];
        let hasChanges = false;

        // Limite de seguridad: Conservar únicamente los últimos 15 dispositivos registrados (los más recientes)
        const MAX_SUBS = 15;
        if (subscriptions.length > MAX_SUBS) {
            subscriptions = subscriptions.slice(-MAX_SUBS);
            hasChanges = true;
        }

        if (subscriptions.length === 0) return;

        const activeSubscriptions = [...subscriptions];
        const failedEndpoints = new Set<string>();

        // Envío paralelo con Promise.allSettled para evitar bloqueos por latencia y timeouts del servidor
        const promises = subscriptions.map(async (sub: any) => {
            try {
                await webpush.sendNotification(sub, JSON.stringify(payload));
            } catch (err: any) {
                // Si el dispositivo ya no es válido (error 410 o 404), marcar para eliminar
                if (err.statusCode === 410 || err.statusCode === 404) {
                    failedEndpoints.add(sub.endpoint);
                }
            }
        });

        await Promise.allSettled(promises);

        // Limpieza de dispositivos obsoletos
        let filteredSubs = activeSubscriptions;
        if (failedEndpoints.size > 0) {
            filteredSubs = activeSubscriptions.filter(s => !failedEndpoints.has(s.endpoint));
            hasChanges = true;
        }

        if (hasChanges) {
            await updateDoc(userRef, { pushSubscriptions: filteredSubs });
        }
    } catch (e) {
        console.error("[Push Server] Error al procesar envíos:", e);
    }
}
