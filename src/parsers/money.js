function parseMoneyLoose(txt) {
    let s = String(txt).toLowerCase().trim();
    s = s.replace(/\s+/g, ' ');
    const hasK = /\bk\b/.test(s);
    const hasMil = /\bmil\b/.test(s);
    
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