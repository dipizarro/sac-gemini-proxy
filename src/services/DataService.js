const fs = require("fs");
const path = require("path");
const iconv = require("iconv-lite");
const { parse } = require("csv-parse/sync");
const { normalizeHeader, toNumberSmart } = require("../utils/helpers");
const OAuthService = require("./OAuthService");
const config = require("../config/config");

class DataService {
    constructor() {
        this.csvPath = path.join(process.cwd(), "data", "3V_MM_MOVMAT_01_3M.csv");
    }

    loadByPath(filePath) { // Para pruebas o flexibilidad
        const raw = fs.readFileSync(filePath);
        const text = iconv.decode(raw, "utf8");
        const lines = text.split(/\r?\n/);

        // 1. Busca la fila del header real (la que contiene MATERIAL1)
        let headerIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes("MATERIAL1")) {
                headerIdx = i;
                break;
            }
        }

        if (headerIdx === -1) throw new Error("No encontré el header real (MATERIAL1) en el CSV.");

        // 2. Extraer el header base "h2"
        const h2Raw = lines[headerIdx];
        const h2Array = parse(h2Raw, { delimiter: ',', columns: false, relax_quotes: true })[0] || [];
        let finalHeaders = [...h2Array];
        let isDoubleHeader = false;

        // 3. Detectar si la fila inmediatamente superior tiene variables rezagadas como SUMA_NETA
        if (headerIdx > 0) {
            const lineAbove = lines[headerIdx - 1];
            if (lineAbove.includes("SUMA_NETA") || lineAbove.includes("Indicadores")) {
                isDoubleHeader = true;
                const h1Array = parse(lineAbove, { delimiter: ',', columns: false, relax_quotes: true })[0] || [];

                // Mezclamos rescatando valores de h1 sobre los huecos vacíos de h2
                for (let i = 0; i < h2Array.length; i++) {
                    const h2Val = h2Array[i] ? h2Array[i].trim() : "";
                    const h1Val = h1Array[i] ? h1Array[i].trim() : "";
                    if (h2Val === "" && h1Val !== "") {
                        finalHeaders[i] = h1Val;
                    }
                }
            }
        }

        // 4. Trimming de columnas basura al inicio (e.g. `,,MATERIAL1`)
        let leadingEmpty = 0;
        for (let i = 0; i < finalHeaders.length; i++) {
            if (!finalHeaders[i] || finalHeaders[i].trim() === "") {
                leadingEmpty++;
            } else {
                break;
            }
        }

        const normalizedHeaders = finalHeaders.slice(leadingEmpty).map(normalizeHeader);

        console.log(`[CSV] headerMode=${isDoubleHeader ? 'double' : 'single'}, leadingEmpty=${leadingEmpty}`);

        // 5. Unir y parsear sólamente la data en bruto post-header
        const dataStr = lines.slice(headerIdx + 1).join("\n");
        let rows = [];

        if (leadingEmpty > 0) {
            // Leer como array crudo (no dicta keys automáticamente) para rebanar columnas basura
            const rawRecords = parse(dataStr, {
                bom: true,
                delimiter: ",",
                skip_empty_lines: true,
                relax_quotes: true,
                relax_column_count: true,
                columns: false
            });

            rows = rawRecords.map(record => {
                const trimmedRecord = record.slice(leadingEmpty);
                const obj = {};
                normalizedHeaders.forEach((header, index) => {
                    obj[header] = trimmedRecord[index];
                });
                return obj;
            });
        } else {
            // Funcionamiento habitual limpio
            rows = parse(dataStr, {
                bom: true,
                delimiter: ",",
                skip_empty_lines: true,
                relax_quotes: true,
                relax_column_count: true,
                trim: true,
                columns: normalizedHeaders
            });
        }

        return rows;
    }

    loadMovMatCsv() {
        return this.loadByPath(this.csvPath);
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

    getInsights() {
        try {
            const rows = this.loadMovMatCsv();

            // Preview se ve que SUMA_NETA está en COL_8
            const SUM_KEY = "COL_8";

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
     * Obtains rows from cache or loads them from CSV.
     * @returns {Array} rows
     */
    async getRowsCached() {
        const CacheService = require("./CacheService");
        const config = require("../config/config");
        const CACHE_KEY = "MOVMAT_DATA";
        let rows = CacheService.get(CACHE_KEY);

        if (!rows) {
            try {
                console.log("DataService: Cache miss, loading local CSV...");
                rows = this.loadMovMatCsv();
                if (rows && rows.length > 0) {
                    CacheService.set(CACHE_KEY, rows, 24 * 60 * 60 * 1000);
                }
            } catch (csvErr) {
                console.warn("Local CSV load failed:", csvErr.message);

                if (config.datasphere.exportUrl) {
                    console.log("Fetching from Datasphere Export Service...");
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
                        CacheService.set(CACHE_KEY, rows, 10 * 60 * 1000); // 10 min for live data
                    }
                } else {
                    throw new Error("No hay datos en caché, el CSV local falló y no hay URL de exportación configurada.");
                }
            }
        }
        return rows || [];
    }

    clearCache() {
        const CacheService = require("./CacheService");
        CacheService.del("MOVMAT_DATA");
        // Clean dependent items like the dataset profile
        const DatasetProfileService = require("./DatasetProfileService");
        DatasetProfileService.clearProfileCache();
        console.log("DataService: All local caches cleared.");
    }
}

module.exports = new DataService();
