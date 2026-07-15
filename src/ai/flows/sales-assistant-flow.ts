'use server';
/**
 * @fileOverview Asistente IA Táctico para el equipo de ventas.
 * Mejorado: Actualizado a Gemini 2.5 Flash.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { collection, getDocs, query, where, limit, orderBy, collectionGroup } from 'firebase/firestore';
import { initializeFirebaseServer } from '@/firebase/server-init';

const SalesAssistantInputSchema = z.object({
  query: z.string().describe('Pregunta del vendedor sobre el negocio.'),
  userId: z.string().describe('ID del vendedor para filtrar datos pertinentes.'),
});
export type SalesAssistantInput = z.infer<typeof SalesAssistantInputSchema>;

const SalesAssistantOutputSchema = z.object({
  answer: z.string().describe('Respuesta profesional y basada en datos.'),
  suggestedAction: z.string().optional().describe('Acción recomendada para el vendedor para cerrar el trato o liquidar stock.'),
});
export type SalesAssistantOutput = z.infer<typeof SalesAssistantOutputSchema>;

const getInventoryTool = ai.defineTool(
  {
    name: 'getInventory',
    description: 'Consulta el stock actual, precios y ubicación física de los productos.',
    inputSchema: z.object({ search: z.string().optional().describe('Marca o nombre del producto para filtrar') }),
    outputSchema: z.any(),
  },
  async (input) => {
    const { firestore } = initializeFirebaseServer();
    const productsRef = collection(firestore, 'products');
    
    let q;
    if (input.search) {
        q = query(productsRef, where('brand', '==', input.search.toUpperCase()), limit(10));
    } else {
        q = query(productsRef, orderBy('stockLevel', 'desc'), limit(20));
    }
    
    const snap = await getDocs(q);
    return snap.docs.map(d => ({
        name: d.data().name,
        sku: d.data().sku,
        stock: d.data().stockLevel,
        price: d.data().price,
        location: d.data().warehouseLocation || 'No asignada'
    }));
  }
);

export const salesAssistantFlow = ai.defineFlow(
  {
    name: 'salesAssistantFlow',
    inputSchema: SalesAssistantInputSchema,
    outputSchema: SalesAssistantOutputSchema,
  },
  async (input) => {
    const response = await ai.generate({
      model: 'googleai/gemini-2.5-flash',
      tools: [getInventoryTool],
      system: `Eres el Asistente Táctico de Athleticenter. 
      Ayudas a vendedores a cerrar tratos analizando stock y pedidos recientes. 
      Instrucciones: Responde siempre en ESPAÑOL de forma profesional.`,
      prompt: `El vendedor (${input.userId}) pregunta: ${input.query}`,
      output: { schema: SalesAssistantOutputSchema }
    });
    return response.output!;
  }
);
