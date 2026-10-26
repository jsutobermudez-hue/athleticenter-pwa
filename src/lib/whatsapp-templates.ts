/**
 * ATHLETICENTER — PLANTILLAS ÚNICAS DE WHATSAPP
 *
 * Fuente única de todos los textos que la app envía a clientes:
 *   - Misma cabecera, mismo tono (usted, profesional y cercano) y misma firma.
 *   - Nunca se menciona el nombre de un vendedor: se firma como "el equipo de Athleticenter".
 *   - Funciones puras (sin dependencias de servidor): sirven en navegador y en servidor.
 *
 * Política comercial vigente (se refleja en las propuestas):
 *   1. Pagando en DIVISAS: 25% de descuento sobre el precio de lista.
 *   2. Pagando la factura de CONTADO: 10% adicional sobre el subtotal en divisas.
 */

export const BRAND = 'ATHLETICENTER C.A.';
export const TEAM_SIGNATURE = 'El equipo de Athleticenter';

export interface PaymentPolicy {
    divisasDiscountPct: number;
    contadoDiscountPct: number;
}

export const DEFAULT_PAYMENT_POLICY: PaymentPolicy = { divisasDiscountPct: 25, contadoDiscountPct: 10 };

// ─────────────── Utilidades ───────────────
export const money = (n: number | undefined | null) =>
    `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const round2 = (n: number) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

export const shortId = (id: string, len = 8) => String(id || '').substring(0, len).toUpperCase();

const head = (title: string) => `*${BRAND} — ${title}*\n\n`;
const hello = (name: string) => `Estimado(a) *${name || 'Cliente'}*,\n\n`;
const foot = (closing: string) => `\n\n${closing}\n\n_${TEAM_SIGNATURE}_`;

/** Montos de la política oficial en cascada (25% divisas, luego 10% contado). */
export function computeBenefits(listTotal: number, policy: PaymentPolicy = DEFAULT_PAYMENT_POLICY) {
    const totalDivisasUSD = round2(listTotal * (1 - policy.divisasDiscountPct / 100));
    const totalContadoUSD = round2(totalDivisasUSD * (1 - policy.contadoDiscountPct / 100));
    return { ...policy, totalDivisasUSD, totalContadoUSD };
}

export function benefitsBlock(listTotal: number, policy: PaymentPolicy = DEFAULT_PAYMENT_POLICY): string {
    const b = computeBenefits(listTotal, policy);
    return (
        `💵 *Pagando en divisas* (${b.divisasDiscountPct}% de descuento): *${money(b.totalDivisasUSD)}*\n` +
        `✅ *Pagando la factura de contado* (${b.contadoDiscountPct}% adicional): *${money(b.totalContadoUSD)}*`
    );
}

// ─────────────── Ventas ───────────────
export function quoteMessage(p: {
    customerName: string; quoteId: string; itemsCount: number; total: number;
    validUntil?: string; policy?: PaymentPolicy;
}): string {
    return (
        head('PROPUESTA COMERCIAL') + hello(p.customerName) +
        `Le hacemos llegar la propuesta comercial *#${shortId(p.quoteId)}*:\n\n` +
        `📦 *Productos incluidos:* ${p.itemsCount}\n` +
        `💰 *Precio de lista:* ${money(p.total)} USD\n` +
        (p.validUntil ? `📅 *Validez de la oferta:* hasta el ${p.validUntil}\n` : '') +
        `\n${benefitsBlock(p.total, p.policy)}` +
        foot('Quedamos atentos para formalizar su pedido. ¡Gracias por su preferencia!')
    );
}

export function orderRegisteredMessage(p: { customerName: string; orderId: string; total: number }): string {
    return (
        head('PEDIDO REGISTRADO') + hello(p.customerName) +
        `Confirmamos que hemos registrado exitosamente su pedido *#${p.orderId}*.\n\n` +
        `💰 *Total:* ${money(p.total)} USD\n\n` +
        `Adjuntamos la Nota de Pedido correspondiente en PDF.` +
        foot('¡Muchas gracias por su preferencia!')
    );
}

export function welcomeMessage(p: { name: string; creditLimit: number }): string {
    return (
        head('BIENVENIDA') + hello(p.name) +
        `Hemos registrado su ficha comercial en nuestro sistema:\n\n` +
        `💳 *Límite de crédito:* ${money(p.creditLimit)} USD\n\n` +
        `Quedamos a su entera disposición para gestionar sus pedidos y consultas.` +
        foot('¡Gracias por confiar en nosotros!')
    );
}

// ─────────────── Pedidos y logística ───────────────
export function orderStatusMessage(p: {
    customerName: string; orderId: string; status: string; trackingNumber?: string;
    total: number; pendingDebt: number;
}): string {
    return (
        head('ESTATUS DE SU PEDIDO') + hello(p.customerName) +
        `Le informamos sobre su pedido *#${shortId(p.orderId)}*:\n\n` +
        `📦 *Estatus actual:* ${String(p.status || '').toUpperCase()}\n` +
        (p.trackingNumber ? `🚚 *Guía / Tracking:* ${p.trackingNumber}\n` : '') +
        `💰 *Monto total:* ${money(p.total)} USD\n` +
        (p.pendingDebt > 0.05 ? `⚠️ *Saldo pendiente:* ${money(p.pendingDebt)} USD\n` : `✅ *Estado de pago:* Al día\n`) +
        foot('¿Desea consultar alguna novedad? Estamos a su entera disposición.')
    );
}

export function expedienteMessage(p: {
    orderId: string; customerName: string; rif?: string; status: string; trackingNumber?: string;
    total: number; pendingDebt: number; itemsSummary: string; extraItems?: number;
}): string {
    return (
        head(`EXPEDIENTE #${shortId(p.orderId)}`) +
        `👤 *Cliente:* ${p.customerName}\n` +
        `📍 *RIF:* ${p.rif || 'S/D'}\n` +
        `📦 *Estatus logístico:* ${String(p.status || '').toUpperCase()}\n` +
        (p.trackingNumber ? `🚚 *Guía / Tracking:* ${p.trackingNumber}\n` : '') +
        `💰 *Total facturado:* ${money(p.total)} USD\n` +
        (p.pendingDebt > 0.05 ? `⚠️ *Saldo pendiente:* ${money(p.pendingDebt)} USD\n` : `✅ *Estado financiero:* Solvente\n`) +
        `\n*Resumen de productos:*\n${p.itemsSummary}` +
        (p.extraItems && p.extraItems > 0 ? `\n…y ${p.extraItems} más.` : '') +
        foot('Quedamos atentos a cualquier solicitud. ¡Gracias por confiar en Athleticenter!')
    );
}

export function dispatchMessage(p: {
    customerName: string; orderId: string; carrier?: string; trackingNumber?: string; packages?: number;
}): string {
    return (
        head('SU PEDIDO FUE DESPACHADO') + hello(p.customerName) +
        `Su pedido *#${shortId(p.orderId)}* ha sido despachado:\n\n` +
        `🚚 *Transporte:* ${p.carrier || 'Encomienda nacional'}\n` +
        `📍 *Guía / Tracking:* ${p.trackingNumber || 'S/D'}\n` +
        `📦 *Bultos:* ${p.packages || 1}` +
        foot('Quedamos atentos a su confirmación de recepción. ¡Muchas gracias!')
    );
}

export function accountStatementMessage(p: {
    customerName: string; rif?: string; totalSpent: number; pendingBalance: number; creditLimit: number;
}): string {
    return (
        head('ESTADO DE CUENTA') + hello(p.customerName) +
        `Le enviamos el resumen de su cuenta:\n\n` +
        `📄 *RIF:* ${p.rif || 'S/D'}\n` +
        `📊 *Total comprado:* ${money(p.totalSpent)} USD\n` +
        (p.pendingBalance > 0.05 ? `💰 *Saldo pendiente:* ${money(p.pendingBalance)} USD\n` : `✅ *Estado de cuenta:* Al día\n`) +
        `💳 *Límite de crédito:* ${money(p.creditLimit)} USD` +
        foot('¿Desea realizar algún requerimiento de reposición de mercancía? Quedamos a sus órdenes.')
    );
}

export function salesGreetingMessage(p: { customerName: string }): string {
    return (
        head('SALUDO COMERCIAL') + hello(p.customerName) +
        `Le saludamos del equipo comercial de Athleticenter. Quedamos a su disposición para apoyarle con nuevos requerimientos o cotizaciones.` +
        foot('¡Esperamos poder atenderle pronto!')
    );
}

// ─────────────── Cobranza ───────────────
export function billingReminderMessage(p: {
    customerName: string; invoiceId: string; remainingBalance: number; statusText: string;
}): string {
    return (
        head('RECORDATORIO DE PAGO') + hello(p.customerName) +
        `Le recordamos el estado de su expediente de facturación:\n\n` +
        `📄 *Expediente:* #${shortId(p.invoiceId)}\n` +
        `💰 *Saldo pendiente:* ${money(p.remainingBalance)} USD\n` +
        `📅 *Estado:* ${p.statusText}\n\n` +
        `Agradecemos el envío de su comprobante de pago para proceder con la conciliación.` +
        foot('¡Muchas gracias por su preferencia!')
    );
}

export type DebtTone = 'amable' | 'firme' | 'urgente';

export function debtToneForAge(oldestDays: number): DebtTone {
    if (oldestDays >= 30) return 'urgente';
    if (oldestDays >= 15) return 'firme';
    return 'amable';
}

/** UN solo mensaje por cliente con todas sus facturas pendientes. */
export function debtReminderMessage(p: {
    customerName: string;
    invoices: { id: string; pending: number; days: number }[];
    tone?: DebtTone;
}): string {
    const total = round2(p.invoices.reduce((s, i) => s + i.pending, 0));
    const oldest = p.invoices.reduce((m, i) => Math.max(m, i.days), 0);
    const tone = p.tone || debtToneForAge(oldest);
    const lines = [...p.invoices].sort((a, b) => b.days - a.days).slice(0, 6)
        .map(i => `• #${shortId(i.id, 7)} — ${money(i.pending)} (${i.days} días)`).join('\n');
    const more = p.invoices.length > 6 ? `\n…y ${p.invoices.length - 6} más.` : '';

    const intro =
        tone === 'urgente'
            ? `Su cuenta presenta saldos con *más de 30 días de antigüedad*. Para mantener habilitado su crédito, le solicitamos regularizar *a la brevedad*:`
            : tone === 'firme'
                ? `Le recordamos que su cuenta mantiene saldos vencidos pendientes por conciliar. Le solicitamos su reporte de pago:`
                : `Le recordamos amablemente que su cuenta presenta un saldo pendiente por conciliar:`;

    return (
        head('AVISO DE SALDO PENDIENTE') + hello(p.customerName) +
        `${intro}\n\n${lines}${more}\n\n` +
        `💰 *Total pendiente:* ${money(total)} USD\n` +
        `⏱️ *Antigüedad máxima:* ${oldest} días\n\n` +
        `Puede responder este mensaje con su comprobante de pago y lo conciliamos de inmediato.` +
        foot('¡Gracias por su apoyo!')
    );
}

// ─────────────── Avisos internos (solo personal) ───────────────
export function internalNoticeMessage(title: string, message: string): string {
    return `🔔 *${BRAND} — AVISO INTERNO*\n\n*${title}*\n\n${message}`;
}
