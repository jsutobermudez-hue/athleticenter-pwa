const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = 3001;
const API_KEY = 'local-dev-key'; // Debe coincidir con WHATSAPP_GATEWAY_API_KEY en .env.local

console.log('Iniciando servicio local de WhatsApp...');

// Inicializar cliente de WhatsApp con sesión guardada localmente
// Vinculacion por CODIGO (sin QR): definir WA_PAIR_PHONE=58414XXXXXXX al iniciar
const PAIR_PHONE = (process.env.WA_PAIR_PHONE || '').replace(/[^\d]/g, '');

const client = new Client({
    authStrategy: new LocalAuth(),
    ...(PAIR_PHONE ? { pairWithPhoneNumber: { phoneNumber: PAIR_PHONE, showNotification: true, intervalMs: 180000 } } : {}),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

let isReady = false;

// Helper para reintentar el envío en caso de frames desprendidos de Puppeteer
async function sendWithRetry(chatId, content, options = {}, retries = 2) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await client.sendMessage(chatId, content, options);
        } catch (err) {
            console.warn(`[WhatsApp Local] Intento de envío ${attempt}/${retries} falló:`, err.message);
            if (err.message && err.message.includes('id property')) {
                try {
                    const chat = await client.getChatById(chatId);
                    if (chat) {
                        return await chat.sendMessage(content, options);
                    }
                } catch (chatErr) {
                    console.warn(`[WhatsApp Local] Intento vía chat falló:`, chatErr.message);
                }
            }
            if (attempt === retries) throw err;
            await new Promise(res => setTimeout(res, 1500));
        }
    }
}

client.on('qr', (qr) => {
    isReady = false;
    console.log('\n=========================================================');
    console.log('¡ESCANEA ESTE CÓDIGO QR CON TU WHATSAPP PARA CONECTAR!');
    console.log('=========================================================\n');
    qrcode.generate(qr, { small: true }); console.log('RAW_QR: ', qr);
});

client.on('code', (code) => {
    isReady = false;
    console.log('\n=========================================================');
    console.log(`CÓDIGO DE VINCULACIÓN PARA +${PAIR_PHONE}:  ${code}`);
    console.log('WhatsApp > Dispositivos vinculados > Vincular con número de teléfono');
    console.log('=========================================================\n');
});

client.on('loading_screen', (percent, message) => {
    console.log(`[WhatsApp Local] Cargando chats: ${percent}% - ${message}`);
});

client.on('ready', () => {
    isReady = true;
    console.log('✅ Cliente de WhatsApp conectado y listo para enviar mensajes.');
});

client.on('authenticated', () => {
    console.log('✅ Sesión de WhatsApp autenticada correctamente.');
    // Si ya está autenticado, verificar estado
    setTimeout(async () => {
        try {
            const state = await client.getState();
            console.log('[WhatsApp Local] Estado del cliente:', state);
            if (state === 'CONNECTED') {
                isReady = true;
                console.log('✅ Cliente marcado como listo (Estado: CONNECTED).');
            }
        } catch (err) {
            console.log('[WhatsApp Local] Esperando evento ready...');
        }
    }, 5000);
});

client.on('auth_failure', msg => {
    isReady = false;
    console.error('❌ Fallo en la autenticación de WhatsApp:', msg);
});

client.on('disconnected', (reason) => {
    isReady = false;
    console.log('❌ Cliente de WhatsApp desconectado:', reason);
});

// Reenvío de mensajes entrantes de clientes al Webhook de Next.js
client.on('message', async (msg) => {
    try {
        // Ignorar mensajes enviados por nosotros, estados de WhatsApp o mensajes de grupo
        if (msg.fromMe || msg.isStatus || !msg.from || !msg.from.endsWith('@c.us')) return;

        const cleanFrom = msg.from.replace('@c.us', '');
        console.log(`[WhatsApp Local] 📥 Mensaje entrante de +${cleanFrom}: "${msg.body}"`);

        const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL || 'http://localhost:3000/api/whatsapp-webhook';
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: cleanFrom,
                body: msg.body || '',
                type: msg.type,
                timestamp: msg.timestamp
            })
        });

        if (!res.ok) {
            console.warn(`[WhatsApp Local] Webhook respondió con status ${res.status}`);
        } else {
            const data = await res.json().catch(() => ({}));
            if (data.action) {
                console.log(`[WhatsApp Local] 🤖 Acción ejecutada por webhook: ${data.action}`);
            }
        }
    } catch (err) {
        console.error('[WhatsApp Local] Error enviando mensaje a webhook:', err.message);
    }
});

// Arrancar el cliente
client.initialize();

// Middleware de autenticación básica
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    next();
};

// Endpoint que emula al Gateway en la nube
app.post('/api/send', authMiddleware, async (req, res) => {
    if (!isReady) {
        return res.status(503).json({ success: false, error: 'El servidor local de WhatsApp aún no ha completado la conexión o el escaneo del código QR.' });
    }

    try {
        const { number, text, media, imageUrl, orderId } = req.body;

        if (!number || (!text && !imageUrl && !media)) {
            return res.status(400).json({ error: 'El número y el contenido son obligatorios' });
        }

        // whatsapp-web.js requiere el formato 'numero@c.us'
        const chatId = `${number}@c.us`;

        let messageId = 'LOCAL_SENT';

        // 1. Si viene un archivo en base64 (PDF / Imagen base64)
        if (media && media.base64) {
            const mediaData = new MessageMedia(
                media.mimetype || 'application/pdf',
                media.base64,
                media.filename || 'Documento.pdf'
            );
            
            const response = await sendWithRetry(chatId, mediaData, { caption: text || '' });
            messageId = response?.id?._serialized || response?.id?.id || String(response?.id || 'LOCAL_SENT');
        } 
        // 2. Si viene una URL o data-URI de imagen (campañas de marketing, fotos de inventario)
        else if (imageUrl) {
            try {
                let contentType = 'image/jpeg';
                let b64 = '';

                // Caso A: Imagen en formato Data URI (data:image/jpeg;base64,...) directo de Firestore
                if (imageUrl.startsWith('data:')) {
                    console.log(`[WhatsApp Local] 🖼️ Procesando imagen interna de inventario (Data URI)...`);
                    const parts = imageUrl.split(';base64,');
                    contentType = parts[0].replace('data:', '') || 'image/jpeg';
                    b64 = parts[1] || '';
                } 
                // Caso B: URL externa HTTP/HTTPS
                else {
                    console.log(`[WhatsApp Local] 🖼️ Descargando imagen externa: ${imageUrl.substring(0, 80)}...`);
                    const imgRes = await fetch(imageUrl);
                    if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
                    const arrayBuffer = await imgRes.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    b64 = buffer.toString('base64');
                    contentType = imgRes.headers.get('content-type') || 'image/jpeg';
                }

                if (!b64) throw new Error('Contenido base64 de imagen vacío');

                const ext = contentType.includes('png') ? '.png' : (contentType.includes('webp') ? '.webp' : '.jpg');
                const tempPath = path.join(os.tmpdir(), `wa_up_${Date.now()}${ext}`);
                fs.writeFileSync(tempPath, Buffer.from(b64, 'base64'));

                const mediaData = MessageMedia.fromFilePath(tempPath);
                const response = await sendWithRetry(chatId, mediaData, { caption: text || '' });
                messageId = response?.id?._serialized || response?.id?.id || String(response?.id || 'LOCAL_SENT');

                try { fs.unlinkSync(tempPath); } catch (_) {}
            } catch (imgErr) {
                console.warn(`[WhatsApp Local] ⚠️ Error enviando imagen, enviando solo texto:`, imgErr.message);
                const response = await sendWithRetry(chatId, text || '');
                messageId = response?.id?._serialized || response?.id?.id || String(response?.id || 'LOCAL_SENT');
            }
        } 
        // 3. Solo texto
        else {
            const response = await sendWithRetry(chatId, text);
            messageId = response?.id?._serialized || response?.id?.id || String(response?.id || 'LOCAL_SENT');
        }

        console.log(`[WhatsApp Local] ✅ Mensaje enviado a ${number} (Orden: ${orderId || 'N/A'})`);
        return res.status(200).json({ success: true, messageId });
    } catch (error) {
        console.error('[WhatsApp Local] ❌ Error enviando mensaje:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor Gateway de WhatsApp escuchando en http://localhost:${PORT}`);
});


// ==========================================
// Cron Job de Cobranza Automática (Bot de Tesorería)
// ==========================================
function startDebtCollectionCron() {
  console.log('[Cron] Iniciando temporizador para Bot de Cobranza (Cada 24h)');
  
  // Función que dispara la API de Next.js
  const triggerDebtCollection = async () => {
    try {
      console.log('[Cron] 🚀 Ejecutando Bot de Cobranza Automática...');
      const res = await fetch('http://localhost:3000/api/cron/debt-collection', {
        method: 'POST'
      });
      const data = await res.json();
      console.log('[Cron] ✅ Resultado de cobranza:', data);
    } catch (error) {
      console.error('[Cron] ❌ Error contactando API de cobranza:', error.message);
    }
  };

  // Ejecutar una vez al día (24 horas = 86400000 ms)
  setInterval(triggerDebtCollection, 86400000);
  
  // Ejecutamos la primera vez en 10 minutos (para asegurar que Next.js ya arrancó)
  setTimeout(triggerDebtCollection, 10 * 60 * 1000);
}

// ==========================================
// Cron Job: GEMINI CLOSER (Rescate de Cotizaciones) — todos los días a las 10:00 AM
// Se programa a hora fija para no escribirle a clientes de madrugada.
// ==========================================
function scheduleDailyAt(hour, minute, task) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const wait = next.getTime() - now.getTime();
  console.log(`[Cron] Próxima ejecución programada: ${next.toLocaleString()}`);
  setTimeout(() => {
    task();
    setInterval(task, 86400000);
  }, wait);
}

function startCloserAgentCron() {
  console.log('[Cron] Iniciando temporizador para Gemini Closer (diario 10:00 AM)');
  scheduleDailyAt(10, 0, async () => {
    try {
      console.log('[Cron] 🤝 Ejecutando Gemini Closer (rescate de cotizaciones)...');
      const res = await fetch('http://localhost:3000/api/cron/closer-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false })
      });
      const data = await res.json();
      console.log(`[Cron] ✅ Gemini Closer: escaneadas ${data.scanned}, elegibles ${data.eligible}, enviadas ${data.sent}`);
    } catch (error) {
      console.error('[Cron] ❌ Error contactando Gemini Closer:', error.message);
    }
  });
}

// ==========================================
// Cron Job: CATÁLOGO BI-SEMANAL (LUNES 10:00 AM Y JUEVES 2:30 PM)
// ==========================================
function scheduleWeeklyAt(dayOfWeek, hour, minute, task) {
  // dayOfWeek: 1 = Lunes, 4 = Jueves (0 = Domingo)
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);

  let daysDiff = (dayOfWeek - now.getDay() + 7) % 7;
  if (daysDiff === 0 && next <= now) {
    daysDiff = 7;
  }
  next.setDate(now.getDate() + daysDiff);

  const wait = next.getTime() - now.getTime();
  console.log(`[Cron Catálogo] Próximo envío programado (Día ${dayOfWeek} ${hour}:${String(minute).padStart(2, '0')}): ${next.toLocaleString()}`);

  setTimeout(() => {
    task();
    setInterval(task, 7 * 86400000);
  }, wait);
}

function startBiweeklyCatalogCron() {
  console.log('[Cron] Iniciando temporizador para Catálogo Bi-Semanal (Lunes 10:00 AM y Jueves 2:30 PM)');

  const triggerCatalog = async (dayLabel) => {
    try {
      console.log(`[Cron Catálogo] 🚀 Ejecutando envío del Catálogo Bi-Semanal (${dayLabel})...`);
      const res = await fetch('http://localhost:3000/api/cron/biweekly-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false })
      });
      const data = await res.json();
      console.log('[Cron Catálogo] ✅ Resultado de catálogo:', data);
    } catch (err) {
      console.error('[Cron Catálogo] ❌ Error contactando API de catálogo:', err.message);
    }
  };

  // Lunes a las 10:00 AM (1)
  scheduleWeeklyAt(1, 10, 0, () => triggerCatalog('Lunes - Inicio de Semana'));

  // Jueves a las 14:30 (2:30 PM) (4)
  scheduleWeeklyAt(4, 14, 30, () => triggerCatalog('Jueves - Fin de Semana'));
}

// Iniciar cron cuando WhatsApp está listo
client.on('ready', () => {
  if (global.cronStarted) return;
  global.cronStarted = true;
  startDebtCollectionCron();
  startCloserAgentCron();
  startBiweeklyCatalogCron();
});
