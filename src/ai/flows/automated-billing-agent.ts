
'use server';

/**
 * @fileOverview An automated agent that checks for pending invoices and sends WhatsApp reminders.
 * This flow is designed to be run periodically (e.g., via a cron job).
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { collection, getDocs, query, where, limit } from 'firebase/firestore';
import { initializeFirebaseServer } from '@/firebase/server-init';
import type { Order } from '@/lib/definitions';
import { generateWhatsAppReminder } from './whatsapp-credit-reminder';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { getInvoiceFromOrder } from '@/lib/billing';

const AgentExecutionResultSchema = z.object({
  processedInvoices: z.number().describe('Total number of invoices checked.'),
  remindersSent: z.number().describe('Number of reminders successfully sent.'),
  errors: z.array(z.string()).describe('List of errors encountered during execution.'),
});
export type AgentExecutionResult = z.infer<typeof AgentExecutionResultSchema>;

/**
 * AGENTE DE COBRANZA AUTOMATIZADA v11.0
 * Saneado: Escucha estados reales 'Entregado' y 'En Verificación'.
 */
export const automatedBillingAgentFlow = ai.defineFlow(
  {
    name: 'automatedBillingAgentFlow',
    outputSchema: AgentExecutionResultSchema,
  },
  async () => {
    console.log('[Billing Agent] Iniciando auditoría de cuentas por cobrar...');
    const { firestore } = initializeFirebaseServer();
    const ordersRef = collection(firestore, 'orders');
    
    // Filtramos órdenes en fase de cobranza activa
    const q = query(ordersRef, where('status', 'in', ['Entregado', 'En Verificación']), limit(50));
    
    const querySnapshot = await getDocs(q);
    
    let processedInvoices = 0;
    let remindersSent = 0;
    const errors: string[] = [];

    const reminderPromises = querySnapshot.docs.map(async (doc) => {
      const order = { id: doc.id, ...doc.data() } as Order;
      processedInvoices++;

      const invoice = getInvoiceFromOrder(order);

      // Solo enviamos recordatorios para facturas con saldo pendiente real
      if (!invoice || invoice.remainingBalance <= 0.05 || invoice.status === 'Pagado') {
        return;
      }

      const phone = invoice.customerPhone;
      if (!phone) {
        errors.push(`Processing failed for ${order.id}: No customer phone number.`);
        return;
      }
      
      try {
        const result = await generateWhatsAppReminder({
          customerName: invoice.customerName,
          remainingCreditDays: invoice.remainingCreditDays,
          discountPercentage: invoice.discountPercentage,
          phoneNumber: phone,
        });
        
        // Priorizar el envío si hay descuento disponible o si está vencido
        if (result.shouldSend && invoice.customerPhone) {
          const sendResult = await sendWhatsAppMessage(invoice.customerPhone, result.message);
          if (sendResult.success) {
            remindersSent++;
          } else {
            errors.push(`WhatsApp failed for ${invoice.customerName}: ${(sendResult as any).error || 'Unknown'}`);
          }
        }
      } catch (e: any) {
        errors.push(`Processing failed for ${order.id}: ${e.message}`);
      }
    });

    await Promise.all(reminderPromises);

    return { processedInvoices, remindersSent, errors };
  }
);
