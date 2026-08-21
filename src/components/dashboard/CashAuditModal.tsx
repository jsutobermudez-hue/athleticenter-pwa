'use client';

import React, { useMemo } from 'react';
import type { Order } from '@/lib/definitions';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getCashBreakdown } from '@/lib/billing';
import { 
    Banknote, 
    Printer, 
    DollarSign, 
    CheckCircle2, 
    Search
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';

interface CashAuditModalProps {
    isOpen: boolean;
    onClose: () => void;
    orders: Order[] | null;
    periodFilter?: 'today' | '7d' | 'this_month' | 'last_month' | 'all';
    bcvRate?: number;
    onSelectOrder?: (order: Order) => void;
}

export function CashAuditModal({ isOpen, onClose, orders, periodFilter = 'all', bcvRate = 65.50, onSelectOrder }: CashAuditModalProps) {
    const [searchTerm, setSearchTerm] = React.useState('');

    const breakdown = useMemo(() => {
        return getCashBreakdown(orders, periodFilter);
    }, [orders, periodFilter]);

    const filteredPayments = useMemo(() => {
        if (!searchTerm) return breakdown.payments;
        const term = searchTerm.toLowerCase();
        return breakdown.payments.filter(p => 
            p.customerName.toLowerCase().includes(term) ||
            p.orderId.toLowerCase().includes(term) ||
            (p.salespersonName || '').toLowerCase().includes(term) ||
            p.method.toLowerCase().includes(term)
        );
    }, [breakdown.payments, searchTerm]);

    const periodTitle = useMemo(() => {
        if (periodFilter === 'today') return 'Arqueo de Caja del Día (HOY)';
        if (periodFilter === '7d') return 'Arqueo de Caja de los Últimos 7 Días';
        if (periodFilter === 'this_month') return 'Arqueo de Caja del Mes Actual';
        if (periodFilter === 'last_month') return 'Arqueo de Caja del Mes Anterior';
        return 'Arqueo Global de Caja (Histórico)';
    }, [periodFilter]);

    const handlePrintPDF = () => {
        try {
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

            doc.setFillColor(15, 23, 42);
            doc.rect(0, 0, 210, 32, 'F');

            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(255, 255, 255);
            doc.text('ATHLETICENTER PRO C.A.', 14, 16);

            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(148, 163, 184);
            doc.text(`ACTA DE ARQUEO Y CIERRE DE CAJA - ${periodTitle.toUpperCase()}`, 14, 23);
            doc.text(`TASA OFICIAL BCV: Bs. ${bcvRate.toFixed(2)} / USD | FECHA EMISIÓN: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 28);

            // Cajas de KPIs
            doc.setFillColor(248, 250, 252);
            doc.roundedRect(14, 38, 42, 18, 3, 3, 'F');
            doc.roundedRect(60, 38, 42, 18, 3, 3, 'F');
            doc.roundedRect(106, 38, 42, 18, 3, 3, 'F');
            doc.roundedRect(152, 38, 44, 18, 3, 3, 'F');

            doc.setFontSize(6.5);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(16, 185, 129);
            doc.text('TOTAL RECAUDADO ($)', 17, 43);
            doc.setFontSize(10);
            doc.text(`$${breakdown.totalCash.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 17, 51);

            doc.setFontSize(6.5);
            doc.setTextColor(37, 99, 235);
            doc.text('EFECTIVO USD', 63, 43);
            doc.setFontSize(10);
            doc.text(`$${breakdown.cashUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 63, 51);

            doc.setFontSize(6.5);
            doc.setTextColor(147, 51, 234);
            doc.text('ZELLE USD', 109, 43);
            doc.setFontSize(10);
            doc.text(`$${breakdown.zelle.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 109, 51);

            doc.setFontSize(6.5);
            doc.setTextColor(2, 132, 199);
            doc.text('BOLÍVARES BCV', 155, 43);
            doc.setFontSize(10);
            doc.text(`$${breakdown.bcv.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 155, 51);

            const tableRows = filteredPayments.map(p => [
                p.orderId,
                format(p.date, 'dd/MM/yyyy HH:mm'),
                p.customerName,
                p.salespersonName || 'Directo',
                p.method,
                `$${p.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                `Bs. ${(p.amount * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`
            ]);

            autoTable(doc, {
                startY: 60,
                head: [['ORDEN #', 'FECHA / HORA PAGO', 'CLIENTE / RAZÓN SOCIAL', 'VENDEDOR', 'MÉTODO DE PAGO', 'MONTO ($ USD)', 'MONTO (Bs. BCV)']],
                body: tableRows,
                styles: { fontSize: 7.5, cellPadding: 2, font: 'helvetica' },
                headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [248, 250, 252] }
            });

            doc.autoPrint();
            window.open(doc.output('bloburl'), '_blank');
        } catch (e) {
            console.error('Error generando PDF de arqueo:', e);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-4xl bg-slate-950 text-white border-slate-800 p-0 overflow-hidden rounded-[2.5rem] shadow-2xl">
                <DialogHeader className="p-6 pb-4 bg-slate-900/80 border-b border-slate-800/80 flex flex-row items-center justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <Badge className="bg-emerald-500/20 text-emerald-400 border-none font-black text-[9px] uppercase px-2.5 py-0.5">
                                Arqueo & Conciliación
                            </Badge>
                            <span className="text-[10px] font-bold text-slate-400">BCV: Bs. {bcvRate.toFixed(2)}</span>
                        </div>
                        <DialogTitle className="text-xl font-black text-white uppercase tracking-tight mt-1 flex items-center gap-2">
                            <Banknote className="h-5 w-5 text-emerald-400" />
                            {periodTitle}
                        </DialogTitle>
                        <DialogDescription className="text-xs text-slate-400 font-bold">
                            Ingresos efectivos en caja desglosados por método de pago y comprobantes recibidos.
                        </DialogDescription>
                    </div>
                    <Button onClick={handlePrintPDF} className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[9px] uppercase tracking-wider shadow-lg flex items-center gap-1.5 shrink-0">
                        <Printer className="h-4 w-4" /> Imprimir Acta Arqueo
                    </Button>
                </DialogHeader>

                <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
                    {/* RESUMEN DE MÉTODOS DE PAGO */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/20 space-y-1">
                            <p className="text-[9px] font-black uppercase text-emerald-400 tracking-wider">Total En Caja</p>
                            <p className="text-xl font-black text-white tracking-tight">
                                ${breakdown.totalCash.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </p>
                            <p className="text-[8px] text-slate-400 font-bold">Bs. {(breakdown.totalCash * bcvRate).toLocaleString('es-VE', { maximumFractionDigits: 0 })}</p>
                        </div>
                        <div className="p-4 rounded-2xl bg-blue-950/40 border border-blue-500/20 space-y-1">
                            <p className="text-[9px] font-black uppercase text-blue-400 tracking-wider">Efectivo USD</p>
                            <p className="text-xl font-black text-white tracking-tight">
                                ${breakdown.cashUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </p>
                        </div>
                        <div className="p-4 rounded-2xl bg-purple-950/40 border border-purple-500/20 space-y-1">
                            <p className="text-[9px] font-black uppercase text-purple-400 tracking-wider">Zelle USD</p>
                            <p className="text-xl font-black text-white tracking-tight">
                                ${breakdown.zelle.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </p>
                        </div>
                        <div className="p-4 rounded-2xl bg-sky-950/40 border border-sky-500/20 space-y-1">
                            <p className="text-[9px] font-black uppercase text-sky-400 tracking-wider">Bolívares BCV</p>
                            <p className="text-xl font-black text-white tracking-tight">
                                ${breakdown.bcv.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </p>
                        </div>
                    </div>

                    {/* BUSCADOR */}
                    <div className="relative">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="BUSCAR PAGO POR CLIENTE, ORDEN O MÉTODO..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full h-10 pl-10 pr-4 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                        />
                    </div>

                    {/* TABLA DE TRANSACCIONES DE COBRO */}
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
                        <table className="w-full text-left text-xs">
                            <thead className="bg-slate-900 text-slate-400 text-[9px] font-black uppercase tracking-wider border-b border-slate-800">
                                <tr>
                                    <th className="px-4 py-3">Orden #</th>
                                    <th className="px-4 py-3">Fecha / Hora</th>
                                    <th className="px-4 py-3">Cliente</th>
                                    <th className="px-4 py-3">Método</th>
                                    <th className="px-4 py-3 text-right">Monto ($)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60 font-bold text-slate-200">
                                {filteredPayments.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-xs">
                                            No se encontraron ingresos registrados en este período.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredPayments.map((p, idx) => (
                                        <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                                            <td className="px-4 py-3 font-black text-emerald-400">{p.orderId}</td>
                                            <td className="px-4 py-3 text-[10px] text-slate-400">{format(p.date, 'dd/MM/yyyy HH:mm')}</td>
                                            <td className="px-4 py-3">
                                                <div>{p.customerName}</div>
                                                <div className="text-[9px] text-slate-500">{p.salespersonName}</div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <Badge variant="outline" className="border-slate-700 bg-slate-800 text-[9px] font-black uppercase text-slate-300">
                                                    {p.method}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3 text-right font-black text-white">
                                                ${p.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
