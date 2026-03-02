const DataService = require("./DataService");
const { toNumberSmart } = require("../utils/helpers");

class SummaryService {

    /**
     * Construye un resumen enriquecido a partir del dataset completo.
     * @param {Array} rows - Conjunto de datos completo
     * @returns {Object} Objeto de resumen enriquecido
     */
    buildRichSummary(rows) {
        if (!rows || rows.length === 0) return { error: "No data" };

        const summary = {
            rowCount: rows.length,
            generatedAt: new Date().toISOString()
        };

        // 1. Detección de Columnas
        const firstRow = rows[0];
        summary.columns = Object.keys(firstRow);

        // 2. Estadísticas Numéricas (SUMA_NETA / COL_8)
        // Detectar columna numérica: preferir SUMA_NETA, respaldo a COL_8
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

        // 3. Rango de Fechas (FECHA)
        const dateCol = summary.columns.find(c => c.includes("FECHA"));
        if (dateCol) {
            let minDate = null, maxDate = null;
            rows.forEach(r => {
                const d = r[dateCol];
                if (d) { // Una simple comparación de strings funciona para ISO/YYYYMMDD, rústico para otros pero rápido
                    if (!minDate || d < minDate) minDate = d;
                    if (!maxDate || d > maxDate) maxDate = d;
                }
            });
            summary.dateRange = { column: dateCol, min: minDate, max: maxDate };
        }

        // 4. Desgloses Categóricos (Top 20)
        // Función auxiliar para obtener el Top N
        const getTop = (col, n = 20) => {
            if (!firstRow[col]) return null;
            const counts = DataService.countBy(rows, col);
            return DataService.topN(counts, n);
        };

        summary.topCentros = getTop("ID_CENTRO");
        summary.topMovimientos = getTop("CLASE_MOVIMIENTO");
        summary.topMateriales = getTop("MATERIAL1");
        summary.topGrupos = getTop("GRUPO_ARTICULOS");

        // 5. Muestreo Inteligente (Enfoque estratificado)
        // Seleccionar filas distribuidas por todo el dataset para obtener variedad
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
