/**
 * DISPATCHER DE WHATSAPP DEL LADO DEL SERVIDOR (Multi-Tier)
 *
 * Jerarquía de envío:
 *  1. Gateway 24/7 en São Paulo (Google Compute Engine, IP estática, Node.js + Baileys + PM2).
 *     Recomendado para producción: 100% aislado de los reinicios de Cloud Run.
 *  2. Gateway local (solo desarrollo, configurable vía WHATSAPP_LOCAL_GATEWAY=true).
 *  3. Fallback wa.me si ningún gateway responde.
 *
 * Cola anti-bloqueo:
 *  Para difusiones masivas o catálogo bi-semanal, usar `enqueueWhatsAppBatch`.
 *  El gateway procesa los mensajes con jitter humano (8-14 s) y descansos cada 20 envíos.
 */

import { formatVenezuelaPhoneE164 } from './whatsapp-gateway';

export interface GatewayPayload {
  number: string;
  text?: string;
  imageUrl?: string;
  videoUrl?: string;
  documentUrl?: string;
  fileName?: string;
  media?: { base64: string; filename?: string; mimetype?: string };
  orderId?: string;
}

export interface GatewayResult {
  success: boolean;
  messageId?: string;
  provider?: string;
  error?: string;
  fallbackUrl?: string;
}

export function normalizeVePhone(raw: string): string {
  let clean = String(raw || '').replace(/[^\d]/g, '');
  if (clean.startsWith('0')) clean = '58' + clean.substring(1);
  if (!clean.startsWith('58') && clean.length === 10) clean = '58' + clean;
  return clean;
}

async function postTo(url: string, key: string, payload: GatewayPayload, timeoutMs: number): Promise<GatewayResult> {
  const res = await fetch(`${url.replace(/\/$/, '')}/api/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({} as any));
  if (res.ok && data?.success) return { success: true, messageId: data.messageId || 'SENT_OK', provider: data.provider };
  return { success: false, error: data?.error || `HTTP ${res.status}` };
}

/** Envía un mensaje por el gateway. Nunca lanza: devuelve { success:false, fallbackUrl } si no hay gateway. */
export async function dispatchViaGateways(input: GatewayPayload): Promise<GatewayResult> {
  const number = normalizeVePhone(input.number);
  if (!number || number.length < 11) return { success: false, error: 'Número de teléfono inválido' };
  if (!input.text && !input.imageUrl && !input.videoUrl && !input.documentUrl && !input.media) {
    return { success: false, error: 'Mensaje vacío' };
  }

  const payload: GatewayPayload = { ...input, number };
  const key = process.env.WHATSAPP_GATEWAY_KEY || '';
  const spUrl = process.env.WHATSAPP_GATEWAY_SP_URL || 'http://35.199.85.127:3001';
  const errors: string[] = [];

  if (!key) {
    console.error('[WhatsApp Dispatch] WHATSAPP_GATEWAY_KEY no configurada: no se puede usar el gateway.');
    errors.push('Gateway sin clave configurada');
  } else {
    // TIER 1: servidor 24/7 de São Paulo
    try {
      const r = await postTo(spUrl, key, payload, 35000);
      if (r.success) return { ...r, provider: r.provider || 'saopaulo' };
      errors.push(`São Paulo: ${r.error}`);
    } catch (e: any) {
      errors.push(`São Paulo: ${e?.message || e}`);
    }

    // TIER 2: gateway local (solo desarrollo, explícito)
    if (process.env.WHATSAPP_LOCAL_GATEWAY === 'true') {
      try {
        const r = await postTo('http://localhost:3001', key, payload, 8000);
        if (r.success) return { ...r, provider: 'local' };
        errors.push(`Local: ${r.error}`);
      } catch (e: any) {
        errors.push(`Local: ${e?.message || e}`);
      }
    }
  }

  console.warn(`[WhatsApp Dispatch] Sin gateway disponible para +${number}: ${errors.join(' | ')}`);
  return {
    success: false,
    error: errors.join(' | ') || 'Gateway no disponible',
    fallbackUrl: `https://wa.me/${number}?text=${encodeURIComponent(input.text || '')}`,
  };
}

export interface QueueItem {
  number: string;
  text: string;
  imageUrl?: string;
  videoUrl?: string;
  documentUrl?: string;
  fileName?: string;
}

/**
 * Encola un lote de mensajes en el gateway de São Paulo, que los envía con pausas anti-bloqueo
 * (8-14 s, enfriamiento cada 20) y solo en horario comercial. Pensado para difusiones y catálogo:
 * evita que el envío quede atado a una petición HTTP de 5 minutos en producción.
 * Si se indica campaignId, el gateway reporta el progreso a /api/marketing/campaign-progress.
 */
export async function enqueueWhatsAppBatch(
  items: QueueItem[],
  opts: {
    campaignId?: string;
    label?: string;
    commonMediaUrl?: string;
    commonMediaType?: 'image' | 'video' | 'pdf';
    commonMediaFileName?: string;
  } = {}
): Promise<{ success: boolean; queued?: number; totalQueued?: number; businessHours?: boolean; error?: string }> {
  const key = process.env.WHATSAPP_GATEWAY_KEY || '';
  const spUrl = process.env.WHATSAPP_GATEWAY_SP_URL || 'http://35.199.85.127:3001';
  if (!key) return { success: false, error: 'WHATSAPP_GATEWAY_KEY no configurada' };

  const clean = items
    .map(i => ({ ...i, number: normalizeVePhone(i.number) }))
    .filter(i => i.number.length >= 11 && (i.text || i.imageUrl || i.videoUrl || i.documentUrl || opts.commonMediaUrl));
  if (!clean.length) return { success: false, error: 'Ningún destinatario válido' };

  try {
    const res = await fetch(`${spUrl.replace(/\/$/, '')}/api/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        campaignId: opts.campaignId,
        label: opts.label,
        items: clean,
        commonMediaUrl: opts.commonMediaUrl,
        commonMediaType: opts.commonMediaType,
        commonMediaFileName: opts.commonMediaFileName,
      }),
      signal: AbortSignal.timeout(35000),
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok || !data?.success) return { success: false, error: data?.error || `HTTP ${res.status}` };
    return { success: true, queued: data.queued, totalQueued: data.totalQueued, businessHours: data.businessHours };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}
