#!/usr/bin/env node
/* Parchea src/bot.js:
   - Extrae el cuerpo de client.on('message', ...) a handleIncomingMessage(client,msg)
   - Reemplaza el listener para delegar en esa función
   - Protege client.initialize() para headless
   - Agrega export de test headless (ctx,text,from)
*/
const fs = require('fs');
const path = require('path');

const BOT_PATH = path.resolve(process.cwd(), 'src', 'bot.js');
if (!fs.existsSync(BOT_PATH)) {
  console.error('❌ No encontré src/bot.js. Asegúrate de estar en la raíz del proyecto.');
  process.exit(1);
}

let src = fs.readFileSync(BOT_PATH, 'utf8');

// Idempotencia: si ya está parcheado, salir
if (src.includes('function handleIncomingMessage(') && src.includes('HEADLESS_TEST')) {
  console.log('ℹ️ Parece que src/bot.js ya está parcheado. No hago cambios.');
  process.exit(0);
}

// Util: busca índice de cierre de bloque { ... } balanceando llaves (maneja strings y escapes básicos)
function findMatchingBrace(s, startIndex) {
  let i = startIndex;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let quote = null;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === quote) { inStr = false; quote = null; continue; }
      continue;
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      inStr = true; quote = ch; continue;
    }
    if (ch === '{') { depth++; if (depth === 1 && i > startIndex) { /* entered block */ } }
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// 1) Localiza el listener de message
const listenerRegex = /client\.on\s*\(\s*['"]message['"]\s*,\s*async?\s*\(\s*([a-zA-Z0-9_$]+)\s*\)\s*=>\s*\{/m;
const m = src.match(listenerRegex);
if (!m) {
  console.error('❌ No pude encontrar `client.on("message", async (msg) => { ... })` en src/bot.js.');
  console.error('   Ajusta el script si tu listener usa otra forma (function(msg){}, diferente variable, etc.).');
  process.exit(1);
}

const msgVar = m[1];
const bodyStart = m.index + m[0].length - 1; // índice del '{' que abre el body
const bodyEnd = findMatchingBrace(src, bodyStart);
if (bodyEnd < 0) {
  console.error('❌ No pude balancear llaves del listener message. Revisa que las llaves estén correctas.');
  process.exit(1);
}

const body = src.slice(bodyStart + 1, bodyEnd); // contenido interno del listener
const before = src.slice(0, m.index);
const after = src.slice(bodyEnd + 1);

// 2) Construye la función reutilizable
const fnBlock = `\n\n// == Added by patch-bot.js ==\nasync function handleIncomingMessage(client, ${msgVar}) {\n${body}\n}\n`;

// 3) Reemplaza el listener por una delegación segura
const newListener = `client.on('message', async (${msgVar}) => {\n  try {\n    await handleIncomingMessage(client, ${msgVar});\n  } catch (e) {\n    console.error('Error en handleIncomingMessage:', e);\n  }\n});\n`;

// 4) Protege client.initialize() para no arrancar en headless
let protectedSrc = before + newListener + after;
protectedSrc = protectedSrc.replace(
  /client\.initialize\s*\(\s*\)\s*;?/g,
  "if (process.env.HEADLESS_TEST !== '1') client.initialize();"
);

// 5) Agrega hook headless al final
const hook = `

// == Headless test hook ==
if (process.env.HEADLESS_TEST === '1') {
  function makeFakeMsg(from, text, ctx) {
    return {
      from,
      body: String(text || ''),
      hasMedia: false,
      downloadMedia: async () => null,
      reply: async (t) => ctx.sendText(from, t)
    };
  }
  function makeFakeClient(ctx) {
    return {
      sendMessage: async (to, content /*, opts */) => ctx.sendText(to, content)
    };
  }
  module.exports = async function testRouter(ctx, text, from) {
    const fakeClient = makeFakeClient(ctx);
    const fakeMsg = makeFakeMsg(from, text, ctx);
    return handleIncomingMessage(fakeClient, fakeMsg);
  };
}
// == end headless hook ==
`;

const patched = protectedSrc + fnBlock + hook;

// Backup y escritura
const bakPath = BOT_PATH + '.bak';
fs.writeFileSync(bakPath, src, 'utf8');
fs.writeFileSync(BOT_PATH, patched, 'utf8');

console.log('✅ Parche aplicado a src/bot.js');
console.log('🗂 Backup creado en:', bakPath);
