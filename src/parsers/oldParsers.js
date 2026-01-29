// src/parsers/oldParsers.js

//
// PARSER DE SÍ/NO
//
function parseYesNo(txt) {
  const s = String(txt).trim().toLowerCase();
  if (['si', 'sí', 'yes', 'y', 'true', '1'].includes(s)) return true;
  if (['no', 'n', 'false', '0'].includes(s)) return false;
  throw new Error('⚠️ Responde "sí" o "no".');
}

//
// PARSER DE MESES
//
function parseMesLoose(txt) {
  const s = String(txt).trim().toLowerCase();

  const meses = {
    '1': 1, 'enero': 1,
    '2': 2, 'febrero': 2,
    '3': 3, 'marzo': 3,
    '4': 4, 'abril': 4,
    '5': 5, 'mayo': 5,
    '6': 6, 'junio': 6,
    '7': 7, 'julio': 7,
    '8': 8, 'agosto': 8,
    '9': 9, 'septiembre': 9, 'setiembre': 9,
    '10': 10, 'octubre': 10,
    '11': 11, 'noviembre': 11,
    '12': 12, 'diciembre': 12,
  };

  if (meses[s]) return meses[s];

  throw new Error('⚠️ Indica un mes válido (1..12 o nombre del mes).');
}

//
// PARSER DE PORCENTAJES
//
function parsePercentLoose(txt) {
  const s = String(txt).trim().replace('%', '');

  const n = Number(s);
  if (!isNaN(n) && n >= 0 && n <= 100) return n;

  throw new Error('⚠️ Porcentaje inválido.');
}

//
// PARSER DE TELÉFONO
//
function parseTelefono(txt) {
  const s = String(txt).trim();
  const digits = s.replace(/\D+/g, '');

  if (digits.length >= 10 && digits.length <= 13) return digits;

  throw new Error('⚠️ Ingresa un teléfono válido (10 dígitos o +52...).');
}

//
// PARSER REGLA 15/30 — PARCHE COMPLETO
//
function parseRegla1530(txt) {
  const s = String(txt).trim().toLowerCase();

  // Variantes para "este mes"
  const este = [
    'este mes',
    'en este mes',
    'este',
    'mismo mes',
    'actual',
    'mes actual',
    'en el mes actual'
  ];

  // Variantes para "siguiente mes"
  const siguiente = [
    'siguiente mes',
    'en el siguiente mes',
    'mes siguiente',
    'siguiente',
    'proximo mes',
    'próximo mes',
    'proximo',
    'próximo'
  ];

  if (este.includes(s)) return 'este';
  if (siguiente.includes(s)) return 'siguiente';

  throw new Error('⚠️ Debe ser "este mes" o "siguiente mes".');
}

//
// PARSER TIPO DOCUMENTO
//
function parseDocType(txt) {
  const s = String(txt).trim();

  if (s === '1') return 'contrato';
  if (s === '2') return 'pagares';
  if (s === '3') return 'ambos';

  throw new Error('⚠️ Responde 1, 2 o 3.');
}

//
// PARSER DE GÉNERO
//
function parseGenero(txt) {
  const s = String(txt || '').trim().toLowerCase();

  if (s === '1') return 'EL COMPRADOR';
  if (s === '2') return 'LA COMPRADORA';

  const male = ['h', 'hombre', 'masculino', 'el comprador', 'comprador'];
  const female = ['m', 'mujer', 'femenino', 'la compradora', 'compradora'];

  if (male.includes(s)) return 'EL COMPRADOR';
  if (female.includes(s)) return 'LA COMPRADORA';

  throw new Error('⚠️ Responde Hombre/Mujer (H/M, masculino/femenino, comprador/compradora).');
}

//
// PARSER DE TESTIGOS
//
function parseTestigos(txt) {
  const parts = String(txt).split(/[\|/]+/);

  if (parts.length < 2)
    throw new Error('⚠️ Debes indicar 2 testigos separados por "|" o "/". Ej: Juan Pérez / Ana Ruiz');

  return parts.map(t => t.trim()).slice(0, 2);
}

module.exports = {
  parseYesNo,
  parseMesLoose,
  parsePercentLoose,
  parseTelefono,
  parseRegla1530,
  parseDocType,
  parseGenero,
  parseTestigos
};
