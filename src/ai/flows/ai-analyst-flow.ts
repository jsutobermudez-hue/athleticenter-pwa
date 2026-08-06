'use server';
/**
 * @fileOverview Agente IA Analista de Datos Omnisciente para Athleticenter Pro v3.0.
 * Potenciado con Gemini 2.5 Flash: Herramientas para ventas globales, productos estrella/balones,
 * auditoría de clientes/mora, rendimiento de vendedores, predicción de stock y redacción para WhatsApp.
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
  answer: z.string().describe('Respuesta narrativa del asistente con estrategia o recomendación.'),
  tabularData: z.array(z.record(z.any())).optional().describe('Datos estructurados para mostrar en tabla.'),
  isSimulated: z.boolean().optional().describe('Indica si la respuesta fue generada por el motor de fallback.'),
});

// HERRAMIENTA 1: MÉTRICAS GLOBALES DE VENTAS Y COBRANZAS
const getGlobalSalesMetrics = ai.defineTool(
  {
    name: 'getGlobalSalesMetrics',
    description: 'Calcula las ventas totales globales en USD, dinero cobrado en efectivo, saldo pendiente por cobrar, ticket promedio y conteo por estado de orden.',
    inputSchema: z.object({
      days: z.number().optional().default(180).describe('Días a considerar (ej. 7, 30, 180)')
    }),
    outputSchema: z.any(),
  },
  async (input) => {
    const { firestore } = initializeFirebaseServer();
    const ordersRef = collection(firestore, 'orders');
    const snap = await getDocs(query(ordersRef, limit(200)));

    const VALID_SALES = ['Entregado', 'Completado', 'Despachado', 'Pagado', 'Aprobado', 'En Preparación'];

    let totalSalesUSD = 0;
    let totalCashCollectedUSD = 0;
    let totalPendingCreditUSD = 0;
    let completedCount = 0;
    let pendingCount = 0;
    let cancelledCount = 0;

    const ordersData = snap.docs.map(d => d.data());
    
    ordersData.forEach(o => {
      const amount = Number(o.totalAmount || 0);
      const paid = Number(o.amountPaid || 0);
      const status = o.status || 'Pendiente';

      if (VALID_SALES.includes(status)) {
        totalSalesUSD += amount;
        if (status === 'Pagado') {
          totalCashCollectedUSD += amount;
        } else {
          totalCashCollectedUSD += paid;
          totalPendingCreditUSD += Math.max(0, amount - paid);
        }
      }

      if (['Completado', 'Entregado', 'Pagado'].includes(status)) completedCount++;
      if (['Pendiente', 'Aprobado', 'En Preparación'].includes(status)) pendingCount++;
      if (status === 'Cancelado') cancelledCount++;
    });

    const totalOrders = ordersData.length;
    const avgTicketUSD = totalOrders > 0 ? totalSalesUSD / (totalOrders || 1) : 0;

    return {
      resumen: {
        ventasTotalesUSD: `$${totalSalesUSD.toFixed(2)}`,
        cobranzasEfectivoUSD: `$${totalCashCollectedUSD.toFixed(2)}`,
        saldoPorCobrarUSD: `$${totalPendingCreditUSD.toFixed(2)}`,
        ticketPromedioUSD: `$${avgTicketUSD.toFixed(2)}`,
        totalPedidosProcesados: totalOrders,
        pedidosFinalizados: completedCount,
        pedidosEnProceso: pendingCount,
        pedidosCancelados: cancelledCount
      }
    };
  }
);

// HERRAMIENTA 2: RANKING DE PRODUCTOS Y BALONES MÁS VENDIDOS
const getTopProductsAndRankings = ai.defineTool(
  {
    name: 'getTopProductsAndRankings',
    description: 'Consulta los productos y balones más vendidos según el contador histórico totalSold, nivel de stock actual y precio.',
    inputSchema: z.object({
      category: z.string().optional().describe('Filtrar por categoría (ej. Balones, Calzado, Indumentaria)'),
      limitCount: z.number().optional().default(15).describe('Número de productos a retornar')
    }),
    outputSchema: z.any(),
  },
  async (input) => {
    const { firestore } = initializeFirebaseServer();
    const productsRef = collection(firestore, 'products');
    const snap = await getDocs(query(productsRef, limit(100)));

    let products = snap.docs.map(d => {
      const data = d.data();
      return {
        sku: data.sku || 'N/A',
        producto: data.name || 'Producto Sin Nombre',
        marca: data.brand || 'N/A',
        categoria: data.category || 'General',
        totalVendidoUnidades: Number(data.totalSold || 0),
        stockDisponible: Number(data.stockLevel || 0),
        precioListaUSD: `$${Number(data.price || 0).toFixed(2)}`
      };
    });

    if (input.category) {
      const catLower = input.category.toLowerCase();
      products = products.filter(p => p.categoria.toLowerCase().includes(catLower) || p.producto.toLowerCase().includes(catLower));
    }

    // Ordenar descendentemente por unidades vendidas
    products.sort((a, b) => b.totalVendidoUnidades - a.totalVendidoUnidades);

    return products.slice(0, input.limitCount || 15);
  }
);

// HERRAMIENTA 3: DESEMPEÑO DEL EQUIPO DE VENDEDORES
const getSalespeoplePerformance = ai.defineTool(
  {
    name: 'getSalespeoplePerformance',
    description: 'Analiza el rendimiento del equipo de ventas, total colocado en USD por vendedor, comisiones generadas y número de pedidos.',
    inputSchema: z.object({}),
    outputSchema: z.any(),
  },
  async () => {
    const { firestore } = initializeFirebaseServer();
    const ordersRef = collection(firestore, 'orders');
    const snap = await getDocs(query(ordersRef, limit(200)));

    const salesMap: Record<string, { vendedor: string; totalVentasUSD: number; pedidosCount: number; comisionesEstimadasUSD: number }> = {};

    snap.docs.forEach(d => {
      const data = d.data();
      const name = data.salespersonName || 'Vendedor Desconocido';
      const amount = Number(data.totalAmount || 0);

      if (!salesMap[name]) {
        salesMap[name] = { vendedor: name, totalVentasUSD: 0, pedidosCount: 0, comisionesEstimadasUSD: 0 };
      }

      salesMap[name].totalVentasUSD += amount;
      salesMap[name].pedidosCount += 1;
      salesMap[name].comisionesEstimadasUSD += (amount * 0.05); // 5% comisión base
    });

    const result = Object.values(salesMap).map(v => ({
      vendedor: v.vendedor,
      totalVentasUSD: `$${v.totalVentasUSD.toFixed(2)}`,
      pedidosColocados: v.pedidosCount,
      comisionGeneradaUSD: `$${v.comisionesEstimadasUSD.toFixed(2)}`
    }));

    result.sort((a, b) => parseFloat(b.totalVentasUSD.replace('$', '')) - parseFloat(a.totalVentasUSD.replace('$', '')));
    return result;
  }
);

// HERRAMIENTA 4: AUDITORÍA DE CARTERA DE CLIENTES Y MORA
const getClientPortfolioAudit = ai.defineTool(
  {
    name: 'getClientPortfolioAudit',
    description: 'Consulta el estado de la cartera de clientes, límite de crédito, crédito consumido y antigüedad de morosidad.',
    inputSchema: z.object({
      filterStatus: z.enum(['todos', 'mora', 'activos']).optional().default('todos')
    }),
    outputSchema: z.any(),
  },
  async (input) => {
    const { firestore } = initializeFirebaseServer();
    const customersRef = collection(firestore, 'customers');
    const snap = await getDocs(query(customersRef, limit(100)));

    const clients = snap.docs.map(d => {
      const data = d.data();
      const creditLimit = Number(data.creditLimit || 0);
      const creditUsed = Number(data.creditUsed || 0);
      const status = data.status || 'Activo';

      return {
        cliente: data.razonSocial || data.name || 'Cliente N/A',
        rif: data.rif || 'N/A',
        telefono: data.phone || 'N/A',
        estado: status,
        limiteCreditoUSD: `$${creditLimit.toFixed(2)}`,
        creditoConsumidoUSD: `$${creditUsed.toFixed(2)}`,
        creditoDisponibleUSD: `$${Math.max(0, creditLimit - creditUsed).toFixed(2)}`,
        vendedorAsignado: data.assignedSalespersonName || 'Sin Asignar'
      };
    });

    if (input.filterStatus === 'mora') {
      return clients.filter(c => parseFloat(c.creditoConsumidoUSD.replace('$', '')) > 0);
    }

    return clients;
  }
);

// HERRAMIENTA 5: PREDICCIÓN DE AGOTAMIENTO DE INVENTARIO
const predictStockOut = ai.defineTool(
  {
    name: 'predictStockOut',
    description: 'Analiza productos con stock bajo o velocidad alta de venta para predecir cuándo se agotarán e indicar la orden de compra sugerida.',
    inputSchema: z.object({}),
    outputSchema: z.any(),
  },
  async () => {
    const { firestore } = initializeFirebaseServer();
    const productsRef = collection(firestore, 'products');
    const snap = await getDocs(query(productsRef, limit(100)));

    const alertProducts = snap.docs.map(d => {
      const data = d.data();
      const stock = Number(data.stockLevel || 0);
      const totalSold = Number(data.totalSold || 0);

      // Si el stock es <= 15 o si las ventas superan 30 unidades
      const isLowStock = stock <= 15;
      const isHighDemand = totalSold >= 30;

      if (isLowStock || isHighDemand) {
        const estimatedDaysLeft = stock > 0 ? Math.ceil(stock / Math.max(1, (totalSold / 90))) : 0;
        return {
          sku: data.sku || 'N/A',
          producto: data.name || 'Sin nombre',
          marca: data.brand || 'N/A',
          stockActual: stock,
          ventasHistoricas: totalSold,
          diasEstimadosAgotamiento: estimatedDaysLeft <= 0 ? '¡AGOTADO!' : `${estimatedDaysLeft} días`,
          sugerenciaRecompraUnidades: Math.max(50, totalSold > 0 ? Math.ceil(totalSold * 0.5) : 50)
        };
      }
      return null;
    }).filter(Boolean);

    return alertProducts;
  }
);

// HERRAMIENTA 6: GENERADOR DE MENSAJES COMERCIALES PARA WHATSAPP
const generateSalesOutreach = ai.defineTool(
  {
    name: 'generateSalesOutreach',
    description: 'Genera un mensaje comercial persuasivo en español listo para enviar por WhatsApp a un cliente para reactivar compras o promocionar balones.',
    inputSchema: z.object({
      customerName: z.string().describe('Nombre del cliente o razón social'),
      productOrOffer: z.string().describe('Producto a promocionar o motivo del mensaje')
    }),
    outputSchema: z.any(),
  },
  async (input) => {
    return {
      mensajeWhatsApp: `¡Hola equipo de ${input.customerName}! 👋 Le saludamos de Athleticenter C.A. 🏆 Queremos notificarles que tenemos disponibilidad exclusiva en ${input.productOrOffer} con condiciones de pronto pago y despacho inmediato. ¿Le reservamos un lote para su inventario esta semana? 📦⚽`,
      recomendacion: "Copia este texto y envíalo directamente por WhatsApp para activar el pedido."
    };
  }
);

// HERRAMIENTA 7: INVENTARIO REAL
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
            totalVendido: Number(data.totalSold || 0),
            stock: Number(data.stockLevel || 0),
            precio: `$${Number(data.price || 0).toFixed(2)}`
        };
    });
  }
);

// HERRAMIENTA 8: RED LOGÍSTICA Y TRANSPORTISTAS
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
          tools: [
            getGlobalSalesMetrics,
            getTopProductsAndRankings,
            getSalespeoplePerformance,
            getClientPortfolioAudit,
            predictStockOut,
            generateSalesOutreach,
            getInventoryData,
            getCarrierMetrics
          ],
          system: `Eres el Analista IA Omnisciente y Consultor Estratégico Senior de Athleticenter Pro v3.0.
          Tu misión es analizar profundamente los datos del negocio y responder cualquier consulta con máxima precisión, ofreciendo diagnósticos y planes estratégicos ejecutivos para aumentar las ventas.
          
          INSTRUCCIONES CLAVE:
          1. Si preguntan por ventas totales, cobranzas o números globales, usa 'getGlobalSalesMetrics'.
          2. Si preguntan por los balones o productos más vendidos, más consultados o ranking, usa 'getTopProductsAndRankings'.
          3. Si preguntan por el rendimiento de los vendedores o comisiones, usa 'getSalespeoplePerformance'.
          4. Si preguntan por clientes en mora, crédito o activación de cuentas, usa 'getClientPortfolioAudit'.
          5. Si preguntan por productos por agotarse o reabastecimiento predictivo, usa 'predictStockOut'.
          6. Si piden redactar un mensaje para un cliente o WhatsApp, usa 'generateSalesOutreach'.
          7. Si el usuario pide estrategias para aumentar ventas de un producto o vendedor, primero extrae los datos empíricos de las herramientas y luego redacta un Plan Estratégico Ejecutivo claro con 3 a 5 acciones concretas fundamentadas en los números reales.
          8. Responde siempre en ESPAÑOL profesional.`,
          prompt: input.query,
        });
        
        const rawText = response.text || '';
        if (!rawText) throw new Error("El modelo no generó una respuesta de texto.");
        
        let answerText = rawText;
        let tabularData: any[] = [];

        // Trata de extraer un JSON estricto si el modelo lo generó
        try {
          const match = rawText.match(/```json\s*([\s\S]*?)\s*```/) || rawText.match(/\{[\s\S]*"answer"[\s\S]*\}/);
          if (match) {
            const jsonString = match[1] || match[0];
            const parsed = JSON.parse(jsonString);
            if (parsed.answer) answerText = parsed.answer;
            if (Array.isArray(parsed.tabularData)) tabularData = parsed.tabularData;
          }
        } catch (jsonErr) {
          // Si no es un JSON o no se pudo parsear, se usa la respuesta Markdown directamente sin fallar
          answerText = rawText;
        }

        return { 
          answer: answerText, 
          tabularData: tabularData, 
          isSimulated: false 
        };
    } catch (e: any) {
        console.error("Error in aiAnalystFlow:", e);
        const hasApiKey = Boolean(process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY);
        
        return {
            answer: hasApiKey 
              ? `Diagnostic Error: ${e?.message || 'Error al procesar la respuesta del modelo'}`
              : "Bienvenido al Mando Analítico Omnisciente. Para activar la inteligencia real de Gemini 2.5 Flash, debes configurar la variable GOOGLE_GENAI_API_KEY. Actualmente opero en modo estructural.",
            tabularData: [
                { KPI: "ESTADO RED", VALOR: "NOMINAL", STATUS: "READY" },
                { KPI: "DETALLE ERROR", VALOR: String(e?.message || 'N/A').substring(0, 40), STATUS: "DEBUG" }
            ],
            isSimulated: true
        };
    }
  }
);
