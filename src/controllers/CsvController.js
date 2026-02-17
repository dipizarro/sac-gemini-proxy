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
            const cachedData = CacheService.get("LOCAL_CSV_DATA");
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
            console.log("Reloading CSV...");
            // Force load from disk
            const rows = DataService.loadMovMatCsv();

            // Update Cache (store indefinitely or long TTL, e.g. 24h)
            CacheService.set("LOCAL_CSV_DATA", rows, 24 * 60 * 60 * 1000);

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
            let rows = CacheService.get("LOCAL_CSV_DATA");

            if (!rows) {
                // Auto-load if not in cache
                console.log("CSV not in cache, loading...");
                rows = DataService.loadMovMatCsv();
                CacheService.set("LOCAL_CSV_DATA", rows, 24 * 60 * 60 * 1000);
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
}

module.exports = new CsvController();
