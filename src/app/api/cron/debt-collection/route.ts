import { NextResponse } from 'next/server';
import { executeAutomatedDebtCollection } from '@/services/agents';
import { authorizeRequest, MANAGER_ROLES } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Cobranza automática. POST body opcional: { "dryRun": true, "testPhone": "58412..." }
 * - dryRun: solo simula y devuelve a quién se avisaría. POR DEFECTO ES SIMULACIÓN:
 *   para enviar mensajes reales hay que mandar explícitamente "dryRun": false.
 * - testPhone: redirige los mensajes a ese número y no registra el aviso en el cliente.
 * Seguridad: clave interna (CRON_SECRET) o usuario gerencia/admin/superadmin.
 */
export async function POST(req: Request) {
  const auth = await authorizeRequest(req, MANAGER_ROLES);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  try {
    let body: any = {};
    try { body = await req.json(); } catch { /* sin cuerpo */ }
    const result = await executeAutomatedDebtCollection({
      dryRun: body.dryRun !== false,
      testPhone: typeof body.testPhone === 'string' && body.testPhone.trim() ? body.testPhone.trim() : undefined,
    });
    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error('[API Cron] Error ejecutando cobranza:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
