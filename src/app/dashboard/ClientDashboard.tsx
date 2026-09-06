'use client';

import React, { useMemo, useState } from 'react';
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
    Wallet,
    MessageCircle,
    ShoppingBag,
    Clock
} from 'lucide-react';
import { DashboardMetricCard } from '@/components/dashboard/DashboardMetricCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CatalogHighlights } from '@/components/dashboard/CatalogHighlights';
import { OrderTrackerTimeline } from '@/components/dashboard/OrderTrackerTimeline';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { getSalesDate } from '@/lib/billing';

export default function ClientDashboard() {
    const router = useRouter();
    const firestore = useFirestore();
    const { user, profile, customerProfile } = useUser();

    const ordersQuery = useMemoFirebase(() => {
        if (!user || !profile || !firestore) return null;
        const targetId = profile.associatedCustomerId || user.uid;
        return query(collection(firestore, 'orders'), where('customerId', '==', targetId), limit(50));
    }, [user, profile, firestore]);

    const { data: myOrders } = useCollection<Order>(ordersQuery);

    const latestOrder = useMemo(() => {
        if (!myOrders || myOrders.length === 0) return null;
        return [...myOrders].sort((a, b) => {
            const dateA = getSalesDate(a);
            const dateB = getSalesDate(b);
            return dateB.getTime() - dateA.getTime();
        })[0];
    }, [myOrders]);

    const [kpiPeriod, setKpiPeriod] = useState<'today' | '7d' | 'this_month' | 'last_month' | 'all'>('all');

    const stats = useMemo(() => {
        if (!myOrders) return { balance: 0, inTransit: 0, totalOrders: 0 };
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        const isDateInPeriod = (rawDate: any) => {
            if (kpiPeriod === 'all' || !rawDate) return true;
            const d = typeof rawDate.toDate === 'function' ? rawDate.toDate() : new Date(rawDate);
            if (isNaN(d.getTime())) return true;
            if (kpiPeriod === 'today') {
                return d.getDate() === now.getDate() && d.getMonth() === currentMonth && d.getFullYear() === currentYear;
            }
            if (kpiPeriod === '7d') {
                const s7 = new Date();
                s7.setDate(now.getDate() - 7);
                return d >= s7;
            }
            if (kpiPeriod === 'this_month') {
                return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
            }
            if (kpiPeriod === 'last_month') {
                const lm = currentMonth === 0 ? 11 : currentMonth - 1;
                const ly = currentMonth === 0 ? currentYear - 1 : currentYear;
                return d.getMonth() === lm && d.getFullYear() === ly;
            }
            return true;
        };

        const filteredOrders = myOrders.filter(o => isDateInPeriod(getSalesDate(o)));

        return {
            balance: customerProfile?.creditUsed || 0,
            inTransit: filteredOrders.filter(o => ['Despachado', 'Completado'].includes(o.status)).length,
            totalOrders: filteredOrders.length
        };
    }, [myOrders, customerProfile, kpiPeriod]);

    const handleWhatsAppSalesperson = (e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        const rawPhone = ((customerProfile as any)?.assignedSalespersonPhone || (customerProfile as any)?.telefono || '').replace(/\D/g, '');
        const salespersonName = customerProfile?.assignedSalespersonName || 'Asesor Comercial';
        const text = `Hola *${salespersonName}*, le saluda *${customerProfile?.razonSocial || 'Cliente B2B'}* desde la plataforma. Quisiera consultar sobre un pedido / cotización.`;
        const url = rawPhone ? `https://wa.me/${rawPhone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(url, '_blank');
    };

    return (
        <div className="flex flex-col gap-10 pb-20 animate-in fade-in duration-700">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 px-1">
                <div className="space-y-1">
                    <h1 className="terminal-header">Mi Cuenta Pro</h1>
                    <p className="tech-label opacity-60">Control de Crédito Corporativo, Rastreo en Vivo y Catálogo B2B.</p>
                </div>
                <div className="flex flex-wrap gap-3">
                    <Button variant="outline" asChild className="h-12 px-6 rounded-2xl border-slate-200 font-black uppercase text-[10px] tracking-widest bg-white shadow-sm hover:bg-slate-50">
                        <Link href="/dashboard/billing">
                            <Wallet className="mr-2 h-4 w-4 text-primary" /> ESTADO CUENTA
                        </Link>
                    </Button>
                    <Button onClick={handleWhatsAppSalesperson} className="h-12 px-6 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-[10px] tracking-widest shadow-xl">
                        <MessageCircle className="mr-2 h-4 w-4" /> ASESOR WHATSAPP
                    </Button>
                </div>
            </header>

            {/* BARRA DE PERÍODOS DE FECHAS */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900 text-white p-3 sm:p-4 rounded-3xl shadow-lg border border-slate-800">
                <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-emerald-400" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">Filtro Temporal de Pedidos:</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1 rounded-2xl border border-slate-800">
                    {[
                        { id: 'today', label: '☀️ Hoy' },
                        { id: '7d', label: '⚡ 7 Días' },
                        { id: 'this_month', label: '🗓️ Mes Actual' },
                        { id: 'last_month', label: '🗓️ Mes Anterior' },
                        { id: 'all', label: '🌐 Todo' },
                    ].map(p => (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => setKpiPeriod(p.id as any)}
                            className={cn(
                                "px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer",
                                kpiPeriod === p.id 
                                    ? "bg-emerald-600 text-white shadow-md font-black" 
                                    : "text-slate-400 hover:text-white hover:bg-slate-900 font-bold"
                            )}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 px-1">
                <DashboardMetricCard 
                    title="Crédito en Uso" 
                    value={`$${stats.balance.toLocaleString()}`} 
                    subtitle={`Límite: $${(customerProfile?.creditLimit || 0).toLocaleString()}`} 
                    icon={CreditCard} iconBg="bg-rose-50" iconColor="text-rose-500" 
                    onClick={() => router.push('/dashboard/billing')}
                />
                <DashboardMetricCard 
                    title="En Tránsito" 
                    value={stats.inTransit} 
                    subtitle="Equipos hacia su sede" 
                    icon={Truck} iconBg="bg-blue-50" iconColor="text-blue-500" 
                    onClick={() => router.push('/dashboard/orders')}
                />
                <DashboardMetricCard 
                    title="Mis Pedidos" 
                    value={stats.totalOrders} 
                    subtitle={kpiPeriod === 'today' ? 'Pedidos Hoy' : kpiPeriod === '7d' ? 'Pedidos 7 Días' : kpiPeriod === 'this_month' ? 'Pedidos Mes Actual' : kpiPeriod === 'last_month' ? 'Pedidos Mes Anterior' : 'Historial Acumulado'} 
                    icon={ClipboardList} iconBg="bg-indigo-50" iconColor="text-indigo-500" 
                    onClick={() => router.push('/dashboard/orders')}
                />
                <DashboardMetricCard 
                    title="Soporte Directo" 
                    value={customerProfile?.assignedSalespersonName?.split(' ')[0] || 'Asesor'} 
                    subtitle="Contactar por WhatsApp" 
                    icon={MessageCircle} iconBg="bg-emerald-50" iconColor="text-emerald-600" 
                    onClick={handleWhatsAppSalesperson}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 px-1">
                <div className="lg:col-span-8 space-y-8">
                    <OrderTrackerTimeline order={latestOrder} />

                    <section className="space-y-4">
                        <div className="flex items-center justify-between px-1">
                            <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-2">
                                <Zap className="h-4 w-4 text-primary" /> Nuevos Equipos en Red
                            </h3>
                            <Link href="/dashboard/inventory" className="text-[10px] font-black uppercase text-primary flex items-center gap-1 hover:underline">
                                Ver Catálogo <ArrowUpRight className="h-3 w-3" />
                            </Link>
                        </div>
                        <CatalogHighlights />
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
