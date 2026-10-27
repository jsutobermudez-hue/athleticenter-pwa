'use server';

/**
 * Acciones administrativas que ejecutan agentes del servidor a petición desde Configuración.
 * Siempre verifican la sesión y el rol (gerencia/admin/superadmin).
 */
import { authorizeAction, MANAGER_ROLES } from '@/lib/server-auth';
import { ensureServerAuth } from '@/firebase/server-init';
import {
  executeRoleBasedDailyWhatsAppBriefing,
  executeWeeklySalespersonReceivablesSummary,
} from '@/services/agents';

export async function runRoleBriefingAction(idToken: string | null, testPhone?: string, testRole?: string) {
  const auth = await authorizeAction(idToken, MANAGER_ROLES);
  if (!auth.ok) return { success: false, error: auth.error, sentCount: 0 };
  await ensureServerAuth();
  return executeRoleBasedDailyWhatsAppBriefing(testPhone || undefined, testRole || undefined);
}

export async function runWeeklyReceivablesAction(idToken: string | null) {
  const auth = await authorizeAction(idToken, MANAGER_ROLES);
  if (!auth.ok) return { success: false, error: auth.error, salespeopleNotified: 0 };
  await ensureServerAuth();
  return executeWeeklySalespersonReceivablesSummary();
}
