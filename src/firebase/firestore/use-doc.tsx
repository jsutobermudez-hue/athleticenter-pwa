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
 * HOOK DE DOCUMENTO v2.5.0
 * Saneado: Implementa fallback automático a getDoc en caso de error de canal.
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

    setIsLoading(true);
    setError(null);

    const unsubscribe = onSnapshot(
      memoizedDocRef,
      (snapshot: DocumentSnapshot<DocumentData>) => {
        if (snapshot.exists()) {
          setData({ ...(snapshot.data() as T), id: snapshot.id });
        } else {
          setData(null);
        }
        setError(null);
        setIsLoading(false);
      },
      async (err: FirestoreError) => {
        console.warn(`[useDoc] onSnapshot failed (${err.code}). Trying fallback getDoc...`, err);
        try {
          const snapshot = await getDoc(memoizedDocRef);
          if (snapshot.exists()) {
            setData({ ...(snapshot.data() as T), id: snapshot.id });
          } else {
            setData(null);
          }
          setError(null);
          setIsLoading(false);
        } catch (fallbackErr: any) {
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

    return () => unsubscribe();
  }, [memoizedDocRef]);

  return { data, isLoading, error };
}
