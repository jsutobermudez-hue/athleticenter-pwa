import { ai } from '@/ai/genkit';
import { jsPDF } from 'jspdf';
import { initializeFirebaseServer, ensureServerAuth } from '@/firebase/server-init';
import {
    collection,
    getDocs,
    query,
    limit,
    doc,
    getDoc,
    addDoc,
    serverTimestamp,
    orderBy
} from 'firebase/firestore';
import { createAppNotifications } from '@/lib/notifications';
import { formatVenezuelaPhoneE164 } from '@/lib/whatsapp-gateway';
import type { Customer, Product } from '@/lib/definitions';

export interface ArmInboundInput {
    phone: string;
    messageText: string;
}

export interface ArmInboundResult {
    success: boolean;
    replyText: string;
    pdfBase64?: string;
    pdfUrl?: string;
    pdfSizeBytes?: number;
    pdfFileName?: string;
    imageUrl?: string;
    extraPhotos?: Array<{ imageUrl: string; caption: string }>;
    leadQualified?: boolean;
    handoffTriggered?: boolean;
    matchedProductsCount?: number;
    error?: string;
}

interface ProductMatch {
    docId: string;
    name: string;
    sku: string;
    brand: string;
    discipline: string;
    category: string;
    stock: number;
    priceLista: number;
    priceDivisas: number;
    priceProntoPago: number;
}

function money(amount: number): string {
    return `$${Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function normalizeText(text: string): string {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\b(valones|valon|pelotas|pelota|bolas|bola)\b/g, 'balon')
        .replace(/\b(voleiball|voleivol|volleyball|voley|veleibol|volei)\b/g, 'voleibol')
        .replace(/\b(basquet|basket|basketball)\b/g, 'baloncesto')
        .replace(/\b(futsal|futbolito)\b/g, 'futbol sala')
        .replace(/\b(soccer)\b/g, 'futbol')
        .replace(/\b(bicis|bicicleta|bicicletas)\b/g, 'bici')
        .replace(/\b(montanera|montaneras|montana|mtb)\b/g, 'montanera spartan')
        .replace(/\b(?:rin|numero|nro|modelo|talla)\s*(12|16|20|24)\b/g, 'rin $1 $1 inch')
        .replace(/\b(ping pong|pin pong|pimpon|tenis de mesa)\b/g, 'pin pong tenis de mesa dhs')
        .replace(/\b(guantin|guantines|guante|guantes|bateo)\b/g, 'guantines beisbol')
        .replace(/\b(snorkel|buceo|careta|playero|playa|acuatico|acuaticos)\b/g, 'snorkel playero ecology')
        .replace(/\b(pito|pitos|silbato|silbatos|arbitro|arbitraje)\b/g, 'silbato fox 40')
        .replace(/\b(camisa|camisas|camiseta|camisetas|tshirt|franela|franelas)\b/g, 'franela indumentaria')
        .replace(/\b(sueter|sudadera|hoodie|hoodies)\b/g, 'hoodie indumentaria')
        .replace(/\b(pantalon|mono|monos|jogger)\b/g, 'mono indumentaria')
        .replace(/\b(short|shorts|bermuda)\b/g, 'short indumentaria')
        .replace(/\b(gorra|gorras|cachucha)\b/g, 'gorra indumentaria')
        .replace(/\b(chaqueta|chaquetas)\b/g, 'chaqueta indumentaria')
        .replace(/\b(franelilla|franelillas|chemise)\b/g, 'franelilla indumentaria')
        // Equivalencia bilingüe de colores para todo el catálogo
        .replace(/\b(blue)\b/g, 'azul blue')
        .replace(/\b(red)\b/g, 'rojo red')
        .replace(/\b(white|blanca)\b/g, 'blanco white')
        .replace(/\b(yellow|amarilla)\b/g, 'amarillo yellow')
        .replace(/\b(black|negra)\b/g, 'negro black')
        .replace(/\b(pink|rosada|rosa)\b/g, 'rosado pink')
        .replace(/\b(green)\b/g, 'verde green')
        .replace(/\b(grey|gray)\b/g, 'gris grey')
        .replace(/\b(navy)\b/g, 'azul marino navy')
        .replace(/\s+/g, ' ')
        .trim();
}

function enrichProductDisplayName(rawName: string, rawSku: string, rawCategory: string, rawDiscipline?: string): string {
    const skuUpper = String(rawSku || '').trim().toUpperCase();
    const nameUpper = String(rawName || '').trim().toUpperCase();
    const catUpper = String(rawCategory || '').trim().toUpperCase();
    const discUpper = String(rawDiscipline || '').trim().toUpperCase();

    // 1. Bicicletas (Montañeras Rin 20"/24" vs Infantiles Paseo Rin 12"/16" + Colores)
    if (catUpper === 'BICICLETAS' || skuUpper.startsWith('MB-') || skuUpper.startsWith('KB-')) {
        let colorLabel = '';
        if (skuUpper.endsWith('SB') || nameUpper.includes('SKY BLUE')) colorLabel = 'Color Azul Cielo (Sky Blue)';
        else if (skuUpper.endsWith('B') || nameUpper.includes('BLUE')) colorLabel = 'Color Azul (Blue)';
        else if (skuUpper.endsWith('R') || nameUpper.includes('RED')) colorLabel = 'Color Rojo (Red)';
        else if (skuUpper.endsWith('W') || nameUpper.includes('WHITE')) colorLabel = 'Color Blanco (White)';
        else if (skuUpper.endsWith('Y') || nameUpper.includes('YELLOW')) colorLabel = 'Color Amarillo (Yellow)';
        else if (skuUpper.endsWith('P') || nameUpper.includes('PINK')) colorLabel = 'Color Rosado (Pink)';

        if (skuUpper.startsWith('MB-001') || (skuUpper.startsWith('MB-') && nameUpper.includes('20'))) {
            return `BICICLETA MONTAÑERA SPARTAN RIN 20" (20 INCH)${colorLabel ? ` — ${colorLabel}` : ''}`;
        }
        if (skuUpper.startsWith('MB-002') || (skuUpper.startsWith('MB-') && nameUpper.includes('24'))) {
            return `BICICLETA MONTAÑERA SPARTAN RIN 24" (24 INCH)${colorLabel ? ` — ${colorLabel}` : ''}`;
        }
        if (skuUpper.startsWith('KB-') && nameUpper.includes('16')) {
            return `BICICLETA INFANTIL PASEO RIN 16" (16 INCH)${colorLabel ? ` — ${colorLabel}` : ''}`;
        }
        if (skuUpper.startsWith('KB-') && nameUpper.includes('12')) {
            return `BICICLETA INFANTIL PASEO RIN 12" (12 INCH)${colorLabel ? ` — ${colorLabel}` : ''}`;
        }
    }

    let enriched = rawName.trim();

    // 2. Balones Deportivos: diferenciar Fútbol Campo (FC-) vs Fútbol Sala / Futsal (FS-) y variantes con mismo nombre
    if (skuUpper.startsWith('FC-') && !nameUpper.includes('CAMPO')) {
        enriched = `${enriched} (Fútbol Campo)`;
    } else if (skuUpper.startsWith('FS-') && !nameUpper.includes('FUTSAL') && !nameUpper.includes('SALA') && !discUpper.includes('7')) {
        enriched = `${enriched} (Fútbol Sala / Futsal)`;
    }

    // Si el SKU termina en variante numérica (ej. PRE05 vs PRE06, MC01 vs MC02, CHA01 vs CH02, NBA01-N)
    const variantMatch = skuUpper.match(/-(PRE0[1-9]|MC0[1-9]|CH0[1-9]|CHA0[1-9]|NBA01-N)$/);
    if (variantMatch && !nameUpper.includes(variantMatch[1])) {
        enriched = `${enriched} [Edición ${variantMatch[1]}]`;
    }

    // 3. Indumentaria y Ropa Deportiva (Messi Kids, etc.): traducir colores en inglés y códigos de variante
    if (
        catUpper === 'INDUMENTARIA' ||
        /^(TS-|CS-|SH-|HD-|CH-|O-|G-VAS|G-VOLO)/.test(skuUpper)
    ) {
        enriched = enriched
            .replace(/\bDEEP BLACK\b/gi, 'Negro (Deep Black)')
            .replace(/\bDK GREY\b/gi, 'Gris Oscuro (Dk Grey)')
            .replace(/\bLIGHT BLUE\b/gi, 'Azul Claro (Light Blue)')
            .replace(/\bARGENTINA BLUE\b/gi, 'Azul Celeste Argentina')
            .replace(/\bROYAL BLUE\b/gi, 'Azul Rey (Royal Blue)')
            .replace(/\bDARK BLUE\b/gi, 'Azul Oscuro (Dark Blue)')
            .replace(/\bNAVY\b/gi, 'Azul Marino (Navy)');

        const codeSuffix = skuUpper.match(/(01|05|06|07|11|12|13|14|17|18|19)$/);
        if (codeSuffix && (nameUpper === 'SHORT SAROL' || nameUpper === 'FRANELA LOGO TEE MESSI' || nameUpper === 'FRANELA NICO')) {
            enriched = `${enriched} (Ref. Color ${codeSuffix[1]})`;
        }
    }

    return enriched;
}

function stemSpanishToken(word: string): string {
    if (word.length <= 3) return word;
    if (word.endsWith('ones')) return word.slice(0, -2);
    if (word.endsWith('ces')) return word.slice(0, -3) + 'z';
    if (word.endsWith('es') && word.length > 5) return word.slice(0, -2);
    if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
    return word;
}

/**
 * Genera al vuelo un Catálogo Mayorista Oficial en PDF (Base64) sincronizado con el stock real
 * y las 3 columnas de la Política Comercial de Cascada (Lista, -25% Divisas, -10% Pronto Pago).
 */
export function generateLiveCatalogPdfBase64(
    products: ProductMatch[],
    bcvRate: number,
    divisasDiscountPct: number,
    prontoPagoDiscountPct: number
): string {
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = 210;
    const margin = 12;
    let y = 14;

    const drawHeader = (pageNum: number) => {
        // Banda corporativa superior oscura
        pdf.setFillColor(15, 23, 42);
        pdf.rect(0, 0, pageWidth, 32, 'F');

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(15);
        pdf.setTextColor(255, 255, 255);
        pdf.text('ATHLETICENTER C.A.', margin, 13);

        pdf.setFontSize(8.5);
        pdf.setTextColor(52, 211, 153);
        pdf.text('RIF: J-507140202  |  DISTRIBUIDOR MAYORISTA OFICIAL MULTIMARCA', margin, 19);

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.5);
        pdf.setTextColor(203, 213, 225);
        pdf.text(
            `Política Comercial: -${divisasDiscountPct}% Pago en Divisas  |  -${prontoPagoDiscountPct}% Adicional Pronto Pago  |  Tasa BCV Ref: Bs. ${bcvRate.toFixed(2)}/USD`,
            margin,
            26
        );

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(10);
        pdf.setTextColor(255, 255, 255);
        pdf.text('CATÁLOGO Y LISTA DE PRECIOS', pageWidth - margin, 13, { align: 'right' });

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.5);
        pdf.setTextColor(148, 163, 184);
        pdf.text(`Actualizado: ${new Date().toLocaleDateString('es-VE')}  |  Pág. ${pageNum}`, pageWidth - margin, 20, { align: 'right' });
    };

    const drawTableCols = (topY: number) => {
        pdf.setFillColor(30, 41, 59);
        pdf.rect(margin, topY, pageWidth - margin * 2, 7, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7);
        pdf.setTextColor(255, 255, 255);
        pdf.text('SKU', margin + 2, topY + 4.8);
        pdf.text('MARCA', margin + 28, topY + 4.8);
        pdf.text('PRODUCTO / MODELO', margin + 52, topY + 4.8);
        pdf.text('STOCK', margin + 123, topY + 4.8, { align: 'right' });
        pdf.text('LISTA (BCV)', margin + 144, topY + 4.8, { align: 'right' });
        pdf.text(`DIVISAS (-${divisasDiscountPct}%)`, margin + 165, topY + 4.8, { align: 'right' });
        pdf.text(`P. PAGO (-${prontoPagoDiscountPct}%)`, pageWidth - margin - 2, topY + 4.8, { align: 'right' });
        return topY + 7;
    };

    let pageNum = 1;
    drawHeader(pageNum);
    y = 38;

    const grouped = new Map<string, ProductMatch[]>();
    for (const p of products) {
        const key = `${p.category} — ${p.discipline}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(p);
    }

    for (const [sectionTitle, items] of grouped.entries()) {
        if (y > 262) {
            pdf.addPage();
            pageNum++;
            drawHeader(pageNum);
            y = 38;
        }

        // Encabezado de sección
        pdf.setFillColor(236, 253, 245);
        pdf.rect(margin, y, pageWidth - margin * 2, 7, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8.5);
        pdf.setTextColor(6, 95, 70);
        pdf.text(`${sectionTitle} (${items.length} MODELOS DISPONIBLES)`, margin + 3, y + 4.8);
        y += 7.5;

        y = drawTableCols(y);

        items.forEach((item, idx) => {
            if (y > 276) {
                pdf.addPage();
                pageNum++;
                drawHeader(pageNum);
                y = 38;
                y = drawTableCols(y);
            }

            if (idx % 2 === 0) {
                pdf.setFillColor(248, 250, 252);
                pdf.rect(margin, y, pageWidth - margin * 2, 6.2, 'F');
            }

            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(6.8);
            pdf.setTextColor(71, 85, 105);
            pdf.text((item.sku || '').slice(0, 14), margin + 2, y + 4.3);

            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(15, 23, 42);
            pdf.text((item.brand || '').slice(0, 12), margin + 28, y + 4.3);

            pdf.setFont('helvetica', 'normal');
            pdf.text((item.name || '').slice(0, 38), margin + 52, y + 4.3);

            pdf.text(`${item.stock} un.`, margin + 123, y + 4.3, { align: 'right' });
            pdf.text(money(item.priceLista), margin + 144, y + 4.3, { align: 'right' });

            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(5, 150, 105);
            pdf.text(money(item.priceDivisas), margin + 165, y + 4.3, { align: 'right' });

            pdf.setTextColor(37, 99, 235);
            pdf.text(money(item.priceProntoPago), pageWidth - margin - 2, y + 4.3, { align: 'right' });

            y += 6.2;
        });

        y += 4;
    }

    // Pie de página corporativo
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(7.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text(
        'Athleticenter C.A. — Pedidos y Cotizaciones por este WhatsApp Corporativo (+58 414-6719204). Despachos a nivel nacional.',
        pageWidth / 2,
        290,
        { align: 'center' }
    );

    return Buffer.from(pdf.output('arraybuffer')).toString('base64');
}

/**
 * Descarga ultrarrápida (15 KB, ~150 ms) de los 141+ productos del catálogo en Firestore
 * proyectando únicamente los campos comerciales y excluyendo imágenes Base64 pesadas.
 */
async function fetchLightweightCatalog(firestore: any, divisasDiscountPct: number, prontoPagoDiscountPct: number): Promise<ProductMatch[]> {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'studio-5015730771-8ece8';
    const items: ProductMatch[] = [];

    try {
        const res = await fetch(
            `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    structuredQuery: {
                        from: [{ collectionId: 'products' }],
                        select: {
                            fields: [
                                { fieldPath: 'sku' },
                                { fieldPath: 'name' },
                                { fieldPath: 'brand' },
                                { fieldPath: 'category' },
                                { fieldPath: 'discipline' },
                                { fieldPath: 'stock' },
                                { fieldPath: 'stockLevel' },
                                { fieldPath: 'price' },
                                { fieldPath: 'features' }
                            ]
                        },
                        limit: 500
                    }
                }),
                signal: AbortSignal.timeout(8000)
            }
        );

        if (res.ok) {
            const rows = await res.json();
            for (const row of rows) {
                const docName: string = row?.document?.name || '';
                const docId = docName.split('/').pop() || '';
                const f = row?.document?.fields;
                if (!f) continue;
                const rawPrice = Number(f.price?.doubleValue ?? f.price?.integerValue ?? 0);
                const stockField = Number(f.stock?.integerValue ?? f.stock?.doubleValue ?? 0);
                const stockLevelField = Number(f.stockLevel?.integerValue ?? f.stockLevel?.doubleValue ?? 0);
                const stock = Math.max(stockField, stockLevelField);
                const priceDivisas = Math.round(rawPrice * (1 - divisasDiscountPct / 100) * 100) / 100;
                const priceProntoPago = Math.round(priceDivisas * (1 - prontoPagoDiscountPct / 100) * 100) / 100;

                const rawBrand = (f.brand?.stringValue || 'GENERAL').trim().toUpperCase();
                const rawCat = (f.category?.stringValue || 'DEPORTES').trim().toUpperCase();
                const rawDisc = (f.discipline?.stringValue || rawCat).trim().toUpperCase();

                const rawSku = (f.sku?.stringValue || docId || '').trim();
                const rawName = (f.name?.stringValue || '').trim();

                items.push({
                    docId,
                    sku: rawSku,
                    name: enrichProductDisplayName(rawName, rawSku, rawCat, rawDisc),
                    brand: rawBrand,
                    category: rawCat === 'BASKETBALL' ? 'BALONES' : rawCat === 'VOLEIBOL' ? 'BALONES' : rawCat,
                    discipline: rawDisc === 'BASKET' ? 'BALONCESTO' : rawDisc === 'VELEIBOL' ? 'VOLEIBOL' : rawDisc,
                    stock,
                    priceLista: rawPrice,
                    priceDivisas,
                    priceProntoPago
                });
            }
            if (items.length > 0) return items;
        }
    } catch (e: any) {
        console.warn('[ARM Agent] Fallback de runQuery a getDocs:', e?.message || e);
    }

    try {
        const prodSnap = await getDocs(query(collection(firestore, 'products'), limit(300)));
        for (const d of prodSnap.docs) {
            const prod = d.data() as Product & { stock?: number };
            const rawPrice = Number(prod.price || 0);
            const stock = Math.max(Number(prod.stock || 0), Number(prod.stockLevel || 0));
            const priceDivisas = Math.round(rawPrice * (1 - divisasDiscountPct / 100) * 100) / 100;
            const priceProntoPago = Math.round(priceDivisas * (1 - prontoPagoDiscountPct / 100) * 100) / 100;
            const rawSku = (prod.sku || d.id || '').trim();
            const rawCat = (prod.category || 'DEPORTES').trim().toUpperCase();
            const rawDisc = (prod.discipline || prod.category || 'GENERAL').trim().toUpperCase();

            items.push({
                docId: d.id,
                sku: rawSku,
                name: enrichProductDisplayName(prod.name || '', rawSku, rawCat, rawDisc),
                brand: (prod.brand || 'GENERAL').trim().toUpperCase(),
                category: rawCat,
                discipline: rawDisc,
                stock,
                priceLista: rawPrice,
                priceDivisas,
                priceProntoPago
            });
        }
    } catch (e: any) {
        console.warn('[ARM Agent] Error leyendo productos:', e?.message || e);
    }

    return items;
}

export async function processArmInboundMessage({ phone, messageText }: ArmInboundInput): Promise<ArmInboundResult> {
    const cleanPhone = formatVenezuelaPhoneE164(phone);
    const last10 = cleanPhone.slice(-10);
    const textUpper = messageText.toUpperCase();

    await ensureServerAuth();
    const { firestore } = initializeFirebaseServer();

    // ─────────────────────────────────────────────────────────────
    // 1. Identificar contexto del cliente / prospecto en Firestore
    // ─────────────────────────────────────────────────────────────
    let customer: (Customer & { id: string }) | null = null;
    let customerName = 'Cliente';
    let customerCompany = '';
    let assignedSalesperson = '';

    try {
        const custSnap = await getDocs(query(collection(firestore, 'customers'), limit(200)));
        const found = custSnap.docs.find(d => {
            const p = String(d.data().phone || (d.data() as any).whatsappPhone || '').replace(/[^\d]/g, '');
            return p.length >= 10 && p.endsWith(last10);
        });
        if (found) {
            customer = { id: found.id, ...(found.data() as Customer) };
            customerCompany = customer.razonSocial || (customer as any).nombreComercial || '';
            customerName = customerCompany || customer.razonSocial || 'Cliente';
            assignedSalesperson = customer.assignedSalespersonName || '';
        }
    } catch (e: any) {
        console.warn('[ARM Agent] Error consultando cliente en Firestore:', e?.message || e);
    }

    // ─────────────────────────────────────────────────────────────
    // 2. Recuperar Memoria Conversacional Reciente (últimos turnos)
    // ─────────────────────────────────────────────────────────────
    const recentHistory: Array<{ message: string; reply: string; ts: number }> = [];
    try {
        const logsSnap = await getDocs(
            query(collection(firestore, 'whatsapp_inbound_logs'), orderBy('processedAt', 'desc'), limit(25))
        );
        const nowMs = Date.now();
        const sixHoursMs = 6 * 60 * 60 * 1000;

        for (const docSnap of logsSnap.docs) {
            const d = docSnap.data();
            const logPhone = String(d.phone || '').replace(/[^\d]/g, '');
            if (!logPhone.endsWith(last10)) continue;
            const tsMillis = typeof d.processedAt?.toMillis === 'function' ? d.processedAt.toMillis() : nowMs;
            if (nowMs - tsMillis <= sixHoursMs && d.message && d.reply) {
                recentHistory.push({
                    message: String(d.message),
                    reply: String(d.reply),
                    ts: tsMillis
                });
            }
            if (recentHistory.length >= 5) break;
        }
        recentHistory.reverse();
    } catch (e: any) {
        console.warn('[ARM Agent] No se pudo leer historial reciente:', e?.message || e);
    }

    const isOngoingConversation = recentHistory.length > 0;

    // ─────────────────────────────────────────────────────────────
    // 3. Obtener política financiera y tasa BCV oficial
    // ─────────────────────────────────────────────────────────────
    let bcvRate = 65.50;
    let divisasDiscountPct = 25;
    let prontoPagoDiscountPct = 10;

    try {
        const finSnap = await getDoc(doc(firestore, 'system', 'financials'));
        if (finSnap.exists()) {
            const fData = finSnap.data();
            if (fData.bcvRate) bcvRate = Number(fData.bcvRate);
            if (fData.defaultBcvDiscount) divisasDiscountPct = Number(fData.defaultBcvDiscount);
            if (fData.earlyPayment7Days) prontoPagoDiscountPct = Number(fData.earlyPayment7Days);
        }
    } catch (e: any) {
        console.warn('[ARM Agent] Error leyendo financieros:', e?.message || e);
    }

    // ─────────────────────────────────────────────────────────────
    // 4. Cargar TODO el Catálogo (141 productos, 14 marcas)
    // ─────────────────────────────────────────────────────────────
    const allCatalog = await fetchLightweightCatalog(firestore, divisasDiscountPct, prontoPagoDiscountPct);
    const inStockProducts = allCatalog.filter(p => p.stock > 0);

    const groupedBySection = new Map<string, ProductMatch[]>();
    const allActiveBrands = new Set<string>();

    for (const p of inStockProducts) {
        const sectionKey = `${p.category} — ${p.discipline}`;
        if (!groupedBySection.has(sectionKey)) groupedBySection.set(sectionKey, []);
        groupedBySection.get(sectionKey)!.push(p);
        allActiveBrands.add(p.brand);
    }

    const fullInventoryDirectoryLines: string[] = [];
    for (const [section, items] of groupedBySection.entries()) {
        fullInventoryDirectoryLines.push(`\n### SECCIÓN: ${section} (${items.length} productos disponibles)`);
        for (const p of items) {
            fullInventoryDirectoryLines.push(
                `- [${p.brand}] *${p.name}* (SKU: ${p.sku}) | Stock: ${p.stock} unid. | Lista: ${money(p.priceLista)} | Divisas (-${divisasDiscountPct}%): *${money(p.priceDivisas)}* | Pronto Pago (-${prontoPagoDiscountPct}% adic.): *${money(p.priceProntoPago)}*`
            );
        }
    }

    const normCurrent = normalizeText(messageText);
    const prevTurnText = recentHistory.length > 0
        ? `${recentHistory[recentHistory.length - 1].message} ${recentHistory[recentHistory.length - 1].reply}`
        : '';
    const normContext = normalizeText(`${messageText} ${prevTurnText}`);

    const STOPWORDS = new Set([
        'hola', 'buenos', 'buenas', 'dias', 'tardes', 'noches', 'tienen', 'tiene', 'tienes',
        'disponible', 'disponibles', 'precio', 'precios', 'foto', 'fotos', 'imagen', 'imagenes',
        'enviame', 'mandame', 'pasame', 'por', 'favor', 'como', 'del', 'las', 'los', 'una', 'uno',
        'para', 'ver', 'quiero', 'necesito', 'cotizar', 'marca', 'marcas', 'mostrar', 'muestrame',
        'hay', 'que', 'cual', 'cuales', 'son', 'ese', 'esa', 'esos', 'esas', 'este', 'esta',
        'puedes', 'puede', 'enviar', 'mandar', 'pasar', 'catalogo', 'lista'
    ]);

    const currentTokens = normCurrent
        .split(' ')
        .filter(w => w.length >= 2 && !STOPWORDS.has(w))
        .map(stemSpanishToken);

    const fallbackTokens = normalizeText(prevTurnText)
        .split(' ')
        .filter(w => w.length >= 3 && !STOPWORDS.has(w))
        .map(stemSpanishToken);

    const activeTokens = currentTokens.length > 0 ? currentTokens : fallbackTokens;
    const activeNormText = currentTokens.length > 0 ? normCurrent : normContext;

    const scoredMatches = inStockProducts
        .map(p => {
            let score = 0;
            const normName = normalizeText(p.name);
            const normBrand = normalizeText(p.brand);
            const normCat = normalizeText(`${p.category} ${p.discipline}`);
            const normSku = normalizeText(p.sku);

            if (normSku && normSku.length >= 3 && activeNormText.includes(normSku)) {
                score += 25;
            }
            if (normBrand && normBrand !== 'generica' && activeNormText.includes(normBrand)) {
                score += 12;
            }
            if ((activeNormText.includes('bici') || activeNormText.includes('rin')) && p.category === 'BICICLETAS') {
                score += 10;
            }
            for (const sizeNum of ['12', '16', '20', '24']) {
                if (new RegExp(`\\b${sizeNum}\\b`).test(activeNormText) && new RegExp(`\\b${sizeNum}\\b`).test(normName)) {
                    score += 25;
                }
            }
            for (const discWord of [
                'voleibol', 'futbol', 'sala', 'campo', 'baloncesto', 'beisbol', 'montanera', 'infantil',
                'franela', 'franelilla', 'short', 'hoodie', 'gorra', 'chaqueta', 'mono', 'indumentaria',
                'snorkel', 'playero', 'silbato', 'guantines', 'pin pong', 'tenis de mesa'
            ]) {
                if (activeNormText.includes(discWord) && (normCat.includes(discWord) || normName.includes(discWord))) {
                    score += 15;
                }
            }
            for (const colorWord of ['azul', 'rojo', 'blanco', 'amarillo', 'negro', 'rosado', 'verde', 'gris', 'marino', 'celeste', 'dorado']) {
                if (activeNormText.includes(colorWord) && normName.includes(colorWord)) {
                    score += 10;
                }
            }
            for (const t of activeTokens) {
                if (t.length < 2) continue;
                if (normBrand.includes(t)) score += 6;
                if (normName.includes(t)) score += 4;
                else if (normCat.includes(t)) score += 2;
            }
            return { product: p, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);

    const directMatches = scoredMatches.map(item => item.product);

    // ─────────────────────────────────────────────────────────────
    // 5. Detectar si el cliente solicita el CATÁLOGO EN PDF o FOTOS
    // ─────────────────────────────────────────────────────────────
    const lastBotAskedForCatalog = Boolean(
        recentHistory.length > 0 &&
        /catalogo.*pdf|enviemos el catalogo/i.test(normalizeText(recentHistory[recentHistory.length - 1].reply))
    );
    const isShortYesForCatalog = lastBotAskedForCatalog && /^(si|claro|dale|por favor|ok|envialo|mandalo|pasalo)\b/i.test(normCurrent);

    const wantsCatalogPdf =
        isShortYesForCatalog ||
        /(catalogo|lista de precio|lista completa|precios y ofertas|enviame el catalogo|pasame el catalogo|mandame el catalogo|catalogo en pdf|pdf)/i.test(normCurrent);

    const wantsProductPhoto =
        !wantsCatalogPdf &&
        /(foto|fotos|imagen|imagenes|ver como es|mostra|muestrame)/i.test(normCurrent);

    let pdfBase64: string | undefined = undefined;
    let pdfUrl: string | undefined = undefined;
    let pdfSizeBytes: number | undefined = undefined;
    let pdfFileName: string | undefined = undefined;
    let productImageUrl: string | undefined = undefined;
    const extraPhotos: Array<{ imageUrl: string; caption: string }> = [];
    const attachedPhotoLabels: string[] = [];

    if (wantsCatalogPdf && inStockProducts.length > 0) {
        try {
            // Verificar primero si el administrador subió un PDF personalizado en Cloud Storage / Firestore (system/armCatalog)
            let customPdfLoaded = false;
            try {
                const customCatSnap = await getDoc(doc(firestore, 'system', 'armCatalog'));
                if (customCatSnap.exists()) {
                    const cData = customCatSnap.data();
                    if (cData?.pdfUrl && typeof cData.pdfUrl === 'string' && cData.pdfUrl.startsWith('https://')) {
                        pdfUrl = cData.pdfUrl;
                        pdfSizeBytes = Number(cData.sizeBytes || 0);
                        pdfFileName = cData.fileName || 'Catalogo_Oficial_Athleticenter.pdf';
                        customPdfLoaded = true;
                    } else if (cData?.pdfBase64 && typeof cData.pdfBase64 === 'string' && cData.pdfBase64.length > 100) {
                        const rawB64 = cData.pdfBase64.includes(';base64,')
                            ? cData.pdfBase64.split(';base64,').pop()!
                            : cData.pdfBase64;
                        pdfBase64 = rawB64;
                        pdfFileName = cData.fileName || 'Catalogo_Oficial_Athleticenter.pdf';
                        customPdfLoaded = true;
                    }
                }
            } catch {}

            if (!customPdfLoaded) {
                pdfBase64 = generateLiveCatalogPdfBase64(
                    inStockProducts,
                    bcvRate,
                    divisasDiscountPct,
                    prontoPagoDiscountPct
                );
                pdfFileName = 'Catalogo_Mayorista_Athleticenter.pdf';
            }
        } catch (pdfErr: any) {
            console.warn('[ARM Agent] Error generando PDF de catálogo:', pdfErr?.message || pdfErr);
        }
    } else if (wantsProductPhoto && directMatches.length > 0) {
        try {
            const wantsMultiplePhotos = /\b(fotos|imagenes|colores|modelos|todos|todas)\b/i.test(normCurrent) && directMatches.length > 1;
            const maxPhotosToFetch = wantsMultiplePhotos ? Math.min(directMatches.length, 4) : 1;

            for (let i = 0; i < maxPhotosToFetch; i++) {
                const targetProd = directMatches[i];
                if (!targetProd?.docId) continue;
                const pDoc = await getDoc(doc(firestore, 'products', targetProd.docId));
                if (!pDoc.exists()) continue;
                const pData = pDoc.data() as Product & { imageUrls?: string[] };
                const imgSource = pData.imageUrl || (Array.isArray(pData.imageUrls) && pData.imageUrls[0]) || '';
                if (!imgSource) continue;

                attachedPhotoLabels.push(`[${targetProd.brand}] ${targetProd.name} (SKU: ${targetProd.sku})`);

                if (!productImageUrl) {
                    productImageUrl = imgSource;
                } else {
                    extraPhotos.push({
                        imageUrl: imgSource,
                        caption: `📸 *[${targetProd.brand}] ${targetProd.name}* (SKU: ${targetProd.sku})\n• Stock disponible: *${targetProd.stock} unid.*\n• Precio Lista: ${money(targetProd.priceLista)}\n• Pago en Divisas (-${divisasDiscountPct}%): *${money(targetProd.priceDivisas)}*\n• Pronto Pago (-${prontoPagoDiscountPct}% adic.): *${money(targetProd.priceProntoPago)}*`
                    });
                }
            }
        } catch (imgErr: any) {
            console.warn('[ARM Agent] Error obteniendo foto de producto:', imgErr?.message || imgErr);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 6. Evaluar Intención Caliente y Disparar Hand-off a Asesor
    // ─────────────────────────────────────────────────────────────
    const isHotIntent = /(PASAME LA CUENTA|QUIERO COMPRAR|APARTAME|APARTAR|HACER PEDIDO|FACTURA|DATOS DE PAGO|PAGO MOVIL|TRANSFERIR|QUIERO HABLAR CON|PASAME CON UN ASESOR|ASESOR HUMANO|COMPRAR YA|COTIZAME FORMAL)/i.test(textUpper);
    let handoffTriggered = false;

    if (isHotIntent) {
        handoffTriggered = true;
        try {
            await createAppNotifications(firestore, {
                category: 'Cotizaciones',
                title: `🔥 Lead Caliente WhatsApp: ${customerName}`,
                message: `El cliente solicitó cerrar pedido o atención humana desde +${cleanPhone}. Mensaje: "${messageText.slice(0, 140)}"`,
                link: '/dashboard/clients',
                initiatorId: 'arm_inbound_agent',
                roles: ['ventas', 'gerencia', 'admin', 'superadmin'],
                salespersonId: customer?.assignedSalespersonId || undefined
            });

            await addDoc(collection(firestore, 'crm_hot_leads'), {
                phone: cleanPhone,
                customerName,
                customerCompany,
                message: messageText,
                status: 'pending_agent_action',
                assignedSalesperson,
                createdAt: serverTimestamp()
            });
        } catch (notifErr: any) {
            console.error('[ARM Agent] Error registrando alerta de lead caliente:', notifErr?.message || notifErr);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 7. Enriquecimiento del CRM (Lead Qualification)
    // ─────────────────────────────────────────────────────────────
    let leadQualified = false;
    const locationMatch = messageText.match(/(?:en|de|desde|ubicados en)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]{4,20})/i);
    const storeMatch = messageText.match(/(?:somos|tienda|comercial|inversiones|distribuidora|gimnasio|colegio|club|academia)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ0-9\s]{3,30})/i);

    if (storeMatch || locationMatch) {
        leadQualified = true;
        try {
            await addDoc(collection(firestore, 'crm_lead_enrichments'), {
                phone: cleanPhone,
                extractedStore: storeMatch ? storeMatch[1].trim() : null,
                extractedLocation: locationMatch ? locationMatch[1].trim() : null,
                rawMessage: messageText,
                updatedAt: serverTimestamp(),
                createdAt: serverTimestamp()
            });
        } catch {}
    }

    // ─────────────────────────────────────────────────────────────
    // 8. Generación con Gemini 2.5 Flash con Visión Total de las 14 Marcas
    // ─────────────────────────────────────────────────────────────
    const conversationHistoryText = isOngoingConversation
        ? recentHistory.map((h, i) => `Turno ${i + 1}:\nCliente: "${h.message}"\nAgente ARM: "${h.reply}"`).join('\n---\n')
        : 'Sin mensajes previos (este es el primer mensaje de la conversación).';

    const systemPrompt = `Eres ARM (Agentic Relationship Manager), el Asesor Comercial Mayorista Senior de ATHLETICENTER C.A. en Venezuela.

CONOCIMIENTO MAESTRO DEL PORTAFOLIO DE ATHLETICENTER:
En Athleticenter somos distribuidores mayoristas multimarca y contamos con stock real en las siguientes líneas y marcas:
1. ⚽🏀🏐 *BALONES DEPORTIVOS (7 Marcas en Stock):*
   - *MOLTEN:* Baloncesto (GG5X, GG7X, GG5, BG5000), Fútbol Campo (Vantaggio AFC 4800), Fútbol Sala (Vantaggio AFC 4000), Fútbol 7 (Vantaggio Bote Alto) y Voleibol (5000 FIVB Texturizado, NCAA 5000, Official).
   - *ADIDAS:* Fútbol Campo (UCL Pro Final Múnich 25, Mundial de Clubes, Trionda Mundial 2026 Competitions y Final, Champions 25 Aniversario, MLS Pro, Women's Champions) y Fútbol Sala (Trionda Mundial 2026 Pro Futsal, Mundial de Clubes, Champions).
   - *NIKE:* Baloncesto (Nike Pure Grip, Nike Versa), Fútbol Campo (Premier League 25/26, Flight, Skills, Stricker) y Fútbol Sala (Premier League Flight).
   - *SPARTAN:* Baloncesto (GQ7X, GP7X), Fútbol Campo (Spartan Pro 2026 Azul/Dorado y Negro/Dorado, Champions, Mundial de Clubes, Premier, National League) y Fútbol Sala (Spartan Pro 26).
   - *MIKASA:* Voleibol profesional (V200W, V320W, MVA300, MVA330, W200W CEV, W200W VNL).
   - *SPALDING:* Baloncesto (Spalding NBA).
   - *WILSON:* Baloncesto (Wilson NBA).
2. 🚲 *BICICLETAS (4 Tamaños de Rin claramente diferenciados):*
   - *LÍNEA INFANTIL PASEO (Modelos más pequeños con rueditas):* Rin 12" (SKUs KB-006/KB-008: $86 Lista / $64.50 Divisas) y Rin 16" (SKUs KB-005/KB-007: $98 Lista / $73.50 Divisas) en Azul, Rojo, Rosado (Pink) y Azul Cielo (Sky Blue).
   - *LÍNEA MONTAÑERA SPARTAN:* Rin 20" (SKUs MB-001B Azul, MB-001R Rojo, MB-001W Blanco, MB-001Y Amarillo: $188 Lista / $141.00 Divisas / $126.90 Pronto Pago) y Rin 24" (SKUs MB-002B Azul, MB-002R Rojo, MB-002W Blanco, MB-002Y Amarillo: $205 Lista / $153.75 Divisas / $138.38 Pronto Pago).
3. 🎽 *INDUMENTARIA Y ROPA DEPORTIVA (MESSI KIDS — 47 Modelos en Stock):*
   - *Franelas:* Denis, Goat, Leo, Logo Tee Messi, Milano, Neros, Nes, Nico ($11-$18 Lista / $8.25-$13.50 Divisas).
   - *Franelillas:* Eve y Nisa ($9-$13 Lista / $6.75-$9.75 Divisas).
   - *Shorts:* Cuti, Indiana, Morgan y Sarol ($18 Lista / $13.50 Divisas).
   - *Hoodies y Chaquetas:* Hoodie Mavin ($18 Lista), Hoodie Serto ($16 Lista), Chaqueta Maton ($23 Lista) y Mono Rorro ($18 Lista).
   - *Gorras:* Vasco y Volo ($9 Lista / $6.75 Divisas) + *Combo Messi Kids 24 Piezas* ($321 Lista / $240.75 Divisas).
4. ⚾🏓🏊‍♂️ *OTRAS CATEGORÍAS DEPORTIVAS:*
   - *Béisbol:* Guantines de Béisbol *SPARTAN* ($22 Lista / $16.50 Divisas) y Guantines de Bateo *BRUCE BOLT* Negro/Dorado con muñequera doble ($44 Lista / $33.00 Divisas).
   - *Tenis de Mesa (Ping Pong):* Caja de pelotas *DHS* 3 Estrellas D40+ ($17 Lista / $12.75 Divisas).
   - *Arbitraje:* Silbatos profesionales *FOX 40* de dedo y de cuerda ($5 Lista / $3.75 Divisas).
   - *Acuáticos / Playa:* Equipos de Snorkel Delfín Verde y Marlin Azul ($19 Lista / $14.25 Divisas) y Sets Playeros Azul y Verde *ECOLOGY* ($12 Lista / $9.00 Divisas).

REGLAS OBLIGATORIAS DE RESPUESTA:
1. ${(pdfBase64 || pdfUrl) ? '¡IMPORTANTE! En este mismo mensaje el sistema está adjuntando automáticamente el archivo PDF oficial del Catálogo Mayorista de Athleticenter. Confírmale al cliente que aquí mismo le estás adjuntando el Catálogo Mayorista Oficial en PDF con todas nuestras marcas y los 3 niveles de precio (Lista, -25% Divisas y -10% Pronto Pago), y preséntale un breve resumen ejecutivo de nuestras líneas principales.' : ''}
2. ${attachedPhotoLabels.length > 0 ? `¡IMPORTANTE! En este mismo mensaje el sistema está adjuntando automáticamente ${attachedPhotoLabels.length} fotografía(s) real(es) de: ${attachedPhotoLabels.join('; ')}. Indícale exactamente qué modelos y colores le estás adjuntando junto con su stock y precios.` : 'No digas "Aquí te adjunto la fotografía" si el sistema no indicó que se adjuntaron fotos.'}
3. RESPONDE CON PRECISIÓN Y VARIEDAD MULTIMARCA (Y NUNCA CONTRADIGAS AL CLIENTE):
   - Si el cliente pide la *Montañera Rin 20* (o *modelo 20*), recuerda que existen 2 modelos más pequeños infantiles (Rin 12" y Rin 16") y que la *Montañera SPARTAN Rin 20" (MB-001)* viene en 4 colores: Azul (MB-001B), Rojo (MB-001R), Blanco (MB-001W) y Amarillo (MB-001Y).
   - Si el cliente pregunta por *balones*, menciona nuestras **7 marcas líderes (*MOLTEN, ADIDAS, NIKE, SPARTAN, MIKASA, SPALDING y WILSON*)** y detállale los modelos solicitados con su stock y precios exactos.
   - Si pregunta por varios productos o marcas (ej. *"balón de fútbol Adidas y Nike"*), detalla TODOS los modelos disponibles tanto de *ADIDAS* como de *NIKE* (nunca dejes una marca sin listar).
4. CERO SALUDOS REPETITIVOS:
   - ${isOngoingConversation ? 'YA ESTÁS CONVERSANDO CON ESTE CLIENTE. ESTÁ PROHIBIDO empezar con "¡Hola! 👋" o "¡Gracias por contactarnos!". Ve directo al grano.' : 'Inicia con un saludo cordial y ejecutivo de bienvenida a Athleticenter.'}
5. POLÍTICA COMERCIAL OFICIAL DE CASCADA (Obligatoria al presentar precios):
   - Precio Lista (Pagadero en Bs a tasa oficial BCV: Bs. ${bcvRate.toFixed(2)}/USD)
   - *${divisasDiscountPct}% de Descuento* pagando en Divisas
   - *${prontoPagoDiscountPct}% de Descuento adicional* por Pronto Pago
6. NUNCA CORTES LA RESPUESTA A LA MITAD. Cierra con una pregunta comercial orientada al cierre y firma siempre:
Atentamente,
*El equipo de Athleticenter*`;

    const userPrompt = `HISTORIAL RECIENTE DE LA CONVERSACIÓN CON ESTE CLIENTE:
${conversationHistoryText}

MENSAJE ACTUAL DEL CLIENTE (+${cleanPhone}${customerCompany ? ` - ${customerCompany}` : ''}):
"${messageText}"

${(pdfBase64 || pdfUrl) ? 'NOTA DEL SISTEMA: El archivo PDF del Catálogo Oficial se enviará adjunto a este mensaje.' : ''}
${attachedPhotoLabels.length > 0 ? `NOTA DEL SISTEMA: Se están enviando adjuntas ${attachedPhotoLabels.length} fotografía(s) real(es) correspondientes a: ${attachedPhotoLabels.join(' | ')}.` : ''}

DIRECTORIO COMPLETO DEL INVENTARIO EN STOCK EN TIEMPO REAL (${inStockProducts.length} productos activos en ${allActiveBrands.size} marcas):
${fullInventoryDirectoryLines.join('\n')}

Redacta ahora la respuesta completa de WhatsApp para el cliente:`;

    let replyText = '';

    try {
        const response = await ai.generate({
            model: 'googleai/gemini-2.5-flash',
            system: systemPrompt,
            prompt: userPrompt,
            config: {
                temperature: 0.3,
                maxOutputTokens: 4096
            }
        });

        replyText = (response.text || '').trim();
    } catch (aiErr: any) {
        console.warn('[ARM Agent] Gemini no disponible, generando respuesta determinística:', aiErr?.message || aiErr);
    }

    if (!replyText || replyText.length < 80) {
        replyText = `*ATHLETICENTER*\n\n` +
            `${(pdfBase64 || pdfUrl) ? '📄 *¡Aquí tienes nuestro Catálogo Mayorista Oficial en PDF adjunto a este mensaje!* 🙌\n\n' : ''}` +
            `Contamos con disponibilidad inmediata para despacho nacional en todo nuestro portafolio multimarca:\n\n` +
            `⚽🏀🏐 *Balones Deportivos (7 Marcas en Stock):*\n` +
            `• *ADIDAS:* Mundial 2026 Trionda, UCL Pro Final Múnich 25, Mundial de Clubes, Champions 25 Aniv., MLS Pro (Lista $29-$33 | Divisas -25%: *$21.75-$24.75* | Pronto Pago -10%: *$19.58-$22.28*)\n` +
            `• *NIKE:* Pure Grip, Versa, Premier League 25/26, Flight, Skills (Lista $29 | Divisas -25%: *$21.75* | Pronto Pago -10%: *$19.58*)\n` +
            `• *MOLTEN:* Baloncesto GG5X/GG7X/BG5000, Fútbol Vantaggio AFC 4800/4000, Voleibol FIVB 5000/NCAA (Lista $22-$29.33 | Divisas -25%: *$16.50-$22.00*)\n` +
            `• *MIKASA:* Voleibol V200W, V320W, MVA300, MVA330, W200W CEV/VNL (Lista $24-$28 | Divisas -25%: *$18.00-$21.00*)\n` +
            `• *SPARTAN:* Baloncesto GQ7X/GP7X, Fútbol Campo y Futsal Pro 2026, Champions, Premier (Lista $26-$27 | Divisas -25%: *$19.50-$20.25*)\n` +
            `• *SPALDING & WILSON:* Baloncesto NBA Oficial (Lista $29-$31 | Divisas -25%: *$21.75-$23.25*)\n\n` +
            `🚲 *Bicicletas & Otras Disciplinas:*\n` +
            `• *Bicicletas SPARTAN:* Rin 20" (*$141.00* en divisas) y Rin 24" (*$153.75* en divisas) + Infantiles Rin 12" y 16"\n` +
            `• *Béisbol SPARTAN:* Guantines ($16.50 en divisas) | *Ping Pong DHS:* Pelotas 3★ ($12.75 en divisas) | *Silbatos FOX 40:* ($3.75 en divisas) | *Acuáticos ECOLOGY*\n\n` +
            `¿Qué modelos y cantidades te gustaría incluir en tu cotización?\n\n` +
            `Atentamente,\n*El equipo de Athleticenter*`;
    } else if (!replyText.includes('El equipo de Athleticenter')) {
        replyText = `${replyText.trim()}\n\nAtentamente,\n*El equipo de Athleticenter*`;
    }

    // Si el catálogo supera los 100 MB (límite nativo de WhatsApp), incluir enlace de descarga directa de alta velocidad
    if (pdfUrl && pdfSizeBytes && pdfSizeBytes > 100 * 1024 * 1024 && !replyText.includes(pdfUrl)) {
        replyText = `${replyText}\n\n📥 *Descarga directa del Catálogo Completo HD (${(pdfSizeBytes / (1024 * 1024)).toFixed(1)} MB):*\n${pdfUrl}`;
    }

    // ─────────────────────────────────────────────────────────────
    // 9. Bitácora en vivo del Agente ARM (whatsapp_inbound_logs)
    // ─────────────────────────────────────────────────────────────
    try {
        await addDoc(collection(firestore, 'whatsapp_inbound_logs'), {
            phone: cleanPhone,
            customerName,
            customerCompany,
            message: messageText,
            reply: replyText,
            intent: isHotIntent ? 'HOT_PURCHASE_INTENT' : (pdfBase64 || pdfUrl) ? 'CATALOG_PDF_SENT' : directMatches.length > 0 ? 'CATALOG_AND_PRICING' : 'GENERAL_INQUIRY',
            isHotLead: handoffTriggered,
            leadQualified,
            matchedProductsCount: directMatches.length || inStockProducts.length,
            processedAt: serverTimestamp()
        });
    } catch (logErr: any) {
        console.warn('[ARM Agent] Error guardando whatsapp_inbound_logs:', logErr?.message || logErr);
    }

    return {
        success: true,
        replyText,
        pdfBase64,
        pdfUrl,
        pdfSizeBytes,
        pdfFileName,
        imageUrl: productImageUrl,
        extraPhotos: extraPhotos.length > 0 ? extraPhotos : undefined,
        leadQualified,
        handoffTriggered,
        matchedProductsCount: directMatches.length || inStockProducts.length
    };
}
