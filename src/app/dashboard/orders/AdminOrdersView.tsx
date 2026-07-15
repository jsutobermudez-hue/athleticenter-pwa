
'use client';

import React, { useMemo, useState } from 'react';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import type { Order, OrderStatus } from '@/lib/definitions';
import { Skeleton } from '@/components/ui/skeleton';
import { OrderCard } from './OrderCard';
import { OrderSheetController } from './OrderSheetController';
import { Card, CardContent } from '@/components/ui/card';
import { Search, Clock, Package, Truck, History, CreditCard, SortAsc, SortDesc, Save, AlertTriangle, MessageCircle, ShieldCheck, Loader2, Plus } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const ALL_STATUSES: OrderStatus[] = ['Borrador', 'Pendiente', 'Aprobado', 'En Preparación', 'Completado', 'Despachado', 'Entregado', 'En Verificación', 'Pagado', 'Cancelado'];

export default function AdminOrdersView() {
    const firestore = useFirestore();
    const { profile: currentUser } = useUser();
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<OrderStatus | 'todos'>('todos');
    const [sortBy, setSortBy] = useState<'orderDate' | 'totalAmount'>('orderDate');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    
    // OPTIMIZACIÓN: Paginación dinámica para órdenes
    const [queryLimit, setQueryLimit] = useState(50);
    const [shouldLoad, setShouldLoad] = useState(false);

    const canListAll = useMemo(() => 
        currentUser && ['superadmin', 'admin', 'gerencia', 'deposito'].includes(currentUser.role),
    [currentUser]);

    const ordersQuery = useMemoFirebase(() => {
        if (!firestore || !canListAll || (!shouldLoad && !searchTerm)) return null;
        const ordersRef = collection(firestore, 'orders');
        return query(ordersRef, orderBy(sortBy, sortOrder), limit(queryLimit));
    }, [firestore, canListAll, sortBy, sortOrder, shouldLoad, searchTerm, queryLimit]);

    const { data: allOrders, isLoading } = useCollection<Order>(ordersQuery);

    const groups = useMemo(() => {
        const initial = { 
            solicitudes: [] as Order[],
            revisiones: [] as Order[],
            borradores: [] as Order[],
            comercial: [] as Order[], 
            operativo: [] as Order[], 
            logistica: [] as Order[], 
            cobranzas: [] as Order[], 
            archivo: [] as Order[] 
        };
        if (!allOrders) return initial;
        
        const term = searchTerm.toLowerCase().trim();
        const filtered = allOrders.filter(o => {
            const matchesSearch = o.id.toLowerCase().includes(term) || o.customerName.toLowerCase().includes(term);
            const matchesStatus = statusFilter === 'todos' || o.status === statusFilter;
            return matchesSearch && matchesStatus;
        });

        filtered.forEach(order => {
            if (order.cancellationRequested === true && order.status !== 'Cancelado') {
                initial.solicitudes.push(order);
            } else if (order.status === 'Cancelado' && order.stockRestored === false) {
                initial.revisiones.push(order);
            } else if (order.status === 'Borrador') {
                initial.borradores.push(order);
            } else if (order.status === 'Pendiente') {
                initial.comercial.push(order);
            } else if (['Aprobado', 'En Preparación', 'Completado'].includes(order.status)) {
                initial.operativo.push(order);
            } else if (order.status === 'Despachado') {
                initial.logistica.push(order);
            } else if (['Entregado', 'En Verificación'].includes(order.status)) {
                initial.cobranzas.push(order);
            } else {
                initial.archivo.push(order);
            }
        });
        return initial;
    }, [allOrders, searchTerm, statusFilter]);

    if (!canListAll) return <div className="p-12 text-center opacity-40 italic font-black uppercase tracking-widest text-[10px]">Acceso restringido.</div>;

    return (
        <div className="flex flex-col gap-4">
            <Card className="border-none shadow-none rounded-2xl overflow-hidden bg-white/50 backdrop-blur-sm">
                <CardContent className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="space-y-1">
                        <Label className="text-[7px] font-black uppercase tracking-widest text-slate-400">Búsqueda Táctica</Label>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                            <Input placeholder="REF / CLIENTE..." className="pl-8 h-8 text-[9px] font-bold uppercase rounded-lg border-none bg-white shadow-inner" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}/>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-[7px] font-black uppercase tracking-widest text-slate-400">Fase Operativa</Label>
                        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                            <SelectTrigger className="h-8 text-[9px] font-bold uppercase rounded-lg border-none bg-white shadow-inner">
                                <SelectValue placeholder="Todos" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="todos" className="text-[9px] font-bold uppercase">Todos</SelectItem>
                                {ALL_STATUSES.map(s => <SelectItem key={s} value={s} className="text-[9px] font-bold uppercase">{s}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-[7px] font-black uppercase tracking-widest text-slate-400">Ordenar por</Label>
                        <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                            <SelectTrigger className="h-8 text-[9px] font-bold uppercase rounded-lg border-none bg-white shadow-inner">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="orderDate" className="text-[9px] font-bold uppercase">Emisión</SelectItem>
                                <SelectItem value="totalAmount" className="text-[9px] font-bold uppercase">Inversión</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-end gap-2">
                        {!shouldLoad && !searchTerm ? (
                            <Button onClick={() => setShouldLoad(true)} className="h-8 w-full bg-primary text-white font-black uppercase text-[8px] tracking-widest rounded-lg">
                                <Loader2 className="h-3 w-3 mr-1" /> CARGAR REGISTROS
                            </Button>
                        ) : (
                            <div className="flex gap-1 w-full">
                                <Button variant={sortOrder === 'desc' ? 'default' : 'outline'} size="sm" className="h-8 flex-1 rounded-lg border-none" onClick={() => setSortOrder('desc')}>
                                    <SortDesc className="h-3 w-3" />
                                </Button>
                                <Button variant={sortOrder === 'asc' ? 'default' : 'outline'} size="sm" className="h-8 flex-1 rounded-lg border-none" onClick={() => setSortOrder('asc')}>
                                    <SortAsc className="h-3 w-3" />
                                </Button>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {isLoading && allOrders === null ? (
                <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
            ) : !shouldLoad && !searchTerm ? (
                <div className="py-20 text-center flex flex-col items-center justify-center gap-4 opacity-30">
                    <ShieldCheck className="h-12 w-12 text-slate-300" />
                    <p className="text-[10px] font-black uppercase tracking-[0.3em]">Protocolo de seguridad activo. Realiza una búsqueda para visualizar datos.</p>
                </div>
            ) : (
                <div className="space-y-4 pb-20">
                    <Accordion type="multiple" defaultValue={['comercial', 'operativo']} className="space-y-2">
                        {[
                            { key: 'solicitudes', label: 'Anulaciones en Trámite', icon: MessageCircle, color: 'amber', orders: groups.solicitudes, alert: true },
                            { key: 'revisiones', label: 'Control de Stock', icon: AlertTriangle, color: 'rose', orders: groups.revisiones, alert: true },
                            { key: 'borradores', label: 'Borradores', icon: Save, color: 'slate', orders: groups.borradores },
                            { key: 'comercial', label: 'Gestión Comercial', icon: Clock, color: 'amber', orders: groups.comercial },
                            { key: 'operativo', label: 'Logística Interna', icon: Package, color: 'indigo', orders: groups.operativo },
                            { key: 'logistica', label: 'En Ruta', icon: Truck, color: 'sky', orders: groups.logistica },
                            { key: 'cobranzas', label: 'Ciclo Financiero', icon: CreditCard, color: 'emerald', orders: groups.cobranzas },
                            { key: 'archivo', label: 'Historial', icon: History, color: 'slate', orders: groups.archivo }
                        ].map(section => (
                            <AccordionItem key={section.key} value={section.key} className={cn(
                                "border-none rounded-xl bg-white ring-1 ring-primary/5 shadow-sm overflow-hidden", 
                                section.orders.length > 0 && section.alert && "ring-2 ring-amber-500/20 bg-amber-50/10"
                            )}>
                                <AccordionTrigger className="px-4 py-2.5 hover:no-underline">
                                    <div className="flex items-center gap-3 text-left">
                                        <div className={cn("p-1.5 rounded-lg", section.alert ? "bg-amber-100 text-amber-600" : `bg-${section.color}-50 text-${section.color}-500`)}>
                                            <section.icon className="h-3.5 w-3.5" />
                                        </div>
                                        <div className="space-y-0.5">
                                            <h3 className="text-[9px] font-black uppercase tracking-tight text-slate-900">{section.label}</h3>
                                            <p className="text-[6px] text-muted-foreground font-black uppercase tracking-[0.2em]">{section.orders.length} EXPEDIENTES</p>
                                        </div>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="px-3 pb-3">
                                    {section.orders.length > 0 ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                                            {section.orders.map(order => <OrderCard key={order.id} order={order} onSelect={setSelectedOrder} />)}
                                        </div>
                                    ) : <div className="h-8 flex items-center justify-center border-2 border-dashed rounded-lg opacity-20"><p className="text-[7px] font-black uppercase">Sin actividad</p></div>}
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                    
                    {allOrders && allOrders.length >= queryLimit && (
                        <div className="flex justify-center">
                            <Button variant="ghost" onClick={() => setQueryLimit(prev => prev + 50)} className="font-black uppercase text-[8px] tracking-[0.3em] text-primary h-10 px-8 rounded-xl border border-dashed border-primary/20">
                                {isLoading ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <Plus className="h-3 w-3 mr-2" />}
                                Cargar Más Expedientes...
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {selectedOrder && <OrderSheetController order={selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)} />}
        </div>
    );
}
