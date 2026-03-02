const IntentRouterService = require("../src/services/IntentRouterService");
const GeminiService = require("../src/services/GeminiService");
const NLDateService = require("../src/services/NLDateService");
const DatasetProfileService = require("../src/services/DatasetProfileService");

// Mock de dependencias externas para aislar el router
jest.mock("../src/services/GeminiService", () => ({
    model: {
        generateContent: jest.fn()
    }
}));

jest.mock("../src/services/DatasetProfileService", () => ({
    getDatasetProfile: jest.fn()
}));

describe("IntentRouterService", () => {
    const mockRows = [{ FECHA: "2024-01-01", ID_CENTRO: "C001" }];

    beforeEach(() => {
        jest.clearAllMocks();

        // Default profile mock
        DatasetProfileService.getDatasetProfile.mockReturnValue({
            minDate: "2024-01-01",
            maxDate: "2024-12-31",
            years: [2024],
            defaultYear: 2024,
            defaultFrom: "2024-01-01",
            defaultTo: "2024-12-31"
        });
    });

    /**
     * Helper para mockear la respuesta de Gemini devolviendo un JSON específico.
     */
    const mockGeminiResponse = (jsonObj) => {
        GeminiService.model.generateContent.mockResolvedValue({
            response: {
                text: () => JSON.stringify(jsonObj)
            }
        });
    };

    // 1. count_distinct_centers_by_date
    it("debe rutear a count_distinct_centers_by_date correctamente", async () => {
        mockGeminiResponse({
            intent: "count_distinct_centers_by_date",
            slots: { date: "2024-01-05" },
            confidence: 0.95
        });

        const result = await IntentRouterService.route("¿Cuántos centros operaron el 5 de enero de 2024?", mockRows);

        expect(result.intent).toBe("count_distinct_centers_by_date");
        expect(result.slots.date).toBe("2024-01-05");
        expect(result.needs_clarification).toBeFalsy();
    });

    // 2. count_movements_by_date
    it("debe rutear a count_movements_by_date correctamente", async () => {
        mockGeminiResponse({
            intent: "count_movements_by_date",
            slots: { date: "2024-02-10" },
            confidence: 0.98
        });

        const result = await IntentRouterService.route("Dime los movimientos del 10 de febrero", mockRows);

        expect(result.intent).toBe("count_movements_by_date");
        expect(result.slots.date).toBe("2024-02-10");
        expect(result.needs_clarification).toBeFalsy();
    });

    // 3. top_centers_by_movements_on_date
    it("debe rutear a top_centers_by_movements_on_date con topN custom", async () => {
        mockGeminiResponse({
            intent: "top_centers_by_movements_on_date",
            slots: { date: "2024-03-01", topN: 3 },
            confidence: 0.9
        });

        const result = await IntentRouterService.route("Top 3 centros con más movimientos el 1 de marzo", mockRows);

        expect(result.intent).toBe("top_centers_by_movements_on_date");
        expect(result.slots.topN).toBe(3);
    });

    // 4. count_distinct_centers_by_date_range
    it("debe rutear a count_distinct_centers_by_date_range auxiliado por NLDateService", async () => {
        // NLDateService debe detectar el rango "del 1 al 5 de enero de 2024"
        // Mockeamos la IA devolviendo la intencion
        mockGeminiResponse({
            intent: "count_distinct_centers_by_date_range",
            slots: {}, // Simulamos que Gemini falla en extraerlo, NLDate debe parcharlo
            confidence: 0.8
        });

        const result = await IntentRouterService.route("¿Cuántos centros únicos del 01/01/2024 al 05/01/2024?", mockRows);

        expect(result.intent).toBe("count_distinct_centers_by_date_range");
        expect(result.slots.from).toBe("2024-01-01");
        expect(result.slots.to).toBe("2024-01-05");
        expect(result.needs_clarification).toBe(false);
    });

    // 5. compare_activity_by_months
    it("debe rutear a compare_activity_by_months y asumir el año por defecto", async () => {
        mockGeminiResponse({
            intent: "compare_activity_by_months",
            slots: { months: [1, 2], metric: "movements" },
            confidence: 0.85
        });

        const result = await IntentRouterService.route("Compara movimientos entre enero y febrero", mockRows);

        expect(result.intent).toBe("compare_activity_by_months");
        expect(result.slots.months).toEqual([1, 2]);
        expect(result.slots.year).toBe(2024); // Inherited from profile
        expect(result.assumptions).toContain("Asumiendo año 2024 para la métrica mensual");
    });

    // 6. patterns_in_quarter
    it("debe rutear a patterns_in_quarter e inferir el quarter del texto", async () => {
        mockGeminiResponse({
            intent: "patterns_in_quarter",
            slots: {}, // Gemini no extrae nada
            confidence: 0.8
        });

        const result = await IntentRouterService.route("Dame un resumen del primer trimestre", mockRows);

        expect(result.intent).toBe("patterns_in_quarter");
        expect(result.slots.quarter).toBe(1);
        expect(result.slots.year).toBe(2024); // Inherited from profile
    });

    // 7. max_active_centers_day
    it("debe rutear a max_active_centers_day", async () => {
        mockGeminiResponse({
            intent: "max_active_centers_day",
            slots: { year: 2023 },
            confidence: 0.99
        });

        const result = await IntentRouterService.route("¿Qué día de 2023 tuvo más centros activos?", mockRows);

        expect(result.intent).toBe("max_active_centers_day");
        expect(result.slots.year).toBe(2023);
    });

    // 8. prioritize_centers_over_period
    it("debe rutear a prioritize_centers_over_period y usar min/max date por defecto", async () => {
        mockGeminiResponse({
            intent: "prioritize_centers_over_period",
            slots: {},
            confidence: 0.9
        });

        const result = await IntentRouterService.route("Prioriza los centros con mayor actividad histórica", mockRows);

        expect(result.intent).toBe("prioritize_centers_over_period");
        expect(result.slots.from).toBe("2024-01-01");
        expect(result.slots.to).toBe("2024-12-31");
        expect(result.slots.metric).toBe("movements");
    });

    // 9. diff_distinct_centers_between_months
    it("debe rutear a diff_distinct_centers_between_months pidiendo clarificación si faltan meses", async () => {
        mockGeminiResponse({
            intent: "diff_distinct_centers_between_months",
            slots: { year: 2024 }, // Faltan months
            confidence: 0.9
        });

        const result = await IntentRouterService.route("Diferencia de centros en meses de 2024", mockRows);

        expect(result.intent).toBe("diff_distinct_centers_between_months");
        expect(result.needs_clarification).toBe(true);
        expect(result.clarification_question).toBe("¿Qué meses deseas procesar?");
    });

    // 10. compare_suma_neta_between_months
    it("debe rutear a compare_suma_neta_between_months", async () => {
        mockGeminiResponse({
            intent: "compare_suma_neta_between_months",
            slots: { year: 2024, months: [3, 4] },
            confidence: 0.95
        });

        const result = await IntentRouterService.route("Compara la suma neta entre marzo y abril de 2024", mockRows);

        expect(result.intent).toBe("compare_suma_neta_between_months");
        expect(result.slots.months).toEqual([3, 4]);
    });

    // 11. distinct_centers_by_group_between_months
    it("debe rutear a distinct_centers_by_group_between_months pidiendo el grupo si falta", async () => {
        mockGeminiResponse({
            intent: "distinct_centers_by_group_between_months",
            slots: { year: 2024, months: [1, 2] }, // Falta group
            confidence: 0.95
        });

        const result = await IntentRouterService.route("¿Cuántos centros operaron entre enero y febrero?", mockRows);

        expect(result.intent).toBe("distinct_centers_by_group_between_months");
        expect(result.needs_clarification).toBe(true);
        expect(result.clarification_question).toBe("¿Para qué grupo de artículo exacto deseas consultar?");
    });

    // 12. materials_without_movements_feb_vs_jan
    it("debe rutear a materials_without_movements_feb_vs_jan", async () => {
        mockGeminiResponse({
            intent: "materials_without_movements_feb_vs_jan",
            slots: { year: 2024, months: [1, 2] },
            confidence: 0.98
        });

        const result = await IntentRouterService.route("Materiales que pararon de salir de enero a febrero 2024", mockRows);

        expect(result.intent).toBe("materials_without_movements_feb_vs_jan");
        expect(result.slots.months).toEqual([1, 2]);
    });

    // 13. compare_total_volume_between_months
    it("debe rutear a compare_total_volume_between_months detectando metrica explicita", async () => {
        mockGeminiResponse({
            intent: "compare_total_volume_between_months",
            slots: { year: 2024, months: [10, 11], volumeMetric: "CANTIDAD" },
            confidence: 0.96
        });

        const result = await IntentRouterService.route("Compara el volumen de CANTIDAD entre oct y nov", mockRows);

        expect(result.intent).toBe("compare_total_volume_between_months");
        expect(result.slots.volumeMetric).toBe("CANTIDAD");
    });

    // 14. sum_suma_neta_by_group_and_date
    it("debe rutear a sum_suma_neta_by_group_and_date correctamente", async () => {
        mockGeminiResponse({
            intent: "sum_suma_neta_by_group_and_date",
            slots: { date: "2024-01-01", group: "KEROSENE", breakdownByCenter: true },
            confidence: 0.99
        });

        const result = await IntentRouterService.route("Suma neta del kerosene el 1ero de enero", mockRows);

        expect(result.intent).toBe("sum_suma_neta_by_group_and_date");
        expect(result.slots.date).toBe("2024-01-01");
        expect(result.slots.group).toBe("KEROSENE");
        expect(result.slots.breakdownByCenter).toBe(true);
    });

    // Edge Cases y Clarificaciones Generales
    it("debe solicitar clarificación si se pide count_distinct_centers_by_date sin fecha", async () => {
        mockGeminiResponse({
            intent: "count_distinct_centers_by_date",
            slots: {},
            confidence: 0.9
        });

        const result = await IntentRouterService.route("¿Cuántos centros hubieron hoy?", mockRows);

        expect(result.intent).toBe("count_distinct_centers_by_date");
        expect(result.needs_clarification).toBe(true);
        expect(result.clarification_question).toBe("¿Para qué fecha deseas consultar?");
    });

    it("debe capturar errores de Gemini y devolver unknown", async () => {
        GeminiService.model.generateContent.mockRejectedValue(new Error("API Error"));

        const result = await IntentRouterService.route("Hola", mockRows);

        expect(result.intent).toBe("unknown");
        expect(result.confidence).toBe(0);
    });
});
