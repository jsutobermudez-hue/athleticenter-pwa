'use client';

import React, { Suspense } from 'react';
import { useUser } from '@/firebase';
import { Loader2 } from 'lucide-react';
import { AdminBillingView } from './AdminBillingView';
import { ClientBillingView } from './ClientBillingView';

export const dynamic = 'force-dynamic';

/**
 * PÁGINA DE FACTURACIÓN v4.0.0 - BLINDAJE DE PRODUCCIÓN
 * Saneado: Uso de Suspense de alto nivel para asegurar la compilación en Next.js 15.
 */
function LoadingScreen() {
    return (
        <div className="flex h-[80vh] w-full items-center justify-center">
            <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Sincronizando Finanzas...</p>
            </div>
        </div>
    );
}

function BillingContent() {
  const { profile: currentUser, isUserLoading } = useUser();

  if (isUserLoading || !currentUser) {
    return <LoadingScreen />;
  }

  if (currentUser.role === 'cliente') {
    return <ClientBillingView />;
  }
  
  return <AdminBillingView />;
}

export default function BillingPage() {
    return (
        <div className="w-full h-full">
            <Suspense fallback={<LoadingScreen />}>
                <BillingContent />
            </Suspense>
        </div>
    );
}