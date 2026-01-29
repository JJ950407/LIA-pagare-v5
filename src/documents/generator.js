// src/documents/generator.js
// Motor de documentos: pagarés + contrato (igual que el bot original, ahora con predio/linderos/testigos)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument } = require('pdf-lib');
const Jimp = require('jimp');
const QrCode = require('qrcode-reader');

// Rutas base del proyecto
const SRC_ROOT = path.resolve(__dirname, '..');      // .../src
const PROJECT_ROOT = path.resolve(SRC_ROOT, '..');   // .../lia-pagare-v4

// PDF genérico (pagarés)
const { renderToFile, renderToBuffer } = require('../pdf');

// Mapping seguro para contrato
const buildMapping = require(path.join(PROJECT_ROOT, 'config', 'mapping.safe.js'));
let numeroALetras;
try {
  numeroALetras = require(path.join(PROJECT_ROOT, 'utils', 'numeroALetras'));
} catch (_) {
  numeroALetras = undefined;
}

// Generador DOCX→PDF para contrato
const { generateContractDocxPdf } = require(path.join(SRC_ROOT, 'modules', 'contracts', 'generate'));

// Config
const OUTPUT_ROOT = 'data/clientes';

// --- Helpers num/fecha/string ---
const two = (n) => String(n).padStart(2, '0');
const toCents = (n) => Math.round(Number(n) * 100);
const fromCents = (c) => Math.round(c) / 100;

function slugify(s) {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .slice(0, 60);
}

// Fecha local segura (sin saltos por zona horaria): 'YYYY-MM-DD'
function ymdLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function ymd(d) {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

function fmtDMY(d) {
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function primera15o30(fechaEmision, preferencia) {
  const d = new Date(fechaEmision);
  const diaRef = d.getDate() <= 15 ? 15 : 30;
  const baseMonthOffset = preferencia === 'siguiente' ? 1 : 0;
  const targetMonth = d.getMonth() + baseMonthOffset;
  const year = d.getFullYear() + Math.floor(targetMonth / 12);
  const month = targetMonth % 12;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const day = diaRef > lastDay ? lastDay : diaRef;
  return new Date(year, month, day);
}

function addMonthsKeepBaseDay(date, months, baseDay) {
  const targetMonth = date.getMonth() + months;
  const year = date.getFullYear() + Math.floor(targetMonth / 12);
  const month = targetMonth % 12;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const day = baseDay > lastDay ? lastDay : baseDay;
  return new Date(year, month, day);
}

// --- HASH & AUDIT Helpers ---
async function sha256HexFromBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
async function sha256HexFromFile(filePath) {
  const data = fs.readFileSync(filePath);
  return sha256HexFromBuffer(data);
}

/**
 * Escribe audit JSON atómico para cada pagaré
 */
function writePagareAuditJson({
  outDir, baseDocId, docId, clienteSlug, ventaId,
  folio, deudor, monto, venceISO, venceDMY,
  preHash, postHash, pdfPath
}) {
  fs.mkdirSync(outDir, { recursive: true });
  const createdAt = new Date().toISOString();
  const shortHash = preHash.slice(0, 10);

  const auditObj = {
    tipo: 'PAGARE',
    baseDocId,
    docId,
    clienteSlug,
    ventaId,
    folio,
    deudor,
    monto,
    venceISO,
    venceDMY,
    hash_sha256_pre_qr: preHash,
    hash_corto_pre_qr: shortHash,
    hash_sha256_post_qr: postHash,
    qr_code: {},
    pdfPath,
    createdAt
  };

  const safeBase = `${docId}_${createdAt.replace(/[:.]/g, '-')}`;
  const finalPath = path.join(outDir, `audit_${safeBase}.json`);
  const tmpPath   = finalPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(auditObj, null, 2), 'utf8');
  fs.renameSync(tmpPath, finalPath);
  return { auditPath: finalPath, shortHash };
}

// --- Plan de pagos (mensualidades + anualidades) ---
function planPagosPorCents(saldo_c, mensual_c) {
  const N = Math.ceil(saldo_c / mensual_c);
  const montos = Array(N).fill(mensual_c);
  const sobrepago = N * mensual_c - saldo_c;
  let rest = sobrepago;
  for (let i = N - 1; i >= 0 && rest > 0; i--) {
    const can = Math.min(rest, montos[i] - 1);
    montos[i] -= can;
    rest -= can;
  }
  return montos;
}

function calcListaPagares(data) {
  const saldo_c = toCents(data.saldo || (data.total - data.enganche));
  const anual_c = toCents(data.anualidadMonto || 0);
  const numAnn = Number(data.numeroAnualidades || 0);
  const totalAnn_c = anual_c * numAnn;
  const saldoMens_c = saldo_c - totalAnn_c;
  const mens_c = toCents(data.mensual || 0);
  const montosMens = planPagosPorCents(saldoMens_c, mens_c);

  const fechaEmision = data.fechaEmision instanceof Date
    ? data.fechaEmision
    : new Date(data.fechaEmision);

  let venc = primera15o30(fechaEmision, data.reglaPref || 'mismo');
  const baseDay = fechaEmision.getDate() <= 15 ? 15 : 30;
  let annRestantes = numAnn;
  let folioContador = 0;
  const lista = [];

  for (let i = 0; i < montosMens.length; i++) {
    folioContador++;
    const folioStr = two(folioContador);
    lista.push({
      folio: folioStr,
      monto: Number(fromCents(montosMens[i]).toFixed(2)),
      fecha_vencimiento: ymdLocal(venc),
      tipo: 'mensualidad'
    });
    const mesVenc = venc.getMonth() + 1;
    if (annRestantes > 0 && mesVenc === (data.anualidadMes || 12)) {
      folioContador++;
      const folioAnnStr = two(folioContador);
      lista.push({
        folio: folioAnnStr,
        monto: Number(fromCents(anual_c).toFixed(2)),
        fecha_vencimiento: ymdLocal(venc),
        tipo: 'anualidad'
      });
      annRestantes--;
    }
    venc = addMonthsKeepBaseDay(venc, 1, baseDay);
  }

  while (annRestantes > 0) {
    const mesVenc = venc.getMonth() + 1;
    if (mesVenc === (data.anualidadMes || 12)) {
      folioContador++;
      const folioAnnStr = two(folioContador);
      lista.push({
        folio: folioAnnStr,
        monto: Number(fromCents(anual_c).toFixed(2)),
        fecha_vencimiento: ymdLocal(venc),
        tipo: 'anualidad'
      });
      annRestantes--;
    }
    venc = addMonthsKeepBaseDay(venc, 1, baseDay);
  }

  const mens = lista.filter(p => p.tipo === 'mensualidad');
  const ann  = lista.filter(p => p.tipo === 'anualidad');
  const combined = [...mens, ...ann];

  for (let i = 0; i < combined.length; i++) {
    combined[i].folio = (i + 1).toString().padStart(2, '0');
  }

  return combined;
}

// --- Normalizadores de predio/linderos ---

function parseNumeroFromText(raw) {
  if (!raw) return 0;
  const m = String(raw).match(/[\d.,]+/);
  if (!m) return 0;
  const clean = m[0].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.');
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}

function parseLindero(raw) {
  if (!raw) {
    return { metros: 0, colinda: 'SIN ESPECIFICAR' };
  }
  const text = String(raw).trim();
  const m = text.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
  if (!m) {
    return { metros: 0, colinda: text || 'SIN ESPECIFICAR' };
  }
  const metros = parseNumeroFromText(m[1]);
  const colinda = m[2].trim() || 'SIN ESPECIFICAR';
  return { metros, colinda };
}

function enrichPredioAndLinderos(d) {
  // Superficie
  const supRaw = d.predioSuperficie || d.superficie || '';
  const supNum = parseNumeroFromText(supRaw);
  const supTxt = numeroALetras ? numeroALetras(supNum) : '';

  d.superficie = supNum;
  d.superficie_m2 = supNum;
  d.superficieTotal = supNum;
  d.superficie_total_m2 = supNum;
  d.superficieTexto = supTxt;
  d.superficie_letras = supTxt;

  // Linderos
  const dirs = [
    { key: 'Norte',   field: 'linderoNorte'   },
    { key: 'Sur',     field: 'linderoSur'     },
    { key: 'Oriente', field: 'linderoOriente' },
    { key: 'Poniente',field: 'linderoPoniente'}
  ];

  d.linderos = d.linderos || {};

  for (const dir of dirs) {
    const raw = d[dir.field];
    const { metros, colinda } = parseLindero(raw);

    // CamelCase
    d[dir.field + 'Metros']  = metros;
    d[dir.field + 'Colinda'] = colinda;

    // snake_case tipo lindero_norte_metros / colinda
    const baseSnake = 'lindero_' + dir.key.toLowerCase();
    d[baseSnake + '_metros']  = metros;
    d[baseSnake + '_colinda'] = colinda;

    // Dentro de d.linderos
    d.linderos[dir.key.toLowerCase()] = {
      metros,
      colinda
    };
  }

  return d;
}

// --- Generación de PDFs + meta.json (PAGARÉS) ---
async function generarLoteYMeta(d) {
  // Normalizar lugar de pago: si usuario puso "si"/"sí", usar lugarExpedicion
  if (d.lugarPago && typeof d.lugarPago === 'string') {
    const raw = d.lugarPago.trim().toLowerCase();
    if (raw === 'si' || raw === 'sí') {
      d.lugarPago = d.lugarExpedicion || d.lugarPago;
    }
  }

  const clienteSlug = slugify(d.deudor || 'CLIENTE');
  const ventaId = Date.now();
  const ventaFechaDir = ymd(d.fechaEmision);
  const baseDir = path.join(OUTPUT_ROOT, clienteSlug, ventaFechaDir);

  const dirLote = path.join(baseDir, 'lote');
  const dirInd  = path.join(baseDir, 'individuales');
  fs.mkdirSync(dirLote, { recursive: true });
  fs.mkdirSync(dirInd,  { recursive: true });

  const dirAudit = path.join(dirInd, 'audit');
  fs.mkdirSync(dirAudit, { recursive: true });

  const baseDocId = `LIA-${clienteSlug}-${ventaFechaDir}-${ventaId}`;

  const saldo_c = toCents(d.saldo);
  const anual_c = toCents(d.anualidadMonto || 0);
  const numAnn = d.numeroAnualidades || 0;
  const totalAnn_c = anual_c * numAnn;
  if (totalAnn_c > saldo_c) {
    throw new Error('Las anualidades exceden el saldo.');
  }

  const merger = await PDFDocument.create();
  const listaFinal = calcListaPagares(d);
  const totalPagares = listaFinal.length;
  const pagaresMeta = [];

  for (const p of listaFinal) {
    const folioNum = Number(p.folio);
    const folioStr = two(folioNum);

    const [vy, vm, vd] = String(p.fecha_vencimiento).split('-').map(Number);
    const venc = new Date(vy, (vm || 1) - 1, vd || 1);

    const payload = {
      deudor: {
        nombre: d.deudor,
        direccion: d.direccion,
        poblacion: d.poblacion
      },
      beneficiario: { nombre: d.beneficiario },
      pagare: {
        folio: folioNum,
        numeroDePagares: totalPagares,
        monto: Number(p.monto),
        lugarDePago: d.lugarPago,
        lugarExpedicion: d.lugarExpedicion,
        fechaEmision: d.fechaEmision.toISOString(),
        fechaVencimiento: venc.toISOString(),
        moratorios: d.moratorios
      }
    };

    const docIdPagare = `${baseDocId}-P${folioStr}`;

    const payloadNoQr = JSON.parse(JSON.stringify(payload));
    if (payloadNoQr?.pagare) delete payloadNoQr.pagare.qr_text;
    const preBuf  = await renderToBuffer('config/mapping_v1.json', payloadNoQr);
    const preHash = await sha256HexFromBuffer(preBuf);

    const shortHash  = preHash.slice(0, 10);
    const emisionISO = (payload?.pagare?.emision) || d.fechaEmision.toISOString();

    payload.pagare = payload.pagare || {};
    payload.pagare.qr_text = JSON.stringify({
      base: baseDocId,
      doc:  `${baseDocId}-P${folioStr}`,
      folio: Number(folioStr),
      monto: Number(p.monto),
      emision: emisionISO,
      h: shortHash,
      preHash,
      postHash: '(por calcular)'
    });

    payload.qr = payload.pagare.qr_text;

    const indPath = path.join(dirInd, `PAGARE_${folioStr}.pdf`);
    await renderToFile('config/mapping_v1.json', payload, indPath);

    const postHash = await sha256HexFromFile(indPath);

    const { auditPath, shortHash: qrShort } = writePagareAuditJson({
      outDir: dirAudit,
      baseDocId,
      docId: docIdPagare,
      clienteSlug,
      ventaId,
      folio: folioStr,
      deudor: d.deudor,
      monto: Number(p.monto).toFixed(2),
      venceISO: venc.toISOString(),
      venceDMY: fmtDMY(venc),
      preHash,
      postHash,
      pdfPath: indPath
    });

    const bytes = fs.readFileSync(indPath);
    const doc = await PDFDocument.load(bytes);
    const [page] = await merger.copyPages(doc, [0]);
    merger.addPage(page);

    pagaresMeta.push({
      folio: folioStr,
      monto: Number(Number(p.monto).toFixed(2)),
      vence: fmtDMY(venc),
      audit_json: auditPath,
      pre_hash: preHash,
      post_hash: postHash,
      qr_short: qrShort,
      doc_id: docIdPagare,
      base_id: baseDocId
    });
  }

  const lotePathRel = path.join(dirLote, `lote_${ventaId}.pdf`);
  fs.writeFileSync(lotePathRel, await merger.save());
  // Convert to absolute path so external callers can reliably locate the file
  const lotePath = path.resolve(lotePathRel);

  const meta = {
    venta_id: String(ventaId),
    cliente_slug: clienteSlug,
    fecha_venta: fmtDMY(d.fechaEmision),
    contacto: { telefono: d.telefono },
    beneficiario: d.beneficiario,
    deudor: {
      nombre: d.deudor,
      direccion: d.direccion,
      poblacion: d.poblacion
    },
    economico: {
      total: Number(d.total.toFixed(2)),
      enganche: Number(d.enganche.toFixed(2)),
      saldo: Number(d.saldo.toFixed(2)),
      mensualidad: Number(d.mensual.toFixed(2)),
      numero_pagares: listaFinal.length,
      moratorios_pct: d.moratorios
    },
    documento: {
      lugar_expedicion: d.lugarExpedicion,
      lugar_pago: d.lugarPago,
      fecha_emision: fmtDMY(d.fechaEmision),
      regla_1530: d.reglaPref
    },
    predio: {
      nombre: d.predioNombre,
      ubicacion: d.predioUbicacion,
      municipio: d.predioMunicipio,
      manzana_lote: d.predioManzanaLote,
      superficie_m2: d.superficie_m2 || parseNumeroFromText(d.predioSuperficie),
      norte: {
        metros: d.linderoNorteMetros,
        colinda: d.linderoNorteColinda
      },
      sur: {
        metros: d.linderoSurMetros,
        colinda: d.linderoSurColinda
      },
      oriente: {
        metros: d.linderoOrienteMetros,
        colinda: d.linderoOrienteColinda
      },
      poniente: {
        metros: d.linderoPonienteMetros,
        colinda: d.linderoPonienteColinda
      },
      testigos: d.testigos
    },
    archivos: {
      base_dir: baseDir,
      lote_pdf: lotePath,
      individuales_dir: dirInd
    },
    pagares: pagaresMeta
  };

  fs.writeFileSync(path.join(baseDir, 'meta.json'), JSON.stringify(meta, null, 2));

  return { baseDir, lotePath, meta, clienteSlug, ventaFechaDir };
}

// --- Generación de CONTRATO ---
async function generarContrato(d) {
  // Normalizar lugar de pago igual que en los pagarés
  if (d.lugarPago && typeof d.lugarPago === 'string') {
    const raw = d.lugarPago.trim().toLowerCase();
    if (raw === 'si' || raw === 'sí') {
      d.lugarPago = d.lugarExpedicion || d.lugarPago;
    }
  }

  // Reconstruir lista de pagarés (si no viene ya)
  let lista = d.listaPagares;
  if (!lista || !Array.isArray(lista) || lista.length === 0) {
    lista = calcListaPagares({
      total: d.total,
      enganche: d.enganche,
      saldo: d.saldo,
      mensual: d.mensual,
      anualidadMonto: d.anualidadMonto || 0,
      numeroAnualidades: d.numeroAnualidades || 0,
      anualidadMes: d.anualidadMes || 12,
      fechaEmision: d.fechaEmision,
      reglaPref: d.reglaPref || 'mismo'
    }) || [];
  }
  d.listaPagares = lista;

  // Contar mensualidades y anualidades
  const mensualidades = lista.filter(p => p.tipo === 'mensualidad').length;
  const anualidades  = lista.filter(p => p.tipo === 'anualidad').length;

  d.numeroMensualidades = mensualidades;
  d.numeroAnualidades   = anualidades;

  // Detectar mensualidad diferente (último pagaré ajustado)
  let montoMensualidadDiferente = '';
  let posMensualidadDiferente = '';
  if (mensualidades > 0) {
    const mensuales = lista.filter(p => p.tipo === 'mensualidad');
    const baseMonto = mensuales[0]?.monto || 0;
    const distintos = mensuales.filter(p => p.monto !== baseMonto);
    if (distintos.length > 0) {
      const especial = distintos[0];
      montoMensualidadDiferente = especial.monto;
      posMensualidadDiferente   = especial.folio || '';
    }
  }
  d.montoMensualidadDiferente = montoMensualidadDiferente;
  d.posMensualidadDiferente   = posMensualidadDiferente;

  // Por compatibilidad, también expone 'pagares'
  d.pagares = lista;

  // Enriquecer datos de predio, superficie y linderos
  enrichPredioAndLinderos(d);

  // Construir mapeo seguro para contrato
  const contratoOut = buildMapping(d, {
    numeroALetras,
    fechaEmision: d.fechaEmision
  });

  // Plantillas posibles
  const candidateTemplates = [
    path.join(PROJECT_ROOT, 'templates', 'v1', 'contract.docx'),
    path.join(PROJECT_ROOT, 'templates', 'v1', 'contrato base.docx'),
    path.join(SRC_ROOT,    'modules', 'contracts', 'contrato base.docx'),
    path.join(PROJECT_ROOT, 'modules', 'contracts', 'contrato base.docx'),
    path.join(PROJECT_ROOT, 'templates', 'v1', 'contractTemplate.docx')
  ];

  const templatePath = candidateTemplates.find(p => fs.existsSync(p));
  if (!templatePath) {
    throw new Error(
      'No encontré la plantilla DOCX para contrato. Probé:\n' +
      candidateTemplates.map(p => '• ' + p).join('\n')
    );
  }

  const outDir = path.join(PROJECT_ROOT, 'data', 'output', 'contracts');
  fs.mkdirSync(outDir, { recursive: true });

  const { outPdf } = await generateContractDocxPdf({
    data: contratoOut,
    templatePath,
    outDir
  });

  return {
    // Convert returned PDF path to absolute for reliable access
    pdfPath: path.resolve(outPdf),
    outDir,
    templatePath
  };
}

module.exports = {
  generarLoteYMeta,
  generarContrato,
  calcListaPagares
};
