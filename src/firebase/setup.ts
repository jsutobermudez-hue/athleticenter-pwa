'use client';

import { firebaseConfig } from './config';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

/**
 * MOTOR DE CONFIGURACIÓN FIREBASE v36.0 (MODO ESTABILIDAD)
 * Saneado: Asegura que todos los servicios compartan la misma instancia de App
 * para que el token de autenticación se propague correctamente a Storage.
 */

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export function initializeFirebase() {
  const auth = getAuth(app);
  const firestore = getFirestore(app);
  const storage = getStorage(app);

  return {
    firebaseApp: app,
    auth,
    firestore,
    storage
  };
}
