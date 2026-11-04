const transport = require('./ODataTransport');
const numeric = require("../utils/numeric");
const OAuthService = require("./OAuthService");
const config = require("../config/config");
const { getDataProvider } = require("../providers/DataProviderFactory");

class DataService {
    constructor() {
        this.pendingLoad = null;
        this.cacheGeneration = 0;
    }

    sumBy(rows, key, valueKey) {
        return rows.reduce((acc, r) => {
            const k = (r[key] ?? "SIN_DATO").toString().trim() || "SIN_DATO";
            const v = numeric.readMetric(rows, r, valueKey);
            acc[k] = numeric.add(rows, acc[k] || 0, v);
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
            if (e instanceof require('./CsvSchemaService').SchemaError) throw e;
            if (e instanceof numeric.DataQualityError) throw e;
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
        let token;
        try { token = await OAuthService.getAccessToken(); } catch (error) { throw transport.sanitize(error); }
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
        params.append("$format", transport.FORMAT);

        const url = `${baseUrl}?${params.toString()}`;

        try {
            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Accept": transport.FORMAT
                }
            });

            return await transport.read(response);
        } catch (error) {
            // Re-lanzar error (OAuthService ya maneja sus errores, aquí manejamos el fetch de datos)
            throw transport.sanitize(error);
        }
    }
    /** Devuelve el snapshot vigente o comparte la carga en curso. */
    async getRowsCached() {
        const CacheService = require("./CacheService");
        const rows = CacheService.get("MOVMAT_DATA");
        if (rows !== null) return rows;
        return this._loadAndPublish(true);
    }

    /** Recarga explícita: un error del provider no se oculta con otra fuente. */
    async reloadRows() {
        // Esperar cargas anteriores para que una recarga explícita siempre consulte
        // el provider y nunca publique resultados fuera de orden.
        while (this.pendingLoad) {
            try { await this.pendingLoad; } catch (_) { /* La recarga reintenta. */ }
        }
        return this._loadAndPublish(false);
    }

    _loadAndPublish(allowFallback) {
        if (this.pendingLoad) return this.pendingLoad;
        const generation = this.cacheGeneration;
        const pending = this._loadRows(allowFallback).then(({ rows, ttl }) => {
            if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) {
                throw new Error("Data provider must return an array of records");
            }
            // clearCache puede haber invalidado esta carga mientras esperaba I/O.
            if (generation === this.cacheGeneration) {
                const CacheService = require("./CacheService");
                this._invalidateDerivedCaches();
                CacheService.set("MOVMAT_DATA", rows, ttl);
            }
            return rows;
        }).finally(() => {
            if (this.pendingLoad === pending) this.pendingLoad = null;
        });
        this.pendingLoad = pending;
        return pending;
    }

    async _loadRows(allowFallback) {
        try {
            const provider = getDataProvider();
            const rows = await provider.loadData();
            if (provider === require('../providers/CsvProvider')) numeric.assertCsvContext(rows);
            return { rows, ttl: 24 * 60 * 60 * 1000 };
        } catch (err) {
            if (err instanceof require('./CsvSchemaService').SchemaError || err instanceof transport.ODataTransportError || !allowFallback || !config.datasphere.exportUrl) throw err;
            const ExportService = require("./ExportService");
            const { parse } = require("csv-parse/sync");
            const { normalizeHeader } = require("../utils/helpers");
            const buffer = await ExportService.exportToCsvBuffer({ resourcePath: config.datasphere.movMatPath });
            return {
                rows: numeric.registerSource(parse(buffer, {
                    columns: header => header.map(normalizeHeader),
                    skip_empty_lines: true,
                    trim: true,
                    relax_quotes: true
                }), 'EXPORT'),
                ttl: 10 * 60 * 1000
            };
        }
    }

    _invalidateDerivedCaches() {
        require("./QueryService").invalidateIndex();
        require("./DatasetProfileService").clearProfileCache();
    }

    clearCache() {
        this.cacheGeneration++;
        this.pendingLoad = null;
        require("./CacheService").del("MOVMAT_DATA");
        this._invalidateDerivedCaches();
    }
}

module.exports = new DataService();
