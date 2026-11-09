import { ai } from '@/ai/genkit';
import { initializeFirebaseServer, ensureServerAuth } from '@/firebase/server-init';
import {
    collection,
    getDocs,
    query,
    where,
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
    imageUrl?: string;
}

function money(amount: number): string {
    return `$${Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Normaliza texto en español: minúsculas, sin tildes, y reduce plurales comunes a raíz singular
 */
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
    if (word.endsWith('ones')) return word.slice(0, -2); // balones -> balon
    if (word.endsWith('ces')) return word.slice(0, -3) + 'z';
    if (word.endsWith('es') && word.length > 5) return word.slice(0, -2);
    if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
    return word;
}

const STOPWORDS = new Set([
    'hola', 'buenos', 'buenas', 'dia', 'dias', 'tarde', 'tardes', 'noche', 'noches',
    'precio', 'precios', 'costo', 'costos', 'tiene', 'tienen', 'tienes', 'cuanto',
    'quiero', 'venden', 'para', 'como', 'esta', 'este', 'estos', 'estas', 'favor',
    'por', 'que', 'cual', 'cuales', 'otra', 'otras', 'otro', 'otros', 'marca', 'marcas',
    'modelo', 'modelos', 'solo', 'solamente', ' únicamente', 'hay', 'disponible',
    'disponibles', 'disponibilidad', 'catalogo', 'catalogos', 'lista', 'info', 'informacion',
    'saludos', 'amigo', 'amigos', 'hermano', 'athleticenter', 'ustedes', 'manejan'
]);

const SYNONYM_GROUPS: string[][] = [
    ['balon', 'balones', 'pelota', 'pelotas', 'ball', 'basketball', 'baloncesto', 'basket', 'futbol', 'voleibol'],
    ['bicicleta', 'bicicletas', 'bici', 'bicis', 'ciclismo', 'spartan', 'mtb', 'rin'],
    ['catalogo', 'catalogos', 'lista', 'inventario', 'productos', 'mercancia', 'stock']
];

/**
 * MOTOR AGÉNTICO COMERCIAL (ARM - INBOUND v2.0 CON MEMORIA Y CATÁLOGO 360°)
 * Transforma WhatsApp en un Asesor Comercial Autónomo 24/7:
 *  1. Identifica al cliente o prospecto por su número de teléfono.
 *  2. Recupera el historial reciente de conversación (memoria conversacional) para no repetir "¡Hola!"
 *     y entender preguntas de seguimiento ("¿Solo Molten?", "¿Y qué otras marcas tienen?").
 *  3. Analiza todo el inventario activo en stock (todas las marcas, categorías y modelos) y calcula
 *     la política de cascada oficial exacta:
 *     - Precio Lista
 *     - 25% Descuento por pago en Divisas
 *     - 10% Descuento adicional por Pronto Pago
 *  4. Enriquecimiento del CRM y Hand-off automático a asesores humanos en leads calientes.
 *  5. Generación completa sin truncamiento (maxOutputTokens: 4096) con Gemini 2.5 Flash.
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
    let recentHistory: Array<{ message: string; reply: string; ts: number }> = [];
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
        recentHistory.reverse(); // Orden cronológico (del más antiguo al más reciente)
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
    // 4. Cargar Inventario Activo Completo y Búsqueda Semántica Diversificada
    // ─────────────────────────────────────────────────────────────
    const allActiveProducts: ProductMatch[] = [];
    const matchedProducts: ProductMatch[] = [];
    const brandsMap = new Map<string, ProductMatch[]>();
    const categoriesSet = new Set<string>();

    try {
        const prodSnap = await getDocs(query(collection(firestore, 'products'), limit(300)));
        const rawProducts = prodSnap.docs.map(d => ({ id: d.id, ...(d.data() as Product) }));

        for (const prod of rawProducts) {
            const stock = Number(prod.stockLevel || 0);
            if (stock <= 0) continue;

            const rawPrice = Number(prod.price || 0);
            // Cascada comercial oficial exacta: Lista -> -25% Divisas -> -10% adicional Pronto Pago
            const priceDivisas = Math.round(rawPrice * (1 - divisasDiscountPct / 100) * 100) / 100;
            const priceProntoPago = Math.round(priceDivisas * (1 - prontoPagoDiscountPct / 100) * 100) / 100;

            const brandClean = (prod.brand || 'GENERAL').trim().toUpperCase();
            const catClean = (prod.category || 'DEPORTES').trim().toUpperCase();
            const discClean = (prod.discipline || prod.category || 'GENERAL').trim().toUpperCase();

            const item: ProductMatch = {
                name: (prod.name || '').trim(),
                sku: (prod.sku || '').trim(),
                brand: brandClean,
                discipline: discClean,
                category: catClean,
                stock,
                priceLista: rawPrice,
                priceDivisas,
                priceProntoPago,
                imageUrl: prod.imageUrl
            };

            allActiveProducts.push(item);
            categoriesSet.add(catClean);
            if (!brandsMap.has(brandClean)) brandsMap.set(brandClean, []);
            brandsMap.get(brandClean)!.push(item);
        }

        // Combinar el mensaje actual + el último mensaje del historial si la pregunta actual es de seguimiento ("¿Solo Molten?", "¿Y qué otras marcas?")
        const combinedQueryText = isOngoingConversation
            ? `${messageText} ${recentHistory[recentHistory.length - 1]?.message || ''}`
            : messageText;

        const normQuery = normalizeText(combinedQueryText);
        const queryWords = normQuery
            .split(' ')
            .filter(w => w.length >= 2 && !STOPWORDS.has(w));

        const expandedStems = new Set<string>();
        for (const w of queryWords) {
            const stem = stemSpanishToken(w);
            expandedStems.add(w);
            expandedStems.add(stem);
            for (const group of SYNONYM_GROUPS) {
                if (group.includes(w) || group.includes(stem)) {
                    group.forEach(g => {
                        expandedStems.add(g);
                        expandedStems.add(stemSpanishToken(g));
                    });
                }
            }
        }

        // Si el cliente pregunta "¿Solo X?" o "¿Qué otras marcas tienen?", priorizar mostrar TODAS las marcas
        const asksOtherBrands = /(OTRA|OTRAS|MARCA|MARCAS|SOLO|UNICAMENTE|ADEMAS| CATALOGO|DISPONIBLE|DISPONIBLES|QUE TIENEN|QUE VENDEN)/i.test(normQuery);

        for (const item of allActiveProducts) {
            const searchable = normalizeText(`${item.name} ${item.sku} ${item.brand} ${item.category} ${item.discipline}`);
            const searchableWords = searchable.split(' ').map(stemSpanishToken);

            const isMatch = Array.from(expandedStems).some(token =>
                token.length >= 3 && (
                    searchable.includes(token) ||
                    searchableWords.some(sw => sw.includes(token) || token.includes(sw))
                )
            );

            if (isMatch) {
                matchedProducts.push(item);
            }
        }

        // Si pide otras marcas, catálogo general o la búsqueda no arrojó coincidencias específicas, incluir todos los productos activos
        if (matchedProducts.length === 0 || asksOtherBrands) {
            for (const item of allActiveProducts) {
                if (!matchedProducts.some(m => m.sku === item.sku)) {
                    matchedProducts.push(item);
                }
            }
        }
    } catch (e: any) {
        console.warn('[ARM Agent] Error buscando inventario:', e?.message || e);
    }

    // Diversificar resultados por marca (Round-Robin entre marcas) para NUNCA mostrar solo una marca si hay varias
    const diversifiedMatches: ProductMatch[] = [];
    const byBrand = new Map<string, ProductMatch[]>();
    for (const p of matchedProducts) {
        if (!byBrand.has(p.brand)) byBrand.set(p.brand, []);
        byBrand.get(p.brand)!.push(p);
    }
    let added = true;
    while (added && diversifiedMatches.length < 10) {
        added = false;
        for (const [, list] of byBrand) {
            if (list.length > 0 && diversifiedMatches.length < 10) {
                diversifiedMatches.push(list.shift()!);
                added = true;
            }
        }
    }

    const topMatches = diversifiedMatches.length > 0 ? diversifiedMatches : allActiveProducts.slice(0, 10);

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
    // 7. Construir Contexto Completo de Inventario y Marcas para Gemini
    // ─────────────────────────────────────────────────────────────
    const activeBrandsList = Array.from(brandsMap.keys());
    const brandsSummaryLines = Array.from(brandsMap.entries()).map(([brand, items]) => {
        const totalUnits = items.reduce((acc, i) => acc + i.stock, 0);
        const models = items.map(i => `${i.name} (${money(i.priceDivisas)} en divisas)`).join(', ');
        return `• Marca *${brand}* (${items.length} modelos en stock, ${totalUnits} unid. totales): ${models}`;
    }).join('\n');

    const productCatalogSummary = topMatches.map(p =>
        `• *[${p.brand}] ${p.name}* (Ref: ${p.sku}) — Stock disponible: ${p.stock} unid.\n` +
        `  🏷️ Precio Lista (BCV): ${money(p.priceLista)}\n` +
        `  💵 Pago en Divisas (-${divisasDiscountPct}%): *${money(p.priceDivisas)}*\n` +
        `  ⚡ Pronto Pago (-${prontoPagoDiscountPct}% adic.): *${money(p.priceProntoPago)}*`
    ).join('\n\n');

    const conversationHistoryText = isOngoingConversation
        ? recentHistory.map((h, i) => `Turno ${i + 1}:\nCliente: "${h.message}"\nAgente ARM: "${h.reply}"`).join('\n---\n')
        : 'Sin mensajes previos (este es el primer mensaje de la conversación).';

    const systemPrompt = `Eres ARM (Agentic Relationship Manager), el Asesor Comercial Mayorista Senior de ATHLETICENTER C.A. en Venezuela.

REGLAS DE ORO DE CONVERSACIÓN Y SERVICIO:
1. RESPONDE DIRECTAMENTE A LA PREGUNTA DEL CLIENTE desde la primera línea:
   - Si el cliente pregunta "¿Solo Molten?" o "¿Qué otras marcas tienen?", respóndele de inmediato que manejamos *${activeBrandsList.join(' y ')}* (por ejemplo, nuestros modelos *NIKE* y *MOLTEN* disponibles en almacén) y muéstrale los modelos exactos con sus precios.
   - Si el cliente pregunta "¿Tienes catálogo disponible?" o "¿Tienes balones disponibles?", confírmale que sí tenemos disponibilidad inmediata y muéstrale el resumen organizado por marca (*${activeBrandsList.join(' / ')}*) con precios y unidades en stock.
2. NO REPITAS SALUDOS ROBÓTICOS:
   - ${isOngoingConversation ? 'YA ESTÁS EN UNA CONVERSACIÓN EN CURSO CON ESTE CLIENTE. ESTÁ ESTRICTAMENTE PROHIBIDO iniciar el mensaje con "¡Hola! 👋", "¡Qué bueno que nos contactas!" o "¡Gracias por contactarnos!". Ve directo a responder su pregunta con naturalidad ejecutiva.' : 'Como es el primer mensaje, inicia con un saludo cordial y ejecutivo.'}
3. POLÍTICA COMERCIAL OFICIAL DE CASCADA (Obligatoria al dar precios):
   - Precio Lista (pagadero en Bs a tasa oficial BCV: Bs. ${bcvRate.toFixed(2)}/USD)
   - *${divisasDiscountPct}% de Descuento* pagando en Divisas
   - *${prontoPagoDiscountPct}% de Descuento adicional* por Pronto Pago
   Muestra siempre los precios exactos provistos en el inventario sin inventar otros.
4.NUNCA DEJES FRASES INCOMPLETAS NI CORTADAS. Redacta una respuesta clara, completa, estructurada con viñetas y cierra siempre con una pregunta comercial que invite al cierre (ej. "¿Cuántas unidades de cada modelo deseas cotizar o prefieres que te enviemos el catálogo en PDF?").
5. FIRMA OBLIGATORIA AL FINAL DEL MENSAJE:
Atentamente,
*El equipo de Athleticenter*`;

    const userPrompt = `HISTORIAL RECIENTE DE ESTA CONVERSACIÓN:
${conversationHistoryText}

MENSAJE ACTUAL DEL CLIENTE (+${cleanPhone}${customerCompany ? ` - ${customerCompany}` : ''}):
"${messageText}"

RESUMEN DE TODAS LAS MARCAS ACTUALMENTE EN STOCK EN ATHLETICENTER:
Marcas activas: ${activeBrandsList.join(', ') || 'Consultar almacén'}
${brandsSummaryLines}

DETALLE DE PRODUCTOS Y PRECIOS OFICIALES EN STOCK:
${productCatalogSummary || 'Sin coincidencias exactas en este momento.'}

${isHotIntent ? 'ALERTA: El cliente tiene intención caliente de compra o solicita asesor/cuenta.' : ''}
Redacta la respuesta completa de WhatsApp para el cliente cumpliendo todas las reglas:`;

    let replyText = '';

    try {
        const response = await ai.generate({
            model: 'googleai/gemini-2.5-flash',
            system: systemPrompt,
            prompt: userPrompt,
            config: {
                temperature: 0.35,
                maxOutputTokens: 4096
            }
        });

        replyText = (response.text || '').trim();
    } catch (aiErr: any) {
        console.warn('[ARM Agent] Gemini no disponible, generando respuesta determinística:', aiErr?.message || aiErr);
    }

    // Respaldo determinístico completo si la respuesta de IA falló o quedó incompleta (< 80 caracteres o sin firma)
    if (!replyText || replyText.length < 80) {
        if (topMatches.length > 0) {
            const greeting = isOngoingConversation
                ? `Con gusto te detallo nuestras opciones disponibles en almacén (trabajamos con las marcas *${activeBrandsList.join(' y ')}*):`
                : `¡Hola! Bienvenido a *Athleticenter C.A.* 🙌 Contamos con disponibilidad inmediata en nuestras marcas *${activeBrandsList.join(' y ')}*:`;

            replyText = `*ATHLETICENTER*\n\n` +
                `${greeting}\n\n` +
                `${productCatalogSummary}\n\n` +
                `🚚 *Despacho nacional inmediato.* Tasa oficial BCV del día: *Bs. ${bcvRate.toFixed(2)} / USD*.\n\n` +
                `¿Qué modelos y cantidades deseas que te coticemos o te enviamos nuestro catálogo completo en PDF?\n\n` +
                `Atentamente,\n*El equipo de Athleticenter*`;
        } else {
            replyText = `*ATHLETICENTER*\n\n` +
                `Contamos con disponibilidad inmediata para despacho nacional con nuestra política comercial de *${divisasDiscountPct}% de descuento en Divisas* + *${prontoPagoDiscountPct}% adicional por Pronto Pago*.\n\n` +
                `¿Qué producto o marca deseas cotizar hoy para enviarte nuestra lista actualizada?\n\n` +
                `Atentamente,\n*El equipo de Athleticenter*`;
        }
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
            intent: isHotIntent ? 'HOT_PURCHASE_INTENT' : topMatches.length > 0 ? 'CATALOG_AND_PRICING' : 'GENERAL_INQUIRY',
            isHotLead: handoffTriggered,
            leadQualified,
            matchedProductsCount: topMatches.length,
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
        matchedProductsCount: topMatches.length
    };
}
