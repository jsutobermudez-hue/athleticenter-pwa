'use client';

import React, { useMemo, useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
    Loader2, 
    Truck, 
    Package, 
    DollarSign, 
    Search, 
    User as UserIcon, 
    Phone, 
    Mail, 
    MapPin, 
    ExternalLink, 
    Users, 
    Clock, 
    AlertTriangle,
    MessageCircle,
    Globe,
    Edit,
    ShieldCheck,
    X
} from 'lucide-react';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, limit } from 'firebase/firestore';
import type { Carrier, Order } from '@/lib/definitions';
import { NewCarrierDialog } from './new-carrier-dialog';
import { EditCarrierDialog } from './edit-carrier-dialog';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function DashboardMetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconBg,
  iconColor
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <Card className="border-none shadow-sm rounded-2xl bg-white p-5 flex items-center justify-between transition-all">
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

function CarrierCard({
  carrier,
  onEdit,
}: {
  carrier: Carrier & { activeShipments: number; totalShipments: number; totalValue: number; avgDeliveryHours?: number };
  onEdit: (carrier: Carrier) => void;
}) {
  const isDelayed = (carrier.avgDeliveryHours || 0) > 72;

  const phoneVal = (carrier as any).contactPhone || (carrier as any).phone || '';

  const handleWhatsAppAgency = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rawPhone = phoneVal.replace(/\D/g, '');
    const text = `Hola equipo de *${carrier.name}*, nos comunicamos desde la central logística de *ATHLETICENTER C.A.* para auditar estado de guías y despachos.`;
    const url = rawPhone ? `https://wa.me/${rawPhone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const handleOpenTrackingPortal = (e: React.MouseEvent) => {
    e.stopPropagation();
    const trackingUrl = (carrier as any).trackingUrl || (carrier as any).website || `https://www.google.com/search?q=${encodeURIComponent(carrier.name + ' rastreo de guia')}`;
    window.open(trackingUrl, '_blank');
  };

  return (
    <Card 
        className={cn(
            "terminal-card group transition-all bg-white border-none shadow-sm rounded-[2rem] overflow-hidden flex flex-col justify-between hover:shadow-xl relative",
            isDelayed && "ring-2 ring-amber-500/20"
        )} 
    >
      <div>
        <CardHeader className="p-6 pb-2">
          <div className="flex items-center justify-between mb-2">
              <div className="h-12 w-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                  <Truck className="h-6 w-6" />
              </div>
              <div className="flex items-center gap-2">
                <Badge className={cn("text-[8px] font-black uppercase px-2.5 h-6 border-none shadow-none", carrier.status === 'Activo' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700')}>
                    {carrier.status || 'Activo'}
                </Badge>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full bg-slate-100 hover:bg-primary hover:text-white" onClick={() => onEdit(carrier)}>
                    <Edit className="h-4 w-4" />
                </Button>
              </div>
          </div>
          <CardTitle className="text-xl font-black uppercase tracking-tighter text-slate-900 leading-tight mt-2">{carrier.name}</CardTitle>
          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-1 flex items-center gap-1.5"><Clock className="h-3 w-3 text-amber-500" /> SLA ENTREGA: {carrier.avgDeliveryHours || 48}H PROMEDIO</p>
        </CardHeader>

        <CardContent className="px-6 pb-4 pt-2 space-y-4">
          <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-2xl bg-blue-50 border border-blue-100 text-center space-y-0.5 shadow-inner">
                  <p className="text-2xl font-black text-blue-700 tracking-tighter">{carrier.activeShipments}</p>
                  <p className="text-[7px] font-black uppercase text-blue-400 tracking-widest">En Ruta</p>
              </div>
              <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-100 text-center space-y-0.5 shadow-inner">
                  <p className="text-xl font-black text-emerald-700 tracking-tighter">${(carrier.totalValue / 1000).toFixed(1)}k</p>
                  <p className="text-[7px] font-black uppercase text-emerald-400 tracking-widest">VALOR CARGA</p>
              </div>
          </div>

          <div className="space-y-1.5 border-t border-dashed pt-3 text-slate-500 text-[10px] font-bold">
            {phoneVal && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 truncate">
                  <Phone className="h-3 w-3 text-slate-400 shrink-0" />
                  <span className="truncate">{phoneVal}</span>
                </div>
                <Button size="sm" variant="ghost" onClick={handleWhatsAppAgency} className="h-7 px-2 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 text-[8px] font-black uppercase rounded-lg">
                  <MessageCircle className="h-3 w-3 mr-1" /> agencia
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </div>

      <CardFooter className="p-4 border-t bg-slate-50/50 flex justify-between gap-2">
        <Button variant="ghost" onClick={handleOpenTrackingPortal} className="w-full h-8 text-[8px] font-black uppercase tracking-widest text-primary hover:bg-white flex items-center justify-center gap-1.5">
          <Globe className="h-3.5 w-3.5" /> Portal de Rastreo Web <ExternalLink className="h-3 w-3" />
        </Button>
      </CardFooter>
    </Card>
  );
}

function CarriersContent() {
  const { profile: currentUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const searchParams = useSearchParams();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [editingCarrier, setEditingCarrier] = useState<Carrier | null>(null);

  const carriersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'carriers'), limit(100)) : null), [firestore]);
  const allOrdersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'orders'), limit(200)) : null), [firestore]);

  const { data: carriers, isLoading: isLoadingCarriers } = useCollection<Carrier>(carriersQuery);
  const { data: allOrders, isLoading: isLoadingOrders } = useCollection<Order>(allOrdersQuery);

  const enrichedCarriers = useMemo(() => {
    if (!carriers || !allOrders) return [];
    return carriers.map(carrier => {
      const carrierOrders = allOrders.filter(o => (o.carrier || '').toLowerCase() === carrier.name.toLowerCase());
      return {
        ...carrier,
        activeShipments: carrierOrders.filter(o => o.status === 'Despachado').length,
        totalShipments: carrierOrders.length,
        totalValue: carrierOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0),
      };
    }).sort((a,b) => b.activeShipments - a.activeShipments);
  }, [carriers, allOrders]);

  const metrics = useMemo(() => {
    let activeShipmentsSum = 0;
    let totalValueInTransitSum = 0;
    let totalHours = 0;
    let hoursCount = 0;

    enrichedCarriers.forEach(c => {
      activeShipmentsSum += c.activeShipments;
      totalValueInTransitSum += c.totalValue;
      const hours = (c as any).avgDeliveryHours;
      if (hours) {
        totalHours += Number(hours);
        hoursCount++;
      }
    });

    const avgHours = hoursCount > 0 ? Math.round(totalHours / hoursCount) : 48;
    return { totalCarriers: enrichedCarriers.length, activeShipmentsSum, totalValueInTransitSum, avgHours };
  }, [enrichedCarriers]);

  const filteredCarriers = useMemo(() => {
    if (!enrichedCarriers) return [];
    const term = searchTerm.toLowerCase().trim();
    if (!term) return enrichedCarriers;
    return enrichedCarriers.filter(c => 
      c.name.toLowerCase().includes(term) ||
      ((c as any).contactPhone || (c as any).phone || '').toLowerCase().includes(term)
    );
  }, [enrichedCarriers, searchTerm]);

  if (isUserLoading || isLoadingCarriers) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin h-10 w-10" /></div>;

  return (
    <div className="w-full max-w-[1440px] mx-auto flex flex-col gap-8 pb-32 px-2 sm:px-6 lg:px-8 animate-in fade-in-50 duration-500">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 px-1">
        <div className="space-y-1">
            <h1 className="terminal-header flex items-center gap-3"><Truck className="h-8 w-8 text-primary" /> Hub de Envíos</h1>
            <p className="tech-label opacity-60">Gestión de Logística Externa, Agencias de Encomienda y Monitoreo de SLA.</p>
        </div>
        <NewCarrierDialog />
      </header>
      
      {/* MÉTRICAS EJECUTIVAS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 px-1">
          <DashboardMetricCard 
              title="Convenios de Encomienda" 
              value={metrics.totalCarriers} 
              subtitle="Agencias Logísticas" 
              icon={Truck} 
              iconBg="bg-blue-50" 
              iconColor="text-blue-600" 
          />
          <DashboardMetricCard 
              title="Paquetes en Ruta" 
              value={metrics.activeShipmentsSum} 
              subtitle="Guías Activas en Tránsito" 
              icon={Package} 
              iconBg="bg-sky-50" 
              iconColor="text-sky-600" 
          />
          <DashboardMetricCard 
              title="Valor en Ruta ($)" 
              value={`$${metrics.totalValueInTransitSum.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} 
              subtitle="Carga Asegurada" 
              icon={ShieldCheck} 
              iconBg="bg-emerald-50" 
              iconColor="text-emerald-600" 
          />
          <DashboardMetricCard 
              title="SLA Promedio" 
              value={`${metrics.avgHours} Horas`} 
              subtitle="Tiempo de Entrega Nacional" 
              icon={Clock} 
              iconBg="bg-amber-50" 
              iconColor="text-amber-600" 
          />
      </div>

      {/* BÚSQUEDA DIRECTA */}
      <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden mx-1">
          <CardContent className="p-4 flex items-center justify-between gap-4">
              <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <Input 
                      placeholder="BUSCAR AGENCIA DE ENCOMIENDA..." 
                      className="pl-9 h-10 text-[10px] font-bold uppercase rounded-xl border-none bg-slate-50 shadow-inner w-full" 
                      value={searchTerm} 
                      onChange={(e) => setSearchTerm(e.target.value)} 
                  />
              </div>
              {searchTerm && (
                <Button variant="ghost" size="sm" onClick={() => setSearchTerm('')} className="h-10 text-[9px] font-black uppercase text-primary px-3 rounded-xl">
                  Limpiar <X className="ml-1 h-3 w-3" />
                </Button>
              )}
          </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 px-1">
        {filteredCarriers.length > 0 ? filteredCarriers.map((carrier) => (
          <CarrierCard key={carrier.id} carrier={carrier} onEdit={setEditingCarrier} />
        )) : (
          <div className="sm:col-span-2 lg:col-span-3 xl:col-span-4 p-16 text-center border-2 border-dashed rounded-[2.5rem] bg-white flex flex-col items-center justify-center gap-3 opacity-40">
              <Truck className="h-10 w-10 text-slate-400" />
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sin agencias de transporte encontradas</p>
          </div>
        )}
      </div>

      {editingCarrier && (
        <EditCarrierDialog carrier={editingCarrier} isOpen={!!editingCarrier} onOpenChange={(open) => !open && setEditingCarrier(null)} />
      )}
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
