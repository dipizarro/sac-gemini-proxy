const GeminiService = require("./GeminiService");
const NLDateService = require("./NLDateService");
const DatasetProfileService = require("./DatasetProfileService");

class IntentRouterService {
    constructor() {
        this.model = GeminiService.model;
    }

    /**
     * Usa Gemini para clasificar la intención del usuario y extraer entidades (ej. fecha).
     */
    async route(message, rows) {
        if (!this.model) {
            return { intent: "unknown", slots: {}, confidence: 0, needs_clarification: false, assumptions: [] };
        }

        const profile = DatasetProfileService.getDatasetProfile(rows);
        const assumptions = [];

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
5. "compare_activity_by_months": El usuario quiere comparar la actividad (centros o movimientos) entre meses específicos (ej: enero vs febrero).
6. "patterns_in_quarter": El usuario busca patrones o tendencias en un trimestre dado (ej: Q1).
7. "max_active_centers_day": El usuario pregunta qué día en específico tuvo mayor cantidad de centros activos (ej: ¿qué día de 2024 hubo más operación?).
8. "prioritize_centers_over_period": El usuario pide priorizar, ranquear o listar los centros con mayor movimiento en un período o año completo en base a su nivel de actividad (ej: "priorizar centros con más movs").
9. "diff_distinct_centers_between_months": El usuario quiere saber la diferencia o comparativa matemática exacta de centros (con movimiento) entre dos meses (ej: "Diferencia de centros entre enero y febrero").
10. "compare_suma_neta_between_months": El usuario quiere comparar el volumen total, monto, valores o suma neta (SUMA_NETA) entre dos meses específicos (ej: "¿Hubo más volumen en enero o febrero?", "comparar suma neta entre enero y febrero").
11. "distinct_centers_by_group_between_months": El usuario pregunta por centros únicos o movimientos para un grupo de artículo o categoría específica entre dos meses de un año dado (ej: "¿Cuántos centros tuvieron movimientos para el grupo de artículo ‘GASOLINA’ entre enero y febrero?").
12. "materials_without_movements_feb_vs_jan": El usuario pregunta qué artículos o materiales tuvieron movimiento o salidas en un mes pero NO en otro (ej: "¿qué materiales se operaron en Enero y dejaron de tener salida en Febrero?").
13. "unknown": Cualquier otra pregunta o saludo.

REGLAS:
- Idioma: Español.
- Normalizar fechas a YYYY-MM-DD.
- Si el usuario pregunta por un top o centros con más movimientos (\`top_centers\`), extrae "topN" si especifica cantidad (ej: "top 10" -> 10). Por defecto usa 5.
- Si el usuario pregunta por un rango ("entre el 1 y 7", "del 1 al 7"), debes clasificar como "count_distinct_centers_by_date_range". Extrae "from" y "to" (YYYY-MM-DD).
- Para comparar meses (\`compare_activity_by_months\`), pedir la diferencia (\`diff_distinct_centers_between_months\`), comparar suma neta (\`compare_suma_neta_between_months\`), filtrar por grupo entre meses (\`distinct_centers_by_group_between_months\`), o pedir materiales inactivos un mes respecto al otro (\`materials_without_movements_feb_vs_jan\`), extrae el \`year\` (ej: 2024), un arreglo \`months\` ordenado cronológicamente con los números de los meses (ej: [1, 2]). 
- Para \`compare_activity_by_months\` extrae además la \`metric\` ("movements" o "distinct_centers", usa "movements" por defecto).
- Crucial: Para \`distinct_centers_by_group_between_months\` extrae además el nombre exacto del grupo que pide el usuario en el slot \`group\` (ej: "GASOLINA").
- Para patrones trimestrales (\`patterns_in_quarter\`), extrae \`year\` y \`quarter\` (1-4).
- Para max active day (\`max_active_centers_day\`) y priorización (\`prioritize_centers_over_period\`), intenta extraer \`year\` (ej: 2024). Para priorización extrae \`metric\` = "movements".
- Si el usuario pregunta de fecha única (intents 1, 2 o 3) pero NO provee la fecha, establece \`needs_clarification=true\` y \`clarification_question="¿Para qué fecha deseas consultar?"\`.
- Si es rango (4) sin indicar \`from\`/\`to\`, pide "¿Cuál es el rango de fechas (desde/hasta)?".
- Si es comparaciones, diferencia o trimestre (5, 6, 9, 10, 11, 12) pero no define meses/trimestre explícitamente, pide aclarar. Para filtro por grupo (11), si omite el grupo, lanza aclarar con "¿Para qué grupo de artículo exacto deseas consultar?". Para materiales inactivos (12), asegúrate obligatoriamente de tener los 2 meses a cruzar.
- Si no hay año para 7, 8, 9, 10, 11 y 12 usa 2024 como fallback temporal si es obvio, o pide "¿Dé qué año deseas consultar?" si es \`needs_clarification=true\`.
- Si no hay fechas explícitas, no las inventes.
- Retorna SOLO el JSON, sin texto adicional.

NOTA TÉCNICA: El sistema ya detectó ${hasRange ? 'UN RANGO VÁLIDO' : 'que NO hay un rango obvio'} (${explicitRange ? JSON.stringify(explicitRange) : 'n/a'}). Úsalo en los slots si es "count_distinct_centers_by_date_range".

JSON SCHEMA:
{
  "intent": "count_distinct_centers_by_date" | "count_movements_by_date" | "top_centers_by_movements_on_date" | "count_distinct_centers_by_date_range" | "compare_activity_by_months" | "patterns_in_quarter" | "max_active_centers_day" | "prioritize_centers_over_period" | "diff_distinct_centers_between_months" | "compare_suma_neta_between_months" | "distinct_centers_by_group_between_months" | "materials_without_movements_feb_vs_jan" | "unknown",
  "slots": { "date": "YYYY-MM-DD", "topN": 5, "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "year": 2024, "months": [1, 2], "quarter": 1, "metric": "movements", "group": "GASOLINA" },
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

            // Validaciones adicionales post-AI / Aplicación de Defaults
            if (parsed.intent === "count_distinct_centers_by_date_range") {
                if (explicitRange) {
                    parsed.slots = { ...parsed.slots, from: explicitRange.from, to: explicitRange.to };
                    parsed.needs_clarification = false;
                } else if (!parsed.slots?.from || !parsed.slots?.to) {
                    parsed.needs_clarification = true;
                    parsed.clarification_question = "¿Cuál es el rango de fechas (desde/hasta)?";
                }
            } else if (["compare_activity_by_months", "diff_distinct_centers_between_months", "compare_suma_neta_between_months", "distinct_centers_by_group_between_months", "materials_without_movements_feb_vs_jan"].includes(parsed.intent)) {
                if (!parsed.slots?.year) {
                    parsed.slots.year = profile.defaultYear;
                    assumptions.push(`Asumiendo año ${profile.defaultYear} para la métrica mensual`);
                }
                if (!parsed.slots?.months || parsed.slots.months.length < 2) {
                    parsed.needs_clarification = true;
                    parsed.clarification_question = "¿Qué meses deseas procesar?";
                } else if (parsed.intent === "distinct_centers_by_group_between_months" && !parsed.slots?.group) {
                    parsed.needs_clarification = true;
                    parsed.clarification_question = "¿Para qué grupo de artículo exacto deseas consultar?";
                } else if (parsed.slots?.year) {
                    parsed.needs_clarification = false;
                    delete parsed.clarification_question;
                }
            } else if (parsed.intent === "patterns_in_quarter") {
                if (!parsed.slots?.year) {
                    parsed.slots.year = profile.defaultYear;
                    assumptions.push(`Asumiendo año ${profile.defaultYear} para el trimestre`);
                }
                if (!parsed.slots?.quarter) {
                    if (message.toLowerCase().includes("primer trimestre")) {
                        parsed.slots.quarter = 1;
                        assumptions.push("Trimestre 1 (Q1) inferido por texto explícito");
                    } else if (message.toLowerCase().includes("segundo trimestre")) {
                        parsed.slots.quarter = 2;
                        assumptions.push("Trimestre 2 (Q2) inferido por texto explícito");
                    } else if (message.toLowerCase().includes("tercer trimestre")) {
                        parsed.slots.quarter = 3;
                        assumptions.push("Trimestre 3 (Q3) inferido por texto explícito");
                    } else if (message.toLowerCase().includes("cuarto trimestre")) {
                        parsed.slots.quarter = 4;
                        assumptions.push("Trimestre 4 (Q4) inferido por texto explícito");
                    } else {
                        parsed.needs_clarification = true;
                        parsed.clarification_question = "¿De qué año y de qué trimestre (Q1-Q4) hablamos?";
                    }
                }

                if (parsed.slots?.year && parsed.slots?.quarter) {
                    parsed.needs_clarification = false;
                    delete parsed.clarification_question;
                }
            } else if (["max_active_centers_day", "prioritize_centers_over_period"].includes(parsed.intent)) {
                if (!parsed.slots?.year && !parsed.slots?.from && !parsed.slots?.to) {
                    if (parsed.intent === "prioritize_centers_over_period") {
                        parsed.slots.from = profile.minDate;
                        parsed.slots.to = profile.maxDate;
                        assumptions.push(`Priorización usando rango global del CSV (${profile.minDate} a ${profile.maxDate})`);
                    } else {
                        parsed.slots.year = profile.defaultYear;
                        assumptions.push(`Asumiendo año ${profile.defaultYear} para buscar el día pico`);
                    }
                }
                if (parsed.intent === "prioritize_centers_over_period" && !parsed.slots?.metric) {
                    parsed.slots.metric = "movements";
                }

                // Siempre se satisface por los defaults o el rango global
                parsed.needs_clarification = false;
                delete parsed.clarification_question;
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

            parsed.assumptions = assumptions;
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
