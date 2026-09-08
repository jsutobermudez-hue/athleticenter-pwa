/**
 * ATHLETICENTER PRO - DISPATCHER UNIVERSAL DE WHATSAPP EN SEGUNDO PLANO v1.0
 * Conecta el 100% de las acciones de WhatsApp en la app (Cotizaciones, Pedidos, Cobranza, Despacho, CRM, Marketing)
 * al motor Gateway silencioso en segundo plano (0 ventanas emergentes, 0 clics manuales).
 */

import { sendBackgroundWhatsAppMessage } from './whatsapp-gateway';

export interface UniversalWhatsAppParams {
  phone?: string;
  message: string;
  pdfBase64?: string;
  fileName?: string;
  orderId?: string;
  quoteId?: string;
  module?: 'billing' | 'quotes' | 'dispatch' | 'orders' | 'clients' | 'marketing' | 'treasury';
}

/**
 * Función Universal para despachar mensajes de WhatsApp en segundo plano desde cualquier lugar de la app
 */
export async function dispatchUniversalWhatsApp({
  phone,
  message,
  pdfBase64,
  fileName,
  orderId,
  quoteId,
  module = 'orders'
}: UniversalWhatsAppParams): Promise<{ success: boolean; fallbackUrl?: string }> {
  if (!phone) {
    console.warn(`[WhatsApp Universal] Intento de envío sin teléfono en módulo ${module}`);
    return { success: false };
  }

  const cleanPhone = phone.replace(/[^\d]/g, '');
  const encodedText = encodeURIComponent(message);
  const fallbackUrl = cleanPhone 
    ? `https://wa.me/${cleanPhone}?text=${encodedText}` 
    : `https://wa.me/?text=${encodedText}`;

  // Intentar despacho 100% silencioso e invisible de fondo a través del Gateway
  try {
    const res = await sendBackgroundWhatsAppMessage({
      phone: cleanPhone,
      message,
      pdfBase64,
      fileName,
      orderId: orderId || quoteId
    });

    if (res.success) {
      console.log(`[WhatsApp Universal] ✅ Despacho automático de fondo exitoso en módulo ${module}`);
      return { success: true, fallbackUrl };
    } else {
      console.warn(`[WhatsApp Universal] Servidores Gateway en segundo plano no disponibles (${res.error || 'Desconectado'}). Activando fallback directo a WhatsApp Web...`);
      if (typeof window !== 'undefined') {
        window.open(fallbackUrl, '_blank');
      }
      return { success: false, fallbackUrl };
    }
  } catch (err) {
    console.warn(`[WhatsApp Universal] Aviso en gateway de fondo (módulo ${module}):`, err);
    if (typeof window !== 'undefined') {
      window.open(fallbackUrl, '_blank');
    }
    return { success: false, fallbackUrl };
  }
}
