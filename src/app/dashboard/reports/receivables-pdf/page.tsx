'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, FileWarning } from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';
import { useUser } from '@/firebase';

/**
 * Descarga autenticada del Estado de Cartera por vendedor.
 * Se usa como destino de las notificaciones del resumen semanal (la ruta /api del PDF exige sesión).
 */
export default function ReceivablesPdfPage() {
  return (
    <Suspense fallback={null}>
      <ReceivablesPdfContent />
    </Suspense>
  );
}

function ReceivablesPdfContent() {
  const params = useSearchParams();
  const { user, isUserLoading } = useUser();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isUserLoading || !user) return;
    const qs = params.toString();
    (async () => {
      try {
        const res = await authFetch(`/api/reports/salesperson-receivables-pdf${qs ? `?${qs}` : ''}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data?.error || `No se pudo generar el reporte (${res.status}).`);
          return;
        }
        const blob = await res.blob();
        window.location.replace(URL.createObjectURL(blob));
      } catch (e: any) {
        setError(e?.message || 'Error de conexión al generar el reporte.');
      }
    })();
  }, [params, user, isUserLoading]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center p-6">
      {error ? (
        <>
          <FileWarning className="h-10 w-10 text-destructive" />
          <p className="font-semibold">{error}</p>
        </>
      ) : (
        <>
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-muted-foreground">Generando Estado de Cartera…</p>
        </>
      )}
    </div>
  );
}
