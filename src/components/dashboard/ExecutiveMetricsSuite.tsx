'use client';

import React, { useState, useMemo } from 'react';
import type { Order } from '@/lib/definitions';
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
    Calendar
} from 'lucide-react';
import { cn } from '@/lib/utils';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Eye, ShoppingCart, CheckCircle2 } from 'lucide-react';
import { OrderSheetController } from '@/app/dashboard/orders/OrderSheetController';

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
    const [period, setPeriod] = useState<'today' | '7d' | '30d' | 'this_month' | 'last_month' | '6m'>('this_month');
    const [activeTab, setActiveTab] = useState<'comparative' | 'logistics' | 'matrix'>('comparative');

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
            : payload.salesOrders || payload.periodOrders;

        openAuditForType(type, customOrders, `${type === 'cobranzas' ? '🟢 Cobranzas Cash' : type === 'despachos' ? '🚚 Despachados' : type === 'cancelaciones' ? '🚨 Cancelados' : '🔵 Ventas'}: ${clickedLabel}`, 'custom');
    };

    const modalFilteredOrders = useMemo(() => {
        const VALID_SALES_STATUSES = ['Entregado', 'Completado', 'Despachado', 'Pagado', 'Aprobado', 'En Preparación'];
        let baseList: Order[] = [];

        if (modalPeriod === 'custom' && selectedBarOrders) {
            baseList = selectedBarOrders;
        } else {
            const now = new Date();
            const currentMonth = now.getMonth();
            const currentYear = now.getFullYear();
            baseList = (orders || []).filter(o => {
                const oDate = convertToDate(o.receptionDate || o.approvalDate || o.createdAt || o.orderDate);
                if (modalPeriod === 'today') {
                    return oDate.getDate() === now.getDate() && oDate.getMonth() === currentMonth && oDate.getFullYear() === currentYear;
                }
                if (modalPeriod === '7d') {
                    const start7d = new Date();
                    start7d.setDate(now.getDate() - 7);
                    return oDate >= start7d;
                }
                if (modalPeriod === 'this_month') {
                    return oDate.getMonth() === currentMonth && oDate.getFullYear() === currentYear;
                }
                if (modalPeriod === 'last_month') {
                    const lastM = currentMonth === 0 ? 11 : currentMonth - 1;
                    const lastY = currentMonth === 0 ? currentYear - 1 : currentYear;
                    return oDate.getMonth() === lastM && oDate.getFullYear() === lastY;
                }
                return true;
            });
        }

        if (auditMode === 'cobranzas') {
            baseList = baseList.filter(o => isCashOrder(o));
        } else if (auditMode === 'despachos') {
            baseList = baseList.filter(o => ['Despachado', 'Entregado', 'Completado'].includes(o.status));
        } else if (auditMode === 'cancelaciones') {
            baseList = baseList.filter(o => o.status === 'Cancelado');
        } else if (auditMode === 'pendientes') {
            baseList = baseList.filter(o => Math.max(0, (o.totalAmount || 0) - getEffectiveCashReceived(o)) > 0.05);
        } else {
            baseList = baseList.filter(o => VALID_SALES_STATUSES.includes(o.status));
        }

        return baseList;
    }, [modalPeriod, selectedBarOrders, orders, auditMode]);

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
        } else if (period === '30d') {
            periodsList = Array.from({ length: 30 }, (_, i) => {
                const day = startOfDay(subDays(now, 29 - i));
                const end = new Date(day);
                end.setHours(23, 59, 59, 999);
                return {
                    dateLabel: format(day, 'dd/MM'),
                    start: day,
                    end: end,
                    rawDate: day
                };
            });
        } else {
            periodsList = Array.from({ length: 6 }, (_, i) => {
                const d = new Date();
                d.setMonth(now.getMonth() - (5 - i));
                const mStart = new Date(d.getFullYear(), d.getMonth(), 1);
                const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
                return {
                    dateLabel: format(d, 'MMM', { locale: es }).toUpperCase(),
                    start: mStart,
                    end: mEnd,
                    rawDate: d
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
                const oDate = convertToDate(o.receptionDate || o.approvalDate || o.createdAt || o.orderDate);
                return oDate >= p.start && oDate <= p.end;
            });

            const salesOrders = periodOrders.filter(o => VALID_SALES_STATUSES.includes(o.status));
            const salesTotal = salesOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
            
            const cashOrders = periodOrders.filter(o => isCashOrder(o));
            const cashTotal = periodOrders.reduce((sum, o) => sum + getEffectiveCashReceived(o), 0);

            const dispatchedOrders = periodOrders.filter(o => ['Despachado', 'Entregado', 'Completado'].includes(o.status));
            const cancelledOrders = periodOrders.filter(o => o.status === 'Cancelado');
            const dispatchedCount = dispatchedOrders.length;
            const cancelledCount = cancelledOrders.length;
            const ordersCount = periodOrders.length;
            const pendingBalance = Math.max(0, salesTotal - cashTotal);
            const avgTicket = ordersCount > 0 ? salesTotal / ordersCount : 0;
            const cancelRate = ordersCount > 0 ? (cancelledCount / ordersCount) * 100 : 0;

            globalSales += salesTotal;
            globalCash += cashTotal;
            globalDispatched += dispatchedCount;
            globalCancelled += cancelledCount;
            globalOrdersCount += ordersCount;

            return {
                name: p.dateLabel,
                ventas: salesTotal,
                cobranzas: cashTotal,
                saldoPendiente: pendingBalance,
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
                        <p className="text-lg sm:text-xl font-black text-white tracking-tighter">${metricsData.totals.sales.toLocaleString()}</p>
                    </div>
                    <div 
                        onClick={() => openAuditForType('cobranzas')}
                        className="space-y-0.5 cursor-pointer hover:bg-white/10 p-2 rounded-xl transition-all group"
                    >
                        <span className="text-[8px] font-black uppercase tracking-widest text-emerald-400 block group-hover:text-emerald-300 transition-colors">Cobranzas Cash (Clic Auditar)</span>
                        <p className="text-lg sm:text-xl font-black text-emerald-400 tracking-tighter">${metricsData.totals.cash.toLocaleString()}</p>
                    </div>
                    <div 
                        onClick={() => openAuditForType('pendientes')}
                        className="space-y-0.5 cursor-pointer hover:bg-white/10 p-2 rounded-xl transition-all group"
                    >
                        <span className="text-[8px] font-black uppercase tracking-widest text-amber-400 block group-hover:text-amber-300 transition-colors">Por Cobrar (Crédito)</span>
                        <p className="text-lg sm:text-xl font-black text-amber-400 tracking-tighter">${metricsData.totals.pending.toLocaleString()}</p>
                    </div>
                    <div 
                        onClick={() => openAuditForType('cobranzas')}
                        className="space-y-0.5 cursor-pointer hover:bg-white/10 p-2 rounded-xl transition-all group"
                    >
                        <span className="text-[8px] font-black uppercase tracking-widest text-cyan-400 block group-hover:text-cyan-300 transition-colors">Efectividad Cobro</span>
                        <div className="flex items-baseline gap-2">
                            <p className="text-lg sm:text-xl font-black text-cyan-400 tracking-tighter">{efficiencyRate}%</p>
                            <Badge variant="outline" className="text-[7px] font-black border-cyan-500/30 text-cyan-400 px-1 py-0">Recaudación</Badge>
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
                        <div className="h-[280px] w-full pt-4">
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
                        <div className="h-[280px] w-full pt-4">
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

                {/* VISTA 3: MATRIZ DE MÉTRICAS GLOBALES (TABLA INTERACTIVA DE LA APP) */}
                {activeTab === 'matrix' && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300 flex items-center gap-2">
                                <TableIcon className="h-3.5 w-3.5 text-primary" /> Matriz Comparativa de Métricas Globales de la App (Haz clic en una fila para auditar)
                            </h3>
                        </div>
                        <div className="max-h-[300px] overflow-y-auto custom-scrollbar border border-white/10 rounded-2xl">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-white/10 sticky top-0 z-10">
                                    <tr>
                                        <th className="p-3 pl-6 text-[8px] font-black uppercase tracking-widest text-slate-300">Período / Fecha</th>
                                        <th className="p-3 text-[8px] font-black uppercase tracking-widest text-slate-300 text-right">Ventas Totales ($)</th>
                                        <th className="p-3 text-[8px] font-black uppercase tracking-widest text-emerald-400 text-right">Cobranzas Cash ($)</th>
                                        <th className="p-3 text-[8px] font-black uppercase tracking-widest text-amber-400 text-right">Por Cobrar ($)</th>
                                        <th className="p-3 text-[8px] font-black uppercase tracking-widest text-slate-300 text-center">Despachos (#)</th>
                                        <th className="p-3 text-[8px] font-black uppercase tracking-widest text-rose-400 text-center">Cancelados (#)</th>
                                        <th className="p-3 pr-6 text-[8px] font-black uppercase tracking-widest text-slate-300 text-right">Ticket Prom. ($)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5 text-[10px] font-mono font-bold">
                                    {metricsData.matrixRows.map((row, idx) => (
                                        <tr key={idx} onClick={() => handleBarClick(row)} className="hover:bg-white/10 transition-colors cursor-pointer">
                                            <td className="p-3 pl-6 font-black uppercase text-white tracking-widest">{row.name}</td>
                                            <td className="p-3 text-right font-black text-white">${row.ventas.toLocaleString()}</td>
                                            <td className="p-3 text-right font-black text-emerald-400">${row.cobranzas.toLocaleString()}</td>
                                            <td className="p-3 text-right font-black text-amber-400">${row.saldoPendiente.toLocaleString()}</td>
                                            <td className="p-3 text-center text-sky-400 font-black">{row.despachos}</td>
                                            <td className="p-3 text-center text-rose-400 font-black">{row.cancelaciones}</td>
                                            <td className="p-3 pr-6 text-right font-black text-slate-300">${Math.round(row.ticketPromedio).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </CardContent>

            {/* MODAL EJECUTIVA FLOTANTE DE AUDITORÍA Y DESGLOSE DE VENTAS DEL PERIODO (DRILL-DOWN) */}
            <Dialog open={isAuditModalOpen} onOpenChange={setIsAuditModalOpen}>
                <DialogContent className="sm:max-w-4xl rounded-[2.5rem] border-none shadow-2xl overflow-hidden p-8 bg-white text-slate-900">
                    <DialogHeader className="space-y-2 border-b pb-4">
                        <div className="flex items-center justify-between">
                            <Badge className={cn(
                                "font-black text-[9px] uppercase tracking-widest px-3 py-1",
                                auditMode === 'cobranzas' ? "bg-emerald-600 text-white" :
                                auditMode === 'pendientes' ? "bg-amber-600 text-white" :
                                auditMode === 'cancelaciones' ? "bg-rose-600 text-white" :
                                auditMode === 'despachos' ? "bg-sky-600 text-white" : "bg-primary text-white"
                            )}>
                                {auditMode === 'cobranzas' ? 'Auditoría de Cobranzas Cash' :
                                 auditMode === 'pendientes' ? 'Auditoría de Cartera por Cobrar' :
                                 auditMode === 'cancelaciones' ? 'Auditoría de Cancelaciones' :
                                 auditMode === 'despachos' ? 'Auditoría Logística de Despachos' : 'Auditoría de Ventas Comerciales'}
                            </Badge>
                            <span className="text-[10px] font-black font-mono text-slate-400">
                                {customModalLabel || (period === 'today' ? '☀️ HOY' : period === '7d' ? '⚡ ÚLTIMOS 7 DÍAS' : period === 'this_month' ? '🗓️ MES ACTUAL (AGOSTO)' : period === 'last_month' ? '📅 MES ANTERIOR' : '🌐 6 MESES')}
                            </span>
                        </div>
                        <DialogTitle className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
                            <BarChart3 className="h-6 w-6 text-primary" /> {customModalLabel || 'Desglose Detallado de Ventas'}
                        </DialogTitle>
                        <DialogDescription className="text-slate-500 text-xs">
                            {auditMode === 'cobranzas' 
                                ? 'Consolidado de cobranzas cash en efectivo, transferencias y Zelle conciliados en el sistema.'
                                : auditMode === 'pendientes'
                                ? 'Expedientes con saldo pendiente por cobrar en cartera comercial.'
                                : 'Listado completo de pedidos registrados en el elemento seleccionado con conversión oficial a Bs. BCV.'}
                        </DialogDescription>
                    </DialogHeader>

                    {/* BARRA DE FILTROS DE PERÍODOS INTERNA EN LA MODAL */}
                    <div className="flex flex-wrap items-center gap-1.5 bg-slate-50 p-2 rounded-2xl border border-slate-100 my-2">
                        <span className="text-[8px] font-black uppercase text-slate-400 mr-1 pl-1">Filtrar Periodo:</span>
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
                                onClick={() => setModalPeriod(p.id as any)}
                                className={cn(
                                    "px-2.5 py-1 rounded-xl text-[8px] font-black uppercase tracking-wider transition-all border cursor-pointer",
                                    modalPeriod === p.id 
                                        ? "bg-slate-900 text-white border-slate-900 shadow-sm" 
                                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                )}
                            >
                                {p.label}
                            </button>
                        ))}
                        {modalPeriod === 'custom' && (
                            <Badge className="bg-primary text-white text-[8px] font-black uppercase px-2.5 py-1 rounded-xl ml-auto border-none">
                                📍 {customModalLabel || 'Selección del Gráfico'}
                            </Badge>
                        )}
                    </div>

                    {/* METRICAS SUMMARY DEL PERIODO DE LA MODAL ADAPTADAS AL MODO */}
                    {(() => {
                        const activeList = modalFilteredOrders;
                        const mSales = activeList.reduce((sum, o) => {
                            if (auditMode === 'cobranzas') {
                                return sum + (o.status === 'Pagado' ? (o.totalAmount || 0) : (o.amountPaid || 0));
                            }
                            if (auditMode === 'pendientes') {
                                return sum + Math.max(0, (o.totalAmount || 0) - (o.amountPaid || 0));
                            }
                            return sum + (o.totalAmount || 0);
                        }, 0);
                        const mCount = activeList.length;
                        const mAvg = mCount > 0 ? mSales / mCount : 0;
                        return (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-100 my-2">
                                <div>
                                    <span className="text-[8px] font-black uppercase text-slate-400">
                                        {auditMode === 'cobranzas' ? 'Total Cobrado USD' : auditMode === 'pendientes' ? 'Total por Cobrar USD' : 'Total Facturado USD'}
                                    </span>
                                    <p className="text-lg font-black text-slate-900 font-mono">${mSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                                </div>
                                <div>
                                    <span className="text-[8px] font-black uppercase text-slate-400">Equivalente Bs. BCV</span>
                                    <p className="text-lg font-black text-slate-700 font-mono">Bs. {(mSales * 65.50).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</p>
                                </div>
                                <div>
                                    <span className="text-[8px] font-black uppercase text-slate-400">
                                        {auditMode === 'cobranzas' ? 'Cobros Efectuados' : auditMode === 'pendientes' ? 'Cuentas Pendientes' : 'Pedidos Totales'}
                                    </span>
                                    <p className="text-lg font-black text-blue-700 font-mono">{mCount} expedientes</p>
                                </div>
                                <div>
                                    <span className="text-[8px] font-black uppercase text-slate-400">
                                        {auditMode === 'cobranzas' ? 'Cobro Promedio' : auditMode === 'pendientes' ? 'Deuda Promedio' : 'Ticket Promedio'}
                                    </span>
                                    <p className="text-lg font-black text-emerald-700 font-mono">${Math.round(mAvg).toLocaleString()}</p>
                                </div>
                            </div>
                        );
                    })()}

                    {/* BARRA DE BÚSQUEDA Y FILTRO DE MÉTODOS DENTRO DE LA MODAL */}
                    <div className="flex flex-col sm:flex-row items-center gap-2 my-2">
                        <div className="relative flex-1 w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                            <Input
                                placeholder="BUSCAR CLIENTE, VENDEDOR O PEDIDO..."
                                value={auditSearchTerm}
                                onChange={(e) => setAuditSearchTerm(e.target.value)}
                                className="pl-9 h-10 text-[10px] font-bold uppercase bg-slate-50 border-none rounded-xl"
                            />
                        </div>
                        {auditMode === 'cobranzas' && (
                            <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-xl">
                                {[
                                    { id: 'todos', label: '💵 Todos' },
                                    { id: 'cash', label: '💵 Cash USD' },
                                    { id: 'bcv', label: '🇻🇪 Bolívares BCV' },
                                    { id: 'zelle', label: '🏦 Zelle' },
                                ].map(m => (
                                    <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => setPaymentMethodFilter(m.id as any)}
                                        className={cn(
                                            "px-2.5 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all border",
                                            paymentMethodFilter === m.id
                                                ? "bg-emerald-700 text-white border-emerald-700 shadow-sm"
                                                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                        )}
                                    >
                                        {m.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* TABLA DE PEDIDOS DESGLOSADOS ADAPTADA AL MODO */}
                    <div className="max-h-[360px] overflow-y-auto custom-scrollbar border border-slate-100 rounded-2xl">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest sticky top-0 z-10">
                                <tr>
                                    <th className="p-3 pl-6">Cliente / Pedido</th>
                                    <th className="p-3">Vendedor</th>
                                    <th className="p-3 text-center">Estado</th>
                                    <th className="p-3 text-right">
                                        {auditMode === 'cobranzas' ? 'Monto Cobrado ($ Cash)' : auditMode === 'pendientes' ? 'Saldo Pendiente ($ USD)' : 'Monto ($ USD)'}
                                    </th>
                                    <th className="p-3 text-right">
                                        {auditMode === 'cobranzas' ? 'Monto Cobrado (Bs. BCV)' : auditMode === 'pendientes' ? 'Saldo Pendiente (Bs. BCV)' : 'Monto (Bs. BCV)'}
                                    </th>
                                    <th className="p-3 pr-6 text-right">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-800">
                                {modalFilteredOrders
                                    .filter(o => {
                                        const term = auditSearchTerm.toLowerCase().trim();
                                        if (term) {
                                            const matchesTerm = (
                                                (o.customerName || '').toLowerCase().includes(term) ||
                                                (o.salespersonName || '').toLowerCase().includes(term) ||
                                                (o.id || '').toLowerCase().includes(term)
                                            );
                                            if (!matchesTerm) return false;
                                        }
                                        if (auditMode === 'cobranzas' && paymentMethodFilter !== 'todos') {
                                            const pMethod = ((o as any).paymentMethod || (o as any).paymentType || (o as any).paymentChannel || '').toLowerCase();
                                            if (paymentMethodFilter === 'cash' && !pMethod.includes('efectivo') && !pMethod.includes('cash')) return false;
                                            if (paymentMethodFilter === 'bcv' && !pMethod.includes('bcv') && !pMethod.includes('bolivar') && !pMethod.includes('pago movil') && !pMethod.includes('transferencia')) return false;
                                            if (paymentMethodFilter === 'zelle' && !pMethod.includes('zelle') && !pMethod.includes('swift')) return false;
                                        }
                                        return true;
                                    })
                                    .map((o, idx) => {
                                        const rowVal = auditMode === 'cobranzas' 
                                            ? (o.status === 'Pagado' ? (o.totalAmount || 0) : (o.amountPaid || 0))
                                            : auditMode === 'pendientes'
                                            ? Math.max(0, (o.totalAmount || 0) - (o.amountPaid || 0))
                                            : (o.totalAmount || 0);

                                        return (
                                            <tr key={o.id || idx} className="hover:bg-slate-50 transition-colors">
                                                <td className="p-3 pl-6">
                                                    <p className="font-black text-slate-900 uppercase leading-tight">{o.customerName || 'Cliente General'}</p>
                                                    <p className="text-[8px] font-mono text-slate-400">ID: {o.id?.slice(0, 8)}</p>
                                                </td>
                                                <td className="p-3 text-slate-600 font-medium text-[10px]">{o.salespersonName || 'Directo'}</td>
                                                <td className="p-3 text-center">
                                                    <Badge variant="outline" className={cn(
                                                        "text-[8px] font-black uppercase px-2 py-0.5 border-slate-200",
                                                        auditMode === 'cobranzas' ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "text-slate-700"
                                                    )}>
                                                        {auditMode === 'cobranzas' ? (o.status === 'Pagado' ? 'Pagado Total' : 'Abono Parcial') : o.status}
                                                    </Badge>
                                                </td>
                                                <td className="p-3 text-right font-mono font-black text-emerald-700">${rowVal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                                <td className="p-3 text-right font-mono font-black text-slate-600">Bs. {(rowVal * 65.50).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
                                                <td className="p-3 pr-6 text-right">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => {
                                                            setSelectedOrderForSheet(o);
                                                        }}
                                                        className="h-8 px-3 rounded-xl text-[8px] font-black uppercase text-primary hover:bg-primary/10"
                                                    >
                                                        <Eye className="h-3 w-3 mr-1" /> Ver Detalle
                                                    </Button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                            </tbody>
                        </table>
                    </div>
                </DialogContent>
            </Dialog>

            {/* FICHA DE DETALLE COMPLETO DEL PEDIDO */}
            {selectedOrderForSheet && (
                <OrderSheetController
                    order={selectedOrderForSheet}
                    onOpenChange={(open) => !open && setSelectedOrderForSheet(null)}
                />
            )}
        </Card>
    );
}
