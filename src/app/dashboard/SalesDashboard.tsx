'use client';

import React, { useMemo, useState } from 'react';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, query, where, limit, Timestamp } from 'firebase/firestore';
import type { User, Order, Customer, Commission, Quote } from '@/lib/definitions';
import { 
    TrendingUp, 
    Users, 
    ShoppingCart, 
    Wallet, 
    Zap, 
    ArrowUpRight,
    Star,
    PlusCircle,
    FileText,
    MessageCircle,
    Clock,
    FileCheck
} from 'lucide-react';
import { DashboardMetricCard } from '@/components/dashboard/DashboardMetricCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CatalogHighlights } from '@/components/dashboard/CatalogHighlights';
import { SalesGoalWidget } from '@/components/dashboard/SalesGoalWidget';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

export default function SalesDashboard({ user, profile }: { user: any, profile: User }) {
    const router = useRouter();
    const firestore = useFirestore();

    const ordersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'orders'), where('salespersonId', '==', profile.id), limit(100)) : null), [firestore, profile.id]);
    const customersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'customers'), where('assignedSalespersonId', '==', profile.id), limit(50)) : null), [firestore, profile.id]);
    const commissionsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'commissions'), where('salespersonId', '==', profile.id), limit(50)) : null), [firestore, profile.id]);
    const quotesQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'quotes'), where('salespersonId', '==', profile.id), limit(50)) : null), [firestore, profile.id]);

    const { data: myOrders } = useCollection<Order>(ordersQuery);
    const { data: myCustomers } = useCollection<Customer>(customersQuery);
    const { data: myCommissions } = useCollection<Commission>(commissionsQuery);
    const { data: myQuotes } = useCollection<Quote>(quotesQuery);

    const [kpiPeriod, setKpiPeriod] = useState<'today' | '7d' | 'this_month' | 'last_month' | 'all'>('all');

    const stats = useMemo(() => {
        if (!myOrders) return { salesMonth: 0, pending: 0, clients: 0, wallet: 0, activeQuotes: 0 };
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

        const filteredOrders = myOrders.filter(o => isDateInPeriod(o.createdAt || o.orderDate || o.receptionDate));
        const filteredCommissions = (myCommissions || []).filter(c => isDateInPeriod(c.createdAt));
        const filteredQuotes = (myQuotes || []).filter(q => isDateInPeriod(q.createdAt));

        return {
            salesMonth: filteredOrders.filter(o => o.status === 'Pagado' || o.status === 'Entregado' || o.status === 'Completado').reduce((s, o) => s + (o.totalAmount || 0), 0),
            pending: filteredOrders.filter(o => ['Pendiente', 'Aprobado', 'En Preparación'].includes(o.status)).length,
            clients: myCustomers?.length || 0,
            wallet: filteredCommissions.filter(c => c.status === 'pendiente').reduce((s, c) => s + (c.salespersonCommissionAmount || 0), 0),
            activeQuotes: filteredQuotes.filter(q => q.status === 'Enviada' || q.status === 'Borrador').length
        };
    }, [myOrders, myCustomers, myCommissions, myQuotes, kpiPeriod]);

    const handleWhatsAppClient = (c: Customer, e: React.MouseEvent) => {
        e.stopPropagation();
        const rawPhone = ((c as any).phone || (c as any).telefono || '').replace(/\D/g, '');
        const text = `Hola *${c.razonSocial}*, le saluda su asesor comercial en *ATHLETICENTER C.A.* Quedo a su disposición para apoyarle con nuevos requerimientos o cotizaciones.`;
        const url = rawPhone ? `https://wa.me/${rawPhone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(url, '_blank');
    };

    return (
        <div className="flex flex-col gap-8 pb-20 animate-in fade-in duration-700">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 px-1">
                <div className="space-y-1">
                    <h1 className="terminal-header">Terminal de Ventas</h1>
                    <p className="tech-label opacity-60">Gestión de Cartera, Cotizaciones y Ejecución de Pedidos B2B.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Link href="/dashboard/orders/new">
                        <Button className="h-12 px-6 rounded-2xl bg-primary hover:bg-primary/90 font-black uppercase tracking-wider text-[10px] shadow-xl">
                            <PlusCircle className="mr-2 h-4 w-4" /> Nuevo Pedido
                        </Button>
                    </Link>
                    <Link href="/dashboard/quotes/new">
                        <Button variant="outline" className="h-12 px-6 rounded-2xl border-slate-200 bg-white font-black uppercase tracking-wider text-[10px] shadow-sm hover:bg-slate-50">
                            <FileText className="mr-2 h-4 w-4 text-blue-600" /> Cotización
                        </Button>
                    </Link>
                </div>
            </header>

            {/* BARRA DE PERÍODOS DE FECHAS */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900 text-white p-3 sm:p-4 rounded-3xl shadow-lg border border-slate-800">
                <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-emerald-400" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">Filtro Temporal de Métricas:</span>
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
                    title="Ventas del Período" 
                    value={`$${stats.salesMonth.toLocaleString()}`} 
                    subtitle={kpiPeriod === 'today' ? 'Ventas Hoy' : kpiPeriod === '7d' ? 'Ventas 7 Días' : kpiPeriod === 'this_month' ? 'Ventas Mes Actual' : kpiPeriod === 'last_month' ? 'Ventas Mes Anterior' : 'Recaudación Total'} 
                    icon={TrendingUp} iconBg="bg-emerald-50" iconColor="text-emerald-500" 
                    onClick={() => router.push('/dashboard/orders')}
                />
                <DashboardMetricCard 
                    title="Comisiones" 
                    value={`$${stats.wallet.toFixed(2)}`} 
                    subtitle="Pendiente por Cobrar" 
                    icon={Wallet} iconBg="bg-indigo-50" iconColor="text-indigo-500" 
                    onClick={() => router.push('/dashboard/commissions')}
                />
                <DashboardMetricCard 
                    title="Cotizaciones Activas" 
                    value={stats.activeQuotes} 
                    subtitle="Presupuestos Enviados" 
                    icon={FileCheck} iconBg="bg-blue-50" iconColor="text-blue-500" 
                    onClick={() => router.push('/dashboard/quotes')}
                />
                <DashboardMetricCard 
                    title="Mi Cartera" 
                    value={stats.clients} 
                    subtitle="Clientes Vinculados" 
                    icon={Users} iconBg="bg-slate-900" iconColor="text-white" 
                    onClick={() => router.push('/dashboard/clients')}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 px-1">
                <div className="lg:col-span-8 space-y-8">
                    <section className="space-y-4">
                        <div className="flex items-center justify-between px-1">
                            <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-2">
                                <Zap className="h-4 w-4 text-primary" /> Equipos Destacados
                            </h3>
                        </div>
                        <CatalogHighlights />
                    </section>
                </div>

                <div className="lg:col-span-4 space-y-8">
                    {/* Meta Comercial */}
                    <SalesGoalWidget commissionValue={stats.wallet} />

                    {/* Radar de Clientes */}
                    <Card className="terminal-card bg-slate-900 text-white p-8 space-y-6 relative overflow-hidden shadow-2xl">
                        <div className="absolute top-0 right-0 p-4 opacity-5"><Star className="h-32 w-32" /></div>
                        <div className="space-y-1 relative z-10">
                            <h3 className="text-xl font-black uppercase tracking-tighter italic text-primary">Radar de Cartera B2B</h3>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-relaxed">MONITOREO DE TUS CLIENTES ASIGNADOS.</p>
                        </div>
                        <div className="space-y-3 relative z-10">
                            {myCustomers?.slice(0, 5).map((c, i) => (
                                <div key={i} className="flex items-center justify-between p-3.5 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                                    <div className="min-w-0 pr-2">
                                        <p className="text-[11px] font-black uppercase truncate text-white">{c.razonSocial}</p>
                                        <p className="text-[8px] font-mono text-slate-400 mt-0.5">RIF: {c.rif}</p>
                                    </div>
                                    <Button size="sm" variant="ghost" onClick={(e) => handleWhatsAppClient(c, e)} className="h-7 px-2 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 text-[8px] font-black uppercase rounded-lg border border-emerald-500/20 shrink-0">
                                        <MessageCircle className="h-3 w-3 mr-1" /> WhatsApp
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}
