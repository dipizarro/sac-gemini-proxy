const config = require('../config/config');
const { performance } = require('node:perf_hooks');
const TIMEOUT_MS = 10000, MAX_BYTES = 64 * 1024, MAX_CACHE_MS = 24 * 60 * 60 * 1000;
let state;

class OAuthError extends Error {
    constructor(reason) {
        super('No se pudo obtener un token OAuth.');
        this.name = 'OAuthError'; this.code = 'OAUTH_ERROR';
        this.statusCode = reason === 'INVALID_CONFIG' ? 500 : reason === 'TIMEOUT' ? 503 : 502;
        this.details = { reason };
    }
}
const fail = reason => { throw new OAuthError(reason); };
function settings() {
    const { tokenUrl, clientId, clientSecret } = config.datasphere?.oauth || {};
    if ([tokenUrl, clientId, clientSecret].some(value => typeof value !== 'string' || !value.trim()) || /[\s\\]/.test(tokenUrl)) fail('INVALID_CONFIG');
    let url;
    try { url = new URL(tokenUrl); } catch { fail('INVALID_CONFIG'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail('INVALID_CONFIG');
    return { tokenUrl: url.href, clientId, clientSecret };
}
function same(a, b) { return a.tokenUrl === b.tokenUrl && a.clientId === b.clientId && a.clientSecret === b.clientSecret; }
const form = value => new URLSearchParams({ v: value }).toString().slice(2);

async function readBody(response, signal) {
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) fail('RESPONSE_LIMIT');
    if (!response.body) fail('INVALID_JSON');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    const cancel = () => { reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
        while (true) {
            signal.throwIfAborted();
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) fail('RESPONSE_LIMIT');
            chunks.push(Buffer.from(value));
        }
        signal.throwIfAborted();
        try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { fail('INVALID_JSON'); }
    } finally { signal.removeEventListener('abort', cancel); cancel(); }
}
async function acquire(held, signal, started) {
    const { tokenUrl, clientId, clientSecret } = held.config;
    const response = await fetch(tokenUrl, {
        method: 'POST', redirect: 'error', signal, cache: 'no-store',
        headers: { Authorization: `Basic ${Buffer.from(`${form(clientId)}:${form(clientSecret)}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'client_credentials' })
    });
    try {
        signal.throwIfAborted();
        if (response.redirected || (response.status >= 300 && response.status < 400)) fail('REDIRECT_REJECTED');
        if (response.status !== 200) fail('HTTP_ERROR'); // Never read remote error bodies.
        const parts = (response.headers.get('content-type') || '').split(';').map(value => value.trim());
        const charset = parts.slice(1).filter(value => /^charset\s*=/i.test(value));
        if (parts[0].toLowerCase() !== 'application/json' || charset.length > 1 || charset.some(value => !/^charset\s*=\s*(?:utf-8|"utf-8")$/i.test(value))) fail('CONTENT_TYPE');
        const data = await readBody(response, signal);
        if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.access_token !== 'string' ||
            !/^[A-Za-z0-9._~+\/-]+=*$/.test(data.access_token) || typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer') fail('INVALID_TOKEN');
        // Missing lifetime has no issuer-backed cache deadline. Use once, never guess one.
        let reusableUntil = 0;
        if (Object.hasOwn(data, 'expires_in')) {
            const raw = data.expires_in;
            const seconds = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
            if (!Number.isSafeInteger(seconds) || seconds <= 0 || !Number.isSafeInteger(seconds * 1000)) fail('INVALID_EXPIRY');
            const lifetime = Math.min(seconds * 1000, MAX_CACHE_MS);
            reusableUntil = started + lifetime - Math.min(60000, lifetime * 0.1);
            if (performance.now() >= reusableUntil) fail('TOKEN_EXPIRED');
        }
        return { token: data.access_token, reusableUntil };
    } finally {
        if (response.body && !response.body.locked) response.body.cancel().catch(() => {});
    }
}
function request(held) {
    const controller = new AbortController(), started = performance.now();
    held.controller = controller;
    let timer;
    const aborted = new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
        timer = setTimeout(() => controller.abort(new OAuthError('TIMEOUT')), TIMEOUT_MS);
    });
    return Promise.race([acquire(held, controller.signal, started), aborted]).then(result => {
        controller.signal.throwIfAborted();
        if (performance.now() - started >= TIMEOUT_MS) { controller.abort(new OAuthError('TIMEOUT')); fail('TIMEOUT'); }
        if (state !== held || !same(settings(), held.config)) fail('CONFIG_CHANGED');
        held.cached = result.reusableUntil > performance.now() ? result : null;
        return result.token;
    }).catch(error => {
        held.cached = null;
        throw error instanceof OAuthError ? error : new OAuthError('REQUEST_FAILED');
    }).finally(() => { clearTimeout(timer); held.pending = null; held.controller = null; });
}
/** Returns a Bearer token; cache and single-flight are private to this process/configuration. */
async function getAccessToken() {
    let current;
    try { current = settings(); }
    catch (error) {
        state?.controller?.abort(new OAuthError('CONFIG_CHANGED')); state = undefined;
        throw error instanceof OAuthError ? error : new OAuthError('INVALID_CONFIG');
    }
    if (!state || !same(current, state.config)) {
        state?.controller?.abort(new OAuthError('CONFIG_CHANGED'));
        state = { config: current, cached: null, pending: null, controller: null };
    }
    if (state.cached && performance.now() < state.cached.reusableUntil) return state.cached.token;
    state.cached = null;
    if (!state.pending) state.pending = request(state);
    return state.pending;
}
module.exports = { getAccessToken };
