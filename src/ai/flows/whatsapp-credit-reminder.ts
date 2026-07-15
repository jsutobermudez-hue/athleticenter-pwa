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
  prompt: `Eres un asistente útil que genera mensajes de WhatsApp para recordar a los clientes sobre su crédito y descuentos.

  Basado en la siguiente información, genera un mensaje de WhatsApp personalizado en ESPAÑOL:
  Nombre del Cliente: {{{customerName}}}
  Días de Crédito Restantes: {{{remainingCreditDays}}}
  Porcentaje de Descuento: {{{discountPercentage}}}

  Si hay un descuento disponible (discountPercentage > 0), el mensaje debe resaltar el descuento y fomentar el pago puntual. Si no hay descuento (discountPercentage es 0), el mensaje debe recordar los días de crédito restantes.

  El mensaje debe ser amigable y profesional. Sé breve y directo.

  Responde en el siguiente formato JSON:
  {
    "message": "El mensaje de WhatsApp generado en español.",
    "shouldSend": true si discountPercentage > 0, false en caso contrario.
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
