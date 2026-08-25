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

  if (!isSidebar) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleReload}
        className={cn(
          "h-8 px-2.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/80 hover:bg-blue-100 dark:hover:bg-blue-900/60 font-black text-[10px] uppercase tracking-wider flex items-center gap-1.5 shadow-2xs shrink-0 transition-all active:scale-95",
          className
        )}
        title="Sincronizar y Recargar Sistema"
      >
        <RefreshCw className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
        <span>Recargar</span>
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleReload}
      className={cn(
        "h-8 w-8 rounded-xl text-white/80 hover:bg-white/10 hover:text-white transition-all active:rotate-180 duration-500 flex items-center justify-center shrink-0",
        className
      )}
      title="Sincronizar y Recargar Sistema"
    >
      <RefreshCw className="h-4 w-4" />
    </Button>
  );
}