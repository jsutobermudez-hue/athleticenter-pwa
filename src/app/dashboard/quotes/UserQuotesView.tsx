'use client';

import React, { useMemo, useState } from 'react';
import type { User, Quote, QuoteStatus } from '@/lib/definitions';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, query, where, limit, Timestamp } from 'firebase/firestore';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Skeleton } from '@/components/ui/skeleton';
import { QuoteSheetController } from './QuoteSheetController';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { FileEdit, Send, History, Calendar, Search, AlertTriangle, SortAsc, SortDesc, ClipboardList, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
    const statusColor = getStatusColor(quote.status);

    return (
        <Card className="group cursor-pointer transition-all hover:border-primary/20 border-primary/5 bg-white p-4 flex flex-col gap-4 rounded-xl sm:rounded-2xl shadow-none ring-1 ring-primary/5 h-full" onClick={() => onSelect(quote)}>
            <div className="flex justify-between items-start">
                <div className="space-y-0.5">
                    <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">EXPEDIENTE</p>
                    <p className="text-[10px] font-bold font-mono text-primary">#{quote.id.substring(0, 8)}</p>
                </div>
                <Badge className={cn("text-[7px] font-black uppercase border-none text-white px-2 h-4 shadow-sm", statusColor)}>{quote.status}</Badge>
            </div>
            <div className="space-y-1.5">
                <p className="text-[11px] font-black uppercase truncate leading-tight text-slate-900">{quote.customerName}</p>
                <p className="text-[8px] text-slate-400 font-bold uppercase flex items-center gap-1.5">
                    <Calendar className="h-3 w-3" /> {quote.quoteDate ? format(quote.quoteDate.toDate(), 'dd MMM, yy', { locale: es }) : '...'}
                </p>
            </div>
            <div className="pt-2 border-t border-dashed border-slate-100 flex justify-between items-end mt-auto">
                <div className="space-y-0.5">
                    <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">INVERSIÓN EST.</p>
                    <p className="text-sm font-black text-slate-900 leading-none">${quote.totalAmount.toFixed(2)}</p>
                </div>
                <div className="h-7 w-7 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
                    <Send className="h-3.5 w-3.5" />
                </div>
            </div>
        </Card>
    );
}

export default function UserQuotesView({ currentUser }: { currentUser: User }) {
    const firestore = useFirestore();
    const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState<'quoteDate' | 'totalAmount'>('quoteDate');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [openSections, setOpenSections] = useState<string[]>([]);

    const quotesQuery = useMemoFirebase(() => {
        if (!firestore || !currentUser?.id) return null;
        
        // B2B: Soporte para empleados de clientes
        const isClient = currentUser.role === 'cliente';
        const filterField = isClient ? 'customerId' : 'salespersonId';
        const filterValue = isClient 
            ? (currentUser.associatedCustomerId || currentUser.id) 
            : currentUser.id;

        return query(
            collection(firestore, 'quotes'), 
            where(filterField, '==', filterValue),
            limit(100)
        );
    }, [firestore, currentUser?.id, currentUser?.role, currentUser?.associatedCustomerId]);

    const { data: rawQuotes, isLoading, error } = useCollection<Quote>(quotesQuery);

    const filteredAndSortedQuotes = useMemo(() => {
        if (!rawQuotes) return [];
        let items = [...rawQuotes];
        
        const term = searchTerm.toLowerCase().trim();
        if (term) {
            items = items.filter(q => 
                q.id.toLowerCase().includes(term) || 
                q.customerName.toLowerCase().includes(term)
            );
        }

        items.sort((a, b) => {
            const valA = a[sortBy];
            const valB = b[sortBy];
            const compA = valA instanceof Timestamp ? valA.toMillis() : (valA as number);
            const compB = valB instanceof Timestamp ? valB.toMillis() : (valB as number);
            if (compA < compB) return sortOrder === 'asc' ? -1 : 1;
            if (compA > compB) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });

        return items;
    }, [rawQuotes, searchTerm, sortBy, sortOrder]);

    const groups = useMemo(() => {
        const initial = { 
            borradores: [] as Quote[],
            activos: [] as Quote[], 
            cerrados: [] as Quote[] 
        };
        filteredAndSortedQuotes.forEach(quote => {
            if (quote.status === 'Borrador') initial.borradores.push(quote);
            else if (['Enviada', 'Aceptada'].includes(quote.status)) initial.activos.push(quote);
            else initial.cerrados.push(quote);
        });
        return initial;
    }, [filteredAndSortedQuotes]);

    if (isLoading) return <div className="space-y-4 px-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-[1.8rem] sm:rounded-[2rem]"/>)}</div>;

    if (error) return <div className="p-16 sm:p-20 text-center flex flex-col items-center justify-center gap-4"><AlertTriangle className="h-10 sm:h-12 w-10 sm:w-12 text-destructive" /><p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.3em]">Fallo de Sincronización B2B</p></div>;

    return (
        <div className="flex flex-col gap-6 w-full animate-in fade-in-50 duration-500">
            <Card className="border-none shadow-sm rounded-[1.8rem] sm:rounded-[2rem] bg-white overflow-hidden mx-1 sm:mx-2">
                <CardContent className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 items-end">
                    <div className="space-y-2">
                        <Label className="text-[9px] sm:text-[10px] font-black uppercase text-slate-400 tracking-widest px-1">Filtro de Prospección</Label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input placeholder="BUSCAR PRESUPUESTO..." className="pl-10 h-10 sm:h-11 bg-slate-50 border-none rounded-xl font-bold text-[11px] sm:text-xs uppercase shadow-inner" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label className="text-[9px] sm:text-[10px] font-black uppercase text-slate-400 tracking-widest px-1">Ordenar por</Label>
                        <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                            <SelectTrigger className="h-10 sm:h-11 bg-slate-50 border-none rounded-xl font-bold uppercase text-[10px] shadow-inner"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="quoteDate" className="font-bold text-[10px] uppercase">Más Recientes</SelectItem>
                                <SelectItem value="totalAmount" className="font-bold text-[10px] uppercase">Monto Estimado</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex gap-2">
                        <Button variant={sortOrder === 'desc' ? 'default' : 'outline'} size="sm" className="h-10 sm:h-11 flex-1 rounded-xl font-black uppercase text-[8px] sm:text-[9px] tracking-widest border-slate-100" onClick={() => setSortOrder('desc')}>
                            <SortDesc className="h-3.5 sm:h-4 w-3.5 sm:w-4 mr-1.5 sm:mr-2" /> DESC
                        </Button>
                        <Button variant={sortOrder === 'asc' ? 'default' : 'outline'} size="sm" className="h-10 sm:h-11 flex-1 rounded-xl font-black uppercase text-[8px] sm:text-[9px] tracking-widest border-slate-100" onClick={() => setSortOrder('asc')}>
                            <SortAsc className="h-3.5 sm:h-4 w-3.5 sm:w-4 mr-1.5 sm:mr-2" /> ASC
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Accordion type="multiple" value={openSections} onValueChange={setOpenSections} className="space-y-4 mx-1 sm:mx-2 pb-20">
                {[
                    { key: 'borradores', label: 'Borradores en Curso', icon: Save, color: 'slate', items: groups.borradores, desc: 'Propuestas en fase de configuración' },
                    { key: 'activos', label: 'Ofertas Activas', icon: Send, color: 'blue', items: groups.activos, desc: 'Enviadas y esperando aceptación' },
                    { key: 'cerrados', label: 'Historial Comercial', icon: History, color: 'emerald', items: groups.cerrados, desc: 'Convertidas, canceladas o vencidas' }
                ].map(section => (
                    <AccordionItem key={section.key} value={section.key} className={cn("border-none rounded-[1.8rem] sm:rounded-[2.5rem] bg-white shadow-sm ring-1 ring-primary/5 overflow-hidden transition-all", section.key === 'borradores' && section.items.length > 0 && "ring-2 ring-primary/20 bg-primary/5")}>
                        <AccordionTrigger className="px-6 sm:px-8 py-5 sm:py-6 hover:no-underline group">
                            <div className="flex items-center gap-4 sm:gap-5 text-left flex-1">
                                <div className={cn("p-2.5 sm:p-3 rounded-xl sm:rounded-2xl shadow-sm transition-transform group-data-[state=open]:rotate-12", `bg-${section.color}-50 text-${section.color}-600`)}>
                                    <section.icon className="h-5 sm:h-6 w-5 sm:w-6" />
                                </div>
                                <div className="space-y-0.5">
                                    <h3 className="text-sm sm:text-base font-black uppercase tracking-tight text-slate-900">{section.label}</h3>
                                    <p className="text-[8px] sm:text-[9px] text-muted-foreground font-black uppercase tracking-[0.2em]">{section.desc}</p>
                                </div>
                                {section.items.length > 0 && (section.key === 'activos' || section.key === 'borradores') ? (
                                    <Badge variant="destructive" className="ml-auto mr-4 bg-rose-600 text-white font-black h-6 sm:h-7 px-2.5 sm:px-3 rounded-lg text-[10px] sm:text-xs shrink-0 animate-pulse flex items-center gap-1 shadow-sm">
                                        <AlertTriangle className="h-3 w-3" /> PENDIENTE ({section.items.length})
                                    </Badge>
                                ) : (
                                    <Badge variant="secondary" className="ml-auto mr-4 bg-slate-100 text-slate-600 font-black h-6 sm:h-7 px-2 sm:px-3 rounded-lg text-[10px] sm:text-xs">{section.items.length}</Badge>
                                )}
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-6 sm:px-8 pb-6 sm:pb-8 pt-2">
                            {section.items.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {section.items.map(quote => <QuoteCard key={quote.id} quote={quote} onSelect={setSelectedQuote} />)}
                                </div>
                            ) : (
                                <div className="py-10 sm:py-12 border-2 border-dashed rounded-[1.5rem] sm:rounded-[2rem] bg-slate-50/50 flex flex-col items-center justify-center gap-3 opacity-30">
                                    <ClipboardList className="h-7 sm:h-8 w-7 sm:w-8 text-slate-300" />
                                    <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.3em]">Sin presupuestos registrados</p>
                                </div>
                            )}
                        </AccordionContent>
                    </AccordionItem>
                ))}
            </Accordion>

            {selectedQuote && <QuoteSheetController quote={selectedQuote} onOpenChange={(open) => !open && setSelectedQuote(null)} />}
        </div>
    );
}
