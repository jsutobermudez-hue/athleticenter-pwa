'use client';

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, limit, serverTimestamp, addDoc, Timestamp, orderBy } from 'firebase/firestore';
import type { PurchaseOrder, Supplier } from '@/lib/definitions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { 
    Globe, 
    Plus, 
    Ship, 
    Plane, 
    Loader2, 
    MapPin, 
    ArrowRight, 
    ShieldCheck, 
    AlertCircle, 
    Package,
    DollarSign,
    Search,
    Filter,
    Calendar,
    Clock,
    X,
    CheckCircle2
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PurchaseOrderDetailSheet } from './PurchaseOrderDetailSheet';
import { format } from 'date-fns';

export const dynamic = 'force-dynamic';

function parseSafeDate(val: any): Date | null {
    if (!val) return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    if (typeof val?.toDate === 'function') {
        try { return val.toDate(); } catch (e) { return null; }
    }
    if (typeof val?.seconds === 'number') {
        return new Date(val.seconds * 1000);
    }
    if (typeof val === 'string' || typeof val === 'number') {
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

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

function PurchaseOrdersContent() {
    const router = useRouter();
    const firestore = useFirestore();
    const { toast } = useToast();
    const { profile, isUserLoading } = useUser();
    const [isNewDialogOpen, setIsNewDialogOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);

    const [searchTerm, setSearchTerm] = useState('');
    const [transportFilter, setTransportFilter] = useState('todos');
    const [statusFilter, setStatusFilter] = useState('todos');

    useEffect(() => {
        if (!isUserLoading && profile && !['superadmin', 'gerencia'].includes(profile.role)) {
            router.replace('/dashboard');
        }
    }, [profile, isUserLoading, router]);

    const posQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'purchaseOrders'), orderBy('createdAt', 'desc'), limit(100)) : null), [firestore]);
    const { data: rawOrders, isLoading: isLoadingOrders } = useCollection<PurchaseOrder>(posQuery);

    const suppliersQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'suppliers'), limit(50)) : null), [firestore]);
    const { data: suppliers } = useCollection<Supplier>(suppliersQuery);

    // MÉTRICAS EJECUTIVAS DE IMPORTACIONES
    const metrics = useMemo(() => {
        if (!rawOrders) return { totalInTransit: 0, transitCount: 0, seaTotal: 0, seaCount: 0, airTotal: 0, airCount: 0, receivedTotal: 0 };

        let totalInTransit = 0;
        let transitCount = 0;
        let seaTotal = 0;
        let seaCount = 0;
        let airTotal = 0;
        let airCount = 0;
        let receivedTotal = 0;

        rawOrders.forEach(po => {
            const cost = po.totalCost || 0;
            if (po.status !== 'Recibido' && po.status !== 'Cancelado') {
                totalInTransit += cost;
                transitCount++;
            } else if (po.status === 'Recibido') {
                receivedTotal += cost;
            }

            if (po.transportMode === 'Marítimo') {
                seaTotal += cost;
                seaCount++;
            } else if (po.transportMode === 'Aéreo') {
                airTotal += cost;
                airCount++;
            }
        });

        return { totalInTransit, transitCount, seaTotal, seaCount, airTotal, airCount, receivedTotal };
    }, [rawOrders]);

    const filteredOrders = useMemo(() => {
        if (!rawOrders) return [];
        let items = [...rawOrders];

        const term = searchTerm.toLowerCase().trim();
        if (term) {
            items = items.filter(po => 
                po.supplierName.toLowerCase().includes(term) ||
                po.originCountry.toLowerCase().includes(term) ||
                po.originCity.toLowerCase().includes(term) ||
                (po.id || '').toLowerCase().includes(term)
            );
        }

        if (transportFilter !== 'todos') {
            items = items.filter(po => po.transportMode === transportFilter);
        }

        if (statusFilter !== 'todos') {
            items = items.filter(po => po.status === statusFilter);
        }

        return items;
    }, [rawOrders, searchTerm, transportFilter, statusFilter]);

    const handleCreatePO = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!firestore || !profile) return;
        const formData = new FormData(e.currentTarget);
        const supplierId = formData.get('supplierId') as string;
        if (!supplierId) { toast({ variant: 'destructive', title: "Proveedor requerido" }); return; }

        setIsSubmitting(true);
        try {
            const supplier = suppliers?.find(s => s.id === supplierId);
            const arrivalDate = formData.get('arrival') as string;
            await addDoc(collection(firestore, 'purchaseOrders'), {
                supplierId, supplierName: supplier?.name || 'N/A', 
                originCountry: formData.get('originCountry') as string, originCity: formData.get('originCity') as string,
                transportMode: formData.get('transportMode') as any, status: 'Pendiente', items: [], totalCost: 0,
                estimatedArrival: arrivalDate ? Timestamp.fromDate(new Date(arrivalDate)) : null,
                createdAt: serverTimestamp(), createdBy: profile.id
            });
            toast({ title: "Orden Iniciada" });
            setIsNewDialogOpen(false);
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Error de Creación" });
        } finally { setIsSubmitting(false); }
    };

    if (isUserLoading || isLoadingOrders) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="w-full max-w-[1440px] mx-auto flex flex-col gap-8 pb-32 px-2 sm:px-6 lg:px-8 animate-in fade-in-50 duration-500">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-1">
                <div className="space-y-1">
                    <h1 className="text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none flex items-center gap-3"><Globe className="h-8 w-8 text-primary" /> Suministros Globales</h1>
                    <p className="text-[10px] text-muted-foreground font-black italic uppercase tracking-[0.4em] opacity-60">Gestión de Importaciones, Aduanas y Costos Landed WAC.</p>
                </div>
                <Dialog open={isNewDialogOpen} onOpenChange={setIsNewDialogOpen}>
                    <DialogTrigger asChild><Button className="h-12 px-8 rounded-2xl font-black uppercase text-[10px] shadow-xl tracking-wider"><Plus className="mr-2 h-4 w-4" /> Nueva Importación</Button></DialogTrigger>
                    <DialogContent className="sm:max-w-xl rounded-[2.5rem] border-none shadow-2xl overflow-hidden">
                        <DialogHeader className="p-8 bg-slate-50 border-b"><DialogTitle className="text-2xl font-black uppercase tracking-tighter">Plan de Suministro (PO)</DialogTitle></DialogHeader>
                        {!suppliers?.length ? <div className="p-10 text-center"><AlertCircle className="h-12 w-12 mx-auto mb-4 text-amber-500" /><Button asChild><Link href="/dashboard/suppliers">Registrar Proveedor</Link></Button></div> : (
                            <form onSubmit={handleCreatePO} className="p-8 space-y-6">
                                <div className="space-y-1">
                                    <Label className="text-[9px] font-black uppercase px-1">Socio / Proveedor Internacional</Label>
                                    <Select name="supplierId" required><SelectTrigger className="h-12 rounded-xl font-bold uppercase text-xs"><SelectValue placeholder="Seleccionar socio..." /></SelectTrigger><SelectContent>{suppliers?.map(s => <SelectItem key={s.id} value={s.id!}>{s.name.toUpperCase()}</SelectItem>)}</SelectContent></Select>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <Label className="text-[9px] font-black uppercase px-1">País Origen</Label>
                                        <Input name="originCountry" placeholder="Ej. China" required className="h-12 rounded-xl font-bold uppercase text-xs" />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-[9px] font-black uppercase px-1">Puerto / Ciudad</Label>
                                        <Input name="originCity" placeholder="Ej. Ningbo" required className="h-12 rounded-xl font-bold uppercase text-xs" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <Label className="text-[9px] font-black uppercase px-1">Modo Transporte</Label>
                                        <Select name="transportMode" defaultValue="Marítimo"><SelectTrigger className="h-12 rounded-xl font-bold uppercase text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Marítimo">🚢 MARÍTIMO</SelectItem><SelectItem value="Aéreo">✈️ AÉREO</SelectItem></SelectContent></Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-[9px] font-black uppercase px-1">Fecha Arribo Estimada (ETA)</Label>
                                        <Input name="arrival" type="date" required className="h-12 rounded-xl font-bold text-xs" />
                                    </div>
                                </div>
                                <Button type="submit" disabled={isSubmitting} className="w-full h-14 rounded-2xl font-black uppercase tracking-[0.2em] shadow-xl">{isSubmitting ? <Loader2 className="animate-spin h-5 w-5" /> : "Iniciar Suministro"}</Button>
                            </form>
                        )}
                    </DialogContent>
                </Dialog>
            </header>

            {/* METRICAS PIPELINE DE IMPORTACIÓN */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 px-1">
                <DashboardMetricCard 
                    title="En Tránsito ($)" 
                    value={`$${metrics.totalInTransit.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} 
                    subtitle={`${metrics.transitCount} Lotes en Ruta`} 
                    icon={Globe} 
                    iconBg="bg-blue-50" 
                    iconColor="text-blue-500" 
                    onClick={() => setStatusFilter('todos')}
                    isActive={statusFilter === 'todos' && transportFilter === 'todos'}
                />
                <DashboardMetricCard 
                    title="Cargas Marítimas" 
                    value={metrics.seaCount} 
                    subtitle={`$${metrics.seaTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })} En Mar`} 
                    icon={Ship} 
                    iconBg="bg-indigo-50" 
                    iconColor="text-indigo-600" 
                    onClick={() => setTransportFilter('Marítimo')}
                    isActive={transportFilter === 'Marítimo'}
                />
                <DashboardMetricCard 
                    title="Envíos Aéreos" 
                    value={metrics.airCount} 
                    subtitle={`$${metrics.airTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })} Express`} 
                    icon={Plane} 
                    iconBg="bg-sky-50" 
                    iconColor="text-sky-600" 
                    onClick={() => setTransportFilter('Aéreo')}
                    isActive={transportFilter === 'Aéreo'}
                />
                <DashboardMetricCard 
                    title="Recibido WAC ($)" 
                    value={`$${metrics.receivedTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} 
                    subtitle="Inventario Sincerado" 
                    icon={ShieldCheck} 
                    iconBg="bg-emerald-50" 
                    iconColor="text-emerald-600" 
                    onClick={() => setStatusFilter('Recibido')}
                    isActive={statusFilter === 'Recibido'}
                />
            </div>

            {/* FILTROS TÁCTICOS */}
            <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden mx-1">
                <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 items-end">
                    <div className="space-y-1">
                        <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Búsqueda Táctica de Suministros</Label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                            <Input 
                                placeholder="PROVEEDOR / PAÍS / CIUDAD..." 
                                className="pl-9 h-10 text-[10px] font-bold uppercase rounded-xl border-none bg-slate-50 shadow-inner" 
                                value={searchTerm} 
                                onChange={(e) => setSearchTerm(e.target.value)} 
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Modo Transporte</Label>
                        <Select value={transportFilter} onValueChange={setTransportFilter}>
                            <SelectTrigger className="h-10 text-[10px] font-bold uppercase rounded-xl border-none bg-slate-50 shadow-inner">
                                <SelectValue placeholder="Todos" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="todos" className="text-[10px] font-bold uppercase">TODOS LOS MEDIOS</SelectItem>
                                <SelectItem value="Marítimo" className="text-[10px] font-bold uppercase">🚢 MARÍTIMO</SelectItem>
                                <SelectItem value="Aéreo" className="text-[10px] font-bold uppercase">✈️ AÉREO</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {(searchTerm || transportFilter !== 'todos' || statusFilter !== 'todos') && (
                        <div className="flex justify-end">
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => { setSearchTerm(''); setTransportFilter('todos'); setStatusFilter('todos'); }}
                                className="h-10 text-[9px] font-black uppercase text-primary px-3 rounded-xl hover:bg-primary/5"
                            >
                                Limpiar Filtros <X className="ml-1 h-3 w-3" />
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 px-1">
                {filteredOrders.length > 0 ? filteredOrders.map(po => {
                    const etaDate = parseSafeDate(po.estimatedArrival);

                    return (
                        <Card key={po.id} onClick={() => setSelectedPO(po)} className="cursor-pointer border-none shadow-xl rounded-[2.5rem] overflow-hidden group flex flex-col sm:flex-row transition-all hover:shadow-2xl hover:-translate-y-1">
                            <div className={cn("w-full sm:w-48 p-8 flex flex-col items-center justify-center text-white shrink-0", po.status === 'Recibido' ? "bg-emerald-600" : "bg-blue-600")}>
                                {po.status === 'Recibido' ? <ShieldCheck className="h-12 w-12" /> : po.transportMode === 'Aéreo' ? <Plane className="h-12 w-12" /> : <Ship className="h-12 w-12" />}
                                <p className="text-sm font-black uppercase mt-2">{po.status}</p>
                                <Badge variant="secondary" className="mt-2 bg-white/20 text-white font-mono text-[8px] border-none px-2">
                                    {po.transportMode === 'Aéreo' ? '✈️ AÉREO' : '🚢 MARÍTIMO'}
                                </Badge>
                            </div>

                            <div className="flex-1 p-8 space-y-5">
                                <div className="flex justify-between items-start">
                                    <div className="space-y-0.5">
                                        <h3 className="text-xl font-black uppercase tracking-tighter text-slate-900 leading-tight">{po.supplierName}</h3>
                                        <p className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
                                            <MapPin className="h-3 w-3 text-primary" /> {po.originCity}, {po.originCountry}
                                        </p>
                                    </div>
                                    {etaDate && (
                                        <Badge variant="outline" className="bg-slate-50 border-slate-200 text-slate-600 text-[8px] font-black uppercase px-2">
                                            ETA: {format(etaDate, 'dd/MM/yy')}
                                        </Badge>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-4 rounded-2xl bg-slate-50 space-y-1">
                                        <p className="text-[8px] font-black uppercase text-slate-400">Manifiesto</p>
                                        <p className="text-sm font-black text-slate-900">{po.items?.length || 0} Modelos</p>
                                    </div>
                                    <div className="p-4 rounded-2xl bg-blue-50 space-y-1">
                                        <p className="text-[8px] font-black uppercase text-blue-400">Inversión Lote</p>
                                        <p className="text-sm font-black text-blue-700">${(po.totalCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                                    </div>
                                </div>

                                <Button variant="ghost" size="sm" className="w-full text-[9px] font-black uppercase text-primary tracking-widest group-hover:bg-primary group-hover:text-white transition-colors h-10 rounded-xl">
                                    Abrir Manifiesto Landed WAC <ArrowRight className="ml-2 h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </Card>
                    );
                }) : (
                    <div className="lg:col-span-2 p-16 text-center border-2 border-dashed rounded-[2.5rem] bg-white flex flex-col items-center justify-center gap-3 opacity-40">
                        <Globe className="h-10 w-10 text-slate-400" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sin importaciones registradas con los filtros seleccionados</p>
                    </div>
                )}
            </div>

            <PurchaseOrderDetailSheet order={selectedPO} isOpen={!!selectedPO} onOpenChange={(open) => !open && setSelectedPO(null)} />
        </div>
    );
}

export default function PurchaseOrdersPage() {
    return <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}><PurchaseOrdersContent /></Suspense>;
}