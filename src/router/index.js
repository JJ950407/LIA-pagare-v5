// src/router/index.js
// Adaptador universal para el tester headless.
// Carga el módulo real del flujo (CJS o ESM) y normaliza la invocación a: (ctx, text, from)

const path = require('path');
const { pathToFileURL } = require('url');

async function loadAny(absPath) {
  // 1) intenta require (CJS)
  try {
    const mod = require(absPath);
    return mod && mod.__esModule ? (mod.default || mod) : mod;
  } catch (e) {
    // 2) si es ESM puro, intenta dynamic import
    if (String(e.message || e).includes('ERR_REQUIRE_ESM')) {
      const url = pathToFileURL(absPath).href;
      const m = await import(url);
      return m && (m.default || m);
    }
    // si falló por “no existe”, seguimos probando otros candidatos
    if (
      String(e.message || e).includes('Cannot find module') ||
      String(e.code || '').includes('MODULE_NOT_FOUND')
    ) {
      return null;
    }
    // otro error real
    throw e;
  }
}

async function tryLoad(candidates) {
  for (const rel of candidates) {
    const abs = path.resolve(process.cwd(), rel);
    const mod = await loadAny(abs);
    if (mod) {
      console.log('[router-adapter] usando:', rel);
      return mod;
    }
  }
  return null;
}

let modPromise = null;
async function getModule() {
  if (!modPromise) {
    const candidates = [
      'src/flows/index.js',
      'src/flows.js',
      'src/bot.js' // por si el flujo principal vive aquí
    ];
    modPromise = tryLoad(candidates);
  }
  return modPromise;
}

// Normaliza la invocación del flujo real:
async function invokeReal(mod, ctx, text, from) {
  // 1) export = function(ctx, text, from)
  if (typeof mod === 'function' && mod.length >= 3) return mod(ctx, text, from);
  // 2) export = function(ctx, { body, from })
  if (typeof mod === 'function' && mod.length <= 2) return mod(ctx, { body: text, from });
  // 3) export = { routeFlow }
  if (mod && typeof mod.routeFlow === 'function' && mod.routeFlow.length >= 3) {
    return mod.routeFlow(ctx, text, from);
  }
  // 4) export = { routeFlow: { handle } }
  if (mod && mod.routeFlow && typeof mod.routeFlow.handle === 'function') {
    return mod.routeFlow.handle(ctx, text, from);
  }
  // 5) export = { routeFlow: { routeFlow } }
  if (mod && mod.routeFlow && typeof mod.routeFlow.routeFlow === 'function') {
    return mod.routeFlow.routeFlow(ctx, text, from);
  }
  // 6) export = { handle }
  if (mod && typeof mod.handle === 'function') {
    if (mod.handle.length >= 3) return mod.handle(ctx, text, from);
    return mod.handle(ctx, { body: text, from });
  }
  throw new Error('[router-adapter] No encontré una firma compatible en el módulo cargado.');
}

// Exporta una función (CJS) compatible con smoke.js:
module.exports = async function router(ctx, text, from) {
  const mod = await getModule();
  if (!mod) {
    throw new Error('[router-adapter] No encontré ningún módulo de flujo. Crea src/flows/index.js o ajusta rutas.');
  }
  return invokeReal(mod, ctx, text, from);
};
