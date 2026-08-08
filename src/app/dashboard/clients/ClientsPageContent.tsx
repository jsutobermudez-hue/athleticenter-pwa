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
    Building
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { User, Customer, Order } from '@/lib/definitions';
import { NewUserDialog } from '../users/new-user-dialog';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, limit, orderBy } from 'firebase/firestore';
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
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import Link from 'next/link';
import { differenceInDays } from 'date-fns';

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
    const daysInactive = customer?.lastOrderDate ? differenceInDays(new Date(), customer.lastOrderDate.toDate()) : null;

    if (!customer) return null;

    const handleWhatsAppClick = () => {
        const rawPhone = (customer.phone || '').replace(/\D/g, '');
        const cleanPhone = rawPhone.length === 10 ? `58${rawPhone}` : rawPhone;
        const text = `*ATHLETICENTER C.A. - SEGUIMIENTO DE CUENTA B2B*\n\n` +
          `Estimado(a) *${customer.razonSocial}*,\n\n` +
          `Le saludamos del Departamento Comercial. Le informamos sobre el estado consolidado de su cuenta corporativa:\n\n` +
          `📄 *RIF Fiscal:* ${customer.rif}\n` +
          (pendingBalance > 0 ? `💰 *Saldo Pendiente:* $${pendingBalance.toFixed(2)} USD\n` : `✅ *Estado de Cuenta:* Al Día\n`) +
          `📍 *Asesor Asignado:* ${customer.assignedSalespersonName || 'Atención General'}\n\n` +
          `¿Desea realizar alguna consulta o requerir reposición de catálogo?\n\n` +
          `¡Quedamos atentos a sus órdenes!`;

        const url = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(url, '_blank');
    };

    return (
        <Sheet open={isOpen} onOpenChange={onOpenChange}>
            <SheetContent className="w-full sm:max-w-xl p-0 border-none rounded-l-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-full">
                <SheetHeader className="p-8 pb-6 bg-slate-900 text-white shrink-0">
                    <div className="flex items-center gap-5">
                        <div className="h-16 w-16 rounded-[1.5rem] bg-primary/20 text-primary flex items-center justify-center shadow-xl border border-primary/10">
                            <Briefcase className="h-8 w-8" />
                        </div>
                        <div className="flex-1 text-left space-y-1">
                            <SheetTitle className="text-2xl font-black uppercase tracking-tighter text-white leading-none">Ficha del Cliente</SheetTitle>
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
                    <div className="p-8 space-y-8">
                        {/* RESUMEN DE SALDO Y ACTIVIDAD */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className={cn("p-6 rounded-[2rem] border grid gap-2", pendingBalance > 0.05 ? "bg-rose-50 border-rose-100" : "bg-emerald-50 border-emerald-100")}>
                                <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                                    <Wallet className="h-3.5 w-3.5 text-slate-500" /> Saldo Pendiente (Deuda)
                                </p>
                                <span className={cn("text-2xl font-black uppercase tracking-tight", pendingBalance > 0.05 ? "text-rose-600" : "text-emerald-600")}>
                                    ${pendingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </span>
                                <Badge className={cn("w-fit text-[8px] font-black uppercase border-none px-2.5 py-0.5", pendingBalance > 0.05 ? "bg-rose-600 text-white" : "bg-emerald-600 text-white")}>
                                    {pendingBalance > 0.05 ? 'CUENTA CON SALDO DEUDOR' : 'AL DÍA / SIN DEUDA'}
                                </Badge>
                            </div>

                            <div className="p-6 rounded-[2rem] bg-slate-50 border border-slate-100 grid gap-2">
                                <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                                    <Clock className="h-3.5 w-3.5 text-slate-500" /> Actividad Comercial
                                </p>
                                {daysInactive !== null ? (
                                    <span className={cn("text-2xl font-black uppercase tracking-tight", daysInactive >= 30 ? "text-rose-600" : daysInactive >= 15 ? "text-amber-600" : "text-emerald-600")}>
                                        {daysInactive === 0 ? "Activo Hoy" : `Hace ${daysInactive} días`}
                                    </span>
                                ) : (
                                    <span className="text-xl font-black uppercase text-slate-400 italic">Sin Compras</span>
                                )}
                                <Badge variant="outline" className="w-fit text-[8px] font-black uppercase border-slate-200">
                                    {daysInactive !== null && daysInactive >= 30 ? 'REMARKETING REQUERIDO' : 'CUENTA REGULAR'}
                                </Badge>
                            </div>
                        </div>

                        {/* BOTÓN RÁPIDO DE WHATSAPP */}
                        <Button 
                            onClick={handleWhatsAppClick} 
                            className="w-full h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider shadow-md flex items-center justify-center gap-2"
                        >
                            <MessageCircle className="h-4 w-4" /> Contactar al Cliente por WhatsApp
                        </Button>

                        {/* DATOS DE LA ENTIDAD */}
                        <div className="space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-2 px-1">
                                <Zap className="h-4 w-4 text-primary" /> Datos de la Entidad Comercial
                            </h3>
                            <div className="grid grid-cols-1 gap-4">
                                <div className="p-5 rounded-[1.8rem] border border-slate-100 bg-white shadow-sm space-y-1">
                                    <Label className="text-[8px] font-black uppercase text-slate-400 tracking-widest">Razón Social Completa</Label>
                                    <p className="text-sm font-black uppercase text-slate-900">{customer.razonSocial}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-5 rounded-[1.8rem] border border-slate-100 bg-white shadow-sm space-y-1">
                                        <Label className="text-[8px] font-black uppercase text-slate-400 tracking-widest">RIF Fiscal</Label>
                                        <p className="text-sm font-black uppercase font-mono text-primary">{customer.rif}</p>
                                    </div>
                                    <div className="p-5 rounded-[1.8rem] border border-slate-100 bg-white shadow-sm space-y-1">
                                        <Label className="text-[8px] font-black uppercase text-slate-400 tracking-widest">Estatus de Cuenta</Label>
                                        <div className="pt-1">
                                            <Badge className={cn("text-[8px] font-black uppercase border-none px-2 h-5", customer.status === 'Activo' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700')}>
                                                {customer.status}
                                            </Badge>
                                        </div>
                                    </div>
                                </div>
                                <div className="p-5 rounded-[1.8rem] border border-slate-100 bg-white shadow-sm space-y-1">
                                    <Label className="text-[8px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5"><Mail className="h-3 w-3" /> Correo Electrónico</Label>
                                    <p className="text-xs font-medium text-slate-600 truncate">{customer.email}</p>
                                </div>
                                {customer.phone && (
                                    <div className="p-5 rounded-[1.8rem] border border-slate-100 bg-white shadow-sm space-y-1">
                                        <Label className="text-[8px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5"><Phone className="h-3 w-3" /> Teléfono Master</Label>
                                        <p className="text-xs font-bold text-slate-900">{customer.phone}</p>
                                    </div>
                                )}
                                <div className="p-5 rounded-[1.8rem] border border-slate-100 bg-white shadow-sm space-y-1">
                                    <Label className="text-[8px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5"><MapPin className="h-3 w-3" /> Dirección Fiscal</Label>
                                    <p className="text-xs font-medium text-slate-600 leading-relaxed">{customer.address || 'Sin dirección registrada.'}</p>
                                </div>
                            </div>
                        </div>

                        <Separator className="opacity-50" />

                        {/* ACCIÓN COMERCIAL DE PEDIDO RÁPIDO */}
                        <div className="p-6 rounded-[2.5rem] bg-primary/5 border border-primary/10 space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-primary flex items-center gap-2">
                                <ShoppingCart className="h-4 w-4" /> Gestión Comercial
                            </h3>
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                <div className="space-y-0.5">
                                    <p className="text-[8px] font-black uppercase text-slate-400">Asesor de Ventas Asignado</p>
                                    <p className="text-xs font-black uppercase text-slate-800">{customer.assignedSalespersonName || 'Sin Asignar'}</p>
                                </div>
                                <Button size="sm" asChild className="h-10 px-6 rounded-xl font-black uppercase text-[10px] tracking-widest bg-slate-900 hover:bg-primary shadow-lg transition-all w-full sm:w-auto">
                                    <Link href={`/dashboard/orders/new?customer=${customer.id}`}>Crear Pedido Rápido <ArrowRight className="ml-2 h-4 w-4" /></Link>
                                </Button>
                            </div>
                        </div>
                    </div>
                </ScrollArea>
            </SheetContent>
        </Sheet>
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
            <div className="min-w-[1050px]">
                <Table>
                    <TableHeader className="bg-slate-900 text-white">
                        <TableRow className="hover:bg-transparent border-none">
                            <TableHead className="text-[10px] font-black uppercase tracking-widest pl-8 py-5 text-white">Entidad Comercial</TableHead>
                            <TableHead className="text-[10px] font-black uppercase tracking-widest text-white">RIF Fiscal</TableHead>
                            <TableHead className="text-center text-[10px] font-black uppercase tracking-widest text-white">Saldo Deudor</TableHead>
                            <TableHead className="text-center text-[10px] font-black uppercase tracking-widest text-white">Actividad</TableHead>
                            {isAdmin && <TableHead className="text-[10px] font-black uppercase tracking-widest text-white">Asesor Asignado</TableHead>}
                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest pr-8 text-white">Acción Directa</TableHead>
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
                                            variant="ghost" 
                                            size="icon" 
                                            onClick={() => setSelectedCustomer(customer)}
                                            className="h-8 w-8 rounded-xl text-slate-400 group-hover:text-primary transition-colors"
                                        >
                                            <ChevronRight className="h-5 w-5" />
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
