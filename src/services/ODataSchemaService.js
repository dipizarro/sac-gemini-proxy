const metadata = require('./ODataMetadataService');
const contract = require('../config/odataContract');
const ErrorType = require('./ODataSchemaError');
const { normalizeHeader } = require('../utils/helpers');
const transport = require('./ODataTransport');
const { randomUUID } = require('crypto');
const contexts = new WeakMap(), tickets = new WeakMap();
const supported = new Set(['Edm.String', 'Edm.Date', 'Edm.Int32', 'Edm.Int16', 'Edm.Byte', 'Edm.SByte', 'Edm.Int64', 'Edm.Decimal', 'Edm.Boolean', 'Edm.Double', 'Edm.Single']);
const fail = reason => { throw new ErrorType(reason); };

function selected(select, model, count) {
    if (count) return [];
    if (!select || select === '*' || (Array.isArray(select) && !select.length)) return model.properties.map(p => p.name);
    const list = Array.isArray(select) ? select : String(select).split(',');
    const names = list.map(s => String(s).trim());
    if (names.some(s => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) || new Set(names).size !== names.length) fail('UNSUPPORTED_PROJECTION');
    return names;
}
function referenced(expression, ordering = false) {
    if (!expression) return [];
    // Only identify property references; SAP remains responsible for evaluating the filter.
    const text = String(expression).replace(/'(?:[^']|'')*'/g, '');
    if (text.includes("'") || /[/@]/.test(text)) fail('UNSUPPORTED_QUERY');
    const keywords = new Set(['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'and', 'or', 'not', 'null', 'true', 'false', ...(ordering ? ['asc', 'desc'] : [])]);
    return [...new Set((text.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || []).filter(s => !keywords.has(s)))];
}
function semanticCheck(p) {
    const display = new Set(['com.sap.vocabularies.Common.v1.Label', 'com.sap.vocabularies.Common.v1.QuickInfo', 'Org.OData.Core.V1.Description', 'Org.OData.Core.V1.LongDescription']);
    if (p.name === 'SUMA_NETA' && p.annotations.some(a => !display.has(a.term))) fail('INCOMPATIBLE_SEMANTICS');
    if (p.annotations.some(a => ['Org.OData.Measures.V1.Unit', 'Org.OData.Measures.V1.ISOCurrency', 'Org.OData.Measures.V1.Scale'].includes(a.term))) fail('INCOMPATIBLE_SEMANTICS');
}
async function prepare({ base, force = false, select, count = false, filter, orderby } = {}) {
    const entry = await metadata.get({ base, force });
    const model = entry.model, properties = new Map(model.properties.map(p => [p.name, p]));
    const normalized = new Set();
    for (const p of model.properties) {
        const name = normalizeHeader(p.name);
        if (normalized.has(name) || p.name.startsWith('__') || p.name.startsWith('@')) fail('COLUMN_COLLISION');
        normalized.add(name);
    }
    const projection = selected(select, model, count);
    const full = !count && (!select || select === '*' || (Array.isArray(select) && !select.length));
    const required = [...new Set([...projection, ...referenced(filter), ...(count ? [] : referenced(orderby, true)), ...(full ? Object.keys(contract.fields) : [])])];
    for (const name of required) {
        const p = properties.get(name);
        if (!p) fail('MISSING_REQUIRED_COLUMN');
        if (!supported.has(p.type)) fail('UNSUPPORTED_PAYLOAD_TYPE');
        const expected = Object.hasOwn(contract.fields, name) ? contract.fields[name] : undefined;
        if (expected) {
            if (p.collection || p.type !== expected.type) fail(name === 'SUMA_NETA' ? 'INCOMPATIBLE_METRIC_TYPE' : 'INCOMPATIBLE_EDM_TYPE');
            if (!expected.nullable && p.nullable) fail('INCOMPATIBLE_NULLABILITY');
            semanticCheck(p);
        }
    }
    // Semantic annotations on the selected entity/container also cannot silently alter measures.
    const relevant = [...model.annotations.container, ...model.annotations.entitySet, ...model.annotations.types.flatMap(t => t.annotations)];
    if (required.includes('SUMA_NETA') && relevant.some(a => a.term.startsWith('Org.OData.Measures.V1.'))) fail('INCOMPATIBLE_SEMANTICS');
    return { entry, properties, projection, count, full };
}
function valueMatches(value, p) {
    if (p.collection) return Array.isArray(value) && value.every(v => valueMatches(v, { ...p, collection: false }));
    if (value === null) return p.nullable;
    if (typeof value === 'object' || value === undefined) return false;
    switch (p.type) {
        case 'Edm.String': return typeof value === 'string' && (typeof p.facets.maxLength !== 'number' || Array.from(value).length <= p.facets.maxLength);
        case 'Edm.Date': return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
        case 'Edm.Int32': return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
        case 'Edm.Int16': return Number.isInteger(value) && value >= -32768 && value <= 32767;
        case 'Edm.Byte': return Number.isInteger(value) && value >= 0 && value <= 255;
        case 'Edm.SByte': return Number.isInteger(value) && value >= -128 && value <= 127;
        // Numeric quality/range remains the responsibility of the approved numeric layer.
        case 'Edm.Int64': case 'Edm.Decimal': return typeof value === 'string';
        case 'Edm.Boolean': return typeof value === 'boolean';
        case 'Edm.Double': case 'Edm.Single': return typeof value === 'number' && Number.isFinite(value);
        default: return false;
    }
}
function validate(rows, ticket, normalized = false) {
    if (!Array.isArray(rows)) fail('PAYLOAD_TYPE_MISMATCH');
    const columns = new Map([...ticket.properties].map(([name, p]) => [normalized ? normalizeHeader(name) : name, p]));
    for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) fail('PAYLOAD_TYPE_MISMATCH');
        for (const name of ticket.projection) if (!Object.hasOwn(row, normalized ? normalizeHeader(name) : name)) fail('MISSING_REQUIRED_COLUMN');
        for (const [name, value] of Object.entries(row)) {
            if (!normalized && (name.startsWith('@odata.') || name.includes('@odata.'))) continue;
            const p = columns.get(name);
            if (!p) fail('UNDECLARED_PROPERTY');
            if (!valueMatches(value, p)) fail('PAYLOAD_TYPE_MISMATCH');
        }
    }
}
function register(rows, ticket, parentSnapshotId, normalized = true) {
    validate(rows, ticket, normalized);
    transport.register(rows);
    contexts.set(rows, Object.freeze({ source: 'ODATA', revision: contract.revision, schemaHash: ticket.entry.hash,
        snapshotId: randomUUID(), parentSnapshotId, projection: Object.freeze([...ticket.projection]), validatedAt: ticket.entry.validatedAt }));
    tickets.set(rows, { ticket, normalized });
    return rows;
}
async function finish(rows, ticket, normalized = true) {
    const entry = await metadata.ensureCurrent(ticket.entry);
    return register(rows, { ...ticket, entry }, undefined, normalized);
}
function assertSnapshot(rows) {
    const held = tickets.get(rows);
    if (!held) fail('UNVALIDATED_SNAPSHOT');
    validate(rows, held.ticket, held.normalized);
    return contexts.get(rows);
}
function copyContext(original, rows) {
    const context = assertSnapshot(original), members = new Set(original);
    if (!Array.isArray(rows) || rows.some(r => !members.has(r))) fail('UNVALIDATED_SNAPSHOT');
    const held = tickets.get(original);
    return register(rows, held.ticket, context.snapshotId, held.normalized);
}
module.exports = { prepare, validate, finish, assertSnapshot, copyContext, context: rows => contexts.get(rows) };
