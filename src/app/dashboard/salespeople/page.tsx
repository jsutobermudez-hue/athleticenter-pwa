'use client';

import React, { useMemo, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Users as UsersIcon,
  Loader2,
  TrendingUp as TrendingIcon,
  ShieldAlert,
  ChevronRight,
  ArrowRight,
  Target,
  DollarSign
} from 'lucide-react';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, limit, Timestamp } from 'firebase/firestore';
import type { Order, User, Customer } from '@/lib/definitions';
import { startOfMonth } from 'date-fns';
import { SalespersonDetailsSheet, type SalespersonWithStats } from './salesperson-details-sheet';
import { cn } from '@/lib/utils';
import { SalespersonRankingCard } from '@/components/dashboard/SalespersonRankingCard';

export const dynamic = 'force-dynamic';

function SalespeoplePageContent() {
  const { profile: currentUser, isUserLoading } = useUser();
  const router = useRouter();
  const firestore = useFirestore();
  const [selectedSalesperson, setSelectedSalesperson] = useState<SalespersonWithStats | null>(null);
  
  const isAdmin = useMemo(() => 
    currentUser && ['superadmin', 'admin', 'gerencia'].includes(currentUser.role), 
  [currentUser]);

  const salespeopleQuery = useMemoFirebase(() => (firestore && isAdmin) ? query(collection(firestore, 'users'), where('role', '==', 'ventas'), limit(100)) : null, [firestore, isAdmin]);
  const customersQuery = useMemoFirebase(() => (firestore && isAdmin) ? query(collection(firestore, 'customers'), limit(100)) : null, [firestore, isAdmin]);
  const allOrdersQuery = useMemoFirebase(() => (firestore && isAdmin) ? query(collection(firestore, 'orders'), where('orderDate', '>=', startOfMonth(new Date())), limit(500)) : null, [firestore, isAdmin]);

  const { data: salespeople, isLoading: isLoadingSalespeople } = useCollection<User>(salespeopleQuery);
  const { data: customers } = useCollection<Customer>(customersQuery);
  const { data: allOrders } = useCollection<Order>(allOrdersQuery);

  const salespeopleWithStats = useMemo(() => {
    if (!salespeople || !customers || !allOrders) return [];
    return salespeople.map(sp => {
      const spOrders = allOrders.filter(o => o.salespersonId === sp.id);
      
      // Cálculo de ventas mensuales (CASH real o estimado 65% si no hay registro)
      const monthlySales = spOrders
        .filter(o => ['Pagado', 'Entregado'].includes(o.status))
        .reduce((sum, o) => sum + (o.totalCashReceived ?? (o.totalAmount * 0.65)), 0);
      
      // Comisión ganada solo sobre pedidos liquidados
      const commissionRate = sp.commissionRate || 0.05;
      const earnedCommission = spOrders
        .filter(o => o.status === 'Pagado')
        .reduce((sum, o) => sum + ((o.totalCashReceived ?? (o.totalAmount * 0.65)) * commissionRate), 0);
        
      return {
        ...sp,
        customerCount: customers.filter(c => c.assignedSalespersonId === sp.id).length,
        monthlyOrderCount: spOrders.length,
        monthlySales,
        earnedCommission,
        pendingSales: spOrders.filter(o => ['Aprobado', 'Despachado'].includes(o.status)).reduce((sum, o) => sum + o.totalAmount, 0),
      } as SalespersonWithStats;
    }).sort((a, b) => b.monthlySales - a.monthlySales);
  }, [salespeople, customers, allOrders]);

  if (isUserLoading || isLoadingSalespeople) return <div className="flex h-[80svh] items-center justify-center"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>;

  if (!isAdmin) {
    return (
        <div className="flex flex-col items-center justify-center h-[70svh] text-center gap-6 p-8 animate-in fade-in duration-700">
            <div className="p-6 rounded-full bg-rose-50 text-rose-500 shadow-inner"><ShieldAlert className="h-12 w-12" /></div>
            <div className="space-y-2">
                <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Acceso Restringido</h2>
                <p className="text-sm text-slate-400 font-medium max-w-xs mx-auto uppercase">Esta terminal requiere permisos de gerencia administrativa para visualizar el rendimiento del equipo.</p>
            </div>
            <Button onClick={() => router.push('/dashboard')} className="h-12 px-10 rounded-xl font-black uppercase tracking-widest text-[10px]">Volver al Mando</Button>
        </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-10 max-w-[1440px] mx-auto pb-32 animate-in fade-in-50 duration-500 px-2 sm:px-4">
        <header className="space-y-2 px-2">
          <h1 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none italic">Gerencia de Ventas</h1>
          <p className="text-muted-foreground font-black italic text-[10px] sm:text-[11px] tracking-[0.4em] uppercase opacity-60">AUDITORÍA DE RENDIMIENTO Y LIQUIDACIÓN DE COMISIONES.</p>
        </header>

        {/* Componente de Ranking de Vendedores con Filtros */}
        <div className="px-2">
          <SalespersonRankingCard orders={allOrders || []} />
        </div>

        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 px-2">
            {salespeopleWithStats.map(sp => {
                const totalGoal = sp.salesGoal || 5000;
                const progress = (sp.monthlySales / totalGoal) * 100;

                return (
                    <Card key={sp.id} className="cursor-pointer rounded-[2.5rem] border-none shadow-sm bg-white hover:shadow-2xl hover:-translate-y-1 transition-all group overflow-hidden" onClick={() => setSelectedSalesperson(sp)}>
                        <CardHeader className="flex flex-row items-center gap-4 p-6 pb-2">
                            <Avatar className="h-14 w-14 border-2 border-slate-50 shadow-md group-hover:scale-110 transition-transform duration-500">
                                <AvatarImage src={sp.avatarUrl} className="object-cover" />
                                <AvatarFallback className="bg-primary/10 text-primary font-black uppercase">{sp.name.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                                <CardTitle className="text-base font-black uppercase tracking-tight truncate text-slate-900 leading-none">{sp.name}</CardTitle>
                                <p className="text-[9px] font-black text-slate-400 uppercase mt-1.5 tracking-[0.2em]">CUOTA: {(sp.commissionRate ? sp.commissionRate * 100 : 5)}%</p>
                            </div>
                        </CardHeader>
                        <CardContent className="p-6 pt-4 space-y-6">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-4 bg-slate-900 text-white rounded-2xl shadow-lg relative overflow-hidden">
                                    <DollarSign className="absolute -right-1 -bottom-1 h-8 w-8 opacity-10" />
                                    <p className="text-[8px] font-black uppercase text-primary mb-1">Cobrado Real</p>
                                    <p className="text-xl font-black tracking-tighter">${sp.monthlySales.toLocaleString()}</p>
                                </div>
                                <div className="p-4 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-100">
                                    <p className="text-[8px] font-black uppercase text-emerald-500 mb-1">Comisión</p>
                                    <p className="text-xl font-black tracking-tighter">${sp.earnedCommission.toFixed(2)}</p>
                                </div>
                            </div>
                            
                            <div className="space-y-2">
                                <div className="flex justify-between items-end px-1">
                                    <span className="text-[8px] font-black uppercase text-slate-400">Progreso Meta</span>
                                    <span className="text-xs font-black text-slate-900 tracking-tighter">{progress.toFixed(1)}%</span>
                                </div>
                                <Progress value={progress} className="h-2 rounded-full bg-slate-50 shadow-inner" />
                            </div>
                        </CardContent>
                        <CardFooter className="p-6 pt-0 border-t border-slate-50 bg-slate-50/20 flex justify-between items-center group/footer">
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1.5"><UsersIcon className="h-3 w-3 text-slate-400" /><span className="text-[8px] font-black uppercase text-slate-600">{sp.customerCount} Clientes</span></div>
                                <div className="h-3 w-px bg-slate-200" />
                                <div className="flex items-center gap-1.5"><TrendingIcon className="h-3 w-3 text-emerald-500" /><span className="text-[8px] font-black uppercase text-slate-600">{sp.monthlyOrderCount} Pedidos</span></div>
                            </div>
                            <div className="h-8 w-8 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-primary shadow-sm group-hover/footer:bg-primary group-hover/footer:text-white transition-all">
                                <ArrowRight className="h-4 w-4" />
                            </div>
                        </CardFooter>
                    </Card>
                );
            })}
        </div>
      </div>
      <SalespersonDetailsSheet salesperson={selectedSalesperson} onOpenChange={(open) => !open && setSelectedSalesperson(null)} />
    </>
  );
}

export default function SalespeoplePage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
            <SalespeoplePageContent />
        </Suspense>
    );
}
