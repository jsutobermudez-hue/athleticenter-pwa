'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Loader2, ClipboardList } from 'lucide-react';
import type { User } from '@/lib/definitions';

type NewQuoteDialogProps = {
    user?: User;
    isLoading: boolean;
}

/**
 * BOTÓN DE NUEVA COTIZACIÓN
 * Navegación interna unificada (Terminal de Mando).
 */
export function NewQuoteDialog({ isLoading }: NewQuoteDialogProps) {
  return (
    <Button asChild disabled={isLoading} className="font-black uppercase tracking-widest px-8 h-12 rounded-xl shadow-xl bg-primary hover:bg-primary/90 transition-all active:scale-95">
        <Link href="/dashboard/quotes/new">
            {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
                <ClipboardList className="mr-2 h-5 w-5" />
            )}
           Nueva Cotización
        </Link>
    </Button>
  );
}
