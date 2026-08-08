
'use client';

import React, { useMemo, useState } from 'react';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import type { Quote, QuoteStatus } from '@/lib/definitions';
import { Skeleton } from '@/components/ui/skeleton';
import { QuoteSheetController } from './QuoteSheetController';
import { Card, CardContent } from '@/components/ui/card';
import { Search, Send, History, Calendar, Filter, SortAsc, SortDesc, Save, Eye, ClipboardList, AlertTriangle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const ALL_STATUSES: QuoteStatus[] = ['Borrador', 'Enviada', 'Aceptada', 'Convertida', 'Vencida', 'Cancelada'];

function QuoteCard({ quote, onSelect }: { quote: Quote; onSelect: (q: Quote) => void }) {
    const getStatusColor = (status: QuoteStatus) => {
        switch (status) {
            case 'Borrador': return 'bg-slate-400';
            case 'Enviada': return 'bg-blue-400';
            case 'Aceptada': return 'bg-emerald-400';
            case 'Convertida': return 'bg-purple-500';
            case 'Vencida': return 'bg-amber-500';
            case 'Cancelada': return 'bg-rose-500';
            default: return 'bg-muted';
        }
    };
    const color = getStatusColor(quote.status);

    return (
        <Card 
            className="group cursor-pointer transition-all hover:border-primary/20 border-primary/5 bg-white p-4 flex flex-col gap-4 rounded-xl sm:rounded-2xl shadow-none ring-1 ring-primary/5 hover:shadow-md hover:-translate-y-0.5" 
            onClick={() => onSelect(quote)}
        >
            <div className="flex justify-between items-start">
                <div className="space-y-0.5">
                    <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">COTIZACIÓN</p>
                    <p className="text-[10px] font-mono font-bold text-slate-600">#{quote.id.substring(0, 8)}</p>
                </div>
                <Badge className={cn("text-[7px] font-black uppercase border-none text-white px-2 h-4.5 rounded-md shadow-sm", color)}>{quote.status}</Badge>
            </div>
            <div className="space-y-1.5">
                <p className="text-[11px] font-black uppercase truncate leading-tight text-slate-900">{quote.customerName}</p>
                <p className="text-[8px] text-slate-400 font-bold uppercase flex items-center gap-1.5">
                    <Calendar className="h-3 w-3" /> {quote.quoteDate ? format(quote.quoteDate.toDate(), 'dd/MM/yy') : '...'}
                </p>
            </div>
            <div className="pt-2 border-t border-dashed border-slate-100 flex justify-between items-end mt-auto">
                <div className="space-y-0.5">
                    <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">TOTAL REF</p>
                    <p className="text-sm font-black text-primary leading-none">${quote.totalAmount.toFixed(2)}</p>
                </div>
                <div className="h-7 w-7 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
                    <Eye className="h-3.5 w-3.5" />
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
    const [sortBy, setSortBy] = useState<'quoteDate' | 'totalAmount'>('quoteDate');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

    const canListAll = useMemo(() => profile && ['superadmin', 'admin', 'gerencia'].includes(profile.role), [profile]);
    
    const quotesQuery = useMemoFirebase(() => (firestore && canListAll ? query(collection(firestore, 'quotes'), orderBy(sortBy, sortOrder), limit(100)) : null), [firestore, canListAll, sortBy, sortOrder]);
    const { data: allQuotes, isLoading } = useCollection<Quote>(quotesQuery);

    const groups = useMemo(() => {
        const initial = { borradores: [] as Quote[], active: [] as Quote[], history: [] as Quote[] };
        if (!allQuotes) return initial;
        
        const term = searchTerm.toLowerCase().trim();
        const filtered = allQuotes.filter(q => {
            const matchesSearch = q.id.toLowerCase().includes(term) || q.customerName.toLowerCase().includes(term);
            const matchesStatus = statusFilter === 'todos' || q.status === statusFilter;
            return matchesSearch && matchesStatus;
        });

        filtered.forEach(q => {
            if (q.status === 'Borrador') initial.borradores.push(q);
            else if (['Enviada', 'Aceptada'].includes(q.status)) initial.active.push(q);
            else initial.history.push(q);
        });
        return initial;
    }, [allQuotes, searchTerm, statusFilter]);

    if (!canListAll) return <div className="p-12 text-center opacity-40 italic font-black uppercase tracking-widest text-[10px] text-slate-500">Acceso restringido a Gerencia Administrativa.</div>;

    if (isLoading) return <div className="space-y-4 px-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-[1.8rem] sm:rounded-[2rem]"/>)}</div>;

    return (
        <div className="flex flex-col gap-6 w-full animate-in fade-in-50 duration-500">
            <Card className="border-none shadow-sm rounded-[1.8rem] sm:rounded-[2rem] bg-white overflow-hidden mx-1 sm:mx-2">
                <CardContent className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                    <div className="space-y-2">
                        <Label className="text-[9px] sm:text-[10px] font-black uppercase text-slate-400 tracking-widest px-1">Buscar</Label>
                        <div className="relative">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input 
                                placeholder="REF / CLIENTE..." 
                                className="pl-10 h-10 sm:h-11 bg-slate-50 border-none rounded-xl font-bold text-[11px] sm:text-xs uppercase shadow-inner w-full" 
                                value={searchTerm} 
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label className="text-[9px] sm:text-[10px] font-black uppercase text-slate-400 tracking-widest px-1">Estado</Label>
                        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                            <SelectTrigger className="h-10 sm:h-11 bg-slate-50 border-none rounded-xl font-bold uppercase text-[10px] sm:text-xs shadow-inner w-full">
                                <SelectValue placeholder="Todos" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="todos" className="font-bold text-[10px] sm:text-xs uppercase">Todos</SelectItem>
                                {ALL_STATUSES.map(s => (
                                    <SelectItem key={s} value={s} className="font-bold text-[10px] sm:text-xs uppercase">{s}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
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
                    <div className="space-y-2">
                        <Label className="text-[9px] sm:text-[10px] font-black uppercase text-slate-400 tracking-widest px-1">Orden</Label>
                        <div className="flex gap-2">
                            <Button 
                                variant={sortOrder === 'desc' ? 'default' : 'outline'} 
                                size="sm" 
                                className="h-10 sm:h-11 flex-1 rounded-xl font-black uppercase text-[8px] sm:text-[9px] tracking-widest border-slate-100" 
                                onClick={() => setSortOrder('desc')}
                            >
                                <SortDesc className="h-3.5 sm:h-4 w-3.5 sm:w-4 mr-1.5 sm:mr-2" /> DESC
                            </Button>
                            <Button 
                                variant={sortOrder === 'asc' ? 'default' : 'outline'} 
                                size="sm" 
                                className="h-10 sm:h-11 flex-1 rounded-xl font-black uppercase text-[8px] sm:text-[9px] tracking-widest border-slate-100" 
                                onClick={() => setSortOrder('asc')}
                            >
                                <SortAsc className="h-3.5 sm:h-4 w-3.5 sm:w-4 mr-1.5 sm:mr-2" /> ASC
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Accordion type="multiple" defaultValue={[]} className="space-y-4 mx-1 sm:mx-2 pb-20">
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

