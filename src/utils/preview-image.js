// Preview image utilities using @napi-rs/canvas
// Exports:
//  - mmToPx(mm, dpi)
//  - composePreviewPNG(options) -> Buffer (PNG)
//    options: {
//      bgPngPath: string,
//      pageSizeMm: { w, h } | { width_mm, height_mm },
//      dpi?: number,
//      data: any,
//      textMap?: { page?, texts?, qr?, pageSizeMm?, dpi?, cropMm?, globalOffsetMm?, fields? },
//      cropMm?: { x, y, w, h },
//      globalOffsetMm?: { x, y },
//      qrPngPath?: string,          // optional if you already have a QR image on disk
//      qrBuffer?: Buffer,           // optional in-memory QR image buffer
//      qrPosMm?: { x_mm, y_mm, size_mm }
//    }
//  - composeTextMapFromJson(jsonPath) -> { page, texts, qr?, pageSizeMm?, dpi?, cropMm?, globalOffsetMm?, fields? }

const fs = require('fs');
const path = require('path');

function mmToPx(mm, dpi) {
  const px = (dpi / 25.4) * Number(mm || 0);
  return px;
}

function resolve(obj, dotted) {
  return String(dotted || '')
    .split('.')
    .filter(Boolean)
    .reduce((o, k) => (o ? o[k] : undefined), obj);
}

function toUpper(v) { return v == null ? '' : String(v).toUpperCase(); }
function two(n) { return String(n).padStart(2, '0'); }

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
function applyType(val, type) {
  if (!type) return toUpper(val);
  switch (type) {
    case 'currency': return formatCurrencyNumber(val);
    case 'currencyWords': return formatCurrencyWords(val);
    case 'dateDMY': return formatDateDMY(val);
    case 'day': { const d = new Date(val); return two(d.getDate()); }
    case 'monthName': { const d = new Date(val); return d.toLocaleString('es-MX', { month: 'long' }).toUpperCase(); }
    case 'year': { const d = new Date(val); return String(d.getFullYear()); }
    case 'percent': return `${Number(val || 0)}%`;
    default: return toUpper(val);
  }
}

function composeTextMapFromJson(jsonPath) {
  const abs = path.isAbsolute(jsonPath) ? jsonPath : path.join(process.cwd(), jsonPath);
  if (!fs.existsSync(abs)) throw new Error(`preview_textmap.json no encontrado: ${abs}`);
  const cfg = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const texts = Array.isArray(cfg.texts) ? cfg.texts : [];
  return {
    page: cfg.page || null,
    texts,
    qr: cfg.qr || null,
    pageSizeMm: cfg.pageSizeMm || null,
    dpi: cfg.dpi || null,
    cropMm: cfg.cropMm || null,
    globalOffsetMm: cfg.globalOffsetMm || null,
    fields: cfg.fields || null,
  };
}

// --- Debug helper ---
const DEBUG = process.env.PREVIEW_DEBUG ? String(process.env.PREVIEW_DEBUG) !== '0' : true;
function dlog(...args) { if (DEBUG) console.log('[preview]', ...args); }

async function composePreviewPNG({ bgPngPath, pageSizeMm, dpi = 300, data, qrPngPath, qrBuffer, qrPosMm, textMap, cropMm, globalOffsetMm }) {
  let Canvas, loadImage;
  try {
    ({ Canvas, loadImage } = require('@napi-rs/canvas'));
  } catch (e) {
    throw new Error('Falta dependencia @napi-rs/canvas. Instale para usar composePreviewPNG.');
  }

  const bgAbs = path.isAbsolute(bgPngPath) ? bgPngPath : path.join(process.cwd(), bgPngPath);
  if (!fs.existsSync(bgAbs)) throw new Error(`Fondo PNG no encontrado: ${bgAbs}`);

  // Merge overrides from textMap if present
  const tm = textMap || {};
  const effDpi = Number(tm.dpi || dpi || 300);
  const effPage = normalizePageSize(pageSizeMm || tm.pageSizeMm || tm.page);
  const effCrop = normalizeCrop(cropMm || tm.cropMm || null);
  const effGlobal = normalizeXY(globalOffsetMm || tm.globalOffsetMm || null);

  const pxPerMM = mmToPx(1, effDpi);
  const widthPx = Math.round(mmToPx(effPage.width_mm, effDpi));
  const heightPx = Math.round(mmToPx(effPage.height_mm, effDpi));

  const canvas = new Canvas(widthPx, heightPx);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.textBaseline = 'top';

  // Draw background scaled to canvas
  const bgImg = await loadImage(bgAbs);
  ctx.drawImage(bgImg, 0, 0, widthPx, heightPx);

  dlog(`Canvas ${widthPx}x${heightPx} @${effDpi}dpi; px/mm=${pxPerMM.toFixed(2)}`);

  // Build items from either texts[] or fields{}
  const items = buildTextItems(tm, data);
  dlog(`Text items: ${items.length}`);
  for (const t of items) {
    const off = normalizeXY(t.offsetMm || t.offset || t.offset_mm);
    const gx = effGlobal.x_mm || 0;
    const gy = effGlobal.y_mm || 0;
    const norm = normalizeTextSpec(t);
    const x = Math.round(((norm.x_mm || 0) + (off.x_mm || 0) + gx) * pxPerMM);
    const y = Math.round(((norm.y_mm || 0) + (off.y_mm || 0) + gy) * pxPerMM);
    const fontPx = Number(norm.fontPx || 14);
    const weight = norm.fontWeight || 'normal';
    const family = norm.fontFamily || 'Helvetica, Arial, sans-serif';
    ctx.font = `${weight} ${fontPx}px ${family}`;
    ctx.fillStyle = norm.color || '#000';
    ctx.textAlign = (norm.align === 'center' ? 'center' : (norm.align === 'right' ? 'right' : 'left'));

    let val = norm.value;
    // Max width truncation with ellipsis
    let drawVal = val;
    const maxWmm = norm.maxWidth_mm != null ? Number(norm.maxWidth_mm) : null;
    if (maxWmm != null && isFinite(maxWmm) && maxWmm > 0) {
      const maxPx = maxWmm * pxPerMM;
      drawVal = truncateToFit(ctx, val, maxPx);
    }

    ctx.fillText(drawVal, x, y);
  }

  // Draw QR if provided
  const qrPath = qrPngPath || null;
  const qrCfg = normalizeQrPos(qrPosMm || tm.qr || null);
  if ((qrPath || qrBuffer) && qrCfg && typeof qrCfg.x_mm === 'number' && typeof qrCfg.y_mm === 'number' && typeof qrCfg.size_mm === 'number') {
    try {
      const size = Math.round(qrCfg.size_mm * pxPerMM);
      const left = Math.round(((qrCfg.x_mm || 0) + (effGlobal.x_mm || 0)) * pxPerMM);
      const top = Math.round(((qrCfg.y_mm || 0) + (effGlobal.y_mm || 0)) * pxPerMM);
      let qrImg = null;
      if (qrBuffer) {
        qrImg = await loadImage(qrBuffer);
      } else if (qrPath) {
        const qrAbs = path.isAbsolute(qrPath) ? qrPath : path.join(process.cwd(), qrPath);
        if (fs.existsSync(qrAbs)) qrImg = await loadImage(qrAbs);
      }
      if (qrImg) {
        ctx.drawImage(qrImg, left, top, size, size);
        dlog(`QR drawn at (${left},${top}) size ${size}px`);
      } else {
        dlog('QR image not available (no buffer/path).');
      }
    } catch (err) {
      dlog('QR draw failed:', err.message || String(err));
    }
  }
  else {
    dlog('QR skipped: missing cfg or image.');
  }

  // Crop if requested
  if (effCrop && isFinite(effCrop.w) && isFinite(effCrop.h)) {
    const sx = Math.max(0, Math.round((effCrop.x || 0) * pxPerMM));
    const sy = Math.max(0, Math.round((effCrop.y || 0) * pxPerMM));
    const sw = Math.min(widthPx - sx, Math.round(effCrop.w * pxPerMM));
    const sh = Math.min(heightPx - sy, Math.round(effCrop.h * pxPerMM));
    const outCanvas = new Canvas(sw, sh);
    const outCtx = outCanvas.getContext('2d');
    outCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return outCanvas.toBuffer('image/png');
  }

  return canvas.toBuffer('image/png');
}

function drawTextWithLetterSpacing(ctx, text, x, y, letterSpacing, align) {
  // Simple manual letter spacing rendering
  const chars = String(text).split('');
  let curX = x;
  if (align === 'center') {
    const width = ctx.measureText(text).width + letterSpacing * (chars.length - 1);
    curX = x - width / 2;
  } else if (align === 'right') {
    const width = ctx.measureText(text).width + letterSpacing * (chars.length - 1);
    curX = x - width;
  }
  for (const ch of chars) {
    ctx.fillText(ch, curX, y);
    curX += ctx.measureText(ch).width + letterSpacing;
  }
}

function normalizePageSize(p) {
  if (!p) return { width_mm: 210, height_mm: 297 };
  if (typeof p.width_mm === 'number' && typeof p.height_mm === 'number') return p;
  if (typeof p.w === 'number' && typeof p.h === 'number') return { width_mm: p.w, height_mm: p.h };
  if (typeof p.width === 'number' && typeof p.height === 'number') return { width_mm: p.width, height_mm: p.height };
  return { width_mm: 210, height_mm: 297 };
}

function normalizeXY(o) {
  if (!o) return { x_mm: 0, y_mm: 0 };
  if (typeof o.x_mm === 'number' || typeof o.y_mm === 'number') return { x_mm: o.x_mm || 0, y_mm: o.y_mm || 0 };
  if (typeof o.x === 'number' || typeof o.y === 'number') return { x_mm: o.x || 0, y_mm: o.y || 0 };
  return { x_mm: 0, y_mm: 0 };
}

function normalizeCrop(o) {
  if (!o) return null;
  const n = { ...o };
  if (n.width_mm != null && n.height_mm != null) { n.w = n.width_mm; n.h = n.height_mm; }
  if (n.left_mm != null) n.x = n.left_mm;
  if (n.top_mm != null) n.y = n.top_mm;
  return { x: Number(n.x || 0), y: Number(n.y || 0), w: Number(n.w || 0), h: Number(n.h || 0) };
}

function normalizeQrPos(q) {
  if (!q) return null;
  if (typeof q.x_mm === 'number' && typeof q.y_mm === 'number' && typeof q.size_mm === 'number') return q;
  const x = q.x_mm != null ? q.x_mm : (q.x != null ? q.x : (q.left_mm != null ? q.left_mm : null));
  const y = q.y_mm != null ? q.y_mm : (q.y != null ? q.y : (q.top_mm != null ? q.top_mm : null));
  const size = q.size_mm != null ? q.size_mm : (q.size != null ? q.size : (q.width_mm != null ? q.width_mm : null));
  if ([x, y, size].every(v => typeof v === 'number')) return { x_mm: x, y_mm: y, size_mm: size };
  return null;
}

function buildTextItems(textMap, data) {
  // Legacy array
  if (Array.isArray(textMap)) {
    return textMap.map(t => makeTextItem(normalizeTextSpec(t), data));
  }
  const items = [];
  if (Array.isArray(textMap?.texts)) {
    for (const t of textMap.texts) {
      const spec = normalizeTextSpec(t);
      const it = makeTextItem(spec, data);
      if (!it.value) dlog('Empty value for key', spec.from || '(unknown from)');
      if (spec.x_mm == null || spec.y_mm == null) dlog('Missing coordinates for key', spec.from || '(unknown from)');
      items.push(it);
    }
  }
  if (textMap && typeof textMap.fields === 'object' && textMap.fields) {
    for (const [key, cfg] of Object.entries(textMap.fields)) {
      const t = { from: cfg.from || key, ...cfg };
      const spec = normalizeTextSpec(t);
      const it = makeTextItem(spec, data);
      if (!it.value) dlog('Empty value for field', key, 'from', spec.from);
      if (spec.x_mm == null || spec.y_mm == null) dlog('Missing coordinates for field', key);
      items.push(it);
    }
  }
  return items;
}

function makeTextItem(t, data) {
  const raw = resolve(data, t.from || '') ?? '';
  let val = String(raw);
  if (t.pad) val = String(val).padStart(Number(t.pad), '0');
  val = applyType(val, t.type);
  return { ...t, value: val };
}

function truncateToFit(ctx, text, maxWidthPx) {
  const ell = '…';
  if (ctx.measureText(text).width <= maxWidthPx) return text;
  let left = 0, right = text.length;
  // Binary search longest prefix that fits when adding ellipsis
  while (left < right) {
    const mid = Math.ceil((left + right) / 2);
    const candidate = text.slice(0, mid) + ell;
    const w = ctx.measureText(candidate).width;
    if (w <= maxWidthPx) left = mid; else right = mid - 1;
  }
  const finalText = text.slice(0, left) + ell;
  // Ensure even truncated fits
  let t = finalText;
  while (t.length > 1 && ctx.measureText(t).width > maxWidthPx) {
    t = t.slice(0, -2) + ell; // remove one char before ellipsis
  }
  return t;
}

module.exports = { mmToPx, composePreviewPNG, composeTextMapFromJson };

// --- Normalization of text spec keys ---
function normalizeTextSpec(t) {
  const n = { ...(t || {}) };
  // Coordinates in mm
  if (n.x_mm == null && n.x != null) n.x_mm = Number(n.x);
  if (n.y_mm == null && n.y != null) n.y_mm = Number(n.y);
  if (n.left_mm != null && n.x_mm == null) n.x_mm = Number(n.left_mm);
  if (n.top_mm != null && n.y_mm == null) n.y_mm = Number(n.top_mm);

  // Offset
  if (!n.offsetMm && n.offset_mm) n.offsetMm = n.offset_mm;
  if (!n.offsetMm && (typeof n.offsetX === 'number' || typeof n.offsetY === 'number')) {
    n.offsetMm = { x_mm: Number(n.offsetX || 0), y_mm: Number(n.offsetY || 0) };
  }

  // Font
  if (n.fontPx == null && n.font_px != null) n.fontPx = Number(n.font_px);
  if (n.fontPx == null && n.fontSize != null) n.fontPx = Number(n.fontSize);
  if (n.fontWeight == null && n.weight != null) n.fontWeight = n.weight;
  if (n.fontFamily == null && (n.family || n.font)) n.fontFamily = n.family || n.font;

  // Color
  if (n.color == null && n.fill != null) n.color = n.fill;

  // Alignment
  if (n.align) n.align = String(n.align).toLowerCase();

  // Max width in mm
  if (n.maxWidth_mm == null && n.maxWidth != null) n.maxWidth_mm = Number(n.maxWidth);

  // Source key alias
  if (n.from == null && n.field != null) n.from = n.field;
  if (n.from == null && n.key != null) n.from = n.key;

  return n;
}
