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

export const dynamic = 'force-dynamic';

/**
 * PÁGINA DE DESPACHO v5.0.0 - RECONEXIÓN TÁCTICA
 * Saneado: Se activa el OrderSheetController para permitir ver detalles al hacer clic en tarjetas.
 */
function DispatchPageContent() {
  const { profile: currentUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const searchParams = useSearchParams();
  
  // Estado para controlar qué diálogo o terminal se abre
  const [dialogState, setDialogState] = useState<{ 
    type: 'dispatch' | 'confirmDelivery' | 'confirmStatus' | 'status' | 'completePacking' | 'details' | null; 
    order: Order | null; 
    targetStatus?: OrderStatus; 
  }>({ type: null, order: null });

  const [activeKpi, setActiveKpi] = useState<'warehouse' | 'road' | 'delivered' | 'todos'>('todos');

  const isClient = currentUser?.role === 'cliente';
  const isAdminOrWarehouseOrSales = currentUser && ['superadmin', 'admin', 'gerencia', 'deposito', 'ventas'].includes(currentUser.role);
  
  const allowedStatuses: OrderStatus[] = ['Aprobado', 'En Preparación', 'Completado', 'Despachado', 'Entregado'];
  
  const ordersQuery = useMemoFirebase(() => {
    if (!isAdminOrWarehouseOrSales || !firestore) return null;
    const base = collection(firestore, 'orders');
    // Cargamos pedidos en fases logísticas activas
    return query(base, where('status', 'in', allowedStatuses), limit(150));
  }, [firestore, isAdminOrWarehouseOrSales]);
  
  const { data: allOrders, isLoading: isLoadingOrders } = useCollection<Order>(ordersQuery);

  const columns = useMemo(() => {
    const groups: Record<OrderStatus, { orders: Order[], count: number, total: number }> = {
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