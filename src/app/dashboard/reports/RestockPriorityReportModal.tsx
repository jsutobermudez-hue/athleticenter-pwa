'use client';

import React, { useMemo, useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import type { Product, PurchaseOrder, CompanyProfile } from '@/lib/definitions';
import {
  buildRestockAnalysis,
  getPriorityLabel,
  type RestockItemAnalysis,
  type RestockPriority,
} from '@/lib/restock-engine';
import { generateRestockPriorityPDF } from '@/lib/pdf-generator';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  AlertTriangle,
  Boxes,
  Check,
  Copy,
  Download,
  FileSpreadsheet,
  Flame,
  Loader2,
  PackageCheck,
  PackageX,
  RotateCcw,
  Search,
  Send,
  TrendingUp,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export interface RestockPriorityReportModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  purchaseOrders?: PurchaseOrder[];
  companyProfile?: Partial<CompanyProfile>;
  defaultTab?: 'restock' | 'agotados' | 'criticos' | 'completo';
}

export function RestockPriorityReportModal({
  isOpen,
  onOpenChange,
  products = [],
  purchaseOrders = [],
  companyProfile,
  defaultTab = 'restock',
}: RestockPriorityReportModalProps) {
  const { toast } = useToast();

  const [threshold, setThreshold] = useState<number>(20);
  const [activeTab, setActiveTab] = useState<'restock' | 'agotados' | 'criticos' | 'completo'>(defaultTab);
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'P1_URGENTE' | 'P2_ALTA' | 'P3_MEDIA'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('todos');
  const [onlyWithMovement, setOnlyWithMovement] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<'priority' | 'most_sold' | 'lowest_stock'>('priority');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [customQuantities, setCustomQuantities] = useState<Record<string, number>>({});
  const [includeCostEstimate, setIncludeCostEstimate] = useState<boolean>(false);
  const [exportingMode, setExportingMode] = useState<'gerencial' | 'proveedor' | null>(null);
  const [copiedSummary, setCopiedSummary] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(defaultTab);
    }
  }, [isOpen, defaultTab]);

  const summary = useMemo(
    () => buildRestockAnalysis(products, { threshold, purchaseOrders }),
    [products, threshold, purchaseOrders]
  );

  const getEffectiveQty = (it: RestockItemAnalysis) =>
    customQuantities[it.id] !== undefined ? Math.max(0, Number(customQuantities[it.id]) || 0) : it.suggestedRestockQty;

  const setItemQty = (id: string, value: number) => {
    const clean = Math.max(0, Math.floor(Number(value) || 0));
    setCustomQuantities((prev) => ({ ...prev, [id]: clean }));
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category.trim());
    });
    return Array.from(set).sort();
  }, [products]);

  const filteredItems = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    const list = summary.items.filter((item) => {
      if (activeTab === 'restock' && item.status === 'saludable') return false;
      if (activeTab === 'agotados' && item.status !== 'agotado') return false;
      if (activeTab === 'criticos' && item.status !== 'critico') return false;

      if (priorityFilter !== 'all' && item.priority !== priorityFilter) return false;
      if (categoryFilter !== 'todos' && item.category !== categoryFilter) return false;
      if (onlyWithMovement && item.totalSold <= 0) return false;

      if (term) {
        const hay = `${item.name} ${item.sku} ${item.category} ${item.discipline} ${item.brand}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });

    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortBy === 'most_sold') {
        if (b.totalSold !== a.totalSold) return b.totalSold - a.totalSold;
        return a.stock - b.stock;
      }
      if (sortBy === 'lowest_stock') {
        if (a.stock !== b.stock) return a.stock - b.stock;
        return b.totalSold - a.totalSold;
      }
      if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
      if (b.totalSold !== a.totalSold) return b.totalSold - a.totalSold;
      return a.stock - b.stock;
    });

    return sorted;
  }, [summary.items, activeTab, priorityFilter, categoryFilter, onlyWithMovement, searchTerm, sortBy]);

  const totalCatalogRestockUnits = useMemo(
    () =>
      summary.items
        .filter((it) => it.status !== 'saludable')
        .reduce((sum, it) => sum + getEffectiveQty(it), 0),
    [summary.items, customQuantities]
  );

  const viewTotals = useMemo(() => {
    return filteredItems.reduce(
      (acc, it) => {
        const qty = getEffectiveQty(it);
        acc.currentStock += it.stock;
        acc.suggestedUnits += qty;
        acc.investmentUSD += qty * it.estimatedUnitCostUSD;
        return acc;
      },
      { currentStock: 0, suggestedUnits: 0, investmentUSD: 0 }
    );
  }, [filteredItems, customQuantities]);

  const handleExportPDF = async (mode: 'gerencial' | 'proveedor') => {
    if (filteredItems.length === 0) {
      toast({ variant: 'destructive', title: 'No hay productos en esta vista para exportar' });
      return;
    }
    if (mode === 'proveedor' && filteredItems.every((it) => getEffectiveQty(it) <= 0)) {
      toast({
        variant: 'destructive',
        title: 'Sin cantidades a pedir',
        description: 'Todos los productos filtrados tienen 0 en unidades sugeridas a reponer.',
      });
      return;
    }

    setExportingMode(mode);
    try {
      const tabLabels: Record<typeof activeTab, string> = {
        restock: `FALTANTES Y MENOS DE ${summary.threshold} UNIDADES — ORDENADOS POR MAYOR VENTA`,
        agotados: 'PRODUCTOS AGOTADOS HOY (0 UNIDADES)',
        criticos: `PRODUCTOS CON POCAS EXISTENCIAS (1 A ${summary.threshold - 1} UNIDADES)`,
        completo: `EXISTENCIA COMPLETA DEL INVENTARIO (ALERTA < ${summary.threshold} UDS)`,
      };
      await generateRestockPriorityPDF(summary, filteredItems, companyProfile, tabLabels[activeTab], {
        mode,
        customQuantities,
        includeCostEstimate,
      });
      toast({
        title:
          mode === 'proveedor'
            ? '📄 PDF Lista para Proveedor descargado'
            : '📄 PDF Gerencial con fotos a color descargado',
      });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al generar PDF', description: e?.message });
    } finally {
      setExportingMode(null);
    }
  };

  const handleExportExcel = () => {
    try {
      const toRow = (it: RestockItemAnalysis, idx: number) => {
        const qty = getEffectiveQty(it);
        const row: Record<string, any> = {
          '#': idx + 1,
          Producto: it.name,
          Categoria: it.category,
          'Unidades Existentes': it.stock,
          'Unidades Vendidas': it.totalSold,
          'Unidades Sugeridas a Reponer': qty,
          Sugerencia: `${it.urgencyBadge} - ${it.recommendationText}`,
          Movimiento: it.movementLabel,
          'Faltan para Umbral': it.shortageToThreshold,
          'En Camino': it.inTransit,
          Referencia: it.sku,
          'Foto URL': it.imageUrl && !it.imageUrl.startsWith('data:') ? it.imageUrl : it.imageUrl ? 'Foto en sistema' : 'Sin foto',
        };
        if (includeCostEstimate) {
          row['Inversion Estimada USD'] = Number((qty * it.estimatedUnitCostUSD).toFixed(2));
        }
        return row;
      };

      const wb = XLSX.utils.book_new();
      const restockOnly = summary.items.filter((i) => i.status !== 'saludable');
      const sheet1 = XLSX.utils.json_to_sheet(restockOnly.map((it, idx) => toRow(it, idx)));
      const sheet2 = XLSX.utils.json_to_sheet(
        summary.items
          .filter((i) => i.status === 'agotado' || i.status === 'critico')
          .sort((a, b) => a.stock - b.stock || b.totalSold - a.totalSold)
          .map((it, idx) => toRow(it, idx))
      );
      const sheet3 = XLSX.utils.json_to_sheet(summary.items.map((it, idx) => toRow(it, idx)));

      XLSX.utils.book_append_sheet(wb, sheet1, '1_Prioridad_Reposicion');
      XLSX.utils.book_append_sheet(wb, sheet2, '2_Agotados_y_Bajos');
      XLSX.utils.book_append_sheet(wb, sheet3, '3_Existencia_Completa');

      XLSX.writeFile(wb, `Reporte_Reposicion_Athleticenter_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
      toast({ title: '📊 Excel (.xlsx) descargado con tus cantidades' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al exportar Excel', description: e?.message });
    }
  };

  const handleCopyWhatsAppSummary = async () => {
    const urgentItems = summary.items.filter((i) => i.priority === 'P1_URGENTE').slice(0, 12);
    const lines = [
      `📦 *ATHLETICENTER — REPORTE DE REPOSICIÓN (<${summary.threshold} UDS)*`,
      `📅 ${format(new Date(), 'dd/MM/yyyy HH:mm')}`,
      `• Agotados hoy (0 uds): *${summary.outOfStockCount} productos*`,
      `• Quedan menos de ${summary.threshold} uds: *${summary.criticalCount} productos*`,
      `• Para pedir urgente: *${summary.p1UrgentCount} productos*`,
      `• Total a reponer: *${totalCatalogRestockUnits.toLocaleString()} unidades*`,
      '',
      `🔴 *PRODUCTOS QUE MÁS SE VENDEN Y FALTAN:*`,
      ...urgentItems.map(
        (it, i) =>
          `${i + 1}. *${it.name}*\n   Quedan: *${it.stock}* uds | Vendidos: *${it.totalSold}* uds | Pedir: *${getEffectiveQty(it)}* uds`
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedSummary(true);
      toast({ title: '📋 Resumen copiado para enviar por WhatsApp' });
      setTimeout(() => setCopiedSummary(false), 2500);
    } catch {
      toast({ variant: 'destructive', title: 'No se pudo copiar al portapapeles' });
    }
  };

  const priorityPillClass = (p: RestockPriority) => {
    switch (p) {
      case 'P1_URGENTE':
        return 'bg-rose-600 text-white border-none';
      case 'P2_ALTA':
        return 'bg-orange-500 text-white border-none';
      case 'P3_MEDIA':
        return 'bg-amber-400 text-slate-950 border-none';
      case 'P4_OK':
        return 'bg-emerald-600 text-white border-none';
    }
  };

  const hasCustomEdits = Object.keys(customQuantities).length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] xl:max-w-7xl w-full p-0 rounded-[2rem] overflow-hidden border-none shadow-2xl bg-white flex flex-col max-h-[94vh]">
        {/* HEADER */}
        <DialogHeader className="p-5 sm:p-6 bg-slate-900 text-white shrink-0 relative">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pr-8">
            <div className="flex items-center gap-3.5">
              <div className="h-12 w-12 rounded-2xl bg-rose-500/20 border border-rose-400/30 text-rose-300 flex items-center justify-center shrink-0">
                <Flame className="h-6 w-6" />
              </div>
              <div className="text-left">
                <DialogTitle className="text-lg sm:text-2xl font-black uppercase tracking-tight text-white leading-none">
                  Reporte de Existencias y Reposición
                </DialogTitle>
                <DialogDescription className="text-[11px] font-bold text-slate-300 mt-1.5">
                  Qué te queda · Qué se vende más · Cuánto reponer (con fotos a color)
                </DialogDescription>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handleCopyWhatsAppSummary}
                variant="outline"
                className="h-10 px-3 rounded-xl bg-white/10 border-white/15 text-white hover:bg-white/20 font-black uppercase text-[10px] tracking-wider"
              >
                {copiedSummary ? <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
                {copiedSummary ? 'Copiado' : 'WhatsApp'}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleExportExcel}
                className="h-10 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-[10px] tracking-wider shadow-lg"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" /> Excel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => handleExportPDF('proveedor')}
                disabled={exportingMode !== null}
                className="h-10 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase text-[10px] tracking-wider shadow-lg"
              >
                {exportingMode === 'proveedor' ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                )}
                PDF Proveedor
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => handleExportPDF('gerencial')}
                disabled={exportingMode !== null}
                className="h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black uppercase text-[10px] tracking-wider shadow-lg"
              >
                {exportingMode === 'gerencial' ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                )}
                PDF con Fotos
              </Button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="absolute top-5 right-5 text-white/40 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </DialogHeader>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-50/60">
          {/* 4 TARJETAS SIMPLES CLICABLES */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <button
              type="button"
              onClick={() => {
                setActiveTab('agotados');
                setPriorityFilter('all');
              }}
              className={cn(
                'p-4 rounded-2xl border bg-white text-left transition-all shadow-sm hover:shadow-md',
                activeTab === 'agotados'
                  ? 'ring-2 ring-rose-500 border-rose-200 bg-rose-50/30'
                  : 'border-slate-200/80'
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-rose-600">Agotados hoy</span>
                <PackageX className="h-4 w-4 text-rose-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 tracking-tight">{summary.outOfStockCount} productos</p>
              <p className="text-[11px] font-bold text-slate-500 mt-0.5">0 unidades disponibles</p>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('criticos');
                setPriorityFilter('all');
              }}
              className={cn(
                'p-4 rounded-2xl border bg-white text-left transition-all shadow-sm hover:shadow-md',
                activeTab === 'criticos'
                  ? 'ring-2 ring-amber-500 border-amber-200 bg-amber-50/30'
                  : 'border-slate-200/80'
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-600">
                  Quedan menos de {summary.threshold}
                </span>
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 tracking-tight">{summary.criticalCount} productos</p>
              <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                Entre 1 y {summary.threshold - 1} unidades
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('restock');
                setPriorityFilter(priorityFilter === 'P1_URGENTE' ? 'all' : 'P1_URGENTE');
              }}
              className={cn(
                'p-4 rounded-2xl border bg-white text-left transition-all shadow-sm hover:shadow-md',
                priorityFilter === 'P1_URGENTE' && activeTab === 'restock'
                  ? 'ring-2 ring-rose-600 border-rose-200 bg-rose-50/40'
                  : 'border-slate-200/80'
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-rose-700">Pedir urgente</span>
                <Flame className="h-4 w-4 text-rose-600" />
              </div>
              <p className="text-2xl font-black text-slate-900 tracking-tight">{summary.p1UrgentCount} productos</p>
              <p className="text-[11px] font-bold text-slate-500 mt-0.5">Los faltantes que más se venden</p>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('completo');
                setPriorityFilter('all');
              }}
              className={cn(
                'p-4 rounded-2xl border bg-white text-left transition-all shadow-sm hover:shadow-md',
                activeTab === 'completo'
                  ? 'ring-2 ring-blue-600 border-blue-200 bg-blue-50/30'
                  : 'border-slate-200/80'
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-blue-700">
                  Total a reponer
                </span>
                <PackageCheck className="h-4 w-4 text-blue-600" />
              </div>
              <p className="text-2xl font-black text-slate-900 tracking-tight">
                {totalCatalogRestockUnits.toLocaleString()} uds
              </p>
              <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                Existencia total catálogo: {summary.totalStockUnits.toLocaleString()} uds
              </p>
            </button>
          </div>

          {/* PESTAÑAS + UMBRAL + FILTROS */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-3 shadow-sm">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <Tabs
                value={activeTab}
                onValueChange={(val: any) => {
                  setActiveTab(val);
                  if (val === 'completo') setPriorityFilter('all');
                }}
                className="w-full lg:w-auto"
              >
                <TabsList className="grid grid-cols-2 sm:grid-cols-4 bg-slate-100 p-1 rounded-xl h-auto gap-1">
                  <TabsTrigger value="restock" className="text-[10px] font-black uppercase py-2 px-3 rounded-lg">
                    Prioridad Reposición ({summary.needsRestockCount})
                  </TabsTrigger>
                  <TabsTrigger value="agotados" className="text-[10px] font-black uppercase py-2 px-3 rounded-lg">
                    Agotados ({summary.outOfStockCount})
                  </TabsTrigger>
                  <TabsTrigger value="criticos" className="text-[10px] font-black uppercase py-2 px-3 rounded-lg">
                    Menos de {summary.threshold} ({summary.criticalCount})
                  </TabsTrigger>
                  <TabsTrigger value="completo" className="text-[10px] font-black uppercase py-2 px-3 rounded-lg">
                    Todo el Inventario ({summary.totalProducts})
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {/* MÍNIMO DE ALERTA */}
              <div className="flex flex-wrap items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200/80">
                <span className="text-[10px] font-black uppercase text-slate-500">
                  Avisar con menos de:
                </span>
                {[10, 20, 30, 50].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setThreshold(preset)}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-[10px] font-black transition-all',
                      threshold === preset
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                    )}
                  >
                    {preset}
                  </button>
                ))}
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={threshold}
                  onChange={(e) => setThreshold(Math.max(1, Number(e.target.value) || 20))}
                  className="w-16 h-7 text-center font-black text-xs bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-center pt-1">
              <div className="relative lg:col-span-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Buscar producto o marca..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-10 pl-9 rounded-xl bg-slate-50 border-slate-200 text-xs font-bold"
                />
              </div>

              <div className="lg:col-span-2">
                <Select value={priorityFilter} onValueChange={(v: any) => setPriorityFilter(v)}>
                  <SelectTrigger className="h-10 rounded-xl bg-slate-50 border-slate-200 text-[11px] font-black uppercase">
                    <SelectValue placeholder="Sugerencia" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs font-bold">TODAS</SelectItem>
                    <SelectItem value="P1_URGENTE" className="text-xs font-bold text-rose-600">🔴 PEDIR URGENTE</SelectItem>
                    <SelectItem value="P2_ALTA" className="text-xs font-bold text-orange-600">🟠 REPONER PRONTO</SelectItem>
                    <SelectItem value="P3_MEDIA" className="text-xs font-bold text-amber-600">🟡 EVALUAR</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="lg:col-span-2">
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="h-10 rounded-xl bg-slate-50 border-slate-200 text-[11px] font-black uppercase">
                    <SelectValue placeholder="Categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos" className="text-xs font-bold">TODAS CATEGORÍAS</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c} className="text-xs font-bold uppercase">
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="lg:col-span-2">
                <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                  <SelectTrigger className="h-10 rounded-xl bg-slate-50 border-slate-200 text-[11px] font-black uppercase">
                    <SelectValue placeholder="Ordenar por" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="priority" className="text-xs font-bold">URGENCIA + VENTAS</SelectItem>
                    <SelectItem value="most_sold" className="text-xs font-bold">MÁS VENDIDOS PRIMERO</SelectItem>
                    <SelectItem value="lowest_stock" className="text-xs font-bold">MENOR EXISTENCIA PRIMERO</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="lg:col-span-2 flex items-center justify-between sm:justify-end gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
                <Label htmlFor="only-movement-switch" className="text-[10px] font-black uppercase text-slate-600 cursor-pointer">
                  Solo con ventas
                </Label>
                <Switch
                  id="only-movement-switch"
                  checked={onlyWithMovement}
                  onCheckedChange={setOnlyWithMovement}
                />
              </div>
            </div>
          </div>

          {/* TABLA VISUAL DE 6 COLUMNAS CLARAS CON FOTO A COLOR */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
            <div className="overflow-auto max-h-[46vh]">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-900 text-white text-[10px] font-black uppercase tracking-wider">
                  <tr>
                    <th className="p-3.5 text-center w-20">Foto a color</th>
                    <th className="p-3.5">Producto</th>
                    <th className="p-3.5 text-center">Unidades existentes</th>
                    <th className="p-3.5 text-center">Unidades vendidas</th>
                    <th className="p-3.5 text-center">Unidades sugeridas a reponer</th>
                    <th className="p-3.5">Sugerencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400 font-bold uppercase text-xs">
                        No hay productos que coincidan con los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((it) => {
                      const effectiveQty = getEffectiveQty(it);
                      const isEdited = customQuantities[it.id] !== undefined;
                      return (
                        <tr key={it.id} className="hover:bg-slate-50/90 transition-colors">
                          {/* 1. FOTO A COLOR */}
                          <td className="p-3 text-center align-middle">
                            {it.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={it.imageUrl}
                                alt={it.name}
                                className="h-14 w-14 mx-auto rounded-xl object-contain bg-white border border-slate-200 p-1 shadow-xs"
                              />
                            ) : (
                              <div className="h-14 w-14 mx-auto rounded-xl bg-slate-100 border border-slate-200 text-slate-400 flex items-center justify-center">
                                <Boxes className="h-6 w-6" />
                              </div>
                            )}
                          </td>

                          {/* 2. PRODUCTO */}
                          <td className="p-3 align-middle max-w-[280px]">
                            <p className="font-black text-sm text-slate-900 leading-snug">
                              {it.name}
                            </p>
                            <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                              {it.category}
                              <span className="text-slate-400 font-normal ml-1.5">· Ref. {it.sku}</span>
                            </p>
                            {it.lowSizesText && (
                              <p className="text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-0.5 inline-block mt-1">
                                {it.lowSizesText}
                              </p>
                            )}
                          </td>

                          {/* 3. UNIDADES EXISTENTES */}
                          <td className="p-3 text-center align-middle whitespace-nowrap">
                            <div className="inline-flex flex-col items-center gap-1">
                              <span
                                className={cn(
                                  'text-lg font-black leading-none',
                                  it.stock <= 0
                                    ? 'text-rose-600'
                                    : it.stock < summary.threshold
                                      ? 'text-orange-600'
                                      : 'text-emerald-600'
                                )}
                              >
                                {it.stock}
                              </span>
                              <span
                                className={cn(
                                  'text-[10px] font-bold px-2 py-0.5 rounded-full',
                                  it.stock <= 0
                                    ? 'bg-rose-50 text-rose-700'
                                    : it.stock < summary.threshold
                                      ? 'bg-orange-50 text-orange-700'
                                      : 'bg-emerald-50 text-emerald-700'
                                )}
                              >
                                {it.stock <= 0
                                  ? 'Agotado'
                                  : it.stock < summary.threshold
                                    ? 'Quedan pocos'
                                    : 'Disponible'}
                              </span>
                              {it.inTransit > 0 && (
                                <span className="text-[9px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                                  +{it.inTransit} en camino
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 4. UNIDADES VENDIDAS */}
                          <td className="p-3 text-center align-middle whitespace-nowrap">
                            <div className="inline-flex flex-col items-center gap-0.5">
                              <span className="text-base font-black text-slate-900 inline-flex items-center gap-1">
                                <TrendingUp className="h-3.5 w-3.5 text-primary" />
                                {it.totalSold}
                              </span>
                              <span
                                className={cn(
                                  'text-[10px] font-bold',
                                  it.rotationTier === 'ALTA'
                                    ? 'text-indigo-700'
                                    : it.rotationTier === 'MEDIA'
                                      ? 'text-sky-700'
                                      : 'text-slate-400'
                                )}
                              >
                                {it.movementLabel}
                              </span>
                            </div>
                          </td>

                          {/* 5. UNIDADES SUGERIDAS A REPONER (EDITABLE) */}
                          <td className="p-3 text-center align-middle whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <Input
                                type="number"
                                min={0}
                                max={9999}
                                value={effectiveQty}
                                onChange={(e) => setItemQty(it.id, Number(e.target.value))}
                                className={cn(
                                  'w-20 h-9 text-center font-black text-sm rounded-xl border',
                                  effectiveQty > 0
                                    ? 'border-blue-200 bg-blue-50/70 text-blue-800'
                                    : 'border-slate-200 bg-slate-50 text-slate-400',
                                  isEdited && 'ring-2 ring-blue-400'
                                )}
                              />
                              {effectiveQty > 0 && (
                                <button
                                  type="button"
                                  title="No pedir este producto (poner 0)"
                                  onClick={() => setItemQty(it.id, 0)}
                                  className="h-7 w-7 rounded-lg text-[10px] font-black text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                                >
                                  0
                                </button>
                              )}
                            </div>
                          </td>

                          {/* 6. SUGERENCIA */}
                          <td className="p-3 align-middle min-w-[200px]">
                            <div className="space-y-1">
                              <Badge className={cn('text-[9px] font-black uppercase', priorityPillClass(it.priority))}>
                                {getPriorityLabel(it.priority)}
                              </Badge>
                              <p className="text-[11px] font-semibold text-slate-600 leading-snug">
                                {it.recommendationText}
                              </p>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* FOOTER SIMPLE */}
        <DialogFooter className="p-4 sm:p-5 bg-white border-t border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-4 text-xs font-bold text-slate-600">
            <span>
              Productos en lista: <strong className="text-slate-900">{filteredItems.length}</strong>
            </span>
            <span>
              Existentes en lista: <strong className="text-slate-900">{viewTotals.currentStock.toLocaleString()} uds</strong>
            </span>
            <span>
              Total a reponer: <strong className="text-blue-700">{viewTotals.suggestedUnits.toLocaleString()} uds</strong>
            </span>
            {includeCostEstimate && (
              <span>
                Inversión est.: <strong className="text-emerald-700">${viewTotals.investmentUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
              <Label htmlFor="include-cost-switch" className="text-[10px] font-black uppercase text-slate-600 cursor-pointer">
                Incluir costo est. ($)
              </Label>
              <Switch
                id="include-cost-switch"
                checked={includeCostEstimate}
                onCheckedChange={setIncludeCostEstimate}
              />
            </div>

            {hasCustomEdits && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCustomQuantities({})}
                className="h-10 px-3 rounded-xl font-black text-[10px] uppercase border-slate-200"
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Restablecer cantidades
              </Button>
            )}

            <Button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-10 px-6 rounded-xl font-black text-xs uppercase bg-slate-900 text-white"
            >
              Cerrar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
