const fs = require('fs');
const path = require('path');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function sanitize(s) { return String(s).replace(/[^\w.-]+/g, '_').slice(0, 80); }

class MockCtx {
  constructor({ runDir }) {
    this.runDir = runDir;
    this.attachmentsDir = path.join(runDir, 'out');
    this.logFilePath = path.join(runDir, 'run.log.json');
    this.logs = [];
    ensureDir(this.runDir);
    ensureDir(this.attachmentsDir);

    this.config = {
      APP_NAME: process.env.APP_NAME || 'LIA-BOT',
      TZ: process.env.TZ || 'America/Mexico_City',
      DATA_ROOT: process.env.DATA_ROOT || path.resolve(process.cwd(), 'data'),
      TEMPLATES_DIR: process.env.TEMPLATES_DIR || path.resolve(process.cwd(), 'templates'),
      LOG_LEVEL: process.env.LOG_LEVEL || 'info'
    };

    this._pushLog({ event: 'CONTEXT_INIT', runDir: this.runDir });
  }

  _pushLog(obj) {
    this.logs.push({ ts: new Date().toISOString(), ...obj });
    fs.writeFileSync(this.logFilePath, JSON.stringify(this.logs, null, 2), 'utf8');
  }

  log(level, msg, extra = {}) {
    this._pushLog({ level, msg, ...extra });
    if (this.config.LOG_LEVEL !== 'silent') {
      const payload = Object.keys(extra).length ? extra : '';
      console.log(`[${level.toUpperCase()}] ${msg}`, payload);
    }
  }

  // Estado opcional por chat
  state = new Map();
  getState(chatId, key, def = null) {
    const bag = this.state.get(chatId) || {};
    return key in bag ? bag[key] : def;
  }
  setState(chatId, key, val) {
    const bag = this.state.get(chatId) || {};
    bag[key] = val;
    this.state.set(chatId, bag);
  }

  // ---- Envíos simulados (todas con chatId) ----
  async sendText(chatId, text) {
    const file = path.join(this.attachmentsDir, `msg_${Date.now()}_${sanitize(chatId)}.txt`);
    fs.writeFileSync(file, String(text ?? ''), 'utf8');
    this.log('info', 'sendText()', { chatId, file });
    return { ok: true, file };
  }

  async sendButtons(chatId, caption, buttons = []) {
    const payload = { caption, buttons };
    const file = path.join(this.attachmentsDir, `buttons_${Date.now()}_${sanitize(chatId)}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    this.log('info', 'sendButtons()', { chatId, file, buttonsCount: buttons.length });
    return { ok: true, file };
  }

  async sendFile(chatId, filePathOrBuffer, caption = '') {
    let src = '';
    let dest = '';
    try {
      if (typeof filePathOrBuffer === 'string') {
        src = filePathOrBuffer;
        dest = path.join(this.attachmentsDir, `${Date.now()}_${sanitize(chatId)}_${path.basename(src)}`);
        fs.copyFileSync(src, dest);
      } else if (Buffer.isBuffer(filePathOrBuffer)) {
        dest = path.join(this.attachmentsDir, `${Date.now()}_${sanitize(chatId)}_attachment.bin`);
        fs.writeFileSync(dest, filePathOrBuffer);
        src = '(buffer)';
      } else {
        throw new Error('sendFile espera string (ruta) o Buffer.');
      }
      this.log('info', 'sendFile()', { chatId, src, dest, captionPreview: String(caption).slice(0, 120) });
      return { ok: true, file: dest };
    } catch (e) {
      this.log('error', 'sendFile() failed', { chatId, error: String(e) });
      return { ok: false, error: String(e) };
    }
  }

  // Alias común
  async sendMessage(chatId, text) { return this.sendText(chatId, text); }
}

module.exports = { MockCtx };
