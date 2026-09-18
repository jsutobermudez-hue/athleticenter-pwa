const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = 3001;
const API_KEY = 'local-dev-key'; // Debe coincidir con WHATSAPP_GATEWAY_API_KEY en .env.local

console.log('Iniciando servicio local de WhatsApp...');

// Inicializar cliente de WhatsApp con sesión guardada localmente
const client = new Client({
    authStrategy: new LocalAuth(),
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
            console.warn(`[WhatsApp Local] Intent de envío ${attempt}/${retries} falló:`, err.message);
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
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    isReady = true;
    console.log('✅ Cliente de WhatsApp conectado y listo para enviar mensajes.');
});

client.on('authenticated', () => {
    console.log('✅ Sesión de WhatsApp autenticada correctamente.');
});

client.on('auth_failure', msg => {
    isReady = false;
    console.error('❌ Fallo en la autenticación de WhatsApp:', msg);
});

client.on('disconnected', (reason) => {
    isReady = false;
    console.log('❌ Cliente de WhatsApp desconectado:', reason);
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
        const { number, text, media, orderId } = req.body;

        if (!number || !text) {
            return res.status(400).json({ error: 'El número y el texto son obligatorios' });
        }

        // whatsapp-web.js requiere el formato 'numero@c.us'
        const chatId = `${number}@c.us`;

        let messageId = 'LOCAL_SENT';

        // Si viene un PDF (media.base64)
        if (media && media.base64) {
            const mediaData = new MessageMedia(
                media.mimetype || 'application/pdf',
                media.base64,
                media.filename || 'Documento.pdf'
            );
            
            // Enviamos el PDF y el texto como "caption"
            const response = await sendWithRetry(chatId, mediaData, { caption: text });
            messageId = response?.id?._serialized || response?.id?.id || String(response?.id || 'LOCAL_SENT');
        } else {
            // Solo texto
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
