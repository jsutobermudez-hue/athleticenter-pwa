
'use server';

/**
 * @fileOverview Agente que monitorea facturas entregadas y dispara alertas de ahorro (Pronto Pago).
 * 
 * - savingsAlertAgentFlow - El flujo principal que audita el reloj de ahorro de los clientes.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { collection, getDocs, query, where, Timestamp, limit, writeBatch, doc } from 'firebase/firestore';
import { initializeFirebaseServer } from '@/firebase/server-init';
import { differenceInHours, addDays, format } from 'date-fns';
import type { Order } from '@/lib/definitions';
import { createAppNotifications } from '@/lib/notifications';
import { sendBackgroundWhatsAppMessage } from '@/lib/whatsapp-gateway';
import { computeOrderBalanceForWhatsApp, earlyPaymentSavingsMessage, shortId } from '@/lib/whatsapp-templates';

const SavingsAgentResultSchema = z.object({
  scannedOrders: z.number().describe('Total de órdenes auditadas en este ciclo.'),
  alertsTriggered: z.number().describe('Total de notificaciones enviadas.'),
  errors: z.array(z.string()).describe('Lista de incidencias encontradas.'),
});

export const savingsAlertAgentFlow = ai.defineFlow(
  {
    name: 'savingsAlertAgentFlow',
    outputSchema: SavingsAgentResultSchema,
  },
  async () => {
    console.log('[Savings Agent] Iniciando auditoría de incentivos...');
    const { firestore } = initializeFirebaseServer();
    const ordersRef = collection(firestore, 'orders');
    
    // Solo auditamos órdenes 'Entregado' que aún no son 'Pagado' o 'En Verificación'
    const q = query(ordersRef, where('status', '==', 'Entregado'), limit(100));
    const querySnapshot = await getDocs(q);
    
    let scannedOrders = 0;
    let alertsTriggered = 0;
    const errors: string[] = [];
    const now = new Date();

    const processPromises = querySnapshot.docs.map(async (orderDoc) => {
      const order = { id: orderDoc.id, ...orderDoc.data() } as Order;
      scannedOrders++;

      if (!order.receptionDate) return;

      const bal = computeOrderBalanceForWhatsApp(order);
      if (!bal.isBillable || bal.pendingDivisasUSD <= 0.50) return;

      const receptionDate = (order.receptionDate as Timestamp).toDate();
      const sevenDaysLimit = addDays(receptionDate, 7);
      const hoursRemaining = differenceInHours(sevenDaysLimit, now);
      if (hoursRemaining <= 0 || hoursRemaining > 48) return;

      const alertsSent = order.alertsSent || [];
      const totalDivisasUSD = bal.pendingDivisasUSD;
      const totalContadoUSD = Math.round(totalDivisasUSD * 0.90 * 100) / 100;
      const savingsUSD = Math.round((totalDivisasUSD - totalContadoUSD) * 100) / 100;

      let alertType: 'saving_48h' | 'saving_24h' | 'saving_12h' | null = null;
      let title = '';
      let message = '';

      if (hoursRemaining <= 12 && !alertsSent.includes('saving_12h')) {
          alertType = 'saving_12h';
          title = `⏰ Últimas horas de pronto pago (-10%) — #${shortId(order.id, 6)}`;
          message = `${order.customerName} aún puede pagar de contado en $${totalContadoUSD.toFixed(2)} y ahorrar $${savingsUSD.toFixed(2)}.`;
      } else if (hoursRemaining > 12 && hoursRemaining <= 24 && !alertsSent.includes('saving_24h')) {
          alertType = 'saving_24h';
          title = `⚡ 24h de pronto pago (-10%) — #${shortId(order.id, 6)}`;
          message = `El beneficio de contado vence mañana para ${order.customerName} (ahorro de $${savingsUSD.toFixed(2)}).`;
      } else if (hoursRemaining > 24 && hoursRemaining <= 48 && !alertsSent.includes('saving_48h')) {
          alertType = 'saving_48h';
          title = `💡 Ventana de pronto pago (-10%) — #${shortId(order.id, 6)}`;
          message = `${order.customerName} tiene 48h para aprovechar el 10% adicional de contado (ahorro $${savingsUSD.toFixed(2)}).`;
      }

      if (alertType) {
          try {
              const batch = writeBatch(firestore);
              const orderRef = doc(firestore, 'orders', order.id);
              batch.update(orderRef, { alertsSent: [...alertsSent, alertType] });
              await batch.commit();

              // Notificar al Cliente y al Vendedor en la app (sin duplicar WhatsApp interno)
              await createAppNotifications(firestore, {
                  category: 'Facturación',
                  title,
                  message,
                  link: `/dashboard/billing?orderId=${order.id}`,
                  initiatorId: 'system_savings_agent',
                  userIds: [order.customerId, order.salespersonId],
                  skipWhatsApp: true,
              });

              // Envío Automático por WhatsApp al Teléfono del Cliente
              const phone = order.customerPhone || (order as any).phone || '';
              if (phone) {
                const waMessage = earlyPaymentSavingsMessage({
                  customerName: order.customerName || 'Cliente',
                  orderId: order.id,
                  totalDivisasUSD,
                  totalContadoUSD,
                  deadlineLabel: format(sevenDaysLimit, 'dd/MM'),
                  hoursRemaining,
                });
                await sendBackgroundWhatsAppMessage({ phone, message: waMessage });
              }
              
              alertsTriggered++;
              console.log(`[Savings Agent] Alerta ${alertType} enviada por App y WhatsApp para pedido ${order.id}`);
          } catch (e: any) {
              errors.push(`Fallo en alerta ${order.id}: ${e.message}`);
          }
      }
    });

    await Promise.all(processPromises);

    console.log(`[Savings Agent] Ciclo finalizado. Auditadas: ${scannedOrders}, Alertas: ${alertsTriggered}`);
    return { scannedOrders, alertsTriggered, errors };
  }
);
