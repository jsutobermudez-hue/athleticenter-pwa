import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import type { OrderItemClient, QuoteItemClient, CompanyProfile, Invoice, Payment, Commission, Product, Order, User, Customer, FinancialSettings } from './definitions';
import { Timestamp } from 'firebase/firestore';
import QRCode from 'qrcode';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { calculatePricingTier } from './pricing';

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
  const primaryColor = [37, 99, 235]; 
  const accentColor = [30, 41, 59];

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
  bcvRate = 1
}: GenerateOrderPdfParams) {
  const doc = new jsPDF();
  const date = createdAt instanceof Timestamp ? createdAt.toDate() : (createdAt instanceof Date ? createdAt : new Date());
  
  await addFiscalHeader(doc, companyProfile, documentType === 'factura' ? 'FACTURA FISCAL' : 'NOTA DE ENTREGA', orderId, date);
  addClientBlock(doc, customerName, customerRif, customerAddress, 50);

  let totalBcvUSD = 0;
  let totalCashUSD = 0;

  const tableRows = orderItems.map(item => {
    const pricing = calculatePricingTier({ 
        costLanded: item.product?.cost || 0,
        strategy: 'target_price', 
        targetPriceUSD: item.unitPrice || 0 
    }, globalSettings);

    const bcvPrice = pricing.priceListBCV;
    const cashPrice = pricing.priceCashUSD;
    
    totalBcvUSD += (item.quantity * bcvPrice);
    totalCashUSD += (item.quantity * cashPrice);
    
    return [
      item.product?.sku || 'N/A', 
      (item.product?.name || 'EQUIPO').toUpperCase() + (item.size ? ` (${item.size})` : ''), 
      item.quantity, 
      `$ ${bcvPrice.toFixed(2)}`, 
      `$ ${cashPrice.toFixed(2)}`, 
      `$ ${(item.quantity * bcvPrice).toFixed(2)}`
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

  const finalY = (doc as any).lastAutoTable.finalY + 10;
  const rate = bcvRate || globalSettings?.bcvRate || 1;
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
    bcvRate = 1 
}: any) {
  const doc = new jsPDF();
  const date = new Date();
  const expDate = expiryDate instanceof Timestamp ? expiryDate.toDate() : (expiryDate instanceof Date ? expiryDate : new Date());

  await addFiscalHeader(doc, companyProfile, 'PRESUPUESTO PROFORMA', quoteId, date);
  addClientBlock(doc, customerName, customerRif, customerAddress, 50);

  let totalBcvUSD = 0;
  let totalCashUSD = 0;

  const tableRows = quoteItems.map((item: any) => {
    const pricing = calculatePricingTier({ 
        costLanded: item.product?.cost || 0,
        strategy: 'target_price', 
        targetPriceUSD: item.unitPrice || item.product?.price || 0 
    }, globalSettings);

    const bcvPrice = pricing.priceListBCV;
    const cashPrice = pricing.priceCashUSD;
    
    totalBcvUSD += (item.quantity * bcvPrice);
    totalCashUSD += (item.quantity * cashPrice);
    
    return [
      item.product?.sku || 'N/A', 
      (item.product?.name || 'EQUIPO').toUpperCase() + (item.size ? ` (${item.size})` : ''), 
      item.quantity, 
      `$ ${bcvPrice.toFixed(2)}`, 
      `$ ${cashPrice.toFixed(2)}`, 
      `$ ${(item.quantity * bcvPrice).toFixed(2)}`
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

  const finalY = (doc as any).lastAutoTable.finalY + 10;

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
