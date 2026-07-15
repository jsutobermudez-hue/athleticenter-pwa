'use client';

import React, { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { 
    Loader2, 
    Download, 
    TrendingUp, 
    Briefcase,
    Users as UsersIcon,
    DollarSign,
    Contact
} from 'lucide-react';
import type { Customer, User, Commission, CompanyProfile } from '@/lib/definitions';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useCollection, useFirestore, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, where, orderBy, limit, Timestamp, doc } from 'firebase/firestore';
import { format, subMonths, isSameMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { generateSalespersonPerformancePDF } from '@/lib/pdf-generator';
import dynamic from 'next/dynamic';

// Importación dinámica del componente de gráfico para evitar errores de SSR/Hydration
const PerformanceChart = dynamic(() => import('./performance-chart'), { 
    ssr: false,
    loading: () => <div className="h-48 w-full flex items-center justify-center bg-slate-50/50 rounded-[2rem] border border-slate-100"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>
});

export type SalespersonWithStats = User & {
  customerCount: number;
  monthlyOrderCount: number;
  monthlySales: number;
  earnedCommission: number;
  pendingSales: number;
};

export function SalespersonDetailsSheet({
  salesperson,
  onOpenChange,
}: {
  salesperson: SalespersonWithStats | null;
  onOpenChange: (open: boolean) => void;
}) {
  const firestore = useFirestore();

  const commissionsQuery = useMemoFirebase(() => {
    if (!firestore || !salesperson) return null;
    return query(
        collection(firestore, 'commissions'), 
        where('salespersonId', '==', salesperson.id), 
        orderBy('commissionDate', 'desc'),
        limit(100)
    );
  }, [firestore, salesperson?.id]);

  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !salesperson) return null;
    return query(collection(firestore, 'customers'), where('assignedSalespersonId', '==', salesperson.id), limit(100));
  }, [firestore, salesperson?.id]);

  const companyProfileRef = useMemoFirebase(() => (firestore ? doc(firestore, 'companyProfile', 'main') : null), [firestore]);
  const { data: companyProfile } = useDoc<CompanyProfile>(companyProfileRef);

  const { data: commissions, isLoading: isLoadingCommissions } = useCollection<Commission>(commissionsQuery);
  const { data: salespersonCustomers, isLoading: isLoadingCustomers } = useCollection<Customer>(customersQuery);

  const trendData = useMemo(() => {
    if (!commissions) return [];
    const months = Array.from({ length: 6 }, (_, i) => {
        const date = subMonths(new Date(), 5 - i);
        return {
            label: format(date, 'MMM', { locale: es }).toUpperCase(),
            date,
            amount: 0
        };
    });

    commissions.forEach(c => {
        const cDate = c.commissionDate instanceof Timestamp ? c.commissionDate.toDate() : null;
        if (!cDate) return;
        const monthIdx = months.findIndex(m => isSameMonth(m.date, cDate));
        if (monthIdx !== -1) {
            const amount = c.invoiceAmount || 0;
            months[monthIdx].amount += amount;
        }
    });

    return months;
  }, [commissions]);

  if (!salesperson) return null;
  
  const totalPipeline = salesperson.monthlySales + (salesperson.pendingSales || 0);
  const goalProgress = salesperson.salesGoal && salesperson.salesGoal > 0 ? (totalPipeline / salesperson.salesGoal) * 100 : 0;

  return (
    <Sheet open={!!salesperson} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-[95vw] sm:max-w-xl lg:max-w-2xl w-full p-0 overflow-hidden border-none rounded-l-[2.5rem] shadow-2xl">
        <ScrollArea className="h-full">
            <div className="p-6 sm:p-10 space-y-10">
                <SheetHeader className="flex flex-row items-center gap-6 text-left space-y-0">
                    <Avatar className="h-20 w-20 border-4 border-white shadow-xl rounded-[1.8rem] overflow-hidden">
                        {salesperson.avatarUrl && <AvatarImage src={salesperson.avatarUrl} alt={salesperson.name} className="object-cover" />}
                        <AvatarFallback className="text-2xl font-black bg-primary/10 text-primary uppercase">{salesperson.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0 space-y-1">
                        <SheetTitle className="text-2xl sm:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-none truncate">{salesperson.name}</SheetTitle>
                        <p className="text-[11px] font-bold text-primary uppercase tracking-widest truncate">{salesperson.email}</p>
                        <Badge variant="outline" className="mt-2 font-black uppercase text-[9px] tracking-widest border-slate-200 h-6 px-3 rounded-lg shadow-sm bg-white">EJECUTIVO DE VENTAS</Badge>
                    </div>
                    <Button 
                        variant="outline" 
                        size="icon" 
                        className="h-12 w-12 rounded-2xl shadow-sm border-slate-100 shrink-0"
                        onClick={() => generateSalespersonPerformancePDF(salesperson, commissions || [], salespersonCustomers || [], companyProfile || undefined)}
                    >
                        <Download className="h-5 w-5 text-slate-600" />
                    </Button>
                </SheetHeader>
                
                <div className="grid grid-cols-2 gap-4">
                    <Card className="border-none bg-slate-900 text-white rounded-[2rem] shadow-xl overflow-hidden relative group">
                        <CardHeader className="p-6 pb-2">
                            <CardTitle className="text-[9px] font-black uppercase tracking-[0.3em] text-primary flex items-center gap-2"><DollarSign className="h-3 w-3" /> Cobrado Real (Mes)</CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 pt-0">
                            <p className="text-3xl font-black tracking-tighter leading-none">${salesperson.monthlySales.toLocaleString()}</p>
                        </CardContent>
                    </Card>

                    <Card className="border-none bg-emerald-600 text-white rounded-[2rem] shadow-xl overflow-hidden relative group">
                        <CardHeader className="p-6 pb-2">
                            <CardTitle className="text-[9px] font-black uppercase tracking-[0.3em] text-emerald-100 flex items-center gap-2"><TrendingUp className="h-3 w-3" /> Comisión Neta</CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 pt-0">
                            <p className="text-3xl font-black tracking-tighter leading-none">${salesperson.earnedCommission.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-4">
                    <div className="flex items-center justify-between px-1">
                        <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400 flex items-center gap-2">
                            <TrendingUp className="h-3.5 w-3.5" /> Curva de Recaudación (CASH)
                        </h3>
                        <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Auditoría 6 Meses</span>
                    </div>
                    <div className="h-56 w-full bg-slate-50/50 rounded-[2.5rem] p-6 border border-slate-100 shadow-inner overflow-hidden">
                        <PerformanceChart data={trendData} />
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="flex justify-between items-end px-2">
                        <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Objetivo Mensual (${(salesperson.salesGoal || 0).toLocaleString()})</h3>
                        <span className="text-sm font-black text-primary tracking-tighter">{goalProgress.toFixed(1)}%</span>
                    </div>
                    <Progress value={goalProgress} className="h-2.5 bg-slate-100 rounded-full shadow-inner" />
                </div>

                <Tabs defaultValue="clients" className="w-full">
                    <TabsList className="grid w-full grid-cols-3 h-12 bg-slate-100 p-1 rounded-2xl mb-8 shadow-inner">
                        <TabsTrigger value="clients" className="rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-lg">Cartera</TabsTrigger>
                        <TabsTrigger value="history" className="rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-lg">Ventas</TabsTrigger>
                        <TabsTrigger value="profile" className="rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-lg">Perfil</TabsTrigger>
                    </TabsList>

                    <TabsContent value="clients" className="mt-0 space-y-4 animate-in fade-in slide-in-from-bottom-2">
                         {isLoadingCustomers ? (
                            <div className="space-y-4">{[1,2].map(i => <div key={i} className="h-14 bg-muted animate-pulse rounded-2xl" />)}</div>
                         ) : salespersonCustomers && salespersonCustomers.length > 0 ? (
                            <div className="grid gap-4">
                                {salespersonCustomers.map(c => (
                                    <div key={c.id} className="p-5 rounded-2xl border border-slate-100 bg-white flex items-center justify-between group hover:border-primary/20 hover:shadow-xl transition-all">
                                        <div className="flex items-center gap-4 min-w-0">
                                            <div className="h-10 w-10 rounded-xl bg-slate-50 flex items-center justify-center border border-slate-100 shadow-inner group-hover:scale-110 transition-transform"><Briefcase className="h-5 w-5 text-slate-400" /></div>
                                            <div className="min-w-0">
                                                <p className="text-xs font-black uppercase tracking-tight text-slate-900 leading-none truncate">{c.razonSocial}</p>
                                                <p className="text-[9px] font-mono font-bold text-slate-400 uppercase mt-1.5 tracking-tighter">RIF: {c.rif}</p>
                                            </div>
                                        </div>
                                        <Badge className={cn("text-[8px] font-black uppercase px-2 h-5 border-none shadow-none shrink-0", c.status === 'Activo' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700')}>{c.status}</Badge>
                                    </div>
                                ))}
                            </div>
                         ) : (
                            <div className="p-16 border-2 border-dashed rounded-[2.5rem] bg-slate-50/50 text-center flex flex-col items-center gap-3 opacity-30">
                                <UsersIcon className="h-10 w-10 text-slate-300" />
                                <p className="text-[10px] font-black uppercase tracking-[0.3em]">Sin cartera vinculada</p>
                            </div>
                         )}
                    </TabsContent>

                    <TabsContent value="history" className="mt-0 animate-in fade-in slide-in-from-bottom-2">
                        <div className="rounded-[2rem] border border-slate-100 overflow-hidden shadow-xl bg-white">
                            <Table>
                                <TableHeader className="bg-slate-900 text-white">
                                    <TableRow className="hover:bg-transparent border-none">
                                        <TableHead className="text-[9px] font-black uppercase h-11 pl-8 text-white">Fecha</TableHead>
                                        <TableHead className="text-[9px] font-black uppercase text-white">Recaudación</TableHead>
                                        <TableHead className="text-right text-[9px] font-black uppercase pr-8 text-white">Comisión</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoadingCommissions ? (
                                        <tr><TableCell colSpan={3} className="h-32 text-center"><Loader2 className="animate-spin h-6 w-6 mx-auto text-primary" /></TableCell></tr>
                                    ) : commissions && commissions.length > 0 ? commissions.map(c => (
                                        <TableRow key={c.id} className="hover:bg-slate-50 transition-colors border-b last:border-none">
                                            <TableCell className="text-[10px] font-bold text-slate-500 py-5 pl-8">
                                                {c.commissionDate instanceof Timestamp ? format(c.commissionDate.toDate(), 'dd MMM, yy', { locale: es }).toUpperCase() : '---'}
                                            </TableCell>
                                            <TableCell className="font-black text-slate-900 text-sm py-5">${(c.invoiceAmount || 0).toFixed(2)}</TableCell>
                                            <TableCell className="text-right font-black text-emerald-600 text-sm py-5 pr-8">${(c.salespersonCommissionAmount || 0).toFixed(2)}</TableCell>
                                        </TableRow>
                                    )) : (
                                        <tr><TableCell colSpan={3} className="h-40 text-center text-[10px] font-black uppercase opacity-20 italic">Sin movimientos conciliados.</TableCell></tr>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </TabsContent>

                    <TabsContent value="profile" className="mt-0 animate-in fade-in slide-in-from-bottom-2">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-6 rounded-[1.8rem] border border-slate-100 bg-slate-50/50 space-y-1.5 shadow-inner">
                                <Label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Zona de Operación</Label>
                                <p className="text-sm font-black uppercase text-slate-900">{salesperson.assignedZone || 'GLOBAL'}</p>
                            </div>
                            <div className="p-6 rounded-[1.8rem] border border-slate-100 bg-slate-50/50 space-y-1.5 shadow-inner">
                                <Label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Supervisor Directo</Label>
                                <p className="text-sm font-black uppercase text-slate-900 truncate">{salesperson.salesManagerName || 'DIRECCIÓN GENERAL'}</p>
                            </div>
                            <div className="p-6 rounded-[1.8rem] border border-slate-100 bg-white space-y-1.5 shadow-sm col-span-2">
                                <Label className="text-[10px] font-black uppercase text-primary tracking-[0.4em] flex items-center gap-2">
                                    <Contact className="h-3.5 w-3.5" /> Contacto Directo
                                </Label>
                                <Separator className="bg-slate-100 my-2" />
                                <div className="grid grid-cols-2 gap-6 pt-2">
                                    <div className="space-y-1">
                                        <p className="text-[8px] font-black text-slate-400 uppercase">Cédula / ID</p>
                                        <p className="text-xs font-bold text-slate-700">{salesperson.identityCard || '---'}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-[8px] font-black text-slate-400 uppercase">Teléfono Móvil</p>
                                        <p className="text-xs font-bold text-slate-700">{salesperson.phone || '---'}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}