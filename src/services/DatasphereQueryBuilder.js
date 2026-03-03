/**
 * Constructor de Consultas Dinámicas para SAP Datasphere OData V4
 */
class DatasphereQueryBuilder {
    /**
     * Construye un string para el parámetro $filter de OData basado en los slots detectados.
     * En OData V4:
     * - Las fechas no llevan comillas (ej. FECHA eq 2024-01-01)
     * - Los strings llevan comillas simples (ej. ID_CENTRO eq '1208')
     * 
     * @param {Object} slots Diccionario de variables extraídas de la intención
     * @returns {string} String formateado para OData $filter o string vacío si no hay filtros
     */
    buildFilterFromSlots(slots = {}) {
        const filters = [];

        // 1. Filtro por Fecha Exacta
        if (slots.date) {
            filters.push(`FECHA eq ${slots.date}`);
        }

        // 2. Filtro por Rango de Fechas (from / to)
        if (slots.from && slots.to) {
            filters.push(`FECHA ge ${slots.from} and FECHA le ${slots.to}`);
        } else if (slots.from) {
            filters.push(`FECHA ge ${slots.from}`);
        } else if (slots.to) {
            filters.push(`FECHA le ${slots.to}`);
        }

        // 3. Filtro por Grupo de Artículos
        if (slots.group) {
            const safeGroup = slots.group.replace(/'/g, "''"); // Escape simple quote for OData
            filters.push(`GRUPO_ARTICULOS eq '${safeGroup}'`);
        }

        // 4. Filtro por Centro ID
        if (slots.center) {
            const safeCenter = slots.center.replace(/'/g, "''");
            filters.push(`ID_CENTRO eq '${safeCenter}'`);
        }

        return filters.join(" and ");
    }

    /**
     * Retorna los campos que deben seleccionarse ($select)
     * optimizados para una intención específica, reduciendo el payload de red.
     * 
     * @param {string} intent Nombre de la intención detectada
     * @returns {string} String separado por comas para OData $select
     */
    buildSelectForIntent(intent) {
        switch (intent) {
            case "SUMA_NETA_GROUP_DATE":
            case "sum_suma_neta_by_group_and_date":
                return "ID_CENTRO,SUMA_NETA,FECHA,GRUPO_ARTICULOS";

            case "COUNT_MOVEMENTS_DATE":
            case "count_movements_by_date":
                // Para contar todo solo necesitamos un campo pivote como la fecha
                return "FECHA";

            case "TOP_CENTERS_BY_MOVEMENTS":
            case "top_centers_by_movements_on_date":
                return "ID_CENTRO,FECHA";

            case "COUNT_DISTINCT_CENTERS_DATE":
            case "count_distinct_centers_by_date":
                return "ID_CENTRO,FECHA";

            default:
                // Si la intención no tiene proyecciones específicas, por seguridad dejamos
                // que OData traiga todos los campos (o podríamos devolver los más comunes)
                return "";
        }
    }
}

module.exports = new DatasphereQueryBuilder();
