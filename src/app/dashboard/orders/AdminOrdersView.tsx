'use client';

import React, { useMemo, useState } from 'react';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import type { Order, OrderStatus } from '@/lib/definitions';
import { Skeleton } from '@/components/ui/skeleton';
import { OrderCard } from './OrderCard';
import { OrderSheetController } from './OrderSheetController';
import { Card, CardContent } from '@/components/ui/card';
import { 
    Search, 
    Clock, 
    Package, 
    Truck, 
    History, 
    CreditCard, 
    SortAsc, 
    SortDesc, 
    Save, 
    AlertTriangle, 
    MessageCircle, 
    ShieldCheck, 
    Loader2, 
    Plus, 
    DollarSign, 
    Wallet, 
    ArrowUpRight, 
    Download,
    Printer,
    Send,
    LayoutGrid,
    Columns3,
    Table as TableIcon,
    FileText,
    Eye,
    User2,
    Filter,
    Info
} from 'lucide-react';
import { format } from 'date-fns';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import { getInvoiceFromOrder } from '@/lib/billing';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const ALL_STATUSES: OrderStatus[] = ['Borrador', 'Pendiente', 'Aprobado', 'En Preparación', 'Completado', 'Despachado', 'Entregado', 'En Verificación', 'Pagado', 'Cancelado'];

function DashboardMetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconBg,
  iconColor,
  onClick,
  isActive
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  onClick?: () => void;
  isActive?: boolean;
}) {
  return (
    <Card 
      onClick={onClick}
      className={cn(
        "border-none shadow-sm rounded-2xl bg-white p-5 flex items-center justify-between transition-all cursor-pointer hover:shadow-md hover:-translate-y-0.5",
        isActive && "ring-2 ring-primary bg-primary/5"
      )}
    >
      <div className="space-y-1">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</p>
        <h3 className="text-2xl font-black uppercase tracking-tight text-slate-900">{value}</h3>
        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{subtitle}</p>
      </div>
      <div className={cn("p-3 rounded-2xl shrink-0 shadow-sm", iconBg, iconColor)}>
        <Icon className="h-6 w-6" />
      </div>
    </Card>
  );
}

import { doc } from 'firebase/firestore';
import { useDoc } from '@/firebase';
import type { FinancialSettings } from '@/lib/definitions';

export default function AdminOrdersView() {
    const firestore = useFirestore();
    const { profile: currentUser } = useUser();

    const settingsRef = useMemoFirebase(() => firestore ? doc(firestore, 'system', 'financials') : null, [firestore]);
    const { data: globalSettings } = useDoc<FinancialSettings>(settingsRef);
    const bcvRate = globalSettings?.bcvRate || 65.50;

    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<OrderStatus | 'todos'>('todos');
    const [salespersonFilter, setSalespersonFilter] = useState('todos');
    const [sortBy, setSortBy] = useState<'orderDate' | 'totalAmount'>('orderDate');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [openSections, setOpenSections] = useState<string[]>([]);
    
    const [queryLimit, setQueryLimit] = useState(100);
    const [activeTab, setActiveTab] = useState<'todos' | 'comercial' | 'operativo' | 'logistica' | 'cobranzas' | 'archivo'>('todos');
    const [dateFilter, setDateFilter] = useState<'todos' | 'today' | '7d' | 'this_month' | 'last_month' | 'custom'>('todos');
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [isExportingPDF, setIsExportingPDF] = useState(false);
    const [viewMode, setViewMode] = useState<'cards' | 'kanban' | 'table'>('cards');

    const canListAll = useMemo(() => 
        currentUser && ['superadmin', 'admin', 'gerencia', 'deposito'].includes(currentUser.role),
    [currentUser]);

    const ordersQuery = useMemoFirebase(() => {
        if (!firestore || !canListAll) return null;
        const ordersRef = collection(firestore, 'orders');
        return query(ordersRef, orderBy(sortBy, sortOrder), limit(queryLimit));
    }, [firestore, canListAll, sortBy, sortOrder, queryLimit]);

    const { data: allOrders, isLoading } = useCollection<Order>(ordersQuery);

    const uniqueSalespeople = useMemo(() => {
        if (!allOrders) return [];
        return Array.from(new Set(allOrders.map(o => o.salespersonName))).filter((sp): sp is string => Boolean(sp)).sort();
    }, [allOrders]);

    const [kpiPeriod, setKpiPeriod] = useState<'today' | '7d' | 'this_month' | 'last_month' | 'all'>('all');

    const metrics = useMemo(() => {
        if (!allOrders) return { totalVolume: 0, totalCount: 0, prepCount: 0, prepTotal: 0, routeCount: 0, routeTotal: 0, pendingDebt: 0 };
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        const isDateInPeriod = (rawDate: any) => {
            if (kpiPeriod === 'all' || !rawDate) return true;
            const d = typeof rawDate.toDate === 'function' ? rawDate.toDate() : new Date(rawDate);
            if (isNaN(d.getTime())) return true;
            if (kpiPeriod === 'today') {
                return d.getDate() === now.getDate() && d.getMonth() === currentMonth && d.getFullYear() === currentYear;
            }
            if (kpiPeriod === '7d') {
                const s7 = new Date();
                s7.setDate(now.getDate() - 7);
                return d >= s7;
            }
            if (kpiPeriod === 'this_month') {
                return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
            }
            if (kpiPeriod === 'last_month') {
                const lm = currentMonth === 0 ? 11 : currentMonth - 1;
                const ly = currentMonth === 0 ? currentYear - 1 : currentYear;
                return d.getMonth() === lm && d.getFullYear() === ly;
            }
            return true;
        };

        let totalVolume = 0;
        let totalCount = 0;
        let prepCount = 0;
        let prepTotal = 0;
        let routeCount = 0;
        let routeTotal = 0;
        let pendingDebt = 0;

        allOrders.forEach(o => {
            if (o.status !== 'Cancelado' && isDateInPeriod(o.createdAt || o.orderDate || o.receptionDate)) {
                totalVolume += (o.totalAmount || 0);
                totalCount += 1;

                if (['Aprobado', 'En Preparación'].includes(o.status)) {
                    prepCount += 1;
                    prepTotal += (o.totalAmount || 0);
                }
                if (['Despachado'].includes(o.status)) {
                    routeCount += 1;
                    routeTotal += (o.totalAmount || 0);
                }
                const inv = getInvoiceFromOrder(o);
                if (inv && inv.remainingBalance > 0.05 && inv.status !== 'Pagado') {
                    pendingDebt += inv.remainingBalance;
                }
            }
        });

        return { totalVolume, totalCount, prepCount, prepTotal, routeCount, routeTotal, pendingDebt };
    }, [allOrders, kpiPeriod]);

    const groups = useMemo(() => {
        if (!allOrders) return { solicitudes: [], revisiones: [], borradores: [], comercial: [], operativo: [], logistica: [], cobranzas: [], archivo: [] };
        
        let filtered = [...allOrders];

        if (statusFilter !== 'todos') {
            filtered = filtered.filter(o => o.status === statusFilter);
        }

        if (salespersonFilter !== 'todos') {
            filtered = filtered.filter(o => o.salespersonId === salespersonFilter || o.salespersonName === salespersonFilter);
        }

        if (dateFilter !== 'todos') {
            const now = new Date();
            const startObj = startDate ? new Date(`${startDate}T00:00:00`) : null;
            const endObj = endDate ? new Date(`${endDate}T23:59:59`) : null;
            filtered = filtered.filter(o => {
                const rawDate = o.orderDate || o.createdAt;
                if (!rawDate) return true;
                const d = typeof (rawDate as any).toDate === 'function' ? (rawDate as any).toDate() : new Date(rawDate as any);
                if (isNaN(d.getTime())) return true;
                if (dateFilter === 'custom') {
                    if (startObj && !isNaN(startObj.getTime()) && d < startObj) return false;
                    if (endObj && !isNaN(endObj.getTime()) && d > endObj) return false;
                    return true;
                }
                if (dateFilter === 'today') return d.toDateString() === now.toDateString();
                if (dateFilter === '7d') {
                    const diff = (now.getTime() - d.getTime()) / (1000 * 3600 * 24);
                    return diff <= 7;
                }
                if (dateFilter === 'this_month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                if (dateFilter === 'last_month') {
                    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear();
                }
                return true;
            });
        }

        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase().trim();
            filtered = filtered.filter(o => 
                (o.id || '').toLowerCase().includes(term) ||
                (o.customerName || '').toLowerCase().includes(term) ||
                (o.salespersonName || '').toLowerCase().includes(term)
            );
        }

        const res: Record<string, Order[]> = {
            solicitudes: [],
            revisiones: [],
            borradores: [],
            comercial: [],
            operativo: [],
            logistica: [],
            cobranzas: [],
            archivo: []
        };

        filtered.forEach(o => {
            if ((o as any).cancellationRequested) {
                res.solicitudes.push(o);
            } else if ((o as any).requiresStockReview) {
                res.revisiones.push(o);
            } else if (o.status === 'Borrador') {
                res.borradores.push(o);
            } else if (['Pendiente', 'En Verificación'].includes(o.status)) {
                res.comercial.push(o);
            } else if (['Aprobado', 'En Preparación'].includes(o.status)) {
                res.operativo.push(o);
            } else if (['Despachado'].includes(o.status)) {
                res.logistica.push(o);
            } else if (['Entregado', 'Pagado', 'Completado'].includes(o.status)) {
                res.cobranzas.push(o);
            } else {
                res.archivo.push(o);
            }
        });

        return res;
    }, [allOrders, statusFilter, salespersonFilter, dateFilter, searchTerm]);

    const filteredOrders = useMemo(() => {
        if (!allOrders) return [];
        return Object.values(groups).flat();
    }, [allOrders, groups]);

    const exportOrdersToCSV = () => {
        if (!filteredOrders || filteredOrders.length === 0) return;
        const headers = ['Pedido ID', 'Cliente', 'Asesor Comercial', 'Estado', 'Monto USD', 'Monto Bs (BCV)'];
        const rows = filteredOrders.map(o => [
            o.id,
            `"${(o.customerName || '').replace(/"/g, '""')}"`,
            `"${(o.salespersonName || 'Directo').replace(/"/g, '""')}"`,
            o.status,
            (o.totalAmount || 0).toFixed(2),
            ((o.totalAmount || 0) * bcvRate).toFixed(2)
        ]);
        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `Ventas_y_Pedidos_Athleticenter_${format(new Date(), 'yyyy-MM-dd')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const exportOrdersToPDF = () => {
        if (!filteredOrders || filteredOrders.length === 0) return;
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
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(148, 163, 184);
            doc.text('INFORME EJECUTIVO AUDITADO DE VENTAS Y PEDIDOS', 14, 22);

            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            doc.text(`TASA OFICIAL BCV: Bs. ${bcvRate.toFixed(2)} / USD  •  EMISIÓN: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 28);

            const filterDetails = `Fase: ${activeTab.toUpperCase()} | Estado: ${statusFilter.toUpperCase()} | Vendedor: ${salespersonFilter === 'todos' ? 'TODOS' : salespersonFilter} | Período: ${dateFilter.toUpperCase()}`;
            doc.setFillColor(241, 245, 249);
            doc.roundedRect(14, 37, 182, 9, 2, 2, 'F');
            doc.setFontSize(7);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(51, 65, 85);
            doc.text(`FILTROS EN PANTALLA: ${filterDetails}`, 18, 43);

            const totalVolumeUSD = filteredOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
            doc.setFillColor(248, 250, 252);
            doc.roundedRect(14, 50, 58, 18, 3, 3, 'F');
            doc.roundedRect(76, 50, 58, 18, 3, 3, 'F');
            doc.roundedRect(138, 50, 58, 18, 3, 3, 'F');

            doc.setFontSize(7);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(15, 23, 42);
            doc.text('PEDIDOS COINCIDENTES', 18, 55);
            doc.setFontSize(11);
            doc.text(`${filteredOrders.length}`, 18, 64);

            doc.setFontSize(7);
            doc.setTextColor(37, 99, 235);
            doc.text('VOLUMEN TOTAL ($ USD)', 80, 55);
            doc.setFontSize(10);
            doc.text(`$${totalVolumeUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 80, 64);

            doc.setFontSize(7);
            doc.setTextColor(16, 185, 129);
            doc.text('EQUIVALENTE BCV (Bs)', 142, 55);
            doc.setFontSize(9);
            doc.text(`Bs. ${(totalVolumeUSD * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`, 142, 64);

            const tableRows = filteredOrders.map(o => [
                `#${(o.id || '').substring(0, 8).toUpperCase()}`,
                o.customerName || 'Cliente General',
                o.salespersonName || 'Directo',
                o.status,
                `$${(o.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                `Bs. ${((o.totalAmount || 0) * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`
            ]);

            autoTable(doc, {
                startY: 72,
                head: [['Nº PEDIDO', 'CLIENTE / RAZÓN SOCIAL', 'VENDEDOR', 'ESTADO LOGÍSTICO', 'MONTO ($ USD)', 'MONTO (Bs BCV)']],
                body: tableRows,
                styles: { fontSize: 7.5, cellPadding: 2.5, font: 'helvetica' },
                headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [248, 250, 252] },
                columnStyles: {
                    0: { fontStyle: 'bold', cellWidth: 26 },
                    1: { cellWidth: 55 },
                    2: { cellWidth: 32 },
                    3: { fontStyle: 'bold', cellWidth: 32 },
                    4: { halign: 'right', fontStyle: 'bold', textColor: [37, 99, 235] },
                    5: { halign: 'right', fontStyle: 'bold' }
                }
            });

            const pageCount = (doc as any).internal.getNumberOfPages();
            for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i);
                doc.setFontSize(7);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(148, 163, 184);
                doc.text(`Athleticenter PRO C.A. • Estado de Pedidos y Despachos • Página ${i} de ${pageCount}`, 14, 287);
            }

            doc.autoPrint();
            const pdfBlob = doc.output('bloburl');
            window.open(pdfBlob, '_blank');
        } catch (e) {
            console.error("Error al generar PDF de pedidos:", e);
        } finally {
            setIsExportingPDF(false);
        }
    };

    const handleSendSalespersonPDFReport = () => {
        if (salespersonFilter === 'todos') return;
        window.open(`/api/reports/salesperson-receivables-pdf?salespersonId=${salespersonFilter}`, '_blank');
    };

    const allSections = [
        { key: 'solicitudes', label: 'Anulaciones en Trámite', icon: MessageCircle, color: 'amber', orders: groups.solicitudes, alert: true, tab: 'comercial' },
        { key: 'revisiones', label: 'Control de Stock', icon: AlertTriangle, color: 'rose', orders: groups.revisiones, alert: true, tab: 'operativo' },
        { key: 'borradores', label: 'Borradores', icon: Save, color: 'slate', orders: groups.borradores, tab: 'comercial' },
        { key: 'comercial', label: 'Gestión Comercial', icon: Clock, color: 'amber', orders: groups.comercial, tab: 'comercial' },
        { key: 'operativo', label: 'Logística Interna / Almacén', icon: Package, color: 'indigo', orders: groups.operativo, tab: 'operativo' },
        { key: 'logistica', label: 'Despachados / En Ruta', icon: Truck, color: 'sky', orders: groups.logistica, tab: 'logistica' },
        { key: 'cobranzas', label: 'Ciclo Financiero / Entregados', icon: CreditCard, color: 'emerald', orders: groups.cobranzas, tab: 'cobranzas' },
        { key: 'archivo', label: 'Historial', icon: History, color: 'slate', orders: groups.archivo, tab: 'archivo' }
    ];

    const visibleSections = activeTab === 'todos' 
        ? allSections 
        : allSections.filter(s => s.tab === activeTab || (activeTab === 'comercial' && ['solicitudes', 'borradores', 'comercial'].includes(s.key)) || (activeTab === 'operativo' && ['revisiones', 'operativo'].includes(s.key)));

    if (!canListAll) {
        return (
            <div className="p-12 text-center opacity-40 italic font-black uppercase tracking-widest text-[10px]">
                Acceso restringido a Gerencia y Logística.
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 animate-in fade-in duration-500">
            {/* TARJETAS KPI DE PEDIDOS */}
            {/* BARRA DE PERÍODOS DE FECHAS */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900 text-white p-3 sm:p-4 rounded-3xl shadow-lg border border-slate-800 mx-1 sm:mx-2">
                <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-emerald-400" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">Filtro Temporal de Pedidos:</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1 rounded-2xl border border-slate-800">
                    {[
                        { id: 'today', label: '☀️ Hoy' },
                        { id: '7d', label: '⚡ 7 Días' },
                        { id: 'this_month', label: '🗓️ Mes Actual' },
                        { id: 'last_month', label: '🗓️ Mes Anterior' },
                        { id: 'all', label: '🌐 Todo' },
                    ].map(p => (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => setKpiPeriod(p.id as any)}
                            className={cn(
                                "px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer",
                                kpiPeriod === p.id 
                                    ? "bg-emerald-600 text-white shadow-md font-black" 
                                    : "text-slate-400 hover:text-white hover:bg-slate-900 font-bold"
                            )}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mx-1 sm:mx-2">
                <DashboardMetricCard 
                    title="Volumen Facturado ($)" 
                    value={`$${metrics.totalVolume.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} 
                    subtitle={`${metrics.totalCount} Pedidos Procesados`} 
                    icon={DollarSign} 
                    iconBg="bg-blue-50" 
                    iconColor="text-blue-500" 
                    onClick={() => { setActiveTab('todos'); setStatusFilter('todos'); setSalespersonFilter('todos'); }}
                    isActive={activeTab === 'todos' && statusFilter === 'todos'}
                />
                <DashboardMetricCard 
                    title="En Almacén / Empaque" 
                    value={metrics.prepCount} 
                    subtitle={`$${metrics.prepTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })} En Preparación`} 
                    icon={Package} 
                    iconBg="bg-indigo-50" 
                    iconColor="text-indigo-600" 
                    onClick={() => setActiveTab('operativo')}
                    isActive={activeTab === 'operativo'}
                />
                <DashboardMetricCard 
                    title="Despachados en Ruta" 
                    value={metrics.routeCount} 
                    subtitle={`$${metrics.routeTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })} En Tránsito`} 
                    icon={Truck} 
                    iconBg="bg-sky-50" 
                    iconColor="text-sky-600" 
                    onClick={() => setActiveTab('logistica')}
                    isActive={activeTab === 'logistica'}
                />
                <DashboardMetricCard 
                    title="Por Cobrar ($)" 
                    value={`$${metrics.pendingDebt.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} 
                    subtitle="Saldo Pendiente de Cobro" 
                    icon={Wallet} 
                    iconBg="bg-rose-50" 
                    iconColor="text-rose-600" 
                    onClick={() => setActiveTab('cobranzas')}
                    isActive={activeTab === 'cobranzas'}
                />
            </div>

            {/* Pestañas de filtrado rápido por fase operativa */}
            <div className="flex bg-slate-100/80 p-1.5 rounded-2xl gap-1.5 overflow-x-auto custom-scrollbar border border-slate-200/60 shadow-sm mx-1 sm:mx-2">
                {[
                    { id: 'todos', label: 'Todos los Pedidos', count: allOrders?.length || 0 },
                    { id: 'comercial', label: 'Comercial / Pendientes', count: groups.comercial.length + groups.solicitudes.length + groups.borradores.length },
                    { id: 'operativo', label: 'Almacén / Preparación', count: groups.operativo.length + groups.revisiones.length },
                    { id: 'logistica', label: 'Despachados / En Ruta', count: groups.logistica.length },
                    { id: 'cobranzas', label: 'Entregados / Cobranzas', count: groups.cobranzas.length },
                    { id: 'archivo', label: 'Historial / Archivo', count: groups.archivo.length },
                ].map(tab => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id as any)}
                        className={cn(
                            "px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all whitespace-nowrap flex items-center gap-2 shrink-0",
                            activeTab === tab.id 
                                ? "bg-slate-900 text-white shadow-md" 
                                : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
                        )}
                    >
                        <span>{tab.label}</span>
                        <Badge variant="secondary" className={cn(
                            "font-mono text-[8px] px-1.5 py-0 h-4 rounded-md border-none font-bold",
                            activeTab === tab.id ? "bg-primary text-white" : "bg-slate-200 text-slate-700"
                        )}>
                            {tab.count}
                        </Badge>
                    </button>
                ))}
            </div>

            {/* Barra de Filtros y Ordenamiento con Selector de Periodo */}
            <Card className="border-none shadow-sm rounded-2xl overflow-hidden bg-white mx-1 sm:mx-2">
                <CardContent className="p-4 space-y-4">
                    {/* FILTROS RÁPIDOS DE PERÍODOS DE VENTA Y EXPORTACIÓN */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                        <div className="flex flex-wrap items-center gap-2">
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
                                            : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 font-bold"
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
                        <div className="flex flex-wrap items-center gap-2 ml-auto">
                            <Button
                                onClick={exportOrdersToPDF}
                                disabled={isExportingPDF}
                                className="h-8 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[9px] font-black uppercase tracking-wider shadow-md flex items-center gap-1.5"
                            >
                                {isExportingPDF ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5 text-emerald-400" />}
                                <span>Imprimir PDF</span>
                            </Button>
                            {salespersonFilter !== 'todos' && (
                                <Button
                                    onClick={handleSendSalespersonPDFReport}
                                    className="h-8 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-black uppercase tracking-wider shadow-md flex items-center gap-1.5"
                                >
                                    <Send className="h-3.5 w-3.5" />
                                    <span>Enviar PDF a Vendedor</span>
                                </Button>
                            )}
                            <Button
                                onClick={exportOrdersToCSV}
                                variant="outline"
                                className="h-8 px-3 rounded-xl border-slate-200 bg-white hover:bg-slate-50 text-slate-900 text-[9px] font-black uppercase tracking-wider shadow-sm flex items-center gap-1.5"
                            >
                                <Download className="h-3.5 w-3.5 text-primary" /> Excel
                            </Button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                        <div className="space-y-1">
                            <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Búsqueda Táctica</Label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                <Input placeholder="REF / CLIENTE / RIF / GUÍA..." className="pl-9 h-10 text-[10px] font-bold uppercase rounded-xl border-none bg-slate-50 shadow-inner" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}/>
                            </div>
                        </div>

                    {uniqueSalespeople.length > 0 && (
                        <div className="space-y-1">
                            <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Asesor Comercial</Label>
                            <Select value={salespersonFilter} onValueChange={setSalespersonFilter}>
                                <SelectTrigger className="h-10 text-[10px] font-bold uppercase rounded-xl border-none bg-slate-50 shadow-inner">
                                    <SelectValue placeholder="Todos" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="todos" className="text-[10px] font-bold uppercase">ASESOR: TODOS</SelectItem>
                                    {uniqueSalespeople.map(sp => (
                                        <SelectItem key={sp} value={sp} className="text-[10px] font-bold uppercase">{sp.toUpperCase()}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className="space-y-1">
                        <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Filtrar Estatus</Label>
                        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as OrderStatus | 'todos')}>
                            <SelectTrigger className="h-10 text-[10px] font-bold uppercase rounded-xl border-none bg-slate-50 shadow-inner">
                                <SelectValue placeholder="Todos los estatus" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="todos" className="text-[10px] font-bold uppercase">ESTATUS: TODOS</SelectItem>
                                {ALL_STATUSES.map(s => (
                                    <SelectItem key={s} value={s} className="text-[10px] font-bold uppercase">{s.toUpperCase()}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Ordenar Por</Label>
                        <div className="flex gap-1">
                            <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                                <SelectTrigger className="h-10 text-[10px] font-bold uppercase rounded-xl border-none bg-slate-50 shadow-inner flex-1">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="orderDate" className="text-[10px] font-bold uppercase">FECHA</SelectItem>
                                    <SelectItem value="totalAmount" className="text-[10px] font-bold uppercase">MONTO ($)</SelectItem>
                                </SelectContent>
                            </Select>
                            <Button variant="ghost" size="icon" onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')} className="h-10 w-10 shrink-0 bg-slate-50 rounded-xl">
                                {sortOrder === 'desc' ? <SortDesc className="h-4 w-4 text-slate-600" /> : <SortAsc className="h-4 w-4 text-slate-600" />}
                            </Button>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" onClick={() => { setSearchTerm(''); setStatusFilter('todos'); setSalespersonFilter('todos'); setDateFilter('todos'); setSortBy('orderDate'); setSortOrder('desc'); }} className="h-10 text-[9px] font-black uppercase text-slate-400 hover:text-slate-900">
                                Limpiar Filtros
                            </Button>
                        </div>

                        {/* SELECTOR ADAPTATIVO TRI-MODAL (TARJETAS POR DEFECTO, KANBAN, TABLA) */}
                        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl shadow-md border border-slate-800">
                            <button
                                type="button"
                                onClick={() => setViewMode('cards')}
                                className={cn(
                                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer",
                                    viewMode === 'cards' ? "bg-emerald-500 text-slate-950 shadow-md font-extrabold" : "text-slate-300 hover:text-white"
                                )}
                            >
                                <LayoutGrid className="h-3.5 w-3.5" /> Tarjetas
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode('kanban')}
                                className={cn(
                                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer",
                                    viewMode === 'kanban' ? "bg-emerald-500 text-slate-950 shadow-md font-extrabold" : "text-slate-300 hover:text-white"
                                )}
                            >
                                <Columns3 className="h-3.5 w-3.5" /> Kanban
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode('table')}
                                className={cn(
                                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer",
                                    viewMode === 'table' ? "bg-emerald-500 text-slate-950 shadow-md font-extrabold" : "text-slate-300 hover:text-white"
                                )}
                            >
                                <TableIcon className="h-3.5 w-3.5" /> Tabla
                            </button>
                        </div>
                    </div>
                </div>
                </CardContent>
            </Card>

            {/* VISTA 1: TARJETAS TÁCTILES POR DEFECTO (REJILLA CON ACORDEONES) */}
            {viewMode === 'cards' && (
                isLoading ? (
                    <div className="p-8 space-y-4">
                        <Skeleton className="h-12 w-full rounded-2xl" />
                        <Skeleton className="h-12 w-full rounded-2xl" />
                    </div>
                ) : (
                    <div className="space-y-4 px-1 sm:px-2">
                        <Accordion type="multiple" value={openSections.length > 0 ? openSections : visibleSections.map(s => s.key)} onValueChange={setOpenSections} className="space-y-3">
                            {visibleSections.map(section => (
                                <AccordionItem key={section.key} value={section.key} className="border-none shadow-sm rounded-2xl bg-white overflow-hidden">
                                    <AccordionTrigger className="px-5 py-4 hover:no-underline hover:bg-slate-50/50 transition-colors">
                                        <div className="flex items-center gap-3 w-full">
                                            <div className={cn("p-2 rounded-xl shadow-sm", section.alert && section.orders.length > 0 ? "bg-rose-100 text-rose-600" : `bg-${section.color}-50 text-${section.color}-600`)}>
                                                <section.icon className="h-4.5 w-4.5" />
                                            </div>
                                            <div className="space-y-0.5">
                                                <h3 className="text-xs font-black uppercase tracking-tight text-slate-900">{section.label}</h3>
                                                <p className="text-[8px] text-muted-foreground font-black uppercase tracking-[0.2em]">{section.orders.length} EXPEDIENTES EN COLA</p>
                                            </div>
                                            {section.orders.length > 0 && section.alert && (
                                                <Badge variant="destructive" className="ml-auto bg-rose-600 text-white font-black text-[9px] uppercase px-2.5 py-0.5 rounded-lg animate-pulse shadow-sm flex items-center gap-1">
                                                    <AlertTriangle className="h-3 w-3" /> REVISIÓN REQUERIDA ({section.orders.length})
                                                </Badge>
                                            )}
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent className="px-5 pb-5">
                                        {section.orders.length > 0 ? (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                                {section.orders.map(order => <OrderCard key={order.id} order={order} onSelect={setSelectedOrder} />)}
                                            </div>
                                        ) : <div className="h-14 flex items-center justify-center border-2 border-dashed rounded-2xl opacity-30"><p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Sin expedientación activa en esta fase</p></div>}
                                    </AccordionContent>
                                </AccordionItem>
                            ))}
                        </Accordion>
                        
                        {allOrders && allOrders.length >= queryLimit && (
                            <div className="flex justify-center pt-4">
                                <Button variant="ghost" onClick={() => setQueryLimit(prev => prev + 50)} className="font-black uppercase text-[8px] tracking-[0.3em] text-primary h-11 px-8 rounded-2xl border border-dashed border-primary/30 hover:bg-primary/5">
                                    {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Plus className="h-3.5 w-3.5 mr-2" />}
                                    Cargar Más Expedientes Comercial...
                                </Button>
                            </div>
                        )}
                    </div>
                )
            )}

            {/* VISTA 2: KANBAN DESLIZABLE CON SWIPE TÁCTIL PARA IPAD Y CELULARES */}
            {viewMode === 'kanban' && (
                <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar snap-x snap-mandatory mx-1 sm:mx-2">
                    {[
                        { title: 'Comercial / Pendientes', color: 'border-amber-500/30 bg-amber-500/5 text-amber-600', orders: [...groups.solicitudes, ...groups.borradores, ...groups.comercial] },
                        { title: 'Almacén / Preparación', color: 'border-indigo-500/30 bg-indigo-500/5 text-indigo-600', orders: [...groups.revisiones, ...groups.operativo] },
                        { title: 'Despachados / En Ruta', color: 'border-sky-500/30 bg-sky-500/5 text-sky-600', orders: groups.logistica },
                        { title: 'Entregados / Cobranzas', color: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600', orders: groups.cobranzas },
                    ].map((col, idx) => (
                        <div key={idx} className="min-w-[320px] max-w-[360px] flex-1 snap-start rounded-[2.2rem] border border-slate-200/80 bg-slate-50/50 p-4 space-y-4">
                            <div className={cn("p-3 rounded-2xl border flex items-center justify-between", col.color)}>
                                <span className="text-[10px] font-black uppercase tracking-wider">{col.title}</span>
                                <Badge className="bg-white/80 font-black text-[10px] text-slate-900 px-2 py-0.5 rounded-lg border-none shadow-2xs">
                                    {col.orders.length}
                                </Badge>
                            </div>
                            <div className="space-y-3 max-h-[75vh] overflow-y-auto custom-scrollbar pr-1">
                                {col.orders.length > 0 ? (
                                    col.orders.map(order => (
                                        <OrderCard key={order.id} order={order} onSelect={setSelectedOrder} />
                                    ))
                                ) : (
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 text-center py-8 opacity-40">Sin pedidos en esta fase</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* VISTA 3: TABLA EJECUTIVA COMPACTA */}
            {viewMode === 'table' && (
                <div className="w-full px-1 sm:px-2">
                    <div className="w-full rounded-[2.5rem] border border-slate-100 shadow-xl bg-white overflow-hidden">
                        <div className="w-full overflow-x-auto">
                            <Table className="w-full">
                                <TableHeader className="bg-slate-900">
                                    <TableRow className="hover:bg-transparent border-none">
                                        <TableHead className="text-[10px] font-black uppercase tracking-widest py-4 pl-6 text-white w-28">N° Pedido</TableHead>
                                        <TableHead className="text-[10px] font-black uppercase tracking-widest text-white min-w-[180px]">Cliente / Razón Social</TableHead>
                                        <TableHead className="text-right text-[10px] font-black uppercase tracking-widest text-white min-w-[140px]">Monto Total ($)</TableHead>
                                        <TableHead className="text-center text-[10px] font-black uppercase tracking-widest text-white min-w-[130px]">Fase Operativa</TableHead>
                                        <TableHead className="text-right text-[10px] font-black uppercase tracking-widest pr-6 text-white min-w-[160px]">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoading ? (
                                        Array.from({ length: 5 }).map((_, i) => <TableRow key={i}><TableCell colSpan={5} className="py-8"><Skeleton className="h-10 w-full rounded-xl" /></TableCell></TableRow>)
                                    ) : allOrders && allOrders.length > 0 ? (
                                        allOrders.map(order => {
                                            return (
                                                <TableRow key={order.id} className="hover:bg-primary/5 cursor-pointer transition-all border-b group" onClick={() => setSelectedOrder(order)}>
                                                    <TableCell className="py-4 pl-6">
                                                        <div className="flex flex-col">
                                                            <span className="font-mono text-[11px] font-black text-primary">#{order.id.substring(0, 8)}</span>
                                                            <span className="text-[8px] font-bold text-slate-400 uppercase mt-0.5">{order.orderDate ? format(order.orderDate.toDate(), 'dd/MM/yy') : ''}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="py-4">
                                                        <div className="flex items-center gap-3">
                                                            <Avatar className="h-9 w-9 rounded-xl border-2 border-white shadow-sm shrink-0">
                                                                <AvatarFallback className="bg-slate-900 text-white font-black text-[10px] uppercase">{order.customerName.charAt(0)}</AvatarFallback>
                                                            </Avatar>
                                                            <div className="flex flex-col min-w-0">
                                                                <span className="font-black text-[12px] uppercase text-slate-900 leading-none truncate">{order.customerName}</span>
                                                                <span className="text-[8px] text-slate-400 font-bold uppercase mt-1 flex items-center gap-1.5"><User2 className="h-2.5 w-2.5" /> Asesor: {order.salespersonName || 'Directo'}</span>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right py-4">
                                                        <div className="flex flex-col items-end">
                                                            <span className="font-black text-base tracking-tighter text-slate-900">${order.totalAmount.toFixed(2)} USD</span>
                                                            <span className="text-[8px] font-bold text-slate-400 uppercase">Bs. {(order.totalAmount * bcvRate).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-center py-4">
                                                        <Badge className="text-[9px] font-black uppercase border px-3 py-1 shadow-none rounded-xl whitespace-nowrap bg-slate-100 text-slate-800 border-slate-300">
                                                            {order.status}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right pr-6 py-4" onClick={(e) => e.stopPropagation()}>
                                                        <div className="flex items-center justify-end gap-2">
                                                            <Button 
                                                                variant="outline" 
                                                                size="sm" 
                                                                onClick={() => setSelectedOrder(order)}
                                                                className="h-8 px-3 rounded-xl border-slate-200 text-slate-800 font-black text-[9px] uppercase tracking-wider flex items-center gap-1"
                                                            >
                                                                <Eye className="h-3 w-3 text-primary" /> Detalle
                                                            </Button>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-60 text-center flex flex-col items-center justify-center gap-4 opacity-30">
                                                <Info className="h-12 w-12 text-slate-300" />
                                                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Sin expedientes activos.</p>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                </div>
            )}

            {selectedOrder && <OrderSheetController order={selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)} />}
        </div>
    );
}
