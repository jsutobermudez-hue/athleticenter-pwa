'use client';

import React, { useMemo, useState } from 'react';
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, limit, doc } from 'firebase/firestore';
import type { Order, Product, Customer, Offer, FinancialSettings, PurchaseOrder, Invoice, OrderStatus } from '@/lib/definitions';
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
    ShieldCheck,
    Award,
    Flame,
    Clock,
    Medal,
    ClipboardList,
    PlusCircle,
    FileText,
    Calculator,
    Globe,
    Truck,
    Sparkles,
    Activity,
    Bot
} from 'lucide-react';
import { DashboardMetricCard } from '@/components/dashboard/DashboardMetricCard';
import { CatalogHighlights } from '@/components/dashboard/CatalogHighlights';
import { SalesTrendChart } from '@/components/dashboard/SalesTrendChart';
import { OrderStatusChart } from '@/components/dashboard/OrderStatusChart';
import { LiveActivityFeed } from '@/components/dashboard/LiveActivityFeed';
import { SalespersonRankingCard } from '@/components/dashboard/SalespersonRankingCard';
import { PaidInvoicesCard } from '@/components/dashboard/PaidInvoicesCard';
import { ExecutiveMetricsSuite } from '@/components/dashboard/ExecutiveMetricsSuite';
import { ReceivablesAuditModal } from '@/components/dashboard/ReceivablesAuditModal';
import { CashAuditModal } from '@/components/dashboard/CashAuditModal';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { OrderSheetController } from './orders/OrderSheetController';
import { ProductDetailsSheet } from '@/app/dashboard/inventory/product-details-sheet';
import { cn } from '@/lib/utils';
import { calculateGlobalFinancialMetrics, getInvoiceFromOrder } from '@/lib/billing';

export default function AdminDashboard() {
    const router = useRouter();
    const firestore = useFirestore();
    const { profile } = useUser();

    // Estados de selección para vistas detalladas
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [isReceivablesModalOpen, setIsReceivablesModalOpen] = useState<boolean>(false);
    const [isCashAuditModalOpen, setIsCashAuditModalOpen] = useState<boolean>(false);

    // Conversor instantáneo BCV
    const [usdAmountInput, setUsdAmountInput] = useState<string>('100');

    const ordersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'orders'), limit(500)) : null), [firestore]);
    const productsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'products'), limit(200)) : null), [firestore]);
    const customersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'customers'), limit(100)) : null), [firestore]);
    const offersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'offers'), limit(100)) : null), [firestore]);
    const posQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'purchaseOrders'), limit(100)) : null), [firestore]);

    const settingsRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
    const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);

    const { data: orders } = useCollection<Order>(ordersQuery);
    const { data: products } = useCollection<Product>(productsQuery);
    const { data: customers } = useCollection<Customer>(customersQuery);
    const { data: allOffers } = useCollection<Offer>(offersQuery);
    const { data: purchaseOrders } = useCollection<PurchaseOrder>(posQuery);

    const canManageInventory = profile && ['superadmin', 'admin', 'gerencia', 'deposito'].includes(profile.role);
    const isSuperAdmin = profile?.role === 'superadmin';

    const bcvRate = globalSettings?.bcvRate || 65.50;

    // Mapeo de colores para estados de órdenes
    const STATUS_COLORS: { [key: string]: string } = {
        'Borrador': 'bg-slate-500/10 text-slate-400 border-slate-500/20',
        'Pendiente': 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
        'Aprobado': 'bg-blue-500/10 text-blue-500 border-blue-500/20',
        'En Preparación': 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
        'Completado': 'bg-purple-500/10 text-purple-500 border-purple-500/20',
        'Despachado': 'bg-orange-500/10 text-orange-500 border-orange-500/20',
        'Entregado': 'bg-green-500/10 text-green-500 border-green-500/20',
        'Cancelado': 'bg-rose-500/10 text-rose-500 border-rose-500/20',
        'En Verificación': 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20',
        'Pagado': 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
        'Rechazado': 'bg-red-500/10 text-red-500 border-red-500/20',
    };

    // Formateador de fechas para pedidos
    const formatOrderDate = (ts: any) => {
        if (!ts) return '';
        const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
        return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) + ' ' + 
               date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
    };

    // Top productos más vendidos
    const topSellingProducts = useMemo(() => {
        if (!products) return [];
        return [...products]
            .sort((a, b) => (b.totalSold || 0) - (a.totalSold || 0))
            .slice(0, 5);
    }, [products]);

    // Últimos 10 pedidos realizados
    const recentOrders = useMemo(() => {
        if (!orders) return [];
        const getDate = (ts: any) => ts ? (typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts)) : new Date(0);
        return [...orders]
            .sort((a, b) => getDate(b.createdAt).getTime() - getDate(a.createdAt).getTime())
            .slice(0, 10);
    }, [orders]);

    // Estado de filtro de período para tarjetas KPI del inicio
    const [kpiPeriod, setKpiPeriod] = useState<'today' | '7d' | 'this_month' | 'last_month' | 'all'>('all');

    const stats = useMemo(() => {
        if (!orders || !products || !customers) return { 
            revenue: 0, pending: 0, lowStock: 0, clients: 0, inventoryValuation: 0, totalDebts: 0, inTransitValuation: 0,
            recaudadoCash: 0, cashBreakdown: null,
            totalOrdersCount: 0, totalOrdersAmount: 0, liquidadosCount: 0, liquidadosAmount: 0 
        };
        
        const globalMetrics = calculateGlobalFinancialMetrics(orders, kpiPeriod);
        const revenue = globalMetrics.totalRevenue;
        const totalDebts = globalMetrics.totalDebts;
        const pending = globalMetrics.pendingOrdersCount;

        const lowStock = products.filter(p => (p.stockLevel ?? (p as any).stock ?? 0) < 10).length;
        const clients = customers.filter(c => c.status === 'Activo').length;

        let inventoryValuation = 0;
        products.forEach(p => {
            const qty = p.stockLevel ?? (p as any).stock ?? 0;
            inventoryValuation += qty * (p.price || 0);
        });

        let inTransitValuation = 0;
        if (purchaseOrders) {
            purchaseOrders.forEach(po => {
                if (po.status !== 'Recibido' && po.status !== 'Cancelado') {
                    inTransitValuation += po.totalCost || 0;
                }
            });
        }

        return { 
            revenue, pending, lowStock, clients, inventoryValuation, totalDebts, inTransitValuation,
            recaudadoCash: globalMetrics.recaudadoCash,
            cashBreakdown: globalMetrics.cashBreakdown,
            totalOrdersCount: globalMetrics.totalOrdersCount,
            totalOrdersAmount: globalMetrics.totalOrdersAmount,
            liquidadosCount: globalMetrics.liquidadosCount,
            liquidadosAmount: globalMetrics.liquidadosAmount
        };
    }, [orders, products, customers, purchaseOrders, kpiPeriod]);

    const allInvoices = useMemo(() => {
        if (!orders) return [];
        const baseStatuses: OrderStatus[] = ['Entregado', 'En Verificación', 'Pagado', 'Despachado', 'Aprobado', 'En Preparación', 'Completado'];
        const filtered = orders.filter(o => baseStatuses.includes(o.status));
        return filtered.map(getInvoiceFromOrder).filter(Boolean) as Invoice[];
    }, [orders]);

    const cashFlowForecast = useMemo(() => {
        if (!allInvoices) return { next7Days: 0, next15Days: 0, next30Days: 0, overdue: 0, totalProjected: 0 };
        let next7Days = 0;
        let next15Days = 0;
        let next30Days = 0;
        let overdue = 0;

        allInvoices.forEach(inv => {
            if (inv.remainingBalance > 0.05 && inv.status !== 'Pagado') {
                const days = inv.remainingCreditDays;
                if (days < 0) overdue += inv.remainingBalance;
                else if (days <= 7) next7Days += inv.remainingBalance;
                else if (days <= 15) next15Days += inv.remainingBalance;
                else if (days <= 30) next30Days += inv.remainingBalance;
            }
        });

        const totalProjected = next7Days + next15Days + next30Days;
        return { next7Days, next15Days, next30Days, overdue, totalProjected };
    }, [allInvoices]);

    const convertedBs = useMemo(() => {
        const usd = parseFloat(usdAmountInput) || 0;
        return (usd * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }, [usdAmountInput, bcvRate]);

    return (
        <div className="flex flex-col gap-8 pb-20 animate-in fade-in duration-700">
            {/* CABECERA Y ACCIONES RÁPIDAS EN 1-CLIC */}
            <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 px-1">
                <div className="space-y-1">
                    <h1 className="terminal-header flex items-center gap-3">
                        {isSuperAdmin ? "Mando Central SuperAdmin" : "Mando Central Ejecutivo"}
                    </h1>
                    <p className="tech-label opacity-60">Visión Global de Operaciones, Rendimiento de Red y Auditoría de Activos.</p>
                </div>
                
                {/* ACCIONES RÁPIDAS EN 1-CLIC */}
                <div className="flex flex-wrap items-center gap-2">
                    <Link href="/dashboard/pricing-intelligence">
                        <Button className="h-11 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black uppercase text-[9px] tracking-widest shadow-lg active:scale-95">
                            <Sparkles className="mr-1.5 h-4 w-4" /> Pricing Intelligence
                        </Button>
                    </Link>
                    <Link href="/dashboard/orders/new">
                        <Button className="h-11 px-4 rounded-xl bg-primary hover:bg-primary/90 text-white font-black uppercase text-[9px] tracking-widest shadow-lg active:scale-95">
                            <PlusCircle className="mr-1.5 h-4 w-4" /> Nuevo Pedido
                        </Button>
                    </Link>
                    <Link href="/dashboard/quotes/new">
                        <Button variant="outline" className="h-11 px-4 rounded-xl border-slate-200 bg-white font-black uppercase text-[9px] tracking-widest hover:bg-slate-50 shadow-sm active:scale-95">
                            <FileText className="mr-1.5 h-4 w-4 text-blue-600" /> Cotización
                        </Button>
                    </Link>
                    <Link href="/dashboard/billing">
                        <Button variant="outline" className="h-11 px-4 rounded-xl border-slate-200 bg-white font-black uppercase text-[9px] tracking-widest hover:bg-slate-50 shadow-sm active:scale-95">
                            <DollarSign className="mr-1.5 h-4 w-4 text-emerald-600" /> Cobranzas
                        </Button>
                    </Link>
                </div>
            </header>

            {/* CONVERTIDOR FINANCIERO Y MONITOR DE TASA BCV */}
            <div className="p-6 rounded-[2.2rem] bg-slate-900 text-white border border-primary/20 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl relative overflow-hidden mx-1">
                <div className="flex items-center gap-4">
                    <div className="p-3.5 rounded-2xl bg-primary/20 text-primary shrink-0">
                        <Calculator className="h-7 w-7" />
                    </div>
                    <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Tasa Oficial BCV</p>
                            <Badge className="bg-emerald-500/20 text-emerald-400 border-none text-[8px] font-black uppercase px-2 h-4">En Vivo</Badge>
                        </div>
                        <p className="text-2xl font-black tracking-tighter text-white">
                            Bs. {bcvRate.toFixed(2)} <span className="text-xs text-slate-400 font-bold uppercase">/ USD</span>
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto bg-white/5 p-2 rounded-2xl border border-white/10">
                    <div className="relative flex-1 md:w-32">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">$</span>
                        <Input 
                            value={usdAmountInput} 
                            onChange={(e) => setUsdAmountInput(e.target.value)} 
                            className="h-10 pl-7 text-right font-black text-sm bg-transparent border-none text-white focus-visible:ring-0" 
                            placeholder="100"
                        />
                    </div>
                    <span className="text-xs font-black text-slate-400">USD =</span>
                    <div className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-black tracking-tight shrink-0">
                        Bs. {convertedBs}
                    </div>
                </div>
            </div>

            {/* BARRA DE FILTROS DE PERÍODO INTERACTIVOS Y TARJETAS MÉTRICAS */}
            <div className="space-y-4 px-1">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                        <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Indicadores Ejecutivos</h2>
                        <p className="text-[9px] font-bold text-slate-400 uppercase">Métricas financieras y comerciales en tiempo real</p>
                    </div>
                    <div className="flex items-center bg-slate-100 p-1 rounded-2xl gap-1 border border-slate-200/60 shadow-sm">
                        {[
                            { id: 'today', label: '☀️ Hoy' },
                            { id: '7d', label: '⚡ 7 Días' },
                            { id: 'this_month', label: '🗓️ Mes Actual' },
                            { id: 'all', label: '🌐 Histórico' },
                        ].map(p => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => setKpiPeriod(p.id as any)}
                                className={cn(
                                    "px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer",
                                    kpiPeriod === p.id 
                                        ? "bg-slate-900 text-white shadow-md font-black" 
                                        : "text-slate-500 hover:text-slate-900 hover:bg-white/50 font-bold"
                                )}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    <DashboardMetricCard 
                        title="Pagos Registrados" 
                        value={`$${(stats.recaudadoCash || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`} 
                        subtitle={kpiPeriod === 'today' ? 'Cobros Hoy' : kpiPeriod === '7d' ? 'Cobros 7 Días' : kpiPeriod === 'this_month' ? 'Cobros Mes Actual' : 'Recaudado Efectivo'} 
                        tooltip="Total de pagos registrados en caja. Clic para auditar detalles, comprobar vouchers con imagen y ver quién lo registró."
                        icon={TrendingUp} iconBg="bg-emerald-50" iconColor="text-emerald-500" 
                        onClick={() => setIsCashAuditModalOpen(true)}
                    />
                    <DashboardMetricCard 
                        title="Cuentas por Cobrar" 
                        value={`$${stats.totalDebts.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} 
                        subtitle="Deuda Activa Clientes" 
                        tooltip="Monto total pendiente por cobrar a clientes con créditos activos o abonos pendientes."
                        icon={DollarSign} iconBg="bg-rose-50" iconColor="text-rose-500" 
                        alert={stats.totalDebts > 0}
                        onClick={() => router.push('/dashboard/billing?status=pendientes')}
                        onIconClick={() => setIsReceivablesModalOpen(true)}
                    />
                    <DashboardMetricCard 
                        title="Valor del Inventario" 
                        value={`$${stats.inventoryValuation.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} 
                        subtitle="Activos en Almacén" 
                        tooltip="Valoración económica total de las mercancías físicamente disponibles en almacén a precio de catálogo."
                        icon={Boxes} iconBg="bg-blue-50" iconColor="text-blue-500" 
                        onClick={() => router.push('/dashboard/inventory')}
                    />
                    <DashboardMetricCard 
                        title="Pedidos Realizados" 
                        value={`${stats.totalOrdersCount} Pedidos`} 
                        subtitle={`$${stats.totalOrdersAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })} Registrados`} 
                        tooltip="Volumen acumulado de órdenes comerciales ingresadas al sistema en todas sus fases operativas."
                        icon={ShoppingCart} iconBg="bg-indigo-50" iconColor="text-indigo-500" 
                        onClick={() => router.push('/dashboard/orders')}
                    />
                </div>

                {/* WIDGET PREDICTOR: PROYECCIÓN INTELIGENTE DE FLUJO DE CAJA (CASH FLOW FORECASTING) */}
                <div className="p-6 sm:p-7 rounded-[2.5rem] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 text-white shadow-2xl space-y-5 border border-white/10 text-left relative overflow-hidden mt-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10 relative z-10">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2.5">
                                <div className="h-8 w-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shadow-md border border-emerald-500/30">
                                    <Sparkles className="h-4.5 w-4.5 animate-pulse" />
                                </div>
                                <h3 className="text-base sm:text-xl font-black uppercase tracking-tight text-white leading-none">Proyección Inteligente de Flujo de Caja</h3>
                            </div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em]">
                                Estimación predictiva de ingresos a 30 días según vencimientos de créditos activos
                            </p>
                        </div>
                        <Badge className="w-fit bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-black uppercase px-3.5 h-7 rounded-xl shadow-md">
                            Proyección Total: ${Math.round(cashFlowForecast.totalProjected).toLocaleString('en-US')} USD
                        </Badge>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 relative z-10">
                        <div 
                            onClick={() => router.push('/dashboard/billing?aging=0-7d')}
                            className="p-5 rounded-[1.8rem] bg-emerald-950/40 border border-emerald-500/30 hover:border-emerald-400/60 hover:bg-emerald-900/40 transition-all cursor-pointer space-y-2 shadow-lg group"
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-[9px] font-black uppercase text-emerald-400 tracking-wider">Próximos 7 Días</span>
                                <div className="h-7 w-7 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
                                    <Clock className="h-3.5 w-3.5" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-white tracking-tight">
                                ${cashFlowForecast.next7Days.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                            <p className="text-[8px] font-bold text-emerald-300/80 uppercase tracking-wider">Recaudación a Corto Plazo</p>
                        </div>

                        <div 
                            onClick={() => router.push('/dashboard/billing?aging=8-15d')}
                            className="p-5 rounded-[1.8rem] bg-blue-950/40 border border-blue-500/30 hover:border-blue-400/60 hover:bg-blue-900/40 transition-all cursor-pointer space-y-2 shadow-lg group"
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-[9px] font-black uppercase text-blue-400 tracking-wider">Días 8 a 15</span>
                                <div className="h-7 w-7 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
                                    <Clock className="h-3.5 w-3.5" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-white tracking-tight">
                                ${cashFlowForecast.next15Days.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                            <p className="text-[8px] font-bold text-blue-300/80 uppercase tracking-wider">Flujo a Mediano Plazo</p>
                        </div>

                        <div 
                            onClick={() => router.push('/dashboard/billing?aging=16-30d')}
                            className="p-5 rounded-[1.8rem] bg-indigo-950/40 border border-indigo-500/30 hover:border-indigo-400/60 hover:bg-indigo-900/40 transition-all cursor-pointer space-y-2 shadow-lg group"
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-[9px] font-black uppercase text-indigo-400 tracking-wider">Días 16 a 30</span>
                                <div className="h-7 w-7 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
                                    <Clock className="h-3.5 w-3.5" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-white tracking-tight">
                                ${cashFlowForecast.next30Days.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                            <p className="text-[8px] font-bold text-indigo-300/80 uppercase tracking-wider">Cierre Mensual Estimado</p>
                        </div>

                        <div 
                            onClick={() => router.push('/dashboard/billing?status=Vencido')}
                            className="p-5 rounded-[1.8rem] bg-rose-950/40 border border-rose-500/30 hover:border-rose-400/60 hover:bg-rose-900/40 transition-all cursor-pointer space-y-2 shadow-lg group"
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-[9px] font-black uppercase text-rose-400 tracking-wider">Mora Crítica (Vencido)</span>
                                <div className="h-7 w-7 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center border border-rose-500/30">
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-rose-200 tracking-tight">
                                ${cashFlowForecast.overdue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                            <p className="text-[8px] font-bold text-rose-400/80 uppercase tracking-wider">Cobranza Crítica Requerida</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* ESPECIAL SUPERADMIN: SUITE DE CONTROL DE INTELIGENCIA Y RED */}
            {isSuperAdmin && (
              <Card className="border border-primary/20 bg-slate-900 text-white rounded-[2.5rem] shadow-2xl overflow-hidden mx-1">
                <CardHeader className="p-8 border-b border-white/5 bg-slate-900/50">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-3">
                      <Bot className="h-5 w-5 text-primary animate-pulse" /> Consola de Mando SuperAdmin
                    </CardTitle>
                    <Badge className="bg-primary/20 text-primary border-none font-black text-[9px] uppercase px-3">
                      Acceso Máximo
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-5 sm:p-8 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-6">
                  <div className="p-5 sm:p-6 rounded-2xl bg-white/5 border border-white/10 space-y-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Analista de Negocio IA</p>
                    <p className="text-xs font-medium text-slate-300">Consulta informes estratégicos y proyecciones financieras impulsadas por Genkit.</p>
                    <Button onClick={() => router.push('/dashboard/ai-analyst')} className="w-full h-10 rounded-xl bg-primary hover:bg-primary/90 text-white font-black text-[9px] uppercase tracking-wider">
                      Consultar Analista IA <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="p-5 sm:p-6 rounded-2xl bg-white/5 border border-white/10 space-y-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Bitácora de Auditoría en Vivo</p>
                    <p className="text-xs font-medium text-slate-300">Audita cada cambio de stock, tasa de cambio y ajustes de rol en la red.</p>
                    <Button onClick={() => router.push('/dashboard/audit')} variant="outline" className="w-full h-10 rounded-xl border-white/20 bg-transparent text-white font-black text-[9px] uppercase tracking-wider hover:bg-white/10">
                      Ver Log Auditoría <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div 
                    onClick={() => router.push('/dashboard/purchase-orders')}
                    className="p-5 sm:p-6 rounded-2xl bg-white/5 border border-white/10 space-y-3 cursor-pointer hover:bg-white/10 transition-colors"
                  >
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center justify-between">
                      <span>Importación en Tránsito</span>
                      <Globe className="h-4 w-4 text-indigo-400" />
                    </p>
                    <p className="text-2xl font-black text-indigo-400 tracking-tighter">
                      ${stats.inTransitValuation.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-[8px] font-bold text-slate-500 uppercase">Lotes Marítimos y Aéreos</p>
                  </div>

                  <div className="p-5 sm:p-6 rounded-2xl bg-white/5 border border-white/10 space-y-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Patrimonio Neto Operativo</p>
                    <p className="text-2xl font-black text-emerald-400 tracking-tighter">
                      ${(stats.inventoryValuation + stats.totalDebts + stats.inTransitValuation).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-[8px] font-bold text-slate-500 uppercase">Inventario + Deudas + Tránsito</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* GRÁFICOS RECHARTS */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 px-1">
                <SalesTrendChart orders={orders} />
                <OrderStatusChart orders={orders} />
            </div>

            {/* SUITE DE ANALÍTICA EJECUTIVA */}
            <div className="px-1">
                <ExecutiveMetricsSuite orders={orders} />
            </div>

            {/* RANKINGS Y PEDIDOS RECIENTES */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 px-1">
                <div className="lg:col-span-7 space-y-8">
                    <SalespersonRankingCard orders={orders || []} />
                    <PaidInvoicesCard orders={orders || []} />

                    <Card className="border border-white/10 shadow-2xl rounded-[2.5rem] bg-slate-900 text-white overflow-hidden">
                        <CardHeader className="p-8 border-b border-white/5">
                            <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-3">
                                <Flame className="h-5 w-5 text-primary animate-pulse" /> Productos Más Vendidos
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-8 space-y-4">
                            {topSellingProducts.length > 0 ? (
                                <div className="space-y-3">
                                    {topSellingProducts.map((p, index) => (
                                        <div 
                                            key={p.id} 
                                            onClick={() => setSelectedProduct(p)}
                                            className="p-4 rounded-2xl border border-white/5 bg-white/5 flex items-center justify-between group hover:bg-white/10 hover:border-primary/20 transition-all cursor-pointer active:scale-98"
                                        >
                                            <div className="flex items-center gap-4 min-w-0">
                                                <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center text-xs font-black text-slate-300">
                                                    #{index + 1}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-xs font-black uppercase text-white truncate leading-none">{p.name}</p>
                                                    <p className="text-[8px] font-mono text-slate-500 mt-1">SKU: {p.sku} / Marca: {p.brand || 'N/A'}</p>
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0 flex items-center gap-3">
                                                <div>
                                                    <p className="text-xs font-black text-primary leading-none">{p.totalSold || 0} un.</p>
                                                    <span className="text-[7px] font-black text-slate-500 uppercase tracking-widest">Vendidos (Stock: {p.stockLevel})</span>
                                                </div>
                                                <ArrowUpRight className="h-4 w-4 text-slate-500 group-hover:text-primary transition-colors" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex h-32 items-center justify-center text-slate-500 text-xs font-black uppercase border border-dashed border-white/10 rounded-3xl">
                                    Esperando Nuevos Registros de Venta
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                <div className="lg:col-span-5">
                    <Card className="border border-white/10 shadow-2xl rounded-[2.5rem] bg-slate-900 text-white overflow-hidden h-full">
                        <CardHeader className="p-8 border-b border-white/5">
                            <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-3">
                                <ClipboardList className="h-5 w-5 text-primary" /> Últimos 10 Pedidos
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-8">
                            {recentOrders.length > 0 ? (
                                <div className="space-y-4">
                                    {recentOrders.map((o) => (
                                        <div 
                                            key={o.id} 
                                            onClick={() => setSelectedOrder(o)}
                                            className="p-4 rounded-2xl border border-white/5 bg-white/5 flex flex-col gap-2 group hover:bg-white/10 hover:border-primary/20 transition-all cursor-pointer active:scale-98"
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="text-[10px] font-black text-primary uppercase">
                                                    #{o.id.substring(0, 8).toUpperCase()}
                                                </span>
                                                <span className="text-[8px] font-mono text-slate-500">
                                                    {formatOrderDate(o.createdAt || o.orderDate)}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-end">
                                                <div className="min-w-0">
                                                    <p className="text-[11px] font-black uppercase text-white truncate leading-none">{o.customerName}</p>
                                                    <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mt-1.5">Vendedor: {o.salespersonName}</p>
                                                </div>
                                                <div className="text-right shrink-0 flex items-center gap-3">
                                                    <div>
                                                        <p className="text-xs font-black text-emerald-400 leading-none">${o.totalAmount.toLocaleString()}</p>
                                                        <Badge variant="outline" className={cn("mt-1.5 text-[6px] font-black uppercase border-none px-2 h-4 flex items-center justify-center", STATUS_COLORS[o.status] || 'bg-slate-500/10 text-slate-400')}>
                                                            {o.status}
                                                        </Badge>
                                                    </div>
                                                    <ArrowUpRight className="h-4 w-4 text-slate-500 group-hover:text-primary transition-colors" />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex h-64 items-center justify-center text-slate-500 text-xs font-black uppercase border border-dashed border-white/10 rounded-3xl">
                                    Sin Pedidos Registrados
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* HIGHLIGHTS DE CATÁLOGO Y ACCESOS */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start px-1">
                <div className="lg:col-span-8 space-y-8">
                    <section className="space-y-4">
                        <div className="flex items-center justify-between px-1">
                            <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-2">
                                <Zap className="h-4 w-4 text-primary" /> Novedades y Destacados
                            </h3>
                            <Link href="/dashboard/inventory" className="text-[10px] font-black uppercase text-primary flex items-center gap-1 hover:underline">
                                Ver Catálogo <ArrowUpRight className="h-3 w-3" />
                            </Link>
                        </div>
                        <CatalogHighlights />
                    </section>
                </div>

                <div className="lg:col-span-4 space-y-8">
                    <LiveActivityFeed />
                </div>
            </div>

            {/* CONTROLADORES DE DETALLE */}
            {selectedOrder && (
                <OrderSheetController 
                    order={selectedOrder} 
                    onOpenChange={(open) => !open && setSelectedOrder(null)} 
                />
            )}

            <ProductDetailsSheet
                product={selectedProduct}
                allOffers={allOffers || []}
                isOpen={!!selectedProduct}
                onOpenChange={(open) => !open && setSelectedProduct(null)}
                canManageInventory={!!canManageInventory}
                canDelete={false}
                onDelete={() => {}}
            />

            <ReceivablesAuditModal
                isOpen={isReceivablesModalOpen}
                onClose={() => setIsReceivablesModalOpen(false)}
                orders={orders}
                onSelectOrder={(o) => setSelectedOrder(o)}
            />

            <CashAuditModal
                isOpen={isCashAuditModalOpen}
                onClose={() => setIsCashAuditModalOpen(false)}
                orders={orders}
                periodFilter={kpiPeriod}
                bcvRate={bcvRate}
                onSelectOrder={(o) => setSelectedOrder(o)}
            />
        </div>
    );
}
