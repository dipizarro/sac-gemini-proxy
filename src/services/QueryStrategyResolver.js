class QueryStrategyResolver {
    /**
     * Resuelve y retorna la estrategia de consulta a utilizar
     * basada en la variable de entorno DATA_SOURCE.
     * 
     * @returns {"CSV" | "ODATA"} El nombre de la estrategia
     */
    resolveStrategy() {
        const source = (process.env.DATA_SOURCE || "").toUpperCase();

        if (source === "ODATA") {
            console.log("[QUERY] Strategy: ODATA");
            return "ODATA";
        }

        // Default y caso explícito
        console.log("[QUERY] Strategy: CSV");
        return "CSV";
    }
}

module.exports = new QueryStrategyResolver();
