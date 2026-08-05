'use client';

import React, { useState, useMemo } from 'react';
import { useCatalog } from '@/firebase/catalog-context';
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, limit, doc } from 'firebase/firestore';
import type { Product, FinancialSettings, Offer } from '@/lib/definitions';
import { ProductCard } from './ProductCard';
import { ProductDetailsSheet } from '@/app/dashboard/inventory/product-details-sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkles, Calendar, RefreshCw, Layers, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

export function CatalogHighlights() {
  const { products, isLoading } = useCatalog();
  const firestore = useFirestore();
  const { profile: currentUser } = useUser();
  const [activeTab, setActiveTab] = useState<'featured' | 'new' | 'restocked' | 'modified'>('featured');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const financialRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
  const { data: globalSettings } = useDoc<FinancialSettings>(financialRef);

  const offersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'offers'), limit(100)) : null), [firestore]);
  const { data: allOffers } = useCollection<Offer>(offersQuery);

  const canManageInventory = currentUser && ['superadmin', 'admin', 'gerencia', 'deposito'].includes(currentUser.role);
  const bcvDiscount = globalSettings?.defaultBcvDiscount || 30;

  // Helper síncrono para verificar si una marca de tiempo de Firebase está dentro de los últimos 7 días
  const isWithinLast7Days = (timestamp: any) => {
    if (!timestamp) return false;
    const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
    const diffTime = Math.abs(new Date().getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 7;
  };

  const filteredProducts = useMemo(() => {
    if (!products) return { featured: [], new: [], restocked: [], modified: [] };

    return products.reduce(
      (acc, product) => {
        // 1. Destacados (Con ofertas activas o marcados como especiales)
        if (product.activeOfferIds && product.activeOfferIds.length > 0) {
          acc.featured.push(product);
        }

        // 2. Novedades (Creados en los últimos 7 días)
        if (product.createdAt && isWithinLast7Days(product.createdAt)) {
          acc.new.push(product);
        }

        // 3. Repuestos (Última compra de stock hace menos de 7 días y stock disponible)
        if (
          (product.lastPurchaseDate && isWithinLast7Days(product.lastPurchaseDate)) ||
          (product.updatedAt && isWithinLast7Days(product.updatedAt) && product.stockLevel > 0 && product.createdAt && product.updatedAt.seconds !== product.createdAt.seconds)
        ) {
          acc.restocked.push(product);
        }

        // 4. Modificados (Modificados recientemente que no sean nuevos)
        const isNew = product.createdAt && isWithinLast7Days(product.createdAt);
        if (product.updatedAt && isWithinLast7Days(product.updatedAt) && !isNew) {
          acc.modified.push(product);
        }

        return acc;
      },
      { featured: [] as Product[], new: [] as Product[], restocked: [] as Product[], modified: [] as Product[] }
    );
  }, [products]);

  const currentList = useMemo(() => {
    return filteredProducts[activeTab] || [];
  }, [filteredProducts, activeTab]);

  const tabs = [
    { id: 'featured', label: 'Destacados', icon: Sparkles, color: 'text-amber-500', count: filteredProducts.featured.length },
    { id: 'new', label: 'Novedades', icon: Calendar, color: 'text-indigo-500', count: filteredProducts.new.length },
    { id: 'restocked', label: 'Repuestos', icon: RefreshCw, color: 'text-emerald-500', count: filteredProducts.restocked.length },
    { id: 'modified', label: 'Modificados', icon: Layers, color: 'text-blue-500', count: filteredProducts.modified.length },
  ];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex gap-2 border-b border-slate-200/50 pb-4 overflow-x-auto">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-28 rounded-lg animate-pulse bg-slate-100" />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-full rounded-[2.5rem] animate-pulse bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Selector de Pestañas Responsivo */}
      <div className="flex gap-3 border-b border-slate-200/20 pb-4 overflow-x-auto scrollbar-none">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "flex items-center gap-2 px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap active:scale-95 border",
                isActive
                  ? "bg-slate-900 border-slate-800 text-white shadow-lg"
                  : "bg-white/5 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/10"
              )}
            >
              <Icon className={cn("h-4 w-4", tab.color)} />
              <span>{tab.label}</span>
              <span className={cn(
                "ml-1.5 px-2 py-0.5 rounded-full text-[9px] font-black",
                isActive ? "bg-primary text-white" : "bg-slate-800 text-slate-300"
              )}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Grid de Productos con Ajuste Automático */}
      {currentList.length > 0 ? (
        <div className="max-h-[740px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-in fade-in duration-500">
            {currentList.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onSelect={setSelectedProduct}
                bcvDiscount={bcvDiscount}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-14 border-2 border-dashed border-slate-200/20 rounded-[2.5rem] bg-white/5 text-center gap-4">
          <Zap className="h-10 w-10 text-slate-500/50" />
          <div className="space-y-1">
            <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Sin Productos</h4>
            <p className="text-[10px] text-slate-500 font-bold max-w-xs">No hay artículos registrados recientemente en esta categoría de novedades.</p>
          </div>
        </div>
      )}

      {/* Detalle del Producto */}
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
