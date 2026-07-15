
'use client';

import React, { useMemo, useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { Loader2, Truck, Package, DollarSign, Search, User as UserIcon, Phone, Mail, MapPin, ExternalLink, Users, Clock, AlertTriangle } from 'lucide-react';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, limit } from 'firebase/firestore';
import type { Carrier, Order, User, OrderStatus } from '@/lib/definitions';
import { Skeleton } from '@/components/ui/skeleton';
import { NewCarrierDialog } from './new-carrier-dialog';
import { EditCarrierDialog } from './edit-carrier-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function CarrierCard({
  carrier,
  onSelect,
}: {
  carrier: Carrier & { activeShipments: number; totalShipments: number; totalValue: number; avgDeliveryHours?: number };
  onSelect: (carrier: any) => void;
}) {
  const isDelayed = (carrier.avgDeliveryHours || 0) > 72;

  return (
    <Card 
        className={cn(
            "terminal-card group transition-all cursor-pointer hover:shadow-2xl hover:-translate-y-1 active:scale-95",
            isDelayed && "ring-2 ring-amber-500/20"
        )} 
        onClick={() => onSelect(carrier)}
    >
      <CardHeader className="p-8 pb-4">
        <div className="flex items-center justify-between mb-4">
            <div className="h-12 w-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                <Truck className="h-6 w-6" />
            </div>
             <Badge className={cn("text-[8px] font-black uppercase px-2 h-5 border-none shadow-none", carrier.status === 'Activo' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700')}>
                {carrier.status}
            </Badge>
        </div>
        <CardTitle className="text-xl font-black uppercase tracking-tighter text-slate-900 leading-tight">{carrier.name}</CardTitle>
        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-1 flex items-center gap-1.5"><Clock className="h-3 w-3" /> PROMEDIO: {carrier.avgDeliveryHours || '--'}H</p>
      </CardHeader>
      <CardContent className="px-8 pb-8 grid grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100 text-center space-y-0.5 shadow-inner">
            <p className="text-2xl font-black text-blue-700 tracking-tighter">{carrier.activeShipments}</p>
            <p className="text-[7px] font-black uppercase text-blue-400 tracking-widest">En Ruta</p>
        </div>
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100 text-center space-y-0.5 shadow-inner">
            <p className="text-xl font-black text-emerald-700 tracking-tighter">${(carrier.totalValue / 1000).toFixed(1)}k</p>
            <p className="text-[7px] font-black uppercase text-emerald-400 tracking-widest">VALOR</p>
        </div>
      </CardContent>
    </Card>
  );
}

function CarriersContent() {
  const { profile: currentUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const searchParams = useSearchParams();
  
  const carriersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'carriers'), limit(100)) : null), [firestore]);
  const allOrdersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'orders'), limit(200)) : null), [firestore]);

  const { data: carriers, isLoading: isLoadingCarriers } = useCollection<Carrier>(carriersQuery);
  const { data: allOrders, isLoading: isLoadingOrders } = useCollection<Order>(allOrdersQuery);

  const enrichedCarriers = useMemo(() => {
    if (!carriers || !allOrders) return [];
    return carriers.map(carrier => {
      const carrierOrders = allOrders.filter(o => o.carrier === carrier.name);
      return {
        ...carrier,
        activeShipments: carrierOrders.filter(o => o.status === 'Despachado').length,
        totalShipments: carrierOrders.length,
        totalValue: carrierOrders.reduce((sum, o) => sum + o.totalAmount, 0),
      };
    }).sort((a,b) => b.activeShipments - a.activeShipments);
  }, [carriers, allOrders]);

  if (isUserLoading || isLoadingCarriers) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin h-10 w-10" /></div>;

  return (
    <div className="w-full max-w-[1440px] mx-auto flex flex-col gap-10 pb-32 px-4 sm:px-6 lg:px-8 animate-in fade-in-50 duration-500">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
        <div className="space-y-1">
            <h1 className="terminal-header">Hub de Envíos</h1>
            <p className="tech-label opacity-60">Gestión de Logística Externa y Directorio de Enlaces.</p>
        </div>
        <NewCarrierDialog />
      </header>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
        {enrichedCarriers.map((carrier) => (
          <CarrierCard key={carrier.id} carrier={carrier} onSelect={() => {}} />
        ))}
      </div>
    </div>
  );
}

export default function CarriersPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin h-10 w-10 text-primary" /></div>}>
            <CarriersContent />
        </Suspense>
    );
}
