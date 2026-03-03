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
            if (key.startsWith("__")) continue;

            const normalizedKey = normalizeHeader(key);
            normalized[normalizedKey] = value;
        }
        return normalized;
    }

    /**
     * Consume el endpoint OData y trae todos los registros usando paginación.
     * @returns {Promise<Array>} Array con todos los registros normalizados
     */
    async fetchAllMovMatData() {
        const baseUrl = config.datasphere.url;

        if (!baseUrl) {
            throw new Error("Missing DATASPHERE_ODATA_URL in config/env");
        }

        let allRecords = [];
        let skip = 0;
        let hasMoreData = true;

        console.log(`[ODATA] Inciando extracción de datos. Page size: ${this.pageSize}`);

        while (hasMoreData) {
            try {
                const token = await OAuthService.getAccessToken();
                const params = new URLSearchParams();

                params.append("$top", this.pageSize);
                params.append("$skip", skip);
                params.append("$format", "json");

                const url = `${baseUrl}?${params.toString()}`;

                const response = await fetch(url, {
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Accept": "application/json"
                    }
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`OData request failed: ${response.status} ${response.statusText} - ${errorText}`);
                }

                const data = await response.json();

                // OData V2 devuelve { d: { results: [...] } }
                // OData V4 devuelve { value: [...] }
                const results = data.d?.results || data.value || data;

                if (!Array.isArray(results)) {
                    throw new Error("Formato de respuesta OData inesperado (no es un array).");
                }

                const pageCount = results.length;

                if (pageCount > 0) {
                    // Normalizar y agregar resultados
                    const normalizedPage = results.map(row => this.normalizeRecord(row));
                    allRecords = allRecords.concat(normalizedPage);
                    console.log(`[ODATA] page fetched. Records in page: ${pageCount}. Total so far: ${allRecords.length}`);
                }

                // Determinar si hay más páginas
                if (pageCount < this.pageSize) {
                    hasMoreData = false;
                } else {
                    skip += this.pageSize;
                }

            } catch (error) {
                console.error(`[ODATA] Error fetching data at skip=${skip}:`, error.message);
                throw error;
            }
        }

        console.log(`[ODATA] total records: ${allRecords.length}`);
        return allRecords;
    }

    /**
     * Alias estandarizado para DataProviderFactory
     * @returns {Promise<Array>}
     */
    async loadData() {
        return this.fetchAllMovMatData();
    }
}

module.exports = new ODataProvider();
