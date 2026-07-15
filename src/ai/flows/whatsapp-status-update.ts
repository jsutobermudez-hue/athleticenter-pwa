'use server';

/**
 * @fileOverview Generates a WhatsApp message to notify a customer about their order status change.
 * Actualizado a Gemini 2.5 Flash para notificaciones instantáneas y amigables.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';

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
  prompt: `Eres un asistente de servicio al cliente para Athleticenter. Tu tarea es generar un mensaje de WhatsApp claro y amigable en ESPAÑOL para notificar a un cliente sobre un cambio en el estado de su pedido.

  Información del Pedido:
  - Nombre del Cliente: {{{customerName}}}
  - ID del Pedido: {{{orderId}}}
  - Nuevo Estado: {{{newStatus}}}
  {{#if carrier}}
  - Transportista: {{{carrier}}}
  {{/if}}
  {{#if trackingNumber}}
  - Número de Seguimiento: {{{trackingNumber}}}
  {{/if}}

  Instrucciones para el mensaje:
  1. Saluda al cliente por su nombre.
  2. Menciona el ID del pedido para referencia.
  3. Informa claramente sobre el nuevo estado.
  4. Si el estado es "Despachado", incluye transportista y guía de forma emocionante.
  5. Firma como "el equipo de Athleticenter".

  Responde únicamente con el objeto JSON que contiene el mensaje.`,
});

const whatsAppStatusUpdateFlow = ai.defineFlow(
  {
    name: 'whatsAppStatusUpdateFlow',
    inputSchema: WhatsAppStatusUpdateInputSchema,
    outputSchema: WhatsAppStatusUpdateOutputSchema,
  },
  async input => {
    const { output } = await whatsAppPrompt(input);
    return output!;
  }
);
