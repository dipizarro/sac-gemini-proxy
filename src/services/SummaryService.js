const DataService = require("./DataService");
const { toNumberSmart } = require("../utils/helpers");

class SummaryService {

    /**
     * Builds a rich summary from the full dataset.
     * @param {Array} rows - Full dataset
     * @returns {Object} Rich summary object
     */
    buildRichSummary(rows) {
        if (!rows || rows.length === 0) return { error: "No data" };

        const summary = {
            rowCount: rows.length,
            generatedAt: new Date().toISOString()
        };

        // 1. Column Detection
        const firstRow = rows[0];
        summary.columns = Object.keys(firstRow);

        // 2. Numeric Stats (SUMA_NETA / COL_8)
        // Detect numeric column: prefer SUMA_NETA, fallback to COL_8
        const numCol = summary.columns.find(c => c.includes("SUMA_NETA")) || "COL_8";
        if (numCol && firstRow[numCol] !== undefined) {
            let min = Infinity, max = -Infinity, sum = 0, count = 0;
            const values = [];

            rows.forEach(r => {
                const val = toNumberSmart(r[numCol]);
                if (!isNaN(val)) {
                    if (val < min) min = val;
                    if (val > max) max = val;
                    sum += val;
                    values.push(val);
                    count++;
                }
            });

            if (count > 0) {
                values.sort((a, b) => a - b);
                summary.numericStats = {
                    column: numCol,
                    min,
                    max,
                    sum: Math.round(sum * 100) / 100,
                    avg: Math.round((sum / count) * 100) / 100,
                    p50: values[Math.floor(count * 0.5)],
                    p90: values[Math.floor(count * 0.9)]
                };
            }
        }

        // 3. Date Range (FECHA)
        const dateCol = summary.columns.find(c => c.includes("FECHA"));
        if (dateCol) {
            let minDate = null, maxDate = null;
            rows.forEach(r => {
                const d = r[dateCol];
                if (d) { // Simple string comparison works for ISO/YYYYMMDD, crude for others but fast
                    if (!minDate || d < minDate) minDate = d;
                    if (!maxDate || d > maxDate) maxDate = d;
                }
            });
            summary.dateRange = { column: dateCol, min: minDate, max: maxDate };
        }

        // 4. Categorical Breakdowns (Top 20)
        // Helper to get top N
        const getTop = (col, n = 20) => {
            if (!firstRow[col]) return null;
            const counts = DataService.countBy(rows, col);
            return DataService.topN(counts, n);
        };

        summary.topCentros = getTop("ID_CENTRO");
        summary.topMovimientos = getTop("CLASE_MOVIMIENTO");
        summary.topMateriales = getTop("MATERIAL1");
        summary.topGrupos = getTop("GRUPO_ARTICULOS");

        // 5. Smart Sampling (Stratified-ish)
        // Pick rows distributed across the dataset to get variety
        const sampleSize = 30;
        const step = Math.max(1, Math.floor(rows.length / sampleSize));
        summary.sampleRows = [];
        for (let i = 0; i < rows.length && summary.sampleRows.length < sampleSize; i += step) {
            summary.sampleRows.push(rows[i]);
        }

        return summary;
    }
}

module.exports = new SummaryService();
