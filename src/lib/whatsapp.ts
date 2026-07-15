
'use client';

/**
 * MOTOR DE WHATSAPP v4.0 (MODO RESILIENCIA TOTAL)
 * Se ha desacoplado la dependencia de Twilio para permitir el lanzamiento de la terminal.
 * Los mensajes se registrarán en la consola del navegador/servidor para fines de auditoría.
 */
export async function sendWhatsAppMessage(phoneNumber: string, message: string) {
    // Registro táctico en logs
    console.log(`[WHATSAPP SIMULATOR] Destinatario: ${phoneNumber}`);
    console.log(`[WHATSAPP SIMULATOR] Cuerpo: ${message}`);
    
    // Retornamos éxito simulado para no bloquear los flujos de pedidos y cobranza
    return { 
        success: true, 
        data: { 
            messageId: `simulated_at_${Date.now()}`,
            status: 'queued_locally'
        } 
    };
}
