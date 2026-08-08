'use client';

import React, { useState } from 'react';
import {
  MoreHorizontal,
  Play,
  Check,
  Truck,
  CheckCheck,
  PackageSearch,
  Cog,
  PackageCheck as PackageCheckIcon,
  Eye,
  ShieldCheck,
  Calendar,
  CheckCircle,
  Box,
  Scale,
  Printer,
  ChevronRight,
  CreditCard,
  Loader2,
  AlertTriangle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import type { Order, OrderStatus, OrderItem, OrderItemClient, Product, CompanyProfile, Customer } from '@/lib/definitions';
import { Timestamp, getDocs, collection, query, limit, doc, getDoc } from 'firebase/firestore';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { generatePackageLabelsPDF } from '@/lib/pdf-generator';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

function LogisticsOrderCard({ order, onOpenDialog, onNavigateToDetails }: { order: Order, onOpenDialog: Function, onNavigateToDetails: (order: Order) => void }) {
    const firestore = useFirestore();
    const { toast } = useToast();
    const [isPrinting, setIsPrinting] = useState(false);
    
    const companyProfileRef = useMemoFirebase(() => (firestore ? doc(firestore, 'companyProfile', 'main') : null), [firestore]);
    const { data: companyProfile } = useDoc<CompanyProfile>(companyProfileRef);

    /**
     * IMPRESIÓN DINÁMICA DESDE KANBAN
     * Recupera ítems y datos de cliente en tiempo real para generar manifiesto completo.
     */
    const handlePrintLabelsFromKanban = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!firestore || isPrinting) return;
        setIsPrinting(true);

        try {
            const itemsSnap = await getDocs(query(collection(firestore, `orders/${order.id}/orderItems`), limit(100)));
            const itemsData = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() } as OrderItem));
            
            const customerSnap = await getDoc(doc(firestore, 'customers', order.customerId));
            const customer = customerSnap.exists() ? customerSnap.data() as Customer : null;

            const enrichedItems = await Promise.all(itemsData.map(async (item) => {
                const pSnap = await getDoc(doc(firestore, 'products', item.productId));
                return { ...item, product: pSnap.exists() ? pSnap.data() as Product : null } as OrderItemClient;
            }));

            await generatePackageLabelsPDF(order, enrichedItems.filter(i => i.product), companyProfile || undefined, customer?.address);
            toast({ title: "Etiquetas Generadas" });
        } catch (err) {
            toast({ variant: 'destructive', title: "Fallo de Impresión" });
        } finally {
            setIsPrinting(false);
        }
    };

    const renderPrimaryAction = () => {
        switch (order.status) {
            case 'Aprobado':
                return <Button variant="default" className="w-full h-10 sm:h-9 rounded-xl bg-slate-900 hover:bg-primary font-black uppercase text-[10px] sm:text-[9px] tracking-widest shadow-lg" onClick={(e) => { e.stopPropagation(); onOpenDialog('confirmStatus', order, 'En Preparación'); }}><Play className="mr-2 h-4 w-4 sm:h-3.5 sm:w-3.5" /> INICIAR PICKING</Button>;
            case 'En Preparación':
                return <Button variant="default" className="w-full h-10 sm:h-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 font-black uppercase text-[10px] sm:text-[9px] tracking-widest shadow-lg" onClick={(e) => { e.stopPropagation(); onOpenDialog('completePacking', order); }}><Check className="mr-2 h-4 w-4 sm:h-3.5 sm:w-3.5" /> FINALIZAR EMBALAJE</Button>;
            case 'Completado':
                return (
                    <div className="flex flex-col gap-2">
                        <Button variant="default" className="w-full h-10 sm:h-9 rounded-xl bg-primary hover:bg-primary/90 font-black uppercase text-[10px] sm:text-[9px] tracking-widest shadow-lg" onClick={(e) => { e.stopPropagation(); onOpenDialog('dispatch', order); }}><Truck className="mr-2 h-4 w-4 sm:h-3.5 sm:w-3.5" /> ASIGNAR TRANSPORTE</Button>
                        <Button variant="outline" disabled={isPrinting} className="w-full h-9 sm:h-8 rounded-xl border-slate-200 font-black uppercase text-[9px] sm:text-[8px] tracking-widest hover:bg-slate-50" onClick={handlePrintLabelsFromKanban}>
                            {isPrinting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Printer className="mr-2 h-3.5 w-3.5 sm:h-3 sm:w-3 text-primary" />} ETIQUETAS QR
                        </Button>
                    </div>
                );
            case 'Despachado':
                return (
                    <div className="flex flex-col gap-2">
                        <Button variant="default" className="w-full h-10 sm:h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 font-black uppercase text-[10px] sm:text-[9px] tracking-widest shadow-lg" onClick={(e) => { e.stopPropagation(); onOpenDialog('confirmDelivery', order); }}><CheckCheck className="mr-2 h-4 w-4 sm:h-3.5 sm:w-3.5" /> CONFIRMAR RECEPCIÓN</Button>
                        <Button variant="outline" disabled={isPrinting} className="w-full h-9 sm:h-8 rounded-xl border-slate-200 font-black uppercase text-[9px] sm:text-[8px] tracking-widest hover:bg-slate-50" onClick={handlePrintLabelsFromKanban}>
                            {isPrinting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Printer className="mr-2 h-3.5 w-3.5 sm:h-3 sm:w-3 text-primary" />} ETIQUETAS QR
                        </Button>
                    </div>
                );
            default:
                return null;
        }
    }

    return (
        <Card 
            className="group cursor-pointer transition-all hover:shadow-xl hover:-translate-y-1 border-primary/5 bg-white p-4 sm:p-5 flex flex-col gap-4 rounded-[1.5rem] sm:rounded-2xl shadow-none ring-1 ring-primary/5 relative overflow-hidden h-full"
            onClick={() => onNavigateToDetails(order)}
        >
            <div className="absolute top-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronRight className="h-5 w-5 text-slate-300" />
            </div>

            <div className="flex justify-between items-start">
                <div className="space-y-0.5">
                    <p className="text-[8px] sm:text-[7px] font-black text-slate-400 uppercase tracking-widest">EXPEDIENTE</p>
                    <p className="text-[11px] sm:text-[10px] font-mono font-bold text-primary">#{order.id.substring(0, 8)}</p>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg"><MoreHorizontal className="h-5 w-5" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-xl shadow-xl z-[150]">
                        <DropdownMenuLabel className="text-[10px] font-black uppercase text-muted-foreground">Logística</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => onNavigateToDetails(order)} className="font-bold text-xs"><Eye className="mr-2 h-4 w-4" /> Ver Detalles</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <div className="space-y-1.5">
                <p className="text-[12px] sm:text-[11px] font-black uppercase tracking-tight text-slate-900 truncate leading-tight">{order.customerName}</p>
                <div className="flex items-center gap-2 text-[9px] sm:text-[8px] font-bold text-slate-400 uppercase">
                    <Calendar className="h-3.5 w-3.5 sm:h-3 sm:w-3" /> {format((order.orderDate as Timestamp).toDate(), "dd MMM, yy", { locale: es })}
                </div>
            </div>

            {(order.status === 'Despachado' || order.status === 'Completado') && (
                <div className={cn("p-3 sm:p-2.5 rounded-xl text-white space-y-2", order.status === 'Completado' ? 'bg-slate-700' : 'bg-slate-900')}>
                    <div className="flex justify-between items-center border-b border-white/10 pb-1.5">
                        <span className="text-[8px] sm:text-[7px] font-black uppercase text-slate-400">Guía Interna</span>
                        <span className="text-[10px] sm:text-[9px] font-mono font-bold text-primary">{order.internalTrackingNumber || 'PENDIENTE'}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center gap-1.5">
                            <Box className="h-3.5 w-3.5 sm:h-3 sm:w-3 text-primary" />
                            <span className="text-[10px] sm:text-[9px] font-black">{order.packageCount || 1} Bultos</span>
                        </div>
                        <div className="flex items-center gap-1.5 justify-end">
                            {order.status === 'Despachado' ? <CreditCard className="h-3.5 w-3.5 sm:h-3 sm:w-3 text-emerald-400" /> : <Scale className="h-3.5 w-3.5 sm:h-3 sm:w-3 text-primary" />}
                            <span className={cn("text-[10px] sm:text-[9px] font-black", order.status === 'Despachado' ? "text-emerald-400" : "text-white")}>
                                {order.status === 'Despachado' ? 'STRIPE' : `${order.totalWeight || '--'}kg`}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            <div className="pt-2 border-t border-dashed border-slate-100 mt-auto">
                {renderPrimaryAction()}
            </div>
        </Card>
    )
}

interface AdminDispatchKanbanProps {
    groups: Record<OrderStatus, { orders: Order[], count: number, total: number }>;
    onOpenDialog: (type: 'dispatch' | 'confirmDelivery' | 'confirmStatus' | 'status' | 'completePacking' | null, order: Order, targetStatus?: OrderStatus) => void;
    onNavigateToDetails: (order: Order) => void;
    activeKpi?: 'warehouse' | 'road' | 'delivered' | 'todos';
}

export function AdminDispatchKanban({ groups, onOpenDialog, onNavigateToDetails, activeKpi = 'todos' }: AdminDispatchKanbanProps) {
    const [openSections, setOpenSections] = useState<string[]>([]);
    const sections = [
        { key: 'Aprobado', label: 'Cola de Picking', icon: PackageSearch, color: 'blue', kpi: 'warehouse' },
        { key: 'En Preparación', label: 'En Embalaje', icon: Cog, color: 'indigo', kpi: 'warehouse' },
        { key: 'Completado', label: 'Listos para Salida', icon: PackageCheckIcon, color: 'slate', kpi: 'warehouse' },
        { key: 'Despachado', label: 'En Ruta (Facturación Stripe)', icon: Truck, color: 'sky', kpi: 'road' },
        { key: 'Entregado', label: 'Historial de Entrega', icon: CheckCircle, color: 'emerald', kpi: 'delivered' },
    ];

    const visibleSections = activeKpi === 'todos' 
        ? sections 
        : sections.filter(s => s.kpi === activeKpi);

    return (
        <Accordion type="multiple" value={openSections} onValueChange={setOpenSections} key={activeKpi} className="space-y-4">
            {visibleSections.map(section => {
                const data = groups[section.key as OrderStatus] || { orders: [], count: 0, total: 0 };
                const hasCriticalAlert = data.count > 0 && (section.key === 'Aprobado' || section.key === 'En Preparación' || data.orders.some(o => o.cancellationRequested));
                
                return (
                    <AccordionItem key={section.key} value={section.key} className="border-none rounded-[1.8rem] sm:rounded-[2.5rem] bg-white shadow-sm ring-1 ring-primary/5 overflow-hidden transition-all">
                        <AccordionTrigger className="px-5 sm:px-8 py-5 sm:py-6 hover:no-underline group">
                            <div className="flex items-center gap-4 sm:gap-5 text-left flex-1 min-w-0">
                                <div className={cn(
                                    "p-2.5 sm:p-3 rounded-xl sm:rounded-2xl shadow-sm transition-transform group-data-[state=open]:rotate-12 shrink-0",
                                    hasCriticalAlert ? "bg-rose-100 text-rose-600" :
                                    section.color === 'blue' ? "bg-blue-50 text-blue-600" :
                                    section.color === 'indigo' ? "bg-indigo-50 text-indigo-600" :
                                    section.color === 'slate' ? "bg-slate-900 text-white" :
                                    section.color === 'sky' ? "bg-sky-50 text-sky-600" :
                                    "bg-emerald-50 text-emerald-600"
                                )}>
                                    <section.icon className="h-5 w-5 sm:h-6 sm:w-6" />
                                </div>
                                <div className="space-y-0.5 flex-1 min-w-0">
                                    <h3 className="text-sm sm:text-base font-black uppercase tracking-tight text-slate-900 truncate">{section.label}</h3>
                                    <p className="text-[8px] sm:text-[9px] text-muted-foreground font-black uppercase tracking-[0.2em] truncate">Fase: {section.key}</p>
                                </div>
                                <div className="ml-auto mr-4 flex items-center gap-3 sm:gap-4 shrink-0">
                                    <div className="text-right hidden md:block">
                                        <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest">VALOR LOTE</p>
                                        <p className="text-sm font-black text-slate-900 tracking-tighter">${data.total.toLocaleString()}</p>
                                    </div>
                                    {hasCriticalAlert ? (
                                        <Badge variant="destructive" className="bg-rose-600 text-white font-black h-6 sm:h-7 px-2.5 sm:px-3 rounded-lg text-[10px] sm:text-xs animate-pulse flex items-center gap-1 shadow-sm">
                                            <AlertTriangle className="h-3 w-3" /> REVISIÓN ({data.count})
                                        </Badge>
                                    ) : (
                                        <Badge variant="secondary" className="bg-slate-100 text-slate-600 font-black h-6 sm:h-7 px-2.5 sm:px-3 rounded-lg text-[10px] sm:text-xs">{data.count}</Badge>
                                    )}
                                </div>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-5 sm:px-8 pb-6 sm:pb-8 pt-2">
                            {data.orders.length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {data.orders.map(order => (
                                        <LogisticsOrderCard 
                                            key={order.id} 
                                            order={order} 
                                            onOpenDialog={onOpenDialog} 
                                            onNavigateToDetails={onNavigateToDetails} 
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="py-10 sm:py-12 border-2 border-dashed rounded-[1.5rem] sm:rounded-[2rem] bg-slate-50/50 flex flex-col items-center justify-center gap-3 opacity-30">
                                    <ShieldCheck className="h-8 w-8 text-slate-300" />
                                    <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.3em]">Sin operaciones activas</p>
                                </div>
                            )}
                        </AccordionContent>
                    </AccordionItem>
                );
            })}
        </Accordion>
    );
}
