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
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('\n=========================================================');
    console.log('¡ESCANEA ESTE CÓDIGO QR CON TU WHATSAPP PARA CONECTAR!');
    console.log('=========================================================\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ Cliente de WhatsApp conectado y listo para enviar mensajes.');
});

client.on('authenticated', () => {
    console.log('✅ Sesión de WhatsApp autenticada correctamente.');
});

client.on('auth_failure', msg => {
    console.error('❌ Fallo en la autenticación de WhatsApp:', msg);
});

client.on('disconnected', (reason) => {
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
    try {
        const { number, text, media, orderId } = req.body;

        if (!number || !text) {
            return res.status(400).json({ error: 'El número y el texto son obligatorios' });
        }

        // whatsapp-web.js requiere el formato 'numero@c.us'
        const chatId = `${number}@c.us`;

        let messageId;

        // Si viene un PDF (media.base64)
        if (media && media.base64) {
            const mediaData = new MessageMedia(
                media.mimetype || 'application/pdf',
                media.base64,
                media.filename || 'Documento.pdf'
            );
            
            // Enviamos el PDF y el texto como "caption"
            const response = await client.sendMessage(chatId, mediaData, { caption: text });
            messageId = response.id.id;
        } else {
            // Solo texto
            const response = await client.sendMessage(chatId, text);
            messageId = response.id.id;
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
