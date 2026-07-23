
import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
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

export async function ensureServerAuth() {
  const { auth } = initializeFirebaseServer();
  if (!auth.currentUser && process.env.FIREBASE_SERVER_EMAIL && process.env.FIREBASE_SERVER_PASSWORD) {
    try {
      await signInWithEmailAndPassword(auth, process.env.FIREBASE_SERVER_EMAIL, process.env.FIREBASE_SERVER_PASSWORD);
      console.log("Server agent authenticated successfully.");
    } catch (e: any) {
      console.error("Failed to authenticate server agent:", e.message);
    }
  }
}
