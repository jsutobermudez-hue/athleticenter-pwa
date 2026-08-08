'use client';

import React, { useMemo, useState } from 'react';
import type { User, Order } from '@/lib/definitions';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, query, where, limit, orderBy, Timestamp } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { OrderCard } from './OrderCard';
import { OrderSheetController } from './OrderSheetController';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Clock, Package, Truck, CheckCircle, Search, AlertTriangle, SortAsc, SortDesc, Box, Save, History, DollarSign, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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

export default function UserOrdersView({ currentUser }: { currentUser: User }) {
    const firestore = useFirestore();
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('todos');
    const [sortBy, setSortBy] = useState<'orderDate' | 'totalAmount'>('orderDate');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [openSections, setOpenSections] = useState<string[]>([]);

    const ordersQuery = useMemoFirebase(() => {
        if (!firestore || !currentUser?.id) return null;
        
        const isClient = currentUser.role === 'cliente';
        const filterField = isClient ? 'customerId' : 'salespersonId';
        const filterValue = isClient 
            ? (currentUser.associatedCustomerId || currentUser.id) 
            : currentUser.id;
        
        return query(
            collection(firestore, 'orders'), 
            where(filterField, '==', filterValue),
            limit(150)
        );
    }, [firestore, currentUser?.id, currentUser?.role, currentUser?.associatedCustomerId]);

    const { data: rawOrders, isLoading, error } = useCollection<Order>(ordersQuery);

    // MÉTRICAS PIPELINE DE MI CARTERA
    const metrics = useMemo(() => {
        if (!rawOrders) return { totalVolume: 0, totalCount: 0, prepCount: 0, routeCount: 0, pendingDebt: 0 };
        
        let totalVolume = 0;
        let totalCount = 0;
        let prepCount = 0;
        let routeCount = 0;
        let pendingDebt = 0;

        rawOrders.forEach(o => {
            if (o.status !== 'Cancelado') {
                totalVolume += o.totalAmount || 0;
                totalCount++;
                const debt = Math.max(0, (o.totalAmount || 0) - (o.amountPaid || 0));
                pendingDebt += debt;
            }
            if (['Aprobado', 'En Preparación', 'Completado'].includes(o.status)) prepCount++;
            else if (o.status === 'Despachado') routeCount++;
        });

        return { totalVolume, totalCount, prepCount, routeCount, pendingDebt };
    }, [rawOrders]);

    const filteredAndSortedOrders = useMemo(() => {
        if (!rawOrders) return [];
        let items = [...rawOrders];
        
        const term = searchTerm.toLowerCase().trim();
        if (term) {
            items = items.filter(o => 
                o.id.toLowerCase().includes(term) || 
                o.customerName.toLowerCase().includes(term) ||
                (o.customerRif || '').toLowerCase().includes(term) ||
                (o.trackingNumber || '').toLowerCase().includes(term)
            );
        }

        if (statusFilter !== 'todos') {
            items = items.filter(o => o.status === statusFilter);
        }

        items.sort((a, b) => {
            let valA: any, valB: any;
            
            if (sortBy === 'orderDate') {
                valA = (a.orderDate as Timestamp)?.toMillis() || 0;
                valB = (b.orderDate as Timestamp)?.toMillis() || 0;
            } else {
                valA = a.totalAmount || 0;
                valB = b.totalAmount || 0;
            }

            if (sortOrder === 'asc') return valA - valB;
            return valB - valA;
        });

        return items;
    }, [rawOrders, searchTerm, statusFilter, sortBy, sortOrder]);

    const groups = useMemo(() => {
        const initial = { 
            borradores: [] as Order[],
            comercial: [] as Order[], 
            operativo: [] as Order[], 
            logistica: [] as Order[], 
            cerrado: [] as Order[] 
        };
        filteredAndSortedOrders.forEach(order => {
            if (order.status === 'Borrador') initial.borradores.push(order);
            else if (['Pendiente', 'Rechazado'].includes(order.status)) initial.comercial.push(order);
            else if (['Aprobado', 'En Preparación', 'Completado'].includes(order.status)) initial.operativo.push(order);
            else if (['Despachado'].includes(order.status)) initial.logistica.push(order);
            else initial.cerrado.push(order);
        });
        return initial;
    }, [filteredAndSortedOrders]);

    if (isLoading) {
        return (
            <div className="space-y-4 px-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-16 text-center flex flex-col items-center justify-center gap-3">
                <AlertTriangle className="h-10 w-10 text-destructive" />
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Error al cargar expedientes de pedidos.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 w-full animate-in fade-in duration-500">
            {/* TARJETAS KPI */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mx-1 sm:mx-2">
                <DashboardMetricCard 
                    title="Mis Pedidos Totales" 
                    value={`$${metrics.totalVolume.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} 
                    subtitle={`${metrics.totalCount} Expedientes Activos`} 
                    icon={DollarSign} 
                    iconBg="bg-blue-50" 
                    iconColor="text-blue-500" 
                    onClick={() => setStatusFilter('todos')}
                    isActive={statusFilter === 'todos'}
                />
                <DashboardMetricCard 
                    title="En Preparación" 
                    value={metrics.prepCount} 
                    subtitle="En Almacén / Empaque" 
                    icon={Package} 
                    iconBg="bg-indigo-50" 
                    iconColor="text-indigo-600" 
                    onClick={() => setStatusFilter('En Preparación')}
                    isActive={statusFilter === 'En Preparación'}
                />
                <DashboardMetricCard 
                    title="Despachados / En Ruta" 
                    value={metrics.routeCount} 
                    subtitle="Camino a Destino" 
                    icon={Truck} 
                    iconBg="bg-sky-50" 
                    iconColor="text-sky-600" 
                    onClick={() => setStatusFilter('Despachado')}
                    isActive={statusFilter === 'Despachado'}
                />
                <DashboardMetricCard 
                    title="Saldo Pendiente ($)" 
                    value={`$${metrics.pendingDebt.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} 
                    subtitle="Por Cancelar" 
                    icon={Wallet} 
                    iconBg="bg-rose-50" 
                    iconColor="text-rose-600" 
                    onClick={() => setStatusFilter('Entregado')}
                    isActive={statusFilter === 'Entregado'}
                />
            </div>

            {/* FILTROS TÁCTICOS */}
            <Card className="border-none shadow-sm rounded-2xl overflow-hidden bg-white mx-1 sm:mx-2">
                <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                    <div className="space-y-1">
                        <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Búsqueda Directa</Label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                            <Input placeholder="BUSCAR PEDIDO / RIF / GUÍA..." className="pl-9 h-10 text-[10px] font-bold uppercase rounded-xl border-none bg-slate-50 shadow-inner" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}/>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Ordenar por</Label>
                        <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                            <SelectTrigger className="h-10 text-[10px] font-bold uppercase rounded-xl border-none bg-slate-50 shadow-inner">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="orderDate" className="text-[10px] font-bold uppercase">Fecha Emisión</SelectItem>
                                <SelectItem value="totalAmount" className="text-[10px] font-bold uppercase">Inversión Total</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex gap-2">
                        <Button variant={sortOrder === 'desc' ? 'default' : 'outline'} size="sm" className="h-10 flex-1 rounded-xl border-slate-100 font-bold text-[9px] uppercase tracking-wider" onClick={() => setSortOrder('desc')}>
                            <SortDesc className="h-3.5 w-3.5 mr-1" /> DESC
                        </Button>
                        <Button variant={sortOrder === 'asc' ? 'default' : 'outline'} size="sm" className="h-10 flex-1 rounded-xl border-slate-100 font-bold text-[9px] uppercase tracking-wider" onClick={() => setSortOrder('asc')}>
                            <SortAsc className="h-3.5 w-3.5 mr-1" /> ASC
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Accordion type="multiple" value={openSections} onValueChange={setOpenSections} className="space-y-3 mx-1 sm:mx-2 pb-20">
                {[
                    { key: 'borradores', label: 'Borradores en Curso', icon: Save, color: 'slate', orders: groups.borradores, desc: 'En armado' },
                    { key: 'comercial', label: 'Pendientes de Validación', icon: Clock, color: 'amber', orders: groups.comercial, desc: 'Esperando aprobación' },
                    { key: 'operativo', label: 'Logística e Imprimación', icon: Package, color: 'indigo', orders: groups.operativo, desc: 'En Almacén' },
                    { key: 'logistica', label: 'Despachados / En Ruta', icon: Truck, color: 'sky', orders: groups.logistica, desc: 'Camino a Destino' },
                    { key: 'cerrado', label: 'Historial de Entregas', icon: CheckCircle, color: 'emerald', orders: groups.cerrado, desc: 'Entregados y Liquidados' }
                ].map(section => (
                    <AccordionItem key={section.key} value={section.key} className="border-none rounded-2xl bg-white ring-1 ring-slate-100 shadow-sm overflow-hidden transition-all">
                        <AccordionTrigger className="px-5 py-4 hover:no-underline">
                            <div className="flex items-center gap-3 text-left w-full mr-2">
                                <div className={cn("p-2 rounded-xl shadow-sm", `bg-${section.color}-50 text-${section.color}-600`)}>
                                    <section.icon className="h-4.5 w-4.5" />
                                </div>
                                <div className="space-y-0.5">
                                    <h3 className="text-xs font-black uppercase tracking-tight text-slate-900">{section.label}</h3>
                                    <p className="text-[8px] text-muted-foreground font-black uppercase tracking-[0.2em]">{section.desc}</p>
                                </div>
                                <Badge variant="secondary" className="ml-auto bg-slate-100 text-slate-600 font-black h-6 px-2.5 rounded-lg text-[10px]">
                                    {section.orders.length}
                                </Badge>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-5 pb-5">
                            {section.orders.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {section.orders.map(order => <OrderCard key={order.id} order={order} onSelect={setSelectedOrder} />)}
                                </div>
                            ) : (
                                <div className="h-14 flex items-center justify-center border-2 border-dashed rounded-2xl opacity-30">
                                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Sin expedientes en esta categoría</p>
                                </div>
                            )}
                        </AccordionContent>
                    </AccordionItem>
                ))}
            </Accordion>

            {selectedOrder && <OrderSheetController order={selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)} />}
        </div>
    );
}
