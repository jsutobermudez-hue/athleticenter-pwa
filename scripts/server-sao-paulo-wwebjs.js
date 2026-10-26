const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json({ limit: '60mb' }));

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.WHATSAPP_GATEWAY_API_KEY || 'local-dev-key';
const PHONE_NUMBER = process.env.PHONE_NUMBER || '584146719204';
const NEXT_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://studio-5015730771-8ece8.web.app';

let isReady = false;
let currentPairingCode = null;

console.log('[WWebJS SP] Iniciando WhatsApp Web con vinculación por código para +' + PHONE_NUMBER + '...');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
    puppeteer: {
        executablePath: '/usr/bin/chromium',
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--single-process'
        ]
    }
});

client.on('qr', async () => {
    try {
        console.log('[WWebJS SP] 📲 Solicitando código de emparejamiento para +' + PHONE_NUMBER + '...');
        const code = await client.requestPairingCode(PHONE_NUMBER);
        currentPairingCode = code;
        console.log('\n=========================================');
        console.log('🔥 TU CÓDIGO DE VINCULACIÓN EN SÃO PAULO: ' + code);
        console.log('Ingresa a: WhatsApp > Dispositivos vinculados > Vincular con número de teléfono');
        console.log('=========================================\n');
    } catch (e) {
        console.error('[WWebJS SP] Error solicitando código:', e.message);
    }
});

client.on('code', (code) => {
    currentPairingCode = code;
    console.log('\n=========================================');
    console.log('🔥 TU CÓDIGO DE VINCULACIÓN EN SÃO PAULO: ' + code);
    console.log('=========================================\n');
});

client.on('ready', () => {
    isReady = true;
    currentPairingCode = null;
    console.log('\n======================================================');
    console.log('✅ WHATSAPP WEB CONECTADO Y 100% OPERATIVO EN SÃO PAULO 24/7');
    console.log('======================================================\n');
});

client.on('authenticated', () => {
    console.log('[WWebJS SP] ✅ Sesión de WhatsApp autenticada correctamente.');
    setTimeout(async () => {
        try {
            const state = await client.getState();
            console.log('[WWebJS SP] Estado del cliente:', state);
            if (state === 'CONNECTED') {
                isReady = true;
            }
        } catch (e) {}
    }, 5000);
});

client.on('auth_failure', (msg) => {
    isReady = false;
    console.error('[WWebJS SP] ❌ Fallo en autenticación:', msg);
});

client.on('disconnected', (reason) => {
    isReady = false;
    console.log('[WWebJS SP] ❌ Cliente desconectado:', reason);
});

// Escuchar mensajes entrantes (respuestas a catálogos)
client.on('message', async (msg) => {
    try {
        if (msg.fromMe || msg.isStatus || !msg.from || !msg.from.endsWith('@c.us')) return;

        const cleanFrom = msg.from.replace('@c.us', '');
        console.log(`[WWebJS SP] 📥 Mensaje entrante de +${cleanFrom}: "${msg.body}"`);

        const webhookUrls = [
            'http://localhost:3000/api/whatsapp-webhook',
            `${NEXT_APP_URL}/api/whatsapp-webhook`
        ];

        for (const url of webhookUrls) {
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        from: cleanFrom,
                        body: msg.body || '',
                        type: msg.type,
                        timestamp: msg.timestamp
                    }),
                    signal: AbortSignal.timeout(6000)
                });
                if (res.ok) break;
            } catch (e) {}
        }
    } catch (err) {
        console.error('[WWebJS SP] Error en webhook:', err.message);
    }
});

client.initialize().catch(err => console.error('[WWebJS SP] Init error:', err));

// Middleware de autenticación
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    next();
};

app.get('/api/status', (req, res) => {
    res.json({
        status: isReady ? 'connected' : 'waiting_auth',
        pairingCode: currentPairingCode,
        phone: PHONE_NUMBER,
        engine: 'whatsapp-web.js Chromium',
        server: 'Sao Paulo 24/7'
    });
});

app.post('/api/send', authMiddleware, async (req, res) => {
    if (!isReady) {
        return res.status(503).json({ success: false, error: 'WhatsApp aún no está conectado en São Paulo' });
    }

    try {
        const { number, text, media, imageUrl } = req.body;
        if (!number || (!text && !imageUrl && !media)) {
            return res.status(400).json({ error: 'Faltan parámetros requeridos' });
        }

        const chatId = `${number}@c.us`;
        let messageId = 'SAOPAULO_SENT_OK';

        // 1. Archivo PDF
        if (media && media.base64) {
            const mediaData = new MessageMedia(
                media.mimetype || 'application/pdf',
                media.base64,
                media.filename || 'Documento.pdf'
            );
            const response = await client.sendMessage(chatId, mediaData, { caption: text || '' });
            messageId = response?.id?._serialized || 'SAOPAULO_SENT_OK';
        }
        // 2. Imagen (URL o Data-URI)
        else if (imageUrl) {
            let contentType = 'image/jpeg';
            let b64 = '';

            if (imageUrl.startsWith('data:')) {
                const parts = imageUrl.split(';base64,');
                contentType = parts[0].replace('data:', '') || 'image/jpeg';
                b64 = parts[1];
            } else if (imageUrl.startsWith('http')) {
                const imgRes = await fetch(imageUrl);
                const arrayBuf = await imgRes.arrayBuffer();
                b64 = Buffer.from(arrayBuf).toString('base64');
                contentType = imgRes.headers.get('content-type') || 'image/jpeg';
            }

            if (b64) {
                const ext = contentType.includes('png') ? '.png' : '.jpg';
                const tempPath = path.join(os.tmpdir(), `wa_sp_${Date.now()}${ext}`);
                fs.writeFileSync(tempPath, Buffer.from(b64, 'base64'));

                const messageMedia = MessageMedia.fromFilePath(tempPath);
                const response = await client.sendMessage(chatId, messageMedia, { caption: text || '' });
                messageId = response?.id?._serialized || 'SAOPAULO_SENT_OK';

                try { fs.unlinkSync(tempPath); } catch (e) {}
            } else {
                const response = await client.sendMessage(chatId, text || '');
                messageId = response?.id?._serialized || 'SAOPAULO_SENT_OK';
            }
        }
        // 3. Solo texto
        else {
            const response = await client.sendMessage(chatId, text || '');
            messageId = response?.id?._serialized || 'SAOPAULO_SENT_OK';
        }

        console.log(`[WWebJS SP] ✅ Mensaje despachado a +${number} (ID: ${messageId})`);
        return res.json({ success: true, messageId, provider: 'saopaulo-wwebjs' });

    } catch (err) {
        console.error('[WWebJS SP] Error en envío:', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// CRON AUTOMÁTICO EN SÃO PAULO: Lunes 10:00 AM y Jueves 02:30 PM (Hora de Venezuela UTC-4)
function initCronJobs() {
    setInterval(async () => {
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const vzlaDate = new Date(utc - (3600000 * 4));
        const day = vzlaDate.getDay();
        const hours = vzlaDate.getHours();
        const minutes = vzlaDate.getMinutes();

        const isMondayCatalog = (day === 1 && hours === 10 && minutes === 0);
        const isThursdayCatalog = (day === 4 && hours === 14 && minutes === 30);

        if ((isMondayCatalog || isThursdayCatalog) && isReady) {
            console.log(`[Cron SP] 🚀 Disparando Catálogo Bi-Semanal... (${hours}:${minutes})`);
            try {
                const catalogUrl = `${NEXT_APP_URL}/api/cron/biweekly-catalog`;
                await fetch(catalogUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ automated: true }),
                    signal: AbortSignal.timeout(120000)
                });
            } catch (err) {}
        }
    }, 60000);
}

initCronJobs();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Gateway WhatsApp Web São Paulo activo en http://0.0.0.0:${PORT}`);
});
