
import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

/**
 * MOTOR DE INICIALIZACIÓN DE SERVIDOR v4.1 (Resiliente)
 * Saneado: Siempre utiliza firebaseConfig para asegurar consistencia en entornos de despliegue.
 */
export function initializeFirebaseServer() {
  let app: FirebaseApp;

  if (getApps().length === 0) {
    // Forzamos el uso de firebaseConfig para evitar fallos si el entorno de Google no inyecta las credenciales automáticamente
    app = initializeApp(firebaseConfig);
  } else {
    app = getApp();
  }

  return {
    firebaseApp: app,
    auth: getAuth(app),
    firestore: getFirestore(app),
  };
}
