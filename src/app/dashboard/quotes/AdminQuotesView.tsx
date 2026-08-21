'use client';

import React, { useMemo, useState } from 'react';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy, limit, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import type { Quote, QuoteStatus } from '@/lib/definitions';
import { Skeleton } from '@/components/ui/skeleton';
import { QuoteSheetController } from './QuoteSheetController';
import { Card, CardContent } from '@/components/ui/card';
import { Search, Send, History, Calendar, Filter, SortAsc, SortDesc, Save, Eye, ClipboardList, AlertTriangle, MessageCircle, DollarSign, Award, CheckCircle2, FilterX, Copy } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { format, differenceInDays, subDays, startOfDay, isSameDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

const ALL_STATUSES: QuoteStatus[] = ['Borrador', 'Enviada', 'Aceptada', 'Convertida', 'Vencida', 'Cancelada'];

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

function QuoteCard({ quote, onSelect }: { quote: Quote; onSelect: (q: Quote) => void }) {
    const firestore = useFirestore();
    const { profile } = useUser();
    const { toast } = useToast();
    const getStatusColor = (status: QuoteStatus) => {
        switch (status) {
            case 'Borrador': return 'bg-slate-400';
            case 'Enviada': return 'bg-blue-500';
            case 'Aceptada': return 'bg-emerald-500';
            case 'Convertida': return 'bg-purple-600';
            case 'Vencida': return 'bg-amber-500';
            case 'Cancelada': return 'bg-rose-500';
            default: return 'bg-muted';
        }
    };
    const color = getStatusColor(quote.status);

    const validUntilDate = (quote as any).validUntil;
    const daysToExpire = validUntilDate && typeof validUntilDate.toDate === 'function' ? differenceInDays(validUntilDate.toDate(), new Date()) : null;
    const isAboutToExpire = daysToExpire !== null && daysToExpire >= 0 && daysToExpire <= 2 && ['Enviada', 'Borrador'].includes(quote.status);

    const handleSendWhatsAppQuote = (e: React.MouseEvent) => {
        e.stopPropagation();
        const rawPhone = (quote.customerPhone || '').replace(/\D/g, '');
        const cleanPhone = rawPhone.length === 10 ? `58${rawPhone}` : rawPhone;
        const itemsCount = ((quote as any).items || []).length;
        
        const text = `*ATHLETICENTER C.A. - PROPUESTA COMERCIAL B2B*\n\n` +
          `Estimado(a) *${quote.customerName}*,\n\n` +
          `Le hacemos llegar la propuesta comercial N° *#${quote.id.substring(0, 8).toUpperCase()}*:\n\n` +
          `📦 *Items Incluidos:* ${itemsCount} productos\n` +
          `💰 *Inversión Total:* $${quote.totalAmount.toFixed(2)} USD\n` +
          (validUntilDate && typeof validUntilDate.toDate === 'function' ? `📅 *Validez de Oferta:* Hasta el ${format(validUntilDate.toDate(), 'dd/MM/yyyy')}\n` : '') +
          `📍 *Asesor Comercial:* ${quote.salespersonName || 'Atención General'}\n\n` +
          `Quedamos atentos para formalizar su pedido de mercancía. ¡Muchas gracias por su preferencia!`;

        const url = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(url, '_blank');
    };

    return (
        <Card 
            className="group cursor-pointer transition-all hover:border-primary/20 border-primary/5 bg-white p-4 flex flex-col gap-4 rounded-2xl shadow-sm ring-1 ring-primary/5 hover:shadow-md hover:-translate-y-0.5" 
            onClick={() => onSelect(quote)}
        >
            <div className="flex justify-between items-start">
                <div className="space-y-0.5">
                    <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">EXPEDIENTE COTIZACIÓN</p>
                    <p className="text-[10px] font-mono font-bold text-slate-700">#{quote.id.substring(0, 8)}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                    <Badge className={cn("text-[7px] font-black uppercase border-none text-white px-2 h-4.5 rounded-md shadow-sm", color)}>{quote.status}</Badge>
                    {isAboutToExpire && (
                        <Badge variant="destructive" className="text-[7px] font-black uppercase h-4 px-1.5 animate-pulse">
                            ¡Por Vencer!
                        </Badge>
                    )}
                </div>
            </div>

            <div className="space-y-1.5">
                <p className="text-[11px] font-black uppercase truncate leading-tight text-slate-900">{quote.customerName}</p>
                <div className="flex items-center justify-between text-[8px] text-slate-400 font-bold uppercase">
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3 text-slate-400" /> {quote.quoteDate ? format(quote.quoteDate.toDate(), 'dd/MM/yy') : '...'}</span>
                    {quote.salespersonName && <span className="truncate max-w-[100px]">{quote.salespersonName}</span>}
                </div>
            </div>

            <div className="pt-2 border-t border-dashed border-slate-100 flex justify-between items-center mt-auto gap-2">
                <div className="space-y-0.5">
                    <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">INVERSIÓN TOTAL</p>
                    <p className="text-sm font-black text-slate-900 leading-none">${quote.totalAmount.toFixed(2)}</p>
                </div>
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <Button 
                        size="sm" 
                        onClick={handleSendWhatsAppQuote}
                        className="h-8 px-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[9px] uppercase tracking-wider flex items-center gap-1 shadow-sm"
                    >
                        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                    </Button>
                    <Button 
                        variant="outline" 
                        size="icon" 
                        title="Duplicar propuesta"
                        onClick={async (e) => {
                            e.stopPropagation();
                            if (!firestore || !profile) return;
                            try {
                                const docRef = await addDoc(collection(firestore, 'quotes'), {
                                    customerId: quote.customerId,
                                    customerName: quote.customerName,
                                    customerPhone: quote.customerPhone || '',
                                    items: (quote as any).items || [],
                                    subtotal: (quote as any).subtotal || quote.totalAmount,
                                    tax: (quote as any).tax || 0,
                                    totalAmount: quote.totalAmount,
                                    status: 'Borrador',
                                    salespersonId: profile.id,
                                    salespersonName: profile.name,
                                    quoteDate: serverTimestamp(),
                                    validUntil: Timestamp.fromDate(new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)),
                                    createdAt: serverTimestamp(),
                                    createdBy: profile.id
                                });
                                toast({ title: "Cotización Duplicada", description: "Borrador creado en 1 clic." });
                            } catch (err: any) {
                                toast({ variant: 'destructive', title: "Fallo al duplicar" });
                            }
                        }}
                        className="h-8 w-8 rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50"
                    >
                        <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => onSelect(quote)}
                        className="h-8 w-8 rounded-xl text-slate-400 group-hover:text-primary transition-colors"
                    >
                        <Eye className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </Card>
    );
}

/**
 * VISTA MAESTRA DE COTIZACIONES (SOLO GERENCIA)
 * Incluye borradores para monitoreo del pipeline comercial.
 */
export default function AdminQuotesView() {
    const firestore = useFirestore();
    const { profile } = useUser();
    const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<QuoteStatus | 'todos'>('todos');
    const [salespersonFilter, setSalespersonFilter] = useState('todos');
    const [dateFilter, setDateFilter] = useState<'todos' | 'today' | '7d' | 'this_month' | 'last_month' | 'custom'>('todos');
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [sortBy, setSortBy] = useState<'quoteDate' | 'totalAmount'>('quoteDate');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [openSections, setOpenSections] = useState<string[]>([]);

    const canListAll = useMemo(() => profile && ['superadmin', 'admin', 'gerencia'].includes(profile.role), [profile]);
    
    const quotesQuery = useMemoFirebase(() => (firestore && canListAll ? query(collection(firestore, 'quotes'), orderBy(sortBy, sortOrder), limit(200)) : null), [firestore, canListAll, sortBy, sortOrder]);
    const { data: allQuotes, isLoading } = useCollection<Quote>(quotesQuery);

    // VENDEDORES ÚNICOS PARA FILTRO DE GERENCIA
    const uniqueSalespeople = useMemo(() => {
        if (!allQuotes) return [];
        return Array.from(new Set(allQuotes.map(q => q.salespersonName))).filter((sp): sp is string => Boolean(sp)).sort();
    }, [allQuotes]);

    // METRICAS PIPELINE EJECUTIVAS
    const metrics = useMemo(() => {
        if (!allQuotes) return { totalPipeline: 0, totalCount: 0, draftsCount: 0, draftsTotal: 0, activeCount: 0, activeTotal: 0, convertedCount: 0, convertedTotal: 0, conversionRate: 0 };
        
        let totalPipeline = 0;
        let totalCount = 0;
        let draftsCount = 0;
        let draftsTotal = 0;
        let activeCount = 0;
        let activeTotal = 0;
        let convertedCount = 0;
        let convertedTotal = 0;

        allQuotes.forEach(q => {
            const amt = q.totalAmount || 0;
            totalPipeline += amt;
            totalCount++;

            if (q.status === 'Borrador') {
                draftsCount++;
                draftsTotal += amt;
            } else if (['Enviada', 'Aceptada'].includes(q.status)) {
                activeCount++;
                activeTotal += amt;
            } else if (q.status === 'Convertida') {
                convertedCount++;
                convertedTotal += amt;
            }
        });

        const conversionRate = totalCount > 0 ? Math.round((convertedCount / totalCount) * 100) : 0;

        return { totalPipeline, totalCount, draftsCount, draftsTotal, activeCount, activeTotal, convertedCount, convertedTotal, conversionRate };
    }, [allQuotes]);

    const groups = useMemo(() => {
        const initial = { borradores: [] as Quote[], active: [] as Quote[], history: [] as Quote[] };
        if (!allQuotes) return initial;
        
        const term = searchTerm.toLowerCase().trim();
        const now = new Date();

        const startObj = startDate ? new Date(`${startDate}T00:00:00`) : null;
        const endObj = endDate ? new Date(`${endDate}T23:59:59`) : null;

        const matchesDate = (q: Quote) => {
            if (dateFilter === 'todos') return true;
            const rawDate = (q as any).quoteDate || q.createdAt;
            if (!rawDate) return true;
            const qDate = typeof (rawDate as any).toDate === 'function' ? (rawDate as any).toDate() : new Date(rawDate as any);
            if (isNaN(qDate.getTime())) return true;

            if (dateFilter === 'custom') {
                if (startObj && !isNaN(startObj.getTime()) && qDate < startObj) return false;
                if (endObj && !isNaN(endObj.getTime()) && qDate > endObj) return false;
                return true;
            }
            if (dateFilter === 'today') return isSameDay(qDate, now);
            if (dateFilter === '7d') return qDate >= startOfDay(subDays(now, 6));
            if (dateFilter === 'this_month') return qDate.getMonth() === now.getMonth() && qDate.getFullYear() === now.getFullYear();
            if (dateFilter === 'last_month') {
                const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                return qDate.getMonth() === lm.getMonth() && qDate.getFullYear() === lm.getFullYear();
            }
            return true;
        };

        const filtered = allQuotes.filter(q => {
            const matchesSearch = q.id.toLowerCase().includes(term) || q.customerName.toLowerCase().includes(term) || (q.customerRif || '').toLowerCase().includes(term);
            const matchesStatus = statusFilter === 'todos' || q.status === statusFilter;
            const matchesSalesperson = salespersonFilter === 'todos' || q.salespersonName === salespersonFilter;
            return matchesSearch && matchesStatus && matchesSalesperson && matchesDate(q);
        });

        filtered.forEach(q => {
            if (q.status === 'Borrador') initial.borradores.push(q);
            else if (['Enviada', 'Aceptada'].includes(q.status)) initial.active.push(q);
            else initial.history.push(q);
        });
        return initial;
    }, [allQuotes, searchTerm, statusFilter, salespersonFilter, dateFilter]);

    const handleClearFilters = () => {
        setSearchTerm('');
        setStatusFilter('todos');
        setSalespersonFilter('todos');
        setDateFilter('todos');
    };

    if (!canListAll) return <div className="p-12 text-center opacity-40 italic font-black uppercase tracking-widest text-[10px] text-slate-500">Acceso restringido a Gerencia Administrativa.</div>;

    if (isLoading) return <div className="space-y-4 px-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-[1.8rem] sm:rounded-[2rem]"/>)}</div>;

    return (
        <div className="flex flex-col gap-6 w-full animate-in fade-in-50 duration-500">
            {/* TARJETAS KPI DE PIPELINE */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mx-1 sm:mx-2">
                <DashboardMetricCard 
                    title="Pipeline Total ($)" 
                    value={`$${metrics.totalPipeline.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} 
                    subtitle={`${metrics.totalCount} Propuestas Emitidas`} 
                    icon={DollarSign} 
                    iconBg="bg-blue-50" 
                    iconColor="text-blue-500" 
                    onClick={handleClearFilters}
                    isActive={statusFilter === 'todos' && salespersonFilter === 'todos'}
                />
                <DashboardMetricCard 
                    title="Borradores en Curso" 
                    value={metrics.draftsCount} 
                    subtitle={`$${metrics.draftsTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })} En Armado`} 
                    icon={Save} 
                    iconBg="bg-slate-100" 
                    iconColor="text-slate-600" 
                    onClick={() => setStatusFilter('Borrador')}
                    isActive={statusFilter === 'Borrador'}
                />
                <DashboardMetricCard 
                    title="Presupuestos Activos" 
                    value={metrics.activeCount} 
                    subtitle={`$${metrics.activeTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })} En Negociación`} 
                    icon={Send} 
                    iconBg="bg-amber-50" 
                    iconColor="text-amber-500" 
                    onClick={() => setStatusFilter('Enviada')}
                    isActive={statusFilter === 'Enviada' || statusFilter === 'Aceptada'}
                />
                <DashboardMetricCard 
                    title="Tasa de Conversión" 
                    value={`${metrics.conversionRate.toFixed(1)}%`} 
                    subtitle={`$${metrics.convertedTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })} Convertidos`} 
                    icon={Award} 
                    iconBg="bg-purple-50" 
                    iconColor="text-purple-600" 
                    onClick={() => setStatusFilter('Convertida')}
                    isActive={statusFilter === 'Convertida'}
                />
            </div>

            {/* BARRA DE FILTROS DE PERÍODO INTERACTIVOS */}
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

            {/* FILTROS TÁCTICOS */}
            <Card className="border-none shadow-sm rounded-[1.8rem] sm:rounded-[2rem] bg-white overflow-hidden mx-1 sm:mx-2">
                <CardContent className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
                    <div className="space-y-1.5">
                        <Label className="text-[9px] sm:text-[10px] font-black uppercase text-slate-400 tracking-widest px-1">Buscar</Label>
                        <div className="relative">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input 
                                placeholder="REF / CLIENTE / RIF..." 
                                className="pl-10 h-10 sm:h-11 bg-slate-50 border-none rounded-xl font-bold text-[11px] sm:text-xs uppercase shadow-inner w-full" 
                                value={searchTerm} 
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>

                    {uniqueSalespeople.length > 0 && (
                        <div className="space-y-1.5">
                            <Label className="text-[9px] sm:text-[10px] font-black uppercase text-slate-400 tracking-widest px-1">Asesor Comercial</Label>
                            <Select value={salespersonFilter} onValueChange={setSalespersonFilter}>
                                <SelectTrigger className="h-10 sm:h-11 bg-slate-50 border-none rounded-xl font-bold uppercase text-[10px] sm:text-xs shadow-inner w-full">
                                    <SelectValue placeholder="Todos" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="todos" className="font-bold text-[10px] sm:text-xs uppercase">ASESOR: TODOS</SelectItem>
                                    {uniqueSalespeople.map(sp => (
                                        <SelectItem key={sp} value={sp} className="font-bold text-[10px] sm:text-xs uppercase">{sp.toUpperCase()}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <Label className="text-[9px] sm:text-[10px] font-black uppercase text-slate-400 tracking-widest px-1">Estado</Label>
                        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                            <SelectTrigger className="h-10 sm:h-11 bg-slate-50 border-none rounded-xl font-bold uppercase text-[10px] sm:text-xs shadow-inner w-full">
                                <SelectValue placeholder="Todos" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="todos" className="font-bold text-[10px] sm:text-xs uppercase">TODOS LOS ESTADOS</SelectItem>
                                {ALL_STATUSES.map(s => (
                                    <SelectItem key={s} value={s} className="font-bold text-[10px] sm:text-xs uppercase">{s.toUpperCase()}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-[9px] sm:text-[10px] font-black uppercase text-slate-400 tracking-widest px-1">Criterio</Label>
                        <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                            <SelectTrigger className="h-10 sm:h-11 bg-slate-50 border-none rounded-xl font-bold uppercase text-[10px] sm:text-xs shadow-inner w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="quoteDate" className="font-bold text-[10px] sm:text-xs uppercase">Fecha Emisión</SelectItem>
                                <SelectItem value="totalAmount" className="font-bold text-[10px] sm:text-xs uppercase">Monto Total</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-[9px] sm:text-[10px] font-black uppercase text-slate-400 tracking-widest px-1">Orden</Label>
                        <div className="flex gap-2">
                            <Button 
                                variant={sortOrder === 'desc' ? 'default' : 'outline'} 
                                size="sm" 
                                className="h-10 sm:h-11 flex-1 rounded-xl font-black uppercase text-[8px] sm:text-[9px] tracking-widest border-slate-100" 
                                onClick={() => setSortOrder('desc')}
                            >
                                <SortDesc className="h-3.5 sm:h-4 w-3.5 sm:w-4 mr-1" /> DESC
                            </Button>
                            <Button 
                                variant={sortOrder === 'asc' ? 'default' : 'outline'} 
                                size="sm" 
                                className="h-10 sm:h-11 flex-1 rounded-xl font-black uppercase text-[8px] sm:text-[9px] tracking-widest border-slate-100" 
                                onClick={() => setSortOrder('asc')}
                            >
                                <SortAsc className="h-3.5 sm:h-4 w-3.5 sm:w-4 mr-1" /> ASC
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Accordion type="multiple" value={openSections} onValueChange={setOpenSections} className="space-y-4 mx-1 sm:mx-2 pb-20">
                {[
                    { key: 'borradores', label: 'Borradores / En Curso', icon: Save, color: 'slate', items: groups.borradores, desc: 'Propuestas en fase de configuración' },
                    { key: 'active', label: 'Presupuestos Activos', icon: Send, color: 'blue', items: groups.active, desc: 'Enviadas y esperando aceptación' },
                    { key: 'history', label: 'Archivo Histórico', icon: History, color: 'emerald', items: groups.history, desc: 'Convertidas, canceladas o vencidas' }
                ].map(section => (
                    <AccordionItem 
                        key={section.key} 
                        value={section.key} 
                        className={cn(
                            "border-none rounded-[1.8rem] sm:rounded-[2.5rem] bg-white shadow-sm ring-1 ring-primary/5 overflow-hidden transition-all", 
                            section.key === 'active' && section.items.length > 0 && "ring-2 ring-blue-100"
                        )}
                    >
                        <AccordionTrigger className="px-6 sm:px-8 py-5 sm:py-6 hover:no-underline group">
                            <div className="flex items-center gap-4 sm:gap-5 text-left flex-1">
                                <div className={cn("p-2.5 sm:p-3 rounded-xl sm:rounded-2xl shadow-sm transition-transform group-data-[state=open]:rotate-12", `bg-${section.color}-50 text-${section.color}-600`)}>
                                    <section.icon className="h-5 sm:h-6 w-5 sm:w-6" />
                                </div>
                                <div className="space-y-0.5">
                                    <h3 className="text-sm sm:text-base font-black uppercase tracking-tight text-slate-900">{section.label}</h3>
                                    <p className="text-[8px] sm:text-[9px] text-muted-foreground font-black uppercase tracking-[0.2em]">{section.desc}</p>
                                </div>
                                {section.items.length > 0 && section.key === 'active' ? (
                                    <Badge variant="destructive" className="ml-auto mr-4 bg-rose-600 text-white font-black h-6 sm:h-7 px-2.5 sm:px-3 rounded-lg text-[10px] sm:text-xs shrink-0 animate-pulse flex items-center gap-1 shadow-sm">
                                        <AlertTriangle className="h-3 w-3" /> PENDIENTE ({section.items.length})
                                    </Badge>
                                ) : (
                                    <Badge variant="secondary" className="ml-auto mr-4 bg-slate-100 text-slate-600 font-black h-6 sm:h-7 px-2 sm:px-3 rounded-lg text-[10px] sm:text-xs">
                                        {section.items.length}
                                    </Badge>
                                )}
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-6 sm:px-8 pb-6 sm:pb-8 pt-2">
                            {section.items.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {section.items.map(q => (
                                        <QuoteCard key={q.id} quote={q} onSelect={setSelectedQuote} />
                                    ))}
                                </div>
                            ) : (
                                <div className="py-10 sm:py-12 border-2 border-dashed rounded-[1.5rem] sm:rounded-[2rem] bg-slate-50/50 flex flex-col items-center justify-center gap-3 opacity-30">
                                    <ClipboardList className="h-7 sm:h-8 w-7 sm:w-8 text-slate-300" />
                                    <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.3em]">Sin cotizaciones registradas</p>
                                </div>
                            )}
                        </AccordionContent>
                    </AccordionItem>
                ))}
            </Accordion>

            {selectedQuote && (
                <QuoteSheetController 
                    quote={selectedQuote} 
                    onOpenChange={(open) => !open && setSelectedQuote(null)} 
                />
            )}
        </div>
    );
}
