'use server';

import { sendPasswordResetEmail } from 'firebase/auth';
import { initializeFirebaseServer } from '@/firebase/server-init';
import { aiAnalystFlow } from '@/ai/flows/ai-analyst-flow';
import { generateWhatsAppReminder } from '@/ai/flows/whatsapp-credit-reminder';
import { generateWhatsAppStatusUpdate } from '@/ai/flows/whatsapp-status-update';

/**
 * ACCIONES DEL SERVIDOR v13.1 - BLINDAJE DE PRODUCCIÓN
 * Saneado: Se aseguran todas las exportaciones críticas para evitar fallos de compilación.
 */

export async function handlePasswordReset(email: string) {
    try {
        const { auth } = initializeFirebaseServer();
        await sendPasswordResetEmail(auth, email);
        return { success: true, data: 'Correo de restablecimiento enviado.' };
    } catch (error: any) {
        return { success: false, error: 'No se pudo conectar con el servicio de correos.' };
    }
}

export async function runAIAnalyst(input: any) {
    try {
        const result = await aiAnalystFlow(input);
        return { success: true, data: result };
    } catch (e: any) {
        console.error("[Action Error] AI Analyst failed:", e.message);
        return { 
            success: false, 
            error: "Error de conexión con el motor neuronal. Por favor verifica la API Key." 
        };
    }
}

export async function handleWhatsAppReminder(input: any) {
    try {
        const result = await generateWhatsAppReminder(input);
        return { success: true, data: result };
    } catch (e: any) {
        return { success: false, error: "Error al generar el recordatorio." };
    }
}

export async function handleWhatsAppStatusUpdate(input: any) {
    try {
        const result = await generateWhatsAppStatusUpdate(input);
        return { success: true, data: result };
    } catch (e: any) {
        return { success: false, error: "Error al generar la actualización de estado." };
    }
}
