#!/usr/bin/env node
/* Arregla package.json roto: elimina BOM/comentarios/comas finales y recorta JSON balanceado. */
const fs = require('fs');
const path = require('path');
const pkgPath = path.resolve(process.cwd(), 'package.json');
const raw0 = fs.readFileSync(pkgPath, 'utf8');

// Backup
const bakPath = pkgPath + '.bak';
fs.writeFileSync(bakPath, raw0, 'utf8');

function stripBOM(s){ return s.replace(/^\uFEFF/, ''); }
function stripComments(s){
  // /* ... */  y  // ...
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/(^|[^:])\/\/.*$/gm, '$1'); // evita URLs http://
  return s;
}
function stripTrailingCommas(s){
  // ,  seguido de  }  o  ]
  return s.replace(/,(\s*[}\]])/g, '$1');
}
function sliceBalancedJSON(s){
  const start = s.indexOf('{');
  if (start < 0) return s;
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < s.length; i++){
    const ch = s[i];
    if (inStr){
      if (esc){ esc = false; }
      else if (ch === '\\') { esc = true; }
      else if (ch === '"') { inStr = false; }
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0){ end = i; break; }
      }
    }
  }
  return end >= 0 ? s.slice(start, end + 1) : s.slice(start);
}

let text = stripBOM(raw0);
text = stripComments(text);
text = stripTrailingCommas(text);
text = sliceBalancedJSON(text);

let pkg;
try {
  pkg = JSON.parse(text);
} catch (e) {
  console.error('❌ Sigue inválido tras saneo. Revisa cerca de la posición indicada.');
  console.error(e.message);
  console.error('Consejo: abre package.json.bak y elimina cualquier segundo { ... } que esté después del } final.');
  process.exit(1);
}

// Añade scripts deseados
pkg.scripts = pkg.scripts || {};
pkg.scripts['smoke'] = 'node scripts/smoke.js tests/cases/venta_contrato.json';
pkg.scripts['smoke:all'] = 'node scripts/smoke.js --all';
pkg.scripts['test-montos'] = 'node scripts/test-montos.js';

// Escribe limpio
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log('✅ package.json arreglado y scripts agregados.');
console.log('🗂 Backup en:', bakPath);
