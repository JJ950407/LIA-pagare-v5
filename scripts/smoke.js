#!/usr/bin/env node
/* eslint-disable no-console */
require('dotenv').config();
process.env.HEADLESS_TEST = '1'; // evita levantar WhatsApp al probar
const fs = require('fs');
const path = require('path');
const { MockCtx } = require('../src/test/mockCtx');

const BASE_TEST_DIR = path.resolve(process.cwd(), 'data', 'test-runs');

function requireIfExists(absPath) {
  try { return require(absPath); } catch (_) { return null; }
}

function resolveRouter() {
  // 1) Forzar por CLI:  node scripts/smoke.js tests/cases/venta_contrato.json --router src/flows/index.js
  const args = process.argv;
  const i = args.indexOf('--router');
  if (i !== -1 && args[i + 1]) {
    const forced = path.resolve(process.cwd(), args[i + 1]);
    try { return require(forced); } catch (e) {
      console.error('Router forzado inválido:', forced, e.message);
      return null;
    }
  }

  // 2) Forzar por ENV: ROUTER=src/flows/index.js npm run smoke
  if (process.env.ROUTER) {
    const forced = path.resolve(process.cwd(), process.env.ROUTER);
    try { return require(forced); } catch (e) {
      console.error('ROUTER inválido:', forced, e.message);
      return null;
    }
  }

  // 3) Autodetección (rutas más comunes en LIA)
  const candidates = [
    'src/flows/index.js',
    'src/flows.js',
    'src/router/index.js',
    'src/router.js'
  ].map(p => path.resolve(process.cwd(), p));

  for (const p of candidates) {
    const mod = requireIfExists(p);
    if (mod) return mod;
  }

  return null;
}

async function tryInvoke(router, ctx, text, from) {
  // 1) export = function(ctx, text, from)
  if (typeof router === 'function' && router.length >= 3) {
    console.log('Invocación: router(ctx, text, from)');
    await router(ctx, text, from);
    return true;
  }
  // 2) export = function(ctx, { body, from })
  if (typeof router === 'function' && router.length <= 2) {
    console.log('Invocación: router(ctx, { body, from })');
    await router(ctx, { body: text, from });
    return true;
  }
  // 3) export = { routeFlow }
  if (router && typeof router.routeFlow === 'function' && router.routeFlow.length >= 3) {
    console.log('Invocación: routeFlow(ctx, text, from)');
    await router.routeFlow(ctx, text, from);
    return true;
  }
  // 4) export = { routeFlow: { handle } }
  if (router && router.routeFlow && typeof router.routeFlow.handle === 'function') {
    console.log('Invocación: routeFlow.handle(ctx, text, from)');
    await router.routeFlow.handle(ctx, text, from);
    return true;
  }
  // 5) export = { routeFlow: { routeFlow } }
  if (router && router.routeFlow && typeof router.routeFlow.routeFlow === 'function') {
    console.log('Invocación: routeFlow.routeFlow(ctx, text, from)');
    await router.routeFlow.routeFlow(ctx, text, from);
    return true;
  }

  console.error('ERROR: No se encontró firma compatible para invocar el router.');
  return false;
}

function loadCase(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(raw);
  if (!Array.isArray(json.steps)) throw new Error('El caso debe tener un arreglo "steps".');
  return json;
}

async function runCase(caseFile) {
  const spec = loadCase(caseFile);
  const caseName = path.basename(caseFile, '.json');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(BASE_TEST_DIR, `${caseName}_${ts}`);
  fs.mkdirSync(runDir, { recursive: true });

  console.log(`\n▶ Caso: ${caseName}\n➜ RunDir: ${runDir}`);

  const ctx = new MockCtx({ runDir });
  const router = resolveRouter();
  if (!router) throw new Error('No pude resolver el router (usa --router o ROUTER=...).');

  const chatId = spec.chatId || process.env.TEST_FROM_NUMBER || '5215550000000@c.us';

  for (const [i, step] of spec.steps.entries()) {
    const text = step.text ?? step.input ?? '';
    console.log(`\n# Paso ${i + 1}/${spec.steps.length} — "${text}"`);
    ctx._pushLog({ event: 'INCOMING_TEXT', chatId, text });

    try {
      const invoked = await tryInvoke(router, ctx, text, chatId);
      if (!invoked) {
        console.error('Deteniendo caso por falta de firma compatible.');
        break;
      }
    } catch (e) {
      ctx.log('error', 'router throw', { step: i + 1, error: String(e), stack: e?.stack });
    }

    if (step.delay) await new Promise(r => setTimeout(r, step.delay));
  }

  console.log(`\n✔ Fin: ${caseName}\n➜ Log: ${path.join(runDir, 'run.log.json')}\n➜ Salidas: ${path.join(runDir, 'out')}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Uso: node scripts/smoke.js <ruta-a-caso.json> | --all [--router src/flows/index.js]');
    process.exit(1);
  }

  const files = [];
  if (args[0] === '--all') {
    const dir = path.resolve(process.cwd(), 'tests', 'cases');
    if (!fs.existsSync(dir)) {
      console.error(`No existe ${dir}`);
      process.exit(1);
    }
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) files.push(path.join(dir, f));
  } else {
    files.push(path.resolve(args[0]));
  }

  for (const f of files) await runCase(f);
}

if (require.main === module) {
  main().catch(e => {
    console.error('Fallo general:', e);
    process.exit(1);
  });
}
