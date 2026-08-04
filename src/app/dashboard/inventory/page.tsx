'use client';

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { 
    Search, 
    Loader2, 
    Filter, 
    Download, 
    Boxes, 
    TrendingUp, 
    AlertTriangle, 
    ArrowUpRight, 
    ShieldAlert, 
    Tag, 
    Sparkles, 
    Zap,
    LayoutGrid,
    X,
    Info,
    Plus,
    PackageSearch
} from 'lucide-react';
import { NewProductDialog } from './manage-inventory-dialog';
import type { Product, Offer, FinancialSettings, CompanyProfile } from '@/lib/definitions';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { useCatalog } from '@/firebase/catalog-context';
import { collection, query, limit, doc, Timestamp } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ProductDetailsSheet } from './product-details-sheet';
import { DeleteProductDialog } from './delete-product-dialog';
import { ProductCard } from '@/components/dashboard/ProductCard';
import { generateInventoryReportPDF } from '@/lib/pdf-generator';
import { cn } from '@/lib/utils';
import { subDays, isAfter } from 'date-fns';

export const dynamic = 'force-dynamic';

const getStatus = (stock: number) => {
    if (stock === 0) return 'Agotado';
    if (stock < 10) return 'Pocas existencias';
    return 'En stock';
};

function SummaryCard({ title, value, subValue, icon: Icon, colorClass, onClick, alert = false, isActive = false }: any) {
    return (
        <Card 
            className={cn(
                "terminal-card group transition-all",
                onClick && "cursor-pointer hover:shadow-2xl hover:-translate-y-1 active:scale-95",
                alert && !isActive && "ring-2 ring-rose-500/20",
                isActive && "ring-2 ring-primary bg-primary/5 shadow-lg"
            )}
            onClick={onClick}
        >
            <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                    <p className={cn("text-[10px] font-black uppercase tracking-widest", isActive ? "text-primary" : "text-slate-400")}>{title}</p>
                    <div className={cn(
                        "p-2.5 rounded-xl transition-transform group-hover:rotate-12", 
                        colorClass, isActive && "bg-primary text-white shadow-lg")}>
                        <Icon className="h-4 w-4" />
                    </div>
                </div>
                <div className="flex items-baseline justify-between">
                    <h3 className={cn("text-2xl font-black tracking-tighter text-slate-900 leading-none", alert && !isActive && "text-rose-600")}>{value}</h3>
                    {onClick && !isActive && <ArrowUpRight className="h-3 w-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />}
                    {onClick && isActive && <X className="h-4 w-4 text-primary animate-in zoom-in" />}
                </div>
                <p className="text-[9px] font-bold text-muted-foreground uppercase mt-2">{subValue}</p>
            </CardContent>
        </Card>
    );
}

function InventoryContent() {
  const firestore = useFirestore();
  const { user, profile: currentUser, isUserLoading } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  
  const [catalogFilter, setCatalogFilter] = useState<'todos' | 'offers' | 'new' | 'active'>('todos');
  const [stockStatusFilter, setStockStatusFilter] = useState('todos');
  const [searchTerm, setSearchTerm] = useState('');

  const { products: inventory, isLoading: isLoadingInventory } = useCatalog();

  const settingsRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
  const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);

  const companyProfileRef = useMemoFirebase(() => (firestore ? doc(firestore, 'companyProfile', 'main') : null), [firestore]);
  const { data: companyProfile } = useDoc<CompanyProfile>(companyProfileRef);

  const offersCollection = useMemoFirebase(() => (firestore ? query(collection(firestore, 'offers'), limit(50)) : null), [firestore]);
  const { data: allOffers, isLoading: isLoadingOffers } = useCollection<Offer>(offersCollection);

  useEffect(() => {
    const statusQuery = searchParams.get('status');
    if (statusQuery === 'low') setStockStatusFilter('low');
    const skuParam = searchParams.get('sku');
    if (skuParam && inventory) {
      const found = inventory.find(p => p.sku === skuParam);
      if (found) setSelectedProduct(found);
    }
  }, [searchParams, inventory]);

  const isLoading = isUserLoading || isLoadingInventory || isLoadingOffers;
  const isAdmin = !!(currentUser && ['superadmin', 'admin', 'gerencia'].includes(currentUser.role));
  const isWarehouse = currentUser?.role === 'deposito';
  const isCommercial = currentUser && ['ventas', 'cliente'].includes(currentUser.role);
  
  const canCreateProduct = isAdmin;
  const canManageStock = isAdmin || isWarehouse;
  
  const filteredInventory = useMemo(() => {
    if (!inventory) return [];
    let items = inventory;

    if (catalogFilter === 'offers') {
        items = items.filter(p => p.activeOfferIds && p.activeOfferIds.length > 0);
    } else if (catalogFilter === 'new') {
        const sevenDaysAgo = subDays(new Date(), 7);
        items = items.filter(p => {
            const createdDate = (p.createdAt as Timestamp)?.toDate();
            return createdDate && isAfter(createdDate, sevenDaysAgo);
        });
    } else if (catalogFilter === 'active') {
        items = items.filter(p => (p.stockLevel ?? (p as any).stock ?? 0) > 0);
    }

    if (stockStatusFilter !== 'todos') {
      items = items.filter((item) => {
        const stockVal = item.stockLevel ?? (item as any).stock ?? 0;
        const status = getStatus(stockVal);
        if (stockStatusFilter === 'low') return status === 'Pocas existencias';
        if (stockStatusFilter === 'out') return status === 'Agotado';
        if (stockStatusFilter === 'in_stock') return status === 'En stock';
        return true;
      });
    }

    const term = searchTerm.toLowerCase().trim();
    if (term) {
      items = items.filter(p => 
        p.name.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term) ||
        p.discipline?.toLowerCase().includes(term) ||
        p.brand?.toLowerCase().includes(term)
      );
    }
    return items;
  }, [inventory, searchTerm, stockStatusFilter, catalogFilter]);

  const stats = useMemo(() => {
    if (!inventory || !globalSettings) return null;
    const lowStockCount = inventory.filter(p => {
        const stockVal = p.stockLevel ?? (p as any).stock ?? 0;
        return stockVal > 0 && stockVal < 10;
    }).length;
    const offersCount = inventory.filter(p => p.activeOfferIds && p.activeOfferIds.length > 0).length;
    const categoriesCount = new Set(inventory.map(p => p.category)).size;
    const sevenDaysAgo = subDays(new Date(), 7);
    const newArrivalsCount = inventory.filter(p => {
        const createdDate = (p.createdAt as Timestamp)?.toDate();
        return createdDate && isAfter(createdDate, sevenDaysAgo);
    }).length;

    return { lowStockCount, offersCount, categoriesCount, newArrivalsCount };
  }, [inventory, globalSettings]);

  const toggleCatalogFilter = (filter: typeof catalogFilter) => {
      setCatalogFilter(prev => prev === filter ? 'todos' : filter);
  };

  const handleToggleStockFilter = (status: string) => {
      setStockStatusFilter(prev => prev === status ? 'todos' : status);
  };

  const handleClearFilters = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setStockStatusFilter('todos');
      setCatalogFilter('todos');
      setSearchTerm('');
  };

  if (isUserLoading || !currentUser) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>;

  return (
    <>
      <TooltipProvider>
        <div className="w-full max-w-full mx-auto flex flex-col gap-6 sm:gap-10 pb-32 px-2 sm:px-6 lg:px-8 animate-in fade-in-50 duration-500">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between px-1">
            <div className="space-y-1">
                <h1 className="terminal-header">
                    {isCommercial ? "Catálogo Pro" : "Catálogo Maestro"}
                </h1>
                <p className="tech-label opacity-60">
                    {isCommercial ? "Explora nuestra red de equipamiento deportivo profesional." : "Gestión táctica de inventario y auditoría de activos."}
                </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                {canManageStock && (
                    <Button 
                        type="button"
                        variant="outline" 
                        onClick={() => generateInventoryReportPDF(filteredInventory, companyProfile || undefined, stockStatusFilter === 'low' ? 'REPORTE DE REPOSICIÓN DE STOCK' : 'INVENTARIO MAESTRO')} 
                        className="flex-1 sm:flex-none h-11 px-4 sm:px-6 rounded-xl border-slate-200 font-black uppercase text-[9px] tracking-widest shadow-sm bg-white hover:bg-slate-50 transition-all active:scale-95"
                    >
                        <Download className="mr-2 h-4 w-4" /> 
                        Auditoría
                    </Button>
                )}
                {canCreateProduct && <NewProductDialog />}
            </div>
          </div>

          <div className="p-5 rounded-[2rem] bg-slate-900 text-white border border-primary/20 flex items-center gap-4 animate-in slide-in-from-top-2 mx-1 shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:rotate-12 transition-transform"><Zap className="h-12 w-12 text-primary" /></div>
              <Info className="h-6 w-6 text-primary shrink-0" />
              <div className="space-y-0.5">
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">Nota Fiscal Athleticenter</p>
                  <p className="text-[11px] font-medium text-slate-300 uppercase leading-relaxed">
                      Todos los precios representan la <span className="text-white font-black">BASE IMPONIBLE</span>. El IVA (16%) se sumará al reportar pago fiscal.
                  </p>
              </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 px-1">
              <SummaryCard 
                  title="Oportunidades" 
                  value={stats?.offersCount.toString() || '0'} 
                  subValue="Artículos con Oferta" 
                  icon={Tag} 
                  colorClass="bg-emerald-50 text-emerald-500"
                  onClick={() => toggleCatalogFilter('offers')}
                  isActive={catalogFilter === 'offers'}
              />
              <SummaryCard 
                  title="Novedades" 
                  value={stats?.newArrivalsCount.toString() || '0'} 
                  subValue="Últimos 7 días" 
                  icon={Sparkles} 
                  colorClass="bg-blue-50 text-blue-500"
                  onClick={() => toggleCatalogFilter('new')}
                  isActive={catalogFilter === 'new'}
              />
              <SummaryCard 
                  title="Categorías Pro" 
                  value={stats?.categoriesCount.toString() || '0'} 
                  subValue="Rubros especializados" 
                  icon={LayoutGrid} 
                  colorClass="bg-indigo-50 text-indigo-500"
                  onClick={() => setCatalogFilter('todos')}
                  isActive={catalogFilter === 'todos'}
              />
              <SummaryCard 
                  title="Stock Crítico" 
                  value={stats?.lowStockCount.toString() || '0'} 
                  subValue="SKUs con reposición" 
                  icon={AlertTriangle} 
                  colorClass={stats?.lowStockCount && stats.lowStockCount > 0 ? "bg-amber-50 text-amber-500" : "bg-slate-50 text-slate-400"}
                  onClick={() => handleToggleStockFilter('low')}
                  isActive={stockStatusFilter === 'low'}
                  alert={stats?.lowStockCount && stats.lowStockCount > 0}
              />
          </div>
          
          <Card className="terminal-card mx-1">
            <CardHeader className="bg-muted/5 border-b py-4 px-6 sm:px-8">
              <div className="flex justify-between items-center">
                <CardTitle className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground flex items-center gap-2">
                    <Filter className="h-3.5 w-3.5" /> FILTROS OPERATIVOS
                </CardTitle>
                {(stockStatusFilter !== 'todos' || catalogFilter !== 'todos' || searchTerm) && (
                    <Button type="button" variant="ghost" size="sm" onClick={handleClearFilters} className="text-[9px] font-black uppercase text-primary h-10 px-4 rounded-xl hover:bg-primary/5 transition-all">
                        Limpiar Auditoría <X className="ml-1 h-3 w-3" />
                    </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="space-y-2">
                    <Label className="tech-label px-1">BÚSQUEDA INTELIGENTE</Label>
                    <div className="relative">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400" />
                      <Input placeholder="Nombre, SKU, Marca..." className="w-full h-12 pl-12 rounded-xl bg-slate-50 border-none font-bold text-sm shadow-inner" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                    </div>
                </div>
                <div className="space-y-2">
                     <Label className="tech-label px-1">ESTADO DE EXISTENCIAS</Label>
                     <Select value={stockStatusFilter} onValueChange={setStockStatusFilter}>
                        <SelectTrigger className="h-12 rounded-xl bg-slate-50 border-none font-bold text-sm shadow-inner">
                            <SelectValue placeholder="Estado de Existencias" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="todos">TODOS LOS PRODUCTOS</SelectItem>
                            <SelectItem value="in_stock">DISPONIBILIDAD TOTAL</SelectItem>
                            <SelectItem value="low">REPOSICIÓN NECESARIA</SelectItem>
                            <SelectItem value="out">AGOTADOS</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <div className="px-1">
            {isLoading && inventory === null ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
                {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-[280px] w-full rounded-[2.5rem]" />)}
                </div>
            ) : (
                <div className="space-y-10">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
                        {filteredInventory.map(product => (
                            <ProductCard 
                                key={product.id} 
                                product={product} 
                                onSelect={setSelectedProduct} 
                                bcvDiscount={globalSettings?.defaultBcvDiscount} 
                                quantityInCart={0}
                            />
                        ))}
                    </div>
                </div>
            )}
          </div>
        </div>
      </TooltipProvider>

      <ProductDetailsSheet 
        product={selectedProduct} 
        allOffers={allOffers || []} 
        isOpen={!!selectedProduct} 
        onOpenChange={(open) => !open && setSelectedProduct(null)} 
        canManageInventory={!!canManageStock} 
        canDelete={isAdmin} 
        onDelete={(product) => { 
            setSelectedProduct(null); 
            setProductToDelete(product); 
        }} 
      />
      <DeleteProductDialog product={productToDelete} isOpen={!!productToDelete} onOpenChange={(open) => !open && setProductToDelete(null)} />
    </>
  );
}

export default function InventoryPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
            <InventoryContent />
        </Suspense>
    );
}