'use client';

import React, { useMemo } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import type { Order } from '@/lib/definitions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingCart } from 'lucide-react';

interface OrderStatusChartProps {
  orders: Order[] | null;
  isLoading?: boolean;
}

const COLORS = {
  'Pendientes': '#eab308',       // Amber
  'Aprobados': '#3b82f6',        // Blue / En Prep
  'Despachados': '#6366f1',      // Indigo / En ruta
  'Completados': '#10b981',      // Emerald / Pagados
};

export function OrderStatusChart({ orders, isLoading = false }: OrderStatusChartProps) {
  const chartData = useMemo(() => {
    if (!orders) return [];

    let pending = 0;
    let approved = 0;
    let dispatched = 0;
    let completed = 0;

    orders.forEach(order => {
      if (['Pendiente'].includes(order.status)) {
        pending++;
      } else if (['Aprobado', 'En Preparación'].includes(order.status)) {
        approved++;
      } else if (['Despachado'].includes(order.status)) {
        dispatched++;
      } else if (['Completado', 'Pagado'].includes(order.status)) {
        completed++;
      }
    });

    return [
      { name: 'Pendientes', value: pending, color: COLORS['Pendientes'] },
      { name: 'En Preparación', value: approved, color: COLORS['Aprobados'] },
      { name: 'Despachados', value: dispatched, color: COLORS['Despachados'] },
      { name: 'Pagados', value: completed, color: COLORS['Completados'] },
    ].filter(item => item.value > 0);
  }, [orders]);

  if (isLoading || !orders) {
    return (
      <Card className="border-none shadow-xl rounded-[2.5rem] bg-white h-[350px] flex items-center justify-center">
        <div className="text-center space-y-4">
          <ShoppingCart className="h-10 w-10 text-slate-300 animate-bounce mx-auto" />
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Analizando Estados...</p>
        </div>
      </Card>
    );
  }

  const totalOrders = orders.length;

  return (
    <Card className="border-none shadow-xl rounded-[2.5rem] bg-white overflow-hidden relative group h-full">
      <CardHeader className="p-8 pb-4 flex flex-row items-center justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" /> Distribución de Pedidos
          </CardTitle>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Estado de Cola de Trabajo Activa</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-black tracking-tighter text-slate-900 leading-none">{totalOrders}</p>
          <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Totales</span>
        </div>
      </CardHeader>
      <CardContent className="px-6 pb-8 pt-0 flex flex-col items-center justify-center">
        {chartData.length > 0 ? (
          <div className="h-[220px] w-full relative flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
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
                  formatter={(value) => [`${value} pedidos`, 'Cantidad']}
                />
                <Legend 
                  verticalAlign="bottom" 
                  height={36} 
                  iconType="circle"
                  iconSize={8}
                  formatter={(value, entry: any) => (
                    <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider">
                      {value} ({entry.payload.value})
                    </span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex h-[220px] items-center justify-center text-slate-400 text-xs font-bold uppercase tracking-widest">
            Sin Pedidos Registrados
          </div>
        )}
      </CardContent>
    </Card>
  );
}
