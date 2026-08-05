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

export function ExecutiveMetricsSuite({ orders }: ExecutiveMetricsSuiteProps) {
    const [period, setPeriod] = useState<'7d' | '30d' | '6m'>('6m');
    const [activeTab, setActiveTab] = useState<'comparative' | 'logistics' | 'matrix'>('comparative');

    // Procesamiento y agrupación de datos
    const metricsData = useMemo(() => {
        if (!orders) return { chartPoints: [], matrixRows: [], totals: { sales: 0, cash: 0, pending: 0, dispatched: 0, cancelled: 0, totalOrders: 0, avgTicket: 0 } };

        const now = new Date();
        const VALID_SALES_STATUSES = ['Entregado', 'Completado', 'Despachado', 'Pagado', 'Aprobado', 'En Preparación'];

        let periodsList: { dateLabel: string; start: Date; end: Date; rawDate: Date }[] = [];

        if (period === '7d') {
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
            
            const cashTotal = periodOrders.reduce((sum, o) => {
                if (o.status === 'Pagado') return sum + (o.totalAmount || 0);
                return sum + (o.amountPaid || 0);
            }, 0);

            const dispatchedCount = periodOrders.filter(o => ['Despachado', 'Entregado', 'Completado'].includes(o.status)).length;
            const cancelledCount = periodOrders.filter(o => o.status === 'Cancelado').length;
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
                tasaCancelacion: cancelRate
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

                    {/* Selector de Períodos de Análisis */}
                    <div className="flex bg-white/5 border border-white/10 p-1 rounded-xl gap-1">
                        {(['7d', '30d', '6m'] as const).map(p => (
                            <button
                                key={p}
                                type="button"
                                onClick={() => setPeriod(p)}
                                className={cn(
                                    "px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all",
                                    period === p ? "bg-white text-slate-900 font-black shadow-sm" : "text-slate-400 hover:text-white"
                                )}
                            >
                                {p === '7d' ? '7D' : p === '30d' ? '30D' : '6M'}
                            </button>
                        ))}
                    </div>
                </div>
            </CardHeader>

            <CardContent className="p-6 sm:p-8 space-y-6">
                {/* BANNER KPI DE RESUMEN GLOBAL */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-white/5 p-4 rounded-2xl border border-white/5">
                    <div className="space-y-0.5">
                        <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 block">Ventas Entregadas</span>
                        <p className="text-lg sm:text-xl font-black text-white tracking-tighter">${metricsData.totals.sales.toLocaleString()}</p>
                    </div>
                    <div className="space-y-0.5">
                        <span className="text-[8px] font-black uppercase tracking-widest text-emerald-400 block">Cobranzas Cash</span>
                        <p className="text-lg sm:text-xl font-black text-emerald-400 tracking-tighter">${metricsData.totals.cash.toLocaleString()}</p>
                    </div>
                    <div className="space-y-0.5">
                        <span className="text-[8px] font-black uppercase tracking-widest text-amber-400 block">Por Cobrar (Crédito)</span>
                        <p className="text-lg sm:text-xl font-black text-amber-400 tracking-tighter">${metricsData.totals.pending.toLocaleString()}</p>
                    </div>
                    <div className="space-y-0.5">
                        <span className="text-[8px] font-black uppercase tracking-widest text-cyan-400 block">Efectividad Cobro</span>
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
                                <BarChart data={metricsData.chartPoints} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 900, fill: '#94a3b8' }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 900, fill: '#94a3b8' }} tickFormatter={(v) => `$${v}`} />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#0f172a', borderRadius: '1rem', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '11px', fontWeight: 900 }} 
                                        formatter={(val: any, name: any) => [`$${Number(val).toLocaleString()}`, name === 'ventas' ? 'Ventas Comercial' : 'Cobranzas Cash']}
                                    />
                                    <Legend wrapperStyle={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', paddingTop: '10px' }} />
                                    <Bar dataKey="ventas" name="ventas" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                                    <Bar dataKey="cobranzas" name="cobranzas" fill="#10b981" radius={[6, 6, 0, 0]} />
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
                                <BarChart data={metricsData.chartPoints} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 900, fill: '#94a3b8' }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 900, fill: '#94a3b8' }} />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#0f172a', borderRadius: '1rem', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '11px', fontWeight: 900 }}
                                        formatter={(val: any, name: any) => [`${val} Unid.`, name === 'despachos' ? 'Despachados / Entregados' : 'Cancelaciones']}
                                    />
                                    <Legend wrapperStyle={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', paddingTop: '10px' }} />
                                    <Bar dataKey="despachos" name="despachos" fill="#38bdf8" radius={[6, 6, 0, 0]} />
                                    <Bar dataKey="cancelaciones" name="cancelaciones" fill="#f43f5e" radius={[6, 6, 0, 0]} />
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
                                <TableIcon className="h-3.5 w-3.5 text-primary" /> Matriz Comparativa de Métricas Globales de la App
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
                                        <tr key={idx} className="hover:bg-white/5 transition-colors">
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
        </Card>
    );
}
