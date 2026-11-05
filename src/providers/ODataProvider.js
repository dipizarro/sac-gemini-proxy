const transport = require('../services/ODataTransport');
const schema = require('../services/ODataSchemaService');
const SchemaError = require('../services/ODataSchemaError');
const config = require("../config/config");
const OAuthService = require("../services/OAuthService");
const { normalizeHeader } = require("../utils/helpers");

class ODataProvider {
    constructor() {
        this.pageSize = parseInt(process.env.ODATA_PAGE_SIZE || "1000", 10);
    }

    /**
     * Normaliza las keys de un registro OData usando la misma lógica
     * que se usa para los archivos CSV.
     * @param {Object} record - Registro original de OData
     * @returns {Object} Registro con keys normalizadas
     */
    normalizeRecord(record) {
        if (!record || typeof record !== "object") return record;

        const normalized = {};
        for (const [key, value] of Object.entries(record)) {
            // Ignoramos metadatos propios de OData (ej. __metadata)
            if (key.startsWith("__") || key.startsWith('@odata.') || key.includes('@odata.')) continue;

            const normalizedKey = normalizeHeader(key);
            normalized[normalizedKey] = value;
        }
        return normalized;
    }

    /**
     * Consume el endpoint OData y trae todos los registros usando paginación.
     * @returns {Promise<Array>} Array con todos los registros normalizados
     */
    async fetchAllMovMatData({ forceMetadata = false } = {}) {
        const baseUrl = config.datasphere.url;
        const ticket = await schema.prepare({ base: baseUrl, force: forceMetadata });

        if (!baseUrl) {
            throw new Error("Missing DATASPHERE_ODATA_URL in config/env");
        }

        let allRecords = [];
        let skip = 0;
        let hasMoreData = true;

        while (hasMoreData) {
            try {
                const token = await OAuthService.getAccessToken();
                const params = new URLSearchParams();

                params.append("$top", this.pageSize);
                params.append("$skip", skip);
                params.append("$format", transport.FORMAT);

                const url = `${baseUrl}?${params.toString()}`;

                const response = await fetch(url, {
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Accept": transport.FORMAT
                    }
                });
                const data = await transport.read(response);

                // OData V2 devuelve { d: { results: [...] } }
                // OData V4 devuelve { value: [...] }
                const results = data.d?.results || data.value || data;
                schema.validate(results, ticket);

                if (!Array.isArray(results)) {
                    throw new Error("Formato de respuesta OData inesperado (no es un array).");
                }

                const pageCount = results.length;

                if (pageCount > 0) {
                    // Normalizar y agregar resultados
                    const normalizedPage = results.map(row => this.normalizeRecord(row));
                    allRecords = allRecords.concat(normalizedPage);
                }

                // Determinar si hay más páginas
                if (pageCount < this.pageSize) {
                    hasMoreData = false;
                } else {
                    skip += this.pageSize;
                }

            } catch (error) {
                if (error instanceof SchemaError) throw error;
                throw transport.sanitize(error);
            }
        }
        return schema.finish(allRecords, ticket);
    }

    /**
     * Alias estandarizado para DataProviderFactory
     * @returns {Promise<Array>}
     */
    async loadData(options) {
        return this.fetchAllMovMatData(options);
    }

    assertSnapshot(rows) { return schema.assertSnapshot(rows); }

    /**
     * Ejecuta una consulta OData filtrada y seleccionando campos específicos
     * (Sin paginación, trae el límite indicado por $top o lo que entregue la API)
     * 
     * @param {Object} options
     * @param {string} [options.filter] - Condición $filter
     * @param {string} [options.select] - Campos a seleccionar $select
     * @param {number} [options.top] - Límite de registros $top
     * @param {string} [options.orderby] - Criterio $orderby
     * @param {boolean} [options.count] - Si es true, retorna solo el valor de conteo (@odata.count) y fuerza $top=0
     * @returns {Promise<Array|number>} Registros normalizados, o número si count es true
     */
    async executeFilteredQuery({ filter, select, top, orderby, count } = {}) {
        const baseUrl = config.datasphere.url;
        const ticket = await schema.prepare({ base: baseUrl, filter, select, orderby, count });

        if (!baseUrl) {
            throw new Error("Missing DATASPHERE_ODATA_URL in config/env");
        }

        try {
            const token = await OAuthService.getAccessToken();
            const params = new URLSearchParams();

            if (filter) params.append("$filter", filter);
            if (select && !count) params.append("$select", select); // Si es count, no hace falta select

            if (count) {
                params.append("$count", "true");
                params.append("$top", "0");
            } else if (top) {
                params.append("$top", top);
            }

            if (orderby && !count) params.append("$orderby", orderby);
            params.append("$format", transport.FORMAT);

            const url = `${baseUrl}?${params.toString()}`;

            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Accept": transport.FORMAT
                }
            });
            const data = await transport.read(response);

            // Si solicitó count, intentamos extraer la propiedad
            if (count) {
                schema.validate(data.value, ticket);
                await schema.finish(data.value, ticket, false);
                return transport.count(data['@odata.count']);
            }

            const results = data.d?.results || data.value || data;
            schema.validate(results, ticket);

            if (!Array.isArray(results)) {
                throw new Error("Formato de respuesta OData inesperado (no es un array).");
            }

            const normalizedRecords = results.map(row => this.normalizeRecord(row));

            return await schema.finish(normalizedRecords, ticket);

        } catch (error) {
            if (error instanceof SchemaError) throw error;
            throw transport.sanitize(error);
        }
    }
}

module.exports = new ODataProvider();
