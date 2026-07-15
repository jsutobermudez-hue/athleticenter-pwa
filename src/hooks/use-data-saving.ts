'use client';
import { useState, useEffect } from 'react';

/**
 * HOOK DE AHORRO DE DATOS v158.0.0
 * Saneado: Evita errores de hidratación mediante lectura diferida.
 */
export function useDataSaving() {
  const [isDataSaving, setIsDataSaving] = useState(false);

  useEffect(() => {
    // Lectura segura en el cliente
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('data_saving_mode');
        if (saved === 'true') {
            setIsDataSaving(true);
        }
    }
  }, []);

  const toggleDataSaving = (val: boolean) => {
    setIsDataSaving(val);
    if (typeof window !== 'undefined') {
        localStorage.setItem('data_saving_mode', val.toString());
    }
  };

  return { isDataSaving, toggleDataSaving };
}
