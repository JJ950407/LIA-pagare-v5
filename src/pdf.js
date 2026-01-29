const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const QRCode = require('qrcode');

// Soporta distintas exportaciones del paquete
const nal = require('numero-a-letras');
const numeroALetrasFn =
  (nal && (nal.NumerosALetras || nal.NumeroALetras || (typeof nal === 'function' ? nal : null))) || null;

const MM_TO_PT = 72 / 25.4;
const mm = v => v * MM_TO_PT;

const toUpper = v => (v == null ? '' : String(v).toUpperCase());
const two = n => String(n).padStart(2,'0');

function formatCurrencyNumber(n) {
  const num = Number(n || 0);
  // Redondear a centavos (elimina residuos flotantes)
  const rounded = Math.round(num * 100) / 100;
  // Forzar exactamente 2 decimales como STRING
  const fixed = rounded.toFixed(2);
  // Formatear con comas pero mantener .00 exacto
  return new Intl.NumberFormat('es-MX', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  }).format(parseFloat(fixed));
}

function formatCurrencyWords(n) {
  const num = Number(n || 0);
  const entero = Math.floor(num);
  let letras;
  try {
    letras = numeroALetrasFn ? numeroALetrasFn(entero, {
      plural: 'pesos', singular: 'peso',
      centPlural: 'centavos', centSingular: 'centavo'
    }) : String(entero);
  } catch { letras = String(entero); }
  return letras.toUpperCase();
}

function formatDateLong(iso) {
  const d = new Date(iso);
  return `${two(d.getDate())} DE ${d.toLocaleString('es-MX',{month:'long'}).toUpperCase()} DE ${d.getFullYear()}`;
}

function formatDateDMY(iso) {
  const d = new Date(iso);
  return `${two(d.getDate())}/${two(d.getMonth()+1)}/${d.getFullYear()}`;
}

function formatPercent(n) {
  const num = Number(n || 0);
  return `${num}%`;
}

function resolve(obj, dotted){ 
  return dotted.split('.').reduce((o,k)=> (o ? o[k] : undefined), obj); 
}

async function renderPagare(mapping, payload){
  const basePdfPath = mapping.pdf.base || 'templates/base.pdf';
  const pdfBytes = fs.readFileSync(basePdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const form = pdfDoc.getForm();
  form.updateFieldAppearances(fontRegular);

  for (const [pdfFieldRaw, rule] of Object.entries(mapping.fields)) {
    const pdfField = pdfFieldRaw;
    let f;
    
    try { 
      f = form.getField(pdfField); 
    } catch (err) { 
      continue; 
    }

    let val = resolve(payload, rule.from);

    // Tipos especiales
    if (rule?.type === 'currency')           val = formatCurrencyNumber(val);
    else if (rule?.type === 'currencyWords') val = formatCurrencyWords(val);
    else if (rule?.type === 'dateLong')      val = formatDateLong(val);
    else if (rule?.type === 'dateDMY')       val = formatDateDMY(val);
    else if (rule?.type === 'day')           { const d = new Date(val); val = two(d.getDate()); }
    else if (rule?.type === 'monthName')     { const d = new Date(val); val = d.toLocaleString('es-MX',{month:'long'}).toUpperCase(); }
    else if (rule?.type === 'year')          { const d = new Date(val); val = String(d.getFullYear()); }
    else if (rule?.type === 'percent')       val = formatPercent(val);

    if (rule?.pad) val = String(val ?? '').padStart(Number(rule.pad), '0');

    // Mayúsculas por defecto (evita tocar números de currency)
    if (rule?.type !== 'currency') val = toUpper(val);

    try { 
      f.setText(String(val)); 
    } catch (err) {
      console.error(`Error al llenar campo "${pdfField}":`, err.message);
    }

    // Ajustes finos por campo
    const key = pdfField.trim().toLowerCase();

    if (key === 'monto') { 
      try { f.updateAppearances(fontBold); } catch {} 
    }

    if (key === 'lugar expedicion') { 
      try { f.setFontSize?.(9); } catch {} 
    }
  }

  // Aplanar apariencias de campos ANTES de dibujar el QR
  form.flatten();

  // QR (solo imagen, sin texto)
  if (mapping.pdf.qr){
    const page = pdfDoc.getPages()[0];
    const { x_mm, y_mm, size_mm } = mapping.pdf.qr;
    const size = mm(size_mm);

    // IMPORTANTE: Extraer el hash corto del JSON completo si existe
    let qrText;
    
    if (payload?.qr) {
      // Si viene como string JSON, parsearlo
      try {
        const qrData = typeof payload.qr === 'string' ? JSON.parse(payload.qr) : payload.qr;
        // Usar solo: base, doc, folio, monto, emision, h
        qrText = JSON.stringify({
          base: qrData.base,
          doc: qrData.doc,
          folio: qrData.folio,
          monto: qrData.monto,
          emision: qrData.emision,
          h: qrData.h
        });
      } catch {
        qrText = String(payload.qr);
      }
    } else if (payload?.pagare?.qr_text) {
      // Si viene en pagare.qr_text
      try {
        const qrData = typeof payload.pagare.qr_text === 'string' 
          ? JSON.parse(payload.pagare.qr_text) 
          : payload.pagare.qr_text;
        // Usar solo los campos esenciales con hash corto
        qrText = JSON.stringify({
          base: qrData.base,
          doc: qrData.doc,
          folio: qrData.folio,
          monto: qrData.monto,
          emision: qrData.emision,
          h: qrData.h
        });
      } catch {
        qrText = String(payload.pagare.qr_text);
      }
    } else {
      // Fallback: JSON simple sin hash
      qrText = JSON.stringify({
        folio: resolve(payload,'pagare.folio'),
        monto: resolve(payload,'pagare.monto'),
        emision: resolve(payload,'pagare.fechaEmision')
      });
    }

    console.log('🔲 QR generado:', qrText);

    // Generar QR con configuración optimizada para lectura en móviles
    const qrPng = await QRCode.toBuffer(qrText, {
      errorCorrectionLevel: 'H',  // Máxima corrección de errores
      margin: 2,                    // Margen reducido
      scale: 8,                     // Escala aumentada para mejor resolución
      width: 256                    // Ancho fijo para consistencia
    });

    const qrImg = await pdfDoc.embedPng(qrPng);
    const x = mm(x_mm), h = size;
    const y = pdfDoc.getPages()[0].getHeight() - mm(y_mm) - h;
    page.drawImage(qrImg, { x, y, width: size, height: size });
  }

  return await pdfDoc.save();
}

async function renderToFile(mappingPath, payload, outPath){
  const mapping = JSON.parse(fs.readFileSync(mappingPath,'utf8'));
  const pdf = await renderPagare(mapping, payload);
  fs.mkdirSync(path.dirname(outPath), { recursive:true });
  fs.writeFileSync(outPath, pdf);
  return outPath;
}

async function renderToBuffer(mappingPath, payload){
  const mappingAbs = path.isAbsolute(mappingPath)
    ? mappingPath
    : path.join(process.cwd(), mappingPath);
  const mapping = JSON.parse(fs.readFileSync(mappingAbs,'utf8'));
  const pdf = await renderPagare(mapping, payload);
  return Buffer.from(pdf);
}

module.exports = { renderToFile, renderToBuffer };