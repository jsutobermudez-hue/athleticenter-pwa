'use client';
import { useMemo } from 'react';

/**
 * A wrapper around React's `useMemo` hook that adds a `__memo` property
 * to the resulting object. This is used by `useCollection` and `useDoc` to
 * enforce that Firestore queries and references are memoized, preventing
 * infinite re-renders.
 *
 * @template T The type of the value to be memoized.
 * @param {() => T} factory The function that computes the value.
 * @param {React.DependencyList | undefined} deps The dependency array for `useMemo`.
 * @returns {T} The memoized value.
 */
export function useMemoFirebase<T>(factory: () => T, deps: React.DependencyList | undefined): T {
  const result = useMemo(factory, deps);

  // Attach a flag to the memoized object.
  // This is a "trick" to allow our custom hooks to verify that their inputs
  // have been properly memoized.
  if (result) {
    (result as any).__memo = true;
  }
  return result;
}
