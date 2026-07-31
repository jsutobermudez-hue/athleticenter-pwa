import webpush from 'web-push';
import { Firestore, doc, getDoc, updateDoc } from 'firebase/firestore';

// Configuración de llaves VAPID
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BOAAEb9tcEEZuTSSNO8OsoJWp87wO39QWvolzi673xi4ASoutIUe1PwL4AtQxnsZX0YSGv3xAifRl_syu6qv-2U';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY; // Clave secreta en el servidor

if (VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        'mailto:soporte@athleticenter.com',
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
    );
}

export async function sendPushNotification(
    firestore: Firestore, 
    userId: string, 
    payload: { title: string; body: string; url?: string }
) {
    if (!VAPID_PRIVATE_KEY) {
        console.warn("[Push Server] Falta la VAPID_PRIVATE_KEY. Envío de fondo omitido.");
        return;
    }

    try {
        const userRef = doc(firestore, 'users', userId);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) return;

        const subscriptions = userSnap.data().pushSubscriptions || [];
        const activeSubscriptions = [...subscriptions];
        let hasChanges = false;

        for (const sub of subscriptions) {
            try {
                await webpush.sendNotification(sub, JSON.stringify(payload));
            } catch (err: any) {
                // Si el dispositivo ya no es válido (ej. desinstaló o revocó permisos), da error 410 o 404
                if (err.statusCode === 410 || err.statusCode === 404) {
                    const idx = activeSubscriptions.findIndex(s => s.endpoint === sub.endpoint);
                    if (idx !== -1) {
                        activeSubscriptions.splice(idx, 1);
                        hasChanges = true;
                    }
                }
            }
        }

        // Limpieza de dispositivos obsoletos para optimizar Firestore
        if (hasChanges) {
            await updateDoc(userRef, { pushSubscriptions: activeSubscriptions });
        }
    } catch (e) {
        console.error("[Push Server] Error al procesar envíos:", e);
    }
}
