
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

  const email = process.env.FIREBASE_SERVER_EMAIL || 'server-agent1@athleticenter.com';
  const password = process.env.FIREBASE_SERVER_PASSWORD || '123456';

  try {
    const res = await signInWithEmailAndPassword(auth, email, password);
    console.log("Server agent authenticated successfully.");
    return res.user;
  } catch (e: any) {
    console.warn("Server auth signin failed, attempting signup/fallback:", e.message);
    try {
      const { createUserWithEmailAndPassword, signInAnonymously } = await import('firebase/auth');
      const createRes = await createUserWithEmailAndPassword(auth, email, password);
      return createRes.user;
    } catch (createErr: any) {
      try {
        const { signInAnonymously } = await import('firebase/auth');
        const anonRes = await signInAnonymously(auth);
        return anonRes.user;
      } catch (anonErr) {
        console.error("Critical: Could not authenticate server agent:", anonErr);
      }
    }
  }
}
