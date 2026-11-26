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
  module?: string;
  recipientName?: string;
  recipientType?: 'cliente' | 'equipo' | 'tercero';
  senderName?: string;
  senderRole?: string;
  source?: 'manual' | 'auto' | 'campaign' | 'commander';
  quoteId?: string;
  campaignId?: string;
}

export interface WhatsAppOutboundLogEntry {
  phone: string;
  recipientName?: string;
  recipientType?: 'cliente' | 'equipo' | 'tercero';
  module?: string;
  orderId?: string;
  quoteId?: string;
  campaignId?: string;
  text: string;
  hasMedia?: boolean;
  mediaType?: 'none' | 'pdf' | 'image' | 'video';
  fileName?: string;
  senderName?: string;
  senderRole?: string;
  source?: 'manual' | 'auto' | 'campaign' | 'commander';
  status: 'sent' | 'failed';
  provider?: string;
  messageId?: string;
  error?: string;
}

/**
 * Registra cada envío en `whatsapp_outbound_logs` sin bloquear ni lanzar errores,
 * guardando únicamente metadatos y texto (jamás Base64 de adjuntos).
 */
export async function logWhatsAppOutboundSafe(entry: WhatsAppOutboundLogEntry): Promise<void> {
  try {
    const writePromise = (async () => {
      const { initializeFirebaseServer, ensureServerAuth } = await import('@/firebase/server-init');
      await ensureServerAuth();
      const { firestore } = initializeFirebaseServer();
      const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');

      await addDoc(collection(firestore, 'whatsapp_outbound_logs'), {
        phone: String(entry.phone || ''),
        recipientName: String(entry.recipientName || ''),
        recipientType: entry.recipientType || 'cliente',
        module: String(entry.module || 'orders'),
        orderId: entry.orderId || null,
        quoteId: entry.quoteId || null,
        campaignId: entry.campaignId || null,
        text: String(entry.text || '').slice(0, 4000),
        hasMedia: Boolean(entry.hasMedia),
        mediaType: entry.mediaType || 'none',
        fileName: entry.fileName || null,
        senderName: entry.senderName || 'Sistema Automático',
        senderRole: entry.senderRole || 'system',
        source: entry.source || 'auto',
        status: entry.status,
        provider: entry.provider || null,
        messageId: entry.messageId || null,
        error: entry.error ? String(entry.error).slice(0, 400) : null,
        createdAt: serverTimestamp(),
      });
    })();

    await Promise.race([
      writePromise,
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch (err) {
    console.warn('[WhatsApp Outbound Log] Aviso al guardar historial:', err);
  }
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
  const spUrl = process.env.WHATSAPP_GATEWAY_SP_URL || 'http://35.213.77.171:3001';
  const errors: string[] = [];

  const mediaType: 'none' | 'pdf' | 'image' | 'video' =
    input.media?.mimetype?.includes('pdf') || input.documentUrl
      ? 'pdf'
      : input.videoUrl
        ? 'video'
        : input.imageUrl
          ? 'image'
          : 'none';
  const hasMedia = mediaType !== 'none';
  const resolvedFileName = input.fileName || input.media?.filename || undefined;

  if (!key) {
    console.error('[WhatsApp Dispatch] WHATSAPP_GATEWAY_KEY no configurada: no se puede usar el gateway.');
    errors.push('Gateway sin clave configurada');
  } else {
    // TIER 1: servidor 24/7 WhatsApp Gateway
    try {
      const sendTimeout = input.documentUrl || input.videoUrl ? 150000 : 35000;
      const r = await postTo(spUrl, key, payload, sendTimeout);
      if (r.success) {
        const provider = r.provider || 'saopaulo';
        await logWhatsAppOutboundSafe({
          phone: number,
          recipientName: input.recipientName,
          recipientType: input.recipientType,
          module: input.module,
          orderId: input.orderId,
          quoteId: input.quoteId,
          campaignId: input.campaignId,
          text: input.text || '',
          hasMedia,
          mediaType,
          fileName: resolvedFileName,
          senderName: input.senderName,
          senderRole: input.senderRole,
          source: input.source,
          status: 'sent',
          provider,
          messageId: r.messageId,
        });
        return { ...r, provider };
      }
      errors.push(`São Paulo: ${r.error}`);
    } catch (e: any) {
      errors.push(`São Paulo: ${e?.message || e}`);
    }

    // TIER 2: gateway local (solo desarrollo, explícito)
    if (process.env.WHATSAPP_LOCAL_GATEWAY === 'true') {
      try {
        const r = await postTo('http://localhost:3001', key, payload, 8000);
        if (r.success) {
          await logWhatsAppOutboundSafe({
            phone: number,
            recipientName: input.recipientName,
            recipientType: input.recipientType,
            module: input.module,
            orderId: input.orderId,
            quoteId: input.quoteId,
            campaignId: input.campaignId,
            text: input.text || '',
            hasMedia,
            mediaType,
            fileName: resolvedFileName,
            senderName: input.senderName,
            senderRole: input.senderRole,
            source: input.source,
            status: 'sent',
            provider: 'local',
            messageId: r.messageId,
          });
          return { ...r, provider: 'local' };
        }
        errors.push(`Local: ${r.error}`);
      } catch (e: any) {
        errors.push(`Local: ${e?.message || e}`);
      }
    }
  }

  const errMsg = errors.join(' | ') || 'Gateway no disponible';
  await logWhatsAppOutboundSafe({
    phone: number,
    recipientName: input.recipientName,
    recipientType: input.recipientType,
    module: input.module,
    orderId: input.orderId,
    quoteId: input.quoteId,
    campaignId: input.campaignId,
    text: input.text || '',
    hasMedia,
    mediaType,
    fileName: resolvedFileName,
    senderName: input.senderName,
    senderRole: input.senderRole,
    source: input.source,
    status: 'failed',
    error: errMsg,
  });

  console.warn(`[WhatsApp Dispatch] Sin gateway disponible para +${number}: ${errMsg}`);
  return {
    success: false,
    error: errMsg,
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
  const spUrl = process.env.WHATSAPP_GATEWAY_SP_URL || 'http://35.213.77.171:3001';
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
      signal: AbortSignal.timeout(opts.commonMediaUrl ? 120000 : 35000),
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok || !data?.success) return { success: false, error: data?.error || `HTTP ${res.status}` };
    return { success: true, queued: data.queued, totalQueued: data.totalQueued, businessHours: data.businessHours };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  }
}
