'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Compass, Home, ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-[#0F172A] text-white p-8 text-center gap-6">
      <div className="p-6 rounded-3xl bg-blue-500/10 text-blue-400 border border-blue-500/20 shadow-2xl">
        <Compass className="h-16 w-16 animate-spin-slow" />
      </div>
      <div className="space-y-2 max-w-md">
        <span className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-400">Error 404</span>
        <h1 className="text-3xl font-black uppercase tracking-tight">Módulo No Encontrado</h1>
        <p className="text-slate-400 text-xs leading-relaxed">
          La ruta solicitada no existe o fue reubicada en una versión reciente del sistema.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs sm:max-w-md justify-center pt-2">
        <Button
          asChild
          className="h-12 px-6 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black uppercase text-xs tracking-wider shadow-lg"
        >
          <Link href="/dashboard">
            <Home className="mr-2 h-4 w-4" /> Panel Principal
          </Link>
        </Button>
        <Button
          asChild
          variant="outline"
          className="h-12 px-6 rounded-2xl bg-white/10 hover:bg-white/20 text-white border-white/20 font-black uppercase text-xs tracking-wider"
        >
          <Link href="/dashboard/billing?status=Vencido">
            Mora y Cobranzas
          </Link>
        </Button>
      </div>
    </div>
  );
}
