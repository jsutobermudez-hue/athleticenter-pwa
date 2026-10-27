'use client';

import React, { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertTriangle, ShieldCheck, Home } from 'lucide-react';

/**
 * MOTOR DE EMERGENCIA GLOBAL v1.3.0
 * Captura fallos críticos sin bucles de recarga infinitos.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Global Resilience] Fallo de sistema capturado:', error?.message || error);
  }, [error]);

  return (
    <html lang="es">
      <head>
        <title>Sincronización Requerida | Athleticenter Pro</title>
      </head>
      <body className="flex h-screen w-full flex-col items-center justify-center bg-[#0F172A] text-white p-10 text-center gap-6">
        <div className="p-6 rounded-full bg-rose-500/10 text-rose-500 shadow-2xl animate-pulse">
            <AlertTriangle className="h-12 w-12" />
        </div>
        <div className="space-y-2">
            <h1 className="text-2xl font-black uppercase tracking-tighter">Terminal en Sincronización</h1>
            <p className="text-slate-400 text-sm max-w-md mx-auto">
                La terminal ha detectado un evento inesperado. 
                Puedes reiniciar la vista o volver al panel principal.
            </p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-xs">
            <Button 
                variant="default" 
                className="h-14 px-8 rounded-2xl bg-primary hover:bg-primary/90 font-black uppercase tracking-[0.2em] shadow-xl transition-all active:scale-95" 
                onClick={() => reset ? reset() : window.location.reload()}
            >
                <RefreshCw className="mr-2 h-4 w-4" /> REINTENTAR VISTA
            </Button>
            <Button 
                variant="outline" 
                className="h-12 px-6 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-black uppercase text-xs tracking-wider border-white/20 transition-all" 
                onClick={() => { window.location.href = '/dashboard'; }}
            >
                <Home className="mr-2 h-4 w-4" /> VOLVER AL PANEL
            </Button>
            <div className="flex items-center justify-center gap-2 opacity-40 pt-2">
                <ShieldCheck className="h-3 w-3" />
                <span className="text-[8px] font-bold uppercase tracking-widest">Protocolo de Resiliencia 3.1 Activo</span>
            </div>
        </div>
      </body>
    </html>
  );
}
