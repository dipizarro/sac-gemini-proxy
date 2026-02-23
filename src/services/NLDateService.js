class NLDateService {
    /**
     * Extrae un rango de fechas desde texto en español.
     * Soporta formatos como:
     * - "entre el 1 y el 7 de enero del 2024"
     * - "del 1 al 7 de enero 2024"
     * - "entre 01/01/2024 y 07/01/2024"
     * - "entre 2024-01-01 y 2024-01-07"
     * Retorna { from: "YYYY-MM-DD", to: "YYYY-MM-DD" } o null si no encuentra un rango válido.
     */
    extractDateRangeEs(text) {
        if (!text) return null;

        // Normalizar texto: minúsculas, remover tildes
        const normalized = text.toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");

        return this._parseExplicitRange(normalized) || this._parseNaturalLanguageRange(normalized);
    }

    _parseExplicitRange(text) {
        // Busca formatos como "entre 2024-01-01 y 2024-01-07" o "del 01/01/2024 al 07/01/2024"
        // Regex para YYYY-MM-DD o DD/MM/YYYY
        const dateRegex = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/g;
        const matches = [...text.matchAll(dateRegex)].map(m => m[1]);

        if (matches.length >= 2) {
            const d1 = this._standardizeDateString(matches[0]);
            const d2 = this._standardizeDateString(matches[1]);
            if (d1 && d2) {
                return this._buildSortedRange(d1, d2);
            }
        }
        return null;
    }

    _parseNaturalLanguageRange(text) {
        // Palabras clave de inicio de rango
        if (!text.includes("entre") && !text.includes("del") && !text.includes("desde")) return null;

        // Intentar atrapar: "del [d1] al [d2] de [mes] [año?]" o "entre el [d1] y el [d2] de [mes] [año?]"
        const rangeRegex = /(?:entre|del|desde)\s+(?:el\s+)?(\d{1,2})\s+(?:y|al|hasta)\s+(?:el\s+)?(\d{1,2})\s+de\s+([a-z]+)(?:\s+(?:de|del)?\s*(\d{4}))?/i;
        const match = text.match(rangeRegex);

        if (match) {
            const day1 = match[1];
            const day2 = match[2];
            const monthStr = match[3];
            const yearStr = match[4] || new Date().getFullYear().toString();

            const monthMap = {
                "enero": "01", "febrero": "02", "marzo": "03", "abril": "04",
                "mayo": "05", "junio": "06", "julio": "07", "agosto": "08",
                "septiembre": "09", "setiembre": "09", "octubre": "10",
                "noviembre": "11", "diciembre": "12"
            };

            const month = monthMap[monthStr];
            if (month) {
                const yyyy = yearStr.length === 2 ? "20" + yearStr : yearStr;
                const d1 = `${yyyy}-${month}-${day1.padStart(2, '0')}`;
                const d2 = `${yyyy}-${month}-${day2.padStart(2, '0')}`;
                return this._buildSortedRange(d1, d2);
            }
        }
        return null;
    }

    _standardizeDateString(dateStr) {
        // Si es YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

        // Si es DD/MM/YYYY
        const parts = dateStr.split("/");
        if (parts.length === 3) {
            const [d, m, y] = parts;
            return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }
        return null;
    }

    _buildSortedRange(date1, date2) {
        // Asegurar from <= to
        if (date1 > date2) {
            return { from: date2, to: date1 };
        }
        return { from: date1, to: date2 };
    }
}

module.exports = new NLDateService();
