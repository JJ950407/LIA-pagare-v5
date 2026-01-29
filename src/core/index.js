// src/core/index.js
const { parseMoneyLoose } = require('../parsers/money');
const { parseDateDMYLoose } = require('../parsers/date');
const {
  parseYesNo,
  parseMesLoose,
  parsePercentLoose,
  parseTelefono,
  parseRegla1530,
  parseDocType,
  parseGenero
} = require('../parsers/oldParsers');
const { SESS, DRAFTS } = require('../db/memory');
const { STEPS } = require('../steps/definitions');
const { generarLoteYMeta, generarContrato } = require('../documents/generator');
// Import MessageMedia so we can send PDF attachments via WhatsApp
const { MessageMedia } = require('whatsapp-web.js');

// Estado base del flujo (los campos extra del contrato se van agregando dinámicamente)
function baseData() {
  return {
    total: 0,
    enganche: 0,
    saldo: 0,
    mensual: 0,
    beneficiario: '',
    deudor: '',
    direccion: '',
    poblacion: '',
    lugarExpedicion: '',
    lugarPago: '',
    fechaEmision: new Date(),
    moratorios: 0,
    telefono: '',
    reglaPref: 'mismo',
    anualidadMonto: 0,
    numeroAnualidades: 0,
    anualidadMes: 12,
    tipoDocumento: 'ambos',
    numeroPagares: 0,
    interes: 0,
    _tieneAnualidades: false
  };
}

function renderMainMenu() {
  return 'Bienvenido 👋.\n¿Qué deseas generar?\n1. Contrato\n2. Pagarés\n3. Ambos\n\nEnvía solo el número correspondiente:';
}

// ----------------------------------------
// Configuración de edición por bloques
// ----------------------------------------

// Menús de edición: campos disponibles por bloque
const EDIT_MENUS = {
  A: [
    { key: 'total', label: '💰 Total' },
    { key: 'enganche', label: '💵 Enganche' },
    { key: 'mensual', label: '📅 Mensualidad' },
    { key: 'anualidadMonto', label: '💎 Monto de anualidad' },
    { key: 'numeroAnualidades', label: '🔢 Número de anualidades' },
    { key: 'anualidadMes', label: '🗓️ Mes de anualidad' },
    { key: 'primerPagoMes', label: '📆 Regla 15/30' },
    { key: 'moratorios', label: '⚠️ Moratorios' },
    { key: 'interes', label: '📈 Interés anual' }
  ],
  B: [
    { key: 'beneficiario', label: '👤 Beneficiario' },
    { key: 'deudor', label: '🙋 Deudor' },
    { key: 'deudorGenero', label: '🚻 Género' },
    { key: 'direccion', label: '🏠 Dirección' },
    { key: 'poblacion', label: '🏙️ Población' },
    { key: 'lugarExpedicion', label: '📍 Expedición' },
    { key: 'lugarPago', label: '🏦 Pago' },
    { key: 'telefono', label: '📞 Teléfono' }
  ],
  C: [
    { key: 'predioNombre', label: '🏷️ Predio' },
    { key: 'predioUbicacion', label: '📌 Ubicación' },
    { key: 'predioMunicipio', label: '🏛️ Municipio' },
    { key: 'predioManzanaLote', label: '🗺️ Manzana/Lote' },
    { key: 'predioSuperficie', label: '📐 Superficie' },
    { key: 'linderoNorte', label: '🧭 Norte' },
    { key: 'linderoSur', label: '🧭 Sur' },
    { key: 'linderoOriente', label: '🧭 Oriente' },
    { key: 'linderoPoniente', label: '🧭 Poniente' },
    { key: 'testigos', label: '🧾 Testigos' }
  ]
};

// Formateo de dinero
function formatMoney(val) {
  return `$${Number(val || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

// Resúmenes por bloque
function resumenBloqueA(d) {
  const lines = [];
  lines.push('🧾 Venta y pagos');
  lines.push(`• 💰 Total: ${formatMoney(d.total)}`);
  lines.push(`• 💵 Enganche: ${formatMoney(d.enganche)}`);
  lines.push(`• 📉 Saldo: ${formatMoney(d.saldo)}`);
  lines.push(`• 📅 Mensualidad: ${formatMoney(d.mensual)}`);
  if ((d.numeroAnualidades || 0) > 0) {
    lines.push(`• 💎 Anualidad: ${formatMoney(d.anualidadMonto)} x ${d.numeroAnualidades}`);
  }
  lines.push(`• 🔢 Pagarés: ${d.numeroPagares}`);
  lines.push(`• 📈 Interés anual: ${d.interes}%`);
  lines.push(`• ⚠️ Moratorios: ${d.moratorios}%`);
  return lines.join('\n');
}

function resumenBloqueB(d) {
  const lines = [];
  lines.push('👥 Cliente y deudor');
  lines.push(`• 👤 Beneficiario: ${d.beneficiario}`);
  lines.push(`• 🙋 Deudor: ${d.deudor}`);
  lines.push(`• 🚻 Género: ${d.deudorGenero || ''}`);
  lines.push(`• 🏠 Dirección: ${d.direccion}`);
  lines.push(`• 🏙️ Población: ${d.poblacion}`);
  lines.push(`• 📍 Expedición: ${d.lugarExpedicion}`);
  lines.push(`• 🏦 Pago: ${d.lugarPago}`);
  lines.push(`• 📞 Teléfono: ${d.telefono}`);
  return lines.join('\n');
}

function resumenBloqueC(d) {
  const lines = [];
  lines.push('🏡 Predio y testigos');
  lines.push(`• 🏷️ Predio: ${d.predioNombre}`);
  lines.push(`• 📌 Ubicación: ${d.predioUbicacion}`);
  lines.push(`• 🏛️ Municipio: ${d.predioMunicipio}`);
  lines.push(`• 🗺️ Manzana/Lote: ${d.predioManzanaLote}`);
  lines.push(`• 📐 Superficie: ${d.predioSuperficie}`);
  lines.push(`• 🧭 Norte: ${d.linderoNorte}`);
  lines.push(`• 🧭 Sur: ${d.linderoSur}`);
  lines.push(`• 🧭 Oriente: ${d.linderoOriente}`);
  lines.push(`• 🧭 Poniente: ${d.linderoPoniente}`);
  lines.push(`• 🧾 Testigos: ${d.testigos}`);
  return lines.join('\n');
}

// Resumen general (final)
function resumenFinal(d) {
  const parts = [];
  parts.push(resumenBloqueA(d));
  parts.push(resumenBloqueB(d));
  if (d.tipoDocumento !== 'pagares') {
    parts.push(resumenBloqueC(d));
  }
  return parts.join('\n\n');
}

// Buscar el parser según el campo
function getParseForField(field) {
  for (const step of STEPS) {
    if (step.field && step.field === field) {
      return step.parse || null;
    }
  }
  return null;
}

// Recalcular saldo y pagarés cuando cambian datos clave
function recalcPagos(d) {
  d.saldo = Number((d.total - d.enganche).toFixed(2));
  const anualTotal = (d.anualidadMonto || 0) * (d.numeroAnualidades || 0);
  if (d.mensual > 0) {
    d.numeroPagares = Math.ceil((d.saldo - anualTotal) / d.mensual);
  } else {
    d.numeroPagares = 0;
  }
}

// Obtener índice inicial de un bloque
function firstIndexOfBlock(block) {
  for (let i = 0; i < STEPS.length; i++) {
    if (STEPS[i].block === block) return i;
  }
  return -1;
}
function resumenVenta(d) {
  const out = ['📋 *Resumen de venta*'];
  out.push(`Total: $${d.total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
  out.push(`Enganche: $${d.enganche.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
  out.push(`Saldo: $${d.saldo.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
  out.push(`Mensualidad: $${d.mensual.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
  out.push(`Número de pagarés: ${d.numeroPagares}`);
  if (d.numeroAnualidades > 0)
    out.push(
      `Anualidad: $${d.anualidadMonto.toLocaleString('es-MX', {
        minimumFractionDigits: 2
      })} x ${d.numeroAnualidades} (mes ${d.anualidadMes})`
    );
  out.push(`Beneficiario: ${d.beneficiario}`);
  out.push(`Deudor: ${d.deudor}`);
  out.push(`Dirección: ${d.direccion}`);
  out.push(`Población: ${d.poblacion}`);
  out.push(`Lugar Expedición: ${d.lugarExpedicion}`);
  out.push(`Lugar Pago: ${d.lugarPago}`);
  out.push(`Fecha Emisión: ${d.fechaEmision.toLocaleDateString('es-MX')}`);
  out.push(`Moratorios: ${d.moratorios}%`);
  if (d.interes > 0) out.push(`Interés anual: ${d.interes}%`);
  out.push(`Tipo de documento: ${d.tipoDocumento}`);
  out.push(`Teléfono: ${d.telefono}`);
  return out.join('\n');
}

// Helper para ejecutar el parser correcto (pasos "simples")
function runParser(text, name) {
  switch (name) {
    case 'parseMoneyLoose':
      return parseMoneyLoose(text);
    case 'parseDateDMYLoose':
      return parseDateDMYLoose(text);
    case 'parseYesNo':
      return parseYesNo(text);
    case 'parseMesLoose':
      return parseMesLoose(text);
    case 'parsePercentLoose':
      return parsePercentLoose(text);
    case 'parseTelefono':
      return parseTelefono(text);
    case 'parseRegla1530':
      return parseRegla1530(text);
    case 'parseDocType':
      return parseDocType(text);
    case 'parseGenero':
      return parseGenero(text);
    default:
      return text.trim();
  }
}

async function handleMessage(client, msg) {
  const from = msg.from;
  const text = (msg.body || '').trim();

  // === Logging (entrada y salida) ===
  // Mostrar en consola los mensajes que llegan del usuario y los que se envían desde el bot.
  // Esto es útil para depurar el flujo cuando se usa WhatsApp real y no sólo el simulador.
  try {
    // Log del mensaje entrante del usuario
    console.log(`\n[USER->${from}] ${text}\n`);
  } catch {
    /* ignora fallos de logging */
  }
  // Parchear sendMessage para registrar cada salida solo una vez por instancia de cliente
  if (!client._loggerPatched) {
    const origSend = client.sendMessage.bind(client);
    client.sendMessage = async (to, content, opts) => {
      try {
        if (typeof content === 'string') {
          // Mensaje de texto normal
          console.log(`\n[BOT->${to}] ${content}\n`);
        } else {
          // Mensaje multimedia (por ejemplo PDF u otra media)
          console.log(`\n[BOT->${to}] [MEDIA SENT]\n`);
        }
      } catch (e) {
        console.error('Error logging outgoing message:', e);
      }
      return origSend(to, content, opts);
    };
    client._loggerPatched = true;
  }

  // --- Comandos Globales ---

  // "menu" o "inicio" reinicia el flujo y comienza de nuevo
  if (/^(menu|inicio|ayuda)$/i.test(text)) {
    delete DRAFTS[from];
    SESS[from] = { idx: 0, data: baseData(), mode: 'capture', summaryFromFinal: false };
    const firstStep = STEPS[0];
    const q = firstStep && firstStep.q ? firstStep.q : renderMainMenu();
    return client.sendMessage(from, q);
  }

  // Cancelar siempre descarta la sesión
  if (/^cancelar$/i.test(text)) {
    delete SESS[from];
    delete DRAFTS[from];
    return client.sendMessage(from, '🛑 Proceso cancelado.');
  }

  // "PAGARE" permite reiniciar el flujo también
  if (/^pagare$/i.test(text)) {
    delete DRAFTS[from];
    SESS[from] = { idx: 0, data: baseData(), mode: 'capture', summaryFromFinal: false };
    const firstStep = STEPS[0];
    const q = firstStep && firstStep.q ? firstStep.q : renderMainMenu();
    return client.sendMessage(from, q);
  }

  // --- Flujo en curso ---
  const flow = SESS[from];
  if (!flow) return;
  const data = flow.data;

  // Helper to send a block summary with its menu
  async function sendBlockSummary(block) {
    let summary = '';
    if (block === 'A') summary = resumenBloqueA(data);
    if (block === 'B') summary = resumenBloqueB(data);
    if (block === 'C') summary = resumenBloqueC(data);
    let menuMsg =
      '¿Qué deseas hacer?\n' +
      '1️⃣➡️ Continuar\n' +
      '2️⃣✏️ Editar un dato\n' +
      '3️⃣🛠️ Editar todo el bloque\n' +
      '4️⃣❌ Cancelar';
    await client.sendMessage(from, summary + '\n\n' + menuMsg);
  }

  // Helper to send the final summary with its menu
  async function sendFinalSummary() {
    const summary = resumenFinal(data);
    let menuMsg =
      '¿Cómo continuamos?\n' +
      '1️⃣🟢 Aprobar y generar documentos\n' +
      '2️⃣✏️ Corregir venta y pagos\n' +
      '3️⃣✏️ Corregir cliente y deudor\n' +
      '4️⃣✏️ Corregir predio y testigos\n' +
      '5️⃣🔎 Editar un solo dato\n' +
      '6️⃣❌ Cancelar';
    await client.sendMessage(from, summary + '\n\n' + menuMsg);
  }

  // Helper to format a value nicely for confirmation
  function formatValueForField(field, value) {
    if (value === null || value === undefined) return '';
    if (
      ['total', 'enganche', 'mensual', 'anualidadMonto'].includes(field)
    ) {
      return formatMoney(value);
    }
    if (['moratorios', 'interes'].includes(field)) {
      return `${value}%`;
    }
    return value.toString();
  }

  // Build a global edit menu based on current data and document type
  function buildGlobalMenu() {
    const items = [];
    const pushUnique = (key, label) => {
      if (!items.some((it) => it.key === key)) items.push({ key, label });
    };
    EDIT_MENUS.A.forEach((it) => pushUnique(it.key, it.label));
    EDIT_MENUS.B.forEach((it) => pushUnique(it.key, it.label));
    if (data.tipoDocumento !== 'pagares') {
      EDIT_MENUS.C.forEach((it) => pushUnique(it.key, it.label));
    }
    return items;
  }

  // Determine which parser to use for a given field name
  function parserForField(field) {
    const p = getParseForField(field);
    return p;
  }

  // Initialize mode if not present
  if (!flow.mode) {
    flow.mode = 'capture';
    flow.summaryFromFinal = false;
  }

  // Main state machine
  switch (flow.mode) {
    case 'capture': {
      const currentStep = STEPS[flow.idx];
      // If we are at the confirm step, jump to final summary
      if (currentStep.id === 'confirm') {
        flow.mode = 'final-summary';
        await sendFinalSummary();
        return;
      }
      // Process answer for current step
      if (currentStep.apply) {
        try {
          currentStep.apply(text, data);
        } catch (e) {
          return client.sendMessage(from, `⚠️ ${e.message}\n\n${currentStep.q}`);
        }
      } else if (currentStep.field) {
        try {
          if (currentStep.field === 'lugarPago') {
            const raw = text.trim().toLowerCase();
            if (['si', 'sí', 'si.', 'sí.'].includes(raw)) {
              data.lugarPago = data.lugarExpedicion;
            } else {
              data.lugarPago = text.trim();
            }
          } else if (currentStep.parse) {
            const val = runParser(text, currentStep.parse);
            data[currentStep.field] = val;
            if (currentStep.field === 'tipoDocumento') {
              data.tipoDocumento = val;
            }
            if (currentStep.field === 'enganche') {
              data.saldo = Number((data.total - data.enganche).toFixed(2));
            }
            if (currentStep.field === 'mensual') {
              const anualTotal = (data.anualidadMonto || 0) * (data.numeroAnualidades || 0);
              data.numeroPagares = Math.ceil((data.saldo - anualTotal) / data.mensual);
            }
            if (currentStep.field === '_tieneAnualidades') {
              data._tieneAnualidades = val === true;
            }
          } else {
            data[currentStep.field] = text.trim();
          }
        } catch (e) {
          return client.sendMessage(from, `⚠️ ${e.message}\n\n${currentStep.q}`);
        }
      }
      // Find next step index, skipping if needed
      let nextIdx = flow.idx + 1;
      while (nextIdx < STEPS.length) {
        const candidate = STEPS[nextIdx];
        let skip = false;
        if (data.tipoDocumento === 'pagares' && candidate.onlyContrato) {
          skip = true;
        }
        if (!data._tieneAnualidades && candidate.onlyAnualidad) {
          skip = true;
        }
        if (skip) {
          nextIdx++;
        } else {
          break;
        }
      }
      // If next is confirm, go to block summary first
      if (nextIdx < STEPS.length && STEPS[nextIdx].id === 'confirm') {
        const currentBlock = currentStep.block;
        flow.currentBlock = currentBlock;
        flow.nextIdxAfterSummary = nextIdx;
        flow.mode = 'block-summary';
        flow.summaryFromFinal = false;
        await sendBlockSummary(currentBlock);
        return;
      }
      // Check if block changes
      const currentBlock = currentStep.block;
      let endedBlock = false;
      if (nextIdx >= STEPS.length) {
        endedBlock = true;
      } else {
        const nextStep = STEPS[nextIdx];
        if (nextStep.block !== currentBlock) {
          endedBlock = true;
        }
      }
      if (endedBlock) {
        flow.currentBlock = currentBlock;
        flow.nextIdxAfterSummary = nextIdx;
        flow.mode = 'block-summary';
        flow.summaryFromFinal = false;
        await sendBlockSummary(currentBlock);
        return;
      }
      // Otherwise ask next step
      flow.idx = nextIdx;
      const nextStep = STEPS[nextIdx];
      await client.sendMessage(from, nextStep.q);
      return;
    }
    case 'block-summary': {
      const opt = text.trim();
      const block = flow.currentBlock;
      if (/^1$/.test(opt)) {
        // Continuar
        if (flow.summaryFromFinal) {
          flow.mode = 'final-summary';
          await sendFinalSummary();
          return;
        }
        const nextIdx = flow.nextIdxAfterSummary;
        if (nextIdx >= STEPS.length) {
          flow.mode = 'final-summary';
          await sendFinalSummary();
          return;
        }
        if (STEPS[nextIdx].id === 'confirm') {
          flow.mode = 'final-summary';
          await sendFinalSummary();
          return;
        }
        flow.idx = nextIdx;
        flow.mode = 'capture';
        const step = STEPS[flow.idx];
        await client.sendMessage(from, step.q);
        return;
      } else if (/^2$/.test(opt)) {
        flow.mode = 'edit-menu';
        const menu = EDIT_MENUS[block] || [];
        let msg = '✏️ ¿Qué dato deseas corregir?\n';
        for (let i = 0; i < menu.length; i++) {
          msg += `${i + 1}️⃣ ${menu[i].label}\n`;
        }
        msg += `0️⃣↩️ Regresar`;
        await client.sendMessage(from, msg.trim());
        return;
      } else if (/^3$/.test(opt)) {
        flow.mode = 'capture';
        flow.idx = firstIndexOfBlock(block);
        const step = STEPS[flow.idx];
        await client.sendMessage(from, step.q);
        return;
      } else if (/^4$/.test(opt)) {
        delete SESS[from];
        delete DRAFTS[from];
        await client.sendMessage(from, '🛑 Proceso cancelado.');
        return;
      } else {
        await client.sendMessage(from, 'Selecciona una opción válida (1, 2, 3 o 4).');
        return;
      }
    }
    case 'edit-menu': {
      const opt = text.trim();
      const block = flow.currentBlock;
      let menu = null;
      if (block === 'GLOBAL') {
        menu = buildGlobalMenu();
      } else {
        menu = EDIT_MENUS[block] || [];
      }
      const choice = parseInt(opt, 10);
      if (isNaN(choice)) {
        await client.sendMessage(from, 'Selecciona un número válido.');
        return;
      }
      if (choice === 0 || choice < 0 || choice > menu.length) {
        if (flow.summaryFromFinal) {
          if (block === 'GLOBAL') {
            flow.mode = 'final-summary';
            await sendFinalSummary();
            return;
          }
          flow.mode = 'block-summary';
          await sendBlockSummary(block);
          return;
        } else {
          flow.mode = 'block-summary';
          await sendBlockSummary(block);
          return;
        }
      }
      const item = menu[choice - 1];
      if (!item) {
        await client.sendMessage(from, 'Selecciona una opción válida.');
        return;
      }
      flow.editField = item.key;
      flow.editLabel = item.label;
      flow.pendingValue = null;
      flow.mode = 'edit-value';
      let stepQ = null;
      for (const st of STEPS) {
        if (st.field === flow.editField) {
          stepQ = st.q;
          break;
        }
      }
      const currentVal = data[flow.editField] != null ? data[flow.editField] : '';
      const prettyCurrent = formatValueForField(flow.editField, currentVal);
      const prompt = stepQ
        ? `${stepQ}\n\n(Valor actual: ${prettyCurrent})`
        : `Ingresa el nuevo valor para ${item.label}:\n\n(Valor actual: ${prettyCurrent})`;
      await client.sendMessage(from, prompt);
      return;
    }
    case 'edit-value': {
      const field = flow.editField;
      let newVal;
      try {
        if (field === 'lugarPago') {
          const raw = text.trim().toLowerCase();
          if (['si', 'sí', 'si.', 'sí.'].includes(raw)) {
            newVal = data.lugarExpedicion;
          } else {
            newVal = text.trim();
          }
        } else {
          const parserName = parserForField(field);
          if (parserName) {
            newVal = runParser(text, parserName);
          } else {
            newVal = text.trim();
          }
        }
      } catch (e) {
        await client.sendMessage(from, `⚠️ ${e.message}\n\nIntenta de nuevo.`);
        return;
      }
      flow.pendingValue = newVal;
      flow.mode = 'edit-confirm';
      const prettyNew = formatValueForField(field, newVal);
      const labelClean = flow.editLabel.replace(/^\d+️⃣ /, '');
      await client.sendMessage(
        from,
        `¿Confirmas que ${labelClean} es ${prettyNew}?\n1️⃣✔️ Sí\n2️⃣↩️ No`
      );
      return;
    }
    case 'edit-confirm': {
      const opt = text.trim();
      if (/^1$/.test(opt)) {
        const field = flow.editField;
        data[field] = flow.pendingValue;
        if (
          ['total', 'enganche', 'mensual', 'anualidadMonto', 'numeroAnualidades'].includes(
            field
          )
        ) {
          recalcPagos(data);
        }
        flow.editField = null;
        flow.editLabel = null;
        flow.pendingValue = null;
        if (flow.summaryFromFinal) {
          if (flow.currentBlock === 'GLOBAL') {
            flow.mode = 'final-summary';
            await sendFinalSummary();
            return;
          } else {
            flow.mode = 'block-summary';
            await sendBlockSummary(flow.currentBlock);
            return;
          }
        } else {
          flow.mode = 'block-summary';
          await sendBlockSummary(flow.currentBlock);
          return;
        }
      } else if (/^2$/.test(opt)) {
        flow.mode = 'edit-value';
        let stepQ = null;
        for (const st of STEPS) {
          if (st.field === flow.editField) {
            stepQ = st.q;
            break;
          }
        }
        const currentVal = data[flow.editField] != null ? data[flow.editField] : '';
        const prettyCurrent = formatValueForField(flow.editField, currentVal);
        const prompt = stepQ
          ? `${stepQ}\n\n(Valor actual: ${prettyCurrent})`
          : `Ingresa el nuevo valor para ${flow.editLabel}:\n\n(Valor actual: ${prettyCurrent})`;
        await client.sendMessage(from, prompt);
        return;
      } else {
        await client.sendMessage(from, 'Selecciona 1 para sí o 2 para no.');
        return;
      }
    }
    case 'final-summary': {
      const opt = text.trim();
      if (/^1$/.test(opt)) {
        await client.sendMessage(from, '⏳ Generando documentos legales...');
        const tipo = (data.tipoDocumento || 'pagares').toLowerCase();
        try {
          let loteResult = null;
          if (tipo === 'pagares' || tipo === 'ambos') {
            loteResult = await generarLoteYMeta(data);
            if (loteResult && loteResult.lotePath) {
              try {
                // Registrar en consola la ruta del PDF y el caption antes de enviarlo
                console.log(`\n[BOT->${from}] [PDF] ${loteResult.lotePath} — 📄 Aquí está el lote completo de pagarés.\n`);
                const media = MessageMedia.fromFilePath(loteResult.lotePath);
                await client.sendMessage(from, media, {
                  caption: '📄 Aquí está el lote completo de pagarés.'
                });
              } catch (e) {
                console.error('Error enviando lote de pagarés:', e);
              }
            }
          }
          if (tipo === 'contrato' || tipo === 'ambos') {
            const contratoResult = await generarContrato(data);
            if (contratoResult && contratoResult.pdfPath) {
              try {
                // Registrar en consola la ruta del PDF y el caption antes de enviarlo
                console.log(`\n[BOT->${from}] [PDF] ${contratoResult.pdfPath} — 📄 Aquí está el contrato.\n`);
                const media = MessageMedia.fromFilePath(contratoResult.pdfPath);
                await client.sendMessage(from, media, {
                  caption: '📄 Aquí está el contrato.'
                });
              } catch (e) {
                console.error('Error enviando contrato:', e);
              }
            }
          }
          await client.sendMessage(
            from,
            '➡️ Proceso finalizado. Escribe *MENU* para iniciar otro.'
          );
          delete SESS[from];
          delete DRAFTS[from];
          return;
        } catch (err) {
          console.error(err);
          return client.sendMessage(from, `❌ Error generando documentos: ${err.message}`);
        }
      } else if (/^2$/.test(opt)) {
        flow.currentBlock = 'A';
        flow.summaryFromFinal = true;
        flow.mode = 'block-summary';
        await sendBlockSummary('A');
        return;
      } else if (/^3$/.test(opt)) {
        flow.currentBlock = 'B';
        flow.summaryFromFinal = true;
        flow.mode = 'block-summary';
        await sendBlockSummary('B');
        return;
      } else if (/^4$/.test(opt)) {
        flow.currentBlock = 'C';
        flow.summaryFromFinal = true;
        flow.mode = 'block-summary';
        await sendBlockSummary('C');
        return;
      } else if (/^5$/.test(opt)) {flow.currentBlock = 'GLOBAL';
      flow.summaryFromFinal = true;
      flow.mode = 'edit-menu';
      const menu = buildGlobalMenu();
      let msg = '✏️ ¿Qué dato deseas corregir?\n';
      for (let i = 0; i < menu.length; i++) {
        msg += `${i + 1}️⃣ ${menu[i].label}\n`;
      }
      msg += `0️⃣↩️ Regresar`;
      await client.sendMessage(from, msg.trim());
      return;
    } else if (/^6$/.test(opt)) {
      delete SESS[from];
      delete DRAFTS[from];
      await client.sendMessage(from, '🛑 Proceso cancelado.');
      return;
    } else {
      await client.sendMessage(
        from,
        'Selecciona una opción del 1 al 6.'
      );
      return;
    }
  }
  default: {
    delete SESS[from];
    delete DRAFTS[from];
    await client.sendMessage(from, 'Se produjo un error interno. Escribe MENU para iniciar.');
    return;
  }
}
}

module.exports = { handleMessage };