'use client';

import React, { useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import type { Order } from '@/lib/definitions';
import { format, subDays, startOfDay, isSameDay } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, DollarSign } from 'lucide-react';

interface SalesTrendChartProps {
  orders: Order[] | null;
  isLoading?: boolean;
}

export function SalesTrendChart({ orders, isLoading = false }: SalesTrendChartProps) {
  const chartData = useMemo(() => {
    if (!orders) return [];

    // Generar últimos 7 días
    const days = Array.from({ length: 7 }, (_, i) => startOfDay(subDays(new Date(), 6 - i)));

    return days.map(day => {
      // Filtrar órdenes pagadas de este día
      const dayOrders = orders.filter(order => {
        if (order.status !== 'Pagado' || !order.createdAt) return false;
        const orderDate = typeof order.createdAt.toDate === 'function' 
          ? order.createdAt.toDate() 
          : new Date(order.createdAt as any);
        return isSameDay(orderDate, day);
      });

      const totalRevenue = dayOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

      return {
        name: format(day, 'dd/MM'),
        monto: totalRevenue,
      };
    });
  }, [orders]);

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
    <Card className="border-none shadow-xl rounded-[2.5rem] bg-white overflow-hidden relative group">
      <CardHeader className="p-8 pb-4 flex flex-row items-center justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" /> Tendencia de Ventas
          </CardTitle>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Historial de Ingresos de los Últimos 7 Días</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-black tracking-tighter text-slate-900 leading-none">${currentTotal.toLocaleString()}</p>
          <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">Semana Activa</span>
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
