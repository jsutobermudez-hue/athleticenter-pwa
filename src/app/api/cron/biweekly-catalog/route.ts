import { NextResponse } from 'next/server';
import { runBiweeklyCatalogAgent } from '@/services/biweekly-catalog-agent';
import { authorizeRequest, MANAGER_ROLES } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * ENDPOINT DE DISPARO DEL CATÁLOGO BI-SEMANAL (LUNES Y JUEVES)
 * Selecciona 3 productos en tendencia y 3 sin rotación de inventario
 * y despacha con foto real del producto estrella a los clientes.
 *
 * Seguridad: clave interna (CRON_SECRET, usada por São Paulo) o usuario gerencia/admin/superadmin.
 * Por defecto es SIMULACIÓN: para envío real hay que mandar explícitamente "dryRun": false.
 */
export async function POST(req: Request) {
  const auth = await authorizeRequest(req, MANAGER_ROLES);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun !== false;
    const testPhone = typeof body.testPhone === 'string' && body.testPhone.trim() ? body.testPhone.trim() : undefined;

    console.log(`[API Cron Biweekly Catalog] Solicitud de ${auth.internal ? 'sistema' : auth.name}: dryRun=${dryRun}, testPhone=${testPhone || 'N/A'}`);

    const result = await runBiweeklyCatalogAgent({ dryRun, testPhone });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API Cron Biweekly Catalog] Error:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Error interno' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const auth = await authorizeRequest(req, MANAGER_ROLES);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  try {
    // GET devuelve una simulación (dryRun) para previsualizar el catálogo actual
    const result = await runBiweeklyCatalogAgent({ dryRun: true });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message }, { status: 500 });
  }
}
