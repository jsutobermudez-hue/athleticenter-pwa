'use client';
/**
 * fetch autenticado desde el navegador: adjunta el Firebase ID token del usuario actual.
 * Usar para llamar a rutas /api protegidas.
 */
import { getAuth } from 'firebase/auth';

export async function getCurrentIdToken(): Promise<string | null> {
  try {
    const user = getAuth().currentUser;
    return user ? await user.getIdToken() : null;
  } catch {
    return null;
  }
}

export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await getCurrentIdToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

/** Abre en pestaña nueva una ruta protegida que devuelve un archivo (PDF), pasando el token por URL. */
export async function openAuthenticatedUrl(path: string): Promise<void> {
  const token = await getCurrentIdToken();
  const sep = path.includes('?') ? '&' : '?';
  window.open(`${path}${token ? `${sep}idToken=${encodeURIComponent(token)}` : ''}`, '_blank');
}
