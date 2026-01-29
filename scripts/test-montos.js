#!/usr/bin/env node
/* eslint-disable no-console */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DEFAULT_CASE = path.resolve(process.cwd(), 'tests', 'cases', 'venta_contrato.json');
const RUNS = Number(process.env.RUNS || process.argv[2] || 5);

function rand(min, max) {
  return Math.round((Math.random() * (max - min) + min) / 1) * 1; // entero simple
}

function mutateAmounts(caseObj) {
  const amountFields = ['total:', 'enganche:', 'mensualidad:', 'anualidadMonto:'];
  for (const step of caseObj.steps) {
    const key = String(step.text ?? step.input ?? '');
    for (const f of amountFields) {
      if (key.toLowerCase().startsWith(f)) {
        const val = rand(2000, 250000).toLocaleString('es-MX');
        const prefix = key.split(':')[0];
        step.text = `${prefix}: $${val}.00`;
      }
    }
  }
  return caseObj;
}

function run(tempCasePath) {
  execSync(`node scripts/smoke.js "${tempCasePath}"`, { stdio: 'inherit' });
}

(function main() {
  if (!fs.existsSync(DEFAULT_CASE)) {
    console.error(`No existe el caso base: ${DEFAULT_CASE}`);
    process.exit(1);
  }
  const base = JSON.parse(fs.readFileSync(DEFAULT_CASE, 'utf8'));

  for (let i = 1; i <= RUNS; i++) {
    console.log(`\n=== RUN ${i}/${RUNS} ===`);
    const mutated = mutateAmounts(JSON.parse(JSON.stringify(base)));
    const tmp = path.resolve(process.cwd(), 'data', `tmp_case_${Date.now()}_${i}.json`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(mutated, null, 2), 'utf8');
    try { run(tmp); } finally {
      try { fs.unlinkSync(tmp); } catch {}
    }
  }
  console.log('\nOK: test-montos completado.');
})();
