'use client';

import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { format, startOfDay, subDays, isSameDay } from 'date-fns';
import { useCollection, useFirestore, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import { authFetch } from '@/lib/auth-fetch';
import { useToast } from '@/hooks/use-toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  CheckCircle2,
  XCircle,
  Search,
  Eye,
  RefreshCw,
  FileSpreadsheet,
  Paperclip,
  Loader2,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface OutboundLog {
  id: string;
  phone: string;
  recipientName?: string;
  recipientType?: 'cliente' | 'equipo' | 'tercero';
  module?: string;
  orderId?: string | null;
  quoteId?: string | null;
  campaignId?: string | null;
  text: string;
  hasMedia?: boolean;
  mediaType?: 'none' | 'pdf' | 'image' | 'video';
  fileName?: string | null;
  senderName?: string;
  senderRole?: string;
  source?: 'manual' | 'auto' | 'campaign' | 'commander';
  status: 'sent' | 'failed';
  provider?: string | null;
  messageId?: string | null;
  error?: string | null;
  createdAt?: any;
}

const MODULE_LABELS: Record<string, string> = {
  orders: 'Pedidos',
  billing: 'Pagos y Recibos',
  treasury: 'Cobranza / Tesorería',
  clients: 'Clientes / Estado de Cuenta',
  quotes: 'Cotizaciones',
  dispatch: 'Despacho y Guías',
  marketing: 'Marketing / Campañas',
  inventory: 'Inventario',
};

function toJsDate(raw: any): Date | null {
  if (!raw) return null;
  if (typeof raw?.toDate === 'function') return raw.toDate();
  if (raw?._seconds) return new Date(raw._seconds * 1000);
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

export function WhatsAppHistoryPanel() {
  const firestore = useFirestore();
  const { toast } = useToast();

  const logsQuery = useMemoFirebase(
    () => (firestore ? query(collection(firestore, 'whatsapp_outbound_logs'), orderBy('createdAt', 'desc'), limit(300)) : null),
    [firestore]
  );
  const { data: logs, isLoading } = useCollection<OutboundLog>(logsQuery);

  const [searchTerm, setSearchTerm] = useState('');
  const [moduleFilter, setModuleFilter] = useState('todos');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'sent' | 'failed'>('todos');
  const [typeFilter, setTypeFilter] = useState<'todos' | 'cliente' | 'equipo' | 'tercero'>('todos');
  const [dateFilter, setDateFilter] = useState<'todos' | 'today' | '7d' | 'this_month'>('todos');
  const [selectedLog, setSelectedLog] = useState<OutboundLog | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const filteredLogs = useMemo(() => {
    const list = logs || [];
    const term = searchTerm.toLowerCase().trim();
    const now = new Date();
    const sevenDaysAgo = startOfDay(subDays(now, 6));

    return list.filter((l) => {
      if (moduleFilter !== 'todos' && (l.module || 'orders') !== moduleFilter) return false;
      if (statusFilter !== 'todos' && l.status !== statusFilter) return false;
      if (typeFilter !== 'todos' && (l.recipientType || 'cliente') !== typeFilter) return false;

      if (dateFilter !== 'todos') {
        const d = toJsDate(l.createdAt);
        if (d) {
          if (dateFilter === 'today' && !isSameDay(d, now)) return false;
          if (dateFilter === '7d' && d < sevenDaysAgo) return false;
          if (dateFilter === 'this_month' && (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear())) return false;
        }
      }

      if (term) {
        const hay = `${l.phone} ${l.recipientName || ''} ${l.orderId || ''} ${l.quoteId || ''} ${l.senderName || ''} ${l.text || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [logs, searchTerm, moduleFilter, statusFilter, typeFilter, dateFilter]);

  const metrics = useMemo(() => {
    const total = filteredLogs.length;
    const sent = filteredLogs.filter((l) => l.status === 'sent').length;
    const failed = filteredLogs.filter((l) => l.status === 'failed').length;
    const withMedia = filteredLogs.filter((l) => l.hasMedia).length;
    const rate = total > 0 ? Math.round((sent / total) * 100) : 100;
    return { total, sent, failed, withMedia, rate };
  }, [filteredLogs]);

  const handleResend = async (log: OutboundLog) => {
    if (!log.phone || log.phone.includes('destinatarios')) {
      toast({ variant: 'destructive', title: 'No reenviable directamente', description: 'Las difusiones masivas se reenvían desde Historial Difusiones.' });
      return;
    }
    setResendingId(log.id);
    try {
      const res = await authFetch('/api/whatsapp-gateway', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          number: log.phone,
          text: log.text,
          module: log.module || 'orders',
          orderId: log.orderId || undefined,
          quoteId: log.quoteId || undefined,
          recipientName: log.recipientName || undefined,
          recipientType: log.recipientType || 'cliente',
        }),
      });
      const data = await res.json();
      if (data?.success) {
        toast({ title: '✅ Mensaje reenviado', description: `Despachado nuevamente a +${log.phone}` });
      } else {
        toast({ variant: 'destructive', title: 'No se pudo reenviar', description: data?.error || 'Gateway sin conexión.' });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e?.message || 'Fallo de red.' });
    } finally {
      setResendingId(null);
    }
  };

  const handleExportExcel = () => {
    if (filteredLogs.length === 0) return;
    const rows = filteredLogs.map((l) => {
      const d = toJsDate(l.createdAt);
      return {
        'Fecha y Hora': d ? format(d, 'dd/MM/yyyy HH:mm') : '-',
        Estado: l.status === 'sent' ? 'Enviado' : 'Falló',
        Teléfono: l.phone,
        Destinatario: l.recipientName || '-',
        Tipo: l.recipientType || 'cliente',
        Módulo: MODULE_LABELS[l.module || ''] || l.module || '-',
        Referencia: l.orderId ? `#${l.orderId.slice(0, 8)}` : l.quoteId ? `#${l.quoteId.slice(0, 8)}` : '-',
        Adjunto: l.hasMedia ? `${(l.mediaType || 'archivo').toUpperCase()}${l.fileName ? ` (${l.fileName})` : ''}` : 'Solo texto',
        Remitente: l.senderName || 'Sistema',
        Mensaje: l.text,
        Error: l.error || '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 18 }, { wch: 10 }, { wch: 16 }, { wch: 24 }, { wch: 10 },
      { wch: 22 }, { wch: 14 }, { wch: 20 }, { wch: 20 }, { wch: 55 }, { wch: 25 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Historial WhatsApp');
    XLSX.writeFile(wb, `Historial_WhatsApp_Athleticenter_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast({ title: 'Excel descargado', description: `${filteredLogs.length} registros exportados.` });
  };

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 rounded-2xl border-none shadow-sm bg-slate-900 text-white">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Mensajes Registrados</p>
          <p className="text-3xl font-black mt-1">{metrics.total}</p>
        </Card>
        <Card className="p-5 rounded-2xl border-none shadow-sm bg-emerald-600 text-white">
          <p className="text-[9px] font-black uppercase tracking-widest text-emerald-100">Tasa de Entrega</p>
          <p className="text-3xl font-black mt-1">{metrics.rate}%</p>
          <p className="text-[10px] font-semibold text-emerald-100">{metrics.sent} enviados</p>
        </Card>
        <Card className="p-5 rounded-2xl border-none shadow-sm bg-white border border-slate-200">
          <p className="text-[9px] font-black uppercase tracking-widest text-rose-500">Fallidos</p>
          <p className="text-3xl font-black text-rose-600 mt-1">{metrics.failed}</p>
        </Card>
        <Card className="p-5 rounded-2xl border-none shadow-sm bg-white border border-slate-200">
          <p className="text-[9px] font-black uppercase tracking-widest text-blue-500">Con Adjunto (PDF / Media)</p>
          <p className="text-3xl font-black text-blue-600 mt-1">{metrics.withMedia}</p>
        </Card>
      </div>

      {/* Filtros */}
      <Card className="p-5 rounded-3xl border border-slate-200/80 shadow-sm bg-white space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'todos', label: 'Todo' },
              { id: 'today', label: 'Hoy' },
              { id: '7d', label: '7 días' },
              { id: 'this_month', label: 'Este mes' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setDateFilter(p.id as any)}
                className={cn(
                  'px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border cursor-pointer transition-all',
                  dateFilter === p.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={filteredLogs.length === 0}
            onClick={handleExportExcel}
            className="h-9 px-4 rounded-xl border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 font-black uppercase text-[10px]"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" /> Exportar Excel
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar cliente, teléfono, #pedido o texto del mensaje..."
              className="h-10 pl-9 rounded-xl bg-slate-50 text-xs font-medium"
            />
          </div>
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="h-10 rounded-xl bg-slate-50 text-xs font-bold">
              <SelectValue placeholder="Módulo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los módulos</SelectItem>
              {Object.entries(MODULE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="h-10 rounded-xl bg-slate-50 text-xs font-bold">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              <SelectItem value="sent">Solo Enviados ✅</SelectItem>
              <SelectItem value="failed">Solo Fallidos ❌</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
            <SelectTrigger className="h-10 rounded-xl bg-slate-50 text-xs font-bold">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Clientes + Equipo</SelectItem>
              <SelectItem value="cliente">Solo Clientes</SelectItem>
              <SelectItem value="equipo">Solo Equipo Interno</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Tabla */}
      <Card className="rounded-3xl border border-slate-200/80 shadow-sm bg-white overflow-hidden">
        {isLoading ? (
          <div className="p-12 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-12 text-center space-y-2 text-slate-400">
            <MessageSquare className="h-10 w-10 mx-auto opacity-40" />
            <p className="text-xs font-black uppercase tracking-widest">
              Aún no hay mensajes salientes registrados con estos filtros
            </p>
            <p className="text-[11px]">
              Cada nuevo mensaje enviado desde la app, crons o campañas quedará auditado aquí automáticamente.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest">
                <tr>
                  <th className="p-3.5">Fecha</th>
                  <th className="p-3.5">Estado</th>
                  <th className="p-3.5">Destinatario / Teléfono</th>
                  <th className="p-3.5">Módulo</th>
                  <th className="p-3.5">Mensaje</th>
                  <th className="p-3.5">Enviado Por</th>
                  <th className="p-3.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLogs.map((log) => {
                  const d = toJsDate(log.createdAt);
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 whitespace-nowrap font-mono text-[11px] text-slate-500">
                        {d ? format(d, 'dd/MM/yy HH:mm') : 'Reciente'}
                      </td>
                      <td className="p-3.5 whitespace-nowrap">
                        {log.status === 'sent' ? (
                          <Badge className="bg-emerald-100 text-emerald-800 border-none text-[9px] font-black uppercase">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Enviado
                          </Badge>
                        ) : (
                          <Badge className="bg-rose-100 text-rose-800 border-none text-[9px] font-black uppercase" title={log.error || ''}>
                            <XCircle className="h-3 w-3 mr-1" /> Falló
                          </Badge>
                        )}
                      </td>
                      <td className="p-3.5">
                        <p className="font-bold text-slate-900">{log.recipientName || 'Destinatario'}</p>
                        <p className="text-[10px] font-mono text-slate-500">+{log.phone}</p>
                      </td>
                      <td className="p-3.5 whitespace-nowrap">
                        <Badge variant="outline" className="text-[9px] font-black uppercase">
                          {MODULE_LABELS[log.module || ''] || log.module || 'General'}
                        </Badge>
                        {log.hasMedia && (
                          <span className="ml-1.5 inline-flex items-center text-[9px] font-bold text-blue-600">
                            <Paperclip className="h-3 w-3 mr-0.5" /> {(log.mediaType || 'PDF').toUpperCase()}
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 max-w-xs">
                        <p className="text-slate-700 line-clamp-2">{log.text}</p>
                      </td>
                      <td className="p-3.5 whitespace-nowrap text-[11px] text-slate-600 font-medium">
                        {log.senderName || 'Sistema'}
                      </td>
                      <td className="p-3.5 text-right whitespace-nowrap space-x-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedLog(log)}
                          className="h-8 px-2.5 rounded-xl text-[9px] font-black uppercase"
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" /> Ver
                        </Button>
                        {!log.phone.includes('destinatarios') && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={resendingId === log.id}
                            onClick={() => handleResend(log)}
                            className="h-8 px-2.5 rounded-xl text-[9px] font-black uppercase border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                          >
                            {resendingId === log.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                            Reenviar
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modal Burbuja WhatsApp */}
      <Dialog open={Boolean(selectedLog)} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-lg rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="text-base font-black uppercase">Mensaje Enviado por WhatsApp</DialogTitle>
            <DialogDescription className="text-xs">
              Para: <strong>{selectedLog?.recipientName || `+${selectedLog?.phone}`}</strong> (+{selectedLog?.phone})
            </DialogDescription>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-3">
              <div className="p-4 rounded-2xl bg-[#ECE5DD] border border-slate-200">
                <div className="bg-white rounded-2xl rounded-tl-none p-4 shadow-sm text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                  {selectedLog.hasMedia && (
                    <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-slate-100 text-[10px] font-bold text-slate-600 flex items-center gap-1.5">
                      <Paperclip className="h-3.5 w-3.5 text-blue-600" />
                      Adjunto {(selectedLog.mediaType || 'archivo').toUpperCase()}: {selectedLog.fileName || 'Archivo multimedia'}
                    </div>
                  )}
                  {selectedLog.text}
                </div>
              </div>
              {selectedLog.error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium">
                  <strong>Motivo del fallo:</strong> {selectedLog.error}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSelectedLog(null)} className="rounded-xl text-xs font-bold">
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
