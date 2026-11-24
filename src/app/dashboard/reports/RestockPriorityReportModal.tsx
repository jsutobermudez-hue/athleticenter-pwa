'use client';

import React, { useMemo, useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import type { Product, PurchaseOrder, CompanyProfile } from '@/lib/definitions';
import {
  buildRestockAnalysis,
  getPriorityLabel,
  getRotationLabel,
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
  FileText,
  Flame,
  Loader2,
  PackageCheck,
  PackageX,
  Search,
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
  const [sortBy, setSortBy] = useState<'priority' | 'most_sold' | 'lowest_stock' | 'investment'>('priority');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isExportingPdf, setIsExportingPdf] = useState(false);
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
      if (sortBy === 'investment') {
        if (b.estimatedInvestmentUSD !== a.estimatedInvestmentUSD) {
          return b.estimatedInvestmentUSD - a.estimatedInvestmentUSD;
        }
        return a.priorityRank - b.priorityRank;
      }
      // default 'priority'
      if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
      if (b.totalSold !== a.totalSold) return b.totalSold - a.totalSold;
      return a.stock - b.stock;
    });

    return sorted;
  }, [summary.items, activeTab, priorityFilter, categoryFilter, onlyWithMovement, searchTerm, sortBy]);

  const viewTotals = useMemo(() => {
    return filteredItems.reduce(
      (acc, it) => {
        acc.currentStock += it.stock;
        acc.suggestedUnits += it.suggestedRestockQty;
        acc.investmentUSD += it.estimatedInvestmentUSD;
        return acc;
      },
      { currentStock: 0, suggestedUnits: 0, investmentUSD: 0 }
    );
  }, [filteredItems]);

  const handleExportPDF = async () => {
    if (filteredItems.length === 0) {
      toast({ variant: 'destructive', title: 'Sin registros para exportar' });
      return;
    }
    setIsExportingPdf(true);
    try {
      const tabLabels: Record<typeof activeTab, string> = {
        restock: `REPOSICIÓN PRIORITARIA (AGOTADOS + < ${summary.threshold} UDS)`,
        agotados: 'PRODUCTOS AGOTADOS (0 UNIDADES)',
        criticos: `EXISTENCIAS BAJAS (1 A ${summary.threshold - 1} UNIDADES)`,
        completo: `EXISTENCIA COMPLETA DEL CATÁLOGO (UMBRAL < ${summary.threshold})`,
      };
      await generateRestockPriorityPDF(summary, filteredItems, companyProfile, tabLabels[activeTab]);
      toast({ title: '📄 PDF Ejecutivo de Reposición descargado' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al generar PDF', description: e?.message });
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportExcel = () => {
    try {
      const toRow = (it: typeof summary.items[number], idx: number) => ({
        '#': idx + 1,
        Prioridad: getPriorityLabel(it.priority),
        Estado: it.status === 'agotado' ? 'AGOTADO (0)' : it.status === 'critico' ? `BAJO (<${summary.threshold})` : 'SURTIDO',
        SKU: it.sku,
        Producto: it.name,
        Categoria: it.category,
        Marca: it.brand,
        Ubicacion: it.warehouseLocation,
        'Quedan (Stock)': it.stock,
        'En Transito (OC)': it.inTransit,
        'Faltan para Umbral': it.shortageToThreshold,
        'Total Vendido': it.totalSold,
        Rotacion: getRotationLabel(it.rotationTier),
        'Sugerido Comprar': it.suggestedRestockQty,
        'Costo Unit USD': Number(it.estimatedUnitCostUSD.toFixed(2)),
        'Tipo Costo': it.hasRealCost ? 'WAC Real' : 'Estimado (55% Cash)',
        'Inversion Est USD': Number(it.estimatedInvestmentUSD.toFixed(2)),
        'PVP Base USD': Number(it.price.toFixed(2)),
        'Valor Stock Actual USD': Number(it.stockValuationUSD.toFixed(2)),
      });

      const restockOnly = summary.items.filter((i) => i.status !== 'saludable');
      const wb = XLSX.utils.book_new();

      const sheet1 = XLSX.utils.json_to_sheet(
        restockOnly.map((it, idx) => toRow(it, idx))
      );
      const sheet2 = XLSX.utils.json_to_sheet(
        summary.items
          .filter((i) => i.status === 'agotado' || i.status === 'critico')
          .sort((a, b) => a.stock - b.stock || b.totalSold - a.totalSold)
          .map((it, idx) => toRow(it, idx))
      );
      const sheet3 = XLSX.utils.json_to_sheet(
        summary.items.map((it, idx) => toRow(it, idx))
      );

      XLSX.utils.book_append_sheet(wb, sheet1, '1_Prioridad_Reposicion');
      XLSX.utils.book_append_sheet(wb, sheet2, '2_Agotados_y_Criticos');
      XLSX.utils.book_append_sheet(wb, sheet3, '3_Existencia_Completa');

      XLSX.writeFile(
        wb,
        `Plan_Reposicion_Athleticenter_${format(new Date(), 'yyyy-MM-dd')}.xlsx`
      );
      toast({ title: '📊 Excel Multi-Hoja (.xlsx) exportado correctamente' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al exportar Excel', description: e?.message });
    }
  };

  const handleCopyWhatsAppSummary = async () => {
    const p1Items = summary.items.filter((i) => i.priority === 'P1_URGENTE').slice(0, 12);
    const lines = [
      `📦 *ATHLETICENTER — PLAN DE REPOSICIÓN Y PRIORIDAD (<${summary.threshold} UDS)*`,
      `📅 ${format(new Date(), 'dd/MM/yyyy HH:mm')}`,
      `• Agotados (0 uds): *${summary.outOfStockCount} SKUs*`,
      `• Bajo stock (<${summary.threshold} uds): *${summary.criticalCount} SKUs*`,
      `• Prioridad P1 (Urgente / Alta rotación): *${summary.p1UrgentCount} SKUs*`,
      `• Sugerido total a reponer: *${summary.totalSuggestedUnits.toLocaleString()} uds* (~$${summary.totalEstimatedInvestmentUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })})`,
      '',
      `🔥 *TOP PRIORIDAD P1 (ORDENADO POR MOVIMIENTO REAL):*`,
      ...p1Items.map(
        (it, i) =>
          `${i + 1}. *${it.sku}* — ${it.name}\n   Quedan: *${it.stock}* uds | Vendidos: *${it.totalSold}* | Comprar: *${it.suggestedRestockQty}* uds`
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedSummary(true);
      toast({ title: '📋 Resumen P1 copiado para WhatsApp' });
      setTimeout(() => setCopiedSummary(false), 2500);
    } catch {
      toast({ variant: 'destructive', title: 'No se pudo copiar al portapapeles' });
    }
  };

  const priorityBadgeClass = (p: RestockPriority) => {
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

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] xl:max-w-7xl w-full p-0 rounded-[2rem] overflow-hidden border-none shadow-2xl bg-white flex flex-col max-h-[94vh]">
        {/* HEADER */}
        <DialogHeader className="p-6 sm:p-7 bg-slate-900 text-white shrink-0 relative">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pr-8">
            <div className="flex items-center gap-3.5">
              <div className="h-12 w-12 rounded-2xl bg-rose-500/20 border border-rose-400/30 text-rose-300 flex items-center justify-center shrink-0">
                <Flame className="h-6 w-6" />
              </div>
              <div className="text-left">
                <DialogTitle className="text-lg sm:text-2xl font-black uppercase tracking-tight text-white leading-none">
                  Plan Maestro de Reposición y Existencias
                </DialogTitle>
                <DialogDescription className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-1.5">
                  Qué queda por producto · Agotados y &lt; {summary.threshold} unidades · Prioridad automática según movimiento real
                </DialogDescription>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handleCopyWhatsAppSummary}
                variant="outline"
                className="h-10 px-3.5 rounded-xl bg-white/10 border-white/15 text-white hover:bg-white/20 font-black uppercase text-[10px] tracking-wider"
              >
                {copiedSummary ? <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
                {copiedSummary ? 'Copiado' : 'Copiar Top P1'}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleExportExcel}
                className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-[10px] tracking-wider shadow-lg"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" /> Excel (.xlsx)
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleExportPDF}
                disabled={isExportingPdf}
                className="h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black uppercase text-[10px] tracking-wider shadow-lg"
              >
                {isExportingPdf ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
                PDF Ejecutivo
              </Button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="absolute top-6 right-6 text-white/40 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </DialogHeader>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5 bg-slate-50/60">
          {/* KPI CARDS CLICABLES */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
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
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-rose-600">Prioridad P1 · Urgente</span>
                <Flame className="h-4 w-4 text-rose-600" />
              </div>
              <p className="text-2xl font-black text-slate-900 tracking-tight">{summary.p1UrgentCount} SKUs</p>
              <p className="text-[10px] font-bold text-slate-500 mt-0.5">Alta rotación sin stock o crítico</p>
            </button>

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
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-rose-500">Agotados (0 Uds)</span>
                <PackageX className="h-4 w-4 text-rose-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 tracking-tight">{summary.outOfStockCount} SKUs</p>
              <p className="text-[10px] font-bold text-slate-500 mt-0.5">Faltantes totales hoy</p>
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
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-amber-600">
                  Menos de {summary.threshold} Uds
                </span>
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              </div>
              <p className="text-2xl font-black text-slate-900 tracking-tight">{summary.criticalCount} SKUs</p>
              <p className="text-[10px] font-bold text-slate-500 mt-0.5">
                1 a {summary.threshold - 1} unidades disponibles
              </p>
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
                  ? 'ring-2 ring-emerald-600 border-emerald-200 bg-emerald-50/30'
                  : 'border-slate-200/80'
              )}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600">
                  Existencia Total Catálogo
                </span>
                <PackageCheck className="h-4 w-4 text-emerald-600" />
              </div>
              <p className="text-2xl font-black text-slate-900 tracking-tight">
                {summary.totalStockUnits.toLocaleString()} uds
              </p>
              <p className="text-[10px] font-bold text-slate-500 mt-0.5">
                {summary.healthyCount} SKUs con ≥{summary.threshold} uds · ${summary.totalStockValuationUSD.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </p>
            </button>
          </div>

          {/* TABS + UMBRAL + FILTROS */}
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
                    Plan Reposición ({summary.needsRestockCount})
                  </TabsTrigger>
                  <TabsTrigger value="agotados" className="text-[10px] font-black uppercase py-2 px-3 rounded-lg">
                    Agotados ({summary.outOfStockCount})
                  </TabsTrigger>
                  <TabsTrigger value="criticos" className="text-[10px] font-black uppercase py-2 px-3 rounded-lg">
                    &lt;{summary.threshold} Uds ({summary.criticalCount})
                  </TabsTrigger>
                  <TabsTrigger value="completo" className="text-[10px] font-black uppercase py-2 px-3 rounded-lg">
                    Todo ({summary.totalProducts})
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {/* CONTROL DE UMBRAL */}
              <div className="flex flex-wrap items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200/80">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                  Mínimo alerta:
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
                    &lt;{preset}
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
                  placeholder="Buscar producto, SKU, marca..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-10 pl-9 rounded-xl bg-slate-50 border-slate-200 text-xs font-bold"
                />
              </div>

              <div className="lg:col-span-2">
                <Select value={priorityFilter} onValueChange={(v: any) => setPriorityFilter(v)}>
                  <SelectTrigger className="h-10 rounded-xl bg-slate-50 border-slate-200 text-[11px] font-black uppercase">
                    <SelectValue placeholder="Prioridad" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs font-bold">TODAS LAS PRIORIDADES</SelectItem>
                    <SelectItem value="P1_URGENTE" className="text-xs font-bold text-rose-600">P1 · URGENTE</SelectItem>
                    <SelectItem value="P2_ALTA" className="text-xs font-bold text-orange-600">P2 · ALTA</SelectItem>
                    <SelectItem value="P3_MEDIA" className="text-xs font-bold text-amber-600">P3 · MEDIA</SelectItem>
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
                    <SelectItem value="priority" className="text-xs font-bold">PRIORIDAD + ROTACIÓN</SelectItem>
                    <SelectItem value="most_sold" className="text-xs font-bold">MÁS VENDIDOS PRIMERO</SelectItem>
                    <SelectItem value="lowest_stock" className="text-xs font-bold">MENOR EXISTENCIA PRIMERO</SelectItem>
                    <SelectItem value="investment" className="text-xs font-bold">MAYOR INVERSIÓN EST.</SelectItem>
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

          {/* TABLA PRINCIPAL */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
            <div className="overflow-auto max-h-[45vh]">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-900 text-white text-[9px] font-black uppercase tracking-wider">
                  <tr>
                    <th className="p-3.5">Prioridad</th>
                    <th className="p-3.5">Producto &amp; SKU</th>
                    <th className="p-3.5 text-center">Quedan (Stock)</th>
                    <th className="p-3.5 text-center">Faltan (&lt;{summary.threshold})</th>
                    <th className="p-3.5 text-center">Vendidos / Rotación</th>
                    <th className="p-3.5 text-center">Sugerido Comprar</th>
                    <th className="p-3.5 text-right">Inversión Est.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400 font-bold uppercase text-xs">
                        No hay productos que coincidan con los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((it) => (
                      <tr key={it.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3 whitespace-nowrap">
                          <Badge className={cn('text-[9px] font-black uppercase', priorityBadgeClass(it.priority))}>
                            {getPriorityLabel(it.priority)}
                          </Badge>
                        </td>
                        <td className="p-3 max-w-[290px]">
                          <p className="font-black text-slate-900 uppercase leading-tight truncate" title={it.name}>
                            {it.name}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="text-[10px] font-mono font-bold text-slate-500">{it.sku}</span>
                            <span className="text-[9px] font-bold uppercase text-slate-400">· {it.category}</span>
                            {it.lowSizes.length > 0 && (
                              <Badge variant="outline" className="text-[8px] font-black border-amber-300 bg-amber-50 text-amber-800 px-1.5 py-0">
                                Tallas bajas: {it.lowSizes.slice(0, 3).join(', ')}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-center whitespace-nowrap">
                          <div className="inline-flex flex-col items-center gap-1">
                            <Badge
                              className={cn(
                                'font-black text-[10px] border-none',
                                it.stock <= 0
                                  ? 'bg-rose-100 text-rose-700'
                                  : it.stock < summary.threshold
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-emerald-100 text-emerald-700'
                              )}
                            >
                              {it.stock} uds
                            </Badge>
                            {it.inTransit > 0 && (
                              <Badge className="bg-blue-50 text-blue-700 border border-blue-200 text-[8px] font-black">
                                +{it.inTransit} tráns.
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-center whitespace-nowrap font-mono font-black">
                          {it.shortageToThreshold > 0 ? (
                            <span className="text-rose-600">-{it.shortageToThreshold}</span>
                          ) : (
                            <span className="text-emerald-600">0</span>
                          )}
                        </td>
                        <td className="p-3 text-center whitespace-nowrap">
                          <div className="inline-flex flex-col items-center gap-1">
                            <span className="font-black text-slate-900 flex items-center gap-1">
                              <TrendingUp className="h-3 w-3 text-primary" /> {it.totalSold}
                            </span>
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[8px] font-black uppercase px-1.5 py-0',
                                it.rotationTier === 'ALTA'
                                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                                  : it.rotationTier === 'MEDIA'
                                    ? 'border-sky-200 bg-sky-50 text-sky-700'
                                    : 'border-slate-200 text-slate-500'
                              )}
                            >
                              {getRotationLabel(it.rotationTier)}
                            </Badge>
                          </div>
                        </td>
                        <td className="p-3 text-center whitespace-nowrap">
                          {it.suggestedRestockQty > 0 ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-black text-xs">
                              {it.suggestedRestockQty} uds
                            </span>
                          ) : (
                            <span className="text-slate-400 font-bold text-[10px]">—</span>
                          )}
                        </td>
                        <td className="p-3 text-right whitespace-nowrap font-mono font-black text-slate-900">
                          {it.suggestedRestockQty > 0 ? (
                            <span title={it.hasRealCost ? 'Costo WAC real' : 'Estimado (55% del PVP Cash)'}>
                              ${it.estimatedInvestmentUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              {!it.hasRealCost && <span className="text-amber-600 ml-0.5">*</span>}
                            </span>
                          ) : (
                            <span className="text-slate-400">$0.00</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* FOOTER TOTALES */}
        <DialogFooter className="p-4 sm:p-5 bg-white border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-4 text-[11px] font-bold text-slate-600">
            <span>
              Mostrando: <strong className="text-slate-900">{filteredItems.length} SKUs</strong>
            </span>
            <span>
              Stock actual vista: <strong className="text-slate-900">{viewTotals.currentStock.toLocaleString()} uds</strong>
            </span>
            <span>
              Sugerido comprar: <strong className="text-blue-700">{viewTotals.suggestedUnits.toLocaleString()} uds</strong>
            </span>
            <span>
              Inversión est.: <strong className="text-emerald-700">${viewTotals.investmentUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
            </span>
            <span className="text-[9px] text-slate-400 uppercase">* Costo estimado si no hay costo WAC</span>
          </div>
          <Button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-10 px-6 rounded-xl font-black text-xs uppercase bg-slate-900 text-white"
          >
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
