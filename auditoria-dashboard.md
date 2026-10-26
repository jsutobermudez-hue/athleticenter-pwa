# 📊 Auditoría y Simulación del Dashboard Interactivo

Este informe documenta la estructura, validación y simulación de impacto de los gráficos analíticos del Dashboard Principal de la aplicación (Executive Metrics, Order Status y Sales Trend).

---

## 1. Módulos Gráficos Auditados

### 📈 Gráfico 1: SalesTrendChart (Tendencias y Flujo de Caja)
- **Función:** Visualiza el rendimiento financiero a través del tiempo.
- **Métricas Duales:** Cruza las "Ventas Brutas" (pedidos facturados) contra las "Cobranzas" (dinero que realmente entró a bancos/caja).
- **Simulación Dinámica:** Si filtras por 7, 30 o 90 días, recalcula dinámicamente el promedio de ventas diarias y dibuja un *AreaChart* donde la curva verde representa los ingresos reales (liquidez) y la curva azul el volumen de operaciones.
- **Exportación:** Permite generar un "Corte Financiero en PDF", estampando la fotografía del gráfico interactivo directamente en el documento.

### 🥧 Gráfico 2: OrderStatusChart (Embudo Logístico y Estatus)
- **Función:** Control operativo de expedientes.
- **Métricas Distribuidas:** Muestra la torta de estados: *Borrador, Revisión, Aprobado, Preparación, Despachado, Cancelado, Facturado.*
- **Simulación Dinámica:** Su interacción permite filtrar toda la tabla inferior de operaciones simplemente tocando una rebanada del pastel. Tiene un panel paralelo para ver el "Funnel de Conversión" (cuántas cotizaciones se vuelven cierres) y otro panel de "Antigüedad" (Aging) para ver las deudas segmentadas.

### 📊 Gráfico 3: ExecutiveMetricsSuite (Matriz Gerencial y Comisiones)
- **Función:** Rendimiento de Recursos Humanos y Clientes Top.
- **Métricas:** Clasifica a los vendedores por volumen de cierre, cálculo de comisiones (liquidaciones) y a los clientes por volumen de compra.
- **Simulación Dinámica:** Este bloque es el pilar de la Gerencia. Permite evaluar en tiempo real si el vendedor "Carlos" superó la meta semanal, renderizando un *BarChart* tricolor y listando las comisiones líquidas devengadas (basado en el cálculo paramétrico configurado en la base de datos).

---

## 2. Simulación de Impacto (Escenario de Trabajo)

Simulemos un ciclo de vida comercial acelerado y observemos cómo reacciona el Dashboard:

**Día 1: Prospección**
1. 3 Vendedores generan 15 cotizaciones por un valor total de $10,000 USD.
2. *Impacto Dashboard:* El `OrderStatusChart` engorda su sección amarilla (Borrador/Cotización). Las métricas financieras globales aún marcan $0 de liquidez.

**Día 3: Cierre y Aprobación**
1. De esas 15 cotizaciones, los clientes aceptan 8, totalizando $6,500 USD.
2. Gerencia aprueba las 8 órdenes. 
3. *Impacto Dashboard:* 
   - El *Funnel de Conversión* salta a una tasa de **53% de efectividad**.
   - El `ExecutiveMetricsSuite` dispara las barras de los vendedores que cerraron, asignando sus comisiones estimadas en tiempo real.
   - El gráfico de estado (`OrderStatusChart`) vacía la sección "Borradores" e incrementa la zona turquesa ("Aprobado").

**Día 5: Despacho y Deuda**
1. Las 8 órdenes salen de almacén. Los clientes pagan 5 de contado ($4,000) y 3 se van a crédito ($2,500).
2. *Impacto Dashboard:*
   - `SalesTrendChart` reacciona agresivamente: Dibuja un pico azul de **$6,500 en Volumen (Ventas)**, pero la curva verde de **Caja Real se queda en $4,000**. Muestra visualmente un déficit de "Cuentas por Cobrar" de $2,500.
   - La matriz de comisiones solo liquida sobre lo cobrado, deteniendo el pago a vendedores por los $2,500 que aún están en la calle.

**Día 12: El Bot Entra en Acción**
1. Los 3 clientes a crédito exceden los 7 días. El **Bot Autónomo de WhatsApp** les cobra automáticamente a las 9:00 AM (implementado hoy).
2. Dos clientes pagan de inmediato por transferencia ($2,000). Tesorería aprueba el dinero.
3. *Impacto Dashboard:*
   - `SalesTrendChart` inyecta un pico tardío verde de $2,000 al flujo de caja.
   - Las comisiones bloqueadas de los vendedores finalmente se liberan en su portal de `ExecutiveMetricsSuite`.
   - La deuda global de la empresa cae a solo $500.

---

### 🛡️ Conclusión de la Auditoría
- Los componentes de *Recharts* responden de manera nativa y síncrona a los filtros de fecha y vendedor.
- El exportador de PDFs (`chart-pdf-exporter`) logra tomar snapshots en SVG y pintarlos con alta fidelidad para presentar cuentas offline.
- El Dashboard ya no es solo una vitrina de datos pasados, sino un Cuadro de Mando Integral **(Balanced Scorecard)** que refleja matemáticamente la efectividad del nuevo sistema omnicanal.
