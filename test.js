// test.js – usa SOLO los logs del core

const { handleMessage } = require('./src/core/index');

const mockClient = {
  sendMessage: (to, content, options) => {
    // No logueamos nada aquí, dejamos que el core (index.js)
    // sea el único que escriba en consola.
    return Promise.resolve();
  }
};

const msgs = [
  { from: 'test', body: 'Menu' },
  { from: 'test', body: '3' },
  { from: 'test', body: 'Hoy' },
  { from: 'test', body: '250000' },
  { from: 'test', body: '30000' },
  { from: 'test', body: '13000' },
  { from: 'test', body: 'no' },
  { from: 'test', body: 'siguiente mes' },
  { from: 'test', body: '1' }, // moratorios
  { from: 'test', body: '1' }, // interés anual
  { from: 'test', body: '1' }, // continuar bloque A

  // Bloque B
  { from: 'test', body: 'Israel Reséndiz Ruiz' },
  { from: 'test', body: 'Spike Spiegel Torres' },
  { from: 'test', body: '1' },
  { from: 'test', body: 'Av imaginación 516 Barrio Calayuco' },
  { from: 'test', body: 'Juchitepec Edo. Mex. C.P. 56860' },
  { from: 'test', body: 'Amecameca Edo. Mex.' },
  { from: 'test', body: 'si' },
  { from: 'test', body: '5512345678' },
  { from: 'test', body: '1' },

  // Bloque C
  { from: 'test', body: 'La mina' },
  { from: 'test', body: 'Viaducto M. Alemán 251 int 1 col del valle c.p. 06000' },
  { from: 'test', body: 'Juchitepec Edo. Mex.' },
  { from: 'test', body: 'Manzana 66 lote 6' },
  { from: 'test', body: '600' },
  { from: 'test', body: '15 calle roja' },
  { from: 'test', body: '20 calle verde' },
  { from: 'test', body: '15 calle azul' },
  { from: 'test', body: '15 calle negro' },
  { from: 'test', body: 'Tom Cruise / Seth MacFarlane' },
  { from: 'test', body: '1' },

  // Aprobar resumen final
  { from: 'test', body: '1' }
];

let idx = 0;

function next() {
  if (idx >= msgs.length) {
    console.log('\n✅ Flujo de prueba terminado.\n');
    return;
  }

  const m = msgs[idx++];

  // ❗ YA NO IMPRIME DOBLE: SOLO UNA VEZ
  console.log(`\n[USER->${m.from}] ${m.body}`);

  Promise.resolve(handleMessage(mockClient, m))
    .then(() => setTimeout(next, 200))
    .catch(err => console.error('❌ Error en handleMessage:', err));
}

next();
