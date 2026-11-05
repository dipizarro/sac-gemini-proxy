const config = require('../config/config');
const oauth = require('./OAuthService');
const metadata = require('./ODataMetadataService');
const schema = require('./ODataSchemaService');
const SchemaError = require('./ODataSchemaError');
const transport = require('./ODataTransport');
const { performance } = require('node:perf_hooks');

const LIMITS = Object.freeze({ maxPages: 1000, maxRows: 100000, maxResponseBytes: 2 * 1024 * 1024,
    maxBytes: 64 * 1024 * 1024, totalMs: 120000, requestMs: 15000 });
const MODES = Object.freeze(['COMPLETE_COLLECTION', 'COMPLETE_FILTERED', 'SERVER_COUNT', 'TOP_N']);
class PaginationError extends Error {
    constructor(reason, indeterminate = false) {
        super('No se pudo acreditar la cobertura de la consulta OData.');
        this.code = 'ODATA_COMPLETENESS_ERROR';
        this.statusCode = indeterminate ? 503 : 502;
        this.details = { source: 'ODATA', reason };
        this.indeterminate = indeterminate;
    }
}
const fail = (reason, indeterminate) => { throw new PaginationError(reason, indeterminate); };

function limitsFor(overrides = {}) {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) fail('INVALID_OPTIONS');
    for (const [key, value] of Object.entries(overrides)) {
        if (!Object.hasOwn(LIMITS, key) || !Number.isSafeInteger(value) || value < 1 || value > LIMITS[key]) fail('INVALID_OPTIONS');
    }
    return { ...LIMITS, ...overrides };
}
function nextUrl(link, current, authorized) {
    if (typeof link !== 'string' || !link || /[\s\\]/.test(link)) fail('NEXT_LINK_REJECTED');
    let url;
    try { url = new URL(link, current); } catch { fail('NEXT_LINK_REJECTED'); }
    if (url.protocol !== 'https:' || url.origin !== authorized.origin || url.username || url.password ||
        url.hash || url.pathname !== authorized.pathname) fail('NEXT_LINK_REJECTED');
    // Do not touch searchParams: the continuation query belongs to the server.
    return url.href;
}

async function traverse(options = {}) {
    const started = performance.now();
    const coverage = { status: 'INDETERMINATE', mode: MODES.includes(options.mode) ? options.mode : undefined, pages: 0, rows: 0, bytes: 0,
        returnedRows: 0, continuation: { backed: options.continuationSupported === true, followed: 0, terminal: false },
        count: { available: false }, temporalConsistency: 'UNVERIFIED' };
    try {
        const limits = limitsFor(options.limits);
        const { mode, filter, select, orderby, top } = options;
        if (!MODES.includes(mode) || (mode === 'COMPLETE_FILTERED' && (typeof filter !== 'string' || !filter.trim())) ||
            (mode === 'COMPLETE_COLLECTION' && filter) ||
            (mode === 'TOP_N' ? (!Number.isSafeInteger(top) || top < 1 || top > limits.maxRows) : top !== undefined) ||
            (filter !== undefined && typeof filter !== 'string') || (orderby !== undefined && typeof orderby !== 'string') ||
            (options.continuationSupported !== undefined && typeof options.continuationSupported !== 'boolean')) fail('INVALID_OPTIONS');
        const base = config.datasphere.url;
        metadata.endpoint(base);
        const authorized = new URL(base), initial = new URL(base);
        initial.searchParams.set('$format', transport.FORMAT);
        if (filter) initial.searchParams.set('$filter', filter);
        if (mode === 'SERVER_COUNT') { initial.searchParams.set('$count', 'true'); initial.searchParams.set('$top', '0'); }
        else {
            if (select && (!Array.isArray(select) || select.length)) initial.searchParams.set('$select', Array.isArray(select) ? select.join(',') : select);
            if (orderby) initial.searchParams.set('$orderby', orderby);
            if (mode === 'TOP_N') initial.searchParams.set('$top', String(top));
        }
        // This scope is internal and may contain filter literals. Never attach it to errors/logs.
        coverage.scope = Object.freeze({ filter: filter || null, select: Array.isArray(select) ? Object.freeze([...select]) : select || null,
            orderby: mode === 'SERVER_COUNT' ? null : orderby || null, top: mode === 'TOP_N' ? top : null });
        const remaining = () => {
            const value = limits.totalMs - (performance.now() - started);
            if (value <= 0) fail('GLOBAL_TIMEOUT', true);
            return value;
        };
        async function bounded(task, request = false) {
            const left = remaining(), duration = request ? Math.min(left, limits.requestMs) : left;
            const reason = request && limits.requestMs < left ? 'REQUEST_TIMEOUT' : 'GLOBAL_TIMEOUT';
            const controller = new AbortController(), began = performance.now(); let timer;
            try {
                const result = await Promise.race([
                    Promise.resolve().then(() => task(controller.signal)),
                    new Promise((_, reject) => { timer = setTimeout(() => {
                        controller.abort(); reject(new PaginationError(reason, true));
                    }, duration); })
                ]);
                // Synchronous parsing/validation can delay timer callbacks.
                if (performance.now() - began >= duration) {
                    controller.abort(); fail(reason, true);
                }
                return result;
            } finally { clearTimeout(timer); }
        }
        const ticket = await bounded(() => schema.prepare({ base, select, filter, orderby, count: mode === 'SERVER_COUNT', force: options.forceMetadata === true }));
        const token = await bounded(() => oauth.getAccessToken());
        const rows = [], visited = new Set(); let current = initial.href;
        while (true) {
            remaining();
            if (coverage.pages >= limits.maxPages) fail('PAGE_LIMIT', true);
            if (visited.has(current)) fail('CONTINUATION_CYCLE');
            if (visited.size) coverage.continuation.followed++;
            visited.add(current);
            const body = await bounded(async signal => {
                const response = await fetch(current, { method: 'GET', redirect: 'error', signal,
                    headers: { Accept: transport.FORMAT, Authorization: `Bearer ${token}` } });
                try {
                    if (response.redirected || (response.status >= 300 && response.status < 400)) fail('REDIRECT_REJECTED');
                    // Do not read HTTP error bodies; they may contain sensitive diagnostics.
                    if (!response.ok) return transport.read(response);
                    const length = response.headers.get('content-length');
                    if (length && (!/^\d+$/.test(length) || Number(length) > limits.maxResponseBytes)) fail('RESPONSE_BYTE_LIMIT', true);
                    if (length && Number(length) > limits.maxBytes - coverage.bytes) fail('TOTAL_BYTE_LIMIT', true);
                    if (!response.body) throw new transport.ODataTransportError('INVALID_JSON');
                    const reader = response.body.getReader(), chunks = []; let size = 0;
                    const cancel = () => { reader.cancel().catch(() => {}); };
                    signal.addEventListener('abort', cancel, { once: true });
                    try {
                        while (true) {
                            if (signal.aborted) fail('REQUEST_TIMEOUT', true);
                            const { value, done } = await reader.read();
                            if (done) break;
                            size += value.byteLength; coverage.bytes += value.byteLength;
                            if (size > limits.maxResponseBytes) fail('RESPONSE_BYTE_LIMIT', true);
                            if (coverage.bytes > limits.maxBytes) fail('TOTAL_BYTE_LIMIT', true);
                            chunks.push(Buffer.from(value));
                        }
                    } finally { signal.removeEventListener('abort', cancel); cancel(); }
                    remaining();
                    // JSON parsing happens only after the decompressed body has been bounded.
                    return await transport.read({ ok: response.ok, headers: response.headers,
                        json: async () => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) });
                } finally {
                    if (response.body && !response.body.locked) response.body.cancel().catch(() => {});
                }
            }, true);
            remaining();
            schema.validate(body.value, ticket, false);
            coverage.pages++; coverage.rows += body.value.length;
            if (coverage.rows > limits.maxRows) fail('ROW_LIMIT', true);
            if (Object.hasOwn(body, '@odata.count')) {
                const count = transport.count(body['@odata.count']);
                if (coverage.count.available && coverage.count.value !== count) fail('COUNT_MISMATCH');
                coverage.count = { available: true, value: count };
            }
            const hasNext = Object.hasOwn(body, '@odata.nextLink');
            const next = hasNext ? nextUrl(body['@odata.nextLink'], current, authorized) : null;
            if (next && visited.has(next)) fail('CONTINUATION_CYCLE');
            coverage.continuation.terminal = !hasNext;
            if (mode === 'SERVER_COUNT') {
                if (!coverage.count.available) fail('COUNT_UNAVAILABLE', true);
                if (body.value.length || hasNext) fail('INVALID_COUNT_RESPONSE');
                coverage.termination = 'SERVER_COUNT'; coverage.status = 'COMPLETE';
                break;
            }
            const capacity = mode === 'TOP_N' ? top - rows.length : body.value.length;
            for (let i = 0; i < Math.min(capacity, body.value.length); i++) rows.push(body.value[i]);
            if (coverage.count.available && coverage.count.value < coverage.rows) fail('COUNT_MISMATCH');
            if (mode === 'TOP_N' && rows.length === top) {
                coverage.status = 'LIMITED'; coverage.termination = 'TOP_N_REACHED'; break;
            }
            if (!next) {
                if (!coverage.continuation.backed) fail('INCOMPLETE_RESULT', true);
                if (coverage.count.available) {
                    coverage.count.matched = coverage.count.value === coverage.rows;
                    if (!coverage.count.matched) fail('COUNT_MISMATCH');
                }
                coverage.status = mode === 'TOP_N' ? 'LIMITED' : 'COMPLETE';
                coverage.termination = 'SERVER_EXHAUSTED'; break;
            }
            current = next;
        }
        // Reuses the approved metadata TTL/revalidation policy; it is not a data snapshot guarantee.
        await bounded(() => schema.finish(rows, ticket, false));
        remaining();
        coverage.returnedRows = rows.length;
        coverage.structural = 'VALIDATED'; coverage.numericQuality = 'NOT_EVALUATED';
        Object.freeze(coverage.count); Object.freeze(coverage.continuation); Object.freeze(coverage);
        return { rows, ...(mode === 'SERVER_COUNT' ? { count: coverage.count.value } : {}), coverage };
    } catch (cause) {
        const error = cause instanceof PaginationError || cause instanceof SchemaError || cause instanceof transport.ODataTransportError
            ? cause : new transport.ODataTransportError('REQUEST_FAILED');
        delete coverage.scope; // No query literals, URLs, credentials, body or partial rows in errors.
        coverage.status = error.indeterminate ? 'INDETERMINATE' : 'FAILED';
        coverage.termination = error.details.reason;
        error.coverage = coverage;
        throw error;
    }
}

module.exports = { traverse, LIMITS, MODES, PaginationError };
