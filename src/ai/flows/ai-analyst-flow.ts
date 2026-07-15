'use server';
/**
 * @fileOverview Agente IA Analista de Datos para Athleticenter v2.5.
 * Optimizado: Actualizado a Gemini 2.5 Flash para máxima precisión analítica.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { collection, getDocs, query, where, limit, orderBy } from 'firebase/firestore';
import { initializeFirebaseServer } from '@/firebase/server-init';

const AIAnalystInputSchema = z.object({
  query: z.string().describe('Consulta o pregunta del usuario sobre el negocio.'),
  userId: z.string().describe('ID del usuario que realiza la consulta.'),
});

const AIAnalystOutputSchema = z.object({
  answer: z.string().describe('Respuesta narrativa del asistente.'),
  tabularData: z.array(z.record(z.any())).optional().describe('Datos estructurados para mostrar en tabla.'),
  isSimulated: z.boolean().optional().describe('Indica si la respuesta fue generada por el motor de fallback.'),
});

// HERRAMIENTA 1: CONSULTA DE INVENTARIO REAL
const getInventoryData = ai.defineTool(
  {
    name: 'getInventoryData',
    description: 'Consulta stock, precios y marcas de productos en el catálogo real de Athleticenter.',
    inputSchema: z.object({ 
        brand: z.string().optional().describe('Filtrar por marca (ej. Nike, Adidas)'),
        category: z.string().optional().describe('Filtrar por categoría (ej. Balones, Calzado)')
    }),
    outputSchema: z.any(),
  },
  async (input) => {
    const { firestore } = initializeFirebaseServer();
    const productsRef = collection(firestore, 'products');
    let q = query(productsRef, limit(50));
    
    if (input.brand) {
        q = query(productsRef, where('brand', '==', input.brand.toUpperCase()), limit(50));
    }
    
    const snap = await getDocs(q);
    return snap.docs.map(d => {
        const data = d.data();
        return {
            sku: data.sku || 'N/A',
            producto: data.name || 'Sin nombre',
            marca: data.brand || 'N/A',
            stock: Number(data.stockLevel || 0),
            precio: `$${Number(data.price || 0).toFixed(2)}`
        };
    });
  }
);

// HERRAMIENTA 2: DESEMPEÑO DE VENTAS REAL
const getSalesPerformance = ai.defineTool(
  {
    name: 'getSalesPerformance',
    description: 'Analiza el volumen de pedidos y recaudación real reciente desde Firestore.',
    inputSchema: z.object({ days: z.number().optional().default(30) }),
    outputSchema: z.any(),
  },
  async (input) => {
    const { firestore } = initializeFirebaseServer();
    const ordersRef = collection(firestore, 'orders');
    const snap = await getDocs(query(ordersRef, orderBy('orderDate', 'desc'), limit(50)));
    
    return snap.docs.map(d => {
        const data = d.data();
        let fechaStr = '---';
        if (data.orderDate) {
            try {
                const date = data.orderDate.toDate ? data.orderDate.toDate() : new Date(data.orderDate.seconds * 1000);
                fechaStr = date.toLocaleDateString();
            } catch (e) { fechaStr = 'Fecha inválida'; }
        }

        return {
            pedido: d.id.substring(0, 8),
            cliente: data.customerName || 'Cliente desconocido',
            monto: `$${Number(data.totalAmount || 0).toFixed(2)}`,
            estado: data.status || 'Pendiente',
            fecha: fechaStr
        };
    });
  }
);

// HERRAMIENTA 3: RED LOGÍSTICA
const getCarrierMetrics = ai.defineTool(
    {
      name: 'getCarrierMetrics',
      description: 'Analiza la red de transportistas y sus tiempos promedio de entrega.',
      inputSchema: z.object({}),
      outputSchema: z.any(),
    },
    async () => {
      const { firestore } = initializeFirebaseServer();
      const carriersRef = collection(firestore, 'carriers');
      const snap = await getDocs(carriersRef);
      
      return snap.docs.map(d => {
          const data = d.data();
          return {
              empresa: data.name || 'N/A',
              promedio_horas: data.avgDeliveryHours || 'Sin datos',
              estado: data.status || 'Activo',
              total_auditorias: data.totalDeliveriesAudit || 0
          };
      });
    }
  );

export const aiAnalystFlow = ai.defineFlow(
  {
    name: 'aiAnalystFlow',
    inputSchema: AIAnalystInputSchema,
    outputSchema: AIAnalystOutputSchema,
  },
  async (input) => {
    try {
        const response = await ai.generate({
          model: 'googleai/gemini-2.5-flash',
          tools: [getInventoryData, getSalesPerformance, getCarrierMetrics],
          system: `Eres el Analista IA de Athleticenter Pro v2.5. Tu misión es extraer valor de la base de datos para la gerencia.
          
          INSTRUCCIONES:
          1. Si preguntan por productos, marcas o stock, usa 'getInventoryData'.
          2. Si preguntan por ventas, pedidos o dinero recaudado, usa 'getSalesPerformance'.
          3. Si preguntan por eficiencia de envíos o transportistas, usa 'getCarrierMetrics'.
          4. Responde siempre en ESPAÑOL profesional.
          5. IMPORTANTE: Siempre devuelve un objeto JSON que coincida exactamente con AIAnalystOutputSchema.`,
          prompt: input.query,
          output: { schema: AIAnalystOutputSchema }
        });
        
        const output = response.output;
        if (!output) throw new Error("El modelo no generó una respuesta válida.");

        return { ...output, isSimulated: false };
    } catch (e: any) {
        return {
            answer: "Bienvenido al Mando Analítico. Para activar la inteligencia real de Gemini, debes configurar la variable GOOGLE_GENAI_API_KEY. Actualmente opero en modo estructural.",
            tabularData: [
                { KPI: "ESTADO RED", VALOR: "NOMINAL", STATUS: "READY" },
                { KPI: "CONEXIÓN IA", VALOR: "OFFLINE", STATUS: "PENDING_KEY" }
            ],
            isSimulated: true
        };
    }
  }
);
