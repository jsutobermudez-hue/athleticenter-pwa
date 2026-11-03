'use client';

import React, { useState, useMemo } from 'react';
import type { Product } from '@/lib/definitions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Search,
    Filter,
    X,
    Tag,
    Check,
    Boxes,
    Sparkles,
    AlertTriangle,
    CheckCircle2,
    Eye,
    ChevronDown,
    ChevronUp,
    Package
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { subDays } from 'date-fns';

interface InventoryProductPickerProps {
    products: Product[];
    selectedProductSku?: string;
    onSelectProduct: (product: Product | null) => void;
    className?: string;
}

export function InventoryProductPicker({
    products = [],
    selectedProductSku,
    onSelectProduct,
    className
}: InventoryProductPickerProps) {
    // FILTROS IGUALES A LOS DE INVENTARIO
    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('todos');
    const [brandFilter, setBrandFilter] = useState('todos');
    const [disciplineFilter, setDisciplineFilter] = useState('todos');
    const [stockStatusFilter, setStockStatusFilter] = useState('todos'); // 'todos' | 'in_stock' | 'low' | 'out'
    const [specialFilter, setSpecialFilter] = useState<'todos' | 'offers' | 'new'>('todos');
    const [isPickerExpanded, setIsPickerExpanded] = useState(false);

    // PRODUCTO SELECCIONADO ACTUAL
    const selectedProduct = useMemo(() => {
        if (!selectedProductSku) return null;
        return products.find(p => p.sku === selectedProductSku) || null;
    }, [products, selectedProductSku]);

    // LISTAS ÚNICAS EXTRAÍDAS DEL INVENTARIO
    const uniqueCategories = useMemo(() => {
        return Array.from(new Set(products.map(p => p.category).filter(Boolean))).sort();
    }, [products]);

    const uniqueBrands = useMemo(() => {
        return Array.from(new Set(products.map(p => p.brand).filter(Boolean) as string[])).sort();
    }, [products]);

    const uniqueDisciplines = useMemo(() => {
        return Array.from(new Set(products.map(p => p.discipline).filter(Boolean) as string[])).sort();
    }, [products]);

    // FILTRADO DINÁMICO IDÉNTICO AL MÓDULO DE INVENTARIO
    const filteredProducts = useMemo(() => {
        let items = products;

        // 1. Filtro especial (ofertas o novedades)
        if (specialFilter === 'offers') {
            items = items.filter(p => p.activeOfferIds && p.activeOfferIds.length > 0);
        } else if (specialFilter === 'new') {
            const thirtyDaysAgo = subDays(new Date(), 30);
            items = items.filter(p => {
                const created = (p.createdAt as any)?.toDate?.() || (p.createdAt instanceof Date ? p.createdAt : null);
                return created && created >= thirtyDaysAgo;
            });
        }

        // 2. Filtro de existencias (Stock)
        if (stockStatusFilter !== 'todos') {
            items = items.filter(p => {
                const stockVal = p.stockLevel ?? (p as any).stock ?? 0;
                if (stockStatusFilter === 'in_stock') return stockVal >= 10;
                if (stockStatusFilter === 'low') return stockVal > 0 && stockVal < 10;
                if (stockStatusFilter === 'out') return stockVal === 0;
                return true;
            });
        }

        // 3. Filtro por categoría / rubro
        if (categoryFilter !== 'todos') {
            items = items.filter(p => p.category === categoryFilter);
        }

        // 4. Filtro por marca
        if (brandFilter !== 'todos') {
            items = items.filter(p => p.brand === brandFilter);
        }

        // 5. Filtro por disciplina deportiva
        if (disciplineFilter !== 'todos') {
            items = items.filter(p => p.discipline === disciplineFilter);
        }

        // 6. Búsqueda inteligente por texto libre
        const term = searchTerm.toLowerCase().trim();
        if (term) {
            items = items.filter(p => 
                p.name.toLowerCase().includes(term) ||
                p.sku.toLowerCase().includes(term) ||
                (p.brand && p.brand.toLowerCase().includes(term)) ||
                (p.discipline && p.discipline.toLowerCase().includes(term)) ||
                (p.category && p.category.toLowerCase().includes(term)) ||
                (p.warehouseLocation && p.warehouseLocation.toLowerCase().includes(term))
            );
        }

        return items;
    }, [products, searchTerm, categoryFilter, brandFilter, disciplineFilter, stockStatusFilter, specialFilter]);

    // RESETEAR TODOS LOS FILTROS
    const hasActiveFilters = Boolean(
        searchTerm || 
        categoryFilter !== 'todos' || 
        brandFilter !== 'todos' || 
        disciplineFilter !== 'todos' || 
        stockStatusFilter !== 'todos' || 
        specialFilter !== 'todos'
    );

    const handleClearFilters = () => {
        setSearchTerm('');
        setCategoryFilter('todos');
        setBrandFilter('todos');
        setDisciplineFilter('todos');
        setStockStatusFilter('todos');
        setSpecialFilter('todos');
    };

    const handleSelect = (prod: Product) => {
        if (selectedProductSku === prod.sku) {
            onSelectProduct(null);
        } else {
            onSelectProduct(prod);
            setIsPickerExpanded(false);
        }
    };

    return (
        <div className={cn("space-y-4", className)}>
            {/* TARJETA DEL PRODUCTO ACTUALMENTE SELECCIONADO */}
            {selectedProduct && !isPickerExpanded ? (
                <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-50 via-white to-slate-50 border-2 border-emerald-500/40 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-black uppercase text-emerald-800 tracking-wider">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            Producto Vinculado a la Campaña
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setIsPickerExpanded(true)}
                                className="h-7 px-2.5 text-[10px] font-black uppercase rounded-lg border-slate-300 hover:bg-slate-100"
                            >
                                Cambiar Producto
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => onSelectProduct(null)}
                                className="h-7 px-2 text-[10px] font-black uppercase text-rose-600 hover:bg-rose-50 rounded-lg"
                            >
                                <X className="h-3 w-3 mr-1" /> Quitar
                            </Button>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Imagen o Placeholder */}
                        <div className="h-16 w-16 rounded-xl bg-white border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center shadow-inner">
                            {selectedProduct.imageUrl ? (
                                <img src={selectedProduct.imageUrl} alt={selectedProduct.name} className="h-full w-full object-cover" />
                            ) : (
                                <Package className="h-8 w-8 text-slate-300" />
                            )}
                        </div>

                        {/* Detalles */}
                        <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-[10px] font-black uppercase bg-slate-900 text-white px-2 py-0.5 rounded">
                                    REF: {selectedProduct.sku}
                                </span>
                                {selectedProduct.brand && (
                                    <Badge variant="outline" className="text-[9px] font-black uppercase border-slate-300">
                                        Marca: {selectedProduct.brand}
                                    </Badge>
                                )}
                                {selectedProduct.discipline && (
                                    <Badge className="bg-primary/10 text-primary border-none text-[9px] font-black uppercase">
                                        {selectedProduct.discipline}
                                    </Badge>
                                )}
                            </div>
                            <h4 className="text-sm font-black uppercase text-slate-900 truncate">
                                {selectedProduct.name}
                            </h4>
                            <div className="flex items-center gap-4 text-xs">
                                <div>
                                    <span className="text-[10px] text-slate-400 font-bold uppercase mr-1">Lista:</span>
                                    <span className="font-black text-slate-700">${Number(selectedProduct.price || selectedProduct.priceCashUSD || 0).toFixed(2)}</span>
                                </div>
                                <div>
                                    <span className="text-[10px] text-emerald-600 font-bold uppercase mr-1">Divisas (-25%):</span>
                                    <span className="font-black text-emerald-600 font-mono">
                                        ${(Number(selectedProduct.price || selectedProduct.priceCashUSD || 0) * 0.75).toFixed(2)}
                                    </span>
                                </div>
                                <div className="ml-auto">
                                    <Badge className={cn(
                                        "text-[9px] font-black uppercase border-none",
                                        (selectedProduct.stockLevel ?? (selectedProduct as any).stock ?? 0) > 10 ? "bg-emerald-100 text-emerald-800" :
                                        (selectedProduct.stockLevel ?? (selectedProduct as any).stock ?? 0) > 0 ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"
                                    )}>
                                        Stock: {selectedProduct.stockLevel ?? (selectedProduct as any).stock ?? 0} unid.
                                    </Badge>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            {/* PANEL DE BÚSQUEDA Y FILTRADO AVANZADO (ESTILO INVENTARIO) */}
            {(!selectedProduct || isPickerExpanded) && (
                <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200 shadow-sm space-y-4 animate-in fade-in duration-300">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-lg bg-emerald-600 text-white">
                                <Filter className="h-3.5 w-3.5" />
                            </div>
                            <span className="text-xs font-black uppercase tracking-wider text-slate-900">
                                Buscar Producto en Inventario Maestro
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            {hasActiveFilters && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={handleClearFilters}
                                    className="h-7 px-2 text-[10px] font-black uppercase text-primary hover:bg-primary/5 rounded-lg"
                                >
                                    Limpiar Filtros <X className="ml-1 h-3 w-3" />
                                </Button>
                            )}
                            {selectedProduct && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setIsPickerExpanded(false)}
                                    className="h-7 px-2.5 text-[10px] font-bold uppercase rounded-lg border-slate-300"
                                >
                                    Cerrar Buscador
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* BARRA DE BÚSQUEDA GENERAL POR TEXTO */}
                    <div className="relative">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            placeholder="Buscar por Nombre, SKU, Marca, Disciplina o Categoría..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="h-11 pl-10 pr-8 rounded-xl bg-white border-slate-200 text-xs font-bold uppercase shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                        />
                        {searchTerm && (
                            <button
                                type="button"
                                onClick={() => setSearchTerm('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>

                    {/* SELECTORES DE FILTROS EN CUADRÍCULA (MARCA, DISCIPLINA, CATEGORÍA, STOCK, ESPECIAL) */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                        {/* 1. MARCA */}
                        <div className="space-y-1">
                            <label className="text-[9px] font-black uppercase text-slate-500 px-1">Marca</label>
                            <select
                                value={brandFilter}
                                onChange={(e) => setBrandFilter(e.target.value)}
                                className="w-full h-9 px-2.5 rounded-xl bg-white border border-slate-200 text-[11px] font-bold uppercase text-slate-800 shadow-sm focus:border-emerald-500 focus:outline-none"
                            >
                                <option value="todos">Todas las Marcas</option>
                                {uniqueBrands.map(b => (
                                    <option key={b} value={b}>{b.toUpperCase()}</option>
                                ))}
                            </select>
                        </div>

                        {/* 2. DISCIPLINA DEPORTIVA */}
                        <div className="space-y-1">
                            <label className="text-[9px] font-black uppercase text-slate-500 px-1">Disciplina</label>
                            <select
                                value={disciplineFilter}
                                onChange={(e) => setDisciplineFilter(e.target.value)}
                                className="w-full h-9 px-2.5 rounded-xl bg-white border border-slate-200 text-[11px] font-bold uppercase text-slate-800 shadow-sm focus:border-emerald-500 focus:outline-none"
                            >
                                <option value="todos">Todas las Disciplinas</option>
                                {uniqueDisciplines.map(d => (
                                    <option key={d} value={d}>{d.toUpperCase()}</option>
                                ))}
                            </select>
                        </div>

                        {/* 3. CATEGORÍA / RUBRO */}
                        <div className="space-y-1">
                            <label className="text-[9px] font-black uppercase text-slate-500 px-1">Categoría</label>
                            <select
                                value={categoryFilter}
                                onChange={(e) => setCategoryFilter(e.target.value)}
                                className="w-full h-9 px-2.5 rounded-xl bg-white border border-slate-200 text-[11px] font-bold uppercase text-slate-800 shadow-sm focus:border-emerald-500 focus:outline-none"
                            >
                                <option value="todos">Todas las Categorías</option>
                                {uniqueCategories.map(c => (
                                    <option key={c} value={c}>{c.toUpperCase()}</option>
                                ))}
                            </select>
                        </div>

                        {/* 4. ESTADO DE EXISTENCIAS (STOCK) */}
                        <div className="space-y-1">
                            <label className="text-[9px] font-black uppercase text-slate-500 px-1">Stock</label>
                            <select
                                value={stockStatusFilter}
                                onChange={(e) => setStockStatusFilter(e.target.value)}
                                className="w-full h-9 px-2.5 rounded-xl bg-white border border-slate-200 text-[11px] font-bold uppercase text-slate-800 shadow-sm focus:border-emerald-500 focus:outline-none"
                            >
                                <option value="todos">Todos los Stocks</option>
                                <option value="in_stock">En Stock (&ge;10)</option>
                                <option value="low">Pocas Existencias (&lt;10)</option>
                                <option value="out">Agotados (0)</option>
                            </select>
                        </div>

                        {/* 5. ESPECIAL: OFERTAS O NOVEDADES */}
                        <div className="space-y-1 col-span-2 sm:col-span-1">
                            <label className="text-[9px] font-black uppercase text-slate-500 px-1">Ocasión</label>
                            <select
                                value={specialFilter}
                                onChange={(e) => setSpecialFilter(e.target.value as any)}
                                className="w-full h-9 px-2.5 rounded-xl bg-white border border-slate-200 text-[11px] font-bold uppercase text-slate-800 shadow-sm focus:border-emerald-500 focus:outline-none"
                            >
                                <option value="todos">Catálogo General</option>
                                <option value="offers">Con Oferta Activa</option>
                                <option value="new">Nuevos Ingresos (&lt;30d)</option>
                            </select>
                        </div>
                    </div>

                    {/* CONTADOR DE COINCIDENCIAS */}
                    <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
                        <span>
                            Mostrando <strong className="text-slate-900">{filteredProducts.length}</strong> de {products.length} productos
                        </span>
                        {selectedProduct && (
                            <span className="text-emerald-700 font-bold">
                                1 Seleccionado actualmente
                            </span>
                        )}
                    </div>

                    {/* LISTA / GRID DE RESULTADOS INTERACTIVOS */}
                    <div className="max-h-72 overflow-y-auto space-y-2 pr-1 border rounded-xl p-2 bg-white border-slate-200 shadow-inner">
                        {filteredProducts.length === 0 ? (
                            <div className="p-8 text-center space-y-2">
                                <Package className="h-8 w-8 text-slate-300 mx-auto" />
                                <p className="text-xs font-black uppercase text-slate-500">
                                    No se encontraron productos con los filtros seleccionados
                                </p>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={handleClearFilters}
                                    className="text-[10px] font-bold uppercase rounded-lg"
                                >
                                    Restablecer Filtros
                                </Button>
                            </div>
                        ) : (
                            filteredProducts.map(prod => {
                                const isSelected = selectedProductSku === prod.sku;
                                const rawPrice = Number(prod.price || prod.priceCashUSD || 0);
                                const priceDivisas = (rawPrice * 0.75).toFixed(2);
                                const stockVal = prod.stockLevel ?? (prod as any).stock ?? 0;

                                return (
                                    <div
                                        key={prod.id || prod.sku}
                                        onClick={() => handleSelect(prod)}
                                        className={cn(
                                            "p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-all text-xs",
                                            isSelected
                                                ? "border-emerald-600 bg-emerald-50/70 shadow-sm"
                                                : "border-slate-100 hover:border-slate-300 hover:bg-slate-50/80"
                                        )}
                                    >
                                        {/* Miniatura */}
                                        <div className="h-12 w-12 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center">
                                            {prod.imageUrl ? (
                                                <img src={prod.imageUrl} alt={prod.name} className="h-full w-full object-cover" />
                                            ) : (
                                                <Package className="h-6 w-6 text-slate-300" />
                                            )}
                                        </div>

                                        {/* Información del producto */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="font-mono text-[9px] font-black uppercase bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded">
                                                    {prod.sku}
                                                </span>
                                                {prod.brand && (
                                                    <span className="text-[9px] font-black uppercase text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                                                        {prod.brand}
                                                    </span>
                                                )}
                                                {prod.discipline && (
                                                    <span className="text-[9px] font-black uppercase text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                                                        {prod.discipline}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="font-bold text-xs uppercase text-slate-900 truncate mt-0.5">
                                                {prod.name}
                                            </p>
                                        </div>

                                        {/* Precios y Stock */}
                                        <div className="text-right shrink-0 space-y-0.5">
                                            <div className="flex items-baseline justify-end gap-2">
                                                <span className="text-[10px] text-slate-400 line-through">${rawPrice.toFixed(2)}</span>
                                                <span className="text-xs font-black text-emerald-600 font-mono">${priceDivisas}</span>
                                            </div>
                                            <div className="flex items-center justify-end gap-1.5">
                                                <span className={cn(
                                                    "text-[9px] font-bold uppercase",
                                                    stockVal >= 10 ? "text-emerald-700" : stockVal > 0 ? "text-amber-600" : "text-rose-600"
                                                )}>
                                                    {stockVal} en stock
                                                </span>
                                                {isSelected ? (
                                                    <div className="h-5 w-5 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                                                        <Check className="h-3 w-3" />
                                                    </div>
                                                ) : (
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-6 px-2 text-[9px] font-black uppercase text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg"
                                                    >
                                                        Elegir
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
