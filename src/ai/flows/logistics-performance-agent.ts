'use server';

/**
 * @fileOverview Agente IA de Auditoría Logística.
 * Mide tiempos de entrega por transportista y detecta anomalías en la red de distribución.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { collection, getDocs, query, where, Timestamp, limit, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { initializeFirebaseServer } from '@/firebase/server-init';
import { differenceInHours } from 'date-fns';
import type { Order, Carrier, AuditLog } from '@/lib/definitions';
import { createAppNotifications } from '@/lib/notifications';

const LogisticsResultSchema = z.object({
  analyzedOrders: z.number().describe('Total de entregas auditadas.'),
  carriersUpdated: z.number().describe('Empresas con métricas refrescadas.'),
  alertsDispatched: z.number().describe('Alertas de retraso crítico emitidas.'),
});

export const logisticsPerformanceAgentFlow = ai.defineFlow(
  {
    name: 'logisticsPerformanceAgentFlow',
    outputSchema: LogisticsResultSchema,
  },
  async () => {
    console.log('[Logistics Agent] Iniciando auditoría de última milla...');
    const { firestore } = initializeFirebaseServer();
    
    // 1. Obtener órdenes entregadas recientemente (últimos 60 días)
    const ordersRef = collection(firestore, 'orders');
    const q = query(ordersRef, where('status', '==', 'Entregado'), limit(200));
    const querySnapshot = await getDocs(q);
    
    const carrierMetrics: Record<string, { totalHours: number, count: number, carrierId?: string }> = {};
    let analyzedOrders = 0;

    querySnapshot.docs.forEach(d => {
        const order = d.data() as Order;
        if (order.carrier && order.pickupDate && order.receptionDate) {
            const start = (order.pickupDate as Timestamp).toDate();
            const end = (order.receptionDate as Timestamp).toDate();
            const hours = differenceInHours(end, start);
            
            if (!carrierMetrics[order.carrier]) {
                carrierMetrics[order.carrier] = { totalHours: 0, count: 0, carrierId: order.carrierId };
            }
            carrierMetrics[order.carrier].totalHours += hours;
            carrierMetrics[order.carrier].count++;
            analyzedOrders++;
        }
    });

    let carriersUpdated = 0;
    let alertsDispatched = 0;

    // 2. Procesar promedios y actualizar transportistas
    for (const name in carrierMetrics) {
        const { totalHours, count, carrierId } = carrierMetrics[name];
        const avgHours = totalHours / count;
        
        if (carrierId) {
            try {
                const carrierRef = doc(firestore, 'carriers', carrierId);
                await updateDoc(carrierRef, {
                    avgDeliveryHours: Number(avgHours.toFixed(1)),
                    totalDeliveriesAudit: count,
                    lastAuditAt: serverTimestamp()
                } as any);
                carriersUpdated++;

                // 3. Alerta de Retraso Crítico (> 72 horas promedio)
                if (avgHours > 72) {
                    await createAppNotifications(firestore, {
                        category: 'Despacho',
                        title: `⚠️ Baja Eficiencia: ${name}`,
                        message: `El transportista promedia ${avgHours.toFixed(1)}h por entrega. Se sugiere auditar el servicio.`,
                        link: `/dashboard/carriers?carrier=${carrierId}`,
                        initiatorId: 'system_logistics_agent',
                        roles: ['admin', 'gerencia'],
                    });
                    alertsDispatched++;
                }
            } catch (e) {}
        }
    }

    console.log(`[Logistics Agent] Ciclo finalizado. Auditadas: ${analyzedOrders}`);
    return { analyzedOrders, carriersUpdated, alertsDispatched };
  }
);
