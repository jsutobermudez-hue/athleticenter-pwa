import { NextResponse } from 'next/server';
import { initializeFirebaseServer, ensureServerAuth } from '@/firebase/server-init';
import { authorizeRequest, MANAGER_ROLES } from '@/lib/server-auth';
import {
  interpretCommanderInstruction,
  executeCommanderDraft,
  cancelCommanderDraft,
  listActivePromotions,
  toggleActivePromotion,
} from '@/services/whatsapp-commander-agent';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  const auth = await authorizeRequest(req, MANAGER_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  try {
    await ensureServerAuth();
    const { firestore } = initializeFirebaseServer();
    const promotions = await listActivePromotions(firestore);
    return NextResponse.json({ success: true, promotions });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'Error consultando promociones' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await authorizeRequest(req, MANAGER_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  try {
    const body = await req.json();
    const action = String(body?.action || '');

    await ensureServerAuth();
    const { firestore } = initializeFirebaseServer();

    if (action === 'plan') {
      const instruction = String(body?.instruction || '').trim();
      if (!instruction) {
        return NextResponse.json({ success: false, error: 'Escribe una instrucción para el agente.' }, { status: 400 });
      }
      const draft = await interpretCommanderInstruction({
        firestore,
        instruction,
        userId: auth.uid,
        userName: auth.name,
        channel: 'web',
      });
      return NextResponse.json({ success: true, draft });
    }

    if (action === 'confirm') {
      const draftId = String(body?.draftId || '').trim();
      if (!draftId) {
        return NextResponse.json({ success: false, error: 'draftId requerido.' }, { status: 400 });
      }
      const result = await executeCommanderDraft({
        firestore,
        draftId,
        confirmedByUid: auth.uid,
        confirmedByName: auth.name,
        overrides: body?.overrides,
      });
      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error || 'No se pudo lanzar la campaña.' }, { status: 400 });
      }
      return NextResponse.json(result);
    }

    if (action === 'cancel') {
      const draftId = String(body?.draftId || '').trim();
      if (draftId) {
        await cancelCommanderDraft({ firestore, draftId });
      }
      return NextResponse.json({ success: true });
    }

    if (action === 'toggle_promo') {
      const promoId = String(body?.promoId || '').trim();
      const active = Boolean(body?.active);
      if (!promoId) {
        return NextResponse.json({ success: false, error: 'promoId requerido.' }, { status: 400 });
      }
      const promotions = await toggleActivePromotion({ firestore, promoId, active });
      return NextResponse.json({ success: true, promotions });
    }

    return NextResponse.json({ success: false, error: 'Acción no soportada.' }, { status: 400 });
  } catch (e: any) {
    console.error('[Commander API] Error:', e);
    return NextResponse.json({ success: false, error: e?.message || 'Error en Agente Comandante' }, { status: 500 });
  }
}
