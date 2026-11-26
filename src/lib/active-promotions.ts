/**
 * UTILIDADES PURAS DE PROMOCIONES ACTIVAS Y DETECCIÓN DE ÓRDENES DEL AGENTE COMANDANTE
 */

export interface ActivePromotion {
  id: string;
  title: string;
  summary: string;
  category?: string;
  discountPct?: number;
  conditions?: string;
  expiresAt?: string | null;
  active: boolean;
  campaignId?: string;
  createdAt?: string;
  createdBy?: string;
}

export interface CommanderIntentDetection {
  isCommander: boolean;
  intent: 'resend_campaign' | 'new_promo' | 'none';
}

function normalizeSearch(raw?: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'con', 'para', 'por',
  'en', 'a', 'al', 'del', 'que', 'se', 'su', 'sus', 'me', 'te', 'le', 'nos', 'quiero', 'puedes',
  'pueda', 'forma', 'automatica', 'nuevo', 'otra', 'vez', 'ese', 'esa', 'eso', 'esta', 'este',
  'hace', 'dias', 'donde', 'damos', 'todos', 'todo', 'clientes', 'cliente', 'favor', 'haz', 'envia',
  'enviar', 'envies', 'reenvia', 'reenviar', 'manda', 'mandar', 'campana', 'promocion', 'promo', 'difusion',
]);

/** Filtra únicamente promociones activas y no expiradas. */
export function filterValidPromotions(promos: ActivePromotion[] | undefined | null, now: Date = new Date()): ActivePromotion[] {
  if (!Array.isArray(promos)) return [];
  const nowMs = now.getTime();
  return promos.filter((p) => {
    if (!p || p.active !== true) return false;
    if (!p.expiresAt) return true;
    const expMs = new Date(p.expiresAt).getTime();
    if (isNaN(expMs)) return true;
    return expMs >= nowMs;
  });
}

/** Genera el bloque de instrucciones para inyectar en el prompt del Agente ARM. */
export function formatPromotionsForArmPrompt(promos: ActivePromotion[]): string {
  if (!promos || promos.length === 0) return '';
  const lines = promos.map((p, idx) => {
    const disc = typeof p.discountPct === 'number' && p.discountPct > 0 ? ` — *${p.discountPct}% de descuento*` : '';
    const cat = p.category ? ` [Línea/Categoría: ${p.category}]` : '';
    const cond = p.conditions ? ` (${p.conditions})` : '';
    const exp = p.expiresAt ? ` — Válida hasta: ${new Date(p.expiresAt).toLocaleDateString('es-VE')}` : '';
    return `${idx + 1}. 🔥 *${p.title}*${cat}${disc}${cond}${exp}\n   Detalle: ${p.summary}`;
  });

  return `\n🔥 PROMOCIONES ESPECIALES VIGENTES EN ESTE MOMENTO (PRIORIDAD SOBRE EL 25% HABITUAL):\n` +
    `Cuando el cliente pregunte por productos incluidos en estas promociones, DEBES aplicar y comunicar este descuento promocional vigente y calcular el monto con ese porcentaje sobre el Precio de Lista BCV:\n` +
    `${lines.join('\n')}\n`;
}

/**
 * Detecta si un mensaje recibido desde el WhatsApp personal del SuperAdmin
 * es una orden de campañas/promociones (y NO una consulta normal de prueba).
 */
export function isSuperAdminCommanderMessage(text: string): boolean {
  const norm = normalizeSearch(text);
  if (!norm || norm.length < 4) return false;
  return (
    /\b(reenvia|reenviar|envia de nuevo|enviar de nuevo|volver a enviar|vuelve a enviar|repite la|repetir la)\b/.test(norm) ||
    /\b(promocion de|promo de|lanzar promo|lanzar campana|crea una promo|crear promo|haz una promo|manda una promo|difusion a|difusion de)\b/.test(norm) ||
    /\b(activar promo|desactivar promo|promos activas|promociones activas)\b/.test(norm) ||
    (/\b(promocion|promo|campana|difusion)\b/.test(norm) && /\b(envia|enviar|reenvia|manda|crea|haz|activa|clientes)\b/.test(norm))
  );
}

/**
 * Busca la mejor campaña histórica coincidente usando palabras clave normalizadas
 * entre la orden del usuario y el título + cuerpo de cada campaña.
 */
export function findMatchingCampaign<T extends { title?: string; message?: string; mediaUrl?: string | null; sentCount?: number; createdAt?: any }>(
  instruction: string,
  campaigns: T[]
): T | null {
  if (!instruction || !Array.isArray(campaigns) || campaigns.length === 0) return null;

  const normInst = normalizeSearch(instruction);
  const tokens = Array.from(
    new Set(
      normInst
        .split(' ')
        .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
    )
  );
  if (tokens.length === 0) return null;

  // Sinónimos básicos para mejorar aciertos (bici -> bicicleta/bicicletas, etc.)
  const expandedTokens = new Set<string>(tokens);
  for (const t of tokens) {
    if (t === 'bici' || t === 'bicis') {
      expandedTokens.add('bicicleta');
      expandedTokens.add('bicicletas');
    } else if (t.startsWith('biciclet')) {
      expandedTokens.add('bici');
      expandedTokens.add('bicicleta');
      expandedTokens.add('bicicletas');
    } else if (t.startsWith('balon')) {
      expandedTokens.add('balon');
      expandedTokens.add('balones');
    } else if (t === '40' || t === '40%') {
      expandedTokens.add('40');
      expandedTokens.add('40%');
    }
  }

  let best: { camp: T; score: number; hasHttpsMedia: boolean; sentCount: number; ts: number } | null = null;

  for (const camp of campaigns) {
    const titleNorm = normalizeSearch(camp.title);
    const msgNorm = normalizeSearch(camp.message);
    let score = 0;

    for (const tok of expandedTokens) {
      if (titleNorm.includes(tok)) score += 4;
      if (msgNorm.includes(tok)) score += 2;
    }

    if (score <= 0) continue;

    const hasHttpsMedia = Boolean(camp.mediaUrl && typeof camp.mediaUrl === 'string' && camp.mediaUrl.startsWith('https://'));
    const sentCount = Number(camp.sentCount || 0);
    let ts = 0;
    if (camp.createdAt) {
      if (typeof camp.createdAt?.toDate === 'function') ts = camp.createdAt.toDate().getTime();
      else if (camp.createdAt?._seconds) ts = camp.createdAt._seconds * 1000;
      else {
        const parsed = new Date(camp.createdAt).getTime();
        if (!isNaN(parsed)) ts = parsed;
      }
    }

    // Bonus pequeño por haber sido completada exitosamente o tener media real
    const rankScore = score * 100 + (sentCount > 0 ? 20 : 0) + (hasHttpsMedia ? 15 : 0);

    if (
      !best ||
      rankScore > best.score ||
      (rankScore === best.score && ts > best.ts)
    ) {
      best = { camp, score: rankScore, hasHttpsMedia, sentCount, ts };
    }
  }

  return best ? best.camp : null;
}

/** Detecta la audiencia pedida en lenguaje natural. */
export function inferAudienceFromText(text: string): 'all' | 'vips' | 'inactive' | 'debtors' {
  const norm = normalizeSearch(text);
  if (/\b(inactivo|inactivos|dormido|dormidos|sin comprar)\b/.test(norm)) return 'inactive';
  if (/\b(vip|vips|pareto|mejores clientes|estrella)\b/.test(norm)) return 'vips';
  if (/\b(deudor|deudores|moroso|morosos|con deuda|pendiente|cobranza|factura)\b/.test(norm)) return 'debtors';
  return 'all';
}
