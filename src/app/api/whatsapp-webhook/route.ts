import { NextResponse } from 'next/server';
import { initializeFirebaseServer } from '@/firebase/server-init';
import { collection, query, where, getDocs, limit, orderBy, doc, getDoc } from 'firebase/firestore';

/**
 * WEBHOOK DE RESPUESTAS AUTOMÁTICAS Y AUTO-RESPONDER DE WHATSAPP (ULTRAMSG)
 * Procesa mensajes entrantes de clientes ("ESTADO", "TASA", "PEDIDO", "AYUDA")
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log(`[WhatsApp Webhook] Mensaje entrante de UltraMsg:`, JSON.stringify(body));

    const fromRaw = body?.data?.from || body?.from || body?.data?.author || '';
    const textRaw = body?.data?.body || body?.body || '';

    if (!fromRaw || !textRaw) {
      return NextResponse.json({ success: true, message: 'Evento omitido sin contenido' });
    }

    // Formatear número telefónico del cliente
    let cleanPhone = String(fromRaw).replace(/[^\d]/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '58' + cleanPhone.substring(1);

    const messageText = String(textRaw).trim().toUpperCase();

    const { firestore } = initializeFirebaseServer();

    // COMANDO 1: RASTREO Y ESTADO DE PEDIDO ("ESTADO" o "PEDIDO")
    if (messageText.includes('ESTADO') || messageText.includes('PEDIDO') || messageText.includes('GUIA') || messageText.includes('TRACKING')) {
      const ordersRef = collection(firestore, 'orders');
      const q = query(
        ordersRef, 
        where('customerPhone', '>=', cleanPhone.slice(-10)), 
        limit(5)
      );
      const snap = await getDocs(q);

      let replyText = '';
      if (!snap.empty) {
        const lastOrder = snap.docs[0].data();
        replyText = `*⚽ ATHLETICENTER C.A. - ESTATUS DE SU PEDIDO*\n\n` +
          `Estimado(a) *${lastOrder.customerName || 'Cliente'}*,\n` +
          `📄 *Expediente:* #${snap.docs[0].id.substring(0, 8).toUpperCase()}\n` +
          `📅 *Estado:* ${lastOrder.status || 'En Proceso'}\n` +
          `💰 *Total USD:* $${(lastOrder.totalAmount || 0).toFixed(2)}\n` +
          (lastOrder.trackingNumber ? `🚚 *Guía de Envío:* ${lastOrder.trackingNumber} (${lastOrder.carrier || 'MRW'})\n` : '') +
          `\nPara conciliar abonos o asistencia personalizada, un asesor comercial se pondrá en contacto pronto.`;
      } else {
        replyText = `*⚽ ATHLETICENTER C.A. - CONSULTA DE PEDIDOS*\n\n` +
          `Hola! No encontramos expedientes recientes vinculados al celular +${cleanPhone}.\n` +
          `Por favor envíenos su número de RIF o número de pedido para ubicarlo de inmediato.`;
      }

      const { sendBackgroundWhatsAppMessage } = await import('@/lib/whatsapp-gateway');
      await sendBackgroundWhatsAppMessage({ phone: cleanPhone, message: replyText });
      return NextResponse.json({ success: true, action: 'reply_order_status' });
    }

    // COMANDO 2: TASA BCV DEL DÍA ("TASA" o "BCV")
    if (messageText.includes('TASA') || messageText.includes('BCV') || messageText.includes('DOLAR')) {
      const settingsSnap = await getDoc(doc(firestore, 'system', 'financials'));
      const bcvRate = settingsSnap.exists() ? settingsSnap.data().bcvRate || 65.50 : 65.50;

      const replyText = `*🏛️ ATHLETICENTER C.A. - TASA OFICIAL BCV DEL DÍA*\n\n` +
        `La Tasa Oficial de Referencia para facturación hoy es:\n` +
        `💵 *Bs. ${bcvRate.toFixed(2)} / USD*\n\n` +
        `Todos nuestros precios de balones y artículos deportivos se calculan a la Tasa BCV Oficial.`;

      const { sendBackgroundWhatsAppMessage } = await import('@/lib/whatsapp-gateway');
      await sendBackgroundWhatsAppMessage({ phone: cleanPhone, message: replyText });
      return NextResponse.json({ success: true, action: 'reply_bcv_rate' });
    }

    return NextResponse.json({ success: true, message: 'Evento recibido y procesado.' });

  } catch (error: any) {
    console.error(`[WhatsApp Webhook] Error en procesamiento:`, error);
    return NextResponse.json({ success: false, error: error?.message }, { status: 500 });
  }
}
