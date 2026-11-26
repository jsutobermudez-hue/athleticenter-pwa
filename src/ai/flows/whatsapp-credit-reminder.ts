'use server';

/**
 * @fileOverview Generates a WhatsApp message for customers about credit and discounts.
 * Actualizado a Gemini 2.5 Flash para mayor calidez y efectividad en cobranzas.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const WhatsAppReminderInputSchema = z.object({
  customerName: z.string().describe('The name of the customer.'),
  remainingCreditDays: z.number().describe('The number of credit days remaining.'),
  discountPercentage: z.number().describe('The discount percentage available for early payment.'),
  phoneNumber: z.string().describe('The customer phone number to send the message to.'),
  orderId: z.string().optional().describe('The short ID or code of the order/invoice.'),
  remainingBalance: z.number().optional().describe('Pending balance at BCV list price in USD.'),
  divisasBalance: z.number().optional().describe('Pending balance paying in divisas (-25%) in USD.'),
  isOverdue: z.boolean().optional().describe('Whether the invoice is already overdue.'),
});
export type WhatsAppReminderInput = z.infer<typeof WhatsAppReminderInputSchema>;

const WhatsAppReminderOutputSchema = z.object({
  message: z.string().describe('The generated WhatsApp message.'),
  shouldSend: z.boolean().describe('Whether the message should be sent based on discount availability.'),
});
export type WhatsAppReminderOutput = z.infer<typeof WhatsAppReminderOutputSchema>;

export async function generateWhatsAppReminder(input: WhatsAppReminderInput): Promise<WhatsAppReminderOutput> {
  return whatsAppCreditReminderFlow(input);
}

const whatsAppPrompt = ai.definePrompt({
  name: 'whatsAppCreditReminderPrompt',
  model: 'googleai/gemini-2.5-flash',
  input: {schema: WhatsAppReminderInputSchema},
  output: {schema: WhatsAppReminderOutputSchema},
  prompt: `Eres el asistente de atención al cliente de Athleticenter. Genera un mensaje de WhatsApp cercano, humano y claro en español venezolano para recordar un saldo o beneficio de pronto pago.

  Datos reales del pedido:
  - Cliente: {{{customerName}}}
  {{#if orderId}}- Pedido: #{{{orderId}}}{{/if}}
  {{#if remainingBalance}}- Saldo pendiente (Lista BCV): \${{{remainingBalance}}}{{/if}}
  {{#if divisasBalance}}- Pagando en divisas (-25%): \${{{divisasBalance}}}{{/if}}
  - Días de crédito restantes: {{{remainingCreditDays}}}
  - Descuento adicional por pronto pago (%): {{{discountPercentage}}}
  {{#if isOverdue}}- Situación: Factura vencida{{/if}}

  Instrucciones de estilo:
  1. Empieza exactamente con: Hola *{{{customerName}}}* 👋
  2. Sé directo, respetuoso y sin jerga ("expediente", "estatus", "solvente").
  3. Incluye el número de pedido (#) y los montos exactos si están disponibles.
  4. Invítalo amablemente a enviar el comprobante por este chat si ya pagó o desea aprovechar el descuento.
  5. Termina exactamente con: — *El equipo de Athleticenter*
  6. NUNCA menciones nombres de vendedores ni inventes cifras o plazos distintos a los entregados. Máximo 70 palabras, con 1-3 emojis.

  Responde en JSON:
  {
    "message": "Texto final para WhatsApp.",
    "shouldSend": true si discountPercentage > 0 o isOverdue es true o remainingCreditDays <= 5; false en caso contrario.
  }`,
});

const whatsAppCreditReminderFlow = ai.defineFlow(
  {
    name: 'whatsAppCreditReminderFlow',
    inputSchema: WhatsAppReminderInputSchema,
    outputSchema: WhatsAppReminderOutputSchema,
  },
  async input => {
    const {output} = await whatsAppPrompt(input);
    return output!;
  }
);
