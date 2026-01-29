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