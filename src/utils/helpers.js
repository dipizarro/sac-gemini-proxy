function normalizeHeader(h, i) {
    const s = (h || "").trim();
    if (!s) return `COL_${i}`; // para headers vacíos por ,, o coma final
    return s
        .replace(/\s+/g, "_") // "ID CENTRO" -> "ID_CENTRO"
        .replace(/[^\w]/g, "_") // limpia caracteres raros
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
}

function toNumberSmart(x) {
    if (x == null || x === "") return 0;
    let s = String(x).trim().replace(/"/g, "");

    // Contar comas y puntos
    const commaCount = (s.match(/,/g) || []).length;
    const dotCount = (s.match(/\./g) || []).length;

    // Si tiene comas para miles y punto para decimal (ej. 1,907,753.50 o 1,907,753)
    if (commaCount > 0 && dotCount <= 1) {
        const lastComma = s.lastIndexOf(',');
        const lastDot = s.lastIndexOf('.');
        if (lastDot === -1 || lastDot > lastComma) {
            // Las comas son miles, las removemos (formato gringo/sistemas)
            s = s.replace(/,/g, '');
        } else if (lastComma > lastDot) {
            // El punto son miles, la coma es decimal (1.907.753,50)
            s = s.replace(/\./g, '').replace(',', '.');
        }
    } else if (dotCount > 1) {
        // Formato europeo puro ej 1.907.753
        s = s.replace(/\./g, '').replace(',', '.');
    } else if (commaCount === 1 && dotCount === 0) {
        // Podría ser 1,50 (uno coma cincuenta) o 1,907 (mil novecientos siete).
        const parts = s.split(',');
        if (parts[1].length === 3) {
            // "1,907" -> asumimos miles por convención regular de exportes largos
            s = s.replace(',', '');
        } else {
            // Decimal
            s = s.replace(',', '.');
        }
    }

    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
}

module.exports = {
    normalizeHeader,
    toNumberSmart,
};
