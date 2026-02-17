const DataService = require("../services/DataService");
const GeminiService = require("../services/GeminiService");
const ExportService = require("../services/ExportService");
const CacheService = require("../services/CacheService");
const config = require("../config/config");
const { parse } = require("csv-parse/sync");
const { normalizeHeader } = require("../utils/helpers");

class ChatController {
    async handleChat(req, res) {
        try {
            const { message, history } = req.body || {};
            if (!message || typeof message !== "string") {
                return res.status(400).json({ error: "message is required (string)" });
            }

            // 1) Detectar intención de datos
            const keywords = ["centro", "movimiento", "material", "grupo", "movmat"];
            const lowerMsg = message.toLowerCase();
            const needsData = keywords.some(k => lowerMsg.includes(k));

            let context = "";

            if (needsData) {
                try {
                    const CACHE_KEY = "MOVMAT_DATA";
                    let rows = CacheService.get(CACHE_KEY);
                    let source = "Cache (Memoria)";

                    if (!rows) {
                        // 1. Try Local CSV first (Faster, preferred for demo)
                        try {
                            console.log("Cache miss. Loading local CSV...");
                            rows = DataService.loadMovMatCsv();
                            source = "CSV Local (Disk)";
                            if (rows && rows.length > 0) {
                                CacheService.set(CACHE_KEY, rows, 24 * 60 * 60 * 1000); // 24h for local file
                            }
                        } catch (csvErr) {
                            console.warn("Local CSV load failed:", csvErr.message);

                            // 2. Fallback to Datasphere Export IF configured
                            if (config.datasphere.exportUrl) {
                                console.log("Fetching from Datasphere Export Service...");
                                source = "Datasphere Export (Live)";
                                const resourcePath = config.datasphere.movMatPath;
                                const buffer = await ExportService.exportToCsvBuffer({ resourcePath });
                                rows = parse(buffer, {
                                    columns: (header) => header.map(normalizeHeader),
                                    skip_empty_lines: true,
                                    trim: true,
                                    relax_quotes: true
                                });
                                if (rows && rows.length > 0) {
                                    CacheService.set(CACHE_KEY, rows, 10 * 60 * 1000); // 10 min for live data
                                }
                            } else {
                                throw new Error("No hay datos en caché, el CSV local falló y no hay URL de exportación configurada.");
                            }
                        }
                    }

                    if (rows && rows.length > 0) {
                        // Agregaciones usando helpers de DataService
                        const numericCol = "COL_8";

                        // Top 5 ID_CENTRO
                        const sumByCentro = DataService.sumBy(rows, "ID_CENTRO", numericCol);
                        const topCentros = DataService.topN(sumByCentro, 5);

                        // Top 5 CLASE_MOVIMIENTO
                        const countByClase = DataService.countBy(rows, "CLASE_MOVIMIENTO");
                        const topClases = DataService.topN(countByClase, 5);

                        // Sample (10 filas)
                        const sample = rows.slice(0, 10);

                        context = `
Contexto de datos (${source}):
- Registros analizados: ${rows.length}
- Top 5 Centros (posiblemente por volumen/suma): ${JSON.stringify(topCentros)}
- Top 5 Clases de Movimiento (frecuencia): ${JSON.stringify(topClases)}
- Muestra de datos: ${JSON.stringify(sample)}

Instrucciones:
- Usa estos datos para responder si la pregunta es sobre totales, centros o movimientos.
- Si te piden detalles que no están en la muestra, indica que solo tienes una vista parcial.
`;
                    } else {
                        context = "No se encontraron datos en Datasphere para la vista solicitada.";
                    }
                } catch (dataErr) {
                    console.error("Error fetching Datasphere data:", dataErr.message);
                    context = `Error obteniendo datos en vivo: ${dataErr.message}. (Responde con conocimiento general)`;
                }
            } else {
                // Fallback a CSV estático si no pide datos explícitos (comportamiento actual)
                context = DataService.getInsights();
            }

            // 2) Genera Response usando AI
            const response = await GeminiService.generateResponse(message, history, context);

            return res.json(response);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: "Internal Server Error", details: err.message });
        }
    }

    async getCsvPreview(req, res) {
        try {
            const rows = DataService.loadMovMatCsv();
            res.json({ count: rows.length, sample: rows.slice(0, 5) });
        } catch (err) {
            res.status(500).json({ error: "Failed to load CSV", details: err.message });
        }
    }

    async proxyDatasphere(req, res) {
        // Este es el código original de server.js
        const config = require("../config/config");
        try {
            const url = `${config.datasphere.url}?$top=50&$format=json`;
            const auth = Buffer.from(`${config.datasphere.user}:${config.datasphere.pass}`).toString("base64");

            const r = await fetch(url, {
                headers: {
                    Authorization: `Basic ${auth}`,
                    Accept: "application/json"
                }
            });

            const text = await r.text();
            res.status(r.status).type("application/json").send(text);
        } catch (err) {
            res.status(500).json({ error: "Datasphere proxy error", details: err.message });
        }
    }
}

module.exports = new ChatController();
