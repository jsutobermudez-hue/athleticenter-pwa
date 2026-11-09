import { ai } from '@/ai/genkit';
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
    leadQualified?: boolean;
    handoffTriggered?: boolean;
    matchedProductsCount?: number;
    error?: string;
}

interface ProductMatch {
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

    // Fallback SDK tradicional
    try {
        const prodSnap = await getDocs(query(collection(firestore, 'products'), limit(300)));
        for (const d of prodSnap.docs) {
            const prod = d.data() as Product;
            const rawPrice = Number(prod.price || 0);
            const stock = Number(prod.stockLevel || 0);
            const priceDivisas = Math.round(rawPrice * (1 - divisasDiscountPct / 100) * 100) / 100;
            const priceProntoPago = Math.round(priceDivisas * (1 - prontoPagoDiscountPct / 100) * 100) / 100;

            items.push({
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

/**
 * MOTOR AGÉNTICO COMERCIAL (ARM - INBOUND v3.0 — VISIÓN TOTAL DEL INVENTARIO 14 MARCAS)
 * Conoce los 141+ productos y todas las marcas de Athleticenter:
 *  - Balones: MOLTEN, ADIDAS, NIKE, SPARTAN, MIKASA, SPALDING, WILSON, PUMA
 *    (Baloncesto, Fútbol Campo, Fútbol Sala, Fútbol 7, Voleibol)
 *  - Bicicletas: SPARTAN (Rin 20" y Rin 24") y Línea Infantil (Rin 12" y Rin 16")
 *  - Béisbol: SPARTAN (Guantines) y BRUCE BOLT
 *  - Tenis de Mesa (Ping Pong): DHS (Pelotas 3 Estrellas D40+)
 *  - Arbitraje / Accesorios: FOX 40 (Silbatos de dedo y cuerda)
 *  - Acuáticos / Snorkel: ECOLOGY (Sets playeros y equipos de snorkel)
 *  - Indumentaria: MESSI KIDS (Chaquetas, Hoodies, Franelillas, Gorras)
 */
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
    // 4. Cargar TODO el Catálogo (141 productos, 14 marcas) sin imágenes Base64
    // ─────────────────────────────────────────────────────────────
    const allCatalog = await fetchLightweightCatalog(firestore, divisasDiscountPct, prontoPagoDiscountPct);
    const inStockProducts = allCatalog.filter(p => p.stock > 0);

    // Agrupar productos en stock por Categoría/Disciplina y por Marca para que Gemini tenga visión 100% completa
    const groupedBySection = new Map<string, ProductMatch[]>();
    const brandsByCategory = new Map<string, Set<string>>();
    const allActiveBrands = new Set<string>();

    for (const p of inStockProducts) {
        const sectionKey = `${p.category} — ${p.discipline}`;
        if (!groupedBySection.has(sectionKey)) groupedBySection.set(sectionKey, []);
        groupedBySection.get(sectionKey)!.push(p);

        if (!brandsByCategory.has(p.category)) brandsByCategory.set(p.category, new Set());
        brandsByCategory.get(p.category)!.add(p.brand);
        allActiveBrands.add(p.brand);
    }

    // Construir el Directorio Maestro del Inventario Activo (compacto y 100% exhaustivo)
    const fullInventoryDirectoryLines: string[] = [];
    for (const [section, items] of groupedBySection.entries()) {
        fullInventoryDirectoryLines.push(`\n### SECCIÓN: ${section} (${items.length} productos disponibles)`);
        for (const p of items) {
            fullInventoryDirectoryLines.push(
                `- [${p.brand}] *${p.name}* (SKU: ${p.sku}) | Stock: ${p.stock} unid. | Lista: ${money(p.priceLista)} | Divisas (-${divisasDiscountPct}%): *${money(p.priceDivisas)}* | Pronto Pago (-${prontoPagoDiscountPct}% adic.): *${money(p.priceProntoPago)}*`
            );
        }
    }

    // Contar coincidencias directas para telemetría
    const normMsg = normalizeText(`${messageText} ${recentHistory[recentHistory.length - 1]?.message || ''}`);
    const queryTokens = normMsg.split(' ').filter(w => w.length >= 3).map(stemSpanishToken);
    const directMatches = inStockProducts.filter(p => {
        const s = normalizeText(`${p.name} ${p.brand} ${p.category} ${p.discipline} ${p.sku}`);
        return queryTokens.some(t => s.includes(t));
    });

    // ─────────────────────────────────────────────────────────────
    // 5. Evaluar Intención Caliente y Disparar Hand-off a Asesor
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
    // 6. Enriquecimiento del CRM (Lead Qualification)
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
    // 7. Generación con Gemini 2.5 Flash con Visión Total de las 14 Marcas
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
   - *PUMA:* Fútbol Sala (Puma Cumbre Copa América - por reposición).
2. 🚲 *BICICLETAS:*
   - *SPARTAN:* Bicicletas Montañeras Rin 20" ($188 Lista / $141 Divisas) y Rin 24" ($205 Lista / $153.75 Divisas) en colores Azul, Rojo, Blanco y Amarillo.
   - *LÍNEA INFANTIL:* Bicicletas Rin 12" ($86 Lista / $64.50 Divisas) y Rin 16" ($98 Lista / $73.50 Divisas) en Azul, Rojo, Pink y Sky Blue.
3. ⚾🏓🏊‍♂️🎽 *OTRAS CATEGORÍAS DEPORTIVAS:*
   - *Béisbol:* Guantines de Béisbol *SPARTAN* ($22 Lista / $16.50 Divisas) y línea *BRUCE BOLT*.
   - *Tenis de Mesa (Ping Pong):* Caja de pelotas *DHS* 3 Estrellas D40+ ($17 Lista / $12.75 Divisas).
   - *Arbitraje:* Silbatos profesionales *FOX 40* de dedo y de cuerda ($5 Lista / $3.75 Divisas).
   - *Acuáticos / Playa:* Sets Playeros y Equipos de Snorkel *ECOLOGY* ($12 Lista / $9 Divisas).
   - *Indumentaria:* Colección *MESSI KIDS* (Chaquetas, Hoodies, Franelillas y Gorras).

REGLAS OBLIGATORIAS DE RESPUESTA:
1. RESPONDE CON PRECISIÓN Y VARIEDAD MULTIMARCA:
   - Si el cliente pregunta por *balones* en general, menciona SIEMPRE que trabajamos con **7 marcas líderes (*MOLTEN, ADIDAS, NIKE, SPARTAN, MIKASA, SPALDING y WILSON*)** en Baloncesto, Fútbol Campo, Fútbol Sala y Voleibol, y muéstrale ejemplos representativos de varias marcas con sus precios o pregúntale qué disciplina busca para detallarle todos los modelos de esa disciplina.
   - Si pregunta por una disciplina específica (ej. Voleibol, Fútbol Campo, Fútbol Sala, Baloncesto, Bicicletas, Ping Pong, Béisbol), detállale TODOS los modelos y marcas disponibles en esa disciplina con su stock y precios.
   - Si pregunta *"¿Qué otras marcas tienen?"* o *"¿Qué marcas manejan?"*, preséntale el abanico completo de nuestras marcas en Balones, Bicicletas y Accesorios.
2. CERO SALUDOS REPETITIVOS:
   - ${isOngoingConversation ? 'YA ESTÁS CONVERSANDO CON ESTE CLIENTE. ESTÁ PROHIBIDO empezar con "¡Hola! 👋", "¡Gracias por contactarnos!" o "¡Qué bueno que nos escribes!". Responde directamente a su pregunta como en una charla fluida.' : 'Inicia con un saludo cordial y ejecutivo de bienvenida a Athleticenter.'}
3. POLÍTICA COMERCIAL OFICIAL DE CASCADA (Obligatoria al presentar precios):
   - Precio Lista (Pagadero en Bs a tasa oficial BCV: Bs. ${bcvRate.toFixed(2)}/USD)
   - *${divisasDiscountPct}% de Descuento* pagando en Divisas
   - *${prontoPagoDiscountPct}% de Descuento adicional* por Pronto Pago
4. NUNCA CORTES LA RESPUESTA A LA MITAD. Cierra siempre con una pregunta comercial que facilite el pedido y la firma oficial:
Atentamente,
*El equipo de Athleticenter*`;

    const userPrompt = `HISTORIAL RECIENTE DE LA CONVERSACIÓN CON ESTE CLIENTE:
${conversationHistoryText}

MENSAJE ACTUAL DEL CLIENTE (+${cleanPhone}${customerCompany ? ` - ${customerCompany}` : ''}):
"${messageText}"

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

    // Respaldo determinístico multimarca si la IA no responde o devuelve texto incompleto
    if (!replyText || replyText.length < 80) {
        replyText = `*ATHLETICENTER*\n\n` +
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
            `¿Qué disciplina o marca te gustaría que te detalláramos con unidades exactas para armar tu cotización?\n\n` +
            `Atentamente,\n*El equipo de Athleticenter*`;
    } else if (!replyText.includes('El equipo de Athleticenter')) {
        replyText = `${replyText.trim()}\n\nAtentamente,\n*El equipo de Athleticenter*`;
    }

    // ─────────────────────────────────────────────────────────────
    // 8. Bitácora en vivo del Agente ARM (whatsapp_inbound_logs)
    // ─────────────────────────────────────────────────────────────
    try {
        await addDoc(collection(firestore, 'whatsapp_inbound_logs'), {
            phone: cleanPhone,
            customerName,
            customerCompany,
            message: messageText,
            reply: replyText,
            intent: isHotIntent ? 'HOT_PURCHASE_INTENT' : directMatches.length > 0 ? 'CATALOG_AND_PRICING' : 'GENERAL_INQUIRY',
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
        leadQualified,
        handoffTriggered,
        matchedProductsCount: directMatches.length || inStockProducts.length
    };
}
