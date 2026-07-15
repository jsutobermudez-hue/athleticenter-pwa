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

  const handleReload = () => {
    toast({
      title: "Recargando sistema",
      description: "Sincronizando datos y refrescando sesión...",
    });
    
    setTimeout(() => {
      window.location.reload();
    }, 600);
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