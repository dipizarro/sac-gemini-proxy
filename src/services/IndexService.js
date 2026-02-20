const { normalizeHeader } = require("../utils/helpers");

class IndexService {

    /**
     * Builds an index mapping dates to a Set of distinct centers.
     * @param {Array} rows - Full dataset
     * @returns {Map<string, Set<string>>} Map<DateString, Set<CenterID>>
     */
    buildIndexes(rows) {
        // Map<DateKey, Set<CenterID>>
        const centersByDate = new Map();

        if (!rows || rows.length === 0) return { centersByDate };

        // Auto-detect columns
        const firstRow = rows[0];
        const cols = Object.keys(firstRow);

        // Find Date Column (prefer FECHA, fallback to anything with 'FECHA' or 'DATE')
        const dateCol = cols.find(c => c === "FECHA") || cols.find(c => c.includes("FECHA")) || cols.find(c => c.includes("DATE"));

        // Find Center Column (ID_CENTRO, CENTRO, PLANT, WERKS)
        const centerCol = cols.find(c => c === "ID_CENTRO") || cols.find(c => c.includes("CENTRO")) || cols.find(c => c.includes("PLANT"));

        if (!dateCol || !centerCol) {
            console.warn("IndexService: Could not detect required columns (Date/Center). Indexing skipped.");
            return { centersByDate };
        }

        console.log(`IndexService: Building index on Date='${dateCol}', Center='${centerCol}'...`);

        rows.forEach(row => {
            const rawDate = row[dateCol];
            const center = row[centerCol];

            if (!rawDate || !center) return;

            const dateKey = this.normalizeDate(rawDate);
            if (!dateKey) return; // Skip invalid dates

            if (!centersByDate.has(dateKey)) {
                centersByDate.set(dateKey, new Set());
            }
            centersByDate.get(dateKey).add(center);
        });

        console.log(`IndexService: Built index for ${centersByDate.size} dates.`);
        return { centersByDate };
    }

    /**
     * Normalizes various date formats to YYYY-MM-DD
     */
    normalizeDate(raw) {
        if (!raw) return null;
        const str = raw.toString().trim();

        // 1. YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

        // 2. DD/MM/YYYY
        // 3. DD-MM-YYYY
        const ddmmyyyy = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
        if (ddmmyyyy) {
            const [_, d, m, y] = ddmmyyyy;
            return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }

        // 4. YYYYMMDD
        if (/^\d{8}$/.test(str)) {
            return `${str.substring(0, 4)}-${str.substring(4, 6)}-${str.substring(6, 8)}`;
        }

        return null; // Unknown format
    }
}

module.exports = new IndexService();
