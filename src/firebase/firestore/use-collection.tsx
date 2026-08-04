'use client';

import { useState, useEffect } from 'react';
import {
  Query,
  onSnapshot,
  getDocs,
  DocumentData,
  FirestoreError,
  QuerySnapshot,
  CollectionReference,
} from 'firebase/firestore';
import { errorEmitter } from '../error-emitter';
import { FirestorePermissionError } from '../errors';

export type WithId<T> = T & { id: string };

export interface UseCollectionResult<T> {
  data: WithId<T>[] | null;
  isLoading: boolean;
  error: FirestoreError | Error | null;
}

/**
 * HOOK DE COLECCIÓN v2.4.0
 * Saneado: Implementa fallback automático a getDocs en caso de error de canal.
 */
export function useCollection<T = any>(
    memoizedTargetRefOrQuery: ((CollectionReference<DocumentData> | Query<DocumentData>) & {__memo?: boolean})  | null | undefined,
): UseCollectionResult<T> {
  type ResultItemType = WithId<T>;
  type StateDataType = ResultItemType[] | null;

  const [data, setData] = useState<StateDataType>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<FirestoreError | Error | null>(null);

  useEffect(() => {
    if (!memoizedTargetRefOrQuery) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    const unsubscribe = onSnapshot(
      memoizedTargetRefOrQuery,
      (snapshot: QuerySnapshot<DocumentData>) => {
        const results: ResultItemType[] = [];
        for (const doc of snapshot.docs) {
          results.push({ ...(doc.data() as T), id: doc.id });
        }
        setData(results);
        setError(null);
        setIsLoading(false);
      },
      async (err: FirestoreError) => {
        console.warn(`[useCollection] onSnapshot failed (${err.code}). Trying fallback getDocs...`, err);
        try {
          const snapshot = await getDocs(memoizedTargetRefOrQuery);
          const results: ResultItemType[] = [];
          for (const doc of snapshot.docs) {
            results.push({ ...(doc.data() as T), id: doc.id });
          }
          setData(results);
          setError(null);
          setIsLoading(false);
        } catch (fallbackErr: any) {
          console.error("[useCollection] Fallback getDocs also failed:", fallbackErr);
          if (err.code === 'permission-denied') {
              let path = "unknown/path";
              try {
                  path = memoizedTargetRefOrQuery.type === 'collection'
                      ? (memoizedTargetRefOrQuery as CollectionReference).path
                      : (memoizedTargetRefOrQuery as any)._query?.path?.canonicalString() || "query/path";
              } catch (e) {}

              const contextualError = new FirestorePermissionError({
                operation: 'list',
                path,
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
  }, [memoizedTargetRefOrQuery]);

  if(memoizedTargetRefOrQuery && !memoizedTargetRefOrQuery.__memo) {
    throw new Error('Firestore query was not properly memoized using useMemoFirebase');
  }
  return { data, isLoading, error };
}
