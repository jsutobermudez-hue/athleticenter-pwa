'use server';

/**
 * @fileOverview Agente IA de Prevención de Abandono (Churn Prevention).
 * Analiza la recurrencia de compra y detecta clientes con inactividad crítica.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { collection, getDocs, query, where, Timestamp, limit, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { initializeFirebaseServer } from '@/firebase/server-init';
import { differenceInDays } from 'date-fns';
import type { Customer } from '@/lib/definitions';
import { createAppNotifications } from '@/lib/notifications';

const ChurnResultSchema = z.object({
  scannedCustomers: z.number().describe('Total de cuentas auditadas.'),
  atRiskCount: z.number().describe('Clientes detectados con inactividad crítica (30+ días).'),
  alertsDispatched: z.number().describe('Notificaciones de reactivación emitidas.'),
});

export const churnPreventionAgentFlow = ai.defineFlow(
  {
    name: 'churnPreventionAgentFlow',
    outputSchema: ChurnResultSchema,
  },
  async () => {
    console.log('[Churn Agent] Iniciando auditoría de pulso de cliente a 30 días...');
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
        const customer = { id: d.id, ...d.data() } as any;
        scannedCustomers++;

        // Si no tiene fecha de último pedido, omitir
        if (!customer.lastOrderDate) continue;

        const lastOrder = typeof customer.lastOrderDate.toDate === 'function' ? customer.lastOrderDate.toDate() : new Date(customer.lastOrderDate);
        const daysSinceLastOrder = differenceInDays(now, lastOrder);
        const CHURN_THRESHOLD_DAYS = 30; // Umbral estratégico a 30 días

        if (daysSinceLastOrder >= CHURN_THRESHOLD_DAYS) {
            atRiskCount++;

            // FILTRO ANTI-FATIGA (Carencia de 30 días entre notificaciones)
            if (customer.lastReactivationSentAt) {
                const lastSent = typeof customer.lastReactivationSentAt.toDate === 'function' 
                    ? customer.lastReactivationSentAt.toDate() 
                    : new Date(customer.lastReactivationSentAt);
                const daysSinceLastSent = differenceInDays(now, lastSent);
                
                // Si se notificó en los últimos 30 días, omitir para no fatigar al cliente
                if (daysSinceLastSent < 30) {
                    console.log(`[Churn Agent] Omitido cliente ${customer.razonSocial || customer.id} por carencia anti-fatiga (${daysSinceLastSent}d desde última alerta).`);
                    continue;
                }
            }

            try {
                // Notificar al Vendedor asignado, Gerencia y Administración
                await createAppNotifications(firestore, {
                    category: 'Clientes',
                    title: `🎯 Alerta de Retención: ${customer.razonSocial || customer.nombreComercial || 'Cliente'}`,
                    message: `El cliente registra exactamente ${daysSinceLastOrder} días sin realizar compras. Se ha sugerido contacto amigable de servicio para renovación de inventario.`,
                    link: `/dashboard/clients?search=${encodeURIComponent(customer.rif || customer.id)}`,
                    initiatorId: 'system_churn_agent',
                    userIds: customer.assignedSalespersonId ? [customer.assignedSalespersonId] : undefined,
                    roles: ['admin', 'gerencia', 'superadmin'],
                });

                // Registrar fecha de envío para la carencia anti-fatiga
                const customerDocRef = doc(firestore, 'customers', customer.id);
                await updateDoc(customerDocRef, {
                    lastReactivationSentAt: serverTimestamp()
                });

                alertsDispatched++;
            } catch (e) {
                console.error(`[Churn Agent] Error notificando riesgo para ${customer.id}:`, e);
            }
        }
    }

    console.log(`[Churn Agent] Ciclo finalizado. Riesgos detectados: ${atRiskCount}, Notificaciones emitidas: ${alertsDispatched}`);
    return { scannedCustomers, atRiskCount, alertsDispatched };
  }
);

