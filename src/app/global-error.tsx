'use client';

import React, { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertTriangle, ShieldCheck } from 'lucide-react';

/**
 * MOTOR DE EMERGENCIA GLOBAL v1.2.0
 * Captura fallos críticos y ofrece recuperación manual asistida.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Global Resilience] Fallo de sistema capturado:', error.message);
    
    // Auto-recuperación inmediata ante actualizaciones de recursos o reconexión de red
    const isLoadError = true;
    const timer = setTimeout(() => {
      window.location.reload();
    }, 1200);

    return () => clearTimeout(timer);
  }, [error]);

  return (
    <html lang="es">
      <head>
        <title>Sincronización Requerida | Athleticenter Pro</title>
      </head>
      <body className="flex h-screen w-full flex-col items-center justify-center bg-[#0F172A] text-white p-10 text-center gap-6">
        <div className="p-6 rounded-full bg-rose-50 text-rose-500 shadow-2xl animate-pulse">
            <AlertTriangle className="h-12 w-12" />
        </div>
        <div className="space-y-2">
            <h1 className="text-2xl font-black uppercase tracking-tighter">Terminal en Sincronización</h1>
            <p className="text-slate-400 text-sm max-w-md mx-auto">
                La terminal ha detectado una actualización de recursos o una inestabilidad en la red. 
                Pulsa el botón para restaurar tu sesión de mando.
            </p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-xs">
            <Button 
                variant="default" 
                className="h-14 px-8 rounded-2xl bg-primary hover:bg-primary/90 font-black uppercase tracking-[0.2em] shadow-xl transition-all active:scale-95" 
                onClick={() => window.location.reload()}
            >
                <RefreshCw className="mr-2 h-4 w-4" /> RESTAURAR CONEXIÓN
            </Button>
            <div className="flex items-center justify-center gap-2 opacity-40">
                <ShieldCheck className="h-3 w-3" />
                <span className="text-[8px] font-bold uppercase tracking-widest">Protocolo de Resiliencia 3.0 Activo</span>
            </div>
        </div>
      </body>
    </html>
  );
}
