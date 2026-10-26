/**
 * @fileOverview GEMINI CLOSER — Agente de Rescate de Cotizaciones (Fase 2).
 *
 * Escanea cotizaciones enviadas que el cliente no ha aprobado y ejecuta una
 * secuencia de seguimiento por WhatsApp redactada por Google Gemini:
 *   - Etapa 1 (>= 3 días): Rescate con venta cruzada + recordatorio de la política oficial
 *     (25% pagando en divisas + 10% adicional pagando la factura de contado).
 *   - Etapa 2 (>= 7 días): Recolección de objeciones (precio, entrega, competencia).
 *
 * Seguridad:
 *   - Por defecto corre en modo SIMULACIÓN (dryRun) — no envía ni modifica datos.
 *   - Cada cotización recibe como máximo un mensaje por etapa (anti-fatiga).
 *   - Si Gemini no responde, se usa una plantilla determinística como respaldo.
 *   - Toda la política de incentivos es configurable en Firestore: system/closerAgent
 */

import { ai } from '@/ai/genkit';
import {
    collection, getDocs, query, where, limit, doc, getDoc, updateDoc,
    serverTimestamp, arrayUnion,
} from 'firebase/firestore';
import { initializeFirebaseServer, ensureServerAuth } from '@/firebase/server-init';
import { dispatchUniversalWhatsApp } from '@/lib/whatsapp-universal';

// ─────────────────────────────────────────────────────────────
// CONFIGURACIÓN (sobrescribible desde Firestore: system/closerAgent)
// ─────────────────────────────────────────────────────────────
export interface CloserAgentSettings {
    enabled: boolean;
    targetStatuses: string[];      // Estados de cotización a perseguir
    rescueAfterDays: number;       // Etapa 1
    feedbackAfterDays: number;     // Etapa 2
    maxQuoteAgeDays: number;       // Cotizaciones más viejas se ignoran (precios desactualizados)
    maxQuotesPerRun: number;
    geminiModel: string;
}

export const DEFAULT_CLOSER_SETTINGS: CloserAgentSettings = {
    enabled: true,
    targetStatuses: ['Enviada'],
    rescueAfterDays: 3,
    feedbackAfterDays: 7,
    maxQuoteAgeDays: 30,
    maxQuotesPerRun: 25,
    geminiModel: process.env.GEMINI_MODEL || 'googleai/gemini-2.5-flash',
};

/**
 * POLÍTICA COMERCIAL OFICIAL DE ATHLETICENTER (no se inventan incentivos nuevos):
 *   1. Descuento por pago en DIVISAS sobre el precio de lista  → system/financials.defaultBcvDiscount (25%)
 *   2. Descuento ADICIONAL por pago de CONTADO, sobre el subtotal en divisas → system/financials.earlyPayment7Days (10%)
 * Los porcentajes se leen de Tesorería para que el agente siempre coincida con la política vigente.
 */
export interface CommercialPolicy {
    divisasDiscountPct: number;
    contadoDiscountPct: number;
}

export const DEFAULT_COMMERCIAL_POLICY: CommercialPolicy = { divisasDiscountPct: 25, contadoDiscountPct: 10 };

export type CloserIncentiveType = 'divisas_contado';

export interface CloserRunOptions {
    dryRun?: boolean;      // true por defecto: solo simula
    testPhone?: string;    // Redirige TODOS los mensajes a este número (pruebas)
    maxQuotes?: number;
}

export interface CloserQuoteResult {
    quoteId: string;
    customerName: string;
    totalAmount: number;
    daysIdle: number;
    stage: 'rescate' | 'feedback';
    incentive?: CloserIncentive;
    crossSell?: string[];
    message: string;
    generatedBy: 'gemini' | 'plantilla';
    recipient: string;
    sent: boolean;
    error?: string;
}

export interface CloserRunResult {
    dryRun: boolean;
    scanned: number;
    eligible: number;
    sent: number;
    skipped: { quoteId: string; reason: string }[];
    results: CloserQuoteResult[];
}

// ─────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────
function toDate(v: any): Date | null {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate();
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date) {
    return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

function money(n: number) {
    return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function round2(n: number) {
    return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

export interface CloserIncentive {
    type: CloserIncentiveType;
    label: string;
    divisasDiscountPct: number;
    contadoDiscountPct: number;
    totalDivisasUSD: number;   // Lista - 25%
    totalContadoUSD: number;   // (Lista - 25%) - 10%
}

/** Calcula los montos con la política oficial: 25% divisas + 10% adicional de contado (en cascada). */
export function buildIncentive(listTotal: number, policy: CommercialPolicy): CloserIncentive {
    const totalDivisasUSD = round2(listTotal * (1 - policy.divisasDiscountPct / 100));
    const totalContadoUSD = round2(totalDivisasUSD * (1 - policy.contadoDiscountPct / 100));
    return {
        type: 'divisas_contado',
        divisasDiscountPct: policy.divisasDiscountPct,
        contadoDiscountPct: policy.contadoDiscountPct,
        totalDivisasUSD,
        totalContadoUSD,
        label:
            `Pagando en divisas tienes ${policy.divisasDiscountPct}% de descuento: queda en ${money(totalDivisasUSD)}. ` +
            `Y si pagas la factura de contado, ${policy.contadoDiscountPct}% adicional: queda en ${money(totalContadoUSD)}`,
    };
}

async function loadCommercialPolicy(firestore: any): Promise<CommercialPolicy> {
    try {
        const snap = await getDoc(doc(firestore, 'system', 'financials'));
        if (snap.exists()) {
            const f = snap.data() as any;
            const divisas = Number(f.defaultBcvDiscount);
            const contado = Number(f.earlyPayment7Days);
            return {
                divisasDiscountPct: divisas > 0 && divisas < 100 ? divisas : DEFAULT_COMMERCIAL_POLICY.divisasDiscountPct,
                contadoDiscountPct: contado > 0 && contado < 100 ? contado : DEFAULT_COMMERCIAL_POLICY.contadoDiscountPct,
            };
        }
    } catch {
        console.warn('[Gemini Closer] No se pudo leer system/financials, usando 25% / 10%.');
    }
    return DEFAULT_COMMERCIAL_POLICY;
}

async function loadSettings(firestore: any): Promise<CloserAgentSettings> {
    try {
        const snap = await getDoc(doc(firestore, 'system', 'closerAgent'));
        if (snap.exists()) return { ...DEFAULT_CLOSER_SETTINGS, ...(snap.data() as Partial<CloserAgentSettings>) };
    } catch (e) {
        console.warn('[Gemini Closer] No se pudo leer system/closerAgent, usando valores por defecto.');
    }
    return DEFAULT_CLOSER_SETTINGS;
}

async function loadQuoteItems(firestore: any, quote: any): Promise<any[]> {
    if (Array.isArray(quote.items) && quote.items.length > 0) return quote.items;
    try {
        const snap = await getDocs(collection(firestore, `quotes/${quote.id}/quoteItems`));
        return snap.docs.map(d => d.data());
    } catch {
        return [];
    }
}

// ─────────────────────────────────────────────────────────────
// REDACCIÓN CON GEMINI (+ plantilla de respaldo)
// ─────────────────────────────────────────────────────────────
interface MsgParams {
    stage: 'rescate' | 'feedback';
    customerName: string;
    quoteCode: string;
    total: number;
    productNames: string[];
    crossSell: string[];
    incentive?: CloserIncentive;
    salesperson: string;
}

function templateMessage(p: MsgParams): string {
    if (p.stage === 'feedback') {
        return `*ATHLETICENTER*\n\nHola *${p.customerName}*, te saludamos el equipo de Athleticenter.\n\n` +
            `Vimos que la cotización *#${p.quoteCode}* (${money(p.total)}) quedó en pausa. Para mejorar, ¿nos cuentas qué faltó?\n\n` +
            `1️⃣ Precio\n2️⃣ Tiempo de entrega\n3️⃣ Conseguí otra opción\n4️⃣ Aún lo estoy evaluando\n\nResponde solo con el número. ¡Gracias! 🙌`;
    }
    const items = p.productNames.slice(0, 3).join(', ') || 'tus equipos';
    const cross = p.crossSell.length ? `\n\n💡 Complementa tu pedido con: *${p.crossSell.join('*, *')}*.` : '';
    const inc = p.incentive!;
    return `*ATHLETICENTER*\n\nHola *${p.customerName}* 👋\n\n` +
        `Te recordamos tu cotización *#${p.quoteCode}* (${items}) por *${money(p.total)}* precio de lista.\n\n` +
        `💵 Pagando en *divisas* (${inc.divisasDiscountPct}% de descuento): *${money(inc.totalDivisasUSD)}*\n` +
        `✅ Pagando la factura de *contado* (${inc.contadoDiscountPct}% adicional): *${money(inc.totalContadoUSD)}*` +
        `${cross}\n\n¿Te la confirmamos? Responde *SÍ* y el equipo de Athleticenter la procesa de inmediato.`;
}

async function writeWithGemini(model: string, p: MsgParams): Promise<string | null> {
    if (!process.env.GOOGLE_GENAI_API_KEY && !process.env.GEMINI_API_KEY) return null;

    const inc = p.incentive;
    const brief = p.stage === 'rescate' && inc
        ? `Objetivo: recuperar una cotización sin respuesta recordando los beneficios de pago vigentes. ` +
          `Debes incluir EXACTAMENTE estos dos montos, sin cambiarlos: ` +
          `pagando en divisas ${inc.divisasDiscountPct}% de descuento = ${money(inc.totalDivisasUSD)}; ` +
          `pagando la factura de contado ${inc.contadoDiscountPct}% adicional = ${money(inc.totalContadoUSD)}. ` +
          `No ofrezcas ningún otro descuento, regalo, envío gratis ni plazo.` +
          (p.crossSell.length ? ` Sugiere de forma natural estos productos complementarios: ${p.crossSell.join(', ')}.` : '') +
          ` Termina pidiendo que responda "SÍ" para confirmar.`
        : `Objetivo: la cotización no se cerró. Pregunta amablemente el motivo y ofrece opciones numeradas: 1) Precio 2) Tiempo de entrega 3) Consiguió otra opción 4) Aún lo evalúa. NO ofrezcas descuentos.`;

    const prompt =
        `Eres el asistente comercial de ATHLETICENTER C.A., distribuidor venezolano de artículos deportivos y equipos fitness.\n` +
        `Redacta UN mensaje de WhatsApp en español venezolano profesional y cercano (máx. 100 palabras), con formato WhatsApp (*negritas*) y 1-3 emojis.\n` +
        `Empieza con "*ATHLETICENTER*" en la primera línea.\n` +
        `Cliente: ${p.customerName}\nCotización: #${p.quoteCode}\nMonto precio de lista: ${money(p.total)}\n` +
        `Productos cotizados: ${p.productNames.join(', ') || 'artículos deportivos'}\nRemitente: "somos el equipo de Athleticenter" (escribe siempre en plural, como equipo)\n` +
        `${brief}\n` +
        `Reglas: NUNCA menciones nombres de personas, vendedores ni asesores; firma siempre como el equipo de Athleticenter. No inventes precios, montos, plazos ni descuentos distintos a los indicados. Devuelve solo el texto del mensaje.`;

    try {
        const res = await ai.generate({ model, prompt, config: { temperature: 0.6 } });
        const text = (res.text || '').trim();
        if (!text || text.length < 40) return null;
        // Validación estricta: ambos montos oficiales deben aparecer tal cual; si no, usamos la plantilla
        if (p.stage === 'rescate' && inc) {
            const digits = (s: string) => s.replace(/[^\d]/g, '');
            const t = digits(text);
            if (!t.includes(digits(money(inc.totalDivisasUSD))) || !t.includes(digits(money(inc.totalContadoUSD)))) {
                console.warn('[Gemini Closer] Gemini alteró/omitió los montos oficiales; se usa plantilla.');
                return null;
            }
        }
        // En la encuesta no debe aparecer ningún descuento
        if (p.stage === 'feedback' && /%|descuento|gratis|regalo/i.test(text)) return null;
        // Nunca debe aparecer el nombre del vendedor
        const sp = (p.salesperson || '').trim();
        if (sp.length > 2 && sp.toLowerCase() !== 'athleticenter' && text.toLowerCase().includes(sp.toLowerCase())) return null;
        return text;
    } catch (e: any) {
        console.warn('[Gemini Closer] Gemini no disponible, usando plantilla:', e?.message || e);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────
// EJECUCIÓN PRINCIPAL
// ─────────────────────────────────────────────────────────────
export async function runGeminiCloserAgent(opts: CloserRunOptions = {}): Promise<CloserRunResult> {
    const dryRun = opts.dryRun !== false;
    const { firestore } = initializeFirebaseServer();
    // Las reglas de Firestore exigen request.auth != null para leer cotizaciones
    await ensureServerAuth();
    const settings = await loadSettings(firestore);
    const policy = await loadCommercialPolicy(firestore);
    const maxQuotes = opts.maxQuotes ?? settings.maxQuotesPerRun;

    const result: CloserRunResult = { dryRun, scanned: 0, eligible: 0, sent: 0, skipped: [], results: [] };
    if (!settings.enabled && !dryRun) {
        result.skipped.push({ quoteId: '-', reason: 'Agente desactivado en system/closerAgent' });
        return result;
    }

    // Catálogo para nombres y venta cruzada
    const productsSnap = await getDocs(query(collection(firestore, 'products'), limit(400)));
    const products = productsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    const productById = new Map<string, any>(products.map(p => [p.id, p]));
    if (products.length === 0) {
        // Catálogo vacío = Firestore no respondió (p. ej. cuota diaria agotada). No seguimos a ciegas.
        throw new Error('Firestore no devolvió productos (posible cuota diaria agotada: RESOURCE_EXHAUSTED). Ejecución abortada.');
    }

    const now = new Date();
    const candidates: any[] = [];
    for (const status of settings.targetStatuses) {
        const snap = await getDocs(query(collection(firestore, 'quotes'), where('status', '==', status), limit(200)));
        snap.docs.forEach(d => candidates.push({ id: d.id, ...(d.data() as any) }));
    }
    result.scanned = candidates.length;

    // Más recientes primero, para que si un cliente tiene varias cotizaciones se trabaje la última
    candidates.sort((a, b) =>
        (toDate(b.quoteDate) || toDate(b.createdAt) || new Date(0)).getTime() -
        (toDate(a.quoteDate) || toDate(a.createdAt) || new Date(0)).getTime());
    const contactedCustomers = new Set<string>();
    const custKey = (q: any) => String(q.customerId || q.customerPhone || q.customerName || q.id);

    // Último contacto del Closer por cliente (cualquier cotización) — anti-fatiga entre corridas
    const lastContactByCustomer = new Map<string, Date>();
    for (const q of candidates) {
        const sent = toDate(q.closerLastSentAt);
        if (!sent) continue;
        const prev = lastContactByCustomer.get(custKey(q));
        if (!prev || sent > prev) lastContactByCustomer.set(custKey(q), sent);
    }
    const MIN_DAYS_BETWEEN_CONTACTS = Math.max(1, settings.feedbackAfterDays - settings.rescueAfterDays);

    for (const quote of candidates) {
        if (result.results.length >= maxQuotes) break;

        const quoteDate = toDate(quote.quoteDate) || toDate(quote.createdAt);
        if (!quoteDate) { result.skipped.push({ quoteId: quote.id, reason: 'Sin fecha' }); continue; }
        const daysIdle = daysBetween(quoteDate, now);
        if (daysIdle > settings.maxQuoteAgeDays) {
            result.skipped.push({ quoteId: quote.id, reason: `Muy antigua (${daysIdle} días > ${settings.maxQuoteAgeDays})` });
            continue;
        }
        const stageDone = Number(quote.closerStage || 0);

        let stage: 'rescate' | 'feedback' | null = null;
        if (stageDone < 1 && daysIdle >= settings.rescueAfterDays) stage = 'rescate';
        else if (stageDone === 1 && daysIdle >= settings.feedbackAfterDays) {
            // Respetar separación mínima entre el rescate y la encuesta (anti-fatiga)
            const lastSent = toDate(quote.closerLastSentAt);
            const gap = settings.feedbackAfterDays - settings.rescueAfterDays;
            if (!lastSent || daysBetween(lastSent, now) >= gap) stage = 'feedback';
        }
        if (!stage) continue;

        const recipient = opts.testPhone || quote.customerPhone || '';
        if (!recipient) { result.skipped.push({ quoteId: quote.id, reason: 'Cliente sin teléfono' }); continue; }

        // Un solo mensaje por cliente por corrida (evita bombardear a quien tiene varias cotizaciones)
        const customerKey = custKey(quote);
        if (contactedCustomers.has(customerKey)) {
            result.skipped.push({ quoteId: quote.id, reason: 'Cliente ya contactado en esta corrida (cotización más reciente)' });
            continue;
        }
        const lastContact = lastContactByCustomer.get(customerKey);
        if (lastContact && daysBetween(lastContact, now) < MIN_DAYS_BETWEEN_CONTACTS) {
            result.skipped.push({ quoteId: quote.id, reason: `Cliente contactado hace ${daysBetween(lastContact, now)} día(s) (anti-fatiga)` });
            continue;
        }
        contactedCustomers.add(customerKey);

        result.eligible++;

        const items = await loadQuoteItems(firestore, quote);
        const quotedIds = new Set(items.map((i: any) => i.productId));
        const productNames = items
            .map((i: any) => productById.get(i.productId)?.name || i.name || i.productName)
            .filter(Boolean) as string[];

        // Venta cruzada: misma categoría, con stock, no cotizado, más vendidos primero
        const categories = new Set(items.map((i: any) => productById.get(i.productId)?.category).filter(Boolean));
        const crossSell: string[] = stage === 'rescate'
            ? products
                .filter(p => categories.has(p.category) && !quotedIds.has(p.id) && Number(p.stockLevel || 0) > 0)
                .sort((a, b) => Number(b.totalSold || 0) - Number(a.totalSold || 0))
                .slice(0, 2)
                .map(p => p.name)
            : [];

        const total = Number(quote.totalAmount || 0);
        // Se respetan los % congelados en la cotización (lo que el cliente vio en su PDF); si no existen, la política vigente
        const snapDivisas = Number(quote.bcvDiscountSnapshot);
        const snapContado = Number(quote.earlyPayment7dSnapshot);
        const quotePolicy: CommercialPolicy = {
            divisasDiscountPct: snapDivisas > 0 && snapDivisas < 100 ? snapDivisas : policy.divisasDiscountPct,
            contadoDiscountPct: snapContado > 0 && snapContado < 100 ? snapContado : policy.contadoDiscountPct,
        };
        const incentive = stage === 'rescate' ? buildIncentive(total, quotePolicy) : undefined;
        const msgParams: MsgParams = {
            stage,
            customerName: quote.customerName || 'Cliente',
            quoteCode: String(quote.id).substring(0, 7).toUpperCase(),
            total,
            productNames,
            crossSell,
            incentive,
            salesperson: quote.salespersonName || 'Athleticenter',
        };

        const geminiText = await writeWithGemini(settings.geminiModel, msgParams);
        const message = geminiText || templateMessage(msgParams);

        const entry: CloserQuoteResult = {
            quoteId: quote.id,
            customerName: msgParams.customerName,
            totalAmount: total,
            daysIdle,
            stage,
            incentive,
            crossSell,
            message,
            generatedBy: geminiText ? 'gemini' : 'plantilla',
            recipient,
            sent: false,
        };

        if (!dryRun) {
            try {
                const res = await dispatchUniversalWhatsApp({ phone: recipient, message, quoteId: quote.id, module: 'quotes' });
                entry.sent = !!res?.success;
                // Solo marcamos la etapa en envíos reales a clientes (no en pruebas con testPhone)
                if (entry.sent && !opts.testPhone) {
                    await updateDoc(doc(firestore, 'quotes', quote.id), {
                        closerStage: stage === 'rescate' ? 1 : 2,
                        closerLastSentAt: serverTimestamp(),
                        ...(incentive ? { closerIncentive: { ...incentive, offeredAt: new Date().toISOString() } } : {}),
                        closerHistory: arrayUnion({ stage, at: new Date().toISOString(), generatedBy: entry.generatedBy }),
                    });
                }
                if (entry.sent) result.sent++;
            } catch (e: any) {
                entry.error = e?.message || String(e);
            }
        }

        result.results.push(entry);
    }

    console.log(`[Gemini Closer] ${dryRun ? 'SIMULACIÓN' : 'EN VIVO'} — escaneadas: ${result.scanned}, elegibles: ${result.eligible}, enviadas: ${result.sent}`);
    return result;
}
