const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} = require('@whiskeysockets/baileys');

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_DEDUP_SIZE = 10000;
const processedMessageIds = new Map();

let socket = null;
let startPromise = null;
let reconnecting = false;
let currentLogger = console;

function cleanupProcessed(now) {
  for (const [id, ts] of processedMessageIds) {
    if (now - ts > DEFAULT_TTL_MS) {
      processedMessageIds.delete(id);
    }
  }
  if (processedMessageIds.size > MAX_DEDUP_SIZE) {
    const entries = Array.from(processedMessageIds.entries()).sort((a, b) => a[1] - b[1]);
    const excess = processedMessageIds.size - MAX_DEDUP_SIZE;
    for (let i = 0; i < excess; i += 1) {
      processedMessageIds.delete(entries[i][0]);
    }
  }
}

function isDuplicateMessage(id) {
  if (!id) return true;
  const now = Date.now();
  const existing = processedMessageIds.get(id);
  cleanupProcessed(now);
  if (existing && now - existing < DEFAULT_TTL_MS) {
    return true;
  }
  processedMessageIds.set(id, now);
  return false;
}

function unwrapMessageContent(message) {
  if (!message) return null;
  let content = message.message || null;
  if (!content) return null;
  if (content.ephemeralMessage && content.ephemeralMessage.message) {
    content = content.ephemeralMessage.message;
  }
  if (content.viewOnceMessage && content.viewOnceMessage.message) {
    content = content.viewOnceMessage.message;
  }
  return content;
}

function extractText(content) {
  if (!content) return '';
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    ''
  ).trim();
}

function normalizeIncomingMessage(message) {
  if (!message || !message.key) return null;
  if (message.key.fromMe) return null;
  if (message.key.remoteJid === 'status@broadcast') return null;

  const content = unwrapMessageContent(message);
  if (!content) return null;

  if (content.protocolMessage) return null;

  const body = extractText(content);
  if (!body) return null;

  return {
    from: message.key.remoteJid,
    body,
    id: message.key.id,
    raw: message
  };
}

async function initSocket({ onMessage, onReady }) {
  const authDir = process.env.BAILEYS_AUTH_DIR || '.baileys';
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const newSocket = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    version
  });

  newSocket.ev.on('creds.update', saveCreds);

  newSocket.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      currentLogger.info('📲 ESCANEA ESTE QR CON WHATSAPP');
      currentLogger.info(qr);
    }
    if (connection === 'open') {
      currentLogger.info('✅ WhatsApp conectado correctamente');
      currentLogger.info('✅ Baileys conectado. Listo para recibir "Menu".');
      if (onReady) onReady();
      reconnecting = false;
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      currentLogger.warn('⚠️ Baileys desconectado. Intentando reconectar...', statusCode);
      if (shouldReconnect && !reconnecting) {
        reconnecting = true;
        if (socket) {
          socket.ev.removeAllListeners();
        }
        initSocket({ onMessage, onReady }).catch((err) => {
          currentLogger.error('❌ Error reconectando Baileys:', err);
          reconnecting = false;
        });
      } else if (!shouldReconnect) {
        currentLogger.error('❌ Sesión cerrada. Borra .baileys y vuelve a escanear QR.');
      }
    }
  });

  newSocket.ev.on('messages.upsert', async (upsert) => {
    if (!upsert || !Array.isArray(upsert.messages)) return;
    for (const message of upsert.messages) {
      const normalized = normalizeIncomingMessage(message);
      if (!normalized) continue;
      if (isDuplicateMessage(normalized.id)) continue;
      try {
        await onMessage(normalized);
      } catch (err) {
        currentLogger.error('❌ Error en onMessage:', err);
      }
    }
  });

  socket = newSocket;
}

async function startBaileys({ onMessage, onReady, logger } = {}) {
  if (startPromise) return startPromise;
  currentLogger = logger || console;
  startPromise = initSocket({ onMessage, onReady });
  return startPromise;
}

async function sendText(to, text) {
  if (!socket) throw new Error('Baileys no inicializado');
  return socket.sendMessage(to, { text });
}

async function sendMedia(to, media, opts = {}) {
  if (!socket) throw new Error('Baileys no inicializado');
  const buffer = Buffer.from(media.data, 'base64');
  return socket.sendMessage(to, {
    document: buffer,
    mimetype: media.mimetype,
    fileName: media.filename || 'documento.pdf',
    caption: opts.caption
  });
}

module.exports = {
  startBaileys,
  sendText,
  sendMedia,
  normalizeIncomingMessage
};
