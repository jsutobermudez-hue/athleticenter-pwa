'use client';

/**
 * Envío de WhatsApp desde botones de la interfaz: 100% automático (sin abrir pestañas),
 * con aviso en pantalla del resultado. Si el gateway no está disponible, el dispatcher
 * universal abre WhatsApp Web como último recurso.
 */
import { dispatchUniversalWhatsApp, type UniversalWhatsAppParams } from './whatsapp-universal';
import { formatVenezuelaPhoneE164 } from './whatsapp-gateway';
import { toast } from '@/hooks/use-toast';

export async function sendWhatsAppWithFeedback(
    params: Omit<UniversalWhatsAppParams, 'phone'> & { phone?: string },
): Promise<boolean> {
    const phone = formatVenezuelaPhoneE164(params.phone || '');
    if (!phone) {
        toast({ variant: 'destructive', title: 'Sin teléfono', description: 'Este cliente no tiene un número de WhatsApp registrado.' });
        return false;
    }
    try {
        const res = await dispatchUniversalWhatsApp({ ...params, phone });
        if (res.success) {
            toast({ title: 'WhatsApp enviado', description: 'El mensaje se envió automáticamente al cliente.' });
            return true;
        }
        toast({ variant: 'destructive', title: 'No se pudo enviar automáticamente', description: 'Se abrió WhatsApp como respaldo.' });
        return false;
    } catch {
        toast({ variant: 'destructive', title: 'Error de envío', description: 'No se pudo contactar el servidor de WhatsApp.' });
        return false;
    }
}
