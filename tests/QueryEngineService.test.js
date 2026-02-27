const QueryEngineService = require("../src/services/QueryEngineService");

describe("QueryEngineService", () => {

    const mockRows = [
        { FECHA: "2024-01-01", ID_CENTRO: "C001", GRUPO_ARTICULOS: "GASOLINA", SUMA_NETA: "100", CLASE_MOVIMIENTO: "ENTRADA" },
        { FECHA: "2024-01-01", ID_CENTRO: "C002", GRUPO_ARTICULOS: "GASOLINA", SUMA_NETA: "50", CLASE_MOVIMIENTO: "SALIDA" },
        { FECHA: "2024-01-01", ID_CENTRO: "C001", GRUPO_ARTICULOS: "PETROLEO", SUMA_NETA: "200", CLASE_MOVIMIENTO: "ENTRADA" },
        { FECHA: "2024-01-02", ID_CENTRO: "C003", GRUPO_ARTICULOS: "GASOLINA", SUMA_NETA: "150", CLASE_MOVIMIENTO: "ENTRADA" },
        { FECHA: "2024-01-02", ID_CENTRO: "C003", GRUPO_ARTICULOS: "GASOLINA", SUMA_NETA: "20", CLASE_MOVIMIENTO: "ENTRADA" },
        { FECHA: "2024-01-03", ID_CENTRO: "C001", GRUPO_ARTICULOS: "KEROSENE", SUMA_NETA: "300", CLASE_MOVIMIENTO: "SALIDA" }
    ];

    describe("countDistinctCentersByDate", () => {
        it("debe retornar la cantidad correcta de centros únicos para una fecha", () => {
            const result = QueryEngineService.countDistinctCentersByDate(mockRows, "2024-01-01");
            expect(result.date).toBe("2024-01-01");
            expect(result.distinctCenters).toBe(2); // C001, C002
            expect(result.sampleCenters.sort()).toEqual(["C001", "C002"].sort());
        });

        it("debe retornar 0 si no hay datos para la fecha", () => {
            const result = QueryEngineService.countDistinctCentersByDate(mockRows, "2024-02-01");
            expect(result.distinctCenters).toBe(0);
        });
    });

    describe("sumSumaNetaByGroupAndDate", () => {
        it("debe calcular la suma neta exacta para un grupo y fecha", () => {
            const result = QueryEngineService.sumSumaNetaByGroupAndDate(mockRows, "2024-01-01", "GASOLINA", { breakdownByCenter: true, top: 5 });
            expect(result.date).toBe("2024-01-01");
            expect(result.group).toBe("GASOLINA");
            expect(result.totalSumaNeta).toBe(150); // 100 + 50
            expect(result.distinctCenters).toBe(2);
            expect(result.totals.rowsMatched).toBe(2);
            expect(result.topCenters.length).toBe(2);
            expect(result.topCenters.find(c => c.center === "C001").sumaNeta).toBe(100);
        });

        it("debe manejar correctamente mayusculas y minusculas en el grupo", () => {
            const result = QueryEngineService.sumSumaNetaByGroupAndDate(mockRows, "2024-01-01", "gasolina");
            expect(result.totalSumaNeta).toBe(150);
        });

        it("debe retornar 0 si el grupo o fecha no existen", () => {
            const result = QueryEngineService.sumSumaNetaByGroupAndDate(mockRows, "2024-01-01", "DIESEL");
            expect(result.totalSumaNeta).toBe(0);
        });
    });

    describe("countMovementsByDate", () => {
        it("debe contar la cantidad total de movimientos (filas) para una fecha", () => {
            const result = QueryEngineService.countMovementsByDate(mockRows, "2024-01-02");
            expect(result.date).toBe("2024-01-02");
            expect(result.movements).toBe(2);
        });

        it("debe retornar 0 movimientos si la fecha no existe", () => {
            const result = QueryEngineService.countMovementsByDate(mockRows, "2025-01-01");
            expect(result.movements).toBe(0);
        });
    });

    describe("topCentersByMovementsOnDate", () => {
        it("debe retornar el top de centros ordenados por cantidad de movimientos cronologicos", () => {
            const result = QueryEngineService.topCentersByMovementsOnDate(mockRows, "2024-01-01", 5);
            expect(result.date).toBe("2024-01-01");
            expect(result.topN).toBe(5);
            expect(result.totals.movements).toBe(3);
            expect(result.totals.distinctCenters).toBe(2);

            // C001 = 2 movimientos, C002 = 1 movimiento
            expect(result.results[0].center).toBe("C001");
            expect(result.results[0].movements).toBe(2);
            expect(result.results[1].center).toBe("C002");
            expect(result.results[1].movements).toBe(1);
        });
    });

    describe("countDistinctCentersByDateRange", () => {
        it("debe contar la cantidad de centros unicos dentro de un rango de fechas", () => {
            const result = QueryEngineService.countDistinctCentersByDateRange(mockRows, "2024-01-01", "2024-01-02");
            expect(result.from).toBe("2024-01-01");
            expect(result.to).toBe("2024-01-02");
            expect(result.distinctCenters).toBe(3); // C001, C002, C003
        });

        it("debe retornar 0 si el rango no matchea con los datos", () => {
            const result = QueryEngineService.countDistinctCentersByDateRange(mockRows, "2025-01-01", "2025-12-31");
            expect(result.distinctCenters).toBe(0);
        });
    });
});
