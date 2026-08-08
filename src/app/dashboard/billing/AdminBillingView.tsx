
'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ReportPaymentDialog } from './report-payment-dialog';
import type { Invoice, Order, OrderStatus } from '@/lib/definitions';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, limit, orderBy } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
    Search, 
    FileWarning, 
    Wallet, 
    Loader2, 
    TrendingUp, 
    X, 
    User2,
    Sparkles,
    Info,
    MessageSquare,
    Clock,
    Filter
} from 'lucide-react';
import { ConfirmPaymentDialog } from './register-payment-dialog';
import { getInvoiceFromOrder } from '@/lib/billing';
import { format } from 'date-fns';
import { OrderSheetController } from '../orders/OrderSheetController';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { DashboardMetricCard } from '@/components/dashboard/DashboardMetricCard';

export function AdminBillingView() {
  const firestore = useFirestore();
  const searchParams = useSearchParams();
  const { profile: currentUser, isUserLoading } = useUser();

  const [statusFilter, setStatusFilter] = useState('todos');
  const [salespersonFilter, setSalespersonFilter] = useState('todos');
  const [agingFilter, setAgingFilter] = useState('todos');
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  
  const isGlobalStaff = useMemo(() => currentUser && ['admin', 'superadmin', 'gerencia', 'deposito'].includes(currentUser.role), [currentUser]);

  const ordersCollection = useMemoFirebase(() => {
    if (!currentUser || !firestore) return null;
    const base = collection(firestore, 'orders');
    if (isGlobalStaff) return query(base, orderBy('updatedAt', 'desc'), limit(500));
    
    const filterField = currentUser.role === 'ventas' ? 'salespersonId' : 'customerId';
    const filterValue = currentUser.role === 'cliente' 
        ? (currentUser.associatedCustomerId || currentUser.id) 
        : currentUser.id;

    return query(base, where(filterField, '==', filterValue), limit(500));
  }, [firestore, currentUser, isGlobalStaff]);
  
  const { data: rawOrders, isLoading: isLoadingOrders } = useCollection<Order>(ordersCollection);

  useEffect(() => {
    const statusQuery = searchParams.get('status');
    if (statusQuery) setStatusFilter(statusQuery);
    const orderQuery = searchParams.get('orderId');
    if (orderQuery) {
      setSearchInput(orderQuery);
      setSearchTerm(orderQuery);
    }
  }, [searchParams]);

  const handleExecuteSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSearchTerm(searchInput.trim());
  };

  const handleClearSearchInput = () => {
    setSearchInput('');
    setSearchTerm('');
  };
  
  const allInvoices = useMemo(() => {
    if (!rawOrders) return [];
    const baseStatuses: OrderStatus[] = ['Entregado', 'En Verificación', 'Pagado', 'Despachado', 'Aprobado', 'En Preparación', 'Completado'];
    const filtered = rawOrders.filter(o => baseStatuses.includes(o.status));
    return filtered.map(getInvoiceFromOrder).filter(Boolean) as Invoice[];
  }, [rawOrders]);

  const uniqueSalespeople = useMemo(() => {
    if (!allInvoices) return [];
    return Array.from(new Set(allInvoices.map(i => i.salespersonName))).filter((sp): sp is string => Boolean(sp)).sort();
  }, [allInvoices]);
  
  const metrics = useMemo(() => {
    if (!rawOrders) return { vencido: 0, porVencer: 0, enVerificacion: 0, totalPorCobrar: 0, recaudado: 0 };
    return rawOrders.reduce((acc, order) => {
      const realCash = order.totalCashReceived ?? order.amountPaid ?? 0;
      acc.recaudado += realCash;
      const inv = getInvoiceFromOrder(order);
      if (!inv) return acc;
      if (inv.status === 'Vencido') acc.vencido += inv.remainingBalance;
      if (inv.status === 'Por Vencer') acc.porVencer += inv.remainingBalance;
      if (inv.status === 'En Verificación') acc.enVerificacion += inv.remainingBalance;
      if (inv.remainingBalance > 0.05 && inv.status !== 'Pagado') {
        acc.totalPorCobrar += inv.remainingBalance;
      }
      return acc;
    }, { vencido: 0, porVencer: 0, enVerificacion: 0, totalPorCobrar: 0, recaudado: 0 });
  }, [rawOrders]);

  const filteredInvoices = useMemo(() => {
    if (!allInvoices) return [];
    let items = allInvoices;
    
    if (statusFilter === 'pendientes') {
      items = items.filter(i => i.remainingBalance > 0.05 && i.status !== 'Pagado');
    } else if (statusFilter !== 'todos') {
      items = items.filter(i => i.status === statusFilter);
    }

    if (salespersonFilter !== 'todos') {
      items = items.filter(i => i.salespersonName === salespersonFilter);
    }

    if (agingFilter !== 'todos') {
      const now = Date.now();
      items = items.filter(i => {
        const createdDate = i.createdAt instanceof Date ? i.createdAt.getTime() : (i.createdAt as any)?.seconds ? (i.createdAt as any).seconds * 1000 : now;
        const daysOld = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));
        if (agingFilter === 'al_dia') return daysOld <= 7;
        if (agingFilter === 'vencimiento') return daysOld > 7 && daysOld <= 15;
        if (agingFilter === 'mora') return daysOld > 15 && daysOld <= 30;
        if (agingFilter === 'mora_critica') return daysOld > 30;
        return true;
      });
    }

    if (searchTerm) {
        const term = searchTerm.toLowerCase().trim();
        items = items.filter(i => 
          i.customerName.toLowerCase().includes(term) || 
          i.id.toLowerCase().includes(term) ||
          (i.salespersonName || '').toLowerCase().includes(term)
        );
    }
    return items;
  }, [allInvoices, statusFilter, salespersonFilter, agingFilter, searchTerm]);

  const filteredMetrics = useMemo(() => {
    const totalRemaining = filteredInvoices.reduce((sum, inv) => sum + inv.remainingBalance, 0);
    const countPending = filteredInvoices.filter(i => i.remainingBalance > 0.05).length;
    return { totalRemaining, countPending };
  }, [filteredInvoices]);

  const handleSendWhatsAppInvoiceReminder = (invoice: Invoice, order?: Order) => {
    const rawPhone = (order?.customerPhone || '').replace(/\D/g, '');
    const cleanPhone = rawPhone.length === 10 ? `58${rawPhone}` : rawPhone;

    const text = `*ATHLETICENTER C.A. - RECORDATORIO DE FACTURACIÓN Y PAGO*\n\n` +
      `Estimado(a) *${invoice.customerName}*,\n\n` +
      `Le saludamos del Departamento de Cobranzas. Le recordamos el estado de su expediente de facturación:\n\n` +
      `📄 *Expediente:* #${invoice.id.substring(0, 8).toUpperCase()}\n` +
      `💰 *Saldo Pendiente:* $${invoice.remainingBalance.toFixed(2)} USD\n` +
      `📅 *Estado:* ${invoice.statusText}\n\n` +
      `Por favor agradeceremos el envío de su comprobante de pago para proceder con la conciliación inmediata.\n\n` +
      `¡Muchas gracias por su preferencia!`;

    const url = cleanPhone 
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}` 
      : `https://wa.me/?text=${encodeURIComponent(text)}`;

    window.open(url, '_blank');
  };

  const handleClearFilters = () => {
      setStatusFilter('todos');
      setSalespersonFilter('todos');
      setAgingFilter('todos');
      setSearchTerm('');
  };

  if (isUserLoading || !currentUser) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>;

  return (
    <div className="w-full max-w-full mx-auto flex flex-col gap-8 pb-32 animate-in fade-in-50 duration-500">
      <header className="space-y-1 px-2">
        <h1 className="text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none italic">Cobranza y Facturación</h1>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em]">Auditoría de ingresos y conciliación de abonos de la red global.</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 px-2">
        <DashboardMetricCard title="Mora Crítica" value={`$${metrics.vencido.toLocaleString()}`} subtitle="Excedido +30D" icon={FileWarning} iconBg="bg-rose-50" iconColor="text-rose-500" onClick={() => setStatusFilter('Vencido')} isActive={statusFilter === 'Vencido'} />
        <DashboardMetricCard title="Total por Cobrar" value={`$${metrics.totalPorCobrar.toLocaleString()}`} subtitle="Cartera Total Pendiente" icon={Wallet} iconBg="bg-blue-50" iconColor="text-blue-500" onClick={() => setStatusFilter('pendientes')} isActive={statusFilter === 'pendientes'} />
        <DashboardMetricCard title="En Auditoría" value={`$${metrics.enVerificacion.toLocaleString()}`} subtitle="Abonos por Conciliar" icon={Sparkles} iconBg="bg-amber-50" iconColor="text-amber-500" onClick={() => setStatusFilter('En Verificación')} isActive={statusFilter === 'En Verificación'} />
        <DashboardMetricCard title="Efectivo Real" value={`$${metrics.recaudado.toLocaleString()}`} subtitle="Ingreso Neto (CASH)" icon={TrendingUp} iconBg="bg-emerald-50" iconColor="text-emerald-500" onClick={() => setStatusFilter('Pagado')} isActive={statusFilter === 'Pagado'} />
      </div>

      <div className="flex flex-col gap-6 w-full">
        {/* BARRA DE FILTROS AVANZADOS MULTIDIMENSIONAL */}
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 px-2">
            <div className="flex flex-wrap items-center gap-3 w-full">
                <form onSubmit={handleExecuteSearch} className="flex flex-1 min-w-[300px] items-center gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input 
                            placeholder="BUSCAR EXPEDIENTE #P-, CLIENTE O RIF..." 
                            className="pl-10 pr-9 h-11 bg-white border-slate-200 rounded-xl text-xs font-bold uppercase shadow-sm focus-visible:ring-2 focus-visible:ring-primary" 
                            value={searchInput} 
                            onChange={(e) => {
                                setSearchInput(e.target.value);
                                setSearchTerm(e.target.value);
                            }} 
                        />
                        {searchInput && (
                            <button 
                                type="button" 
                                onClick={handleClearSearchInput}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-md"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                    <Button 
                        type="submit" 
                        className="h-11 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-[10px] uppercase tracking-wider shadow-md shrink-0 flex items-center gap-1.5"
                    >
                        <Search className="h-3.5 w-3.5 text-primary" /> BUSCAR
                    </Button>
                </form>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-11 w-full sm:w-56 rounded-xl bg-white border-slate-200 font-bold text-[10px] uppercase shadow-sm"><SelectValue placeholder="Estado" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="todos" className="font-bold text-[10px] uppercase">ESTADO: TODOS</SelectItem>
                        <SelectItem value="pendientes" className="font-bold text-[10px] uppercase text-blue-600 font-black">PENDIENTES DE PAGO (TODAS)</SelectItem>
                        <SelectItem value="Por Vencer" className="font-bold text-[10px] uppercase">POR VENCER (AL DÍA)</SelectItem>
                        <SelectItem value="Vencido" className="font-bold text-[10px] uppercase text-rose-600 font-bold">VENCIDO (MORA CRÍTICA)</SelectItem>
                        <SelectItem value="En Verificación" className="font-bold text-[10px] uppercase text-amber-600">EN VERIFICACIÓN</SelectItem>
                        <SelectItem value="Pagado" className="font-bold text-[10px] uppercase text-emerald-600">PAGADO (FINALIZADO)</SelectItem>
                    </SelectContent>
                </Select>

                {isGlobalStaff && uniqueSalespeople.length > 0 && (
                    <Select value={salespersonFilter} onValueChange={setSalespersonFilter}>
                        <SelectTrigger className="h-11 w-full sm:w-48 rounded-xl bg-white border-slate-200 font-bold text-[10px] uppercase shadow-sm"><SelectValue placeholder="Asesor" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="todos" className="font-bold text-[10px] uppercase">ASESOR: TODOS</SelectItem>
                            {uniqueSalespeople.map(sp => <SelectItem key={sp} value={sp} className="font-bold text-[10px] uppercase">{sp.toUpperCase()}</SelectItem>)}
                        </SelectContent>
                    </Select>
                )}

                <Select value={agingFilter} onValueChange={setAgingFilter}>
                    <SelectTrigger className="h-11 w-full sm:w-48 rounded-xl bg-white border-slate-200 font-bold text-[10px] uppercase shadow-sm"><SelectValue placeholder="Antigüedad" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="todos" className="font-bold text-[10px] uppercase">ANTIGÜEDAD: TODAS</SelectItem>
                        <SelectItem value="al_dia" className="font-bold text-[10px] uppercase">AL DÍA (1-7 DÍAS)</SelectItem>
                        <SelectItem value="vencimiento" className="font-bold text-[10px] uppercase">VENCIMIENTO (8-15 DÍAS)</SelectItem>
                        <SelectItem value="mora" className="font-bold text-[10px] uppercase">EN MORA (16-30 DÍAS)</SelectItem>
                        <SelectItem value="mora_critica" className="font-bold text-[10px] uppercase">MORA CRÍTICA (+30 DÍAS)</SelectItem>
                    </SelectContent>
                </Select>

                {(statusFilter !== 'todos' || salespersonFilter !== 'todos' || agingFilter !== 'todos' || searchTerm) && (
                    <Button variant="ghost" size="sm" onClick={handleClearFilters} className="text-[9px] font-black uppercase text-rose-500 h-11 px-4 hover:bg-rose-50 rounded-xl">
                        Limpiar <X className="ml-1 h-3 w-3" />
                    </Button>
                )}
            </div>

            {/* RESUMEN DE RESULTADOS FILTRADOS */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-slate-900 text-white shadow-lg">
                <div className="flex items-center gap-3">
                    <Filter className="h-4 w-4 text-primary" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                        Resultados Filtrados: <span className="text-white font-bold">{filteredInvoices.length} expedientes</span>
                    </p>
                </div>
                <div className="flex items-center gap-6">
                    <div className="text-right">
                        <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 block">Deuda Pendiente Coincidente</span>
                        <span className="text-base font-black text-amber-400 tracking-tighter">${filteredMetrics.totalRemaining.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</span>
                    </div>
                </div>
            </div>
        </div>

        <div className="w-full px-2">
            <ScrollArea className="w-full whitespace-nowrap rounded-[2.5rem] border border-slate-100 shadow-xl bg-white">
                <div className="min-w-[1000px]">
                    <Table>
                        <TableHeader className="bg-slate-900">
                            <TableRow className="hover:bg-transparent border-none">
                                <TableHead className="text-[10px] font-black uppercase tracking-widest py-5 pl-8 text-white">Expediente</TableHead>
                                <TableHead className="text-[10px] font-black uppercase tracking-widest text-white">Entidad Comercial</TableHead>
                                <TableHead className="text-right text-[10px] font-black uppercase tracking-widest text-white">Saldo Pendiente</TableHead>
                                <TableHead className="text-center text-[10px] font-black uppercase tracking-widest text-white">Estado Cobro</TableHead>
                                <TableHead className="text-right text-[10px] font-black uppercase tracking-widest pr-8 text-white">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoadingOrders ? (
                                Array.from({ length: 5 }).map((_, i) => <TableRow key={i}><TableCell colSpan={5} className="py-8"><Skeleton className="h-10 w-full rounded-xl" /></TableCell></TableRow>)
                            ) : filteredInvoices.length > 0 ? filteredInvoices.map((invoice) => {
                                const orderForInvoice = rawOrders?.find(o => o.id === invoice.id);
                                const isPendingVerification = invoice.status === 'En Verificación';

                                return (
                                    <TableRow key={invoice.id} className="hover:bg-primary/5 cursor-pointer transition-all border-b group" onClick={() => orderForInvoice && setSelectedOrder(orderForInvoice)}>
                                        <TableCell className="py-6 pl-8">
                                            <div className="flex flex-col">
                                                <span className="font-mono text-[11px] font-black text-primary">#{invoice.id.substring(0, 8)}</span>
                                                <span className="text-[8px] font-bold text-slate-400 uppercase mt-1">Vence: {format(invoice.dueDate as any, 'dd/MM/yy')}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <Avatar className="h-10 w-10 rounded-xl border-2 border-white shadow-sm shrink-0">
                                                    <AvatarFallback className="bg-slate-100 text-slate-400 font-black text-[10px] uppercase">{invoice.customerName.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <div className="flex flex-col min-w-0">
                                                    <span className="font-black text-[12px] uppercase text-slate-900 leading-none truncate">{invoice.customerName}</span>
                                                    <span className="text-[8px] text-slate-400 font-bold uppercase mt-1.5 flex items-center gap-1.5"><User2 className="h-2.5 w-2.5" /> Asesor: {invoice.salespersonName}</span>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex flex-col items-end">
                                                <span className={cn("font-black text-lg tracking-tighter", invoice.remainingBalance > 0 ? "text-slate-900" : "text-emerald-600")}>
                                                    ${invoice.remainingBalance.toFixed(2)}
                                                </span>
                                                <span className="text-[8px] font-bold text-slate-400 uppercase">Monto BI</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Badge className={cn(
                                                "text-[8px] font-black uppercase border-none px-2.5 h-5 shadow-none", 
                                                invoice.status === 'Pagado' ? 'bg-emerald-100 text-emerald-700' : 
                                                invoice.status === 'Vencido' ? 'bg-rose-100 text-rose-700' : 
                                                invoice.status === 'En Verificación' ? 'bg-blue-100 text-blue-700 animate-pulse' :
                                                'bg-amber-100 text-amber-700'
                                            )}>
                                                {invoice.statusText}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right pr-8" onClick={(e) => e.stopPropagation()}>
                                            <div className="flex items-center justify-end gap-2">
                                                {isPendingVerification && orderForInvoice && isGlobalStaff && (
                                                    <ConfirmPaymentDialog order={orderForInvoice} />
                                                )}
                                                {invoice.remainingBalance > 0.05 && (
                                                    <div className="flex gap-2">
                                                        <Button 
                                                            variant="outline" 
                                                            size="sm" 
                                                            className="h-9 px-3 rounded-xl border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-black text-[9px] uppercase tracking-wider"
                                                            onClick={() => handleSendWhatsAppInvoiceReminder(invoice, orderForInvoice)}
                                                        >
                                                            <MessageSquare className="h-3.5 w-3.5 text-emerald-600 mr-1" /> WhatsApp
                                                        </Button>
                                                        <ReportPaymentDialog invoice={invoice} mode="partial" />
                                                        <ReportPaymentDialog invoice={invoice} mode="total" />
                                                    </div>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            }) : (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-60 text-center flex flex-col items-center justify-center gap-4 opacity-30">
                                        <Info className="h-12 w-12 text-slate-300" />
                                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Sin registros financieros.</p>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
                <ScrollBar orientation="horizontal" className="bg-slate-50 h-3" />
            </ScrollArea>
        </div>
      </div>

      {selectedOrder && (
        <OrderSheetController 
            order={selectedOrder} 
            onOpenChange={(open) => !open && setSelectedOrder(null)} 
        />
      )}
    </div>
  );
}
