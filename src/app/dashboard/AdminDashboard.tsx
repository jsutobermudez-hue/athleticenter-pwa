'use client';

import React, { useMemo, useState } from 'react';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, limit } from 'firebase/firestore';
import type { Order, Product, Customer, Offer } from '@/lib/definitions';
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
    ClipboardList
} from 'lucide-react';
import { DashboardMetricCard } from '@/components/dashboard/DashboardMetricCard';
import { CatalogHighlights } from '@/components/dashboard/CatalogHighlights';
import { SalesTrendChart } from '@/components/dashboard/SalesTrendChart';
import { OrderStatusChart } from '@/components/dashboard/OrderStatusChart';
import { LiveActivityFeed } from '@/components/dashboard/LiveActivityFeed';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { OrderSheetController } from './orders/OrderSheetController';
import { ProductDetailsSheet } from '@/app/dashboard/inventory/product-details-sheet';
import { cn } from '@/lib/utils';
import { SalespersonRankingCard } from '@/components/dashboard/SalespersonRankingCard';

/**
 * TABLERO DE ADMINISTRACIÓN v2.2.0 - RANKINGS INTERACTIVOS Y MONITOREO EN TIEMPO REAL
 */
export default function AdminDashboard() {
    const router = useRouter();
    const firestore = useFirestore();
    const { profile } = useUser();

    // Estados de selección para vistas detalladas
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

    const ordersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'orders'), limit(100)) : null), [firestore]);
    const productsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'products'), limit(200)) : null), [firestore]);
    const customersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'customers'), limit(100)) : null), [firestore]);
    const offersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'offers'), limit(100)) : null), [firestore]);

    const { data: orders } = useCollection<Order>(ordersQuery);
    const { data: products } = useCollection<Product>(productsQuery);
    const { data: customers } = useCollection<Customer>(customersQuery);
    const { data: allOffers } = useCollection<Offer>(offersQuery);

    const canManageInventory = profile && ['superadmin', 'admin', 'gerencia', 'deposito'].includes(profile.role);
    const bcvDiscount = 30; // Descuento base

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
                <p className="tech-label opacity-60">Visión Global de Operaciones and Rendimiento de Red.</p>
            </header>

            {/* Tarjetas Métricas */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 px-1">
                <DashboardMetricCard 
                    title="Venta Realizada" 
                    value={`$${stats.revenue.toLocaleString()}`} 
                    subtitle="Recaudación CASH" 
                    icon={TrendingUp} iconBg="bg-emerald-50" iconColor="text-emerald-500" 
                    onClick={() => router.push('/dashboard/billing')}
                />
                <DashboardMetricCard 
                    title="Cola de Trabajo" 
                    value={stats.pending} 
                    subtitle="Pedidos Activos" 
                    icon={ShoppingCart} iconBg="bg-blue-50" iconColor="text-blue-500" 
                    onClick={() => router.push('/dashboard/orders')}
                />
                <DashboardMetricCard 
                    title="Stock Crítico" 
                    value={stats.lowStock} 
                    subtitle="SKUs bajo umbral" 
                    icon={AlertTriangle} iconBg="bg-rose-50" iconColor="text-rose-500"
                    alert={stats.lowStock > 0}
                    onClick={() => router.push('/dashboard/inventory')}
                />
                <DashboardMetricCard 
                    title="Red B2B" 
                    value={stats.clients} 
                    subtitle="Cuentas Activas" 
                    icon={Users} iconBg="bg-slate-900" iconColor="text-white" 
                    onClick={() => router.push('/dashboard/clients')}
                />
            </div>

            {/* Gráficos Recharts en Rejilla responsiva */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 px-1">
                <SalesTrendChart orders={orders} />
                <OrderStatusChart orders={orders} />
            </div>

            {/* SECCIÓN INTERMEDIA: RANKINGS Y PEDIDOS RECIENTES */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 px-1">
                {/* Columna Izquierda: Rankings (Vendedores y Productos) */}
                <div className="lg:col-span-7 space-y-8">
                    <SalespersonRankingCard orders={orders || []} />

                    {/* Productos Más Vendidos */}
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

                {/* Columna Derecha: Últimos 10 Pedidos Realizados */}
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

            {/* Highlights de Catálogo y Barra Lateral */}
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
                    {/* Accesos Tácticos */}
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

                    {/* Bitácora de Auditoría */}
                    <LiveActivityFeed />
                </div>
            </div>



            {/* Controladores de Detalle flotantes */}
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
        </div>
    );
}
