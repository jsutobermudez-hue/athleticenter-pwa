'use client';

import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import type { Order, FinancialSettings, Product } from '@/lib/definitions';
import { getEffectiveCashReceived, getCashDate, getSalesDate, isOrderInMoraCritica, getMoraCriticaAmount, calculateMetricsByDiscipline, calculateMetricsBySalesperson } from '@/lib/billing';
import { format, subDays, subMonths, startOfDay, endOfDay, startOfMonth, isSameDay, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, Printer, Loader2, Users, Calendar, Trophy, Filter, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { doc, collection, query, limit } from 'firebase/firestore';
import { useDoc, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { captureSvgAsPng } from '@/lib/chart-pdf-exporter';

interface SalesTrendChartProps {
  orders: Order[] | null;
  isLoading?: boolean;
  selectedSalespersonName?: string;
  initialDimension?: 'timeline' | 'salesperson' | 'discipline';
  initialPeriod?: '7d' | '30d' | 'this_month' | '6m' | 'all' | 'custom';
  hideDimensionSwitcher?: boolean;
  customTitle?: string;
}

const getDate = (ts: any): Date | null => {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts.seconds) return new Date(ts.seconds * 1000);
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
};

export function SalesTrendChart({
  orders,
  isLoading = false,
  selectedSalespersonName,
  initialDimension = 'timeline',
  initialPeriod = '30d',
  hideDimensionSwitcher = false,
  customTitle
}: SalesTrendChartProps) {
  const firestore = useFirestore();
  const settingsRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
  const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);
  const bcvRate = globalSettings?.bcvRate || 65.50;

  const [dimension, setDimension] = useState<'timeline' | 'salesperson' | 'discipline'>(initialDimension);
  const [period, setPeriod] = useState<'7d' | '30d' | 'this_month' | '6m' | 'all' | 'custom'>(initialPeriod);
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [viewMode, setViewMode] = useState<'comparative' | 'sales' | 'cash' | 'mora_critica'>('comparative');
  const [isExportingPDF, setIsExportingPDF] = useState(false);

  const productsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'products'), limit(300)) : null), [firestore]);
  const { data: products } = useCollection<Product>(productsQuery);

  const chartData = useMemo(() => {
    if (!orders) return [];

    const now = new Date();
    const VALID_SALES_STATUSES = ['Entregado', 'Completado', 'Despachado', 'Pagado', 'Aprobado', 'En Preparación', 'En Verificación'];

    // Filtro unificado de pedidos por período de fechas (aplica para Vendedores, Disciplinas y Línea de tiempo)
    let startDateLimit: Date | null = null;
    let endDateLimit: Date | null = null;

    if (period === '7d') {
      startDateLimit = startOfDay(subDays(now, 6));
    } else if (period === '30d') {
      startDateLimit = startOfDay(subDays(now, 29));
    } else if (period === 'this_month') {
      startDateLimit = startOfMonth(now);
    } else if (period === '6m') {
      startDateLimit = startOfDay(subMonths(now, 6));
    } else if (period === 'custom') {
      if (customStartDate) startDateLimit = startOfDay(new Date(customStartDate));
      if (customEndDate) endDateLimit = endOfDay(new Date(customEndDate));
    }

    let dateFilteredOrders = orders;
    if (period !== 'all') {
      dateFilteredOrders = orders.filter(order => {
        const sDate = getSalesDate(order);
        const cDate = getCashDate(order);
        const targetDate = sDate || cDate;

        if (!targetDate || isNaN(targetDate.getTime())) return false;
        if (startDateLimit && targetDate < startDateLimit) return false;
        if (endDateLimit && targetDate > endDateLimit) return false;

        return true;
      });
    }

    if (dimension === 'salesperson') {
      const spData = calculateMetricsBySalesperson(dateFilteredOrders);
      return spData.map(item => ({
        name: item.salespersonName,
        ventas: item.ventas,
        cobranzas: item.cobranzas,
        moraCritica: item.moraCritica,
        pending: item.pending,
        efficiencyPct: item.efficiencyPct,
        orderCount: item.orderCount
      }));
    }

    if (dimension === 'discipline') {
      const discData = calculateMetricsByDiscipline(dateFilteredOrders, products || []);
      return discData.map(item => ({
        name: item.discipline,
        ventas: item.ventas,
        cobranzas: item.cobranzas,
        moraCritica: item.moraCritica,
        pending: item.pending,
        efficiencyPct: item.efficiencyPct,
        topSalespersonName: item.topSalespersonName,
        topSalespersonAmount: item.topSalespersonAmount
      }));
    }

    // Timeline dimension
    if (period === '7d' || period === '30d' || period === 'this_month' || (period === 'custom' && startDateLimit && endDateLimit && differenceInDays(endDateLimit, startDateLimit) <= 31)) {
      let days: Date[] = [];
      if (period === '7d') {
        days = Array.from({ length: 7 }, (_, i) => startOfDay(subDays(now, 6 - i)));
      } else if (period === '30d') {
        days = Array.from({ length: 30 }, (_, i) => startOfDay(subDays(now, 29 - i)));
      } else if (period === 'this_month') {
        const daysInMonth = now.getDate();
        days = Array.from({ length: daysInMonth }, (_, i) => startOfDay(new Date(now.getFullYear(), now.getMonth(), i + 1)));
      } else if (period === 'custom' && startDateLimit && endDateLimit) {
        const totalDays = Math.max(1, differenceInDays(endDateLimit, startDateLimit) + 1);
        days = Array.from({ length: totalDays }, (_, i) => startOfDay(new Date(startDateLimit!.getTime() + i * 86400000)));
      } else {
        days = Array.from({ length: 7 }, (_, i) => startOfDay(subDays(now, 6 - i)));
      }

      return days.map(day => {
        const salesTotal = dateFilteredOrders.filter(order => {
          const sDate = getSalesDate(order);
          return sDate && isSameDay(sDate, day) && VALID_SALES_STATUSES.includes(order.status);
        }).reduce((sum, order) => sum + (order.totalAmount || 0), 0);

        let cashTotal = 0;
        dateFilteredOrders.forEach(order => {
          if (Array.isArray((order as any).payments) && (order as any).payments.length > 0) {
            (order as any).payments.forEach((p: any) => {
              if (p.status === 'verified' || !p.status) {
                const pDate = getDate(p.paymentDate || p.createdAt || p.date);
                if (pDate && isSameDay(pDate, day)) {
                  cashTotal += (Number(p.amount || p.monto) || 0);
                }
              }
            });
          } else {
            const cDate = getCashDate(order);
            const cash = getEffectiveCashReceived(order);
            if (cDate && isSameDay(cDate, day) && cash > 0) {
              cashTotal += cash;
            }
          }
        });

        const moraTotal = dateFilteredOrders.filter(order => {
          const sDate = getSalesDate(order);
          if (!sDate || sDate > day) return false;
          return isOrderInMoraCritica(order, day);
        }).reduce((sum, order) => sum + getMoraCriticaAmount(order, day), 0);

        return {
          name: format(day, 'dd/MM'),
          ventas: salesTotal,
          cobranzas: cashTotal,
          moraCritica: moraTotal
        };
      });
    } else {
      // 6 Meses o Todos
      let monthsCount = period === 'all' ? 12 : 6;
      if (period === 'custom' && startDateLimit && endDateLimit) {
        monthsCount = Math.max(1, Math.ceil(differenceInDays(endDateLimit, startDateLimit) / 30));
      }

      const months = Array.from({ length: monthsCount }, (_, i) => {
        return new Date(now.getFullYear(), now.getMonth() - (monthsCount - 1 - i), 1);
      });

      return months.map(month => {
        const salesTotal = dateFilteredOrders.filter(order => {
          const sDate = getSalesDate(order);
          return sDate && sDate.getMonth() === month.getMonth() && sDate.getFullYear() === month.getFullYear() && VALID_SALES_STATUSES.includes(order.status);
        }).reduce((sum, order) => sum + (order.totalAmount || 0), 0);

        let cashTotal = 0;
        dateFilteredOrders.forEach(order => {
          if (Array.isArray((order as any).payments) && (order as any).payments.length > 0) {
            (order as any).payments.forEach((p: any) => {
              if (p.status === 'verified' || !p.status) {
                const pDate = getDate(p.paymentDate || p.createdAt || p.date);
                if (pDate && pDate.getMonth() === month.getMonth() && pDate.getFullYear() === month.getFullYear()) {
                  cashTotal += (Number(p.amount || p.monto) || 0);
                }
              }
            });
          } else {
            const cDate = getCashDate(order);
            const cash = getEffectiveCashReceived(order);
            if (cDate && cDate.getMonth() === month.getMonth() && cDate.getFullYear() === month.getFullYear() && cash > 0) {
              cashTotal += cash;
            }
          }
        });

        const moraTotal = dateFilteredOrders.filter(order => {
          const sDate = getSalesDate(order);
          if (!sDate) return false;
          return sDate.getMonth() === month.getMonth() && sDate.getFullYear() === month.getFullYear() && isOrderInMoraCritica(order, now);
        }).reduce((sum, order) => sum + getMoraCriticaAmount(order, now), 0);

        return {
          name: format(month, 'MMM', { locale: es }).toUpperCase(),
          ventas: salesTotal,
          cobranzas: cashTotal,
          moraCritica: moraTotal
        };
      });
    }
  }, [orders, period, dimension, products, customStartDate, customEndDate]);

  const totals = useMemo(() => {
    const totalSales = chartData.reduce((sum, item) => sum + item.ventas, 0);
    const totalCash = chartData.reduce((sum, item) => sum + item.cobranzas, 0);
    const totalMora = chartData.reduce((sum, item) => sum + item.moraCritica, 0);
    const count = chartData.length || 1;
    const dailyAvg = totalSales / count;
    const efficiencyRate = totalSales > 0 ? Math.min(100, Math.round((totalCash / totalSales) * 100)) : 0;
    return { totalSales, totalCash, totalMora, dailyAvg, efficiencyRate };
  }, [chartData]);

  const handleExportPDF = async () => {
    setIsExportingPDF(true);
    try {
      const jsPDF = (await import('jspdf')).default;
      const autoTable = (await import('jspdf-autotable')).default;

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, 297, 24, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('ATHLETICENTER PRO C.A. - ANÁLISIS MULTI-DIMENSIONAL DE VENTAS & COBRANZAS', 14, 13);
      doc.setFontSize(8);
      const getPeriodLabelText = () => {
        if (period === '7d') return 'Últimos 7 Días';
        if (period === '30d') return 'Últimos 30 Días';
        if (period === 'this_month') return 'Este Mes';
        if (period === '6m') return 'Últimos 6 Meses';
        if (period === 'all') return 'Histórico Consolidado';
        if (period === 'custom') {
          if (customStartDate && customEndDate) return `${customStartDate} a ${customEndDate}`;
          return 'Rango Personalizado';
        }
        return '';
      };

      const dimLabel = dimension === 'timeline' 
        ? `LÍNEA DE TIEMPO (${getPeriodLabelText().toUpperCase()})` 
        : dimension === 'salesperson' 
        ? `COMPARATIVA POR VENDEDOR (${getPeriodLabelText().toUpperCase()})` 
        : `DISTRIBUCIÓN POR DISCIPLINA (${getPeriodLabelText().toUpperCase()})`;
      doc.text(`FECHA DE EMISIÓN: ${format(new Date(), 'dd/MM/yyyy HH:mm')} | DIMENSIÓN: ${dimLabel}`, 14, 19);

      doc.setFillColor(248, 250, 252);
      doc.roundedRect(14, 28, 269, 18, 3, 3, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(14, 28, 269, 18, 3, 3, 'S');

      doc.setTextColor(15, 23, 42);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(`VENTAS FACTURADAS: $${totals.totalSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 18, 38);
      doc.text(`CASH RECAUDADO: $${totals.totalCash.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 105, 38);
      doc.text(`MORA CRÍTICA (+30D): $${totals.totalMora.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 180, 38);
      doc.text(`EFICIENCIA: ${totals.efficiencyRate}%`, 250, 38);

      const chartImage = await captureSvgAsPng('sales-trend-chart-container');
      let tableStartY = 50;

      if (chartImage) {
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(71, 85, 105);
        doc.text('GRÁFICO COMPARATIVO VISUAL:', 14, 50);

        doc.addImage(chartImage, 'PNG', 14, 53, 269, 70);
        tableStartY = 128;
      }

      let headCols = ['Dimensión / Registro', 'Ventas ($ USD)', 'Cobranzas ($ USD)', 'Pendiente ($ USD)', 'Mora Crítica ($ USD)', '% Eficiencia'];
      if (dimension === 'discipline') {
        headCols = ['Disciplina Deportiva', 'Ventas ($ USD)', 'Cobranzas ($ USD)', 'Pendiente ($ USD)', 'Mora Crítica ($ USD)', '% Eficiencia', 'Líder de Ventas'];
      } else if (dimension === 'salesperson') {
        headCols = ['Asesor Comercial', 'Ventas ($ USD)', 'Cobranzas ($ USD)', 'Pendiente ($ USD)', 'Mora Crítica ($ USD)', 'Pedidos', '% Eficiencia'];
      } else {
        headCols = ['Período', 'Ventas ($ USD)', 'Cobranzas ($ USD)', 'Brecha ($ USD)', 'Mora Crítica ($ USD)', '% Eficiencia', 'Equiv. BCV (Bs.)'];
      }

      const tableRows = chartData.map((d: any) => {
        const pendingVal = typeof d.pending === 'number' ? d.pending : Math.max(0, d.ventas - d.cobranzas);
        const effVal = typeof d.efficiencyPct === 'number' ? d.efficiencyPct : (d.ventas > 0 ? Math.min(100, Math.round((d.cobranzas / d.ventas) * 100)) : 0);

        if (dimension === 'discipline') {
          return [
            d.name,
            `$${d.ventas.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `$${d.cobranzas.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `$${pendingVal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `$${d.moraCritica.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `${effVal}%`,
            d.topSalespersonName ? `${d.topSalespersonName} ($${d.topSalespersonAmount?.toLocaleString('en-US')})` : 'N/A'
          ];
        }

        if (dimension === 'salesperson') {
          return [
            d.name,
            `$${d.ventas.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `$${d.cobranzas.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `$${pendingVal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `$${d.moraCritica.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
            `${d.orderCount || 0}`,
            `${effVal}%`
          ];
        }

        return [
          d.name,
          `$${d.ventas.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `$${d.cobranzas.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `$${pendingVal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `$${d.moraCritica.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          `${effVal}%`,
          `Bs. ${(d.cobranzas * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`
        ];
      });

      const footRow = [
        'TOTAL CONSOLIDADO',
        `$${totals.totalSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        `$${totals.totalCash.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        `$${Math.max(0, totals.totalSales - totals.totalCash).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        `$${totals.totalMora.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        `${totals.efficiencyRate}%`,
        dimension === 'discipline' ? '-' : dimension === 'salesperson' ? '-' : `Bs. ${(totals.totalCash * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`
      ];

      autoTable(doc, {
        startY: tableStartY,
        head: [headCols],
        body: tableRows,
        foot: [footRow],
        headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold', halign: 'center' },
        bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        footStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontSize: 9, fontStyle: 'bold', halign: 'center' },
        theme: 'grid'
      });

      doc.autoPrint();
      const pdfBlob = doc.output('bloburl');
      window.open(pdfBlob, '_blank');
    } catch (e) {
      console.error('Error generating PDF:', e);
    } finally {
      setIsExportingPDF(false);
    }
  };

  if (isLoading || !orders) {
    return (
      <Card className="border-none shadow-xl rounded-[2.5rem] bg-white h-[350px] flex items-center justify-center">
        <div className="text-center space-y-4">
          <TrendingUp className="h-10 w-10 text-slate-300 animate-bounce mx-auto" />
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cargando Tendencias...</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-none shadow-xl rounded-[2.5rem] bg-white overflow-hidden relative group animate-in fade-in duration-500">
      <CardHeader className="p-8 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 space-y-0">
        <div className="space-y-2">
          <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 flex items-center gap-2 flex-wrap">
            <TrendingUp className="h-4 w-4 text-primary" /> {customTitle || (dimension === 'salesperson' ? 'Comparativa por Vendedor' : dimension === 'discipline' ? 'Distribución por Disciplina' : 'Tendencia de Ventas vs Cobranzas')}
            {selectedSalespersonName && (
              <Badge className="bg-indigo-100 text-indigo-700 font-black text-[9px] uppercase border-none px-2 py-0.5 ml-1">
                👤 {selectedSalespersonName}
              </Badge>
            )}
          </CardTitle>

          <div className="flex flex-wrap items-center gap-2">
            {/* SELECTOR DE DIMENSIÓN DE ANÁLISIS (Si no está oculto) */}
            {!hideDimensionSwitcher && (
              <div className="flex bg-slate-900 text-white rounded-xl p-1 gap-1 shadow-inner">
                {[
                  { id: 'timeline', label: '📅 Período', icon: Calendar },
                  { id: 'salesperson', label: '👤 Vendedores', icon: Users },
                  { id: 'discipline', label: '⚽ Disciplinas', icon: Trophy },
                ].map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDimension(d.id as any)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5",
                      dimension === d.id
                        ? "bg-primary text-white shadow-md font-extrabold"
                        : "text-slate-400 hover:text-white hover:bg-slate-800"
                    )}
                  >
                    <d.icon className="h-3 w-3" />
                    {d.label}
                  </button>
                ))}
              </div>
            )}

            {/* SUB-FILTRO DE RANGO DE TIEMPO (Activo para TODAS las dimensiones) */}
            <div className="flex bg-slate-100 border border-slate-200/50 rounded-xl p-1 gap-1 flex-wrap items-center animate-in fade-in duration-300">
              {[
                { id: '7d', label: '7D' },
                { id: '30d', label: '30D' },
                { id: 'this_month', label: 'Mes' },
                { id: '6m', label: '6M' },
                { id: 'all', label: 'Todos' },
                { id: 'custom', label: '📅 Rango' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPeriod(p.id as any)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all",
                    period === p.id 
                      ? "bg-slate-800 text-white shadow-sm" 
                      : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* SELECCIÓN DE FECHAS DESDE / HASTA SI PERIOD === 'custom' */}
            {period === 'custom' && (
              <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm animate-in fade-in duration-300">
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="h-6 text-[9px] font-mono border-none bg-transparent px-1 focus:outline-none text-slate-700"
                  title="Fecha de Inicio"
                />
                <span className="text-[9px] text-slate-400 font-bold">-</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="h-6 text-[9px] font-mono border-none bg-transparent px-1 focus:outline-none text-slate-700"
                  title="Fecha de Fin"
                />
              </div>
            )}

            {/* SELECTOR DE VISTA DE CONCEPTO */}
            <div className="flex bg-slate-100 border border-slate-200/50 rounded-xl p-1 gap-1">
              {[
                { id: 'comparative', label: '📊 Dual' },
                { id: 'sales', label: '🔵 Ventas' },
                { id: 'cash', label: '🟢 Cash' },
                { id: 'mora_critica', label: '🚨 Mora' },
              ].map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setViewMode(v.id as any)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all",
                    viewMode === v.id
                      ? v.id === 'mora_critica' ? "bg-rose-600 text-white shadow-sm" : "bg-slate-900 text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>

            {/* BOTÓN DE IMPRESIÓN REPORTE PDF */}
            <Button
              onClick={handleExportPDF}
              disabled={isExportingPDF}
              variant="outline"
              className="h-8 px-3 rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50 font-black text-[8px] sm:text-[9px] uppercase tracking-wider flex items-center gap-1.5 shadow-sm shrink-0"
              title="Imprimir Gráfico Visual y Reporte PDF"
            >
              {isExportingPDF ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5 text-primary" />}
              <span className="truncate">🖨️ Imprimir PDF</span>
            </Button>
          </div>
        </div>

        <div className="text-left sm:text-right shrink-0">
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-black tracking-tighter text-slate-900 leading-none">${totals.totalSales.toLocaleString('en-US', { minimumFractionDigits: 0 })}</p>
            <Badge variant="outline" className="text-[7px] font-black border-slate-200 text-slate-600 px-1.5 py-0 font-mono">
              {dimension === 'timeline' ? `Prom: $${totals.dailyAvg.toLocaleString('en-US', { minimumFractionDigits: 0 })}/día` : `${chartData.length} Registros`}
            </Badge>
          </div>
          <div className="flex items-center sm:justify-end gap-2 mt-1.5">
            <span className="text-[8px] font-black text-emerald-600 uppercase tracking-widest">
              Cash: ${totals.totalCash.toLocaleString('en-US', { minimumFractionDigits: 0 })}
            </span>
            <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 font-black text-[8px] border-emerald-200/60 rounded-md">
              {totals.efficiencyRate}% Cobrado
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-6 pb-6 pt-0">
        <div id="sales-trend-chart-container" className="h-[260px] w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            {dimension === 'timeline' ? (
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorVentas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0}/>
                  </linearGradient>
                  <linearGradient id="colorCobranzas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0}/>
                  </linearGradient>
                  <linearGradient id="colorMora" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 9, fontWeight: 900, fill: '#64748b' }} 
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 9, fontWeight: 900, fill: '#64748b' }}
                  tickFormatter={(val) => `$${val}`}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#0f172a', 
                    borderRadius: '1.2rem', 
                    border: 'none', 
                    color: '#fff',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    fontWeight: 900
                  }}
                  formatter={(value: any, name: any) => [
                    `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2 })} (Bs. ${(Number(value) * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })})`,
                    name === 'ventas' ? '🔵 Ventas Facturadas' : name === 'cobranzas' ? '🟢 Cobranzas Realizadas' : '🚨 Mora Crítica (+30D)'
                  ]}
                  labelFormatter={(label) => `Período: ${label}`}
                />
                {(viewMode === 'comparative' || viewMode === 'sales') && (
                  <Area 
                    type="monotone" 
                    dataKey="ventas" 
                    stroke="#3b82f6" 
                    strokeWidth={3} 
                    fillOpacity={1} 
                    fill="url(#colorVentas)" 
                  />
                )}
                {(viewMode === 'comparative' || viewMode === 'cash') && (
                  <Area 
                    type="monotone" 
                    dataKey="cobranzas" 
                    stroke="#10b981" 
                    strokeWidth={3} 
                    fillOpacity={1} 
                    fill="url(#colorCobranzas)" 
                  />
                )}
                {(viewMode === 'comparative' || viewMode === 'mora_critica') && (
                  <Area 
                    type="monotone" 
                    dataKey="moraCritica" 
                    stroke="#ef4444" 
                    strokeWidth={3} 
                    fillOpacity={1} 
                    fill="url(#colorMora)" 
                  />
                )}
              </AreaChart>
            ) : (
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 9, fontWeight: 900, fill: '#475569' }} 
                  interval={0}
                  angle={-15}
                  textAnchor="end"
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 9, fontWeight: 900, fill: '#64748b' }}
                  tickFormatter={(val) => `$${val}`}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#0f172a', 
                    borderRadius: '1.2rem', 
                    border: 'none', 
                    color: '#fff',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    fontWeight: 900
                  }}
                  formatter={(value: any, name: any, item: any) => {
                    const labelName = name === 'ventas' ? '🔵 Ventas' : name === 'cobranzas' ? '🟢 Cash Recaudado' : '🚨 Mora Crítica';
                    const mainText = `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2 })} (Bs. ${(Number(value) * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })})`;
                    if (dimension === 'discipline' && item?.payload?.topSalespersonName) {
                      return [`${mainText} | 👑 Líder: ${item.payload.topSalespersonName} ($${item.payload.topSalespersonAmount?.toLocaleString('en-US')})`, labelName];
                    }
                    return [mainText, labelName];
                  }}
                  labelFormatter={(label) => `${dimension === 'discipline' ? 'Disciplina' : 'Asesor'}: ${label}`}
                />
                {(viewMode === 'comparative' || viewMode === 'sales') && (
                  <Bar dataKey="ventas" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={45} />
                )}
                {(viewMode === 'comparative' || viewMode === 'cash') && (
                  <Bar dataKey="cobranzas" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={45} />
                )}
                {(viewMode === 'comparative' || viewMode === 'mora_critica') && (
                  <Bar dataKey="moraCritica" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={45} />
                )}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
