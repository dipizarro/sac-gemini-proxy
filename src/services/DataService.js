const { toNumberSmart } = require("../utils/helpers");
const OAuthService = require("./OAuthService");
const config = require("../config/config");
const { getDataProvider } = require("../providers/DataProviderFactory");

class DataService {
    constructor() {
        // La instancia ahora delega en DataProviderFactory para cargar datos
    }

    sumBy(rows, key, valueKey) {
        return rows.reduce((acc, r) => {
            const k = (r[key] ?? "SIN_DATO").toString().trim() || "SIN_DATO";
            const v = toNumberSmart(r[valueKey]);
            acc[k] = (acc[k] || 0) + v;
            return acc;
        }, {});
    }

    countBy(rows, key) {
        return rows.reduce((acc, r) => {
            const k = (r[key] ?? "SIN_DATO").toString().trim() || "SIN_DATO";
            acc[k] = (acc[k] || 0) + 1;
            return acc;
        }, {});
    }

    topN(mapObj, n = 5) {
        return Object.entries(mapObj)
            .sort((a, b) => b[1] - a[1])
            .slice(0, n);
    }

    async getInsights() {
        try {
            const provider = getDataProvider();
            const rows = await provider.loadData();

            // Soportar tanto formato CSV (COL_8) como OData (SUMA_NETA)
            const SUM_KEY = rows.length > 0 && typeof rows[0]["SUMA_NETA"] !== "undefined" ? "SUMA_NETA" : "COL_8";

            const topCentros = this.topN(this.sumBy(rows, "ID_CENTRO", SUM_KEY), 5);
            const topClases = this.topN(this.countBy(rows, "CLASE_MOVIMIENTO"), 5);
            const topGrupos = this.topN(this.countBy(rows, "GRUPO_ARTICULOS"), 5);

            // Sample chico 
            const sample = rows.slice(0, 12);

            return `
          Contexto del reporte (CSV MovMat):
          - Top 5 ID_CENTRO por suma (${SUM_KEY}):
          ${JSON.stringify(topCentros, null, 2)}
          - Top 5 CLASE_MOVIMIENTO por frecuencia:
          ${JSON.stringify(topClases, null, 2)}
          - Top 5 GRUPO_ARTICULOS por frecuencia:
          ${JSON.stringify(topGrupos, null, 2)}
          - Muestra de filas:
          ${JSON.stringify(sample, null, 2)}
  
          Instrucciones:
          - Responde con lenguaje de negocio.
          - Si falta un filtro (fecha/centro/clase), pregunta cuál necesita.
          `;
        } catch (e) {
            return `Contexto CSV no disponible (error leyendo archivo): ${e.message}`;
        }
    }

    /**
     * Consume OData MovMat desde Datasphere.
     * @param {Object} options
     * @param {number} [options.top=50] - Cantidad de registros ($top)
     * @param {string|string[]} [options.select] - Campos a seleccionar ($select)
     * @param {string} [options.filter] - Filtro OData ($filter)
     * @returns {Promise<Object>} Respuesta JSON de Datasphere
     */
    async fetchMovMat({ top = 50, select, filter } = {}) {
        const token = await OAuthService.getAccessToken();
        const baseUrl = config.datasphere.url;

        if (!baseUrl) {
            throw new Error("Missing DATASPHERE_ODATA_URL in config");
        }

        const params = new URLSearchParams();

        // $top
        if (top) params.append("$top", top);

        // $select
        if (select) {
            const selectVal = Array.isArray(select) ? select.join(",") : select;
            params.append("$select", selectVal);
        }

        // $filter
        if (filter) {
            params.append("$filter", filter);
        }

        // $format
        params.append("$format", "json");

        const url = `${baseUrl}?${params.toString()}`;

        try {
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

            return await response.json();
        } catch (error) {
            // Re-lanzar error (OAuthService ya maneja sus errores, aquí manejamos el fetch de datos)
            throw new Error(`Failed to fetch MovMat data: ${error.message}`);
        }
    }
    /**
     * Obtiene filas de la caché o las carga desde el CSV.
     * @returns {Array} rows
     */
    async getRowsCached() {
        const CacheService = require("./CacheService");
        const config = require("../config/config");
        const CACHE_KEY = "MOVMAT_DATA";
        let rows = CacheService.get(CACHE_KEY);

        if (!rows) {
            try {
                const provider = getDataProvider();
                console.log("DataService: Cache miss, loading data from provider...");
                rows = await provider.loadData();
                if (rows && rows.length > 0) {
                    CacheService.set(CACHE_KEY, rows, 24 * 60 * 60 * 1000);
                }
            } catch (err) {
                console.warn("Provider load failed:", err.message);

                if (config.datasphere.exportUrl) {
                    console.log("Fetching from Datasphere Export Service fallback...");
                    const ExportService = require("./ExportService");
                    const { parse } = require("csv-parse/sync");
                    const { normalizeHeader } = require("../utils/helpers");

                    const resourcePath = config.datasphere.movMatPath;
                    const buffer = await ExportService.exportToCsvBuffer({ resourcePath });
                    rows = parse(buffer, {
                        columns: (header) => header.map(normalizeHeader),
                        skip_empty_lines: true,
                        trim: true,
                        relax_quotes: true
                    });
                    if (rows && rows.length > 0) {
                        CacheService.set(CACHE_KEY, rows, 10 * 60 * 1000); // 10 minutos para datos en vivo
                    }
                } else {
                    throw new Error(`Data loading failed and no fallback export URL configured. Original error: ${err.message}`);
                }
            }
        }
        return rows || [];
    }

    clearCache() {
        const CacheService = require("./CacheService");
        CacheService.del("MOVMAT_DATA");
        // Limpiar elementos dependientes como el perfil del dataset
        const DatasetProfileService = require("./DatasetProfileService");
        DatasetProfileService.clearProfileCache();
        console.log("DataService: All local caches cleared.");
    }
}

module.exports = new DataService();
