
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
  if (auth.currentUser) return auth.currentUser;

  // Seguridad: sin credenciales por defecto ni accesos de respaldo (anónimo / auto-registro).
  // Las credenciales del agente deben venir SIEMPRE de variables de entorno.
  const email = process.env.FIREBASE_SERVER_EMAIL;
  const password = process.env.FIREBASE_SERVER_PASSWORD;

  if (!email || !password) {
    console.error("Critical: FIREBASE_SERVER_EMAIL / FIREBASE_SERVER_PASSWORD no configuradas.");
    throw new Error('Server agent credentials are not configured');
  }

  try {
    const res = await signInWithEmailAndPassword(auth, email, password);
    console.log("Server agent authenticated successfully.");
    return res.user;
  } catch (e: any) {
    console.error("Critical: Could not authenticate server agent:", e?.code || e?.message);
    throw e;
  }
}
