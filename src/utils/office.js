// src/utils/office.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function findSoffice() {
  const candidates = [
    'soffice',
    '/usr/bin/soffice',
    '/usr/local/bin/soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice', // macOS
  ];
  for (const c of candidates) {
    try { 
      if (c === 'soffice' || fs.existsSync(c)) return c; 
    } catch {}
  }
  return 'soffice';
}

async function docxToPdf(inputPath, outputDir) {
  const soffice = findSoffice();
  await new Promise((resolve, reject) => {
    const args = ['--headless', '--convert-to', 'pdf', '--outdir', outputDir, inputPath];
    const p = spawn(soffice, args, { stdio: 'ignore' });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error('LibreOffice convert error')));
  });

  const outPdf = path.join(outputDir, path.basename(inputPath, path.extname(inputPath)) + '.pdf');
  if (!fs.existsSync(outPdf)) throw new Error('PDF no generado');
  return outPdf;
}

module.exports = { docxToPdf };
