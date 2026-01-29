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