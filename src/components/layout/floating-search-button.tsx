
'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';

/**
 * BOTÓN FLOTANTE DE BÚSQUEDA v154.0.0
 * Facilita el acceso al Omnibox en dispositivos móviles.
 */
export function FloatingSearchButton() {
  const handleOpenSearch = () => {
    window.dispatchEvent(new CustomEvent('open-global-search'));
  };

  return (
    <Button
      onClick={handleOpenSearch}
      className="fixed bottom-24 right-6 z-40 h-14 w-14 rounded-full shadow-2xl bg-slate-900 hover:bg-primary text-white border-none lg:hidden animate-in slide-in-from-bottom-10 duration-500"
      size="icon"
    >
      <Search className="h-6 w-6" />
    </Button>
  );
}
