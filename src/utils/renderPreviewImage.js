const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const QRCode = require('qrcode');

// Helpers
const two = (n) => String(n).padStart(2, '0');
const resolve = (obj, dotted) => dotted.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
const toUpper = (v) => (v == null ? '' : String(v).toUpperCase());

// Formatting similar to src/pdf.js (duplicated locally to avoid tight coupling)
function formatCurrencyNumber(n) {
  const num = Number(n || 0);
  return new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}
function numeroALetrasSafe(entero) {
  try {
    const nal = require('numero-a-letras');
    const fn = (nal && (nal.NumerosALetras || nal.NumeroALetras || (typeof nal === 'function' ? nal : null))) || null;
    return fn ? fn(entero, {
      plural: 'pesos', singular: 'peso',
      centPlural: 'centavos', centSingular: 'centavo'
    }) : String(entero);
  } catch { return String(entero); }
}
function formatCurrencyWords(n) {
  const entero = Math.floor(Number(n || 0));
  return numeroALetrasSafe(entero).toUpperCase();
}
function formatDateDMY(iso) {
  const d = new Date(iso);
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function formatPercent(n) { return `${Number(n || 0)}%`; }

// Economic helpers (duplicated from bot.js logic)
function toCents(n) { return Math.round(Number(n) * 100); }
function fromCents(c) { return (c / 100); }
function primera15o30(fechaEmision, preferencia) {
  const d = new Date(fechaEmision);
  const diaRef = d.getDate() <= 15 ? 15 : 30;
  if (preferencia === 'siguiente') return new Date(d.getFullYear(), d.getMonth() + 1, diaRef);
  return new Date(d.getFullYear(), d.getMonth(), diaRef);
}
function addMonthsKeepDay(d, months) { const n = new Date(d); n.setMonth(n.getMonth() + months); return n; }
function planPagosPorCents(saldo_c, mensual_c) {
  const N = Math.ceil(saldo_c / mensual_c);
  const montos = Array(N).fill(mensual_c);
  const sobrepago = N * mensual_c - saldo_c;
  let rest = sobrepago;
  for (let i = N - 1; i >= 0 && rest > 0; i--) {
    const can = Math.min(rest, montos[i] - 1);
    montos[i] -= can; rest -= can;
  }
  return montos;
}

function computeFirstPagarePayload(data) {
  const saldo_c = toCents(Number((data.total - data.enganche).toFixed(2)));
  const mens_c = toCents(data.mensual);
  const montos = planPagosPorCents(saldo_c, mens_c);
  const venc = primera15o30(data.fechaEmision, data.reglaPref);
  const folioNum = 1;
  return {
    deudor: { nombre: data.deudor, direccion: data.direccion, poblacion: data.poblacion },
    beneficiario: { nombre: data.beneficiario },
    pagare: {
      folio: folioNum,
      numeroDePagares: montos.length,
      monto: fromCents(montos[0]),
      lugarDePago: data.lugarPago,
      lugarExpedicion: data.lugarExpedicion,
      fechaEmision: data.fechaEmision.toISOString(),
      fechaVencimiento: venc.toISOString(),
      moratorios: data.moratorios
    }
  };
}

function applyType(val, type) {
  if (!type) return toUpper(val);
  switch (type) {
    case 'currency': return formatCurrencyNumber(val);
    case 'currencyWords': return formatCurrencyWords(val);
    case 'dateDMY': return formatDateDMY(val);
    case 'day': { const d = new Date(val); return two(d.getDate()); }
    case 'monthName': { const d = new Date(val); return d.toLocaleString('es-MX', { month: 'long' }).toUpperCase(); }
    case 'year': { const d = new Date(val); return String(d.getFullYear()); }
    case 'percent': return formatPercent(val);
    default: return toUpper(val);
  }
}

async function getPageSizeMMFromPdf(mappingPathAbs) {
  try {
    const mapping = JSON.parse(fs.readFileSync(mappingPathAbs, 'utf8'));
    const base = mapping?.pdf?.base || 'templates/base.pdf';
    const baseAbs = path.isAbsolute(base) ? base : path.join(process.cwd(), base);
    const bytes = fs.readFileSync(baseAbs);
    const doc = await PDFDocument.load(bytes);
    const p = doc.getPages()[0];
    const { width, height } = p.getSize(); // points
    const mmPerPt = 25.4 / 72;
    return { width_mm: width * mmPerPt, height_mm: height * mmPerPt };
  } catch {
    // Default to A4
    return { width_mm: 210, height_mm: 297 };
  }
}

function buildSvgOverlay(width_px, height_px, pxPerMM, overlayCfg, payload) {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width_px}" height="${height_px}" viewBox="0 0 ${width_px} ${height_px}">`,
    '<style>.t{font-family: Helvetica, Arial, sans-serif; fill:#000}</style>'
  ];

  const texts = Array.isArray(overlayCfg?.texts) ? overlayCfg.texts : [];
  for (const t of texts) {
    const raw = resolve(payload, t.from || '') ?? '';
    let val = String(raw);
    if (t.pad) val = String(val).padStart(Number(t.pad), '0');
    if (t.type) val = applyType(val, t.type);
    else val = toUpper(val);

    const x = Math.round((t.x_mm || 0) * pxPerMM.x);
    const y = Math.round((t.y_mm || 0) * pxPerMM.y);
    const fontSize = Number(t.font_px || 14);
    const weight = t.weight || 'normal';
    const anchor = (t.align === 'center' ? 'middle' : (t.align === 'right' ? 'end' : 'start'));
    const color = t.color || '#000';
    const letterSpacing = t.letterSpacing != null ? ` letter-spacing: ${t.letterSpacing}px;` : '';

    parts.push(`<text class="t" x="${x}" y="${y}" font-size="${fontSize}" font-weight="${weight}" text-anchor="${anchor}" style="fill:${color};${letterSpacing}">${escapeXml(val)}</text>`);
  }

  parts.push('</svg>');
  return Buffer.from(parts.join(''));
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function renderPreviewImage(mappingPath, data, bgPath, overlayPath) {
  const mappingAbs = path.isAbsolute(mappingPath) ? mappingPath : path.join(process.cwd(), mappingPath);
  const bgAbs = path.isAbsolute(bgPath) ? bgPath : path.join(process.cwd(), bgPath);
  if (!fs.existsSync(bgAbs)) throw new Error(`Fondo no encontrado: ${bgAbs}`);

  // Prepare payload (first pagaré)
  const payload = computeFirstPagarePayload(data);

  // Load overlay config (overlayPath or fallback to config/fields_map.json -> config/preview_textmap.json)
  let overlayCfg = null;
  let rawCfg = null;
  try {
    if (overlayPath) {
      const overlayAbs = path.isAbsolute(overlayPath) ? overlayPath : path.join(process.cwd(), overlayPath);
      if (fs.existsSync(overlayAbs)) rawCfg = JSON.parse(fs.readFileSync(overlayAbs, 'utf8'));
    }
    if (!rawCfg) {
      const sharedPath = path.join(process.cwd(), 'config', 'fields_map.json');
      if (fs.existsSync(sharedPath)) rawCfg = JSON.parse(fs.readFileSync(sharedPath, 'utf8'));
    }
    if (!rawCfg) {
      const fallbackPath = path.join(process.cwd(), 'config', 'preview_textmap.json');
      if (fs.existsSync(fallbackPath)) rawCfg = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
    }
  } catch (_) {}
  overlayCfg = rawCfg || overlayCfg || {};

  // Back-compat: if we only have fields, derive a texts[] for SVG fallback
  if ((!overlayCfg.texts || overlayCfg.texts.length === 0) && overlayCfg.fields && typeof overlayCfg.fields === 'object') {
    overlayCfg.texts = Object.entries(overlayCfg.fields).map(([key, t]) => ({
      from: t.from || key,
      x_mm: t.x_mm,
      y_mm: t.y_mm,
      align: t.align,
      font_px: t.fontPx || t.font_px,
      color: t.color,
      weight: t.fontWeight || t.weight,
      type: t.type,
      pad: t.pad,
      letterSpacing: t.letterSpacing
    }));
  }
  // Back-compat: page alias
  if (!overlayCfg.page && overlayCfg.pageSizeMm) {
    const p = overlayCfg.pageSizeMm;
    overlayCfg.page = (typeof p.w === 'number' && typeof p.h === 'number')
      ? { width_mm: p.w, height_mm: p.h }
      : p;
  }

  // Try the canvas-based renderer (precise positioning, cropping, max width)
  try {
    const { composePreviewPNG } = require('./preview-image');

    // Resolve page size: overlay.pageSizeMm | overlay.page | mapping.pdf.base | A4
    let pageSizeMm = overlayCfg?.pageSizeMm || overlayCfg?.page || null;
    if (!pageSizeMm) pageSizeMm = await getPageSizeMMFromPdf(mappingAbs);

    // Resolve DPI, crop, global offset
    const dpi = overlayCfg?.dpi || 300;
    const cropMm = overlayCfg?.cropMm || null;
    const globalOffsetMm = overlayCfg?.globalOffsetMm || null;

    // Prepare text map compatible with composePreviewPNG
    const textMap = overlayCfg;

    // QR config
    const mapping = JSON.parse(fs.readFileSync(mappingAbs, 'utf8'));
    const qrCfg = overlayCfg?.qr || mapping?.pdf?.qr;
    let qrBuffer = null;
    if (qrCfg && typeof qrCfg.x_mm === 'number' && typeof qrCfg.y_mm === 'number' && typeof qrCfg.size_mm === 'number') {
      const qrText = JSON.stringify({
        folio: payload.pagare.folio,
        monto: payload.pagare.monto,
        emision: formatDateDMY(payload.pagare.fechaEmision)
      });
      // High quality QR; sizing is handled in canvas via size_mm
      qrBuffer = await QRCode.toBuffer(qrText, { margin: 0, scale: 8 });
    }

    const png = await composePreviewPNG({
      bgPngPath: bgAbs,
      pageSizeMm,
      dpi,
      data: payload,
      textMap,
      cropMm,
      globalOffsetMm,
      qrBuffer,
      qrPosMm: overlayCfg?.qr || null,
    });
    return png;
  } catch (e) {
    // Fallback: existing sharp + SVG overlay path (no cropping/maxWidth ellipsis)
    // Page size in mm (overlay > mapping.pdf.base > A4)
    const pageMM = overlayCfg?.page?.width_mm && overlayCfg?.page?.height_mm
      ? { width_mm: overlayCfg.page.width_mm, height_mm: overlayCfg.page.height_mm }
      : await getPageSizeMMFromPdf(mappingAbs);

    // Background dimensions
    const bg = sharp(bgAbs);
    const meta = await bg.metadata();
    const width_px = meta.width || 2480; // fallback A4@300dpi
    const height_px = meta.height || 3508;
    const pxPerMM = { x: width_px / pageMM.width_mm, y: height_px / pageMM.height_mm };

    const composites = [];
    const svgBuf = buildSvgOverlay(width_px, height_px, pxPerMM, overlayCfg, payload);
    composites.push({ input: svgBuf, top: 0, left: 0 });

    const mapping = JSON.parse(fs.readFileSync(mappingAbs, 'utf8'));
    const qrCfg = overlayCfg?.qr || mapping?.pdf?.qr;
    if (qrCfg && typeof qrCfg.x_mm === 'number' && typeof qrCfg.y_mm === 'number' && typeof qrCfg.size_mm === 'number') {
      const qrText = JSON.stringify({
        folio: payload.pagare.folio,
        monto: payload.pagare.monto,
        emision: formatDateDMY(payload.pagare.fechaEmision)
      });
      const size_px = Math.round(qrCfg.size_mm * pxPerMM.x);
      const qrRaw = await QRCode.toBuffer(qrText, { margin: 0, scale: 6 });
      const qrPng = await sharp(qrRaw).resize({ width: size_px, height: size_px, fit: 'fill' }).png().toBuffer();
      const left = Math.round(qrCfg.x_mm * pxPerMM.x);
      const top = Math.round(qrCfg.y_mm * pxPerMM.y);
      composites.push({ input: qrPng, left, top });
    }

    const out = await sharp(bgAbs).composite(composites).png().toBuffer();
    return out;
  }
}

module.exports = { renderPreviewImage };
