'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Loader2, PlusCircle } from 'lucide-react';
import type { User } from '@/lib/definitions';

type NewOrderDialogProps = {
    user?: User;
    isLoading: boolean;
}

/**
 * BOTÓN DE NUEVO PEDIDO
 * Navegación interna unificada (Terminal de Mando).
 */
export function NewOrderDialog({ isLoading }: NewOrderDialogProps) {
  return (
    <Button asChild disabled={isLoading} className="font-black uppercase tracking-widest px-8 h-12 rounded-xl shadow-xl bg-primary hover:bg-primary/90 transition-all active:scale-95">
        <Link href="/dashboard/orders/new">
            {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
                <PlusCircle className="mr-2 h-5 w-5" />
            )}
           Nuevo Pedido
        </Link>
    </Button>
  );
}
