const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const cors = require('cors');

function requestId(req, res, next) {
    // Client IDs are deliberately not trusted or reflected.
    req.requestId = randomUUID();
    res.set('X-Request-ID', req.requestId);
    next();
}

function rateLimit({ limit, windowMs = 60000, maxKeys = 10000, now = () => performance.now() }) {
    if (![limit, windowMs, maxKeys].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Configuración HTTP inválida');
    const clients = new Map();
    let sweepAt = 0;
    return (req, res, next) => {
        const time = now();
        // At most one bounded sweep per window; no timers or unbounded key retention.
        if (time >= sweepAt) {
            for (const [key, entry] of clients) if (entry.until <= time) clients.delete(key);
            sweepAt = time + windowMs;
        }
        const key = req.ip || 'unknown';
        let entry = clients.get(key);
        if (entry && entry.until <= time) { clients.delete(key); entry = undefined; }
        if (!entry) {
            if (clients.size >= maxKeys) {
                res.set('Cache-Control', 'no-store');
                res.set('Retry-After', String(Math.max(1, Math.ceil((sweepAt - time) / 1000))));
                return res.status(503).json({ success: false, code: 'RATE_LIMIT_CAPACITY', error: 'Servicio temporalmente ocupado' });
            }
            entry = { count: 0, until: time + windowMs }; clients.set(key, entry);
        }
        if (entry.count >= limit) {
            res.set('Cache-Control', 'no-store');
            res.set('Retry-After', String(Math.max(1, Math.ceil((entry.until - time) / 1000))));
            return res.status(429).json({ success: false, code: 'RATE_LIMITED', error: 'Demasiadas solicitudes' });
        }
        entry.count++;
        next();
    };
}

function corsPolicy({ environment, allowedOrigins }) {
    const invalid = () => { throw new Error('Configuración HTTP inválida'); };
    if (!Array.isArray(allowedOrigins) || (environment === 'production' && !allowedOrigins.length)) invalid();
    for (const origin of allowedOrigins) {
        let url; try { url = new URL(origin); } catch { invalid(); }
        if (url.origin !== origin || url.username || url.password || !['https:', 'http:'].includes(url.protocol) ||
            (environment === 'production' && url.protocol !== 'https:')) invalid();
    }
    const allowed = new Set(allowedOrigins);
    const methods = ['GET', 'HEAD', 'POST'];
    const headers = ['content-type', 'x-request-id'];
    const apply = cors({ origin: true, credentials: false, methods, allowedHeaders: headers, preflightContinue: true,
        exposedHeaders: ['X-Request-ID', 'Retry-After'], maxAge: 600 });
    return (req, res, next) => {
        res.vary('Origin');
        const origin = req.headers.origin;
        if (origin === undefined) return next();
        let permitted = allowed.has(origin);
        if (req.method === 'OPTIONS') {
            res.vary('Access-Control-Request-Method'); res.vary('Access-Control-Request-Headers');
            permitted = permitted && methods.includes(req.headers['access-control-request-method']) &&
                (req.headers['access-control-request-headers'] || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean).every(value => headers.includes(value));
        }
        if (!permitted) {
            res.set('Cache-Control', 'no-store');
            return res.status(403).json({ success: false, code: 'CORS_DENIED', error: 'Origen o preflight no autorizado' });
        }
        return apply(req, res, next);
    };
}
module.exports = { requestId, rateLimit, corsPolicy };
