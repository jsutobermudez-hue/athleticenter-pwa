'use server';

import { sendPasswordResetEmail } from 'firebase/auth';
import { initializeFirebaseServer, ensureServerAuth } from '@/firebase/server-init';
import { aiAnalystFlow } from '@/ai/flows/ai-analyst-flow';
import { generateWhatsAppReminder } from '@/ai/flows/whatsapp-credit-reminder';
import { generateWhatsAppStatusUpdate } from '@/ai/flows/whatsapp-status-update';
import { executeBcvRateSync } from '@/services/agents';

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
        await ensureServerAuth();
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

export async function syncBcvRateAction() {
    try {
        await ensureServerAuth();
        const result = await executeBcvRateSync();
        return result;
    } catch (e: any) {
        console.error("[Action Error] BCV Sync failed:", e.message);
        return { success: false, error: e.message };
    }
}


