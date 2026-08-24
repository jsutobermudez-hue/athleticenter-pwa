
'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
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
    Filter,
    Download,
    ShoppingCart,
    CheckCircle2,
    Banknote
} from 'lucide-react';
import { ConfirmPaymentDialog } from './register-payment-dialog';
import { getInvoiceFromOrder, calculateGlobalFinancialMetrics } from '@/lib/billing';
import { CashAuditModal } from '@/components/dashboard/CashAuditModal';
import { format } from 'date-fns';
import { OrderSheetController } from '../orders/OrderSheetController';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { DashboardMetricCard } from '@/components/dashboard/DashboardMetricCard';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Printer, Send } from 'lucide-react';
import { generatePaymentReceiptPDF } from '@/lib/pdf-generator';

import { doc } from 'firebase/firestore';
import { useDoc } from '@/firebase';
import type { FinancialSettings } from '@/lib/definitions';

export function AdminBillingView() {
  const firestore = useFirestore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile: currentUser, isUserLoading } = useUser();

  const settingsRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
  const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);
  const bcvRate = globalSettings?.bcvRate || 65.50;

  const [statusFilter, setStatusFilter] = useState('todos');
  const [salespersonFilter, setSalespersonFilter] = useState('todos');
  const [agingFilter, setAgingFilter] = useState('todos');
  const [dateFilter, setDateFilter] = useState<'todos' | 'today' | '7d' | 'this_month' | 'last_month' | 'custom'>('todos');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedInvoiceForPayment, setSelectedInvoiceForPayment] = useState<Invoice | null>(null);
  const [selectedOrderForSheet, setSelectedOrderForSheet] = useState<Order | null>(null);
  const [isCashAuditModalOpen, setIsCashAuditModalOpen] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  
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
      // Limpiar filtros para garantizar que la factura sea visible
      setStatusFilter('todos');
      setDateFilter('todos');
      setAgingFilter('todos');
      setSalespersonFilter('todos');
      
      const cleanTerm = orderQuery.replace('#', '').trim();
      setSearchInput(cleanTerm);
      setSearchTerm(cleanTerm);
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

  // AUTO-DISPARO DE MODAL DE PAGO SI VIENE orderId EN LA URL
  useEffect(() => {
    const orderQuery = searchParams.get('orderId');
    if (orderQuery && allInvoices.length > 0 && !selectedInvoiceForPayment) {
      const cleanTerm = orderQuery.replace('#', '').trim().toLowerCase();
      const targetInvoice = allInvoices.find(i => 
        i.id.toLowerCase() === cleanTerm ||
        i.id.toLowerCase().startsWith(cleanTerm) ||
        cleanTerm.includes(i.id.toLowerCase())
      );
      if (targetInvoice) {
        setSelectedInvoiceForPayment(targetInvoice);
      }
    }
  }, [searchParams, allInvoices, selectedInvoiceForPayment]);

  const uniqueSalespeople = useMemo(() => {
    if (!allInvoices) return [];
    return Array.from(new Set(allInvoices.map(i => i.salespersonName))).filter((sp): sp is string => Boolean(sp)).sort();
  }, [allInvoices]);
  
  const metrics = useMemo(() => {
    if (!rawOrders) return { 
      vencido: 0, porVencer: 0, enVerificacion: 0, totalPorCobrar: 0, recaudado: 0,
      totalOrdersCount: 0, totalOrdersAmount: 0, liquidadosCount: 0, liquidadosAmount: 0
    };
    const globalMetrics = calculateGlobalFinancialMetrics(rawOrders, dateFilter as any);
    return {
      vencido: globalMetrics.vencido,
      porVencer: globalMetrics.porVencer,
      enVerificacion: globalMetrics.enVerificacion,
      totalPorCobrar: globalMetrics.totalDebts,
      recaudado: globalMetrics.recaudadoCash,
      totalOrdersCount: globalMetrics.totalOrdersCount,
      totalOrdersAmount: globalMetrics.totalOrdersAmount,
      liquidadosCount: globalMetrics.liquidadosCount,
      liquidadosAmount: globalMetrics.liquidadosAmount
    };
  }, [rawOrders, dateFilter]);

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
        const startDate = i.creditStartDate instanceof Date 
          ? i.creditStartDate 
          : i.createdAt instanceof Date 
            ? i.createdAt 
            : (i.createdAt as any)?.seconds 
              ? new Date((i.createdAt as any).seconds * 1000) 
              : new Date();
        const daysOld = Math.max(0, Math.floor((now - startDate.getTime()) / (1000 * 60 * 60 * 24)));
        if (agingFilter === 'al_dia') return daysOld <= 7;
        if (agingFilter === 'vencimiento') return daysOld > 7 && daysOld <= 15;
        if (agingFilter === 'mora') return daysOld > 15 && daysOld <= 30;
        if (agingFilter === 'mora_critica') return daysOld > 30;
        return true;
      });
    }

    if (dateFilter !== 'todos') {
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      items = items.filter(i => {
        let iDate: Date | null = null;
        if ((i as any).issueDate) iDate = new Date((i as any).issueDate);
        else if (i.creditStartDate) iDate = i.creditStartDate instanceof Date ? i.creditStartDate : new Date(i.creditStartDate);
        else if (i.createdAt) {
          if (i.createdAt instanceof Date) iDate = i.createdAt;
          else if ((i.createdAt as any).seconds) iDate = new Date((i.createdAt as any).seconds * 1000);
          else iDate = new Date(i.createdAt as any);
        }
        if (!iDate || isNaN(iDate.getTime())) return true;
        if (dateFilter === 'custom') {
          const startObj = startDate ? new Date(`${startDate}T00:00:00`) : null;
          const endObj = endDate ? new Date(`${endDate}T23:59:59`) : null;
          if (startObj && !isNaN(startObj.getTime()) && iDate < startObj) return false;
          if (endObj && !isNaN(endObj.getTime()) && iDate > endObj) return false;
          return true;
        }
        if (dateFilter === 'today') {
          return iDate.getDate() === now.getDate() && iDate.getMonth() === currentMonth && iDate.getFullYear() === currentYear;
        }
        if (dateFilter === '7d') {
          const start7d = new Date();
          start7d.setDate(now.getDate() - 7);
          return iDate >= start7d;
        }
        if (dateFilter === 'this_month') {
          return iDate.getMonth() === currentMonth && iDate.getFullYear() === currentYear;
        }
        if (dateFilter === 'last_month') {
          const lastM = currentMonth === 0 ? 11 : currentMonth - 1;
          const lastY = currentMonth === 0 ? currentYear - 1 : currentYear;
          return iDate.getMonth() === lastM && iDate.getFullYear() === lastY;
        }
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
  }, [allInvoices, statusFilter, salespersonFilter, agingFilter, dateFilter, searchTerm]);

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
    setDateFilter('todos');
    setSearchTerm('');
    setSearchInput('');
  };

  const totalFilteredSalesUSD = useMemo(() => filteredInvoices.reduce((sum, i) => sum + i.amountTotal, 0), [filteredInvoices]);
  const totalFilteredPendingUSD = useMemo(() => filteredInvoices.reduce((sum, i) => sum + i.remainingBalance, 0), [filteredInvoices]);

  const exportInvoicesToCSV = () => {
    if (!filteredInvoices || filteredInvoices.length === 0) return;
    const bcvRate = 65.50;
    const headers = ['Expediente ID', 'Cliente', 'Asesor Comercial', 'Estado', 'Monto Total USD', 'Saldo Pendiente USD', 'Monto Total Bs (BCV)', 'Saldo Pendiente Bs (BCV)'];
    const rows = filteredInvoices.map(i => [
      i.id,
      `"${(i.customerName || '').replace(/"/g, '""')}"`,
      `"${(i.salespersonName || 'Directo').replace(/"/g, '""')}"`,
      i.statusText || i.status,
      i.amountTotal.toFixed(2),
      i.remainingBalance.toFixed(2),
      (i.amountTotal * bcvRate).toFixed(2),
      (i.remainingBalance * bcvRate).toFixed(2)
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Facturas_Athleticenter_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportInvoicesToPDF = () => {
    if (!filteredInvoices || filteredInvoices.length === 0) return;
    setIsExportingPDF(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, 210, 34, 'F');
      doc.setFontSize(15);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text('ATHLETICENTER PRO C.A.', 14, 15);
      doc.setFontSize(9);
      doc.text('INFORME AUDITADO DE FACTURACIÓN Y COBRANZAS', 14, 22);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.text(`TASA OFICIAL BCV: Bs. ${bcvRate.toFixed(2)} / USD  •  EMISIÓN: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 28);
      
      const filterDetails = `Estado: ${statusFilter.toUpperCase()} | Vendedor: ${salespersonFilter === 'todos' ? 'TODOS' : salespersonFilter} | Antigüedad: ${agingFilter.toUpperCase()} | Período: ${dateFilter.toUpperCase()}`;
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(14, 37, 182, 9, 2, 2, 'F');
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(51, 65, 85);
      doc.text(`FILTROS EN PANTALLA: ${filterDetails}`, 18, 43);
      
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(14, 50, 58, 18, 3, 3, 'F');
      doc.roundedRect(76, 50, 58, 18, 3, 3, 'F');
      doc.roundedRect(138, 50, 58, 18, 3, 3, 'F');
      doc.setFontSize(7);
      doc.setTextColor(15, 23, 42);
      doc.text('EXPEDIENTES FILTRADOS', 18, 55);
      doc.setFontSize(11);
      doc.text(`${filteredInvoices.length}`, 18, 64);
      doc.setFontSize(7);
      doc.setTextColor(37, 99, 235);
      doc.text('TOTAL FACTURADO ($)', 80, 55);
      doc.setFontSize(10);
      doc.text(`$${totalFilteredSalesUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 80, 64);
      doc.setFontSize(7);
      doc.setTextColor(225, 29, 72);
      doc.text('SALDO PENDIENTE ($ USD)', 142, 55);
      doc.setFontSize(10);
      doc.text(`$${totalFilteredPendingUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 142, 64);
      
      const tableRows = filteredInvoices.map(i => [
        `#${i.id.substring(0, 8).toUpperCase()}`,
        i.customerName || 'Cliente General',
        i.salespersonName || 'Directo',
        i.statusText || i.status,
        `$${i.amountTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        `$${i.remainingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        `Bs. ${(i.remainingBalance * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`
      ]);
      autoTable(doc, {
        startY: 72,
        head: [['EXPEDIENTE', 'CLIENTE / RAZÓN SOCIAL', 'VENDEDOR', 'ESTADO COBRO', 'TOTAL ($)', 'SALDO PEND. ($)', 'SALDO PEND. (Bs BCV)']],
        body: tableRows,
        styles: { fontSize: 7.5, cellPadding: 2.5, font: 'helvetica' },
        headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] }
      });
      doc.autoPrint();
      window.open(doc.output('bloburl'), '_blank');
    } catch (e) { console.error(e); } finally { setIsExportingPDF(false); }
  };

  const handleSendSalespersonPDFReport = () => {
    if (salespersonFilter === 'todos') return;
    window.open(`/api/reports/salesperson-receivables-pdf?salespersonId=${salespersonFilter}`, '_blank');
  };

  if (isUserLoading || !currentUser) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>;

  return (
    <div className="w-full max-w-full mx-auto flex flex-col gap-8 pb-32 animate-in fade-in-50 duration-500">
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 px-2">
        <div className="space-y-1">
          <h1 className="text-3xl font-black uppercase tracking-tight text-slate-900 leading-none">Cobranza y Facturación</h1>
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Auditoría de ingresos y conciliación de abonos de la red global</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button onClick={() => setIsCashAuditModalOpen(true)} className="h-10 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase tracking-wider shadow-md transition-all active:scale-95 flex items-center gap-1.5">
            <Banknote className="h-4 w-4" /> Pagos Registrados
          </Button>
          <Button onClick={exportInvoicesToPDF} disabled={isExportingPDF} className="h-10 px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-black uppercase tracking-wider shadow-md transition-all active:scale-95 flex items-center gap-1.5">
            {isExportingPDF ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4 text-emerald-400" />} Imprimir PDF
          </Button>
          {salespersonFilter !== 'todos' && (
            <Button onClick={handleSendSalespersonPDFReport} className="h-10 px-4 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-wider shadow-md transition-all active:scale-95 flex items-center gap-1.5">
              <Send className="h-4 w-4" /> Enviar PDF a Vendedor
            </Button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 px-2">
        <DashboardMetricCard title="Mora Crítica" value={`$${metrics.vencido.toLocaleString()}`} subtitle="Excedido +30D" icon={FileWarning} iconBg="bg-rose-50" iconColor="text-rose-500" onClick={() => setStatusFilter('Vencido')} isActive={statusFilter === 'Vencido'} tooltip="Facturas con vencimiento mayor a 30 días en crédito." />
        <DashboardMetricCard title="Total por Cobrar" value={`$${metrics.totalPorCobrar.toLocaleString()}`} subtitle="Deuda Activa Clientes" icon={Wallet} iconBg="bg-blue-50" iconColor="text-blue-500" onClick={() => setStatusFilter('pendientes')} isActive={statusFilter === 'pendientes'} tooltip="Saldo pendiente neto por cobrar a la red de clientes." />
        <DashboardMetricCard title="En Auditoría" value={`$${metrics.enVerificacion.toLocaleString()}`} subtitle="Abonos por Conciliar" icon={Sparkles} iconBg="bg-amber-50" iconColor="text-amber-500" onClick={() => setStatusFilter('En Verificación')} isActive={statusFilter === 'En Verificación'} tooltip="Abonos registrados pendientes de verificación en caja." />
        <DashboardMetricCard title="Efectivo Real" value={`$${metrics.recaudado.toLocaleString()}`} subtitle="Ingreso Neto (CASH)" icon={TrendingUp} iconBg="bg-emerald-50" iconColor="text-emerald-500" onClick={() => setStatusFilter('Pagado')} isActive={statusFilter === 'Pagado'} tooltip="Recaudación total en efectivo o divisas efectivamente liquidada." />
        <DashboardMetricCard title="Pedidos Realizados" value={`${metrics.totalOrdersCount} Pedidos`} subtitle={`$${metrics.totalOrdersAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })} Registrados`} icon={ShoppingCart} iconBg="bg-indigo-50" iconColor="text-indigo-500" onClick={() => router.push('/dashboard/orders')} tooltip="Volumen total de pedidos registrados. Haz clic para ir al módulo de pedidos." />
      </div>

      <div className="flex flex-col gap-6 w-full">
        {/* BARRA DE FILTROS AVANZADOS MULTIDIMENSIONAL */}
        <div className="flex flex-col gap-4 border-b border-slate-200/80 pb-6 px-2">
            {/* FILTROS RÁPIDOS DE PERÍODOS DE VENTA */}
            <div className="flex flex-wrap items-center gap-2 pb-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mr-2">Periodo Facturado:</span>
                {[
                    { id: 'todos', label: 'Todo el Histórico' },
                    { id: 'today', label: 'Hoy' },
                    { id: '7d', label: 'Últimos 7 Días' },
                    { id: 'this_month', label: 'Mes Actual' },
                    { id: 'last_month', label: 'Mes Anterior' },
                    { id: 'custom', label: 'Rango Personalizado' },
                ].map(p => (
                    <button
                        key={p.id}
                        type="button"
                        onClick={() => setDateFilter(p.id as any)}
                        className={cn(
                            "px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer border shadow-2xs",
                            dateFilter === p.id 
                                ? "bg-slate-900 text-white border-slate-900 shadow-sm font-black" 
                                : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 font-bold"
                        )}
                    >
                        {p.label}
                    </button>
                ))}
            {dateFilter === 'custom' && (
                <div className="flex flex-wrap items-center gap-3 mt-2 p-3 bg-slate-50 border border-slate-200/80 rounded-2xl animate-in fade-in-50 duration-300">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Fecha Desde:</span>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="h-9 px-3 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 shadow-2xs"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Fecha Hasta:</span>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="h-9 px-3 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 shadow-2xs"
                        />
                    </div>
                    {(startDate || endDate) && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setStartDate(''); setEndDate(''); }}
                            className="h-9 px-3 text-[10px] font-black uppercase text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                        >
                            Limpiar Fechas
                        </Button>
                    )}
                </div>
            )}
            </div>

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
            <div className="w-full rounded-[2.5rem] border border-slate-100 shadow-xl bg-white overflow-hidden">
                <div className="w-full overflow-x-auto">
                    <Table className="w-full">
                        <TableHeader className="bg-slate-900">
                            <TableRow className="hover:bg-transparent border-none">
                                <TableHead className="text-[10px] font-black uppercase tracking-widest py-4 pl-6 text-white w-28">Expediente</TableHead>
                                <TableHead className="text-[10px] font-black uppercase tracking-widest text-white min-w-[180px]">Entidad Comercial</TableHead>
                                <TableHead className="text-right text-[10px] font-black uppercase tracking-widest text-white min-w-[150px]">Saldo Pendiente</TableHead>
                                <TableHead className="text-center text-[10px] font-black uppercase tracking-widest text-white min-w-[130px]">Estado Cobro</TableHead>
                                <TableHead className="text-right text-[10px] font-black uppercase tracking-widest pr-6 text-white min-w-[200px]">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoadingOrders ? (
                                Array.from({ length: 5 }).map((_, i) => <TableRow key={i}><TableCell colSpan={5} className="py-8"><Skeleton className="h-10 w-full rounded-xl" /></TableCell></TableRow>)
                            ) : filteredInvoices.length > 0 ? filteredInvoices.map((invoice) => {
                                const orderForInvoice = rawOrders?.find(o => o.id === invoice.id);
                                const isPendingVerification = invoice.status === 'En Verificación';

                                return (
                                    <TableRow key={invoice.id} className="hover:bg-primary/5 cursor-pointer transition-all border-b group" onClick={() => orderForInvoice && setSelectedOrderForSheet(orderForInvoice)}>
                                        <TableCell className="py-4 pl-6">
                                            <div className="flex flex-col">
                                                <span className="font-mono text-[11px] font-black text-primary">#{invoice.id.substring(0, 8)}</span>
                                                <span className="text-[8px] font-bold text-slate-400 uppercase mt-0.5">Vence: {format(invoice.dueDate as any, 'dd/MM/yy')}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="py-4">
                                            <div className="flex items-center gap-3">
                                                <Avatar className="h-9 w-9 rounded-xl border-2 border-white shadow-sm shrink-0">
                                                    <AvatarFallback className="bg-slate-100 text-slate-400 font-black text-[10px] uppercase">{invoice.customerName.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <div className="flex flex-col min-w-0">
                                                    <span className="font-black text-[12px] uppercase text-slate-900 leading-none truncate">{invoice.customerName}</span>
                                                    <span className="text-[8px] text-slate-400 font-bold uppercase mt-1 flex items-center gap-1.5"><User2 className="h-2.5 w-2.5" /> Asesor: {invoice.salespersonName}</span>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right py-4">
                                            <div className="flex flex-col items-end gap-1">
                                                <span className={cn("font-black text-base tracking-tighter", invoice.remainingBalance <= 0.05 ? "text-emerald-600 font-extrabold" : "text-slate-900")}>
                                                    ${invoice.remainingBalance.toFixed(2)}
                                                </span>
                                                {(() => {
                                                    const paidPct = invoice.amountTotal > 0 ? Math.min(100, Math.round((invoice.amountPaid / invoice.amountTotal) * 100)) : 0;
                                                    return (
                                                        <div className="flex flex-col items-end gap-0.5">
                                                            <div className="flex items-center gap-1 text-[8px] font-bold text-slate-400 uppercase">
                                                                <span>${invoice.amountPaid.toFixed(2)} de ${invoice.amountTotal.toFixed(2)}</span>
                                                                <span className="font-black text-slate-700">({paidPct}%)</span>
                                                            </div>
                                                            <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                                                                <div className={cn("h-full transition-all duration-500 rounded-full", paidPct >= 100 ? "bg-emerald-500" : "bg-blue-500")} style={{ width: `${paidPct}%` }} />
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center py-4">
                                            <Badge className={cn(
                                                "text-[9px] font-black uppercase border px-3 py-1 shadow-none rounded-xl whitespace-nowrap", 
                                                invoice.remainingBalance <= 0.05 ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 
                                                invoice.status === 'Vencido' ? 'bg-rose-50 text-rose-700 border-rose-300' : 
                                                invoice.status === 'En Verificación' ? 'bg-amber-50 text-amber-800 border-amber-300 animate-pulse' :
                                                'bg-blue-50 text-blue-700 border-blue-300'
                                            )}>
                                                {invoice.remainingBalance <= 0.05 ? '🎉 TOTALMENTE PAGADO' : invoice.statusText}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right pr-6 py-4" onClick={(e) => e.stopPropagation()}>
                                            <div className="flex items-center justify-end gap-2">
                                                {isPendingVerification && orderForInvoice && isGlobalStaff && (
                                                    <ConfirmPaymentDialog order={orderForInvoice} />
                                                )}
                                                {invoice.remainingBalance > 0.05 ? (
                                                    <div className="flex gap-2">
                                                        <Button 
                                                            variant="outline" 
                                                            size="sm" 
                                                            className="h-8 px-2.5 rounded-xl border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-black text-[9px] uppercase tracking-wider"
                                                            onClick={() => handleSendWhatsAppInvoiceReminder(invoice, orderForInvoice)}
                                                        >
                                                            <MessageSquare className="h-3 w-3 text-emerald-600 mr-1" /> WhatsApp
                                                        </Button>
                                                        <ReportPaymentDialog invoice={invoice} mode="partial" />
                                                        <ReportPaymentDialog invoice={invoice} mode="total" />
                                                    </div>
                                                ) : (
                                                    <div className="flex gap-2">
                                                        <Button 
                                                            variant="outline" 
                                                            size="sm" 
                                                            className="h-8 px-2.5 rounded-xl border-slate-200 bg-slate-900 text-white hover:bg-slate-800 font-black text-[9px] uppercase tracking-wider shadow-sm flex items-center gap-1"
                                                            onClick={() => generatePaymentReceiptPDF({
                                                                payment: { amount: invoice.amountTotal, method: 'Transferencia Bancaria', paymentDate: new Date() },
                                                                order: orderForInvoice || { id: invoice.id, customerName: invoice.customerName, totalAmount: invoice.amountTotal }
                                                            })}
                                                        >
                                                            <Printer className="h-3 w-3 text-emerald-400" /> Recibo PDF
                                                        </Button>
                                                        <Button 
                                                            variant="outline" 
                                                            size="sm" 
                                                            className="h-8 px-2.5 rounded-xl border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-black text-[9px] uppercase tracking-wider"
                                                            onClick={() => handleSendWhatsAppInvoiceReminder(invoice, orderForInvoice)}
                                                        >
                                                            <MessageSquare className="h-3.5 w-3.5 text-emerald-600 mr-1" /> WhatsApp Solvente
                                                        </Button>
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
            </div>

            {/* RESUMEN DINÁMICO AL PIE DE LA TABLA */}
            <div className="bg-slate-900 text-white p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono font-bold mt-2 shadow-lg">
              <span className="text-[10px] uppercase font-black tracking-widest text-slate-400">
                Mostrando <span className="text-white font-bold">{filteredInvoices.length}</span> expedientes de facturación seleccionados
              </span>
              <div className="flex flex-wrap items-center gap-4 text-[11px]">
                <span>Total Facturado: <span className="text-emerald-400 font-black">${totalFilteredSalesUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD</span> <span className="text-slate-400 text-[9px]">(Bs. {(totalFilteredSalesUSD * 65.50).toLocaleString('es-VE', { minimumFractionDigits: 2 })})</span></span>
                <span>Saldo Pendiente: <span className="text-amber-400 font-black">${totalFilteredPendingUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD</span></span>
              </div>
            </div>
        </div>
      </div>

      {selectedOrderForSheet && (
        <OrderSheetController 
            order={selectedOrderForSheet} 
            onOpenChange={(open) => !open && setSelectedOrderForSheet(null)} 
        />
      )}

      {selectedInvoiceForPayment && (
        <ReportPaymentDialog
            invoice={selectedInvoiceForPayment}
            mode="partial"
        />
      )}

      <CashAuditModal
        isOpen={isCashAuditModalOpen}
        onClose={() => setIsCashAuditModalOpen(false)}
        orders={rawOrders}
        periodFilter={dateFilter === 'todos' ? 'all' : dateFilter}
        bcvRate={bcvRate}
      />
    </div>
  );
}
