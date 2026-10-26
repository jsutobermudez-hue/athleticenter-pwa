import { initializeFirebaseServer, ensureServerAuth } from '@/firebase/server-init';
import {
  collection,
  getDocs,
  query,
  where,
  limit,
  orderBy,
  doc,
  setDoc,
  addDoc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { sendBackgroundWhatsAppMessage, formatVenezuelaPhoneE164 } from '@/lib/whatsapp-gateway';
import type { Customer, Product, Order } from '@/lib/definitions';

export interface BiweeklyCatalogOptions {
  dryRun?: boolean;
  testPhone?: string;
}

export interface CatalogProductSummary {
  slot: number;
  id: string;
  name: string;
  sku: string;
  category?: string;
  stockLevel: number;
  priceList: number;
  priceDivisas: number;
  type: 'tendencia' | 'sin_rotacion';
  imageUrl?: string;
}

export interface BiweeklyCatalogResult {
  success: boolean;
  dryRun: boolean;
  edition: string;
  products: CatalogProductSummary[];
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  previewMessage?: string;
  heroProduct?: string;
}

function calculateDivisasPrice(price: number, priceCashUSD?: number): number {
  if (priceCashUSD && priceCashUSD > 0) return priceCashUSD;
  const p = Number(price || 0);
  return Math.round((p * 0.75 + Number.EPSILON) * 100) / 100;
}

/**
 * MOTOR DE CATÁLOGO AUTOMÁTICO BI-SEMANAL (LUNES Y JUEVES)
 * Selecciona 3 productos en tendencia y 3 sin rotación con stock disponible.
 * Despacha con foto real de inventario y protección anti-bloqueo.
 */
export async function runBiweeklyCatalogAgent(options: BiweeklyCatalogOptions = {}): Promise<BiweeklyCatalogResult> {
  const dryRun = options.dryRun === true;
  await ensureServerAuth();
  const { firestore } = initializeFirebaseServer();

  console.log(`[Biweekly Catalog] 🚀 Iniciando selección de productos (dryRun=${dryRun})...`);

  // 1. Obtener productos con stock (máximo 40 para optimizar cuota de Firestore)
  let inStockProducts: (Product & { id: string })[] = [];
  try {
    const productsSnap = await getDocs(query(collection(firestore, 'products'), limit(50)));
    const allProducts: (Product & { id: string })[] = productsSnap.docs.map(d => ({
      id: d.id,
      ...(d.data() as Product)
    }));
    inStockProducts = allProducts.filter(p => Number(p.stockLevel || 0) > 0);
  } catch (err: any) {
    console.warn('[Biweekly Catalog] Error leyendo productos (posible cuota):', err.message);
  }

  if (inStockProducts.length === 0) {
    console.warn('[Biweekly Catalog] No hay productos con stock o no se pudieron leer.');
    return {
      success: false,
      dryRun,
      edition: 'Sin Inventario',
      products: [],
      totalRecipients: 0,
      sentCount: 0,
      failedCount: 0
    };
  }

  // 2. Analizar ventas recientes en órdenes (máximo 40 órdenes)
  const salesCountBySku: Record<string, number> = {};
  try {
    const ordersSnap = await getDocs(query(collection(firestore, 'orders'), limit(40)));
    ordersSnap.docs.forEach(docSnap => {
      const orderData = docSnap.data() as any;
      if (orderData.status !== 'Cancelado' && Array.isArray(orderData.items)) {
        orderData.items.forEach((item: any) => {
          const key = item.sku || item.productId || item.name;
          if (key) {
            salesCountBySku[key] = (salesCountBySku[key] || 0) + Number(item.quantity || 1);
          }
        });
      }
    });
  } catch (err: any) {
    console.warn('[Biweekly Catalog] No se pudieron leer órdenes recientes, usando ventas registradas en producto:', err.message);
  }

  // 3. Clasificar productos:
  // - Tendencia: Mayor volumen de ventas
  // - Sin Rotación: Menor volumen de ventas (o 0) con stock acumulado
  const rankedProducts = inStockProducts.map(p => {
    const sold = salesCountBySku[p.sku] || salesCountBySku[p.id] || salesCountBySku[p.name] || Number(p.totalSold || 0);
    return { product: p, sold };
  });

  // Ordenar de mayor a menor ventas
  rankedProducts.sort((a, b) => b.sold - a.sold);

  // Top 3 en Tendencia
  const tendenciaList = rankedProducts.slice(0, 3).map(r => r.product);

  // Top 3 Sin Rotación (tomados del fondo con stock > 0, excluyendo los de tendencia)
  const tendenciaIds = new Set(tendenciaList.map(p => p.id));
  const sinRotacionCandidates = rankedProducts
    .filter(r => !tendenciaIds.has(r.product.id))
    .sort((a, b) => a.sold - b.sold); // de menor a mayor ventas

  const sinRotacionList = sinRotacionCandidates.slice(0, 3).map(r => r.product);

  // Armar lista final de 5 a 6 productos
  const finalProducts: CatalogProductSummary[] = [];
  let slot = 1;

  tendenciaList.forEach(p => {
    finalProducts.push({
      slot: slot++,
      id: p.id,
      name: p.name,
      sku: p.sku || p.id.substring(0, 8),
      category: p.category,
      stockLevel: p.stockLevel,
      priceList: Number(p.price || 0),
      priceDivisas: calculateDivisasPrice(p.price, p.priceCashUSD),
      type: 'tendencia',
      imageUrl: p.imageUrl
    });
  });

  sinRotacionList.forEach(p => {
    finalProducts.push({
      slot: slot++,
      id: p.id,
      name: p.name,
      sku: p.sku || p.id.substring(0, 8),
      category: p.category,
      stockLevel: p.stockLevel,
      priceList: Number(p.price || 0),
      priceDivisas: calculateDivisasPrice(p.price, p.priceCashUSD),
      type: 'sin_rotacion',
      imageUrl: p.imageUrl
    });
  });

  // 4. Seleccionar la Imagen Estrella (Hero Image)
  // Se busca la primera foto válida entre los productos en tendencia
  const heroProduct = finalProducts.find(p => p.imageUrl && p.imageUrl.length > 50) || finalProducts[0];
  const heroImageUrl = heroProduct?.imageUrl;

  // 5. Guardar en Firestore el catálogo activo para que el webhook reconozca las respuestas 1-6
  const editionName = new Date().toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'short' });
  try {
    await setDoc(doc(firestore, 'system', 'activeCatalog'), {
      edition: editionName,
      updatedAt: serverTimestamp(),
      heroProductId: heroProduct?.id || null,
      heroProductName: heroProduct?.name || null,
      slots: finalProducts.map(p => ({
        slot: p.slot,
        id: p.id,
        name: p.name,
        sku: p.sku,
        priceDivisas: p.priceDivisas,
        type: p.type
      }))
    });
    console.log('[Biweekly Catalog] ✅ system/activeCatalog actualizado en Firestore.');
  } catch (err) {
    console.warn('[Biweekly Catalog] Error guardando activeCatalog:', err);
  }

  // 6. Construir el texto oficial del mensaje
  const itemsText = finalProducts.map(p => {
    const prefix = p.type === 'tendencia' ? '🌟' : '📦';
    const tag = p.type === 'tendencia' ? 'Tendencia' : 'Liquidación';
    return `${p.slot}️⃣ ${prefix} *${p.name}* (Ref: ${p.sku})\n` +
      `   • Stock: ${p.stockLevel} unid. | Lista: $${p.priceList.toFixed(2)}\n` +
      `   • 💵 *Precio en Divisas (25% desc.):* $${p.priceDivisas.toFixed(2)}`;
  }).join('\n\n');

  const messageTemplate = `*ATHLETICENTER*\n\n` +
    `🔥 *CATÁLOGO OFICIAL: DISPONIBILIDAD INMEDIATA*\n\n` +
    `Estimado(a) *{{nombre}}*, te compartimos los artículos deportivos destacados para despacho esta semana:\n\n` +
    `${itemsText}\n\n` +
    `🏆 *CONDICIONES OFICIALES:* \n` +
    `💵 25% de descuento por pago en divisas / efectivo sobre precio de lista.\n` +
    `✅ 10% adicional por pago de la factura de contado dentro del plazo.\n\n` +
    `💬 *¿Deseas apartar mercancía para tu negocio?*\n` +
    `Responde con el número *(1 al ${finalProducts.length})* y te reservamos las unidades de inmediato.\n\n` +
    `Atentamente,\n*El equipo de Athleticenter*`;

  // 7. Determinar audiencia de destinatarios
  let recipients: { id: string; name: string; phone: string }[] = [];

  if (options.testPhone) {
    recipients = [{ id: 'TEST', name: 'Gerencia Athleticenter', phone: formatVenezuelaPhoneE164(options.testPhone) }];
  } else {
    const customersSnap = await getDocs(query(collection(firestore, 'customers'), limit(80)));
    recipients = customersSnap.docs
      .map(d => {
        const c = d.data() as Customer;
        const p = formatVenezuelaPhoneE164(c.phone || (c as any).whatsappPhone || '');
        return {
          id: d.id,
          name: c.razonSocial || (c as any).nombre || 'Cliente',
          phone: p
        };
      })
      .filter(r => r.phone && r.phone.length >= 10);
  }

  if (dryRun) {
    console.log(`[Biweekly Catalog] [SIMULACIÓN] Mensaje generado para ${recipients.length} clientes.`);
    return {
      success: true,
      dryRun: true,
      edition: editionName,
      products: finalProducts,
      totalRecipients: recipients.length,
      sentCount: 0,
      failedCount: 0,
      previewMessage: messageTemplate.replace(/{{nombre}}/gi, 'Cliente Ejemplo'),
      heroProduct: heroProduct?.name
    };
  }

  // 8. Despacho real con protección anti-bloqueo
  let sentCount = 0;
  let failedCount = 0;

  console.log(`[Biweekly Catalog] 🚀 Despachando a ${recipients.length} clientes...`);

  for (let i = 0; i < recipients.length; i++) {
    const item = recipients[i];
    const personalizedMessage = messageTemplate.replace(/{{nombre}}/gi, item.name);

    try {
      const res = await sendBackgroundWhatsAppMessage({
        phone: item.phone,
        message: personalizedMessage,
        imageUrl: heroImageUrl
      });

      if (res.success) {
        sentCount++;
      } else {
        failedCount++;
      }
    } catch (sendErr) {
      failedCount++;
    }

    // Intervalo de seguridad entre mensajes (8 a 14 segundos)
    if (i < recipients.length - 1) {
      if ((i + 1) % 20 === 0) {
        console.log(`[Biweekly Catalog] ⏳ Pausa de enfriamiento (60s) tras ${i + 1} envíos...`);
        await new Promise(r => setTimeout(r, 60000));
      } else {
        const jitter = Math.floor(Math.random() * (14000 - 8000 + 1)) + 8000;
        await new Promise(r => setTimeout(r, jitter));
      }
    }
  }

  // Registrar en historial de campañas
  try {
    await addDoc(collection(firestore, 'marketing_campaigns'), {
      title: `Catálogo Oficial (${editionName})`,
      message: messageTemplate,
      mediaUrl: heroImageUrl ? 'Foto de inventario' : null,
      mediaType: heroImageUrl ? 'image' : 'none',
      audienceType: options.testPhone ? 'test' : 'all',
      totalTarget: recipients.length,
      sentCount,
      failedCount,
      status: 'completed',
      type: 'biweekly_catalog',
      createdAt: serverTimestamp()
    });
  } catch (histErr) {
    console.warn('[Biweekly Catalog] Error guardando historial:', histErr);
  }

  return {
    success: true,
    dryRun: false,
    edition: editionName,
    products: finalProducts,
    totalRecipients: recipients.length,
    sentCount,
    failedCount,
    heroProduct: heroProduct?.name
  };
}
