'use client';

import React, { useMemo, useState } from 'react';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, query, where, limit } from 'firebase/firestore';
import type { Order, Product, Carrier } from '@/lib/definitions';
import { 
    Truck, 
    Package, 
    Boxes, 
    CheckCircle2, 
    Zap, 
    ArrowUpRight,
    MapPin,
    Search,
    ShieldCheck
} from 'lucide-react';
import { DashboardMetricCard } from '@/components/dashboard/DashboardMetricCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { CatalogHighlights } from '@/components/dashboard/CatalogHighlights';
import { ExpressStockAdjust } from '@/components/dashboard/ExpressStockAdjust';

export default function WarehouseDashboard() {
    const router = useRouter();
    const firestore = useFirestore();

    const ordersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'orders'), where('status', 'in', ['Aprobado', 'En Preparación', 'Completado', 'Despachado']), limit(100)) : null), [firestore]);
    const carriersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'carriers'), limit(20)) : null), [firestore]);

    const { data: activeOrders } = useCollection<Order>(ordersQuery);
    const { data: carriers } = useCollection<Carrier>(carriersQuery);

    const [kpiPeriod, setKpiPeriod] = useState<'today' | '7d' | 'this_month' | 'last_month' | 'all'>('all');

    const stats = useMemo(() => {
        if (!activeOrders) return { picking: 0, packing: 0, ready: 0, transit: 0 };
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

        const filteredOrders = activeOrders.filter(o => isDateInPeriod(o.createdAt || o.orderDate || o.receptionDate));

        return {
            picking: filteredOrders.filter(o => o.status === 'Aprobado').length,
            packing: filteredOrders.filter(o => o.status === 'En Preparación').length,
            ready: filteredOrders.filter(o => o.status === 'Completado').length,
            transit: filteredOrders.filter(o => o.status === 'Despachado').length,
        };
    }, [activeOrders, kpiPeriod]);

    return (
        <div className="flex flex-col gap-10 pb-20 animate-in fade-in duration-700">
            <header className="space-y-1">
                <h1 className="terminal-header">Centro Logístico</h1>
                <p className="tech-label opacity-60">Control de Picking, Embalaje y Certificación de Salidas.</p>
            </header>

            {/* BARRA DE PERÍODOS DE FECHAS */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900 text-white p-3 sm:p-4 rounded-3xl shadow-lg border border-slate-800">
                <div className="flex items-center gap-2">
                    <Boxes className="h-4 w-4 text-emerald-400" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">Filtro Logístico por Período:</span>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <DashboardMetricCard 
                    title="Cola de Picking" 
                    value={stats.picking} 
                    subtitle={kpiPeriod === 'all' ? 'Esperando Selección' : 'Filtrado por Período'} 
                    icon={Boxes} iconBg="bg-blue-50" iconColor="text-blue-500" 
                    onClick={() => router.push('/dashboard/dispatch')}
                />
                <DashboardMetricCard 
                    title="En Embalaje" 
                    value={stats.packing} 
                    subtitle="Preparación de Bultos" 
                    icon={Package} iconBg="bg-indigo-50" iconColor="text-indigo-500" 
                    onClick={() => router.push('/dashboard/dispatch')}
                />
                <DashboardMetricCard 
                    title="Listos para Salida" 
                    value={stats.ready} 
                    subtitle="Certificación Pendiente" 
                    icon={CheckCircle2} iconBg="bg-emerald-50" iconColor="text-emerald-500" 
                    onClick={() => router.push('/dashboard/dispatch')}
                />
                <DashboardMetricCard 
                    title="En Ruta" 
                    value={stats.transit} 
                    subtitle="Seguimiento Activo" 
                    icon={Truck} iconBg="bg-slate-900" iconColor="text-white" 
                    onClick={() => router.push('/dashboard/dispatch')}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-7 space-y-8">
                    <Card className="terminal-card p-8 space-y-8">
                        <div className="flex items-center justify-between border-b pb-6">
                            <div className="flex items-center gap-4">
                                <div className="p-3 rounded-2xl bg-primary text-white shadow-xl"><Search className="h-5 w-5" /></div>
                                <div className="space-y-0.5">
                                    <h3 className="text-xl font-black uppercase tracking-tighter">Buscador Logístico</h3>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">LOCALIZA PEDIDOS POR ID O CLIENTE.</p>
                                </div>
                            </div>
                            <Button variant="outline" asChild className="h-10 px-6 rounded-xl border-slate-200 font-black uppercase text-[10px] tracking-widest"><Link href="/dashboard/dispatch">Ir a Terminal</Link></Button>
                        </div>
                        <div className="grid gap-4">
                            {activeOrders?.slice(0, 4).map(o => (
                                <div key={o.id} className="p-5 rounded-[1.8rem] border border-slate-50 bg-slate-50/50 flex items-center justify-between group hover:bg-white hover:border-primary/20 transition-all">
                                    <div className="flex items-center gap-5">
                                        <div className="h-12 w-12 rounded-xl bg-white shadow-sm flex items-center justify-center text-primary font-bold text-xs">#{o.id.substring(0,3)}</div>
                                        <div>
                                            <p className="text-xs font-black uppercase text-slate-900 leading-none">{o.customerName}</p>
                                            <Badge variant="outline" className="mt-2 text-[8px] font-black uppercase border-primary/20 text-primary h-5">{o.status}</Badge>
                                        </div>
                                    </div>
                                    <Link href={`/dashboard/dispatch?orderId=${o.id}`}>
                                        <ArrowUpRight className="h-5 w-5 text-slate-300 group-hover:text-primary transition-colors" />
                                    </Link>
                                </div>
                            ))}
                        </div>
                    </Card>

                    <ExpressStockAdjust />
                </div>

                <div className="lg:col-span-5 space-y-8">
                    <Card className="terminal-card bg-slate-900 text-white p-8 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 opacity-5"><MapPin className="h-32 w-32" /></div>
                        <div className="space-y-6 relative z-10">
                            <div className="space-y-1">
                                <h3 className="text-xl font-black uppercase tracking-tighter italic text-primary">Red de Operadores</h3>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ESTADO DE TRANSPORTISTAS AUTORIZADOS.</p>
                            </div>
                            <div className="space-y-3">
                                {carriers?.map((c, i) => (
                                    <div key={i} className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/10">
                                        <div className="flex items-center gap-3">
                                            <Truck className="h-4 w-4 text-primary" />
                                            <span className="text-[11px] font-black uppercase tracking-widest">{c.name}</span>
                                        </div>
                                        <Badge className="bg-emerald-500/20 text-emerald-400 border-none text-[7px] font-black uppercase h-4 px-2">ACTIVO</Badge>
                                    </div>
                                ))}
                            </div>
                            <div className="pt-4 border-t border-white/5 flex items-center gap-3">
                                <ShieldCheck className="h-5 w-5 text-emerald-500" />
                                <p className="text-[9px] font-bold text-slate-500 uppercase leading-relaxed">TODOS LOS OPERADORES CUMPLEN CON EL PROTOCOLO DE CUSTODIA DIGITAL.</p>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>

            <section className="space-y-4 pt-6 border-t border-slate-200/10">
                <div className="flex items-center gap-2 px-1">
                    <Zap className="h-4 w-4 text-primary" />
                    <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400">
                        Novedades y Movimientos de Catálogo
                    </h3>
                </div>
                <CatalogHighlights />
            </section>
        </div>
    );
}
