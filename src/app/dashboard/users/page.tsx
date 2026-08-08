'use client';

import React, { useEffect, useMemo, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
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
import { MoreHorizontal, Loader2, AlertTriangle, Search, ShieldAlert } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { User } from '@/lib/definitions';
import { NewUserDialog } from './new-user-dialog';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where, limit } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { EditUserDialog } from './edit-user-dialog';
import {
  TooltipProvider,
} from '@/components/ui/tooltip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';

export const dynamic = 'force-dynamic';

function UsersPageContent() {
  const { profile: currentUser, isUserLoading } = useUser();
  const router = useRouter();
  const firestore = useFirestore();
  
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [statusFilter, setStatusFilter] = useState('Activo');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!isUserLoading && currentUser && !['superadmin', 'admin', 'gerencia'].includes(currentUser.role)) {
      router.replace('/dashboard');
    }
  }, [currentUser, isUserLoading, router]);

  const allUsersQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser) return null;
    const usersRef = collection(firestore, 'users');
    
    if (!['superadmin', 'admin', 'gerencia'].includes(currentUser.role)) {
        const staffRoles = ['superadmin', 'admin', 'gerencia', 'ventas', 'deposito'];
        return query(usersRef, where('role', 'in', staffRoles), limit(100));
    }
    
    return query(usersRef, limit(100));
  }, [firestore, currentUser]);

  const { data: allUsers, isLoading: isLoadingAllUsers } = useCollection<User>(allUsersQuery);

  const filteredUsers = useMemo(() => {
    if (!allUsers) return [];
    let items = allUsers;
    if (statusFilter !== 'todos') items = items.filter(user => user.status === statusFilter);
    if (searchTerm) {
        const term = searchTerm.toLowerCase().trim();
        items = items.filter(user => 
            user.name.toLowerCase().includes(term) || 
            user.email.toLowerCase().includes(term)
        );
    }
    return items;
  }, [allUsers, statusFilter, searchTerm]);
  
  const userStats = useMemo(() => {
    if (!allUsers) return { total: 0, staff: 0, clients: 0, active: 0, inactive: 0 };
    return {
      total: allUsers.length,
      staff: allUsers.filter(u => u.role !== 'cliente').length,
      clients: allUsers.filter(u => u.role === 'cliente').length,
      active: allUsers.filter(u => u.status === 'Activo').length,
      inactive: allUsers.filter(u => u.status === 'Inactivo').length,
    };
  }, [allUsers]);

  if (isUserLoading || !currentUser) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <>
      <TooltipProvider>
        <div className="flex flex-col gap-6 w-full pb-20 animate-in fade-in-50 duration-500 px-2 sm:px-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-2">
            <div>
              <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900">Gestión de Usuarios y Seguridad</h1>
              <p className="text-[10px] text-muted-foreground font-black italic uppercase tracking-[0.3em] opacity-60">Control de Roles, Facultades y Auditoría de Identidad</p>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => router.push('/dashboard/audit')} className="h-11 px-4 rounded-xl font-black uppercase text-[10px] tracking-wider border-slate-200 shadow-sm">
                <ShieldAlert className="mr-2 h-4 w-4 text-amber-500" /> Bitácora de Auditoría
              </Button>
              <NewUserDialog />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mx-2">
            <Card className="border-none shadow-md rounded-2xl p-4 bg-slate-900 text-white">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Total Usuarios</p>
              <p className="text-2xl sm:text-3xl font-black tracking-tighter mt-1">{userStats.total}</p>
            </Card>
            <Card className="border-none shadow-md rounded-2xl p-4 bg-indigo-600 text-white">
              <p className="text-[9px] font-black uppercase tracking-widest text-indigo-200">Personal Staff</p>
              <p className="text-2xl sm:text-3xl font-black tracking-tighter mt-1">{userStats.staff}</p>
            </Card>
            <Card className="border-none shadow-md rounded-2xl p-4 bg-emerald-600 text-white">
              <p className="text-[9px] font-black uppercase tracking-widest text-emerald-200">Clientes Red B2B</p>
              <p className="text-2xl sm:text-3xl font-black tracking-tighter mt-1">{userStats.clients}</p>
            </Card>
            <Card className="border-none shadow-md rounded-2xl p-4 bg-white border border-slate-100 shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Activos / Inactivos</p>
              <p className="text-2xl sm:text-3xl font-black tracking-tighter mt-1 text-slate-900">{userStats.active} <span className="text-sm font-bold text-rose-500">/ {userStats.inactive}</span></p>
            </Card>
          </div>
          
          <Card className="border-none shadow-sm rounded-2xl overflow-hidden bg-white mx-2">
            <CardHeader className="bg-muted/10 border-b py-3 px-6"><CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Filtros de Seguridad y Acceso</CardTitle></CardHeader>
            <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-muted-foreground px-1">Búsqueda</Label><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" /><Input placeholder="NOMBRE O EMAIL..." className="h-11 pl-10 rounded-xl bg-slate-50 border-none font-bold text-xs uppercase" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div></div>
                    <div className="space-y-1.5"><Label className="text-[10px] font-black uppercase text-muted-foreground px-1">Estado</Label><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="h-11 rounded-xl bg-slate-50 border-none font-bold"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">TODOS</SelectItem><SelectItem value="Activo">ACTIVOS</SelectItem><SelectItem value="Inactivo">INACTIVOS</SelectItem></SelectContent></Select></div>
                </div>
            </CardContent>
          </Card>
          
          <div className="rounded-[2rem] border-none shadow-xl overflow-hidden bg-white mx-2">
            <Table>
                <TableHeader className="bg-slate-900 text-white"><TableRow><TableHead className="pl-10 py-5">Usuario</TableHead><TableHead>Rol</TableHead><TableHead className="text-center">Estado</TableHead><TableHead className="text-right pr-10">Acciones</TableHead></TableRow></TableHeader>
                <TableBody>
                    {isLoadingAllUsers ? Array.from({ length: 3 }).map((_, i) => <TableRow key={i}><TableCell colSpan={4} className="py-8 pl-10"><Skeleton className="h-10 w-full rounded-xl" /></TableCell></TableRow>) : filteredUsers.map((user) => (
                        <TableRow key={user.id} className="hover:bg-primary/5 transition-colors border-b last:border-none">
                        <TableCell className="pl-10 py-6"><div className="flex items-center gap-4"><Avatar><AvatarImage src={user.avatarUrl} /><AvatarFallback>{user.name?.charAt(0)}</AvatarFallback></Avatar><div><p className="font-black text-sm uppercase">{user.name}</p><p className="text-[10px] font-bold text-muted-foreground">{user.email}</p></div></div></TableCell>
                        <TableCell className="capitalize font-bold text-xs">{user.role}</TableCell>
                        <TableCell className="text-center"><Badge className={cn("text-[9px] font-black uppercase px-2.5 h-5", user.status === 'Activo' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700')}>{user.status}</Badge></TableCell>
                        <TableCell className="text-right pr-10"><Button variant="ghost" size="icon" onClick={() => setEditingUser(user)}><MoreHorizontal className="h-4 w-4" /></Button></TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
          </div>
        </div>
      </TooltipProvider>
      {editingUser && <EditUserDialog user={editingUser} isOpen={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)} />}
    </>
  );
}

export default function UsersPage() {
    return <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>}><UsersPageContent /></Suspense>;
}