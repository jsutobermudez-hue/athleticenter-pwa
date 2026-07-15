'use client';

import React, { useMemo, type ReactNode } from 'react';
import { FirebaseProvider } from './context';
import { initializeFirebase } from './setup';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

/**
 * PROVEEDOR DE CLIENTE v1.5.0
 * Sincronizado: Utiliza el motor de setup independiente para evitar fallos de resolución de módulos.
 */
export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  const firebaseServices = useMemo(() => {
    return initializeFirebase();
  }, []);

  return (
    <FirebaseProvider
      firebaseApp={firebaseServices.firebaseApp}
      auth={firebaseServices.auth}
      firestore={firebaseServices.firestore}
      storage={firebaseServices.storage}
    >
      {children}
    </FirebaseProvider>
  );
}
