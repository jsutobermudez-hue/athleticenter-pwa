'use client';
    
import { useState, useEffect } from 'react';
import {
  DocumentReference,
  onSnapshot,
  getDoc,
  DocumentData,
  FirestoreError,
  DocumentSnapshot,
} from 'firebase/firestore';
import { errorEmitter } from '../error-emitter';
import { FirestorePermissionError } from '../errors';

type WithId<T> = T & { id: string };

export interface UseDocResult<T> {
  data: WithId<T> | null;
  isLoading: boolean;
  error: FirestoreError | Error | null;
}

/**
 * HOOK DE DOCUMENTO v2.6.0
 * Saneado: Implementa fallback automático a getDoc en caso de error de canal
 * o latencia prolongada (>2.2s), con desbloqueo garantizado de isLoading.
 */
export function useDoc<T = any>(
  memoizedDocRef: DocumentReference<DocumentData> | null | undefined,
): UseDocResult<T> {
  const [data, setData] = useState<WithId<T> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(!!memoizedDocRef);
  const [error, setError] = useState<FirestoreError | Error | null>(null);

  useEffect(() => {
    if (!memoizedDocRef) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    let isMounted = true;
    let hasResolved = false;

    setIsLoading(true);
    setError(null);

    const applyDoc = (snapshot: DocumentSnapshot<DocumentData>) => {
      if (!isMounted) return;
      hasResolved = true;
      if (snapshot.exists()) {
        setData({ ...(snapshot.data() as T), id: snapshot.id });
      } else {
        setData(null);
      }
      setError(null);
      setIsLoading(false);
    };

    const slowStreamTimer = setTimeout(async () => {
      if (hasResolved || !isMounted) return;
      try {
        const snapshot = await getDoc(memoizedDocRef);
        if (!hasResolved && isMounted) {
          applyDoc(snapshot);
        }
      } catch {
        // Ignorado; manejado por hardUnlockTimer
      }
    }, 2200);

    const hardUnlockTimer = setTimeout(() => {
      if (!hasResolved && isMounted) {
        setIsLoading(false);
      }
    }, 3500);

    const unsubscribe = onSnapshot(
      memoizedDocRef,
      (snapshot: DocumentSnapshot<DocumentData>) => {
        applyDoc(snapshot);
      },
      async (err: FirestoreError) => {
        console.warn(`[useDoc] onSnapshot failed (${err.code}). Trying fallback getDoc...`, err);
        try {
          const snapshot = await getDoc(memoizedDocRef);
          applyDoc(snapshot);
        } catch (fallbackErr: any) {
          if (!isMounted) return;
          hasResolved = true;
          console.error("[useDoc] Fallback getDoc also failed:", fallbackErr);
          if (err.code === 'permission-denied') {
              const contextualError = new FirestorePermissionError({
                operation: 'get',
                path: memoizedDocRef.path,
              });
              setError(contextualError);
              errorEmitter.emit('permission-error', contextualError);
          } else {
              setError(err);
          }
          setData(null);
          setIsLoading(false);
        }
      }
    );

    return () => {
      isMounted = false;
      clearTimeout(slowStreamTimer);
      clearTimeout(hardUnlockTimer);
      unsubscribe();
    };
  }, [memoizedDocRef]);

  return { data, isLoading, error };
}
