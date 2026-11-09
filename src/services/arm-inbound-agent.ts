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
    pdfFileName?: string;
    imageUrl?: string;
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
        .replace(/\s+/g, ' ')
        .trim();
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
                const stock = Number(f.stockLevel?.integerValue ?? f.stockLevel?.doubleValue ?? 0);
                const priceDivisas = Math.round(rawPrice * (1 - divisasDiscountPct / 100) * 100) / 100;
                const priceProntoPago = Math.round(priceDivisas * (1 - prontoPagoDiscountPct / 100) * 100) / 100;

                const rawBrand = (f.brand?.stringValue || 'GENERAL').trim().toUpperCase();
                const rawCat = (f.category?.stringValue || 'DEPORTES').trim().toUpperCase();
                const rawDisc = (f.discipline?.stringValue || rawCat).trim().toUpperCase();

                items.push({
                    docId,
                    sku: (f.sku?.stringValue || '').trim(),
                    name: (f.name?.stringValue || '').trim(),
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
            const prod = d.data() as Product;
            const rawPrice = Number(prod.price || 0);
            const stock = Number(prod.stockLevel || 0);
            const priceDivisas = Math.round(rawPrice * (1 - divisasDiscountPct / 100) * 100) / 100;
            const priceProntoPago = Math.round(priceDivisas * (1 - prontoPagoDiscountPct / 100) * 100) / 100;

            items.push({
                docId: d.id,
                sku: (prod.sku || '').trim(),
                name: (prod.name || '').trim(),
                brand: (prod.brand || 'GENERAL').trim().toUpperCase(),
                category: (prod.category || 'DEPORTES').trim().toUpperCase(),
                discipline: (prod.discipline || prod.category || 'GENERAL').trim().toUpperCase(),
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
    const normContext = normalizeText(`${messageText} ${recentHistory[recentHistory.length - 1]?.message || ''}`);
    const queryTokens = normContext.split(' ').filter(w => w.length >= 3).map(stemSpanishToken);

    const directMatches = inStockProducts.filter(p => {
        const s = normalizeText(`${p.name} ${p.brand} ${p.category} ${p.discipline} ${p.sku}`);
        if (normContext.includes('bici') && p.category === 'BICICLETAS') return true;
        return queryTokens.some(t => s.includes(t));
    });

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
    let pdfFileName: string | undefined = undefined;
    let productImageUrl: string | undefined = undefined;

    if (wantsCatalogPdf && inStockProducts.length > 0) {
        try {
            // Verificar primero si el administrador subió un PDF personalizado en Firestore (system/armCatalog)
            let customPdfLoaded = false;
            try {
                const customCatSnap = await getDoc(doc(firestore, 'system', 'armCatalog'));
                if (customCatSnap.exists()) {
                    const cData = customCatSnap.data();
                    if (cData?.pdfBase64 && typeof cData.pdfBase64 === 'string' && cData.pdfBase64.length > 100) {
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
            const targetProd = directMatches[0];
            if (targetProd.docId) {
                const pDoc = await getDoc(doc(firestore, 'products', targetProd.docId));
                if (pDoc.exists()) {
                    const pData = pDoc.data() as Product;
                    if (pData.imageUrl) {
                        productImageUrl = pData.imageUrl;
                    }
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
2. 🚲 *BICICLETAS:*
   - *SPARTAN:* Bicicletas Montañeras Rin 20" ($188 Lista / $141.00 Divisas / $126.90 Pronto Pago) y Rin 24" ($205 Lista / $153.75 Divisas / $138.38 Pronto Pago) en Azul, Rojo, Blanco y Amarillo.
   - *LÍNEA INFANTIL:* Bicicletas Rin 12" ($86 Lista / $64.50 Divisas) y Rin 16" ($98 Lista / $73.50 Divisas) en Azul, Rojo, Pink y Sky Blue.
3. ⚾🏓🏊‍♂️🎽 *OTRAS CATEGORÍAS DEPORTIVAS:*
   - *Béisbol:* Guantines de Béisbol *SPARTAN* ($22 Lista / $16.50 Divisas) y *BRUCE BOLT*.
   - *Tenis de Mesa (Ping Pong):* Caja de pelotas *DHS* 3 Estrellas D40+ ($17 Lista / $12.75 Divisas).
   - *Arbitraje:* Silbatos profesionales *FOX 40* de dedo y de cuerda ($5 Lista / $3.75 Divisas).
   - *Acuáticos / Playa:* Sets Playeros y Equipos de Snorkel *ECOLOGY* ($12 Lista / $9.00 Divisas).

REGLAS OBLIGATORIAS DE RESPUESTA:
1. ${pdfBase64 ? '¡IMPORTANTE! En este mismo mensaje el sistema está adjuntando automáticamente el archivo PDF oficial "Catalogo_Mayorista_Athleticenter.pdf". Confírmale al cliente que aquí mismo le estás adjuntando el Catálogo Mayorista Oficial en PDF con todas nuestras marcas y los 3 niveles de precio (Lista, -25% Divisas y -10% Pronto Pago), y preséntale un breve resumen ejecutivo de nuestras líneas principales.' : ''}
2. ${productImageUrl ? '¡IMPORTANTE! En este mismo mensaje el sistema está adjuntando la fotografía real del producto solicitado. Indícale que adjuntas la imagen junto con los precios y colores/modelos disponibles.' : ''}
3. RESPONDE CON PRECISIÓN Y VARIEDAD MULTIMARCA:
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

${pdfBase64 ? 'NOTA DEL SISTEMA: El archivo PDF del Catálogo Oficial se enviará adjunto a este mensaje.' : ''}
${productImageUrl ? 'NOTA DEL SISTEMA: La imagen del producto se enviará adjunta a este mensaje.' : ''}

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
            `${pdfBase64 ? '📄 *¡Aquí tienes nuestro Catálogo Mayorista Oficial en PDF adjunto a este mensaje!* 🙌\n\n' : ''}` +
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
            intent: isHotIntent ? 'HOT_PURCHASE_INTENT' : pdfBase64 ? 'CATALOG_PDF_SENT' : directMatches.length > 0 ? 'CATALOG_AND_PRICING' : 'GENERAL_INQUIRY',
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
        pdfFileName,
        imageUrl: productImageUrl,
        leadQualified,
        handoffTriggered,
        matchedProductsCount: directMatches.length || inStockProducts.length
    };
}
