import { NextRequest, NextResponse } from 'next/server';
import { initializeFirebaseServer } from '@/firebase/server-init';
import { collection, query, getDocs, limit, where, doc as firestoreDoc, getDoc } from 'firebase/firestore';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getEffectiveCashReceived } from '@/lib/billing';
import { format } from 'date-fns';

export const dynamic = 'force-dynamic';

const convertToDate = (value: any): Date => {
    if (!value) return new Date(0);
    if (typeof value.toDate === 'function') {
        return value.toDate();
    }
    return new Date(value);
};

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const salespersonId = searchParams.get('salespersonId');
        const salespersonNameParam = searchParams.get('salespersonName');

        const { firestore } = initializeFirebaseServer();
        const { ensureServerAuth } = await import('@/firebase/server-init');
        await ensureServerAuth();

        // 1. Obtener la tasa BCV oficial
        let bcvRate = 65.50;
        try {
            const settingsSnap = await getDoc(firestoreDoc(firestore, 'system', 'financials'));
            if (settingsSnap.exists()) {
                bcvRate = settingsSnap.data()?.bcvRate || 65.50;
            }
        } catch (_) {}

        // 2. Obtener órdenes de Firestore de forma segura
        let rawOrders: any[] = [];
        try {
            const ordersSnap = await getDocs(query(collection(firestore, 'orders'), limit(300)));
            rawOrders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (snapErr: any) {
            console.warn("[PDF Route] Aviso: Consulta de órdenes diferida con respaldo:", snapErr?.message);
        }

        const VALID_SALES = ['Entregado', 'Completado', 'Despachado', 'Pagado', 'Aprobado', 'En Preparación', 'En Verificación', 'Pendiente'];

        // 3. Filtrar órdenes activas por vendedor
        const pendingOrders = rawOrders.filter(o => {
            if (o.status === 'Cancelado' || o.status === 'Rechazado') return false;
            if (!VALID_SALES.includes(o.status)) return false;

            // Filtro por vendedor si se especificó
            if (salespersonId && salespersonId !== 'all') {
                const sId = o.salespersonId || o.sellerId || o.vendedorId;
                if (sId !== salespersonId) {
                    const sName = (o.salespersonName || o.vendedor || '').toLowerCase();
                    if (!salespersonNameParam || !sName.includes(salespersonNameParam.toLowerCase())) {
                        return false;
                    }
                }
            }

            const total = Number(o.totalAmount || 0);
            const paid = getEffectiveCashReceived(o);
            const isPaid = o.status === 'Pagado' || paid >= (total - 0.05);

            return !isPaid && (total - paid) > 0.05;
        });

        // Ordenar por fecha más antigua
        pendingOrders.sort((a, b) => {
            const dateA = convertToDate(a.receptionDate || a.createdAt || a.orderDate);
            const dateB = convertToDate(b.receptionDate || b.createdAt || b.orderDate);
            return dateA.getTime() - dateB.getTime();
        });

        // 4. Calcular métricas
        const now = Date.now();
        let totalDebtUSD = 0;
        let totalMoraUSD = 0;
        let totalCurrentUSD = 0;
        let totalPaidUSD = 0;
        let moraCount = 0;

        const tableRows = pendingOrders.map(o => {
            const total = Number(o.totalAmount || 0);
            const paid = getEffectiveCashReceived(o);
            const pending = Math.max(0, total - paid);
            const pendingBs = pending * bcvRate;

            totalDebtUSD += pending;
            totalPaidUSD += paid;

            const orderDate = convertToDate(o.receptionDate || o.createdAt || o.orderDate);
            const daysOld = Math.floor((now - orderDate.getTime()) / (1000 * 60 * 60 * 24));

            if (daysOld >= 30) {
                totalMoraUSD += pending;
                moraCount++;
            } else {
                totalCurrentUSD += pending;
            }

            const clientName = o.customerName || o.clientName || 'Cliente N/A';
            const clientPhone = o.customerPhone || o.phone || 'S/N';
            const dateStr = orderDate.getTime() > 0 ? format(orderDate, 'dd/MM/yyyy') : 'S/F';
            const statusLabel = daysOld >= 30 ? `MORA (${daysOld}d)` : `VIGENTE (${daysOld}d)`;

            return [
                `#${o.id}`,
                `${clientName}\nTel: ${clientPhone}`,
                dateStr,
                statusLabel,
                `$${total.toFixed(2)}`,
                `$${paid.toFixed(2)}`,
                `$${pending.toFixed(2)}\nBs. ${pendingBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            ];
        });

        const targetSalespersonName = salespersonNameParam || (pendingOrders[0]?.salespersonName || 'Asesor Comercial / Vendedor');

        // 5. Construir documento PDF con jsPDF
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

        // Membrete Institucional Slate-900
        doc.setFillColor(15, 23, 42); // Slate-900
        doc.rect(0, 0, 210, 32, 'F');

        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 255, 255);
        doc.text('ATHLETICENTER PRO C.A.', 14, 16);

        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184); // Slate-400
        doc.text('REPORTE EJECUTIVO SEMANAL DE CARTERA POR COBRAR - VENDEDORES', 14, 23);
        doc.text(`VENDEDOR ASIGNADO: ${targetSalespersonName.toUpperCase()}`, 14, 28);

        // Bloque Fecha y Tasa BCV
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(51, 65, 85);
        doc.text(`FECHA DE EMISIÓN: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 38);
        doc.text(`TASA OFICIAL BCV: Bs. ${bcvRate.toFixed(2)} / USD`, 120, 38);

        // Cajas de KPIs Resumen
        doc.setFillColor(248, 250, 252); // Slate-50
        doc.roundedRect(14, 43, 58, 22, 3, 3, 'F');
        doc.roundedRect(76, 43, 58, 22, 3, 3, 'F');
        doc.roundedRect(138, 43, 58, 22, 3, 3, 'F');

        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(225, 29, 72); // Rose-600
        doc.text('DEUDA TOTAL EN CARTERA', 18, 48);
        doc.setFontSize(12);
        doc.text(`$${totalDebtUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 18, 56);
        doc.setFontSize(6);
        doc.setTextColor(100, 116, 139);
        doc.text(`Bs. ${(totalDebtUSD * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`, 18, 61);

        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(194, 65, 12); // Orange-700 (Mora)
        doc.text('MORA CRÍTICA (+30 DÍAS)', 80, 48);
        doc.setFontSize(12);
        doc.text(`$${totalMoraUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 80, 56);
        doc.setFontSize(6);
        doc.setTextColor(100, 116, 139);
        doc.text(`${moraCount} expediente(s) en mora`, 80, 61);

        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(16, 185, 129); // Emerald-600
        doc.text('ABONOS RECAUDADOS', 142, 48);
        doc.setFontSize(12);
        doc.text(`$${totalPaidUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 142, 56);
        doc.setFontSize(6);
        doc.setTextColor(100, 116, 139);
        doc.text(`${pendingOrders.length} ordenes en seguimiento`, 142, 61);

        // Tabla con autoTable
        autoTable(doc, {
            startY: 70,
            head: [['PEDIDO', 'CLIENTE / CONTACTO', 'EMISIÓN', 'ESTADO', 'TOTAL ($)', 'ABONADO', 'SALDO PENDIENTE']],
            body: tableRows.length > 0 ? tableRows : [['-', 'Sin expedientes pendientes por cobrar', '-', '-', '$0.00', '$0.00', '$0.00']],
            styles: { fontSize: 8, cellPadding: 3, font: 'helvetica' },
            headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            columnStyles: {
                0: { fontStyle: 'bold', cellWidth: 22 },
                1: { cellWidth: 55 },
                2: { cellWidth: 22 },
                3: { fontStyle: 'bold', cellWidth: 26 },
                4: { halign: 'right', cellWidth: 22 },
                5: { halign: 'right', cellWidth: 22 },
                6: { halign: 'right', fontStyle: 'bold', textColor: [225, 29, 72] }
            }
        });

        // Pie de página institucional
        const pageCount = (doc as any).internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(148, 163, 184);
            doc.text(`Athleticenter PRO C.A. • Sistema de Procura y Cobranzas • Página ${i} de ${pageCount}`, 14, 287);
        }

        const pdfOutput = doc.output('arraybuffer');

        return new NextResponse(pdfOutput, {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="Estado_Cartera_${targetSalespersonName.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.pdf"`
            }
        });

    } catch (err: any) {
        console.error('Error generando PDF de cartera por vendedor:', err);
        return NextResponse.json({ success: false, error: err.message || 'Error generando PDF.' }, { status: 500 });
    }
}
