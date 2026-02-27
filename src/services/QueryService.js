const CacheService = require("./CacheService");
const DataService = require("./DataService");
const IndexService = require("./IndexService");

class QueryService {

    constructor() {
        this.INDEX_CACHE_KEY = "MOVMAT_INDEX_V1";
    }

    /**
     * Obtiene o crea el índice desde la caché o fuente de datos.
     */
    _getIndex() {
        let index = CacheService.get(this.INDEX_CACHE_KEY);
        if (!index) {
            console.log("QueryService: Index missing, rebuilding...");
            // Cargar datos completos
            // Asumimos que DataService tiene la lógica de la fuente de verdad (cargar del fs)
            // Pero idealmente lo obtenemos primero de CacheService("MOVMAT_DATA")
            let rows = CacheService.get("MOVMAT_DATA");
            if (!rows) {
                rows = DataService.loadMovMatCsv();
                CacheService.set("MOVMAT_DATA", rows, 24 * 60 * 60 * 1000);
            }

            index = IndexService.buildIndexes(rows);
            CacheService.set(this.INDEX_CACHE_KEY, index, 24 * 60 * 60 * 1000); // 24 horas
        }
        return index;
    }

    /**
     * Cuenta los centros distintos para una fecha específica.
     * @param {string} dateKey - YYYY-MM-DD
     */
    countDistinctCentersByDate(dateKey) {
        const index = this._getIndex();
        const centersSet = index.centersByDate.get(dateKey);

        if (!centersSet) {
            return {
                date: dateKey,
                distinctCenters: 0,
                sampleCenters: []
            };
        }

        const distinctCenters = centersSet.size;
        const sampleCenters = Array.from(centersSet).slice(0, 10);

        return {
            date: dateKey,
            distinctCenters,
            sampleCenters
        };
    }

    /**
     * Función auxiliar para invalidar el índice (se llama al recargar CSV)
     */
    invalidateIndex() {
        CacheService.del(this.INDEX_CACHE_KEY);
    }
}

module.exports = new QueryService();
