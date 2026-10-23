import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { number, text, imageUrl, media, orderId } = body;

    if (!number || (!text && !media && !imageUrl)) {
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

    // TIER 1: SERVIDOR CENTRAL 24/7 EN SAO PAULO (http://35.199.85.127:3001/api/send)
    try {
      console.log(`[WhatsApp Gateway Sao Paulo] Intentando servidor principal en São Paulo 24/7...`);
      const spRes = await fetch('http://35.199.85.127:3001/api/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer local-dev-key'
        },
        body: JSON.stringify({
          number: cleanPhone,
          text,
          imageUrl,
          media,
          orderId
        }),
        signal: AbortSignal.timeout(8000)
      });

      if (spRes.ok) {
        const spData = await spRes.json().catch(() => ({}));
        if (spData.success) {
          console.log(`[WhatsApp Gateway Sao Paulo] ✅ Mensaje despachado mediante servidor 24/7 de São Paulo:`, spData);
          return NextResponse.json({ success: true, messageId: spData.messageId || 'SAOPAULO_OK', provider: 'saopaulo' });
        }
      }
    } catch (spErr) {
      console.warn(`[WhatsApp Gateway Sao Paulo] Servidor http://35.199.85.127:3001 no respondió a tiempo.`);
    }

    // TIER 2: SERVIDOR LOCAL DE RESPALDO (localhost:3001, whatsapp-server.js)
    try {
      const localRes = await fetch('http://localhost:3001/api/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer local-dev-key'
        },
        body: JSON.stringify({
          number: cleanPhone,
          text,
          imageUrl,
          media,
          orderId
        }),
        signal: AbortSignal.timeout(5000)
      });

      if (localRes.ok) {
        const localData = await localRes.json().catch(() => ({}));
        if (localData.success) {
          console.log(`[WhatsApp Gateway Local] ✅ Mensaje despachado mediante servidor local de respaldo:`, localData);
          return NextResponse.json({ success: true, messageId: localData.messageId || 'LOCAL_OK', provider: 'local' });
        }
      }
    } catch (localErr) {
      console.warn(`[WhatsApp Gateway Local] Servidor local http://localhost:3001 no activo o ocupado.`);
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
