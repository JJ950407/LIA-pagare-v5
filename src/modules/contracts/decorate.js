// modules/contracts/decorate.js
const MES_NOMBRE = {1:'enero',2:'febrero',3:'marzo',4:'abril',5:'mayo',6:'junio',7:'julio',8:'agosto',9:'septiembre',10:'octubre',11:'noviembre',12:'diciembre'};

// TODO: reemplaza por tu convertidor formal a letras en MX si ya lo tienes
function numeroALetras(n) {
  const f = Number(n || 0).toFixed(2);
  return `${f} PESOS 00/100 M.N.`.toUpperCase();
}

// Reproducción del plan de pagos en centavos
function planPagosPorCents(total_c, mensual_c) {
  const N = Math.ceil(total_c / mensual_c);
  const montos = Array(N).fill(mensual_c);
  let rest = N*mensual_c - total_c;
  for (let i = 0; i < N && rest > 0; i++) {
    const can = Math.min(rest, montos[i] - 1);
    montos[i] -= can;
    rest -= can;
  }
  return montos;
}

function calculaNumeroPagaresConAnualidades(data) {
  const saldo_c = Math.round(((data.total || 0) - (data.enganche || 0)) * 100);
  const anual_c = Math.round((data.anualidadMonto || 0) * 100);
  const numAnn = data.numeroAnualidades || 0;
  const totalAnn_c = anual_c * numAnn;
  const saldoMens_c = saldo_c - totalAnn_c;
  const mens_c = Math.round((data.mensual || 0) * 100);
  if (mens_c <= 0) return numAnn; // evita división por cero
  const mens = planPagosPorCents(Math.max(0, saldoMens_c), mens_c);
  return mens.length + numAnn;
}

function formateaFechaPrimerPago(data) {
  const d = (data._fechaPrimerPago instanceof Date) ? data._fechaPrimerPago : new Date(data.fechaEmision || Date.now());
  const dia = String(d.getDate()).padStart(2,'0');
  const mes = MES_NOMBRE[d.getMonth()+1].toUpperCase();
  const anio = d.getFullYear();
  return `${dia} DE ${mes} DEL ${anio}`;
}

// Une datos del bot + extras del contrato y genera alias/derivados
function decorateForContract(data, contratoExtra = {}) {
  const out = { ...data };

  // Importes en letras y derivados
  out['total_en_letra']   = numeroALetras(out.total);
  out['enganche_letra']    = numeroALetras(out.enganche);
  out['saldo']            = Number(((out.total || 0) - (out.enganche || 0)).toFixed(2));
  out['saldo_letra']      = numeroALetras(out['saldo']);
  out['mensual_letra']    = numeroALetras(out.mensual);
  out['anualidad_letra']  = numeroALetras(out.anualidadMonto);
  out['anualidad_mes_nombre'] = MES_NOMBRE[out.anualidadMes || 12];

  out['numeroPagares']    = calculaNumeroPagaresConAnualidades(out);
  out['fechaPrimerPago']  = formateaFechaPrimerPago(out);

  // Alias para tokens del DOCX
  if (out.moratorios != null && out['interes'] == null) out['interes'] = out.moratorios;
  if (!out['nombre deudor'] && out.deudor) out['nombre deudor'] = out.deudor;

  // Campos de predio, colindancias, testigos, etc.
  Object.assign(out, contratoExtra);
  return out;
}

module.exports = { decorateForContract, calculaNumeroPagaresConAnualidades, numeroALetras, MES_NOMBRE };
