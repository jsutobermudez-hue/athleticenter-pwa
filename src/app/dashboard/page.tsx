'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useUser } from '../../firebase/context';
import { Skeleton } from '../../components/ui/skeleton';
import { Button } from '../../components/ui/button';

import AdminDashboard from './AdminDashboard';
import SalesDashboard from './SalesDashboard';
import WarehouseDashboard from './WarehouseDashboard';
import ClientDashboard from './ClientDashboard';

/**
 * TERMINAL DE MANDO v1.6.0 (BLINDAJE DE PUBLICACIÓN)
 * Saneado: Directiva force-dynamic obligatoria para despliegue exitoso en Next.js 15.
 */
export const dynamic = 'force-dynamic';

function DashboardSkeleton() {
    return (
        <div className="space-y-10 animate-in fade-in-50 duration-500">
            <div className="space-y-2">
                <Skeleton className="h-10 w-64 rounded-xl" />
                <Skeleton className="h-4 w-96 rounded-lg opacity-50" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {[1,2,3,4].map(i => <Skeleton key={i} className="h-32 rounded-[2rem]" />)}
            </div>
        </div>
    );
}

function DashboardContent() {
    const { user, profile, isUserLoading, customerProfile } = useUser();
    const router = useRouter();

    if (isUserLoading) return <DashboardSkeleton />;

    if (!profile) {
        return (
            <div className="flex h-svh w-full flex-col items-center justify-center bg-[#0F172A] text-white p-10 text-center gap-6">
                <div className="p-8 rounded-full bg-rose-500/10 text-rose-500">
                    <AlertTriangle className="h-16 w-16" />
                </div>
                <h1 className="text-2xl font-black uppercase tracking-tighter">Identidad No Encontrada</h1>
                <p className="text-slate-400 text-sm max-w-md mx-auto">Tu cuenta de acceso no tiene un perfil vinculado en la red.</p>
                <Button className="h-14 px-8 rounded-2xl bg-white text-slate-900" onClick={() => router.push('/login')}>VOLVER AL ACCESO</Button>
            </div>
        );
    }

    if (profile.role === 'cliente' && !customerProfile) {
        return (
            <div className="flex h-svh w-full flex-col items-center justify-center bg-[#0F172A] text-white p-10 text-center gap-6">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <div className="space-y-2">
                    <h1 className="text-2xl font-black uppercase tracking-tighter">Sincronizando Cuenta B2B</h1>
                    <p className="text-slate-400 text-sm max-w-md mx-auto">Preparando su acceso corporativo...</p>
                </div>
            </div>
        );
    }

    switch(profile.role) {
        case 'cliente':
            return <ClientDashboard />;
        case 'ventas':
            return <SalesDashboard user={user} profile={profile} />;
        case 'deposito':
            return <WarehouseDashboard />;
        case 'admin':
        case 'superadmin':
        case 'gerencia':
            return <AdminDashboard />;
        default:
            return (
                <div className="flex flex-col items-center justify-center gap-6 p-10 text-center min-h-[60vh]">
                    <h1 className="text-2xl font-black uppercase">Acceso No Definido</h1>
                    <Button onClick={() => router.push('/login')}>Volver</Button>
                </div>
            );
    }
}

export default function DashboardPage() {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return (
      <div className="relative flex h-svh w-full items-center justify-center bg-[#0F172A] overflow-hidden">
        <div className="animate-in fade-in duration-1000">
            <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
    </Suspense>
  );
}