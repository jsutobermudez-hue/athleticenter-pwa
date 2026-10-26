# Matriz de Notificaciones y Mensajes (WhatsApp & Push)

Esta matriz detalla todos los modelos de mensajes que la aplicación está programada para emitir de forma automática, a través de nuestro Motor Omnicanal Fantasma (WhatsApp + Notificaciones Push en la App).

## 1. Módulo de Pedidos (Ventas y Depósito)

### 🆕 Creación de Pedido
Se dispara automáticamente cuando un vendedor carga un nuevo pedido en el sistema.
* **Asunto:** `🚨 Nuevo Pedido Registrado`
* **Cuerpo del Mensaje:**
  > El vendedor {Nombre Vendedor} ha registrado el pedido #{ID Pedido} para {Nombre Cliente} por un total de ${Monto} USD.

### ✅ Aprobación de Pedido
Se dispara cuando Gerencia o Administración aprueba el pedido y lo pasa a Depósito.
* **Asunto:** `¡Pedido Aprobado! #{ID Pedido}`
* **Cuerpo del Mensaje:**
  > El pedido de {Nombre Cliente} ha sido movido a fase de preparación.

### ❌ Rechazo de Pedido
Se dispara si un pedido no procede por falta de crédito, inventario u otro motivo.
* **Asunto:** `Pedido Rechazado: #{ID Pedido}`
* **Cuerpo del Mensaje:**
  > Motivo: {Nota del Administrador}. Por {Nombre Supervisor}.

### 📦 Certificación de Picking (Depósito)
Se dispara cuando el almacén termina de armar las cajas físicas.
* **Asunto:** `Picking Certificado #{ID Pedido}`
* **Cuerpo del Mensaje:**
  > El operario {Nombre Operario} ha culminado la recolección. Listo para embalaje y salida.

### 🚚 Despacho y Envío
Se dispara cuando el camión o encomienda sale de la sede con la mercancía.
* **Asunto:** `¡Pedido Despachado! #{ID Pedido}`
* **Cuerpo del Mensaje:**
  > Guía Interna: {Tracking Interno}. Transportista: {Nombre Transporte}.

### 🔄 Conversión Cotización a Pedido
* **Asunto:** `¡Nueva Conversión de Pedido!`
* **Cuerpo del Mensaje:**
  > Folio #{ID Pedido} generado desde cotización #{ID Cotización}.

---

## 2. Módulo de Cotizaciones (Proformas)

### 📝 Nueva Cotización
Se dispara cuando el vendedor le entrega un presupuesto formal a un cliente.
* **Asunto:** `📝 Presupuesto Proforma Creado`
* **Cuerpo del Mensaje:**
  > El vendedor {Nombre Vendedor} ha generado la cotización #{ID Cotización} para {Nombre Cliente} por un total de ${Monto} USD.

### 🔄 Cambio de Estado de Cotización
* **Asunto:** `Estado Actualizado #{ID Cotización}`
* **Cuerpo del Mensaje:**
  > Nuevo estado: {Estado} (Ej. Cancelada/Enviada). Por {Nombre Vendedor}.

---

## 3. Módulo de Tesorería, Facturación y Cobranzas

*(Nota: En la propuesta de automatización "Bot de Tesorería", los mensajes de Deuda serán enviados por esta vía).*

### ⚠️ Recordatorio de Deuda (Cobranza Automática / Bot Tesorería)
Se enviará al cliente con facturas vencidas (Actualmente requiere el clic del botón de Tesorería, se automatizará pronto).
* **Asunto / Cabecera:** `*ATHLETICENTER C.A. - AVISO DE DEUDAS Y ESTADO DE CUENTA*`
* **Cuerpo del Mensaje:**
  > Estimado(a) *{Nombre Cliente}*,
  > 
  > Le saludamos del Departamento de Tesorería. Le recordamos que su cuenta presenta un saldo pendiente por conciliar de:
  > 💰 *Monto Pendiente:* ${Deuda Total} USD
  > ⏳ *Antigüedad Máxima:* {Días} días (Factura #{ID Factura})
  >
  > Agradecemos su valioso apoyo realizando su reporte de pago a la brevedad para mantener habilitado su cupo de crédito. Quedamos atentos a sus comprobantes. ¡Muchas gracias!

### ⏳ Abonos en Verificación
Alerta para Administración cuando los clientes reportan transferencias que deben verificarse en banco.
* **Asunto:** `⚠️ Alerta de Conciliación: {X} Abonos en Verificación`
* **Cuerpo del Mensaje:**
  > Atención Administración: Existen {X} abonos pendientes por conciliar que suman ${Monto Total} USD en caja.

### 📈 Actualización Cambiaria (Tasa BCV)
Se dispara diariamente cuando el bot actualiza la tasa oficial.
* **Asunto:** `📈 Tasa BCV Sincronizada`
* **Cuerpo del Mensaje:**
  > La tasa oficial ha sido actualizada automáticamente de {Tasa Vieja} a {Tasa Nueva} Bs. Precios de catálogo protegidos.

---

## 4. Reportes de Rendimiento y Carteras (Agentes Inteligentes)

Estos mensajes se emiten automáticamente al inicio o fin del día, conteniendo resúmenes ejecutivos para los trabajadores.

### 📊 Estado de Cartera Vendedores (Semanal/Diario)
Se dispara directamente al vendedor asignado.
* **Asunto:** `📅 Resumen Semanal de Cartera: {Nombre Vendedor}`
* **Cuerpo del Mensaje:**
  > Tienes ${Deuda USD} USD en {X} expedientes por cobrar. Descarga tu Estado de Cartera en PDF adjunto.

### 🤖 Motor de Avisos por Rol (Gerencia)
Reporte gerencial consolidado.
* **Asunto:** `📊 Motor de Avisos por Rol Ejecutado`
* **Cuerpo del Mensaje:**
  > Se despacharon los informes de WhatsApp personalizados a {X} usuarios según su rol.

---

## 5. Módulo de Seguridad y Soporte

### 🛡️ Cambios de Perfil Críticos
Aviso de seguridad si un empleado cambia permisos o sufre un hackeo.
* **Asunto:** `Perfil Actualizado: {Nombre Usuario}`
* **Cuerpo del Mensaje:**
  > Cambios de permisos por Superadministrador: {Detalle del permiso escalado}.

### 🆘 Tickets de Soporte Interno
* **Asunto:** `Nuevo Ticket de Soporte: {Asunto}`
* **Cuerpo del Mensaje:**
  > De: {Nombre Solicitante}. Haz clic para ver los detalles en el panel de control.
