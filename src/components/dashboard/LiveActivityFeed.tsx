'use client';

import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot, getDocs } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import type { AuditLog } from '@/lib/definitions';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, ShieldAlert, Clock, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

const formatAuditAction = (action: string) => {
  const normalized = (action || '').toUpperCase();

  if (normalized.includes('MASS_PRICE_UPDATE')) {
    return {
      title: '🏷️ Actualización Masiva de Precios',
      description: 'Modificación general de precios en catálogo de productos',
      badge: 'Precios',
      badgeClass: 'bg-rose-500/20 text-rose-400 border-rose-500/30'
    };
  }
  if (normalized.includes('ROLLBACK_PRICE_UPDATE')) {
    return {
      title: '⏪ Reversión / Restauración de Precios',
      description: 'Restauración de lista de precios anterior por seguridad',
      badge: 'Seguridad',
      badgeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30'
    };
  }
  if (normalized.includes('ORDER_CREATED') || normalized.includes('NUEVO_PEDIDO')) {
    return {
      title: '📦 Creación de Nuevo Pedido',
      description: 'Registro de pedido comercial en la red',
      badge: 'Ventas',
      badgeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    };
  }
  if (normalized.includes('PAYMENT') || normalized.includes('COBRANZA')) {
    return {
      title: '💵 Registro de Cobranza en Caja',
      description: 'Ingreso efectivo de abono o liquidación de factura',
      badge: 'Cobranza',
      badgeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
    };
  }
  if (normalized.includes('STOCK') || normalized.includes('INVENTARIO')) {
    return {
      title: '🔄 Ajuste de Inventario / Stock',
      description: 'Modificación de existencias físicas en almacén',
      badge: 'Almacén',
      badgeClass: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
    };
  }
  if (normalized.includes('BCV') || normalized.includes('RATE')) {
    return {
      title: '🇻🇪 Ajuste de Tasa Oficial BCV',
      description: 'Actualización del tipo de cambio oficial de referencia',
      badge: 'Divisas',
      badgeClass: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
    };
  }

  // Fallback amigable
  const cleanTitle = (action || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, l => l.toUpperCase());

  return {
    title: `⚡ ${cleanTitle}`,
    description: `Registro operativo en el sistema`,
    badge: 'Operación',
    badgeClass: 'bg-slate-700/50 text-slate-300 border-slate-600'
  };
};

export function LiveActivityFeed() {
  const firestore = useFirestore();
  const router = useRouter();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!firestore) return;

    setIsLoading(true);
    const q = query(
      collection(firestore, 'auditLogs'),
      orderBy('createdAt', 'desc'),
      limit(5)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: AuditLog[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() } as AuditLog);
        });
        setLogs(list);
        setIsLoading(false);
      },
      async (error) => {
        console.warn("[LiveActivityFeed] onSnapshot failed. Trying fallback getDocs...", error);
        try {
          const snapshot = await getDocs(q);
          const list: AuditLog[] = [];
          snapshot.forEach((doc) => {
            list.push({ id: doc.id, ...doc.data() } as AuditLog);
          });
          setLogs(list);
          setIsLoading(false);
        } catch (fallbackError) {
          console.error("Error in getDocs fallback for live activity:", fallbackError);
          setIsLoading(false);
        }
      }
    );

    return () => unsubscribe();
  }, [firestore]);

  return (
    <Card className="border border-white/10 shadow-2xl rounded-[2.5rem] bg-slate-900 text-white overflow-hidden">
      <CardHeader className="p-8 border-b border-white/5 flex flex-row items-center justify-between">
        <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-3">
          <Activity className="h-5 w-5 animate-pulse text-primary" /> Bitácora Operativa
        </CardTitle>
        <Button
          onClick={() => router.push('/dashboard/audit')}
          variant="outline"
          className="h-8 px-3 rounded-xl border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 font-black text-[9px] uppercase tracking-wider flex items-center gap-1 shadow-sm"
        >
          <span>Audit Complete</span> <ArrowUpRight className="h-3 w-3 text-primary" />
        </Button>
      </CardHeader>

      <CardContent className="p-8 space-y-5">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-24 bg-white/10" />
              <Skeleton className="h-8 w-full bg-white/5 rounded-xl" />
            </div>
          ))
        ) : logs.length > 0 ? (
          <div className="space-y-4">
            {logs.map((log) => {
              const logDate = log.createdAt 
                ? typeof log.createdAt.toDate === 'function' 
                  ? log.createdAt.toDate() 
                  : new Date(log.createdAt as any)
                : null;

              const actionMeta = formatAuditAction(log.action);

              return (
                <div 
                  key={log.id} 
                  className="p-4 rounded-2xl bg-white/5 border border-white/5 flex flex-col gap-2 hover:bg-white/10 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black uppercase text-primary tracking-widest flex items-center gap-1.5">
                      👤 {log.userName || 'Usuario del Sistema'}
                    </span>
                    {logDate && (
                      <span className="text-[8px] font-mono text-slate-400 flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" /> {format(logDate, "dd/MM HH:mm")}
                      </span>
                    )}
                  </div>

                  <div className="space-y-0.5">
                    <p className="text-[11px] font-black text-white tracking-tight leading-snug">
                      {actionMeta.title}
                    </p>
                    <p className="text-[9px] font-medium text-slate-400">
                      {actionMeta.description}
                    </p>
                  </div>

                  <div className="flex items-center justify-between mt-1 pt-1 border-t border-white/5">
                    <span className="text-[8px] font-mono text-slate-500">
                      Módulo: {(log.resource || 'General').toUpperCase()}
                    </span>
                    <Badge 
                      variant="outline"
                      className={cn(
                        "text-[7px] font-black uppercase tracking-widest px-2 h-4 border",
                        actionMeta.badgeClass
                      )}
                    >
                      {actionMeta.badge}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-28 items-center justify-center text-slate-500 text-xs font-black uppercase border border-dashed border-white/10 rounded-2xl">
            Sin Actividad Registrada
          </div>
        )}
      </CardContent>
    </Card>
  );
}
