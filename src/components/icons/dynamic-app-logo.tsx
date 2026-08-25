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

interface DynamicAppLogoProps {
  className?: string;
  variant?: 'light' | 'sidebar' | 'transparent';
}

/**
 * LOGO DINÁMICO v15.1.0 (RESPONSIVE & ADAPTATIVO POR CONTEXTO)
 * Saneado: Adaptabilidad de fondo según variante (dark/sidebar vs light).
 */
export function DynamicAppLogo({ className, variant = 'light' }: DynamicAppLogoProps) {
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

  const isSidebar = variant === 'sidebar' || variant === 'transparent';

  // Si hay logo cargado, se muestra en un contenedor adaptativo
  if (companyProfile?.logoUrl && !hasError) {
    return (
      <div className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-xl shadow-xs p-1 transition-all", 
        isSidebar 
          ? "bg-white/10 border border-white/20 backdrop-blur-md" 
          : "bg-white border border-slate-100 shadow-sm",
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
    <div className={cn(
      "flex items-center justify-center p-1 rounded-xl shadow-xs transition-all", 
      isSidebar 
        ? "bg-white/10 border border-white/20 text-white backdrop-blur-md" 
        : "bg-white border border-slate-100 text-slate-900 shadow-sm",
      className || "h-10 w-10"
    )}>
      <AppLogo className={cn("w-full h-full", isSidebar ? "text-white" : "text-slate-900")} />
    </div>
  );
}
