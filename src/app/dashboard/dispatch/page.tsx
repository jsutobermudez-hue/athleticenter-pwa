'use client';

import React, { useMemo, useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, Package, Truck, ShieldCheck } from 'lucide-react';
import {
  useCollection,
  useFirestore,
  useMemoFirebase,
  useUser,
} from '@/firebase';
import { collection, query, where, limit } from 'firebase/firestore';
import type { Order, OrderStatus } from '@/lib/definitions';
import { DispatchOrderDialog } from './dispatch-order-dialog';
import { ConfirmDeliveryDialog } from './confirm-delivery-dialog';
import { ConfirmStatusChangeDialog } from './confirm-status-change-dialog';
import { CompletePackingDialog } from './complete-packing-dialog';
import { UpdateOrderStatusDialog } from '../orders/update-order-status-dialog';
import { ClientDispatchView } from './ClientDispatchView';
import { AdminDispatchKanban } from './AdminDispatchKanban';
import { OrderSheetController } from '../orders/OrderSheetController';
import { DashboardMetricCard } from '@/components/dashboard/DashboardMetricCard';

import { format, subDays, startOfDay, isSameDay } from 'date-fns';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function DispatchPageContent() {
  const { profile: currentUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const searchParams = useSearchParams();
  
  const [dialogState, setDialogState] = useState<{ 
    type: 'dispatch' | 'confirmDelivery' | 'confirmStatus' | 'status' | 'completePacking' | 'details' | null; 
    order: Order | null; 
    targetStatus?: OrderStatus; 
  }>({ type: null, order: null });

  const [activeKpi, setActiveKpi] = useState<'warehouse' | 'road' | 'delivered' | 'todos'>('todos');
  const [dateFilter, setDateFilter] = useState<'todos' | 'today' | '7d' | 'this_month' | 'last_month' | 'custom'>('todos');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const isClient = currentUser?.role === 'cliente';
  const isAdminOrWarehouseOrSales = currentUser && ['superadmin', 'admin', 'gerencia', 'deposito', 'ventas'].includes(currentUser.role);
  
  const allowedStatuses: OrderStatus[] = ['Aprobado', 'En Preparación', 'Completado', 'Despachado', 'Entregado'];
  
  const ordersQuery = useMemoFirebase(() => {
    if (!isAdminOrWarehouseOrSales || !firestore) return null;
    const base = collection(firestore, 'orders');
    return query(base, where('status', 'in', allowedStatuses), limit(150));
  }, [firestore, isAdminOrWarehouseOrSales]);
  
  const { data: rawOrders, isLoading: isLoadingOrders } = useCollection<Order>(ordersQuery);

  const allOrders = useMemo(() => {
    if (!rawOrders) return [];
    if (dateFilter === 'todos') return rawOrders;

    const now = new Date();
    const startObj = startDate ? new Date(`${startDate}T00:00:00`) : null;
    const endObj = endDate ? new Date(`${endDate}T23:59:59`) : null;

    return rawOrders.filter(o => {
      const rawDate = o.orderDate || o.createdAt;
      if (!rawDate) return true;
      const d = typeof (rawDate as any).toDate === 'function' ? (rawDate as any).toDate() : new Date(rawDate as any);
      if (isNaN(d.getTime())) return true;

      if (dateFilter === 'custom') {
        if (startObj && !isNaN(startObj.getTime()) && d < startObj) return false;
        if (endObj && !isNaN(endObj.getTime()) && d > endObj) return false;
        return true;
      }
      if (dateFilter === 'today') return isSameDay(d, now);
      if (dateFilter === '7d') return d >= startOfDay(subDays(now, 6));
      if (dateFilter === 'this_month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      if (dateFilter === 'last_month') {
        const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear();
      }
      return true;
    });
  }, [rawOrders, dateFilter, startDate, endDate]);

  const columns = useMemo(() => {
    const groups: Record<OrderStatus, { orders: Order[], count: number, total: number }> = {
        'Borrador': { orders: [], count: 0, total: 0 },
        'Pendiente': { orders: [], count: 0, total: 0 },
        'Aprobado': { orders: [], count: 0, total: 0 },
        'En Preparación': { orders: [], count: 0, total: 0 },
        'Completado': { orders: [], count: 0, total: 0 },
        'Despachado': { orders: [], count: 0, total: 0 },
        'Entregado': { orders: [], count: 0, total: 0 },
        'Cancelado': { orders: [], count: 0, total: 0 },
        'En Verificación': { orders: [], count: 0, total: 0 },
        'Pagado': { orders: [], count: 0, total: 0 },
        'Rechazado': { orders: [], count: 0, total: 0 },
    };
    if (!allOrders) return groups;
    allOrders.forEach(o => {
        if (groups[o.status]) {
            groups[o.status].orders.push(o);
            groups[o.status].count++;
            groups[o.status].total += o.totalAmount;
        }
    });
    return groups;
  }, [allOrders]);

  const kpis = useMemo(() => ({
    warehouseTotal: (columns['Aprobado'].total + columns['En Preparación'].total + columns['Completado'].total),
    roadTotal: columns['Despachado'].total,
    deliveredTotal: columns['Entregado'].total
  }), [columns]);

  if (isUserLoading || !currentUser) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;
  
  // Vista específica para Clientes (Rastreo)
  if (isClient) return <ClientDispatchView />;

  return (
    <div className="flex flex-col gap-8 w-full pb-32 animate-in fade-in-50 duration-500">
      <header className="px-2 space-y-1">
        <h1 className="text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none italic">Logística de Red</h1>
        <p className="text-[10px] text-muted-foreground font-black uppercase tracking-[0.4em]">Control de Picking, Tránsito y Certificación de Entregas.</p>
      </header>

      {/* BARRA DE FILTROS DE PERÍODO */}
      <div className="flex flex-wrap items-center gap-2 px-2">
        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 mr-1">Periodo:</span>
        {[
          { id: 'todos', label: '🌐 Todo el Histórico' },
          { id: 'today', label: '☀️ Hoy' },
          { id: '7d', label: '⚡ Últimos 7 Días' },
          { id: 'this_month', label: '🗓️ Mes Actual' },
          { id: 'last_month', label: '📅 Mes Anterior' },
          { id: 'custom', label: '📆 Rango Personalizado' },
        ].map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => setDateFilter(p.id as any)}
            className={cn(
              "px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer border",
              dateFilter === p.id 
                ? "bg-slate-900 text-white border-slate-900 shadow-sm font-black" 
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 font-bold"
            )}
          >
            {p.label}
          </button>
        ))}

        {dateFilter === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 px-2.5 bg-white border border-slate-200 rounded-xl text-[10px] font-bold text-slate-700 focus:outline-none focus:border-primary"
            />
            <span className="text-slate-400 text-xs font-bold">a</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-8 px-2.5 bg-white border border-slate-200 rounded-xl text-[10px] font-bold text-slate-700 focus:outline-none focus:border-primary"
            />
          </div>
        )}
      </div>

      {/* Tablero de KPIs Interactivos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 px-2">
        <DashboardMetricCard 
            title="En Almacén" 
            value={`$${kpis.warehouseTotal.toLocaleString()}`} 
            icon={Package} iconBg="bg-indigo-50" iconColor="text-indigo-500" 
            isActive={activeKpi === 'warehouse'} 
            onClick={() => setActiveKpi(activeKpi === 'warehouse' ? 'todos' : 'warehouse')} 
        />
        <DashboardMetricCard 
            title="En Ruta" 
            value={`$${kpis.roadTotal.toLocaleString()}`} 
            icon={Truck} iconBg="bg-sky-50" iconColor="text-sky-500" 
            isActive={activeKpi === 'road'} 
            onClick={() => setActiveKpi(activeKpi === 'road' ? 'todos' : 'road')} 
        />
        <DashboardMetricCard 
            title="Entregado" 
            value={`$${kpis.deliveredTotal.toLocaleString()}`} 
            icon={ShieldCheck} iconBg="bg-emerald-50" iconColor="text-emerald-500" 
            isActive={activeKpi === 'delivered'} 
            onClick={() => setActiveKpi(activeKpi === 'delivered' ? 'todos' : 'delivered')} 
        />
      </div>

      <div className="flex-1 px-2">
        <AdminDispatchKanban 
            groups={columns as any} 
            onOpenDialog={(type, order, status) => setDialogState({ type, order, targetStatus: status })} 
            // Al hacer clic en la tarjeta, abrimos la terminal de detalles
            onNavigateToDetails={(o) => setDialogState({ type: 'details', order: o })} 
            activeKpi={activeKpi}
        />
      </div>

      {/* Orquestador de Diálogos y Terminales */}
      {dialogState.order && (
        <>
          <DispatchOrderDialog order={dialogState.order} isOpen={dialogState.type === 'dispatch'} onOpenChange={open => !open && setDialogState({ type: null, order: null })} />
          <ConfirmDeliveryDialog order={dialogState.order} isOpen={dialogState.type === 'confirmDelivery'} onOpenChange={open => !open && setDialogState({ type: null, order: null })} />
          <ConfirmStatusChangeDialog order={dialogState.order} newStatus={dialogState.targetStatus} isOpen={dialogState.type === 'confirmStatus'} onOpenChange={open => !open && setDialogState({ type: null, order: null })} />
          <CompletePackingDialog order={dialogState.order} isOpen={dialogState.type === 'completePacking'} onOpenChange={open => !open && setDialogState({ type: null, order: null })} />
          <UpdateOrderStatusDialog order={dialogState.order} isOpen={dialogState.type === 'status'} onOpenChange={open => !open && setDialogState({ type: null, order: null })} />
          
          {/* Terminal Maestra de Logística (Detalles, Fotos, Picking) */}
          {dialogState.type === 'details' && (
              <OrderSheetController 
                order={dialogState.order} 
                onOpenChange={open => !open && setDialogState({ type: null, order: null })} 
              />
          )}
        </>
      )}
    </div>
  );
}

export default function DispatchPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
            <DispatchPageContent />
        </Suspense>
    );
}