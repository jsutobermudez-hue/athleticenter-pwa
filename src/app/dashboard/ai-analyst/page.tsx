'use client';

import React, { Suspense } from 'react';
import { AIReportingHub } from '@/components/reports/AIReportingHub';
import { Loader2 } from 'lucide-react';

/**
 * PÁGINA DEL ANALISTA IA v1.1.0
 * Centro de procesamiento de lenguaje natural y reportes dinámicos.
 * Mejorado: Suspense robusto para evitar fallos de hidratación.
 */
export default function AIAnalystPage() {
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
