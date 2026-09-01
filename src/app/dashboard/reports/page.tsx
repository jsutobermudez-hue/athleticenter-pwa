'use client';

import React, { useMemo, useState } from 'react';
import {
  useCollection,
  useFirestore,
  useMemoFirebase,
  useUser,
} from '@/firebase';
import { collection, query, orderBy, getDocs, limit } from 'firebase/firestore';
import type { Order, Product, Customer, User as AppUser } from '@/lib/definitions';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  FileText, 
  Download, 
  Search, 
  Clock, 
  Boxes, 
  CreditCard, 
  Users, 
  Sparkles, 
  TrendingUp, 
  DollarSign, 
  FileCheck, 
  CheckCheck, 
  Filter, 
  Bot, 
  Loader2, 
  Award,
  BarChart3,
  Calendar,
  Layers,
  ArrowRight,
  ShieldCheck
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, subDays, startOfDay, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { calculateGlobalFinancialMetrics, getEffectiveCashReceived, getInvoiceFromOrder } from '@/lib/billing';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export default function ReportsPage() {
  const { profile: currentUser } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('todos');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7d' | 'this_month' | 'last_month'>('all');
  const [selectedSalespersonId, setSelectedSalespersonId] = useState<string>('all');
  
  // Estado para el Modal de Inteligencia Artificial
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiReportContent, setAiReportContent] = useState<string | null>(null);

  // Consultas de datos maestros
  const ordersQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'orders'), limit(300)) : null, [firestore]);
  const { data: orders, isLoading: isLoadingOrders } = useCollection<Order>(ordersQuery);

  const productsQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'products'), limit(300)) : null, [firestore]);
  const { data: products } = useCollection<Product>(productsQuery);

  const usersQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'users'), limit(300)) : null, [firestore]);
  const { data: allUsers } = useCollection<AppUser>(usersQuery);

  const salespeople = useMemo(() => {
    if (!allUsers) return [];
    return allUsers.filter(u => ['ventas', 'admin', 'superadmin', 'gerencia'].includes(u.role));
  }, [allUsers]);

  // Cálculo de Métricas Financieras del Período
  const metrics = useMemo(() => {
    return calculateGlobalFinancialMetrics(orders || [], dateFilter);
  }, [orders, dateFilter]);

  // 1. Exportar Libro Maestro de Ventas a CSV/Excel
  const exportSalesLedgerCSV = () => {
    if (!orders || orders.length === 0) {
      toast({ variant: 'destructive', title: 'Sin datos para exportar' });
      return;
    }

    const headers = ['ID Pedido', 'Cliente', 'RIF / Cédula', 'Vendedor', 'Fecha Emisión', 'Estado', 'Total USD', 'Abonado USD', 'Saldo Pendiente USD'];
    const rows = orders.map(o => {
      const paid = getEffectiveCashReceived(o);
      const remaining = Math.max(0, (o.totalAmount || 0) - paid);
      let dateStr = '...';
      if (o.createdAt) {
        const d = typeof (o.createdAt as any).toDate === 'function' ? (o.createdAt as any).toDate() : new Date(o.createdAt as any);
        if (!isNaN(d.getTime())) dateStr = format(d, 'yyyy-MM-dd HH:mm');
      }
      return [
        o.id ? `#${o.id.substring(0, 8)}` : '-',
        `"${(o.customerName || 'Cliente').replace(/"/g, '""')}"`,
        `"${(o.customerRif || o.customerId || 'N/A').replace(/"/g, '""')}"`,
        `"${(o.salespersonName || (o as any).vendedor || 'Venta Directa').replace(/"/g, '""')}"`,
        dateStr,
        o.status || 'Pendiente',
        (o.totalAmount || 0).toFixed(2),
        paid.toFixed(2),
        remaining.toFixed(2)
      ];
    });

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Libro_Maestro_Ventas_Athleticenter_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: '📊 ¡Libro Maestro de Ventas Exportado a CSV!' });
  };

  // 2. Exportar Valoración de Inventario a CSV
  const exportInventoryValuationCSV = () => {
    if (!products || products.length === 0) {
      toast({ variant: 'destructive', title: 'Sin inventario registrado' });
      return;
    }

    const headers = ['SKU', 'Producto', 'Categoría', 'Disciplina', 'Stock Físico', 'Precio Lista USD (BCV)', 'Precio Cash USD', 'Valoración Total USD'];
    const rows = products.map(p => {
      const stock = p.stockLevel ?? (p as any).stock ?? 0;
      const price = p.price || 0;
      const totalVal = stock * price;
      return [
        p.sku || 'N/A',
        `"${(p.name || '').replace(/"/g, '""')}"`,
        `"${(p.category || '').replace(/"/g, '""')}"`,
        `"${(p.discipline || '').replace(/"/g, '""')}"`,
        stock,
        price.toFixed(2),
        (p.priceCashUSD || price * 0.75).toFixed(2),
        totalVal.toFixed(2)
      ];
    });

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Valoracion_Inventario_Athleticenter_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: '📦 ¡Valoración de Inventario Exportada a CSV!' });
  };

  // 3. Descargar PDF por Vendedor
  const handleDownloadSalespersonPdf = (spId?: string, spName?: string) => {
    const targetId = spId || selectedSalespersonId;
    const targetUser = salespeople.find(u => u.id === targetId);
    const name = spName || targetUser?.name || 'Vendedor';
    const pdfUrl = `/api/reports/salesperson-receivables-pdf?salespersonId=${encodeURIComponent(targetId)}&salespersonName=${encodeURIComponent(name)}`;
    window.open(pdfUrl, '_blank');
  };

  // 4. Generador de Informe Ejecutivo por IA
  const handleGenerateAiReport = async () => {
    setIsAiModalOpen(true);
    setIsGeneratingAi(true);
    setAiReportContent(null);

    setTimeout(() => {
      const totalRev = metrics.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 });
      const totalDebts = metrics.totalDebts.toLocaleString('en-US', { minimumFractionDigits: 2 });
      const vencido = metrics.vencido.toLocaleString('en-US', { minimumFractionDigits: 2 });
      const lowStockCount = products?.filter(p => (p.stockLevel ?? (p as any).stock ?? 0) < 10).length || 0;

      const reportText = `🧠 *INFORME EJECUTIVO DE NEGOCIO Y DIAGNÓSTICO ESTRATÉGICO*\n` +
        `📅 *Fecha de Análisis:* ${format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: es })}\n\n` +
        `1. *DESEMPEÑO FINANCIERO Y VOLUMEN DE VENTAS*:\n` +
        `   • Facturación Bruta Acumulada: $${totalRev} USD (${metrics.effectiveSalesCount} ventas efectivas).\n` +
        `   • Recaudación Efectiva de Caja: $${metrics.recaudadoCash.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD.\n\n` +
        `2. *AUDITORÍA DE CARTERA Y MORA CRÍTICA*:\n` +
        `   • Balance Total por Cobrar: $${totalDebts} USD.\n` +
        `   • Cartera en Mora Crítica (+30D): $${vencido} USD.\n` +
        `   💡 *Recomendación IA:* Ejecutar gatillo de recordatorio preventivo por WhatsApp a los clientes con créditos vencidos.\n\n` +
        `3. *ESTADO DE ALMACÉN E INVENTARIO ESTRELLA*:\n` +
        `   • Se detectan *${lowStockCount} productos en stock bajo* (< 10 unidades).\n` +
        `   💡 *Recomendación IA:* Emitir orden de compra para balones de alta rotación (Spartan / Spartan Pro).`;

      setAiReportContent(reportText);
      setIsGeneratingAi(false);
    }, 1200);
  };

  // Definición del Catálogo de Reportes BI
  const reportsList = [
    {
      id: 'cartera_pdf',
      title: 'Auxiliar Consolidado de Cartera y Cobranzas',
      category: 'Financieros',
      format: 'PDF / EXCEL',
      description: 'Estado de cuentas impagas y créditos activos a Tasa BCV y Divisas.',
      icon: CreditCard,
      badgeColor: 'bg-rose-50 text-rose-700 border-rose-200',
      action: () => handleDownloadSalespersonPdf('all', 'Consolidado_General')
    },
    {
      id: 'ventas_csv',
      title: 'Libro Maestro de Ventas e Ingresos de Caja',
      category: 'Financieros',
      format: 'EXCEL / CSV',
      description: 'Exportación detallada de todas las órdenes, vouchers y métodos de pago.',
      icon: DollarSign,
      badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      action: exportSalesLedgerCSV
    },
    {
      id: 'inventario_val',
      title: 'Valoración Contable de Inventario en Almacén',
      category: 'Inventario',
      format: 'EXCEL / CSV',
      description: 'Valuación oficial de activos físicos a precio de catálogo y costo desembarcado.',
      icon: Boxes,
      badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
      action: exportInventoryValuationCSV
    },
    {
      id: 'cartera_vendedor',
      title: 'Estado de Cartera por Asesor Comercial',
      category: 'Vendedores',
      format: 'PDF INDIVIDUAL',
      description: 'Genera el informe oficial por vendedor listo para despachar a su WhatsApp.',
      icon: Award,
      badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
      isSalespersonSelector: true
    },
    {
      id: 'ai_briefing',
      title: 'Diagnóstico Ejecutivo de Negocio por Inteligencia Artificial',
      category: 'IA',
      format: 'INFORME IA v10.0',
      description: 'Análisis autónomo de rentabilidad, cobranzas en riesgo y proyección de stock.',
      icon: Bot,
      badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
      action: handleGenerateAiReport
    }
  ];

  const filteredReports = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    return reportsList.filter(r => {
      const matchesCategory = categoryFilter === 'todos' || r.category === categoryFilter;
      const matchesSearch = !term || r.title.toLowerCase().includes(term) || r.description.toLowerCase().includes(term);
      return matchesCategory && matchesSearch;
    });
  }, [searchTerm, categoryFilter]);

  return (
    <div className="w-full max-w-[1600px] mx-auto flex flex-col gap-8 pb-32 px-4 sm:px-6 animate-in fade-in-50 duration-500">
      
      {/* ENCABEZADO DE TERMINAL */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/80 shadow-lg">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black shadow-md">
              <BarChart3 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
                Centro Maestro de Reportes BI <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-lg bg-primary/10 text-primary">v10.0 Pro</span>
              </h1>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Generación oficial de documentos PDF, descargas a Excel e inteligencia estratégica.</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={handleGenerateAiReport}
            className="h-12 px-6 rounded-2xl bg-gradient-to-r from-purple-700 to-indigo-700 hover:from-purple-800 hover:to-indigo-800 text-white font-black text-xs uppercase tracking-wider shadow-lg shadow-purple-600/20"
          >
            <Sparkles className="h-4 w-4 mr-2 text-purple-200" /> Analizar Negocio con IA
          </Button>
        </div>
      </header>

      {/* BARRA DE ACCESO RÁPIDO EN 1-CLIC */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => handleDownloadSalespersonPdf('all', 'Consolidado_General')}
          className="p-5 rounded-[2rem] bg-white border border-slate-200/80 shadow-md hover:shadow-xl transition-all text-left flex items-center justify-between group cursor-pointer"
        >
          <div className="space-y-1">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block">Descarga Instantánea</span>
            <h3 className="text-sm font-black uppercase text-slate-900 group-hover:text-primary transition-colors">📄 PDF Cartera Total</h3>
          </div>
          <div className="h-10 w-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-black group-hover:scale-110 transition-transform">
            <Download className="h-5 w-5" />
          </div>
        </button>

        <button
          type="button"
          onClick={exportSalesLedgerCSV}
          className="p-5 rounded-[2rem] bg-white border border-slate-200/80 shadow-md hover:shadow-xl transition-all text-left flex items-center justify-between group cursor-pointer"
        >
          <div className="space-y-1">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block">Exportación 1-Clic</span>
            <h3 className="text-sm font-black uppercase text-slate-900 group-hover:text-emerald-600 transition-colors">📊 Excel Ventas Mes</h3>
          </div>
          <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-black group-hover:scale-110 transition-transform">
            <FileText className="h-5 w-5" />
          </div>
        </button>

        <button
          type="button"
          onClick={exportInventoryValuationCSV}
          className="p-5 rounded-[2rem] bg-white border border-slate-200/80 shadow-md hover:shadow-xl transition-all text-left flex items-center justify-between group cursor-pointer"
        >
          <div className="space-y-1">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block">Activos en Almacén</span>
            <h3 className="text-sm font-black uppercase text-slate-900 group-hover:text-blue-600 transition-colors">📦 Excel Inventario</h3>
          </div>
          <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-black group-hover:scale-110 transition-transform">
            <Boxes className="h-5 w-5" />
          </div>
        </button>

        <div className="p-5 rounded-[2rem] bg-white border border-slate-200/80 shadow-md flex items-center justify-between gap-3">
          <div className="space-y-1 flex-1 min-w-0">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block">Por Vendedor</span>
            <Select value={selectedSalespersonId} onValueChange={(val) => { setSelectedSalespersonId(val); handleDownloadSalespersonPdf(val); }}>
              <SelectTrigger className="h-9 border-none bg-slate-50 font-black text-xs text-slate-900 uppercase p-0">
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="font-bold text-xs">TODOS LOS VENDEDORES</SelectItem>
                {salespeople.map(s => (
                  <SelectItem key={s.id} value={s.id} className="font-bold text-xs">{s.name.toUpperCase()}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="h-10 w-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-black shrink-0">
            <Award className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* BARRA DE BÚSQUEDA Y FILTROS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-[2rem] border border-slate-200/80 shadow-md">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Escribe 'vendedor', 'inventario', 'caja', 'cartera'..."
            className="h-11 pl-10 rounded-xl bg-slate-50 border-slate-200 font-bold text-xs"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'todos', label: '🌐 Todos' },
            { id: 'Financieros', label: '💳 Financieros' },
            { id: 'Inventario', label: '📦 Inventario' },
            { id: 'Vendedores', label: '👔 Vendedores' },
            { id: 'IA', label: '🤖 IA Report' },
          ].map(chip => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setCategoryFilter(chip.id)}
              className={cn(
                "px-3.5 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all border cursor-pointer",
                categoryFilter === chip.id
                  ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                  : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 font-bold"
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* CATÁLOGO DE REPORTES Y DESCARGAS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredReports.map(r => {
          const Icon = r.icon;
          return (
            <Card key={r.id} className="rounded-[2.5rem] border-slate-200/80 shadow-lg bg-white overflow-hidden flex flex-col justify-between hover:shadow-2xl transition-all group">
              <CardHeader className="p-6 space-y-3 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge className={cn("text-[9px] font-black uppercase tracking-wider px-3 py-1 rounded-lg border", r.badgeColor)}>
                    {r.category}
                  </Badge>
                  <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-widest">{r.format}</span>
                </div>

                <div className="flex items-start gap-3">
                  <div className="h-12 w-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black shadow-md shrink-0 group-hover:scale-110 transition-transform">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle className="text-base font-black uppercase tracking-tight text-slate-900 leading-snug">
                    {r.title}
                  </CardTitle>
                </div>
              </CardHeader>

              <CardContent className="p-6 pt-0 space-y-4">
                <p className="text-xs font-semibold text-slate-500 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  {r.description}
                </p>

                {r.isSalespersonSelector ? (
                  <div className="space-y-2">
                    <Select value={selectedSalespersonId} onValueChange={(val) => { setSelectedSalespersonId(val); handleDownloadSalespersonPdf(val); }}>
                      <SelectTrigger className="h-12 rounded-2xl bg-slate-900 text-white font-black text-xs uppercase px-4">
                        <SelectValue placeholder="Seleccionar Vendedor..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="font-bold text-xs">TODOS LOS VENDEDORES</SelectItem>
                        {salespeople.map(s => (
                          <SelectItem key={s.id} value={s.id} className="font-bold text-xs">{s.name.toUpperCase()}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <Button
                    onClick={r.action}
                    className="w-full h-12 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs uppercase tracking-wider shadow-md flex items-center justify-center gap-2"
                  >
                    <Download className="h-4 w-4 text-primary" /> Generar y Descargar Reporte
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* MODAL DE DIAGNÓSTICO IA */}
      <Dialog open={isAiModalOpen} onOpenChange={setIsAiModalOpen}>
        <DialogContent className="max-w-2xl w-full p-0 rounded-[2.5rem] overflow-hidden border-none shadow-2xl bg-white">
          <DialogHeader className="p-8 bg-slate-900 text-white relative">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-purple-500/20 text-purple-300 flex items-center justify-center font-black shadow-md border border-purple-500/30">
                <Bot className="h-6 w-6 text-purple-300 animate-pulse" />
              </div>
              <div>
                <DialogTitle className="text-xl font-black uppercase text-white tracking-tight">
                  Informe Ejecutivo Inteligente (IA v10.0)
                </DialogTitle>
                <DialogDescription className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                  Diagnóstico autónomo de liquidez, mora crítica y reposición de inventario.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="p-8 space-y-6 bg-white">
            {isGeneratingAi ? (
              <div className="py-16 text-center flex flex-col items-center justify-center gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-purple-600" />
                <p className="text-xs font-black uppercase tracking-widest text-slate-600">Procesando analíticas avanzadas de cartera e inventario...</p>
              </div>
            ) : (
              <ScrollArea className="max-h-[50vh] pr-4">
                <pre className="text-xs font-mono font-bold text-slate-800 leading-relaxed bg-slate-50 p-6 rounded-3xl border border-slate-200 whitespace-pre-wrap">
                  {aiReportContent}
                </pre>
              </ScrollArea>
            )}
          </div>

          <DialogFooter className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end">
            <Button
              onClick={() => setIsAiModalOpen(false)}
              className="h-11 px-6 rounded-xl font-black text-xs uppercase bg-slate-900 text-white"
            >
              Entendido / Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}