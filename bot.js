// bot.js – LIA Pagaré v4 (uso real en WhatsApp)
// Transporte Baileys conectado al core modular

require('dotenv').config();

const { handleMessage } = require('./src/core/index');
const { startBaileys, sendText, sendMedia } = require('./src/transport/baileys');

function createLogger() {
  const level = (process.env.LOG_LEVEL || 'info').toLowerCase();
  const levels = ['error', 'warn', 'info', 'debug'];
  const minIndex = levels.indexOf(level);
  const shouldLog = (lvl) => levels.indexOf(lvl) <= (minIndex === -1 ? 2 : minIndex);
  return {
    info: (...args) => {
      if (shouldLog('info')) console.log(...args);
    },
    warn: (...args) => {
      if (shouldLog('warn')) console.warn(...args);
    },
    error: (...args) => {
      if (shouldLog('error')) console.error(...args);
    },
    debug: (...args) => {
      if (shouldLog('debug')) console.debug(...args);
    }
  };
}

async function start() {
  const transport = (process.env.TRANSPORT || 'baileys').toLowerCase();
  const logger = createLogger();

  if (transport !== 'baileys') {
    logger.warn(`⚠️ Transporte "${transport}" no soportado. Usando Baileys.`);
  }

  const client = {
    sendMessage: async (to, content, opts) => {
      if (typeof content === 'string') {
        return sendText(to, content);
      }
      if (content && content.mimetype && content.data) {
        return sendMedia(to, content, opts);
      }
      return sendText(to, String(content));
    }
  };

  await startBaileys({
    logger,
    onReady: () => {
      logger.info('✅ LIA Pagaré conectado a WhatsApp (Baileys).');
    },
    onMessage: async (msg) => {
      try {
        await handleMessage(client, { from: msg.from, body: msg.body, id: msg.id, raw: msg.raw });
      } catch (err) {
        logger.error('❌ Error en handleMessage (WhatsApp):', err);
        try {
          await client.sendMessage(
            msg.from,
            '⚠️ Ocurrió un error al procesar tu solicitud. Intenta de nuevo.'
          );
        } catch (sendErr) {
          logger.error('❌ Error al responder mensaje de error:', sendErr);
        }
      }
    }
  });
}

if (require.main === module) {
  start();
}

module.exports = { start };
