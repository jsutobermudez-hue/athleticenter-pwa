'use client';

import React from 'react';
import Link from 'next/link';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import type { Product } from '@/lib/definitions';
import { collection, query, where, orderBy, limit } from 'firebase/firestore';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle } from 'lucide-react';

export function InventoryTicker() {
  const firestore = useFirestore();

  const lowStockQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(
      collection(firestore, 'products'), 
      where('stock', '<', 10), 
      where('stock', '>', 0), 
      orderBy('stock', 'asc'),
      limit(10)
    );
  }, [firestore]);

  const { data: lowStockProducts, isLoading } = useCollection<Product>(lowStockQuery);

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning-foreground" />
            Alertas de Inventario
        </h3>
        <div className="space-y-2">
          {isLoading ? (
             Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
          ) : lowStockProducts && lowStockProducts.length > 0 ? (
            lowStockProducts.map(product => (
              <Link key={product.id} href={`/dashboard/inventory?sku=${product.sku}`} className="block">
                <div className="flex justify-between items-center p-2 rounded-md hover:bg-muted text-sm">
                  <p className="font-medium">{product.name}</p>
                  <p className="text-warning-foreground font-bold">{product.stock} unidades</p>
                </div>
              </Link>
            ))
          ) : (
            <div className="flex h-24 items-center justify-center text-muted-foreground text-sm border-2 border-dashed rounded-md">
              Todo el stock está en niveles óptimos.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}