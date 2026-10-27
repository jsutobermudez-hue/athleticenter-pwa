/**
 * ATHLETICENTER — GATEWAY DE WHATSAPP 24/7 (SÃO PAULO) v3
 *
 * - Envío inmediato:      POST /api/send     (Bearer WHATSAPP_GATEWAY_KEY)
 * - Cola anti-bloqueo:    POST /api/queue    (difusiones y catálogo; pausas 8-14 s, enfriamiento 60 s cada 20,
 *                                             solo horario comercial lun-sáb 8:00-19:00 hora Venezuela)
 * - Estado:               GET  /api/status   (público, sin datos sensibles)
 * - Webhook entrante  ->  APP_URL/api/whatsapp-webhook   (cabecera x-webhook-secret)
 * - Tareas programadas -> APP_URL/api/cron/*             (Bearer CRON_SECRET)
 *     · Cobranza automática:  lun-sáb 09:00
 *     · Gemini Closer:        lun-sáb 10:30
 *     · Catálogo bi-semanal:  lunes 10:00 y jueves 14:30
 *
 * Configuración en .env (mismo directorio): WHATSAPP_GATEWAY_KEY, WHATSAPP_WEBHOOK_SECRET, CRON_SECRET, APP_URL, PHONE_NUMBER
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
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
app.use(express.json({ limit: '25mb' }));

const log = (...a) => console.log(new Date().toISOString(), ...a);
const logErr = (...a) => console.error(new Date().toISOString(), ...a);

// ---------------------------------------------------------------- WhatsApp
let sock = null;
let isConnected = false;
let currentPairingCode = null;
let codeRequested = false;
let lastConnectedAt = null;

const authDir = path.join(__dirname, 'auth_info_baileys');
fs.mkdirSync(authDir, { recursive: true });

async function startWhatsApp() {
  log('[WA] Iniciando conexión para +' + PHONE_NUMBER);
  codeRequested = false;
  fs.mkdirSync(authDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
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
      codeRequested = false;
      lastConnectedAt = new Date().toISOString();
      log('✅ WHATSAPP CONECTADO Y OPERATIVO (São Paulo 24/7)');
      processQueue();
    }

    if (sock && !sock.authState.creds.registered && !isConnected && !codeRequested) {
      codeRequested = true;
      await delay(1500);
      try {
        currentPairingCode = await sock.requestPairingCode(PHONE_NUMBER);
        log('🔥 CÓDIGO DE VINCULACIÓN: ' + currentPairingCode);
      } catch (err) {
        logErr('[WA] Error solicitando código:', err.message);
        setTimeout(() => { codeRequested = false; }, 30000);
      }
    }
  });

  // Mensajes entrantes -> webhook firmado de la app
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        if (msg.key.fromMe) continue;
        const jid = msg.key.remoteJid || '';
        if (!jid.endsWith('@s.whatsapp.net')) continue;
        const from = jid.replace('@s.whatsapp.net', '');
        const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '';
        if (!body) continue;
        log(`[WA] 📥 Entrante de ...${from.slice(-4)} (${body.length} car.)`);
        const res = await fetch(`${APP_URL}/api/whatsapp-webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET },
          body: JSON.stringify({ from, body, timestamp: msg.messageTimestamp }),
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) logErr(`[Webhook] La app respondió ${res.status}`);
      } catch (e) {
        logErr('[Webhook] Error notificando a la app:', e.message);
      }
    }
  });
}

async function sendOne({ number, text, imageUrl, media }) {
  if (!isConnected || !sock) throw new Error('WhatsApp no está conectado en São Paulo');
  const clean = String(number).replace(/\D/g, '');
  if (clean.length < 11) throw new Error('Número inválido');
  const jid = clean + '@s.whatsapp.net';

  if (media && media.base64) {
    const r = await sock.sendMessage(jid, {
      document: Buffer.from(media.base64, 'base64'),
      mimetype: media.mimetype || 'application/pdf',
      fileName: media.filename || 'Documento_Athleticenter.pdf',
      caption: text || '',
    });
    return r?.key?.id;
  }
  if (imageUrl) {
    let buf = null;
    if (imageUrl.startsWith('data:image/')) {
      buf = Buffer.from(imageUrl.split(';base64,').pop(), 'base64');
    } else if (imageUrl.startsWith('https://')) {
      const ir = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
      if (ir.ok && (ir.headers.get('content-type') || '').startsWith('image/')) buf = Buffer.from(await ir.arrayBuffer());
    }
    if (buf && buf.length < 15 * 1024 * 1024) {
      const r = await sock.sendMessage(jid, { image: buf, caption: text || '' });
      return r?.key?.id;
    }
  }
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
  // LEGACY_GATEWAY_KEY: solo durante la transición de versiones de la app; eliminar del .env al terminar.
  if (!matches(API_KEY) && !matches(process.env.LEGACY_GATEWAY_KEY || '')) {
    return res.status(401).json({ success: false, error: 'No autorizado' });
  }
  next();
}

// ---------------------------------------------------------------- Cola persistente
const QUEUE_FILE = path.join(__dirname, 'queue.json');
let queue = [];      // [{ id, campaignId, number, text, imageUrl, attempts }]
let campaigns = {};  // campaignId -> { sent, failed, total, label }
try {
  const saved = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  queue = saved.queue || [];
  campaigns = saved.campaigns || {};
  if (queue.length) log(`[Cola] Recuperados ${queue.length} mensajes pendientes del disco.`);
} catch {}
const persist = () => { try { fs.writeFileSync(QUEUE_FILE, JSON.stringify({ queue, campaigns })); } catch (e) { logErr('[Cola] No se pudo guardar:', e.message); } };

function vzlaNow() { return new Date(Date.now() - 4 * 3600 * 1000); } // Venezuela UTC-4 (sin horario de verano)
function inBusinessHours() {
  const d = vzlaNow();
  const day = d.getUTCDay();   // 0 = domingo
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
      if (!remainingForCampaign) { log(`[Cola] ✅ Campaña ${item.campaignId} finalizada: ${c.sent} enviados, ${c.failed} fallidos.`); delete campaigns[item.campaignId]; persist(); }

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
setInterval(processQueue, 60 * 1000); // reanuda al volver el horario comercial o la conexión

// ---------------------------------------------------------------- API
app.get('/api/status', (req, res) => {
  res.json({
    status: isConnected ? 'connected' : 'waiting_auth',
    pairingCode: isConnected ? null : currentPairingCode,
    lastConnectedAt,
    queued: queue.length,
    businessHours: inBusinessHours(),
    server: 'Sao Paulo 24/7',
  });
});

app.post('/api/send', requireKey, async (req, res) => {
  const { number, text, imageUrl, media } = req.body || {};
  if (!number || (!text && !imageUrl && !media)) return res.status(400).json({ success: false, error: 'Faltan parámetros obligatorios' });
  try {
    const id = await sendOne({ number, text, imageUrl, media });
    log(`[Send] ✅ Enviado a ...${String(number).slice(-4)}`);
    res.json({ success: true, messageId: id || 'SENT_OK', provider: 'baileys-saopaulo' });
  } catch (e) {
    logErr(`[Send] ❌ ...${String(number).slice(-4)}: ${e.message}`);
    res.status(isConnected ? 500 : 503).json({ success: false, error: e.message });
  }
});

app.post('/api/queue', requireKey, (req, res) => {
  const { campaignId, items, label } = req.body || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ success: false, error: 'Lista vacía' });
  if (items.length > 1000) return res.status(400).json({ success: false, error: 'Máximo 1000 mensajes por lote' });
  const cid = String(campaignId || `adhoc-${Date.now()}`);
  const valid = items.filter(i => i && i.number && (i.text || i.imageUrl));
  campaigns[cid] = campaigns[cid] || { sent: 0, failed: 0, total: 0, errors: [], label: label || '' };
  campaigns[cid].total += valid.length;
  for (const i of valid) queue.push({ id: crypto.randomUUID(), campaignId: cid, number: String(i.number), text: i.text || '', imageUrl: i.imageUrl || undefined, attempts: 0 });
  persist();
  log(`[Cola] ➕ ${valid.length} mensajes encolados (campaña ${cid}${label ? ' · ' + label : ''}). Total en cola: ${queue.length}`);
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
  log(`🚀 Gateway São Paulo v3 en puerto ${PORT} · App: ${APP_URL} · Cron: ${CRON_SECRET ? 'activo' : 'DESACTIVADO (falta CRON_SECRET)'}`);
});
