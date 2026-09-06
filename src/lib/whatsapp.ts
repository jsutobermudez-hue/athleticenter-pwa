
'use client';

/**
 * MOTOR DE WHATSAPP v4.0 (MODO RESILIENCIA TOTAL)
 * Se ha desacoplado la dependencia de Twilio para permitir el lanzamiento de la terminal.
 * Los mensajes se registrarán en la consola del navegador/servidor para fines de auditoría.
 */
export async function sendWhatsAppMessage(phoneNumber: string, message: string) {
    try {
        const { sendBackgroundWhatsAppMessage } = await import('./whatsapp-gateway');
        const res = await sendBackgroundWhatsAppMessage({
            phone: phoneNumber,
            message: message
        });
        
        return { 
            success: res.success, 
            data: { 
                messageId: res.messageId || `sent_at_${Date.now()}`,
                status: res.success ? 'sent' : 'failed'
            } 
        };
    } catch (error) {
        console.error('[WhatsApp] Fallo en el envío de mensaje:', error);
        return { 
            success: false, 
            data: { 
                status: 'error'
            } 
        };
    }
}
