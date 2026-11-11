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
function requireComplete(rows, collection = false) {
    const held = contexts.get(rows);
    if (!held || held.coverage.status !== 'COMPLETE' || !['COMPLETE_COLLECTION', 'COMPLETE_FILTERED'].includes(held.coverage.mode)) fail();
    if (collection && held.coverage.mode !== 'COMPLETE_COLLECTION') fail('INCOMPLETE_SCOPE');
    if (rows.length !== held.identities.length || held.identities.some((row, i) => rows[i] !== row)) fail('SNAPSHOT_CHANGED');
    require('./ODataSchemaService').assertSnapshot(rows);
    return held.coverage;
}
function assertAnalytic(rows) {
    if (require('../utils/numeric').hasODataOrigin(rows)) requireComplete(rows);
}
module.exports = { register, get, requireComplete, assertAnalytic };
