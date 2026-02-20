const fs = require('fs');
const DataService = require('../services/DataService');
const CacheService = require('../services/CacheService');

class CsvController {

    async getStatus(req, res) {
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
            console.error("CSV Status Error:", error);
            res.status(500).json({ error: "Failed to get CSV status", details: error.message });
        }
    }

    async reload(req, res) {
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
            console.error("CSV Reload Error:", error);
            res.status(500).json({ error: "Failed to reload CSV", details: error.message });
        }
    }

    async getSummary(req, res) {
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
            console.error("CSV Summary Error:", error);
            res.status(500).json({ error: "Failed to generate summary", details: error.message });
        }
    }

    async getProfile(req, res) {
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
            console.error("Profile Error:", error);
            res.status(500).json({ error: "Profiling failed", details: error.message });
        }
    }

    async getDistinctCenters(req, res) {
        try {
            const date = req.query.date;
            if (!date) return res.status(400).json({ error: "Missing date param (YYYY-MM-DD)" });

            const QueryService = require("../services/QueryService");
            const result = QueryService.countDistinctCentersByDate(date);

            res.json({ ok: true, ...result });
        } catch (error) {
            res.status(500).json({ error: "Query failed", details: error.message });
        }
    }
}

module.exports = new CsvController();
