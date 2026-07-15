'use server';

/**
 * @fileOverview Agente IA Predictor de Quiebre de Stock.
 * Analiza velocidad de venta y proyecta días de inventario restantes.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { collection, getDocs, query, where, Timestamp, limit } from 'firebase/firestore';
import { initializeFirebaseServer } from '@/firebase/server-init';
import { subDays } from 'date-fns';
import type { OrderItem, Product } from '@/lib/definitions';
import { createAppNotifications } from '@/lib/notifications';

const PredictorResultSchema = z.object({
  scannedSkus: z.number().describe('Total de productos analizados.'),
  criticalRisks: z.number().describe('Productos con riesgo de quiebre detectado.'),
  alertsTriggered: z.number().describe('Notificaciones push emitidas.'),
  errors: z.array(z.string()).describe('Lista de incidencias durante el análisis.'),
});

export const stockOutPredictorAgentFlow = ai.defineFlow(
  {
    name: 'stockOutPredictorAgentFlow',
    outputSchema: PredictorResultSchema,
  },
  async () => {
    console.log('[Stock Predictor] Iniciando análisis de velocidad de venta...');
    const { firestore } = initializeFirebaseServer();
    const thirtyDaysAgo = subDays(new Date(), 30);
    
    // 1. Obtener órdenes de los últimos 30 días
    const ordersRef = collection(firestore, 'orders');
    const q = query(ordersRef, where('orderDate', '>=', Timestamp.fromDate(thirtyDaysAgo)));
    const ordersSnap = await getDocs(q);
    
    const salesVelocity: Record<string, number> = {};
    const orderIds = ordersSnap.docs.map(d => d.id);

    if (orderIds.length === 0) {
        return { scannedSkus: 0, criticalRisks: 0, alertsTriggered: 0, errors: ["Sin ventas recientes para proyectar."] };
    }

    // 2. Agregar cantidades vendidas por SKU
    // Procesamos en lotes para evitar saturación
    const itemsPromises = orderIds.map(id => getDocs(collection(firestore, `orders/${id}/orderItems`)));
    const allItemsSnaps = await Promise.all(itemsPromises);
    
    allItemsSnaps.forEach(snap => {
        snap.docs.forEach(doc => {
            const data = doc.data() as OrderItem;
            salesVelocity[data.productId] = (salesVelocity[data.productId] || 0) + data.quantity;
        });
    });

    // 3. Analizar inventario contra demanda proyectada
    const productsSnap = await getDocs(collection(firestore, 'products'));
    let criticalRisks = 0;
    let alertsTriggered = 0;
    const errors: string[] = [];

    for (const pDoc of productsSnap.docs) {
        const product = { id: pDoc.id, ...pDoc.data() } as Product;
        // Fallback: usar stockLevel o el campo antiguo stock
        const currentStock = product.stockLevel ?? (product as any).stock ?? 0;
        const totalSold30d = salesVelocity[product.id!] || 0;
        const dailyVelocity = totalSold30d / 30;

        if (dailyVelocity > 0 && currentStock > 0) {
            const daysRemaining = Math.floor(currentStock / dailyVelocity);
            const leadTimeBuffer = 30; // Tiempo de reposición estándar (importación)

            // Si el stock dura menos que el tiempo de reposición, alertamos
            if (daysRemaining <= leadTimeBuffer) {
                criticalRisks++;
                try {
                    await createAppNotifications(firestore, {
                        category: 'Inventario',
                        title: `⚠️ Riesgo de Quiebre: ${product.sku}`,
                        message: `El equipo "${product.name}" se agotará en aprox. ${daysRemaining} días. Ritmo: ${dailyVelocity.toFixed(2)} un/día.`,
                        link: `/dashboard/inventory?sku=${product.sku}`,
                        initiatorId: 'system_predictor_agent',
                        roles: ['admin', 'gerencia'],
                    });
                    alertsTriggered++;
                } catch (e: any) {
                    errors.push(`Error en alerta ${product.sku}: ${e.message}`);
                }
            }
        }
    }

    console.log(`[Stock Predictor] Ciclo finalizado. Riesgos: ${criticalRisks}`);
    return {
        scannedSkus: productsSnap.size,
        criticalRisks,
        alertsTriggered,
        errors
    };
  }
);