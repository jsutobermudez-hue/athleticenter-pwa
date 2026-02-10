'use client';

import React, { createContext, useContext, ReactNode, useMemo, useState, useEffect } from 'react';
import type { FirebaseApp } from 'firebase/app';
import { doc, onSnapshot, type Firestore, type Unsubscribe } from 'firebase/firestore';
import type { Auth, User as FirebaseAuthUser } from 'firebase/auth';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';
import type { User as AppUser, Customer } from '@/lib/definitions';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';

interface FirebaseContextState {
  firebaseApp: FirebaseApp | null;
  firestore: Firestore | null;
  auth: Auth | null;
  user: FirebaseAuthUser | null;
  profile: AppUser | null;
  customerProfile: Customer | null;
  isUserLoading: boolean;
}

const FirebaseContext = createContext<FirebaseContextState | undefined>(undefined);

interface FirebaseProviderProps {
  children: ReactNode;
  firebaseApp: FirebaseApp | null;
  auth: Auth | null;
  firestore: Firestore | null;
}

export function FirebaseProvider({ children, firebaseApp, auth, firestore }: FirebaseProviderProps) {
  const [user, setUser] = useState<FirebaseAuthUser | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [customerProfile, setCustomerProfile] = useState<Customer | null>(null);
  const [isUserLoading, setIsUserLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (!auth || !firestore) {
      setIsUserLoading(false);
      return;
    }

    let profileUnsubscribe: Unsubscribe | null = null;
    let customerProfileUnsubscribe: Unsubscribe | null = null;

    const authUnsubscribe = onAuthStateChanged(auth, async (newAuthUser) => {
      if (profileUnsubscribe) profileUnsubscribe();
      if (customerProfileUnsubscribe) customerProfileUnsubscribe();
      
      setUser(null);
      setProfile(null);
      setCustomerProfile(null);
      setIsUserLoading(true);

      if (newAuthUser) {
        setUser(newAuthUser);

        profileUnsubscribe = onSnapshot(
          doc(firestore, 'users', newAuthUser.uid),
          (profileSnap) => {
            if (!profileSnap.exists()) {
              console.error("CRITICAL: User profile document not found for authenticated user.", newAuthUser.uid);
              auth.signOut();
              router.replace('/login?error=profile_missing');
              return;
            }
            
            const userProfile = { id: profileSnap.id, ...profileSnap.data() } as AppUser;
            setProfile(userProfile);

            if (userProfile.role === 'cliente') {
              customerProfileUnsubscribe = onSnapshot(
                doc(firestore, 'customers', userProfile.id),
                (customerSnap) => {
                  if (customerSnap.exists()) {
                    setCustomerProfile({ id: customerSnap.id, ...customerSnap.data() } as Customer);
                  } else {
                    setCustomerProfile(null);
                  }
                  setIsUserLoading(false);
                },
                (error) => {
                  console.error("Error fetching customer profile:", error);
                  setCustomerProfile(null);
                  setIsUserLoading(false);
                }
              );
            } else {
              setCustomerProfile(null);
              setIsUserLoading(false);
            }
          },
          (error) => {
            console.error("Error fetching user profile:", error);
            setProfile(null);
            setIsUserLoading(false);
          }
        );
      } else {
        setIsUserLoading(false);
      }
    });

    return () => {
      authUnsubscribe();
      if (profileUnsubscribe) profileUnsubscribe();
      if (customerProfileUnsubscribe) customerProfileUnsubscribe();
    };
  }, [auth, firestore, router]);


  const contextValue = useMemo(() => ({
    firebaseApp,
    firestore,
    auth,
    user,
    profile,
    customerProfile,
    isUserLoading,
  }), [firebaseApp, firestore, auth, user, profile, isUserLoading, customerProfile]);

  return (
    <FirebaseContext.Provider value={contextValue}>
      <FirebaseErrorListener />
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebase() {
  const context = useContext(FirebaseContext);
  if (context === undefined) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return context;
}

export function useAuth() {
  const { auth } = useFirebase();
  if (!auth) throw new Error("Auth service not available");
  return auth;
}

export function useFirestore() {
    const { firestore } = useFirebase();
    if (!firestore) throw new Error("Firestore service not available");
    return firestore;
}

export function useUser() {
    const { user, profile, isUserLoading, customerProfile } = useFirebase();
    return { user, profile, isUserLoading, customerProfile };
}