'use client';

import React, { useMemo, useState } from 'react';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import type { Order, OrderStatus } from '@/lib/definitions';
import { Skeleton } from '@/components/ui/skeleton';
import { OrderCard } from './OrderCard';
import { OrderSheetController } from './OrderSheetController';
import { Card, CardContent } from '@/components/ui/card';
import { Search, Clock, Package, Truck, History, CreditCard, SortAsc, SortDesc, Save, AlertTriangle, MessageCircle, ShieldCheck, Loader2, Plus, DollarSign, Wallet, ArrowUpRight, Download } from 'lucide-react';
import { format } from 'date-fns';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const ALL_STATUSES: OrderStatus[] = ['Borrador', 'Pendiente', 'Aprobado', 'En Preparación', 'Completado', 'Despachado', 'Entregado', 'En Verificación', 'Pagado', 'Cancelado'];

function DashboardMetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconBg,
  iconColor,
  onClick,
  isActive
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  onClick?: () => void;
  isActive?: boolean;
}) {
  return (
    <Card 
      onClick={onClick}
      className={cn(
        "border-none shadow-sm rounded-2xl bg-white p-5 flex items-center justify-between transition-all cursor-pointer hover:shadow-md hover:-translate-y-0.5",
        isActive && "ring-2 ring-primary bg-primary/5"
      )}
    >
      <div className="space-y-1">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</p>
        <h3 className="text-2xl font-black uppercase tracking-tight text-slate-900">{value}</h3>
        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{subtitle}</p>
      </div>
      <div className={cn("p-3 rounded-2xl shrink-0 shadow-sm", iconBg, iconColor)}>
        <Icon className="h-6 w-6" />
      </div>
    </Card>
  );
}

export default function AdminOrdersView() {
    const firestore = useFirestore();
    const { profile: currentUser } = useUser();
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<OrderStatus | 'todos'>('todos');
    const [salespersonFilter, setSalespersonFilter] = useState('todos');
    const [sortBy, setSortBy] = useState<'orderDate' | 'totalAmount'>('orderDate');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [openSections, setOpenSections] = useState<string[]>([]);
    
    const [queryLimit, setQueryLimit] = useState(100);
    const [activeTab, setActiveTab] = useState<'todos' | 'comercial' | 'operativo' | 'logistica' | 'cobranzas' | 'archivo'>('todos');
    const [dateFilter, setDateFilter] = useState<'todos' | 'today' | '7d' | 'this_month' | 'last_month'>('todos');

    const canListAll = useMemo(() => 
        currentUser && ['superadmin', 'admin', 'gerencia', 'deposito'].includes(currentUser.role),
    [currentUser]);

    const ordersQuery = useMemoFirebase(() => {
        if (!firestore || !canListAll) return null;
        const ordersRef = collection(firestore, 'orders');
        return query(ordersRef, orderBy(sortBy, sortOrder), limit(queryLimit));
    }, [firestore, canListAll, sortBy, sortOrder, queryLimit]);

    const { data: allOrders, isLoading } = useCollection<Order>(ordersQuery);

    // VENDEDORES ÚNICOS PARA FILTRO DE GERENCIA
    const uniqueSalespeople = useMemo(() => {
        if (!allOrders) return [];
        return Array.from(new Set(allOrders.map(o => o.salespersonName))).filter((sp): sp is string => Boolean(sp)).sort();
    }, [allOrders]);

    // MÉTRICAS EJECUTIVAS DE PEDIDOS
    const metrics = useMemo(() => {
        if (!allOrders) return { totalVolume: 0, totalCount: 0, prepCount: 0, prepTotal: 0, routeCount: 0, routeTotal: 0, pendingDebt: 0 };

        let totalVolume = 0;
        let totalCount = 0;
        let prepCount = 0;
        let prepTotal = 0;
        let routeCount = 0;
        let routeTotal = 0;
        let pendingDebt = 0;

        allOrders.forEach(o => {
            if (o.status !== 'Cancelado') {
                totalVolume += o.totalAmount || 0;
                totalCount++;
                const debt = Math.max(0, (o.totalAmount || 0) - (o.amountPaid || 0));
                pendingDebt += debt;
            }

            if (['Aprobado', 'En Preparación', 'Completado'].includes(o.status)) {
                prepCount++;
                prepTotal += o.totalAmount || 0;
            } else if (o.status === 'Despachado') {
                routeCount++;
                routeTotal += o.totalAmount || 0;
            }
        });

        return { totalVolume, totalCount, prepCount, prepTotal, routeCount, routeTotal, pendingDebt };
    }, [allOrders]);

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
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        const filtered = allOrders.filter(o => {
            const matchesSearch = o.id.toLowerCase().includes(term) || o.customerName.toLowerCase().includes(term) || (o.customerRif || '').toLowerCase().includes(term) || (o.trackingNumber || '').toLowerCase().includes(term);
            const matchesStatus = statusFilter === 'todos' || o.status === statusFilter;
            const matchesSalesperson = salespersonFilter === 'todos' || o.salespersonName === salespersonFilter;
            
            let matchesDate = true;
            if (dateFilter !== 'todos') {
                let oDate: Date | null = null;
                const rawDate = o.orderDate || o.createdAt || o.approvalDate;
                if (rawDate) {
                    if (typeof (rawDate as any).toDate === 'function') oDate = (rawDate as any).toDate();
                    else if ((rawDate as any).seconds) oDate = new Date((rawDate as any).seconds * 1000);
                    else oDate = new Date(rawDate as any);
                }
                if (oDate && !isNaN(oDate.getTime())) {
                    if (dateFilter === 'today') {
                        matchesDate = oDate.getDate() === now.getDate() && oDate.getMonth() === currentMonth && oDate.getFullYear() === currentYear;
                    } else if (dateFilter === '7d') {
                        const start7d = new Date();
                        start7d.setDate(now.getDate() - 7);
                        matchesDate = oDate >= start7d;
                    } else if (dateFilter === 'this_month') {
                        matchesDate = oDate.getMonth() === currentMonth && oDate.getFullYear() === currentYear;
                    } else if (dateFilter === 'last_month') {
                        const lastM = currentMonth === 0 ? 11 : currentMonth - 1;
                        const lastY = currentMonth === 0 ? currentYear - 1 : currentYear;
                        matchesDate = oDate.getMonth() === lastM && oDate.getFullYear() === lastY;
                    }
                }
            }

            return matchesSearch && matchesStatus && matchesSalesperson && matchesDate;
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
    }, [allOrders, searchTerm, statusFilter, salespersonFilter, dateFilter]);

    const exportOrdersToCSV = () => {
        if (!allOrders || allOrders.length === 0) return;
        const bcvRate = 65.50;
        const headers = ['Pedido ID', 'Cliente', 'Asesor Comercial', 'Estado', 'Monto USD', 'Monto Bs (BCV)'];
        const rows = allOrders.map(o => [
            o.id,
            `"${(o.customerName || '').replace(/"/g, '""')}"`,
            `"${(o.salespersonName || 'Directo').replace(/"/g, '""')}"`,
            o.status,
            (o.totalAmount || 0).toFixed(2),
            ((o.totalAmount || 0) * bcvRate).toFixed(2)
        ]);
        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `Ventas_y_Pedidos_Athleticenter_${format(new Date(), 'yyyy-MM-dd')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (!canListAll) return <div className="p-12 text-center opacity-40 italic font-black uppercase tracking-widest text-[10px]">Acceso restringido a Gerencia y Logística.</div>;

    const allSections = [
        { key: 'solicitudes', label: 'Anulaciones en Trámite', icon: MessageCircle, color: 'amber', orders: groups.solicitudes, alert: true, tab: 'comercial' },
        { key: 'revisiones', label: 'Control de Stock', icon: AlertTriangle, color: 'rose', orders: groups.revisiones, alert: true, tab: 'operativo' },
        { key: 'borradores', label: 'Borradores', icon: Save, color: 'slate', orders: groups.borradores, tab: 'comercial' },
        { key: 'comercial', label: 'Gestión Comercial', icon: Clock, color: 'amber', orders: groups.comercial, tab: 'comercial' },
        { key: 'operativo', label: 'Logística Interna / Almacén', icon: Package, color: 'indigo', orders: groups.operativo, tab: 'operativo' },
        { key: 'logistica', label: 'Despachados / En Ruta', icon: Truck, color: 'sky', orders: groups.logistica, tab: 'logistica' },
        { key: 'cobranzas', label: 'Ciclo Financiero / Entregados', icon: CreditCard, color: 'emerald', orders: groups.cobranzas, tab: 'cobranzas' },
        { key: 'archivo', label: 'Historial', icon: History, color: 'slate', orders: groups.archivo, tab: 'archivo' }
    ];

    const visibleSections = activeTab === 'todos' 
        ? allSections 
        : allSections.filter(s => s.tab === activeTab || (activeTab === 'comercial' && ['solicitudes', 'borradores', 'comercial'].includes(s.key)) || (activeTab === 'operativo' && ['revisiones', 'operativo'].includes(s.key)));

    return (
        <div className="flex flex-col gap-6 animate-in fade-in duration-500">
            {/* TARJETAS KPI DE PEDIDOS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mx-1 sm:mx-2">
                <DashboardMetricCard 
                    title="Volumen Facturado ($)" 
                    value={`$${metrics.totalVolume.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} 
                    subtitle={`${metrics.totalCount} Pedidos Procesados`} 
                    icon={DollarSign} 
                    iconBg="bg-blue-50" 
                    iconColor="text-blue-500" 
                    onClick={() => { setActiveTab('todos'); setStatusFilter('todos'); setSalespersonFilter('todos'); }}
                    isActive={activeTab === 'todos' && statusFilter === 'todos'}
                />
                <DashboardMetricCard 
                    title="En Almacén / Empaque" 
                    value={metrics.prepCount} 
                    subtitle={`$${metrics.prepTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })} En Preparación`} 
                    icon={Package} 
                    iconBg="bg-indigo-50" 
                    iconColor="text-indigo-600" 
                    onClick={() => setActiveTab('operativo')}
                    isActive={activeTab === 'operativo'}
                />
                <DashboardMetricCard 
                    title="Despachados en Ruta" 
                    value={metrics.routeCount} 
                    subtitle={`$${metrics.routeTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })} En Tránsito`} 
                    icon={Truck} 
                    iconBg="bg-sky-50" 
                    iconColor="text-sky-600" 
                    onClick={() => setActiveTab('logistica')}
                    isActive={activeTab === 'logistica'}
                />
                <DashboardMetricCard 
                    title="Por Cobrar ($)" 
                    value={`$${metrics.pendingDebt.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} 
                    subtitle="Saldo Pendiente de Cobro" 
                    icon={Wallet} 
                    iconBg="bg-rose-50" 
                    iconColor="text-rose-600" 
                    onClick={() => setActiveTab('cobranzas')}
                    isActive={activeTab === 'cobranzas'}
                />
            </div>

            {/* Pestañas de filtrado rápido por fase operativa */}
            <div className="flex bg-slate-100/80 p-1.5 rounded-2xl gap-1.5 overflow-x-auto custom-scrollbar border border-slate-200/60 shadow-sm mx-1 sm:mx-2">
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

            {/* Barra de Filtros y Ordenamiento con Selector de Periodo */}
            <Card className="border-none shadow-sm rounded-2xl overflow-hidden bg-white mx-1 sm:mx-2">
                <CardContent className="p-4 space-y-4">
                    {/* FILTROS RÁPIDOS DE PERÍODOS DE VENTA Y EXPORTACIÓN */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 mr-1">Periodo:</span>
                            {[
                                { id: 'todos', label: '🌐 Todo el Histórico' },
                                { id: 'today', label: '☀️ Hoy' },
                                { id: '7d', label: '⚡ Últimos 7 Días' },
                                { id: 'this_month', label: '🗓️ Mes Actual' },
                                { id: 'last_month', label: '📅 Mes Anterior' },
                            ].map(p => (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => setDateFilter(p.id as any)}
                                    className={cn(
                                        "px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer border",
                                        dateFilter === p.id 
                                            ? "bg-slate-900 text-white border-slate-900 shadow-sm" 
                                            : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                                    )}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                        <Button
                            onClick={exportOrdersToCSV}
                            variant="outline"
                            className="h-8 px-3 rounded-xl border-slate-200 bg-white hover:bg-slate-50 text-slate-900 text-[9px] font-black uppercase tracking-wider shadow-sm flex items-center gap-1.5 ml-auto"
                        >
                            <Download className="h-3.5 w-3.5 text-primary" /> Exportar a Excel
                        </Button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                        <div className="space-y-1">
                            <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Búsqueda Táctica</Label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                <Input placeholder="REF / CLIENTE / RIF / GUÍA..." className="pl-9 h-10 text-[10px] font-bold uppercase rounded-xl border-none bg-slate-50 shadow-inner" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}/>
                            </div>
                        </div>

                    {uniqueSalespeople.length > 0 && (
                        <div className="space-y-1">
                            <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Asesor Comercial</Label>
                            <Select value={salespersonFilter} onValueChange={setSalespersonFilter}>
                                <SelectTrigger className="h-10 text-[10px] font-bold uppercase rounded-xl border-none bg-slate-50 shadow-inner">
                                    <SelectValue placeholder="Todos" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="todos" className="text-[10px] font-bold uppercase">ASESOR: TODOS</SelectItem>
                                    {uniqueSalespeople.map(sp => (
                                        <SelectItem key={sp} value={sp} className="text-[10px] font-bold uppercase">{sp.toUpperCase()}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className="space-y-1">
                        <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Estatus Exacto</Label>
                        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                            <SelectTrigger className="h-10 text-[10px] font-bold uppercase rounded-xl border-none bg-slate-50 shadow-inner">
                                <SelectValue placeholder="Todos" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="todos" className="text-[10px] font-bold uppercase">TODOS LOS ESTADOS</SelectItem>
                                {ALL_STATUSES.map(s => <SelectItem key={s} value={s} className="text-[10px] font-bold uppercase">{s.toUpperCase()}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Ordenar por</Label>
                        <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                            <SelectTrigger className="h-10 text-[10px] font-bold uppercase rounded-xl border-none bg-slate-50 shadow-inner">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="orderDate" className="text-[10px] font-bold uppercase">Fecha Emisión</SelectItem>
                                <SelectItem value="totalAmount" className="text-[10px] font-bold uppercase">Monto Inversión</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Orden Sentido</Label>
                        <div className="flex gap-1.5 w-full">
                            <Button variant={sortOrder === 'desc' ? 'default' : 'outline'} size="sm" className="h-10 flex-1 rounded-xl border-slate-100 font-bold text-[9px] uppercase tracking-wider" onClick={() => setSortOrder('desc')}>
                                <SortDesc className="h-3.5 w-3.5 mr-1" /> DESC
                            </Button>
                            <Button variant={sortOrder === 'asc' ? 'default' : 'outline'} size="sm" className="h-10 flex-1 rounded-xl border-slate-100 font-bold text-[9px] uppercase tracking-wider" onClick={() => setSortOrder('asc')}>
                                <SortAsc className="h-3.5 w-3.5 mr-1" /> ASC
                            </Button>
                        </div>
                    </div>
                    </div>
                </CardContent>
            </Card>

            {/* Listado Principal de Pedidos en Vivo */}
            {isLoading && !allOrders ? (
                <div className="space-y-3 p-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 w-full rounded-2xl bg-white" />)}</div>
            ) : (
                <div className="space-y-4 pb-20 mx-1 sm:mx-2">
                    <Accordion type="multiple" value={openSections} onValueChange={setOpenSections} className="space-y-3">
                        {visibleSections.map(section => (
                            <AccordionItem key={section.key} value={section.key} className={cn(
                                "border-none rounded-2xl bg-white ring-1 ring-slate-100 shadow-sm overflow-hidden transition-all", 
                                section.orders.length > 0 && section.alert && "ring-2 ring-rose-500/40 bg-rose-50/10"
                            )}>
                                <AccordionTrigger className="px-5 py-4 hover:no-underline">
                                    <div className="flex items-center gap-3 text-left w-full mr-2">
                                        <div className={cn("p-2 rounded-xl shadow-sm", section.alert && section.orders.length > 0 ? "bg-rose-100 text-rose-600" : `bg-${section.color}-50 text-${section.color}-600`)}>
                                            <section.icon className="h-4.5 w-4.5" />
                                        </div>
                                        <div className="space-y-0.5">
                                            <h3 className="text-xs font-black uppercase tracking-tight text-slate-900">{section.label}</h3>
                                            <p className="text-[8px] text-muted-foreground font-black uppercase tracking-[0.2em]">{section.orders.length} EXPEDIENTES EN COLA</p>
                                        </div>
                                        {section.orders.length > 0 && section.alert && (
                                            <Badge variant="destructive" className="ml-auto bg-rose-600 text-white font-black text-[9px] uppercase px-2.5 py-0.5 rounded-lg animate-pulse shadow-sm flex items-center gap-1">
                                                <AlertTriangle className="h-3 w-3" /> REVISIÓN REQUERIDA ({section.orders.length})
                                            </Badge>
                                        )}
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="px-5 pb-5">
                                    {section.orders.length > 0 ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                            {section.orders.map(order => <OrderCard key={order.id} order={order} onSelect={setSelectedOrder} />)}
                                        </div>
                                    ) : <div className="h-14 flex items-center justify-center border-2 border-dashed rounded-2xl opacity-30"><p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Sin expedientación activa en esta fase</p></div>}
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
