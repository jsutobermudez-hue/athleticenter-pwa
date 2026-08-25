'use client';

import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import type { Order } from '@/lib/definitions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
    ShoppingCart, 
    Eye, 
    Search, 
    Filter, 
    FileText, 
    Printer, 
    CheckCircle2, 
    Clock, 
    Package, 
    Truck, 
    AlertCircle,
    ArrowUpRight,
    Loader2
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { OrderSheetController } from '@/app/dashboard/orders/OrderSheetController';
import { cn } from '@/lib/utils';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';

import { doc } from 'firebase/firestore';
import { useDoc, useFirestore, useMemoFirebase } from '@/firebase';
import { captureSvgAsPng } from '@/lib/chart-pdf-exporter';
import type { FinancialSettings } from '@/lib/definitions';

interface OrderStatusChartProps {
  orders: Order[] | null;
  isLoading?: boolean;
}

const COLORS: { [key: string]: string } = {
  'Pagados': '#10b981',          // Emerald Green
  'En Preparación': '#2563eb',   // Primary Blue Athleticenter
  'Despachados': '#6366f1',      // Indigo
  'En Verificación': '#0284c7',  // Sky Blue
  'Pendientes': '#f59e0b',       // Warm Amber
  'Cancelados': '#ef4444',       // Crimson Red
};

export function OrderStatusChart({ orders, isLoading = false }: OrderStatusChartProps) {
  const firestore = useFirestore();
  const settingsRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
  const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);
  const bcvRate = globalSettings?.bcvRate || 65.50;

  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrderForSheet, setSelectedOrderForSheet] = useState<Order | null>(null);
  const [activeTab, setActiveTab] = useState<'chart' | 'funnel'>('chart');
  const [isExportingPDF, setIsExportingPDF] = useState(false);

  // Clasificación por embudo operativo
  const funnelData = useMemo(() => {
    if (!orders) return { verification: [], warehouse: [], transit: [], completed: [], pending: [], cancelled: [] };

    const verification: Order[] = [];
    const warehouse: Order[] = [];
    const transit: Order[] = [];
    const completed: Order[] = [];
    const pending: Order[] = [];
    const cancelled: Order[] = [];

    orders.forEach(order => {
      if (['En Verificación'].includes(order.status)) {
        verification.push(order);
      } else if (['Aprobado', 'En Preparación'].includes(order.status)) {
        warehouse.push(order);
      } else if (['Despachado'].includes(order.status)) {
        transit.push(order);
      } else if (['Completado', 'Pagado', 'Entregado'].includes(order.status)) {
        completed.push(order);
      } else if (['Cancelado', 'Rechazado'].includes(order.status)) {
        cancelled.push(order);
      } else {
        pending.push(order);
      }
    });

    return { verification, warehouse, transit, completed, pending, cancelled };
  }, [orders]);

  const chartData = useMemo(() => {
    if (!orders) return [];
    const totalCount = orders.length || 1;

    return [
      { name: 'Pagados / Liquidados', value: funnelData.completed.length, orders: funnelData.completed, color: COLORS['Pagados'], percent: Math.round((funnelData.completed.length / totalCount) * 100) },
      { name: 'En Almacén / Empaque', value: funnelData.warehouse.length, orders: funnelData.warehouse, color: COLORS['En Preparación'], percent: Math.round((funnelData.warehouse.length / totalCount) * 100) },
      { name: 'En Ruta / Despachados', value: funnelData.transit.length, orders: funnelData.transit, color: COLORS['Despachados'], percent: Math.round((funnelData.transit.length / totalCount) * 100) },
      { name: 'Verificación de Pago', value: funnelData.verification.length, orders: funnelData.verification, color: COLORS['En Verificación'], percent: Math.round((funnelData.verification.length / totalCount) * 100) },
      { name: 'Por Aprobar / Pendientes', value: funnelData.pending.length, orders: funnelData.pending, color: COLORS['Pendientes'], percent: Math.round((funnelData.pending.length / totalCount) * 100) },
      { name: 'Cancelados / Anulados', value: funnelData.cancelled.length, orders: funnelData.cancelled, color: COLORS['Cancelados'], percent: Math.round((funnelData.cancelled.length / totalCount) * 100) },
    ].filter(item => item.value > 0);
  }, [orders, funnelData]);

  const totalRevenueUSD = useMemo(() => {
    if (!orders) return 0;
    return orders
      .filter(o => o.status !== 'Cancelado' && o.status !== 'Rechazado')
      .reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  }, [orders]);

  const openStatusAudit = (statusName: string) => {
    setSelectedStatusFilter(statusName);
    setIsModalOpen(true);
  };

  const filteredOrdersForModal = useMemo(() => {
    if (!orders || !selectedStatusFilter) return orders || [];
    const targetBucket = chartData.find(c => c.name === selectedStatusFilter);
    if (targetBucket && targetBucket.orders && targetBucket.orders.length > 0) {
      return targetBucket.orders;
    }
    if (selectedStatusFilter.includes('Pagados') || selectedStatusFilter === 'Completado') {
      return orders.filter(o => ['Pagado', 'Completado', 'Entregado'].includes(o.status));
    }
    if (selectedStatusFilter.includes('Almacén') || selectedStatusFilter === 'En Preparación') {
      return orders.filter(o => ['Aprobado', 'En Preparación'].includes(o.status));
    }
    if (selectedStatusFilter.includes('Despachados') || selectedStatusFilter === 'Despachado') {
      return orders.filter(o => ['Despachado'].includes(o.status));
    }
    if (selectedStatusFilter.includes('Verificación')) {
      return orders.filter(o => ['En Verificación'].includes(o.status));
    }
    if (selectedStatusFilter.includes('Cancelados') || selectedStatusFilter === 'Cancelado') {
      return orders.filter(o => ['Cancelado', 'Rechazado'].includes(o.status));
    }
    return orders.filter(o => ['Pendiente', 'Borrador'].includes(o.status));
  }, [orders, selectedStatusFilter, chartData]);

  // Generador e Impresor de Reportes PDF Oficiales
  const handleExportPDF = async (filterTargetName?: string) => {
    setIsExportingPDF(true);
    try {
      const targetOrders = filterTargetName ? filteredOrdersForModal : (orders || []);
      const reportTitle = filterTargetName 
        ? `REPORTE DE PEDIDOS: ${filterTargetName.toUpperCase()}`
        : 'INFORME EJECUTIVO DE DISTRIBUCIÓN Y ESTADO DE PEDIDOS';

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      // Encabezado Slate-900
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, 210, 32, 'F');

      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text('ATHLETICENTER PRO C.A.', 14, 16);

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text(reportTitle, 14, 23);
      doc.text(`TASA OFICIAL BCV: Bs. ${bcvRate.toFixed(2)} / USD`, 14, 28);

      // Cajas de KPIs
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(14, 38, 58, 20, 3, 3, 'F');
      doc.roundedRect(76, 38, 58, 20, 3, 3, 'F');
      doc.roundedRect(138, 38, 58, 20, 3, 3, 'F');

      const sumUSD = targetOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('TOTAL EXPEDIENTES', 18, 43);
      doc.setFontSize(12);
      doc.text(`${targetOrders.length}`, 18, 52);

      doc.setFontSize(7);
      doc.setTextColor(16, 185, 129);
      doc.text('VOLUMEN FACTURADO ($)', 80, 43);
      doc.setFontSize(12);
      doc.text(`$${sumUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 80, 52);

      doc.setFontSize(7);
      doc.setTextColor(99, 102, 241);
      doc.text('EQUIVALENTE BCV (Bs)', 142, 43);
      doc.setFontSize(10);
      doc.text(`Bs. ${(sumUSD * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`, 142, 52);

      // Captura e Inserción del Gráfico Visual si está disponible
      const chartImage = await captureSvgAsPng('order-status-chart-container');
      let tableStartY = 64;

      if (chartImage && !filterTargetName) {
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(71, 85, 105);
        doc.text('REPRESENTACIÓN GRÁFICA DE DISTRIBUCIÓN:', 14, 63);

        doc.addImage(chartImage, 'PNG', 14, 66, 182, 55);
        tableStartY = 126;
      }

      // Filas para la tabla
      const tableRows = targetOrders.map(o => [
        `#${o.id?.slice(0, 8)}`,
        o.customerName || 'Cliente General',
        o.salespersonName || 'Directo',
        o.status,
        `$${(o.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        `Bs. ${((o.totalAmount || 0) * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`
      ]);

      autoTable(doc, {
        startY: tableStartY,
        head: [['Nº PEDIDO', 'CLIENTE / RAZÓN SOCIAL', 'VENDEDOR', 'ESTADO LOGÍSTICO', 'MONTO ($ USD)', 'MONTO (Bs. BCV)']],
        body: tableRows.length > 0 ? tableRows : [['-', 'Sin pedidos en este filtro', '-', '-', '$0.00', 'Bs. 0.00']],
        styles: { fontSize: 8, cellPadding: 3, font: 'helvetica' },
        headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 24 },
          1: { cellWidth: 55 },
          2: { cellWidth: 30 },
          3: { fontStyle: 'bold', cellWidth: 30 },
          4: { halign: 'right', fontStyle: 'bold', textColor: [16, 185, 129] },
          5: { halign: 'right', fontStyle: 'bold' }
        }
      });

      const pageCount = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184);
        doc.text(`Athleticenter PRO C.A. • Reporte de Distribución de Pedidos • Página ${i} de ${pageCount}`, 14, 287);
      }

      doc.autoPrint();
      const pdfBlob = doc.output('bloburl');
      window.open(pdfBlob, '_blank');

    } catch (e: any) {
      console.error('Error generando PDF de reporte:', e);
    } finally {
      setIsExportingPDF(false);
    }
  };

  if (isLoading || !orders) {
    return (
      <Card className="border-none shadow-xl rounded-[2.5rem] bg-white h-[350px] flex items-center justify-center">
        <div className="text-center space-y-4">
          <ShoppingCart className="h-10 w-10 text-slate-300 animate-bounce mx-auto" />
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Analizando Cola Operativa...</p>
        </div>
      </Card>
    );
  }

  const totalOrders = orders.length;

  return (
    <Card className="border-none shadow-xl rounded-[2.5rem] bg-white overflow-hidden relative group h-full flex flex-col justify-between">
      <CardHeader className="p-8 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-primary" /> Distribución & Embudo Operativo
            </CardTitle>
          </div>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
            Monitor táctico de cola de trabajo y cuellos de botella
          </p>
        </div>

        {/* PESTAÑAS Y BOTÓN DE IMPRESIÓN PDF */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="bg-slate-100 p-1 rounded-2xl flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('chart')}
              className={cn(
                "px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all",
                activeTab === 'chart' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
              )}
            >
              📊 Gráfico
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('funnel')}
              className={cn(
                "px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all",
                activeTab === 'funnel' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
              )}
            >
              ⚡ Embudo
            </button>
          </div>

          <Button
            onClick={() => handleExportPDF()}
            disabled={isExportingPDF}
            variant="outline"
            className="h-8 px-2.5 rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50 font-black text-[8px] sm:text-[9px] uppercase tracking-wider flex items-center gap-1 shadow-sm shrink-0"
            title="Imprimir Gráfico Visual y Reporte PDF"
          >
            {isExportingPDF ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5 text-primary" />}
            <span className="truncate">Reporte PDF</span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-6 pb-6 pt-0 flex flex-col items-center justify-center flex-1 space-y-4">
        {activeTab === 'funnel' ? (
          /* EMBUDO TÁCTICO DE TRABAJO EN TIEMPO REAL */
          <div className="w-full space-y-3 pt-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div 
                onClick={() => openStatusAudit('Verificación de Pago')}
                className="bg-cyan-50 border border-cyan-100 hover:border-cyan-300 p-3.5 rounded-2xl cursor-pointer transition-all space-y-1 group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[8px] font-black uppercase tracking-widest text-cyan-700 flex items-center gap-1">
                    <Clock className="h-3 w-3 text-cyan-600" /> Verificación
                  </span>
                  <Badge className="bg-cyan-600 text-white text-[8px] font-black px-1.5 py-0 rounded-lg">
                    {funnelData.verification.length}
                  </Badge>
                </div>
                <div className="text-sm font-black text-cyan-900 tracking-tight">
                  ${funnelData.verification.reduce((sum, o) => sum + (o.totalAmount || 0), 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </div>
                <p className="text-[8px] font-bold text-cyan-600 uppercase">Abonos por conciliar</p>
              </div>

              <div 
                onClick={() => openStatusAudit('En Almacén / Empaque')}
                className="bg-blue-50 border border-blue-100 hover:border-blue-300 p-3.5 rounded-2xl cursor-pointer transition-all space-y-1 group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[8px] font-black uppercase tracking-widest text-blue-700 flex items-center gap-1">
                    <Package className="h-3 w-3 text-blue-600" /> En Almacén
                  </span>
                  <Badge className="bg-blue-600 text-white text-[8px] font-black px-1.5 py-0 rounded-lg">
                    {funnelData.warehouse.length}
                  </Badge>
                </div>
                <div className="text-sm font-black text-blue-900 tracking-tight">
                  ${funnelData.warehouse.reduce((sum, o) => sum + (o.totalAmount || 0), 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </div>
                <p className="text-[8px] font-bold text-blue-600 uppercase">Por empacar / picking</p>
              </div>

              <div 
                onClick={() => openStatusAudit('En Ruta / Despachados')}
                className="bg-indigo-50 border border-indigo-100 hover:border-indigo-300 p-3.5 rounded-2xl cursor-pointer transition-all space-y-1 group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[8px] font-black uppercase tracking-widest text-indigo-700 flex items-center gap-1">
                    <Truck className="h-3 w-3 text-indigo-600" /> En Ruta
                  </span>
                  <Badge className="bg-indigo-600 text-white text-[8px] font-black px-1.5 py-0 rounded-lg">
                    {funnelData.transit.length}
                  </Badge>
                </div>
                <div className="text-sm font-black text-indigo-900 tracking-tight">
                  ${funnelData.transit.reduce((sum, o) => sum + (o.totalAmount || 0), 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </div>
                <p className="text-[8px] font-bold text-indigo-600 uppercase">En tránsito con transporte</p>
              </div>

              <div 
                onClick={() => openStatusAudit('Pagados / Liquidados')}
                className="bg-emerald-50 border border-emerald-100 hover:border-emerald-300 p-3.5 rounded-2xl cursor-pointer transition-all space-y-1 group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[8px] font-black uppercase tracking-widest text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Entregados
                  </span>
                  <Badge className="bg-emerald-600 text-white text-[8px] font-black px-1.5 py-0 rounded-lg">
                    {funnelData.completed.length}
                  </Badge>
                </div>
                <div className="text-sm font-black text-emerald-900 tracking-tight">
                  ${funnelData.completed.reduce((sum, o) => sum + (o.totalAmount || 0), 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </div>
                <p className="text-[8px] font-bold text-emerald-600 uppercase">Liquidados al 100%</p>
              </div>
            </div>

            <div className="p-3 bg-slate-900 text-white rounded-2xl flex items-center justify-between">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                Total Cartera Activa en Cola: {totalOrders} expedientes
              </span>
              <span className="text-xs font-black text-emerald-400 font-mono">
                Volumen Total: ${Math.round(totalRevenueUSD).toLocaleString()} USD
              </span>
            </div>
          </div>
        ) : (
          /* GRÁFICO CIRCULAR DE DONA */
          <>
            <div id="order-status-chart-container" className="h-[180px] w-full relative flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={75}
                    paddingAngle={4}
                    dataKey="value"
                    onClick={(entry) => openStatusAudit(entry.name)}
                    className="cursor-pointer hover:opacity-90 transition-opacity"
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} cursor="pointer" />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#0f172a', 
                      borderRadius: '1rem', 
                      border: 'none', 
                      color: '#fff',
                      fontFamily: 'monospace',
                      fontSize: '10px',
                      fontWeight: 900
                    }}
                    formatter={(value: any, name: any) => [`${value} pedidos (${chartData.find(c => c.name === name)?.percent}%)`, name]}
                  />
                </PieChart>
              </ResponsiveContainer>

              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">Volumen Total</span>
                <p className="text-sm font-black text-slate-900 font-mono tracking-tight">${Math.round(totalRevenueUSD).toLocaleString()}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-1.5 w-full">
              {chartData.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => openStatusAudit(item.name)}
                  className="px-2.5 py-1 rounded-xl bg-slate-50 border border-slate-200/60 hover:bg-slate-100 hover:border-slate-300 transition-all flex items-center gap-1.5 cursor-pointer text-left group"
                >
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="text-[9px] font-black uppercase text-slate-700 tracking-wider group-hover:text-slate-900">
                    {item.name}: {item.value} <span className="text-slate-400">({item.percent}%)</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </CardContent>

      {/* MODAL EJECUTIVA DRILL-DOWN DE PEDIDOS POR ESTADO CON BOTÓN IMPRIMIR PDF */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-4xl rounded-[2.5rem] border-none shadow-2xl overflow-hidden p-8 bg-white text-slate-900">
          <DialogHeader className="space-y-2 border-b pb-4">
            <div className="flex items-center justify-between">
              <Badge className="bg-primary text-white font-black text-[9px] uppercase tracking-widest px-3 py-1">
                Auditoría por Estado
              </Badge>
              <Button
                onClick={() => handleExportPDF(selectedStatusFilter || undefined)}
                disabled={isExportingPDF}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[9px] uppercase tracking-wider h-8 px-3 rounded-xl flex items-center gap-1.5 shadow-md"
              >
                {isExportingPDF ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                Imprimir Reporte PDF
              </Button>
            </div>
            <DialogTitle className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <Filter className="h-6 w-6 text-primary" /> Pedidos en Estado: {selectedStatusFilter}
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-xs">
              Listado completo de expedientes filtrados con conversión oficial a Bs. BCV.
            </DialogDescription>
          </DialogHeader>

          <div className="relative my-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              placeholder="BUSCAR CLIENTE, VENDEDOR O ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-10 text-[10px] font-bold uppercase bg-slate-50 border-none rounded-xl"
            />
          </div>

          <div className="max-h-[360px] overflow-y-auto custom-scrollbar border border-slate-100 rounded-2xl">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest sticky top-0 z-10">
                <tr>
                  <th className="p-3 pl-6">Cliente / Pedido</th>
                  <th className="p-3">Vendedor</th>
                  <th className="p-3 text-center">Estado</th>
                  <th className="p-3 text-right">Monto ($ USD)</th>
                  <th className="p-3 text-right">Monto (Bs. BCV)</th>
                  <th className="p-3 pr-6 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-800">
                {filteredOrdersForModal
                  .filter(o => {
                    const term = searchTerm.toLowerCase().trim();
                    if (!term) return true;
                    return (
                      (o.customerName || '').toLowerCase().includes(term) ||
                      (o.salespersonName || '').toLowerCase().includes(term) ||
                      (o.id || '').toLowerCase().includes(term)
                    );
                  })
                  .map((o, idx) => (
                    <tr key={o.id || idx} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 pl-6">
                        <p className="font-black text-slate-900 uppercase leading-tight">{o.customerName || 'Cliente General'}</p>
                        <p className="text-[8px] font-mono text-slate-400">ID: {o.id?.slice(0, 8)}</p>
                      </td>
                      <td className="p-3 text-slate-600 font-medium text-[10px]">{o.salespersonName || 'Directo'}</td>
                      <td className="p-3 text-center">
                        <Badge variant="outline" className="text-[8px] font-black uppercase border-slate-200 text-slate-700 px-2 py-0.5">
                          {o.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-right font-mono font-black text-emerald-700">${(o.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 text-right font-mono font-black text-slate-600">Bs. {((o.totalAmount || 0) * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
                      <td className="p-3 pr-6 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedOrderForSheet(o)}
                          className="h-8 px-3 rounded-xl text-[8px] font-black uppercase text-primary hover:bg-primary/10"
                        >
                          <Eye className="h-3 w-3 mr-1" /> Detalle
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      {selectedOrderForSheet && (
        <OrderSheetController
          order={selectedOrderForSheet}
          onOpenChange={(open) => {
            if (!open) setSelectedOrderForSheet(null);
          }}
        />
      )}
    </Card>
  );
}
