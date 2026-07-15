'use client';

import React, { useMemo } from 'react';
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, where, limit, doc } from 'firebase/firestore';
import type { Order, Product, FinancialSettings, Customer } from '@/lib/definitions';
import { 
    CreditCard, 
    Truck, 
    Boxes, 
    Bell, 
    ArrowUpRight, 
    DollarSign,
    Zap,
    Download,
    ClipboardList,
    Wallet
} from 'lucide-react';
import { DashboardMetricCard } from '@/components/dashboard/DashboardMetricCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { NewArrivals } from '@/components/dashboard/new-arrivals';
import Link from 'next/link';

export default function ClientDashboard() {
    const firestore = useFirestore();
    const { user, profile, customerProfile } = useUser();

    const ordersQuery = useMemoFirebase(() => {
        if (!user || !profile || !firestore) return null;
        const targetId = profile.associatedCustomerId || user.uid;
        return query(collection(firestore, 'orders'), where('customerId', '==', targetId), limit(50));
    }, [user, profile, firestore]);

    const { data: myOrders } = useCollection<Order>(ordersQuery);

    const stats = useMemo(() => {
        if (!myOrders) return { balance: 0, inTransit: 0, totalOrders: 0 };
        return {
            balance: customerProfile?.creditUsed || 0,
            inTransit: myOrders.filter(o => ['Despachado', 'Completado'].includes(o.status)).length,
            totalOrders: myOrders.length
        };
    }, [myOrders, customerProfile]);

    return (
        <div className="flex flex-col gap-10 pb-20 animate-in fade-in duration-700">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 px-1">
                <div className="space-y-1">
                    <h1 className="terminal-header">Mi Cuenta Pro</h1>
                    <p className="tech-label opacity-60">Control de Crédito Corporativo y Seguimiento de Suministros.</p>
                </div>
                <div className="flex gap-3">
                    <Button variant="outline" asChild className="h-12 px-6 rounded-xl border-slate-200 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm hover:bg-slate-50">
                        <Link href="/dashboard/billing">
                            <Wallet className="mr-2 h-4 w-4 text-primary" /> ESTADO CUENTA
                        </Link>
                    </Button>
                    <Button asChild className="h-12 px-8 rounded-xl bg-slate-900 hover:bg-primary font-black uppercase text-[10px] tracking-widest shadow-xl">
                        <Link href="/dashboard/inventory">
                            EXPLORAR CATÁLOGO
                        </Link>
                    </Button>
                </div>
            </header>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <DashboardMetricCard 
                    title="Crédito en Uso" 
                    value={`$${stats.balance.toLocaleString()}`} 
                    subtitle="Límite: $${(customerProfile?.creditLimit || 0).toLocaleString()}" 
                    icon={CreditCard} iconBg="bg-rose-50" iconColor="text-rose-500" 
                />
                <DashboardMetricCard 
                    title="En Tránsito" 
                    value={stats.inTransit} 
                    subtitle="Equipos hacia su sede" 
                    icon={Truck} iconBg="bg-blue-50" iconColor="text-blue-500" 
                />
                <DashboardMetricCard 
                    title="Mis Pedidos" 
                    value={stats.totalOrders} 
                    subtitle="Historial Acumulado" 
                    icon={ClipboardList} iconBg="bg-indigo-50" iconColor="text-indigo-500" 
                />
                <DashboardMetricCard 
                    title="Mi Asesor" 
                    value={customerProfile?.assignedSalespersonName?.split(' ')[0] || 'Personal'} 
                    subtitle="Soporte Directo Red" 
                    icon={Zap} iconBg="bg-slate-900" iconColor="text-white" 
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-8 space-y-8">
                    <section className="space-y-4">
                        <div className="flex items-center justify-between px-1">
                            <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-2">
                                <Zap className="h-4 w-4 text-primary" /> Nuevos Equipos en Red
                            </h3>
                        </div>
                        <NewArrivals />
                    </section>
                </div>

                <div className="lg:col-span-4">
                    <Card className="terminal-card bg-primary text-white border-none shadow-2xl relative overflow-hidden group h-full">
                        <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:rotate-12 transition-transform duration-1000">
                            <Zap className="h-40 w-40" />
                        </div>
                        <CardHeader className="p-8 pb-4">
                            <CardTitle className="text-2xl font-black uppercase tracking-tighter leading-none italic">Beneficio de Pronto Pago</CardTitle>
                        </CardHeader>
                        <CardContent className="p-8 space-y-6 relative z-10">
                            <p className="text-sm font-medium text-primary-foreground/80 leading-relaxed">
                                Liquida tus abonos en los primeros <span className="text-white font-black underline underline-offset-4">7 días</span> y obtén un <span className="text-white font-black">10% de ahorro directo</span> en tu inversión.
                            </p>
                            <div className="p-6 rounded-[2rem] bg-white text-slate-900 shadow-xl space-y-4">
                                <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-400">
                                    <span>Escala Actual</span>
                                    <span className="text-emerald-500">Tier 1 Activo</span>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex justify-between font-black text-sm"><span>Día 1-7</span><span className="text-emerald-600">10% OFF</span></div>
                                    <div className="flex justify-between font-black text-sm"><span>Día 8-15</span><span className="text-blue-600">5% OFF</span></div>
                                </div>
                            </div>
                            <Button asChild variant="secondary" className="w-full h-14 rounded-2xl bg-white text-primary hover:bg-slate-50 font-black uppercase tracking-[0.2em] shadow-2xl">
                                <Link href="/dashboard/billing">REPORTAR ABONO <DollarSign className="ml-2 h-4 w-4" /></Link>
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
