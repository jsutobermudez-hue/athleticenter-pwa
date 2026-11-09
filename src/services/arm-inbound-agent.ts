import { ai } from '@/ai/genkit';
import { initializeFirebaseServer, ensureServerAuth } from '@/firebase/server-init';
import {
    collection,
    getDocs,
    query,
    limit,
    doc,
    getDoc,
    setDoc,
    addDoc,
    updateDoc,
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
    brand?: string;
    discipline?: string;
    category?: string;
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
 * MOTOR AGÉNTICO COMERCIAL (ARM - INBOUND)
 * Transforma WhatsApp en un Asesor Comercial Autónomo 24/7:
 *  1. Identifica al cliente o prospecto por su número de teléfono.
 *  2. Busca en inventario productos solicitados y calcula la política de cascada oficial:
 *     - Precio Lista
 *     - 25% Descuento por pago de contado en Divisas
 *     - 10% Descuento adicional por Pronto Pago
 *  3. Enriquecimiento del CRM (Guarda nombre de tienda, ciudad, disciplina en Firestore).
 *  4. Detección de intención caliente y Hand-off al asesor humano vía notificación push.
 *  5. Redacción conversacional con Gemini 2.5 Flash y firma de "El equipo de Athleticenter".
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
    let customerName = 'Amigo(a)';
    let customerCompany = '';
    let assignedSalesperson = '';

    try {
        const custSnap = await getDocs(query(collection(firestore, 'customers'), limit(100)));
        const found = custSnap.docs.find(d => {
            const p = String(d.data().phone || '').replace(/[^\d]/g, '');
            return p.endsWith(last10);
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
    // 2. Obtener política financiera y tasa BCV oficial
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
    // 3. Buscar productos en inventario que coincidan con la consulta
    // ─────────────────────────────────────────────────────────────
    const matchedProducts: ProductMatch[] = [];
    try {
        const prodSnap = await getDocs(query(collection(firestore, 'products'), limit(150)));
        const allProducts = prodSnap.docs.map(d => ({ id: d.id, ...(d.data() as Product) }));

        // Palabras clave de búsqueda
        const rawTokens = messageText
            .toLowerCase()
            .replace(/[^\w\sáéíóúñ]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length >= 3 && !['hola', 'buenos', 'buenas', 'dias', 'tardes', 'noches', 'precio', 'costo', 'tienen', 'cuanto', 'quiero', 'venden', 'para', 'como', 'esta', 'este', 'favor'].includes(t));

        for (const prod of allProducts) {
            const pName = (prod.name || '').toLowerCase();
            const pSku = (prod.sku || '').toLowerCase();
            const pBrand = (prod.brand || '').toLowerCase();
            const pCat = (prod.category || '').toLowerCase();
            const pDisc = (prod.discipline || '').toLowerCase();
            const pFeatures = (prod.features || '').toLowerCase();

            const isMatch = rawTokens.some(token => 
                pName.includes(token) || 
                pSku.includes(token) || 
                pBrand.includes(token) || 
                pCat.includes(token) || 
                pDisc.includes(token) ||
                pFeatures.includes(token)
            );

            if (isMatch && Number(prod.stockLevel || 0) > 0) {
                const rawPrice = Number(prod.price || 0);
                const priceDivisas = (prod.priceCashUSD && prod.priceCashUSD > 0) 
                    ? prod.priceCashUSD 
                    : Math.round(rawPrice * (1 - divisasDiscountPct / 100) * 100) / 100;
                
                const priceProntoPago = (prod.priceEarly7d && prod.priceEarly7d > 0)
                    ? prod.priceEarly7d
                    : Math.round(priceDivisas * (1 - prontoPagoDiscountPct / 100) * 100) / 100;

                matchedProducts.push({
                    name: prod.name,
                    sku: prod.sku,
                    brand: prod.brand,
                    discipline: prod.discipline,
                    category: prod.category,
                    stock: prod.stockLevel,
                    priceLista: rawPrice,
                    priceDivisas,
                    priceProntoPago,
                    imageUrl: prod.imageUrl
                });
            }
        }
    } catch (e: any) {
        console.warn('[ARM Agent] Error buscando inventario:', e?.message || e);
    }

    // Limitar a máximo 4 productos para mantener el mensaje de WhatsApp ágil
    const topMatches = matchedProducts.slice(0, 4);

    // ─────────────────────────────────────────────────────────────
    // 4. Evaluar Intención Caliente y Disparar Hand-off a Asesor
    // ─────────────────────────────────────────────────────────────
    const isHotIntent = /(PASAME LA CUENTA|QUIERO COMPRAR|APARTAME|APARTAR|HACER PEDIDO|FACTURA|DATOS DE PAGO|PAGO MOVIL|TRANSFERIR|QUIERO HABLAR CON|PASAME CON UN ASESOR|ASESOR HUMANO)/i.test(textUpper);
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
    // 5. Enriquecimiento del CRM (Lead Qualification)
    // ─────────────────────────────────────────────────────────────
    let leadQualified = false;
    const locationMatch = messageText.match(/(?:en|de|desde|ubicados en)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]{4,20})/i);
    const storeMatch = messageText.match(/(?:somos|tienda|comercial|inversiones|distribuidora|gimnasio|colegio)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ0-9\s]{3,30})/i);

    if (storeMatch || locationMatch) {
        leadQualified = true;
        try {
            await addDoc(collection(firestore, 'crm_lead_enrichments'), {
                phone: cleanPhone,
                extractedStore: storeMatch ? storeMatch[1].trim() : null,
                extractedLocation: locationMatch ? locationMatch[1].trim() : null,
                rawMessage: messageText,
                createdAt: serverTimestamp()
            });
        } catch {}
    }

    // ─────────────────────────────────────────────────────────────
    // 6. Generación de Respuesta con Gemini 2.5 Flash
    // ─────────────────────────────────────────────────────────────
    let replyText = '';
    const hasProducts = topMatches.length > 0;

    let productCatalogSummary = '';
    if (hasProducts) {
        productCatalogSummary = topMatches.map(p => 
            `• *${p.name}* (Ref: ${p.sku}) | Stock: ${p.stock} un.\n` +
            `  🏷️ Precio Lista: ${money(p.priceLista)}\n` +
            `  💵 Divisas (${divisasDiscountPct}% desc.): *${money(p.priceDivisas)}*\n` +
            `  ⚡ Pronto Pago (-${prontoPagoDiscountPct}% adic.): *${money(p.priceProntoPago)}*`
        ).join('\n\n');
    }

    const systemPrompt = `Eres ARM (Agentic Relationship Manager), el Asesor Comercial Ejecutivo de ATHLETICENTER C.A., mayorista y distribuidor líder de artículos deportivos y bicicletas Spartan en Venezuela.

Tu objetivo: Responder al cliente por WhatsApp con precisión ejecutiva, calidez venezolana y cierre comercial.

REGLAS OBLIGATORIAS:
1. Política Comercial Oficial de Cascada:
   - Precio de Lista
   - 25% Descuento por pago de contado en Divisas
   - 10% Descuento adicional por Pronto Pago
   Tasa oficial de referencia: Bs. ${bcvRate.toFixed(2)}/USD.
2. Si hay productos consultados disponibles, preséntalos con el desglose exacto de los 3 precios sin alterarlos.
3. Si el cliente pide catálogo, confírmale que tenemos catálogo digital completo en PDF y pregúntale qué disciplina busca (Ciclismo Spartan, Balones, Ropa, etc.).
4. Si el cliente tiene intención caliente de compra o pide un asesor humano, indícale amablemente que su solicitud ha sido priorizada y que un asesor comercial de nuestro equipo se pondrá en contacto de inmediato para coordinar factura y despacho.
5. Firma obligatoria siempre:
   Atentamente,
   *El equipo de Athleticenter*
6. Formato WhatsApp: Usa negritas (*negrita*), saltos de línea claros y entre 2 y 4 emojis ejecutivos.
7. Nunca inventes productos ni precios fuera de los datos provistos.`;

    const userPrompt = `Mensaje del cliente (${cleanPhone}${customerCompany ? ` - ${customerCompany}` : ''}):
"${messageText}"

Datos del inventario coincidente:
${productCatalogSummary || 'No se detectó un producto específico o está por confirmarse en almacén.'}

${isHotIntent ? 'NOTA: El cliente tiene alta intención de compra o pide cuenta/asesor.' : ''}
${leadQualified ? 'NOTA: El cliente proporcionó datos de su comercio o ubicación.' : ''}`;

    try {
        const response = await ai.generate({
            model: 'googleai/gemini-2.5-flash',
            system: systemPrompt,
            prompt: userPrompt,
            config: {
                temperature: 0.5,
                maxOutputTokens: 600
            }
        });

        replyText = (response.text || '').trim();
    } catch (aiErr: any) {
        console.warn('[ARM Agent] Gemini no disponible, generando respuesta determinística:', aiErr?.message || aiErr);
    }

    // Plantilla de contingencia en caso de que la IA esté temporalmente saturada
    if (!replyText || replyText.length < 30) {
        if (hasProducts) {
            replyText = `*ATHLETICENTER*\n\n` +
                `¡Hola! Qué gusto saludarle${customerCompany ? ` a *${customerCompany}*` : ''}. 🙌\n\n` +
                `Le confirmamos la disponibilidad en nuestro almacén central para despacho inmediato:\n\n` +
                `${productCatalogSummary}\n\n` +
                `🚚 Despachamos a nivel nacional. Facturación con base en la tasa oficial BCV (Bs. ${bcvRate.toFixed(2)}).\n\n` +
                `¿Desea que le apartemos las unidades o le compartamos el catálogo en PDF?\n\n` +
                `Atentamente,\n*El equipo de Athleticenter*`;
        } else if (isHotIntent) {
            replyText = `*ATHLETICENTER*\n\n` +
                `¡Excelente! 🙌 Hemos recibido su solicitud con prioridad alta.\n\n` +
                `Un asesor comercial de nuestro equipo se comunicará directamente con usted a este número para coordinar los detalles de su pedido y facilitarle los datos de cuenta.\n\n` +
                `¡Muchas gracias por su preferencia!\n\n` +
                `Atentamente,\n*El equipo de Athleticenter*`;
        } else {
            replyText = `*ATHLETICENTER*\n\n` +
                `¡Hola! Bienvenido a Athleticenter, mayoristas en bicicletas Spartan y artículos deportivos al mayor en Venezuela. 🚴‍♂️⚽\n\n` +
                `Contamos con disponibilidad para despacho nacional con nuestra política de *25% en Divisas* + *10% por Pronto Pago*.\n\n` +
                `¿Qué producto o disciplina deportiva desea cotizar el día de hoy? Con gusto le enviamos precios o nuestro catálogo en PDF.\n\n` +
                `Atentamente,\n*El equipo de Athleticenter*`;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 7. Bitácora en vivo del Agente ARM (whatsapp_inbound_logs)
    // ─────────────────────────────────────────────────────────────
    try {
        await addDoc(collection(firestore, 'whatsapp_inbound_logs'), {
            phone: cleanPhone,
            customerName,
            customerCompany,
            message: messageText,
            reply: replyText,
            intent: isHotIntent ? 'HOT_PURCHASE_INTENT' : hasProducts ? 'CATALOG_AND_PRICING' : 'GENERAL_INQUIRY',
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
