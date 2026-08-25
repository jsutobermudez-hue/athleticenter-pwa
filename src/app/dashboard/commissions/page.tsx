
'use client';

import React, { useMemo, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Skeleton } from '@/components/ui/skeleton';
import { useCollection, useFirestore, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, query, where, limit, Timestamp, doc, writeBatch, serverTimestamp, getDoc } from 'firebase/firestore';
import type { Commission, User, Order, CompanyProfile } from '@/lib/definitions';
import { 
    CalendarIcon, 
    Loader2, 
    DollarSign, 
    Filter, 
    Wallet, 
    TrendingUp, 
    Clock, 
    CheckCircle2, 
    X,
    ChevronRight,
    ArrowUpRight,
    Sparkles,
    Landmark,
    Download,
    Receipt,
    FileText
} from 'lucide-react';
import { DateRange } from 'react-day-picker';
import { format, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { generateCommissionReceiptPDF } from '@/lib/pdf-generator';
import { createAppNotifications } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

function WalletCard({ title, value, subtitle, icon: Icon, colorClass }: any) {
    return (
        <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden group relative">
            <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{title}</p>
                    <div className={cn("p-2.5 rounded-xl transition-transform group-hover:rotate-12", colorClass)}>
                        <Icon className="h-4 w-4" />
                    </div>
                </div>
                <h3 className="text-3xl font-black tracking-tighter text-slate-900">${(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
                <p className="text-[10px] font-bold text-muted-foreground uppercase mt-1">{subtitle}</p>
            </CardContent>
        </Card>
    );
}

function CommissionsContent() {
    const { profile: currentUser, isUserLoading } = useUser();
    const firestore = useFirestore();
    const { toast } = useToast();

    const [selectedCommissions, setSelectedCommissions] = useState<Set<string>>(new Set());
    const [isLiquidating, setIsLiquidating] = useState(false);
    const [paymentReference, setPaymentReference] = useState('');
    const [statusFilter, setStatusFilter] = useState<'todos' | 'pendiente' | 'pagado'>('todos');
    const [dateRange, setDateRange] = useState<DateRange | undefined>();

    const isAdminView = useMemo(() => currentUser && ['superadmin', 'admin', 'gerencia'].includes(currentUser.role), [currentUser]);

    const ordersQuery = useMemoFirebase(() => {
        if (isUserLoading || !firestore || !currentUser) return null;
        const base = collection(firestore, 'orders');
        if (!isAdminView) return query(base, where('salespersonId', '==', currentUser.id), limit(200));
        return query(base, limit(200));
    }, [firestore, isUserLoading, currentUser, isAdminView]);

    const commissionsQuery = useMemoFirebase(() => {
        if (isUserLoading || !firestore || !currentUser) return null;
        const base = collection(firestore, 'commissions');
        if (!isAdminView) return query(base, where('salespersonId', '==', currentUser.id), limit(300));
        return query(base, limit(300));
    }, [firestore, isUserLoading, currentUser, isAdminView]);

    const { data: rawCommissions, isLoading: isLoadingComms } = useCollection<Commission>(commissionsQuery);
    const { data: allOrders, isLoading: isLoadingOrders } = useCollection<Order>(ordersQuery);
    const { data: companyProfile } = useDoc<CompanyProfile>(useMemoFirebase(() => (firestore ? doc(firestore, 'companyProfile', 'main') : null), [firestore]));

    const walletStats = useMemo(() => {
        if (!allOrders || !rawCommissions || !currentUser) return { available: 0, pipeline: 0, totalPaid: 0 };
        
        let available = 0;
        let pipeline = 0;
        let totalPaid = 0;

        const isCommissionInDateRange = (c: Commission) => {
            if (!dateRange?.from) return true;
            const start = startOfDay(dateRange.from).getTime();
            const end = (dateRange.to || dateRange.from).getTime() + 86400000;
            const d = c.commissionDate instanceof Timestamp ? c.commissionDate.toMillis() : (c.createdAt ? new Date(c.createdAt as any).getTime() : 0);
            return d >= start && d <= end;
        };

        rawCommissions.filter(c => c.status === 'pagado' && isCommissionInDateRange(c)).forEach(c => {
            const amount = c.invoiceAmount || 0;
            const comm = c.salespersonCommissionAmount || 0;
            const isOldRecord = amount > (comm * 15);
            const sinceratedBase = isOldRecord ? amount * 0.65 : amount;
            totalPaid += (sinceratedBase * 0.05);
        });

        rawCommissions.filter(c => (c.status || 'pendiente') === 'pendiente' && isCommissionInDateRange(c)).forEach(c => {
            const amount = c.invoiceAmount || 0;
            const comm = c.salespersonCommissionAmount || 0;
            const isOldRecord = amount > (comm * 15);
            const sinceratedBase = isOldRecord ? amount * 0.65 : amount;
            available += (sinceratedBase * 0.05);
        });

        allOrders.forEach(o => {
            const rate = o.salespersonCommissionRate || 0.05;
            if (['Entregado', 'En Verificación', 'Despachado', 'Completado'].includes(o.status)) {
                const pendingBase = (o.totalAmount || 0) - (o.amountPaid || 0);
                if (pendingBase > 0) {
                    pipeline += (pendingBase * 0.65 * rate);
                }
            }
        });

        return { available, pipeline, totalPaid };
    }, [allOrders, rawCommissions, currentUser, dateRange]);

    const filteredCommissions = useMemo(() => {
        if (!rawCommissions) return [];
        let items = [...rawCommissions];

        if (statusFilter !== 'todos') items = items.filter(c => (c.status || 'pendiente') === statusFilter);
        
        if (dateRange?.from) {
            const start = startOfDay(dateRange.from).getTime();
            const end = (dateRange.to || dateRange.from).getTime() + 86400000;
            items = items.filter(c => {
                const d = c.commissionDate instanceof Timestamp ? c.commissionDate.toMillis() : 0;
                return d >= start && d <= end;
            });
        }
        
        return items.sort((a, b) => {
            const timeA = a.commissionDate instanceof Timestamp ? a.commissionDate.toMillis() : 0;
            const timeB = b.commissionDate instanceof Timestamp ? b.commissionDate.toMillis() : 0;
            return timeB - timeA;
        });
    }, [rawCommissions, statusFilter, dateRange]);

    if (isUserLoading || isLoadingComms || isLoadingOrders) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>;

    return (
        <div className="w-full max-w-[1440px] mx-auto flex flex-col gap-6 sm:gap-10 pb-32 px-4 sm:px-6 lg:px-10 animate-in fade-in-50 duration-500">
            <header className="space-y-1">
                <h1 className="text-3xl sm:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none italic">Billetera de Comisiones</h1>
                <p className="text-[9px] sm:text-[10px] text-muted-foreground font-black italic uppercase tracking-[0.4em] opacity-60">Control de incentivos devengados sobre Efectivo Real (CASH).</p>
            </header>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                <WalletCard title="Balance Disponible" value={walletStats.available} subtitle="Abonos verificados (BI)" icon={Wallet} colorClass="bg-blue-50 text-blue-500" />
                <WalletCard title="Pipeline (En Tránsito)" value={walletStats.pipeline} subtitle="Potencial sobre saldo" icon={TrendingUp} colorClass="bg-indigo-50 text-indigo-500" />
                <WalletCard title="Total Liquidado" value={walletStats.totalPaid} subtitle="Ya recibidas en cuenta" icon={CheckCircle2} colorClass="bg-emerald-50 text-emerald-500" />
                <Card className="border-none shadow-sm rounded-2xl bg-slate-900 text-white p-6 flex flex-col justify-center">
                    <p className="text-[10px] font-black uppercase text-primary tracking-widest mb-2">Resumen Acumulado</p>
                    <div className="flex justify-between items-end">
                        <h3 className="text-2xl sm:text-3xl font-black tracking-tighter">${((walletStats.available || 0) + (walletStats.totalPaid || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
                        <div className="p-2 rounded-xl bg-white/5"><DollarSign className="h-4 w-4" /></div>
                    </div>
                </Card>
            </div>

            <Card className="border-none shadow-sm rounded-[2rem] bg-white overflow-hidden">
                <CardHeader className="bg-muted/5 border-b py-4 px-6 sm:px-8">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <CardTitle className="text-[10px] font-black uppercase tracking-[0.4em] text-muted-foreground flex items-center gap-2"><Filter className="h-3.5 w-3.5" /> Auditoría de Liquidación</CardTitle>
                        <div className="flex gap-2">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="h-9 font-black text-[9px] uppercase border-none bg-slate-50 shadow-inner px-4">
                                        <CalendarIcon className="mr-2 h-3 w-3 text-primary" />
                                        {dateRange?.from ? `${format(dateRange.from, 'dd/MM')} - ${format(dateRange.to || dateRange.from, 'dd/MM')}` : "FILTRAR FECHA"}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 rounded-2xl overflow-hidden shadow-2xl border-none" align="end">
                                    <Calendar mode="range" selected={dateRange} onSelect={setDateRange} locale={es} />
                                </PopoverContent>
                            </Popover>
                            <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                                <SelectTrigger className="h-9 w-full sm:w-48 rounded-xl bg-slate-50 border-none font-bold uppercase text-[9px] shadow-inner"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="todos">TODOS LOS ESTADOS</SelectItem>
                                    <SelectItem value="pendiente">PENDIENTE PAGO</SelectItem>
                                    <SelectItem value="pagado">LIQUIDADO</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                    <Table>
                        <TableHeader className="bg-slate-50/50">
                            <TableRow>
                                {isAdminView && <TableHead className="w-12 pl-8 py-5">
                                    <Checkbox checked={selectedCommissions.size > 0} onCheckedChange={(checked) => {
                                        if (checked) setSelectedCommissions(new Set(filteredCommissions.filter(c => c.status !== 'pagado').map(c => c.id)));
                                        else setSelectedCommissions(new Set());
                                    }} />
                                </TableHead>}
                                <TableHead className="text-[10px] font-black uppercase tracking-widest pl-8 py-5">Fecha</TableHead>
                                <TableHead className="text-[10px] font-black uppercase tracking-widest">Pedido</TableHead>
                                <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Comisión</TableHead>
                                <TableHead className="text-center text-[10px] font-black uppercase tracking-widest">Estado</TableHead>
                                <TableHead className="text-right text-[10px] font-black uppercase tracking-widest pr-8">Base (CASH)</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredCommissions.length > 0 ? filteredCommissions.map(c => (
                                <TableRow key={c.id} className="hover:bg-primary/5 transition-colors border-b last:border-none">
                                    {isAdminView && <TableCell className="pl-8">
                                        <Checkbox checked={selectedCommissions.has(c.id)} onCheckedChange={() => {
                                            const newSet = new Set(selectedCommissions);
                                            if (newSet.has(c.id)) newSet.delete(c.id); else newSet.add(c.id);
                                            setSelectedCommissions(newSet);
                                        }} disabled={c.status === 'pagado'} />
                                    </TableCell>}
                                    <TableCell className="py-5 text-[10px] font-bold text-slate-500 pl-8">
                                        {c.commissionDate instanceof Timestamp ? format(c.commissionDate.toDate(), 'dd/MM/yy') : '---'}
                                    </TableCell>
                                    <TableCell className="font-mono text-[10px] font-black text-primary">#{c.orderId?.substring(0, 8)}</TableCell>
                                    <TableCell className="text-right font-black text-emerald-600">${(c.salespersonCommissionAmount || 0).toFixed(2)}</TableCell>
                                    <TableCell className="text-center">
                                        <Badge className={cn("text-[8px] font-black uppercase h-5", c.status === 'pagado' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>{c.status || 'PENDIENTE'}</Badge>
                                    </TableCell>
                                    <TableCell className="text-right pr-8 font-black text-slate-900">${(c.invoiceAmount || 0).toFixed(2)}</TableCell>
                                </TableRow>
                            )) : <TableRow><TableCell colSpan={6} className="h-40 text-center opacity-30 italic text-[10px] uppercase font-black">Sin registros activos.</TableCell></TableRow>}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}

export default function CommissionsPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
            <CommissionsContent />
        </Suspense>
    );
}
