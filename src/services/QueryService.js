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
    async _getIndex() {
        // Comprobar primero el dataset: su TTL puede vencer antes que el índice.
        const rows = await DataService.getRowsCached();
        let index = CacheService.get(this.INDEX_CACHE_KEY);
        if (!index || this.indexRows !== rows) {
            index = IndexService.buildIndexes(rows);
            // Un lector de un snapshot anterior puede finalizar tras una recarga.
            if (CacheService.get("MOVMAT_DATA") === rows) {
                this.indexRows = rows;
                CacheService.set(this.INDEX_CACHE_KEY, index, 24 * 60 * 60 * 1000);
            }
        }
        return index;
    }

    /**
     * Cuenta los centros distintos para una fecha específica.
     * @param {string} dateKey - YYYY-MM-DD
     */
    async countDistinctCentersByDate(dateKey) {
        const index = await this._getIndex();
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
        this.indexRows = null;
    }
}

module.exports = new QueryService();
