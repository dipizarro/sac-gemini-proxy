const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("../config/config");

class IntentRouterService {
    constructor() {
        if (config.gemini.apiKey) {
            this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
            this.model = this.genAI.getGenerativeModel({
                model: config.gemini.modelName,
                generationConfig: { responseMimeType: "application/json" }
            });
        }
    }

    async route(message) {
        if (!this.model) {
            return { intent: "unknown", slots: {}, confidence: 0, needs_clarification: false };
        }

        const prompt = `
Eres un clasificador de intenciones experto para un sistema de almacén.
Tu tarea es analizar el mensaje del usuario y retornar un JSON estricto.

INTENCIONES:
1. "count_distinct_centers_by_date": El usuario pregunta cuántos centros únicos (o cantidad de centros) tuvieron movimientos en una fecha.
2. "count_movements_by_date": El usuario pregunta cuántos movimientos totales, registros o filas hubo en una fecha.
3. "unknown": Cualquier otra pregunta o saludo.

REGLAS:
- Idioma: Español.
- Normalizar fechas a YYYY-MM-DD.
- Soportar formatos como "1 de enero del 2024", "el dia 1 de enero 2024", "2024-01-01", "01/01/2024".
- Si el usuario pregunta por cantidad de centros o movimientos pero NO provee una fecha, establece needs_clarification=true y clarification_question="¿Para qué fecha deseas consultar?".
- Si no hay fecha, no inventar una.
- Retorna SOLO el JSON, sin texto adicional.

JSON SCHEMA:
{
  "intent": "count_distinct_centers_by_date" | "count_movements_by_date" | "unknown",
  "slots": { "date": "YYYY-MM-DD" },
  "confidence": 0.0-1.0,
  "needs_clarification": boolean,
  "clarification_question": "string"
}

MENSAJE DEL USUARIO: "${message}"
`;

        try {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text();
            // Asegurar que solo procesamos el JSON si el modelo incluye backticks
            const jsonStr = text.replace(/```json|```/g, "").trim();
            const parsed = JSON.parse(jsonStr);

            // Validaciones adicionales post-AI
            const needsDateIntents = ["count_distinct_centers_by_date", "count_movements_by_date"];
            if (needsDateIntents.includes(parsed.intent) && !parsed.slots?.date && !parsed.needs_clarification) {
                parsed.needs_clarification = true;
                parsed.clarification_question = "¿Para qué fecha deseas consultar?";
            }

            return parsed;
        } catch (error) {
            console.error("IntentRouterService Error:", error);
            return {
                intent: "unknown",
                slots: {},
                confidence: 0,
                needs_clarification: false
            };
        }
    }
}

module.exports = new IntentRouterService();
