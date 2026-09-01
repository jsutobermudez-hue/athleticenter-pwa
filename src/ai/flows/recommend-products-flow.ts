'use server';

/**
 * @fileOverview AI Agent that suggests complementary products.
 * Actualizado a Gemini 2.5 Flash para mayor precisión en ventas cruzadas.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';

const RecommendProductsInputSchema = z.object({
  cartItems: z.array(z.string()).describe('List of product names currently in the cart.'),
  availableInventory: z.array(z.object({
    id: z.string(),
    name: z.string(),
    category: z.string(),
    brand: z.string(),
    discipline: z.string(),
  })).describe('Simplified list of available inventory to choose from.'),
});

const RecommendProductsOutputSchema = z.object({
  recommendations: z.array(z.object({
    productId: z.string(),
    reason: z.string().describe('Short reason why this product complements the current cart.'),
  })).max(3),
});

export async function recommendProducts(input: z.infer<typeof RecommendProductsInputSchema>) {
  return recommendProductsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'recommendProductsPrompt',
  model: 'googleai/gemini-1.5-flash',
  input: { schema: RecommendProductsInputSchema },
  output: { schema: RecommendProductsOutputSchema },
  prompt: `Eres un estratega de ventas B2B para Athleticenter. Tu objetivo es sugerir productos que aumenten el valor del pedido.

  Carrito Actual:
  {{#each cartItems}}
  - {{{this}}}
  {{/each}}

  Basado en el inventario disponible, elige hasta 3 productos que complementen el carrito. 
  Ejemplo: Si llevan Balones, sugiere Infladores o Conos. Si llevan Calzado, sugiere Medias.

  Responde solo con el JSON de recomendaciones.`,
});

const recommendProductsFlow = ai.defineFlow(
  {
    name: 'recommendProductsFlow',
    inputSchema: RecommendProductsInputSchema,
    outputSchema: RecommendProductsOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);
