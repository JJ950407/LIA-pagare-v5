// bot.js – LIA Pagaré v4 (uso real en WhatsApp)
// Misma config que tu bot viejo, pero apuntando al core modular

require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Cerebro nuevo (el mismo que usa test.js)
const { handleMessage } = require('./src/core/index');

// ========== CONFIGURACIÓN DEL CLIENTE ==========

const client = new Client({
  authStrategy: new LocalAuth(),          // usa .wwebjs_auth (misma sesión)
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox'], // igual que antes
  },
});

// ========== EVENTOS BÁSICOS ==========

client.on('qr', (qr) => {
  console.log('📲 Escanea este QR con tu WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ LIA Pagaré v4 conectado a WhatsApp. Listo para recibir "Menu".');
});

// ========== MANEJO DE MENSAJES ==========

client.on('message', async (msg) => {
  try {
    const m = {
      from: msg.from,
      body: (msg.body || '').trim(),
    };

    await handleMessage(client, m);
  } catch (err) {
    console.error('❌ Error en handleMessage (WhatsApp):', err);
    try {
      await msg.reply('⚠️ Ocurrió un error al procesar tu solicitud. Intenta de nuevo.');
    } catch (e) {
      console.error('❌ Error al responder mensaje de error:', e);
    }
  }
});

// ========== INICIO ==========

client.initialize();
