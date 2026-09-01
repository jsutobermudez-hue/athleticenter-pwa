
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
import { differenceInHours, addDays } from 'date-fns';
import type { Order } from '@/lib/definitions';
import { createAppNotifications } from '@/lib/notifications';
import { sendBackgroundWhatsAppMessage } from '@/lib/whatsapp-gateway';

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
      
      const receptionDate = (order.receptionDate as Timestamp).toDate();
      const sevenDaysLimit = addDays(receptionDate, 7);
      const hoursRemaining = differenceInHours(sevenDaysLimit, now);
      const alertsSent = order.alertsSent || [];

      let alertType: 'saving_48h' | 'saving_24h' | 'saving_12h' | 'tier_shift' | null = null;
      let title = "";
      let message = "";

      // LÓGICA DE ESCALAMIENTO TÁCTICO
      if (hoursRemaining <= 0 && !alertsSent.includes('tier_shift')) {
          alertType = 'tier_shift';
          title = "⏱️ Actualización de Ahorro: Tier 5%";
          message = `Tu descuento del 10% ha expirado, pero aún puedes ahorrar un 5% liquidando en los próximos 8 días. ¡Optimiza tu inversión en #${order.id.substring(0, 6)}!`;
      } else if (hoursRemaining > 0 && hoursRemaining <= 12 && !alertsSent.includes('saving_12h')) {
          alertType = 'saving_12h';
          title = "🚨 ¡Últimas 12 Horas de Ahorro!";
          message = `Tu beneficio de pronto pago (10%) para el pedido #${order.id.substring(0, 6)} está por expirar. No pierdas la oportunidad de pagar menos.`;
      } else if (hoursRemaining > 12 && hoursRemaining <= 24 && !alertsSent.includes('saving_24h')) {
          alertType = 'saving_24h';
          title = "⚡ ¡Solo 24 Horas para Ahorrar 10%!";
          message = `Tu beneficio de pronto pago vence mañana. Ahorra en tu factura #${order.id.substring(0, 6)} liquidando antes del cierre del día.`;
      } else if (hoursRemaining > 24 && hoursRemaining <= 48 && !alertsSent.includes('saving_48h')) {
          alertType = 'saving_48h';
          title = "⏳ Oportunidad de Ahorro: 10% OFF";
          message = `Te quedan 48 horas para aprovechar un 10% de ahorro en tu pedido #${order.id.substring(0, 6)}. ¡Acelera tu rentabilidad hoy!`;
      }

      if (alertType) {
          try {
              const batch = writeBatch(firestore);
              // Registrar alerta enviada para evitar spam
              const orderRef = doc(firestore, 'orders', order.id);
              batch.update(orderRef, { alertsSent: [...alertsSent, alertType] });
              await batch.commit();

              // Notificar al Cliente y al Vendedor
              await createAppNotifications(firestore, {
                  category: 'Facturación',
                  title,
                  message,
                  link: `/dashboard/billing?orderId=${order.id}`,
                  initiatorId: 'system_savings_agent',
                  userIds: [order.customerId, order.salespersonId],
              });

              // Envío Automático por WhatsApp al Teléfono del Cliente
              const phone = order.customerPhone || (order as any).phone || '';
              if (phone) {
                const waMessage = `👋 Hola ${order.customerName || 'Estimado Cliente'}, le saludamos de Athleticenter.\n\n` +
                  `⚡ *${title}*\n${message}\n\n` +
                  `📄 Pedido: #${order.id}\n💰 Monto Total: $${(order.totalAmount || 0).toFixed(2)} USD\n\n` +
                  `¡Aprovecha tu beneficio de pronto pago antes del vencimiento!`;
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
