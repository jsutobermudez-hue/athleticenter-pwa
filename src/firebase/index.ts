'use client';

/**
 * BARRIL DE FIREBASE v30.0
 * Punto de exportación único y blindado para toda la terminal.
 */

// Exportaciones de Hooks de Datos
export { useMemoFirebase } from './firestore/use-memo-firebase';
export { useCollection } from './firestore/use-collection';
export { useDoc } from './firestore/use-doc';

// Exportaciones de Contexto y Auth (Fuente de Verdad)
export { 
  useFirebase, 
  useAuth, 
  useFirestore, 
  useStorage, 
  useUser, 
  FirebaseProvider 
} from './context';

export { FirebaseClientProvider } from './client-provider';
export { initializeFirebase } from './setup';
