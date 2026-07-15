'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Download, X, Smartphone, Zap } from 'lucide-react';

/**
 * BANNER DE INSTALACIÓN PWA v145.0.0
 * Saneado: Evita errores de hidratación inicializando visibilidad en false.
 */
export function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false); 

  useEffect(() => {
    // Comprobación segura tras el montaje (Client-side only)
    const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    setIsStandalone(isStandaloneMode);
    
    const alreadyDismissed = localStorage.getItem('pwa_banner_dismissed');
    if (!isStandaloneMode && !alreadyDismissed) {
        setIsVisible(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsVisible(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setIsVisible(false);
    localStorage.setItem('pwa_banner_dismissed', 'true');
  };

  if (isStandalone || !isVisible) return null;

  return (
    <div className="fixed bottom-6 left-4 right-4 z-[100] animate-in slide-in-from-bottom-10 duration-700 md:bottom-10 md:left-auto md:right-10 md:w-[400px]">
      <div className="bg-slate-900 text-white p-8 rounded-[2.5rem] shadow-2xl border border-white/10 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:scale-110 transition-transform duration-700 pointer-events-none">
            <Smartphone className="h-32 w-32" />
        </div>
        
        <button 
            onClick={handleDismiss}
            className="absolute top-6 right-6 text-white/40 hover:text-white transition-colors"
        >
            <X className="h-5 w-5" />
        </button>

        <div className="space-y-6 relative z-10">
            <div className="flex items-center gap-4">
                <div className="p-3 rounded-2xl bg-primary text-white shadow-xl shadow-primary/20 animate-pulse">
                    <Zap className="h-6 w-6" />
                </div>
                <div className="space-y-0.5">
                    <h3 className="text-lg font-black uppercase tracking-tighter">Athleticenter Pro</h3>
                    <p className="text-[9px] font-black text-primary uppercase tracking-[0.3em] leading-none">Experiencia de Alto Rendimiento</p>
                </div>
            </div>
            
            <div className="space-y-2">
                <p className="text-xs text-slate-300 leading-relaxed font-medium">
                    Instala la aplicación para acceder al catálogo <span className="text-white font-bold">sin internet</span> y recibir alertas en tiempo real.
                </p>
            </div>

            <Button 
                onClick={handleInstall}
                className="w-full h-14 bg-white text-slate-900 hover:bg-slate-100 font-black uppercase tracking-[0.2em] text-[10px] rounded-2xl shadow-2xl active:scale-95 transition-all"
            >
                INSTALAR APLICACIÓN <Download className="ml-2 h-4 w-4" />
            </Button>
            
            <p className="text-[8px] text-center font-bold text-slate-500 uppercase tracking-widest">
                SIN CONSUMO DE DATOS TRAS LA INSTALACIÓN
            </p>
        </div>
      </div>
    </div>
  );
}
