'use client';

import React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
    ShieldAlert, 
    User, 
    Clock, 
    Activity, 
    FileText, 
    Database, 
    ArrowRight, 
    CheckCircle2, 
    AlertTriangle, 
    Info,
    Smartphone,
    Building2,
    Tag,
    Layers
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { AuditLog } from '@/lib/definitions';
import { getHumanReadableAction, AUDIT_ACTION_TRANSLATIONS } from '@/lib/audit';

interface AuditLogDetailSheetProps {
  log: AuditLog | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AuditLogDetailSheet({ log, isOpen, onOpenChange }: AuditLogDetailSheetProps) {
  if (!log) return null;

  const humanActionTitle = getHumanReadableAction(log.action);
  const actionMeta = AUDIT_ACTION_TRANSLATIONS[log.action];

  let logDate: Date;
  if (log.createdAt) {
    logDate = typeof (log.createdAt as any).toDate === 'function' 
      ? (log.createdAt as any).toDate() 
      : new Date(log.createdAt as any);
  } else {
    logDate = new Date();
  }

  const formattedDate = !isNaN(logDate.getTime()) ? format(logDate, "dd/MM/yyyy HH:mm:ss") : 'Fecha no disponible';

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl w-full p-0 bg-slate-50 border-l border-slate-200">
        <ScrollArea className="h-full">
          {/* ENCABEZADO DE AUDITORÍA */}
          <div className="bg-slate-900 text-white p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <Badge className={cn(
                "text-[9px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-lg",
                log.severity === 'critical' ? 'bg-rose-600 text-white' :
                log.severity === 'warning' ? 'bg-amber-500 text-slate-950' : 'bg-blue-600 text-white'
              )}>
                {log.severity === 'critical' ? '🔴 ALERTA CRÍTICA' : log.severity === 'warning' ? '🟡 ADVERTENCIA' : '🔵 INFORMACIÓN'}
              </Badge>
              <span className="text-[10px] font-mono font-bold text-slate-400 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-slate-400" /> {formattedDate}
              </span>
            </div>

            <div className="space-y-1">
              <h2 className="text-xl font-black uppercase tracking-tight text-white leading-snug">
                {humanActionTitle}
              </h2>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Layers className="h-3.5 w-3.5 text-primary" /> Recurso: <span className="text-white">{log.resource.toUpperCase()}</span>
              </p>
            </div>

            {/* FICHA DE OPERARIO */}
            <div className="p-3 bg-white/5 rounded-2xl border border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-primary/20 text-primary flex items-center justify-center font-black text-xs">
                  <User className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase text-white">{log.userName}</p>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    Operario del Sistema {log.userRole ? `• ${log.userRole.toUpperCase()}` : ''}
                  </p>
                </div>
              </div>
              <Badge variant="outline" className="text-[8px] font-black uppercase border-white/20 text-slate-300">
                ID: {log.userId?.substring(0, 8) || 'SISTEMA'}
              </Badge>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* DESCRIPCIÓN CLARA Y ENTENDIBLE */}
            <Card className="rounded-2xl border-slate-200/80 shadow-xs bg-white">
              <CardContent className="p-5 space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-slate-500" /> Resumen de la Operación
                </span>
                <p className="text-xs font-bold text-slate-800 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100">
                  {log.details || actionMeta?.description || 'Operación registrada en el libro maestro.'}
                </p>
              </CardContent>
            </Card>

            {/* METADATOS TÉCNICOS */}
            <Card className="rounded-2xl border-slate-200/80 shadow-xs bg-white">
              <CardContent className="p-5 space-y-3">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 text-slate-500" /> Metadatos Técnicos de Red
                </span>

                <div className="grid grid-cols-2 gap-3 text-[11px]">
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-[8px] font-black uppercase text-slate-400 block">Clave de Acción</span>
                    <code className="font-mono font-bold text-slate-900 text-[10px]">{log.action}</code>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <span className="text-[8px] font-black uppercase text-slate-400 block">ID del Registro Afectado</span>
                    <code className="font-mono font-bold text-slate-900 text-[10px]">{log.resourceId || 'N/A'}</code>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* DIFERENCIAL DE ESTADO (SI EXISTE ESTADO ANTERIOR vs NUEVO) */}
            {(log.previousState || log.newState) && (
              <Card className="rounded-2xl border-slate-200/80 shadow-xs bg-white">
                <CardContent className="p-5 space-y-3">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5 text-slate-500" /> Auditoría de Valores (Antes vs Después)
                  </span>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {log.previousState && (
                      <div className="p-3 rounded-xl bg-rose-50/60 border border-rose-100 space-y-1">
                        <span className="text-[9px] font-black uppercase tracking-wider text-rose-700 block">Estado Anterior</span>
                        <pre className="text-[10px] font-mono font-bold text-rose-950 overflow-x-auto whitespace-pre-wrap">
                          {typeof log.previousState === 'object' ? JSON.stringify(log.previousState, null, 2) : String(log.previousState)}
                        </pre>
                      </div>
                    )}
                    {log.newState && (
                      <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-100 space-y-1">
                        <span className="text-[9px] font-black uppercase tracking-wider text-emerald-700 block">Nuevo Estado</span>
                        <pre className="text-[10px] font-mono font-bold text-emerald-950 overflow-x-auto whitespace-pre-wrap">
                          {typeof log.newState === 'object' ? JSON.stringify(log.newState, null, 2) : String(log.newState)}
                        </pre>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
