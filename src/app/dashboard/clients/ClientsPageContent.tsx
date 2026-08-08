'use client';

import React, { useState, useMemo, useEffect } from 'react';
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
import { 
    MoreHorizontal, 
    Loader2, 
    Search, 
    Users, 
    AlertTriangle, 
    User as UserIcon,
    Briefcase,
    MapPin,
    Phone,
    Mail,
    Edit,
    ChevronRight,
    ArrowRight,
    ShieldCheck,
    Clock,
    Zap,
    TrendingUp,
    ShoppingCart,
    FilterX,
    Plus,
    MessageCircle,
    Wallet,
    AlertCircle,
    CheckCircle2,
    Filter,
    Building,
    Package,
    Receipt,
    ExternalLink,
    Maximize2,
    Calendar,
    DollarSign,
    Eye
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { User, Customer, Order } from '@/lib/definitions';
import { NewUserDialog } from '../users/new-user-dialog';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, limit, orderBy, getDocs, doc, getDoc } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { EditUserDialog } from '../users/edit-user-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import Link from 'next/link';
import { differenceInDays, format } from 'date-fns';

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

function CustomerDetailsSheet({ 
    customer, 
    user,
    pendingBalance = 0,
    isOpen, 
    onOpenChange,
    onEdit
}: { 
    customer: Customer | null; 
    user: User | null;
    pendingBalance?: number;
    isOpen: boolean; 
    onOpenChange: (open: boolean) => void;
    onEdit: (user: User) => void;
}) {
    const firestore = useFirestore();
    const [selectedProofUrl, setSelectedProofUrl] = useState<string | null>(null);

    const daysInactive = customer?.lastOrderDate ? differenceInDays(new Date(), customer.lastOrderDate.toDate()) : null;

    // CONSULTA EN TIEMPO REAL DE TODOS LOS PEDIDOS DEL CLIENTE SELECCIONADO
    const customerOrdersQuery = useMemoFirebase(() => {
        if (!firestore || !customer?.id) return null;
        return query(
            collection(firestore, 'orders'),
            where('customerId', '==', customer.id)
        );
    }, [firestore, customer?.id]);

    const { data: customerOrders, isLoading: isLoadingOrders } = useCollection<Order>(customerOrdersQuery);

    const [topProducts, setTopProducts] = useState<Array<{ id: string; name: string; quantity: number; total: number; price: number; imageUrl?: string }>>([]);
    const [isLoadingTopProducts, setIsLoadingTopProducts] = useState(false);

    // CARGA ASÍNCRONA DE ÍTEMS DE SUBCOLECCIÓN FIRESTORE (`orders/{id}/orderItems`) Y RESOLUCIÓN DE PRODUCTOS
    useEffect(() => {
        if (!firestore || !customerOrders || customerOrders.length === 0) {
            setTopProducts([]);
            return;
        }

        let isMounted = true;
        setIsLoadingTopProducts(true);

        const loadCustomerItems = async () => {
            try {
                const validOrders = customerOrders.filter(o => o.status !== 'Cancelado');
                const productMap = new Map<string, { id: string; name: string; quantity: number; total: number; price: number; imageUrl?: string }>();
                const productCache = new Map<string, any>();

                for (const order of validOrders) {
                    let itemsList: any[] = (order as any).items || [];
                    
                    if (itemsList.length === 0 && order.id) {
                        try {
                            const itemsSnap = await getDocs(collection(firestore, `orders/${order.id}/orderItems`));
                            itemsList = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                        } catch (e) {
                            console.error("Error cargando subcolección orderItems", e);
                        }
                    }

                    for (const item of itemsList) {
                        const productId = item.productId || item.id || item.name;
                        if (!productId) continue;

                        let name = item.name || item.product?.name;
                        let imageUrl = item.imageUrl || item.product?.imageUrl;
                        const qty = item.quantity || 1;
                        const price = item.unitPrice || item.price || 0;
                        const total = item.total || (price * qty);

                        if (!name && item.productId) {
                            if (productCache.has(item.productId)) {
                                const pData = productCache.get(item.productId);
                                name = pData.name;
                                imageUrl = pData.imageUrl;
                            } else {
                                try {
                                    const pSnap = await getDoc(doc(firestore, 'products', item.productId));
                                    if (pSnap.exists()) {
                                        const pData = pSnap.data();
                                        productCache.set(item.productId, pData);
                                        name = pData.name;
                                        imageUrl = pData.imageUrl;
                                    }
                                } catch (e) {
                                    console.error("Error leyendo documento del producto", e);
                                }
                            }
                        }

                        const finalName = name || `Producto (${productId.substring(0, 6)})`;
                        const existing = productMap.get(productId) || { id: productId, name: finalName, quantity: 0, total: 0, price, imageUrl };
                        existing.quantity += qty;
                        existing.total += total;
                        if (imageUrl) existing.imageUrl = imageUrl;
                        productMap.set(productId, existing);
                    }
                }

                if (isMounted) {
                    const sorted = Array.from(productMap.values()).sort((a, b) => b.total - a.total);
                    setTopProducts(sorted);
                    setIsLoadingTopProducts(false);
                }
            } catch (error) {
                console.error("Error procesando top productos del cliente 360", error);
                if (isMounted) setIsLoadingTopProducts(false);
            }
        };

        loadCustomerItems();

        return () => {
            isMounted = false;
        };
    }, [firestore, customerOrders]);

    // CÁLCULO DE INTELIGENCIA COMERCIAL 360°
    const analytics = useMemo(() => {
        if (!customerOrders) return {
            totalSpent: 0,
            totalPaid: 0,
            orderCount: 0,
            avgTicket: 0,
            paymentRecords: [],
            orderList: []
        };

        const validOrders = customerOrders.filter(o => o.status !== 'Cancelado');
        const orderCount = validOrders.length;
        let totalSpent = 0;
        let totalPaid = 0;

        const paymentRecords: Array<{ orderId: string; dateDisplay: string; method: string; ref: string; amount: number; proofUrl?: string }> = [];

        validOrders.forEach(o => {
            const amount = o.totalAmount || 0;
            const paid = o.amountPaid || 0;
            totalSpent += amount;
            totalPaid += paid;

            const paymentRef = (o as any).paymentReference;
            const paymentProof = (o as any).paymentProofUrl;
            const paymentMethodStr = (o as any).paymentMethod || 'Transferencia / Depósito';

            if (paid > 0 || paymentRef || paymentProof) {
                const orderDateRaw = o.updatedAt || o.orderDate || o.createdAt;
                let dateDisplay = 'Reciente';
                if (orderDateRaw && (orderDateRaw as any).toDate) {
                    dateDisplay = format((orderDateRaw as any).toDate(), 'dd/MM/yyyy');
                } else if (orderDateRaw instanceof Date) {
                    dateDisplay = format(orderDateRaw, 'dd/MM/yyyy');
                }

                paymentRecords.push({
                    orderId: o.id || '',
                    dateDisplay,
                    method: paymentMethodStr,
                    ref: paymentRef || 'Sin Ref.',
                    amount: paid,
                    proofUrl: paymentProof
                });
            }
        });

        const avgTicket = orderCount > 0 ? totalSpent / orderCount : 0;
        const orderList = [...validOrders].sort((a, b) => {
            const dateA = (a.orderDate as any)?.seconds || (a.createdAt as any)?.seconds || 0;
            const dateB = (b.orderDate as any)?.seconds || (b.createdAt as any)?.seconds || 0;
            return dateB - dateA;
        });

        return {
            totalSpent,
            totalPaid,
            orderCount,
            avgTicket,
            paymentRecords,
            orderList
        };
    }, [customerOrders]);

    if (!customer) return null;

    const handleWhatsAppClick = () => {
        const rawPhone = (customer.phone || '').replace(/\D/g, '');
        const cleanPhone = rawPhone.length === 10 ? `58${rawPhone}` : rawPhone;
        const text = `*ATHLETICENTER C.A. - EXPEDIENTE Y ESTADO DE CUENTA B2B*\n\n` +
          `Estimado(a) *${customer.razonSocial}*,\n\n` +
          `Le saludamos del Departamento Comercial. Le enviamos el resumen de su cuenta corporativa:\n\n` +
          `📄 *RIF Fiscal:* ${customer.rif}\n` +
          `📊 *Total Comprado:* $${analytics.totalSpent.toFixed(2)} USD\n` +
          (pendingBalance > 0.05 ? `💰 *Saldo Pendiente:* $${pendingBalance.toFixed(2)} USD\n` : `✅ *Estado de Cuenta:* Al Día\n`) +
          `📍 *Asesor Asignado:* ${customer.assignedSalespersonName || 'Atención General'}\n\n` +
          `¿Desea realizar algún requerimiento de reposición de mercancía?\n\n` +
          `¡Quedamos a sus enteras órdenes!`;

        const url = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(url, '_blank');
    };

    return (
        <>
        <Sheet open={isOpen} onOpenChange={onOpenChange}>
            <SheetContent className="w-full sm:max-w-2xl p-0 border-none rounded-l-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-full bg-slate-50">
                {/* ENCABEZADO ESPECTACULAR */}
                <SheetHeader className="p-8 pb-6 bg-slate-900 text-white shrink-0">
                    <div className="flex items-center gap-5">
                        <div className="h-16 w-16 rounded-[1.5rem] bg-primary/20 text-primary flex items-center justify-center shadow-xl border border-primary/10 font-black text-2xl">
                            {customer.razonSocial.charAt(0)}
                        </div>
                        <div className="flex-1 text-left space-y-1">
                            <div className="flex items-center gap-2">
                                <SheetTitle className="text-2xl font-black uppercase tracking-tighter text-white leading-none">Expediente 360°</SheetTitle>
                                <Badge className="bg-emerald-500 text-white text-[8px] font-black uppercase px-2 py-0.5 border-none">B2B Verificado</Badge>
                            </div>
                            <SheetDescription className="text-primary font-bold text-[10px] uppercase tracking-[0.2em]">{customer.razonSocial}</SheetDescription>
                        </div>
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className="bg-white/5 border-white/10 text-white hover:bg-white/10 rounded-xl font-black uppercase text-[9px] tracking-widest h-9"
                            onClick={() => user && onEdit(user)}
                        >
                            <Edit className="h-3.5 w-3.5 mr-1.5" /> Editar
                        </Button>
                    </div>
                </SheetHeader>

                <ScrollArea className="flex-1">
                    <div className="p-6 sm:p-8 space-y-6">
                        {/* PESTAÑAS 360° DE NAVEGACIÓN */}
                        <Tabs defaultValue="resumen" className="w-full">
                            <TabsList className="w-full grid grid-cols-4 bg-slate-200/60 p-1 rounded-2xl mb-6">
                                <TabsTrigger value="resumen" className="rounded-xl text-[9px] font-black uppercase tracking-wider py-2.5 data-[state=active]:bg-slate-900 data-[state=active]:text-white transition-all">Resumen 360°</TabsTrigger>
                                <TabsTrigger value="productos" className="rounded-xl text-[9px] font-black uppercase tracking-wider py-2.5 data-[state=active]:bg-slate-900 data-[state=active]:text-white transition-all">Top Artículos</TabsTrigger>
                                <TabsTrigger value="pedidos" className="rounded-xl text-[9px] font-black uppercase tracking-wider py-2.5 data-[state=active]:bg-slate-900 data-[state=active]:text-white transition-all">Pedidos ({analytics.orderCount})</TabsTrigger>
                                <TabsTrigger value="pagos" className="rounded-xl text-[9px] font-black uppercase tracking-wider py-2.5 data-[state=active]:bg-slate-900 data-[state=active]:text-white transition-all">Pagos ({analytics.paymentRecords.length})</TabsTrigger>
                            </TabsList>

                            {/* PESTAÑA 1: RESUMEN 360° */}
                            <TabsContent value="resumen" className="space-y-6 animate-in fade-in-50 duration-300">
                                {/* METRICAS FINANCIERAS DE LA CUENTA */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-5 rounded-[1.8rem] bg-white border border-slate-100 shadow-sm space-y-1">
                                        <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                                            <TrendingUp className="h-3.5 w-3.5 text-primary" /> Total Comprado
                                        </p>
                                        <span className="text-xl font-black uppercase tracking-tight text-slate-900">
                                            ${analytics.totalSpent.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                        </span>
                                        <p className="text-[8px] font-bold text-slate-500 uppercase">{analytics.orderCount} Pedidos Procesados</p>
                                    </div>

                                    <div className="p-5 rounded-[1.8rem] bg-white border border-slate-100 shadow-sm space-y-1">
                                        <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                                            <ShoppingCart className="h-3.5 w-3.5 text-blue-500" /> Ticket Promedio
                                        </p>
                                        <span className="text-xl font-black uppercase tracking-tight text-slate-900">
                                            ${analytics.avgTicket.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                        </span>
                                        <p className="text-[8px] font-bold text-slate-500 uppercase">Promedio por Pedido</p>
                                    </div>

                                    <div className={cn("p-5 rounded-[1.8rem] border shadow-sm space-y-1", pendingBalance > 0.05 ? "bg-rose-50 border-rose-100" : "bg-emerald-50 border-emerald-100")}>
                                        <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                                            <Wallet className="h-3.5 w-3.5 text-slate-500" /> Saldo Pendiente
                                        </p>
                                        <span className={cn("text-xl font-black uppercase tracking-tight", pendingBalance > 0.05 ? "text-rose-600" : "text-emerald-600")}>
                                            ${pendingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                        </span>
                                        <Badge className={cn("w-fit text-[8px] font-black uppercase border-none px-2 py-0.5", pendingBalance > 0.05 ? "bg-rose-600 text-white" : "bg-emerald-600 text-white")}>
                                            {pendingBalance > 0.05 ? 'CON SALDO DEUDOR' : 'AL DÍA / SOLVENTE'}
                                        </Badge>
                                    </div>

                                    <div className="p-5 rounded-[1.8rem] bg-white border border-slate-100 shadow-sm space-y-1">
                                        <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                                            <Clock className="h-3.5 w-3.5 text-slate-500" /> Actividad Comercial
                                        </p>
                                        {daysInactive !== null ? (
                                            <span className={cn("text-xl font-black uppercase tracking-tight", daysInactive >= 30 ? "text-rose-600" : daysInactive >= 15 ? "text-amber-600" : "text-emerald-600")}>
                                                {daysInactive === 0 ? "Activo Hoy" : `Hace ${daysInactive} d`}
                                            </span>
                                        ) : (
                                            <span className="text-lg font-black uppercase text-slate-400 italic">Sin Compras</span>
                                        )}
                                        <p className="text-[8px] font-bold text-slate-500 uppercase">Último Pedido</p>
                                    </div>
                                </div>

                                {/* DATOS DE LA ENTIDAD COMERCIAL */}
                                <div className="p-6 rounded-[2rem] bg-white border border-slate-100 shadow-sm space-y-4">
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-2">
                                        <Zap className="h-4 w-4 text-primary" /> Ficha Fiscal de la Entidad
                                    </h3>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <Label className="text-[8px] font-black uppercase text-slate-400 tracking-widest">Razón Social</Label>
                                            <p className="text-xs font-black uppercase text-slate-900">{customer.razonSocial}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[8px] font-black uppercase text-slate-400 tracking-widest">RIF Fiscal</Label>
                                            <p className="text-xs font-black uppercase font-mono text-primary">{customer.rif}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[8px] font-black uppercase text-slate-400 tracking-widest">Correo Electrónico</Label>
                                            <p className="text-xs font-medium text-slate-600 truncate">{customer.email}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[8px] font-black uppercase text-slate-400 tracking-widest">Asesor Comercial</Label>
                                            <p className="text-xs font-black uppercase text-slate-800">{customer.assignedSalespersonName || 'Atención General'}</p>
                                        </div>
                                        <div className="sm:col-span-2 space-y-1">
                                            <Label className="text-[8px] font-black uppercase text-slate-400 tracking-widest">Dirección Fiscal</Label>
                                            <p className="text-xs font-medium text-slate-600">{customer.address || 'Sin dirección registrada.'}</p>
                                        </div>
                                    </div>
                                </div>

                                {/* ACCIONES DIRECTAS */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <Button 
                                        onClick={handleWhatsAppClick} 
                                        className="h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider shadow-md flex items-center justify-center gap-2"
                                    >
                                        <MessageCircle className="h-4 w-4" /> WhatsApp Directo
                                    </Button>
                                    <Button 
                                        asChild 
                                        className="h-12 rounded-2xl bg-slate-900 hover:bg-primary text-white font-black text-xs uppercase tracking-wider shadow-md flex items-center justify-center gap-2"
                                    >
                                        <Link href={`/dashboard/orders/new?customer=${customer.id}`}>
                                            Crear Pedido Rápido <ArrowRight className="h-4 w-4" />
                                        </Link>
                                    </Button>
                                </div>
                            </TabsContent>

                            {/* PESTAÑA 2: PRODUCTOS FRECUENTES */}
                            <TabsContent value="productos" className="space-y-4 animate-in fade-in-50 duration-300">
                                <div className="flex justify-between items-center px-1">
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-2">
                                        <Package className="h-4 w-4 text-primary" /> Productos Preferidos del Cliente
                                    </h3>
                                    <span className="text-[9px] font-bold uppercase text-slate-400">{topProducts.length} Artículos Distintos</span>
                                </div>

                                {isLoadingTopProducts ? (
                                    <div className="flex h-36 flex-col items-center justify-center gap-2 text-slate-400">
                                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                                        <p className="text-[9px] font-black uppercase tracking-widest">Cargando Historial de Productos...</p>
                                    </div>
                                ) : topProducts.length > 0 ? (
                                    <div className="space-y-3">
                                        {topProducts.map((prod, idx) => (
                                            <div key={prod.id} className="p-4 rounded-2xl bg-white border border-slate-100 shadow-sm flex items-center justify-between gap-4">
                                                <div className="flex items-center gap-3.5">
                                                    {prod.imageUrl ? (
                                                        <div className="h-11 w-11 rounded-xl bg-slate-50 border border-slate-100 overflow-hidden shrink-0">
                                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                                            <img src={prod.imageUrl} alt={prod.name} className="h-full w-full object-cover" />
                                                        </div>
                                                    ) : (
                                                        <div className="h-10 w-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-black text-xs shrink-0 shadow-inner">
                                                            #{idx + 1}
                                                        </div>
                                                    )}
                                                    <div className="space-y-0.5">
                                                        <p className="text-xs font-black uppercase text-slate-900 leading-tight">{prod.name}</p>
                                                        <p className="text-[9px] font-bold uppercase text-slate-500">{prod.quantity} Unidades Compradas</p>
                                                    </div>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <p className="text-xs font-black uppercase text-emerald-600 font-mono">
                                                        ${prod.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                    </p>
                                                    <p className="text-[8px] font-bold uppercase text-slate-400">Total Invertido</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="p-12 text-center bg-white rounded-3xl border border-slate-100 space-y-2">
                                        <Package className="h-10 w-10 text-slate-300 mx-auto" />
                                        <p className="text-xs font-black uppercase text-slate-400 tracking-wider">Sin productos registrados aún</p>
                                    </div>
                                )}
                            </TabsContent>

                            {/* PESTAÑA 3: HISTORIAL DE PEDIDOS */}
                            <TabsContent value="pedidos" className="space-y-4 animate-in fade-in-50 duration-300">
                                <div className="flex justify-between items-center px-1">
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-2">
                                        <Receipt className="h-4 w-4 text-primary" /> Historial de Expedientes
                                    </h3>
                                    <span className="text-[9px] font-bold uppercase text-slate-400">{analytics.orderList.length} Pedidos Registrados</span>
                                </div>

                                {isLoadingOrders ? (
                                    <div className="flex h-32 items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>
                                ) : analytics.orderList.length > 0 ? (
                                    <div className="space-y-3">
                                        {analytics.orderList.map((order) => {
                                            const paid = order.amountPaid || 0;
                                            const pending = Math.max(0, order.totalAmount - paid);

                                            return (
                                                <div key={order.id} className="p-4 rounded-2xl bg-white border border-slate-100 shadow-sm flex items-center justify-between gap-4">
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs font-black uppercase text-slate-900 font-mono">#{order.id.substring(0, 8)}</span>
                                                            <Badge className="bg-slate-900 text-white text-[8px] font-black uppercase px-2 py-0.5 border-none">
                                                                {order.status}
                                                            </Badge>
                                                        </div>
                                                        <p className="text-[9px] font-bold uppercase text-slate-500">
                                                            Items: {((order as any).items || []).length} productos
                                                        </p>
                                                    </div>

                                                    <div className="text-right shrink-0 space-y-0.5">
                                                        <p className="text-xs font-black uppercase text-slate-900 font-mono">
                                                            ${order.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                        </p>
                                                        {pending > 0.05 ? (
                                                            <span className="text-[8px] font-black uppercase text-rose-600 block">Deuda: ${pending.toFixed(2)}</span>
                                                        ) : (
                                                            <span className="text-[8px] font-black uppercase text-emerald-600 block">Totalmente Pagado</span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="p-12 text-center bg-white rounded-3xl border border-slate-100 space-y-2">
                                        <ShoppingCart className="h-10 w-10 text-slate-300 mx-auto" />
                                        <p className="text-xs font-black uppercase text-slate-400 tracking-wider">No posee expedientes de compra registrados</p>
                                    </div>
                                )}
                            </TabsContent>

                            {/* PESTAÑA 4: HISTORIAL DE PAGOS Y RECIBOS */}
                            <TabsContent value="pagos" className="space-y-4 animate-in fade-in-50 duration-300">
                                <div className="flex justify-between items-center px-1">
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-2">
                                        <Wallet className="h-4 w-4 text-primary" /> Historial de Abonos y Comprobantes
                                    </h3>
                                    <span className="text-[9px] font-bold uppercase text-slate-400">{analytics.paymentRecords.length} Registros de Pago</span>
                                </div>

                                {analytics.paymentRecords.length > 0 ? (
                                    <div className="space-y-3">
                                        {analytics.paymentRecords.map((pay, idx) => (
                                            <div key={idx} className="p-4 rounded-2xl bg-white border border-slate-100 shadow-sm flex items-center justify-between gap-4">
                                                <div className="flex items-center gap-3.5">
                                                    {pay.proofUrl ? (
                                                        <div 
                                                            onClick={() => setSelectedProofUrl(pay.proofUrl || null)} 
                                                            className="h-12 w-12 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden cursor-pointer relative group shrink-0"
                                                        >
                                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                                            <img src={pay.proofUrl} alt="Comprobante" className="h-full w-full object-cover group-hover:scale-110 transition-transform" />
                                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                                                                <Maximize2 className="h-4 w-4" />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="h-12 w-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-black shrink-0">
                                                            <Receipt className="h-5 w-5" />
                                                        </div>
                                                    )}

                                                    <div className="space-y-0.5">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs font-black uppercase text-slate-900">{pay.method}</span>
                                                            <Badge variant="outline" className="text-[8px] font-mono font-bold uppercase text-slate-500">Ref: {pay.ref}</Badge>
                                                        </div>
                                                        <p className="text-[9px] font-bold uppercase text-slate-400">Fecha: {pay.dateDisplay}</p>
                                                    </div>
                                                </div>

                                                <div className="text-right shrink-0">
                                                    <p className="text-sm font-black uppercase text-emerald-600 font-mono">
                                                        ${pay.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                    </p>
                                                    <span className="text-[8px] font-black uppercase text-slate-400">Abono Confirmado</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="p-12 text-center bg-white rounded-3xl border border-slate-100 space-y-2">
                                        <Wallet className="h-10 w-10 text-slate-300 mx-auto" />
                                        <p className="text-xs font-black uppercase text-slate-400 tracking-wider">Sin historial de abonos o comprobantes</p>
                                    </div>
                                )}
                            </TabsContent>
                        </Tabs>
                    </div>
                </ScrollArea>
            </SheetContent>
        </Sheet>

        {/* DIALOG PARA ZOOM DEL COMPROBANTE */}
        <Dialog open={!!selectedProofUrl} onOpenChange={(open) => !open && setSelectedProofUrl(null)}>
            <DialogContent className="max-w-2xl p-4 bg-slate-900 border-none rounded-3xl overflow-hidden text-white">
                <DialogHeader className="p-2">
                    <DialogTitle className="text-sm font-black uppercase tracking-wider text-slate-300">Comprobante de Pago Adjunto</DialogTitle>
                </DialogHeader>
                {selectedProofUrl && (
                    <div className="max-h-[80vh] overflow-auto rounded-2xl flex items-center justify-center bg-black/50 p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={selectedProofUrl} alt="Comprobante Zoom" className="w-full h-auto object-contain rounded-xl shadow-2xl" />
                    </div>
                )}
            </DialogContent>
        </Dialog>
        </>
    );
}

export default function ClientsPageContent() {
  const { profile: currentUser, isUserLoading } = useUser();
  const firestore = useFirestore();
  const searchParams = useSearchParams();

  const [queryLimit, setQueryLimit] = useState(100);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [salespersonFilter, setSalespersonFilter] = useState('todos');
  const [inactivityFilter, setInactivityFilter] = useState('todos');
  const [debtFilter, setDebtFilter] = useState('todos');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const isSalesperson = currentUser?.role === 'ventas';
  const isAdmin = currentUser && ['superadmin', 'admin', 'gerencia'].includes(currentUser.role);

  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser) return null;
    const customersCollection = collection(firestore, 'customers');
    
    if (isSalesperson) {
        return query(
            customersCollection, 
            where('assignedSalespersonId', '==', currentUser.id), 
            limit(queryLimit)
        );
    }
    
    return query(customersCollection, limit(queryLimit));
  }, [firestore, currentUser, isSalesperson, queryLimit]);

  const usersQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser) return null;
    return query(collection(firestore, 'users'), limit(queryLimit));
  }, [firestore, currentUser, queryLimit]);

  const ordersQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser) return null;
    return query(collection(firestore, 'orders'), orderBy('updatedAt', 'desc'), limit(300));
  }, [firestore, currentUser]);

  const { data: customers, isLoading: isLoadingCustomers } = useCollection<Customer>(customersQuery);
  const { data: allUsers, isLoading: isLoadingUsers } = useCollection<User>(usersQuery);
  const { data: allOrders } = useCollection<Order>(ordersQuery);

  const isLoading = isUserLoading || isLoadingCustomers || isLoadingUsers;
  const usersById = useMemo(() => new Map(allUsers?.map(u => [u.id, u]) || []), [allUsers]);

  // MAPEO DE SALDOS PENDIENTES POR CLIENTE
  const customerPendingBalances = useMemo(() => {
    const map = new Map<string, number>();
    if (!allOrders) return map;
    
    const activeStatuses = ['Entregado', 'En Verificación', 'Despachado', 'Completado', 'En Preparación', 'Aprobado'];
    allOrders.forEach(o => {
      if (activeStatuses.includes(o.status)) {
        const paid = o.amountPaid || 0;
        const pending = Math.max(0, o.totalAmount - paid);
        if (pending > 0.05 && o.customerId) {
          map.set(o.customerId, (map.get(o.customerId) || 0) + pending);
        }
      }
    });
    return map;
  }, [allOrders]);

  // LISTA DE ASESORES PARA FILTRO ADMIN
  const uniqueSalespeople = useMemo(() => {
    if (!customers) return [];
    return Array.from(new Set(customers.map(c => c.assignedSalespersonName))).filter((sp): sp is string => Boolean(sp)).sort();
  }, [customers]);

  // METRICAS EJECUTIVAS
  const metrics = useMemo(() => {
    if (!customers) return { total: 0, activos: 0, enMora: 0, remarketing: 0, totalDebt: 0 };
    const now = new Date();
    
    let total = customers.length;
    let activos = 0;
    let enMora = 0;
    let remarketing = 0;
    let totalDebt = 0;

    customers.forEach(c => {
      const days = c.lastOrderDate ? differenceInDays(now, c.lastOrderDate.toDate()) : null;
      const debt = c.id ? (customerPendingBalances.get(c.id) || 0) : 0;
      totalDebt += debt;

      if (days !== null && days <= 15) activos++;
      if (days === null || days > 30) remarketing++;
      if (debt > 0.05 && days !== null && days > 30) enMora++;
    });

    return { total, activos, enMora, remarketing, totalDebt };
  }, [customers, customerPendingBalances]);

  // FILTRADO DE CLIENTES EN TABLA
  const filteredCustomers = useMemo(() => {
    if (!customers) return [];
    let items = customers;
    const now = new Date();

    if (statusFilter !== 'todos') {
      items = items.filter(c => c.status === statusFilter);
    }

    if (salespersonFilter !== 'todos') {
      items = items.filter(c => c.assignedSalespersonName === salespersonFilter);
    }

    if (inactivityFilter !== 'todos') {
      items = items.filter(c => {
        const days = c.lastOrderDate ? differenceInDays(now, c.lastOrderDate.toDate()) : null;
        if (inactivityFilter === 'activos') return days !== null && days <= 7;
        if (inactivityFilter === 'atencion') return days !== null && days > 7 && days <= 15;
        if (inactivityFilter === 'inactivos') return days === null || days > 30;
        return true;
      });
    }

    if (debtFilter !== 'todos') {
      items = items.filter(c => {
        const debt = c.id ? (customerPendingBalances.get(c.id) || 0) : 0;
        if (debtFilter === 'con_deuda') return debt > 0.05;
        if (debtFilter === 'sin_deuda') return debt <= 0.05;
        return true;
      });
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase().trim();
      items = items.filter(c => 
        c.razonSocial.toLowerCase().includes(term) || 
        c.rif.toLowerCase().includes(term) ||
        c.email.toLowerCase().includes(term) ||
        (c.assignedSalespersonName || '').toLowerCase().includes(term)
      );
    }
    return items;
  }, [customers, statusFilter, salespersonFilter, inactivityFilter, debtFilter, searchTerm, customerPendingBalances]);

  const handleClearFilters = () => {
    setSearchTerm('');
    setStatusFilter('todos');
    setSalespersonFilter('todos');
    setInactivityFilter('todos');
    setDebtFilter('todos');
  };

  const handleSendWhatsAppQuick = (customer: Customer, e: React.MouseEvent) => {
    e.stopPropagation();
    const rawPhone = (customer.phone || '').replace(/\D/g, '');
    const cleanPhone = rawPhone.length === 10 ? `58${rawPhone}` : rawPhone;
    const pendingDebt = customer.id ? (customerPendingBalances.get(customer.id) || 0) : 0;
    
    const text = `*ATHLETICENTER C.A. - ATENCIÓN Y ASESORÍA B2B*\n\n` +
      `Estimado(a) *${customer.razonSocial}*,\n\n` +
      `Le saludamos del Departamento Comercial de Athleticenter. Queremos hacer seguimiento a su cuenta corporativa:\n\n` +
      `📄 *RIF Fiscal:* ${customer.rif}\n` +
      (pendingDebt > 0.05 ? `💰 *Saldo Pendiente:* $${pendingDebt.toFixed(2)} USD\n` : `✅ *Estado de Cuenta:* Al Día\n`) +
      `📍 *Asesor Asignado:* ${customer.assignedSalespersonName || 'Atención General'}\n\n` +
      `¿En qué podemos apoyarle hoy con el despacho de mercancía o actualización de ofertas?\n\n` +
      `¡Muchas gracias por su preferencia!`;

    const url = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  useEffect(() => {
    const searchParam = searchParams.get('search');
    if (searchParam) setSearchTerm(searchParam);
  }, [searchParams]);

  if (isUserLoading || !currentUser) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;

  return (
    <div className="w-full max-w-[1440px] mx-auto flex flex-col gap-8 pb-32 px-4 sm:px-6 lg:px-10 animate-in fade-in-50 duration-500">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between px-2">
        <div className="space-y-1 text-left">
            <h1 className="text-4xl font-black uppercase tracking-tighter text-slate-900 leading-none">Cartera de Clientes</h1>
            <p className="text-[10px] text-muted-foreground font-black italic uppercase tracking-[0.4em] opacity-60">
                {isAdmin ? "Directorio Maestro de Cuentas B2B (Visión Global)" : "Gestión de Cuentas B2B y Agenda Comercial."}
            </p>
        </div>
        <NewUserDialog defaultRole="cliente" buttonLabel="Registrar Cliente" />
      </header>
      
      {/* METRICAS KPI EJECUTIVAS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 px-2">
        <DashboardMetricCard 
          title="Total Cuentas B2B" 
          value={metrics.total} 
          subtitle="Red Corporativa" 
          icon={Building} 
          iconBg="bg-blue-50" 
          iconColor="text-blue-500" 
          onClick={handleClearFilters}
          isActive={statusFilter === 'todos' && salespersonFilter === 'todos' && inactivityFilter === 'todos' && debtFilter === 'todos'}
        />
        <DashboardMetricCard 
          title="Cuentas Activas" 
          value={metrics.activos} 
          subtitle="Compras < 15 Días" 
          icon={CheckCircle2} 
          iconBg="bg-emerald-50" 
          iconColor="text-emerald-500" 
          onClick={() => setInactivityFilter('activos')}
          isActive={inactivityFilter === 'activos'}
        />
        <DashboardMetricCard 
          title="Cartera en Mora" 
          value={metrics.enMora} 
          subtitle={`Deuda Total $${metrics.totalDebt.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} 
          icon={AlertTriangle} 
          iconBg="bg-rose-50" 
          iconColor="text-rose-500" 
          onClick={() => setDebtFilter('con_deuda')}
          isActive={debtFilter === 'con_deuda'}
        />
        <DashboardMetricCard 
          title="Remarketing Requerido" 
          value={metrics.remarketing} 
          subtitle="Sin Compras > 30 Días" 
          icon={Clock} 
          iconBg="bg-amber-50" 
          iconColor="text-amber-500" 
          onClick={() => setInactivityFilter('inactivos')}
          isActive={inactivityFilter === 'inactivos'}
        />
      </div>

      {isAdmin && (
          <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10 flex items-center gap-3 mx-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <p className="text-[10px] font-black uppercase text-primary tracking-widest leading-relaxed">
                  MODO ADMINISTRADOR: Estás viendo la lista global. Úsala para encontrar clientes registrados por otros asesores o cuentas en proceso de reasignación.
              </p>
          </div>
      )}

      {/* BARRA DE FILTROS AVANZADOS MULTIDIMENSIONAL */}
      <Card className="border-none shadow-sm rounded-[2.5rem] overflow-hidden bg-white mx-2">
        <CardHeader className="bg-slate-900 text-white py-4 px-8">
          <div className="flex justify-between items-center">
            <CardTitle className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-300 flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" /> Filtros Tácticos de Cartera
            </CardTitle>
            {(searchTerm || statusFilter !== 'todos' || salespersonFilter !== 'todos' || inactivityFilter !== 'todos' || debtFilter !== 'todos') && (
              <Button variant="ghost" size="sm" onClick={handleClearFilters} className="h-8 text-[9px] font-black uppercase text-rose-400 hover:bg-white/10 hover:text-rose-300">
                <FilterX className="h-3 w-3 mr-1" /> Limpiar Filtros
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase text-slate-500 tracking-widest px-1">Búsqueda Directa</Label>
              <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input 
                    placeholder="RAZÓN SOCIAL, RIF O EMAIL..." 
                    className="h-11 pl-10 rounded-xl bg-slate-50 border-none font-bold text-xs uppercase shadow-inner" 
                    value={searchTerm} 
                    onChange={(e) => setSearchTerm(e.target.value)} 
                  />
              </div>
            </div>

            {isAdmin && uniqueSalespeople.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-[9px] font-black uppercase text-slate-500 tracking-widest px-1">Asesor de Ventas</Label>
                <Select value={salespersonFilter} onValueChange={setSalespersonFilter}>
                    <SelectTrigger className="h-11 rounded-xl bg-slate-50 border-none font-bold text-xs uppercase shadow-inner"><SelectValue placeholder="Asesor" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="todos" className="font-bold text-xs uppercase">ASESOR: TODOS</SelectItem>
                        {uniqueSalespeople.map(sp => <SelectItem key={sp} value={sp} className="font-bold text-xs uppercase">{sp.toUpperCase()}</SelectItem>)}
                    </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase text-slate-500 tracking-widest px-1">Actividad Comercial</Label>
              <Select value={inactivityFilter} onValueChange={setInactivityFilter}>
                  <SelectTrigger className="h-11 rounded-xl bg-slate-50 border-none font-bold text-xs uppercase shadow-inner"><SelectValue placeholder="Actividad" /></SelectTrigger>
                  <SelectContent>
                      <SelectItem value="todos" className="font-bold text-xs uppercase">ACTIVIDAD: TODAS</SelectItem>
                      <SelectItem value="activos" className="font-bold text-xs uppercase text-emerald-600">ACTIVAS (&lt; 7 DÍAS)</SelectItem>
                      <SelectItem value="atencion" className="font-bold text-xs uppercase text-amber-600">EN ATENCIÓN (8-15 DÍAS)</SelectItem>
                      <SelectItem value="inactivos" className="font-bold text-xs uppercase text-rose-600">INACTIVAS (+30 DÍAS)</SelectItem>
                  </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase text-slate-500 tracking-widest px-1">Estado de Deuda</Label>
              <Select value={debtFilter} onValueChange={setDebtFilter}>
                  <SelectTrigger className="h-11 rounded-xl bg-slate-50 border-none font-bold text-xs uppercase shadow-inner"><SelectValue placeholder="Deuda" /></SelectTrigger>
                  <SelectContent>
                      <SelectItem value="todos" className="font-bold text-xs uppercase">DEUDA: TODAS</SelectItem>
                      <SelectItem value="con_deuda" className="font-bold text-xs uppercase text-rose-600 font-black">CON SALDO DEUDOR</SelectItem>
                      <SelectItem value="sin_deuda" className="font-bold text-xs uppercase text-emerald-600">AL DÍA / SIN DEUDA</SelectItem>
                  </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* TABLA PRINCIPAL DE CLIENTES */}
      <div className="space-y-6 mx-2">
        <ScrollArea className="w-full whitespace-nowrap rounded-[2.5rem] border border-slate-100 shadow-xl bg-white">
            <div className="min-w-[1100px]">
                <Table>
                    <TableHeader className="bg-slate-900 text-white">
                        <TableRow className="hover:bg-transparent border-none">
                            <TableHead className="text-[10px] font-black uppercase tracking-widest pl-8 py-5 text-white">Entidad Comercial</TableHead>
                            <TableHead className="text-[10px] font-black uppercase tracking-widest text-white">RIF Fiscal</TableHead>
                            <TableHead className="text-center text-[10px] font-black uppercase tracking-widest text-white">Saldo Deudor</TableHead>
                            <TableHead className="text-center text-[10px] font-black uppercase tracking-widest text-white">Actividad</TableHead>
                            {isAdmin && <TableHead className="text-[10px] font-black uppercase tracking-widest text-white">Asesor Asignado</TableHead>}
                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest pr-8 text-white">Acciones 360°</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading && customers === null ? Array.from({ length: 3 }).map((_, i) => (<TableRow key={i}><TableCell colSpan={isAdmin ? 6 : 5} className="py-8 px-8"><Skeleton className="h-10 w-full rounded-xl" /></TableCell></TableRow>)) : filteredCustomers.length > 0 ? filteredCustomers.map((customer) => {
                            const daysInactive = customer.lastOrderDate ? differenceInDays(new Date(), customer.lastOrderDate.toDate()) : null;
                            const pendingDebt = customer.id ? (customerPendingBalances.get(customer.id) || 0) : 0;

                            return (
                            <TableRow key={customer.id} className="hover:bg-primary/5 cursor-pointer transition-colors border-b last:border-none group" onClick={() => setSelectedCustomer(customer)}>
                                <TableCell className="py-5 pl-8">
                                  <div className="flex items-center gap-4">
                                      <div className="h-11 w-11 rounded-2xl bg-primary/10 flex items-center justify-center text-primary font-black text-sm shadow-inner group-hover:scale-110 transition-transform">{customer.razonSocial.charAt(0)}</div>
                                      <div className="flex flex-col">
                                          <span className="font-black text-sm uppercase tracking-tighter text-slate-900 leading-none">{customer.razonSocial}</span>
                                          <span className="text-[9px] font-bold text-slate-500 mt-1">{customer.email}</span>
                                      </div>
                                  </div>
                                </TableCell>
                                <TableCell className="font-mono text-xs font-black text-slate-600 uppercase">{customer.rif}</TableCell>
                                <TableCell className="text-center">
                                    {pendingDebt > 0.05 ? (
                                        <Badge className="bg-rose-500 text-white font-black text-[9px] uppercase px-2.5 py-1 rounded-lg shadow-sm">
                                            ${pendingDebt.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                        </Badge>
                                    ) : (
                                        <Badge className="bg-emerald-100 text-emerald-700 font-black text-[8px] uppercase border-none px-2.5 py-0.5">
                                            AL DÍA ($0.00)
                                        </Badge>
                                    )}
                                </TableCell>
                                <TableCell className="text-center">
                                    {daysInactive !== null ? (
                                        <Badge className={cn("text-[8px] font-black uppercase h-5 border-none", daysInactive >= 30 ? 'bg-rose-100 text-rose-700' : daysInactive >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>
                                            {daysInactive === 0 ? 'Hoy' : `Hace ${daysInactive} d`}
                                        </Badge>
                                    ) : <Badge variant="outline" className="text-[8px] font-black uppercase opacity-30 h-5">Sin Historial</Badge>}
                                </TableCell>
                                {isAdmin && (
                                    <TableCell className="text-[10px] font-black uppercase text-slate-600">{customer.assignedSalespersonName || 'Sin Asignar'}</TableCell>
                                )}
                                <TableCell className="text-right pr-8">
                                    <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                        <Button 
                                            size="sm" 
                                            onClick={(e) => handleSendWhatsAppQuick(customer, e)}
                                            className="h-8 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[9px] uppercase tracking-wider shadow-sm flex items-center gap-1"
                                        >
                                            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                                        </Button>
                                        <Button 
                                            variant="outline"
                                            size="sm" 
                                            onClick={() => setSelectedCustomer(customer)}
                                            className="h-8 px-3 rounded-xl border-slate-200 hover:bg-slate-900 hover:text-white font-black text-[9px] uppercase tracking-wider flex items-center gap-1 transition-all"
                                        >
                                            <Eye className="h-3.5 w-3.5" /> Expediente 360°
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                            )
                        }) : (
                            <TableRow>
                                <TableCell colSpan={isAdmin ? 6 : 5} className="h-60 text-center flex flex-col items-center justify-center gap-4">
                                    <div className="opacity-30 flex flex-col items-center gap-4">
                                        <Users className="h-12 w-12 text-slate-400" />
                                        <p className="text-xs font-black uppercase tracking-[0.3em] text-slate-500">Sin cuentas comerciales encontradas para este filtro</p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            <ScrollBar orientation="horizontal" className="bg-slate-50 h-3" />
        </ScrollArea>
        
        {customers && customers.length >= queryLimit && (
            <div className="flex justify-center pb-10">
                <Button variant="ghost" onClick={() => setQueryLimit(prev => prev + 50)} className="font-black uppercase text-[8px] tracking-[0.3em] text-primary h-10 px-8 rounded-xl border border-dashed border-primary/20 hover:bg-primary/5">
                    {isLoading ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <Plus className="h-3 w-3 mr-2" />}
                    Cargar Más Cuentas...
                </Button>
            </div>
        )}
      </div>

      <CustomerDetailsSheet 
        customer={selectedCustomer} 
        user={selectedCustomer && selectedCustomer.id ? usersById.get(selectedCustomer.id) || null : null}
        pendingBalance={selectedCustomer && selectedCustomer.id ? (customerPendingBalances.get(selectedCustomer.id) || 0) : 0}
        isOpen={!!selectedCustomer} 
        onOpenChange={(open) => !open && setSelectedCustomer(null)}
        onEdit={(user) => { setSelectedCustomer(null); setEditingUser(user); }}
      />

      {editingUser && (
        <EditUserDialog 
            user={editingUser} 
            isOpen={!!editingUser} 
            onOpenChange={(open) => !open && setEditingUser(null)} 
            title="Sincronizar Ficha de Cliente" 
        />
      )}
    </div>
  );
}
