/**
 * ATHLETICENTER — PLANTILLAS ÚNICAS Y CÁLCULO CONTABLE DE WHATSAPP
 *
 * Fuente única de todos los textos que la app envía por WhatsApp a clientes,
 * equipo interno, vendedores, depósito, administración, gerencia y terceros:
 *   - Tono cercano, humano y claro ("Hola *Nombre* 👋").
 *   - Cero jerga interna ("Expediente", "Solvente", "Estatus logístico", "Tier 5%").
 *   - Nunca se menciona el nombre de un vendedor a clientes: se firma como "El equipo de Athleticenter".
 *   - Cero histórico acumulado ("totalSpent") en estados de cuenta para evitar confusiones con deudas reales.
 *   - Funciones puras (sin dependencias de servidor): sirven en navegador y en servidor.
 *
 * Política comercial vigente:
 *   1. Pagando en DIVISAS: 25% de descuento sobre el precio de lista BCV.
 *   2. Pagando la factura de CONTADO: 10% adicional sobre el subtotal en divisas.
 */

export const BRAND = 'ATHLETICENTER C.A.';
export const BRAND_SHORT = 'Athleticenter';
export const TEAM_SIGNATURE = 'El equipo de Athleticenter';
export const APP_BASE_URL = 'https://studio--studio-5015730771-8ece8.us-central1.hosted.app';
export const BILLABLE_ORDER_STATUSES = ['Despachado', 'Entregado', 'En Verificación'] as const;

export interface PaymentPolicy {
    divisasDiscountPct: number;
    contadoDiscountPct: number;
}

export const DEFAULT_PAYMENT_POLICY: PaymentPolicy = { divisasDiscountPct: 25, contadoDiscountPct: 10 };

// ─────────────── Utilidades ───────────────
export const money = (n: number | undefined | null) =>
    `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const round2 = (n: number) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

export const shortId = (id: string, len = 8) => String(id || '').replace(/^#/, '').substring(0, len).toUpperCase();

const hello = (name?: string) => `Hola *${(name || 'Cliente').trim()}* 👋\n\n`;
const sign = () => `\n\n— *${TEAM_SIGNATURE}*`;

export function humanOrderStatus(status?: string): string {
    switch (status) {
        case 'Borrador':
            return 'Borrador';
        case 'Pendiente':
            return 'Recibido (por aprobar)';
        case 'Aprobado':
            return 'Aprobado (pronto pasará a preparación)';
        case 'En Preparación':
            return 'En preparación (estamos alistando tu mercancía en depósito)';
        case 'Completado':
            return 'Listo para despacho (embalado en depósito)';
        case 'Despachado':
            return 'Despachado (en camino)';
        case 'Entregado':
            return 'Entregado';
        case 'En Verificación':
            return 'Pago en verificación';
        case 'Pagado':
            return 'Pagado al 100%';
        case 'Cancelado':
        case 'Rechazado':
            return 'Anulado';
        default:
            return status || 'En proceso';
    }
}

/** Montos de la política oficial en cascada (25% divisas, luego 10% contado). */
export function computeBenefits(listTotal: number, policy: PaymentPolicy = DEFAULT_PAYMENT_POLICY) {
    const totalDivisasUSD = round2(listTotal * (1 - policy.divisasDiscountPct / 100));
    const totalContadoUSD = round2(totalDivisasUSD * (1 - policy.contadoDiscountPct / 100));
    return { ...policy, totalDivisasUSD, totalContadoUSD };
}

export function benefitsBlock(listTotal: number, policy: PaymentPolicy = DEFAULT_PAYMENT_POLICY): string {
    const b = computeBenefits(listTotal, policy);
    return (
        `• *Pagando en divisas (-${b.divisasDiscountPct}%):* ${money(b.totalDivisasUSD)}\n` +
        `• *Contado / Pronto pago (-${b.contadoDiscountPct}% adicional):* ${money(b.totalContadoUSD)}`
    );
}

/**
 * Fuente única de cálculo contable para mensajes de WhatsApp.
 * Respeta explícitamente status === 'Pagado', abonos reales y política de divisas.
 */
export function computeOrderBalanceForWhatsApp(order: any, fallbackDivisasPct = 25): {
    isPaid: boolean;
    isBillable: boolean;
    totalListUSD: number;
    totalDivisasUSD: number;
    paidUSD: number;
    pendingListUSD: number;
    pendingDivisasUSD: number;
    divisasDiscountPct: number;
} {
    const status = String(order?.status || '');
    if (!order || ['Cancelado', 'Rechazado', 'Borrador'].includes(status)) {
        return {
            isPaid: false,
            isBillable: false,
            totalListUSD: 0,
            totalDivisasUSD: 0,
            paidUSD: 0,
            pendingListUSD: 0,
            pendingDivisasUSD: 0,
            divisasDiscountPct: fallbackDivisasPct,
        };
    }

    let paidFromArray = 0;
    if (Array.isArray(order?.payments) && order.payments.length > 0) {
        paidFromArray = order.payments.reduce((sum: number, p: any) => {
            if (p?.status === 'verified' || (!p?.status && p?.status !== 'rejected')) {
                return sum + (Number(p?.amount || p?.monto || p?.amountUSD) || 0);
            }
            return sum;
        }, 0);
    }

    const paidUSD = round2(
        paidFromArray > 0
            ? paidFromArray
            : Math.max(
                Number(order?.totalCashReceived || 0),
                Number(order?.amountPaid || 0),
                Number(order?.paidAmount || 0)
            )
    );

    const totalListUSD = round2(order?.totalAmount || 0);
    const hasFractionalNetDecimals =
        totalListUSD % 1 !== 0 && (totalListUSD.toString().split('.')[1]?.length || 0) > 2;
    const isAlreadyNet =
        order?.incentivesApplied === true ||
        order?.isNetPrice === true ||
        hasFractionalNetDecimals;

    const rawPct =
        typeof order?.bcvDiscountSnapshot === 'number'
            ? order.bcvDiscountSnapshot
            : typeof order?.treasurySnapshot?.bcvDiscountPercent === 'number'
                ? order.treasurySnapshot.bcvDiscountPercent
                : fallbackDivisasPct;

    const divisasDiscountPct = isAlreadyNet ? 0 : rawPct;
    const totalDivisasUSD = round2(totalListUSD * (1 - divisasDiscountPct / 100));

    const explicitPaid =
        status === 'Pagado' ||
        order?.isPaid === true ||
        order?.paymentStatus === 'Pagado';

    const rawPendingList = Math.max(0, round2(totalListUSD - paidUSD));
    const rawPendingDivisas = Math.max(0, round2(totalDivisasUSD - paidUSD));
    const settledByDivisas = paidUSD > 0 && rawPendingDivisas <= 0.50;

    const isPaid = explicitPaid || rawPendingList <= 0.50 || settledByDivisas;
    const pendingListUSD = isPaid ? 0 : rawPendingList;
    const pendingDivisasUSD = isPaid ? 0 : rawPendingDivisas;

    const isBillable =
        (BILLABLE_ORDER_STATUSES as readonly string[]).includes(status) &&
        !isPaid &&
        pendingListUSD > 0.50;

    return {
        isPaid,
        isBillable,
        totalListUSD,
        totalDivisasUSD,
        paidUSD,
        pendingListUSD,
        pendingDivisasUSD,
        divisasDiscountPct,
    };
}

// ─────────────── Clientes: Ventas, Pedidos y Despacho ───────────────

export function welcomeMessage(p: { name: string; creditLimit: number }): string {
    const creditLine = p.creditLimit > 0 ? `\n• *Límite de crédito disponible:* ${money(p.creditLimit)}\n` : '\n';
    return (
        hello(p.name) +
        `¡Bienvenido a *${BRAND_SHORT}*! Ya activamos tu cuenta comercial con nosotros.` +
        creditLine +
        `\nCuando quieras pedir catálogo, cotizar o hacer un pedido, escríbenos por aquí y te atendemos de una vez. 🙌` +
        sign()
    );
}

export function quoteMessage(p: {
    customerName: string;
    quoteId: string;
    itemsCount: number;
    total: number;
    validUntil?: string;
    policy?: PaymentPolicy;
}): string {
    const b = computeBenefits(p.total, p.policy);
    return (
        hello(p.customerName) +
        `Te enviamos tu cotización *#${shortId(p.quoteId)}* en PDF con los productos que solicitaste (${p.itemsCount} artículo${p.itemsCount === 1 ? '' : 's'}). 📄\n\n` +
        `• *Total (Lista BCV):* ${money(p.total)}\n` +
        `• *En divisas (-${b.divisasDiscountPct}%):* ${money(b.totalDivisasUSD)}\n` +
        `• *Contado / Pronto pago (-${b.contadoDiscountPct}% adicional):* ${money(b.totalContadoUSD)}\n` +
        (p.validUntil ? `• *Válida hasta:* ${p.validUntil}\n` : '') +
        `\nSi deseas aprobarla, responde *CONFIRMO* y la pasamos de una vez a despacho. 🙌` +
        sign()
    );
}

export function orderRegisteredMessage(p: {
    customerName: string;
    orderId: string;
    total: number;
    policy?: PaymentPolicy;
}): string {
    const b = computeBenefits(p.total, p.policy);
    return (
        hello(p.customerName) +
        `¡Ya registramos tu pedido *#${shortId(p.orderId)}*! 📦\n` +
        `Te adjuntamos la nota de pedido en PDF para tu revisión.\n\n` +
        `• *Total (Lista BCV):* ${money(p.total)}\n` +
        `• *Pagando en divisas (-${b.divisasDiscountPct}%):* ${money(b.totalDivisasUSD)}\n\n` +
        `Te iremos avisando por aquí apenas pase a preparación y despacho. 🙌` +
        sign()
    );
}

export function orderStatusMessage(p: {
    customerName: string;
    orderId: string;
    status: string;
    trackingNumber?: string;
    total: number;
    pendingDebt: number;
    paidAmount?: number;
    pendingDivisas?: number;
    isPaid?: boolean;
    isBillable?: boolean;
    policy?: PaymentPolicy;
}): string {
    const isPaid = p.isPaid === true || p.pendingDebt <= 0.50;
    const b = computeBenefits(p.total, p.policy);
    const pendingDiv = p.pendingDivisas !== undefined ? p.pendingDivisas : computeBenefits(p.pendingDebt, p.policy).totalDivisasUSD;

    let balanceLines = '';
    if (isPaid) {
        balanceLines =
            `• *Total del pedido:* ${money(p.total)}\n` +
            `• *Estado de pago:* ✅ *Pagado al 100% — Saldo $0.00*`;
    } else if (p.isBillable === false) {
        balanceLines =
            `• *Total (Lista BCV):* ${money(p.total)}\n` +
            `• *Pagando en divisas (-${b.divisasDiscountPct}%):* ${money(b.totalDivisasUSD)}` +
            (p.paidAmount && p.paidAmount > 0.05 ? `\n• *Abonado:* ${money(p.paidAmount)}` : '');
    } else {
        balanceLines =
            `• *Total del pedido:* ${money(p.total)}\n` +
            (p.paidAmount && p.paidAmount > 0.05 ? `• *Pagado:* ${money(p.paidAmount)}\n` : '') +
            `• *Saldo pendiente (Lista BCV):* ${money(p.pendingDebt)}\n` +
            `• *Pagando en divisas (-${b.divisasDiscountPct}%):* ${money(pendingDiv)}`;
    }

    return (
        hello(p.customerName) +
        `Actualización de tu pedido *#${shortId(p.orderId)}*:\n` +
        `📌 *Estado:* ${humanOrderStatus(p.status)}\n` +
        (p.trackingNumber ? `🚚 *Guía:* ${p.trackingNumber}\n` : '') +
        `\n${balanceLines}\n\n` +
        `Cualquier duda, respóndenos directamente por este chat.` +
        sign()
    );
}

export function expedienteMessage(p: {
    orderId: string;
    customerName: string;
    rif?: string;
    status: string;
    trackingNumber?: string;
    total: number;
    pendingDebt: number;
    paidAmount?: number;
    pendingDivisas?: number;
    isPaid?: boolean;
    itemsSummary: string;
    extraItems?: number;
    policy?: PaymentPolicy;
}): string {
    const isPaid = p.isPaid === true || p.pendingDebt <= 0.50;
    const b = computeBenefits(p.pendingDebt, p.policy);
    const pendingDiv = p.pendingDivisas !== undefined ? p.pendingDivisas : b.totalDivisasUSD;

    const paymentLine = isPaid
        ? `• *Saldo pendiente:* $0.00 ✅ *Pagado al 100%*`
        : `• *Saldo pendiente (Lista BCV):* ${money(p.pendingDebt)}\n• *Pagando en divisas (-${b.divisasDiscountPct}%):* ${money(pendingDiv)}`;

    return (
        hello(p.customerName) +
        `Aquí tienes el resumen de tu pedido *#${shortId(p.orderId)}*:\n` +
        `📌 *Estado:* ${humanOrderStatus(p.status)}\n` +
        (p.trackingNumber ? `🚚 *Guía:* ${p.trackingNumber}\n` : '') +
        `\n*Productos:*\n${p.itemsSummary}` +
        (p.extraItems && p.extraItems > 0 ? `\n…y ${p.extraItems} producto${p.extraItems === 1 ? '' : 's'} más.` : '') +
        `\n\n• *Total del pedido:* ${money(p.total)}\n` +
        (p.paidAmount && p.paidAmount > 0.05 ? `• *Pagado:* ${money(p.paidAmount)}\n` : '') +
        `${paymentLine}\n\n` +
        `Cualquier duda, respóndenos directamente por este chat.` +
        sign()
    );
}

export function dispatchMessage(p: {
    customerName: string;
    orderId: string;
    carrier?: string;
    trackingNumber?: string;
    packages?: number;
}): string {
    const bultos = p.packages && p.packages > 0 ? p.packages : 1;
    return (
        hello(p.customerName) +
        `¡Tu pedido *#${shortId(p.orderId)}* ya va en camino! 🚚\n\n` +
        `• *Agencia:* ${p.carrier || 'Encomienda nacional'}\n` +
        (p.trackingNumber ? `• *N° de guía:* ${p.trackingNumber}\n` : '') +
        `• *Bultos:* ${bultos} ${bultos === 1 ? 'bulto' : 'bultos'}\n\n` +
        `Apenas lo recibas, confírmanos por aquí para saber que llegó todo perfecto. 🙌` +
        sign()
    );
}

export function orderStatusChangeMessage(p: {
    customerName: string;
    orderId: string;
    newStatus: string;
    carrier?: string;
    trackingNumber?: string;
}): string {
    return (
        hello(p.customerName) +
        `Tu pedido *#${shortId(p.orderId)}* pasó a: *${humanOrderStatus(p.newStatus)}*.\n` +
        (p.carrier ? `• *Agencia:* ${p.carrier}\n` : '') +
        (p.trackingNumber ? `• *N° de guía:* ${p.trackingNumber}\n` : '') +
        `\nTe seguimos avisando por aquí cualquier novedad. 🙌` +
        sign()
    );
}

export function salesGreetingMessage(p: { customerName: string }): string {
    return (
        hello(p.customerName) +
        `Te saludamos desde *${BRAND_SHORT}*. ¿Cómo va todo por allá?\n` +
        `Esta semana tenemos reposición fresca de inventario disponible para despacho inmediato. Si necesitas catálogo o precios actualizados, avísanos por aquí y te lo enviamos de una vez. ⚽🙌` +
        sign()
    );
}

// ─────────────── Clientes: Cuenta, Pagos y Cobranza ───────────────

/**
 * Estado de cuenta claro: NUNCA imprime el histórico acumulado de compras ("totalSpent")
 * para que un cliente en $0 nunca piense que debe su historial.
 */
export function accountStatementMessage(p: {
    customerName: string;
    rif?: string;
    totalSpent?: number;
    pendingBalance: number;
    pendingDivisasBalance?: number;
    openInvoicesCount?: number;
    creditLimit?: number;
    policy?: PaymentPolicy;
}): string {
    if (p.pendingBalance <= 0.50) {
        return (
            hello(p.customerName) +
            `Te compartimos tu estado de cuenta con *${BRAND_SHORT}*:\n\n` +
            `✅ *Tu cuenta está al día.*\n` +
            `• Saldo pendiente hoy: *$0.00*\n\n` +
            `¡Gracias por tu confianza! Cuando necesites reponer mercancía, escríbenos por aquí y te atendemos de una vez. 🙌` +
            sign()
        );
    }

    const b = computeBenefits(p.pendingBalance, p.policy);
    const divisasBalance = p.pendingDivisasBalance !== undefined ? p.pendingDivisasBalance : b.totalDivisasUSD;

    return (
        hello(p.customerName) +
        `Te compartimos tu resumen de cuenta al día de hoy en *${BRAND_SHORT}*:\n\n` +
        `• *Saldo pendiente (Lista BCV):* ${money(p.pendingBalance)}\n` +
        `• *Pagando en divisas (-${b.divisasDiscountPct}%):* ${money(divisasBalance)}\n` +
        (p.openInvoicesCount && p.openInvoicesCount > 0 ? `• *Facturas abiertas:* ${p.openInvoicesCount}\n` : '') +
        `\nSi ya realizaste algún pago, envíanos el comprobante por aquí para actualizar tu cuenta de inmediato. 🙌` +
        sign()
    );
}

export function paymentReceiptMessage(p: {
    customerName: string;
    orderId: string;
    amountPaid: number;
    method: string;
    referenceNumber?: string;
    isFullyPaid: boolean;
    remainingListUSD?: number;
    remainingDivisasUSD?: number;
    receiptCode?: string;
    hasPdfAttachment?: boolean;
    policy?: PaymentPolicy;
}): string {
    const isPaid = p.isFullyPaid || (p.remainingListUSD !== undefined && p.remainingListUSD <= 0.50);
    const remList = p.remainingListUSD || 0;
    const remDiv =
        p.remainingDivisasUSD !== undefined
            ? p.remainingDivisasUSD
            : computeBenefits(remList, p.policy).totalDivisasUSD;
    const pct = (p.policy || DEFAULT_PAYMENT_POLICY).divisasDiscountPct;

    const statusBlock = isPaid
        ? `• *Estado del pedido:* ✅ *Pagado al 100% — Saldo $0.00*`
        : `• *Estado del pedido:* ⏳ Abono registrado\n` +
          `• *Saldo pendiente (Lista BCV):* ${money(remList)}\n` +
          `• *Saldo en divisas (-${pct}%):* ${money(remDiv)}`;

    const refPart = p.referenceNumber && p.referenceNumber !== 'N/A' ? ` · Ref: ${p.referenceNumber}` : '';
    const receiptLine = p.hasPdfAttachment
        ? `¡Recibimos tu pago! Aquí tienes tu recibo en PDF adjunto. 📄\n\n`
        : `¡Confirmamos tu pago${p.receiptCode ? ` (${p.receiptCode})` : ''}! 📄\n\n`;

    return (
        hello(p.customerName) +
        receiptLine +
        `• *Pedido:* #${shortId(p.orderId)}\n` +
        `• *Monto recibido:* ${money(p.amountPaid)} (${p.method}${refPart})\n` +
        `${statusBlock}\n\n` +
        `¡Muchas gracias por tu puntualidad! 🙌` +
        sign()
    );
}

export function billingReminderMessage(p: {
    customerName: string;
    invoiceId: string;
    remainingBalance: number;
    remainingDivisas?: number;
    statusText?: string;
    isPaid?: boolean;
    policy?: PaymentPolicy;
}): string {
    if (p.isPaid || p.remainingBalance <= 0.50) {
        return (
            hello(p.customerName) +
            `Confirmamos que tu pedido *#${shortId(p.invoiceId)}* está ✅ *Pagado al 100% (Saldo $0.00)*.\n\n` +
            `¡Muchas gracias por tu confianza y puntualidad! 🙌` +
            sign()
        );
    }

    const b = computeBenefits(p.remainingBalance, p.policy);
    const divisas = p.remainingDivisas !== undefined ? p.remainingDivisas : b.totalDivisasUSD;

    return (
        hello(p.customerName) +
        `Te escribimos para recordarte amablemente que tienes un saldo pendiente en tu pedido *#${shortId(p.invoiceId)}*:\n\n` +
        `• *Saldo pendiente (Lista BCV):* ${money(p.remainingBalance)}\n` +
        `• *Pagando en divisas (-${b.divisasDiscountPct}%):* ${money(divisas)}\n` +
        (p.statusText ? `• *Situación:* ${p.statusText}\n` : '') +
        `\nSi ya realizaste el pago, compártenos el comprobante por aquí para registrarlo. ¡Gracias! 🙌` +
        sign()
    );
}

export type DebtTone = 'amable' | 'firme' | 'urgente';

export function debtToneForAge(oldestDays: number): DebtTone {
    if (oldestDays >= 30) return 'urgente';
    if (oldestDays >= 15) return 'firme';
    return 'amable';
}

/** UN solo mensaje por cliente agrupando sus facturas pendientes con opción en divisas. */
export function debtReminderMessage(p: {
    customerName: string;
    invoices: { id: string; pending: number; days: number }[];
    tone?: DebtTone;
    policy?: PaymentPolicy;
}): string {
    const total = round2(p.invoices.reduce((s, i) => s + i.pending, 0));
    const oldest = p.invoices.reduce((m, i) => Math.max(m, i.days), 0);
    const tone = p.tone || debtToneForAge(oldest);
    const b = computeBenefits(total, p.policy);

    const lines = [...p.invoices]
        .sort((a, b2) => b2.days - a.days)
        .slice(0, 6)
        .map(i => `• Pedido *#${shortId(i.id)}* — ${money(i.pending)} (${i.days} días)`)
        .join('\n');
    const more = p.invoices.length > 6 ? `\n…y ${p.invoices.length - 6} pedido${p.invoices.length - 6 === 1 ? '' : 's'} más.` : '';

    const intro =
        tone === 'urgente'
            ? `Tienes facturas pendientes que superan los *30 días*. Para mantener activo tu crédito comercial, te agradecemos ponerte al día lo antes posible:`
            : tone === 'firme'
                ? `Te recordamos que mantienes un saldo vencido pendiente por cancelar en *${BRAND_SHORT}*:`
                : `Te escribimos para recordarte amablemente que tienes pendiente el siguiente saldo con *${BRAND_SHORT}*:`;

    return (
        hello(p.customerName) +
        `${intro}\n\n${lines}${more}\n\n` +
        `• *Total pendiente (Lista BCV):* ${money(total)}\n` +
        `• *Pagando en divisas (-${b.divisasDiscountPct}%):* ${money(b.totalDivisasUSD)}\n\n` +
        `Si ya realizaste el pago, envíanos el comprobante por aquí para actualizar tu cuenta de inmediato. ¡Gracias! 🙌` +
        sign()
    );
}

export function earlyPaymentSavingsMessage(p: {
    customerName: string;
    orderId: string;
    totalDivisasUSD: number;
    totalContadoUSD: number;
    deadlineLabel: string;
    hoursRemaining: number;
}): string {
    const savingsUSD = round2(Math.max(0, p.totalDivisasUSD - p.totalContadoUSD));
    const timeNote =
        p.hoursRemaining <= 12
            ? '¡Últimas horas para aprovechar el *10% de descuento adicional por pronto pago*!'
            : p.hoursRemaining <= 24
                ? 'Te queda menos de 1 día para aprovechar el *10% de descuento adicional por pronto pago*.'
                : 'Todavía estás a tiempo de aprovechar el *10% de descuento adicional por pronto pago*.';

    return (
        hello(p.customerName) +
        `Te recordamos que en tu pedido *#${shortId(p.orderId)}* ${timeNote}\n\n` +
        `• *Total normal en divisas:* ${money(p.totalDivisasUSD)}\n` +
        `• *Pagando de contado antes del ${p.deadlineLabel}:* *${money(p.totalContadoUSD)}* (te ahorras *${money(savingsUSD)}*)\n\n` +
        `Si quieres aprovecharlo, envíanos el comprobante por aquí y lo aplicamos de inmediato. 🙌` +
        sign()
    );
}

// ─────────────── Mensajes Internos: Equipo, Vendedores y Terceros ───────────────

export function internalNoticeMessage(title: string, message: string, link?: string): string {
    const cleanLink = link && link !== '#' && link.startsWith('/') ? `\n\n🔗 Abrir en la app: ${APP_BASE_URL}${link}` : '';
    return `🔔 *${BRAND_SHORT} — Aviso Interno*\n\n*${title}*\n${message}${cleanLink}`;
}

export function commissionPaidMessage(p: {
    salespersonName: string;
    totalUSD: number;
    totalBs: number;
    operationsCount: number;
    accountName: string;
    referenceNumber: string;
}): string {
    const bsFormatted = Number(p.totalBs || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (
        hello(p.salespersonName) +
        `¡Ya liquidamos tus comisiones! Te adjuntamos tu recibo en PDF. 📄💵\n\n` +
        `• *Total liquidado:* ${money(p.totalUSD)} (Bs. ${bsFormatted} a tasa BCV)\n` +
        `• *Operaciones incluidas:* ${p.operationsCount} venta${p.operationsCount === 1 ? '' : 's'}\n` +
        `• *Cuenta / Medio:* ${p.accountName}\n` +
        `• *Referencia:* ${p.referenceNumber || 'N/A'}\n\n` +
        `¡Excelente trabajo! Seguimos sumando. 🙌`
    );
}

export function commissionBalanceMessage(p: { salespersonName: string; pendingUSD: number }): string {
    return (
        hello(p.salespersonName) +
        `Te avisamos que ya tienes *${money(p.pendingUSD)}* en comisiones acumuladas disponibles por liquidar. 📈\n\n` +
        `Puedes ver el desglose por pedido aquí:\n${APP_BASE_URL}/dashboard/commissions`
    );
}

export function pendingReconciliationAlertMessage(p: {
    adminName: string;
    pendingCount: number;
    totalAmountUSD: number;
    items: { orderId: string; customerName: string; amount: number }[];
}): string {
    const lines = p.items
        .slice(0, 6)
        .map(item => `• ${item.customerName} — *${money(item.amount)}* (#${shortId(item.orderId)})`)
        .join('\n');
    const more = p.items.length > 6 ? `\n…y ${p.items.length - 6} más.` : '';

    return (
        hello(p.adminName) +
        `Tienes *${p.pendingCount} abono${p.pendingCount === 1 ? '' : 's'} pendiente${p.pendingCount === 1 ? '' : 's'} por verificar* en Tesorería por un total de *${money(p.totalAmountUSD)}*:\n\n` +
        `${lines}${more}\n\n` +
        `🔗 Revisar y aprobar aquí:\n${APP_BASE_URL}/dashboard/treasury`
    );
}

export function dailyBriefingSalespersonMessage(p: {
    name: string;
    dateLabel: string;
    pendingReceivablesUSD: number;
    dueSoonCount: number;
    dueSoonUSD: number;
    moraCount: number;
    moraUSD: number;
    inPreparationCount: number;
    deliveredYesterdayCount: number;
    deliveredYesterdayUSD: number;
    inactiveClients: string[];
}): string {
    const inactiveLine =
        p.inactiveClients.length > 0
            ? `• ${p.inactiveClients.slice(0, 3).join(', ')}${p.inactiveClients.length > 3 ? ` (+${p.inactiveClients.length - 3} más)` : ''}\n(Buen momento para escribirles hoy 🙌)`
            : '• Toda tu cartera compró recientemente. ¡Buen ritmo!';

    return (
        `Buenos días, *${p.name}* 👋\n` +
        `Tu resumen comercial de hoy (*${p.dateLabel}*):\n\n` +
        `💰 *Tu cobranza:*\n` +
        `• Pendiente total: *${money(p.pendingReceivablesUSD)}*\n` +
        `• Por vencer (próximos 3 días): *${p.dueSoonCount} factura${p.dueSoonCount === 1 ? '' : 's'} (${money(p.dueSoonUSD)})*\n` +
        `• Vencidas (+30 días): *${p.moraCount} cliente${p.moraCount === 1 ? '' : 's'} (${money(p.moraUSD)})*\n\n` +
        `📦 *Tus pedidos:*\n` +
        `• En preparación / por despachar: *${p.inPreparationCount} pedido${p.inPreparationCount === 1 ? '' : 's'}*\n` +
        `• Entregados ayer: *${p.deliveredYesterdayCount} pedido${p.deliveredYesterdayCount === 1 ? '' : 's'} (${money(p.deliveredYesterdayUSD)})*\n\n` +
        `🎯 *Clientes sin pedir hace +10 días:*\n${inactiveLine}\n\n` +
        `🔗 Ver tu panel:\n${APP_BASE_URL}/dashboard/orders`
    );
}

export function dailyBriefingWarehouseMessage(p: {
    name: string;
    dateLabel: string;
    toPrepareCount: number;
    readyToShipCount: number;
    missingTrackingCount: number;
    dispatchedYesterdayCount: number;
}): string {
    return (
        `Buenos días, *${p.name}* 👋\n` +
        `Tu agenda de despacho para hoy (*${p.dateLabel}*):\n\n` +
        `📦 *Pendiente en depósito:*\n` +
        `• Por armar / embalar: *${p.toPrepareCount} pedido${p.toPrepareCount === 1 ? '' : 's'}*\n` +
        `• Listos para asignar transporte: *${p.readyToShipCount} pedido${p.readyToShipCount === 1 ? '' : 's'}*\n` +
        `• Despachados sin número de guía cargado: *${p.missingTrackingCount} pedido${p.missingTrackingCount === 1 ? '' : 's'}*\n\n` +
        `🚚 *Resumen de ayer:*\n` +
        `• *${p.dispatchedYesterdayCount} pedido${p.dispatchedYesterdayCount === 1 ? '' : 's'}* despachado${p.dispatchedYesterdayCount === 1 ? '' : 's'} exitosamente.\n\n` +
        `🔗 Abrir tablero de despacho:\n${APP_BASE_URL}/dashboard/dispatch`
    );
}

export function dailyBriefingAdminMessage(p: {
    name: string;
    dateLabel: string;
    bcvRate: number;
    pendingVerificationCount: number;
    pendingVerificationUSD: number;
    paymentsYesterdayCount: number;
    paymentsYesterdayUSD: number;
    moraUSD: number;
    moraCount: number;
}): string {
    return (
        `Buenos días, *${p.name}* 👋\n` +
        `Resumen de Administración y Cobranza (*${p.dateLabel}*):\n\n` +
        `📈 *Tasa BCV vigente:* ${p.bcvRate > 0 ? `Bs. ${p.bcvRate.toFixed(2)} / USD` : 'Sincronizada'}\n\n` +
        `🏦 *Pendiente por revisar hoy:*\n` +
        `• Abonos por conciliar: *${p.pendingVerificationCount} pago${p.pendingVerificationCount === 1 ? '' : 's'} (${money(p.pendingVerificationUSD)})*\n` +
        `• Pagos registrados ayer: *${p.paymentsYesterdayCount} pago${p.paymentsYesterdayCount === 1 ? '' : 's'} (${money(p.paymentsYesterdayUSD)})*\n\n` +
        `🔴 *Cobranza vencida (+30 días):*\n` +
        `• *${money(p.moraUSD)}* en *${p.moraCount} factura${p.moraCount === 1 ? '' : 's'}*\n\n` +
        `🔗 Ir a Tesorería:\n${APP_BASE_URL}/dashboard/treasury`
    );
}

export function dailyBriefingExecutiveMessage(p: {
    name: string;
    dateLabel: string;
    bcvRate: number;
    ordersYesterdayCount: number;
    ordersYesterdayUSD: number;
    dispatchedYesterdayCount: number;
    dispatchedYesterdayUSD: number;
    paymentsYesterdayCount: number;
    paymentsYesterdayUSD: number;
    pendingVerificationCount: number;
    pendingVerificationUSD: number;
    moraCount: number;
    moraUSD: number;
    lowStockCount: number;
    firstLowStockProduct?: { name: string; stock: number };
}): string {
    const stockLine =
        p.lowStockCount > 0 && p.firstLowStockProduct
            ? `• *${p.lowStockCount} producto${p.lowStockCount === 1 ? '' : 's'}* con pocas unidades (ej. ${p.firstLowStockProduct.name}: ${p.firstLowStockProduct.stock} und.)`
            : '• Inventario con stock saludable en todo el catálogo.';

    return (
        `Buenos días, *${p.name}* 👋\n` +
        `Resumen ejecutivo de *${BRAND_SHORT}* (*${p.dateLabel}*):\n\n` +
        `📈 *Tasa BCV:* ${p.bcvRate > 0 ? `Bs. ${p.bcvRate.toFixed(2)} / USD` : 'Sincronizada'}\n\n` +
        `📊 *Movimiento de ayer:*\n` +
        `• Pedidos nuevos: *${p.ordersYesterdayCount}* (*${money(p.ordersYesterdayUSD)}*)\n` +
        `• Pedidos despachados: *${p.dispatchedYesterdayCount}* (*${money(p.dispatchedYesterdayUSD)}*)\n` +
        `• Cobros registrados: *${p.paymentsYesterdayCount}* (*${money(p.paymentsYesterdayUSD)}*)\n\n` +
        `💰 *Caja y cobranza hoy:*\n` +
        `• Pagos por verificar: *${p.pendingVerificationCount}* (*${money(p.pendingVerificationUSD)}*)\n` +
        `• Mora (+30 días): *${p.moraCount} cuenta${p.moraCount === 1 ? '' : 's'}* (*${money(p.moraUSD)}*)\n\n` +
        `📦 *Inventario bajo:*\n${stockLine}\n\n` +
        `🔗 Ver dashboard en vivo:\n${APP_BASE_URL}/dashboard`
    );
}

export function morningBrainBriefingMessage(p: {
    netWalletLiquidityUSD: number;
    runwayMonths: number;
    totalCashVerified: number;
    totalPipelineUSD: number;
    paidExpensesThisMonthUSD: number;
    monthlyFixedExpensesUSD: number;
    totalMoneyFoundUSD: number;
    accountsReceivableUSD: number;
    overdueCount: number;
    openQuotesPipelineUSD: number;
    staleQuotesCount: number;
    approvalQueueCount: number;
}): string {
    return (
        `Buenos días 👋 — *Resumen de Gerencia (7:00 AM)*\n\n` +
        `💵 *Caja disponible:* ${money(p.netWalletLiquidityUSD)} (cubre ~${p.runwayMonths.toFixed(1)} meses de gastos fijos)\n` +
        `✅ *Cobrado verificado:* ${money(p.totalCashVerified)}\n` +
        `📈 *Pedidos en curso:* ${money(p.totalPipelineUSD)}\n` +
        `🏢 *Gastos fijos del mes:* ${money(p.paidExpensesThisMonthUSD)} pagados de ${money(p.monthlyFixedExpensesUSD)}\n\n` +
        `🎯 *Oportunidades para recuperar hoy: ${money(p.totalMoneyFoundUSD)}*\n` +
        `• Cuentas por cobrar: *${money(p.accountsReceivableUSD)}* (${p.overdueCount} en seguimiento)\n` +
        `• Cotizaciones sin respuesta: *${money(p.openQuotesPipelineUSD)}* (${p.staleQuotesCount} abiertas)\n` +
        `• Decisiones pendientes por tu aprobación: *${p.approvalQueueCount}*`
    );
}

export function criticalAuditAlertMessage(p: {
    userName: string;
    userRole?: string;
    actionLabel: string;
    moduleLabel: string;
    details: string;
    dateLabel: string;
}): string {
    return (
        `🚨 *Alerta de Auditoría — ${BRAND_SHORT}*\n\n` +
        `Se realizó una acción sensible en el sistema:\n\n` +
        `• *Usuario:* ${p.userName} (${p.userRole || 'Admin'})\n` +
        `• *Acción:* ${p.actionLabel}\n` +
        `• *Módulo:* ${p.moduleLabel}\n` +
        `• *Detalle:* ${p.details}\n` +
        `• *Fecha:* ${p.dateLabel}\n\n` +
        `🔗 Ver registro completo:\n${APP_BASE_URL}/dashboard/audit`
    );
}

export function carrierInquiryMessage(carrierName: string): string {
    return `Hola equipo de *${carrierName}* 👋, les escribimos desde *${BRAND_SHORT}* para consultar el estatus de nuestras guías y despachos pendientes. ¡Gracias!`;
}

export function supplierInquiryMessage(contactOrName: string): string {
    return `Hola *${contactOrName}* 👋, te saludamos desde *${BRAND_SHORT}*. Queríamos consultar disponibilidad actual de inventario y tiempos de entrega. ¡Gracias!`;
}

export function clientToSalespersonMessage(salespersonName: string, companyName: string): string {
    return `Hola *${salespersonName}* 👋, te escribe *${companyName}* desde la plataforma de ${BRAND_SHORT}. Quiero consultar sobre un pedido / cotización.`;
}

export function whatsappTestMessage(dateLabel?: string): string {
    return (
        `Hola 👋 — *Prueba de WhatsApp de ${BRAND_SHORT}*\n\n` +
        `Este es un mensaje de verificación enviado correctamente desde el sistema.\n` +
        `• *Fecha:* ${dateLabel || new Date().toLocaleString('es-VE')}\n` +
        `• *Estado:* Conexión activa ✅`
    );
}
