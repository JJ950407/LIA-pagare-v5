const fs = require('fs');
const path = require('path');
const real = require('./doublepass');

let buildMapping = null;
try { buildMapping = require('../../../config/mapping.safe.js'); } catch (_) {}

/* Utils */
function keysOf(o){ try { return Object.keys(o||{});} catch { return []; } }
function safeWrite(file, obj){ try { fs.writeFileSync(file, JSON.stringify(obj,null,2)); } catch {} }
function isPlainObj(v){ return v && typeof v==='object' && !Array.isArray(v); }
function parseFecha(str){
  if (!str || typeof str!=='string') return null;
  const s = str.trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const d = new Date(+m[3], +m[2]-1, +m[1]);
    return isNaN(d) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function fmt(d){
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}
function deepFind(obj, predicate, maxNodes=5000){
  const seen = new Set();
  const stack = [{v:obj, path:[]}];
  let visits=0;
  while (stack.length && visits < maxNodes){
    const {v, path} = stack.pop();
    if (!v || typeof v!=='object') continue;
    if (seen.has(v)) continue;
    seen.add(v); visits++;
    try { if (predicate(v, path)) return {value:v, path}; } catch {}
    if (Array.isArray(v)){
      for (let i=v.length-1;i>=0;i--) stack.push({v:v[i], path: path.concat([`[${i}]`])});
    } else {
      const ks = Object.keys(v);
      for (let i=ks.length-1;i>=0;i--){
        const k=ks[i];
        stack.push({v:v[k], path:path.concat([k])});
      }
    }
  }
  return null;
}

/* Heurísticas */
function looksLikeFinalMapping(m){
  if (!isPlainObj(m)) return false;
  const must = ['nombre deudor','direccion deudor','poblacion deudor','pagares'];
  const has = must.every(k => k in m);
  if (!has) return false;
  const nombre = (m['nombre deudor']||'').toString().trim();
  const pagaresLen = Array.isArray(m.pagares) ? m.pagares.length : 0;
  return (nombre && pagaresLen>0);
}
function looksUsefulRaw(o){
  if (!isPlainObj(o)) return false;
  const keys = Object.keys(o);
  if (keys.includes('comprador') || keys.includes('cliente') || keys.includes('listaPagares') || keys.includes('lote')) return true;
  if (typeof o.nombre === 'string' && o.nombre.trim()) return true;
  if ('mensual' in o || 'numeroPagares' in o || 'mensualidad' in o || 'pagares' in o) return true;
  const predioHints = ['nombre predio','ubicación predio','municipio predio','manzana y lote(s)','superficie numero','superficie letra'];
  if (predioHints.some(k => k in o)) return true;
  return false;
}
function findBestRawSource(cands){
  for (const c of cands){ if (looksUsefulRaw(c)) return c; }
  for (const c of cands){ const hit = deepFind(c, v => looksUsefulRaw(v)); if (hit) return hit.value; }
  for (const c of cands){ if (c && Object.keys(c).length) return c; }
  return {};
}

function findNombre(any){
  // 1) variantes directas comunes
  const direct = [
    'nombre deudor','nombre_deudor','deudor','deudor_nombre',
    'comprador','comprador_nombre','nombreComprador',
    'cliente','cliente_nombre','clienteNombre','nombreCliente',
    'titular','propietario','beneficiario',
    'nombre'
  ];
  for (const k of direct){
    const v = any && any[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object'){
      const c1 = v.nombreCompleto || v.nombre;
      if (typeof c1 === 'string' && c1.trim()) return c1.trim();
      // armar "nombres + apellidos"
      const c2 = [v.nombres, v.apellidos].filter(Boolean).join(' ').trim();
      if (c2) return c2;
    }
  }

  // 2) comprador/cliente anidados
  const cc = any?.comprador || any?.cliente || any?.titular || any?.propietario;
  if (cc){
    const v = cc.nombreCompleto || cc.nombre || [cc.nombres, cc.apellidos].filter(Boolean).join(' ').trim();
    if (typeof v === 'string' && v.trim()) return v.trim();
  }

  // 3) deep: (a) objeto con propiedad "nombre" usable
  const hitObj = deepFind(any, v => isPlainObj(v) && typeof v.nombre === 'string' && v.nombre.trim());
  if (hitObj) return hitObj.value.nombre.trim();

  // 4) deep: (b) cualquier par clave/valor donde la clave sugiera nombre de deudor/cliente/comprador/titular
  const hitKV = deepFind(any, v => {
    if (!isPlainObj(v)) return false;
    for (const k of Object.keys(v)){
      const key = k.toLowerCase();
      if (/(^nombre$|deudor|cliente|comprador|titular|propietario)/.test(key)){
        const val = v[k];
        if (typeof val === 'string' && val.trim()) return true;
      }
    }
    return false;
  });
  if (hitKV){
    const obj = hitKV.value;
    for (const k of Object.keys(obj)){
      const key = k.toLowerCase();
      if (/(^nombre$|deudor|cliente|comprador|titular|propietario)/.test(key)){
        const val = obj[k];
        if (typeof val === 'string' && val.trim()) return val.trim();
      }
    }
  }

  return '';
}
  const cc = any?.comprador || any?.cliente;
  if (cc){ const v = cc.nombreCompleto || cc.nombre; if (typeof v==='string' && v.trim()) return v.trim(); }
  const hit = deepFind(any, v => isPlainObj(v) && typeof v.nombre==='string' && v.nombre.trim());
  if (hit) return hit.value.nombre.trim();
  return '';
}
function findListaPagares(any){
  if (Array.isArray(any?.listaPagares) && any.listaPagares.length) return any.listaPagares;
  if (Array.isArray(any?.lote) && any.lote.length) return any.lote;
  const hit = deepFind(any, (v)=>{
    if (!Array.isArray(v) || v.length===0) return false;
    const s=v[0]; if (!s||typeof s!=='object') return false;
    const hasMonto = ('monto' in s) || ('importe' in s);
    const hasFecha = ('fecha' in s) || ('fecha_vencimiento' in s) || ('vencimiento' in s);
    return hasMonto && hasFecha;
  });
  return hit ? hit.value : [];
}
function normalizePagares(lista){
  return lista.map((it, idx)=>{
    const folio = (it?.folio!=null ? String(it.folio).padStart(2,'0') : String(idx+1).padStart(2,'0'));
    const iso   = it?.fecha || it?.fecha_vencimiento || it?.vencimiento || '';
    const d     = parseFecha(iso);
    const fecha = d ? fmt(d) : (it?.fecha || it?.vencimiento || '');
    const montoNum = Number(it?.monto ?? it?.importe ?? 0);
    const monto = montoNum.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
    const obs = it?.obs || it?.observaciones || (it?.tipo ? String(it.tipo).toUpperCase() : '');
    const monto_letra = String(it?.monto_letra || it?.importe_letra || `${montoNum} PESOS 00/100 M.N.`).toUpperCase();
    return { folio, fecha, monto, monto_letra, obs };
  });
}
function toNum(x){ if(x==null) return 0; const s=String(x).replace(/[^0-9.\-]/g,''); const n=Number(s); return isNaN(n)?0:n; }
function synthPagaresFromParams(m){
  const mensual = toNum(m.mensual ?? m.mensualidad ?? m.montoMensual ?? m.mensualidad_monto);
  const n       = toNum(m.numeroPagares ?? m.numPagares ?? m.pagares ?? m.numero_mensualidades);
  if(!mensual || !n) return [];
  let start = parseFecha(m.fechaPrimerPago);
  if(!start){
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), 30);
    start = (now.getDate()>30) ? new Date(now.getFullYear(), now.getMonth()+1, 30) : base;
  }
  const out=[];
  for (let i=0;i<n;i++){
    const d = new Date(start.getFullYear(), start.getMonth()+i, 30);
    const montoNum = mensual;
    out.push({
      folio: String(i+1).padStart(2,'0'),
      fecha: fmt(d),
      monto: montoNum.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2}),
      monto_letra: (`${montoNum} PESOS 00/100 M.N.`).toUpperCase(),
      obs: ''
    });
  }
  return out;
}

/* Wrapper principal */
async function generateContractDoublePass(args){
  const a = { ...(args||{}) };

  // Forzar plantilla si existe
  try {
    const myTpl = path.join(__dirname, '../../../templates/contract.docx');
    if (fs.existsSync(myTpl)) a.templatePath = myTpl;
  } catch {}

  // Candidatos (incluye globals)
  const candidates = [
    a.mapping, a.data, a.payload, a.body, a.venta, a.datos, a.draft, a.state, a.session, a.ctx, a,
    (globalThis && globalThis.datosVentaOdraft) ? globalThis.datosVentaOdraft : null,
    (globalThis && globalThis._lia_form) ? globalThis._lia_form : null,
    (globalThis && globalThis._lia_state) ? globalThis._lia_state : null,
    (globalThis && globalThis._lia_draft) ? globalThis._lia_draft : null
  ].filter(Boolean);

  // DIAG inicial
  const diagArgs = { at:new Date().toISOString(),
    topLevelKeys: keysOf(a),
    mappingKeys: keysOf(a.mapping),
    dataKeys: keysOf(a.data)
  };
  safeWrite('/tmp/lia-debug-args.json', diagArgs);
  console.log('DIAG KEYS (pre):', diagArgs);

  // Si el mapping de entrada ya sirve, úsalo; si no, busca fuente y construye
  let mappingIn = a.mapping;
  const mappingReady = looksLikeFinalMapping(mappingIn);
  let source = mappingReady ? mappingIn : findBestRawSource(candidates);

  let mapping = mappingReady ? mappingIn : {};
// LIA SOURCE DUMP
try {
  const _keys = Object.keys(source || {});
  require('fs').writeFileSync('/tmp/lia-source-keys.txt', _keys.join('\n'));
  const preview = {};
  for (const k of _keys.slice(0,30)) {
    const v = source[k];
    if (typeof v === 'string' || typeof v === 'number') preview[k] = v;
    else if (Array.isArray(v)) preview[k] = {type:'array',len:v.length};
    else if (v && typeof v === 'object') preview[k] = {type:'object',keys:Object.keys(v).slice(0,5)};
  }
  require('fs').writeFileSync('/tmp/lia-source-sample.json', JSON.stringify(preview,null,2));
  console.log('CHOSEN SOURCE KEYS:', _keys);
} catch(e){ console.log('dump source fail', e.message); }

  // === DUMP de la fuente elegida (para diagnóstico) ===
  try {
    const _keys = Object.keys(source || {});
    fs.writeFileSync('/tmp/lia-source-keys.txt', _keys.join('\n'));
    const seen = new Set();
    const shallow = {};
    (_keys||[]).slice(0,100).forEach(k=>{
      const v = source[k];
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v == null) {
        shallow[k] = v;
      } else if (Array.isArray(v)) {
        shallow[k] = { __type: 'array', length: v.length, sample: v[0] };
      } else if (v && typeof v === 'object') {
        const kk = Object.keys(v).slice(0,10);
        const small = {};
        kk.forEach(sk=>{
          const sv = v[sk];
          if (typeof sv === 'string' || typeof sv === 'number' || typeof sv === 'boolean' || sv == null) {
            small[sk] = sv;
          } else if (Array.isArray(sv)) {
            small[sk] = { __type: 'array', length: sv.length };
          } else if (sv && typeof sv === 'object') {
            small[sk] = { __type: 'object', keys: Object.keys(sv).slice(0,5) };
          }
        });
        shallow[k] = { __type: 'object', keys: kk, sample: small };
      }
    });
    fs.writeFileSync('/tmp/lia-source-sample.json', JSON.stringify(shallow, null, 2));
    console.log('CHOSEN SOURCE KEYS:', _keys);
  } catch (e) { console.log('DUMP source error:', e?.message); }
  if (!mappingReady && typeof buildMapping === 'function'){
    try {
      mapping = buildMapping(source, { numeroALetras: a.numeroALetras });
    } catch (e) {
      safeWrite('/tmp/lia-debug-buildMapping-error.json', { message: e.message, stack: String(e.stack||'') });
      mapping = {};
    }
  }

  // Red de seguridad
  if (!mapping['nombre deudor']) mapping['nombre deudor'] = findNombre(source);
  if (!mapping['direccion deudor']) mapping['direccion deudor'] = (source?.comprador?.domicilio || source?.direccion || '');
  if (!mapping['poblacion deudor']) mapping['poblacion deudor'] = (source?.comprador?.ciudad || source?.poblacion || '');

  if (!Array.isArray(mapping.pagares) || mapping.pagares.length===0){
    let lista = findListaPagares(source);
    if (lista.length) mapping.pagares = normalizePagares(lista);
  }
  if (!Array.isArray(mapping.pagares) || mapping.pagares.length===0){
    console.log('SYNTH INPUTS', {
      mensual: source?.mensual ?? source?.mensualidad ?? source?.montoMensual ?? source?.mensualidad_monto,
      numeroPagares: source?.numeroPagares ?? source?.numPagares ?? source?.pagares ?? source?.numero_mensualidades,
      pagaressrc: Array.isArray(source?.listaPagares)? source.listaPagares.length : (Array.isArray(source?.lote)? source.lote.length : 0)
    });
    mapping.pagares = synthPagaresFromParams(source);
  }

  if (!mapping.fechaPrimerPago && Array.isArray(mapping.pagares) && mapping.pagares.length){
    mapping.fechaPrimerPago = mapping.pagares[0].fecha;
  }

  
// LIA NAME FALLBACKS
if (!mapping['nombre deudor']) {
  mapping['nombre deudor'] = findNombre(source);
  try {
    if (!mapping['nombre deudor'] && source?.cliente?.nombre) mapping['nombre deudor'] = String(source.cliente.nombre).trim();
    if (!mapping['nombre deudor'] && source?.cliente?.nombreCompleto) mapping['nombre deudor'] = String(source.cliente.nombreCompleto).trim();
    if (!mapping['nombre deudor'] && source?.comprador?.nombre) mapping['nombre deudor'] = String(source.comprador.nombre).trim();
    if (!mapping['nombre deudor'] && source?.comprador?.nombreCompleto) mapping['nombre deudor'] = String(source.comprador.nombreCompleto).trim();
    if (!mapping['nombre deudor'] && source?.deudor) mapping['nombre deudor'] = String(source.deudor).trim();
  } catch {}
  if (!mapping['nombre deudor'] && Array.isArray(mapping.pagares) && mapping.pagares.length) {
    const fp = mapping.pagares[0] || {};
    mapping['nombre deudor'] = String(fp.nombre_deudor || fp.deudor || fp.cliente || '').trim();
  }
}

const diagMap = { at:new Date().toISOString(),
    templatePath: a.templatePath,
    chosenSourceKeys: keysOf(source),
    keys: keysOf(mapping),
    sample: {
      nombre: mapping['nombre deudor'],
      direccion: mapping['direccion deudor'],
      fechaPrimerPago: mapping.fechaPrimerPago,
      pagaresCount: Array.isArray(mapping.pagares) ? mapping.pagares.length : 0,
      firstP: Array.isArray(mapping.pagares)&&mapping.pagares.length ? mapping.pagares[0] : null
    }
  };
  console.log('CHOSEN SOURCE KEYS:', diagMap.chosenSourceKeys);
  safeWrite('/tmp/lia-debug-mapping.json', diagMap);
  console.log('USANDO TEMPLATE:', a.templatePath);
  console.log('DEBUG CONTRATO:', diagMap.sample);

  if (!mapping['nombre deudor']) throw new Error('Mapping incompleto: "nombre deudor" vacío');
  if (!Array.isArray(mapping.pagares) || mapping.pagares.length===0) throw new Error('Mapping incompleto: pagares[] vacío');

  a.mapping = mapping;
  return real.generateContractDoublePass(a);
}

module.exports = { generateContractDoublePass };
