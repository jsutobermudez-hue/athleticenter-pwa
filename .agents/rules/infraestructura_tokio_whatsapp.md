# Regla Oficial de Infraestructura: Gateway WhatsApp 24/7 en Tokio (35.213.77.171) y Protección de Costos GCP

> **IMPORTANTE (Actualización 09/11/2026):** El servidor antiguo de São Paulo (`35.199.85.127` / `athleticenter-server`) fue **ELIMINADO DEFINITIVAMENTE** y migrado a **Tokio, Japón (`athleticenter-tokyo`, IP: `35.213.77.171`)**. **PROHIBIDO** usar la IP antigua `35.199.85.127`.

## 1. Servidor Gateway de WhatsApp 24/7 (`athleticenter-tokyo`)
- **URL Oficial del Gateway de WhatsApp (`WHATSAPP_GATEWAY_SP_URL`):** **`http://35.213.77.171:3001`**
- **Endpoints del Gateway:**
  - Estado y código de vinculación: `http://35.213.77.171:3001/api/status`
  - Código QR en navegador: `http://35.213.77.171:3001/qr`
  - Envío individual: `POST http://35.213.77.171:3001/api/send`
  - Cola de difusión anti-bloqueo: `POST http://35.213.77.171:3001/api/queue`
- **Acceso SSH al Servidor de Tokio (Proyecto GCP: `athleticenter-app2`, Zona: `asia-northeast1-b`):**
  ```powershell
  ssh -i "C:\Users\Justo Noe\.ssh\google_compute_engine" -o StrictHostKeyChecking=no jsutobermudez@35.213.77.171
  ```
- **Ubicación del Gateway en el servidor:** `/home/jsutobermudez/app/whatsapp/baileys-server.js` (administrado por **PM2** bajo el nombre `whatsapp`, junto con el proceso `custodio-c1-c2` de Binance).

## 2. Reglas de Costos en `studio-5015730771-8ece8` y `athleticenter-app2`
1. **Base de datos oficial:** Athleticenter PWA utiliza exclusivamente **Cloud Firestore**. **PROHIBIDO** activar *Firebase Data Connect* o crear instancias de *Cloud SQL PostgreSQL*.
2. **En el servidor GCE (`athleticenter-tokyo`):** **PROHIBIDO** instalar `google-cloud-ops-agent` o activar políticas de snapshots diarios automáticos.
