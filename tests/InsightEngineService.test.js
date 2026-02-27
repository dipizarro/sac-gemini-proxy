const InsightEngineService = require("../src/services/InsightEngineService");

describe("InsightEngineService", () => {

    // Dataset simulado abarcando 2 años y varios meses
    const mockRows = [
        { FECHA: "2024-01-10", ID_CENTRO: "C001", CLASE_MOVIMIENTO: "ENT", SUMA_NETA: "100", GRUPO_ARTICULOS: "GASOLINA", MATERIAL1: "MAT1" },
        { FECHA: "2024-01-15", ID_CENTRO: "C001", CLASE_MOVIMIENTO: "SAL", SUMA_NETA: "50", GRUPO_ARTICULOS: "GASOLINA", MATERIAL1: "MAT2" },
        { FECHA: "2024-02-05", ID_CENTRO: "C002", CLASE_MOVIMIENTO: "ENT", SUMA_NETA: "200", GRUPO_ARTICULOS: "PETROLEO", MATERIAL1: "MAT1" },
        { FECHA: "2024-02-20", ID_CENTRO: "C003", CLASE_MOVIMIENTO: "SAL", SUMA_NETA: "300", GRUPO_ARTICULOS: "PETROLEO", MATERIAL1: "MAT3" },
        { FECHA: "2024-03-01", ID_CENTRO: "C001", CLASE_MOVIMIENTO: "ENT", SUMA_NETA: "150", GRUPO_ARTICULOS: "GASOLINA", MATERIAL1: "MAT4" },
        { FECHA: "2024-03-01", ID_CENTRO: "C002", CLASE_MOVIMIENTO: "ENT", SUMA_NETA: "50", GRUPO_ARTICULOS: "GASOLINA", MATERIAL1: "MAT4" },
        { FECHA: "2023-12-10", ID_CENTRO: "C004", CLASE_MOVIMIENTO: "ENT", SUMA_NETA: "500", GRUPO_ARTICULOS: "OTROS", MATERIAL1: "MAT5" }
    ];

    describe("activityByMonth", () => {
        it("debe retornar los movimientos por mes agrupados correctamente para un año especifico", () => {
            const result = InsightEngineService.activityByMonth(mockRows, 2024);
            expect(result.year).toBe(2024);
            expect(result.months.length).toBe(12);

            const jan = result.months.find(m => m.month === 1);
            expect(jan.movements).toBe(2);
            expect(jan.distinctCenters).toBe(1); // C001

            const feb = result.months.find(m => m.month === 2);
            expect(feb.movements).toBe(2);
            expect(feb.distinctCenters).toBe(2); // C002, C003

            const dec = result.months.find(m => m.month === 12);
            expect(dec.movements).toBe(0); // 2023 no entra
        });
    });

    describe("compareMonths", () => {
        it("debe determinar correctamente al ganador entre dos meses segun metric movements", () => {
            // Enero: 2, Febrero: 2 (Empate)
            const resTie = InsightEngineService.compareMonths(mockRows, 2024, 1, 2, "movements");
            expect(resTie.winner).toBe("Empate");

            // Febrero: 2 centros, Enero: 1 centro (Gana Feb)
            const resCenters = InsightEngineService.compareMonths(mockRows, 2024, 1, 2, "distinctCenters");
            expect(resCenters.winner).toBe("Mes 2");
        });
    });

    describe("quarterPatterns", () => {
        it("debe retornar los totales, centros top y dias top del Q1", () => {
            const result = InsightEngineService.quarterPatterns(mockRows, 2024, 1);

            expect(result.year).toBe(2024);
            expect(result.quarter).toBe(1);
            expect(result.monthsRange).toEqual([1, 3]);

            // Total Q1: Ene(2) + Feb(2) + Mar(2) = 6
            expect(result.totals.movements).toBe(6);
            expect(result.totals.distinctCenters).toBe(3); // C001, C002, C003

            // El centro 1 tiene mas (3 movimientos) en el quarter
            expect(result.topCentersByMovements[0].center).toBe("C001");
            expect(result.topCentersByMovements[0].movements).toBe(3);

            // El pico de dias
            expect(result.peakDaysByMovements[0].date).toBe("2024-03-01");
            expect(result.peakDaysByMovements[0].movements).toBe(2);
        });

        it("debe informar de error si el trimestre no es del 1 al 4", () => {
            const result = InsightEngineService.quarterPatterns(mockRows, 2024, 5);
            expect(result.error).toBeDefined();
        });
    });

    describe("maxActiveCentersDay", () => {
        it("debe identificar el dia con mayor cantidad de centros unicos", () => {
            const result = InsightEngineService.maxActiveCentersDay(mockRows, 2024);
            expect(result.year).toBe(2024);
            // El 2024-03-01 operaron C001 y C002 (2 centros)
            expect(result.date).toBe("2024-03-01");
            expect(result.distinctCenters).toBe(2);
        });
    });

    describe("prioritizeCenters", () => {
        it("debe priorizar globalmente los centros con mayores movimientos en todo el set", () => {
            const result = InsightEngineService.prioritizeCenters(mockRows); // Sin año, global
            expect(result.distinctCentersTotal).toBe(4); // C001, C002, C003, C004

            expect(result.results[0].center).toBe("C001"); // 3 Movimientos
            expect(result.results[1].center).toBe("C002"); // 2 Movimientos  
            expect(result.results[2].center).toBe("C003"); // 1 Movimiento
            expect(result.results[3].center).toBe("C004"); // 1 Movimiento
        });

        it("debe aplicar el filtro de año priorizando centros con mayor actividad del 2024", () => {
            const result = InsightEngineService.prioritizeCenters(mockRows, { year: 2024 });
            expect(result.distinctCentersTotal).toBe(3); // C001, C002, C003

            expect(result.results[0].center).toBe("C001");
            expect(result.results.find(c => c.center === "C004")).toBeUndefined();
        });
    });

    describe("diffDistinctCentersMonths", () => {
        it("debe identificar qué centros están exclusivos en un mes contra otro", () => {
            // Enero: C001
            // Febrero: C002, C003
            const result = InsightEngineService.diffDistinctCentersMonths(mockRows, 2024, 1, 2);

            expect(result.year).toBe(2024);
            expect(result.distinctCentersA).toBe(1);
            expect(result.distinctCentersB).toBe(2);
            expect(result.diff).toBe(1);

            expect(result.onlyMonthA).toBe(1); // C001
            expect(result.onlyMonthB).toBe(2); // C002, C003
        });
    });

    describe("compareSumaNetaMonths", () => {
        it("debe calcular el volumen SUMA_NETA correcto entre dos meses, retornar el ganador y las diferencias", () => {
            // Enero (Mes 1): 100 + 50 = 150
            // Marzo (Mes 3): 150 + 50 = 200
            const result = InsightEngineService.compareSumaNetaMonths(mockRows, 2024, 1, 3);

            expect(result.sumA).toBe(150);
            expect(result.sumB).toBe(200);
            expect(result.winner).toBe("Mes B");
            expect(result.diffAbs).toBe(50);
            expect(result.diffPct).toBe(25); // (50/200) * 100
        });
    });

    describe("distinctCentersByGroupMonths", () => {
        it("debe retornar los centros correspondientes para el grupo de articulo ingresado entre dos meses", () => {
            const result = InsightEngineService.distinctCentersByGroupMonths(mockRows, 2024, 1, 3, "GASOLINA");

            expect(result.group).toBe("gasolina"); // Lo formatea
            expect(result.monthADistinctCenters).toBe(1); // M1: C001
            expect(result.monthBDistinctCenters).toBe(2); // M3: C001, C002
            // Total unicos en el periodo de 1 a 3 para GASOLINA
            expect(result.totalDistinctCenters).toBe(2); // C001 y C002 a lo largo  del periodo
        });
    });

    describe("materialsWithoutMovementsMonths", () => {
        it("debe aislar los materiales transaccionados unicamente un mes y no el otro de forma mutuamente excluyente", () => {
            // Enero: MAT1, MAT2
            // Marzo: MAT4
            const result = InsightEngineService.materialsWithoutMovementsMonths(mockRows, 2024, 1, 3);

            expect(result.countOnlyA).toBe(2); // MAT1 y MAT2 no estan en Marzo
            expect(result.sampleOnlyA).toEqual(["MAT1", "MAT2"]);

            expect(result.countOnlyB).toBe(1); // MAT4 no esta en Enero
            expect(result.sampleOnlyB).toEqual(["MAT4"]);
        });
    });

    describe("compareTotalVolumeBetweenMonths con heuristica dinamica", () => {
        it("debe encontrar automaticamente a la suma neta e implementarla en la comparacion", () => {
            const result = InsightEngineService.compareTotalVolumeBetweenMonths(mockRows, 2024, 1, 3);

            // Por fallo heuristico a fallback (SUMA_NETA existe)
            expect(result.metricKey).toBe("SUMA_NETA");
            expect(result.a.volumeTotal).toBe(150);
            expect(result.b.volumeTotal).toBe(200);
        });

        it("debe respetar la metrica sobreescrita forzada", () => {
            // Obligamos a que use la clase movimiento en su lugar, aunque de NaN el test es asegurar que lo rutea.
            const result = InsightEngineService.compareTotalVolumeBetweenMonths(mockRows, 2024, 1, 3, "CLASE_MOV");
            expect(result.metricKey).toBe("CLASE_MOVIMIENTO");
        });
    });
});
