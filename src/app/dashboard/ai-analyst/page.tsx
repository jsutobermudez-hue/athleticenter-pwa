'use client';

import React, { Suspense } from 'react';
import { AIReportingHub } from '@/components/reports/AIReportingHub';
import { Loader2 } from 'lucide-react';
import { useUser } from '@/firebase';
import { useRouter } from 'next/navigation';

/**
 * PÁGINA DEL ANALISTA IA v1.2.0
 * Centro de procesamiento de lenguaje natural y reportes dinámicos.
 * Protegido: Acceso exclusivo para superadmin, gerencia y admin.
 */
export default function AIAnalystPage() {
    const { profile: currentUser, isUserLoading } = useUser();
    const router = useRouter();
    const canAccess = Boolean(currentUser && ['superadmin', 'gerencia', 'admin'].includes(currentUser.role));

    React.useEffect(() => {
        if (!isUserLoading && currentUser && !canAccess) {
            router.replace('/dashboard');
        }
    }, [currentUser, canAccess, isUserLoading, router]);

    if (isUserLoading || !currentUser || !canAccess) {
        return (
            <div className="flex h-[80vh] w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="w-full h-full animate-in fade-in duration-500">
            <Suspense fallback={
                <div className="flex h-[80vh] w-full items-center justify-center">
                    <div className="flex flex-col items-center gap-4">
                        <Loader2 className="h-12 w-12 animate-spin text-primary" />
                        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Iniciando Red Neuronal...</p>
                    </div>
                </div>
            }>
                <AIReportingHub />
            </Suspense>
        </div>
    );
}
