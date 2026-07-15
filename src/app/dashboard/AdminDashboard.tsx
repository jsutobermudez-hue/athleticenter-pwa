
'use client';

import React, { useMemo } from 'react';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, limit } from 'firebase/firestore';
import type { Order, Product, Customer } from '@/lib/definitions';
import { 
    TrendingUp, 
    ShoppingCart, 
    Boxes, 
    Users, 
    AlertTriangle, 
    DollarSign,
    Zap,
    ArrowUpRight,
    Target,
    ShieldCheck
} from 'lucide-react';
import { DashboardMetricCard } from '@/components/dashboard/DashboardMetricCard';
import { NewArrivals } from '@/components/dashboard/new-arrivals';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

/**
 * TABLERO DE ADMINISTRACIÓN v1.4.0 - BLINDAJE TÁCTICO
 * Corregido: Se utiliza un contenedor div explícito para 'Accesos Tácticos' para evitar conflictos de color con el componente Card.
 */
export default function AdminDashboard() {
    const firestore = useFirestore();
    const { profile } = useUser();

    const ordersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'orders'), limit(100)) : null), [firestore]);
    const productsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'products'), limit(200)) : null), [firestore]);
    const customersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'customers'), limit(100)) : null), [firestore]);

    const { data: orders } = useCollection<Order>(ordersQuery);
    const { data: products } = useCollection<Product>(productsQuery);
    const { data: customers } = useCollection<Customer>(customersQuery);

    const stats = useMemo(() => {
        if (!orders || !products || !customers) return { revenue: 0, pending: 0, lowStock: 0, clients: 0 };
        
        return {
            revenue: orders.filter(o => o.status === 'Pagado').reduce((s, o) => s + o.totalAmount, 0),
            pending: orders.filter(o => ['Pendiente', 'Aprobado', 'En Preparación'].includes(o.status)).length,
            lowStock: products.filter(p => (p.stockLevel ?? (p as any).stock ?? 0) < 10).length,
            clients: customers.filter(c => c.status === 'Activo').length
        };
    }, [orders, products, customers]);

    const tacticActions = [
        { label: 'Aprobar Pedidos', href: '/dashboard/orders?status=Pendiente', icon: ShieldCheck },
        { label: 'Sincronizar Tasa', href: '/dashboard/treasury', icon: DollarSign },
        { label: 'Auditar Despacho', href: '/dashboard/dispatch', icon: ShoppingCart },
        { label: 'Gestión Fiscal', href: '/dashboard/billing', icon: Boxes },
    ];

    return (
        <div className="flex flex-col gap-10 pb-20 animate-in fade-in duration-700">
            <header className="space-y-1 px-1">
                <h1 className="terminal-header">Mando Central</h1>
                <p className="tech-label opacity-60">Visión Global de Operaciones y Rendimiento de Red.</p>
            </header>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 px-1">
                <DashboardMetricCard 
                    title="Venta Realizada" 
                    value={`$${stats.revenue.toLocaleString()}`} 
                    subtitle="Recaudación CASH" 
                    icon={TrendingUp} iconBg="bg-emerald-50" iconColor="text-emerald-500" 
                />
                <DashboardMetricCard 
                    title="Cola de Trabajo" 
                    value={stats.pending} 
                    subtitle="Pedidos Activos" 
                    icon={ShoppingCart} iconBg="bg-blue-50" iconColor="text-blue-500" 
                />
                <DashboardMetricCard 
                    title="Stock Crítico" 
                    value={stats.lowStock} 
                    subtitle="SKUs bajo umbral" 
                    icon={AlertTriangle} iconBg="bg-rose-50" iconColor="text-rose-500"
                    alert={stats.lowStock > 0}
                />
                <DashboardMetricCard 
                    title="Red B2B" 
                    value={stats.clients} 
                    subtitle="Cuentas Activas" 
                    icon={Users} iconBg="bg-slate-900" iconColor="text-white" 
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start px-1">
                <div className="lg:col-span-8 space-y-8">
                    <section className="space-y-4">
                        <div className="flex items-center justify-between px-1">
                            <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-2">
                                <Zap className="h-4 w-4 text-primary" /> Ingresos Recientes
                            </h3>
                            <Link href="/dashboard/inventory" className="text-[10px] font-black uppercase text-primary flex items-center gap-1 hover:underline">
                                Ver Catálogo <ArrowUpRight className="h-3 w-3" />
                            </Link>
                        </div>
                        <NewArrivals />
                    </section>
                </div>

                <div className="lg:col-span-4">
                    <div className="shadow-2xl rounded-[2.5rem] bg-slate-900 text-white relative overflow-hidden group border border-white/5">
                        <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:rotate-12 transition-transform duration-1000">
                            <Target className="h-32 w-32" />
                        </div>
                        <div className="p-8 border-b border-white/5">
                            <h3 className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-3">
                                <Zap className="h-5 w-5" /> Accesos Tácticos
                            </h3>
                        </div>
                        <div className="p-8 space-y-4">
                            {tacticActions.map((action, i) => (
                                <Link 
                                    key={i} 
                                    href={action.href} 
                                    className="flex items-center justify-between p-5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all group/item active:scale-95 shadow-inner"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="p-2 rounded-xl bg-primary/10 text-primary">
                                            <action.icon className="h-5 w-5" />
                                        </div>
                                        <span className="text-[11px] font-black uppercase tracking-widest text-white/90 group-hover/item:text-white">{action.label}</span>
                                    </div>
                                    <ArrowUpRight className="h-4 w-4 text-slate-500 group-hover/item:text-white transition-colors" />
                                </Link>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
