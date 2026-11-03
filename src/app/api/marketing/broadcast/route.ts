import { NextResponse } from 'next/server';
import { initializeFirebaseServer, ensureServerAuth } from '@/firebase/server-init';
import { collection, addDoc, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import { enqueueWhatsAppBatch, dispatchViaGateways } from '@/lib/whatsapp-dispatch-server';
import { formatVenezuelaPhoneE164 } from '@/lib/whatsapp-gateway';
import { authorizeRequest, MANAGER_ROLES } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutos máximo para procesar listas masivas

interface BroadcastRecipient {
  id: string;
  name: string;
  phone: string;
}

interface BroadcastPayload {
  title: string;
  message: string;
  mediaUrl?: string;
  mediaType?: 'none' | 'image' | 'video' | 'pdf' | 'document';
  mediaFileName?: string;
  audienceType: 'all' | 'debtors' | 'recurrent' | 'inactive' | 'vip' | 'custom' | 'test';
  recipients: BroadcastRecipient[];
  userId?: string;
  userName?: string;
  isTest?: boolean;
  testPhone?: string;
  testNumber?: string;
}

// Límite de seguridad para evitar DoS o bloqueos por WhatsApp
const MAX_RECIPIENTS = 1000;

export async function POST(req: Request) {
  try {
    const auth = await authorizeRequest(req, MANAGER_ROLES);
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const body: BroadcastPayload = await req.json();
    const {
      title,
      message,
      mediaUrl,
      mediaType = 'none',
      mediaFileName,
      audienceType = 'all',
      recipients = [],
    } = body;
    // La auditoría se toma de la sesión verificada, nunca del cuerpo de la petición.
    const userId = auth.uid;
    const userName = auth.name;

    if (Array.isArray(recipients) && recipients.length > MAX_RECIPIENTS) {
      return NextResponse.json({ success: false, error: `Máximo ${MAX_RECIPIENTS} destinatarios por campaña.` }, { status: 400 });
    }
    if (mediaUrl && typeof mediaUrl === 'string' && 
        !mediaUrl.startsWith('data:image/') && 
        !mediaUrl.startsWith('data:video/') && 
        !mediaUrl.startsWith('data:application/pdf') &&
        !mediaUrl.startsWith('data:@file/pdf') &&
        !mediaUrl.startsWith('data:') &&
        !mediaUrl.startsWith('https://') && 
        !mediaUrl.startsWith('http://')) {
      return NextResponse.json({ success: false, error: 'El archivo multimedia debe ser una imagen, video o documento PDF válido.' }, { status: 400 });
    }

    const isDoc = mediaType === 'pdf' || mediaType === 'document' || (mediaUrl && mediaUrl.includes('application/pdf'));
    const resolvedDocName = mediaFileName || (title ? `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf` : 'Catalogo_Athleticenter.pdf');

    // Modo de prueba inmediata a un solo número
    const testNum = body.testNumber || body.testPhone || (body.isTest && Array.isArray(body.recipients) && body.recipients[0]?.phone);
    if (body.isTest && testNum) {
      const testPhone = formatVenezuelaPhoneE164(testNum);
      const personalized = message ? message.replace(/{{nombre}}/gi, 'Cliente de Prueba') : '';
      const finalMessage = `*ATHLETICENTER [VISTA PREVIA]*\n\n` +
        (title ? `*${title}*\n\n` : '') +
        `${personalized}\n\n` +
        `Atentamente,\n*El equipo de Athleticenter*`;
      const res = await dispatchViaGateways({
        number: testPhone,
        text: finalMessage,
        imageUrl: mediaType === 'image' && mediaUrl ? mediaUrl : undefined,
        videoUrl: mediaType === 'video' && mediaUrl ? mediaUrl : undefined,
        documentUrl: isDoc && mediaUrl ? mediaUrl : undefined,
        fileName: resolvedDocName
      });
      return NextResponse.json({
        success: res.success,
        message: res.success ? `Mensaje de prueba enviado exitosamente a ${testPhone}` : `Fallo al enviar prueba: ${res.error}`
      });
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

    // 1. Crear documento de campaña en Firestore (Protegiendo límite de 1MB de Firestore para Base64)
    const firestoreMediaUrl = (mediaUrl && typeof mediaUrl === 'string' && mediaUrl.startsWith('data:'))
      ? (mediaUrl.length > 500000 ? `[Archivo ${(isDoc ? 'PDF' : mediaType).toUpperCase()} Base64 (${(mediaUrl.length / (1024 * 1024)).toFixed(1)} MB)]` : mediaUrl)
      : (mediaType !== 'none' ? mediaUrl : null);

    const campaignRef = await addDoc(collection(firestore, 'marketing_campaigns'), {
      title,
      message,
      mediaUrl: firestoreMediaUrl,
      mediaType: isDoc ? 'pdf' : mediaType,
      mediaFileName: isDoc ? resolvedDocName : null,
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
    const hasCommonMedia = Boolean(mediaUrl);
    const items = validRecipients.map(item => {
      const personalized = message.replace(/{{nombre}}/gi, item.name || 'Cliente');
      const finalMessage = `*ATHLETICENTER*\n\n` +
        `*${title}*\n\n` +
        `${personalized}\n\n` +
        `Atentamente,\n*El equipo de Athleticenter*`;
      return { 
        number: item.phone, 
        text: finalMessage
      };
    });

    const resolvedBatchMediaType: 'image' | 'video' | 'pdf' | undefined = 
      mediaType === 'image' ? 'image' : 
      mediaType === 'video' ? 'video' : 
      isDoc ? 'pdf' : undefined;

    const q = await enqueueWhatsAppBatch(items, { 
      campaignId, 
      label: title,
      commonMediaUrl: hasCommonMedia ? mediaUrl : undefined,
      commonMediaType: resolvedBatchMediaType,
      commonMediaFileName: resolvedDocName
    });
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
      queuedInGateway: q.queued,
      totalQueued: q.totalQueued,
      businessHours: q.businessHours,
      message: `Campaña encolada exitosamente para ${validRecipients.length} destinatarios en el gateway de São Paulo (blindaje anti-bloqueo activo).`
    });

  } catch (error: any) {
    console.error('[Marketing Broadcast] Error crítico:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Error inesperado al programar la difusión.' },
      { status: 500 }
    );
  }
}
