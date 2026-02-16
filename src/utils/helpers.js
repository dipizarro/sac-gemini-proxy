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
    if (x == null) return 0;
    const s = String(x).trim().replace(/"/g, "");

    // Caso 1: "335,540" (coma decimal / miles)
    // Caso 2: "1.234.567" (puntos miles)
    // Caso 3: "1234.56"
    // Estrategia simple: quitamos puntos miles, y convertimos coma a punto si no hay punto decimal.
    const noDots = s.replace(/\./g, "");
    const normalized = noDots.includes(",") ? noDots.replace(",", ".") : noDots;

    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
}

module.exports = {
    normalizeHeader,
    toNumberSmart,
};
