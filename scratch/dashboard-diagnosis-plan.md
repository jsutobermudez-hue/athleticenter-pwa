# 🩺 Diagnóstico Profundo del Dashboard y Cuadros Comparativos

Tras realizar una auditoría exhaustiva de los módulos de cálculo en `AdminDashboard.tsx`, `SalesTrendChart.tsx` y `billing.ts`, he encontrado la causa exacta de la confusión con la "Tendencia de la Mora Crítica", así como el estado del cuadro de vendedores.

## 1. Cuadro Comparativo de Vendedores (Matriz / Barras)
✅ **Estado:** **Funcionando Correctamente.**
*   **Diagnóstico:** El cálculo agrupa correctamente el rendimiento en vivo de cada vendedor. Totaliza las Ventas (órdenes activas), Cobranzas (cash efectivo recolectado) y la Mora Crítica actual.
*   **Mecánica:** Utiliza el estado **actual** de la factura (`getInvoiceFromOrder`). Si un cliente debe $100 y está vencido, se le asigna al vendedor. Si lo paga hoy, desaparece de la mora del vendedor. Esto es **correcto** para ver la "fotografía de hoy".

## 2. Gráfico de Tendencia de la Mora Crítica (Timeline / Curva en el Tiempo)
❌ **Estado:** **Defectuoso (Cálculo Histórico Erróneo).**
*   **Diagnóstico:** Aquí radica el problema que notaste. El gráfico intenta dibujar cómo se comportó la mora en el pasado (ej. día por día en los últimos 30 días). Para hacerlo, le pregunta a la orden: *"¿Estabas en mora el día 15 de este mes?"*.
*   **El Error:** La función subyacente que responde a esa pregunta (`isOrderInMoraCritica`) utiliza la calculadora en vivo, la cual cuenta **todos los pagos hasta el día de HOY**, en lugar de contar solo los pagos que existían hasta ese día 15.
*   **Consecuencia:** Si un cliente cayó en mora hace 20 días, pero **pagó ayer**, el sistema mira la orden hoy, ve que está "Pagada", y **borra retroactivamente** esa mora del gráfico de los últimos 20 días. Por lo tanto, tu línea de tendencia de Mora Crítica nunca muestra picos históricos reales; solo muestra la deuda actual distribuida en el tiempo, lo cual es matemáticamente inútil para medir "tendencias".

## 3. Ventas y Cobranzas (En la Tendencia)
✅ **Estado:** **Funcionando Correctamente.**
*   Las Ventas grafican la suma de las facturas emitidas en cada día.
*   Las Cobranzas revisan el arreglo de `payments` y suman los abonos basándose estrictamente en la `paymentDate` de cada recibo. Esto funciona perfecto.

---

# 🛠️ Plan de Mejoras y Ajustes Propuesto

Para solucionar esto y dejar el Dashboard como una herramienta analítica precisa, propongo ejecutar el siguiente plan:

### Acción 1: Crear Lógica de "Fotografía Histórica" para la Mora
*   Crearé una nueva función en `billing.ts` llamada `getHistoricalMoraAsOfDate(order, targetDate)`.
*   Esta función calculará la fecha de vencimiento (`dueDate`). Si la fecha `targetDate` del gráfico es mayor al vencimiento, calculará cuánto dinero se había pagado **estrictamente hasta ese `targetDate`** (ignorando los pagos posteriores).
*   Si la deuda no estaba cubierta en ese momento del pasado, la sumará a la gráfica. ¡Así verás los picos reales de mora y cómo bajan cuando el cliente finalmente paga!

### Acción 2: Reestructurar el `SalesTrendChart.tsx`
*   Reemplazaré la vieja lógica de `moraTotal` en el mapa de días por la nueva función histórica.
*   Ajustaré la renderización para que la línea roja de "Mora Crítica" represente el **saldo en riesgo real** que existía al final de cada día graficado.

### Acción 3: Optimización del Cuadro de Vendedores
*   Actualmente el "Top Vendedor" se define por el monto de ventas facturadas brutas. Validaré que el cuadro matriz deje muy claro qué es "Ventas" (Facturado) vs "Cobranzas" (Efectivo), para evitar confusiones de lectura.

---
**¿Me autorizas a proceder con la implementación de este plan y la corrección de la curva de tendencia de Mora en el código?**
