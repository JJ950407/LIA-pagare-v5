// PDF -> PNG rasterizer using pdfjs-dist + @napi-rs/canvas
// Public API only accepts Uint8Array for PDF bytes.
// Exports:
//  - rasterizeFirstPage(pdfUint8, { dpi=216 }) -> Promise<Buffer>
//  - rasterizePage(pdfUint8, pageNumber, { dpi=216 }) -> Promise<Buffer>
//  - rasterizeAllPages(pdfUint8, { dpi=216 }) -> Promise<Buffer[]>
//  - toUint8(input) -> Uint8Array   (helper for callers)
//  - viewportScaleForDpi(dpi) -> number

'use strict';

let pdfjsLib = null;
let createCanvasFn = null;

function ensurePdfJs() {
  if (pdfjsLib) return pdfjsLib;
  try {
    // Legacy build works best in Node without worker
    pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    return pdfjsLib;
  } catch (e) {
    const err = new Error("pdfjs-raster: falta dependencia 'pdfjs-dist'. Instale con: npm i pdfjs-dist");
    err.code = 'NO_PDFJS';
    throw err;
  }
}

function ensureCanvas() {
  if (createCanvasFn) return createCanvasFn;
  try {
    const { createCanvas } = require('@napi-rs/canvas');
    createCanvasFn = createCanvas;
    return createCanvasFn;
  } catch (e) {
    const err = new Error("pdfjs-raster: falta '@napi-rs/canvas'. Instale con: npm i @napi-rs/canvas");
    err.code = 'NO_CANVAS';
    throw err;
  }
}

// Helper: normalize any typed input to Uint8Array for pdfjs
function toUint8(input) {
  if (!input) return new Uint8Array();
  if (input instanceof Uint8Array) return input;
  if (Buffer.isBuffer(input)) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer);
  if (input.buffer && input.buffer instanceof ArrayBuffer) return new Uint8Array(input.buffer);
  // Last resort attempt (may throw if not iterable)
  return new Uint8Array(input);
}

function viewportScaleForDpi(dpi) {
  const d = Number(dpi || 72);
  return d / 72; // 1pt = 1/72 inch
}

async function openPdf(dataUint8) {
  const pdfjs = ensurePdfJs();
  const loadingTask = pdfjs.getDocument({ data: dataUint8, disableWorker: true });
  const pdf = await loadingTask.promise;
  return pdf;
}

async function renderPageToPng(pdf, pageNumber, dpi) {
  const createCanvas = ensureCanvas();
  const page = await pdf.getPage(pageNumber);
  const scale = viewportScaleForDpi(dpi);
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toBuffer('image/png');
}

async function rasterizeFirstPage(pdfUint8, { dpi = 216 } = {}) {
  const data = toUint8(pdfUint8);
  const pdf = await openPdf(data);
  try {
    return await renderPageToPng(pdf, 1, dpi);
  } finally {
    try { await pdf.destroy(); } catch {}
  }
}

async function rasterizePage(pdfUint8, pageNumber = 1, { dpi = 216 } = {}) {
  const data = toUint8(pdfUint8);
  const pdf = await openPdf(data);
  try {
    const pageCount = pdf.numPages || (await pdf.getMetadata()?.info?.Pages) || 1;
    const n = Math.min(Math.max(1, Math.floor(pageNumber)), pageCount);
    return await renderPageToPng(pdf, n, dpi);
  } finally {
    try { await pdf.destroy(); } catch {}
  }
}

async function rasterizeAllPages(pdfUint8, { dpi = 216 } = {}) {
  const data = toUint8(pdfUint8);
  const pdf = await openPdf(data);
  try {
    const results = [];
    const total = pdf.numPages || 1;
    for (let i = 1; i <= total; i++) {
      results.push(await renderPageToPng(pdf, i, dpi));
    }
    return results;
  } finally {
    try { await pdf.destroy(); } catch {}
  }
}

module.exports = {
  toUint8,
  viewportScaleForDpi,
  rasterizeFirstPage,
  rasterizePage,
  rasterizeAllPages,
};

