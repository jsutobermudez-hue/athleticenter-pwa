'use client';

import React, { useMemo, useState, useEffect } from 'react';
import type { Order } from '@/lib/definitions';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getCashBreakdown, type PaymentItem } from '@/lib/billing';
import { 
    Banknote, 
    Printer, 
    DollarSign, 
    CheckCircle2, 
    Search,
    Calendar,
    Filter,
    FilterX,
    Eye,
    ExternalLink,
    UserCheck,
    FileText,
    ShieldCheck,
    Building,
    Hash
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';

interface CashAuditModalProps {
    isOpen: boolean;
    onClose: () => void;
    orders: Order[] | null;
    periodFilter?: 'today' | '7d' | 'this_month' | 'last_month' | 'custom' | 'all';
    bcvRate?: number;
    onSelectOrder?: (order: Order) => void;
}

export function CashAuditModal({ isOpen, onClose, orders, periodFilter = 'all', bcvRate = 65.50, onSelectOrder }: CashAuditModalProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [activePeriod, setActivePeriod] = useState<'today' | '7d' | 'this_month' | 'last_month' | 'custom' | 'all'>(periodFilter);
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [methodFilter, setMethodFilter] = useState<string>('todos');
    const [salespersonFilter, setSalespersonFilter] = useState<string>('todos');

    // Estado para el modal de detalle del pago seleccionado
    const [selectedPaymentForDetail, setSelectedPaymentForDetail] = useState<PaymentItem | null>(null);

    useEffect(() => {
        setActivePeriod(periodFilter);
    }, [periodFilter, isOpen]);

    // Lista de vendedores únicos
    const uniqueSalespeople = useMemo(() => {
        if (!orders) return [];
        return Array.from(new Set(orders.map(o => o.salespersonName))).filter((sp): sp is string => Boolean(sp)).sort();
    }, [orders]);

    const breakdown = useMemo(() => {
        return getCashBreakdown(orders, activePeriod, startDate, endDate);
    }, [orders, activePeriod, startDate, endDate]);

    const filteredPayments = useMemo(() => {
        let result = breakdown.payments;

        if (methodFilter !== 'todos') {
            result = result.filter(p => {
                const norm = p.method.toLowerCase();
                if (methodFilter === 'cash') return norm.includes('efectivo') || norm.includes('cash') || norm.includes('divisas');
                if (methodFilter === 'zelle') return norm.includes('zelle');
                if (methodFilter === 'bcv') return norm.includes('bcv') || norm.includes('pago móvil') || norm.includes('pago movil') || norm.includes('transferencia ves') || norm.includes('bolivar');
                if (methodFilter === 'custodia') return norm.includes('custodia') || norm.includes('panamá') || norm.includes('panama');
                return true;
            });
        }

        if (salespersonFilter !== 'todos') {
            result = result.filter(p => p.salespersonName === salespersonFilter);
        }

        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase().trim();
            result = result.filter(p => 
                p.customerName.toLowerCase().includes(term) ||
                p.orderId.toLowerCase().includes(term) ||
                (p.salespersonName || '').toLowerCase().includes(term) ||
                p.method.toLowerCase().includes(term) ||
                (p.reference || '').toLowerCase().includes(term)
            );
        }

        return result;
    }, [breakdown.payments, methodFilter, salespersonFilter, searchTerm]);

    const periodTitle = useMemo(() => {
        if (activePeriod === 'today') return 'Pagos Registrados del Día (HOY)';
        if (activePeriod === '7d') return 'Pagos Registrados (Últimos 7 Días)';
        if (activePeriod === 'this_month') return 'Pagos Registrados del Mes Actual';
        if (activePeriod === 'last_month') return 'Pagos Registrados del Mes Anterior';
        if (activePeriod === 'custom') {
            if (startDate && endDate) return `Pagos Registrados del ${startDate} al ${endDate}`;
            if (startDate) return `Pagos Registrados desde ${startDate}`;
            if (endDate) return `Pagos Registrados hasta ${endDate}`;
            return 'Pagos Registrados por Rango Personalizado';
        }
        return 'Pagos Registrados (Histórico)';
    }, [activePeriod, startDate, endDate]);

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
            doc.text(`INFORME OFICIAL DE PAGOS REGISTRADOS Y CIERRE DE CAJA - ${periodTitle.toUpperCase()}`, 14, 23);
            doc.text(`TASA OFICIAL BCV: Bs. ${bcvRate.toFixed(2)} / USD | FECHA EMISIÓN: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 28);

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
                p.registeredBy || p.salespersonName || 'Directo',
                p.method,
                `$${p.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                `Bs. ${(p.amount * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`
            ]);

            autoTable(doc, {
                startY: 60,
                head: [['ORDEN #', 'FECHA / HORA PAGO', 'CLIENTE / RAZÓN SOCIAL', 'REGISTRADO POR', 'MÉTODO DE PAGO', 'MONTO ($ USD)', 'MONTO (Bs. BCV)']],
                body: tableRows,
                styles: { fontSize: 7.5, cellPadding: 2, font: 'helvetica' },
                headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [248, 250, 252] }
            });

            doc.autoPrint();
            window.open(doc.output('bloburl'), '_blank');
        } catch (e) {
            console.error('Error generando PDF de pagos registrados:', e);
        }
    };

    return (
        <>
            <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
                <DialogContent className="max-w-5xl bg-slate-950 text-white border-slate-800 p-0 overflow-hidden rounded-[2.5rem] shadow-2xl">
                    <DialogHeader className="p-6 pb-4 bg-slate-900/80 border-b border-slate-800/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-2">
                                <Badge className="bg-emerald-500/20 text-emerald-400 border-none font-black text-[9px] uppercase px-2.5 py-0.5">
                                    Auditoría & Registro de Pagos
                                </Badge>
                                <span className="text-[10px] font-bold text-slate-400">BCV: Bs. {bcvRate.toFixed(2)}</span>
                            </div>
                            <DialogTitle className="text-xl font-black text-white uppercase tracking-tight mt-1 flex items-center gap-2">
                                <Banknote className="h-5 w-5 text-emerald-400" />
                                {periodTitle}
                            </DialogTitle>
                            <DialogDescription className="text-xs text-slate-400 font-bold">
                                Haz clic sobre cualquier pago para ver la foto del comprobante, quién lo registró y el detalle completo.
                            </DialogDescription>
                        </div>
                        <Button onClick={handlePrintPDF} className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[9px] uppercase tracking-wider shadow-lg flex items-center gap-1.5 shrink-0">
                            <Printer className="h-4 w-4" /> Imprimir Reporte PDF
                        </Button>
                    </DialogHeader>

                    <div className="p-6 space-y-5 max-h-[78vh] overflow-y-auto">
                        {/* BARRA DE FILTROS AVANZADOS Y RANGO DE FECHAS */}
                        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 mr-1">Período:</span>
                                {[
                                    { id: 'all', label: '🌐 Todo el Histórico' },
                                    { id: 'today', label: '☀️ Hoy' },
                                    { id: '7d', label: '⚡ 7 Días' },
                                    { id: 'this_month', label: '🗓️ Mes Actual' },
                                    { id: 'last_month', label: '📅 Mes Anterior' },
                                    { id: 'custom', label: '📆 Rango Personalizado' },
                                ].map(p => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => setActivePeriod(p.id as any)}
                                        className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all border ${
                                            activePeriod === p.id 
                                                ? "bg-emerald-600 text-white border-emerald-500 font-black shadow-md" 
                                                : "bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-white"
                                        }`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-800/80">
                                {/* RANGO DESDE / HASTA */}
                                <div className="space-y-1">
                                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Fecha Desde</label>
                                    <input
                                        type="date"
                                        value={startDate}
                                        onChange={(e) => { setStartDate(e.target.value); setActivePeriod('custom'); }}
                                        className="w-full h-9 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-bold text-white focus:outline-none focus:border-emerald-500"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Fecha Hasta</label>
                                    <input
                                        type="date"
                                        value={endDate}
                                        onChange={(e) => { setEndDate(e.target.value); setActivePeriod('custom'); }}
                                        className="w-full h-9 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-bold text-white focus:outline-none focus:border-emerald-500"
                                    />
                                </div>

                                {/* MÉTODO DE PAGO */}
                                <div className="space-y-1">
                                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Vía de Pago</label>
                                    <select
                                        value={methodFilter}
                                        onChange={(e) => setMethodFilter(e.target.value)}
                                        className="w-full h-9 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-bold text-white focus:outline-none focus:border-emerald-500"
                                    >
                                        <option value="todos">Todas las Vías de Pago</option>
                                        <option value="cash">💵 Efectivo USD</option>
                                        <option value="zelle">⚡ Zelle USD</option>
                                        <option value="bcv">🇻🇪 Bolívares BCV / Pago Móvil</option>
                                        <option value="custodia">🏦 Custodia / Panamá</option>
                                    </select>
                                </div>

                                {/* VENDEDOR */}
                                <div className="space-y-1">
                                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">Vendedor / Registrado por</label>
                                    <select
                                        value={salespersonFilter}
                                        onChange={(e) => setSalespersonFilter(e.target.value)}
                                        className="w-full h-9 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-bold text-white focus:outline-none focus:border-emerald-500"
                                    >
                                        <option value="todos">Todos los Vendedores</option>
                                        {uniqueSalespeople.map(sp => (
                                            <option key={sp} value={sp}>{sp}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* RESUMEN DE MÉTODOS DE PAGO */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/20 space-y-1">
                                <p className="text-[9px] font-black uppercase text-emerald-400 tracking-wider">Total Recaudado</p>
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
                                placeholder="BUSCAR PAGO POR CLIENTE, ORDEN, REFERENCIA O VENDEDOR..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full h-10 pl-10 pr-4 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                            />
                        </div>

                        {/* TABLA DE TRANSACCIONES DE COBRO CON ACCIÓN DE CLIC PARA DETALLE */}
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-slate-900 text-slate-400 text-[9px] font-black uppercase tracking-wider border-b border-slate-800">
                                    <tr>
                                        <th className="px-4 py-3">Orden #</th>
                                        <th className="px-4 py-3">Fecha / Hora</th>
                                        <th className="px-4 py-3">Cliente</th>
                                        <th className="px-4 py-3">Registrado Por</th>
                                        <th className="px-4 py-3">Método</th>
                                        <th className="px-4 py-3 text-right">Monto ($)</th>
                                        <th className="px-4 py-3 text-center">Acción</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/60 font-bold text-slate-200">
                                    {filteredPayments.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-xs">
                                                No se encontraron pagos registrados con los filtros seleccionados.
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredPayments.map((p, idx) => (
                                            <tr 
                                                key={idx} 
                                                onClick={() => setSelectedPaymentForDetail(p)}
                                                className="hover:bg-emerald-500/10 cursor-pointer transition-colors group"
                                            >
                                                <td className="px-4 py-3 font-black text-emerald-400 group-hover:underline flex items-center gap-1.5">
                                                    <Hash className="h-3 w-3 text-emerald-500" />
                                                    {p.orderId}
                                                </td>
                                                <td className="px-4 py-3 text-[10px] text-slate-400">{format(p.date, 'dd/MM/yyyy HH:mm')}</td>
                                                <td className="px-4 py-3">
                                                    <div>{p.customerName}</div>
                                                    {p.customerRif && <div className="text-[9px] font-mono text-slate-500">{p.customerRif}</div>}
                                                </td>
                                                <td className="px-4 py-3 text-[10px] text-slate-300">
                                                    <div className="flex items-center gap-1">
                                                        <UserCheck className="h-3 w-3 text-blue-400" />
                                                        <span>{p.registeredBy || p.salespersonName}</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <Badge variant="outline" className="border-slate-700 bg-slate-800 text-[9px] font-black uppercase text-slate-300">
                                                        {p.method}
                                                    </Badge>
                                                    {p.reference && (
                                                        <span className="block text-[8px] font-mono text-slate-500">Ref: {p.reference}</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-right font-black text-white">
                                                    ${p.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <Button variant="ghost" size="sm" className="h-7 px-2.5 rounded-lg bg-slate-800 hover:bg-emerald-600 hover:text-white text-slate-300 text-[9px] font-black uppercase tracking-wider flex items-center gap-1 mx-auto">
                                                        <Eye className="h-3 w-3" /> Detalle
                                                    </Button>
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

            {/* MODAL SECUNDARIO: DETALLE DEL PAGO SELECCIONADO Y FOTO DEL COMPROBANTE */}
            {selectedPaymentForDetail && (
                <Dialog open={!!selectedPaymentForDetail} onOpenChange={(open) => !open && setSelectedPaymentForDetail(null)}>
                    <DialogContent className="max-w-xl bg-slate-950 text-white border-slate-800 p-0 overflow-hidden rounded-[2.5rem] shadow-2xl">
                        <DialogHeader className="p-6 pb-4 bg-slate-900 border-b border-slate-800 flex flex-row items-center justify-between">
                            <div>
                                <Badge className="bg-emerald-500/20 text-emerald-400 border-none font-black text-[9px] uppercase px-2.5 py-0.5">
                                    Detalle del Pago Registrado
                                </Badge>
                                <DialogTitle className="text-xl font-black text-white uppercase tracking-tight mt-1 flex items-center gap-2">
                                    Orden {selectedPaymentForDetail.orderId}
                                </DialogTitle>
                                <DialogDescription className="text-xs text-slate-400 font-bold">
                                    Registrado el {format(selectedPaymentForDetail.date, 'dd/MM/yyyy HH:mm:ss')}
                                </DialogDescription>
                            </div>
                            <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-black text-[10px] uppercase px-3 py-1">
                                Verificado en Caja
                            </Badge>
                        </DialogHeader>

                        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
                            {/* COMPROBANTE DE PAGO / FOTO VOUCHER */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center justify-between">
                                    <span>📸 Comprobante Digital de Pago</span>
                                    {selectedPaymentForDetail.receiptUrl && (
                                        <a 
                                            href={selectedPaymentForDetail.receiptUrl} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="text-emerald-400 hover:underline flex items-center gap-1 text-[9px] font-bold"
                                        >
                                            <ExternalLink className="h-3 w-3" /> Ver Imagen Completa
                                        </a>
                                    )}
                                </label>
                                
                                {selectedPaymentForDetail.receiptUrl ? (
                                    <div className="relative rounded-2xl overflow-hidden border border-slate-800 bg-black max-h-64 flex items-center justify-center">
                                        <img 
                                            src={selectedPaymentForDetail.receiptUrl} 
                                            alt="Comprobante de pago" 
                                            className="object-contain max-h-64 w-full rounded-2xl"
                                        />
                                    </div>
                                ) : (
                                    <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-2">
                                        <ShieldCheck className="h-8 w-8 text-emerald-400 mx-auto opacity-80" />
                                        <p className="text-xs font-black uppercase text-slate-300">Pago Recibido Directamente en Caja</p>
                                        <p className="text-[10px] text-slate-400 font-bold">Sin adjunto de comprobante digital. Registrado y respaldado en sistema interno.</p>
                                    </div>
                                )}
                            </div>

                            {/* TARJETAS DE DATOS FINANCIEROS Y AUDITORÍA */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 space-y-1">
                                    <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Monto Ingresado ($)</p>
                                    <p className="text-xl font-black text-emerald-400">
                                        ${selectedPaymentForDetail.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </p>
                                    <p className="text-[8px] text-slate-400 font-bold">Bs. {(selectedPaymentForDetail.amount * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</p>
                                </div>

                                <div className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 space-y-1">
                                    <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Vía de Pago</p>
                                    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-black text-[10px] uppercase">
                                        {selectedPaymentForDetail.method}
                                    </Badge>
                                    {selectedPaymentForDetail.reference && (
                                        <p className="text-[9px] font-mono text-slate-300">Ref: {selectedPaymentForDetail.reference}</p>
                                    )}
                                </div>
                            </div>

                            {/* INFORMACIÓN DE QUIÉN REGISTRÓ Y DATOS DE CLIENTE */}
                            <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3 text-xs">
                                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                                    <span className="text-[9px] font-black uppercase text-slate-400 flex items-center gap-1.5">
                                        <UserCheck className="h-3.5 w-3.5 text-blue-400" /> Registrado Por:
                                    </span>
                                    <span className="font-black text-white">{selectedPaymentForDetail.registeredBy || selectedPaymentForDetail.salespersonName || 'Sistema / Caja'}</span>
                                </div>

                                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                                    <span className="text-[9px] font-black uppercase text-slate-400 flex items-center gap-1.5">
                                        <Building className="h-3.5 w-3.5 text-emerald-400" /> Cliente / Razón Social:
                                    </span>
                                    <div className="text-right">
                                        <div className="font-bold text-white">{selectedPaymentForDetail.customerName}</div>
                                        {selectedPaymentForDetail.customerRif && <div className="text-[9px] font-mono text-slate-400">{selectedPaymentForDetail.customerRif}</div>}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between">
                                    <span className="text-[9px] font-black uppercase text-slate-400 flex items-center gap-1.5">
                                        <FileText className="h-3.5 w-3.5 text-purple-400" /> Estado de la Orden:
                                    </span>
                                    <Badge variant="outline" className="border-slate-700 bg-slate-800 text-slate-300 font-bold text-[9px] uppercase">
                                        {selectedPaymentForDetail.orderStatus || 'En Proceso'}
                                    </Badge>
                                </div>
                            </div>

                            {/* BOTÓN PARA ABRIR EL EXPEDIENTE COMPLETO */}
                            {selectedPaymentForDetail.rawOrder && onSelectOrder && (
                                <Button 
                                    onClick={() => {
                                        const raw = selectedPaymentForDetail.rawOrder;
                                        setSelectedPaymentForDetail(null);
                                        onSelectOrder(raw!);
                                    }}
                                    className="w-full h-11 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-black text-[10px] uppercase tracking-wider flex items-center justify-center gap-2"
                                >
                                    <FileText className="h-4 w-4 text-emerald-400" /> Abrir Expediente Completo de la Orden
                                </Button>
                            )}
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}
