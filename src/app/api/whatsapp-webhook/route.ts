import { NextResponse } from 'next/server';
import { initializeFirebaseServer, ensureServerAuth } from '@/firebase/server-init';
import { collection, query, where, getDocs, limit, orderBy, doc, getDoc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { sendBackgroundWhatsAppMessage, formatVenezuelaPhoneE164 } from '@/lib/whatsapp-gateway';

/**
 * WEBHOOK MULTI-GATEWAY DE WHATSAPP (ATHLETICENTER)
 * Procesa mensajes entrantes desde:
 *  - Servidor Local (whatsapp-web.js en puerto 3001)
 *  - UltraMsg / Twilio / Gateway en la nube
 * 
 * Intents soportados:
 *  1. Confirmación de cotizaciones ("SÍ", "CONFIRMO", "ME INTERESA")
 *  2. Encuesta de objeciones Gemini Closer (1, 2, 3, 4)
 *  3. Estatus de pedidos ("ESTADO", "PEDIDO", "GUIA")
 *  4. Tasa BCV del día ("TASA", "BCV")
 *  5. Menú de ayuda general ("HOLA", "ASESOR", "AYUDA")
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log(`[WhatsApp Webhook] Mensaje entrante:`, JSON.stringify(body));

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
    // INTENT 1: CONFIRMACIÓN DE COTIZACIÓN ("SÍ", "CONFIRMO", ETC.)
    // ─────────────────────────────────────────────────────────────
    const isAffirmative = /^(S[IÍ]|CONFIRMO|CONFIRMAR|ACEPTO|ACEPTAR|DALE|ME INTERESA|PROCEDER|APROBADO|APROBAR)(\b|\s)/i.test(upperText)
      || upperText === 'SÍ' || upperText === 'SI';

    if (isAffirmative) {
      // Buscar la cotización más reciente vinculada a este cliente
      const quotesRef = collection(firestore, 'quotes');
      const snap = await getDocs(query(quotesRef, orderBy('createdAt', 'desc'), limit(50)));
      
      const matchedQuote = snap.docs.find(d => {
        const qData = d.data();
        const p = String(qData.customerPhone || '').replace(/[^\d]/g, '');
        return p.endsWith(last10);
      });

      if (matchedQuote) {
        const qData = matchedQuote.data();
        const quoteCode = qData.quoteNumber || qData.quoteCode || matchedQuote.id.substring(0, 8).toUpperCase();

        try {
          await updateDoc(doc(firestore, 'quotes', matchedQuote.id), {
            closerCustomerInterested: true,
            closerCustomerResponse: messageText,
            closerCustomerRespondedAt: serverTimestamp(),
            status: qData.status === 'Enviada' ? 'Aceptada' : qData.status
          });
        } catch (updateErr) {
          console.error('[WhatsApp Webhook] Error actualizando cotización:', updateErr);
        }

        const reply = `*ATHLETICENTER*\n\n` +
          `¡Excelente noticia! 🙌 Hemos registrado su confirmación para la cotización *#${quoteCode}*.\n\n` +
          `El equipo de Athleticenter se comunicará con usted a la brevedad para coordinar la facturación y el despacho.\n\n` +
          `¡Muchas gracias por su confianza! ⚽`;

        await sendBackgroundWhatsAppMessage({ phone: cleanPhone, message: reply });
        return NextResponse.json({ success: true, action: 'quote_confirmed', quoteId: matchedQuote.id });
      } else {
        const reply = `*ATHLETICENTER*\n\n` +
          `¡Muchas gracias por su respuesta! 🙌 Hemos recibido su confirmación. El equipo de Athleticenter se comunicará con usted en breve para asistirle.`;
        await sendBackgroundWhatsAppMessage({ phone: cleanPhone, message: reply });
        return NextResponse.json({ success: true, action: 'quote_confirmed_general' });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // INTENT 2: RESPUESTA A CATÁLOGO (1-6) O ENCUESTA CLOSER (1-4)
    // ─────────────────────────────────────────────────────────────
    const catalogRegex = /(?:QUIERO|APARTAME|ME INTERESA|DAME|APARTAR|SEPARA|COMPRAR|OPCION|NUMERO|#)?\s*(?:EL|LA)?\s*([1-6])(?:\b|\.|\s|$)/i;
    const match = upperText.match(catalogRegex);
    const hasBuyKeyword = /(QUIERO|APARTAME|ME INTERESA|DAME|APARTAR|SEPARA|COMPRAR)/i.test(upperText);

    const optionChar = match ? match[1] : '';

    if (optionChar) {
      const optionNum = parseInt(optionChar, 10);

      // 1. Revisar si hay un catálogo activo publicado en el sistema
      let activeCatalogSnap = null;
      try {
        activeCatalogSnap = await getDoc(doc(firestore, 'system', 'activeCatalog'));
      } catch (catErr) {
        console.warn('[WhatsApp Webhook] No se pudo leer activeCatalog:', catErr);
      }

      const activeSlots: any[] = activeCatalogSnap?.exists() ? (activeCatalogSnap.data()?.slots || []) : [];
      const matchedSlot = activeSlots.find((s: any) => s.slot === optionNum);

      // Buscar si el cliente tenía una cotización en etapa de encuesta Closer
      const quotesRef = collection(firestore, 'quotes');
      const quotesSnap = await getDocs(query(quotesRef, orderBy('createdAt', 'desc'), limit(30)));
      const matchedCloserQuote = quotesSnap.docs.find(d => {
        const qData = d.data();
        const p = String(qData.customerPhone || '').replace(/[^\d]/g, '');
        return p.endsWith(last10) && qData.closerFeedbackSent === true;
      });

      // Si el cliente tenía encuesta de Closer pendiente y escribió solo "1", "2", "3" o "4" sin palabras de compra:
      if (matchedCloserQuote && !hasBuyKeyword && optionNum <= 4) {
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
        } catch (updateErr) {
          console.error('[WhatsApp Webhook] Error registrando objeción:', updateErr);
        }

        const reply = `*ATHLETICENTER*\n\n` +
          `Muchas gracias por su respuesta. Tomamos muy en cuenta su retroalimentación (*${label}*) para seguir brindándole el mejor servicio y las mejores condiciones comerciales.\n\n` +
          `El equipo de Athleticenter queda a su entera disposición. 🙌`;

        await sendBackgroundWhatsAppMessage({ phone: cleanPhone, message: reply });
        return NextResponse.json({ success: true, action: 'objection_recorded', option: optionNum, label });
      }

      // De lo contrario, si hay un producto en el catálogo en ese slot: ¡Es una solicitud de producto!
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
        } catch (leadErr) {
          console.error('[WhatsApp Webhook] Error guardando catalog_lead:', leadErr);
        }

        const reply = `*ATHLETICENTER*\n\n` +
          `¡Excelente elección! 🙌 Hemos registrado su solicitud para apartar:\n\n` +
          `• *${matchedSlot.name}* (Ref: ${matchedSlot.sku})\n` +
          `• 💵 Precio en Divisas: *$${Number(matchedSlot.priceDivisas || 0).toFixed(2)}*\n\n` +
          `Un asesor de nuestro equipo se comunicará con usted a la brevedad para confirmar la cantidad de unidades y coordinar el despacho.\n\n` +
          `¡Muchas gracias por su confianza! ⚽`;

        await sendBackgroundWhatsAppMessage({ phone: cleanPhone, message: reply });
        return NextResponse.json({ success: true, action: 'catalog_product_requested', slot: matchedSlot.slot, product: matchedSlot.name });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // INTENT 3: RASTREO Y ESTADO DE PEDIDO ("ESTADO" o "PEDIDO")
    // ─────────────────────────────────────────────────────────────
    if (upperText.includes('ESTADO') || upperText.includes('PEDIDO') || upperText.includes('GUIA') || upperText.includes('TRACKING') || upperText.includes('ESTATUS')) {
      const ordersRef = collection(firestore, 'orders');
      const snap = await getDocs(query(ordersRef, orderBy('createdAt', 'desc'), limit(50)));
      
      const matchedOrder = snap.docs.find(d => {
        const oData = d.data();
        const p = String(oData.customerPhone || '').replace(/[^\d]/g, '');
        return p.endsWith(last10);
      });

      let replyText = '';
      if (matchedOrder) {
        const oData = matchedOrder.data();
        const code = oData.orderNumber || matchedOrder.id.substring(0, 8).toUpperCase();
        const total = Number(oData.totalAmount || 0).toFixed(2);
        const status = oData.status || 'En Proceso';

        replyText = `*ATHLETICENTER*\n\n` +
          `Estimado(a) *${oData.customerName || 'Cliente'}*:\n\n` +
          `Le informamos el estatus de su pedido *#${code}*:\n` +
          `• *Estado:* ${status}\n` +
          `• *Total USD:* $${total}\n` +
          (oData.trackingNumber ? `• *Guía de Envío:* ${oData.trackingNumber} (${oData.carrier || 'MRW'})\n` : '') +
          `\nPara conciliar abonos o coordinar entregas, el equipo de Athleticenter está a su disposición.`;
      } else {
        replyText = `*ATHLETICENTER*\n\n` +
          `Hola. No encontramos pedidos recientes asociados al número +${cleanPhone}.\n\n` +
          `Por favor indíquenos su nombre, RIF o número de pedido para que el equipo de Athleticenter lo verifique de inmediato.`;
      }

      await sendBackgroundWhatsAppMessage({ phone: cleanPhone, message: replyText });
      return NextResponse.json({ success: true, action: 'reply_order_status' });
    }

    // ─────────────────────────────────────────────────────────────
    // INTENT 4: TASA BCV DEL DÍA ("TASA" o "BCV")
    // ─────────────────────────────────────────────────────────────
    if (upperText.includes('TASA') || upperText.includes('BCV') || upperText.includes('DOLAR')) {
      let bcvRate = 65.50;
      try {
        const settingsSnap = await getDoc(doc(firestore, 'system', 'financials'));
        if (settingsSnap.exists() && settingsSnap.data().bcvRate) {
          bcvRate = Number(settingsSnap.data().bcvRate);
        }
      } catch (rateErr) {
        console.warn('[WhatsApp Webhook] No se pudo leer tasa BCV de firestore:', rateErr);
      }

      const replyText = `*ATHLETICENTER*\n\n` +
        `💵 *Tasa Oficial BCV del día:*\n` +
        `*Bs. ${bcvRate.toFixed(2)} / USD*\n\n` +
        `Todos nuestros productos y facturas se calculan con base en la tasa oficial vigente.\n\n` +
        `Atentamente,\n*El equipo de Athleticenter*`;

      await sendBackgroundWhatsAppMessage({ phone: cleanPhone, message: replyText });
      return NextResponse.json({ success: true, action: 'reply_bcv_rate' });
    }

    // ─────────────────────────────────────────────────────────────
    // INTENT 5: MENÚ DE AYUDA Y SALUDO GENERAL
    // ─────────────────────────────────────────────────────────────
    if (
      upperText.includes('HOLA') || upperText.includes('BUENOS') || upperText.includes('BUENAS') ||
      upperText.includes('AYUDA') || upperText.includes('ASESOR') || upperText.includes('INFO') ||
      upperText.includes('CATALOGO')
    ) {
      const replyText = `*ATHLETICENTER*\n\n` +
        `¡Hola! Bienvenido a Athleticenter, mayoristas en balones y artículos deportivos.\n\n` +
        `Comandos automáticos disponibles:\n` +
        `• Escriba *ESTADO* para rastrear su pedido.\n` +
        `• Escriba *TASA* para consultar la tasa BCV oficial.\n` +
        `• Escriba *SÍ* si desea confirmar una cotización recibida.\n\n` +
        `Si requiere atención personalizada, en breve un asesor de nuestro equipo le atenderá con gusto. 🙌`;

      await sendBackgroundWhatsAppMessage({ phone: cleanPhone, message: replyText });
      return NextResponse.json({ success: true, action: 'reply_menu' });
    }

    return NextResponse.json({ success: true, message: 'Evento recibido sin comando coincidente' });

  } catch (error: any) {
    console.error(`[WhatsApp Webhook] Error en procesamiento:`, error);
    return NextResponse.json({ success: false, error: error?.message }, { status: 500 });
  }
}
