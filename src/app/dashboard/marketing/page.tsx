'use client';

import React, { useMemo, useState, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useUser, useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, query, where, limit, Timestamp, orderBy } from 'firebase/firestore';
import type { Customer, Order, Quote, Product } from '@/lib/definitions';
import { 
    Card, CardContent, CardHeader, CardTitle 
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { 
    Loader2, 
    Search, 
    Trophy, 
    MessageCircle, 
    Zap,
    Activity,
    Target,
    ShieldAlert,
    DollarSign,
    Box,
    Megaphone,
    History,
    CheckCircle2,
    Clock,
    AlertCircle
} from 'lucide-react';
import { differenceInDays, subMonths, isSameMonth } from 'date-fns';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { DashboardMetricCard } from '@/components/dashboard/DashboardMetricCard';
import { BroadcastCampaignModal } from './BroadcastCampaignModal';
import { sendWhatsAppWithFeedback } from '@/lib/whatsapp-client';

export const dynamic = 'force-dynamic';

function HeatmapDots({ activity }: { activity: boolean[] }) {
    return (
        <div className="flex gap-1">
            {activity.map((active, i) => (
                <div 
                    key={i} 
                    className={cn(
                        "h-2 w-2 rounded-full transition-all duration-500",
                        active ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-200"
                    )}
                    title={`Mes ${i+1}`}
                />
            ))}
        </div>
    );
}

function RadialMiniProgress({ value, color = "text-primary" }: { value: number, color?: string }) {
    const radius = 15;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (value / 100) * circumference;

    return (
        <div className="relative h-10 w-10 flex items-center justify-center">
            <svg className="h-10 w-10 transform -rotate-90">
                <circle cx="20" cy="20" r={radius} stroke="currentColor" strokeWidth="3" fill="transparent" className="text-slate-100" />
                <circle 
                    cx="20" cy="20" r={radius} stroke="currentColor" strokeWidth="3" fill="transparent" 
                    className={cn("transition-all duration-1000", color)}
                    style={{ strokeDasharray: circumference, strokeDashoffset }}
                />
            </svg>
            <span className="absolute text-[8px] font-black">{Math.round(value)}%</span>
        </div>
    );
}

function MarketingContent() {
    const { profile, isUserLoading } = useUser();
    const router = useRouter();
    const firestore = useFirestore();
    const { toast } = useToast();
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState('pulse');
    const [isMounted, setIsMounted] = useState(false);
    const [isBroadcastOpen, setIsBroadcastOpen] = useState(false);

    useEffect(() => { 
        setIsMounted(true); 
    }, []);

    const isAdmin = profile && ['superadmin', 'admin', 'gerencia'].includes(profile.role);

    useEffect(() => {
        if (!isUserLoading && !isAdmin && isMounted) {
            router.replace('/dashboard');
        }
    }, [isAdmin, isUserLoading, router, isMounted]);

    const customersQuery = useMemoFirebase(() => (firestore && isAdmin) ? query(collection(firestore, 'customers'), limit(300)) : null, [firestore, isAdmin]);
    const quotesQuery = useMemoFirebase(() => (firestore && isAdmin) ? query(collection(firestore, 'quotes'), limit(200)) : null, [firestore, isAdmin]);
    const ordersQuery = useMemoFirebase(() => (firestore && isAdmin) ? query(collection(firestore, 'orders'), orderBy('orderDate', 'desc'), limit(500)) : null, [firestore, isAdmin]);
    const productsQuery = useMemoFirebase(() => (firestore && isAdmin) ? query(collection(firestore, 'products'), limit(300)) : null, [firestore, isAdmin]);
    const campaignsQuery = useMemoFirebase(() => (firestore && isAdmin) ? query(collection(firestore, 'marketing_campaigns'), orderBy('createdAt', 'desc'), limit(30)) : null, [firestore, isAdmin]);

    const { data: allCustomers } = useCollection<Customer>(customersQuery);
    const { data: allQuotes } = useCollection<Quote>(quotesQuery);
    const { data: allOrders } = useCollection<Order>(ordersQuery);
    const { data: allProducts } = useCollection<Product>(productsQuery);
    const { data: allCampaigns } = useCollection<any>(campaignsQuery);

    const metrics = useMemo(() => {
        if (!allCustomers || !allQuotes || !allOrders || !allProducts || !isMounted) return null;

        const now = new Date();
        const results = {
            pulse: [] as any[],
            pareto: [] as any[],
            leakage: [] as any[],
            stats: { totalValueAtRisk: 0, vipsCount: 0, activeQuotes: 0 }
        };

        allCustomers.forEach(customer => {
            const customerOrders = allOrders.filter(o => o.customerId === customer.id && o.status !== 'Cancelado');
            const activity = Array.from({ length: 12 }, (_, i) => {
                const monthDate = subMonths(now, 11 - i);
                return customerOrders.some(o => isSameMonth((o.orderDate as Timestamp).toDate(), monthDate));
            });
            const lastOrderDate = customer.lastOrderDate ? (customer.lastOrderDate as Timestamp).toDate() : null;
            const daysSinceLast = lastOrderDate ? differenceInDays(now, lastOrderDate) : Infinity;
            let health: 'healthy' | 'warning' | 'critical' = 'healthy';
            if (daysSinceLast === Infinity || daysSinceLast > 45) health = 'critical';
            else if (daysSinceLast > 20) health = 'warning';
            results.pulse.push({ ...customer, health, daysSinceLast, activity });
        });

        const customerRevenue = allCustomers.map(c => {
            const total = allOrders.filter(o => o.customerId === c.id && o.status === 'Pagado').reduce((sum, o) => sum + (o.totalAmount || 0), 0);
            return { id: c.id, name: c.razonSocial, total, customer: c };
        }).sort((a, b) => b.total - a.total);

        const topCount = Math.max(1, Math.ceil(customerRevenue.length * 0.2));
        results.pareto = customerRevenue.slice(0, topCount).map(item => ({ ...item.customer, ltv: item.total }));
        results.stats.vipsCount = results.pareto.length;

        results.leakage = allQuotes.filter(q => q.status === 'Enviada' || q.status === 'Aceptada').map(q => {
            const days = differenceInDays(now, q.quoteDate ? q.quoteDate.toDate() : new Date());
            if (days >= 3) results.stats.totalValueAtRisk += (q.totalAmount || 0);
            return { ...q, daysOpen: days };
        }).sort((a, b) => (b.totalAmount || 0) - (a.totalAmount || 0));
        results.stats.activeQuotes = results.leakage.length;

        return results;
    }, [allCustomers, allQuotes, allOrders, allProducts, isMounted]);

    const handleDelegate = async (target: any, type: string) => {
        const phone = target.phone || target.whatsappPhone || target.customerPhone;
        if (!phone) {
            toast({ variant: 'destructive', title: 'Sin teléfono registrado', description: 'El contacto no posee un número de WhatsApp asociado.' });
            return;
        }

        let text = '';
        if (type === 'churn') {
            text = `*ATHLETICENTER*\n\n` +
                `Estimado(a) *${target.razonSocial || 'Cliente'}*:\n\n` +
                `Le saludamos cordialmente desde el equipo de Athleticenter.\n\n` +
                `Queremos ponernos a su disposición con nuestro inventario deportivo mayorista actualizado y recordarle nuestros beneficios de pago vigentes:\n\n` +
                `💵 *25% de descuento* en divisas / efectivo sobre precio de lista.\n` +
                `✅ *10% adicional* por pago de contado dentro del plazo.\n\n` +
                `¿Desea que le enviemos nuestro catálogo de balones y accesorios?\n\n` +
                `Atentamente,\n*El equipo de Athleticenter*`;
        } else if (type === 'leakage') {
            const code = target.quoteNumber || target.id?.substring(0, 8).toUpperCase();
            text = `*ATHLETICENTER*\n\n` +
                `Estimado(a) *${target.customerName || 'Cliente'}*:\n\n` +
                `Le saludamos del equipo de Athleticenter respecto a su cotización *#${code}*.\n\n` +
                `Queremos ponernos a su orden para confirmar existencias y afinar los detalles de facturación y despacho.\n\n` +
                `¿Tiene alguna duda o requerimiento adicional?\n\n` +
                `Atentamente,\n*El equipo de Athleticenter*`;
        }

        await sendWhatsAppWithFeedback({
            phone,
            message: text,
            module: 'marketing'
        });
    };

    if (isUserLoading || !profile || !isMounted) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;
    if (!isAdmin) return <div className="p-12 text-center opacity-40 uppercase font-black">Acceso no autorizado.</div>;

    const filteredPulse = metrics?.pulse?.filter(p => (p.razonSocial || '').toLowerCase().includes(searchTerm.toLowerCase())) || [];
    const filteredPareto = metrics?.pareto?.filter(p => (p.razonSocial || '').toLowerCase().includes(searchTerm.toLowerCase())) || [];

    return (
        <div className="w-full max-w-[1600px] mx-auto flex flex-col gap-10 pb-32 px-4 animate-in fade-in-50 duration-700">
            {/* Header con botón de lanzamiento */}
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div className="space-y-2">
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-2xl bg-primary text-white shadow-xl shadow-primary/20 animate-pulse">
                            <Zap className="h-6 w-6" />
                        </div>
                        <h1 className="text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none italic">
                            Revenue Command Center
                        </h1>
                    </div>
                    <p className="tech-label opacity-60">
                        DIRECCIÓN GENERAL: INTELIGENCIA PREDICTIVA, DIFUSIÓN WHATSAPP Y BLINDAJE DE INGRESOS.
                    </p>
                </div>

                <Button 
                    onClick={() => setIsBroadcastOpen(true)}
                    className="h-12 px-6 rounded-2xl bg-primary text-white hover:bg-primary/90 font-black uppercase text-xs tracking-wider shadow-xl shadow-primary/25 flex items-center gap-2.5 active:scale-95 transition-all shrink-0"
                >
                    <Megaphone className="h-4 w-4" /> Nueva Difusión Masiva
                </Button>
            </header>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <DashboardMetricCard 
                    title="Capital en Riesgo" 
                    value={`$${(metrics?.stats.totalValueAtRisk || 0).toLocaleString()}`} 
                    subtitle="Fuga Detectada" 
                    icon={DollarSign} iconBg="bg-slate-900" iconColor="text-white"
                    alert={(metrics?.stats.totalValueAtRisk || 0) > 0}
                />
                <DashboardMetricCard 
                    title="Elite Pareto (80/20)" 
                    value={metrics?.stats.vipsCount || 0} 
                    subtitle="Top Clientes Facturación" 
                    icon={Trophy} iconBg="bg-amber-50" iconColor="text-amber-500"
                />
                <DashboardMetricCard 
                    title="Pipeline Activo" 
                    value={metrics?.stats.activeQuotes || 0} 
                    subtitle="Propuestas Abiertas" 
                    icon={Target} iconBg="bg-blue-50" iconColor="text-blue-500"
                />
                <DashboardMetricCard 
                    title="Salud de Cartera" 
                    value={(metrics?.pulse.filter(p => p.health === 'healthy').length || 0)} 
                    subtitle="Clientes Fidelizados" 
                    icon={Activity} iconBg="bg-emerald-50" iconColor="text-emerald-500"
                />
            </div>

            {/* Tabs principales */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-8">
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 bg-white/40 backdrop-blur-xl p-4 rounded-[2.5rem] ring-1 ring-black/5 shadow-sm">
                    <TabsList className="bg-slate-100/50 p-1.5 rounded-2xl border-none shadow-inner flex flex-wrap gap-1">
                        <TabsTrigger value="pulse" className="px-6 rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-lg data-[state=active]:text-primary">
                            <Activity className="h-4 w-4 mr-2" /> Radar de Pulso
                        </TabsTrigger>
                        <TabsTrigger value="pareto" className="px-6 rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-lg data-[state=active]:text-primary">
                            <Trophy className="h-4 w-4 mr-2" /> Club Pareto (80/20)
                        </TabsTrigger>
                        <TabsTrigger value="leakage" className="px-6 rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-lg data-[state=active]:text-primary">
                            <ShieldAlert className="h-4 w-4 mr-2" /> Capital en Fuga
                        </TabsTrigger>
                        <TabsTrigger value="campaigns" className="px-6 rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-lg data-[state=active]:text-primary">
                            <History className="h-4 w-4 mr-2" /> Historial Difusiones
                        </TabsTrigger>
                    </TabsList>
                    
                    <div className="relative w-full max-w-sm">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input 
                            placeholder="FILTRAR INTELIGENCIA..." 
                            className="h-11 pl-12 rounded-xl bg-white border-none shadow-sm font-bold text-[10px] uppercase tracking-widest" 
                            value={searchTerm} 
                            onChange={(e) => setSearchTerm(e.target.value)} 
                        />
                    </div>
                </div>

                {/* 1. Radar de Pulso */}
                <TabsContent value="pulse" className="mt-0 outline-none animate-in slide-in-from-bottom-4 duration-700">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredPulse.map(c => (
                            <Card key={c.id} className={cn("border-none shadow-sm rounded-[2rem] bg-white group transition-all hover:shadow-2xl hover:-translate-y-1 relative overflow-hidden", c.health === 'critical' && "ring-2 ring-rose-500/20 bg-rose-50/10")}>
                                <CardContent className="p-8 space-y-6">
                                    <div className="flex justify-between items-start">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <div className={cn("h-2 w-2 rounded-full animate-pulse", c.health === 'healthy' ? "bg-emerald-500" : c.health === 'warning' ? "bg-amber-500" : "bg-rose-500")} />
                                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Estado de Cuenta</p>
                                            </div>
                                            <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 truncate max-w-[180px]">{c.razonSocial}</h3>
                                        </div>
                                        <RadialMiniProgress value={c.health === 'healthy' ? 100 : c.health === 'warning' ? 60 : 20} color={c.health === 'healthy' ? "text-emerald-500" : "text-rose-500"} />
                                    </div>
                                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-3">
                                        <div className="flex justify-between items-center text-[9px] font-black uppercase text-slate-400">
                                            <span>Consistencia (12 Meses)</span>
                                            <HeatmapDots activity={c.activity} />
                                        </div>
                                        <Separator className="bg-slate-200/50" />
                                        <div className="flex justify-between items-center">
                                            <span className="text-[9px] font-black uppercase text-slate-400">Última Compra</span>
                                            <Badge className={cn("text-[8px] font-black uppercase border-none px-2 h-5", c.health === 'healthy' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700')}>
                                                {c.daysSinceLast === Infinity ? 'SIN REGISTRO' : `HACE ${c.daysSinceLast} DÍAS`}
                                            </Badge>
                                        </div>
                                    </div>
                                    <Button 
                                        variant="outline" 
                                        className="w-full h-11 rounded-xl font-black uppercase text-[9px] tracking-widest border-primary/20 text-primary hover:bg-primary hover:text-white transition-all shadow-sm flex items-center justify-center gap-2" 
                                        onClick={() => handleDelegate(c, 'churn')}
                                    >
                                        <MessageCircle className="h-3.5 w-3.5" /> Exigir Reactivación
                                    </Button>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                {/* 2. Club Pareto (80/20) */}
                <TabsContent value="pareto" className="mt-0 outline-none animate-in fade-in-50 duration-700">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredPareto.map((vip, idx) => (
                            <Card key={vip.id} className="border-none shadow-md rounded-[2rem] bg-white group hover:shadow-2xl hover:-translate-y-1 transition-all overflow-hidden border border-amber-100">
                                <CardContent className="p-8 space-y-6">
                                    <div className="flex justify-between items-start">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <Badge className="bg-amber-100 text-amber-800 border-none font-black text-[9px] uppercase px-2">
                                                    VIP #{idx + 1}
                                                </Badge>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Socio Estratégico</p>
                                            </div>
                                            <h3 className="text-base font-black uppercase text-slate-900 truncate max-w-[200px] mt-1">
                                                {vip.razonSocial}
                                            </h3>
                                        </div>
                                        <div className="h-10 w-10 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center font-black">
                                            <Trophy className="h-5 w-5" />
                                        </div>
                                    </div>

                                    <div className="p-4 rounded-2xl bg-amber-50/50 border border-amber-100/60 space-y-2">
                                        <p className="text-[9px] font-black uppercase text-amber-800 tracking-widest">Facturación Total Histórica</p>
                                        <p className="text-2xl font-black text-slate-900 tracking-tight">
                                            ${Number(vip.ltv || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                        </p>
                                    </div>

                                    <Button
                                        variant="default"
                                        className="w-full h-11 rounded-xl bg-slate-900 text-white hover:bg-primary font-black uppercase text-[9px] tracking-widest transition-all shadow-md flex items-center justify-center gap-2"
                                        onClick={() => handleDelegate(vip, 'churn')}
                                    >
                                        <MessageCircle className="h-3.5 w-3.5" /> Mensaje Preferencial VIP
                                    </Button>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                {/* 3. Capital en Fuga */}
                <TabsContent value="leakage" className="mt-0 outline-none animate-in zoom-in-95 duration-700">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                        <div className="lg:col-span-8 space-y-6">
                            {metrics?.leakage.map(q => (
                                <Card key={q.id} className="border-none shadow-xl rounded-[2.5rem] bg-white overflow-hidden group hover:ring-2 hover:ring-primary/20 transition-all">
                                    <CardContent className="p-8 flex flex-col sm:flex-row items-center justify-between gap-6">
                                        <div className="flex items-center gap-6 flex-1 min-w-0">
                                            <div className="h-16 w-16 rounded-[1.5rem] bg-rose-50 text-rose-500 flex items-center justify-center shrink-0 shadow-inner group-hover:scale-110 transition-transform duration-500">
                                                <ShieldAlert className="h-8 w-8" />
                                            </div>
                                            <div className="space-y-1.5 min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="text-[10px] font-mono font-bold text-primary uppercase">#{q.id.substring(0,8)}</p>
                                                    <Badge variant="outline" className="border-rose-200 text-rose-600 font-black text-[8px] h-5 px-2 uppercase">
                                                        {q.daysOpen} DÍAS ABIERTA
                                                    </Badge>
                                                </div>
                                                <h3 className="text-base font-black uppercase text-slate-900 leading-tight truncate">{q.customerName}</h3>
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest italic">
                                                    COTIZACIÓN ACTIVA
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-8">
                                            <div className="text-right">
                                                <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Inversión Vulnerable</p>
                                                <p className="text-2xl font-black text-rose-600 tracking-tighter leading-none mt-1">
                                                    ${(q.totalAmount || 0).toLocaleString()}
                                                </p>
                                            </div>
                                            <Button 
                                                onClick={() => handleDelegate(q, 'leakage')} 
                                                className="h-12 px-8 rounded-xl bg-slate-900 text-white hover:bg-primary font-black uppercase text-[10px] tracking-widest shadow-xl active:scale-95 transition-all flex items-center gap-2"
                                            >
                                                <MessageCircle className="h-4 w-4" /> Delegar Cierre
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                        <div className="lg:col-span-4 space-y-8">
                            <Card className="border-none shadow-2xl rounded-[3rem] bg-slate-900 text-white p-10 relative overflow-hidden group h-full">
                                <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:rotate-12 transition-transform duration-1000"><ShieldAlert className="h-32 w-32" /></div>
                                <div className="relative z-10 space-y-10">
                                    <div className="space-y-2"><h3 className="text-2xl font-black uppercase tracking-tighter text-white italic">Protocolo de Rescate</h3><p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-relaxed">ACCIONES RECOMENDADAS PARA RECUPERAR EL REVENUE ABIERTO.</p></div>
                                    <div className="space-y-6">
                                        {[
                                            { label: 'Re-Oferta Masiva', desc: 'Disparar campaña oficial por WhatsApp.', icon: Megaphone, priority: 85 },
                                            { label: 'Contacto VIP', desc: 'Priorizar cuentas clave con +3 días.', icon: Trophy, priority: 65 },
                                            { label: 'Ajuste de Stock', desc: 'Vincular ítems de alta demanda.', icon: Box, priority: 45 }
                                        ].map((step, i) => (
                                            <div key={i} className="space-y-2">
                                                <div className="flex gap-4 group/item">
                                                    <div className="h-10 w-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-primary group-hover/item:scale-110 transition-transform"><step.icon className="h-5 w-5" /></div>
                                                    <div className="space-y-0.5"><p className="text-xs font-black uppercase text-white">{step.label}</p><p className="text-[9px] text-slate-500 font-bold uppercase">{step.desc}</p></div>
                                                </div>
                                                <Progress value={step.priority} className="h-1 bg-white/5" />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </Card>
                        </div>
                    </div>
                </TabsContent>

                {/* 4. Historial de Difusiones */}
                <TabsContent value="campaigns" className="mt-0 outline-none animate-in fade-in-50 duration-700">
                    <Card className="border-none shadow-xl rounded-[2.5rem] bg-white p-8 space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-xl font-black uppercase tracking-tight text-slate-900">
                                    Campañas Masivas Recientes
                                </h3>
                                <p className="text-xs text-slate-500 font-medium mt-0.5">
                                    Registro de difusiones procesadas en segundo plano con protección anti-bloqueo.
                                </p>
                            </div>
                            <Button 
                                onClick={() => setIsBroadcastOpen(true)}
                                size="sm" 
                                className="h-10 rounded-xl font-black uppercase text-[10px] bg-primary text-white"
                            >
                                <Megaphone className="h-3.5 w-3.5 mr-1.5" /> Nueva Campaña
                            </Button>
                        </div>

                        {(!allCampaigns || allCampaigns.length === 0) ? (
                            <div className="p-12 text-center text-slate-400 font-bold text-xs uppercase tracking-widest">
                                No se registran campañas masivas recientes. Presiona &quot;Nueva Difusión Masiva&quot; para iniciar una.
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {allCampaigns.map((camp: any) => (
                                    <div key={camp.id} className="p-6 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                        <div className="space-y-1 flex-1">
                                            <div className="flex items-center gap-2">
                                                <Badge className={cn("text-[8px] font-black uppercase border-none px-2", camp.status === 'completed' ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700")}>
                                                    {camp.status === 'completed' ? 'Completada' : 'Procesando en Fondo'}
                                                </Badge>
                                                <span className="text-[10px] text-slate-400 font-mono">
                                                    {camp.createdAt ? new Date((camp.createdAt as any).toDate ? (camp.createdAt as any).toDate() : camp.createdAt).toLocaleDateString() : 'Hoy'}
                                                </span>
                                            </div>
                                            <h4 className="text-sm font-black uppercase text-slate-900">{camp.title}</h4>
                                            <p className="text-xs text-slate-600 line-clamp-1">{camp.message}</p>
                                        </div>

                                        <div className="flex items-center gap-6 shrink-0">
                                            <div className="text-right">
                                                <p className="text-[9px] font-black uppercase text-slate-400">Entregados</p>
                                                <p className="text-base font-black text-emerald-600">
                                                    {camp.sentCount || 0} / {camp.totalTarget || 0}
                                                </p>
                                            </div>
                                            {camp.failedCount > 0 && (
                                                <div className="text-right">
                                                    <p className="text-[9px] font-black uppercase text-slate-400">Fallidos</p>
                                                    <p className="text-base font-black text-rose-600">
                                                        {camp.failedCount}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Modal de Difusión Masiva */}
            <BroadcastCampaignModal 
                isOpen={isBroadcastOpen} 
                onOpenChange={setIsBroadcastOpen} 
                customers={allCustomers || []} 
                products={allProducts || []}
                paretoCustomers={metrics?.pareto || []}
            />
        </div>
    );
}

export default function MarketingPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
            <MarketingContent />
        </Suspense>
    );
}
