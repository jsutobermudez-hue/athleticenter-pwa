
import { NextResponse } from 'next/server';
import { 
    executeBcvRateSync,
    executeAutomatedBilling, 
    executeSavingsAlert, 
    executeStockOutPredictor, 
    executeLogisticsAudit, 
    executeChurnPrevention 
} from '@/services/agents';

export const dynamic = 'force-dynamic';

/**
 * ENDPOINT DE AUTOMATIZACIÓN v6.0 (FASE 4: BLINDAJE BCV)
 * Orquestador maestro de procesos autónomos de la terminal.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // Verificación de seguridad para evitar disparos accidentales
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.warn("[Cron] Intento de ejecución no autorizado.");
    return new Response('Unauthorized', { status: 401 });
  }

  console.log("[Cron] Iniciando Ciclo de Inteligencia Autónoma y Blindaje BCV...");

  try {
    const results = await Promise.allSettled([
        executeBcvRateSync(),
        executeAutomatedBilling(),
        executeSavingsAlert(),
        executeStockOutPredictor(),
        executeLogisticsAudit(),
        executeChurnPrevention()
    ]);

    const summary = results.map((r, i) => ({
        agent: ['BCV_Sync', 'Billing', 'Savings', 'StockOut', 'Logistics', 'Churn'][i],
        status: r.status,
        data: r.status === 'fulfilled' ? r.value : null,
        error: r.status === 'rejected' ? r.reason : null
    }));

    console.log("[Cron] Ciclo finalizado exitosamente.");

    return NextResponse.json({
        status: 'success',
        timestamp: new Date().toISOString(),
        summary
    });
  } catch (error: any) {
    console.error("[Cron] Fallo crítico en el orquestador:", error.message);
    return NextResponse.json({ status: 'error', message: error.message }, { status: 500 });
  }
}
