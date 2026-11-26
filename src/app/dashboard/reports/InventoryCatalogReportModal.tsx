'use client';

import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { collectionGroup, getDocs } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import type { Product, CompanyProfile, Order } from '@/lib/definitions';
import {
  extractInventoryFilterOptions,
  filterInventoryProducts,
  computeInventorySelectionMetrics,
  buildInventoryFilterTitle,
  buildSoldUnitsByProductMap,
  computeProductAuditRow,
  canonicalizeCategory,
  canonicalizeBrand,
  canonicalizeDiscipline,
  getProductCashPrice,
  formatProductSizesSummary,
  type InventoryStockFilter,
  type InventorySortBy,
} from '@/lib/inventory-filter';
import { generateInventoryReportPDF } from '@/lib/pdf-generator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Boxes,
  FileSpreadsheet,
  Loader2,
  Printer,
  RotateCcw,
  Search,
  MapPin,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export interface InventoryCatalogReportModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  orders?: Order[];
  companyProfile?: Partial<CompanyProfile>;
  bcvDiscount?: number;
}

export function InventoryCatalogReportModal({
  isOpen,
  onOpenChange,
  products = [],
  orders = [],
  companyProfile,
  bcvDiscount = 25,
}: InventoryCatalogReportModalProps) {
  const { toast } = useToast();
  const firestore = useFirestore();

  const [categoryFilter, setCategoryFilter] = useState<string>('todos');
  const [brandFilter, setBrandFilter] = useState<string>('todos');
  const [disciplineFilter, setDisciplineFilter] = useState<string>('todos');
  const [stockFilter, setStockFilter] = useState<InventoryStockFilter>('todos');
  const [sortBy, setSortBy] = useState<InventorySortBy>('name_asc');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showPrices, setShowPrices] = useState<boolean>(true);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [loadedOrderItems, setLoadedOrderItems] = useState<Array<{ orderId?: string; productId?: string; quantity?: number }> | null>(null);
  const [isLoadingSalesAudit, setIsLoadingSalesAudit] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen || !firestore || loadedOrderItems !== null) return;
    let active = true;
    setIsLoadingSalesAudit(true);
    getDocs(collectionGroup(firestore, 'orderItems'))
      .then((snap) => {
        if (!active) return;
        const items = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            orderId: data.orderId || d.ref.parent.parent?.id || '',
            productId: data.productId || '',
            quantity: Number(data.quantity || 0),
          };
        });
        setLoadedOrderItems(items);
      })
      .catch(() => {
        if (!active) return;
        setLoadedOrderItems([]);
      })
      .finally(() => {
        if (active) setIsLoadingSalesAudit(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, firestore, loadedOrderItems]);

  const soldByProductId = useMemo(() => {
    if (!orders || orders.length === 0 || !loadedOrderItems) return undefined;
    return buildSoldUnitsByProductMap(orders as any[], loadedOrderItems);
  }, [orders, loadedOrderItems]);

  const filterOptions = useMemo(() => extractInventoryFilterOptions(products), [products]);

  // Chips rápidos para las categorías principales ordenadas por cantidad de modelos
  const topCategoryChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) {
      const cat = canonicalizeCategory(p.category);
      if (cat) counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({ name, count }));
  }, [products]);

  const activeFilters = useMemo(
    () => ({
      category: categoryFilter,
      brand: brandFilter,
      discipline: disciplineFilter,
      stockStatus: stockFilter,
      searchTerm,
      sortBy,
    }),
    [categoryFilter, brandFilter, disciplineFilter, stockFilter, searchTerm, sortBy]
  );

  const filteredProducts = useMemo(
    () => filterInventoryProducts(products, activeFilters),
    [products, activeFilters]
  );

  const metrics = useMemo(
    () => computeInventorySelectionMetrics(filteredProducts, bcvDiscount, soldByProductId),
    [filteredProducts, bcvDiscount, soldByProductId]
  );

  const reportHeaderMeta = useMemo(
    () => buildInventoryFilterTitle(activeFilters),
    [activeFilters]
  );

  const allSortedProducts = useMemo(
    () =>
      filterInventoryProducts(products, {
        category: 'todos',
        brand: 'todos',
        discipline: 'todos',
        stockStatus: 'todos',
        searchTerm: '',
        sortBy,
      }),
    [products, sortBy]
  );

  const hasAnyFilter =
    categoryFilter !== 'todos' ||
    brandFilter !== 'todos' ||
    disciplineFilter !== 'todos' ||
    stockFilter !== 'todos' ||
    searchTerm.trim().length > 0;

  const handleClearFilters = () => {
    setCategoryFilter('todos');
    setBrandFilter('todos');
    setDisciplineFilter('todos');
    setStockFilter('todos');
    setSearchTerm('');
    setSortBy('name_asc');
  };

  const handleExportPDF = async (forceFullInventory: boolean = false) => {
    const targetProducts = forceFullInventory ? allSortedProducts : filteredProducts;
    if (targetProducts.length === 0 || isGeneratingPdf) return;
    setIsGeneratingPdf(true);
    try {
      const targetMetrics = forceFullInventory
        ? computeInventorySelectionMetrics(targetProducts, bcvDiscount, soldByProductId)
        : metrics;
      const pdfTitle = forceFullInventory ? 'INVENTARIO MAESTRO 100%' : reportHeaderMeta.title;
      const pdfSubtitle = forceFullInventory
        ? 'CATÁLOGO COMPLETO AL 100% (INCLUYE AGOTADOS EN 0)'
        : reportHeaderMeta.subtitle;
      const baseSlug = forceFullInventory ? 'Inventario_100_Completo' : reportHeaderMeta.filenameSlug;

      await generateInventoryReportPDF(
        targetProducts,
        companyProfile,
        pdfTitle,
        {
          subtitle: pdfSubtitle,
          showPrices,
          bcvDiscount,
          soldByProductId,
          filename: showPrices ? baseSlug : `${baseSlug}_Conteo_Fisico`,
        }
      );
      toast({
        title: 'PDF Generado con Fotos',
        description: `${targetProducts.length} producto(s) · Había: ${targetMetrics.totalHadUnits.toLocaleString()} · Vendido: ${targetMetrics.totalSoldUnits.toLocaleString()} · Quedan: ${targetMetrics.totalUnits.toLocaleString()}.`,
      });
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error generando PDF',
        description: err?.message || 'No se pudo generar el documento.',
      });
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleExportExcel = () => {
    if (filteredProducts.length === 0) return;

    const rows: Record<string, string | number>[] = filteredProducts.map((p, idx) => {
      const audit = computeProductAuditRow(p, soldByProductId);
      const stock = audit.remaining;
      const listPrice = Number(p.price || 0);
      const cashPrice = getProductCashPrice(p, bcvDiscount);
      const sizesText = formatProductSizesSummary(p);
      const row: Record<string, string | number> = {
        '#': idx + 1,
        Código: p.sku || 'S/C',
        Producto: p.name || 'Producto',
        Categoría: canonicalizeCategory(p.category) || '-',
        Marca: canonicalizeBrand(p.brand) || '-',
        Disciplina: canonicalizeDiscipline(p.discipline) || '-',
        Ubicación: p.warehouseLocation || '-',
        Tallas: sizesText || '-',
        'Había (Uds)': audit.had,
        'Vendido (Uds)': audit.sold,
        'Deben Quedar (Uds)': stock,
      };
      if (showPrices) {
        row['Precio BCV (USD)'] = Number(listPrice.toFixed(2));
        row[`Precio Cash -${bcvDiscount}% (USD)`] = Number(cashPrice.toFixed(2));
        row['Total BCV (USD)'] = Number((Math.max(0, stock) * listPrice).toFixed(2));
        row['Total Cash (USD)'] = Number((Math.max(0, stock) * cashPrice).toFixed(2));
      }
      return row;
    });

    const totalRow: Record<string, string | number> = {
      '#': '',
      Código: 'TOTAL',
      Producto: `${metrics.modelsCount} modelos (${metrics.inStockCount} con stock / ${metrics.outOfStockCount} en 0)`,
      Categoría: '',
      Marca: '',
      Disciplina: '',
      Ubicación: '',
      Tallas: '',
      'Había (Uds)': metrics.totalHadUnits,
      'Vendido (Uds)': metrics.totalSoldUnits,
      'Deben Quedar (Uds)': metrics.totalUnits,
    };
    if (showPrices) {
      totalRow['Precio BCV (USD)'] = '';
      totalRow[`Precio Cash -${bcvDiscount}% (USD)`] = '';
      totalRow['Total BCV (USD)'] = metrics.totalValuationBCV;
      totalRow['Total Cash (USD)'] = metrics.totalValuationCash;
    }
    rows.push(totalRow);

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 5 },
      { wch: 16 },
      { wch: 36 },
      { wch: 16 },
      { wch: 14 },
      { wch: 16 },
      { wch: 12 },
      { wch: 24 },
      { wch: 14 },
      { wch: 14 },
      { wch: 18 },
      ...(showPrices ? [{ wch: 15 }, { wch: 18 }, { wch: 15 }, { wch: 15 }] : []),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    XLSX.writeFile(wb, `${reportHeaderMeta.filenameSlug}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);

    toast({
      title: 'Excel Descargado',
      description: `Se exportaron ${filteredProducts.length} productos (${metrics.totalUnits.toLocaleString()} uds).`,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[96vw] max-h-[92dvh] flex flex-col p-0 overflow-hidden rounded-[2rem] border-none shadow-2xl bg-white">
        {/* HEADER */}
        <DialogHeader className="p-6 sm:p-7 bg-slate-900 text-white shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3.5">
              <div className="h-12 w-12 rounded-2xl bg-blue-500/20 text-blue-300 border border-blue-400/30 flex items-center justify-center shrink-0">
                <Boxes className="h-6 w-6" />
              </div>
              <div>
                <DialogTitle className="text-lg sm:text-xl font-black uppercase tracking-tight text-white leading-tight">
                  Inventario Completo y Filtrable (PDF con Fotos)
                </DialogTitle>
                <DialogDescription className="text-[11px] font-bold text-slate-300 uppercase tracking-wider mt-0.5">
                  Imprime todo el catálogo o filtra por tipo (ej. Balones), marca, disciplina y disponibilidad.
                </DialogDescription>
              </div>
            </div>
            <Badge className="bg-blue-600 text-white border-none text-[10px] font-black uppercase px-3 py-1 self-start sm:self-center">
              {metrics.modelsCount} Modelos · {metrics.totalUnits.toLocaleString()} Uds
            </Badge>
          </div>
        </DialogHeader>

        {/* CUERPO CON FILTROS, KPIS Y TABLA PREVIEW */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5 min-h-0 bg-slate-50/40">
          {/* CHIPS DE ACCESO RÁPIDO EN 1-CLIC */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 mr-1">
              Acceso Rápido:
            </span>
            <button
              type="button"
              onClick={handleClearFilters}
              className={cn(
                'px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider border transition-all cursor-pointer',
                !hasAnyFilter
                  ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              )}
            >
              Todo el Inventario ({products.length})
            </button>
            {topCategoryChips.map((chip) => {
              const active = categoryFilter === chip.name;
              return (
                <button
                  key={chip.name}
                  type="button"
                  onClick={() => setCategoryFilter(active ? 'todos' : chip.name)}
                  className={cn(
                    'px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider border transition-all cursor-pointer',
                    active
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:text-blue-700'
                  )}
                >
                  {chip.name} ({chip.count})
                </button>
              );
            })}
          </div>

          {/* BARRA DE FILTROS MULTIDIMENSIONAL */}
          <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-sm space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <div className="space-y-1">
                <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                  Tipo / Categoría
                </Label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="h-10 rounded-xl bg-slate-50 border-slate-200 text-[11px] font-bold uppercase">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos" className="text-[11px] font-bold uppercase">
                      TODAS LAS CATEGORÍAS
                    </SelectItem>
                    {filterOptions.categories.map((cat) => (
                      <SelectItem key={cat} value={cat} className="text-[11px] font-bold uppercase">
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                  Marca
                </Label>
                <Select value={brandFilter} onValueChange={setBrandFilter}>
                  <SelectTrigger className="h-10 rounded-xl bg-slate-50 border-slate-200 text-[11px] font-bold uppercase">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos" className="text-[11px] font-bold uppercase">
                      TODAS LAS MARCAS
                    </SelectItem>
                    {filterOptions.brands.map((brand) => (
                      <SelectItem key={brand} value={brand} className="text-[11px] font-bold uppercase">
                        {brand}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                  Disciplina
                </Label>
                <Select value={disciplineFilter} onValueChange={setDisciplineFilter}>
                  <SelectTrigger className="h-10 rounded-xl bg-slate-50 border-slate-200 text-[11px] font-bold uppercase">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos" className="text-[11px] font-bold uppercase">
                      TODAS LAS DISCIPLINAS
                    </SelectItem>
                    {filterOptions.disciplines.map((disc) => (
                      <SelectItem key={disc} value={disc} className="text-[11px] font-bold uppercase">
                        {disc}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                  Disponibilidad
                </Label>
                <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as InventoryStockFilter)}>
                  <SelectTrigger className="h-10 rounded-xl bg-slate-50 border-slate-200 text-[11px] font-bold uppercase">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos" className="text-[11px] font-bold uppercase">
                      TODOS (INCLUYE 0)
                    </SelectItem>
                    <SelectItem value="in_stock" className="text-[11px] font-bold uppercase text-emerald-700">
                      SOLO DISPONIBLES (&gt; 0)
                    </SelectItem>
                    <SelectItem value="needs_restock" className="text-[11px] font-bold uppercase text-amber-700">
                      FALTANTES (&lt; 20 UDS)
                    </SelectItem>
                    <SelectItem value="low" className="text-[11px] font-bold uppercase">
                      BAJO STOCK (1 - 19)
                    </SelectItem>
                    <SelectItem value="out" className="text-[11px] font-bold uppercase text-rose-700">
                      SOLO AGOTADOS (0)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                  Ordenar Por
                </Label>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as InventorySortBy)}>
                  <SelectTrigger className="h-10 rounded-xl bg-slate-50 border-slate-200 text-[11px] font-bold uppercase">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name_asc" className="text-[11px] font-bold uppercase">
                      NOMBRE (A - Z)
                    </SelectItem>
                    <SelectItem value="stock_desc" className="text-[11px] font-bold uppercase">
                      MAYOR STOCK PRIMERO
                    </SelectItem>
                    <SelectItem value="stock_asc" className="text-[11px] font-bold uppercase">
                      MENOR STOCK PRIMERO
                    </SelectItem>
                    <SelectItem value="brand_asc" className="text-[11px] font-bold uppercase">
                      MARCA (A - Z)
                    </SelectItem>
                    <SelectItem value="price_desc" className="text-[11px] font-bold uppercase">
                      MAYOR PRECIO BCV
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                  Buscar Modelo / SKU
                </Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Nombre, SKU, pasillo..."
                    className="h-10 pl-8 rounded-xl bg-slate-50 border-slate-200 text-[11px] font-bold uppercase"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <div className="flex items-center gap-2.5">
                <Switch id="inv-show-prices" checked={showPrices} onCheckedChange={setShowPrices} />
                <Label htmlFor="inv-show-prices" className="text-[11px] font-bold uppercase text-slate-700 cursor-pointer">
                  Mostrar precios BCV / Cash en PDF y Excel (apágalo para imprimir hoja de conteo físico)
                </Label>
              </div>
              {hasAnyFilter && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFilters}
                  className="h-8 px-3 rounded-xl text-[10px] font-black uppercase text-slate-500 hover:text-slate-900"
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Limpiar Filtros
                </Button>
              )}
            </div>
          </div>

          {/* 4 TARJETAS KPI EN VIVO */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-4 rounded-2xl bg-slate-900 text-white shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Modelos en Lista</p>
              <p className="text-2xl font-black tracking-tight mt-0.5">{metrics.modelsCount}</p>
              <p className="text-[10px] font-semibold text-slate-300 mt-0.5">
                {metrics.inStockCount} disponibles · {metrics.outOfStockCount} agotados
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-blue-600 text-white shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-widest text-blue-100">
                Deben Quedar {isLoadingSalesAudit ? '(calculando ventas...)' : ''}
              </p>
              <p className="text-2xl font-black tracking-tight mt-0.5">{metrics.totalUnits.toLocaleString()}</p>
              <p className="text-[10px] font-semibold text-blue-100 mt-0.5">
                Había: {metrics.totalHadUnits.toLocaleString()} · Vendido: {metrics.totalSoldUnits.toLocaleString()}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Valoración Lista BCV</p>
              <p className="text-2xl font-black tracking-tight text-slate-900 mt-0.5">
                ${metrics.totalValuationBCV.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-[10px] font-semibold text-slate-400 mt-0.5">Base imponible catálogo</p>
            </div>
            <div className="p-4 rounded-2xl bg-emerald-600 text-white shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-widest text-emerald-100">Valoración Cash (-{bcvDiscount}%)</p>
              <p className="text-2xl font-black tracking-tight mt-0.5">
                ${metrics.totalValuationCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-[10px] font-semibold text-emerald-100 mt-0.5">Equivalente divisas efectivo</p>
            </div>
          </div>

          {/* TABLA DE VISTA PREVIA CON FOTOS A COLOR */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            {filteredProducts.length === 0 ? (
              <div className="p-12 text-center space-y-2">
                <Boxes className="h-10 w-10 text-slate-300 mx-auto" />
                <p className="text-xs font-black uppercase text-slate-700">No hay productos con esos filtros</p>
                <p className="text-[11px] font-medium text-slate-400">
                  Prueba limpiando alguno de los filtros de marca, disciplina o stock.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[42vh]">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 z-10 bg-slate-900 text-white">
                    <tr className="text-[9px] font-black uppercase tracking-widest">
                      <th className="p-3.5 w-16 text-center">Foto</th>
                      <th className="p-3.5">Producto / Código / Marca</th>
                      <th className="p-3.5 text-center">Había</th>
                      <th className="p-3.5 text-center">Vendido</th>
                      <th className="p-3.5 text-center">Deben Quedar</th>
                      {showPrices && (
                        <>
                          <th className="p-3.5 text-right">Lista BCV</th>
                          <th className="p-3.5 text-right">Cash (-{bcvDiscount}%)</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredProducts.map((p) => {
                      const audit = computeProductAuditRow(p, soldByProductId);
                      const stock = audit.remaining;
                      const brand = canonicalizeBrand(p.brand);
                      const disc = canonicalizeDiscipline(p.discipline);
                      const cat = canonicalizeCategory(p.category);
                      const sizesText = formatProductSizesSummary(p);
                      const listPrice = Number(p.price || 0);
                      const cashPrice = getProductCashPrice(p, bcvDiscount);
                      const previewImg = p.imageUrl || (Array.isArray(p.imageUrls) ? p.imageUrls[0] : '');

                      return (
                        <tr key={p.id || p.sku} className="hover:bg-slate-50/80 transition-colors">
                          <td className="p-3 text-center">
                            {previewImg ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={previewImg}
                                alt={p.name}
                                crossOrigin={previewImg.startsWith('data:') ? undefined : 'anonymous'}
                                className="h-11 w-11 rounded-xl object-cover border border-slate-200 mx-auto bg-white"
                              />
                            ) : (
                              <div className="h-11 w-11 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                                <Boxes className="h-5 w-5" />
                              </div>
                            )}
                          </td>
                          <td className="p-3">
                            <p className="font-black uppercase text-slate-900 leading-tight">{p.name}</p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              <span className="text-[9px] font-mono font-bold text-slate-500">CÓD: {p.sku || 'S/C'}</span>
                              {p.warehouseLocation && (
                                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase text-slate-400">
                                  <MapPin className="h-2.5 w-2.5" />
                                  {p.warehouseLocation}
                                </span>
                              )}
                              {cat && (
                                <Badge variant="secondary" className="text-[8px] font-black uppercase px-1.5 h-4">
                                  {cat}
                                </Badge>
                              )}
                              {brand && (
                                <Badge variant="outline" className="text-[8px] font-black uppercase px-1.5 h-4 border-blue-200 text-blue-700 bg-blue-50/50">
                                  {brand}
                                </Badge>
                              )}
                              {disc && (
                                <Badge variant="outline" className="text-[8px] font-black uppercase px-1.5 h-4 border-slate-200 text-slate-600">
                                  {disc}
                                </Badge>
                              )}
                            </div>
                            {sizesText && (
                              <p className="text-[10px] font-semibold text-slate-500 mt-1">
                                Tallas: {sizesText}
                              </p>
                            )}
                          </td>
                          <td className="p-3 text-center font-mono font-bold text-slate-700">
                            {audit.had}
                          </td>
                          <td className="p-3 text-center font-mono font-bold text-blue-600">
                            {audit.sold}
                          </td>
                          <td className="p-3 text-center">
                            <Badge
                              className={cn(
                                'font-black text-[10px] border-none px-2.5 py-0.5',
                                stock <= 0
                                  ? 'bg-rose-100 text-rose-700'
                                  : stock < 20
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-emerald-100 text-emerald-700'
                              )}
                            >
                              {stock}
                            </Badge>
                          </td>
                          {showPrices && (
                            <>
                              <td className="p-3 text-right font-mono font-bold text-slate-900">
                                ${listPrice.toFixed(2)}
                              </td>
                              <td className="p-3 text-right font-mono font-black text-emerald-600">
                                ${cashPrice.toFixed(2)}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* PIE CON ACCIONES DE EXPORTACIÓN */}
        <DialogFooter className="p-5 sm:px-7 bg-white border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
          <div className="text-[10px] font-bold uppercase text-slate-500">
            Documento a emitir: <strong className="text-slate-900">{reportHeaderMeta.title}</strong>
            {hasAnyFilter && ` · ${reportHeaderMeta.subtitle}`}
          </div>
          <div className="flex flex-wrap items-center gap-2.5 justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={filteredProducts.length === 0}
              onClick={handleExportExcel}
              className="h-11 px-5 rounded-xl border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 font-black uppercase text-[10px] tracking-wider"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4 text-emerald-600" /> Exportar Excel (.xlsx)
            </Button>
            {hasAnyFilter && allSortedProducts.length > 0 && (
              <Button
                type="button"
                variant="outline"
                disabled={isGeneratingPdf}
                onClick={() => handleExportPDF(true)}
                className="h-11 px-5 rounded-xl border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100 font-black uppercase text-[10px] tracking-wider"
              >
                <Printer className="mr-2 h-4 w-4 text-blue-600" /> Imprimir 100% Inventario ({allSortedProducts.length})
              </Button>
            )}
            <Button
              type="button"
              disabled={filteredProducts.length === 0 || isGeneratingPdf}
              onClick={() => handleExportPDF(false)}
              className="h-11 px-6 rounded-xl bg-slate-900 hover:bg-blue-600 text-white font-black uppercase text-[10px] tracking-wider shadow-lg"
            >
              {isGeneratingPdf ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generando PDF...
                </>
              ) : (
                <>
                  <Printer className="mr-2 h-4 w-4 text-blue-300" />{' '}
                  {showPrices
                    ? `Imprimir PDF con Fotos (${metrics.modelsCount})`
                    : `Imprimir Hoja Conteo Físico (${metrics.modelsCount})`}
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
