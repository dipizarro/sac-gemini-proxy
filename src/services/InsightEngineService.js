const IndexService = require("./IndexService");

class InsightEngineService {
    /**
     * Devuelve para cada mes del año: movements y distinctCenters.
     */
    activityByMonth(rows, year) {
        if (!rows || rows.length === 0) return { year, months: [] };

        const { dateCol, centerCol } = this._detectCols(rows);
        if (!dateCol || !centerCol) return { year, months: [] };

        const monthStats = new Map(); // month (1-12) -> { movements, distinctCentersSet }

        const yearStr = year.toString();

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rawDate = row[dateCol];
            const dateKey = IndexService.normalizeDate(rawDate); // "YYYY-MM-DD"

            if (dateKey.startsWith(yearStr)) {
                const center = row[centerCol];
                const month = parseInt(dateKey.substring(5, 7), 10);

                if (!monthStats.has(month)) {
                    monthStats.set(month, { movements: 0, centersSet: new Set() });
                }

                const stats = monthStats.get(month);
                stats.movements++;
                if (center) stats.centersSet.add(center);
            }
        }

        const monthsResult = [];
        for (let m = 1; m <= 12; m++) {
            if (monthStats.has(m)) {
                const st = monthStats.get(m);
                monthsResult.push({
                    month: m,
                    movements: st.movements,
                    distinctCenters: st.centersSet.size
                });
            } else {
                monthsResult.push({ month: m, movements: 0, distinctCenters: 0 });
            }
        }

        return { year, months: monthsResult };
    }

    /**
     * Compara dos meses en base a una métrica
     */
    compareMonths(rows, year, monthA, monthB, metric = "movements") {
        const activity = this.activityByMonth(rows, year);
        const statsA = activity.months.find(m => m.month === monthA) || { movements: 0, distinctCenters: 0 };
        const statsB = activity.months.find(m => m.month === monthB) || { movements: 0, distinctCenters: 0 };

        const valA = statsA[metric];
        const valB = statsB[metric];

        let winner = "Empate";
        if (valA > valB) winner = `Mes ${monthA}`;
        else if (valB > valA) winner = `Mes ${monthB}`;

        return {
            year,
            monthA,
            monthB,
            metric,
            aValue: valA,
            bValue: valB,
            winner
        };
    }

    /**
     * Extrae información y patrones para un trimestre (Q1-Q4) de un año
     */
    quarterPatterns(rows, year, quarter) {
        if (![1, 2, 3, 4].includes(quarter)) {
            return { error: "Trimestre inválido, debe ser 1, 2, 3 o 4" };
        }

        if (!rows || rows.length === 0) return { year, quarter, error: "No data" };
        const { dateCol, centerCol, movClassCol } = this._detectCols(rows);

        const startMonth = (quarter - 1) * 3 + 1;
        const endMonth = startMonth + 2;
        const yearStr = year.toString();

        let qMovements = 0;
        const qCentersSet = new Set();
        const dailyMovementCounts = new Map(); // dateKey -> count
        const dailyCentersSet = new Map(); // dateKey -> Set of centers
        const centerMovementCounts = new Map(); // centerId -> count
        const movClassCounts = new Map(); // movClass -> count

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rawDate = row[dateCol];
            const dateKey = IndexService.normalizeDate(rawDate);

            if (dateKey.startsWith(yearStr)) {
                const month = parseInt(dateKey.substring(5, 7), 10);
                if (month >= startMonth && month <= endMonth) {
                    qMovements++;
                    const center = row[centerCol];

                    if (center) {
                        qCentersSet.add(center);

                        // Center movements
                        centerMovementCounts.set(center, (centerMovementCounts.get(center) || 0) + 1);

                        // Daily centers
                        if (!dailyCentersSet.has(dateKey)) dailyCentersSet.set(dateKey, new Set());
                        dailyCentersSet.get(dateKey).add(center);
                    }

                    // Daily movements
                    dailyMovementCounts.set(dateKey, (dailyMovementCounts.get(dateKey) || 0) + 1);

                    // Mov class if available
                    if (movClassCol) {
                        const mClass = row[movClassCol];
                        if (mClass) movClassCounts.set(mClass, (movClassCounts.get(mClass) || 0) + 1);
                    }
                }
            }
        }

        const topCenters = this._topFromMap(centerMovementCounts, 10).map(t => ({ center: t.key, movements: t.val }));
        const topDaysMovs = this._topFromMap(dailyMovementCounts, 5).map(t => ({ date: t.key, movements: t.val }));

        const distinctCentersByDayMap = new Map();
        for (const [dKey, cSet] of dailyCentersSet.entries()) {
            distinctCentersByDayMap.set(dKey, cSet.size);
        }
        const topDaysCenters = this._topFromMap(distinctCentersByDayMap, 5).map(t => ({ date: t.key, distinctCenters: t.val }));

        const result = {
            year,
            quarter,
            monthsRange: [startMonth, endMonth],
            totals: {
                movements: qMovements,
                distinctCenters: qCentersSet.size
            },
            topCentersByMovements: topCenters,
            peakDaysByMovements: topDaysMovs,
            peakDaysByDistinctCenters: topDaysCenters
        };

        if (movClassCol) {
            result.topMovementClasses = this._topFromMap(movClassCounts, 10).map(t => ({ class: t.key, count: t.val }));
        }

        return result;
    }

    /**
     * Devuelve el día con mayor cantidad de centros activos en el año
     */
    maxActiveCentersDay(rows, year) {
        if (!rows || rows.length === 0) return { year, error: "No data" };
        const { dateCol, centerCol } = this._detectCols(rows);
        const yearStr = year.toString();

        const dailyCentersSet = new Map();

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rawDate = row[dateCol];
            const dateKey = IndexService.normalizeDate(rawDate);

            if (dateKey.startsWith(yearStr)) {
                const center = row[centerCol];
                if (center) {
                    if (!dailyCentersSet.has(dateKey)) dailyCentersSet.set(dateKey, new Set());
                    dailyCentersSet.get(dateKey).add(center);
                }
            }
        }

        const distinctCentersByDayMap = new Map();
        for (const [dKey, cSet] of dailyCentersSet.entries()) {
            distinctCentersByDayMap.set(dKey, cSet.size);
        }

        const topDates = this._topFromMap(distinctCentersByDayMap, 10).map(t => ({ date: t.key, distinctCenters: t.val }));

        if (topDates.length === 0) {
            return { year, maxActiveDay: null, distinctCenters: 0, topDates: [] };
        }

        return {
            year,
            date: topDates[0].date,
            distinctCenters: topDates[0].distinctCenters,
            topDates
        };
    }

    /**
     * Prioriza centros por movimientos en un año o en todo el set.
     */
    prioritizeCenters(rows, opts = {}) {
        if (!rows || rows.length === 0) return { error: "No data" };
        const { dateCol, centerCol } = this._detectCols(rows);

        const yearStr = opts.year ? opts.year.toString() : null;
        const centerCounts = new Map();

        let minDate = "9999-12-31";
        let maxDate = "0000-01-01";

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rawDate = row[dateCol];
            const dateKey = IndexService.normalizeDate(rawDate);

            if (!yearStr || dateKey.startsWith(yearStr)) {
                if (dateKey < minDate) minDate = dateKey;
                if (dateKey > maxDate) maxDate = dateKey;

                const center = row[centerCol];
                if (center) {
                    centerCounts.set(center, (centerCounts.get(center) || 0) + 1);
                }
            }
        }

        const results = this._topFromMap(centerCounts, 10).map(t => ({ center: t.key, movements: t.val }));

        return {
            from: minDate !== "9999-12-31" ? minDate : null,
            to: maxDate !== "0000-01-01" ? maxDate : null,
            distinctCentersTotal: centerCounts.size,
            results
        };
    }

    /**
     * Calcula la diferencia exacta de centros activos entre dos meses de un año
     */
    diffDistinctCentersMonths(rows, year, monthA, monthB) {
        if (!rows || rows.length === 0) return { error: "No data" };
        const { dateCol, centerCol } = this._detectCols(rows);

        const yearStr = year.toString();
        const centersA = new Set();
        const centersB = new Set();

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rawDate = row[dateCol];
            const dateKey = IndexService.normalizeDate(rawDate);

            if (dateKey.startsWith(yearStr)) {
                const month = parseInt(dateKey.substring(5, 7), 10);
                const center = row[centerCol];

                if (center) {
                    if (month === monthA) {
                        centersA.add(center);
                    } else if (month === monthB) {
                        centersB.add(center);
                    }
                }
            }
        }

        let onlyMonthA = 0;
        let onlyMonthB = 0;

        // Conteo Bonus Relativo
        centersA.forEach(c => {
            if (!centersB.has(c)) onlyMonthA++;
        });

        centersB.forEach(c => {
            if (!centersA.has(c)) onlyMonthB++;
        });

        return {
            year,
            monthA,
            monthB,
            distinctCentersA: centersA.size,
            distinctCentersB: centersB.size,
            diff: centersB.size - centersA.size,
            onlyMonthA,
            onlyMonthB
        };
    }

    /**
     * Calcula la suma de SUMA_NETA por mes y compara dos meses.
     */
    compareSumaNetaMonths(rows, year, monthA, monthB) {
        if (!rows || rows.length === 0) return { error: "No data" };
        const { dateCol, sumaNetaCol } = this._detectCols(rows);

        if (!sumaNetaCol) {
            return { error: "MISSING_METRIC_SUMANETA" };
        }

        const yearStr = year.toString();
        let sumA = 0;
        let sumB = 0;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rawDate = row[dateCol];
            const dateKey = IndexService.normalizeDate(rawDate);

            if (dateKey.startsWith(yearStr)) {
                const month = parseInt(dateKey.substring(5, 7), 10);

                if (month === monthA || month === monthB) {
                    const rawVal = row[sumaNetaCol];
                    // Asegurar casteo flotante seguro
                    let val = parseFloat(rawVal);
                    if (isNaN(val)) val = 0;

                    if (month === monthA) sumA += val;
                    else if (month === monthB) sumB += val;
                }
            }
        }

        let winner = "empate";
        if (sumA > sumB) winner = "Mes A";
        else if (sumB > sumA) winner = "Mes B";

        const diffAbs = Math.abs(sumB - sumA);
        const maxAbs = Math.max(Math.abs(sumA), Math.abs(sumB));

        let diffPct = 0;
        if (maxAbs > 0) {
            diffPct = (diffAbs / maxAbs) * 100;
        }

        return {
            year,
            monthA,
            monthB,
            sumA,
            sumB,
            winner,
            diffAbs,
            diffPct
        };
    }

    // --- Helpers Privados ---

    _detectCols(rows) {
        if (!rows || rows.length === 0) return {};
        const cols = Object.keys(rows[0]);
        const dateCol = cols.find(c => c === "FECHA") || cols.find(c => c.includes("FECHA")) || cols.find(c => c.includes("DATE"));
        const centerCol = cols.find(c => c === "ID_CENTRO") || cols.find(c => c.includes("CENTRO")) || cols.find(c => c.includes("PLANT"));
        const movClassCol = cols.find(c => c === "CLASE_MOVIMIENTO") || cols.find(c => c.includes("CLASE")) || cols.find(c => c.includes("MOV_TYPE") || c.includes("BWART"));
        const sumaNetaCol = cols.find(c => c === "SUMA_NETA") || cols.find(c => c.toUpperCase().includes("SUMA_NETA"));
        return { dateCol, centerCol, movClassCol, sumaNetaCol };
    }

    _topFromMap(map, n) {
        return Array.from(map.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, n)
            .map(([k, v]) => ({ key: k, val: v }));
    }
}

module.exports = new InsightEngineService();
