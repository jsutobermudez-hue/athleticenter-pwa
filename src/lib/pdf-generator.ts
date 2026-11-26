import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import type { OrderItemClient, QuoteItemClient, CompanyProfile, Invoice, Payment, Commission, Product, Order, User, Customer, FinancialSettings, PurchaseOrder } from './definitions';
import { Timestamp } from 'firebase/firestore';
import QRCode from 'qrcode';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { calculatePricingTier } from './pricing';
import { roundCurrency } from './billing';
import { type RestockSummary, type RestockItemAnalysis, getPriorityLabel } from './restock-engine';
import {
  getProductStock,
  getProductCashPrice,
  formatProductSizesSummary,
  canonicalizeBrand,
  canonicalizeDiscipline,
  computeInventorySelectionMetrics,
  computeProductAuditRow,
} from './inventory-filter';

type GenerateOrderPdfParams = {
  customerName: string;
  customerRif?: string;
  customerAddress?: string;
  orderItems: OrderItemClient[];
  salespersonName: string;
  orderId: string;
  createdAt: Date | Timestamp;
  companyProfile?: Partial<CompanyProfile>;
  documentType?: 'nota' | 'entrega' | 'factura' | 'recibo_final';
  globalSettings?: FinancialSettings;
  bcvRate?: number;
  order?: Partial<Order>;
  autoSave?: boolean;
};

/**
 * MOTOR DE DOCUMENTACIÓN FISCAL v8.0 - ATHLETICENTER PRO
 * Sincronizado: Nota de Entrega Corporativa, Recibido Conforme y Finiquito de Pagos.
 */

async function getBase64ImageFromUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.setAttribute('crossOrigin', 'anonymous');
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = (e) => reject(e);
        img.src = url;
    });
}

const thumbnailCache = new Map<string, string>();
const MAX_THUMBNAIL_CACHE_ENTRIES = 600;

function resolveItemImageUrl(itemOrProduct: any): string {
    return (
        itemOrProduct?.product?.imageUrl ||
        (Array.isArray(itemOrProduct?.product?.imageUrls) ? itemOrProduct.product.imageUrls[0] : '') ||
        itemOrProduct?.imageUrl ||
        (Array.isArray(itemOrProduct?.imageUrls) ? itemOrProduct.imageUrls[0] : '') ||
        ''
    );
}

/**
 * Formatea la celda de producto colocando siempre el código del sistema
 * inmediatamente debajo del nombre del producto.
 */
function formatProductCellWithCode(params: {
    name?: string;
    sku?: string;
    fallbackId?: string;
    size?: string | null;
    metaLines?: Array<string | undefined | null>;
    codePrefix?: string;
}): string {
    const baseName = (params.name || 'PRODUCTO').trim().toUpperCase();
    const sizeSuffix = params.size ? ` [TALLA: ${String(params.size).trim().toUpperCase()}]` : '';
    const code = (params.sku || params.fallbackId || 'S/C').trim().toUpperCase();
    const lines = [
        `${baseName}${sizeSuffix}`,
        `${params.codePrefix || 'CÓDIGO'}: ${code}`,
    ];
    for (const line of params.metaLines || []) {
        const trimmed = (line || '').trim();
        if (trimmed) lines.push(trimmed);
    }
    return lines.join('\n');
}

function drawImageToJpegDataUrl(img: HTMLImageElement): string | null {
    try {
        const size = 120;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        const w = img.naturalWidth || img.width || size;
        const h = img.naturalHeight || img.height || size;
        const scale = Math.min((size - 8) / w, (size - 8) / h);
        const dw = w * scale;
        const dh = h * scale;
        const dx = (size - dw) / 2;
        const dy = (size - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);
        return canvas.toDataURL('image/jpeg', 0.82);
    } catch {
        return null;
    }
}

function loadImageElement(src: string, timeoutMs: number, useCrossOrigin: boolean): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (val: HTMLImageElement | null) => {
            if (!settled) {
                settled = true;
                resolve(val);
            }
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        const img = new Image();
        if (useCrossOrigin) {
            img.crossOrigin = 'anonymous';
        }
        img.onload = () => {
            clearTimeout(timer);
            finish(img);
        };
        img.onerror = () => {
            clearTimeout(timer);
            finish(null);
        };
        img.src = src;
    });
}

function cacheThumbnail(url: string, jpegUrl: string) {
    if (thumbnailCache.size >= MAX_THUMBNAIL_CACHE_ENTRIES) {
        const firstKey = thumbnailCache.keys().next().value;
        if (firstKey) thumbnailCache.delete(firstKey);
    }
    thumbnailCache.set(url, jpegUrl);
}

/**
 * Convierte cualquier imagen (Base64 o URL HTTPS) en miniatura cuadrada a color JPEG
 * liviana (120x120 px sobre blanco) evitando conflictos de caché CORS y con reintento automático.
 */
async function loadColorThumbnailDataUrl(url: string): Promise<string | null> {
    if (!url || typeof window === 'undefined') return null;
    const cached = thumbnailCache.get(url);
    if (cached) return cached;

    if (url.startsWith('data:')) {
        const img = await loadImageElement(url, 8000, false);
        const jpegUrl = img ? drawImageToJpegDataUrl(img) : null;
        if (jpegUrl) cacheThumbnail(url, jpegUrl);
        return jpegUrl;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
            await new Promise((r) => setTimeout(r, 250));
        }
        let blobUrl: string | null = null;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 12000) : null;
        try {
            const res = await fetch(url, {
                mode: 'cors',
                cache: 'no-cache',
                signal: controller?.signal,
            });
            if (res.ok) {
                const blob = await res.blob();
                blobUrl = URL.createObjectURL(blob);
                const img = await loadImageElement(blobUrl, 8000, false);
                const jpegUrl = img ? drawImageToJpegDataUrl(img) : null;
                if (jpegUrl) {
                    cacheThumbnail(url, jpegUrl);
                    return jpegUrl;
                }
            }
        } catch {
            // Se reintenta o pasa al respaldo por <img> con cache-buster
        } finally {
            if (timer) clearTimeout(timer);
            if (blobUrl) URL.revokeObjectURL(blobUrl);
        }
    }

    const cbUrl = `${url}${url.includes('?') ? '&' : '?'}_pdfcb=${Date.now()}`;
    const fallbackImg = await loadImageElement(cbUrl, 10000, true);
    const fallbackJpeg = fallbackImg ? drawImageToJpegDataUrl(fallbackImg) : null;
    if (fallbackJpeg) {
        cacheThumbnail(url, fallbackJpeg);
        return fallbackJpeg;
    }

    return null;
}

async function preloadThumbnailMap(urls: string[]): Promise<Map<string, string>> {
    const uniqueUrls = Array.from(new Set(urls.filter(Boolean)));
    const map = new Map<string, string>();
    const batchSize = 6;
    for (let i = 0; i < uniqueUrls.length; i += batchSize) {
        const chunk = uniqueUrls.slice(i, i + batchSize);
        const results = await Promise.all(
            chunk.map(async (u) => ({ url: u, dataUrl: await loadColorThumbnailDataUrl(u) }))
        );
        for (const r of results) {
            if (r.dataUrl) map.set(r.url, r.dataUrl);
        }
    }
    return map;
}

function drawThumbnailInCell(doc: jsPDF, data: any, thumb: string | undefined, imgSize: number = 15) {
    if (!thumb) return;
    const x = data.cell.x + (data.cell.width - imgSize) / 2;
    const y = data.cell.y + (data.cell.height - imgSize) / 2;
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(255, 255, 255);
    doc.rect(x, y, imgSize, imgSize, 'FD');
    doc.addImage(thumb, 'JPEG', x + 0.5, y + 0.5, imgSize - 1, imgSize - 1);
}

function addPageNumbersFooter(doc: jsPDF) {
    const totalPages = (doc as any).internal.getNumberOfPages();
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(148, 163, 184);
        doc.text(`Página ${i} de ${totalPages}`, pageW - 14, pageH - 6, { align: 'right' });
    }
}

async function addFiscalHeader(doc: jsPDF, company: Partial<CompanyProfile> | undefined, title: string, refId: string, date: Date) {
  const primaryColor = [15, 23, 42]; 
  const accentColor = [37, 99, 235]; 

  if (company?.logoUrl) {
    try { 
        const base64Logo = await getBase64ImageFromUrl(company.logoUrl);
        doc.addImage(base64Logo, 'PNG', 14, 12, 28, 28, undefined, 'FAST'); 
    } catch (e) {
        console.warn("[PDF] Fallo al pre-cargar logo corporativo.");
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
  doc.text((company?.companyName || 'ATHLETICENTER C.A.').toUpperCase(), 45, 20);
  
  doc.setFontSize(9);
  doc.text(`RIF: ${company?.companyRif || 'J-507140202'}`, 45, 25);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(100);
  const addressLines = doc.splitTextToSize(company?.companyAddress || 'av.117 casa nro 117-125 sector Corito Maracaibo,Zulia zona postal 4001', 85);
  doc.text(addressLines, 45, 30);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text(title.toUpperCase(), 196, 20, { align: 'right' });
  
  doc.setFontSize(10);
  doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
  doc.text(`CONTROL: #${refId.replace('#', '').toUpperCase()}`, 196, 27, { align: 'right' });
  
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text(`EMISIÓN: ${date.toLocaleDateString('es-ES')}`, 196, 32, { align: 'right' });

  doc.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.setLineWidth(0.5);
  doc.line(14, 45, 196, 45);
}

function addClientBlock(doc: jsPDF, name: string, rif: string | undefined, address: string | undefined, y: number) {
  const accentColor = [30, 41, 59];
  
  doc.setFillColor(248, 250, 252);
  doc.rect(14, y, 182, 25, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.rect(14, y, 182, 25, 'S');

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text("DATOS DEL CLIENTE:", 18, y + 6);

  doc.setFontSize(11);
  doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
  doc.text(name.toUpperCase(), 18, y + 13);

  doc.setFontSize(9);
  doc.text(`RIF: ${rif?.toUpperCase() || 'V-00000000-0'}`, 18, y + 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(120);
  const clientAddr = doc.splitTextToSize(address || 'DIRECCIÓN FISCAL PENDIENTE.', 170);
  doc.text(clientAddr, 18, y + 22);
}

export async function generateOrderPDF({ 
  customerName, 
  customerRif,
  customerAddress,
  orderItems, 
  salespersonName,
  orderId, 
  createdAt, 
  companyProfile, 
  documentType = 'entrega',
  globalSettings,
  bcvRate = 65.50,
  order,
  autoSave = true
}: GenerateOrderPdfParams): Promise<string> {
  const doc = new jsPDF();
  const date = createdAt instanceof Timestamp ? createdAt.toDate() : (createdAt instanceof Date ? createdAt : new Date());
  
  const isFactura = documentType === 'factura';
  const isPagado = order?.status === 'Pagado';
  
  let docTitle = 'NOTA DE ENTREGA';
  if (isFactura) {
    docTitle = 'FACTURA FISCAL DIGITAL';
  } else if (isPagado) {
    docTitle = 'NOTA DE ENTREGA Y FINIQUITO';
  }

  await addFiscalHeader(doc, companyProfile, docTitle, orderId, date);
  addClientBlock(doc, customerName, customerRif, customerAddress, 50);

  const effBcvRate = bcvRate || (order as any)?.receptionBcvRate || globalSettings?.bcvRate || 65.50;

  const isNetOrPromotional = 
    (order as any)?.incentivesApplied === true ||
    (order as any)?.isNetPrice === true ||
    !!(order as any)?.promoName;

  const bcvDiscountPct = isNetOrPromotional 
    ? 0 
    : ((order as any)?.bcvDiscountSnapshot !== undefined 
        ? (order as any).bcvDiscountSnapshot 
        : (globalSettings?.defaultBcvDiscount !== undefined ? globalSettings.defaultBcvDiscount : 25));

  const isDispatchDelivery = !isFactura && !isPagado;

  const effEarly7Pct = isNetOrPromotional 
    ? 0 
    : ((order as any)?.earlyPayment7dSnapshot !== undefined 
        ? (order as any).earlyPayment7dSnapshot 
        : (globalSettings?.earlyPayment7Days !== undefined ? globalSettings.earlyPayment7Days : 10));

  const effEarly15Pct = isNetOrPromotional 
    ? 0 
    : ((order as any)?.earlyPayment15dSnapshot !== undefined 
        ? (order as any).earlyPayment15dSnapshot 
        : (globalSettings?.earlyPayment15Days !== undefined ? globalSettings.earlyPayment15Days : 5));

  const thumbMap = await preloadThumbnailMap(orderItems.map(resolveItemImageUrl));

  // Para NOTA DE ENTREGA DE DESPACHO:
  // Se presenta el PRECIO DE LISTA BASE EN $ A BCV SIN DESCUENTOS.
  // Para NOTA FINAL PAGADA O FACTURA: SÍ SALEN LOS DESCUENTOS APLICADOS.
  const tableRows = orderItems.map((item, index) => {
    const rawPrice = item.unitPrice;
    
    let finalUnitPrice = rawPrice;
    if (!isDispatchDelivery && !isNetOrPromotional) {
      finalUnitPrice = roundCurrency(rawPrice * (1 - bcvDiscountPct / 100));
    }
    
    const rowSubtotal = roundCurrency(finalUnitPrice * item.quantity);

    const desc = formatProductCellWithCode({
      name: item.product?.name || 'PRODUCTO / EQUIPO',
      sku: item.product?.sku,
      fallbackId: item.productId || item.product?.id,
      size: item.size,
      metaLines: [item.product?.category ? item.product.category.toUpperCase() : ''],
    });

    return [
      (index + 1).toString(),
      '', // Foto a color dibujada en didDrawCell
      desc,
      item.quantity.toString(),
      `$ ${finalUnitPrice.toFixed(2)}`,
      `$ ${rowSubtotal.toFixed(2)}`
    ];
  });

  const priceColHeader = isDispatchDelivery ? "P. LISTA ($ USD)" : "P. UNITARIO ($ USD)";
  const totalColHeader = isDispatchDelivery ? "TOTAL LISTA ($ USD)" : "TOTAL ($ USD)";

  (doc as any).autoTable({
    head: [["#", "FOTO", "PRODUCTO / CÓDIGO", "CANT", priceColHeader, totalColHeader]],
    body: tableRows,
    startY: 80,
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], fontSize: 7, fontStyle: 'bold', halign: 'center' },
    bodyStyles: { minCellHeight: 18, valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 9, halign: 'center', fontSize: 7 },
      1: { cellWidth: 20, halign: 'center' },
      2: { cellWidth: 85, fontSize: 7 },
      3: { cellWidth: 16, halign: 'center', fontSize: 7.5, fontStyle: 'bold' },
      4: { cellWidth: 26, halign: 'right', fontSize: 7 },
      5: { cellWidth: 26, halign: 'right', fontSize: 7, fontStyle: 'bold' }
    },
    styles: { overflow: 'linebreak', cellPadding: 2 },
    didDrawCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 1) {
        const item = orderItems[data.row.index];
        if (!item) return;
        drawThumbnailInCell(doc, data, thumbMap.get(resolveItemImageUrl(item)), 15);
      }
    },
    margin: { top: 14, right: 14, bottom: 16, left: 14 }
  });

  let finalY = (doc as any).lastAutoTable.finalY + 6;
  const pageHeightLimit = doc.internal.pageSize.getHeight() - 14;
  const requiredBottomHeight = isDispatchDelivery ? 92 : 66;
  if (finalY + requiredBottomHeight > pageHeightLimit) {
    doc.addPage();
    finalY = 20;
  }

  const totalSubtotalUSD = orderItems.reduce((acc, i) => {
    let p = i.unitPrice;
    if (!isDispatchDelivery && !isNetOrPromotional) {
      p = roundCurrency(i.unitPrice * (1 - bcvDiscountPct / 100));
    }
    return acc + roundCurrency(p * i.quantity);
  }, 0);

  const totalAmountUSD = isDispatchDelivery ? totalSubtotalUSD : (order?.totalAmount || totalSubtotalUSD);
  const totalEquivBS = roundCurrency(totalAmountUSD * effBcvRate);

  // BANNER DE TOTALES Y ESPECIFICACIÓN
  doc.setFillColor(248, 250, 252);
  doc.rect(14, finalY, 182, 32, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.rect(14, finalY, 182, 32, 'S');

  doc.setFontSize(7); doc.setTextColor(100); doc.setFont("helvetica", "bold");
  doc.text("PAGO EN BOLÍVARES (TASA BCV OFICIAL):", 18, finalY + 8);
  doc.setFontSize(10); doc.setTextColor(37, 99, 235); doc.setFont("helvetica", "bold");
  doc.text(`EQUIVALENTE BCV: Bs. ${totalEquivBS.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`, 18, finalY + 16);
  doc.setFontSize(7); doc.setTextColor(120); doc.setFont("helvetica", "normal");
  doc.text(`Tasa Oficial de Cambio: Bs. ${effBcvRate.toFixed(2)} / USD`, 18, finalY + 23);
  if (salespersonName) {
    doc.text(`Asesor Comercial: ${salespersonName.toUpperCase()}`, 18, finalY + 28);
  }

  doc.setFillColor(15, 23, 42);
  doc.rect(110, finalY, 86, 32, 'F');

  doc.setFontSize(7); doc.setTextColor(148, 163, 184); doc.setFont("helvetica", "bold");
  doc.text(isPagado ? "TOTAL PAGADO / SOLVENTE:" : (isDispatchDelivery ? "TOTAL VALORACIÓN LISTA BCV:" : "TOTAL MONTO NETO ENTREGADO:"), 114, finalY + 8);

  doc.setFontSize(14); doc.setTextColor(16, 185, 129); doc.setFont("helvetica", "bold");
  doc.text(`$ ${totalAmountUSD.toFixed(2)} USD`, 114, finalY + 18);

  doc.setFontSize(6.5); doc.setTextColor(203, 213, 225); doc.setFont("helvetica", "normal");
  if (isPagado) {
    const discLabel = isNetOrPromotional 
      ? "Tarifa Oferta / Precio Neto Comercial" 
      : `Liquidado con beneficio Descuento Cash (${bcvDiscountPct}%)`;
    doc.text(`✅ ESPECIFICACIÓN: ${discLabel.toUpperCase()}`, 114, finalY + 26);
  } else {
    doc.text(`* Condición de Pago: ${((order as any)?.paymentStatus || order?.status || 'Pendiente').toUpperCase()}`, 114, finalY + 26);
  }

  // CUADRO COMERCIAL INFORMATIVO DE CONDICIONES DE CRÉDITO Y DESCUENTOS POR ESCRITO
  let bannerHeight = 0;
  if (isDispatchDelivery) {
    const bannerY = finalY + 35;
    doc.setFillColor(241, 245, 249);
    doc.rect(14, bannerY, 182, 22, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.rect(14, bannerY, 182, 22, 'S');

    const cashSub = Math.round((totalAmountUSD * (1 - bcvDiscountPct / 100) + Number.EPSILON) * 100) / 100;
    const pp7d = Math.round((cashSub * (1 - effEarly7Pct / 100) + Number.EPSILON) * 100) / 100;
    const pp15d = Math.round((cashSub * (1 - effEarly15Pct / 100) + Number.EPSILON) * 100) / 100;

    doc.setFontSize(7); doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "bold");
    doc.text("💡 CALENDARIO DE INCENTIVOS DE PRONTO PAGO Y COBRANZA EN CASCADA:", 18, bannerY + 5);

    doc.setFontSize(6.5); doc.setTextColor(71, 85, 105); doc.setFont("helvetica", "normal");
    doc.text(`• PAGO EN DIVISAS (CASH / ZELLE / USDT): Aplica Descuento Contado Divisas (${bcvDiscountPct}%) + Incentivo Pronto Pago.`, 18, bannerY + 10);
    doc.text(`• CONDICIONES DE PAGO: CONTADO / PRONTO PAGO (32.5% OFF Total Cascada): ${pp7d.toFixed(2)} USD  |  CRÉDITO HASTA 30D (25% OFF Divisas): ${cashSub.toFixed(2)} USD`, 18, bannerY + 15);
    doc.text(`* Término de Crédito: 30 Días continuos desde emisión. Pagos >30 Días (Mora) no reciben descuento ($${totalAmountUSD.toFixed(2)} USD).`, 18, bannerY + 19);

    bannerHeight = 26;
  }

  // BLOQUE "RECIBIDO CONFORME" PARA ENTREGA DE MERCANCÍA
  const signatureY = finalY + 35 + bannerHeight;

  if (signatureY + 28 <= 285) {
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.4);

    // Caja Entregado Por (Almacén / Transportista)
    doc.rect(14, signatureY, 88, 26, 'S');
    doc.setFontSize(7); doc.setTextColor(15, 23, 42); doc.setFont("helvetica", "bold");
    doc.text("ENTREGADO POR (ALMACÉN / TRANSPORTISTA)", 18, signatureY + 5);
    doc.setFontSize(6.5); doc.setTextColor(100); doc.setFont("helvetica", "normal");
    doc.text("Nombre: _____________________________________", 18, signatureY + 11);
    doc.text("C.I.: __________________  Fecha: ____/____/_____", 18, signatureY + 17);
    doc.text("Firma / Transportista: ________________________", 18, signatureY + 23);

    // Caja Recibido Conforme (Cliente / Depósito)
    doc.rect(108, signatureY, 88, 26, 'S');
    doc.setFontSize(7); doc.setTextColor(15, 23, 42); doc.setFont("helvetica", "bold");
    doc.text("RECIBIDO CONFORME (CLIENTE / RECEPTOR)", 112, signatureY + 5);
    doc.setFontSize(6.5); doc.setTextColor(100); doc.setFont("helvetica", "normal");
    doc.text("Nombre: _____________________________________", 112, signatureY + 11);
    doc.text("C.I. / RIF: ______________  Fecha: ____/____/_____", 112, signatureY + 17);
    doc.text("Firma y Sello Cliente: ________________________", 112, signatureY + 23);
  }

  addPageNumbersFooter(doc);

  if (autoSave) {
    const filePrefix = isFactura ? 'Factura' : 'Nota_Entrega';
    doc.save(`${filePrefix}_${orderId.substring(0,8)}.pdf`);
  }

  const dataUri = doc.output('datauristring');
  return dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
}

/**
 * GENERADOR DE ETIQUETAS QR MAESTRAS (100x150mm)
 */
export async function generatePackageLabelsPDF(
    order: Order, 
    items: OrderItemClient[] = [], 
    companyProfile?: Partial<CompanyProfile>,
    customerAddress?: string
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [100, 150] });
  const packageCount = order.packageCount || 1;
  const qrData = `${window.location.origin}/dashboard/dispatch?orderId=${order.id}`;
  let qrImage = '';
  
  try { qrImage = await QRCode.toDataURL(qrData, { margin: 1 }); } catch (e) { console.error("QR Error:", e); }

  const base64Logo = companyProfile?.logoUrl ? await getBase64ImageFromUrl(companyProfile.logoUrl).catch(() => null) : null;

  for (let i = 1; i <= packageCount; i++) {
    if (i > 1) doc.addPage([150, 100], 'landscape');
    
    doc.setDrawColor(30, 41, 59); doc.setLineWidth(1); doc.rect(5, 5, 140, 90);
    
    if (base64Logo) { doc.addImage(base64Logo, 'PNG', 10, 8, 15, 15); }
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(30, 41, 59);
    doc.text((companyProfile?.companyName || "ATHLETICENTER").toUpperCase(), 28, 13);
    doc.setFontSize(7); doc.setTextColor(100);
    doc.text(`RIF: ${companyProfile?.companyRif || 'J-50000000-0'} | GUÍA: ${order.internalTrackingNumber || 'PENDIENTE'}`, 28, 18);

    doc.setFillColor(248, 250, 252); doc.rect(10, 25, 65, 24, 'F');
    doc.setDrawColor(226, 232, 240); doc.rect(10, 25, 65, 24, 'S');
    doc.setFontSize(6); doc.setTextColor(100); doc.text("DESTINATARIO / CLIENTE:", 12, 29);
    doc.setFontSize(8); doc.setTextColor(37, 99, 235); doc.text(order.customerName.toUpperCase(), 12, 33, { maxWidth: 60 });
    doc.setFontSize(7); doc.setTextColor(100); doc.text(`RIF: ${order.customerRif || 'N/A'}`, 12, 38);
    
    if (customerAddress) {
        doc.setFontSize(5); doc.setTextColor(120);
        const addrLines = doc.splitTextToSize(customerAddress.toUpperCase(), 60);
        doc.text(addrLines, 12, 41);
    }

    doc.setFillColor(248, 250, 252); doc.rect(78, 25, 62, 24, 'F');
    doc.rect(78, 25, 62, 24, 'S');
    doc.setFontSize(6); doc.setTextColor(100); doc.text("LOGÍSTICA / TRANSPORTISTA:", 80, 29);
    doc.setFontSize(8); doc.setTextColor(30, 41, 59); doc.text((order.carrier || "RETIRO EN SEDE").toUpperCase(), 80, 33);
    doc.setFontSize(7); doc.text(`GUÍA EXT: ${order.trackingNumber || '---'}`, 80, 38);

    if (items.length > 0) {
        const tableRows = items.map(item => [
            formatProductCellWithCode({
                name: item.product?.name?.substring(0, 35) || 'EQUIPO',
                sku: item.product?.sku,
                fallbackId: item.productId || item.product?.id,
                size: item.size,
                codePrefix: 'CÓD',
            }),
            item.quantity,
        ]);
        (doc as any).autoTable({
            head: [["EQUIPO / CÓDIGO", "CANT"]],
            body: tableRows,
            startY: 50,
            margin: { left: 10, right: 78 },
            styles: { fontSize: 6, cellPadding: 1 },
            headStyles: { fillColor: [30, 41, 59], fontSize: 6 },
            columnStyles: {
                0: { cellWidth: 64 },
                1: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
            },
            tableWidth: 80
        });
    }

    if (qrImage) { doc.addImage(qrImage, 'PNG', 105, 50, 33, 33); }
    
    doc.setFillColor(30, 41, 59); doc.rect(10, 84, 130, 7, 'F');
    doc.setTextColor(255); doc.setFontSize(8); doc.setFont("helvetica", "bold");
    doc.text(`BULTO ${i}-${packageCount}`, 75, 88.5, { align: 'center' });
  }
  doc.save(`Etiquetas_QR_${order.id.substring(0,8)}.pdf`);
}

export async function generateQuotePDF({ 
    quoteId, 
    customerName, 
    customerRif, 
    customerAddress, 
    salespersonName, 
    quoteItems, 
    expiryDate, 
    companyProfile, 
    globalSettings,
    bcvRate = 1,
    quote,
    autoSave = true
}: any) {
  const doc = new jsPDF();
  const date = new Date();
  const expDate = expiryDate instanceof Timestamp ? expiryDate.toDate() : (expiryDate instanceof Date ? expiryDate : new Date());

  await addFiscalHeader(doc, companyProfile, 'PRESUPUESTO PROFORMA', quoteId, date);
  addClientBlock(doc, customerName, customerRif, customerAddress, 50);

  let totalBcvUSD = 0;
  let totalCashUSD = 0;

  const isNetOrPromotional = 
    (quote as any)?.incentivesApplied === true ||
    (quote as any)?.isNetPrice === true ||
    !!(quote as any)?.promoName;

  const bcvDiscountPct = isNetOrPromotional 
    ? 0 
    : ((quote as any)?.bcvDiscountSnapshot !== undefined 
        ? (quote as any).bcvDiscountSnapshot 
        : (globalSettings?.defaultBcvDiscount !== undefined ? globalSettings.defaultBcvDiscount : 25));

  const thumbMap = await preloadThumbnailMap((quoteItems || []).map(resolveItemImageUrl));

  const tableRows = quoteItems.map((item: any) => {
    const itemUnitPrice = roundCurrency(item.unitPrice || item.product?.price || 0);
    const catalogPrice = item.product?.price && item.product.price > 0 ? item.product.price : itemUnitPrice;
    const isItemNet = isNetOrPromotional || item.isNetPrice || (catalogPrice > 0 && itemUnitPrice < (catalogPrice * 0.95));

    const bcvPrice = isItemNet ? catalogPrice : itemUnitPrice;
    const cashPrice = isItemNet
      ? itemUnitPrice
      : roundCurrency(bcvPrice * (1 - bcvDiscountPct / 100));
    
    const rowBcvTotal = roundCurrency(item.quantity * bcvPrice);
    const rowCashTotal = roundCurrency(item.quantity * cashPrice);

    totalBcvUSD += rowBcvTotal;
    totalCashUSD += rowCashTotal;

    const productCellText = formatProductCellWithCode({
      name: item.product?.name || 'EQUIPO',
      sku: item.product?.sku,
      fallbackId: item.productId || item.product?.id,
      size: item.size,
    });
    
    return [
      '', // Foto a color dibujada en didDrawCell
      productCellText, 
      item.quantity, 
      `$ ${bcvPrice.toFixed(2)}`, 
      `$ ${cashPrice.toFixed(2)}`, 
      `$ ${rowBcvTotal.toFixed(2)}`
    ];
  });

  (doc as any).autoTable({ 
    head: [["FOTO", "PRODUCTO / CÓDIGO", "CANT", "P. BCV", "P. CASH", "TOTAL BCV"]], 
    body: tableRows, 
    startY: 80, 
    theme: 'grid', 
    styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
    headStyles: { fillColor: [37, 99, 235], halign: 'center', fontSize: 7, fontStyle: 'bold' },
    bodyStyles: { minCellHeight: 18, valign: 'middle' },
    columnStyles: { 
        0: { cellWidth: 20, halign: 'center' },
        1: { cellWidth: 84 },
        2: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
        3: { cellWidth: 21, halign: 'right' },
        4: { cellWidth: 21, halign: 'right' },
        5: { cellWidth: 22, halign: 'right', fontStyle: 'bold' }
    },
    didDrawCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 0) {
        const item = quoteItems?.[data.row.index];
        if (!item) return;
        drawThumbnailInCell(doc, data, thumbMap.get(resolveItemImageUrl(item)), 15);
      }
    },
    margin: { top: 14, right: 14, bottom: 16, left: 14 }
  });

  let finalY = (doc as any).lastAutoTable.finalY + 10;
  if (finalY + 45 > 280) {
    doc.addPage();
    finalY = 20;
  }

  doc.setFillColor(241, 245, 249);
  doc.rect(14, finalY, 85, 30, 'F');
  doc.setDrawColor(203, 213, 225);
  doc.rect(14, finalY, 85, 30, 'S');

  doc.setFontSize(7); doc.setTextColor(100); doc.setFont("helvetica", "bold");
  doc.text("PAGO EN BOLÍVARES (TASA BCV):", 18, finalY + 11);
  doc.setFontSize(11); doc.setTextColor(37, 99, 235); doc.setFont("helvetica", "bold");
  doc.text(`TOTAL USD: $ ${totalBcvUSD.toFixed(2)}`, 18, finalY + 21);

  doc.setFillColor(30, 41, 59);
  doc.rect(111, finalY, 85, 30, 'F');
  
  doc.setFontSize(7); doc.setTextColor(148, 163, 184); doc.setFont("helvetica", "bold");
  doc.text("PAGO EN DIVISAS (CASH/ZELLE):", 115, finalY + 11);
  doc.setFontSize(11); doc.setTextColor(16, 185, 129); doc.setFont("helvetica", "bold");
  doc.text(`TOTAL USD CASH: $ ${totalCashUSD.toFixed(2)}`, 115, finalY + 21);

  const validUntilStr = expDate ? format(expDate, 'dd/MM/yyyy') : '20 días';

  doc.setFontSize(6); doc.setTextColor(150); doc.setFont("helvetica", "normal");
  doc.text(`* VÁLIDO HASTA: ${validUntilStr}. ESTE DOCUMENTO REPRESENTA LA BASE IMPONIBLE. EL IVA (16%) SE CALCULA AL MOMENTO DEL PAGO FISCAL.`, 14, finalY + 38);

  addPageNumbersFooter(doc);

  if (autoSave !== false) {
    doc.save(`Cotizacion_${quoteId.substring(0,8)}.pdf`);
  }
  const dataUri = doc.output('datauristring');
  return dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
}

export async function generatePickingListPDF({ orderId, customerName, orderItems, companyProfile }: any) {
  const doc = new jsPDF();
  const date = new Date();
  await addFiscalHeader(doc, companyProfile, 'ORDEN DE PICKING', orderId, date);
  if (customerName) {
    doc.setFontSize(8.5); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 41, 59);
    doc.text(`CLIENTE / DESTINO: ${String(customerName).toUpperCase()}`, 14, 46);
  }
  const safeItems = Array.isArray(orderItems) ? orderItems : [];
  const thumbMap = await preloadThumbnailMap(safeItems.map(resolveItemImageUrl));

  const tableRows = safeItems.map((item: any) => [
    '', // Foto dibujada en didDrawCell
    item.product?.warehouseLocation || 'Z-ZZZ',
    formatProductCellWithCode({
      name: item.product?.name || 'EQUIPO',
      sku: item.product?.sku,
      fallbackId: item.productId || item.product?.id,
      size: item.size,
    }),
    item.quantity,
    "[  ]"
  ]);
  (doc as any).autoTable({
    head: [["FOTO", "UBICACIÓN", "PRODUCTO / CÓDIGO", "CANT", "CHECK"]],
    body: tableRows,
    startY: 50,
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2, overflow: 'linebreak' },
    headStyles: { fillColor: [30, 41, 59], halign: 'center', fontSize: 7 },
    bodyStyles: { minCellHeight: 18, valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 20, halign: 'center' },
      1: { cellWidth: 24, halign: 'center', fontStyle: 'bold' },
      2: { cellWidth: 106 },
      3: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
      4: { cellWidth: 16, halign: 'center' }
    },
    didDrawCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 0) {
        const item = safeItems[data.row.index];
        if (!item) return;
        drawThumbnailInCell(doc, data, thumbMap.get(resolveItemImageUrl(item)), 15);
      }
    },
    margin: { top: 14, right: 14, bottom: 16, left: 14 }
  });
  addPageNumbersFooter(doc);
  doc.save(`Picking_${orderId.substring(0,8)}.pdf`);
}

export async function generateInventoryReportPDF(
  products: Product[],
  companyProfile?: Partial<CompanyProfile>,
  title: string = 'INVENTARIO MAESTRO',
  options: {
    subtitle?: string;
    showPrices?: boolean;
    bcvDiscount?: number;
    filename?: string;
    soldByProductId?: Record<string, number>;
  } = {}
) {
  const safeProducts = Array.isArray(products) ? products : [];
  const showPrices = options.showPrices !== false;
  const bcvDiscount = options.bcvDiscount ?? 25;
  const subtitle = (options.subtitle || 'CATÁLOGO Y AUDITORÍA DE EXISTENCIAS (100% INCLUYE AGOTADOS EN 0)').toUpperCase();
  const metrics = computeInventorySelectionMetrics(safeProducts, bcvDiscount, options.soldByProductId);

  const thumbMap = await preloadThumbnailMap(safeProducts.map(resolveItemImageUrl));

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Encabezado oscuro corporativo
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 28, 'F');

  if (companyProfile?.logoUrl) {
    try {
      const base64Logo = await getBase64ImageFromUrl(companyProfile.logoUrl);
      doc.addImage(base64Logo, 'PNG', 14, 4, 20, 20, undefined, 'FAST');
    } catch (_) {}
  }

  const textStartX = companyProfile?.logoUrl ? 38 : 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(96, 165, 250);
  doc.text((companyProfile?.companyName || 'ATHLETICENTER C.A.').toUpperCase(), textStartX, 10.5);

  doc.setFontSize(7.2);
  doc.setTextColor(203, 213, 225);
  doc.text(`RIF: ${companyProfile?.companyRif || 'J-507140202'}  ·  EMISIÓN: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, textStartX, 16.5);
  doc.text(
    `${metrics.modelsCount} MODELOS (${metrics.outOfStockCount} EN 0)  ·  HABÍA: ${metrics.totalHadUnits.toLocaleString()}  ·  VENDIDO: ${metrics.totalSoldUnits.toLocaleString()}  ·  QUEDAN: ${metrics.totalUnits.toLocaleString()}`,
    textStartX,
    22
  );

  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(title.toUpperCase(), pageW - 14, 12, { align: 'right' });

  doc.setFontSize(7);
  doc.setTextColor(251, 191, 36);
  const subtitleText = subtitle.length > 68 ? `${subtitle.slice(0, 65)}...` : subtitle;
  doc.text(subtitleText, pageW - 14, 19, { align: 'right' });

  // Barra superior de métricas resumidas
  const barY = 31;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, barY, pageW - 28, 12, 2, 2, 'FD');
  doc.setFontSize(6.8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  const barSummaryLeft = `MODELOS: ${metrics.modelsCount} (${metrics.inStockCount} DISP · ${metrics.outOfStockCount} EN 0) | HABÍA: ${metrics.totalHadUnits.toLocaleString()} | VENDIDO: ${metrics.totalSoldUnits.toLocaleString()} | QUEDAN: ${metrics.totalUnits.toLocaleString()}`;
  doc.text(barSummaryLeft, 18, barY + 7.5);
  if (showPrices) {
    doc.setFontSize(6.8);
    doc.setTextColor(5, 150, 105);
    doc.text(
      `BCV: $${metrics.totalValuationBCV.toLocaleString('en-US', { minimumFractionDigits: 2 })} · CASH: $${metrics.totalValuationCash.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      pageW - 18,
      barY + 7.5,
      { align: 'right' }
    );
  } else {
    doc.setTextColor(100, 116, 139);
    doc.text('AUDITORÍA Y CONTEO FÍSICO', pageW - 18, barY + 7.5, { align: 'right' });
  }

  const formatDetailCell = (p: Product, includeLocation: boolean = false) => {
    const brand = canonicalizeBrand(p.brand);
    const disc = canonicalizeDiscipline(p.discipline);
    const cat = (p.category || '').trim().toUpperCase();
    const loc = includeLocation && p.warehouseLocation ? `UBIC: ${p.warehouseLocation.trim().toUpperCase()}` : '';
    const meta = [brand, disc, cat, loc].filter(Boolean).join(' · ');
    const sizesTxt = formatProductSizesSummary(p);
    return formatProductCellWithCode({
      name: p.name,
      sku: p.sku,
      fallbackId: p.id,
      metaLines: [meta, sizesTxt ? `Tallas: ${sizesTxt}` : ''],
    });
  };

  if (showPrices) {
    const tableRows = safeProducts.map((p) => {
      const audit = computeProductAuditRow(p, options.soldByProductId);
      const listPrice = Number(p.price || 0);
      const cashPrice = getProductCashPrice(p, bcvDiscount);
      const totalRowBCV = Math.max(0, audit.remaining) * listPrice;
      return [
        '', // Foto en didDrawCell
        formatDetailCell(p, true),
        `${audit.had}`,
        `${audit.sold}`,
        `${audit.remaining}`,
        `$${listPrice.toFixed(2)}`,
        `$${cashPrice.toFixed(2)}`,
        `$${totalRowBCV.toFixed(2)}`,
      ];
    });

    (doc as any).autoTable({
      head: [['FOTO', 'PRODUCTO / CÓDIGO', 'HABÍA', 'VENDIDO', 'DEBEN QUEDAR', 'LISTA BCV', 'CASH', 'TOTAL BCV']],
      body: tableRows,
      startY: 46,
      theme: 'grid',
      styles: { fontSize: 6.9, cellPadding: 1.8, valign: 'middle', textColor: [30, 41, 59], lineColor: [226, 232, 240] },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, halign: 'center', fontSize: 6.4, fontStyle: 'bold' },
      bodyStyles: { minCellHeight: 19 },
      columnStyles: {
        0: { cellWidth: 18, halign: 'center' },
        1: { cellWidth: 62 },
        2: { cellWidth: 18, halign: 'center', fontStyle: 'bold', fontSize: 7.8, textColor: [51, 65, 85] },
        3: { cellWidth: 19, halign: 'center', fontStyle: 'bold', fontSize: 7.8, textColor: [37, 99, 235] },
        4: { cellWidth: 21, halign: 'center', fontStyle: 'bold', fontSize: 8.2 },
        5: { cellWidth: 16, halign: 'right' },
        6: { cellWidth: 16, halign: 'right', textColor: [5, 150, 105], fontStyle: 'bold' },
        7: { cellWidth: 18, halign: 'right', fontStyle: 'bold' },
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 4) {
          const p = safeProducts[data.row.index];
          if (!p) return;
          const stock = getProductStock(p);
          if (stock <= 0) data.cell.styles.textColor = [190, 18, 60];
          else if (stock < 20) data.cell.styles.textColor = [194, 65, 12];
          else data.cell.styles.textColor = [21, 128, 61];
        }
      },
      didDrawCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 0) {
          const p = safeProducts[data.row.index];
          if (!p) return;
          drawThumbnailInCell(doc, data, thumbMap.get(resolveItemImageUrl(p)), 15);
        }
      },
      margin: { top: 14, right: 14, bottom: 18, left: 14 },
    });
  } else {
    const countRows = safeProducts.map((p) => {
      const audit = computeProductAuditRow(p, options.soldByProductId);
      return [
        '', // Foto en didDrawCell
        formatDetailCell(p, true),
        `${audit.had}`,
        `${audit.sold}`,
        `${audit.remaining}`,
        '____________',
      ];
    });

    (doc as any).autoTable({
      head: [['FOTO', 'PRODUCTO / CÓDIGO', 'HABÍA', 'VENDIDO', 'DEBEN QUEDAR', 'CONTEO FÍSICO']],
      body: countRows,
      startY: 46,
      theme: 'grid',
      styles: { fontSize: 7.4, cellPadding: 2, valign: 'middle', textColor: [30, 41, 59], lineColor: [226, 232, 240] },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, halign: 'center', fontSize: 6.9, fontStyle: 'bold' },
      bodyStyles: { minCellHeight: 20 },
      columnStyles: {
        0: { cellWidth: 20, halign: 'center' },
        1: { cellWidth: 72 },
        2: { cellWidth: 22, halign: 'center', fontStyle: 'bold', fontSize: 8.5, textColor: [51, 65, 85] },
        3: { cellWidth: 22, halign: 'center', fontStyle: 'bold', fontSize: 8.5, textColor: [37, 99, 235] },
        4: { cellWidth: 24, halign: 'center', fontStyle: 'bold', fontSize: 8.8 },
        5: { cellWidth: 28, halign: 'center', fontStyle: 'bold', textColor: [148, 163, 184] },
      },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 4) {
          const p = safeProducts[data.row.index];
          if (!p) return;
          const stock = getProductStock(p);
          if (stock <= 0) data.cell.styles.textColor = [190, 18, 60];
          else if (stock < 20) data.cell.styles.textColor = [194, 65, 12];
          else data.cell.styles.textColor = [21, 128, 61];
        }
      },
      didDrawCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 0) {
          const p = safeProducts[data.row.index];
          if (!p) return;
          drawThumbnailInCell(doc, data, thumbMap.get(resolveItemImageUrl(p)), 16);
        }
      },
      margin: { top: 14, right: 14, bottom: 18, left: 14 },
    });
  }

  let finalY = ((doc as any).lastAutoTable?.finalY || 50) + 6;
  if (finalY + 28 > pageH - 14) {
    doc.addPage();
    finalY = 18;
  }

  doc.setFillColor(15, 23, 42);
  doc.roundedRect(14, finalY, pageW - 28, 22, 2.5, 2.5, 'F');
  doc.setFontSize(7.2);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(148, 163, 184);
  doc.text('RESUMEN DEL INVENTARIO IMPRESO', 18, finalY + 7);
  if (showPrices) {
    doc.setFontSize(8);
    doc.setTextColor(52, 211, 153);
    doc.text(
      `Total BCV: $${metrics.totalValuationBCV.toLocaleString('en-US', { minimumFractionDigits: 2 })}  |  Cash: $${metrics.totalValuationCash.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      pageW - 18,
      finalY + 7,
      { align: 'right' }
    );
  }
  doc.setFontSize(8.4);
  doc.setTextColor(255, 255, 255);
  doc.text(
    `Modelos: ${metrics.modelsCount}  ·  Había: ${metrics.totalHadUnits.toLocaleString()} uds  ·  Vendido: ${metrics.totalSoldUnits.toLocaleString()} uds  ·  Deben Quedar: ${metrics.totalUnits.toLocaleString()} uds  ·  En 0 (Agotados): ${metrics.outOfStockCount}`,
    18,
    finalY + 15.5
  );

  addPageNumbersFooter(doc);
  const rawSlug = options.filename || title.replace(/\s+/g, '_');
  const cleanSlug = rawSlug.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_|_$/g, '') || 'Inventario';
  doc.save(`${cleanSlug}_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
}

export async function generateAccountStatementPDF(customer: Customer, invoices: Invoice[], companyProfile?: Partial<CompanyProfile>) {
    const doc = new jsPDF();
    await addFiscalHeader(doc, companyProfile, 'ESTADO DE CUENTA CORPORATIVO', customer.id || customer.rif, new Date());
    addClientBlock(doc, customer.razonSocial, customer.rif, customer.address, 50);

    const tableRows = invoices.map(inv => [
        inv.id.substring(0,8),
        inv.status.toUpperCase(),
        inv.dueDate instanceof Date ? format(inv.dueDate, 'dd/MM/yy') : (inv.dueDate as any).toDate ? format((inv.dueDate as any).toDate(), 'dd/MM/yy') : '---',
        `$ ${inv.amountTotal.toFixed(2)}`,
        `$ ${inv.remainingBalance.toFixed(2)}`
    ]);

    (doc as any).autoTable({
        head: [["PEDIDO", "ESTADO", "VENCIMIENTO", "TOTAL", "PENDIENTE"]],
        body: tableRows,
        startY: 80,
        theme: 'grid',
        headStyles: { fillColor: [30, 41, 59] }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(12); doc.setFont("helvetica", "bold");
    doc.text(`SALDO TOTAL DEUDOR: $ ${customer.creditUsed.toLocaleString()}`, 196, finalY, { align: 'right' });

    doc.save(`Estado_Cuenta_${customer.razonSocial.substring(0,10)}.pdf`);
}

export async function generateSalespersonPerformancePDF(sp: any, commissions: Commission[], customers: Customer[], companyProfile?: Partial<CompanyProfile>) {
    const doc = new jsPDF();
    await addFiscalHeader(doc, companyProfile, 'REPORTE DE DESEMPEÑO COMERCIAL', sp.id.substring(0,6), new Date());
    
    doc.setFontSize(11); doc.setTextColor(30, 41, 59);
    doc.text(`ASESOR: ${sp.name.toUpperCase()}`, 14, 55);
    
    const rows = [
        ["Recaudación Real (CASH)", `$ ${sp.monthlySales.toLocaleString()}`],
        ["Comisiones Sinceradas", `$ ${sp.earnedCommission.toFixed(2)}`],
        ["Pedidos en Tránsito", `$ ${sp.pendingSales.toLocaleString()}`],
        ["Cartera Activa", `${sp.customerCount} Clientes`]
    ];

    (doc as any).autoTable({
        body: rows,
        startY: 60,
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 2 }
    });

    doc.save(`Performance_${sp.name.split(' ')[0]}.pdf`);
}

export async function generateCommissionReceiptPDF(
    sp: User, 
    commissions: Commission[], 
    reference: string, 
    companyProfile?: Partial<CompanyProfile>,
    autoSave: boolean = true
): Promise<string> {
    const doc = new jsPDF();
    await addFiscalHeader(doc, companyProfile, 'RECIBO DE LIQUIDACIÓN DE COMISIONES', reference, new Date());
    
    doc.setFontSize(10); doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "bold");
    doc.text(`BENEFICIARIO: ${sp.name.toUpperCase()} (${(sp.role || 'VENTAS').toUpperCase()})`, 14, 55);

    const totalUSD = commissions.reduce((sum, c) => sum + (c.salespersonCommissionAmount ?? (c as any).commissionAmountUSD ?? 0), 0);
    const avgBcv = (commissions[0] as any)?.bcvRate || 36.5;
    const totalBS = totalUSD * avgBcv;

    const tableRows = commissions.map(c => {
        const orderNum = c.orderNumber || c.orderId.substring(0, 8).toUpperCase();
        const commDate = c.commissionDate instanceof Timestamp ? format(c.commissionDate.toDate(), 'dd/MM/yy') : format(new Date(), 'dd/MM/yy');
        const method = c.paymentMethod || (c as any).method || 'CASH';
        const baseUSD = c.invoiceAmount ?? (c as any).paymentAmountUSD ?? 0;
        const commUSD = c.salespersonCommissionAmount ?? (c as any).commissionAmountUSD ?? 0;
        const commBS = (c as any).commissionAmountBS || (commUSD * avgBcv);

        return [
            orderNum,
            commDate,
            method.toUpperCase(),
            `$ ${baseUSD.toFixed(2)}`,
            `$ ${commUSD.toFixed(2)}`,
            `Bs. ${commBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        ];
    });

    (doc as any).autoTable({
        head: [["PEDIDO / REF", "FECHA", "MÉTODO DE PAGO", "BASE RECAUDADA", "COMISIÓN ($)", "EQUIV. (BS BCV)"]],
        body: tableRows,
        startY: 62,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], fontSize: 7, fontStyle: 'bold', halign: 'center' },
        styles: { fontSize: 7, cellPadding: 2 }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 8;
    doc.setFillColor(248, 250, 252);
    doc.rect(14, finalY, 182, 18, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.rect(14, finalY, 182, 18, 'S');

    doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(15, 23, 42);
    doc.text(`TOTAL LIQUIDADO EN DÓLARES: $ ${totalUSD.toFixed(2)} USD`, 18, finalY + 7);
    doc.setTextColor(37, 99, 235);
    doc.text(`EQUIVALENTE BCV: Bs. ${totalBS.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 18, finalY + 13);

    if (autoSave) {
        doc.save(`Recibo_Comisiones_${sp.name.split(' ')[0]}.pdf`);
    }

    const dataUri = doc.output('datauristring');
    return dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
}

export async function generateSystemManualPDF(companyProfile?: Partial<CompanyProfile>) {
    const doc = new jsPDF();
    await addFiscalHeader(doc, companyProfile, 'MANUAL OPERATIVO V6.0', 'ATH-PRO-DOC', new Date());

    doc.setFontSize(14); doc.setTextColor(37, 99, 235);
    doc.text("1. PROTOCOLO DE PRECIOS", 14, 60);
    doc.setFontSize(10); doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "normal");
    const text1 = "La terminal gestiona una dualidad de precios: BCV (Precio de lista oficial) y CASH (Precio con incentivo de red aproximado del 35%). Los asesores deben promover el pago en divisas para activar los incentivos automáticos.";
    doc.text(doc.splitTextToSize(text1, 180), 14, 67);

    doc.setFontSize(14); doc.setTextColor(37, 99, 235); doc.setFont("helvetica", "bold");
    doc.text("2. FLUJO DE PEDIDOS", 14, 90);
    doc.setFontSize(10); doc.setTextColor(30, 41, 59); doc.setFont("helvetica", "normal");
    const text2 = "Un pedido pasa por: Pendiente (esperando aprobación) > Aprobado > Picking > Embalaje > Despachado > Entregado. La cobranza se activa únicamente tras la certificación de entrega por parte del cliente o transportista.";
    doc.text(doc.splitTextToSize(text2, 180), 14, 97);

    doc.save('Manual_Athleticenter_Pro.pdf');
}

export async function generatePurchaseOrderPDF(order: PurchaseOrder, companyProfile?: Partial<CompanyProfile>) {
    const doc = new jsPDF();
    const date = order.createdAt ? (order.createdAt instanceof Timestamp ? order.createdAt.toDate() : new Date(order.createdAt as any)) : new Date();
    await addFiscalHeader(doc, companyProfile, 'MANIFIESTO DE SUMINISTROS', order.id?.substring(0, 8) || 'PO-SUMINISTRO', date);

    doc.setFillColor(248, 250, 252);
    doc.rect(14, 50, 182, 32, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.rect(14, 50, 182, 32, 'S');

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text("DATOS DE LA IMPORTACIÓN / PROVEEDOR INTERNACIONAL:", 18, 56);

    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text((order.supplierName || 'PROVEEDOR N/A').toUpperCase(), 18, 63);

    doc.setFontSize(8);
    doc.text(`ORIGEN: ${(order.originCity || '').toUpperCase()}, ${(order.originCountry || '').toUpperCase()} | MODO: ${(order.transportMode || 'Marítimo').toUpperCase()}`, 18, 69);
    doc.text(`CONTENEDOR / GUÍA: ${order.trackingNumber || order.blNumber || 'SIN GUÍA'} | CONTENEDOR: ${order.containerType || 'Carga LCL'} | CBM: ${order.totalCBM ? order.totalCBM.toFixed(2) : '0.00'} m³`, 18, 75);

    const etaStr = order.estimatedArrival 
        ? (order.estimatedArrival instanceof Timestamp ? format(order.estimatedArrival.toDate(), 'dd/MM/yyyy') : '')
        : 'N/A';
    doc.text(`ESTADO: ${(order.status || 'Pendiente').toUpperCase()} | ETA: ${etaStr}`, 120, 63);

    const items = order.items || [];
    const tableRows = items.map((item, idx) => {
        const unitCost = item.unitCost || 0;
        const landed = item.landedUnitCost || unitCost;
        const qty = item.quantity || 0;
        return [
            `#${idx + 1}`,
            formatProductCellWithCode({
                name: item.name || 'N/A',
                sku: item.sku,
                fallbackId: item.productId,
            }),
            `${qty} UNID`,
            `$ ${unitCost.toFixed(2)}`,
            `$ ${landed.toFixed(2)}`,
            `$ ${(qty * landed).toFixed(2)}`
        ];
    });

    (doc as any).autoTable({
        head: [["ITEM", "PRODUCTO / CÓDIGO", "CANTIDAD", "FOB UNID", "LANDED UNID", "SUBTOTAL USD"]],
        body: tableRows.length > 0 ? tableRows : [["-", "Sin artículos en el manifiesto", "-", "-", "-", "$0.00"]],
        startY: 88,
        theme: 'grid',
        headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
            0: { cellWidth: 12, halign: 'center' },
            1: { cellWidth: 86 },
            2: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
            3: { cellWidth: 20, halign: 'right' },
            4: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
            5: { cellWidth: 22, halign: 'right', fontStyle: 'bold' }
        }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 10;

    const customsTotal = (order.customsTariffsAmount || 0) + (order.portFeesAmount || 0) + (order.customsAgentFeesAmount || 0) + (order.otherCustomsExpenses || 0);

    doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(100);
    doc.text(`Gastos de Importación (Aranceles, Flete y Puerto): $ ${customsTotal.toFixed(2)} USD`, 14, finalY + 5);

    doc.setFillColor(241, 245, 249);
    doc.rect(120, finalY, 76, 20, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.rect(120, finalY, 76, 20, 'S');

    doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(100);
    doc.text("INVERSIÓN TOTAL LOTE:", 124, finalY + 7);

    doc.setFontSize(14); doc.setTextColor(37, 99, 235);
    doc.text(`$ ${(order.totalCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`, 192, finalY + 15, { align: 'right' });

    doc.save(`Manifiesto_Importacion_${(order.id || 'PO').substring(0, 8)}.pdf`);
}

function isVESPaymentMethod(method?: string): boolean {
    const norm = (method || '').toLowerCase();
    return norm.includes('pago móvil') || norm.includes('pago movil') || norm.includes('transferencia ves') || norm.includes('bolivar') || norm.includes('punto de venta');
}

export async function generatePaymentReceiptPDF({
    payment,
    allPayments,
    order,
    companyProfile,
    globalSettings,
    bcvRate = 65.50,
    paymentIndex = 1,
    autoSave = true
}: {
    payment?: Partial<Payment> & { amount: number; method: string; referenceNumber?: string; registeredByName?: string; paymentDate?: any; imageUrl?: string };
    allPayments?: (Partial<Payment> & { amount: number; method: string; referenceNumber?: string; registeredByName?: string; paymentDate?: any })[];
    order: Partial<Order>;
    companyProfile?: Partial<CompanyProfile>;
    globalSettings?: FinancialSettings;
    bcvRate?: number;
    paymentIndex?: number;
    autoSave?: boolean;
}): Promise<string> {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const orderIdStr = (order.id || 'N/A').toUpperCase();
    const activePayment = payment || (allPayments && allPayments.length > 0 ? allPayments[allPayments.length - 1] : { amount: 0, method: 'Efectivo' });
    const receiptId = `#REC-${orderIdStr.replace('#', '')}-${paymentIndex}`;
    
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 210, 36, 'F');

    let textStartX = 14;
    if (companyProfile?.logoUrl) {
        try {
            const base64Logo = await getBase64ImageFromUrl(companyProfile.logoUrl);
            doc.addImage(base64Logo, 'PNG', 12, 5, 26, 26, undefined, 'FAST');
            textStartX = 42;
        } catch (e) {
            console.warn("[PDF] Error loading logo for receipt PDF:", e);
        }
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text((companyProfile?.companyName || (companyProfile as any)?.name || 'ATHLETICENTER PRO C.A.').toUpperCase(), textStartX, 15);

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(148, 163, 184);
    doc.text(`RIF: ${companyProfile?.companyRif || (companyProfile as any)?.rif || 'J-12345678-0'}`, textStartX, 21);
    doc.text(`RECIBO OFICIAL DE PAGO Y CAJA - COMPROBANTE MULTI-ABONO CERTIFICADO`, textStartX, 26);
    doc.text(`TASA OFICIAL BCV: Bs. ${bcvRate.toFixed(2)} / USD | EMISIÓN: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, textStartX, 31);

    doc.setFillColor(16, 185, 129);
    doc.rect(145, 10, 51, 18, 'F');
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text("RECIBO N°", 170.5, 16, { align: 'center' });
    doc.setFontSize(11);
    doc.text(receiptId, 170.5, 24, { align: 'center' });

    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, 42, 182, 28, 3, 3, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(14, 42, 182, 28, 3, 3, 'S');

    doc.setFontSize(7.5); doc.setFont("helvetica", "bold"); doc.setTextColor(100);
    doc.text("CLIENTE / RAZÓN SOCIAL:", 18, 48);
    doc.text("ORDEN VINCULADA:", 115, 48);
    doc.text("VENDEDOR / ASESOR:", 115, 62);

    doc.setFontSize(10); doc.setTextColor(15, 23, 42);
    doc.text((order.customerName || 'Cliente General').toUpperCase(), 18, 55);
    doc.setFontSize(8.5); doc.setTextColor(71, 85, 105);
    doc.text(`RIF: ${order.customerRif || 'N/A'}`, 18, 62);

    doc.setFontSize(10); doc.setTextColor(16, 185, 129);
    doc.text(orderIdStr, 115, 55);
    doc.setFontSize(8.5); doc.setTextColor(71, 85, 105);
    doc.text((order.salespersonName || 'Directo').toUpperCase(), 115, 67);

    const nominalTotal = Number(order.totalAmount || 0);
    const isNetOrPromotional = 
      (order as any).incentivesApplied === true ||
      (order as any).isNetPrice === true ||
      !!(order as any).promoName ||
      (order.id || '').includes('P-CONV');

    const paymentsList = (allPayments && allPayments.length > 0) ? allPayments : [activePayment];

    const hasForeignPayment = paymentsList.some(p => {
      const norm = (p.method || '').toLowerCase();
      return norm.includes('zelle') || norm.includes('efectivo') || norm.includes('binance') || norm.includes('usdt') || norm.includes('cash');
    }) || ['zelle', 'efectivo', 'binance', 'usdt', 'cash'].some(m => (activePayment.method || '').toLowerCase().includes(m));

    const hasEarlyPayment = paymentsList.some(p => {
      const dType = (p as any).discountType || (p as any).earlyPaymentType;
      return dType === '7days' || dType === '15days';
    }) || ((activePayment as any).discountType === '7days' || (activePayment as any).discountType === '15days');

    let bcvDiscountPct = (order as any).bcvDiscountSnapshot !== undefined 
      ? (order as any).bcvDiscountSnapshot 
      : (globalSettings?.defaultBcvDiscount !== undefined ? globalSettings.defaultBcvDiscount : 25);
    let early7dPct = hasEarlyPayment ? ((order as any).earlyPayment7dSnapshot !== undefined ? (order as any).earlyPayment7dSnapshot : 5) : 0;

    let cashDiscVal = 0;
    let earlyDiscVal = 0;

    if (isNetOrPromotional) {
      cashDiscVal = 0;
      earlyDiscVal = 0;
      bcvDiscountPct = 0;
      early7dPct = 0;
    } else {
      cashDiscVal = hasForeignPayment ? nominalTotal * (bcvDiscountPct / 100) : 0;
      const subtotalPostCash = Math.max(0, nominalTotal - cashDiscVal);
      earlyDiscVal = hasEarlyPayment ? subtotalPostCash * (early7dPct / 100) : 0;
    }

    const netExigible = isNetOrPromotional ? nominalTotal : Math.max(0, nominalTotal - cashDiscVal - earlyDiscVal);

    doc.setFillColor(241, 245, 249);
    doc.rect(14, 75, 182, 7, 'F');
    doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 41, 59);
    doc.text("1. AMORTIZACIÓN E INCENTIVOS DEL PEDIDO (CONDICIONES INMUTABLES CONGELADAS)", 18, 80);

    const amortRows = isNetOrPromotional ? [
        ["Monto Nominal Pedido (Lista BCV)", `$ ${nominalTotal.toFixed(2)} USD`, `Bs. ${(nominalTotal * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`],
        [`TARIFA NETO OFERTA / PROMOCIONAL`, `$ ${nominalTotal.toFixed(2)} USD`, `Bs. ${(nominalTotal * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`],
        ["MONTO NETO EXIGIBLE EN DIVISAS", `$ ${netExigible.toFixed(2)} USD`, `Bs. ${(netExigible * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`]
    ] : [
        ["Monto Nominal Pedido (Lista BCV)", `$ ${nominalTotal.toFixed(2)} USD`, `Bs. ${(nominalTotal * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`],
        [`Descuento Divisas / Cash (${hasForeignPayment ? bcvDiscountPct : 0}%)`, `- $ ${cashDiscVal.toFixed(2)} USD`, `- Bs. ${(cashDiscVal * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`],
        [`Descuento Pronto Pago (${early7dPct}%)`, `- $ ${earlyDiscVal.toFixed(2)} USD`, `- Bs. ${(earlyDiscVal * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`],
        ["MONTO NETO EXIGIBLE EN DIVISAS", `$ ${netExigible.toFixed(2)} USD`, `Bs. ${(netExigible * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`]
    ];

    (doc as any).autoTable({
        head: [["DESCRIPCIÓN DE BASE", "VALOR EN $ USD", "VALOR EN BOLÍVARES (Bs. BCV)"]],
        body: amortRows,
        startY: 84,
        theme: 'plain',
        headStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 7.5 },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
            0: { cellWidth: 100, fontStyle: 'bold' },
            1: { cellWidth: 40, halign: 'right' },
            2: { cellWidth: 42, halign: 'right' }
        }
    });

    const nextY = (doc as any).lastAutoTable.finalY + 6;
    doc.setFillColor(241, 245, 249);
    doc.rect(14, nextY, 182, 7, 'F');
    doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(16, 185, 129);
    doc.text("2. HISTORIAL COMPLETO DE ABONOS BANCARIOS CERTIFICADOS DE LA ORDEN", 18, nextY + 5);

    const bankRows = paymentsList.map((p, idx) => {
        let pDateStr = format(new Date(), 'dd/MM/yy');
        if (p.paymentDate) {
            if (typeof (p.paymentDate as any).toDate === 'function') pDateStr = format((p.paymentDate as any).toDate(), 'dd/MM/yy');
            else if ((p.paymentDate as any).seconds) pDateStr = format(new Date((p.paymentDate as any).seconds * 1000), 'dd/MM/yy');
            else pDateStr = format(new Date(p.paymentDate), 'dd/MM/yy');
        }

        const amtUSD = Number(p.amount || 0);
        const pBcvRate = (p as any).bcvRate || (p as any).bcvRateSnapshot || (order as any).receptionBcvRate || bcvRate;
        const isVES = isVESPaymentMethod(p.method);
        const amountDisplay = isVES 
            ? `Bs. ${(amtUSD * pBcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ($${amtUSD.toFixed(2)} @ Bs.${pBcvRate.toFixed(2)})`
            : `$ ${amtUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;

        return [
            `Abono #${idx + 1}\n(${pDateStr})`,
            (p.method || 'Efectivo').toUpperCase(),
            p.referenceNumber || 'N/A / Caja Físico',
            amountDisplay,
            (p.registeredByName || order.salespersonName || 'Caja Central').toUpperCase()
        ];
    });

    (doc as any).autoTable({
        head: [["# / FECHA", "MÉTODO / VÍA", "N° REFERENCIA", "MONTO INGRESADO", "VERIFICADO POR"]],
        body: bankRows,
        startY: nextY + 9,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
        bodyStyles: { fontSize: 7.5 },
        columnStyles: {
            0: { cellWidth: 26, fontStyle: 'bold', halign: 'center' },
            1: { cellWidth: 32 },
            2: { cellWidth: 38 },
            3: { cellWidth: 46, fontStyle: 'bold', halign: 'right' },
            4: { cellWidth: 40 }
        }
    });

    const nextY2 = (doc as any).lastAutoTable.finalY + 6;
    const totalPaidSoFar = paymentsList.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const remainingBalance = Math.max(0, netExigible - totalPaidSoFar);

    doc.setFillColor(15, 23, 42);
    doc.roundedRect(14, nextY2, 182, 24, 3, 3, 'F');

    doc.setFontSize(7.5); doc.setFont("helvetica", "bold"); doc.setTextColor(148, 163, 184);
    doc.text("NETO EXIGIBLE", 20, nextY2 + 6);
    doc.text("TOTAL ABONADO CUMULATIVO", 75, nextY2 + 6);
    doc.text("SALDO ADICIONAL PENDIENTE", 145, nextY2 + 6);

    doc.setFontSize(10); doc.setTextColor(255, 255, 255);
    doc.text(`$${netExigible.toFixed(2)} USD`, 20, nextY2 + 13);
    doc.setFontSize(7); doc.setTextColor(148, 163, 184);
    doc.text(`Bs. ${(netExigible * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`, 20, nextY2 + 18);

    doc.setFontSize(10); doc.setTextColor(16, 185, 129);
    doc.text(`$${totalPaidSoFar.toFixed(2)} USD`, 75, nextY2 + 13);
    doc.setFontSize(7); doc.setTextColor(52, 211, 153);
    doc.text(`Bs. ${(totalPaidSoFar * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`, 75, nextY2 + 18);

    if (remainingBalance <= 0.05) {
        doc.setFontSize(10); doc.setTextColor(52, 211, 153);
        doc.text("SOLVENTE (100%)", 145, nextY2 + 13);
        doc.setFontSize(7);
        doc.text("0.00 DEUDA", 145, nextY2 + 18);
    } else {
        doc.setFontSize(10); doc.setTextColor(248, 113, 113);
        doc.text(`$${remainingBalance.toFixed(2)} USD`, 145, nextY2 + 13);
        doc.setFontSize(7);
        doc.text(`Bs. ${(remainingBalance * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`, 145, nextY2 + 18);
    }

    doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(100);
    doc.text("CERTIFICADO DIGITAL DE PAGO: Documento emitido automáticamente por el Sistema Athleticenter Pro.", 14, 280);
    doc.text("Validez oficial respaldada por comprobante bancario adjunto en el expediente.", 14, 284);

    if (autoSave) {
        doc.save(`Recibo_Pago_${receiptId.replace('#', '')}.pdf`);
    }

    const dataUri = doc.output('datauristring');
    return dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
}

/**
 * REPORTE VISUAL DE EXISTENCIAS Y REPOSICIÓN CON FOTOS A COLOR (CARTA VERTICAL)
 * Modos:
 *  - 'gerencial': Foto a color | Producto | Unidades existentes | Unidades vendidas | Sugerido a reponer | Sugerencia
 *  - 'proveedor': # | Foto a color | Producto | Cantidad a pedir (sin ventas ni stock interno)
 */
export async function generateRestockPriorityPDF(
    summary: RestockSummary,
    itemsToPrint: RestockItemAnalysis[],
    companyProfile?: Partial<CompanyProfile>,
    subtitle: string = `PRODUCTOS CON MENOS DE ${summary.threshold} UNIDADES — ORDENADOS POR MAYOR VENTA`,
    options: {
        mode?: 'gerencial' | 'proveedor';
        customQuantities?: Record<string, number>;
        includeCostEstimate?: boolean;
    } = {}
) {
    const mode = options.mode || 'gerencial';
    const customQuantities = options.customQuantities || {};
    const includeCostEstimate = Boolean(options.includeCostEstimate);

    const resolveQty = (it: RestockItemAnalysis) =>
        customQuantities[it.id] !== undefined ? Math.max(0, Number(customQuantities[it.id]) || 0) : it.suggestedRestockQty;

    const printableItems = mode === 'proveedor'
        ? itemsToPrint.filter((it) => resolveQty(it) > 0)
        : itemsToPrint;

    const thumbMap = await preloadThumbnailMap(printableItems.map((it) => it.imageUrl));

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    // Encabezado limpio
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageW, 28, 'F');

    if (companyProfile?.logoUrl) {
        try {
            const base64Logo = await getBase64ImageFromUrl(companyProfile.logoUrl);
            doc.addImage(base64Logo, 'PNG', 12, 4, 20, 20, undefined, 'FAST');
        } catch (_) {}
    }

    const textStartX = companyProfile?.logoUrl ? 36 : 14;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(96, 165, 250);
    doc.text((companyProfile?.companyName || 'ATHLETICENTER C.A.').toUpperCase(), textStartX, 11);

    doc.setFontSize(7.5);
    doc.setTextColor(203, 213, 225);
    doc.text(`RIF: ${companyProfile?.companyRif || 'J-507140202'}  ·  FECHA: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, textStartX, 17);
    doc.text(`${printableItems.length} PRODUCTOS EN LISTADO`, textStartX, 22);

    doc.setFontSize(11.5);
    doc.setTextColor(255, 255, 255);
    doc.text(
        mode === 'proveedor' ? 'LISTA DE PEDIDO / REPOSICIÓN' : 'REPORTE DE EXISTENCIAS Y REPOSICIÓN',
        pageW - 14,
        12,
        { align: 'right' }
    );
    doc.setFontSize(7.5);
    doc.setTextColor(251, 191, 36);
    doc.text(
        (mode === 'proveedor' ? 'CANTIDADES SOLICITADAS CON REFERENCIA VISUAL' : subtitle).toUpperCase(),
        pageW - 14,
        19,
        { align: 'right' }
    );

    const totalSuggestedInView = printableItems.reduce((s, it) => s + resolveQty(it), 0);
    const totalExistingInView = printableItems.reduce((s, it) => s + it.stock, 0);
    const totalInvestmentInView = printableItems.reduce(
        (s, it) => s + resolveQty(it) * it.estimatedUnitCostUSD,
        0
    );

    // Tarjetas resumen superiores
    const kpis = mode === 'proveedor'
        ? [
            { label: 'TOTAL DE PRODUCTOS', value: `${printableItems.length} artículos`, color: [15, 23, 42] },
            { label: 'TOTAL DE UNIDADES A PEDIR', value: `${totalSuggestedInView.toLocaleString()} uds`, color: [37, 99, 235] },
            { label: 'FECHA DE SOLICITUD', value: format(new Date(), 'dd/MM/yyyy'), color: [5, 150, 105] },
        ]
        : [
            { label: 'AGOTADOS HOY (0)', value: `${summary.outOfStockCount} prod.`, color: [225, 29, 72] },
            { label: `MENOS DE ${summary.threshold} UDS`, value: `${summary.criticalCount} prod.`, color: [217, 119, 6] },
            { label: 'PEDIR URGENTE', value: `${summary.p1UrgentCount} prod.`, color: [185, 28, 28] },
            { label: 'TOTAL A REPONER', value: `${totalSuggestedInView.toLocaleString()} uds`, color: [37, 99, 235] },
        ];

    const boxGap = 3;
    const totalBoxArea = pageW - 28;
    const boxW = (totalBoxArea - boxGap * (kpis.length - 1)) / kpis.length;
    kpis.forEach((k, idx) => {
        const bx = 14 + idx * (boxW + boxGap);
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(bx, 32, boxW, 14, 2, 2, 'FD');
        doc.setFontSize(6.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(100, 116, 139);
        doc.text(k.label, bx + 3, 37);
        doc.setFontSize(10);
        doc.setTextColor(k.color[0], k.color[1], k.color[2]);
        doc.text(k.value, bx + 3, 43.5);
    });

    if (mode === 'proveedor') {
        const provRows = printableItems.map((it, idx) => [
            `${idx + 1}`,
            '', // Foto dibujada en didDrawCell
            formatProductCellWithCode({
                name: it.name,
                sku: it.sku,
                fallbackId: it.id,
                metaLines: [[it.brand, it.category].filter(Boolean).join(' · '), it.lowSizesText],
            }),
            `${resolveQty(it)} uds`,
        ]);

        (doc as any).autoTable({
            head: [['#', 'FOTO', 'PRODUCTO / CÓDIGO', 'CANTIDAD A PEDIR']],
            body: provRows,
            startY: 50,
            theme: 'grid',
            styles: { fontSize: 8.5, cellPadding: 2.5, valign: 'middle', textColor: [30, 41, 59], lineColor: [226, 232, 240] },
            headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold', fontSize: 8, halign: 'center' },
            bodyStyles: { minCellHeight: 24 },
            columnStyles: {
                0: { cellWidth: 12, halign: 'center', fontStyle: 'bold' },
                1: { cellWidth: 28, halign: 'center' },
                2: { cellWidth: 112 },
                3: { cellWidth: 36, halign: 'center', fontStyle: 'bold', fontSize: 10 },
            },
            didParseCell: (data: any) => {
                if (data.section === 'body' && data.column.index === 3) {
                    data.cell.styles.textColor = [29, 78, 216];
                }
            },
            didDrawCell: (data: any) => {
                if (data.section === 'body' && data.column.index === 1) {
                    const rowItem = printableItems[data.row.index];
                    if (!rowItem) return;
                    drawThumbnailInCell(doc, data, thumbMap.get(rowItem.imageUrl), 20);
                }
            },
            margin: { top: 14, right: 14, bottom: 18, left: 14 },
        });
    } else {
        const mgrRows = printableItems.map((it) => {
            const qty = resolveQty(it);
            const stockNote = it.stock <= 0 ? 'Agotado' : it.stock < summary.threshold ? 'Quedan pocos' : 'Disponible';
            return [
                '', // Foto dibujada en didDrawCell
                formatProductCellWithCode({
                    name: it.name,
                    sku: it.sku,
                    fallbackId: it.id,
                    metaLines: [[it.category, it.lowSizesText].filter(Boolean).join(' · ')],
                }),
                `${it.stock}\n(${stockNote})`,
                `${it.totalSold}`,
                qty > 0 ? `${qty}` : '0',
                `${getPriorityLabel(it.priority)}\n${it.recommendationText}`,
            ];
        });

        (doc as any).autoTable({
            head: [[
                'FOTO',
                'PRODUCTO / CÓDIGO',
                'EXISTENTES',
                'VENDIDAS',
                'SUGERIDO REPONER',
                'SUGERENCIA'
            ]],
            body: mgrRows,
            startY: 50,
            theme: 'grid',
            styles: { fontSize: 7.5, cellPadding: 2, valign: 'middle', textColor: [30, 41, 59], lineColor: [226, 232, 240] },
            headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold', fontSize: 7.2, halign: 'center' },
            bodyStyles: { minCellHeight: 22 },
            columnStyles: {
                0: { cellWidth: 22, halign: 'center' },
                1: { cellWidth: 56 },
                2: { cellWidth: 21, halign: 'center', fontStyle: 'bold' },
                3: { cellWidth: 21, halign: 'center', fontStyle: 'bold', fontSize: 8.5 },
                4: { cellWidth: 24, halign: 'center', fontStyle: 'bold', fontSize: 9 },
                5: { cellWidth: 44, valign: 'middle' },
            },
            didParseCell: (data: any) => {
                if (data.section !== 'body') return;
                const rowItem = printableItems[data.row.index];
                if (!rowItem) return;

                if (data.column.index === 2) {
                    if (rowItem.stock <= 0) data.cell.styles.textColor = [190, 18, 60];
                    else if (rowItem.stock < summary.threshold) data.cell.styles.textColor = [194, 65, 12];
                    else data.cell.styles.textColor = [21, 128, 61];
                }
                if (data.column.index === 4) {
                    const qty = resolveQty(rowItem);
                    data.cell.styles.textColor = qty > 0 ? [29, 78, 216] : [148, 163, 184];
                }
                if (data.column.index === 5) {
                    data.cell.styles.fontStyle = 'bold';
                    if (rowItem.priority === 'P1_URGENTE') {
                        data.cell.styles.fillColor = [254, 226, 226];
                        data.cell.styles.textColor = [153, 27, 27];
                    } else if (rowItem.priority === 'P2_ALTA') {
                        data.cell.styles.fillColor = [255, 237, 213];
                        data.cell.styles.textColor = [154, 52, 18];
                    } else if (rowItem.priority === 'P3_MEDIA') {
                        data.cell.styles.fillColor = [254, 249, 195];
                        data.cell.styles.textColor = [133, 77, 14];
                    } else {
                        data.cell.styles.fillColor = [220, 252, 231];
                        data.cell.styles.textColor = [22, 101, 52];
                    }
                }
            },
            didDrawCell: (data: any) => {
                if (data.section === 'body' && data.column.index === 0) {
                    const rowItem = printableItems[data.row.index];
                    if (!rowItem) return;
                    drawThumbnailInCell(doc, data, thumbMap.get(rowItem.imageUrl), 18);
                }
            },
            margin: { top: 14, right: 14, bottom: 18, left: 14 },
        });
    }

    const totalPages = (doc as any).internal.getNumberOfPages();
    const footerSummary =
        mode === 'proveedor'
            ? `Total solicitado: ${printableItems.length} productos · ${totalSuggestedInView.toLocaleString()} unidades`
            : `Productos: ${printableItems.length} · Existentes: ${totalExistingInView.toLocaleString()} uds · Total a reponer: ${totalSuggestedInView.toLocaleString()} uds${includeCostEstimate ? ` · Inversión est.: $${totalInvestmentInView.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : ''}`;

    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(7.2);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100);
        doc.text(footerSummary, 14, pageH - 8);
        doc.text(`Página ${i} de ${totalPages}`, pageW - 14, pageH - 8, { align: 'right' });
    }

    const fileNamePrefix = mode === 'proveedor'
        ? 'Lista_Pedido_Proveedor_Athleticenter'
        : 'Reporte_Reposicion_Fotos_Athleticenter';
    doc.save(`${fileNamePrefix}_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
}

export async function generateConsolidatedPaymentReceiptPDF({
    batchPaymentId,
    customerName,
    customerRif,
    totalAmountReceived,
    method,
    referenceNumber,
    paymentDate,
    registeredByName,
    items,
    surplusToCreditBalance = 0,
    companyProfile,
    bcvRate = 65.50,
    download = true,
}: {
    batchPaymentId: string;
    customerName: string;
    customerRif?: string;
    totalAmountReceived: number;
    method: string;
    referenceNumber?: string;
    paymentDate: Date;
    registeredByName?: string;
    items: Array<{
        orderId: string;
        previousBalance: number;
        discountAmount: number;
        appliedCash: number;
        remainingAfter: number;
        isFullyPaid: boolean;
    }>;
    surplusToCreditBalance?: number;
    companyProfile?: Partial<CompanyProfile>;
    bcvRate?: number;
    download?: boolean;
}): Promise<string> {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const receiptId = `#${(batchPaymentId || 'MULTI').toUpperCase()}`;
    const safeDate = paymentDate instanceof Date && !isNaN(paymentDate.getTime()) ? paymentDate : new Date();

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 210, 36, 'F');

    let textStartX = 14;
    if (companyProfile?.logoUrl) {
        try {
            const base64Logo = await getBase64ImageFromUrl(companyProfile.logoUrl);
            doc.addImage(base64Logo, 'PNG', 12, 5, 26, 26, undefined, 'FAST');
            textStartX = 42;
        } catch (e) {
            console.warn('[PDF] Error loading logo for consolidated receipt PDF:', e);
        }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text((companyProfile?.companyName || (companyProfile as any)?.name || 'ATHLETICENTER PRO C.A.').toUpperCase(), textStartX, 15);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(`RIF: ${companyProfile?.companyRif || (companyProfile as any)?.rif || 'J-12345678-0'}`, textStartX, 21);
    doc.text('RECIBO CONSOLIDADO DE PAGO MULTI-FACTURA CERTIFICADO', textStartX, 26);
    doc.text(`TASA OFICIAL BCV: Bs. ${bcvRate.toFixed(2)} / USD | EMISIÓN: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, textStartX, 31);

    doc.setFillColor(16, 185, 129);
    doc.rect(142, 10, 54, 18, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    doc.text('RECIBO MULTI', 169, 16, { align: 'center' });
    doc.setFontSize(8);
    doc.text(receiptId.substring(0, 22), 169, 23.5, { align: 'center' });

    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, 42, 182, 34, 3, 3, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(14, 42, 182, 34, 3, 3, 'S');

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100);
    doc.text('CLIENTE / RAZÓN SOCIAL:', 18, 48);
    doc.text('PAGO ÚNICO RECIBIDO:', 115, 48);
    doc.text('MÉTODO Y REFERENCIA:', 115, 62);

    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text((customerName || 'Cliente General').toUpperCase().substring(0, 40), 18, 55);
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`RIF: ${customerRif || 'N/A'}`, 18, 62);
    doc.text(`FECHA PAGO: ${format(safeDate, 'dd/MM/yyyy')} | VERIFICADO: ${(registeredByName || 'Caja Central').toUpperCase().substring(0, 24)}`, 18, 70);

    const isVES = isVESPaymentMethod(method);
    const totalLabel = isVES
        ? `$${totalAmountReceived.toFixed(2)} USD (Bs. ${(totalAmountReceived * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })})`
        : `$${totalAmountReceived.toFixed(2)} USD`;

    doc.setFontSize(10.5);
    doc.setTextColor(16, 185, 129);
    doc.text(totalLabel, 115, 55);
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`${(method || 'Transferencia').toUpperCase()} · REF: ${referenceNumber || 'N/A'}`, 115, 68);

    doc.setFillColor(241, 245, 249);
    doc.rect(14, 82, 182, 7, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(`DISTRIBUCIÓN DEL PAGO EN ${items.length} FACTURA(S)`, 18, 87);

    const rows = items.map((it) => [
        `#${(it.orderId || '').substring(0, 10).toUpperCase()}`,
        `$${it.previousBalance.toFixed(2)}`,
        it.discountAmount > 0 ? `-$${it.discountAmount.toFixed(2)}` : '$0.00',
        `$${it.appliedCash.toFixed(2)}`,
        `$${it.remainingAfter.toFixed(2)}`,
        it.isFullyPaid ? 'PAGADO 100%' : 'ABONO PARCIAL',
    ]);

    (doc as any).autoTable({
        head: [['FACTURA', 'SALDO PREVIO', 'AHORRO/DESC.', 'APLICADO', 'RESTANTE', 'ESTADO']],
        body: rows,
        startY: 91,
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
            0: { cellWidth: 32, fontStyle: 'bold' },
            1: { cellWidth: 30, halign: 'right' },
            2: { cellWidth: 30, halign: 'right', textColor: [16, 185, 129] },
            3: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
            4: { cellWidth: 30, halign: 'right' },
            5: { cellWidth: 30, halign: 'center', fontStyle: 'bold' },
        },
    });

    let cursorY = ((doc as any).lastAutoTable?.finalY || 140) + 8;

    const totalApplied = roundCurrency(items.reduce((s, it) => s + Number(it.appliedCash || 0), 0));
    const totalRemaining = roundCurrency(items.reduce((s, it) => s + Number(it.remainingAfter || 0), 0));

    doc.setFillColor(15, 23, 42);
    doc.roundedRect(14, cursorY, 182, 22, 3, 3, 'F');
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(148, 163, 184);
    doc.text('MONTO ÚNICO RECIBIDO', 20, cursorY + 7);
    doc.text('APLICADO A FACTURAS', 80, cursorY + 7);
    doc.text('SALDO RESTANTE EN LOTE', 142, cursorY + 7);

    doc.setFontSize(10.5);
    doc.setTextColor(255, 255, 255);
    doc.text(`$${totalAmountReceived.toFixed(2)} USD`, 20, cursorY + 15);
    doc.setTextColor(52, 211, 153);
    doc.text(`$${totalApplied.toFixed(2)} USD`, 80, cursorY + 15);
    doc.setTextColor(totalRemaining <= 0.05 ? 52 : 248, totalRemaining <= 0.05 ? 211 : 113, totalRemaining <= 0.05 ? 153 : 113);
    doc.text(totalRemaining <= 0.05 ? '$0.00 (SOLVENTE)' : `$${totalRemaining.toFixed(2)} USD`, 142, cursorY + 15);

    cursorY += 28;

    if (surplusToCreditBalance > 0.01) {
        doc.setFillColor(236, 253, 245);
        doc.setDrawColor(16, 185, 129);
        doc.roundedRect(14, cursorY, 182, 16, 3, 3, 'FD');
        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(6, 95, 70);
        doc.text(`SALDO A FAVOR ACREDITADO EN BILLETERA DEL CLIENTE: $${surplusToCreditBalance.toFixed(2)} USD`, 18, cursorY + 7);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.text('Este excedente queda disponible en su cuenta para aplicarlo en próximos pedidos.', 18, cursorY + 12.5);
    }

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text('CERTIFICADO DIGITAL DE PAGO CONSOLIDADO: Emitido automáticamente por Athleticenter Pro.', 14, 280);
    doc.text('Todas las facturas listadas comparten el mismo respaldo bancario en el expediente.', 14, 284);

    if (download) {
        doc.save(`Recibo_Consolidado_${batchPaymentId}.pdf`);
    }

    const dataUri = doc.output('datauristring');
    return dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
}
