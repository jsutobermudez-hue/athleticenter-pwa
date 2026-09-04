import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import type { OrderItemClient, QuoteItemClient, CompanyProfile, Invoice, Payment, Commission, Product, Order, User, Customer, FinancialSettings, PurchaseOrder } from './definitions';
import { Timestamp } from 'firebase/firestore';
import QRCode from 'qrcode';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { calculatePricingTier } from './pricing';
import { roundCurrency } from './billing';

type GenerateOrderPdfParams = {
  customerName: string;
  customerRif?: string;
  customerAddress?: string;
  orderItems: OrderItemClient[];
  salespersonName: string;
  orderId: string;
  createdAt: Date | Timestamp;
  companyProfile?: Partial<CompanyProfile>;
  documentType?: 'nota' | 'factura';
  globalSettings?: FinancialSettings;
  bcvRate?: number;
  order?: Partial<Order>;
};

/**
 * MOTOR DE DOCUMENTACIÓN FISCAL v7.5 - ATHLETICENTER PRO
 * Sincronizado: Sistema de etiquetas QR y Transparencia de Precios en Cotizaciones.
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
  doc.text(`RIF: ${company?.companyRif || 'J-50000000-0'}`, 45, 25);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(100);
  const addressLines = doc.splitTextToSize(company?.companyAddress || 'DIRECCIÓN FISCAL NO REGISTRADA.', 85);
  doc.text(addressLines, 45, 30);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text(title.toUpperCase(), 196, 20, { align: 'right' });
  
  doc.setFontSize(10);
  doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
  doc.text(`CONTROL: #${refId.toUpperCase()}`, 196, 27, { align: 'right' });
  
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
  orderId, 
  createdAt, 
  companyProfile, 
  documentType = 'nota',
  globalSettings,
  bcvRate,
  order
}: GenerateOrderPdfParams) {
  const doc = new jsPDF();
  const date = createdAt instanceof Timestamp ? createdAt.toDate() : (createdAt instanceof Date ? createdAt : new Date());
  
  await addFiscalHeader(doc, companyProfile, documentType === 'factura' ? 'FACTURA FISCAL' : 'NOTA DE ENTREGA', orderId, date);
  addClientBlock(doc, customerName, customerRif, customerAddress, 50);

  let totalBcvUSD = 0;
  let totalCashUSD = 0;

  const isNetOrPromotional = 
    (order as any)?.incentivesApplied === true ||
    (order as any)?.isNetPrice === true ||
    !!(order as any)?.promoName ||
    (orderId || '').includes('P-CONV');

  const bcvDiscountPct = isNetOrPromotional 
    ? 0 
    : ((order as any)?.bcvDiscountSnapshot !== undefined 
        ? (order as any).bcvDiscountSnapshot 
        : (globalSettings?.defaultBcvDiscount !== undefined ? globalSettings.defaultBcvDiscount : 25));

  const tableRows = orderItems.map(item => {
    const itemUnitPrice = roundCurrency(item.unitPrice || item.product?.price || 0);
    const catalogPrice = item.product?.price || itemUnitPrice;
    const isItemNet = isNetOrPromotional || (item as any).isNetPrice || (catalogPrice > 0 && itemUnitPrice < catalogPrice);

    const bcvPrice = itemUnitPrice;

    const cashPrice = isItemNet
      ? bcvPrice
      : roundCurrency(bcvPrice * (1 - bcvDiscountPct / 100));
    
    const rowBcvTotal = roundCurrency(item.quantity * bcvPrice);
    const rowCashTotal = roundCurrency(item.quantity * cashPrice);

    totalBcvUSD += rowBcvTotal;
    totalCashUSD += rowCashTotal;
    
    return [
      item.product?.sku || 'N/A', 
      (item.product?.name || 'EQUIPO').toUpperCase() + (item.size ? ` (${item.size})` : ''), 
      item.quantity, 
      `$ ${bcvPrice.toFixed(2)}`, 
      `$ ${cashPrice.toFixed(2)}`, 
      `$ ${rowBcvTotal.toFixed(2)}`
    ];
  });

  (doc as any).autoTable({
    head: [["SKU", "DESCRIPCIÓN", "CANT", "P. BCV", "P. CASH", "TOTAL BCV"]], 
    body: tableRows, 
    startY: 80, 
    theme: 'grid',
    styles: { fontSize: 7 },
    headStyles: { fillColor: [37, 99, 235], fontSize: 7, fontStyle: 'bold', halign: 'center' },
    columnStyles: { 
        2: { halign: 'center' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right', fontStyle: 'bold' }
    }
  });

  let finalY = (doc as any).lastAutoTable.finalY + 10;
  if (finalY + 45 > 280) {
    doc.addPage();
    finalY = 20;
  }

  const rate = bcvRate || (order as any)?.receptionBcvRate || (order as any)?.bcvRate || globalSettings?.bcvRate || 65.50;
  const totalVES = totalBcvUSD * rate;

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

  doc.setFontSize(6); doc.setTextColor(150); doc.setFont("helvetica", "normal");
  doc.text("* ESTE DOCUMENTO REPRESENTA LA BASE IMPONIBLE. EL IVA (16%) SE CALCULA AL MOMENTO DEL PAGO FISCAL.", 14, finalY + 38);

  doc.save(`${documentType === 'factura' ? 'Factura' : 'Nota'}_${orderId.substring(0,8)}.pdf`);
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
        const tableRows = items.map(item => [item.product?.sku || 'N/A', item.product?.name.toUpperCase().substring(0, 35), item.quantity]);
        (doc as any).autoTable({
            head: [["SKU", "EQUIPO", "CANT"]],
            body: tableRows,
            startY: 50,
            margin: { left: 10, right: 78 },
            styles: { fontSize: 6, cellPadding: 1 },
            headStyles: { fillColor: [30, 41, 59], fontSize: 6 },
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
    quote
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

  const tableRows = quoteItems.map((item: any) => {
    const itemUnitPrice = roundCurrency(item.unitPrice || item.product?.price || 0);
    const catalogPrice = item.product?.price || itemUnitPrice;
    const isItemNet = isNetOrPromotional || item.isNetPrice || (catalogPrice > 0 && itemUnitPrice < catalogPrice);

    const bcvPrice = itemUnitPrice;

    const cashPrice = isItemNet
      ? bcvPrice
      : roundCurrency(bcvPrice * (1 - bcvDiscountPct / 100));
    
    const rowBcvTotal = roundCurrency(item.quantity * bcvPrice);
    const rowCashTotal = roundCurrency(item.quantity * cashPrice);

    totalBcvUSD += rowBcvTotal;
    totalCashUSD += rowCashTotal;
    
    return [
      item.product?.sku || 'N/A', 
      (item.product?.name || 'EQUIPO').toUpperCase() + (item.size ? ` (${item.size})` : ''), 
      item.quantity, 
      `$ ${bcvPrice.toFixed(2)}`, 
      `$ ${cashPrice.toFixed(2)}`, 
      `$ ${rowBcvTotal.toFixed(2)}`
    ];
  });

  (doc as any).autoTable({ 
    head: [["SKU", "DESCRIPCIÓN DEL EQUIPO", "CANT", "P. BCV", "P. CASH", "TOTAL BCV"]], 
    body: tableRows, 
    startY: 80, 
    theme: 'grid', 
    styles: { fontSize: 7 },
    headStyles: { fillColor: [37, 99, 235], halign: 'center', fontSize: 7, fontStyle: 'bold' },
    columnStyles: { 
        2: { halign: 'center' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right', fontStyle: 'bold' }
    }
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

  doc.save(`Cotizacion_${quoteId.substring(0,8)}.pdf`);
}

export async function generatePickingListPDF({ orderId, customerName, orderItems, companyProfile }: any) {
  const doc = new jsPDF();
  const date = new Date();
  await addFiscalHeader(doc, companyProfile, 'ORDEN DE PICKING', orderId, date);
  const tableRows = orderItems.map((item: any) => [
    item.product?.warehouseLocation || 'Z-ZZZ', 
    item.product?.sku || 'N/A', 
    item.product?.name.toUpperCase() + (item.size ? ` (${item.size})` : ''), 
    item.quantity, 
    "[  ]"
  ]);
  (doc as any).autoTable({ 
    head: [["UBICACIÓN", "SKU", "EQUIPO", "CANT", "CHECK"]], 
    body: tableRows, 
    startY: 50, 
    theme: 'grid', 
    headStyles: { fillColor: [30, 41, 59] } 
  });
  doc.save(`Picking_${orderId.substring(0,8)}.pdf`);
}

export async function generateInventoryReportPDF(products: Product[], companyProfile?: Partial<CompanyProfile>, title: string = 'INVENTARIO MAESTRO') {
  const doc = new jsPDF();
  await addFiscalHeader(doc, companyProfile, title, 'INV-' + Date.now().toString().slice(-6), new Date());
  const tableRows = products.map(p => [p.sku, p.name.toUpperCase(), p.warehouseLocation || '---', p.stockLevel, `$ ${p.price.toFixed(2)}`]);
  (doc as any).autoTable({ head: [["SKU", "DESCRIPCIÓN", "UBICACIÓN", "STOCK", "PVP BASE"]], body: tableRows, startY: 50, theme: 'grid', headStyles: { fillColor: [30, 41, 59] } });
  doc.save(`${title.replace(/\s+/g, '_')}.pdf`);
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

export async function generateCommissionReceiptPDF(sp: User, commissions: Commission[], reference: string, companyProfile?: Partial<CompanyProfile>) {
    const doc = new jsPDF();
    await addFiscalHeader(doc, companyProfile, 'RECIBO DE COMISIONES', reference, new Date());
    
    doc.setFontSize(11); doc.setTextColor(30, 41, 59);
    doc.text(`BENEFICIARIO: ${sp.name.toUpperCase()}`, 14, 55);

    const total = commissions.reduce((sum, c) => sum + c.salespersonCommissionAmount, 0);

    const tableRows = commissions.map(c => [
        c.orderId.substring(0,8),
        format((c.commissionDate as Timestamp).toDate(), 'dd/MM/yy'),
        `$ ${c.invoiceAmount.toFixed(2)}`,
        `$ ${c.salespersonCommissionAmount.toFixed(2)}`
    ]);

    (doc as any).autoTable({
        head: [["PEDIDO", "FECHA", "BASE RECAUDADA", "COMISIÓN"]],
        body: tableRows,
        startY: 65,
        theme: 'grid',
        headStyles: { fillColor: [30, 41, 59] }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(12); doc.setFont("helvetica", "bold");
    doc.text(`TOTAL A LIQUIDAR: $ ${total.toFixed(2)}`, 196, finalY, { align: 'right' });

    doc.save(`Recibo_Comisiones_${sp.name.split(' ')[0]}.pdf`);
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
            (item.sku || 'N/A').toUpperCase(),
            (item.name || 'N/A').toUpperCase(),
            `${qty} UNID`,
            `$ ${unitCost.toFixed(2)}`,
            `$ ${landed.toFixed(2)}`,
            `$ ${(qty * landed).toFixed(2)}`
        ];
    });

    (doc as any).autoTable({
        head: [["ITEM", "REF / SKU", "DESCRIPCIÓN DE PRODUCTO", "CANTIDAD", "FOB UNID", "LANDED UNID", "SUBTOTAL USD"]],
        body: tableRows.length > 0 ? tableRows : [["-", "-", "Sin artículos en el manifiesto", "-", "-", "-", "$0.00"]],
        startY: 88,
        theme: 'grid',
        headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
            0: { cellWidth: 12, halign: 'center' },
            1: { cellWidth: 28, fontStyle: 'bold' },
            2: { cellWidth: 58 },
            3: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
            4: { cellWidth: 20, halign: 'right' },
            5: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
            6: { cellWidth: 22, halign: 'right', fontStyle: 'bold' }
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
    paymentIndex = 1
}: {
    payment?: Partial<Payment> & { amount: number; method: string; referenceNumber?: string; registeredByName?: string; paymentDate?: any; imageUrl?: string };
    allPayments?: (Partial<Payment> & { amount: number; method: string; referenceNumber?: string; registeredByName?: string; paymentDate?: any })[];
    order: Partial<Order>;
    companyProfile?: Partial<CompanyProfile>;
    globalSettings?: FinancialSettings;
    bcvRate?: number;
    paymentIndex?: number;
}) {
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
      earlyDiscVal = hasEarlyPayment ? nominalTotal * (early7dPct / 100) : 0;
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

    doc.save(`Recibo_Pago_${receiptId.replace('#', '')}.pdf`);
}
