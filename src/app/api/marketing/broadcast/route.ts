import { NextResponse } from 'next/server';
import { initializeFirebaseServer, ensureServerAuth } from '@/firebase/server-init';
import { collection, addDoc, doc, updateDoc, serverTimestamp, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { sendBackgroundWhatsAppMessage, formatVenezuelaPhoneE164 } from '@/lib/whatsapp-gateway';

/**
 * REGLAS DE SEGURIDAD ANTI-BLOQUEO PARA DIFUSIÓN MASIVA (WHATSAPP):
 *  - Jitter orgánico entre mensajes: 8 a 14 segundos (evita detección de cadencia robótica).
 *  - Pausa de enfriamiento por lotes: Cada 20 mensajes enviados, pausa de 60 segundos.
 *  - Firma institucional unificada: Siempre 'El equipo de Athleticenter'.
 */
const MIN_DELAY_MS = 8000;
const MAX_DELAY_MS = 14000;
const BATCH_SIZE = 20;
const BATCH_COOLDOWN_MS = 60000;

function getRandomJitter(min = MIN_DELAY_MS, max = MAX_DELAY_MS) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export interface BroadcastRecipient {
  id?: string;
  name?: string;
  phone: string;
}

/**
 * GET: Obtener el historial reciente de campañas de marketing
 */
export async function GET() {
  try {
    await ensureServerAuth();
    const { firestore } = initializeFirebaseServer();

    const campaignsRef = collection(firestore, 'marketing_campaigns');
    const snap = await getDocs(query(campaignsRef, orderBy('createdAt', 'desc'), limit(20)));

    const campaigns = snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    return NextResponse.json({ success: true, campaigns });
  } catch (error: any) {
    console.error('[Marketing Broadcast GET] Error:', error);
    return NextResponse.json({ success: false, error: error?.message }, { status: 500 });
  }
}

/**
 * POST: Iniciar una campaña de difusión masiva en segundo plano
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      title,
      message,
      mediaUrl,
      mediaType = 'none',
      audienceType = 'all',
      recipients = [],
      userId = 'admin',
      userName = 'Administrador'
    } = body;

    if (!title || !message) {
      return NextResponse.json({ success: false, error: 'Título y mensaje son requeridos.' }, { status: 400 });
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json({ success: false, error: 'La lista de destinatarios está vacía.' }, { status: 400 });
    }

    // Filtrar números válidos
    const validRecipients: BroadcastRecipient[] = recipients
      .map(r => ({
        id: r.id || '',
        name: r.name || 'Cliente',
        phone: formatVenezuelaPhoneE164(r.phone || '')
      }))
      .filter(r => r.phone && r.phone.length >= 10);

    if (validRecipients.length === 0) {
      return NextResponse.json({ success: false, error: 'Ningún destinatario tiene un número telefónico válido.' }, { status: 400 });
    }

    await ensureServerAuth();
    const { firestore } = initializeFirebaseServer();

    // 1. Crear documento de campaña en Firestore
    const campaignRef = await addDoc(collection(firestore, 'marketing_campaigns'), {
      title,
      message,
      mediaUrl: mediaType !== 'none' ? mediaUrl : null,
      mediaType,
      audienceType,
      totalTarget: validRecipients.length,
      sentCount: 0,
      failedCount: 0,
      status: 'processing',
      sentBy: userId,
      sentByName: userName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    const campaignId = campaignRef.id;
    console.log(`[Marketing Broadcast] 🚀 Campaña #${campaignId} iniciada para ${validRecipients.length} destinatarios.`);

    // 2. Procesar el envío en segundo plano (asíncrono, no bloquea la respuesta HTTP)
    (async () => {
      let sentCount = 0;
      let failedCount = 0;
      const logs: { phone: string; name: string; success: boolean; error?: string; time: string }[] = [];

      for (let i = 0; i < validRecipients.length; i++) {
        const item = validRecipients[i];
        
        // Reemplazar variable {{nombre}}
        const personalized = message.replace(/{{nombre}}/gi, item.name || 'Cliente');
        
        // Construir mensaje oficial con formato Athleticenter
        const finalMessage = `*ATHLETICENTER*\n\n` +
          `*${title}*\n\n` +
          `${personalized}\n\n` +
          `Atentamente,\n*El equipo de Athleticenter*`;

        try {
          const res = await sendBackgroundWhatsAppMessage({
            phone: item.phone,
            message: finalMessage,
            imageUrl: mediaType === 'image' && mediaUrl ? mediaUrl : undefined
          });

          if (res.success) {
            sentCount++;
            logs.push({ phone: item.phone, name: item.name || '', success: true, time: new Date().toISOString() });
          } else {
            failedCount++;
            logs.push({ phone: item.phone, name: item.name || '', success: false, error: res.error, time: new Date().toISOString() });
          }
        } catch (err: any) {
          failedCount++;
          logs.push({ phone: item.phone, name: item.name || '', success: false, error: err.message, time: new Date().toISOString() });
        }

        // Actualizar progreso periódicamente cada 5 mensajes o al final
        if ((i + 1) % 5 === 0 || i === validRecipients.length - 1) {
          try {
            await updateDoc(doc(firestore, 'marketing_campaigns', campaignId), {
              sentCount,
              failedCount,
              updatedAt: serverTimestamp()
            });
          } catch (updateErr) {
            console.warn(`[Marketing Broadcast] Error actualizando progreso en Firestore:`, updateErr);
          }
        }

        // Pausa de seguridad anti-bloqueo si quedan más mensajes
        if (i < validRecipients.length - 1) {
          // Si completamos un lote de 20 mensajes, enfriar 60 segundos
          if ((i + 1) % BATCH_SIZE === 0) {
            console.log(`[Marketing Broadcast] ⏳ Pausa de enfriamiento por lote (${BATCH_COOLDOWN_MS / 1000}s) tras ${i + 1} envíos...`);
            await new Promise(r => setTimeout(r, BATCH_COOLDOWN_MS));
          } else {
            // Jitter aleatorio (8-14s)
            const waitTime = getRandomJitter();
            await new Promise(r => setTimeout(r, waitTime));
          }
        }
      }

      // Marcar campaña como completada
      try {
        await updateDoc(doc(firestore, 'marketing_campaigns', campaignId), {
          sentCount,
          failedCount,
          status: 'completed',
          completedAt: serverTimestamp(),
          logs: logs.slice(0, 100) // Guardar los primeros 100 logs de auditoría
        });
        console.log(`[Marketing Broadcast] ✅ Campaña #${campaignId} finalizada. Enviados: ${sentCount}, Fallidos: ${failedCount}`);
      } catch (finalErr) {
        console.error('[Marketing Broadcast] Error marcando campaña como completada:', finalErr);
      }
    })().catch(bgErr => {
      console.error('[Marketing Broadcast Worker] Error fatal en worker de fondo:', bgErr);
    });

    // Responder inmediatamente al navegador para que no se congele
    return NextResponse.json({
      success: true,
      campaignId,
      totalTarget: validRecipients.length,
      message: `Campaña iniciada con éxito en segundo plano con protección anti-bloqueo. Total destinatarios: ${validRecipients.length}.`
    });

  } catch (error: any) {
    console.error('[Marketing Broadcast POST] Error:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Error iniciando campaña' }, { status: 500 });
  }
}
