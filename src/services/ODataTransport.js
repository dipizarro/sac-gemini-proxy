const numeric = require('../utils/numeric');
const FORMAT = 'application/json;IEEE754Compatible=true';
class ODataTransportError extends Error {
    constructor(reason) {
        super('La respuesta OData no cumple el contrato de transporte.');
        this.code = 'ODATA_TRANSPORT_ERROR';
        this.statusCode = 502;
        this.details = { source: 'ODATA', reason };
    }
}
function register(rows) { return numeric.registerSource(rows, 'ODATA', { SUMA_NETA: 'odata-int64' }); }
function count(value) {
    const parsed = numeric.parseMetric(value, 'odata-int64');
    if (parsed.status !== 'valid' || parsed.value < 0) throw new ODataTransportError('INVALID_COUNT');
    return parsed.value;
}
async function read(response) {
    if (!response.ok) throw new ODataTransportError('HTTP_ERROR');
    const parts = (response.headers.get('content-type') || '').split(';').map(s => s.trim());
    const flags = parts.slice(1).filter(s => /^IEEE754Compatible\s*=/i.test(s));
    if (parts[0].toLowerCase() !== 'application/json' || flags.length !== 1 || !/^IEEE754Compatible\s*=\s*(?:true|"true")$/i.test(flags[0])) throw new ODataTransportError('CONTENT_TYPE');
    const version = response.headers.get('odata-version');
    if (version && !/^4\.(?:0|01)$/.test(version)) throw new ODataTransportError('VERSION');
    let body;
    try { body = await response.json(); } catch { throw new ODataTransportError('INVALID_JSON'); }
    if (!body || !Array.isArray(body.value)) throw new ODataTransportError('INVALID_PAYLOAD');
    for (const row of body.value) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new ODataTransportError('INVALID_RECORD');
        if (row.SUMA_NETA !== undefined && row.SUMA_NETA !== null && typeof row.SUMA_NETA !== 'string') throw new ODataTransportError('INT64_REPRESENTATION');
    }
    if (Object.hasOwn(body, '@odata.count')) count(body['@odata.count']);
    register(body.value);
    return body;
}
function sanitize(error) { return error instanceof ODataTransportError ? error : new ODataTransportError('REQUEST_FAILED'); }
module.exports = { FORMAT, read, register, count, sanitize, ODataTransportError };
