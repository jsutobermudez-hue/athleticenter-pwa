
'use client';

import { collection, addDoc, serverTimestamp, type Firestore } from 'firebase/firestore';
import type { AuditLog } from './definitions';

/**
 * Registra una acción administrativa crítica en el Libro de Auditoría Global.
 * v219.0.0 - Hardening: Soporta severidades críticas para transacciones financieras.
 */
export async function logActivity(
    firestore: Firestore,
    params: {
        userId: string;
        userName: string;
        action: string;
        resource: AuditLog['resource'];
        resourceId?: string;
        details: string;
        severity?: AuditLog['severity'];
    }
) {
    try {
        const auditRef = collection(firestore, 'auditLogs');
        await addDoc(auditRef, {
            ...params,
            severity: params.severity || 'info',
            createdAt: serverTimestamp(),
        });
    } catch (e) {
        // Fallback silencioso para no interrumpir el flujo del usuario
        console.warn("[Audit] Fallo al registrar log de actividad:", e);
    }
}
