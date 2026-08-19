'use client';

import React, { useState, useMemo } from 'react';
import type { Order, FinancialSettings } from '@/lib/definitions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ResponsiveContainer, BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { format, subDays, startOfDay, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { 
    BarChart3, 
    TrendingUp, 
    DollarSign, 
    Receipt, 
    Truck, 
    AlertTriangle, 
    Table as TableIcon, 
    Layers,
    ArrowUpRight,
    PieChart,
    Calendar,
    Printer,
    Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Eye, ShoppingCart, CheckCircle2 } from 'lucide-react';
import { OrderSheetController } from '@/app/dashboard/orders/OrderSheetController';
import { captureSvgAsPng } from '@/lib/chart-pdf-exporter';
import { doc } from 'firebase/firestore';
import { useDoc, useFirestore, useMemoFirebase } from '@/firebase';

interface ExecutiveMetricsSuiteProps {
    orders: Order[] | null;
}

const convertToDate = (value: any): Date => {
    if (!value) return new Date(0);
    if (typeof value.toDate === 'function') {
        return value.toDate();
    }
    return new Date(value);
};

const getEffectiveCashReceived = (o: Order): number => {
    if (!o) return 0;
    if (typeof o.totalCashReceived === 'number' && o.totalCashReceived > 0) {
        return o.totalCashReceived;
    }
    if (typeof o.amountPaid === 'number' && o.amountPaid > 0) {
        return o.amountPaid;
    }
    const altPaid = (o as any).paidAmount || (o as any).totalPaid || (o as any).montoPagado;
    if (typeof altPaid === 'number' && altPaid > 0) {
        return altPaid;
    }
    if (o.status === 'Pagado' || (o as any).isPaid === true || (o as any).paymentStatus === 'Pagado') {
        return o.totalAmount || 0;
    }
    return 0;
};

const isCashOrder = (o: Order): boolean => {
    return getEffectiveCashReceived(o) > 0 || o.status === 'Pagado' || (o as any).isPaid === true || (o as any).paymentStatus === 'Pagado';
};

export function ExecutiveMetricsSuite({ orders }: ExecutiveMetricsSuiteProps) {
    const firestore = useFirestore();
    const settingsRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
    const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);
    const bcvRate = globalSettings?.bcvRate || 65.50;

    const [period, setPeriod] = useState<'today' | '7d' | '30d' | 'this_month' | 'last_month' | '6m'>('this_month');
    const [activeTab, setActiveTab] = useState<'comparative' | 'logistics' | 'matrix'>('comparative');
    const [isExportingPDF, setIsExportingPDF] = useState(false);

    // ESTADO MODAL INTERACTIVA DE DESGLOSE DE VENTAS (DRILL-DOWN)
    const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
    const [auditSearchTerm, setAuditSearchTerm] = useState('');
    const [selectedOrderForSheet, setSelectedOrderForSheet] = useState<Order | null>(null);
    const [selectedBarOrders, setSelectedBarOrders] = useState<Order[] | null>(null);
    const [customModalLabel, setCustomModalLabel] = useState<string>('');
    const [auditMode, setAuditMode] = useState<'ventas' | 'cobranzas' | 'despachos' | 'cancelaciones' | 'pendientes'>('ventas');
    const [paymentMethodFilter, setPaymentMethodFilter] = useState<'todos' | 'cash' | 'bcv' | 'zelle'>('todos');
    const [modalPeriod, setModalPeriod] = useState<'today' | '7d' | '30d' | 'this_month' | 'last_month' | '6m' | 'custom'>('this_month');

    const openAuditForType = (type: 'ventas' | 'cobranzas' | 'despachos' | 'cancelaciones' | 'pendientes', customOrders?: Order[], customLabel?: string, targetPeriod?: any) => {
        setAuditMode(type);
        setModalPeriod(targetPeriod || (customOrders ? 'custom' : period));
        setCustomModalLabel(customLabel || '');
        setSelectedBarOrders(customOrders || null);
        setIsAuditModalOpen(true);
    };

    const handleBarClick = (entry: any) => {
        if (!entry) return;
        const clickedLabel = entry.name || entry.payload?.name || 'Periodo Seleccionado';
        const dataKey = entry.dataKey || (entry.tooltipPayload && entry.tooltipPayload[0]?.dataKey) || 'ventas';
        const payload = entry.payload || entry;
        
        let type: 'ventas' | 'cobranzas' | 'despachos' | 'cancelaciones' = 'ventas';
        if (dataKey === 'cobranzas') type = 'cobranzas';
        else if (dataKey === 'despachos') type = 'despachos';
        else if (dataKey === 'cancelaciones') type = 'cancelaciones';
        else type = 'ventas';

        const customOrders = type === 'cobranzas' ? payload.cashOrders 
            : type === 'despachos' ? payload.dispatchedOrders
            : type === 'cancelaciones' ? payload.cancelledOrders
            : payload.salesOrders;

        openAuditForType(type, customOrders, `${clickedLabel} (${dataKey.toUpperCase()})`);
    };

    const filteredAuditOrders = useMemo(() => {
        if (!orders) return [];
        let baseList: Order[] = selectedBarOrders ? [...selectedBarOrders] : [];

        if (!selectedBarOrders) {
            const now = new Date();
            const VALID_SALES_STATUSES = ['Entregado', 'Completado', 'Despachado', 'Pagado', 'Aprobado', 'En Preparación'];

            baseList = orders.filter(o => {
                const oDate = convertToDate(o.receptionDate || o.approvalDate || o.createdAt || o.orderDate);
                
                if (modalPeriod === 'today') {
                    return isSameDay(oDate, now);
                } else if (modalPeriod === '7d') {
                    return oDate >= startOfDay(subDays(now, 6));
                } else if (modalPeriod === '30d') {
                    return oDate >= startOfDay(subDays(now, 29));
                } else if (modalPeriod === 'this_month') {
                    return oDate.getMonth() === now.getMonth() && oDate.getFullYear() === now.getFullYear();
                } else if (modalPeriod === 'last_month') {
                    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    return oDate.getMonth() === lastMonth.getMonth() && oDate.getFullYear() === lastMonth.getFullYear();
                } else if (modalPeriod === '6m') {
                    return oDate >= startOfDay(subDays(now, 180));
                }
                return true;
            });

            if (auditMode === 'ventas') {
                baseList = baseList.filter(o => VALID_SALES_STATUSES.includes(o.status));
            } else if (auditMode === 'cobranzas') {
                baseList = baseList.filter(o => isCashOrder(o));
            } else if (auditMode === 'despachos') {
                baseList = baseList.filter(o => ['Despachado', 'Entregado', 'Completado'].includes(o.status));
            } else if (auditMode === 'cancelaciones') {
                baseList = baseList.filter(o => ['Cancelado', 'Rechazado'].includes(o.status));
            } else if (auditMode === 'pendientes') {
                baseList = baseList.filter(o => (o.totalAmount || 0) - getEffectiveCashReceived(o) > 0.05 && o.status !== 'Cancelado' && o.status !== 'Borrador');
            }
        }

        if (paymentMethodFilter !== 'todos') {
            baseList = baseList.filter(o => {
                const method = (o as any).paymentMethod?.toLowerCase() || '';
                if (paymentMethodFilter === 'cash') return method.includes('efectivo') || method.includes('usd') || method.includes('cash');
                if (paymentMethodFilter === 'bcv') return method.includes('transferencia') || method.includes('bolivares') || method.includes('bcv') || method.includes('pago movil');
                if (paymentMethodFilter === 'zelle') return method.includes('zelle') || method.includes('paypal') || method.includes('binance');
                return true;
            });
        }

        return baseList;
    }, [modalPeriod, selectedBarOrders, orders, auditMode, paymentMethodFilter]);

    // Procesamiento y agrupación de datos
    const metricsData = useMemo(() => {
        if (!orders) return { chartPoints: [], matrixRows: [], totals: { sales: 0, cash: 0, pending: 0, dispatched: 0, cancelled: 0, totalOrders: 0, avgTicket: 0 } };

        const now = new Date();
        const VALID_SALES_STATUSES = ['Entregado', 'Completado', 'Despachado', 'Pagado', 'Aprobado', 'En Preparación'];

        let periodsList: { dateLabel: string; start: Date; end: Date; rawDate: Date }[] = [];

        if (period === 'today') {
            const base = startOfDay(now);
            const blocks = [
                { label: '00-06h', startH: 0, endH: 5 },
                { label: '06-12h', startH: 6, endH: 11 },
                { label: '12-18h', startH: 12, endH: 17 },
                { label: '18-24h', startH: 18, endH: 23 },
            ];
            periodsList = blocks.map(b => {
                const s = new Date(base);
                s.setHours(b.startH, 0, 0, 0);
                const e = new Date(base);
                e.setHours(b.endH, 59, 59, 999);
                return { dateLabel: b.label, start: s, end: e, rawDate: s };
            });
        } else if (period === '7d') {
            periodsList = Array.from({ length: 7 }, (_, i) => {
                const day = startOfDay(subDays(now, 6 - i));
                const end = new Date(day);
                end.setHours(23, 59, 59, 999);
                return {
                    dateLabel: format(day, 'dd/MM'),
                    start: day,
                    end: end,
                    rawDate: day
                };
            });
        } else if (period === 'this_month') {
            const year = now.getFullYear();
            const month = now.getMonth();
            const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
            const weekRanges = [
                { label: 'Sem 1 (1-7)', startDay: 1, endDay: 7 },
                { label: 'Sem 2 (8-14)', startDay: 8, endDay: 14 },
                { label: 'Sem 3 (15-21)', startDay: 15, endDay: 21 },
                { label: `Sem 4 (22-${lastDayOfMonth})`, startDay: 22, endDay: lastDayOfMonth },
            ];
            periodsList = weekRanges.map(w => ({
                dateLabel: w.label,
                start: new Date(year, month, w.startDay, 0, 0, 0),
                end: new Date(year, month, w.endDay, 23, 59, 59, 999),
                rawDate: new Date(year, month, w.startDay)
            }));
        } else if (period === 'last_month') {
            const lmDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const year = lmDate.getFullYear();
            const month = lmDate.getMonth();
            const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
            const weekRanges = [
                { label: 'Sem 1 (1-7)', startDay: 1, endDay: 7 },
                { label: 'Sem 2 (8-14)', startDay: 8, endDay: 14 },
                { label: 'Sem 3 (15-21)', startDay: 15, endDay: 21 },
                { label: `Sem 4 (22-${lastDayOfMonth})`, startDay: 22, endDay: lastDayOfMonth },
            ];
            periodsList = weekRanges.map(w => ({
                dateLabel: w.label,
                start: new Date(year, month, w.startDay, 0, 0, 0),
                end: new Date(year, month, w.endDay, 23, 59, 59, 999),
                rawDate: new Date(year, month, w.startDay)
            }));
        } else {
            // 6 Meses
            periodsList = Array.from({ length: 6 }, (_, i) => {
                const mDate = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
                const mEnd = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0, 23, 59, 59, 999);
                return {
                    dateLabel: format(mDate, 'MMM', { locale: es }).toUpperCase(),
                    start: mDate,
                    end: mEnd,
                    rawDate: mDate
                };
            });
        }

        let globalSales = 0;
        let globalCash = 0;
        let globalDispatched = 0;
        let globalCancelled = 0;
        let globalOrdersCount = 0;

        const chartPoints = periodsList.map(p => {
            const periodOrders = orders.filter(o => {
                const d = convertToDate(o.receptionDate || o.approvalDate || o.createdAt || o.orderDate);
                return d >= p.start && d <= p.end;
            });

            const salesOrders = periodOrders.filter(o => VALID_SALES_STATUSES.includes(o.status));
            const salesTotal = salesOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

            const cashOrders = periodOrders.filter(o => isCashOrder(o));
            const cashTotal = cashOrders.reduce((sum, o) => sum + getEffectiveCashReceived(o), 0);

            const dispatchedOrders = periodOrders.filter(o => ['Despachado', 'Entregado', 'Completado'].includes(o.status));
            const dispatchedCount = dispatchedOrders.length;

            const cancelledOrders = periodOrders.filter(o => ['Cancelado', 'Rechazado'].includes(o.status));
            const cancelledCount = cancelledOrders.length;

            const ordersCount = salesOrders.length;
            const avgTicket = ordersCount > 0 ? Math.round(salesTotal / ordersCount) : 0;
            const cancelRate = (dispatchedCount + cancelledCount) > 0 ? Math.round((cancelledCount / (dispatchedCount + cancelledCount)) * 100) : 0;

            globalSales += salesTotal;
            globalCash += cashTotal;
            globalDispatched += dispatchedCount;
            globalCancelled += cancelledCount;
            globalOrdersCount += ordersCount;

            return {
                name: p.dateLabel,
                ventas: salesTotal,
                cobranzas: cashTotal,
                despachos: dispatchedCount,
                cancelaciones: cancelledCount,
                pedidosTotales: ordersCount,
                ticketPromedio: avgTicket,
                tasaCancelacion: cancelRate,
                periodOrders: periodOrders,
                salesOrders: salesOrders,
                cashOrders: cashOrders,
                dispatchedOrders: dispatchedOrders,
                cancelledOrders: cancelledOrders
            };
        });

        const globalPending = Math.max(0, globalSales - globalCash);
        const globalAvgTicket = globalOrdersCount > 0 ? globalSales / globalOrdersCount : 0;

        return {
            chartPoints,
            matrixRows: [...chartPoints].reverse(),
            totals: {
                sales: globalSales,
                cash: globalCash,
                pending: globalPending,
                dispatched: globalDispatched,
                cancelled: globalCancelled,
                totalOrders: globalOrdersCount,
                avgTicket: globalAvgTicket
            }
        };
    }, [orders, period]);

    const efficiencyRate = useMemo(() => {
        if (metricsData.totals.sales <= 0) return 0;
        return Math.min(100, Math.round((metricsData.totals.cash / metricsData.totals.sales) * 100));
    }, [metricsData]);

    const dsoDays = useMemo(() => {
        if (!orders || orders.length === 0) return 12;
        const paidOrders = orders.filter(o => getEffectiveCashReceived(o) > 0);
        if (paidOrders.length === 0) return 14;
        const now = new Date();
        const totalDays = paidOrders.reduce((sum, o) => {
            const oDate = convertToDate(o.receptionDate || o.approvalDate || o.createdAt || o.orderDate);
            const diffTime = Math.abs(now.getTime() - oDate.getTime());
            const diffDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
            return sum + Math.min(diffDays, 45);
        }, 0);
        return Math.round(totalDays / paidOrders.length) || 12;
    }, [orders]);

    const moraStats = useMemo(() => {
        if (!orders || orders.length === 0) return { overduePercent: 0, count: 0 };
        const creditOrders = orders.filter(o => (o.totalAmount || 0) - getEffectiveCashReceived(o) > 0.05);
        if (creditOrders.length === 0) return { overduePercent: 0, count: 0 };
        const now = new Date();
        const overdue = creditOrders.filter(o => {
            const oDate = convertToDate(o.receptionDate || o.approvalDate || o.createdAt || o.orderDate);
            const diffDays = Math.ceil((now.getTime() - oDate.getTime()) / (1000 * 60 * 60 * 24));
            return diffDays > 15;
        });
        const overduePercent = Math.round((overdue.length / creditOrders.length) * 100);
        return { overduePercent, count: overdue.length };
    }, [orders]);

    const handleExportPDF = async () => {
        setIsExportingPDF(true);
        try {
            const jsPDF = (await import('jspdf')).default;
            const autoTable = (await import('jspdf-autotable')).default;

            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const activeTabLabel = activeTab === 'comparative' ? 'VENTAS VS COBRANZAS' : activeTab === 'logistics' ? 'DESPACHOS VS CANCELACIONES' : 'MATRIZ GLOBAL APP';
            const periodLabel = period === 'today' ? 'Hoy' : period === '7d' ? 'Últimos 7 Días' : period === 'this_month' ? 'Mes Actual' : period === 'last_month' ? 'Mes Anterior' : '6 Meses';

            // Header Corporativo Slate-900
            doc.setFillColor(15, 23, 42);
            doc.rect(0, 0, 210, 26, 'F');

            doc.setTextColor(255, 255, 255);
            doc.setFontSize(13);
            doc.setFont('helvetica', 'bold');
            doc.text('ATHLETICENTER - SUITE DE ANALÍTICA EJECUTIVA', 14, 11);

            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.text(`Vista: ${activeTabLabel} | Período: ${periodLabel.toUpperCase()} | Tasa BCV: Bs. ${bcvRate.toFixed(2)} / USD | Fecha: ${new Date().toLocaleDateString('es-VE')}`, 14, 19);

            // Resumen de Métricas
            doc.setFillColor(248, 250, 252);
            doc.roundedRect(14, 31, 182, 20, 3, 3, 'F');
            doc.setDrawColor(226, 232, 240);
            doc.roundedRect(14, 31, 182, 20, 3, 3, 'S');

            doc.setTextColor(15, 23, 42);
            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.text(`VENTAS ENTREGADAS: $${metricsData.totals.sales.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 18, 39);
            doc.text(`COBRANZA CASH REAL: $${metricsData.totals.cash.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 18, 46);

            doc.text(`POR COBRAR (CRÉDITO): $${metricsData.totals.pending.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 115, 39);
            doc.text(`EFECTIVIDAD DE COBRO: ${efficiencyRate}% COBRADO`, 115, 46);

            // Captura e Inserción de Imagen Visual del Gráfico
            const chartImage = await captureSvgAsPng('executive-metrics-suite-chart-container');
            let tableStartY = 56;

            if (chartImage) {
                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(71, 85, 105);
                doc.text('REPRESENTACIÓN GRÁFICA COMPARATIVA EN TIEMPO REAL:', 14, 57);

                doc.addImage(chartImage, 'PNG', 14, 60, 182, 60);
                tableStartY = 125;
            }

            const tableRows = metricsData.chartPoints.map((d: any) => {
                const diff = d.ventas - d.cobranzas;
                const bcvEquiv = d.cobranzas * bcvRate;
                return [
                    d.name,
                    `$${d.ventas.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                    `$${d.cobranzas.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                    `$${diff.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                    `Bs. ${bcvEquiv.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`
                ];
            });

            autoTable(doc, {
                startY: tableStartY,
                head: [['Período / Semana', 'Ventas ($ USD)', 'Cobranzas ($ USD)', 'Brecha ($ USD)', 'Equiv. BCV (Bs.)']],
                body: [
                    ...tableRows,
                    [
                        'TOTAL GENERAL', 
                        `$${metricsData.totals.sales.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                        `$${metricsData.totals.cash.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                        `$${metricsData.totals.pending.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                        `Bs. ${(metricsData.totals.cash * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`
                    ]
                ],
                headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold', halign: 'center' },
                bodyStyles: { fontSize: 8, halign: 'center' },
                footStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontSize: 9, fontStyle: 'bold', halign: 'center' },
                theme: 'grid'
            });

            doc.autoPrint();
            const pdfBlob = doc.output('bloburl');
            window.open(pdfBlob, '_blank');
        } catch (e) {
            console.error('Error generating Executive PDF:', e);
        } finally {
            setIsExportingPDF(false);
        }
    };

    return (
        <Card className="border-none shadow-2xl rounded-[2.5rem] bg-slate-900 text-white overflow-hidden animate-in fade-in duration-500">
            <CardHeader className="p-6 sm:p-8 pb-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/10">
                <div className="space-y-1">
                    <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-2">
                        <BarChart3 className="h-5 w-5 text-primary" /> Suite de Analítica Ejecutiva & Matriz Comparativa
                    </CardTitle>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Monitoreo en paralelo: Ventas Comercial, Cobranzas Cash, Despachos Operativos y Cancelaciones
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {/* Selectores de Pestaña Sub-View */}
                    <div className="flex bg-white/5 border border-white/10 p-1 rounded-xl gap-1">
                        {[
                            { id: 'comparative', label: 'Ventas vs Cobranzas', icon: DollarSign },
                            { id: 'logistics', label: 'Despachos vs Cancelaciones', icon: Truck },
                            { id: 'matrix', label: 'Matriz Global App', icon: TableIcon },
                        ].map(t => (
                            <button
                                key={t.id}
                                type="button"
                                onClick={() => setActiveTab(t.id as any)}
                                className={cn(
                                    "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5",
                                    activeTab === t.id 
                                        ? "bg-primary text-white shadow-md shadow-primary/20" 
                                        : "text-slate-400 hover:text-white hover:bg-white/5"
                                )}
                            >
                                <t.icon className="h-3 w-3" />
                                <span>{t.label}</span>
                            </button>
                        ))}
                    </div>

                    {/* Selector de Períodos de Análisis Explícitos */}
                    <div className="flex flex-wrap items-center bg-white/5 border border-white/10 p-1 rounded-xl gap-1">
                        {[
                            { id: 'today', label: '☀️ Hoy' },
                            { id: '7d', label: '⚡ 7 Días' },
                            { id: 'this_month', label: '🗓️ Mes Actual' },
                            { id: 'last_month', label: '📅 Mes Anterior' },
                            { id: '6m', label: '🌐 6 Meses' },
                        ].map(p => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => setPeriod(p.id as any)}
                                className={cn(
                                    "px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer",
                                    period === p.id ? "bg-white text-slate-900 font-black shadow-sm" : "text-slate-400 hover:text-white hover:bg-white/5"
                                )}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>

                    {/* BOTÓN DE IMPRESIÓN DE GRÁFICO VISUAL EN PDF */}
                    <Button
                        onClick={handleExportPDF}
                        disabled={isExportingPDF}
                        variant="outline"
                        className="h-8 px-3 rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/20 font-black text-[9px] uppercase tracking-wider flex items-center gap-1.5 shadow-sm"
                        title="Imprimir Gráfico Visual y Reporte PDF"
                    >
                        {isExportingPDF ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5 text-primary" />}
                        <span>🖨️ Imprimir Gráfico</span>
                    </Button>
                </div>
            </CardHeader>

            <CardContent className="p-6 sm:p-8 space-y-6">
                {/* BANNER KPI DE RESUMEN GLOBAL INTERACTIVO (1-CLIC) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-white/5 p-4 rounded-2xl border border-white/5">
                    <div 
                        onClick={() => openAuditForType('ventas')}
                        className="space-y-0.5 cursor-pointer hover:bg-white/10 p-2 rounded-xl transition-all group"
                    >
                        <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 block group-hover:text-primary transition-colors">Ventas Entregadas (Clic Auditar)</span>
                        <div className="flex items-baseline justify-between gap-1">
                            <p className="text-lg sm:text-xl font-black text-white tracking-tighter">${metricsData.totals.sales.toLocaleString()}</p>
                            <Badge variant="outline" className="text-[7px] font-black border-slate-700 text-slate-300 px-1 py-0 font-mono">
                                Tick: ${Math.round(metricsData.totals.avgTicket || 0)}
                            </Badge>
                        </div>
                    </div>
                    <div 
                        onClick={() => openAuditForType('cobranzas')}
                        className="space-y-0.5 cursor-pointer hover:bg-white/10 p-2 rounded-xl transition-all group"
                    >
                        <span className="text-[8px] font-black uppercase tracking-widest text-emerald-400 block group-hover:text-emerald-300 transition-colors">Cobranzas Cash (Clic Auditar)</span>
                        <div className="flex items-baseline justify-between gap-1">
                            <p className="text-lg sm:text-xl font-black text-emerald-400 tracking-tighter">${metricsData.totals.cash.toLocaleString()}</p>
                            <Badge variant="outline" className="text-[7px] font-black border-emerald-500/30 text-emerald-400 px-1 py-0 font-mono">
                                DSO: {dsoDays}d
                            </Badge>
                        </div>
                    </div>
                    <div 
                        onClick={() => openAuditForType('pendientes')}
                        className="space-y-0.5 cursor-pointer hover:bg-white/10 p-2 rounded-xl transition-all group"
                    >
                        <span className="text-[8px] font-black uppercase tracking-widest text-amber-400 block group-hover:text-amber-300 transition-colors">Por Cobrar (Crédito)</span>
                        <div className="flex items-baseline justify-between gap-1">
                            <p className="text-lg sm:text-xl font-black text-amber-400 tracking-tighter">${metricsData.totals.pending.toLocaleString()}</p>
                            <Badge variant="outline" className={cn(
                                "text-[7px] font-black px-1 py-0 font-mono",
                                moraStats.overduePercent > 20 ? "border-rose-500/40 text-rose-400 bg-rose-500/10" : "border-amber-500/30 text-amber-400"
                            )}>
                                Mora: {moraStats.overduePercent}%
                            </Badge>
                        </div>
                    </div>
                    <div className="space-y-0.5 p-2">
                        <span className="text-[8px] font-black uppercase tracking-widest text-sky-400 block">Efectividad Cobro</span>
                        <div className="flex items-baseline justify-between gap-1">
                            <p className="text-lg sm:text-xl font-black text-sky-400 tracking-tighter">{efficiencyRate}%</p>
                            <Badge variant="outline" className="text-[7px] font-black border-sky-500/30 text-sky-400 px-1 py-0 font-mono">
                                {efficiencyRate >= 80 ? '🟢 Óptimo' : efficiencyRate >= 50 ? '🟡 Regular' : '🔴 Bajo'}
                            </Badge>
                        </div>
                    </div>
                </div>

                {/* VISTA 1: COBRANZAS VS VENTAS (GRÁFICO ÁREA/BARRAS) */}
                {activeTab === 'comparative' && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300 flex items-center gap-2">
                                <TrendingUp className="h-3.5 w-3.5 text-primary" /> Curva Comparativa: Ventas Comerciales ($) vs. Cobranzas Cash ($)
                            </h3>
                        </div>
                        <div id="executive-metrics-suite-chart-container" className="h-[280px] w-full pt-4">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={metricsData.chartPoints} maxBarSize={50} barCategoryGap="25%" margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 900, fill: '#94a3b8' }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 900, fill: '#94a3b8' }} tickFormatter={(v) => `$${v}`} />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#0f172a', borderRadius: '1rem', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '11px', fontWeight: 900 }} 
                                        formatter={(val: any, name: any) => [`$${Number(val).toLocaleString()}`, name === 'ventas' ? 'Ventas Comercial' : 'Cobranzas Cash']}
                                    />
                                    <Legend wrapperStyle={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', paddingTop: '10px' }} />
                                    <Bar dataKey="ventas" name="ventas" fill="#3b82f6" radius={[6, 6, 0, 0]} maxBarSize={50} onClick={handleBarClick} className="cursor-pointer hover:opacity-80 transition-opacity" />
                                    <Bar dataKey="cobranzas" name="cobranzas" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={50} onClick={handleBarClick} className="cursor-pointer hover:opacity-80 transition-opacity" />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}

                {/* VISTA 2: DESPACHOS VS CANCELACIONES (GRÁFICO LOGÍSTICO) */}
                {activeTab === 'logistics' && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300 flex items-center gap-2">
                                <Truck className="h-3.5 w-3.5 text-sky-400" /> Rendimiento Logístico: Pedidos Despachados vs. Cancelaciones
                            </h3>
                        </div>
                        <div id="executive-metrics-suite-chart-container" className="h-[280px] w-full pt-4">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={metricsData.chartPoints} maxBarSize={50} barCategoryGap="25%" margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 900, fill: '#94a3b8' }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 900, fill: '#94a3b8' }} />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#0f172a', borderRadius: '1rem', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '11px', fontWeight: 900 }}
                                        formatter={(val: any, name: any) => [`${val} Unid.`, name === 'despachos' ? 'Despachados / Entregados' : 'Cancelaciones']}
                                    />
                                    <Legend wrapperStyle={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', paddingTop: '10px' }} />
                                    <Bar dataKey="despachos" name="despachos" fill="#38bdf8" radius={[6, 6, 0, 0]} maxBarSize={50} onClick={handleBarClick} className="cursor-pointer hover:opacity-80 transition-opacity" />
                                    <Bar dataKey="cancelaciones" name="cancelaciones" fill="#f43f5e" radius={[6, 6, 0, 0]} maxBarSize={50} onClick={handleBarClick} className="cursor-pointer hover:opacity-80 transition-opacity" />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}

                {/* VISTA 3: MATRIZ GLOBAL APP (TABLA RESUMEN GENERAL) */}
                {activeTab === 'matrix' && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300 flex items-center gap-2">
                                <TableIcon className="h-3.5 w-3.5 text-emerald-400" /> Matriz Consolidada por Sub-Periodos Auditados
                            </h3>
                        </div>
                        <div className="overflow-x-auto border border-white/10 rounded-2xl">
                            <table className="w-full text-left text-xs font-medium text-slate-300 border-collapse">
                                <thead className="bg-white/5 text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-white/10">
                                    <tr>
                                        <th className="p-3.5 pl-6">Sub-Periodo</th>
                                        <th className="p-3.5 text-right">Ventas ($ USD)</th>
                                        <th className="p-3.5 text-right text-emerald-400">Cobranza ($ USD)</th>
                                        <th className="p-3.5 text-right text-amber-400">Brecha / Deuda ($)</th>
                                        <th className="p-3.5 text-center">Despachos</th>
                                        <th className="p-3.5 text-center text-rose-400">Cancelaciones</th>
                                        <th className="p-3.5 pr-6 text-right">Acción</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5 font-mono text-[11px]">
                                    {metricsData.matrixRows.map((row, idx) => (
                                        <tr key={idx} className="hover:bg-white/5 transition-colors">
                                            <td className="p-3.5 pl-6 font-sans font-bold text-white uppercase">{row.name}</td>
                                            <td className="p-3.5 text-right font-black text-white">${row.ventas.toLocaleString()}</td>
                                            <td className="p-3.5 text-right font-black text-emerald-400">${row.cobranzas.toLocaleString()}</td>
                                            <td className="p-3.5 text-right font-black text-amber-400">${(row.ventas - row.cobranzas).toLocaleString()}</td>
                                            <td className="p-3.5 text-center font-bold text-sky-300">{row.despachos} unid.</td>
                                            <td className="p-3.5 text-center font-bold text-rose-400">{row.cancelaciones} unid.</td>
                                            <td className="p-3.5 pr-6 text-right">
                                                <Button 
                                                    size="sm" 
                                                    variant="ghost" 
                                                    onClick={() => openAuditForType('ventas', row.periodOrders, `Detalle ${row.name}`)}
                                                    className="h-7 px-2.5 rounded-lg text-[9px] font-black uppercase text-primary hover:bg-primary/20"
                                                >
                                                    <Eye className="h-3 w-3 mr-1" /> Auditar
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </CardContent>

            {/* MODAL INTERACTIVA DE AUDITORÍA DRILL-DOWN */}
            <Dialog open={isAuditModalOpen} onOpenChange={setIsAuditModalOpen}>
                <DialogContent className="sm:max-w-4xl rounded-[2.5rem] border-none shadow-2xl overflow-hidden p-8 bg-white text-slate-900">
                    <DialogHeader className="space-y-2 border-b pb-4">
                        <div className="flex items-center justify-between">
                            <Badge className="bg-primary text-white font-black text-[9px] uppercase tracking-widest px-3 py-1">
                                Auditoría Táctica Genkit
                            </Badge>
                            <Badge variant="outline" className="border-slate-300 text-slate-700 font-mono text-[9px] uppercase px-3">
                                {filteredAuditOrders.length} Expedientes
                            </Badge>
                        </div>
                        <DialogTitle className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
                            <ShoppingCart className="h-6 w-6 text-primary" /> 
                            {customModalLabel ? customModalLabel : `Desglose de Expedientes: ${auditMode.toUpperCase()}`}
                        </DialogTitle>
                        <DialogDescription className="text-slate-500 text-xs">
                            Listado completo de facturas y pedidos auditados con conversión oficial a Bs. BCV.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col sm:flex-row items-center gap-3 my-2">
                        <div className="relative flex-1 w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                            <Input
                                placeholder="BUSCAR CLIENTE, VENDEDOR O ID..."
                                value={auditSearchTerm}
                                onChange={(e) => setAuditSearchTerm(e.target.value)}
                                className="pl-9 h-10 text-[10px] font-bold uppercase bg-slate-50 border-none rounded-xl"
                            />
                        </div>
                        <div className="flex bg-slate-100 p-1 rounded-xl gap-1 w-full sm:w-auto overflow-x-auto">
                            {[
                                { id: 'todos', label: 'Todos' },
                                { id: 'cash', label: '💵 Divisas/Cash' },
                                { id: 'bcv', label: '🇻🇪 Bolívares BCV' },
                                { id: 'zelle', label: '⚡ Zelle/USDT' },
                            ].map(f => (
                                <button
                                    key={f.id}
                                    type="button"
                                    onClick={() => setPaymentMethodFilter(f.id as any)}
                                    className={cn(
                                        "px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all whitespace-nowrap",
                                        paymentMethodFilter === f.id ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:text-slate-900"
                                    )}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="max-h-[360px] overflow-y-auto custom-scrollbar border border-slate-100 rounded-2xl">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest sticky top-0 z-10">
                                <tr>
                                    <th className="p-3 pl-6">Cliente / Pedido</th>
                                    <th className="p-3">Vendedor</th>
                                    <th className="p-3 text-center">Estado</th>
                                    <th className="p-3 text-right">Monto ($ USD)</th>
                                    <th className="p-3 text-right">Monto (Bs. BCV)</th>
                                    <th className="p-3 pr-6 text-right">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-800">
                                {filteredAuditOrders
                                    .filter(o => {
                                        const term = auditSearchTerm.toLowerCase().trim();
                                        if (!term) return true;
                                        return (
                                            (o.customerName || '').toLowerCase().includes(term) ||
                                            (o.salespersonName || '').toLowerCase().includes(term) ||
                                            (o.id || '').toLowerCase().includes(term)
                                        );
                                    })
                                    .map((o, idx) => (
                                        <tr key={o.id || idx} className="hover:bg-slate-50 transition-colors">
                                            <td className="p-3 pl-6">
                                                <p className="font-black text-slate-900 uppercase leading-tight">{o.customerName || 'Cliente General'}</p>
                                                <p className="text-[8px] font-mono text-slate-400">ID: {o.id?.slice(0, 8)}</p>
                                            </td>
                                            <td className="p-3 text-slate-600 font-medium text-[10px]">{o.salespersonName || 'Directo'}</td>
                                            <td className="p-3 text-center">
                                                <Badge variant="outline" className="text-[8px] font-black uppercase border-slate-200 text-slate-700 px-2 py-0.5">
                                                    {o.status}
                                                </Badge>
                                            </td>
                                            <td className="p-3 text-right font-mono font-black text-emerald-700">${(o.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                            <td className="p-3 text-right font-mono font-black text-slate-600">Bs. {((o.totalAmount || 0) * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
                                            <td className="p-3 pr-6 text-right">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => setSelectedOrderForSheet(o)}
                                                    className="h-8 px-3 rounded-xl text-[8px] font-black uppercase text-primary hover:bg-primary/10"
                                                >
                                                    <Eye className="h-3 w-3 mr-1" /> Detalle
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                    </div>
                </DialogContent>
            </Dialog>

            {/* CONTROLES SHEET DETALLE */}
            {selectedOrderForSheet && (
                <OrderSheetController 
                    order={selectedOrderForSheet} 
                    onOpenChange={(open) => !open && setSelectedOrderForSheet(null)} 
                />
            )}
        </Card>
    );
}
