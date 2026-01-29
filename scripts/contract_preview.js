// scripts/contract_preview.js
// Ejecuta: node scripts/contract_preview.js

const fs = require('fs');
const path = require('path');

// --- resolvemos rutas de módulos en src/ o fuera de src/ ---
function tryRequire(paths) {
  for (const p of paths) {
    try {
      return require(p);
    } catch (e) {
      // si el error es distinto a MODULE_NOT_FOUND, lo relanzamos
      if (!String(e?.code).includes('MODULE_NOT_FOUND')) throw e;
    }
  }
  throw new Error(
    'No pude cargar módulos de contrato. Probé:\n' +
    paths.map(p => '• ' + p).join('\n') +
    '\nAsegúrate de tener los archivos en alguna de esas rutas.'
  );
}

const { decorateForContract } = tryRequire([
  '../src/modules/contracts/decorate',
  '../modules/contracts/decorate',
]);

const { generateContractDocxPdf } = tryRequire([
  '../src/modules/contracts/generate',
  '../modules/contracts/generate',
]);

// -------------------------
// Datos FALSOS de prueba
// -------------------------
const data = {
  total: 250000,
  enganche: 10000,
  mensual: 5000,
  anualidadMonto: 0,
  numeroAnualidades: 0,
  anualidadMes: 12,

  beneficiario: 'INVERSIONES FALSAS S.A. DE C.V.',
  deudor: 'Juan Prueba López',
  direccion: 'Av. Sin Nombre 123, Col. Demo',
  poblacion: 'Demo City, MX',
  lugarExpedicion: 'Ciudad de México',
  lugarPago: 'Ciudad de México',
  fechaEmision: new Date(),
  reglaPref: 'mismo',
  moratorios: 10,
  telefono: '5512345678',
  genero: 'EL COMPRADOR', // o 'LA COMPRADORA'
};

// Tokens extra del contrato (usa EXACTAMENTE los nombres de tu DOCX)
const contratoExtra = {
  'nombre predio': 'Predio San Blas (PRUEBA)',
  'ubicación predio': 'Juchitepec, Estado de México',
  'municipio predio': 'Juchitepec',
  'manzana y lote(s)': 'Manzana 10, Lote 2',
  'superficie numero': '152.00',
  'superficie letra': 'CIENTO CINCUENTA Y DOS METROS CUADRADOS',
  'norte numero': '10.00 m',     'colindancia norte': 'Calle Ficticia 1',
  'sur numero': '10.00 m',       'colindancia sur': 'Calle Ficticia 2',
  'oriente numero': '15.20 m',   'colindancia oriente': 'Lote Vecino 3',
  'poniente numero': '15.20 m',  'colindancia poniente': 'Lote Vecino 4',
  'testigo1': 'Testigo A', 'testigo2': 'Testigo B',
};

(async () => {
  try {
    const outData = decorateForContract(data, contratoExtra);

    // Buscamos la plantilla en varias ubicaciones y nombres
    const candidates = [
      path.join(__dirname, '..', 'templates', 'v1', 'contract.docx'),
      path.join(__dirname, '..', 'templates', 'v1', 'contrato base.docx'),
      path.join(__dirname, '..', 'src', 'modules', 'contracts', 'contrato base.docx'),
      path.join(__dirname, '..', 'src', 'modules', 'contracts', 'contract.docx'),
    ];
    const templatePath = candidates.find(p => fs.existsSync(p));
    if (!templatePath) {
      console.error('❌ No encontré la plantilla DOCX. Probé:\n' + candidates.join('\n'));
      process.exit(1);
    }

    const outDir = path.join(__dirname, '..', 'data', 'output', 'contracts');
    const { outDocx, outPdf } = await generateContractDocxPdf({ data: outData, templatePath, outDir });

    console.log('✅ Contrato DOCX:', outDocx);
    console.log('✅ Contrato PDF :', outPdf);
  } catch (e) {
    console.error('❌ Error generando contrato:', e);
    process.exit(1);
  }
})();
