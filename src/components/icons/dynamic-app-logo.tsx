'use client';

import React, { useState, useEffect } from 'react';
import { useDoc, useFirestore, useMemoFirebase } from '../../firebase';
import { doc } from 'firebase/firestore';
import { AppLogo } from './app-logo';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../../lib/utils';

interface CompanyProfile {
  id?: string;
  logoUrl?: string;
  logoFit?: 'contain' | 'cover';
}

/**
 * LOGO DINÁMICO v15.0.0 (ULTRA RESILIENTE & ADAPTATIVO)
 * Saneado: Fondo blanco forzado y ajuste 'contain' para preservar la integridad de marca.
 */
export function DynamicAppLogo({ className }: { className?: string }) {
  const firestore = useFirestore();
  const [hasError, setHasError] = useState(false);
  
  const companyProfileRef = useMemoFirebase(() => 
    firestore ? doc(firestore, 'companyProfile', 'main') : null, 
  [firestore]);
  
  const { data: companyProfile, isLoading: isLoadingProfile } = useDoc<CompanyProfile>(companyProfileRef);

  useEffect(() => {
    if (companyProfile?.logoUrl) {
        setHasError(false);
    }
  }, [companyProfile?.logoUrl]);

  if (isLoadingProfile) {
    return <Skeleton className={cn("rounded-xl bg-slate-200/50 h-10 w-10", className)} />;
  }

  // Si hay logo cargado, se muestra en un contenedor blanco adaptativo
  if (companyProfile?.logoUrl && !hasError) {
    return (
      <div className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm border border-slate-100 p-1", 
        className || "h-10 w-10"
      )}>
        <img 
          src={companyProfile.logoUrl} 
          alt="Athleticenter Logo" 
          className="w-full h-full object-contain"
          loading="eager"
          onError={() => setHasError(true)}
        />
      </div>
    );
  }

  // Fallback al logo SVG original si no hay personalización
  return (
    <div className={cn("flex items-center justify-center p-1 bg-white rounded-xl shadow-sm border border-slate-100", className || "h-10 w-10")}>
        <AppLogo className="h-full w-full" />
    </div>
  );
}
