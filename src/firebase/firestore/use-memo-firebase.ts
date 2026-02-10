'use client';
import { useMemo, DependencyList } from 'react';

export function useMemoFirebase<T>(factory: () => T, deps: DependencyList | undefined): T {
  const result = useMemo(factory, deps || []);

  if (result) {
    (result as any).__memo = true;
  }
  return result;
}