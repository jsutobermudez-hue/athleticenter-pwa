import { NextResponse } from 'next/server';
import { executeAutomatedDebtCollection } from '@/services/agents';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Cobranza automática. POST body opcional: { "dryRun": true, "testPhone": "58412..." }
 * - dryRun: solo simula y devuelve a quién se avisaría.
 * - testPhone: redirige los mensajes a ese número y no registra el aviso en el cliente.
 */
export async function POST(req: Request) {
  try {
    let body: any = {};
    try { body = await req.json(); } catch { /* sin cuerpo */ }
    const result = await executeAutomatedDebtCollection({
      dryRun: body.dryRun === true,
      testPhone: typeof body.testPhone === 'string' && body.testPhone.trim() ? body.testPhone.trim() : undefined,
    });
    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error('[API Cron] Error ejecutando cobranza:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
