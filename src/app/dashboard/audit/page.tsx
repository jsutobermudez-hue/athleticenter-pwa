'use client';

import React, { useMemo, useState, Suspense } from 'react';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import type { AuditLog } from '@/lib/definitions';
import { Loader2, ShieldAlert, Clock, Activity, ShieldCheck, CheckCheck, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export const dynamic = 'force-dynamic';

function AuditPageContent() {
  const { profile: currentUser, isUserLoading } = useUser();
  const router = useRouter();
  const firestore = useFirestore();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('operations');

  const isAdmin = currentUser && currentUser.role === 'superadmin';
  const auditQuery = useMemoFirebase(() => (firestore && isAdmin) ? query(collection(firestore, 'auditLogs'), orderBy('createdAt', 'desc'), limit(300)) : null, [firestore, isAdmin]);
  const { data: logs, isLoading } = useCollection<AuditLog>(auditQuery);

  const filteredLogs = useMemo(() => {
    if (!logs) return { operations: [], notifications: [] };
    const term = searchTerm.toLowerCase();
    const allFiltered = logs.filter(log => 
        log.userName.toLowerCase().includes(term) || log.action.toLowerCase().includes(term)
    );
    return { operations: allFiltered.filter(l => l.resource !== 'notifications'), notifications: allFiltered.filter(l => l.resource === 'notifications') };
  }, [logs, searchTerm]);

  if (isUserLoading || !currentUser) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>;
  if (!isAdmin) { router.replace('/dashboard'); return null; }

  return (
    <div className="w-full max-w-[1440px] mx-auto flex flex-col gap-8 pb-32 px-4 animate-in fade-in-50 duration-500">
      <header className="space-y-1">
        <h1 className="terminal-header flex items-center gap-4"><ShieldAlert className="h-10 w-10 text-rose-600" /> Auditoría Global</h1>
        <p className="tech-label opacity-60">Registro maestro de operaciones críticas de red.</p>
      </header>

      <Card className="terminal-card"><CardContent className="p-8"><div className="relative"><Activity className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" /><Input placeholder="BUSCAR OPERARIO O ACCIÓN..." className="h-14 pl-12 rounded-[1.5rem] bg-slate-50 border-none font-bold" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div></CardContent></Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-6">
        <TabsList className="bg-white/50 p-1 h-12 rounded-xl shadow-sm"><TabsTrigger value="operations" className="rounded-lg font-black uppercase text-[10px] px-8">Operaciones</TabsTrigger><TabsTrigger value="notifications" className="rounded-lg font-black uppercase text-[10px] px-8">Alertas</TabsTrigger></TabsList>
        <TabsContent value="operations" className="mt-0"><div className="terminal-card">
            <Table>
                <TableHeader className="bg-slate-900 text-white"><TableRow><TableHead className="text-white pl-8 py-5">Fecha</TableHead><TableHead className="text-white">Operario</TableHead><TableHead className="text-white">Acción</TableHead><TableHead className="text-white text-right pr-8">Nivel</TableHead></TableRow></TableHeader>
                <TableBody>
                    {isLoading ? Array.from({ length: 3 }).map((_, i) => <TableRow key={i}><TableCell colSpan={4} className="py-6 pl-8"><Skeleton className="h-8 w-full" /></TableCell></TableRow>) 
                    : filteredLogs.operations.map(log => (
                        <TableRow key={log.id} className="hover:bg-primary/5 transition-colors border-b last:border-none">
                            <TableCell className="py-5 pl-8 text-[10px] font-bold text-slate-400">{log.createdAt ? format(log.createdAt.toDate(), "dd/MM HH:mm") : '...'}</TableCell>
                            <TableCell><span className="font-black text-[11px] uppercase">{log.userName}</span></TableCell>
                            <TableCell><Badge variant="outline" className="text-[9px] font-black uppercase">{log.action}</Badge></TableCell>
                            <TableCell className="text-right pr-8"><Badge className={cn("text-[9px] font-black uppercase", log.severity === 'critical' ? 'bg-rose-600' : 'bg-slate-700')}>{log.severity}</Badge></TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div></TabsContent>
      </Tabs>
    </div>
  );
}

export default function AuditPage() {
    return <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>}><AuditPageContent /></Suspense>;
}