'use client';

/**
 * ARCHIVO OBSOLETO - ELIMINAR O IGNORAR
 * La lógica de useUser ha sido unificada en src/firebase/provider.tsx para 
 * evitar conflictos de estado y bloqueos de hidratación.
 */
export function useUser() {
    throw new Error("useUser debe importarse desde '@/firebase' (vía provider.tsx)");
}
