'use client';

import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import type { Order, FinancialSettings } from '@/lib/definitions';
import { getEffectiveCashReceived, getCashDate, getSalesDate, isOrderInMoraCritica, getMoraCriticaAmount } from '@/lib/billing';
import { format, subDays, startOfDay, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, DollarSign, Activity, CheckCircle2, Printer, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { doc } from 'firebase/firestore';
import { useDoc, useFirestore, useMemoFirebase } from '@/firebase';
import { captureSvgAsPng } from '@/lib/chart-pdf-exporter';

interface SalesTrendChartProps {
  orders: Order[] | null;
  isLoading?: boolean;
  selectedSalespersonName?: string;
}

const getDate = (ts: any): Date | null => {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts.seconds) return new Date(ts.seconds * 1000);
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
};



export function SalesTrendChart({ orders, isLoading = false, selectedSalespersonName }: SalesTrendChartProps) {
  const firestore = useFirestore();
  const settingsRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
  const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);
  const bcvRate = globalSettings?.bcvRate || 65.50;

  const [period, setPeriod] = useState<'7d' | '30d' | '6m'>('7d');
  const [viewMode, setViewMode] = useState<'comparative' | 'sales' | 'cash' | 'mora_critica'>('comparative');
  const [isExportingPDF, setIsExportingPDF] = useState(false);

  const chartData = useMemo(() => {
    if (!orders) return [];

    const now = new Date();
    const VALID_SALES_STATUSES = ['Entregado', 'Completado', 'Despachado', 'Pagado', 'Aprobado', 'En Preparación', 'En Verificación'];

    if (period === '7d' || period === '30d') {
      const daysCount = period === '7d' ? 7 : 30;
      const days = Array.from({ length: daysCount }, (_, i) => startOfDay(subDays(now, daysCount - 1 - i)));
      
      return days.map(day => {
        const salesTotal = orders.filter(order => {
          const sDate = getSalesDate(order);
          return sDate && isSameDay(sDate, day) && VALID_SALES_STATUSES.includes(order.status);
        }).reduce((sum, order) => sum + (order.totalAmount || 0), 0);

        let cashTotal = 0;
        orders.forEach(order => {
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

        const moraTotal = orders.filter(order => {
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
      // 6 Meses
      const months = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
        return d;
      });

      return months.map(month => {
        const salesTotal = orders.filter(order => {
          const sDate = getSalesDate(order);
          return sDate && sDate.getMonth() === month.getMonth() && sDate.getFullYear() === month.getFullYear() && VALID_SALES_STATUSES.includes(order.status);
        }).reduce((sum, order) => sum + (order.totalAmount || 0), 0);

        let cashTotal = 0;
        orders.forEach(order => {
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

        const moraTotal = orders.filter(order => {
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
  }, [orders, period]);

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

      const doc = new jsPDF();

      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, 210, 24, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('ATHLETICENTER PRO C.A. - AUDITORÍA DE TENDENCIA DE VENTAS', 14, 15);
      doc.setFontSize(8);
      doc.text(`FECHA DE INFORME: ${format(new Date(), 'dd/MM/yyyy HH:mm')} | PERÍODO: ${period.toUpperCase()}`, 14, 20);

      doc.setFillColor(248, 250, 252);
      doc.roundedRect(14, 31, 182, 20, 3, 3, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(14, 31, 182, 20, 3, 3, 'S');

      doc.setTextColor(15, 23, 42);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(`TOTAL VENTAS FACTURADAS: $${totals.totalSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 18, 39);
      doc.text(`COBRANZA CASH REAL: $${totals.totalCash.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 18, 46);

      doc.text(`PROMEDIO: $${Math.round(totals.dailyAvg).toLocaleString('en-US')}/día`, 115, 39);
      doc.text(`EFICIENCIA: ${totals.efficiencyRate}% COBRADO`, 115, 46);

      const chartImage = await captureSvgAsPng('sales-trend-chart-container');
      let tableStartY = 56;

      if (chartImage) {
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(71, 85, 105);
        doc.text('REPRESENTACIÓN GRÁFICA VISUAL:', 14, 57);

        doc.addImage(chartImage, 'PNG', 14, 60, 182, 60);
        tableStartY = 125;
      }

      const tableRows = chartData.map(d => [
        d.name,
        `$${d.ventas.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        `$${d.cobranzas.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        `$${(d.ventas - d.cobranzas).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        `${d.ventas > 0 ? Math.min(100, Math.round((d.cobranzas / d.ventas) * 100)) : 0}%`,
        `Bs. ${(d.cobranzas * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`
      ]);

      autoTable(doc, {
        startY: tableStartY,
        head: [['Período', 'Ventas ($ USD)', 'Cobranzas ($ USD)', 'Brecha ($ USD)', '% Eficiencia', 'Equiv. BCV (Bs.)']],
        body: tableRows,
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
        <div className="space-y-1">
          <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 flex items-center gap-2 flex-wrap">
            <TrendingUp className="h-4 w-4 text-primary" /> Tendencia de Ventas vs Cobranzas
            {selectedSalespersonName && (
              <Badge className="bg-indigo-100 text-indigo-700 font-black text-[9px] uppercase border-none px-2 py-0.5 ml-1">
                👤 {selectedSalespersonName}
              </Badge>
            )}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <div className="flex bg-slate-100 border border-slate-200/50 rounded-xl p-1 gap-1">
              {(['7d', '30d', '6m'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all",
                    period === p 
                      ? "bg-primary text-white shadow-sm" 
                      : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  {p === '7d' ? '7D' : p === '30d' ? '30D' : '6M'}
                </button>
              ))}
            </div>

            {/* SELECTOR DE VISTA DUAL (COMPARATIVO) */}
            <div className="flex bg-slate-100 border border-slate-200/50 rounded-xl p-1 gap-1">
              {[
                { id: 'comparative', label: '📊 Dual' },
                { id: 'sales', label: '🔵 Ventas' },
                { id: 'cash', label: '🟢 Cash' },
                { id: 'mora_critica', label: '🚨 Mora Crítica' },
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

            {/* BOTÓN DE IMPRESIÓN DE GRÁFICO VISUAL EN PDF */}
            <Button
              onClick={handleExportPDF}
              disabled={isExportingPDF}
              variant="outline"
              className="h-7 px-2 rounded-lg border-slate-200 text-slate-700 hover:bg-slate-50 font-black text-[8px] sm:text-[9px] uppercase tracking-wider flex items-center gap-1 shadow-sm shrink-0"
              title="Imprimir Gráfico Visual y Reporte PDF"
            >
              {isExportingPDF ? <Loader2 className="h-3 w-3 animate-spin" /> : <Printer className="h-3 w-3 text-primary" />}
              <span className="truncate">Reporte PDF</span>
            </Button>
          </div>
        </div>

        <div className="text-left sm:text-right shrink-0">
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-black tracking-tighter text-slate-900 leading-none">${totals.totalSales.toLocaleString('en-US', { minimumFractionDigits: 0 })}</p>
            <Badge variant="outline" className="text-[7px] font-black border-slate-200 text-slate-600 px-1.5 py-0 font-mono">
              Prom: ${totals.dailyAvg.toLocaleString('en-US', { minimumFractionDigits: 0 })}/día
            </Badge>
          </div>
          <div className="flex items-center sm:justify-end gap-2 mt-1.5">
            <span className="text-[8px] font-black text-emerald-600 uppercase tracking-widest">
              Cobranza Cash: ${totals.totalCash.toLocaleString('en-US', { minimumFractionDigits: 0 })}
            </span>
            <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 font-black text-[8px] border-emerald-200/60 rounded-md">
              {totals.efficiencyRate}% Cobrado
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-6 pb-6 pt-0">
        <div id="sales-trend-chart-container" className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
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
                labelFormatter={(label) => `Periodo: ${label}`}
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
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
