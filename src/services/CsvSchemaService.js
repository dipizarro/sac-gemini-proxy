const { parse } = require('csv-parse/sync');
const { normalizeHeader } = require('../utils/helpers');
const contract = require('../config/csvContract');
class SchemaError extends Error {
    constructor(reason) {
        super('La estructura CSV no cumple el contrato esperado.');
        this.code = 'SCHEMA_CONTRACT_MISMATCH'; this.statusCode = 500;
        this.details = { source: 'CSV', reason };
    }
}
function fail(reason) { throw new SchemaError(reason); }
function decode(text) {
    let records;
    try {
        // Solo tolerancia durante reconocimiento: no se mapea ningún objeto aún.
        records = parse(text, { bom: true, columns: false, skip_empty_lines: true, relax_column_count: true });
    } catch { fail('INVALID_ROW_STRUCTURE'); }
    const candidates = records.map((r, i) => r.some(c => c.trim() === 'MATERIAL1') ? i : -1).filter(i => i >= 0);
    if (candidates.length !== 1) fail('INCOMPATIBLE_COLUMN_LAYOUT');
    const start = candidates[0];
    const raw = records[start].map(c => c.trim());
    const above = records[start - 1];
    if (above && above.some(c => ['SUMA_NETA', 'Indicadores'].includes(c.trim()))) {
        if (above.length !== raw.length) fail('INCOMPATIBLE_COLUMN_LAYOUT');
        for (let i = 0; i < raw.length; i++) {
            const upper = above[i].trim();
            if (!raw[i] && upper) raw[i] = upper;
            else if (upper === 'SUMA_NETA' && raw[i] !== 'SUMA_NETA') fail('INCOMPATIBLE_COLUMN_LAYOUT');
        }
    }
    let padding = 0;
    while (padding < raw.length && raw[padding] === '') padding++;
    if (!contract.leadingPadding.includes(padding)) fail('INCOMPATIBLE_COLUMN_LAYOUT');
    const names = raw.slice(padding).map(normalizeHeader);
    if (new Set(names).size !== names.length) fail('DUPLICATE_COLUMN');
    const alias = !names.includes('SUMA_NETA') && raw.includes(contract.metricAlias);
    for (const key of contract.required) if (!names.includes(key) && !(key === 'SUMA_NETA' && alias)) fail('MISSING_REQUIRED_COLUMN');
    const roles = Object.fromEntries(contract.required.map(k => [k, k]));
    const rows = records.slice(start + 1).map(record => {
        if (record.length !== raw.length) fail('INVALID_ROW_STRUCTURE');
        if (record.slice(0, padding).some(c => c.trim() !== '')) fail('INCOMPATIBLE_COLUMN_LAYOUT');
        const result = Object.fromEntries(names.map((name, i) => [name, record[i + padding]]));
        // Layout de alias explícito: preservar COL_8 y exponer el rol canónico.
        if (alias) result.SUMA_NETA = result[contract.metricAlias];
        return result;
    });
    return { rows, columns: alias ? [...names, 'SUMA_NETA'] : names, roles, revision: contract.revision };
}
module.exports = { decode, SchemaError, fail };
