import { NextResponse } from 'next/server';
import { authorizeRequest, STAFF_ROLES } from '@/lib/server-auth';
import { processArmInboundMessage } from '@/services/arm-inbound-agent';
import { sendBackgroundWhatsAppMessage, formatVenezuelaPhoneE164 } from '@/lib/whatsapp-gateway';

export async function POST(req: Request) {
  const auth = await authorizeRequest(req, STAFF_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  try {
    const body = await req.json();
    const phone = formatVenezuelaPhoneE164(String(body?.phone || '584120000000'));
    const message = String(body?.message || '').trim();
    const sendToWhatsapp = Boolean(body?.sendToWhatsapp);

    if (!message) {
      return NextResponse.json({ success: false, error: 'Escribe un mensaje para simular.' }, { status: 400 });
    }

    const armResult = await processArmInboundMessage({
      phone,
      messageText: message,
    });

    let whatsappDispatched = false;
    if (sendToWhatsapp && armResult.replyText) {
      const gw = await sendBackgroundWhatsAppMessage({
        phone,
        message: armResult.replyText,
        orderId: 'ARM-TEST',
        pdfBase64: armResult.pdfBase64,
        fileName: armResult.pdfFileName,
        imageUrl: armResult.imageUrl,
      });
      whatsappDispatched = gw.success;

      if (armResult.extraPhotos && armResult.extraPhotos.length > 0) {
        for (const extra of armResult.extraPhotos) {
          await sendBackgroundWhatsAppMessage({
            phone,
            message: extra.caption,
            orderId: 'ARM-TEST-PHOTO',
            imageUrl: extra.imageUrl,
          });
        }
      }
    }

    const { pdfBase64: _omitPdf, imageUrl: _omitImg, extraPhotos: _omitExtra, ...safeResult } = armResult;

    return NextResponse.json({
      ...safeResult,
      hasPdfAttached: Boolean(armResult.pdfBase64),
      hasPhotoAttached: Boolean(armResult.imageUrl),
      photosCount: (armResult.imageUrl ? 1 : 0) + (armResult.extraPhotos?.length || 0),
      intent: armResult.handoffTriggered ? 'HOT_LEAD_HANDOFF' : 'ARM_SALES_AGENT',
      isHotLead: Boolean(armResult.handoffTriggered),
      whatsappDispatched,
    });
  } catch (err: any) {
    console.error('[ARM Simulate] Error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Error procesando simulación ARM' },
      { status: 500 }
    );
  }
}
