import { NextResponse } from 'next/server';
import { runGeminiCloserAgent } from '@/ai/flows/gemini-closer-agent';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GEMINI CLOSER — Endpoint del agente de rescate de cotizaciones.
 *
 * POST body (JSON, todo opcional):
 *   { "dryRun": true, "testPhone": "584121234567", "maxQuotes": 5 }
 *
 * Por seguridad el modo por defecto es SIMULACIÓN (dryRun: true).
 * Para enviar mensajes reales hay que mandar explícitamente "dryRun": false.
 */
export async function POST(req: Request) {
    try {
        let body: any = {};
        try { body = await req.json(); } catch { /* sin cuerpo */ }

        const result = await runGeminiCloserAgent({
            dryRun: body.dryRun !== false,
            testPhone: typeof body.testPhone === 'string' && body.testPhone.trim() ? body.testPhone.trim() : undefined,
            maxQuotes: typeof body.maxQuotes === 'number' ? body.maxQuotes : undefined,
        });

        return NextResponse.json({ success: true, ...result });
    } catch (error: any) {
        console.error('[API Closer] Error ejecutando Gemini Closer:', error);
        return NextResponse.json({ success: false, error: error?.message || String(error) }, { status: 500 });
    }
}
