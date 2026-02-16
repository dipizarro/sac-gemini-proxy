const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("../config/config");

class GeminiService {
    constructor() {
        if (config.gemini.apiKey) {
            this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
            this.model = this.genAI.getGenerativeModel({ model: config.gemini.modelName });
        } else {
            console.warn("Gemini API Key is missing. AI features will not work.");
        }
    }

    async generateResponse(message, history, context) {
        if (!this.model) {
            throw new Error("Gemini Model not initialized (missing API Key?)");
        }

        // Prompt final (history + contexto CSV)
        let prompt = `${context}\nPregunta del usuario: ${message}\n`;

        if (Array.isArray(history) && history.length > 0) {
            const ctx = history
                .slice(-10)
                .map(m => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
                .join("\n");
            prompt = `${context}\n${ctx}\nUser: ${message}\nAssistant:`;
        }

        const result = await this.model.generateContent(prompt);
        const reply = result?.response?.text?.() ?? "";

        return { reply, model: config.gemini.modelName };
    }
}

module.exports = new GeminiService();
