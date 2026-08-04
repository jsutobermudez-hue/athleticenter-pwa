'use client';

import React, { useState, useMemo } from 'react';
import { useCatalog } from '@/firebase/catalog-context';
import { useFirestore, useUser } from '@/firebase';
import { doc, updateDoc, serverTimestamp, collection, setDoc } from 'firebase/firestore';
import type { Product } from '@/lib/definitions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Plus, Minus, Check, Loader2, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function ExpressStockAdjust() {
  const { products } = useCatalog();
  const firestore = useFirestore();
  const { profile: currentUser } = useUser();
  const { toast } = useToast();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const matchedProducts = useMemo(() => {
    if (!products || !searchTerm.trim()) return [];
    const term = searchTerm.toLowerCase().trim();
    return products
      .filter(p => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || p.brand?.toLowerCase().includes(term))
      .slice(0, 4);
  }, [products, searchTerm]);

  const handleAdjustStock = async (product: Product, diff: number) => {
    if (!firestore || !currentUser || !product.id) return;
    
    const currentStock = product.stockLevel ?? (product as any).stock ?? 0;
    const newStock = Math.max(0, currentStock + diff);
    
    if (newStock === currentStock) return;
    
    setUpdatingId(product.id);
    
    try {
      const prodRef = doc(firestore, 'products', product.id);
      await updateDoc(prodRef, {
        stockLevel: newStock,
        updatedAt: serverTimestamp()
      });

      // Crear registro de auditoría en Firestore
      const auditRef = doc(collection(firestore, 'auditLogs'));
      await setDoc(auditRef, {
        createdAt: serverTimestamp(),
        userName: currentUser.name || 'Almacén',
        action: `Ajuste exprés de stock: ${product.name} (SKU: ${product.sku}) de ${currentStock} a ${newStock} un.`,
        resource: 'products',
        severity: 'info'
      });

      toast({
        title: '¡Stock Sincronizado!',
        description: `${product.sku}: ${currentStock} ➔ ${newStock} unidades.`,
      });
    } catch (error) {
      console.error("Error adjusting stock:", error);
      toast({
        title: 'Error de Sincronización',
        description: 'No tienes permisos suficientes o falló la conexión.',
        variant: 'destructive'
      });
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <Card className="border border-slate-200/50 shadow-xl rounded-[2.5rem] bg-white overflow-hidden">
      <CardHeader className="p-8 pb-4">
        <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-primary" /> Ajuste Exprés de Existencias
        </CardTitle>
      </CardHeader>
      <CardContent className="p-8 pt-0 space-y-6">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          <Input 
            placeholder="BUSCAR POR SKU O NOMBRE DE PRODUCTO..." 
            className="h-14 pl-12 rounded-[1.5rem] bg-slate-50 border-none font-bold uppercase text-xs tracking-wider"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {searchTerm.trim() && (
          <div className="space-y-3 animate-in fade-in duration-300">
            {matchedProducts.length > 0 ? (
              matchedProducts.map((p) => {
                const stockVal = p.stockLevel ?? (p as any).stock ?? 0;
                const isUpdating = updatingId === p.id;
                
                return (
                  <div 
                    key={p.id} 
                    className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 flex items-center justify-between hover:bg-white hover:shadow-md transition-all"
                  >
                    <div className="min-w-0 pr-4">
                      <p className="text-[11px] font-black uppercase text-slate-900 truncate">{p.name}</p>
                      <p className="text-[8px] font-mono text-slate-400 mt-1">SKU: {p.sku} | {p.brand || 'SIN MARCA'}</p>
                    </div>
                    
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <div className="text-right">
                        <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">Existencia</span>
                        <span className="text-sm font-black text-slate-800">{stockVal} un.</span>
                      </div>
                      
                      <div className="flex items-center gap-1">
                        <Button 
                          variant="outline" 
                          size="icon" 
                          className="h-9 w-9 rounded-xl active:scale-90"
                          disabled={stockVal === 0 || isUpdating}
                          onClick={() => handleAdjustStock(p, -1)}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="outline" 
                          size="icon" 
                          className="h-9 w-9 rounded-xl active:scale-90"
                          disabled={isUpdating}
                          onClick={() => handleAdjustStock(p, 1)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                        {isUpdating && (
                          <Loader2 className="h-4 w-4 animate-spin text-primary ml-1" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-center text-[10px] font-bold text-slate-400 uppercase py-2">Sin Coincidencias</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
