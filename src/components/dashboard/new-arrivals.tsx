'use client';

import React, { useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from '@/firebase';
import type { Product, FinancialSettings, Offer } from '@/lib/definitions';
import { collection, query, orderBy, limit, doc } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { ProductDetailsSheet } from '@/app/dashboard/inventory/product-details-sheet';
import { ProductCard } from './ProductCard';
import { useDataSaving } from '@/hooks/use-data-saving';
import { cn } from '@/lib/utils';
import { Box } from 'lucide-react';

/**
 * NEW ARRIVALS (v1.9.0)
 * Optimizado: Detecta Modo Ahorro de Datos para desactivar animaciones.
 */
export function NewArrivals() {
  const firestore = useFirestore();
  const { profile: currentUser } = useUser();
  const { isDataSaving } = useDataSaving();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  
  const [emblaRef] = useEmblaCarousel(
    { loop: true, align: 'start', skipSnaps: false }, 
    [Autoplay({ delay: 5000, stopOnInteraction: true })]
  );

  const productsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'products'), orderBy('createdAt', 'desc'), limit(10));
  }, [firestore]);

  const { data: products, isLoading } = useCollection<Product>(productsQuery);

  const financialRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
  const { data: globalSettings } = useDoc<FinancialSettings>(financialRef);

  const offersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'offers'), limit(100)) : null), [firestore]);
  const { data: allOffers } = useCollection<Offer>(offersQuery);

  const canManageInventory = currentUser && ['superadmin', 'admin', 'gerencia', 'deposito'].includes(currentUser.role);
  const bcvDiscount = globalSettings?.defaultBcvDiscount || 30;

  if (isLoading) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-[2rem]" />)}
        </div>
    );
  }

  // MODO AHORRO: Reemplazar carrusel por rejilla estática para ahorrar CPU/Datos
  if (isDataSaving) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-in fade-in duration-500">
            {products?.slice(0, 4).map(product => (
                <ProductCard 
                    key={product.id} 
                    product={product} 
                    onSelect={setSelectedProduct} 
                    bcvDiscount={bcvDiscount}
                />
            ))}
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

  return (
    <>
      <div className="overflow-hidden cursor-grab active:cursor-grabbing px-1" ref={emblaRef}>
        <div className="flex">
          {products && products.length > 0 ? (
              products.map(product => (
                  <div key={product.id} className="flex-[0_0_100%] sm:flex-[0_0_50%] lg:flex-[0_0_33.33%] xl:flex-[0_0_25%] min-w-0 pr-4">
                      <ProductCard 
                        product={product} 
                        onSelect={setSelectedProduct} 
                        bcvDiscount={bcvDiscount}
                      />
                  </div>
              ))
          ) : (
               <div className="flex h-40 w-full items-center justify-center text-muted-foreground border-2 border-dashed rounded-[2rem] bg-muted/5 font-bold uppercase text-[10px] tracking-widest">
                  Sin ingresos recientes registrados.
               </div>
          )}
        </div>
      </div>

      <ProductDetailsSheet 
        product={selectedProduct} 
        allOffers={allOffers || []} 
        isOpen={!!selectedProduct} 
        onOpenChange={(open) => !open && setSelectedProduct(null)} 
        canManageInventory={!!canManageInventory} 
        canDelete={false} 
        onDelete={() => {}} 
      />
    </>
  );
}
