'use client';

import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import type { Order } from '@/lib/definitions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingCart, Eye, Search, Filter } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { OrderSheetController } from '@/app/dashboard/orders/OrderSheetController';
import { cn } from '@/lib/utils';

interface OrderStatusChartProps {
  orders: Order[] | null;
  isLoading?: boolean;
}

const COLORS = {
  'Pendientes': '#eab308',       // Amber
  'En Preparación': '#3b82f6',   // Blue
  'Despachados': '#6366f1',      // Indigo
  'Pagados': '#10b981',          // Emerald
};

export function OrderStatusChart({ orders, isLoading = false }: OrderStatusChartProps) {
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrderForSheet, setSelectedOrderForSheet] = useState<Order | null>(null);

  const chartData = useMemo(() => {
    if (!orders) return [];

    let pending: Order[] = [];
    let approved: Order[] = [];
    let dispatched: Order[] = [];
    let completed: Order[] = [];

    orders.forEach(order => {
      if (['Pendiente'].includes(order.status)) {
        pending.push(order);
      } else if (['Aprobado', 'En Preparación'].includes(order.status)) {
        approved.push(order);
      } else if (['Despachado'].includes(order.status)) {
        dispatched.push(order);
      } else if (['Completado', 'Pagado', 'Entregado'].includes(order.status)) {
        completed.push(order);
      }
    });

    const totalCount = orders.length || 1;

    return [
      { name: 'Pagados', value: completed.length, orders: completed, color: COLORS['Pagados'], percent: Math.round((completed.length / totalCount) * 100) },
      { name: 'En Preparación', value: approved.length, orders: approved, color: COLORS['En Preparación'], percent: Math.round((approved.length / totalCount) * 100) },
      { name: 'Despachados', value: dispatched.length, orders: dispatched, color: COLORS['Despachados'], percent: Math.round((dispatched.length / totalCount) * 100) },
      { name: 'Pendientes', value: pending.length, orders: pending, color: COLORS['Pendientes'], percent: Math.round((pending.length / totalCount) * 100) },
    ].filter(item => item.value > 0);
  }, [orders]);

  const totalRevenueUSD = useMemo(() => {
    if (!orders) return 0;
    return orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  }, [orders]);

  const openStatusAudit = (statusName: string) => {
    setSelectedStatusFilter(statusName);
    setIsModalOpen(true);
  };

  const filteredOrdersForModal = useMemo(() => {
    if (!orders || !selectedStatusFilter) return [];
    if (selectedStatusFilter === 'Pagados') {
      return orders.filter(o => ['Pagado', 'Completado', 'Entregado'].includes(o.status));
    }
    if (selectedStatusFilter === 'En Preparación') {
      return orders.filter(o => ['Aprobado', 'En Preparación'].includes(o.status));
    }
    if (selectedStatusFilter === 'Despachados') {
      return orders.filter(o => ['Despachado'].includes(o.status));
    }
    if (selectedStatusFilter === 'Pendientes') {
      return orders.filter(o => ['Pendiente', 'Borrador', 'En Verificación'].includes(o.status));
    }
    return orders;
  }, [orders, selectedStatusFilter]);

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
    <Card className="border-none shadow-xl rounded-[2.5rem] bg-white overflow-hidden relative group h-full flex flex-col justify-between">
      <CardHeader className="p-8 pb-2 flex flex-row items-center justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" /> Distribución de Pedidos
          </CardTitle>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Estado de Cola de Trabajo (Clic Auditar)</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-black tracking-tighter text-slate-900 leading-none">{totalOrders}</p>
          <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Ped. Activos</span>
        </div>
      </CardHeader>

      <CardContent className="px-6 pb-6 pt-0 flex flex-col items-center justify-center flex-1 space-y-4">
        {chartData.length > 0 ? (
          <>
            <div className="h-[180px] w-full relative flex items-center justify-center">
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

              {/* CENTRO MONETARIO DINÁMICO DE LA DONA */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">Volumen Total</span>
                <p className="text-sm font-black text-slate-900 font-mono tracking-tight">${Math.round(totalRevenueUSD).toLocaleString()}</p>
              </div>
            </div>

            {/* CHIPS EJECUTIVOS INTERACTIVOS DE ESTADO (1-CLIC) */}
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
        ) : (
          <div className="flex h-[220px] items-center justify-center text-slate-400 text-xs font-bold uppercase tracking-widest">
            Sin Pedidos Registrados
          </div>
        )}
      </CardContent>

      {/* MODAL EJECUTIVA DRILL-DOWN DE PEDIDOS POR ESTADO */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-4xl rounded-[2.5rem] border-none shadow-2xl overflow-hidden p-8 bg-white text-slate-900">
          <DialogHeader className="space-y-2 border-b pb-4">
            <div className="flex items-center justify-between">
              <Badge className="bg-primary text-white font-black text-[9px] uppercase tracking-widest px-3 py-1">
                Auditoría por Estado
              </Badge>
              <span className="text-[10px] font-black font-mono text-slate-400 uppercase">
                🏷️ {selectedStatusFilter}
              </span>
            </div>
            <DialogTitle className="text-2xl font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <Filter className="h-6 w-6 text-primary" /> Pedidos en Estado: {selectedStatusFilter}
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-xs">
              Listado completo de expedientes filtrados en esta categoría con conversión oficial a Bs. BCV.
            </DialogDescription>
          </DialogHeader>

          {/* BUSCADOR DENTRO DE LA MODAL */}
          <div className="relative my-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              placeholder="BUSCAR CLIENTE, VENDEDOR O ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-10 text-[10px] font-bold uppercase bg-slate-50 border-none rounded-xl"
            />
          </div>

          {/* TABLA DE PEDIDOS FILTRADOS POR ESTADO */}
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
                      <td className="p-3 text-right font-mono font-black text-slate-600">Bs. {((o.totalAmount || 0) * 65.50).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
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

      {/* CONTROLLER DEL DETALLE DE PEDIDO */}
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

