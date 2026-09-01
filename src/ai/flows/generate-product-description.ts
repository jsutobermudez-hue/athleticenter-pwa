'use server';

/**
 * @fileOverview Generates a product description using AI.
 * Actualizado a Gemini 2.5 Flash para máximo rendimiento en producción.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';

const GenerateProductDescriptionInputSchema = z.object({
  name: z.string().describe('The name of the product.'),
  brand: z.string().optional().describe('The brand of the product.'),
  category: z.string().optional().describe('The category the product belongs to.'),
  discipline: z.string().optional().describe('The sport or discipline the product is for.'),
});
export type GenerateProductDescriptionInput = z.infer<typeof GenerateProductDescriptionInputSchema>;

const GenerateProductDescriptionOutputSchema = z.object({
  description: z.string().describe('The generated product description.'),
});
export type GenerateProductDescriptionOutput = z.infer<typeof GenerateProductDescriptionOutputSchema>;

export async function generateProductDescription(
  input: GenerateProductDescriptionInput
): Promise<GenerateProductDescriptionOutput> {
  return generateProductDescriptionFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateProductDescriptionPrompt',
  model: 'googleai/gemini-1.5-flash',
  input: { schema: GenerateProductDescriptionInputSchema },
  output: { schema: GenerateProductDescriptionOutputSchema },
  prompt: `Eres un experto en marketing de equipos deportivos para un distribuidor B2B. Tu tarea es escribir una descripción de producto atractiva y concisa en ESPAÑOL.

  Basado en la siguiente información, genera la descripción:
  - Nombre del Producto: {{{name}}}
  {{#if brand}}- Marca: {{{brand}}}{{/if}}
  {{#if category}}- Categoría: {{{category}}}{{/if}}
  {{#if discipline}}- Disciplina: {{{discipline}}}{{/if}}

  La descripción debe ser profesional, resaltar los beneficios clave para los clientes (tiendas, clubes, etc.) y ser adecuada para un catálogo. No excedas las 3-4 frases.

  Responde únicamente con el objeto JSON que contiene la descripción.`,
});

const generateProductDescriptionFlow = ai.defineFlow(
  {
    name: 'generateProductDescriptionFlow',
    inputSchema: GenerateProductDescriptionInputSchema,
    outputSchema: GenerateProductDescriptionOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);
