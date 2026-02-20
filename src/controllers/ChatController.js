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

            // --- EXACT COUNT INTENT DETECTION (Hybrid Engine) ---
            // Regex for explicit formats: YYYY-MM-DD, DD/MM/YYYY
            const dateRegexParams = /(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/;

            // Regex for natural Spanish: "1 de enero del 2024", "10 de mayo 2024"
            const monthsSpan = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre";
            const dateRegexNatural = new RegExp(`(\\d{1,2})\\s+de\\s+(${monthsSpan})\\s+(?:de|del)?\\s+(\\d{4})`, "i");

            // Keywords: cuantos/cuántos AND centros/centro
            const isCountQuestion = (lowerMsg.includes("cuantos") || lowerMsg.includes("cuántos"))
                && lowerMsg.includes("centro");

            let dateKey = null;

            if (isCountQuestion) {
                if (dateRegexParams.test(message)) {
                    // 2024-01-01 or 01/01/2024
                    let m = message.match(dateRegexParams)[0];
                    if (m.includes("/")) {
                        const [d, mo, y] = m.split("/");
                        dateKey = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
                    } else {
                        dateKey = m;
                    }
                } else if (dateRegexNatural.test(lowerMsg)) {
                    // 1 de enero del 2024
                    const m = lowerMsg.match(dateRegexNatural);
                    const d = m[1].padStart(2, '0');
                    const monthName = m[2];
                    const y = m[3];

                    const monthMap = {
                        enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
                        julio: "07", agosto: "08", septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12"
                    };
                    dateKey = `${y}-${monthMap[monthName]}-${d}`;
                }
            }

            if (dateKey) {
                try {
                    const profile = require("../utils/profile");
                    const t0 = profile.nowMs();

                    const QueryService = require("../services/QueryService");
                    const result = QueryService.countDistinctCentersByDate(dateKey);

                    const t1 = profile.nowMs();
                    const timing = Math.round(t1 - t0);

                    return res.json({
                        reply: `Para la fecha **${dateKey}** (detectada como ${result.date}), encontré **${result.distinctCenters}** centros distintos con movimientos registrados.`,
                        meta: {
                            engine: "query",
                            executionMs: timing,
                            evidenceSample: result.sampleCenters
                        }
                    });
                } catch (idxErr) {
                    console.error("QueryService Error:", idxErr);
                }
            }
            // ------------------------------------

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
                // OJO: Si RICH_SUMMARY está activo, podríamos querer usarlo aquí también, 
                // pero la lógica original era DataService.getInsights(). Respetamos eso por ahora.
                context = DataService.getInsights();
            }

            // --- RICH SUMMARY INTEGRATION ---
            const useRich = config.richSummary || req.query.rich === "1";
            if (useRich && needsData) {
                try {
                    // Force load full dataset from cache or disk
                    const CACHE_KEY = "MOVMAT_DATA";
                    let rows = CacheService.get(CACHE_KEY);
                    if (!rows || rows.length === 0) {
                        rows = DataService.loadMovMatCsv();
                        CacheService.set(CACHE_KEY, rows, 24 * 60 * 60 * 1000);
                    }

                    // Build Rich Summary
                    const SummaryService = require("../services/SummaryService");
                    const richData = SummaryService.buildRichSummary(rows);

                    context = `
CONTEXTO EXTENDIDO (Rich Summary Mode):
- Total de registros: ${richData.rowCount}
- Columnas: ${richData.columns.join(", ")}
- Top 20 Centros: ${JSON.stringify(richData.topCentros)}
- Top 20 Movimientos: ${JSON.stringify(richData.topMovimientos)}
- Top 20 Materiales: ${JSON.stringify(richData.topMateriales)}
- Estadísticas ${richData.numericStats ? richData.numericStats.column : 'N/A'}: ${JSON.stringify(richData.numericStats)}
- Muestra Diversa: ${JSON.stringify(richData.sampleRows)}

INSTRUCCIONES:
- Tienes acceso a un resumen detallado. Úsalo para responder preguntas complejas sobre distribución, valores máximos/mínimos y tendencias.
- Si falta algún filtro específico (ej. fecha exacta), pídelo.
`;
                } catch (richErr) {
                    console.error("Rich Summary Failed:", richErr);
                    // Fallback to standard context (already set)
                }
            }
            // -------------------------------


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
