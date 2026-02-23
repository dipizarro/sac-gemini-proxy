const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("../config/config");
const GeminiService = require("./GeminiService");
const NLDateService = require("./NLDateService");

class IntentRouterService {
    constructor() {
        this.model = GeminiService.model;
    }

    /**
     * Usa Gemini para clasificar la intención del usuario y extraer entidades (ej. fecha).
     */
    async route(message) {
        if (!this.model) {
            return { intent: "unknown", slots: {}, confidence: 0, needs_clarification: false };
        }

        // 1. Tratar de extraer rango usando NLDateService con antelación
        const explicitRange = NLDateService.extractDateRangeEs(message);
        const hasRange = !!explicitRange;

        const prompt = `
Eres un clasificador de intenciones experto para un sistema de almacén.
Tu tarea es analizar el mensaje del usuario y retornar un JSON estricto.

INTENCIONES:
1. "count_distinct_centers_by_date": El usuario pregunta cuántos centros únicos (o cantidad de centros) tuvieron movimientos en una sola fecha.
2. "count_movements_by_date": El usuario pregunta cuántos movimientos totales, registros o filas hubo en una fecha.
3. "top_centers_by_movements_on_date": El usuario pregunta qué centros tuvieron más movimientos (o mayor/top movimientos) en una fecha.
4. "count_distinct_centers_by_date_range": El usuario pregunta cuántos centros (únicos u operación) hubo en un período o rango de fechas (ej: entre x e y).
5. "unknown": Cualquier otra pregunta o saludo.

REGLAS:
- Idioma: Español.
- Normalizar fechas a YYYY-MM-DD.
- Si el usuario pregunta por un top o centros con más movimientos, extrae "topN" si especifica cantidad (ej: "top 10" -> 10). Por defecto usa 5.
- Si el usuario pregunta por un rango ("entre el 1 y 7", "del 1 al 7"), debes clasificar como "count_distinct_centers_by_date_range". Extrae "from" y "to" (YYYY-MM-DD).
- Si el usuario pregunta por cantidad de centros, movimientos, o top para una FECHA ÚNICA pero NO la provee, establece needs_clarification=true y clarification_question="¿Para qué fecha deseas consultar?".
- Si el usuario clasifica como RANGO ("count_distinct_centers_by_date_range") pero no indica explícitamente el inicio y fin, establece needs_clarification=true y clarification_question="¿Cuál es el rango de fechas (desde/hasta)?".
- Si no hay fechas explícitas, no las inventes.
- Retorna SOLO el JSON, sin texto adicional.

NOTA TÉCNICA: El sistema ya detectó ${hasRange ? 'UN RANGO VÁLIDO' : 'que NO hay un rango obvio'} (${explicitRange ? JSON.stringify(explicitRange) : 'n/a'}). Úsalo en los slots si es "count_distinct_centers_by_date_range".

JSON SCHEMA:
{
  "intent": "count_distinct_centers_by_date" | "count_movements_by_date" | "top_centers_by_movements_on_date" | "count_distinct_centers_by_date_range" | "unknown",
  "slots": { "date": "YYYY-MM-DD", "topN": 5, "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
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
            if (parsed.intent === "count_distinct_centers_by_date_range") {
                // Usar NLDateService como fallback/override seguro si el LLM no extrajo bien el slot pero sí detectó la intención
                if (explicitRange) {
                    parsed.slots = { ...parsed.slots, from: explicitRange.from, to: explicitRange.to };
                    parsed.needs_clarification = false;
                } else if (!parsed.slots?.from || !parsed.slots?.to) {
                    parsed.needs_clarification = true;
                    parsed.clarification_question = "¿Cuál es el rango de fechas (desde/hasta)?";
                }
            } else {
                const needsDateIntents = [
                    "count_distinct_centers_by_date",
                    "count_movements_by_date",
                    "top_centers_by_movements_on_date"
                ];
                if (needsDateIntents.includes(parsed.intent) && !parsed.slots?.date && !parsed.needs_clarification) {
                    parsed.needs_clarification = true;
                    parsed.clarification_question = "¿Para qué fecha deseas consultar?";
                }
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
