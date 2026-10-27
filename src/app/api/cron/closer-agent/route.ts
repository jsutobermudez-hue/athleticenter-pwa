import { NextResponse } from 'next/server';
import { runGeminiCloserAgent } from '@/ai/flows/gemini-closer-agent';
import { authorizeRequest, MANAGER_ROLES } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_QUOTES_CAP = 30;

/**
 * GEMINI CLOSER — Endpoint del agente de rescate de cotizaciones.
 *
 * POST body (JSON, todo opcional):
 *   { "dryRun": true, "testPhone": "584121234567", "maxQuotes": 5 }
 *
 * Por seguridad el modo por defecto es SIMULACIÓN (dryRun: true).
 * Para enviar mensajes reales hay que mandar explícitamente "dryRun": false.
 * Seguridad: clave interna (CRON_SECRET) o usuario gerencia/admin/superadmin. maxQuotes con tope.
 */
export async function POST(req: Request) {
    const auth = await authorizeRequest(req, MANAGER_ROLES);
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

    try {
        let body: any = {};
        try { body = await req.json(); } catch { /* sin cuerpo */ }

        const requested = typeof body.maxQuotes === 'number' ? body.maxQuotes : undefined;
        const result = await runGeminiCloserAgent({
            dryRun: body.dryRun !== false,
            testPhone: typeof body.testPhone === 'string' && body.testPhone.trim() ? body.testPhone.trim() : undefined,
            maxQuotes: requested !== undefined ? Math.max(1, Math.min(MAX_QUOTES_CAP, Math.floor(requested))) : undefined,
        });

        return NextResponse.json({ success: true, ...result });
    } catch (error: any) {
        console.error('[API Closer] Error ejecutando Gemini Closer:', error);
        return NextResponse.json({ success: false, error: error?.message || String(error) }, { status: 500 });
    }
}
