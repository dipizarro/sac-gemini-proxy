const config = require('../config/config');
const oauth = require('./OAuthService');
const reader = require('./CsdlReader');
const { CsdlError } = require('./csdl/errors');
const ErrorType = require('./ODataSchemaError');
const contract = require('../config/odataContract');
const { createHash } = require('crypto');
const TTL = 5 * 60 * 1000;
const entries = new Map(), pending = new Map();
let generation = 0;
function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}
function endpoint(base) {
    try {
        const url = new URL(base);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error();
        const parts = url.pathname.split('/');
        if (parts.length !== 9 || parts.slice(1, 6).join('/') !== 'api/v1/datasphere/consumption/relational') throw Error();
        const decoded = parts.slice(6).map(decodeURIComponent);
        if (decoded.some(s => !s || s === '.' || s === '..' || /[\\/?#\u0000-\u001f]/.test(s))) throw Error();
        const entitySet = decoded[2]; parts[8] = '$metadata'; url.pathname = parts.join('/');
        return { url: url.href, entitySet };
    } catch { throw new ErrorType('INVALID_ENDPOINT', 'metadata'); }
}
async function acquire(base) {
    const target = endpoint(base);
    try {
        let authTimer;
        const token = await Promise.race([
            oauth.getAccessToken(),
            new Promise((_, reject) => { authTimer = setTimeout(() => reject(new ErrorType('AUTH_TIMEOUT', 'unavailable')), 15000); })
        ]).finally(() => clearTimeout(authTimer));
        const response = await fetch(target.url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, Accept: 'application/xml' } });
        if (!response.ok || response.redirected) throw new ErrorType('HTTP_OR_REDIRECT', 'unavailable');
        const mime = (response.headers.get('content-type') || '').split(';').map(p => p.trim());
        const charset = mime.slice(1).filter(p => /^charset\s*=/i.test(p));
        if (mime[0].toLowerCase() !== 'application/xml' || charset.length > 1 || charset.some(p => !/^charset\s*=\s*(?:utf-8|"utf-8")$/i.test(p))) throw new ErrorType('CONTENT_TYPE', 'metadata');
        const version = response.headers.get('odata-version');
        if (version && version !== '4.0') throw new ErrorType('UNSUPPORTED_VERSION', 'metadata');
        const length = response.headers.get('content-length');
        if (length && (!/^\d+$/.test(length) || Number(length) > reader.LIMITS.maxBytes)) throw new ErrorType('INPUT_LIMIT', 'metadata');
        if (!response.body) throw new ErrorType('EMPTY_BODY', 'metadata');
        const chunks = []; let size = 0;
        for await (const chunk of response.body) {
            size += chunk.length;
            if (size > reader.LIMITS.maxBytes) throw new ErrorType('INPUT_LIMIT', 'metadata');
            chunks.push(Buffer.from(chunk));
        }
        const model = await reader.read(Buffer.concat(chunks), { entitySet: target.entitySet });
        return { model: freeze(model), hash: createHash('sha256').update(JSON.stringify(model)).digest('hex') };
    } catch (error) {
        if (error instanceof ErrorType) throw error;
        if (error instanceof CsdlError) throw new ErrorType(error.details.reason, error.details.reason === 'BUSY' ? 'unavailable' : 'metadata');
        throw new ErrorType('REQUEST_FAILED', 'unavailable');
    }
}
async function get({ base = config.datasphere.url, force = false } = {}) {
    endpoint(base); // Validate even when cached; never accept an arbitrary metadata URL.
    const key = base + '|' + contract.revision;
    if (pending.has(key)) return pending.get(key);
    const cached = entries.get(key);
    if (!force && cached && Date.now() < cached.expiresAt) return cached;
    if (pending.size >= 2) throw new ErrorType('BUSY', 'unavailable');
    const startedGeneration = generation;
    const task = acquire(base).then(result => {
        const entry = Object.freeze({ ...result, key, base, validatedAt: Date.now(), expiresAt: Date.now() + TTL });
        if (generation === startedGeneration) {
            entries.delete(key);
            if (entries.size >= 4) entries.delete(entries.keys().next().value);
            entries.set(key, entry);
        }
        return entry;
    }).catch(error => {
        if (generation === startedGeneration) entries.delete(key);
        throw error;
    }).finally(() => { if (pending.get(key) === task) pending.delete(key); });
    pending.set(key, task);
    return task;
}
async function ensureCurrent(entry) {
    const current = await get({ base: entry.base });
    if (current.hash !== entry.hash) throw new ErrorType('SCHEMA_CHANGED_DURING_LOAD');
    return current;
}
function clear() { generation++; entries.clear(); pending.clear(); }
module.exports = { get, ensureCurrent, clear, endpoint, TTL };
