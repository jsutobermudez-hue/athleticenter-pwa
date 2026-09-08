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

    const instanceId = process.env.WHATSAPP_GATEWAY_INSTANCE_ID || 'instance189931';
    const apiKey = process.env.WHATSAPP_GATEWAY_API_KEY || 'ze6y0kdj1j7n0ekw';
    const provider = process.env.WHATSAPP_GATEWAY_PROVIDER || 'ultramsg';
    const rawGatewayUrl = process.env.WHATSAPP_GATEWAY_URL || `https://api.ultramsg.com/${instanceId}`;

    console.log(`[WhatsApp Gateway API] Intentando despacho a +${cleanPhone} (Orden: #${orderId || 'N/A'})`);

    // TIER 1: INTENTAR API CLOUD (ULTRAMSG / PERSONALIZADO)
    if (provider === 'ultramsg' || rawGatewayUrl.includes('ultramsg')) {
      const isDocument = Boolean(media?.base64);
      const targetEndpoint = isDocument 
        ? `https://api.ultramsg.com/${instanceId}/messages/document`
        : `https://api.ultramsg.com/${instanceId}/messages/chat`;

      const params = new URLSearchParams();
      params.append('token', apiKey);
      params.append('to', cleanPhone);

      if (isDocument) {
        params.append('document', media.base64);
        params.append('filename', media.filename || 'Recibo_Oficial_Athleticenter.pdf');
        params.append('caption', text || '');
      } else {
        params.append('body', text || '');
      }

      try {
        const externalRes = await fetch(targetEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
          signal: AbortSignal.timeout(8000)
        });

        if (externalRes.ok) {
          const data = await externalRes.json().catch(() => ({}));
          if (data.id || data.sent === 'true' || data.success) {
            console.log(`[WhatsApp Gateway UltraMsg] ✅ Mensaje despachado con éxito:`, data);
            return NextResponse.json({ success: true, messageId: data.id || data.messageId || 'ULTRAMSG_OK', provider: 'ultramsg' });
          } else {
            console.warn(`[WhatsApp Gateway UltraMsg] Respuesta de UltraMsg indicó error:`, data);
          }
        } else {
          const errText = await externalRes.text().catch(() => '');
          console.warn(`[WhatsApp Gateway UltraMsg] Servidor UltraMsg no disponible (${externalRes.status}):`, errText);
        }
      } catch (cloudErr: any) {
        console.warn(`[WhatsApp Gateway UltraMsg] Fallo de conexión con UltraMsg:`, cloudErr?.message || cloudErr);
      }
    }

    // TIER 2: FALLBACK A SERVIDOR LOCAL DE DESARROLLO (http://localhost:3001/api/send)
    try {
      console.log(`[WhatsApp Gateway Local] Intentando servidor local de WhatsApp en http://localhost:3001/api/send...`);
      const localRes = await fetch('http://localhost:3001/api/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer local-dev-key'
        },
        body: JSON.stringify({
          number: cleanPhone,
          text,
          media,
          orderId
        }),
        signal: AbortSignal.timeout(4000)
      });

      if (localRes.ok) {
        const localData = await localRes.json().catch(() => ({}));
        if (localData.success) {
          console.log(`[WhatsApp Gateway Local] ✅ Mensaje despachado mediante servidor local de WhatsApp:`, localData);
          return NextResponse.json({ success: true, messageId: localData.messageId || 'LOCAL_OK', provider: 'local' });
        }
      }
    } catch (localErr) {
      console.warn(`[WhatsApp Gateway Local] Servidor local http://localhost:3001 no activo o inalcanzable.`);
    }

    // TIER 3: NINGÚN GATEWAY AUTOMÁTICO CONECTADO -> NOTIFICAR FALLO PARA USAR ENLACE WA.ME CON 1-CLIC
    const encodedText = encodeURIComponent(text || '');
    const fallbackUrl = `https://wa.me/${cleanPhone}?text=${encodedText}`;

    console.warn(`[WhatsApp Gateway] Ningún servidor Gateway automático está conectado. Notificando fallback wa.me para +${cleanPhone}`);
    return NextResponse.json({
      success: false,
      error: 'Servidor Gateway no disponible. Utilizando enlace de WhatsApp directo.',
      fallbackUrl
    });

  } catch (error: any) {
    console.error(`[WhatsApp Gateway API] Error interno en gateway route:`, error);
    return NextResponse.json({ success: false, error: error?.message || 'Error interno del servidor Gateway' }, { status: 500 });
  }
}
