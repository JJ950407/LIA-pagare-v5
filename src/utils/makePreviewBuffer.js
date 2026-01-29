const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

// Accepts a path or Buffer for both inputs.
// Returns a Buffer with background + print content overlaid per page, in memory only.
async function makePreviewBuffer(printInput, bgInput){
  const loadBytes = (input) => {
    if (!input) throw new Error('makePreviewBuffer: missing input');
    if (Buffer.isBuffer(input)) return input;
    if (typeof input === 'string') {
      const abs = path.isAbsolute(input) ? input : path.join(process.cwd(), input);
      return fs.readFileSync(abs);
    }
    throw new Error('makePreviewBuffer: input must be Buffer or path');
  };

  const printBytes = loadBytes(printInput);
  let bgBytes;
  try { bgBytes = loadBytes(bgInput); }
  catch { bgBytes = null; }

  const printPdf = await PDFDocument.load(printBytes);
  const out = await PDFDocument.create();

  // Try to interpret background as PDF first; if not, try as image (PNG/JPG)
  let bgPdf = null;
  let bgImage = null; // { kind: 'png'|'jpg', img }
  if (bgBytes) {
    try {
      bgPdf = await PDFDocument.load(bgBytes);
    } catch {
      try {
        // We embed into the OUT document (target)
        // Detect PNG signature
        const isPng = bgBytes.slice(0,8).equals(Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]));
        if (isPng) bgImage = { kind: 'png', embed: async () => out.embedPng(bgBytes) };
        else bgImage = { kind: 'jpg', embed: async () => out.embedJpg(bgBytes) };
      } catch {
        bgPdf = null; bgImage = null;
      }
    }
  }

  const pagesPrint = printPdf.getPages();
  const pagesBg = bgPdf ? bgPdf.getPages() : [];

  for (let i = 0; i < pagesPrint.length; i++) {
    const srcPage = pagesPrint[i];
    const { width, height } = srcPage.getSize();

    const page = out.addPage([width, height]);

    // Draw BG first if available
    if (bgPdf && pagesBg.length > 0) {
      const bgIndex = Math.min(i, pagesBg.length - 1);
      const embeddedBg = await out.embedPage(pagesBg[bgIndex]);
      page.drawPage(embeddedBg, { x: 0, y: 0, width, height });
    } else if (bgImage) {
      const img = await bgImage.embed();
      page.drawImage(img, { x: 0, y: 0, width, height });
    }

    // Draw print content on top
    const embeddedPrint = await out.embedPage(pagesPrint[i]);
    page.drawPage(embeddedPrint, { x: 0, y: 0, width, height });
  }

  const bytes = await out.save();
  return Buffer.from(bytes);
}

module.exports = { makePreviewBuffer };
