const DataService = require("../services/DataService");
const GeminiService = require("../services/GeminiService");

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
                    // Fetch real data from Datasphere
                    // top: 200 para tener muestra suficiente para agregar
                    const data = await DataService.fetchMovMat({ top: 200 });

                    // Normalizar respuesta (Datasphere OData puede devolver { d: { results: [] } } o { value: [] })
                    const rows = data.d?.results || data.value || (Array.isArray(data) ? data : []);

                    if (rows.length > 0) {
                        // Agregaciones usando helpers de DataService
                        // Asumimos COL_8 es numérica para suma (similar a getInsights de CSV) o usamos conteo si no.
                        // Intenta detectar columna métrica
                        const numericCol = "COL_8"; // Ajustar si se sabe nombre real OData, por ahora asumimos mapeo similar al CSV o hardcode

                        // Top 5 ID_CENTRO
                        const sumByCentro = DataService.sumBy(rows, "ID_CENTRO", numericCol);
                        const topCentros = DataService.topN(sumByCentro, 5);

                        // Top 5 CLASE_MOVIMIENTO
                        const countByClase = DataService.countBy(rows, "CLASE_MOVIMIENTO");
                        const topClases = DataService.topN(countByClase, 5);

                        // Sample (10 filas)
                        const sample = rows.slice(0, 10);

                        context = `
Contexto de datos (Datasphere OData):
- Registros analizados: ${rows.length} (Muestra de los últimos movimietos)
- Top 5 Centros (posiblemente por volumen/suma): ${JSON.stringify(topCentros)}
- Top 5 Clases de Movimiento (frecuencia): ${JSON.stringify(topClases)}
- Muestra de datos: ${JSON.stringify(sample)}

Instrucciones:
- Usa estos datos para responder si la pregunta es sobre totales, centros o movimientos.
- Si te piden detalles que no están en la muestra, indica que solo tienes una vista parcial.
`;
                    } else {
                        context = "No se encontraron datos recientes en Datasphere.";
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
        // Este es el código original de server.js, mantenido como está.
        // En un refactor real, esto debería probablemente estar en un DatasphereService.
        // implementando inline aquí para coincidir con el alcance.
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
