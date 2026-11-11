const contexts = new WeakMap();
function fail(reason = 'UNVALIDATED_COVERAGE') {
    throw new (require('./ODataPaginationService').PaginationError)(reason, true);
}
// Internal publication hook, used only after successful pagination/schema validation.
function register(rows, coverage) {
    require('./ODataSchemaService').assertSnapshot(rows);
    contexts.set(rows, { coverage, identities: rows.slice() });
    return rows;
}
function get(rows) { return contexts.get(rows)?.coverage; }
function requireComplete(rows, scope = true) {
    const held = contexts.get(rows);
    if (!held || held.coverage.status !== 'COMPLETE' || !['COMPLETE_COLLECTION', 'COMPLETE_FILTERED'].includes(held.coverage.mode)) fail();
    if (held.coverage.mode !== 'COMPLETE_COLLECTION' &&
        (!scope || typeof scope !== 'object' || !require('./ODataQueryScope').matches(require('../providers/ODataProvider').scopeFor(rows), scope))) fail('INCOMPLETE_SCOPE');
    if (rows.length !== held.identities.length || held.identities.some((row, i) => rows[i] !== row)) fail('SNAPSHOT_CHANGED');
    require('./ODataSchemaService').assertSnapshot(rows);
    return held.coverage;
}
function assertAnalytic(rows, scope = true) {
    if (require('../utils/numeric').hasODataOrigin(rows)) requireComplete(rows, scope);
}
module.exports = { register, get, requireComplete, assertAnalytic };
