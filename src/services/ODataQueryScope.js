// Closed contracts, not an OData filter parser. Only these plans can certify a subset.
function normalize(scope) {
    const keys = { DATE: ['kind', 'date'], DATE_GROUP: ['kind', 'date', 'group'], RANGE: ['kind', 'from', 'to'] };
    const expected = scope && Object.hasOwn(keys, scope.kind) && keys[scope.kind];
    const invalid = () => { throw new (require('./ODataPaginationService').PaginationError)('INCOMPATIBLE_SCOPE', true); };
    if (!expected || Object.keys(scope).length !== expected.length || expected.some(k => !Object.hasOwn(scope, k))) invalid();
    const result = Object.fromEntries(expected.map(k => [k, scope[k]]));
    for (const key of expected.filter(k => ['date', 'from', 'to'].includes(k))) {
        const value = result[key];
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) invalid();
    }
    if (result.kind === 'DATE_GROUP' && (typeof result.group !== 'string' || !result.group.trim())) invalid();
    if (result.kind === 'RANGE' && result.from > result.to) invalid();
    return Object.freeze(result);
}
function filter(scope) {
    scope = normalize(scope);
    if (scope.kind === 'RANGE') return `FECHA ge ${scope.from} and FECHA le ${scope.to}`;
    const date = `FECHA eq ${scope.date}`;
    return scope.kind === 'DATE' ? date : `${date} and GRUPO_ARTICULOS eq '${scope.group.replace(/'/g, "''")}'`;
}
function matches(actual, requested) {
    requested = normalize(requested);
    return actual && Object.keys(requested).length === Object.keys(actual).length && Object.keys(requested).every(k => requested[k] === actual[k]);
}
function assertGroupRows(rows, scope) {
    if (scope?.kind !== 'DATE_GROUP') return;
    if (rows.some(row => typeof row.GRUPO_ARTICULOS !== 'string' || row.GRUPO_ARTICULOS !== scope.group)) {
        throw new (require('./ODataPaginationService').PaginationError)('SCOPE_PAYLOAD_MISMATCH');
    }
}
module.exports = { normalize, filter, matches, assertGroupRows };
