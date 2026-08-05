'use client';

import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import type { Order } from '@/lib/definitions';
import { format, subDays, startOfDay, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SalesTrendChartProps {
  orders: Order[] | null;
  isLoading?: boolean;
}

export function SalesTrendChart({ orders, isLoading = false }: SalesTrendChartProps) {
  const [period, setPeriod] = useState<'7d' | '30d' | '6m'>('7d');

  const chartData = useMemo(() => {
    if (!orders) return [];

    const now = new Date();
    const VALID_SALES_STATUSES = ['Entregado', 'Completado', 'Despachado', 'Pagado', 'Aprobado', 'En Preparación'];
    const getDate = (ts: any) => ts ? (typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts)) : new Date(0);

    if (period === '7d') {
      const days = Array.from({ length: 7 }, (_, i) => startOfDay(subDays(now, 6 - i)));
      return days.map(day => {
        const dayOrders = orders.filter(order => {
          if (!VALID_SALES_STATUSES.includes(order.status)) return false;
          const orderDate = getDate(order.receptionDate || order.approvalDate || order.createdAt || order.orderDate);
          return isSameDay(orderDate, day);
        });

        const totalRevenue = dayOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

        return {
          name: format(day, 'dd/MM'),
          monto: totalRevenue,
        };
      });
    } else if (period === '30d') {
      const days = Array.from({ length: 30 }, (_, i) => startOfDay(subDays(now, 29 - i)));
      return days.map(day => {
        const dayOrders = orders.filter(order => {
          if (!VALID_SALES_STATUSES.includes(order.status)) return false;
          const orderDate = getDate(order.receptionDate || order.approvalDate || order.createdAt || order.orderDate);
          return isSameDay(orderDate, day);
        });

        const totalRevenue = dayOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

        return {
          name: format(day, 'dd/MM'),
          monto: totalRevenue,
        };
      });
    } else {
      // 6 meses agrupados por mes
      const months = Array.from({ length: 6 }, (_, i) => {
        const d = new Date();
        d.setMonth(now.getMonth() - (5 - i));
        return d;
      });

      return months.map(m => {
        const mStart = new Date(m.getFullYear(), m.getMonth(), 1);
        const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0, 23, 59, 59, 999);

        const monthOrders = orders.filter(order => {
          if (!VALID_SALES_STATUSES.includes(order.status)) return false;
          const orderDate = getDate(order.receptionDate || order.approvalDate || order.createdAt || order.orderDate);
          return orderDate >= mStart && orderDate <= mEnd;
        });

        const totalRevenue = monthOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

        return {
          name: format(m, 'MMM', { locale: es }).toUpperCase(),
          monto: totalRevenue,
        };
      });
    }
  }, [orders, period]);

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

  const currentTotal = chartData.reduce((sum, d) => sum + d.monto, 0);

  return (
    <Card className="border-none shadow-xl rounded-[2.5rem] bg-white overflow-hidden relative group animate-in fade-in duration-500">
      <CardHeader className="p-8 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" /> Tendencia de Ventas
          </CardTitle>
          <div className="flex bg-slate-100 border border-slate-200/50 rounded-xl p-1 gap-1 mt-2">
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
        </div>
        <div className="text-left sm:text-right shrink-0">
          <p className="text-2xl font-black tracking-tighter text-slate-900 leading-none">${currentTotal.toLocaleString()}</p>
          <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest block mt-1.5">
            {period === '7d' ? 'Semana Activa' : period === '30d' ? 'Mes Activo' : 'Semestre Activo'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-6 pb-6 pt-0">
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorMonto" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0}/>
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
                formatter={(value: any) => [`$${Number(value).toLocaleString()}`, 'Venta']}
                labelFormatter={(label) => `Día: ${label}`}
              />
              <Area 
                type="monotone" 
                dataKey="monto" 
                stroke="#3b82f6" 
                strokeWidth={3} 
                fillOpacity={1} 
                fill="url(#colorMonto)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
