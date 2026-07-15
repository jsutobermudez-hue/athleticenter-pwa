
'use client';

import React, { useMemo, useState } from 'react';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import type { Quote, QuoteStatus } from '@/lib/definitions';
import { Skeleton } from '@/components/ui/skeleton';
import { QuoteSheetController } from './QuoteSheetController';
import { Card, CardContent } from '@/components/ui/card';
import { Search, Send, History, Calendar, Filter, SortAsc, SortDesc, Save } from 'lucide-react';
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
        <Card className="group cursor-pointer transition-all hover:border-primary/20 border-primary/5 bg-white p-2.5 flex flex-col gap-2 rounded-xl shadow-none" onClick={() => onSelect(quote)}>
            <div className="flex justify-between items-start">
                <div className="space-y-0.5">
                    <p className="text-[6px] font-black text-muted-foreground uppercase">COTIZACIÓN</p>
                    <p className="text-[8px] font-mono font-bold">#{quote.id.substring(0, 8)}</p>
                </div>
                <Badge className={cn("text-[6px] font-black uppercase border-none text-white px-1 h-3.5", color)}>{quote.status}</Badge>
            </div>
            <div className="space-y-1">
                <p className="text-[9px] font-black uppercase truncate leading-tight">{quote.customerName}</p>
                <p className="text-[7px] text-muted-foreground font-bold uppercase flex items-center gap-1"><Calendar className="h-2.5 w-2.5" /> {quote.quoteDate ? format(quote.quoteDate.toDate(), 'dd/MM/yy') : '...'}</p>
            </div>
            <div className="pt-1.5 border-t border-dashed flex justify-between items-end">
                <div className="space-y-0.5">
                    <p className="text-[6px] font-black text-slate-400 uppercase">TOTAL REF</p>
                    <p className="text-xs font-black text-primary leading-none">${quote.totalAmount.toFixed(2)}</p>
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

    if (!canListAll) return <div className="p-12 text-center opacity-40 italic font-black uppercase tracking-widest text-[10px]">Acceso restringido a Gerencia Administrativa.</div>;

    if (isLoading) return <div className="space-y-3">{[1, 2].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>;

    return (
        <div className="flex flex-col gap-4">
            <Card className="border-none shadow-none rounded-2xl bg-white/50 backdrop-blur-sm p-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="space-y-1">
                        <Label className="text-[7px] font-black uppercase text-slate-400 px-1">Buscar</Label>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                            <Input placeholder="REF / CLIENTE..." className="pl-8 h-8 text-[9px] font-bold uppercase border-none bg-white shadow-inner rounded-lg" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}/>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-[7px] font-black uppercase text-slate-400 px-1">Estado</Label>
                        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                            <SelectTrigger className="h-8 text-[9px] font-bold uppercase border-none bg-white shadow-inner rounded-lg"><SelectValue placeholder="Todos" /></SelectTrigger>
                            <SelectContent>{ALL_STATUSES.map(s => <SelectItem key={s} value={s} className="text-[9px] font-bold uppercase">{s}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-[7px] font-black uppercase text-slate-400 px-1">Criterio</Label>
                        <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                            <SelectTrigger className="h-8 text-[9px] font-bold uppercase border-none bg-white shadow-inner rounded-lg"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="quoteDate" className="text-[9px] font-bold uppercase">Fecha Emisión</SelectItem>
                                <SelectItem value="totalAmount" className="text-[9px] font-bold uppercase">Monto Total</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-[7px] font-black uppercase text-slate-400 px-1">Orden</Label>
                        <div className="flex gap-1">
                            <Button variant={sortOrder === 'desc' ? 'default' : 'outline'} size="sm" className="h-8 flex-1 rounded-lg border-none" onClick={() => setSortOrder('desc')}>
                                <SortDesc className="h-3 w-3 mr-1" /> <span className="text-[8px] font-black">DESC</span>
                            </Button>
                            <Button variant={sortOrder === 'asc' ? 'default' : 'outline'} size="sm" className="h-8 flex-1 rounded-lg border-none" onClick={() => setSortOrder('asc')}>
                                <SortAsc className="h-3 w-3 mr-1" /> <span className="text-[8px] font-black">ASC</span>
                            </Button>
                        </div>
                    </div>
                </div>
            </Card>

            <Accordion type="multiple" defaultValue={[]} className="space-y-2">
                <AccordionItem value="borradores" className="border-none rounded-xl bg-white shadow-sm ring-1 ring-slate-100 overflow-hidden">
                    <AccordionTrigger className="px-4 py-2.5 hover:no-underline">
                        <div className="flex items-center gap-3"><div className="p-1 rounded-lg bg-slate-50 text-slate-500"><Save className="h-3.5 w-3.5" /></div><div className="text-left"><h3 className="text-[9px] font-black uppercase">Borradores / En Curso</h3><p className="text-[6px] font-black text-slate-400 uppercase tracking-widest">{groups.borradores.length} REGISTROS</p></div></div>
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3"><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 pt-1">{groups.borradores.map(q => <QuoteCard key={q.id} quote={q} onSelect={setSelectedQuote} />)}</div></AccordionContent>
                </AccordionItem>
                <AccordionItem value="active" className="border-none rounded-xl bg-white shadow-sm ring-1 ring-blue-50 overflow-hidden">
                    <AccordionTrigger className="px-4 py-2.5 hover:no-underline">
                        <div className="flex items-center gap-3"><div className="p-1 rounded-lg bg-blue-50 text-blue-500"><Send className="h-3.5 w-3.5" /></div><div className="text-left"><h3 className="text-[9px] font-black uppercase">Presupuestos Activos</h3><p className="text-[6px] font-black text-slate-400 uppercase tracking-widest">{groups.active.length} REGISTROS</p></div></div>
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3"><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 pt-1">{groups.active.map(q => <QuoteCard key={q.id} quote={q} onSelect={setSelectedQuote} />)}</div></AccordionContent>
                </AccordionItem>
                <AccordionItem value="history" className="border-none rounded-xl bg-white shadow-sm ring-1 ring-slate-50 overflow-hidden opacity-80">
                    <AccordionTrigger className="px-4 py-2.5 hover:no-underline">
                        <div className="flex items-center gap-3"><div className="p-1 rounded-lg bg-slate-50 text-slate-500"><History className="h-3.5 w-3.5" /></div><div className="text-left"><h3 className="text-[9px] font-black uppercase">Archivo Histórico</h3><p className="text-[6px] font-black text-slate-400 uppercase tracking-widest">{groups.history.length} REGISTROS</p></div></div>
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3"><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 pt-1">{groups.history.map(q => <QuoteCard key={q.id} quote={q} onSelect={setSelectedQuote} />)}</div></AccordionContent>
                </AccordionItem>
            </Accordion>

            {selectedQuote && <QuoteSheetController quote={selectedQuote} onOpenChange={(open) => !open && setSelectedQuote(null)} />}
        </div>
    );
}
