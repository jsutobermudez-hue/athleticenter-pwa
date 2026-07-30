'use client';

import React, { useMemo } from 'react';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, query, where, limit, Timestamp } from 'firebase/firestore';
import type { User, Order, Customer, Commission } from '@/lib/definitions';
import { 
    TrendingUp, 
    Users, 
    ShoppingCart, 
    Wallet, 
    Zap, 
    ArrowUpRight,
    Star,
    PlusCircle
} from 'lucide-react';
import { DashboardMetricCard } from '@/components/dashboard/DashboardMetricCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NewArrivals } from '@/components/dashboard/new-arrivals';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function SalesDashboard({ user, profile }: { user: any, profile: User }) {
    const firestore = useFirestore();

    const ordersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'orders'), where('salespersonId', '==', profile.id), limit(100)) : null), [firestore, profile.id]);
    const customersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'customers'), where('assignedSalespersonId', '==', profile.id), limit(50)) : null), [firestore, profile.id]);
    const commissionsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'commissions'), where('salespersonId', '==', profile.id), limit(50)) : null), [firestore, profile.id]);

    const { data: myOrders } = useCollection<Order>(ordersQuery);
    const { data: myCustomers } = useCollection<Customer>(customersQuery);
    const { data: myCommissions } = useCollection<Commission>(commissionsQuery);

    const stats = useMemo(() => {
        if (!myOrders) return { salesMonth: 0, pending: 0, clients: 0, wallet: 0 };
        return {
            salesMonth: myOrders.filter(o => o.status === 'Pagado').reduce((s, o) => s + o.totalAmount, 0),
            pending: myOrders.filter(o => ['Pendiente', 'Aprobado'].includes(o.status)).length,
            clients: myCustomers?.length || 0,
            wallet: myCommissions?.filter(c => c.status === 'pendiente').reduce((s, c) => s + c.salespersonCommissionAmount, 0) || 0
        };
    }, [myOrders, myCustomers, myCommissions]);

    return (
        <div className="flex flex-col gap-10 pb-20 animate-in fade-in duration-700">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 px-1">
                <div className="space-y-1">
                    <h1 className="terminal-header">Terminal de Ventas</h1>
                    <p className="tech-label opacity-60">Gestión de Cartera y Ejecución de Pedidos B2B.</p>
                </div>
                <Link href="/dashboard/orders/new">
                    <Button className="h-14 px-10 rounded-2xl bg-primary hover:bg-primary/90 font-black uppercase tracking-[0.2em] shadow-2xl shadow-primary/20 transition-all active:scale-95">
                        <PlusCircle className="mr-2 h-5 w-5" /> NUEVO PEDIDO
                    </Button>
                </Link>
            </header>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <DashboardMetricCard 
                    title="Venta Cerrada" 
                    value={`$${stats.salesMonth.toLocaleString()}`} 
                    subtitle="Recaudación Mes" 
                    icon={TrendingUp} iconBg="bg-emerald-50" iconColor="text-emerald-500" 
                />
                <DashboardMetricCard 
                    title="Comisiones" 
                    value={`$${stats.wallet.toFixed(2)}`} 
                    subtitle="Pendiente por Cobrar" 
                    icon={Wallet} iconBg="bg-indigo-50" iconColor="text-indigo-500" 
                />
                <DashboardMetricCard 
                    title="En Gestión" 
                    value={stats.pending} 
                    subtitle="Solicitudes Activas" 
                    icon={ShoppingCart} iconBg="bg-blue-50" iconColor="text-blue-500" 
                />
                <DashboardMetricCard 
                    title="Mi Cartera" 
                    value={stats.clients} 
                    subtitle="Clientes Vinculados" 
                    icon={Users} iconBg="bg-slate-900" iconColor="text-white" 
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-8 space-y-8">
                    <section className="space-y-4">
                        <div className="flex items-center justify-between px-1">
                            <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-2">
                                <Zap className="h-4 w-4 text-primary" /> Equipos Destacados
                            </h3>
                        </div>
                        <NewArrivals />
                    </section>
                </div>

                <div className="lg:col-span-4">
                    <Card className="terminal-card bg-slate-900 text-white p-8 space-y-8 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-5"><Star className="h-32 w-32" /></div>
                        <div className="space-y-2 relative z-10">
                            <h3 className="text-xl font-black uppercase tracking-tighter italic text-primary">Radar de Clientes</h3>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-relaxed">MONITOREO DE ACTIVIDAD DE TU CARTERA B2B.</p>
                        </div>
                        <div className="space-y-3 relative z-10">
                            {myCustomers?.slice(0, 5).map((c, i) => (
                                <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                                    <div className="min-w-0">
                                        <p className="text-[11px] font-black uppercase truncate">{c.razonSocial}</p>
                                        <p className="text-[8px] font-mono text-slate-500">RIF: {c.rif}</p>
                                    </div>
                                    <Link href={`/dashboard/clients?search=${c.rif}`}>
                                        <ArrowUpRight className="h-4 w-4 text-primary" />
                                    </Link>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}
