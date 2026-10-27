import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { initializeFirebaseServer, ensureServerAuth } from '@/firebase/server-init';

export const dynamic = 'force-dynamic';

/**
 * Recibe del gateway de São Paulo el progreso de una campaña encolada (difusión o catálogo)
 * y lo refleja en marketing_campaigns. Autenticado con WHATSAPP_WEBHOOK_SECRET.
 */
export async function POST(req: Request) {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
  const provided = req.headers.get('x-webhook-secret') || '';
  if (!secret || secret.length < 24 || provided.length !== secret.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(secret))) {
    return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { campaignId, sentCount, failedCount, status, errors } = await req.json();
    if (!campaignId || typeof campaignId !== 'string' || campaignId.includes('/')) {
      return NextResponse.json({ success: false, error: 'campaignId inválido' }, { status: 400 });
    }
    await ensureServerAuth();
    const { firestore } = initializeFirebaseServer();
    const update: Record<string, any> = {
      sentCount: Number(sentCount) || 0,
      failedCount: Number(failedCount) || 0,
      status: status === 'completed' ? 'completed' : 'processing',
      updatedAt: serverTimestamp(),
    };
    if (status === 'completed') update.completedAt = serverTimestamp();
    if (Array.isArray(errors) && errors.length) update.lastErrors = errors.slice(-20).map(String);
    await updateDoc(doc(firestore, 'marketing_campaigns', campaignId), update);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('[Campaign Progress] Error:', e?.message || e);
    return NextResponse.json({ success: false, error: e?.message }, { status: 500 });
  }
}
