/**
 * ATHLETICENTER — GATEWAY DE WHATSAPP 24/7 (SÃO PAULO / TOKIO) v3.3
 *
 * - Envío inmediato:      POST /api/send     (Bearer WHATSAPP_GATEWAY_KEY)
 * - Cola anti-bloqueo:    POST /api/queue    (difusiones y catálogo; pausas 8-14 s, enfriamiento 60 s cada 20,
 *                                             solo horario comercial lun-sáb 8:00-19:00 hora Venezuela)
 * - Estado:               GET  /api/status   (público, sin datos sensibles)
 * - Webhook entrante  ->  APP_URL/api/whatsapp-webhook   (cabecera x-webhook-secret)
 *   ·Soporta JIDs clásicos (@s.whatsapp.net) y nuevos Linked IDs de privacidad (@lid) de WhatsApp Multi-Device
 *   ·Desempaqueta mensajes temporales (ephemeralMessage), viewOnce y respuestas a botones/listas
 * - Tareas programadas -> APP_URL/api/cron/*             (Bearer CRON_SECRET)
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, delay } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3001);
const API_KEY = process.env.WHATSAPP_GATEWAY_KEY || '';
const WEBHOOK_SECRET = process.env.WHATSAPP_WEBHOOK_SECRET || '';
const CRON_SECRET = process.env.CRON_SECRET || '';
const APP_URL = (process.env.APP_URL || 'https://studio--studio-5015730771-8ece8.us-central1.hosted.app').replace(/\/$/, '');
const PHONE_NUMBER = process.env.PHONE_NUMBER || '584146719204';

if (API_KEY.length < 24) {
  console.error('❌ WHATSAPP_GATEWAY_KEY no configurada o demasiado corta. Abortando por seguridad.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '150mb' }));

const log = (...a) => console.log(new Date().toISOString(), ...a);
const logErr = (...a) => console.error(new Date().toISOString(), ...a);

// ---------------------------------------------------------------- WhatsApp & LID Mapping
let sock = null;
let isConnected = false;
let currentPairingCode = null;
let currentQrDataUrl = null;
let codeRequested = false;
let lastConnectedAt = null;

// Mapa en memoria para resolver números/LIDs al JID exacto de respuesta (@s.whatsapp.net o @lid)
const jidMap = new Map();
const recentOutbox = new Map();

function registerJidMapping(rawPhoneOrId, remoteJid) {
  if (!remoteJid) return;
  const digits = String(rawPhoneOrId || '').replace(/\D/g, '');
  if (digits.length >= 8) {
    jidMap.set(digits, remoteJid);
    jidMap.set(digits.slice(-10), remoteJid);
    if (!digits.startsWith('58')) {
      jidMap.set('58' + digits, remoteJid);
      jidMap.set('58' + digits.slice(-10), remoteJid);
    }
  }
}

function unwrapMessageContent(m) {
  if (!m) return null;
  if (m.ephemeralMessage?.message) return unwrapMessageContent(m.ephemeralMessage.message);
  if (m.viewOnceMessage?.message) return unwrapMessageContent(m.viewOnceMessage.message);
  if (m.viewOnceMessageV2?.message) return unwrapMessageContent(m.viewOnceMessageV2.message);
  if (m.viewOnceMessageV2Extension?.message) return unwrapMessageContent(m.viewOnceMessageV2Extension.message);
  if (m.documentWithCaptionMessage?.message) return unwrapMessageContent(m.documentWithCaptionMessage.message);
  if (m.editedMessage?.message?.protocolMessage?.editedMessage) {
    return unwrapMessageContent(m.editedMessage.message.protocolMessage.editedMessage);
  }
  if (m.editedMessage?.message) return unwrapMessageContent(m.editedMessage.message);
  return m;
}

function extractMessageText(rawMsg) {
  const m = unwrapMessageContent(rawMsg);
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    m.interactiveResponseMessage?.body?.text ||
    ''
  ).trim();
}

const authDir = path.join(__dirname, 'auth_info_baileys');
const qrFilePath = path.join(__dirname, 'qr.png');
fs.mkdirSync(authDir, { recursive: true });

async function startWhatsApp() {
  log('[WA] Iniciando conexión para +' + PHONE_NUMBER);
  codeRequested = false;
  fs.mkdirSync(authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  let version = undefined;
  try {
    const vInfo = await fetchLatestBaileysVersion();
    version = vInfo.version;
    log('[WA] Versión WhatsApp Web:', version.join('.'));
  } catch (e) {
    logErr('[WA] No se pudo obtener versión remota, usando local:', e.message);
  }

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: Browsers && Browsers.ubuntu ? Browsers.ubuntu('Chrome') : ['Ubuntu', 'Chrome', '128.0.6613.120'],
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      try {
        await QRCode.toFile(qrFilePath, qr, { width: 420, margin: 2 });
        currentQrDataUrl = await QRCode.toDataURL(qr, { width: 420, margin: 2 });
        log('📷 NUEVO CÓDIGO QR GENERADO Y LISTO EN /qr y qr.png');
      } catch (err) {
        logErr('[WA] Error generando imagen QR:', err.message);
      }
    }

    if (connection === 'close') {
      isConnected = false;
      currentPairingCode = null;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      logErr(`[WA] Conexión cerrada. status=${statusCode} loggedOut=${loggedOut}`);
      if (loggedOut) {
        logErr('[WA] ⚠️ SESIÓN CERRADA DESDE EL TELÉFONO. Se requiere volver a vincular.');
        try { fs.rmSync(authDir, { recursive: true, force: true }); fs.mkdirSync(authDir, { recursive: true }); } catch {}
      }
      setTimeout(startWhatsApp, loggedOut ? 5000 : 4000);
    } else if (connection === 'open') {
      isConnected = true;
      currentPairingCode = null;
      currentQrDataUrl = null;
      codeRequested = false;
      lastConnectedAt = new Date().toISOString();
      try { if (fs.existsSync(qrFilePath)) fs.unlinkSync(qrFilePath); } catch {}
      log('✅ WHATSAPP CONECTADO Y OPERATIVO (24/7)');
      processQueue();
    }
  });

  // Mensajes entrantes -> webhook firmado de la app (Soporta @s.whatsapp.net y @lid)
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return;
    for (const msg of messages) {
      try {
        if (!msg || !msg.message) continue;
        const remoteJid = msg.key?.remoteJid || '';
        if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.endsWith('@g.us') || remoteJid.endsWith('@newsletter') || remoteJid.endsWith('@broadcast')) {
          continue;
        }

        const body = extractMessageText(msg.message);
        if (!body) continue;

        // Evitar bucle con respuestas firmadas por Athleticenter
        if (body.includes('*ATHLETICENTER*') || body.includes('El equipo de Athleticenter')) {
          continue;
        }

        // Ignorar mensajes salientes propios
        if (msg.key?.fromMe) {
          continue;
        }

        if (type !== 'notify') continue;

        const altCandidates = [
          msg.key?.senderPn,
          msg.key?.remoteJidAlt,
          msg.key?.participantAlt,
          msg.key?.participant,
          msg.participant,
          remoteJid
        ].filter(Boolean);

        const phoneJid = altCandidates.find(j => String(j).endsWith('@s.whatsapp.net')) || remoteJid;
        const from = String(phoneJid).split('@')[0].replace(/:\d+$/, '');

        registerJidMapping(from, remoteJid);
        registerJidMapping(remoteJid.split('@')[0], remoteJid);

        log(`[WA] 📥 Entrante de ${from} (jid=${remoteJid}, pushName=${msg.pushName || 'N/A'}): "${body.slice(0, 80)}"`);

        const beforeWebhookTs = Date.now();
        const res = await fetch(`${APP_URL}/api/whatsapp-webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET },
          body: JSON.stringify({
            from,
            remoteJid,
            pushName: msg.pushName || '',
            body,
            timestamp: msg.messageTimestamp
          }),
          signal: AbortSignal.timeout(25000),
        });

        const resText = await res.text();
        if (!res.ok) {
          logErr(`[Webhook] ❌ La app respondió ${res.status}: ${resText.slice(0, 200)}`);
        } else {
          log(`[Webhook] ✅ Procesado (${res.status}): ${resText.slice(0, 200)}`);
          try {
            const data = JSON.parse(resText);
            const lastSent = recentOutbox.get(remoteJid) || 0;
            if (data?.replyText && lastSent < beforeWebhookTs) {
              log(`[Webhook] 📤 Enviando replyText directo a ${remoteJid}`);
              await sock.sendMessage(remoteJid, { text: data.replyText });
              recentOutbox.set(remoteJid, Date.now());
            }
          } catch {}
        }
      } catch (e) {
        logErr('[Webhook] Error notificando a la app:', e.message);
      }
    }
  });
}

async function sendOne({ number, text, imageUrl, videoUrl, documentUrl, fileName, media }) {
  if (!isConnected || !sock) throw new Error('WhatsApp no está conectado en São Paulo');
  const raw = String(number || '').trim();
  let jid = '';
  if (raw.endsWith('@s.whatsapp.net') || raw.endsWith('@lid')) {
    jid = raw;
  } else {
    const clean = raw.replace(/\D/g, '');
    if (clean.length < 10) throw new Error('Número inválido');
    jid = jidMap.get(clean) || jidMap.get(clean.slice(-10)) || (clean + '@s.whatsapp.net');
  }
  recentOutbox.set(jid, Date.now());

  if (media && media.base64) {
    const r = await sock.sendMessage(jid, {
      document: Buffer.from(media.base64, 'base64'),
      mimetype: media.mimetype || 'application/pdf',
      fileName: media.filename || 'Documento_Athleticenter.pdf',
      caption: text || '',
    });
    return r?.key?.id;
  }

  // 1. Envío de Documento PDF (hasta 100 MB adjunto nativo — límite oficial máximo de WhatsApp)
  const MAX_WA_PDF_BYTES = 100 * 1024 * 1024;
  if (documentUrl) {
    let buf = null;
    let remoteDownloadLink = null;
    if (typeof documentUrl === 'string' && fs.existsSync(documentUrl)) {
      try { buf = fs.readFileSync(documentUrl); } catch (e) { logErr('[Send] Error leyendo documento PDF de disco:', e.message); }
    } else if (typeof documentUrl === 'string' && (documentUrl.startsWith('data:application/pdf') || documentUrl.startsWith('data:'))) {
      buf = Buffer.from(documentUrl.split(';base64,').pop(), 'base64');
    } else if (typeof documentUrl === 'string' && (documentUrl.startsWith('https://') || documentUrl.startsWith('http://'))) {
      remoteDownloadLink = documentUrl;
      try {
        const dr = await fetch(documentUrl, { signal: AbortSignal.timeout(120000) });
        const lenHeader = Number(dr.headers.get('content-length') || 0);
        if (dr.ok && (!lenHeader || lenHeader <= MAX_WA_PDF_BYTES)) {
          buf = Buffer.from(await dr.arrayBuffer());
        } else if (lenHeader > MAX_WA_PDF_BYTES) {
          log(`[Send] 📎 PDF supera 100 MB (${(lenHeader / (1024 * 1024)).toFixed(1)} MB), se enviará enlace directo Cloud.`);
        }
      } catch (e) {
        logErr('[Send] Error descargando PDF remoto:', e.message);
      }
    }
    if (buf && buf.length <= MAX_WA_PDF_BYTES) {
      const docName = fileName || 'Catalogo_Athleticenter.pdf';
      log(`[Send] 📄 Transmitiendo documento PDF (${(buf.length / (1024 * 1024)).toFixed(2)} MB: ${docName}) a ...${String(number).slice(-4)}`);
      const r = await sock.sendMessage(jid, {
        document: buf,
        mimetype: 'application/pdf',
        fileName: docName,
        caption: text || '',
      });
      return r?.key?.id;
    } else if (remoteDownloadLink) {
      log(`[Send] 🔗 PDF > 100 MB o remoto pesado: enviando enlace directo de alta velocidad a ...${String(number).slice(-4)}`);
      const enrichedText = (text || '').includes(remoteDownloadLink)
        ? (text || remoteDownloadLink)
        : `${text || '📄 Catálogo Oficial Athleticenter'}\n\n📥 *Descarga directa del catálogo completo:*\n${remoteDownloadLink}`;
      const r = await sock.sendMessage(jid, { text: enrichedText });
      return r?.key?.id;
    } else if (buf) {
      logErr(`[Send] ⚠️ Documento PDF excede 100 MB (${(buf.length / (1024 * 1024)).toFixed(2)} MB), enviando solo texto`);
    } else {
      logErr(`[Send] ⚠️ Buffer de PDF no disponible para ...${String(number).slice(-4)}, enviando solo texto`);
    }
  }

  // 2. Envío de Video MP4
  if (videoUrl) {
    let buf = null;
    if (typeof videoUrl === 'string' && fs.existsSync(videoUrl)) {
      try { buf = fs.readFileSync(videoUrl); } catch (e) { logErr('[Send] Error leyendo video de disco:', e.message); }
    } else if (typeof videoUrl === 'string' && videoUrl.startsWith('data:video/')) {
      buf = Buffer.from(videoUrl.split(';base64,').pop(), 'base64');
    } else if (typeof videoUrl === 'string' && (videoUrl.startsWith('https://') || videoUrl.startsWith('http://'))) {
      const vr = await fetch(videoUrl, { signal: AbortSignal.timeout(45000) });
      if (vr.ok) buf = Buffer.from(await vr.arrayBuffer());
    }
    if (buf && buf.length < 50 * 1024 * 1024) {
      log(`[Send] 🎥 Transmitiendo video MP4 (${(buf.length / (1024 * 1024)).toFixed(2)} MB) a ...${String(number).slice(-4)}`);
      const r = await sock.sendMessage(jid, {
        video: buf,
        caption: text || '',
        mimetype: 'video/mp4'
      });
      return r?.key?.id;
    } else if (buf) {
      logErr(`[Send] ⚠️ Video excede 50 MB (${(buf.length / (1024 * 1024)).toFixed(2)} MB), enviando solo texto`);
    } else {
      logErr(`[Send] ⚠️ Buffer de video no disponible para ...${String(number).slice(-4)}, enviando solo texto`);
    }
  }

  // 3. Envío de Imagen
  if (imageUrl) {
    let buf = null;
    if (typeof imageUrl === 'string' && fs.existsSync(imageUrl)) {
      try { buf = fs.readFileSync(imageUrl); } catch (e) { logErr('[Send] Error leyendo imagen de disco:', e.message); }
    } else if (typeof imageUrl === 'string' && imageUrl.startsWith('data:image/')) {
      buf = Buffer.from(imageUrl.split(';base64,').pop(), 'base64');
    } else if (typeof imageUrl === 'string' && (imageUrl.startsWith('https://') || imageUrl.startsWith('http://'))) {
      const ir = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
      if (ir.ok && (ir.headers.get('content-type') || '').startsWith('image/')) buf = Buffer.from(await ir.arrayBuffer());
    }
    if (buf && buf.length < 20 * 1024 * 1024) {
      log(`[Send] 🖼️ Transmitiendo imagen (${(buf.length / (1024 * 1024)).toFixed(2)} MB) a ...${String(number).slice(-4)}`);
      const r = await sock.sendMessage(jid, { image: buf, caption: text || '' });
      return r?.key?.id;
    } else if (buf) {
      logErr(`[Send] ⚠️ Imagen excede 20 MB, enviando solo texto`);
    } else {
      logErr(`[Send] ⚠️ Buffer de imagen no disponible para ...${String(number).slice(-4)}, enviando solo texto`);
    }
  }

  // Fallback a texto
  const r = await sock.sendMessage(jid, { text: text || '' });
  return r?.key?.id;
}

// ---------------------------------------------------------------- Seguridad
function requireKey(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
  const matches = (key) => {
    if (!key) return false;
    const a = Buffer.from(token);
    const b = Buffer.from(key);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  if (!matches(API_KEY) && !matches(process.env.LEGACY_GATEWAY_KEY || '')) {
    return res.status(401).json({ success: false, error: 'No autorizado' });
  }
  next();
}

// ---------------------------------------------------------------- Cola persistente
const QUEUE_FILE = path.join(__dirname, 'queue.json');
let queue = [];
let campaigns = {};
try {
  const saved = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  queue = saved.queue || [];
  campaigns = saved.campaigns || {};
  if (queue.length) log(`[Cola] Recuperados ${queue.length} mensajes pendientes del disco.`);
} catch {}
const persist = () => { try { fs.writeFileSync(QUEUE_FILE, JSON.stringify({ queue, campaigns })); } catch (e) { logErr('[Cola] No se pudo guardar:', e.message); } };

function vzlaNow() { return new Date(Date.now() - 4 * 3600 * 1000); }
function inBusinessHours() {
  const d = vzlaNow();
  const day = d.getUTCDay();
  const h = d.getUTCHours();
  return day !== 0 && h >= 8 && h < 19;
}

async function reportProgress(campaignId, final = false) {
  const c = campaigns[campaignId];
  if (!c || !campaignId || campaignId.startsWith('adhoc-')) return;
  try {
    await fetch(`${APP_URL}/api/marketing/campaign-progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET },
      body: JSON.stringify({ campaignId, sentCount: c.sent, failedCount: c.failed, status: final ? 'completed' : 'processing', errors: (c.errors || []).slice(-20) }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) { logErr('[Cola] No se pudo reportar progreso:', e.message); }
}

let processing = false;
let sentInBatch = 0;
async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length) {
      if (!isConnected) { log('[Cola] En pausa: WhatsApp desconectado.'); break; }
      if (!inBusinessHours()) { log('[Cola] En pausa: fuera de horario comercial (lun-sáb 8:00-19:00 VET).'); break; }

      const item = queue[0];
      const c = campaigns[item.campaignId] || (campaigns[item.campaignId] = { sent: 0, failed: 0, total: 0, errors: [] });
      try {
        await sendOne(item);
        c.sent++;
      } catch (e) {
        item.attempts = (item.attempts || 0) + 1;
        if (item.attempts < 2 && isConnected) { queue.push(queue.shift()); persist(); await delay(5000); continue; }
        c.failed++;
        (c.errors = c.errors || []).push(`...${String(item.number).slice(-4)}: ${e.message}`);
        logErr(`[Cola] Fallo definitivo a ...${String(item.number).slice(-4)}: ${e.message}`);
      }
      queue.shift();
      persist();

      const remainingForCampaign = queue.some(q => q.campaignId === item.campaignId);
      if ((c.sent + c.failed) % 5 === 0 || !remainingForCampaign) await reportProgress(item.campaignId, !remainingForCampaign);
      if (!remainingForCampaign) {
        log(`[Cola] ✅ Campaña ${item.campaignId} finalizada: ${c.sent} enviados, ${c.failed} fallidos.`);
        if (c.mediaFile && fs.existsSync(c.mediaFile)) {
          try {
            fs.unlinkSync(c.mediaFile);
            log(`[Cola] 🧹 Archivo multimedia temporal liberado: ${c.mediaFile}`);
          } catch (err) {
            logErr('[Cola] Error al eliminar archivo temporal:', err.message);
          }
        }
        delete campaigns[item.campaignId];
        persist();
      }

      if (queue.length) {
        sentInBatch++;
        if (sentInBatch % 20 === 0) { log('[Cola] ⏳ Enfriamiento anti-bloqueo 60 s'); await delay(60000); }
        else await delay(8000 + Math.floor(Math.random() * 6001));
      }
    }
  } finally {
    processing = false;
  }
}
setInterval(processQueue, 60 * 1000);

// ---------------------------------------------------------------- API
app.get('/api/status', (req, res) => {
  res.json({
    status: isConnected ? 'connected' : 'waiting_auth',
    pairingCode: isConnected ? null : currentPairingCode,
    hasQr: !isConnected && !!currentQrDataUrl,
    lastConnectedAt,
    queued: queue.length,
    businessHours: inBusinessHours(),
    server: 'Sao Paulo 24/7',
  });
});

app.get('/qr.png', (req, res) => {
  if (fs.existsSync(qrFilePath)) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.sendFile(qrFilePath);
  } else {
    res.status(404).send('QR no disponible');
  }
});

app.get('/qr', (req, res) => {
  if (isConnected) {
    return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:50px;background:#0f172a;color:#22c55e;"><h1>✅ WHATSAPP CONECTADO Y OPERATIVO (24/7)</h1><p style="color:#fff;">El Agente ARM de Athleticenter ya está recibiendo y respondiendo mensajes.</p></body></html>');
  }
  if (currentQrDataUrl) {
    return res.send(`<html><head><meta http-equiv="refresh" content="8"><title>Vincular WhatsApp Athleticenter</title></head><body style="font-family:sans-serif;text-align:center;padding:30px;background:#0f172a;color:#fff;"><h2>📷 Escanea con WhatsApp &gt; Dispositivos vinculados</h2><div style="background:#fff;display:inline-block;padding:16px;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,0.5);"><img src="${currentQrDataUrl}" style="width:360px;height:360px;" /></div><p style="color:#94a3b8;margin-top:16px;">Se actualiza automáticamente cada 8 segundos...</p></body></html>`);
  }
  res.send('<html><head><meta http-equiv="refresh" content="3"></head><body style="font-family:sans-serif;text-align:center;padding:50px;background:#0f172a;color:#fff;"><h2>⏳ Generando código QR... (Recargando en 3s)</h2></body></html>');
});

app.post('/api/send', requireKey, async (req, res) => {
  const { number, text, imageUrl, videoUrl, documentUrl, fileName, media } = req.body || {};
  if (!number || (!text && !imageUrl && !videoUrl && !documentUrl && !media)) {
    return res.status(400).json({ success: false, error: 'Faltan parámetros obligatorios' });
  }
  try {
    const id = await sendOne({ number, text, imageUrl, videoUrl, documentUrl, fileName, media });
    log(`[Send] ✅ Enviado a ...${String(number).slice(-4)}`);
    res.json({ success: true, messageId: id || 'SENT_OK', provider: 'baileys-saopaulo' });
  } catch (e) {
    logErr(`[Send] ❌ ...${String(number).slice(-4)}: ${e.message}`);
    res.status(isConnected ? 500 : 503).json({ success: false, error: e.message });
  }
});

app.post('/api/queue', requireKey, async (req, res) => {
  const { campaignId, items, label, commonMediaUrl, commonMediaType, commonMediaFileName } = req.body || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ success: false, error: 'Lista vacía' });
  if (items.length > 1000) return res.status(400).json({ success: false, error: 'Máximo 1000 mensajes por lote' });
  const cid = String(campaignId || `adhoc-${Date.now()}`);

  let commonFilePath = null;
  let resolvedFileName = commonMediaFileName || (label ? `${label.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf` : 'Catalogo_Athleticenter.pdf');
  if (!resolvedFileName.toLowerCase().endsWith('.pdf') && (commonMediaType === 'pdf' || commonMediaUrl?.includes('application/pdf'))) {
    resolvedFileName += '.pdf';
  }

  if (commonMediaUrl && typeof commonMediaUrl === 'string') {
    const mediaDir = path.join(__dirname, 'media_cache');
    try {
      if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
      if (commonMediaUrl.startsWith('data:')) {
        const parts = commonMediaUrl.split(';base64,');
        const header = parts[0] || '';
        const b64 = parts[1] || '';
        let ext = 'bin';
        if (header.includes('pdf') || commonMediaType === 'pdf') ext = 'pdf';
        else if (header.includes('video/') || commonMediaType === 'video') ext = 'mp4';
        else if (header.includes('image/png')) ext = 'png';
        else if (header.includes('image/webp')) ext = 'webp';
        else if (header.includes('image/')) ext = 'jpg';

        commonFilePath = path.join(mediaDir, `${cid}.${ext}`);
        fs.writeFileSync(commonFilePath, Buffer.from(b64, 'base64'));
        const sizeMb = (Buffer.byteLength(b64, 'base64') / (1024 * 1024)).toFixed(2);
        log(`[Cola] 💾 Multimedia común guardada en disco (${sizeMb} MB): ${commonFilePath}`);
      } else if (commonMediaUrl.startsWith('http://') || commonMediaUrl.startsWith('https://')) {
        try {
          const headOrGet = await fetch(commonMediaUrl, { signal: AbortSignal.timeout(120000) });
          const lenHeader = Number(headOrGet.headers.get('content-length') || 0);
          const cType = headOrGet.headers.get('content-type') || '';
          const maxCacheBytes = commonMediaType === 'pdf' || cType.includes('pdf') ? 100 * 1024 * 1024 : 50 * 1024 * 1024;
          if (headOrGet.ok && (!lenHeader || lenHeader <= maxCacheBytes)) {
            const buf = Buffer.from(await headOrGet.arrayBuffer());
            if (buf.length <= maxCacheBytes) {
              let ext = 'pdf';
              if (commonMediaType === 'video' || cType.includes('video/')) ext = 'mp4';
              else if (commonMediaType === 'image' || cType.includes('image/')) ext = cType.includes('png') ? 'png' : cType.includes('webp') ? 'webp' : 'jpg';
              commonFilePath = path.join(mediaDir, `${cid}.${ext}`);
              fs.writeFileSync(commonFilePath, buf);
              log(`[Cola] ⚡ Multimedia Cloud cacheada en SSD local (${(buf.length / (1024 * 1024)).toFixed(2)} MB): ${commonFilePath}`);
            } else {
              commonFilePath = commonMediaUrl;
            }
          } else {
            commonFilePath = commonMediaUrl;
          }
        } catch (dlErr) {
          logErr('[Cola] ⚠️ No se pudo pre-cachear URL remota, se usará URL directa:', dlErr.message);
          commonFilePath = commonMediaUrl;
        }
      }
    } catch (err) {
      logErr('[Cola] ❌ Error almacenando multimedia común:', err.message);
    }
  }

  const valid = items.filter(i => i && i.number && (i.text || i.imageUrl || i.videoUrl || i.documentUrl || i.media || commonFilePath));
  campaigns[cid] = campaigns[cid] || { sent: 0, failed: 0, total: 0, errors: [], label: label || '', mediaFile: commonFilePath };
  campaigns[cid].total += valid.length;
  if (commonFilePath) campaigns[cid].mediaFile = commonFilePath;

  for (const i of valid) {
    let itemVideo = i.videoUrl;
    let itemImage = i.imageUrl;
    let itemDoc = i.documentUrl;
    if (commonFilePath) {
      if (commonMediaType === 'pdf' || commonFilePath.endsWith('.pdf')) {
        itemDoc = commonFilePath;
      } else if (commonMediaType === 'video' || commonFilePath.endsWith('.mp4')) {
        itemVideo = commonFilePath;
      } else if (commonMediaType === 'image' || commonFilePath.endsWith('.jpg') || commonFilePath.endsWith('.png') || commonFilePath.endsWith('.webp')) {
        itemImage = commonFilePath;
      }
    }
    queue.push({
      id: crypto.randomUUID(),
      campaignId: cid,
      number: String(i.number),
      text: i.text || '',
      imageUrl: itemImage || undefined,
      videoUrl: itemVideo || undefined,
      documentUrl: itemDoc || undefined,
      fileName: resolvedFileName,
      media: i.media || undefined,
      attempts: 0
    });
  }

  persist();
  log(`[Cola] ➕ ${valid.length} mensajes encolados (campaña ${cid}${label ? ' · ' + label : ''}${commonFilePath ? ' [MULTIMEDIA: ' + path.extname(commonFilePath) + ']' : ''}). Total en cola: ${queue.length}`);
  processQueue();
  res.json({ success: true, campaignId: cid, queued: valid.length, totalQueued: queue.length, businessHours: inBusinessHours() });
});

// ---------------------------------------------------------------- Tareas programadas
const lastRun = {};
async function callApp(name, pathName, body) {
  log(`[Cron] 🚀 ${name}`);
  try {
    const res = await fetch(`${APP_URL}${pathName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON_SECRET}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(290000),
    });
    const text = await res.text();
    if (!res.ok) logErr(`[Cron] ❌ ${name}: HTTP ${res.status} ${text.slice(0, 300)}`);
    else log(`[Cron] ✅ ${name}: ${text.slice(0, 300)}`);
  } catch (e) {
    logErr(`[Cron] ❌ ${name}: ${e.message}`);
  }
}

const SCHEDULE = [
  { name: 'Cobranza automática', days: [1, 2, 3, 4, 5, 6], hh: 9, mm: 0, path: '/api/cron/debt-collection', body: { dryRun: false } },
  { name: 'Gemini Closer', days: [1, 2, 3, 4, 5, 6], hh: 10, mm: 30, path: '/api/cron/closer-agent', body: { dryRun: false } },
  { name: 'Catálogo bi-semanal (lunes)', days: [1], hh: 10, mm: 0, path: '/api/cron/biweekly-catalog', body: { dryRun: false } },
  { name: 'Catálogo bi-semanal (jueves)', days: [4], hh: 14, mm: 30, path: '/api/cron/biweekly-catalog', body: { dryRun: false } },
];

setInterval(() => {
  if (!CRON_SECRET) return;
  const d = vzlaNow();
  const key = d.toISOString().slice(0, 16);
  for (const job of SCHEDULE) {
    if (job.days.includes(d.getUTCDay()) && d.getUTCHours() === job.hh && d.getUTCMinutes() === job.mm) {
      const runKey = `${job.name}|${key}`;
      if (lastRun[runKey]) continue;
      lastRun[runKey] = true;
      if (!isConnected) { logErr(`[Cron] ⚠️ ${job.name} omitido: WhatsApp desconectado`); continue; }
      callApp(job.name, job.path, job.body);
    }
  }
}, 20 * 1000);

// ---------------------------------------------------------------- Arranque
startWhatsApp();
app.listen(PORT, '0.0.0.0', () => {
  log(`🚀 Gateway São Paulo v3.3 (100MB PDF Ready) en puerto ${PORT} · App: ${APP_URL} · Cron: ${CRON_SECRET ? 'activo' : 'DESACTIVADO (falta CRON_SECRET)'}`);
});
