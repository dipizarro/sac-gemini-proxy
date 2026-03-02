const fs = require('fs');
const DataService = require('../services/DataService');
const CacheService = require('../services/CacheService');

class CsvController {

    async getStatus(req, res, next) {
        try {
            const csvPath = DataService.csvPath;
            let fileStats = null;

            if (fs.existsSync(csvPath)) {
                const stats = fs.statSync(csvPath);
                fileStats = {
                    exists: true,
                    path: csvPath,
                    sizeBytes: stats.size,
                    mtime: stats.mtime
                };
            } else {
                fileStats = { exists: false, path: csvPath };
            }

            // Check Cache Status
            const cachedData = CacheService.get("MOVMAT_DATA");
            const cacheStatus = {
                loaded: !!cachedData,
                rows: cachedData ? cachedData.length : 0
            };

            res.json({
                file: fileStats,
                cache: cacheStatus
            });
        } catch (error) {
            next(error);
        }
    }

    async reload(req, res, next) {
        try {
            console.log("Reloading CSV from disk...");
            // Force load from disk
            const rows = DataService.loadMovMatCsv();

            // Update Cache (store indefinitely or long TTL, e.g. 24h)
            CacheService.set("MOVMAT_DATA", rows, 24 * 60 * 60 * 1000);

            // Invalidate Indexes
            const QueryService = require("../services/QueryService");
            QueryService.invalidateIndex();

            res.json({
                ok: true,
                message: "CSV reloaded and cached",
                rows: rows.length
            });
        } catch (error) {
            next(error);
        }
    }

    async getSummary(req, res, next) {
        try {
            let rows = CacheService.get("MOVMAT_DATA");

            if (!rows) {
                // Auto-load if not in cache
                console.log("CSV not in cache, loading...");
                rows = DataService.loadMovMatCsv();
                CacheService.set("MOVMAT_DATA", rows, 24 * 60 * 60 * 1000);
            }

            // Calculations
            // Asumimos COL_8 es métrica (suma neta) si existe, o usamos conteo
            const numericCol = "COL_8";

            // Top 5 Centros
            const sumByCentro = DataService.sumBy(rows, "ID_CENTRO", numericCol);
            const topCentros = DataService.topN(sumByCentro, 5);

            // Top 5 Movimientos
            const countByClase = DataService.countBy(rows, "CLASE_MOVIMIENTO");
            const topMovimientos = DataService.topN(countByClase, 5);

            res.json({
                ok: true,
                rowCount: rows.length,
                topCentros,     // Array of [key, value]
                topMovimientos  // Array of [key, value]
            });
        } catch (error) {
            next(error);
        }
    }

    async getProfile(req, res, next) {
        try {
            const profile = require("../utils/profile");
            const SummaryService = require("../services/SummaryService");

            // 1. Measure Load + Parse
            const t0 = profile.nowMs();
            const mem0 = profile.memMb();

            console.log("Profiling: Loading CSV...");
            // Force load to measure raw speed
            const rows = DataService.loadMovMatCsv();

            const t1 = profile.nowMs();
            const mem1 = profile.memMb();

            // 2. Measure Summary Build
            console.log("Profiling: Building Rich Summary...");
            const richSummary = SummaryService.buildRichSummary(rows);

            const t2 = profile.nowMs();
            const mem2 = profile.memMb();

            res.json({
                ok: true,
                rowCount: rows.length,
                timingsMs: {
                    loadParse: Math.round(t1 - t0),
                    buildSummary: Math.round(t2 - t1),
                    total: Math.round(t2 - t0)
                },
                memoryMb: {
                    before: mem0,
                    afterLoad: mem1,
                    afterSummary: mem2,
                    delta: Math.round((mem2 - mem0) * 100) / 100
                },
                summaryPreview: {
                    columns: richSummary.columns,
                    stats: richSummary.numericStats
                }
            });

        } catch (error) {
            next(error);
        }
    }

    async getDistinctCenters(req, res, next) {
        try {
            const date = req.query.date;
            if (!date) return res.status(400).json({ error: "Missing date param (YYYY-MM-DD)" });

            const QueryService = require("../services/QueryService");
            const result = QueryService.countDistinctCentersByDate(date);

            res.json({ ok: true, ...result });
        } catch (error) {
            next(error);
        }
    }

    // --- Métodos Migrados desde ChatController ---

    async getCsvPreview(req, res, next) {
        try {
            const rows = DataService.loadMovMatCsv();
            res.json({ count: rows.length, sample: rows.slice(0, 5) });
        } catch (err) {
            next(err);
        }
    }

    async getCsvMovementsByDate(req, res, next) {
        try {
            const { date } = req.query;
            if (!date) {
                return res.status(400).json({ ok: false, error: "Missing 'date' query parameter (YYYY-MM-DD)" });
            }

            const QueryEngineService = require("../services/QueryEngineService");
            const rows = await DataService.getRowsCached();
            const result = QueryEngineService.countMovementsByDate(rows, date);

            return res.json({
                ok: true,
                date: result.date,
                movements: result.movements
            });
        } catch (err) {
            next(err);
        }
    }

    async getCsvTopCentersByMovements(req, res, next) {
        try {
            const { date, top } = req.query;
            if (!date) {
                return res.status(400).json({ ok: false, error: "Missing 'date' query parameter (YYYY-MM-DD)" });
            }

            const topN = top ? parseInt(top, 10) : 5;
            const QueryEngineService = require("../services/QueryEngineService");
            const rows = await DataService.getRowsCached();
            const result = QueryEngineService.topCentersByMovementsOnDate(rows, date, topN);

            return res.json({
                ok: true,
                date: result.date,
                topCenters: result.results,
                distinctCentersTotal: result.totals.distinctCenters
            });
        } catch (err) {
            next(err);
        }
    }

    async getCsvSumaNetaByGroupAndDate(req, res, next) {
        try {
            const { date, group, top } = req.query;
            if (!date || !group) {
                return res.status(400).json({ ok: false, error: "Missing 'date' (YYYY-MM-DD) or 'group' query parameters" });
            }

            const topN = top ? parseInt(top, 10) : 10;
            const QueryEngineService = require("../services/QueryEngineService");
            const rows = await DataService.getRowsCached();
            const result = QueryEngineService.sumSumaNetaByGroupAndDate(rows, date, group, { top: topN });

            if (result.error) {
                return res.status(400).json({ ok: false, error: result.error });
            }

            return res.json({
                ok: true,
                date: result.date,
                group: result.group,
                totalSumaNeta: result.totalSumaNeta,
                distinctCenters: result.distinctCenters,
                topCenters: result.topCenters
            });
        } catch (err) {
            next(err);
        }
    }

    async getCsvDistinctCentersRange(req, res, next) {
        try {
            const { from, to } = req.query;
            if (!from || !to) {
                return res.status(400).json({ ok: false, error: "Missing 'from' or 'to' query parameter (YYYY-MM-DD)" });
            }

            const QueryEngineService = require("../services/QueryEngineService");
            const rows = await DataService.getRowsCached();
            const result = QueryEngineService.countDistinctCentersByDateRange(rows, from, to);

            return res.json({
                ok: true,
                from: result.from,
                to: result.to,
                distinctCenters: result.distinctCenters
            });
        } catch (err) {
            next(err);
        }
    }

    // --- Endpoints para Insight Engine ---

    async getCsvInsightCompareMonths(req, res, next) {
        try {
            const { year, a, b, metric } = req.query;
            if (!year || !a || !b) return res.status(400).json({ ok: false, error: "Missing year, a, or b" });
            const InsightEngineService = require("../services/InsightEngineService");
            const rows = await DataService.getRowsCached();
            const result = InsightEngineService.compareMonths(rows, parseInt(year), parseInt(a), parseInt(b), metric || "movements");
            return res.json({ ok: true, ...result });
        } catch (err) {
            next(err);
        }
    }

    async getCsvInsightMaxActiveDay(req, res, next) {
        try {
            const { year } = req.query;
            if (!year) return res.status(400).json({ ok: false, error: "Missing year" });
            const InsightEngineService = require("../services/InsightEngineService");
            const rows = await DataService.getRowsCached();
            const result = InsightEngineService.maxActiveCentersDay(rows, parseInt(year));
            return res.json({ ok: true, ...result });
        } catch (err) {
            next(err);
        }
    }

    async getCsvInsightQuarter(req, res, next) {
        try {
            const { year, q } = req.query;
            if (!year || !q) return res.status(400).json({ ok: false, error: "Missing year or q" });
            const InsightEngineService = require("../services/InsightEngineService");
            const rows = await DataService.getRowsCached();
            const result = InsightEngineService.quarterPatterns(rows, parseInt(year), parseInt(q));
            return res.json({ ok: true, ...result });
        } catch (err) {
            next(err);
        }
    }

    async getCsvInsightPrioritize(req, res, next) {
        try {
            const { year } = req.query;
            const InsightEngineService = require("../services/InsightEngineService");
            const rows = await DataService.getRowsCached();
            const result = InsightEngineService.prioritizeCenters(rows, { year: year ? parseInt(year) : null });
            return res.json({ ok: true, ...result });
        } catch (err) {
            next(err);
        }
    }

    async getCsvInsightDiffCenters(req, res, next) {
        try {
            const { year, a, b } = req.query;
            if (!year || !a || !b) return res.status(400).json({ ok: false, error: "Missing year, a, or b" });
            const InsightEngineService = require("../services/InsightEngineService");
            const rows = await DataService.getRowsCached();
            const result = InsightEngineService.diffDistinctCentersMonths(rows, parseInt(year), parseInt(a), parseInt(b));
            return res.json({ ok: true, ...result });
        } catch (err) {
            next(err);
        }
    }

    async getCsvInsightCompareSumaNeta(req, res, next) {
        try {
            const { year, a, b } = req.query;
            if (!year || !a || !b) return res.status(400).json({ ok: false, error: "Missing year, a, or b" });
            const InsightEngineService = require("../services/InsightEngineService");
            const rows = await DataService.getRowsCached();
            const result = InsightEngineService.compareSumaNetaMonths(rows, parseInt(year), parseInt(a), parseInt(b));
            if (result.error) return res.status(400).json({ ok: false, ...result });
            return res.json({ ok: true, ...result });
        } catch (err) {
            next(err);
        }
    }

    async getCsvInsightGroupCenters(req, res, next) {
        try {
            const { year, a, b, group } = req.query;
            if (!year || !a || !b || !group) return res.status(400).json({ ok: false, error: "Missing year, a, b, or group" });
            const InsightEngineService = require("../services/InsightEngineService");
            const rows = await DataService.getRowsCached();
            const result = InsightEngineService.distinctCentersByGroupMonths(rows, parseInt(year), parseInt(a), parseInt(b), group);
            if (result.error) return res.status(400).json({ ok: false, ...result });
            return res.json({ ok: true, ...result });
        } catch (err) {
            next(err);
        }
    }

    async getCsvInsightMaterialDiff(req, res, next) {
        try {
            const { year, a, b } = req.query;
            if (!year || !a || !b) return res.status(400).json({ ok: false, error: "Missing year, a, or b" });
            const InsightEngineService = require("../services/InsightEngineService");
            const rows = await DataService.getRowsCached();
            const result = InsightEngineService.materialsWithoutMovementsMonths(rows, parseInt(year), parseInt(a), parseInt(b));
            if (result.error) return res.status(400).json({ ok: false, ...result });
            return res.json({ ok: true, ...result });
        } catch (err) {
            next(err);
        }
    }

}

module.exports = new CsvController();
