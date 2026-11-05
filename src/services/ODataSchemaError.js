class ODataSchemaError extends Error {
    constructor(reason, kind = 'schema') {
        super('No se pudo validar el contrato estructural OData.');
        this.code = kind === 'unavailable' ? 'METADATA_UNAVAILABLE' : kind === 'metadata' ? 'ODATA_METADATA_ERROR' : 'SCHEMA_CONTRACT_MISMATCH';
        this.statusCode = kind === 'unavailable' ? 503 : 502;
        this.details = { source: 'ODATA', reason };
    }
}
module.exports = ODataSchemaError;
