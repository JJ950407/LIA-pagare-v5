// numeroALetras.js — versión compatible con el contrato original LIA

function Unidades(num) {
  switch (num) {
      case 1: return 'UN';
      case 2: return 'DOS';
      case 3: return 'TRES';
      case 4: return 'CUATRO';
      case 5: return 'CINCO';
      case 6: return 'SEIS';
      case 7: return 'SIETE';
      case 8: return 'OCHO';
      case 9: return 'NUEVE';
  }
  return '';
}

function Decenas(num) {
  let decena = Math.floor(num / 10);
  let unidad = num - (decena * 10);

  switch (decena) {
      case 1:
          switch (unidad) {
              case 0: return 'DIEZ';
              case 1: return 'ONCE';
              case 2: return 'DOCE';
              case 3: return 'TRECE';
              case 4: return 'CATORCE';
              case 5: return 'QUINCE';
              default: return 'DIECI' + Unidades(unidad);
          }
      case 2:
          if (unidad === 0) return 'VEINTE';
          return 'VEINTI' + Unidades(unidad);
      case 3: return (unidad === 0) ? 'TREINTA' : 'TREINTA Y ' + Unidades(unidad);
      case 4: return (unidad === 0) ? 'CUARENTA' : 'CUARENTA Y ' + Unidades(unidad);
      case 5: return (unidad === 0) ? 'CINCUENTA' : 'CINCUENTA Y ' + Unidades(unidad);
      case 6: return (unidad === 0) ? 'SESENTA' : 'SESENTA Y ' + Unidades(unidad);
      case 7: return (unidad === 0) ? 'SETENTA' : 'SETENTA Y ' + Unidades(unidad);
      case 8: return (unidad === 0) ? 'OCHENTA' : 'OCHENTA Y ' + Unidades(unidad);
      case 9: return (unidad === 0) ? 'NOVENTA' : 'NOVENTA Y ' + Unidades(unidad);
      case 0: return Unidades(unidad);
  }
  return '';
}

function Centenas(num) {
  let centenas = Math.floor(num / 100);
  let resto = num % 100;

  switch (centenas) {
      case 1: return (resto === 0) ? 'CIEN' : 'CIENTO ' + Decenas(resto);
      case 2: return 'DOSCIENTOS ' + Decenas(resto);
      case 3: return 'TRESCIENTOS ' + Decenas(resto);
      case 4: return 'CUATROCIENTOS ' + Decenas(resto);
      case 5: return 'QUINIENTOS ' + Decenas(resto);
      case 6: return 'SEISCIENTOS ' + Decenas(resto);
      case 7: return 'SETECIENTOS ' + Decenas(resto);
      case 8: return 'OCHOCIENTOS ' + Decenas(resto);
      case 9: return 'NOVECIENTOS ' + Decenas(resto);
  }
  return Decenas(resto);
}

function Seccion(num, divisor, strSingular, strPlural) {
  let cientos = Math.floor(num / divisor);
  let resto = num - (cientos * divisor);

  let letras = '';

  if (cientos > 0) {
      if (cientos === 1) letras = strSingular;
      else letras = Centenas(cientos) + ' ' + strPlural;
  }

  if (resto > 0) letras += ' ';

  return { letras: letras, resto: resto };
}

function numeroALetras(num) {
  num = Math.floor(num);

  if (num === 0) return 'CERO';

  let millones = Seccion(num, 1000000, 'UN MILLÓN', 'MILLONES');
  let miles = Seccion(millones.resto, 1000, 'MIL', 'MIL');
  let cientos = Centenas(miles.resto);

  let letras = '';

  if (millones.letras) letras += millones.letras;
  if (miles.letras) letras += ' ' + miles.letras;
  if (cientos) letras += ' ' + cientos;

  return letras.trim();
}

module.exports = { numeroALetras };
