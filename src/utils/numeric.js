const { toNumberSmart } = require('./helpers');
// Identidad del snapshot, sin campos extra en filas/JSON ni dependencia de DATA_SOURCE.
const csvProfiles = new WeakMap();
const sources = new WeakMap();
function registerSource(rows, source, profiles = {}) {
    sources.set(rows, source);
    csvProfiles.set(rows, Object.freeze({ ...profiles }));
    return rows;
}
function isStrict(rows) { return csvProfiles.has(rows); }
function qualityError(rows, reason, status) { return new DataQualityError(reason, status, sources.get(rows)); }

function registerCsv(rows, profiles) {
    return registerSource(rows, 'CSV', profiles);
}

function parseMetric(input, profile) {
    if (profile === 'odata-int64') {
        if (input === undefined) return { status: 'invalid', reason: 'MISSING_FIELD' };
        if (input === null) return { status: 'missing', reason: 'MISSING_VALUE' };
        if (typeof input !== 'string' || input.length > 20 || !/^-?(?:0|[1-9]\d*)$/.test(input)) return { status: 'invalid', reason: 'INVALID_FORMAT' };
        const value = Number(input);
        return Number.isSafeInteger(value) ? { status: 'valid', value: value === 0 ? 0 : value } : { status: 'invalid', reason: 'UNSAFE_INTEGER' };
    }
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
    constructor(reason, status = 'invalid', source = 'CSV') {
        super('No se puede calcular una métrica fiable con los datos disponibles.');
        this.code = 'DATA_QUALITY_ERROR';
        this.statusCode = 500;
        this.isOperational = true;
        this.details = { source, status, reason };
    }
}

function isCsv(rows) { return sources.get(rows) === 'CSV'; }

function readMetric(rows, row, key) {
    if (!isStrict(rows)) return toNumberSmart(row[key]);
    const profiles = csvProfiles.get(rows);
    const profile = Object.hasOwn(profiles, key) ? profiles[key] : undefined;
    const parsed = parseMetric(row[key], profile);
    if (parsed.status !== 'valid') throw qualityError(rows, parsed.reason, parsed.status);
    return parsed.value;
}

function checkedInteger(rows, value) {
    if (isStrict(rows) && !Number.isSafeInteger(value)) throw qualityError(rows, 'UNSAFE_AGGREGATE');
    return value;
}

function add(rows, a, b) { return checkedInteger(rows, a + b); }
function difference(rows, a, b) { return checkedInteger(rows, Math.abs(a - b)); }

module.exports = { registerSource, isStrict, qualityError, parseMetric, registerCsv, isCsv, readMetric, add, difference, DataQualityError };
