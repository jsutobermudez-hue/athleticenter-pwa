'use server';

/**
 * @fileOverview Generates a WhatsApp message to notify a customer about their order status change.
 * Actualizado a Gemini 2.5 Flash para notificaciones instantáneas y amigables.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { orderStatusChangeMessage } from '@/lib/whatsapp-templates';

const WhatsAppStatusUpdateInputSchema = z.object({
  customerName: z.string().describe('The name of the customer.'),
  orderId: z.string().describe('The short ID of the order (e.g., ABC-123).'),
  newStatus: z.string().describe('The new status of the order (e.g., Procesando, Despachado).'),
  carrier: z.string().optional().describe('The shipping carrier, if the order has been dispatched.'),
  trackingNumber: z.string().optional().describe('The tracking number, if the order has been dispatched.'),
});
export type WhatsAppStatusUpdateInput = z.infer<typeof WhatsAppStatusUpdateInputSchema>;

const WhatsAppStatusUpdateOutputSchema = z.object({
  message: z.string().describe('The generated WhatsApp message in Spanish.'),
});
export type WhatsAppStatusUpdateOutput = z.infer<typeof WhatsAppStatusUpdateOutputSchema>;

export async function generateWhatsAppStatusUpdate(input: WhatsAppStatusUpdateInput): Promise<WhatsAppStatusUpdateOutput> {
  return whatsAppStatusUpdateFlow(input);
}

const whatsAppPrompt = ai.definePrompt({
  name: 'whatsAppStatusUpdatePrompt',
  model: 'googleai/gemini-2.5-flash',
  input: { schema: WhatsAppStatusUpdateInputSchema },
  output: { schema: WhatsAppStatusUpdateOutputSchema },
  prompt: `Eres el asistente de atención al cliente de Athleticenter. Redacta un mensaje de WhatsApp cercano, claro y breve en español venezolano para avisar al cliente que su pedido cambió de estado.

  Información del Pedido:
  - Cliente: {{{customerName}}}
  - Pedido: #{{{orderId}}}
  - Nuevo Estado: {{{newStatus}}}
  {{#if carrier}}
  - Agencia: {{{carrier}}}
  {{/if}}
  {{#if trackingNumber}}
  - N° de Guía: {{{trackingNumber}}}
  {{/if}}

  Instrucciones obligatorias:
  1. Empieza exactamente con: Hola *{{{customerName}}}* 👋
  2. Menciona el pedido *#{{{orderId}}}* y explica en lenguaje simple qué significa el nuevo estado (sin usar palabras como "expediente" o "estatus logístico").
  3. Si viene agencia o número de guía, inclúyelos claramente.
  4. Termina exactamente con: — *El equipo de Athleticenter*
  5. NUNCA menciones nombres de vendedores ni inventes montos, fechas o plazos. Máximo 55 palabras, con 1-2 emojis.

  Responde únicamente con el objeto JSON que contiene el mensaje.`,
});

const whatsAppStatusUpdateFlow = ai.defineFlow(
  {
    name: 'whatsAppStatusUpdateFlow',
    inputSchema: WhatsAppStatusUpdateInputSchema,
    outputSchema: WhatsAppStatusUpdateOutputSchema,
  },
  async input => {
    try {
      const { output } = await whatsAppPrompt(input);
      if (output?.message) return output;
    } catch (e) {
      console.warn('[whatsAppStatusUpdateFlow] Fallback a plantilla directa:', e);
    }
    return {
      message: orderStatusChangeMessage({
        customerName: input.customerName,
        orderId: input.orderId,
        newStatus: input.newStatus,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
      }),
    };
  }
);
