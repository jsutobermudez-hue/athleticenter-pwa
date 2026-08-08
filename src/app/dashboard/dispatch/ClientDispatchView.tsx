'use client';

import React, { useMemo, useState } from 'react';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, limit } from 'firebase/firestore';
import type { Order, OrderStatus } from '@/lib/definitions';
import { Loader2, Search, Truck, ExternalLink, Hourglass, Box, CheckCircle2, History, ShieldCheck, X, Clock, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { OrderStatusTimeline } from './OrderStatusTimeline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { OrderSheetController } from '../orders/OrderSheetController';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import Link from 'next/link';

export function ClientDispatchView() {
    const { user, profile: currentUser, isUserLoading } = useUser();
    const firestore = useFirestore();

    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [openSections, setOpenSections] = useState<string[]>([]);

    const ordersQuery = useMemoFirebase(() => {
        if (!user || !currentUser || !firestore) return null;
        // B2B: Usar ID de empresa para el filtro de consulta
        const targetId = currentUser.associatedCustomerId || user.uid;
        return query(
            collection(firestore, 'orders'),
            where('customerId', '==', targetId),
            limit(100)
        );
    }, [user, currentUser, firestore]);
    const { data: allOrders, isLoading: isLoadingOrders } = useCollection<Order>(ordersQuery);

    const groups = useMemo(() => {
        if (!allOrders) return { pending: [], transit: [], history: [] };

        const res = { pending: [] as Order[], transit: [] as Order[], history: [] as Order[] };
        const transitStatuses: OrderStatus[] = ['Aprobado', 'En Preparación', 'Completado', 'Despachado'];
        const historyStatuses: OrderStatus[] = ['Entregado', 'Cancelado', 'Pagado', 'En Verificación'];

        allOrders.forEach(o => {
            if (o.status === 'Pendiente') res.pending.push(o);
            else if (transitStatuses.includes(o.status)) res.transit.push(o);
            else if (historyStatuses.includes(o.status)) res.history.push(o);
        });
        
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            res.history = res.history.filter(o => o.id.toLowerCase().includes(term));
        }
        
        return res;
    }, [allOrders, searchTerm]);

    const getTrackingUrl = (order: Order) => {
        if (!order.trackingUrlTemplate || !order.trackingNumber) return null;
        return order.trackingUrlTemplate.replace('{trackingNumber}', order.trackingNumber);
    }
    
    if (isUserLoading || isLoadingOrders) {
        return <div className="flex h-64 items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>;
    }

    return (
        <div className="flex flex-col gap-6 sm:gap-8 max-w-full mx-auto pb-24 px-1 sm:px-4 animate-in fade-in-50 duration-500 overflow-x-hidden">
            <header className="px-1 space-y-1">
                <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none">Rastreo de Equipos</h1>
                <p className="text-[9px] sm:text-[10px] text-muted-foreground font-black italic uppercase tracking-[0.4em] opacity-60">Visibilidad en tiempo real de su cadena de suministros.</p>
            </header>

            <Accordion type="multiple" value={openSections} onValueChange={setOpenSections} className="space-y-4 w-full">
                <AccordionItem value="pending" className="border-none rounded-[1.8rem] sm:rounded-[2.5rem] bg-white shadow-sm ring-1 ring-amber-100 overflow-hidden">
                    <AccordionTrigger className="px-6 sm:px-8 py-5 sm:py-6 hover:no-underline group">
                        <div className="flex items-center gap-4 sm:gap-5 text-left flex-1 min-w-0">
                            <div className={cn(
                                "p-2.5 sm:p-3 rounded-xl sm:rounded-2xl shadow-sm transition-transform group-data-[state=open]:rotate-12 shrink-0",
                                groups.pending.length > 0 ? "bg-rose-100 text-rose-600" : "bg-amber-50 text-amber-600"
                            )}>
                                <Hourglass className="h-5 sm:h-6 w-5 sm:w-6" />
                            </div>
                            <div className="space-y-0.5 flex-1 min-w-0">
                                <h3 className="text-sm sm:text-base font-black uppercase tracking-tight text-slate-900 truncate">Validación Comercial</h3>
                                <p className="text-[8px] sm:text-[9px] text-muted-foreground font-black uppercase tracking-[0.2em] truncate">Pedidos en revisión inicial</p>
                            </div>
                            {groups.pending.length > 0 ? (
                                <Badge variant="destructive" className="ml-auto mr-4 bg-rose-600 text-white font-black h-6 sm:h-7 px-2.5 sm:px-3 rounded-lg text-[10px] sm:text-xs shrink-0 animate-pulse flex items-center gap-1 shadow-sm">
                                    <AlertTriangle className="h-3 w-3" /> REVISIÓN ({groups.pending.length})
                                </Badge>
                            ) : (
                                <Badge variant="secondary" className="ml-auto mr-4 bg-amber-100 text-amber-700 font-black h-6 sm:h-7 px-2 sm:px-3 rounded-lg text-[10px] sm:text-xs shrink-0">{groups.pending.length}</Badge>
                            )}
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-6 sm:px-8 pb-6 sm:pb-8 pt-2">
                        {groups.pending.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {groups.pending.map(order => (
                                    <Card key={order.id} className={cn(
                                        "cursor-pointer transition-all rounded-2xl p-5 group border-none shadow-md",
                                        order.cancellationRequested ? "ring-2 ring-amber-500 bg-amber-50/50" : "bg-white hover:ring-2 hover:ring-primary/20"
                                    )} onClick={() => setSelectedOrder(order)}>
                                        <div className="flex justify-between items-start mb-3">
                                            <p className="text-[10px] font-mono font-bold text-primary">#{order.id.substring(0, 8)}</p>
                                            {order.cancellationRequested && (
                                                <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200 text-[7px] font-black uppercase px-1.5 h-4 gap-1">
                                                    <Clock className="h-2 w-2" /> Trámite de Anulación
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="text-lg font-black text-slate-900 tracking-tighter mb-4">${order.totalAmount.toFixed(2)}</p>
                                        <div className="flex items-center justify-between pt-3 border-t border-dashed">
                                            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">En Verificación</span>
                                            <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        ) : (
                            <div className="py-10 sm:py-12 border-2 border-dashed rounded-[1.5rem] sm:rounded-[2rem] bg-slate-50/50 flex flex-col items-center justify-center gap-3 opacity-30">
                                <ShieldCheck className="h-7 sm:h-8 w-7 sm:w-8 text-slate-300" />
                                <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.3em]">Sin pedidos pendientes</p>
                            </div>
                        )}
                    </AccordionContent>
                </AccordionItem>

                <AccordionItem value="transit" className="border-none rounded-[1.8rem] sm:rounded-[2.5rem] bg-white shadow-sm ring-1 ring-sky-100 overflow-hidden">
                    <AccordionTrigger className="px-6 sm:px-8 py-5 sm:py-6 hover:no-underline group">
                        <div className="flex items-center gap-4 sm:gap-5 text-left flex-1 min-w-0">
                            <div className="p-2.5 sm:p-3 rounded-xl sm:rounded-2xl bg-sky-50 text-sky-600 shadow-sm transition-transform group-data-[state=open]:rotate-12 shrink-0">
                                <Truck className="h-5 sm:h-6 w-5 sm:w-6" />
                            </div>
                            <div className="space-y-0.5 flex-1 min-w-0">
                                <h3 className="text-sm sm:text-base font-black uppercase tracking-tight text-slate-900 truncate">En Ruta de Despacho</h3>
                                <p className="text-[8px] sm:text-[9px] text-muted-foreground font-black uppercase tracking-[0.2em] truncate">Mercancía en preparación o tránsito</p>
                            </div>
                            <Badge variant="secondary" className="ml-auto mr-4 bg-sky-100 text-sky-700 font-black h-6 sm:h-7 px-2 sm:px-3 rounded-lg text-[10px] sm:text-xs shrink-0">{groups.transit.length}</Badge>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-6 sm:px-8 pb-6 sm:pb-8 pt-2">
                        {groups.transit.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {groups.transit.map(order => (
                                    <Card key={order.id} className={cn(
                                        "rounded-[1.8rem] sm:rounded-[2rem] shadow-md border-none overflow-hidden group cursor-pointer transition-all",
                                        order.cancellationRequested ? "ring-2 ring-amber-500 bg-amber-50/30" : "bg-white"
                                    )} onClick={() => setSelectedOrder(order)}>
                                        <CardHeader className="p-5 sm:p-6 pb-2 border-b bg-slate-50/50">
                                            <div className="flex justify-between items-start">
                                                <div className="space-y-1">
                                                    <CardTitle className="text-xs sm:text-sm font-black uppercase tracking-tighter">Pedido #{order.id.substring(0, 8)}</CardTitle>
                                                    {order.cancellationRequested && (
                                                        <div className="flex items-center gap-1 text-amber-600 animate-pulse">
                                                            <AlertTriangle className="h-2.5 w-2.5" />
                                                            <span className="text-[7px] font-black uppercase tracking-widest">Cancelación Solicitada</span>
                                                        </div>
                                                    )}
                                                </div>
                                                <Badge className="bg-primary text-white text-[7px] sm:text-[8px] font-black uppercase h-5">{order.status}</Badge>
                                            </div>
                                        </CardHeader>
                                        <CardContent className="p-5 sm:p-6 space-y-6">
                                            <OrderStatusTimeline order={order} />
                                            {order.status === 'Despachado' && (
                                                <div className="rounded-2xl bg-slate-900 p-4 sm:p-5 text-white shadow-xl relative overflow-hidden group">
                                                    <Truck className="absolute -right-4 -bottom-4 h-16 sm:h-20 w-16 sm:w-20 opacity-10" />
                                                    <div className="flex items-center gap-2 font-black text-[9px] sm:text-[10px] uppercase tracking-widest text-primary mb-3"><Truck className="h-3.5 sm:h-4 w-3.5 sm:w-4"/> Tracking de Operador</div>
                                                    <div className="space-y-2 relative z-10">
                                                        <div className="flex justify-between items-center"><span className="text-[8px] sm:text-[9px] font-bold text-slate-400 uppercase">Transportista</span><span className="text-[10px] sm:text-xs font-black uppercase truncate max-w-[120px]">{order.carrier}</span></div>
                                                        <div className="flex justify-between items-center"><span className="text-[8px] sm:text-[9px] font-bold text-slate-400 uppercase">Guía #</span>
                                                            {getTrackingUrl(order) ? (
                                                                <a href={getTrackingUrl(order)!} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-primary underline font-mono text-[10px] sm:text-xs" onClick={(e) => e.stopPropagation()}>
                                                                    {order.trackingNumber} <ExternalLink className="h-3 w-3" />
                                                                </a>
                                                            ) : <span className="font-mono text-[10px] sm:text-xs font-black">{order.trackingNumber}</span>}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        ) : (
                            <div className="py-10 sm:py-12 border-2 border-dashed rounded-[1.5rem] sm:rounded-[2rem] bg-slate-50/50 flex flex-col items-center justify-center gap-4 text-center">
                                <Box className="h-8 sm:h-10 w-8 sm:w-10 text-slate-300" />
                                <div className="space-y-1">
                                    <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-slate-400">Sin unidades en tránsito</p>
                                    <Button asChild variant="ghost" size="sm" className="text-primary font-black uppercase text-[8px] sm:text-[9px] tracking-widest"><Link href="/dashboard/orders/new">Solicitar Nuevo Equipo</Link></Button>
                                </div>
                            </div>
                        )}
                    </AccordionContent>
                </AccordionItem>

                <AccordionItem value="history" className="border-none rounded-[1.8rem] sm:rounded-[2.5rem] bg-white shadow-sm ring-1 ring-slate-100 overflow-hidden opacity-80">
                    <AccordionTrigger className="px-6 sm:px-8 py-5 sm:py-6 hover:no-underline group">
                        <div className="flex items-center gap-4 sm:gap-5 text-left flex-1 min-w-0">
                            <div className="p-2.5 sm:p-3 rounded-xl sm:rounded-2xl bg-slate-50 text-slate-600 shrink-0">
                                <History className="h-5 sm:h-6 w-5 sm:w-6" />
                            </div>
                            <div className="space-y-0.5 flex-1 min-w-0">
                                <h3 className="text-sm sm:text-base font-black uppercase tracking-tight text-slate-900 truncate">Archivo Histórico</h3>
                                <p className="text-[8px] sm:text-[9px] text-muted-foreground font-black uppercase tracking-[0.2em] truncate">Entregas, cancelaciones y archivo</p>
                            </div>
                            <Badge variant="secondary" className="ml-auto mr-4 bg-slate-100 text-slate-600 font-black h-6 sm:h-7 px-2 sm:px-3 rounded-lg text-[10px] sm:text-xs shrink-0">{groups.history.length}</Badge>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-6 sm:px-8 pb-6 sm:pb-8 pt-2">
                        <div className="space-y-4">
                            <div className="relative max-w-sm">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <Input placeholder="BUSCAR POR ID..." className="pl-10 h-10 sm:h-11 bg-slate-50 border-none rounded-xl font-bold text-[9px] sm:text-10px uppercase shadow-inner" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                            </div>
                            <div className="rounded-[1.5rem] border border-slate-100 overflow-x-auto shadow-inner w-full">
                                <Table className="w-full">
                                    <TableHeader className="bg-slate-900 text-white">
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead className="text-[8px] sm:text-[9px] font-black uppercase pl-6 py-4">ID</TableHead>
                                            <TableHead className="text-[8px] sm:text-[9px] font-black uppercase">Fecha</TableHead>
                                            <TableHead className="text-center text-[8px] sm:text-[9px] font-black uppercase">Estado</TableHead>
                                            <TableHead className="text-right text-[8px] sm:text-[9px] font-black uppercase pr-6">Monto</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody className="bg-white">
                                        {groups.history.length > 0 ? (
                                            groups.history.map(order => (
                                                <TableRow key={order.id} className="cursor-pointer hover:bg-slate-50 transition-colors border-b last:border-none group" onClick={() => setSelectedOrder(order)}>
                                                    <TableCell className="font-mono text-[9px] sm:text-[10px] font-black text-primary py-4 pl-6">#{order.id.substring(0, 8)}</TableCell>
                                                    <TableCell className="text-[9px] sm:text-[10px] font-bold text-slate-500 whitespace-nowrap">{order.orderDate.toDate().toLocaleDateString('es-ES')}</TableCell>
                                                    <TableCell className="text-center">
                                                        <Badge variant="outline" className={cn("text-[7px] sm:text-[8px] font-black uppercase px-1.5 sm:px-2 h-5", order.status === 'Cancelado' ? 'border-rose-200 text-rose-600' : 'border-emerald-200 text-emerald-600')}>
                                                            {order.status}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right font-black text-slate-900 pr-6">${order.totalAmount.toFixed(2)}</TableCell>
                                                </TableRow>
                                            ))
                                        ) : <TableRow><TableCell colSpan={4} className="h-24 text-center italic text-[9px] sm:text-[10px] font-bold uppercase text-slate-400">Sin registros históricos.</TableCell></TableRow>}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>

            {selectedOrder && (
                <OrderSheetController 
                    order={selectedOrder} 
                    onOpenChange={(open) => !open && setSelectedOrder(null)} 
                />
            )}
        </div>
    );
}
