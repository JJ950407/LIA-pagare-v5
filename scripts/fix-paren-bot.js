#!/usr/bin/env node
// Quita el ');' sobrante tras el cierre del listener client.on('message', ...)
const fs = require('fs');
const path = require('path');

const BOT = path.resolve(process.cwd(), 'src', 'bot.js');
if (!fs.existsSync(BOT)) {
  console.error('No encontré src/bot.js');
  process.exit(1);
}

let s = fs.readFileSync(BOT, 'utf8');

// Localiza el inicio del listener
const startRe = /client\.on\s*\(\s*['"]message['"]\s*,\s*async?\s*\(\s*[a-zA-Z0-9_$]+\s*\)\s*=>\s*\{/m;
const m = s.match(startRe);
if (!m) {
  console.error('No encontré client.on("message", async (msg) => { ... }');
  console.error('Si tu listener usa otro estilo (function,msg), avísame y lo ajusto.');
  process.exit(1);
}

const startIndex = m.index + m[0].length - 1; // apunta al '{' de apertura
// Balancea llaves para encontrar el '}' que cierra el listener
let i = startIndex, depth = 0, inStr = false, esc = false, quote = null, closeBrace = -1;
for (; i < s.length; i++) {
  const ch = s[i];
  if (inStr) {
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === quote) { inStr = false; quote = null; }
    continue;
  }
  if (ch === '"' || ch === '\'' || ch === '`') { inStr = true; quote = ch; continue; }
  if (ch === '{') depth++;
  else if (ch === '}') {
    depth--;
    if (depth === 0) { closeBrace = i; break; }
  }
}
if (closeBrace < 0) {
  console.error('No pude balancear las llaves del listener.');
  process.exit(1);
}

// Mira los caracteres inmediatamente después del '}' de cierre
let j = closeBrace + 1;
while (j < s.length && /\s/.test(s[j])) j++;
// Si justo viene ');' lo eliminamos
if (s.slice(j, j + 2) === ');') {
  const before = s.slice(0, j);
  const after = s.slice(j + 2);
  s = before + after;
  fs.writeFileSync(BOT, s, 'utf8');
  console.log('✅ Removido el ); sobrante después del listener.');
} else {
  console.log('ℹ️ No había ); inmediato; no se cambió nada.');
}
