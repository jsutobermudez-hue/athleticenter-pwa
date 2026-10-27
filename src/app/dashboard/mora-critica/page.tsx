'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

/**
 * REDIRECCIÓN OFICIAL: MÓDULO DE MORA CRÍTICA
 * Conduce de forma transparente a la vista de Facturación filtrada por expedientes vencidos.
 */
export default function MoraCriticaRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard/billing?status=Vencido');
  }, [router]);

  return (
    <div className="flex h-[80vh] w-full items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-rose-500" />
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
          Cargando Módulo de Mora Crítica...
        </p>
      </div>
    </div>
  );
}
