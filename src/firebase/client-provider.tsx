'use client';

import { useEffect, ReactNode } from 'react';
import { getApps, initializeApp } from 'firebase/app';

// Configuración de Firebase.
// Asegúrate de tener tus variables de entorno configuradas en .env.local o en el panel de Firebase
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function FirebaseClientProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (getApps().length === 0) {
      initializeApp(firebaseConfig);
    }
  }, []);

  return <>{children}</>;
}