const IndexService = require("./IndexService");
const { toNumberSmart } = require("../utils/helpers");

class QueryEngineService {
    /**
     * Reuses indexing logic to efficiently find distinct centers by date.
     * @param {Array} rows - Full dataset
     * @param {string} dateKey - YYYY-MM-DD
     */
    countDistinctCentersByDate(rows, dateKey) {
        if (!rows || rows.length === 0) {
            return { date: dateKey, distinctCenters: 0, sampleCenters: [] };
        }

        // Build a temporary index or use a direct filter
        // Since we want to be "Engine-like" and exact:
        const index = IndexService.buildIndexes(rows);
        const centersSet = index.centersByDate.get(dateKey);

        if (!centersSet) {
            return {
                date: dateKey,
                distinctCenters: 0,
                sampleCenters: []
            };
        }

        const distinctCenters = centersSet.size;
        const sampleCenters = Array.from(centersSet).slice(0, 10);

        return {
            date: dateKey,
            distinctCenters,
            sampleCenters
        };
    }

    /**
     * Devuelve la suma exacta de SUMA_NETA, cantidad de centros distintos, y top N centros
     * filtrado exclusivamente por FECHA y GRUPO_ARTICULOS.
     */
    sumSumaNetaByGroupAndDate(rows, dateKey, group, opts = {}) {
        const breakdownByCenter = opts.breakdownByCenter !== false; // Default true
        const topN = opts.top || 10;

        let totalSumaNeta = 0;
        const centersSet = new Set();
        const centerSumaCounts = new Map();
        let rowsMatched = 0;

        if (!rows || rows.length === 0 || !dateKey || !group) {
            return {
                date: dateKey,
                group,
                totalSumaNeta: 0,
                distinctCenters: 0,
                topCenters: [],
                totals: { rowsMatched: 0 }
            };
        }

        const cols = Object.keys(rows[0]);
        const dateCol = cols.find(c => c === "FECHA" || c === "FE_REGISTRO") || cols[0];
        const centerCol = cols.find(c => c === "CENTRO" || c === "ID_CENTRO") || cols[1];
        const groupCol = cols.find(c => c.includes("GRUPO_ARTICULO"));
        const metricKey = cols.find(c => c === "SUMA_NETA") || cols.find(c => c.includes("NETA") || c.includes("SUMA"));

        if (!groupCol || !metricKey) {
            return {
                error: "Faltan columnas core (Grupo Artículo o Suma Neta)",
                date: dateKey,
                group,
                totalSumaNeta: 0,
                distinctCenters: 0,
                topCenters: [],
                totals: { rowsMatched: 0 }
            };
        }

        const targetGroup = group.trim().toUpperCase();

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rawDate = row[dateCol];
            const normDate = IndexService.normalizeDate(rawDate);

            if (normDate === dateKey) {
                const rowGroup = (row[groupCol] || "").trim().toUpperCase();
                // Match fuzzy/exact del grupo
                if (rowGroup.includes(targetGroup) || targetGroup.includes(rowGroup)) {
                    rowsMatched++;

                    const center = row[centerCol];
                    const val = toNumberSmart(row[metricKey]);

                    totalSumaNeta += val;

                    if (center) {
                        centersSet.add(center);
                        if (breakdownByCenter) {
                            centerSumaCounts.set(center, (centerSumaCounts.get(center) || 0) + val);
                        }
                    }
                }
            }
        }

        let topCenters = [];
        if (breakdownByCenter) {
            // Sort map by numeric descending value
            topCenters = Array.from(centerSumaCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, topN)
                .map(([center, sumaNeta]) => ({ center, sumaNeta }));
        }

        return {
            date: dateKey,
            group: targetGroup,
            totalSumaNeta,
            distinctCenters: centersSet.size,
            topCenters,
            totals: { rowsMatched }
        };
    }
    countMovementsByDate(rows, dateKey) {
        if (!rows || rows.length === 0) {
            return { date: dateKey, movements: 0, evidence: { sampleRows: [] } };
        }

        // Auto-detect columns (re-using logic similar to IndexService)
        const firstRow = rows[0];
        const cols = Object.keys(firstRow);
        const dateCol = cols.find(c => c === "FECHA") || cols.find(c => c.includes("FECHA")) || cols.find(c => c.includes("DATE"));

        if (!dateCol) {
            console.warn("QueryEngineService: Could not detect date column for countMovementsByDate.");
            return { date: dateKey, movements: 0, evidence: { sampleRows: [] } };
        }

        const matchingRows = rows.filter(row => {
            const rawDate = row[dateCol];
            return IndexService.normalizeDate(rawDate) === dateKey;
        });

        const movements = matchingRows.length;
        const evidence = {};

        if (process.env.EVIDENCE_SAMPLE === "1") {
            evidence.sampleRows = matchingRows.slice(0, 5);

            // Optionally add sampleCenters if center column is detectable
            const centerCol = cols.find(c => c === "ID_CENTRO") || cols.find(c => c.includes("CENTRO")) || cols.find(c => c.includes("PLANT"));
            if (centerCol && movements > 0) {
                const centers = new Set(matchingRows.map(r => r[centerCol]));
                evidence.sampleCenters = Array.from(centers).slice(0, 10);
            }
        }

        return {
            date: dateKey,
            movements,
            evidence
        };
    }

    /**
     * Devuelve el top N de centros con mayor número de movimientos en una fecha dada.
     * @param {Array} rows - Full dataset
     * @param {string} dateKey - YYYY-MM-DD
     * @param {number} topN - Cantidad de resultados deseada (def: 5)
     */
    topCentersByMovementsOnDate(rows, dateKey, topN = 5) {
        const defaultEmpty = { date: dateKey, topN, results: [], totals: { movements: 0, distinctCenters: 0 } };

        if (!rows || rows.length === 0) return defaultEmpty;

        // Auto-detect columns
        const firstRow = rows[0];
        const cols = Object.keys(firstRow);
        const dateCol = cols.find(c => c === "FECHA") || cols.find(c => c.includes("FECHA")) || cols.find(c => c.includes("DATE"));
        const centerCol = cols.find(c => c === "ID_CENTRO") || cols.find(c => c.includes("CENTRO")) || cols.find(c => c.includes("PLANT"));

        if (!dateCol || !centerCol) {
            console.warn("QueryEngineService: Could not detect date/center column for topCentersByMovementsOnDate.");
            return defaultEmpty;
        }

        // 1. Filtrar exactamente por fecha
        const matchingRows = rows.filter(row => {
            const rawDate = row[dateCol];
            return IndexService.normalizeDate(rawDate) === dateKey;
        });

        if (matchingRows.length === 0) return defaultEmpty;

        // 2. Contar movimientos por centro Map<centerId, count>
        const centerCounts = new Map();
        matchingRows.forEach(row => {
            const center = row[centerCol];
            if (!center) return;
            centerCounts.set(center, (centerCounts.get(center) || 0) + 1);
        });

        // 3. Ordenar descendentemente
        const sortedCenters = Array.from(centerCounts.entries())
            .sort((a, b) => b[1] - a[1]) // Mayor a menor
            .slice(0, topN)
            .map(([centerId, count]) => ({
                center: centerId,
                movements: count
            }));

        const response = {
            date: dateKey,
            topN,
            results: sortedCenters,
            totals: {
                movements: matchingRows.length,
                distinctCenters: centerCounts.size
            }
        };

        // 4. Agregar evidencia opcional si aplica
        if (process.env.EVIDENCE_SAMPLE === "1") {
            response.evidence = {
                sampleCenters: sortedCenters.map(s => s.center).slice(0, 10),
                sampleRows: matchingRows.slice(0, 5)
            };
        }

        return response;
    }

    /**
     * Devuelve la cantidad de centros distintos que tuvieron movimientos en un rango de fechas.
     * @param {Array} rows - Full dataset
     * @param {string} from - Fecha inicial YYYY-MM-DD
     * @param {string} to - Fecha final YYYY-MM-DD
     */
    countDistinctCentersByDateRange(rows, from, to) {
        const defaultEmpty = { from, to, distinctCenters: 0 };

        if (!rows || rows.length === 0 || !from || !to) return defaultEmpty;

        // Auto-detect columns
        const firstRow = rows[0];
        const cols = Object.keys(firstRow);
        const dateCol = cols.find(c => c === "FECHA") || cols.find(c => c.includes("FECHA")) || cols.find(c => c.includes("DATE"));
        const centerCol = cols.find(c => c === "ID_CENTRO") || cols.find(c => c.includes("CENTRO")) || cols.find(c => c.includes("PLANT"));

        if (!dateCol || !centerCol) {
            console.warn("QueryEngineService: Could not detect date/center column for countDistinctCentersByDateRange.");
            return defaultEmpty;
        }

        const distinctCentersSet = new Set();
        const sampleCentersSet = new Set();

        const isSampleEnabled = process.env.EVIDENCE_SAMPLE === "1";

        // Iterar las filas y filtrar por rango
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rawDate = row[dateCol];
            const dateKey = IndexService.normalizeDate(rawDate);

            // Check if date is within range (string comparison works for YYYY-MM-DD)
            if (dateKey >= from && dateKey <= to) {
                const center = row[centerCol];
                if (center) {
                    distinctCentersSet.add(center);
                    // Coleccionar muestra si es necesario
                    if (isSampleEnabled && sampleCentersSet.size < 10) {
                        sampleCentersSet.add(center);
                    }
                }
            }
        }

        const response = {
            from,
            to,
            distinctCenters: distinctCentersSet.size
        };

        if (isSampleEnabled) {
            response.evidence = {
                sampleCenters: Array.from(sampleCentersSet)
            };
        }

        return response;
    }
}

module.exports = new QueryEngineService();

