import { ai } from '@/ai/genkit';
import { collection, doc, getDoc, getDocs, addDoc, updateDoc, setDoc, query, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { formatVenezuelaPhoneE164 } from '@/lib/whatsapp-gateway';
import { enqueueWhatsAppBatch, logWhatsAppOutboundSafe } from '@/lib/whatsapp-dispatch-server';
import {
  findMatchingCampaign,
  inferAudienceFromText,
  filterValidPromotions,
  type ActivePromotion,
} from '@/lib/active-promotions';

export type CommanderAudienceType = 'all' | 'vips' | 'inactive' | 'debtors';

export interface CommanderDraftResult {
  draftId: string;
  mode: 'resend_campaign' | 'new_promo';
  title: string;
  message: string;
  audienceType: CommanderAudienceType;
  recipientCount: number;
  mediaType: 'none' | 'image' | 'video' | 'pdf';
  mediaUrl: string;
  mediaFileName?: string;
  missingLegacyMediaWarning: boolean;
  matchedCampaignId?: string;
  matchedCampaignTitle?: string;
  activateInArm: boolean;
  promoDiscountPct?: number;
  promoCategory?: string;
  promoSummary: string;
  promoExpiresAt?: string | null;
}

export function resolveAudienceCustomers(customers: any[], audienceType: string): Array<{ id: string; name: string; phone: string }> {
  const withPhone = (customers || [])
    .map((c) => {
      const phone = formatVenezuelaPhoneE164(c?.phone || c?.whatsappPhone || c?.telefono || '');
      return {
        raw: c,
        id: String(c?.id || ''),
        name: String(c?.razonSocial || c?.nombre || 'Cliente').trim() || 'Cliente',
        phone,
      };
    })
    .filter((x) => x.phone && x.phone.length >= 11);

  if (audienceType === 'inactive') {
    const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
    return withPhone
      .filter(({ raw }) => {
        const d = raw?.lastOrderDate;
        if (!d) return true;
        const ms = typeof d?.toDate === 'function' ? d.toDate().getTime() : new Date(d).getTime();
        return isNaN(ms) || ms < thirtyDaysAgo;
      })
      .map(({ id, name, phone }) => ({ id, name, phone }));
  }

  if (audienceType === 'debtors') {
    return withPhone
      .filter(({ raw }) => {
        const bal = Number(raw?.balanceUSD || raw?.currentBalanceUSD || raw?.saldoPendienteUSD || raw?.creditUsed || 0);
        return bal > 0.5;
      })
      .map(({ id, name, phone }) => ({ id, name, phone }));
  }

  if (audienceType === 'vips') {
    const sorted = [...withPhone].sort(
      (a, b) => Number(b.raw?.totalSpent || b.raw?.lifetimeValue || 0) - Number(a.raw?.totalSpent || a.raw?.lifetimeValue || 0)
    );
    const vipSlice = sorted.slice(0, Math.max(10, Math.ceil(sorted.length * 0.25)));
    return vipSlice.map(({ id, name, phone }) => ({ id, name, phone }));
  }

  return withPhone.map(({ id, name, phone }) => ({ id, name, phone }));
}

function detectDiscountPct(text: string): number | undefined {
  const m = String(text || '').match(/(\d{1,2})\s*%/);
  if (!m) return undefined;
  const pct = Number(m[1]);
  return pct >= 5 && pct <= 90 ? pct : undefined;
}

function detectCategoryKeyword(text: string): string | undefined {
  const low = String(text || '').toLowerCase();
  if (low.includes('biciclet') || low.includes('bici')) return 'BICICLETAS';
  if (low.includes('balon') || low.includes('balón') || low.includes('pelota')) return 'BALONES';
  if (low.includes('messi') || low.includes('franela') || low.includes('ropa') || low.includes('indumentaria')) return 'INDUMENTARIA';
  if (low.includes('beisbol') || low.includes('béisbol') || low.includes('guantin')) return 'BÉISBOL';
  return undefined;
}

export async function interpretCommanderInstruction(params: {
  firestore: any;
  instruction: string;
  userId: string;
  userName: string;
  userPhone?: string;
  channel: 'web' | 'whatsapp';
}): Promise<CommanderDraftResult> {
  const { firestore, instruction, userId, userName, userPhone, channel } = params;

  const [campSnap, prodSnap, custSnap] = await Promise.all([
    getDocs(query(collection(firestore, 'marketing_campaigns'), orderBy('createdAt', 'desc'), limit(40))),
    getDocs(query(collection(firestore, 'products'), limit(250))),
    getDocs(query(collection(firestore, 'customers'), limit(500))),
  ]);

  const campaigns = campSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  const customers = custSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  const products = prodSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  const matchedCampaign = findMatchingCampaign(instruction, campaigns);
  let audienceType: CommanderAudienceType = inferAudienceFromText(instruction);

  // Detectar descuento y categoría desde instrucción o campaña encontrada
  const combinedSource = `${instruction} ${matchedCampaign?.title || ''} ${matchedCampaign?.message || ''}`;
  let promoDiscountPct = detectDiscountPct(instruction) || detectDiscountPct(matchedCampaign?.title || '') || detectDiscountPct(matchedCampaign?.message || '');
  let promoCategory = detectCategoryKeyword(combinedSource);
  let activateInArm = Boolean(promoDiscountPct && promoDiscountPct !== 25) || /promo|descuento|oferta|bici/i.test(instruction);

  let mode: 'resend_campaign' | 'new_promo' = matchedCampaign ? 'resend_campaign' : 'new_promo';
  let title = matchedCampaign?.title || '🔥 Promoción Especial Athleticenter';
  let message = matchedCampaign?.message || '';
  let mediaType: 'none' | 'image' | 'video' | 'pdf' = 'none';
  let mediaUrl = '';
  let mediaFileName: string | undefined = matchedCampaign?.mediaFileName || undefined;
  let missingLegacyMediaWarning = false;

  if (matchedCampaign) {
    const rawMedia = String(matchedCampaign.mediaUrl || '');
    const rawType = String(matchedCampaign.mediaType || 'none');
    if (rawMedia.startsWith('https://') || (rawMedia.startsWith('data:') && !rawMedia.startsWith('[Archivo'))) {
      mediaUrl = rawMedia;
      mediaType = rawType === 'video' ? 'video' : rawType === 'pdf' || rawType === 'document' ? 'pdf' : rawType === 'image' ? 'image' : 'none';
    } else if (rawType !== 'none' || rawMedia.startsWith('[Archivo')) {
      missingLegacyMediaWarning = true;
      mediaType = 'none';
      mediaUrl = '';
    }
  } else {
    // Nueva promoción: intentar redactar con Gemini 2.5 Flash usando el catálogo real
    const catProducts = products
      .filter((p) => Number(p.stockLevel ?? p.stock ?? 0) > 0)
      .filter((p) => !promoCategory || String(p.category || '').toUpperCase().includes(promoCategory))
      .slice(0, 12)
      .map((p) => `${p.name} (SKU: ${p.sku || p.id}, Lista BCV: $${Number(p.price || 0).toFixed(2)}, Stock: ${Number(p.stockLevel ?? p.stock ?? 0)})`)
      .join('\n');

    let aiFilled = false;
    if (process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY) {
      try {
        const res = await ai.generate({
          model: 'googleai/gemini-2.5-flash',
          prompt:
            `Eres el Director Comercial de ATHLETICENTER C.A. en Venezuela.\n` +
            `El administrador escribió esta instrucción para una difusión de WhatsApp:\n"${instruction}"\n\n` +
            `Productos en stock relevantes:\n${catProducts || 'Catálogo general Athleticenter'}\n\n` +
            `Devuelve EXCLUSIVAMENTE un JSON válido (sin markdown) con esta forma:\n` +
            `{"title":"Título corto atractivo en mayúsculas o con emoji","message":"Cuerpo del mensaje usando {{nombre}} al inicio, lenguaje claro venezolano cercano, con los precios/descuentos solicitados, sin firmas al final (el sistema añade firma)","promoDiscountPct":40,"promoCategory":"BICICLETAS","promoSummary":"Resumen corto para el bot de ventas"}`,
          config: { temperature: 0.4 },
        });
        const rawText = (res.text || '').replace(/```json|```/gi, '').trim();
        const parsed = JSON.parse(rawText);
        if (parsed?.title && parsed?.message) {
          title = String(parsed.title).trim();
          message = String(parsed.message).trim();
          if (typeof parsed.promoDiscountPct === 'number') promoDiscountPct = parsed.promoDiscountPct;
          if (parsed.promoCategory) promoCategory = String(parsed.promoCategory).toUpperCase();
          aiFilled = true;
        }
      } catch (e) {
        console.warn('[Commander] Fallback determinístico al redactar promo nueva:', e);
      }
    }

    if (!aiFilled) {
      const pctText = promoDiscountPct ? `${promoDiscountPct}% de descuento` : 'precios especiales';
      title = promoCategory ? `🔥 PROMOCIÓN ESPECIAL EN ${promoCategory}` : '🔥 PROMOCIÓN ESPECIAL ATHLETICENTER';
      message =
        `Hola *{{nombre}}* 👋\n\n` +
        `Queremos compartir contigo una promoción especial por tiempo limitado en *Athleticenter*:\n\n` +
        `🎁 *${pctText}*${promoCategory ? ` en toda nuestra línea de *${promoCategory}*` : ''} pagando de contado y en divisas.\n\n` +
        `Responde a este chat con el modelo y la cantidad que te interesa y te apartamos tu pedido de una vez. 🙌`;
    }
  }

  const validRecipients = resolveAudienceCustomers(customers, audienceType);
  const promoSummary = promoDiscountPct
    ? `${promoDiscountPct}% de descuento${promoCategory ? ` en ${promoCategory}` : ''} por pago de contado y divisas.`
    : `${title}: ${message.slice(0, 180)}`;

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const draftData = {
    mode,
    instruction,
    title,
    message,
    audienceType,
    recipientCount: validRecipients.length,
    mediaType,
    mediaUrl,
    mediaFileName: mediaFileName || null,
    missingLegacyMediaWarning,
    matchedCampaignId: matchedCampaign?.id || null,
    matchedCampaignTitle: matchedCampaign?.title || null,
    activateInArm,
    promoDiscountPct: promoDiscountPct || null,
    promoCategory: promoCategory || null,
    promoSummary,
    promoExpiresAt: null,
    status: 'pending_confirmation',
    channel,
    userId,
    userName,
    userPhone: userPhone || null,
    expiresAt,
    createdAt: serverTimestamp(),
  };

  const draftRef = await addDoc(collection(firestore, 'whatsapp_commander_drafts'), draftData);

  return {
    draftId: draftRef.id,
    mode,
    title,
    message,
    audienceType,
    recipientCount: validRecipients.length,
    mediaType,
    mediaUrl,
    mediaFileName,
    missingLegacyMediaWarning,
    matchedCampaignId: matchedCampaign?.id,
    matchedCampaignTitle: matchedCampaign?.title,
    activateInArm,
    promoDiscountPct,
    promoCategory,
    promoSummary,
    promoExpiresAt: null,
  };
}

export async function upsertActivePromotion(firestore: any, promo: ActivePromotion): Promise<ActivePromotion[]> {
  const promoRef = doc(firestore, 'system', 'activePromotions');
  const snap = await getDoc(promoRef);
  const existing: ActivePromotion[] = snap.exists() && Array.isArray(snap.data()?.items) ? snap.data().items : [];
  const next = [
    promo,
    ...existing.filter((p) => p.id !== promo.id && p.title.toLowerCase() !== promo.title.toLowerCase()),
  ].slice(0, 20);
  await setDoc(promoRef, { items: next, updatedAt: serverTimestamp() }, { merge: true });
  return filterValidPromotions(next);
}

export async function toggleActivePromotion(params: { firestore: any; promoId: string; active: boolean }): Promise<ActivePromotion[]> {
  const promoRef = doc(params.firestore, 'system', 'activePromotions');
  const snap = await getDoc(promoRef);
  const existing: ActivePromotion[] = snap.exists() && Array.isArray(snap.data()?.items) ? snap.data().items : [];
  const updated = existing.map((p) => (p.id === params.promoId ? { ...p, active: params.active } : p));
  await setDoc(promoRef, { items: updated, updatedAt: serverTimestamp() }, { merge: true });
  return filterValidPromotions(updated);
}

export async function listActivePromotions(firestore: any): Promise<ActivePromotion[]> {
  const snap = await getDoc(doc(firestore, 'system', 'activePromotions'));
  if (!snap.exists() || !Array.isArray(snap.data()?.items)) return [];
  return filterValidPromotions(snap.data().items);
}

export async function executeCommanderDraft(params: {
  firestore: any;
  draftId: string;
  confirmedByUid: string;
  confirmedByName: string;
  overrides?: {
    title?: string;
    message?: string;
    audienceType?: CommanderAudienceType;
    mediaType?: 'none' | 'image' | 'video' | 'pdf';
    mediaUrl?: string;
    mediaFileName?: string;
    activateInArm?: boolean;
    promoDiscountPct?: number;
    promoCategory?: string;
    promoExpiresAt?: string | null;
  };
}): Promise<{
  success: boolean;
  campaignId?: string;
  totalTarget: number;
  promoActivatedInArm: boolean;
  error?: string;
}> {
  const { firestore, draftId, confirmedByUid, confirmedByName, overrides } = params;
  const draftRef = doc(firestore, 'whatsapp_commander_drafts', draftId);
  const draftSnap = await getDoc(draftRef);
  if (!draftSnap.exists()) {
    return { success: false, totalTarget: 0, promoActivatedInArm: false, error: 'Borrador no encontrado.' };
  }

  const d = draftSnap.data() as any;
  if (d.status !== 'pending_confirmation') {
    return { success: false, totalTarget: 0, promoActivatedInArm: false, error: `Este borrador ya fue ${d.status}.` };
  }

  const title = String(overrides?.title ?? d.title ?? '').trim();
  const message = String(overrides?.message ?? d.message ?? '').trim();
  const audienceType = (overrides?.audienceType ?? d.audienceType ?? 'all') as CommanderAudienceType;
  const mediaType = (overrides?.mediaType ?? d.mediaType ?? 'none') as 'none' | 'image' | 'video' | 'pdf';
  const mediaUrl = String(overrides?.mediaUrl ?? d.mediaUrl ?? '').trim();
  const mediaFileName = overrides?.mediaFileName ?? d.mediaFileName ?? undefined;
  const activateInArm = overrides?.activateInArm !== undefined ? overrides.activateInArm : Boolean(d.activateInArm);
  const promoDiscountPct = overrides?.promoDiscountPct !== undefined ? overrides.promoDiscountPct : d.promoDiscountPct;
  const promoCategory = overrides?.promoCategory !== undefined ? overrides.promoCategory : d.promoCategory;
  const promoExpiresAt = overrides?.promoExpiresAt !== undefined ? overrides.promoExpiresAt : d.promoExpiresAt;

  if (!title || !message) {
    return { success: false, totalTarget: 0, promoActivatedInArm: false, error: 'Título y mensaje requeridos.' };
  }

  const custSnap = await getDocs(query(collection(firestore, 'customers'), limit(600)));
  const customers = custSnap.docs.map((cDoc) => ({ id: cDoc.id, ...(cDoc.data() as any) }));
  const validRecipients = resolveAudienceCustomers(customers, audienceType);

  if (validRecipients.length === 0) {
    return { success: false, totalTarget: 0, promoActivatedInArm: false, error: 'No hay destinatarios con teléfono válido para esa audiencia.' };
  }

  const hasCommonMedia = Boolean(mediaUrl && mediaType !== 'none');
  const resolvedDocName = mediaFileName || `${title.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

  const campaignRef = await addDoc(collection(firestore, 'marketing_campaigns'), {
    title,
    message,
    mediaUrl: hasCommonMedia ? mediaUrl : null,
    mediaType,
    mediaFileName: mediaType === 'pdf' ? resolvedDocName : null,
    audienceType,
    totalTarget: validRecipients.length,
    sentCount: 0,
    failedCount: 0,
    status: 'processing',
    sentBy: confirmedByUid,
    sentByName: `${confirmedByName} (Comandante IA)`,
    commanderDraftId: draftId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const campaignId = campaignRef.id;
  const items = validRecipients.map((r) => {
    const personalized = message.replace(/{{nombre}}/gi, r.name || 'Cliente');
    const finalMessage = `*ATHLETICENTER*\n\n*${title}*\n\n${personalized}\n\n— *El equipo de Athleticenter*`;
    return { number: r.phone, text: finalMessage };
  });

  const q = await enqueueWhatsAppBatch(items, {
    campaignId,
    label: title,
    commonMediaUrl: hasCommonMedia ? mediaUrl : undefined,
    commonMediaType: mediaType !== 'none' ? mediaType : undefined,
    commonMediaFileName: mediaType === 'pdf' ? resolvedDocName : undefined,
  });

  if (!q.success) {
    await updateDoc(doc(firestore, 'marketing_campaigns', campaignId), {
      status: 'failed',
      error: q.error || 'Gateway no disponible',
      updatedAt: serverTimestamp(),
    }).catch(() => {});
    return { success: false, campaignId, totalTarget: validRecipients.length, promoActivatedInArm: false, error: q.error };
  }

  await updateDoc(doc(firestore, 'marketing_campaigns', campaignId), {
    status: 'queued',
    updatedAt: serverTimestamp(),
  }).catch(() => {});

  await logWhatsAppOutboundSafe({
    phone: `${validRecipients.length} destinatarios`,
    recipientName: `Difusión Comandante (${validRecipients.length} clientes)`,
    recipientType: 'cliente',
    module: 'marketing',
    campaignId,
    text: `*${title}*\n\n${message}`,
    hasMedia: hasCommonMedia,
    mediaType,
    fileName: mediaType === 'pdf' ? resolvedDocName : undefined,
    senderName: confirmedByName,
    senderRole: 'superadmin',
    source: 'commander',
    status: 'sent',
    provider: 'saopaulo-batch',
  });

  let promoActivatedInArm = false;
  if (activateInArm) {
    await upsertActivePromotion(firestore, {
      id: campaignId,
      title,
      summary: d.promoSummary || message.slice(0, 450),
      category: promoCategory || undefined,
      discountPct: typeof promoDiscountPct === 'number' && promoDiscountPct > 0 ? promoDiscountPct : undefined,
      conditions: 'Pago de contado y en divisas',
      expiresAt: promoExpiresAt || null,
      active: true,
      campaignId,
      createdAt: new Date().toISOString(),
      createdBy: confirmedByName,
    });
    promoActivatedInArm = true;
  }

  await updateDoc(draftRef, {
    status: 'executed',
    campaignId,
    totalTarget: validRecipients.length,
    promoActivatedInArm,
    executedAt: serverTimestamp(),
  }).catch(() => {});

  return {
    success: true,
    campaignId,
    totalTarget: validRecipients.length,
    promoActivatedInArm,
  };
}

export async function cancelCommanderDraft(params: { firestore: any; draftId: string }): Promise<void> {
  await updateDoc(doc(params.firestore, 'whatsapp_commander_drafts', params.draftId), {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
  }).catch(() => {});
}
