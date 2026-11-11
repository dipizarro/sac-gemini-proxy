const pagination = require('../services/ODataPaginationService');
const coverage = require('../services/ODataCoverageService');
const capabilities = require('../services/ODataCapabilities');
const schema = require('../services/ODataSchemaService');
const queryScopes = new WeakMap();

class ODataProvider {
    scopeFor(rows) { return queryScopes.get(rows); }
    async traverse(options) {
        const capability = capabilities.forConfiguredAsset();
        if (['COMPLETE_COLLECTION', 'COMPLETE_FILTERED'].includes(options.mode) && !capability.continuationSupported) {
            throw new pagination.PaginationError('CONTINUATION_UNCERTIFIED', true);
        }
        if (options.mode === 'SERVER_COUNT' && !capability.serverCount) throw new pagination.PaginationError('COUNT_UNCERTIFIED', true);
        return pagination.traverse({ ...options, continuationSupported: capability.continuationSupported });
    }
    async fetchAllMovMatData({ forceMetadata = false } = {}) {
        const result = await this.traverse({ mode: 'COMPLETE_COLLECTION', forceMetadata, normalize: true });
        coverage.requireComplete(result.rows, true);
        return result.rows;
    }
    loadData(options) { return this.fetchAllMovMatData(options); }
    assertSnapshot(rows) { schema.assertSnapshot(rows); coverage.requireComplete(rows, true); }
    async executeFilteredQuery({ filter, select, top, orderby, count, scope } = {}) {
        if (scope !== undefined) {
            if (filter !== undefined) throw new pagination.PaginationError('INCOMPATIBLE_SCOPE', true);
            scope = require('../services/ODataQueryScope').normalize(scope);
            filter = require('../services/ODataQueryScope').filter(scope);
        }
        const mode = count ? 'SERVER_COUNT' : top !== undefined && top !== null ? 'TOP_N' : filter ? 'COMPLETE_FILTERED' : 'COMPLETE_COLLECTION';
        const result = await this.traverse({ mode, filter, select, orderby, ...(mode === 'TOP_N' ? { top } : {}), normalize: true });
        if (scope && mode === 'COMPLETE_FILTERED') queryScopes.set(result.rows, scope);
        return count ? result.count : result.rows;
    }
}
module.exports = new ODataProvider();
