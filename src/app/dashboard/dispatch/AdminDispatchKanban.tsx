'use client';

import React, { useState, useMemo } from 'react';
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
  AlertTriangle,
  MessageCircle,
  Search,
  Filter,
  X,
  Maximize2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import type { Order, OrderStatus, OrderItem, OrderItemClient, Product, CompanyProfile, Customer } from '@/lib/definitions';
import { Timestamp, getDocs, collection, query, limit, doc, getDoc } from 'firebase/firestore';
import { dispatchUniversalWhatsApp } from '@/lib/whatsapp-universal';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { generatePackageLabelsPDF } from '@/lib/pdf-generator';
import { useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

function LogisticsOrderCard({ order, onOpenDialog, onNavigateToDetails, onZoom }: { order: Order, onOpenDialog: Function, onNavigateToDetails: (order: Order) => void, onZoom: (url: string) => void }) {
    const firestore = useFirestore();
    const { toast } = useToast();
    const [isPrinting, setIsPrinting] = useState(false);
    
    const companyProfileRef = useMemoFirebase(() => (firestore ? doc(firestore, 'companyProfile', 'main') : null), [firestore]);
    const { data: companyProfile } = useDoc<CompanyProfile>(companyProfileRef);

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

    const handleWhatsAppTracking = (e: React.MouseEvent) => {
        e.stopPropagation();
        const rawPhone = (order.customerPhone || '').replace(/\D/g, '');
        const cleanPhone = rawPhone.length === 10 ? `58${rawPhone}` : rawPhone;

        const text = `*ATHLETICENTER C.A. - NOTIFICACIÓN DE DESPACHO*\n\n` +
            `Estimado(a) *${order.customerName}*,\n\n` +
            `Su pedido N° *#${order.id.substring(0, 8).toUpperCase()}* ha sido despachado:\n\n` +
            `🚚 *Empresa de Transporte:* ${order.carrier || (order as any).paymentMethod || 'Encomienda Nacional'}\n` +
            `📍 *N° de Guía / Tracking:* ${order.trackingNumber || order.internalTrackingNumber || 'S/D'}\n` +
            `📦 *Bultos:* ${order.packageCount || 1}\n\n` +
            `Quedamos atentos a su confirmación de recepción. ¡Muchas gracias!`;

        dispatchUniversalWhatsApp({
            phone: cleanPhone,
            message: text,
            orderId: order.id,
            module: 'dispatch'
        });
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
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={handleWhatsAppTracking} className="flex-1 h-8 rounded-xl bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 font-black uppercase text-[8px] tracking-wider flex items-center justify-center gap-1">
                            <MessageCircle className="h-3.5 w-3.5" /> NOTIFICAR
                          </Button>
                          <Button variant="outline" disabled={isPrinting} size="sm" className="h-8 px-3 rounded-xl border-slate-200 font-black uppercase text-[8px] tracking-widest hover:bg-slate-50" onClick={handlePrintLabelsFromKanban}>
                              {isPrinting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Printer className="h-3.5 w-3.5 text-primary" />}
                          </Button>
                        </div>
                    </div>
                );
            default:
                return (
                  <Button variant="outline" size="sm" onClick={handleWhatsAppTracking} className="w-full h-8 rounded-xl bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 font-black uppercase text-[8px] tracking-wider flex items-center justify-center gap-1">
                    <MessageCircle className="h-3.5 w-3.5" /> NOTIFICAR CLIENTE
                  </Button>
                );
        }
    };

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
                    <p className="text-[8px] sm:text-[7px] font-black text-slate-400 uppercase tracking-widest">EXPEDIENTE LOGÍSTICO</p>
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

            {(order.status === 'Despachado' || order.status === 'Completado' || order.status === 'Entregado') && (
                <div className={cn("p-3 sm:p-2.5 rounded-xl text-white space-y-2", order.status === 'Completado' ? 'bg-slate-700' : order.status === 'Despachado' ? 'bg-slate-900' : 'bg-emerald-950')}>
                    <div className="flex justify-between items-center border-b border-white/10 pb-1.5">
                        <span className="text-[8px] sm:text-[7px] font-black uppercase text-slate-400">Guía / Tracking</span>
                        <span className="text-[10px] sm:text-[9px] font-mono font-bold text-primary">{order.trackingNumber || order.internalTrackingNumber || 'PENDIENTE'}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center gap-1.5">
                            <Box className="h-3.5 w-3.5 sm:h-3 sm:w-3 text-primary" />
                            <span className="text-[10px] sm:text-[9px] font-black">{order.packageCount || 1} Bultos</span>
                        </div>
                        <div className="flex items-center gap-1.5 justify-end">
                            <Truck className="h-3.5 w-3.5 sm:h-3 sm:w-3 text-emerald-400" />
                            <span className="text-[10px] sm:text-[9px] font-black truncate max-w-[80px] text-emerald-400">
                                {order.carrier || 'Encomienda'}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* MINIATURA CUSTODIA DIGITAL */}
            {(order.dispatchImageUrl || order.deliveryImageUrl) && (
              <div className="flex items-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                {order.dispatchImageUrl && (
                  <div 
                    onClick={() => onZoom(order.dispatchImageUrl!)}
                    className="relative group h-12 w-16 rounded-lg overflow-hidden border border-slate-200 cursor-pointer bg-slate-900 shrink-0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={order.dispatchImageUrl} alt="Salida" className="h-full w-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white">
                      <Maximize2 className="h-3 w-3" />
                    </div>
                  </div>
                )}
                {order.deliveryImageUrl && (
                  <div 
                    onClick={() => onZoom(order.deliveryImageUrl!)}
                    className="relative group h-12 w-16 rounded-lg overflow-hidden border border-emerald-300 cursor-pointer bg-slate-900 shrink-0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={order.deliveryImageUrl} alt="Entrega" className="h-full w-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white">
                      <Maximize2 className="h-3 w-3" />
                    </div>
                  </div>
                )}
                <span className="text-[8px] font-bold uppercase text-slate-400">Custodia Digital</span>
              </div>
            )}

            <div className="pt-2 border-t border-dashed border-slate-100 mt-auto">
                {renderPrimaryAction()}
            </div>
        </Card>
    );
}

interface AdminDispatchKanbanProps {
    groups: Record<OrderStatus, { orders: Order[], count: number, total: number }>;
    onOpenDialog: (type: 'dispatch' | 'confirmDelivery' | 'confirmStatus' | 'status' | 'completePacking' | null, order: Order, targetStatus?: OrderStatus) => void;
    onNavigateToDetails: (order: Order) => void;
    activeKpi?: 'warehouse' | 'road' | 'delivered' | 'todos';
}

export function AdminDispatchKanban({ groups, onOpenDialog, onNavigateToDetails, activeKpi = 'todos' }: AdminDispatchKanbanProps) {
    const [openSections, setOpenSections] = useState<string[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [carrierFilter, setCarrierFilter] = useState('todos');
    const [sortOrder, setSortOrder] = useState<'recent' | 'oldest' | 'highestAmount' | 'customerName'>('recent');
    const [zoomImage, setZoomImage] = useState<string | null>(null);

    const sections = [
        { key: 'Aprobado', label: 'Cola de Picking', icon: PackageSearch, color: 'blue', kpi: 'warehouse' },
        { key: 'En Preparación', label: 'En Embalaje', icon: Cog, color: 'indigo', kpi: 'warehouse' },
        { key: 'Completado', label: 'Listos para Salida', icon: PackageCheckIcon, color: 'slate', kpi: 'warehouse' },
        { key: 'Despachado', label: 'En Ruta (Despachados)', icon: Truck, color: 'sky', kpi: 'road' },
        { key: 'Entregado', label: 'Historial de Entrega Certificada', icon: CheckCircle, color: 'emerald', kpi: 'delivered' },
    ];

    const visibleSections = activeKpi === 'todos' 
        ? sections 
        : sections.filter(s => s.kpi === activeKpi);

    return (
        <div className="space-y-6">
            {/* BARRA DE BÚSQUEDA Y FILTRO LOGÍSTICO CON ORDENAMIENTO */}
            <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden">
                <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
                    <div className="space-y-1 md:col-span-1">
                        <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Búsqueda Táctica de Despacho</Label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                            <Input 
                                placeholder="REF / CLIENTE / RIF / GUÍA..." 
                                className="pl-9 h-10 text-[10px] font-bold uppercase rounded-xl border-none bg-slate-50 shadow-inner" 
                                value={searchTerm} 
                                onChange={(e) => setSearchTerm(e.target.value)} 
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Empresa de Transporte</Label>
                        <Select value={carrierFilter} onValueChange={setCarrierFilter}>
                            <SelectTrigger className="h-10 text-[10px] font-bold uppercase rounded-xl border-none bg-slate-50 shadow-inner">
                                <SelectValue placeholder="Todas" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="todos" className="text-[10px] font-bold uppercase">TODAS LAS ENCOMIENDAS</SelectItem>
                                <SelectItem value="TEALCA" className="text-[10px] font-bold uppercase">TEALCA</SelectItem>
                                <SelectItem value="MRW" className="text-[10px] font-bold uppercase">MRW</SelectItem>
                                <SelectItem value="ZOOM" className="text-[10px] font-bold uppercase">ZOOM</SelectItem>
                                <SelectItem value="FLETE PROPIO" className="text-[10px] font-bold uppercase">FLETE PROPIO ATHLETICENTER</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Orden del Historial</Label>
                        <Select value={sortOrder} onValueChange={(val: any) => setSortOrder(val)}>
                            <SelectTrigger className="h-10 text-[10px] font-bold uppercase rounded-xl border-none bg-slate-50 shadow-inner">
                                <SelectValue placeholder="Orden" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="recent" className="text-[10px] font-bold uppercase">📅 Más Recientes Primero</SelectItem>
                                <SelectItem value="oldest" className="text-[10px] font-bold uppercase">🗓️ Más Antiguos Primero</SelectItem>
                                <SelectItem value="highestAmount" className="text-[10px] font-bold uppercase">💰 Mayor Monto ($ USD)</SelectItem>
                                <SelectItem value="customerName" className="text-[10px] font-bold uppercase">🏢 Cliente (A-Z)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {(searchTerm || carrierFilter !== 'todos' || sortOrder !== 'recent') && (
                        <div className="flex justify-end">
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => { setSearchTerm(''); setCarrierFilter('todos'); setSortOrder('recent'); }}
                                className="h-10 text-[9px] font-black uppercase text-primary px-3 rounded-xl hover:bg-primary/5"
                            >
                                Limpiar Filtros <X className="ml-1 h-3 w-3" />
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Accordion type="multiple" value={openSections} onValueChange={setOpenSections} key={activeKpi} className="space-y-4">
                {visibleSections.map(section => {
                    const rawGroup = groups[section.key as OrderStatus] || { orders: [], count: 0, total: 0 };
                    
                    // FILTRADO EN VIVO Y ORDENAMIENTO CRONOLÓGICO DE ÓRDENES
                    const filteredOrders = rawGroup.orders.filter(o => {
                        const term = searchTerm.toLowerCase().trim();
                        const matchesSearch = !term || o.id.toLowerCase().includes(term) || o.customerName.toLowerCase().includes(term) || (o.customerRif || '').toLowerCase().includes(term) || (o.trackingNumber || '').toLowerCase().includes(term);
                        const matchesCarrier = carrierFilter === 'todos' || (o.carrier || '').toUpperCase().includes(carrierFilter.toUpperCase());
                        return matchesSearch && matchesCarrier;
                    });

                    const sortedOrders = [...filteredOrders].sort((a, b) => {
                        if (sortOrder === 'highestAmount') {
                            return (b.totalAmount || 0) - (a.totalAmount || 0);
                        }
                        if (sortOrder === 'customerName') {
                            return (a.customerName || '').localeCompare(b.customerName || '');
                        }
                        const dateA = (a.receptionDate as any)?.seconds || (a.updatedAt as any)?.seconds || (a.orderDate as any)?.seconds || 0;
                        const dateB = (b.receptionDate as any)?.seconds || (b.updatedAt as any)?.seconds || (b.orderDate as any)?.seconds || 0;
                        
                        if (sortOrder === 'oldest') {
                            return dateA - dateB;
                        }
                        // Default 'recent' (más recientes primero)
                        return dateB - dateA;
                    });

                    const groupCount = sortedOrders.length;
                    const groupTotal = sortedOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
                    const hasCriticalAlert = groupCount > 0 && (section.key === 'Aprobado' || section.key === 'En Preparación' || sortedOrders.some(o => o.cancellationRequested));
                    
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
                                            <p className="text-sm font-black text-slate-900">${groupTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                                        </div>
                                        <Badge variant="secondary" className="bg-slate-100 font-mono text-[10px] sm:text-xs font-black px-2.5 sm:px-3 py-1 rounded-xl">
                                            {groupCount}
                                        </Badge>
                                    </div>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="px-5 sm:px-8 pb-6 sm:pb-8 pt-2">
                                {groupCount > 0 ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                        {sortedOrders.map(order => (
                                            <LogisticsOrderCard 
                                                key={order.id} 
                                                order={order} 
                                                onOpenDialog={onOpenDialog} 
                                                onNavigateToDetails={onNavigateToDetails}
                                                onZoom={setZoomImage}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="py-10 text-center border-2 border-dashed rounded-2xl bg-slate-50/50 flex flex-col items-center justify-center gap-2 opacity-40">
                                        <Box className="h-8 w-8 text-slate-400" />
                                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Sin expedientes activos en esta fase</p>
                                    </div>
                                )}
                            </AccordionContent>
                        </AccordionItem>
                    );
                })}
            </Accordion>

            {/* MODAL ZOOM CUSTODIA DIGITAL */}
            <Dialog open={!!zoomImage} onOpenChange={() => setZoomImage(null)}>
                <DialogContent className="max-w-[95vw] sm:max-w-4xl p-0 border-none bg-black/95 flex items-center justify-center rounded-[2rem] overflow-hidden shadow-2xl">
                    {zoomImage && <img src={zoomImage} alt="Evidencia Full" className="max-w-full max-h-[85vh] object-contain" />}
                </DialogContent>
            </Dialog>
        </div>
    );
}
