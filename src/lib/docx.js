// src/lib/docx.js
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function renderDocxBuffer(templatePath, data) {
  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  doc.render(data);
  return doc.getZip().generate({ type: 'nodebuffer' });
}

function renderDocxFile({ templatePath, data, outPath }) {
  const buf = renderDocxBuffer(templatePath, data);
  if (outPath) {
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, buf);
  }
  return { outPath, buffer: buf };
}

// === Compat layer para doublepass ===
async function renderDocxWithMapping({ templatePath, mapping, outPath }) {
  const { buffer } = renderDocxFile({ templatePath, data: mapping, outPath });
  return buffer; // por si lo requieren
}

module.exports = {
  ensureDir,
  renderDocxBuffer,
  renderDocxFile,
  renderDocxWithMapping,
};
