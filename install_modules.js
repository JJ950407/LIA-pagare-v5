const fs = require('fs');
const path = require('path');

// Definición de los archivos y su contenido
const files = {
  // ---------------------------------------------------------
  // 1. PARSERS
  // ---------------------------------------------------------
  'src/parsers/money.js': `
function parseMoneyLoose(txt) {
    let s = String(txt).toLowerCase().trim();
    s = s.replace(/\\s+/g, ' ');
    const hasK = /\\bk\\b/.test(s);
    const hasMil = /\\bmil\\b/.test(s);
    
    s = s.replace(/[^0-9.,-]/g, '');

    if (s.includes(',') && s.includes('.')) {
        s = s.replace(/,/g, ''); 
    } else if (s.includes(',')) {
        const parts = s.split(',');
        const lastPart = parts[parts.length - 1];
        if (lastPart.length === 3 && parts.length >= 2) {
            s = s.replace(/,/g, ''); 
        } else if (lastPart.length <= 2) {
            s = s.replace(',', '.'); 
        }
    }

    let n = Number(s || 0);
    if (!isFinite(n)) throw new Error('Monto inválido.');
    if (hasK || hasMil) n = n * 1000;
    
    return Number(n.toFixed(2));
}

module.exports = { parseMoneyLoose };
`,

  'src/parsers/date.js': `
const { addMonths, format, parse, isValid } = require('date-fns');
const { es } = require('date-fns/locale');

function parseDateDMYLoose(text) {
    let clean = text.trim().replace(/[^0-9/.-]/g, '');
    let date = parse(clean, 'dd/MM/yyyy', new Date());
    
    if (!isValid(date)) {
        date = parse(clean, 'dd-MM-yyyy', new Date());
    }

    if (!isValid(date)) {
        if (text.toLowerCase().includes('hoy')) return new Date();
        throw new Error('Formato de fecha inválido. Usa DD/MM/AAAA');
    }
    
    return date;
}

function addMonthsKeepBaseDay(dateObj, monthsToAdd, dayBase) {
    let newDate = addMonths(dateObj, monthsToAdd);
    if (dayBase) {
        newDate.setDate(Math.min(dayBase, new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0).getDate()));
    }
    return newDate;
}

function primera15o30(dateObj) {
    const day = dateObj.getDate();
    return day <= 15 ? "15" : "30";
}

module.exports = { parseDateDMYLoose, addMonthsKeepBaseDay, primera15o30 };
`,

  // ---------------------------------------------------------
  // 2. CALCULATORS
  // ---------------------------------------------------------
  'src/calculators/planPagos.js': `
const { format } = require('date-fns');
const { es } = require('date-fns/locale');
const { addMonthsKeepBaseDay } = require('../parsers/date');

function calcListaPagares(total, enganche, numPagos, fechaInicio, diaBase) {
    const saldo = total - enganche;
    const montoMensual = saldo / numPagos; 
    
    const lista = [];
    let fechaActual = new Date(fechaInicio);

    for (let i = 1; i <= numPagos; i++) {
        if (i > 1) { 
            fechaActual = addMonthsKeepBaseDay(new Date(fechaInicio), i - 1, diaBase);
        }

        lista.push({
            folio: i.toString().padStart(2, '0'),
            monto: Number(montoMensual.toFixed(2)),
            fecha_vencimiento: format(fechaActual, 'yyyy-MM-dd'),
            fecha_vencimiento_texto: format(fechaActual, "d 'de' MMMM 'de' yyyy", { locale: es }).toUpperCase(),
            tipo: "mensualidad"
        });
    }
    
    return lista;
}

module.exports = { calcListaPagares };
`,

  // ---------------------------------------------------------
  // 3. DB (MEMORY)
  // ---------------------------------------------------------
  'src/db/memory.js': `
const SESS = {};      
const DRAFTS = {};    
const LAST_MSG = {};  

module.exports = { SESS, DRAFTS, LAST_MSG };
`,

  // ---------------------------------------------------------
  // 4. STEPS (DEFINITIONS)
  // ---------------------------------------------------------
  'src/steps/definitions.js': `
const STEPS = [
  { id: 'ASK_TOTAL',    q: '¿Cuál es el precio TOTAL del lote? (Ej: 250k)', field: 'total' },
  { id: 'ASK_ENGANCHE', q: '¿Cuánto es el ENGANCHE?', field: 'enganche' },
  { id: 'ASK_PLAZO',    q: '¿A cuántos meses (mensualidades)?', field: 'mensualidades' },
  { id: 'ASK_FECHA',    q: '¿Fecha del primer pago? (dd/mm/aaaa)', field: 'fechaPrimerPago' },
  { id: 'ASK_CLIENTE',  q: 'Nombre completo del CLIENTE (Deudor):', field: 'nombreDeudor' },
  { id: 'ASK_DIRECCION',q: 'Dirección del CLIENTE:', field: 'direccionDeudor' },
  { id: 'ASK_POBLACION',q: 'Población/Municipio del CLIENTE:', field: 'poblacionDeudor' },
  { id: 'CONFIRM',      q: 'Datos capturados. Escribe *APROBAR* para generar o *CANCELAR* para salir.', field: null }
];

module.exports = { STEPS };
`,

  // ---------------------------------------------------------
  // 5. BOT PRINCIPAL
  // ---------------------------------------------------------
  'src/bot.js': `
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// --- MÓDULOS NUEVOS ---
const { parseMoneyLoose } = require('./parsers/money');
const { parseDateDMYLoose } = require('./parsers/date');
const { calcListaPagares } = require('./calculators/planPagos');
const { SESS, DRAFTS } = require('./db/memory');
const { STEPS } = require('./steps/definitions');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('Escanea el QR, por favor.');
});

client.on('ready', () => {
    console.log('LIA Pagare v3 (Modular) está listo.');
});

client.on('message', async msg => {
    const chat = await msg.getChat();
    const from = msg.from;
    const text = msg.body.trim();

    // 1. Comandos Globales
    if (text.toUpperCase() === 'PAGARE') {
        SESS[from] = { stepIdx: 0, active: true };
        DRAFTS[from] = {}; // Reiniciar borrador
        await chat.sendMessage(\`Hola. Iniciando generación de pagaré.\\n\\n\${STEPS[0].q}\`);
        return;
    }

    if (text.toUpperCase() === 'CANCELAR') {
        delete SESS[from];
        delete DRAFTS[from];
        await chat.sendMessage('Operación cancelada.');
        return;
    }

    // 2. Manejo del Flujo Activo
    if (SESS[from] && SESS[from].active) {
        const currentIdx = SESS[from].stepIdx;
        const currentStep = STEPS[currentIdx];

        if (currentStep && currentStep.field) {
            let val = text;
            try {
                if (['total', 'enganche'].includes(currentStep.field)) {
                    val = parseMoneyLoose(text);
                }
                if (currentStep.field === 'fechaPrimerPago') {
                    const dateObj = parseDateDMYLoose(text);
                    val = dateObj; 
                }
                DRAFTS[from][currentStep.field] = val;
            } catch (e) {
                await chat.sendMessage(\`Error: \${e.message}. Intenta de nuevo.\`);
                return; 
            }
        }

        const nextIdx = currentIdx + 1;
        
        if (nextIdx < STEPS.length) {
            SESS[from].stepIdx = nextIdx;
            const nextStep = STEPS[nextIdx];
            await chat.sendMessage(nextStep.q);
        } else {
            if (text.toUpperCase() === 'APROBAR') {
                await chat.sendMessage('Generando documentos... (Simulación)');
                console.log('Datos finales:', DRAFTS[from]);
                
                try {
                    const draft = DRAFTS[from];
                    const pagares = calcListaPagares(
                        draft.total, 
                        draft.enganche, 
                        parseInt(draft.mensualidades), 
                        draft.fechaPrimerPago, 
                        15 
                    );
                    await chat.sendMessage(\`Cálculo exitoso: \${pagares.length} pagarés generados en memoria.\`);
                } catch(err) {
                    console.error(err);
                    await chat.sendMessage('Error calculando tabla de pagos.');
                }

                delete SESS[from]; 
            } else {
                await chat.sendMessage('Confirma escribiendo *APROBAR* o escribe *CANCELAR*.');
            }
        }
    }
});

client.initialize();
`
};

// Función para crear los archivos
function createFiles() {
  console.log('🚀 Iniciando instalación de módulos...');
  
  for (const [filePath, content] of Object.entries(files)) {
    // Asegurar que el directorio existe
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📂 Directorio creado: ${dir}`);
    }

    // Escribir el archivo
    fs.writeFileSync(filePath, content.trim());
    console.log(`✅ Archivo creado: ${filePath}`);
  }

  console.log('\\n✨ Instalación completada. Ahora ejecuta: npm run dev');
}

createFiles();