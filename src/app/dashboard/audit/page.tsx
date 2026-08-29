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
import { Button } from '@/components/ui/button';
import { useCollection, useFirestore, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import type { AuditLog } from '@/lib/definitions';
import { 
    Loader2, 
    ShieldAlert, 
    Clock, 
    Activity, 
    ShieldCheck, 
    CheckCheck, 
    RefreshCw, 
    Download, 
    Filter, 
    Search, 
    User2, 
    Layers, 
    FileText,
    Sparkles,
    Eye
} from 'lucide-react';
import { format, subDays, startOfDay, isSameDay } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getHumanReadableAction, AUDIT_ACTION_TRANSLATIONS } from '@/lib/audit';
import { AuditLogDetailSheet } from './audit-log-detail-sheet';

export const dynamic = 'force-dynamic';

function AuditPageContent() {
  const { profile: currentUser, isUserLoading } = useUser();
  const router = useRouter();
  const firestore = useFirestore();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('operations');
  const [dateFilter, setDateFilter] = useState<'todos' | 'today' | '7d' | 'this_month' | 'last_month' | 'custom'>('todos');
  const [moduleFilter, setModuleFilter] = useState<string>('todos');
  const [severityFilter, setSeverityFilter] = useState<string>('todos');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedLogForSheet, setSelectedLogForSheet] = useState<AuditLog | null>(null);

  const isAdmin = currentUser && ['superadmin', 'admin', 'gerencia'].includes(currentUser.role);
  const auditQuery = useMemoFirebase(() => (firestore && isAdmin) ? query(collection(firestore, 'auditLogs'), orderBy('createdAt', 'desc'), limit(500)) : null, [firestore, isAdmin]);
  const { data: logs, isLoading } = useCollection<AuditLog>(auditQuery);

  const filteredLogs = useMemo(() => {
    if (!logs) return { operations: [], notifications: [] };
    const term = searchTerm.toLowerCase().trim();
    const now = new Date();
    const startObj = startDate ? new Date(`${startDate}T00:00:00`) : null;
    const endObj = endDate ? new Date(`${endDate}T23:59:59`) : null;

    const matchesDate = (log: AuditLog) => {
      if (dateFilter === 'todos') return true;
      if (!log.createdAt) return true;
      const lDate = typeof (log.createdAt as any).toDate === 'function' ? (log.createdAt as any).toDate() : new Date(log.createdAt as any);
      if (isNaN(lDate.getTime())) return true;

      if (dateFilter === 'custom') {
        if (startObj && !isNaN(startObj.getTime()) && lDate < startObj) return false;
        if (endObj && !isNaN(endObj.getTime()) && lDate > endObj) return false;
        return true;
      }
      if (dateFilter === 'today') return isSameDay(lDate, now);
      if (dateFilter === '7d') return lDate >= startOfDay(subDays(now, 6));
      if (dateFilter === 'this_month') return lDate.getMonth() === now.getMonth() && lDate.getFullYear() === now.getFullYear();
      if (dateFilter === 'last_month') {
        const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return lDate.getMonth() === lm.getMonth() && lDate.getFullYear() === lm.getFullYear();
      }
      return true;
    };

    const allFiltered = logs.filter(log => {
      const humanTitle = getHumanReadableAction(log.action).toLowerCase();
      const userName = (log.userName || '').toLowerCase();
      const details = (log.details || '').toLowerCase();
      const actionKey = (log.action || '').toLowerCase();

      const matchesSearch = userName.includes(term) || humanTitle.includes(term) || details.includes(term) || actionKey.includes(term);
      const matchesModule = moduleFilter === 'todos' || log.resource === moduleFilter || log.module === moduleFilter;
      const matchesSeverity = severityFilter === 'todos' || log.severity === severityFilter;

      return matchesSearch && matchesModule && matchesSeverity && matchesDate(log);
    });

    return { 
      operations: allFiltered.filter(l => l.resource !== 'notifications'), 
      notifications: allFiltered.filter(l => l.resource === 'notifications') 
    };
  }, [logs, searchTerm, dateFilter, moduleFilter, severityFilter, startDate, endDate]);

  const exportAuditToCSV = () => {
    const listToExport = activeTab === 'operations' ? filteredLogs.operations : filteredLogs.notifications;
    if (!listToExport || listToExport.length === 0) return;

    const headers = ['Fecha y Hora', 'Operario', 'Rol Operario', 'Acción Entendible', 'Clave Técnica', 'Recurso / Módulo', 'Nivel Severidad', 'Detalles Explicativos'];
    const rows = listToExport.map(log => {
      let lDateStr = '...';
      if (log.createdAt) {
        const d = typeof (log.createdAt as any).toDate === 'function' ? (log.createdAt as any).toDate() : new Date(log.createdAt as any);
        if (!isNaN(d.getTime())) lDateStr = format(d, 'yyyy-MM-dd HH:mm:ss');
      }
      return [
        lDateStr,
        `"${(log.userName || '').replace(/"/g, '""')}"`,
        `"${(log.userRole || 'Operario').replace(/"/g, '""')}"`,
        `"${getHumanReadableAction(log.action).replace(/"/g, '""')}"`,
        log.action,
        log.resource || 'sistema',
        log.severity || 'info',
        `"${(log.details || '').replace(/"/g, '""')}"`
      ];
    });

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Auditoria_Global_Athleticenter_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isUserLoading || !currentUser) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>;
  if (!isAdmin) { router.replace('/dashboard'); return null; }

  return (
    <div className="w-full max-w-[1440px] mx-auto flex flex-col gap-8 pb-32 px-4 animate-in fade-in-50 duration-500">
      {/* ENCABEZADO DE AUDITORÍA */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="terminal-header flex items-center gap-3">
            <ShieldAlert className="h-9 w-9 text-rose-600" /> Auditoría Global
          </h1>
          <p className="tech-label opacity-60">Registro maestro inmutable de operaciones y eventos de red.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            onClick={exportAuditToCSV}
            variant="outline"
            className="h-11 px-4 rounded-xl border-slate-200 bg-white hover:bg-slate-50 font-black text-xs uppercase tracking-wider text-slate-800 shadow-xs"
          >
            <Download className="h-4 w-4 mr-2 text-emerald-600" /> Exportar CSV
          </Button>
        </div>
      </header>

      {/* BARRA DE FILTROS MULTIDIMENSIONALES */}
      <div className="flex flex-col gap-4 bg-white p-5 rounded-[2rem] border border-slate-200/80 shadow-md">
        {/* FILTRO DE FECHAS */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 mr-1 flex items-center gap-1">
            <Clock className="h-3 w-3" /> Periodo:
          </span>
          {[
            { id: 'todos', label: '🌐 Todo el Histórico' },
            { id: 'today', label: '☀️ Hoy' },
            { id: '7d', label: '⚡ Últimos 7 Días' },
            { id: 'this_month', label: '🗓️ Mes Actual' },
            { id: 'last_month', label: '📅 Mes Anterior' },
            { id: 'custom', label: '📆 Rango Personalizado' },
          ].map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => setDateFilter(p.id as any)}
              className={cn(
                "px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer border",
                dateFilter === p.id 
                  ? "bg-slate-900 text-white border-slate-900 shadow-xs font-black" 
                  : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 font-bold"
              )}
            >
              {p.label}
            </button>
          ))}

          {dateFilter === 'custom' && (
            <div className="flex items-center gap-2 ml-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-8 px-2.5 bg-white border border-slate-200 rounded-xl text-[10px] font-bold text-slate-700 focus:outline-none focus:border-primary"
              />
              <span className="text-slate-400 text-xs font-bold">a</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-8 px-2.5 bg-white border border-slate-200 rounded-xl text-[10px] font-bold text-slate-700 focus:outline-none focus:border-primary"
              />
            </div>
          )}
        </div>

        {/* BÚSQUEDA Y SELECTORES DE MÓDULO Y SEVERIDAD */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
          <div className="md:col-span-2 relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input 
              placeholder="Buscar por operario, acción entendible o detalle..." 
              className="h-11 pl-10 rounded-xl bg-slate-50 border-slate-200 font-bold text-xs" 
              value={searchTerm} 
              onChange={(e) => setSearchTerm(e.target.value)} 
            />
          </div>

          <div>
            <Select value={moduleFilter} onValueChange={setModuleFilter}>
              <SelectTrigger className="h-11 rounded-xl bg-slate-50 border-slate-200 font-black text-xs text-slate-800 uppercase">
                <SelectValue placeholder="Módulo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos" className="font-bold text-xs">MÓDULO: TODOS</SelectItem>
                <SelectItem value="invoices" className="font-bold text-xs">FACTURACIÓN Y COBRANZAS</SelectItem>
                <SelectItem value="products" className="font-bold text-xs">INVENTARIO Y PRECIOS</SelectItem>
                <SelectItem value="orders" className="font-bold text-xs">PEDIDOS Y LOGÍSTICA</SelectItem>
                <SelectItem value="quotes" className="font-bold text-xs">COTIZACIONES Y PROFORMAS</SelectItem>
                <SelectItem value="users" className="font-bold text-xs">USUARIOS Y PERMISOS</SelectItem>
                <SelectItem value="system" className="font-bold text-xs">CONFIGURACIÓN Y SISTEMA</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="h-11 rounded-xl bg-slate-50 border-slate-200 font-black text-xs text-slate-800 uppercase">
                <SelectValue placeholder="Severidad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos" className="font-bold text-xs">SEVERIDAD: TODAS</SelectItem>
                <SelectItem value="critical" className="font-bold text-xs">🔴 ALERTA CRÍTICA</SelectItem>
                <SelectItem value="warning" className="font-bold text-xs">🟡 ADVERTENCIA</SelectItem>
                <SelectItem value="info" className="font-bold text-xs">🔵 INFORMACIÓN</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* PESTAÑAS Y TABLA AUDITABLE */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-4">
        <TabsList className="bg-white/70 p-1 h-12 rounded-xl shadow-xs border border-slate-200/80">
          <TabsTrigger value="operations" className="rounded-lg font-black uppercase text-[10px] px-8">
            Operaciones ({filteredLogs.operations.length})
          </TabsTrigger>
          <TabsTrigger value="notifications" className="rounded-lg font-black uppercase text-[10px] px-8">
            Alertas ({filteredLogs.notifications.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="operations" className="mt-0">
          <div className="w-full rounded-[2.2rem] border border-slate-200 bg-white overflow-hidden shadow-xl">
            <Table>
              <TableHeader className="bg-slate-900 text-white">
                <TableRow className="hover:bg-transparent border-none">
                  <TableHead className="text-white pl-8 py-4 text-[10px] font-black uppercase tracking-wider">Fecha y Hora</TableHead>
                  <TableHead className="text-white text-[10px] font-black uppercase tracking-wider">Operario</TableHead>
                  <TableHead className="text-white text-[10px] font-black uppercase tracking-wider">Acción (Entendible)</TableHead>
                  <TableHead className="text-white text-[10px] font-black uppercase tracking-wider">Módulo</TableHead>
                  <TableHead className="text-white text-right pr-8 text-[10px] font-black uppercase tracking-wider">Nivel</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={5} className="py-6 pl-8"><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                )) : filteredLogs.operations.length > 0 ? (
                  filteredLogs.operations.map(log => {
                    const humanTitle = getHumanReadableAction(log.action);
                    let lDateStr = '...';
                    if (log.createdAt) {
                      const d = typeof (log.createdAt as any).toDate === 'function' ? (log.createdAt as any).toDate() : new Date(log.createdAt as any);
                      if (!isNaN(d.getTime())) lDateStr = format(d, "dd/MM HH:mm");
                    }

                    return (
                      <TableRow 
                        key={log.id} 
                        onClick={() => setSelectedLogForSheet(log)}
                        className="hover:bg-slate-50 transition-all border-b last:border-none cursor-pointer group"
                      >
                        <TableCell className="py-4 pl-8 text-[10px] font-mono font-bold text-slate-400">
                          {lDateStr}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-black text-xs uppercase text-slate-900 group-hover:text-primary transition-colors">
                              {log.userName}
                            </span>
                            {log.userRole && (
                              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                                {log.userRole}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-black text-xs text-slate-800">
                              {humanTitle}
                            </span>
                            <span className="text-[9px] font-mono text-slate-400 truncate max-w-[280px]">
                              {log.action}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[9px] font-black uppercase tracking-wider border-slate-200 text-slate-700 bg-slate-50">
                            {log.resource ? log.resource.toUpperCase() : 'SISTEMA'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-8">
                          <Badge className={cn(
                            "text-[9px] font-black uppercase px-2.5 py-0.5",
                            log.severity === 'critical' ? 'bg-rose-600 text-white' : 
                            log.severity === 'warning' ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-white'
                          )}>
                            {log.severity}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-60 text-center flex flex-col items-center justify-center gap-3 opacity-40">
                      <ShieldCheck className="h-10 w-10 text-slate-400" />
                      <p className="text-xs font-black uppercase tracking-widest text-slate-500">Sin registros de auditoría que coincidan con el filtro.</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* SHEET DE DETALLE DE AUDITORÍA */}
      <AuditLogDetailSheet 
        log={selectedLogForSheet}
        isOpen={Boolean(selectedLogForSheet)}
        onOpenChange={(open) => !open && setSelectedLogForSheet(null)}
      />
    </div>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
      <AuditPageContent />
    </Suspense>
  );
}