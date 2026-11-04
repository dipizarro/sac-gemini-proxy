const { toNumberSmart } = require('./helpers');
// Identidad del snapshot, sin campos extra en filas/JSON ni dependencia de DATA_SOURCE.
const csvProfiles = new WeakMap();

function registerCsv(rows, profiles) {
    csvProfiles.set(rows, Object.freeze({ ...profiles }));
    return rows;
}

function parseMetric(input, profile) {
    if (input === undefined) return { status: 'invalid', reason: 'MISSING_FIELD' };
    if (input === null || (typeof input === 'string' && input.trim() === '')) {
        return { status: 'missing', reason: 'MISSING_VALUE' };
    }
    if (profile !== 'csv-integer-comma') return { status: 'ambiguous', reason: 'UNCONFIGURED_PROFILE' };
    if (typeof input !== 'string' && typeof input !== 'number') return { status: 'invalid', reason: 'INVALID_TYPE' };
    let value = input;
    if (typeof input === 'string') {
        const text = input.trim();
        if (text.length > 64) return { status: 'invalid', reason: 'INPUT_TOO_LONG' };
        if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) {
            return { status: 'invalid', reason: 'INVALID_FORMAT' };
        }
        value = Number(text.replace(/,/g, ''));
    }
    if (!Number.isSafeInteger(value)) return { status: 'invalid', reason: 'UNSAFE_INTEGER' };
    return { status: 'valid', value: value === 0 ? 0 : value };
}

class DataQualityError extends Error {
    constructor(reason, status = 'invalid') {
        super('No se puede calcular una métrica fiable con los datos disponibles.');
        this.code = 'DATA_QUALITY_ERROR';
        this.statusCode = 500;
        this.isOperational = true;
        this.details = { source: 'CSV', status, reason };
    }
}

function isCsv(rows) { return csvProfiles.has(rows); }

function readMetric(rows, row, key) {
    if (!isCsv(rows)) return toNumberSmart(row[key]);
    const profiles = csvProfiles.get(rows);
    const profile = Object.hasOwn(profiles, key) ? profiles[key] : undefined;
    const parsed = parseMetric(row[key], profile);
    if (parsed.status !== 'valid') throw new DataQualityError(parsed.reason, parsed.status);
    return parsed.value;
}

function checkedInteger(rows, value) {
    if (isCsv(rows) && !Number.isSafeInteger(value)) throw new DataQualityError('UNSAFE_AGGREGATE');
    return value;
}

function add(rows, a, b) { return checkedInteger(rows, a + b); }
function difference(rows, a, b) { return checkedInteger(rows, Math.abs(a - b)); }

module.exports = { parseMetric, registerCsv, isCsv, readMetric, add, difference, DataQualityError };
