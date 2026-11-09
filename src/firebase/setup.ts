'use client';

import { firebaseConfig } from './config';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

/**
 * MOTOR DE CONFIGURACIÓN FIREBASE v37.0 (MODO ESTABILIDAD + AUTO LONG-POLLING)
 * Saneado: Asegura que todos los servicios compartan la misma instancia de App
 * y activa auto-detección de Long Polling para evitar cuelgues de WebChannel.
 */

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

let firestoreInstance: Firestore | null = null;

function getStableFirestore(): Firestore {
  if (firestoreInstance) return firestoreInstance;
  try {
    firestoreInstance = initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
    });
  } catch {
    firestoreInstance = getFirestore(app);
  }
  return firestoreInstance;
}

export function initializeFirebase() {
  const auth = getAuth(app);
  const firestore = getStableFirestore();
  const storage = getStorage(app);

  return {
    firebaseApp: app,
    auth,
    firestore,
    storage
  };
}
