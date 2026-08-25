'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface ReloadAppButtonProps {
  className?: string;
  variant?: 'sidebar' | 'header';
}

/**
 * Componente que permite recargar la aplicación de forma forzada.
 * Estilo adaptado para el Header y Sidebar en todos los dispositivos.
 */
export function ReloadAppButton({ className, variant = 'header' }: ReloadAppButtonProps) {
  const { toast } = useToast();

  const handleReload = async () => {
    toast({
      title: "Sincronizando Sistema",
      description: "Limpiando caché PWA e instalando versión actualizada...",
    });
    
    try {
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      }
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.update();
        }
      }
    } catch (e) {
      console.warn("[PWA] Error clearing cache:", e);
    }

    setTimeout(() => {
      window.location.reload();
    }, 400);
  };

  const isSidebar = variant === 'sidebar';

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleReload}
      className={cn(
        "h-9 w-9 rounded-xl transition-all active:rotate-180 duration-500 shadow-2xs flex items-center justify-center shrink-0",
        isSidebar 
          ? "text-white/80 hover:bg-white/10 hover:text-white" 
          : "text-slate-700 dark:text-slate-200 bg-slate-100/80 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200/60 dark:border-slate-700/60",
        className
      )}
      title="Sincronizar y Recargar Sistema"
    >
      <RefreshCw className="h-4 w-4" />
    </Button>
  );
}