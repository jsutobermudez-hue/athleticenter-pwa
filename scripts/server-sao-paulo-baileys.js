const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '60mb' }));

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.WHATSAPP_GATEWAY_API_KEY || 'local-dev-key';
const PHONE_NUMBER = '584146719204';
const NEXT_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://studio-5015730771-8ece8.web.app';

let sock = null;
let isConnected = false;
let currentPairingCode = null;
let codeRequested = false;

const authDir = path.join(__dirname, 'auth_info_baileys');
if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
}

async function startWhatsApp() {
    console.log('[Baileys SP] 🚀 Iniciando conexión para +' + PHONE_NUMBER + '...');
    codeRequested = false;

    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            isConnected = false;
            currentPairingCode = null;
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log('[Baileys SP] Conexión cerrada. Status:', statusCode, 'Reconectando:', shouldReconnect);
            
            if (shouldReconnect) {
                setTimeout(startWhatsApp, 4000);
            } else {
                console.log('[Baileys SP] Desconectado por usuario. Limpiando credenciales...');
                try {
                    fs.rmSync(authDir, { recursive: true, force: true });
                    fs.mkdirSync(authDir, { recursive: true });
                } catch(e) {}
                setTimeout(startWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            isConnected = true;
            currentPairingCode = null;
            codeRequested = false;
            console.log('\n======================================================');
            console.log('✅ WHATSAPP CONECTADO Y 100% OPERATIVO EN SÃO PAULO 24/7');
            console.log('======================================================\n');
        }

        // Solicitar código rápido si no está registrado
        if (sock && !sock.authState.creds.registered && !isConnected && !codeRequested) {
            codeRequested = true;
            await delay(1500);

            try {
                const code = await sock.requestPairingCode(PHONE_NUMBER);
                currentPairingCode = code;
                console.log('\n=========================================');
                console.log('🔥 TU CÓDIGO ÚNICO DE VINCULACIÓN: ' + code);
                console.log('Ingresa a: WhatsApp > Dispositivos vinculados > Vincular con número de teléfono');
                console.log('=========================================\n');
            } catch (err) {
                console.error('[Baileys SP] Error solicitando código:', err.message);
                setTimeout(() => { codeRequested = false; }, 30000);
            }
        }
    });

    // Escuchar mensajes entrantes (respuestas a catálogos)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return;
            for (const msg of messages) {
                if (msg.key.fromMe) continue;
                const remoteJid = msg.key.remoteJid || '';
                if (!remoteJid.endsWith('@s.whatsapp.net')) continue;

                const cleanFrom = remoteJid.replace('@s.whatsapp.net', '');
                const body = msg.message?.conversation || 
                             msg.message?.extendedTextMessage?.text || 
                             msg.message?.imageMessage?.caption || '';

                if (!body) continue;

                console.log(`[Baileys SP] 📥 Mensaje entrante de +${cleanFrom}: "${body}"`);

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
                                body: body,
                                timestamp: msg.messageTimestamp
                            }),
                            signal: AbortSignal.timeout(6000)
                        });
                        if (res.ok) break;
                    } catch (e) {}
                }
            }
        } catch (e) {
            console.error('[Baileys SP] Error webhook:', e.message);
        }
    });
}

startWhatsApp();

// Estado del Gateway
app.get('/api/status', (req, res) => {
    res.json({
        status: isConnected ? 'connected' : 'waiting_auth',
        pairingCode: currentPairingCode,
        phone: PHONE_NUMBER,
        server: 'Sao Paulo 24/7'
    });
});

// Endpoint principal para envío de mensajes, imágenes y PDFs
app.post('/api/send', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== 'Bearer ' + API_KEY) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    const { number, text, imageUrl, media } = req.body;
    if (!number || (!text && !imageUrl && !media)) {
        return res.status(400).json({ error: 'Faltan parámetros obligatorios' });
    }

    if (!isConnected || !sock) {
        return res.status(503).json({ error: 'WhatsApp no está conectado en São Paulo' });
    }

    try {
        const cleanNumber = String(number).replace(/\D/g, '');
        const jid = cleanNumber + '@s.whatsapp.net';

        let result;

        // 1. Archivo PDF
        if (media && media.base64) {
            const buffer = Buffer.from(media.base64, 'base64');
            result = await sock.sendMessage(jid, {
                document: buffer,
                mimetype: media.mimetype || 'application/pdf',
                fileName: media.filename || 'Documento_Athleticenter.pdf',
                caption: text || ''
            });
        }
        // 2. Imagen (URL o Data-URI base64)
        else if (imageUrl) {
            let imageBuffer;
            if (imageUrl.startsWith('data:')) {
                const base64Data = imageUrl.split(';base64,').pop();
                imageBuffer = Buffer.from(base64Data, 'base64');
            } else if (imageUrl.startsWith('http')) {
                const imgRes = await fetch(imageUrl);
                imageBuffer = Buffer.from(await imgRes.arrayBuffer());
            }

            if (imageBuffer) {
                result = await sock.sendMessage(jid, {
                    image: imageBuffer,
                    caption: text || ''
                });
            } else {
                result = await sock.sendMessage(jid, { text: text || '' });
            }
        }
        // 3. Solo texto
        else {
            result = await sock.sendMessage(jid, { text: text || '' });
        }

        const msgId = result?.key?.id || 'BAILEYS_SENT_OK';
        console.log(`[Baileys SP] ✅ Mensaje enviado a +${cleanNumber} (ID: ${msgId})`);
        return res.json({ success: true, messageId: msgId, provider: 'baileys-saopaulo' });

    } catch (error) {
        console.error('[Baileys SP] Error al enviar mensaje:', error.message);
        return res.status(500).json({ error: error.message });
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

        if ((isMondayCatalog || isThursdayCatalog) && isConnected) {
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
    console.log(`🚀 Gateway Baileys São Paulo activo en http://0.0.0.0:${PORT}`);
});
