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
    Plus
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { User, Customer } from '@/lib/definitions';
import { NewUserDialog } from '../users/new-user-dialog';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, limit } from 'firebase/firestore';
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

function CustomerDetailsSheet({ 
    customer, 
    user, 
    isOpen, 
    onOpenChange,
    onEdit
}: { 
    customer: Customer | null; 
    user: User | null;
    isOpen: boolean; 
    onOpenChange: (open: boolean) => void;
    onEdit: (user: User) => void;
}) {
    const daysInactive = customer?.lastOrderDate ? differenceInDays(new Date(), customer.lastOrderDate.toDate()) : null;

    if (!customer) return null;

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
                    <div className="p-8 space-y-10">
                        <div className="p-6 rounded-[2.5rem] bg-slate-50 border border-slate-100 grid grid-cols-2 gap-6 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-5"><TrendingUp className="h-12 w-12" /></div>
                            <div className="space-y-1">
                                <p className="text-[8px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1">
                                    <Clock className="h-3 w-3" /> Estado de Actividad
                                </p>
                                {daysInactive !== null ? (
                                    <div className="flex flex-col">
                                        <span className={cn("text-lg font-black uppercase", daysInactive >= 30 ? "text-rose-600" : daysInactive >= 15 ? "text-amber-600" : "text-emerald-600")}>
                                            {daysInactive === 0 ? "Activo Hoy" : `Hace ${daysInactive} días`}
                                        </span>
                                    </div>
                                ) : (
                                    <span className="text-lg font-black uppercase text-slate-300 italic">Sin Historial</span>
                                )}
                            </div>
                            <div className="space-y-1 border-l pl-6">
                                <p className="text-[8px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1">
                                    <ShieldCheck className="h-3 w-3" /> Estatus Red
                                </p>
                                <span className="text-lg font-black uppercase text-emerald-600">Sincronizado</span>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-2 px-1">
                                <Zap className="h-4 w-4 text-primary" /> Datos de la Entidad
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
                                        <Label className="text-[8px] font-black uppercase text-slate-400 tracking-widest">Estado Cuenta</Label>
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
                                <div className="p-5 rounded-[1.8rem] border border-slate-100 bg-white shadow-sm space-y-1">
                                    <Label className="text-[8px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-1.5"><MapPin className="h-3 w-3" /> Dirección Fiscal</Label>
                                    <p className="text-xs font-medium text-slate-600 leading-relaxed">{customer.address || 'Sin dirección registrada.'}</p>
                                </div>
                            </div>
                        </div>

                        <Separator className="opacity-50" />

                        <div className="p-6 rounded-[2.5rem] bg-primary/5 border border-primary/10 space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-primary flex items-center gap-2">
                                <ShoppingCart className="h-4 w-4" /> Gestión Comercial
                            </h3>
                            <div className="flex justify-between items-center">
                                <div className="space-y-0.5">
                                    <p className="text-[8px] font-black uppercase text-slate-400">Asesor de Ventas</p>
                                    <p className="text-xs font-black uppercase text-slate-800">{customer.assignedSalespersonName || 'Sin Asignar'}</p>
                                </div>
                                <Button size="sm" asChild className="h-9 px-5 rounded-xl font-black uppercase text-[9px] tracking-widest bg-slate-900 hover:bg-primary shadow-lg transition-all">
                                    <Link href={`/dashboard/orders/new?customer=${customer.id}`}>Configurar Pedido <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link>
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

  // OPTIMIZACIÓN: Paginación para clientes
  const [queryLimit, setQueryLimit] = useState(50);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('Activo');
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

  const { data: customers, isLoading: isLoadingCustomers } = useCollection<Customer>(customersQuery);
  const { data: allUsers, isLoading: isLoadingUsers } = useCollection<User>(usersQuery);

  const isLoading = isUserLoading || isLoadingCustomers || isLoadingUsers;
  const usersById = useMemo(() => new Map(allUsers?.map(u => [u.id, u]) || []), [allUsers]);

  const filteredCustomers = useMemo(() => {
    if (!customers) return [];
    let items = customers;
    if (statusFilter !== 'todos') items = items.filter(c => c.status === statusFilter);
    if (searchTerm) {
      const term = searchTerm.toLowerCase().trim();
      items = items.filter(c => 
        c.razonSocial.toLowerCase().includes(term) || 
        c.rif.toLowerCase().includes(term) ||
        c.email.toLowerCase().includes(term)
      );
    }
    return items;
  }, [customers, searchTerm, statusFilter]);

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
      
      {isAdmin && (
          <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10 flex items-center gap-3 mx-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <p className="text-[10px] font-black uppercase text-primary tracking-widest leading-relaxed">
                  MODO ADMINISTRADOR: Estás viendo la lista global. Úsala para encontrar clientes registrados por otros asesores o cuentas en proceso de reasignación.
              </p>
          </div>
      )}

      <Card className="border-none shadow-sm rounded-[2.5rem] overflow-hidden bg-white mx-2">
        <CardHeader className="bg-muted/5 border-b py-4 px-8">
          <div className="flex justify-between items-center">
            <CardTitle className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground flex items-center gap-2">Filtros de Búsqueda</CardTitle>
            {searchTerm && <Button variant="ghost" size="sm" onClick={() => setSearchTerm('')} className="h-7 text-[9px] font-black uppercase"><FilterX className="h-3 w-3 mr-1" /> Limpiar</Button>}
          </div>
        </CardHeader>
        <CardContent className="p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase text-slate-500 tracking-widest px-1">Búsqueda Táctica</Label>
              <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input placeholder="RAZÓN SOCIAL, RIF O EMAIL..." className="h-11 pl-10 rounded-xl bg-slate-50 border-none font-bold text-xs uppercase shadow-inner" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[9px] font-black uppercase text-slate-500 tracking-widest px-1">Estado Cuenta</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-11 rounded-xl bg-slate-50 border-none shadow-inner font-bold text-xs uppercase shadow-inner"><SelectValue /></SelectTrigger>
                  <SelectContent>
                      <SelectItem value="todos">TODOS LOS ESTADOS</SelectItem>
                      <SelectItem value="Activo">ACTIVOS</SelectItem>
                      <SelectItem value="Inactivo">INACTIVOS</SelectItem>
                  </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6 mx-2">
        <ScrollArea className="w-full whitespace-nowrap rounded-[2.5rem] border border-slate-100 shadow-xl bg-white">
            <div className="min-w-[1000px]">
                <Table>
                    <TableHeader className="bg-slate-900 text-white">
                        <TableRow className="hover:bg-transparent border-none">
                            <TableHead className="text-[10px] font-black uppercase tracking-widest pl-10 py-5 text-white">Entidad Comercial</TableHead>
                            <TableHead className="text-[10px] font-black uppercase tracking-widest text-white">RIF Fiscal</TableHead>
                            <TableHead className="text-center text-[10px] font-black uppercase tracking-widest text-white">Actividad</TableHead>
                            {isAdmin && <TableHead className="text-[10px] font-black uppercase tracking-widest text-white">Asesor</TableHead>}
                            <TableHead className="text-right text-[10px] font-black uppercase tracking-widest pr-10 text-white">Acción</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading && customers === null ? Array.from({ length: 3 }).map((_, i) => (<TableRow key={i}><TableCell colSpan={isAdmin ? 5 : 4} className="py-8 px-10"><Skeleton className="h-10 w-full rounded-xl" /></TableCell></TableRow>)) : filteredCustomers.length > 0 ? filteredCustomers.map((customer) => {
                            const daysInactive = customer.lastOrderDate ? differenceInDays(new Date(), customer.lastOrderDate.toDate()) : null;
                            return (
                            <TableRow key={customer.id} className="hover:bg-primary/5 cursor-pointer transition-colors border-b last:border-none group" onClick={() => setSelectedCustomer(customer)}>
                                <TableCell className="py-6 pl-10">
                                <div className="flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary font-black text-xs shadow-inner group-hover:scale-110 transition-transform">{customer.razonSocial.charAt(0)}</div>
                                    <div className="flex flex-col"><span className="font-black text-sm uppercase tracking-tighter text-slate-800 leading-none">{customer.razonSocial}</span><span className="text-[9px] font-muted-foreground font-bold uppercase mt-1.5">{customer.email}</span></div>
                                </div>
                                </TableCell>
                                <TableCell className="font-mono text-xs font-black text-slate-500 uppercase">{customer.rif}</TableCell>
                                <TableCell className="text-center">
                                    {daysInactive !== null ? (
                                        <Badge className={cn("text-[8px] font-black uppercase h-5 border-none", daysInactive >= 30 ? 'bg-rose-500 text-white' : 'bg-emerald-100 text-emerald-700')}>
                                            {daysInactive === 0 ? 'Hoy' : `Hace ${daysInactive} d`}
                                        </Badge>
                                    ) : <Badge variant="outline" className="text-[8px] font-black uppercase opacity-30 h-5">Sin Historial</Badge>}
                                </TableCell>
                                {isAdmin && (
                                    <TableCell className="text-[10px] font-black uppercase text-slate-500">{customer.assignedSalespersonName || 'Sin Asignar'}</TableCell>
                                )}
                                <TableCell className="text-right pr-10">
                                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl text-slate-300 group-hover:text-primary transition-colors">
                                        <ChevronRight className="h-5 w-5" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                            )
                        }) : (
                            <TableRow>
                                <TableCell colSpan={isAdmin ? 5 : 4} className="h-60 text-center flex flex-col items-center justify-center gap-4">
                                    <div className="opacity-20 flex flex-col items-center gap-4">
                                        <Users className="h-12 w-12" />
                                        <p className="text-xs font-black uppercase tracking-[0.3em]">Sin registros tácticos encontrados</p>
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
                <Button variant="ghost" onClick={() => setQueryLimit(prev => prev + 50)} className="font-black uppercase text-[8px] tracking-[0.3em] text-primary h-10 px-8 rounded-xl border border-dashed border-primary/20">
                    {isLoading ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <Plus className="h-3 w-3 mr-2" />}
                    Cargar Más Cuentas...
                </Button>
            </div>
        )}
      </div>

      <CustomerDetailsSheet 
        customer={selectedCustomer} 
        user={selectedCustomer ? usersById.get(selectedCustomer.id) || null : null}
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
