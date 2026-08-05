
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
import { Badge } from '@/components/ui/badge';

const ALL_STATUSES: OrderStatus[] = ['Borrador', 'Pendiente', 'Aprobado', 'En Preparación', 'Completado', 'Despachado', 'Entregado', 'En Verificación', 'Pagado', 'Cancelado'];

export default function AdminOrdersView() {
    const firestore = useFirestore();
    const { profile: currentUser } = useUser();
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<OrderStatus | 'todos'>('todos');
    const [sortBy, setSortBy] = useState<'orderDate' | 'totalAmount'>('orderDate');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    
    // OPTIMIZACIÓN: Carga dinámica e inmediata de órdenes
    const [queryLimit, setQueryLimit] = useState(50);
    const [activeTab, setActiveTab] = useState<'todos' | 'comercial' | 'operativo' | 'logistica' | 'cobranzas' | 'archivo'>('todos');

    const canListAll = useMemo(() => 
        currentUser && ['superadmin', 'admin', 'gerencia', 'deposito'].includes(currentUser.role),
    [currentUser]);

    const ordersQuery = useMemoFirebase(() => {
        if (!firestore || !canListAll) return null;
        const ordersRef = collection(firestore, 'orders');
        return query(ordersRef, orderBy(sortBy, sortOrder), limit(queryLimit));
    }, [firestore, canListAll, sortBy, sortOrder, queryLimit]);

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

    const allSections = [
        { key: 'solicitudes', label: 'Anulaciones en Trámite', icon: MessageCircle, color: 'amber', orders: groups.solicitudes, alert: true, tab: 'comercial' },
        { key: 'revisiones', label: 'Control de Stock', icon: AlertTriangle, color: 'rose', orders: groups.revisiones, alert: true, tab: 'operativo' },
        { key: 'borradores', label: 'Borradores', icon: Save, color: 'slate', orders: groups.borradores, tab: 'comercial' },
        { key: 'comercial', label: 'Gestión Comercial', icon: Clock, color: 'amber', orders: groups.comercial, tab: 'comercial' },
        { key: 'operativo', label: 'Logística Interna', icon: Package, color: 'indigo', orders: groups.operativo, tab: 'operativo' },
        { key: 'logistica', label: 'En Ruta', icon: Truck, color: 'sky', orders: groups.logistica, tab: 'logistica' },
        { key: 'cobranzas', label: 'Ciclo Financiero', icon: CreditCard, color: 'emerald', orders: groups.cobranzas, tab: 'cobranzas' },
        { key: 'archivo', label: 'Historial', icon: History, color: 'slate', orders: groups.archivo, tab: 'archivo' }
    ];

    const visibleSections = activeTab === 'todos' 
        ? allSections 
        : allSections.filter(s => s.tab === activeTab || (activeTab === 'comercial' && ['solicitudes', 'borradores', 'comercial'].includes(s.key)) || (activeTab === 'operativo' && ['revisiones', 'operativo'].includes(s.key)));

    return (
        <div className="flex flex-col gap-4 animate-in fade-in duration-500">
            {/* Pestañas de filtrado rápido por fase operativa */}
            <div className="flex bg-slate-100/80 p-1.5 rounded-2xl gap-1.5 overflow-x-auto custom-scrollbar border border-slate-200/60 shadow-sm">
                {[
                    { id: 'todos', label: 'Todos los Pedidos', count: allOrders?.length || 0 },
                    { id: 'comercial', label: 'Comercial / Pendientes', count: groups.comercial.length + groups.solicitudes.length + groups.borradores.length },
                    { id: 'operativo', label: 'Almacén / Preparación', count: groups.operativo.length + groups.revisiones.length },
                    { id: 'logistica', label: 'Despachados / En Ruta', count: groups.logistica.length },
                    { id: 'cobranzas', label: 'Entregados / Cobranzas', count: groups.cobranzas.length },
                    { id: 'archivo', label: 'Historial / Archivo', count: groups.archivo.length },
                ].map(tab => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id as any)}
                        className={cn(
                            "px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all whitespace-nowrap flex items-center gap-2 shrink-0",
                            activeTab === tab.id 
                                ? "bg-slate-900 text-white shadow-md" 
                                : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
                        )}
                    >
                        <span>{tab.label}</span>
                        <Badge variant="secondary" className={cn(
                            "font-mono text-[8px] px-1.5 py-0 h-4 rounded-md border-none font-bold",
                            activeTab === tab.id ? "bg-primary text-white" : "bg-slate-200 text-slate-700"
                        )}>
                            {tab.count}
                        </Badge>
                    </button>
                ))}
            </div>

            {/* Barra de Filtros y Ordenamiento */}
            <Card className="border-none shadow-sm rounded-2xl overflow-hidden bg-white">
                <CardContent className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="space-y-1">
                        <Label className="text-[7px] font-black uppercase tracking-widest text-slate-400">Búsqueda Táctica</Label>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                            <Input placeholder="REF / CLIENTE..." className="pl-8 h-8 text-[9px] font-bold uppercase rounded-lg border-none bg-slate-50 shadow-inner" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}/>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-[7px] font-black uppercase tracking-widest text-slate-400">Fase Operativa</Label>
                        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                            <SelectTrigger className="h-8 text-[9px] font-bold uppercase rounded-lg border-none bg-slate-50 shadow-inner">
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
                            <SelectTrigger className="h-8 text-[9px] font-bold uppercase rounded-lg border-none bg-slate-50 shadow-inner">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="orderDate" className="text-[9px] font-bold uppercase">Emisión</SelectItem>
                                <SelectItem value="totalAmount" className="text-[9px] font-bold uppercase">Inversión</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1 flex flex-col justify-end">
                        <Label className="text-[7px] font-black uppercase tracking-widest text-slate-400 mb-1">Orden Sentido</Label>
                        <div className="flex gap-1.5 w-full">
                            <Button variant={sortOrder === 'desc' ? 'default' : 'outline'} size="sm" className="h-8 flex-1 rounded-lg border-none font-bold text-[9px]" onClick={() => setSortOrder('desc')}>
                                <SortDesc className="h-3 w-3 mr-1" /> Descendente
                            </Button>
                            <Button variant={sortOrder === 'asc' ? 'default' : 'outline'} size="sm" className="h-8 flex-1 rounded-lg border-none font-bold text-[9px]" onClick={() => setSortOrder('asc')}>
                                <SortAsc className="h-3 w-3 mr-1" /> Ascendente
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Listado Principal de Pedidos en Vivo */}
            {isLoading && !allOrders ? (
                <div className="space-y-3 p-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 w-full rounded-2xl bg-white" />)}</div>
            ) : (
                <div className="space-y-4 pb-20">
                    <Accordion type="multiple" defaultValue={['solicitudes', 'revisiones', 'borradores', 'comercial', 'operativo', 'logistica', 'cobranzas', 'archivo']} className="space-y-3">
                        {visibleSections.map(section => (
                            <AccordionItem key={section.key} value={section.key} className={cn(
                                "border-none rounded-2xl bg-white ring-1 ring-slate-100 shadow-sm overflow-hidden transition-all", 
                                section.orders.length > 0 && section.alert && "ring-2 ring-amber-500/30 bg-amber-50/20"
                            )}>
                                <AccordionTrigger className="px-5 py-3 hover:no-underline">
                                    <div className="flex items-center gap-3 text-left">
                                        <div className={cn("p-2 rounded-xl", section.alert ? "bg-amber-100 text-amber-600" : `bg-${section.color}-50 text-${section.color}-500`)}>
                                            <section.icon className="h-4 w-4" />
                                        </div>
                                        <div className="space-y-0.5">
                                            <h3 className="text-[11px] font-black uppercase tracking-tight text-slate-900">{section.label}</h3>
                                            <p className="text-[8px] text-muted-foreground font-black uppercase tracking-[0.2em]">{section.orders.length} EXPEDIENTES EN COLA</p>
                                        </div>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="px-5 pb-4">
                                    {section.orders.length > 0 ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                            {section.orders.map(order => <OrderCard key={order.id} order={order} onSelect={setSelectedOrder} />)}
                                        </div>
                                    ) : <div className="h-12 flex items-center justify-center border-2 border-dashed rounded-xl opacity-30"><p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Sin expedientación activa en esta fase</p></div>}
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                    
                    {allOrders && allOrders.length >= queryLimit && (
                        <div className="flex justify-center pt-4">
                            <Button variant="ghost" onClick={() => setQueryLimit(prev => prev + 50)} className="font-black uppercase text-[8px] tracking-[0.3em] text-primary h-11 px-8 rounded-2xl border border-dashed border-primary/30 hover:bg-primary/5">
                                {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Plus className="h-3.5 w-3.5 mr-2" />}
                                Cargar Más Expedientes Comercial...
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {selectedOrder && <OrderSheetController order={selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)} />}
        </div>
    );
}
