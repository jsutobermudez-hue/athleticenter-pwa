import { NextResponse } from 'next/server';
import { runBiweeklyCatalogAgent } from '@/services/biweekly-catalog-agent';

/**
 * ENDPOINT DE DISPARO DEL CATÁLOGO BI-SEMANAL (LUNES Y JUEVES)
 * Selecciona 3 productos en tendencia y 3 sin rotación de inventario
 * y despacha con foto real del producto estrella a los clientes.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { dryRun = false, testPhone } = body;

    console.log(`[API Cron Biweekly Catalog] Solicitud recibida: dryRun=${dryRun}, testPhone=${testPhone || 'N/A'}`);

    const result = await runBiweeklyCatalogAgent({
      dryRun: Boolean(dryRun),
      testPhone: testPhone ? String(testPhone) : undefined
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API Cron Biweekly Catalog] Error:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Error interno' }, { status: 500 });
  }
}

export async function GET() {
  try {
    // GET devuelve una simulación (dryRun) para previsualizar el catálogo actual
    const result = await runBiweeklyCatalogAgent({ dryRun: true });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message }, { status: 500 });
  }
}
