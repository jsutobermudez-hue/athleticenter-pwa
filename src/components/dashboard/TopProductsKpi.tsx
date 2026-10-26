'use client';

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
    Flame, 
    TrendingUp, 
    AlertOctagon, 
    DollarSign, 
    Package, 
    Sparkles, 
    ArrowUpRight,
    Boxes
} from 'lucide-react';
import type { Order, Product } from '@/lib/definitions';
import { cn } from '@/lib/utils';

interface TopProductsKpiProps {
    orders: Order[];
    products: Product[];
    className?: string;
    onSelectProduct?: (product: Product) => void;
}

interface ProductPerformance {
    productId: string;
    sku: string;
    name: string;
    category: string;
    currentStock: number;
    minThreshold: number;
    unitsSold: number;
    revenueUSD: number;
    estimatedProfitUSD: number;
    stockDaysRemaining: number | null; // Días estimados antes de quiebre
    isLowStockRisk: boolean;
    productRef?: Product;
}

export function TopProductsKpi({ orders, products, className, onSelectProduct }: TopProductsKpiProps) {
    const [viewMode, setViewMode] = useState<'volume' | 'revenue' | 'risk'>('revenue');

    // Cálculo del rendimiento cruzando tanto órdenes que tengan items embebidos como el acumulador nativo totalSold de Product
    const performanceData = useMemo(() => {
        const stats = new Map<string, { unitsSold: number; revenueUSD: number }>();

        // 1. Escaneamos órdenes válidas (por si traen items o líneas embebidas)
        const validStatuses = new Set(['Aprobado', 'Preparacion', 'Despachado', 'Entregado', 'Facturado']);
        
        orders.forEach(order => {
            if (!validStatuses.has(order.status)) return;
            const anyOrder = order as any;
            const items = anyOrder.items || anyOrder.orderItems || [];
            if (Array.isArray(items)) {
                items.forEach((item: any) => {
                    const pId = item.productId || item.id;
                    if (!pId) return;
                    const current = stats.get(pId) || { unitsSold: 0, revenueUSD: 0 };
                    const qty = Number(item.quantity || item.qty || 0);
                    const price = Number(item.unitPrice || item.price || 0);
                    current.unitsSold += qty;
                    current.revenueUSD += qty * price;
                    stats.set(pId, current);
                });
            }
        });

        const list: ProductPerformance[] = [];

        // 2. Evaluamos métricas para cada producto del inventario
        products.forEach(p => {
            const pId = p.id || '';
            const stat = stats.get(pId) || { unitsSold: 0, revenueUSD: 0 };
            
            // Si no vinieron items embebidos en las órdenes, tomamos el acumulado nativo totalSold
            const totalUnits = stat.unitsSold > 0 ? stat.unitsSold : Number((p as any).totalSold || 0);
            const totalRevenue = stat.revenueUSD > 0 
                ? stat.revenueUSD 
                : totalUnits * (p.priceCashUSD || p.price || 0);

            const cost = p.cost || 0;
            const estimatedProfit = totalRevenue - (totalUnits * cost);
            
            // Estimación de quiebre de stock: ventana estimada mensual
            const dailyRunRate = totalUnits > 0 ? totalUnits / 30 : 0;
            let stockDaysRemaining: number | null = null;
            if (dailyRunRate > 0) {
                stockDaysRemaining = Math.max(0, Math.round((p.stockLevel || 0) / dailyRunRate));
            }

            const threshold = p.minStockThreshold || 5;
            const isLowStockRisk = ((p.stockLevel || 0) <= threshold) || (stockDaysRemaining !== null && stockDaysRemaining <= 7);

            list.push({
                productId: pId,
                sku: p.sku || 'N/A',
                name: p.name || 'Sin nombre',
                category: p.category || 'General',
                currentStock: p.stockLevel || 0,
                minThreshold: threshold,
                unitsSold: totalUnits,
                revenueUSD: totalRevenue,
                estimatedProfitUSD: estimatedProfit,
                stockDaysRemaining,
                isLowStockRisk,
                productRef: p
            });
        });

        return list;
    }, [orders, products]);

    // Segmentaciones
    const topByRevenue = useMemo(() => {
        return [...performanceData]
            .filter(p => p.revenueUSD > 0)
            .sort((a, b) => b.revenueUSD - a.revenueUSD)
            .slice(0, 5);
    }, [performanceData]);

    const topByVolume = useMemo(() => {
        return [...performanceData]
            .filter(p => p.unitsSold > 0)
            .sort((a, b) => b.unitsSold - a.unitsSold)
            .slice(0, 5);
    }, [performanceData]);

    const stockRiskProducts = useMemo(() => {
        return [...performanceData]
            .filter(p => p.isLowStockRisk && (p.unitsSold > 0 || p.currentStock <= p.minThreshold))
            .sort((a, b) => {
                if (a.stockDaysRemaining === null) return 1;
                if (b.stockDaysRemaining === null) return -1;
                return a.stockDaysRemaining - b.stockDaysRemaining;
            })
            .slice(0, 5);
    }, [performanceData]);

    // Totales rápidos para las insignias
    const totalCatalogRevenue = useMemo(() => {
        return performanceData.reduce((acc, curr) => acc + curr.revenueUSD, 0);
    }, [performanceData]);

    const displayList = viewMode === 'revenue' 
        ? topByRevenue 
        : viewMode === 'volume' 
            ? topByVolume 
            : stockRiskProducts;

    return (
        <Card className={cn(
            "terminal-card border-none shadow-xl rounded-[2.5rem] overflow-hidden bg-white dark:bg-slate-900",
            className
        )}>
            <CardHeader className="p-6 md:p-8 border-b border-slate-100 dark:border-slate-800/60">
                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <span className="p-2 rounded-xl bg-amber-500/10 text-amber-500 font-bold">
                                <Flame className="h-4 w-4" />
                            </span>
                            <CardTitle className="text-sm font-black uppercase tracking-[0.25em] text-slate-900 dark:text-white">
                                Top Productos Estrella & Alerta de Quiebre
                            </CardTitle>
                            <Badge className="bg-primary/10 text-primary border-none text-[9px] font-black uppercase tracking-wider">
                                <Sparkles className="h-3 w-3 mr-1" /> IA Engine
                            </Badge>
                        </div>
                        <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                            Rendimiento comercial real en base a órdenes confirmadas y predicción de reposición.
                        </p>
                    </div>

                    {/* SELECTORES DE VISTA */}
                    <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-2xl border border-slate-200/50 dark:border-slate-700/50">
                        <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => setViewMode('revenue')}
                            className={cn(
                                "h-8 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all",
                                viewMode === 'revenue' 
                                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm" 
                                    : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
                            )}
                        >
                            <DollarSign className="h-3 w-3 mr-1 text-emerald-500" /> + Rentables
                        </Button>
                        <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => setViewMode('volume')}
                            className={cn(
                                "h-8 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all",
                                viewMode === 'volume' 
                                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm" 
                                    : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
                            )}
                        >
                            <TrendingUp className="h-3 w-3 mr-1 text-blue-500" /> + Vendidos
                        </Button>
                        <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => setViewMode('risk')}
                            className={cn(
                                "h-8 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all",
                                viewMode === 'risk' 
                                    ? "bg-rose-500 text-white shadow-sm shadow-rose-500/20" 
                                    : "text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                            )}
                        >
                            <AlertOctagon className="h-3 w-3 mr-1" /> Riesgo Stock ({stockRiskProducts.length})
                        </Button>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="p-6 md:p-8">
                {displayList.length === 0 ? (
                    <div className="py-12 flex flex-col items-center justify-center text-center gap-3">
                        <div className="p-4 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400">
                            <Package className="h-8 w-8" />
                        </div>
                        <p className="text-xs font-black text-slate-500 uppercase tracking-widest">
                            {viewMode === 'risk' 
                                ? 'Todo el inventario está protegido. No hay riesgo de quiebre en este momento.'
                                : 'No hay suficientes órdenes confirmadas para calcular este ranking.'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-3">
                        {displayList.map((item, idx) => {
                            const percentOfTotal = totalCatalogRevenue > 0 
                                ? ((item.revenueUSD / totalCatalogRevenue) * 100).toFixed(1) 
                                : '0';

                            return (
                                <div 
                                    key={item.productId}
                                    onClick={() => item.productRef && onSelectProduct?.(item.productRef)}
                                    className={cn(
                                        "group flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-2xl border transition-all duration-200 cursor-pointer",
                                        "bg-slate-50/50 hover:bg-slate-100/70 border-slate-100 dark:bg-slate-800/40 dark:hover:bg-slate-800/80 dark:border-slate-800",
                                        item.isLowStockRisk && viewMode === 'risk' && "border-rose-200 dark:border-rose-900/50 bg-rose-50/20"
                                    )}
                                >
                                    {/* IDENTIFICADOR & NOMBRE */}
                                    <div className="flex items-center gap-3.5 min-w-0">
                                        <div className={cn(
                                            "flex items-center justify-center h-8 w-8 rounded-xl font-black text-xs shrink-0",
                                            idx === 0 ? "bg-amber-500 text-white shadow-md shadow-amber-500/20" :
                                            idx === 1 ? "bg-slate-300 dark:bg-slate-700 text-slate-900 dark:text-white" :
                                            idx === 2 ? "bg-amber-700/60 text-white" :
                                            "bg-slate-100 dark:bg-slate-800 text-slate-500"
                                        )}>
                                            #{idx + 1}
                                        </div>
                                        <div className="min-w-0 space-y-0.5">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                                    SKU: {item.sku}
                                                </span>
                                                <Badge variant="outline" className="text-[8px] font-bold uppercase tracking-wider py-0 px-1.5 border-slate-200 dark:border-slate-700">
                                                    {item.category}
                                                </Badge>
                                            </div>
                                            <p className="text-xs font-black text-slate-900 dark:text-white uppercase truncate max-w-[280px] md:max-w-md group-hover:text-primary transition-colors">
                                                {item.name}
                                            </p>
                                        </div>
                                    </div>

                                    {/* MÉTRICAS NUMÉRICAS */}
                                    <div className="flex items-center justify-between sm:justify-end gap-6 w-full sm:w-auto mt-3 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-200/50 dark:border-slate-700/50">
                                        {/* STOCK ACTUAL */}
                                        <div className="text-left sm:text-right">
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">
                                                Stock Almacén
                                            </span>
                                            <span className={cn(
                                                "text-xs font-black flex items-center sm:justify-end gap-1",
                                                item.currentStock <= item.minThreshold 
                                                    ? "text-rose-600 dark:text-rose-400" 
                                                    : "text-slate-700 dark:text-slate-300"
                                            )}>
                                                <Boxes className="h-3 w-3 inline" />
                                                {item.currentStock} unds
                                                {item.stockDaysRemaining !== null && (
                                                    <span className="text-[9px] font-bold opacity-75">
                                                        (~{item.stockDaysRemaining}d)
                                                    </span>
                                                )}
                                            </span>
                                        </div>

                                        {/* VENTAS ACUMULADAS */}
                                        <div className="text-left sm:text-right">
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">
                                                Vendidos
                                            </span>
                                            <span className="text-xs font-black text-slate-900 dark:text-white">
                                                {item.unitsSold} unds
                                            </span>
                                        </div>

                                        {/* TOTAL USD */}
                                        <div className="text-right min-w-[90px]">
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">
                                                Facturación
                                            </span>
                                            <span className="text-sm font-black text-emerald-600 dark:text-emerald-400 block">
                                                ${item.revenueUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                            <span className="text-[8px] font-extrabold text-slate-400">
                                                {percentOfTotal}% del total
                                            </span>
                                        </div>

                                        <ArrowUpRight className="h-4 w-4 text-slate-300 group-hover:text-primary transition-colors hidden sm:block shrink-0" />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
