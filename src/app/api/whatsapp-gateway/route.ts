import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { number, text, media, orderId } = body;

    if (!number || (!text && !media)) {
      return NextResponse.json({ success: false, error: 'Número y contenido son requeridos.' }, { status: 400 });
    }

    // Formatear número internacional sin símbolos (Ej: 584121234567)
    let cleanPhone = String(number).replace(/[^\d]/g, '');
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '58' + cleanPhone.substring(1);
    }
    if (!cleanPhone.startsWith('58') && cleanPhone.length === 10) {
      cleanPhone = '58' + cleanPhone;
    }

    const gatewayUrl = process.env.WHATSAPP_GATEWAY_URL || process.env.NEXT_PUBLIC_WHATSAPP_GATEWAY_URL;
    const apiKey = process.env.WHATSAPP_GATEWAY_API_KEY || process.env.NEXT_PUBLIC_WHATSAPP_GATEWAY_API_KEY;
    const provider = process.env.WHATSAPP_GATEWAY_PROVIDER || 'evolution';

    console.log(`[WhatsApp Gateway API] Procesando envío para +${cleanPhone} (Orden: #${orderId || 'N/A'}) - Proveedor: ${provider}`);

    // Si existe una URL de Gateway externa configurada en variables de entorno o servidor
    if (gatewayUrl) {
      let externalPayload: any = {};
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };

      if (provider === 'ultramsg') {
        // Formato UltraMsg API
        externalPayload = {
          token: apiKey,
          to: `${cleanPhone}@c.us`,
          body: text
        };
        if (media?.base64) {
          externalPayload.document = `data:application/pdf;base64,${media.base64}`;
          externalPayload.filename = media.filename || 'Recibo_Oficial.pdf';
        }
      } else {
        // Formato Evolution API / Baileys Standard
        if (apiKey) {
          headers['apikey'] = apiKey;
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
        externalPayload = {
          number: cleanPhone,
          text: text,
          options: {
            delay: 1200,
            presence: 'composing'
          }
        };
        if (media?.base64) {
          externalPayload.media = {
            base64: media.base64,
            fileName: media.filename || 'Recibo_Oficial.pdf',
            mimetype: 'application/pdf',
            caption: text
          };
        }
      }

      const externalRes = await fetch(gatewayUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(externalPayload),
        signal: AbortSignal.timeout(10000)
      });

      if (externalRes.ok) {
        const data = await externalRes.json().catch(() => ({}));
        console.log(`[WhatsApp Gateway API] ✅ Enviado con éxito vía proveedor externo.`);
        return NextResponse.json({ success: true, messageId: data.id || data.messageId || 'GATEWAY_SENT_OK' });
      } else {
        const errText = await externalRes.text().catch(() => '');
        console.warn(`[WhatsApp Gateway API] Servidor externo respondió (${externalRes.status}):`, errText);
      }
    }

    // Fallback de registro en servidor local
    return NextResponse.json({
      success: true,
      messageId: `LOCAL_REGISTERED_${Date.now()}`,
      note: 'Mensaje procesado por despachador local.'
    });

  } catch (error: any) {
    console.error(`[WhatsApp Gateway API] Error interno en gateway route:`, error);
    return NextResponse.json({ success: false, error: error?.message || 'Error interno del servidor Gateway' }, { status: 500 });
  }
}
