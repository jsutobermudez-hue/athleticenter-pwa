import { NextResponse } from 'next/server';
import { initializeFirebaseServer, ensureServerAuth } from '@/firebase/server-init';
import { collection, addDoc, doc, updateDoc, serverTimestamp, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { formatVenezuelaPhoneE164 } from '@/lib/whatsapp-gateway';
import { enqueueWhatsAppBatch } from '@/lib/whatsapp-dispatch-server';
import { authorizeRequest, MANAGER_ROLES } from '@/lib/server-auth';

const MAX_RECIPIENTS = 500;

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
export async function GET(req: Request) {
  const auth = await authorizeRequest(req, MANAGER_ROLES);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

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
  // Seguridad: solo gerencia/admin/superadmin con sesión válida (o proceso interno).
  const auth = await authorizeRequest(req, MANAGER_ROLES);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  try {
    const body = await req.json();
    const {
      title,
      message,
      mediaUrl,
      mediaType = 'none',
      audienceType = 'all',
      recipients = [],
    } = body;
    // La auditoría se toma de la sesión verificada, nunca del cuerpo de la petición.
    const userId = auth.uid;
    const userName = auth.name;

    if (Array.isArray(recipients) && recipients.length > MAX_RECIPIENTS) {
      return NextResponse.json({ success: false, error: `Máximo ${MAX_RECIPIENTS} destinatarios por campaña.` }, { status: 400 });
    }
    if (mediaUrl && typeof mediaUrl === 'string' && !mediaUrl.startsWith('data:image/') && !mediaUrl.startsWith('https://')) {
      return NextResponse.json({ success: false, error: 'La imagen debe ser una foto del inventario (https o imagen embebida).' }, { status: 400 });
    }

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
    console.log(`[Marketing Broadcast] 🚀 Campaña #${campaignId} creada para ${validRecipients.length} destinatarios por ${userName}.`);

    // 2. Encolar en el gateway 24/7 de São Paulo: allí se aplican las pausas anti-bloqueo
    //    (8-14 s, enfriamiento 60 s cada 20) y el horario comercial. El gateway reporta el progreso
    //    a /api/marketing/campaign-progress. Así el envío no depende de que esta petición siga viva.
    const items = validRecipients.map(item => {
      const personalized = message.replace(/{{nombre}}/gi, item.name || 'Cliente');
      const finalMessage = `*ATHLETICENTER*\n\n` +
        `*${title}*\n\n` +
        `${personalized}\n\n` +
        `Atentamente,\n*El equipo de Athleticenter*`;
      return { number: item.phone, text: finalMessage, imageUrl: mediaType === 'image' && mediaUrl ? mediaUrl : undefined };
    });

    const q = await enqueueWhatsAppBatch(items, { campaignId, label: title });
    if (!q.success) {
      await updateDoc(doc(firestore, 'marketing_campaigns', campaignId), {
        status: 'failed',
        error: q.error || 'Gateway no disponible',
        updatedAt: serverTimestamp()
      }).catch(() => {});
      return NextResponse.json({ success: false, error: `No se pudo encolar la campaña: ${q.error}` }, { status: 502 });
    }

    await updateDoc(doc(firestore, 'marketing_campaigns', campaignId), { status: 'queued', updatedAt: serverTimestamp() }).catch(() => {});

    return NextResponse.json({
      success: true,
      campaignId,
      totalTarget: validRecipients.length,
      message: q.businessHours
        ? `Campaña en cola con protección anti-bloqueo. Total destinatarios: ${validRecipients.length}.`
        : `Campaña en cola. Por estar fuera del horario comercial (lun-sáb 8:00-19:00), el envío comenzará en el próximo horario hábil. Total: ${validRecipients.length}.`
    });

  } catch (error: any) {
    console.error('[Marketing Broadcast POST] Error:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Error iniciando campaña' }, { status: 500 });
  }
}
