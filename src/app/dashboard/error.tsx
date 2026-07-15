'use client';

import React, { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, CloudOff, ShieldCheck } from 'lucide-react';

/**
 * GESTOR DE ERRORES DE RUTA v1.1.0
 * Captura fallos de carga en sub-rutas y ofrece recuperación local inmediata.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Si es un error de carga de fragmento, forzamos recarga total
    if (error.message.toLowerCase().includes('chunk')) {
        window.location.reload();
    }
  }, [error]);

  return (
    <div className="flex h-[80vh] w-full flex-col items-center justify-center p-10 text-center gap-6 animate-in fade-in duration-700">
        <div className="p-6 rounded-full bg-amber-50 text-amber-500 shadow-xl shadow-amber-500/10">
            <CloudOff className="h-12 w-12" />
        </div>
        <div className="space-y-2">
            <h1 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Sincronización Interrumpida</h1>
            <p className="text-slate-500 text-sm max-w-md mx-auto font-medium">
                No pudimos cargar esta sección de la terminal debido a una actualización del servidor o fallo de red.
            </p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-xs">
            <Button 
                variant="default" 
                className="h-14 px-8 rounded-2xl bg-slate-900 hover:bg-primary font-black uppercase tracking-[0.2em] shadow-xl transition-all active:scale-95" 
                onClick={() => reset()}
            >
                <RefreshCw className="mr-2 h-4 w-4" /> REINTENTAR CARGA
            </Button>
            <div className="flex items-center justify-center gap-2 opacity-40">
                <ShieldCheck className="h-2 w-2" />
                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">
                    ID DE DIAGNÓSTICO: {error.digest || 'LOCAL_SYNC_ERR'}
                </span>
            </div>
        </div>
    </div>
  );
}
