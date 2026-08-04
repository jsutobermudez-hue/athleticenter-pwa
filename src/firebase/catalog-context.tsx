'use client';

import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy, getDocs } from 'firebase/firestore';
import { useFirebase, useUser } from './context';
import type { Product } from '../lib/definitions';

interface CatalogContextState {
  products: Product[];
  isLoading: boolean;
  categories: string[];
  brands: string[];
  disciplines: string[];
}

const CatalogContext = createContext<CatalogContextState | undefined>(undefined);

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const { firestore } = useFirebase();
  const { user } = useUser();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!firestore || !user) {
      setProducts([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const q = collection(firestore, 'products');
    
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Product[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() } as Product);
        });
        // Sort by SKU in memory to avoid query indexing errors in Firestore
        list.sort((a, b) => (a.sku || '').localeCompare(b.sku || ''));
        setProducts(list);
        setIsLoading(false);
      },
      async (error) => {
        console.warn("[CatalogProvider] onSnapshot failed. Trying fallback getDocs...", error);
        try {
          const snapshot = await getDocs(q);
          const list: Product[] = [];
          snapshot.forEach((doc) => {
            list.push({ id: doc.id, ...doc.data() } as Product);
          });
          list.sort((a, b) => (a.sku || '').localeCompare(b.sku || ''));
          setProducts(list);
          setIsLoading(false);
        } catch (fallbackError) {
          console.error("Error in getDocs fallback for catalog:", fallbackError);
          setIsLoading(false);
        }
      }
    );

    return () => unsubscribe();
  }, [firestore, user]);

  const categories = useMemo(() => {
    const set = new Set(products.map(p => p.category?.trim()).filter(Boolean));
    return Array.from(set).sort() as string[];
  }, [products]);

  const brands = useMemo(() => {
    const set = new Set(products.map(p => p.brand?.trim()).filter(Boolean));
    return Array.from(set).sort() as string[];
  }, [products]);

  const disciplines = useMemo(() => {
    const set = new Set(products.map(p => p.discipline?.trim()).filter(Boolean));
    return Array.from(set).sort() as string[];
  }, [products]);

  const value = useMemo(() => ({
    products,
    isLoading,
    categories,
    brands,
    disciplines
  }), [products, isLoading, categories, brands, disciplines]);

  return (
    <CatalogContext.Provider value={value}>
      {children}
    </CatalogContext.Provider>
  );
}

export function useCatalog() {
  const context = useContext(CatalogContext);
  if (context === undefined) {
    throw new Error('useCatalog debe ser usado dentro de CatalogProvider');
  }
  return context;
}
