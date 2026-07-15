'use client';

import React, { useMemo, useState } from 'react';
import type { User, Order } from '@/lib/definitions';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, query, where, limit, orderBy, Timestamp } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { OrderCard } from './OrderCard';
import { OrderSheetController } from './OrderSheetController';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Clock, Package, Truck, CheckCircle, Search, AlertTriangle, SortAsc, SortDesc, Box, Save, History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function UserOrdersView({ currentUser }: { currentUser: User }) {
    const firestore = useFirestore();
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState<'orderDate' | 'totalAmount'>('orderDate');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

    const ordersQuery = useMemoFirebase(() => {
        if (!firestore || !currentUser?.id) return null;
        
        // B2B: Los clientes (empleados) deben consultar usando el ID corporativo
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

    const filteredAndSortedOrders = useMemo(() => {
        if (!rawOrders) return [];
        let items = [...rawOrders];
        
        const term = searchTerm.toLowerCase().trim();
        if (term) {
            items = items.filter(o => 
                o.id.toLowerCase().includes(term) || 
                o.customerName.toLowerCase().includes(term)
            );
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
    }, [rawOrders, searchTerm, sortBy, sortOrder]);

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
            <div className="p-16 sm:p-24 text-center flex flex-col items-center justify-center gap-6 animate-in fade-in duration-700">
                <div className="p-6 rounded-full bg-rose-50 text-rose-500 shadow-inner">
                    <AlertTriangle className="h-12 w-12" />
                </div>
                <div className="space-y-2">
                    <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900">Sincronización en curso</h3>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest max-w-xs mx-auto">
                        Estamos optimizando la base de datos para tu cuenta. Por favor, espera un minuto mientras los índices se activan.
                    </p>
                </div>
                <Button onClick={() => window.location.reload()} className="h-11 px-8 rounded-xl font-black uppercase tracking-widest text-[10px]">
                    Recargar Terminal
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 w-full animate-in fade-in-50 duration-500">
            <Card className="border-none shadow-sm rounded-[1.8rem] sm:rounded-[2rem] bg-white overflow-hidden mx-1 sm:mx-2">
                <CardContent className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 items-end">
                    <div className="space-y-2">
                        <Label className="text-[9px] sm:text-[10px] font-black uppercase text-slate-400 tracking-widest px-1">Búsqueda Táctica</Label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input placeholder="PEDIDO O REFERENCIA..." className="pl-10 h-10 sm:h-11 bg-slate-50 border-none rounded-xl font-bold text-[11px] sm:text-xs uppercase shadow-inner" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label className="text-[9px] sm:text-[10px] font-black uppercase text-slate-400 tracking-widest px-1">Criterio de Orden</Label>
                        <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                            <SelectTrigger className="h-10 sm:h-11 bg-slate-50 border-none rounded-xl font-bold uppercase text-[10px] shadow-inner"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="orderDate" className="font-bold text-[10px] uppercase">Más Recientes</SelectItem>
                                <SelectItem value="totalAmount" className="font-bold text-[10px] uppercase">Monto Inversión</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex gap-2">
                        <Button variant={sortOrder === 'desc' ? 'default' : 'outline'} size="sm" className="h-10 sm:h-11 flex-1 rounded-xl font-black uppercase text-[8px] sm:text-[9px] tracking-widest border-slate-100" onClick={() => setSortOrder('desc')}>
                            <SortDesc className="h-3.5 sm:h-4 w-3.5 sm:w-4 mr-1.5 sm:mr-2" /> DESC
                        </Button>
                        <Button variant={sortOrder === 'asc' ? 'default' : 'outline'} size="sm" className="h-10 sm:h-11 flex-1 rounded-xl font-black uppercase text-[8px] sm:text-[9px] tracking-widest border-slate-100" onClick={() => setSortOrder('asc')}>
                            <SortAsc className="h-3.5 sm:h-4 w-3.5 sm:w-4 mr-1.5 sm:mr-2" /> ASC
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Accordion type="multiple" defaultValue={[]} className="space-y-4 mx-1 sm:mx-2 pb-20">
                {[
                    { key: 'borradores', label: 'Borradores en Curso', icon: Save, color: 'slate', orders: groups.borradores, desc: 'Trabajos guardados sin enviar' },
                    { key: 'comercial', label: 'En Revisión', icon: Clock, color: 'amber', orders: groups.comercial, desc: 'Esperando validación comercial' },
                    { key: 'operativo', label: 'Gestión Almacén', icon: Package, color: 'indigo', orders: groups.operativo, desc: 'Picking y embalaje en curso' },
                    { key: 'logistica', label: 'Logística Activa', icon: Truck, color: 'sky', orders: groups.logistica, desc: 'Unidades en ruta de despacho' },
                    { key: 'cerrado', label: 'Historial Finalizado', icon: CheckCircle, color: 'slate', orders: groups.cerrado, desc: 'Entregas confirmadas y archivo' }
                ].map(section => (
                    <AccordionItem key={section.key} value={section.key} className={cn("border-none rounded-[1.8rem] sm:rounded-[2.5rem] bg-white shadow-sm ring-1 ring-primary/5 overflow-hidden transition-all", section.key === 'borradores' && section.orders.length > 0 && "ring-2 ring-primary/20 bg-primary/5")}>
                        <AccordionTrigger className="px-6 sm:px-8 py-5 sm:py-6 hover:no-underline group">
                            <div className="flex items-center gap-4 sm:gap-5 text-left flex-1">
                                <div className={cn("p-2.5 sm:p-3 rounded-xl sm:rounded-2xl shadow-sm transition-transform group-data-[state=open]:rotate-12", `bg-${section.color}-50 text-${section.color}-600`)}>
                                    <section.icon className="h-5 sm:h-6 w-5 sm:w-6" />
                                </div>
                                <div className="space-y-0.5">
                                    <h3 className="text-sm sm:text-base font-black uppercase tracking-tight text-slate-900">{section.label}</h3>
                                    <p className="text-[8px] sm:text-[9px] text-muted-foreground font-black uppercase tracking-[0.2em]">{section.desc}</p>
                                </div>
                                <Badge variant="secondary" className="ml-auto mr-4 bg-slate-100 text-slate-600 font-black h-6 sm:h-7 px-2 sm:px-3 rounded-lg text-[10px] sm:text-xs">{section.orders.length}</Badge>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-6 sm:px-8 pb-6 sm:pb-8 pt-2">
                            {section.orders.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {section.orders.map(order => <OrderCard key={order.id} order={order} onSelect={setSelectedOrder} />)}
                                </div>
                            ) : (
                                <div className="py-10 sm:py-12 border-2 border-dashed rounded-[1.5rem] sm:rounded-[2rem] bg-slate-50/50 flex flex-col items-center justify-center gap-3 opacity-30">
                                    <Box className="h-7 sm:h-8 w-7 sm:w-8 text-slate-300" />
                                    <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.3em]">Sin movimientos en esta fase</p>
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
