// src/modules/contracts/doublepass.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dayjs = require('dayjs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const QRCode = require('qrcode');
const { renderDocxWithMapping, ensureDir } = require('../../lib/docx');

// -----------------------------------------------------------------------------
// Utilidades
// -----------------------------------------------------------------------------

// Conversión mm -> puntos PDF
const MM_TO_PT = 72 / 25.4;
const mm = (v) => v * MM_TO_PT;

// Calcular hash SHA-256 de un archivo
function calculateHash(filePath) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  } catch (error) {
    console.error('❌ Error calculando hash:', error.message);
    return null;
  }
}

// Intentar convertir DOCX -> PDF con LibreOffice (best-effort)
async function tryDocxToPdf(docxPath, outDir) {
  try {
    const { execSync } = require('child_process');
    ensureDir(outDir);
    execSync(
      `soffice --headless --convert-to pdf --outdir "${outDir}" "${docxPath}"`,
      { stdio: 'ignore' }
    );
    const pdfPath = path.join(
      outDir,
      path.basename(docxPath).replace(/\.docx$/i, '.pdf')
    );
    if (fs.existsSync(pdfPath)) return pdfPath;
  } catch (_) {}
  return null;
}

// -----------------------------------------------------------------------------
// Fase 2: Foliado y QR
// -----------------------------------------------------------------------------

// Foliado (numeración de páginas)
async function addPageNumbers(pdfDoc) {
  try {
    console.log('📄 Agregando numeración de páginas...');
    const pages = pdfDoc.getPages();
    const totalPages = pages.length;
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    pages.forEach((page, index) => {
      const pageNumber = index + 1;
      const text = `Página ${pageNumber} de ${totalPages}`;
      const size = 10;
      const textWidth = font.widthOfTextAtSize(text, size);
      const { width } = page.getSize();

      // Centrado inferior a 15 mm del borde
      page.drawText(text, {
        x: (width - textWidth) / 2,
        y: mm(15),
        size,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
    });

    console.log(`✅ Numeración agregada: ${totalPages} páginas`);
    return totalPages;
  } catch (error) {
    console.error('❌ Error al agregar numeración:', error.message);
    return 0;
  }
}

// Agregar QR (incluye hash corto)
async function addQRToContractPdf(pdfPath, mapping, totalPages, pdfHashPreQR) {
  try {
    console.log('📱 Agregando QR al contrato (con hash pre-QR)...');

    const existingPdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { height } = firstPage.getSize();

    const qrData = {
      tipo: 'CONTRATO',
      nombre: mapping['nombre deudor'] || '',
      fecha:
        mapping['fecha emision contrato'] ||
        mapping['fecha actual'] ||
        dayjs().format('DD/MM/YYYY'),
      pagares: Array.isArray(mapping.pagares) ? mapping.pagares.length : 0,
      paginas: totalPages || pages.length,
      folio: mapping['folio contrato'] || mapping['numero contrato'] || 'C-001',
      hash: pdfHashPreQR ? pdfHashPreQR.substring(0, 16) : '',
    };

    const qrText = JSON.stringify(qrData);
    const qrPng = await QRCode.toBuffer(qrText, {
      margin: 0,
      scale: 6,
      errorCorrectionLevel: 'M',
    });
    const qrImg = await pdfDoc.embedPng(qrPng);

    // Posición: esquina sup. derecha (25 mm)
    const qrSize = mm(25);
    const x = mm(175);
    const y = height - mm(33);

    firstPage.drawImage(qrImg, {
      x,
      y,
      width: qrSize,
      height: qrSize,
    });

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(pdfPath, pdfBytes);

    console.log('✅ QR agregado exitosamente al contrato');
    console.log(
      `🔐 Hash (pre-QR) incluido en QR: ${qrData.hash || '(vacío)'}`
    );
    return true;
  } catch (error) {
    console.error('❌ Error al agregar QR al contrato:', error.message);
    return false;
  }
}

// -----------------------------------------------------------------------------
// Audit JSON (con hashes pre y post QR) — ahora único por corrida
// -----------------------------------------------------------------------------

/**
 * Genera audit_*.json junto al PDF final.
 * Guarda:
 *  - hash_sha256_pre_qr (del PDF antes de estampar el QR)
 *  - hash_sha256_post_qr (del PDF final ya con QR)
 * El nombre incluye el base del PDF para evitar sobrescrituras en procesos simultáneos.
 */
function generateAuditJson(pdfPath, docxPath, mapping, totalPages, pdfHashPreQR) {
  try {
    console.log('📋 Generando audit.json...');

    const pdfStats = fs.existsSync(pdfPath) ? fs.statSync(pdfPath) : null;
    const docxStats = fs.existsSync(docxPath) ? fs.statSync(docxPath) : null;

    const pdfHashPostQR = pdfStats ? calculateHash(pdfPath) : null;
    const docxHash = docxStats ? calculateHash(docxPath) : null;

    const audit = {
      version: '1.0',
      tipo: 'contrato',
      timestamp: new Date().toISOString(),
      fecha_generacion: dayjs().format('DD/MM/YYYY HH:mm:ss'),

      cliente: {
        nombre: mapping['nombre deudor'] || '',
        domicilio: mapping['direccion deudor'] || '',
        poblacion: mapping['poblacion deudor'] || '',
      },

      archivos: {
        contrato_pdf: pdfStats
          ? {
              nombre: path.basename(pdfPath),
              ruta_relativa: path.basename(pdfPath),
              hash_sha256_pre_qr: pdfHashPreQR || null,
              hash_sha256_post_qr: pdfHashPostQR,
              tamaño_bytes: pdfStats.size,
              paginas: totalPages,
            }
          : null,
        contrato_docx: docxStats
          ? {
              nombre: path.basename(docxPath),
              ruta_relativa: path.basename(docxPath),
              hash_sha256: docxHash,
              tamaño_bytes: docxStats.size,
            }
          : null,
      },

      datos_contrato: {
        folio: mapping['folio contrato'] || mapping['numero contrato'] || 'C-001',
        predio: mapping['nombre predio'] || '',
        manzana_lote: mapping['manzana y lote(s)'] || '',
        total_pagares: Array.isArray(mapping.pagares) ? mapping.pagares.length : 0,
        monto_total: mapping['precio total numero'] || '',
        enganche: mapping['enganche numero'] || '',
        saldo: mapping['saldo numero'] || '',
        primer_vencimiento: mapping.fechaPrimerPago || '',
      },

      qr_code: {
        tipo: 'CONTRATO',
        nombre: mapping['nombre deudor'] || '',
        fecha:
          mapping['fecha emision contrato'] ||
          mapping['fecha actual'] ||
          dayjs().format('DD/MM/YYYY'),
        pagares: Array.isArray(mapping.pagares) ? mapping.pagares.length : 0,
        paginas: totalPages,
        folio:
          mapping['folio contrato'] || mapping['numero contrato'] || 'C-001',
        hash_corto_pre_qr: pdfHashPreQR ? pdfHashPreQR.substring(0, 16) : '',
      },

      verificacion: {
        instrucciones:
          'El QR contiene el hash del PDF antes de estampar el propio QR (pre_QR). Para validar integridad del archivo final, calcule el hash SHA-256 del PDF actual y compárelo con hash_sha256_post_qr.',
        hash_completo_pdf_post_qr: pdfHashPostQR,
        algoritmo: 'SHA-256',
      },
    };

    // Guardar audit.json junto al PDF, único por corrida (usa el nombre del PDF)
    const pdfBase = path.basename(pdfPath, '.pdf'); // p.ej. "contrato_20251027_222058"
    const auditFilename = `audit_${pdfBase}.json`;
    const auditPath = path.join(path.dirname(pdfPath), auditFilename);
    fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2));

    console.log('✅ audit.json generado exitosamente');
    console.log(`📁 Guardado en: ${auditPath}`);
    console.log(`🔐 Hash post-QR (completo): ${pdfHashPostQR}`);

    return { audit, auditPath, pdfHashPreQR, pdfHashPostQR };
  } catch (error) {
    console.error('❌ Error generando audit.json:', error.message);
    return { audit: null, auditPath: null, pdfHashPreQR: null, pdfHashPostQR: null };
  }
}

// -----------------------------------------------------------------------------
// Flujo principal: doble pasada
// -----------------------------------------------------------------------------

/**
 * generateContractDoublePass
 * 1) Renderiza DOCX (pasada 1) para contar páginas
 * 2) Renderiza DOCX final con num_hojas y num_hojas_letra
 * 3) Convierte a PDF, agrega foliado, calcula hash pre-QR, estampa QR,
 *    y genera audit.json con hashes pre y post.
 */
async function generateContractDoublePass({
  templatePath,
  mapping,
  outBaseDir,
  numeroALetras,
}) {
  const ts = dayjs().format('YYYYMMDD_HHmmss');

  // Directorio temporal para la pasada 1 — único por corrida
  const tmpDir = path.join(outBaseDir, '..', '..', 'tmp', ts);
  ensureDir(tmpDir);

  // PASADA 1: render simple para estimar páginas
  const p1Docx = path.join(tmpDir, `contrato_p1_${ts}.docx`);
  await renderDocxWithMapping({ templatePath, mapping, outPath: p1Docx });

  let pages = 0;
  const p1Pdf = await tryDocxToPdf(p1Docx, tmpDir);
  if (p1Pdf && fs.existsSync(p1Pdf)) {
    const pdfDoc = await PDFDocument.load(fs.readFileSync(p1Pdf));
    pages = pdfDoc.getPageCount();
  }

  // Completar tokens num_hojas / num_hojas_letra
  const num_hojas = pages;
  const numeroALetrasFn =
    typeof numeroALetras === 'function' ? numeroALetras : (n) => String(n);
  const num_hojas_letra = numeroALetrasFn(num_hojas);
  const mappingFinal = { ...mapping, num_hojas, num_hojas_letra };

  // PASADA 2: render final en carpeta contrato/
  const outDocDir = path.join(outBaseDir, 'contrato');
  ensureDir(outDocDir);

  const outName = `contrato_${ts}`;
  const finalDocx = path.join(outDocDir, `${outName}.docx`);
  await renderDocxWithMapping({
    templatePath,
    mapping: mappingFinal,
    outPath: finalDocx,
  });

  // PDF final
  let finalPdf = await tryDocxToPdf(finalDocx, outDocDir);

  // Fase 2: foliado + QR + audit.json
  if (finalPdf && fs.existsSync(finalPdf)) {
    // 1) Foliado
    const pdfBytes = fs.readFileSync(finalPdf);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = await addPageNumbers(pdfDoc);

    // Guardar PDF con numeración
    const pdfWithNumbers = await pdfDoc.save();
    fs.writeFileSync(finalPdf, pdfWithNumbers);

    // 2) Hash PRE-QR (del PDF numerado, antes de estampar QR)
    const pdfHashPreQR = calculateHash(finalPdf);

    // 3) Estampar QR con hash pre-QR
    await addQRToContractPdf(finalPdf, mappingFinal, totalPages, pdfHashPreQR);

    // 4) audit.json (calcula internamente hash post-QR y guarda ambos)
    const { auditPath: _auditPath } = generateAuditJson(
      finalPdf,
      finalDocx,
      mappingFinal,
      totalPages,
      pdfHashPreQR
    );
    console.log(`🔎 Auditoría -> ${_auditPath}`);

    console.log('\n🎉 FASE 2 COMPLETADA:');
    console.log('  ✅ Foliado de páginas');
    console.log('  ✅ QR con hash de verificación (pre-QR)');
    console.log('  ✅ Hashes pre y post QR guardados en audit.json\n');
  } else {
    console.warn('⚠️ No se pudo generar PDF final, se omite FASE 2');
  }

  return { pages, finalDocx, finalPdf };
}

module.exports = { generateContractDoublePass };
