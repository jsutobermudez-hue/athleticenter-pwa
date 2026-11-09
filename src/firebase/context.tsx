'use client';

import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import type { FirebaseApp } from 'firebase/app';
import type { Auth, User as FirebaseAuthUser } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { doc, onSnapshot, getDoc, type Unsubscribe } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import type { User as AppUser, Customer } from '../lib/definitions';
import { FirebaseErrorListener } from '../components/FirebaseErrorListener';

/**
 * CONTEXTO MAESTRO v315.0.0
 * Sincronizado: Fallback automático a getDoc en perfil de usuario y vinculación B2B.
 */
export interface FirebaseContextState {
  firebaseApp: FirebaseApp | null;
  firestore: Firestore | null;
  auth: Auth | null;
  storage: FirebaseStorage | null;
  user: FirebaseAuthUser | null;
  profile: AppUser | null;
  customerProfile: Customer | null;
  isUserLoading: boolean;
}

export const FirebaseContext = createContext<FirebaseContextState | undefined>(undefined);

export function useFirebase() {
  const context = useContext(FirebaseContext);
  if (context === undefined) {
    throw new Error('useFirebase debe ser usado dentro de FirebaseProvider');
  }
  return context;
}

export function useAuth() {
  const context = useFirebase();
  if (!context.auth) throw new Error("Servicio de Auth no disponible");
  return context.auth;
}

export function useFirestore() {
    const context = useFirebase();
    if (!context.firestore) throw new Error("Servicio de Firestore no disponible");
    return context.firestore;
}

export function useStorage() {
    const context = useFirebase();
    if (!context.storage) throw new Error("Servicio de Storage no disponible");
    return context.storage;
}

export function useUser() {
    const context = useFirebase();
    return { 
        user: context.user, 
        profile: context.profile, 
        isUserLoading: context.isUserLoading, 
        customerProfile: context.customerProfile 
    };
}

interface FirebaseProviderProps {
  children: React.ReactNode;
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
  storage: FirebaseStorage;
}

export const FirebaseProvider: React.FC<FirebaseProviderProps> = ({
  children,
  firebaseApp,
  firestore,
  auth,
  storage,
}) => {
  const [user, setUser] = useState<FirebaseAuthUser | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [customerProfile, setCustomerProfile] = useState<Customer | null>(null);
  const [isUserLoading, setIsUserLoading] = useState(true);

  useEffect(() => {
    const unsubscribeAuth = auth.onAuthStateChanged((firebaseUser) => {
      setUser(firebaseUser);
      if (!firebaseUser) {
        setProfile(null);
        setCustomerProfile(null);
        setIsUserLoading(false);
      }
    });
    return () => unsubscribeAuth();
  }, [auth]);

  useEffect(() => {
    let unsubscribeProfile: Unsubscribe | null = null;
    let unsubscribeCustomer: Unsubscribe | null = null;
    let safetyTimeout: NodeJS.Timeout;
    let slowProfileTimeout: NodeJS.Timeout;
    let isMounted = true;
    let profileResolved = false;

    if (user && firestore) {
      const userRef = doc(firestore, 'users', user.uid);

      // FAIL-SAFE 1: Si onSnapshot tarda >1.8s, intenta getDoc directo
      slowProfileTimeout = setTimeout(async () => {
        if (profileResolved || !isMounted) return;
        try {
          const snap = await getDoc(userRef);
          if (!profileResolved && isMounted && snap.exists()) {
            profileResolved = true;
            const profileData = { id: snap.id, ...snap.data() } as AppUser;
            setProfile(profileData);
            if (profileData.role !== 'cliente') {
              setCustomerProfile(null);
              setIsUserLoading(false);
            }
          }
        } catch {}
      }, 1800);

      // FAIL-SAFE 2: Desbloqueo forzado a los 4 segundos si el servidor no responde
      safetyTimeout = setTimeout(() => {
          if (isMounted) setIsUserLoading(false);
      }, 4000);
      
      unsubscribeProfile = onSnapshot(userRef, (docSnap) => {
        if (!isMounted) return;
        profileResolved = true;
        if (docSnap.exists()) {
          const profileData = { id: docSnap.id, ...docSnap.data() } as AppUser;
          setProfile(profileData);
          
          if (profileData.role === 'cliente') {
              const targetCustomerId = profileData.associatedCustomerId || user.uid;
              const custRef = doc(firestore, 'customers', targetCustomerId);
              
              if (unsubscribeCustomer) unsubscribeCustomer();
              unsubscribeCustomer = onSnapshot(custRef, (custSnap) => {
                  if (!isMounted) return;
                  if (custSnap.exists()) {
                      setCustomerProfile({ id: custSnap.id, ...custSnap.data() } as Customer);
                  } else {
                      setCustomerProfile(null);
                  }
                  clearTimeout(safetyTimeout);
                  setIsUserLoading(false);
              }, () => {
                  clearTimeout(safetyTimeout);
                  if (isMounted) setIsUserLoading(false);
              });
          } else {
              setCustomerProfile(null);
              clearTimeout(safetyTimeout);
              setIsUserLoading(false);
          }
        } else {
          setProfile(null);
          clearTimeout(safetyTimeout);
          setIsUserLoading(false);
        }
      }, () => {
          clearTimeout(safetyTimeout);
          if (isMounted) setIsUserLoading(false);
      });
    }

    return () => {
        isMounted = false;
        if (unsubscribeProfile) unsubscribeProfile();
        if (unsubscribeCustomer) unsubscribeCustomer();
        if (safetyTimeout) clearTimeout(safetyTimeout);
        if (slowProfileTimeout) clearTimeout(slowProfileTimeout);
    };
  }, [user, firestore]);

  const contextValue = useMemo<FirebaseContextState>(() => ({
    firebaseApp,
    firestore,
    auth,
    storage,
    user,
    profile,
    customerProfile,
    isUserLoading,
  }), [firebaseApp, firestore, auth, storage, user, profile, customerProfile, isUserLoading]);

  return (
    <FirebaseContext.Provider value={contextValue}>
      <FirebaseErrorListener />
      {children}
    </FirebaseContext.Provider>
  );
};
