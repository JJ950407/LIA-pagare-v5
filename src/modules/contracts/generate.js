const { generateContractDoublePass } = require('./doublepass');

async function generateContractDocxPdf({ data, templatePath, outDir, numeroALetras }) {
  const { finalPdf } = await generateContractDoublePass({
    templatePath,
    mapping: data,
    outBaseDir: outDir,
    numeroALetras
  });
  return { outPdf: finalPdf };
}

module.exports = { generateContractDocxPdf };
