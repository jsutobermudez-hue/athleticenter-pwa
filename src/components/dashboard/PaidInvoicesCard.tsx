'use client';

import React, { useState, useMemo } from 'react';
import type { Order } from '@/lib/definitions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, DollarSign, Receipt, CheckCircle2, ChevronRight, CreditCard } from 'lucide-react';
import { OrderSheetController } from '@/app/dashboard/orders/OrderSheetController';
import { cn } from '@/lib/utils';

interface PaidInvoicesCardProps {
    orders: Order[] | null;
}

const convertToDate = (value: any): Date => {
    if (!value) return new Date(0);
    if (typeof value.toDate === 'function') {
        return value.toDate();
    }
    return new Date(value);
};

const formatDate = (ts: any) => {
    const d = convertToDate(ts);
    if (d.getTime() === 0) return 'S/F';
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

export function PaidInvoicesCard({ orders }: PaidInvoicesCardProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

    // Filtrar únicamente órdenes pagadas o con pagos parciales mayores a 0
    const paidOrders = useMemo(() => {
        if (!orders) return [];
        return orders
            .filter(o => o.status === 'Pagado' || (o.amountPaid && o.amountPaid > 0))
            .sort((a, b) => {
                const dateA = convertToDate(a.updatedAt || a.receptionDate || a.createdAt || a.orderDate);
                const dateB = convertToDate(b.updatedAt || b.receptionDate || b.createdAt || b.orderDate);
                return dateB.getTime() - dateA.getTime();
            });
    }, [orders]);

    // Filtrar por búsqueda
    const filteredInvoices = useMemo(() => {
        if (!searchQuery.trim()) return paidOrders;
        const q = searchQuery.toLowerCase().trim();
        return paidOrders.filter(o => 
            o.id.toLowerCase().includes(q) ||
            o.customerName?.toLowerCase().includes(q) ||
            o.salespersonName?.toLowerCase().includes(q)
        );
    }, [paidOrders, searchQuery]);

    // Total recabado en dólares
    const totalCashCollected = useMemo(() => {
        return paidOrders.reduce((sum, o) => sum + (o.amountPaid || o.totalAmount || 0), 0);
    }, [paidOrders]);

    return (
        <>
            <Card className="border-none shadow-xl rounded-[2.5rem] bg-white overflow-hidden animate-in fade-in duration-500">
                <CardHeader className="p-6 sm:p-8 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100">
                    <div className="space-y-1">
                        <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 flex items-center gap-2">
                            <Receipt className="h-4 w-4 text-emerald-500" /> Facturas Cobradas (Recaudación Cash)
                        </CardTitle>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                            Registro de facturas con abono verificado y liquidación total
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                        <div className="relative flex-1 sm:w-64">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                            <Input
                                placeholder="BUSCAR FACTURA, CLIENTE O VENDEDOR..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 h-10 bg-slate-50 border-none rounded-xl text-[10px] font-black uppercase tracking-wider text-slate-900"
                            />
                        </div>

                        <div className="bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 rounded-2xl flex items-center gap-2 shrink-0">
                            <DollarSign className="h-4 w-4 text-emerald-600" />
                            <div className="text-right">
                                <span className="text-[8px] font-black uppercase tracking-widest text-emerald-600 block">Total Recaudado</span>
                                <span className="text-base font-black text-emerald-700 tracking-tighter">${totalCashCollected.toLocaleString()}</span>
                            </div>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="p-0">
                    <div className="max-h-[380px] overflow-y-auto custom-scrollbar">
                        {filteredInvoices.length > 0 ? (
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-slate-50/80 sticky top-0 z-10 border-b border-slate-100">
                                    <tr>
                                        <th className="p-4 pl-8 text-[9px] font-black uppercase tracking-widest text-slate-400">Nº Factura / Pedido</th>
                                        <th className="p-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Cliente</th>
                                        <th className="p-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Vendedor</th>
                                        <th className="p-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Fecha</th>
                                        <th className="p-4 text-[9px] font-black uppercase tracking-widest text-slate-400 text-right">Total Factura</th>
                                        <th className="p-4 text-[9px] font-black uppercase tracking-widest text-slate-400 text-right">Cobrado Cash</th>
                                        <th className="p-4 pr-8 text-[9px] font-black uppercase tracking-widest text-slate-400 text-center">Estado Pago</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredInvoices.map((o) => {
                                        const dateStr = formatDate(o.updatedAt || o.receptionDate || o.createdAt || o.orderDate);
                                        const amountPaid = o.amountPaid || o.totalAmount || 0;
                                        const isFullPaid = o.status === 'Pagado' || (amountPaid >= o.totalAmount - 0.05);

                                        return (
                                            <tr
                                                key={o.id}
                                                onClick={() => setSelectedOrder(o)}
                                                className="hover:bg-slate-50/80 transition-colors cursor-pointer group text-[11px]"
                                            >
                                                <td className="p-4 pl-8 font-black uppercase text-slate-900 flex items-center gap-2">
                                                    <Badge variant="outline" className="font-mono text-[9px] border-slate-200 group-hover:border-primary group-hover:text-primary transition-colors">
                                                        #{o.id}
                                                    </Badge>
                                                </td>
                                                <td className="p-4 font-black uppercase text-slate-800 truncate max-w-[180px]">
                                                    {o.customerName}
                                                </td>
                                                <td className="p-4 font-bold text-slate-500 uppercase truncate max-w-[140px]">
                                                    {o.salespersonName || 'Sistema'}
                                                </td>
                                                <td className="p-4 font-mono font-bold text-slate-500">
                                                    {dateStr}
                                                </td>
                                                <td className="p-4 font-black text-slate-900 text-right">
                                                    ${o.totalAmount.toLocaleString()}
                                                </td>
                                                <td className="p-4 font-black text-emerald-600 text-right">
                                                    ${amountPaid.toLocaleString()}
                                                </td>
                                                <td className="p-4 pr-8 text-center">
                                                    <Badge className={cn(
                                                        "text-[8px] font-black uppercase tracking-widest border-none px-2.5 py-1 rounded-xl inline-flex items-center gap-1",
                                                        isFullPaid ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"
                                                    )}>
                                                        <CheckCircle2 className="h-3 w-3" />
                                                        {isFullPaid ? 'Cobrado 100%' : 'Abono Parcial'}
                                                    </Badge>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        ) : (
                            <div className="p-12 text-center space-y-3 opacity-40">
                                <Receipt className="h-10 w-10 mx-auto text-slate-300" />
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                    No se encontraron facturas cobradas coincidentes
                                </p>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Modal de auditoría de pedido al hacer clic en cualquier factura */}
            {selectedOrder && (
                <OrderSheetController
                    order={selectedOrder}
                    onOpenChange={(open) => !open && setSelectedOrder(null)}
                />
            )}
        </>
    );
}
