const CacheService = require("./CacheService");
const DataService = require("./DataService");
const IndexService = require("./IndexService");

class QueryService {

    constructor() {
        this.INDEX_CACHE_KEY = "MOVMAT_INDEX_V1";
    }

    /**
     * Gets or creates the index from cache/source.
     */
    _getIndex() {
        let index = CacheService.get(this.INDEX_CACHE_KEY);
        if (!index) {
            console.log("QueryService: Index missing, rebuilding...");
            // Load full data
            // We assume DataService has the source of truth logic (fs load)
            // But ideally we get it from CacheService("MOVMAT_DATA") first
            let rows = CacheService.get("MOVMAT_DATA");
            if (!rows) {
                rows = DataService.loadMovMatCsv();
                CacheService.set("MOVMAT_DATA", rows, 24 * 60 * 60 * 1000);
            }

            index = IndexService.buildIndexes(rows);
            CacheService.set(this.INDEX_CACHE_KEY, index, 24 * 60 * 60 * 1000); // 24 hours
        }
        return index;
    }

    /**
     * Counts distinct centers for a specific date.
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
     * Helper to invalidate index (called on CSV reload)
     */
    invalidateIndex() {
        CacheService.del(this.INDEX_CACHE_KEY);
    }
}

module.exports = new QueryService();
