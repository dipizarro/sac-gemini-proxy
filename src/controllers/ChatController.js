const DataService = require("../services/DataService");
const GeminiService = require("../services/GeminiService");
const config = require("../config/config");

class ChatController {
    async handleChat(req, res) {
        try {
            const { message, history } = req.body || {};
            if (!message || typeof message !== "string") {
                return res.status(400).json({ error: "message is required (string)" });
            }

            const IntentRouterService = require("../services/IntentRouterService");
            const QueryEngineService = require("../services/QueryEngineService");

            // 1. Obtener datos (cache/CSV)
            const rows = await DataService.getRowsCached();

            // 2. Clasificar intención + extraer slots (LLM)
            const route = await IntentRouterService.route(message);

            // 3. Si falta información crucial, preguntar al usuario
            if (route.needs_clarification) {
                return res.json({
                    reply: route.clarification_question,
                    meta: {
                        engine: "router",
                        intent: route.intent,
                        needs_clarification: true
                    }
                });
            }

            // 4. Si es una consulta exacta soportada, usar Query Engine
            if (route.intent === "count_distinct_centers_by_date") {
                const dateKey = route.slots.date;
                const result = QueryEngineService.countDistinctCentersByDate(rows, dateKey);

                return res.json({
                    reply: `El ${result.date}, ${result.distinctCenters} centros tuvieron movimientos registrados.`,
                    meta: {
                        engine: "query",
                        exact: true,
                        intent: route.intent,
                        date: result.date
                    },
                    evidence: { sampleCenters: result.sampleCenters }
                });
            }

            if (route.intent === "count_movements_by_date") {
                const dateKey = route.slots.date;
                const result = QueryEngineService.countMovementsByDate(rows, dateKey);

                return res.json({
                    reply: `El ${result.date}, se registraron ${result.movements} movimientos.`,
                    meta: {
                        engine: "query",
                        exact: true,
                        intent: route.intent,
                        date: result.date
                    },
                    evidence: result.evidence
                });
            }

            if (route.intent === "top_centers_by_movements_on_date") {
                const dateKey = route.slots.date;
                const topN = route.slots.topN || 5;
                const result = QueryEngineService.topCentersByMovementsOnDate(rows, dateKey, topN);

                // Build a nice reply string
                let reply = `El ${result.date}, los ${result.topN} centros con más movimientos fueron:\n`;
                result.results.forEach((item, index) => {
                    reply += `${index + 1}) Centro ${item.center}: ${item.movements} movimientos\n`;
                });

                return res.json({
                    reply: reply.trim(),
                    meta: {
                        engine: "query",
                        exact: true,
                        intent: route.intent,
                        date: result.date,
                        topN: result.topN
                    },
                    data: result.results,
                    totals: result.totals,
                    evidence: result.evidence
                });
            }

            if (route.intent === "count_distinct_centers_by_date_range") {
                const { from, to } = route.slots;
                const result = QueryEngineService.countDistinctCentersByDateRange(rows, from, to);

                return res.json({
                    reply: `Entre el ${result.from} y el ${result.to}, ${result.distinctCenters} centros tuvieron movimientos registrados.`,
                    meta: {
                        engine: "query",
                        exact: true,
                        intent: route.intent,
                        from: result.from,
                        to: result.to
                    },
                    evidence: result.evidence
                });
            }

            // 5. Si la intención no es mapeable a Query Engine, usar Gemini "Normal"
            const context = `
            Eres un asistente experto en el reporte de Movimientos de Materiales.
            El usuario hace una pregunta general o fuera del flujo de consulta exacta.
            Responde de forma profesional y directa. No menciones el tamaño del dataset ni que estás viendo una muestra.
            Si no sabes algo basándote en el contexto, simplemente indícalo cordialmente.
            `;

            const response = await GeminiService.generateResponse(message, history, context);
            return res.json({
                ...response,
                meta: { engine: "ai", intent: route.intent }
            });

        } catch (err) {
            console.error("ChatController Error:", err);
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

    async getCsvMovementsByDate(req, res) {
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
            console.error("getCsvMovementsByDate Error:", err);
            return res.status(500).json({ ok: false, error: "Internal Server Error", details: err.message });
        }
    }

    async getCsvTopCentersByMovements(req, res) {
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
                results: result.results,
                totals: result.totals
            });
        } catch (err) {
            console.error("getCsvTopCentersByMovements Error:", err);
            return res.status(500).json({ ok: false, error: "Internal Server Error", details: err.message });
        }
    }

    async getCsvDistinctCentersRange(req, res) {
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
            console.error("getCsvDistinctCentersRange Error:", err);
            return res.status(500).json({ ok: false, error: "Internal Server Error", details: err.message });
        }
    }

    async proxyDatasphere(req, res) {
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
