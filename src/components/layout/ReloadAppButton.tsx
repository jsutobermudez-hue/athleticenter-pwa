'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

/**
 * Componente que permite recargar la aplicación de forma forzada.
 * Estilo adaptado para el nuevo Sidebar con degradado.
 */
export function ReloadAppButton() {
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

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleReload}
      className="h-8 w-8 text-white/60 hover:bg-white/10 hover:text-white transition-all active:rotate-180 duration-500"
      title="Recargar Aplicación"
    >
      <RefreshCw className="h-4 w-4" />
    </Button>
  );
}