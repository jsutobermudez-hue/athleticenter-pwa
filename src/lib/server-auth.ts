/**
 * ATHLETICENTER PRO — AUTORIZACIÓN DE SERVIDOR
 *
 * Toda ruta API / server action sensible debe pasar por aquí.
 * Acepta dos tipos de credencial:
 *   1. Interna (procesos automáticos, São Paulo, crons): `Authorization: Bearer <CRON_SECRET>`
 *   2. Usuario (navegador): `Authorization: Bearer <Firebase ID token>`; el rol se lee de users/{uid}.
 *
 * Falla cerrado: si CRON_SECRET no está configurado, ninguna petición interna es aceptada.
 */
import { timingSafeEqual } from 'crypto';
import { doc, getDoc } from 'firebase/firestore';
import { firebaseConfig } from '@/firebase/config';
import { initializeFirebaseServer, ensureServerAuth } from '@/firebase/server-init';

export type AppRole = 'superadmin' | 'gerencia' | 'admin' | 'ventas' | 'deposito' | 'cliente';

export const MANAGER_ROLES: AppRole[] = ['superadmin', 'gerencia', 'admin'];
export const STAFF_ROLES: AppRole[] = ['superadmin', 'gerencia', 'admin', 'ventas', 'deposito'];

export type AuthResult =
  | { ok: true; internal: true; uid: 'system'; role: 'superadmin'; name: string }
  | { ok: true; internal: false; uid: string; role: AppRole; name: string; email?: string }
  | { ok: false; status: 401 | 403; error: string };

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** ¿La petición trae la clave interna correcta? */
export function isInternalSecret(token: string | null | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24 || !token) return false;
  return safeEqual(token, secret);
}

function extractBearer(req: Request): string | null {
  const h = req.headers.get('authorization') || '';
  if (h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  return null;
}

// Cache corto de tokens verificados para no consultar a Google en cada petición.
const tokenCache = new Map<string, { uid: string; email?: string; exp: number }>();

/** Verifica un Firebase ID token contra Google Identity Toolkit (sin firebase-admin). */
export async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; email?: string } | null> {
  const cached = tokenCache.get(idToken);
  if (cached && cached.exp > Date.now()) return { uid: cached.uid, email: cached.email };

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const user = data?.users?.[0];
    if (!user?.localId || user.disabled) return null;

    // Cachear 5 minutos (los ID tokens duran 60 min)
    if (tokenCache.size > 500) tokenCache.clear();
    tokenCache.set(idToken, { uid: user.localId, email: user.email, exp: Date.now() + 5 * 60 * 1000 });
    return { uid: user.localId, email: user.email };
  } catch {
    return null;
  }
}

async function loadProfile(uid: string): Promise<{ role: AppRole; name: string } | null> {
  await ensureServerAuth();
  const { firestore } = initializeFirebaseServer();
  const snap = await getDoc(doc(firestore, 'users', uid));
  if (!snap.exists()) return null;
  const d = snap.data() as any;
  return { role: (d.role || 'cliente') as AppRole, name: d.name || d.displayName || d.email || 'Usuario' };
}

/**
 * Autoriza una petición HTTP.
 * @param allowedRoles roles de usuario permitidos. Las peticiones internas siempre se aceptan
 *                     salvo que `allowInternal` sea false.
 * @param opts.queryTokenParam permite leer el ID token de un parámetro de URL (descargas de PDF en pestaña nueva).
 */
export async function authorizeRequest(
  req: Request,
  allowedRoles: AppRole[],
  opts: { allowInternal?: boolean; queryTokenParam?: string } = {}
): Promise<AuthResult> {
  const { allowInternal = true, queryTokenParam } = opts;

  let token = extractBearer(req);
  if (!token && queryTokenParam) {
    token = new URL(req.url).searchParams.get(queryTokenParam);
  }
  if (!token) return { ok: false, status: 401, error: 'Autenticación requerida' };

  if (isInternalSecret(token)) {
    if (!allowInternal) return { ok: false, status: 403, error: 'Credencial interna no permitida aquí' };
    return { ok: true, internal: true, uid: 'system', role: 'superadmin', name: 'Sistema Athleticenter' };
  }

  const verified = await verifyFirebaseIdToken(token);
  if (!verified) return { ok: false, status: 401, error: 'Sesión inválida o expirada' };

  const profile = await loadProfile(verified.uid);
  if (!profile) return { ok: false, status: 403, error: 'Perfil de usuario no encontrado' };
  if (!allowedRoles.includes(profile.role)) return { ok: false, status: 403, error: 'Permisos insuficientes' };

  return { ok: true, internal: false, uid: verified.uid, role: profile.role, name: profile.name, email: verified.email };
}

/** Autoriza una server action a partir del ID token que envía el cliente. */
export async function authorizeAction(idToken: string | undefined | null, allowedRoles: AppRole[]): Promise<AuthResult> {
  if (!idToken) return { ok: false, status: 401, error: 'Autenticación requerida' };
  const verified = await verifyFirebaseIdToken(idToken);
  if (!verified) return { ok: false, status: 401, error: 'Sesión inválida o expirada' };
  const profile = await loadProfile(verified.uid);
  if (!profile) return { ok: false, status: 403, error: 'Perfil de usuario no encontrado' };
  if (!allowedRoles.includes(profile.role)) return { ok: false, status: 403, error: 'Permisos insuficientes' };
  return { ok: true, internal: false, uid: verified.uid, role: profile.role, name: profile.name, email: verified.email };
}

/** Cabecera para llamadas servidor→servidor (agentes, crons). */
export function internalAuthHeaders(): Record<string, string> {
  const secret = process.env.CRON_SECRET;
  return secret ? { Authorization: `Bearer ${secret}` } : {};
}
