'use client';

import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot, getDocs } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import type { AuditLog } from '@/lib/definitions';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, ShieldAlert, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

export function LiveActivityFeed() {
  const firestore = useFirestore();
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
      <CardHeader className="p-8 border-b border-white/5">
        <CardTitle className="text-xs font-black uppercase tracking-[0.3em] text-primary flex items-center gap-3">
          <Activity className="h-5 w-5 animate-pulse text-primary" /> Bitácora Operativa
        </CardTitle>
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

              return (
                <div 
                  key={log.id} 
                  className="p-4 rounded-2xl bg-white/5 border border-white/5 flex flex-col gap-2 hover:bg-white/10 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black uppercase text-primary tracking-widest">
                      {log.userName}
                    </span>
                    {logDate && (
                      <span className="text-[8px] font-mono text-slate-500 flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" /> {format(logDate, "dd/MM HH:mm")}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] font-bold text-slate-300 uppercase leading-snug">
                    {log.action}
                  </p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[8px] font-mono text-slate-600">
                      Recurso: {log.resource || 'general'}
                    </span>
                    <Badge 
                      className={cn(
                        "text-[7px] font-black uppercase tracking-widest border-none px-2 h-4",
                        log.severity === 'critical' 
                          ? 'bg-rose-500/20 text-rose-400' 
                          : 'bg-blue-500/20 text-blue-400'
                      )}
                    >
                      {log.severity || 'info'}
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
