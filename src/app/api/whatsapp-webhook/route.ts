import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { initializeFirebaseServer, ensureServerAuth } from '@/firebase/server-init';
import { collection, query, getDocs, limit, orderBy, doc, getDoc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { sendBackgroundWhatsAppMessage, formatVenezuelaPhoneE164 } from '@/lib/whatsapp-gateway';
import { processArmInboundMessage } from '@/services/arm-inbound-agent';
import { computeOrderBalanceForWhatsApp, humanOrderStatus, money } from '@/lib/whatsapp-templates';

/**
 * WEBHOOK MULTI-GATEWAY DE WHATSAPP (ATHLETICENTER v3.0)
 * Prioriza el Agente Comercial Autónomo ARM (con envío automático de Catálogo PDF y Fotos)
 * evitando falsos positivos en confirmaciones de cotización o números en frases naturales.
 */
export async function POST(req: Request) {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
  const provided = req.headers.get('x-webhook-secret') || '';
  if (!secret || secret.length < 24 || provided.length !== secret.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(secret))) {
    return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  }

  try {
    const body = await req.json();
    console.log(`[WhatsApp Webhook] Mensaje entrante de ...${String(body?.from || '').slice(-4)} (${String(body?.body || '').length} caracteres)`);

    const fromRaw = body?.from || body?.From || body?.data?.from || body?.data?.author || '';
    const textRaw = body?.body || body?.Body || body?.data?.body || body?.text || '';

    if (!fromRaw || !textRaw) {
      return NextResponse.json({ success: true, message: 'Evento omitido sin contenido' });
    }

    const cleanPhone = formatVenezuelaPhoneE164(String(fromRaw));
    const last10 = cleanPhone.slice(-10);
    const messageText = String(textRaw).trim();
    const upperText = messageText.toUpperCase();

    if (!cleanPhone || !messageText) {
      return NextResponse.json({ success: true, message: 'Número o texto no válido' });
    }

    await ensureServerAuth();
    const { firestore } = initializeFirebaseServer();

    // ─────────────────────────────────────────────────────────────
    // INTENT 1: CONFIRMACIÓN ESTRICTA DE COTIZACIÓN ABIERTA
    // Solo si es una confirmación corta y NO menciona catálogo, productos, precios o marcas,
    // y únicamente si el cliente posee una cotización activa en estado 'Enviada'.
    // ─────────────────────────────────────────────────────────────
    const mentionsCatalogOrProduct = /(CATALOGO|CATÁLOGO|PRECIO|BALON|BICI|MARCA|MODELO|ENVIAME|ENVÍAME|PASAME|PÁSAME|MANDAME|MÁNDAME|TIENEN|TIENES|CUANTO|FOTO|PDF|LISTA|OFERTA|ADIDAS|NIKE|MOLTEN|SPARTAN|MIKASA|SPALDING|WILSON)/i.test(upperText);
    const isStrictQuoteConfirm =
      !mentionsCatalogOrProduct &&
      messageText.length <= 28 &&
      /^(CONFIRMO|CONFIRMAR COTIZACION|ACEPTO COTIZACION|APROBADO|APROBAR COTIZACION)$/i.test(upperText);

    if (isStrictQuoteConfirm) {
      const quotesRef = collection(firestore, 'quotes');
      const snap = await getDocs(query(quotesRef, orderBy('createdAt', 'desc'), limit(50)));

      const matchedQuote = snap.docs.find(d => {
        const qData = d.data();
        const p = String(qData.customerPhone || '').replace(/[^\d]/g, '');
        return p.endsWith(last10) && qData.status === 'Enviada';
      });

      if (matchedQuote) {
        const qData = matchedQuote.data();
        const quoteCode = qData.quoteNumber || qData.quoteCode || matchedQuote.id.substring(0, 8).toUpperCase();

        try {
          await updateDoc(doc(firestore, 'quotes', matchedQuote.id), {
            closerCustomerInterested: true,
            closerCustomerResponse: messageText,
            closerCustomerRespondedAt: serverTimestamp(),
            status: 'Aceptada'
          });
        } catch (updateErr) {
          console.error('[WhatsApp Webhook] Error actualizando cotización:', updateErr);
        }

        const reply = `Hola *${qData.customerName || 'Cliente'}* 👋\n\n` +
          `¡Excelente! 🙌 Ya registramos tu aprobación para la cotización *#${quoteCode}*.\n\n` +
          `En breve nos comunicamos contigo por aquí para coordinar los detalles de pago y despacho. ¡Gracias por tu confianza! ⚽\n\n` +
          `— *El equipo de Athleticenter*`;

        await sendBackgroundWhatsAppMessage({ phone: cleanPhone, message: reply });
        return NextResponse.json({ success: true, action: 'quote_confirmed', quoteId: matchedQuote.id, replyText: reply });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // INTENT 2: RESPUESTA NUMÉRICA ESTRICTA A CATÁLOGO BI-SEMANAL O ENCUESTA CLOSER (SOLO "1" AL "6")
    // ─────────────────────────────────────────────────────────────
    const strictOptionMatch = upperText.match(/^(?:OPCION|OPCIÓN)?\s*([1-6])$/i);
    if (strictOptionMatch) {
      const optionNum = parseInt(strictOptionMatch[1], 10);

      let activeCatalogSnap = null;
      try {
        activeCatalogSnap = await getDoc(doc(firestore, 'system', 'activeCatalog'));
      } catch {}

      const activeSlots: any[] = activeCatalogSnap?.exists() ? (activeCatalogSnap.data()?.slots || []) : [];
      const matchedSlot = activeSlots.find((s: any) => s.slot === optionNum);

      const quotesRef = collection(firestore, 'quotes');
      const quotesSnap = await getDocs(query(quotesRef, orderBy('createdAt', 'desc'), limit(30)));
      const matchedCloserQuote = quotesSnap.docs.find(d => {
        const qData = d.data();
        const p = String(qData.customerPhone || '').replace(/[^\d]/g, '');
        return p.endsWith(last10) && qData.closerFeedbackSent === true;
      });

      if (matchedCloserQuote && optionNum <= 4) {
        const objectionLabels: Record<string, string> = {
          '1': 'Precio / Presupuesto',
          '2': 'Tiempo de entrega',
          '3': 'Consiguió otra opción',
          '4': 'Aún lo está evaluando'
        };
        const label = objectionLabels[String(optionNum)] || 'Otro motivo';

        try {
          await updateDoc(doc(firestore, 'quotes', matchedCloserQuote.id), {
            closerObjection: label,
            closerObjectionCode: String(optionNum),
            closerFeedbackReceivedAt: serverTimestamp()
          });
        } catch {}

        const reply = `¡Muchas gracias por contarnos! 🙌 Tomamos muy en cuenta tu comentario (*${label}*) para seguir mejorando nuestros precios y servicio.\n\n` +
          `Cuando necesites algo más, estamos a la orden por aquí.\n\n— *El equipo de Athleticenter*`;

        await sendBackgroundWhatsAppMessage({ phone: cleanPhone, message: reply });
        return NextResponse.json({ success: true, action: 'objection_recorded', option: optionNum, label, replyText: reply });
      }

      if (matchedSlot) {
        try {
          await addDoc(collection(firestore, 'catalog_leads'), {
            phone: cleanPhone,
            slot: matchedSlot.slot,
            productName: matchedSlot.name,
            productSku: matchedSlot.sku,
            priceDivisas: matchedSlot.priceDivisas,
            type: matchedSlot.type,
            rawMessage: messageText,
            createdAt: serverTimestamp()
          });
        } catch {}

        const reply = `¡Buena elección! 🙌 Ya anotamos tu solicitud para apartar:\n\n` +
          `• *${matchedSlot.name}* (Cód: ${matchedSlot.sku})\n` +
          `• 💵 Precio en divisas: *${money(Number(matchedSlot.priceDivisas || 0))}*\n\n` +
          `En unos minutos te escribimos para confirmar cuántas unidades necesitas y coordinar el envío. ⚽\n\n` +
          `— *El equipo de Athleticenter*`;

        await sendBackgroundWhatsAppMessage({ phone: cleanPhone, message: reply });
        return NextResponse.json({ success: true, action: 'catalog_product_requested', slot: matchedSlot.slot, product: matchedSlot.name, replyText: reply });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // INTENT 3: RASTREO EXPLÍCITO DE PEDIDO
    // ─────────────────────────────────────────────────────────────
    if (/(ESTADO DE MI PEDIDO|ESTATUS DE MI PEDIDO|RASTREAR MI PEDIDO|NUMERO DE GUIA|MI GUIA DE ENVIO)/i.test(upperText)) {
      const ordersRef = collection(firestore, 'orders');
      const snap = await getDocs(query(ordersRef, orderBy('createdAt', 'desc'), limit(50)));

      const matchedOrder = snap.docs.find(d => {
        const oData = d.data();
        const p = String(oData.customerPhone || '').replace(/[^\d]/g, '');
        return p.endsWith(last10);
      });

      if (matchedOrder) {
        const oData = matchedOrder.data();
        const code = oData.orderNumber || matchedOrder.id.substring(0, 8).toUpperCase();
        const bal = computeOrderBalanceForWhatsApp(oData);
        const balanceLine = bal.isPaid
          ? `• *Pago:* ✅ Pagado al 100% — Saldo $0.00\n`
          : `• *Total (Lista BCV):* ${money(bal.totalListUSD)}\n` +
            (bal.isBillable
              ? `• *Saldo pendiente (Lista BCV):* ${money(bal.pendingListUSD)} (Divisas: ${money(bal.pendingDivisasUSD)})\n`
              : `• *Pagando en divisas (-${bal.divisasDiscountPct}%):* ${money(bal.totalDivisasUSD)}\n`);

        const replyText = `Hola *${oData.customerName || 'Cliente'}* 👋\n\n` +
          `Aquí tienes el estado de tu pedido *#${code}*:\n` +
          `• *Estado:* ${humanOrderStatus(oData.status)}\n` +
          balanceLine +
          (oData.trackingNumber ? `• *Agencia / Guía:* ${oData.carrier || 'Encomienda'} — *${oData.trackingNumber}*\n` : '') +
          `\nCualquier duda o si deseas enviar un comprobante, respóndenos por este chat. 🙌\n\n` +
          `— *El equipo de Athleticenter*`;

        await sendBackgroundWhatsAppMessage({ phone: cleanPhone, message: replyText });
        return NextResponse.json({ success: true, action: 'reply_order_status', replyText });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // INTENT 4: TASA BCV DEL DÍA (CONSULTA DIRECTA DE TASA)
    // ─────────────────────────────────────────────────────────────
    if (/^(TASA|BCV|TASA BCV|CUAL ES LA TASA|A COMO ESTA EL DOLAR|TASA DEL DIA)\??$/i.test(upperText)) {
      let bcvRate = 65.50;
      try {
        const settingsSnap = await getDoc(doc(firestore, 'system', 'financials'));
        if (settingsSnap.exists() && settingsSnap.data().bcvRate) {
          bcvRate = Number(settingsSnap.data().bcvRate);
        }
      } catch {}

      const replyText = `Hola 👋\n\n` +
        `💵 *Tasa oficial BCV del día:* *Bs. ${bcvRate.toFixed(2)} / USD*\n\n` +
        `Recuerda que pagando en divisas tienes *25% de descuento*, y si pagas tu factura de contado cuentas con *10% adicional*.\n\n` +
        `— *El equipo de Athleticenter*`;

      await sendBackgroundWhatsAppMessage({ phone: cleanPhone, message: replyText });
      return NextResponse.json({ success: true, action: 'reply_bcv_rate', replyText });
    }

    // ─────────────────────────────────────────────────────────────
    // INTENT 5: AGENTE AGÉNTICO COMERCIAL (ARM INBOUND v3.0 CON PDF Y FOTOS)
    // ─────────────────────────────────────────────────────────────
    console.log(`[WhatsApp Webhook] 🤖 Activando Agente ARM v3.0 para +${cleanPhone}: "${messageText}"`);
    const armResult = await processArmInboundMessage({ phone: cleanPhone, messageText });

    if (armResult.replyText) {
      await sendBackgroundWhatsAppMessage({
        phone: cleanPhone,
        message: armResult.replyText,
        documentUrl: armResult.pdfUrl,
        pdfBase64: armResult.pdfBase64,
        fileName: armResult.pdfFileName || 'Catalogo_Mayorista_Athleticenter.pdf',
        imageUrl: armResult.imageUrl
      });

      if (armResult.extraPhotos && armResult.extraPhotos.length > 0) {
        for (const extra of armResult.extraPhotos) {
          await sendBackgroundWhatsAppMessage({
            phone: cleanPhone,
            message: extra.caption,
            imageUrl: extra.imageUrl
          });
        }
      }

      return NextResponse.json({
        success: true,
        action: 'arm_agent_processed',
        replyText: armResult.replyText,
        pdfSent: Boolean(armResult.pdfBase64 || armResult.pdfUrl),
        imageSent: Boolean(armResult.imageUrl),
        extraPhotosSent: armResult.extraPhotos?.length || 0,
        leadQualified: armResult.leadQualified,
        handoffTriggered: armResult.handoffTriggered,
        matchedProductsCount: armResult.matchedProductsCount
      });
    }

    return NextResponse.json({ success: true, message: 'Evento recibido y procesado por ARM' });

  } catch (error: any) {
    console.error(`[WhatsApp Webhook] Error en procesamiento:`, error);
    return NextResponse.json({ success: false, error: error?.message }, { status: 500 });
  }
}
