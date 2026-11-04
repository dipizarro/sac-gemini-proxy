const reasons = new Set([
    'INVALID_OPTIONS', 'INPUT_LIMIT', 'UNSUPPORTED_ENCODING', 'FORBIDDEN_DECLARATION',
    'INVALID_XML', 'INVALID_STRUCTURE', 'UNSUPPORTED_VERSION', 'DEPTH_LIMIT', 'NODE_LIMIT',
    'ATTRIBUTE_LIMIT', 'TIME_LIMIT', 'MEMORY_LIMIT', 'WORKER_FAILED', 'BUSY',
    'DUPLICATE_DECLARATION', 'UNRESOLVED_REFERENCE', 'UNSUPPORTED_STRUCTURE',
    'CYCLIC_INHERITANCE', 'INVALID_FACET', 'ENTITY_SET_NOT_FOUND', 'AMBIGUOUS_ENTITY_SET'
]);
class CsdlError extends Error {
    constructor(reason) {
        super('No se pudo interpretar de forma segura el contrato CSDL.');
        this.code = 'CSDL_READER_ERROR';
        this.details = { reason: reasons.has(reason) ? reason : 'WORKER_FAILED' };
    }
}
function fail(reason) { throw new CsdlError(reason); }
module.exports = { CsdlError, fail };
