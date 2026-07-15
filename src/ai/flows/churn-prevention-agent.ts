'use server';

/**
 * @fileOverview Agente IA de Prevención de Abandono (Churn Prevention).
 * Analiza la recurrencia de compra y detecta clientes con inactividad crítica.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { collection, getDocs, query, where, Timestamp, limit } from 'firebase/firestore';
import { initializeFirebaseServer } from '@/firebase/server-init';
import { differenceInDays } from 'date-fns';
import type { Customer } from '@/lib/definitions';
import { createAppNotifications } from '@/lib/notifications';

const ChurnResultSchema = z.object({
  scannedCustomers: z.number().describe('Total de cuentas auditadas.'),
  atRiskCount: z.number().describe('Clientes detectados con inactividad crítica.'),
  alertsDispatched: z.number().describe('Notificaciones de reactivación emitidas.'),
});

export const churnPreventionAgentFlow = ai.defineFlow(
  {
    name: 'churnPreventionAgentFlow',
    outputSchema: ChurnResultSchema,
  },
  async () => {
    console.log('[Churn Agent] Iniciando auditoría de pulso de cliente...');
    const { firestore } = initializeFirebaseServer();
    
    // 1. Obtener todos los clientes activos
    const customersRef = collection(firestore, 'customers');
    const q = query(customersRef, where('status', '==', 'Activo'), limit(200));
    const querySnapshot = await getDocs(q);
    
    let scannedCustomers = 0;
    let atRiskCount = 0;
    let alertsDispatched = 0;
    const now = new Date();

    for (const d of querySnapshot.docs) {
        const customer = { id: d.id, ...d.data() } as Customer;
        scannedCustomers++;

        // Si no tiene fecha de último pedido, asumimos que es nuevo o nunca ha comprado
        if (!customer.lastOrderDate) continue;

        const lastOrder = (customer.lastOrderDate as Timestamp).toDate();
        const daysSinceLastOrder = differenceInDays(now, lastOrder);
        const CHURN_THRESHOLD_DAYS = 30; // Umbral de alerta: 30 días sin comprar

        if (daysSinceLastOrder >= CHURN_THRESHOLD_DAYS) {
            atRiskCount++;
            
            try {
                // Notificar al Vendedor y al Superadmin
                await createAppNotifications(firestore, {
                    category: 'Clientes',
                    title: `🎯 Alerta de Retención: ${customer.razonSocial}`,
                    message: `La cuenta no ha registrado actividad en ${daysSinceLastOrder} días. Sugerimos contacto inmediato para evitar fuga.`,
                    link: `/dashboard/clients?search=${customer.rif}`,
                    initiatorId: 'system_churn_agent',
                    userIds: [customer.assignedSalespersonId],
                    roles: ['admin', 'gerencia'],
                });
                alertsDispatched++;
            } catch (e) {
                console.error(`[Churn Agent] Error notificando riesgo para ${customer.id}:`, e);
            }
        }
    }

    console.log(`[Churn Agent] Ciclo finalizado. Riesgos detectados: ${atRiskCount}`);
    return { scannedCustomers, atRiskCount, alertsDispatched };
  }
);
