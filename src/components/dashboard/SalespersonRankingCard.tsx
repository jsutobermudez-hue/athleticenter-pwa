'use client';

import React, { useMemo, useState } from 'react';
import type { Order } from '@/lib/definitions';
import { 
    Card, 
    CardContent, 
    CardHeader, 
    CardTitle,
    CardFooter
} from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Medal, Search, Calendar, Award, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { OrderSheetController } from '@/app/dashboard/orders/OrderSheetController';

const STATUS_COLORS: { [key: string]: string } = {
    'Borrador': 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    'Pendiente': 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    'Aprobado': 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    'En Preparación': 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
    'Completado': 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    'Despachado': 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    'Entregado': 'bg-green-500/10 text-green-500 border-green-500/20',
    'Cancelado': 'bg-rose-500/10 text-rose-500 border-rose-500/20',
    'En Verificación': 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20',
    'Pagado': 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    'Rechazado': 'bg-red-500/10 text-red-500 border-red-500/20',
};

const convertToDate = (value: any): Date => {
    if (!value) return new Date(0);
    if (typeof value.toDate === 'function') {
        return value.toDate();
    }
    return new Date(value);
};

const formatOrderDate = (ts: any) => {
    const date = convertToDate(ts);
    if (date.getTime() === 0) return '';
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) + ' ' + 
           date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
};

export function SalespersonRankingCard({ orders }: { orders: Order[] }) {
    const [searchQuery, setSearchQuery] = useState('');
    const [period, setPeriod] = useState<'todos' | 'semana' | 'mes' | 'rango'>('todos');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    const [selectedSalesperson, setSelectedSalesperson] = useState<any | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

    // Filtrado de órdenes en base al periodo y rango personalizado
    const filteredOrders = useMemo(() => {
        if (!orders) return [];
        
        const now = new Date();
        const startOfWeek = new Date();
        startOfWeek.setDate(now.getDate() - 7);
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const VALID_SALES_STATUSES = ['Entregado', 'Completado', 'Despachado', 'Pagado', 'Aprobado', 'En Preparación', 'En Verificación'];

        let parsedStart: Date | null = null;
        let parsedEnd: Date | null = null;
        if (startDate) {
            parsedStart = new Date(startDate);
            parsedStart.setHours(0, 0, 0, 0);
        }
        if (endDate) {
            parsedEnd = new Date(endDate);
            parsedEnd.setHours(23, 59, 59, 999);
        }

        return orders.filter(o => {
            if (!VALID_SALES_STATUSES.includes(o.status)) return false;
            const oDate = convertToDate(o.receptionDate || o.approvalDate || o.createdAt || o.orderDate);

            if (period === 'semana') {
                return oDate >= startOfWeek;
            }
            if (period === 'mes') {
                return oDate >= startOfMonth;
            }
            if (period === 'rango') {
                if (parsedStart && oDate < parsedStart) return false;
                if (parsedEnd && oDate > parsedEnd) return false;
            }
            return true;
        });
    }, [orders, period, startDate, endDate]);

    // Agrupación y ordenamiento por vendedor (incluyendo Ventas Directas)
    const salespersonRanking = useMemo(() => {
        const groups: { [id: string]: { id: string; name: string; totalSales: number; orderCount: number; orders: Order[] } } = {};

        filteredOrders.forEach(order => {
            const spId = order.salespersonId || 'direct_system';
            const spName = order.salespersonName || (order.salespersonId ? 'Vendedor' : 'Ventas Directas / Sistema');

            // Filtro por texto del nombre del vendedor
            if (searchQuery && !spName.toLowerCase().includes(searchQuery.toLowerCase())) {
                return;
            }

            if (!groups[spId]) {
                groups[spId] = {
                    id: spId,
                    name: spName,
                    totalSales: 0,
                    orderCount: 0,
                    orders: []
                };
            }
            groups[spId].totalSales += order.totalAmount || 0;
            groups[spId].orderCount += 1;
            groups[spId].orders.push(order);
        });

        return Object.values(groups).sort((a, b) => b.totalSales - a.totalSales);
    }, [filteredOrders, searchQuery]);

    return (
        <>
            <Card className="border border-white/10 shadow-2xl rounded-[2.5rem] bg-slate-900 text-white overflow-hidden">
                <CardHeader className="p-6 sm:p-8 border-b border-white/5 space-y-4">
                    <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-3">
                        <Medal className="h-5 w-5 text-primary" /> Rendimiento del Equipo B2B
                    </CardTitle>

                    {/* Fila de Filtros */}
                    <div className="flex flex-wrap gap-4 items-center justify-between">
                        {/* Buscador de Vendedor */}
                        <div className="relative flex-1 min-w-[200px]">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                            <input 
                                type="text" 
                                placeholder="Buscar vendedor..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full h-11 pl-11 pr-4 bg-white/5 border border-white/10 rounded-2xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-primary/50 transition-all font-bold uppercase"
                            />
                        </div>

                        {/* Selector de Periodo */}
                        <div className="flex bg-white/5 border border-white/10 rounded-2xl p-1 gap-1">
                            {(['todos', 'semana', 'mes', 'rango'] as const).map((p) => (
                                <button
                                    key={p}
                                    type="button"
                                    onClick={() => setPeriod(p)}
                                    className={cn(
                                        "px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all",
                                        period === p 
                                            ? "bg-primary text-white shadow-lg shadow-primary/20" 
                                            : "text-slate-400 hover:text-white"
                                    )}
                                >
                                    {p === 'todos' ? 'Todo' : p === 'semana' ? 'Semana' : p === 'mes' ? 'Mes' : 'Rango'}
                                </button>
                            ))}
                        </div>

                        {/* Rango de Fechas Personalizado */}
                        {period === 'rango' && (
                            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl px-3 py-1 animate-in fade-in duration-300">
                                <Calendar className="h-3.5 w-3.5 text-primary shrink-0" />
                                <input 
                                    type="date" 
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="bg-transparent border-none text-[10px] text-white focus:outline-none uppercase font-black cursor-pointer"
                                />
                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">a</span>
                                <input 
                                    type="date" 
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    className="bg-transparent border-none text-[10px] text-white focus:outline-none uppercase font-black cursor-pointer"
                                />
                            </div>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="p-6 sm:p-8 space-y-4">
                    {salespersonRanking.length > 0 ? (
                        <div className="space-y-3 max-h-[460px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
                            {salespersonRanking.map((rank, index) => (
                                <div 
                                    key={rank.id} 
                                    onClick={() => setSelectedSalesperson(rank)}
                                    className="p-5 rounded-[1.8rem] border border-white/5 bg-white/5 flex items-center justify-between group hover:bg-white/10 hover:border-primary/20 transition-all cursor-pointer active:scale-98"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary font-black text-xs flex items-center justify-center">
                                            #{index + 1}
                                        </div>
                                        <div>
                                            <p className="text-xs font-black uppercase text-white leading-none">{rank.name}</p>
                                            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1.5">{rank.orderCount} Pedidos Realizados</p>
                                        </div>
                                    </div>
                                    <div className="text-right flex items-center gap-3">
                                        <div>
                                            <p className="text-sm font-black tracking-tighter text-emerald-400 leading-none">${rank.totalSales.toLocaleString()}</p>
                                            <span className="text-[7px] font-black text-slate-500 uppercase tracking-widest">Total Facturado</span>
                                        </div>
                                        <ArrowUpRight className="h-4 w-4 text-slate-500 group-hover:text-primary transition-colors" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex h-32 items-center justify-center text-slate-500 text-xs font-black uppercase border border-dashed border-white/10 rounded-3xl">
                            Sin Resultados con estos Filtros
                        </div>
                    )}
                </CardContent>
                <CardFooter className="p-6 border-t border-white/5 bg-white/[0.02] flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Facturado en Periodo ({period.toUpperCase()}):</span>
                    <p className="text-base font-black tracking-tighter text-emerald-400 font-mono">
                        ${salespersonRanking.reduce((sum, r) => sum + r.totalSales, 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </p>
                </CardFooter>
            </Card>

            {/* Modal de Pedidos de Vendedor */}
            <Dialog open={!!selectedSalesperson} onOpenChange={(open) => !open && setSelectedSalesperson(null)}>
                <DialogContent className="max-w-[95vw] sm:max-w-3xl p-8 border-none bg-slate-900 text-white rounded-[2rem] shadow-2xl overflow-hidden">
                    <DialogHeader className="border-b border-white/5 pb-4">
                        <DialogTitle className="text-xl font-black uppercase tracking-tighter italic text-primary flex items-center gap-3">
                            <Award className="h-6 w-6 text-primary" /> Pedidos de {selectedSalesperson?.name}
                        </DialogTitle>
                        <DialogDescription className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">
                            Historial de ventas y solicitudes del vendedor en el periodo seleccionado
                        </DialogDescription>
                    </DialogHeader>
                    <div className="mt-6 max-h-[60vh] overflow-y-auto pr-2 space-y-3 scrollbar-thin scrollbar-thumb-slate-800">
                        {selectedSalesperson?.orders && selectedSalesperson.orders.length > 0 ? (
                            selectedSalesperson.orders.map((o: Order) => (
                                <div 
                                    key={o.id} 
                                    onClick={() => setSelectedOrder(o)}
                                    className="p-5 rounded-2xl border border-white/5 bg-white/5 flex items-center justify-between group hover:bg-white/10 hover:border-primary/20 transition-all cursor-pointer active:scale-98"
                                >
                                    <div>
                                        <div className="flex items-center gap-3">
                                            <span className="text-[10px] font-black text-primary uppercase">#{o.id.substring(0, 8).toUpperCase()}</span>
                                            <Badge variant="outline" className={cn("text-[6px] font-black uppercase border-none px-2 h-4", STATUS_COLORS[o.status] || 'bg-slate-500/10 text-slate-400')}>
                                                {o.status}
                                            </Badge>
                                        </div>
                                        <p className="text-xs font-black uppercase text-white mt-2 leading-none">{o.customerName}</p>
                                        <p className="text-[8px] font-mono text-slate-500 mt-1">Fecha: {formatOrderDate(o.createdAt || o.orderDate)}</p>
                                    </div>
                                    <div className="text-right flex items-center gap-3">
                                        <div>
                                            <p className="text-sm font-black tracking-tighter text-emerald-400 leading-none">${o.totalAmount.toLocaleString()}</p>
                                            <span className="text-[7px] font-black text-slate-500 uppercase tracking-widest mt-1">Ver Detalle del Pedido</span>
                                        </div>
                                        <ArrowUpRight className="h-5 w-5 text-slate-500 group-hover:text-primary transition-colors" />
                                    </div>
                                </div>
                            ))
                        ) : (
                            <p className="text-center text-slate-500 text-xs font-black uppercase py-10">Sin Pedidos Vinculados</p>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Panel de Detalle del Pedido */}
            {selectedOrder && (
                <OrderSheetController 
                    order={selectedOrder} 
                    onOpenChange={(open) => !open && setSelectedOrder(null)} 
                />
            )}
        </>
    );
}
