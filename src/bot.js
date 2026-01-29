// bot.js – LIA Pagaré v4 (raíz)
// Conecta WhatsApp (whatsapp-web.js) con el core modular (src/core/index.js)
// Forzando a usar el Chromium de puppeteer para evitar timeouts

require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const puppeteer = require('puppeteer');

// Cerebro nuevo (el que ya funciona con test.js)
const { handleMessage } = require('./src/core/index');

// =======================
//   CONFIGURACIÓN WS
// =======================

const client = new Client({
  authStrategy: new LocalAuth(), // mantiene la misma sesión en .wwebjs_auth

  // Estos options se pasan a puppeteer.launch()
  puppeteer: {
    headless: false,                         // que se vea la ventana, más estable en Mac
    executablePath: puppeteer.executablePath(), // usa el Chromium que instaló puppeteer
    timeout: 0,                              // sin límite de 30s para lanzar el browser
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  },
});

// =======================
//   EVENTOS BÁSICOS
// =======================

client.on('qr', (qr) => {
  console.log('📲 Escanea este QR con tu WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ LIA Pagaré v4 conectado a WhatsApp. Listo para recibir "Menu".');
});

// =======================
//   MANEJO DE MENSAJES
// =======================

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

// =======================
//   INICIALIZAR CLIENTE
// =======================

client.initialize();
