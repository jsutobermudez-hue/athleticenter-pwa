import { NextResponse } from 'next/server';
import { authorizeRequest, STAFF_ROLES } from '@/lib/server-auth';
import { dispatchViaGateways } from '@/lib/whatsapp-dispatch-server';

export const dynamic = 'force-dynamic';

/**
 * GATEWAY DE WHATSAPP (relay autenticado).
 * Solo personal con sesión válida (o procesos internos con CRON_SECRET) puede enviar mensajes.
 * El despacho real lo hace dispatchViaGateways (servidor 24/7 de São Paulo).
 */
export async function POST(req: Request) {
  const auth = await authorizeRequest(req, STAFF_ROLES);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  try {
    const body = await req.json();
    const { number, text, imageUrl, media, orderId } = body || {};

    if (!number || (!text && !media && !imageUrl)) {
      return NextResponse.json({ success: false, error: 'Número y contenido son requeridos.' }, { status: 400 });
    }
    if (imageUrl && typeof imageUrl === 'string' && !imageUrl.startsWith('data:image/') && !imageUrl.startsWith('https://')) {
      return NextResponse.json({ success: false, error: 'URL de imagen no permitida.' }, { status: 400 });
    }

    console.log(`[WhatsApp Gateway API] Despacho solicitado por ${auth.internal ? 'sistema' : `${auth.name} (${auth.role})`} (Orden: #${orderId || 'N/A'})`);
    const result = await dispatchViaGateways({ number, text, imageUrl, media, orderId });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[WhatsApp Gateway API] Error interno en gateway route:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Error interno del servidor Gateway' }, { status: 500 });
  }
}
