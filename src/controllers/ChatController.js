const DataService = require("../services/DataService");
const GeminiService = require("../services/GeminiService");

class ChatController {
    async handleChat(req, res) {
        try {
            const { message, history } = req.body || {};
            if (!message || typeof message !== "string") {
                return res.status(400).json({ error: "message is required (string)" });
            }

            // 1) Obtener contexto desde CSV
            const csvContext = DataService.getInsights();

            // 2) Genera Response usando AI
            const response = await GeminiService.generateResponse(message, history, csvContext);

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
