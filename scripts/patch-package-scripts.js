#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const pkgPath = path.resolve(process.cwd(), 'package.json');

const want = {
  smoke: 'node scripts/smoke.js tests/cases/venta_contrato.json',
  'smoke:all': 'node scripts/smoke.js --all',
  'test-montos': 'node scripts/test-montos.js'
};

let text = fs.readFileSync(pkgPath, 'utf8');

// 1) Si hay dos objetos raíz pegados, intenta quedarte con el primero JSON válido
try {
  JSON.parse(text);
} catch {
  // recorta desde el primer '{' hasta el último '}' válido
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    text = text.slice(first, last + 1);
  }
}

const pkg = JSON.parse(text);
pkg.scripts = pkg.scripts || {};
Object.assign(pkg.scripts, want);

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log('✔ package.json actualizado. Scripts añadidos:', Object.keys(want));
