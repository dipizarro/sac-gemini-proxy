jest.mock('../src/config/config', () => ({ cors: { allowedOrigins: [] }, datasphere: {} }));
jest.mock('../src/services/GeminiService', () => ({ generateResponse: jest.fn() }));
jest.mock('../src/services/DataService', () => ({ fetchMovMat: jest.fn(), reloadRows: jest.fn() }));
jest.mock('../src/services/ExportService', () => ({ exportToCsvBuffer: jest.fn() }));
const http = require('node:http');
const express = require('express');
let server;
async function start(options = {}) {
    const { createApp } = require('../src/app');
    const app = createApp({ environment: 'test', allowedOrigins: ['https://allowed.example'], ...options });
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    return app;
}
function request(path = '/health', { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method, headers }, res => {
            let text = ''; res.on('data', chunk => { text += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
        });
        req.on('error', reject); req.end(body);
    });
}
afterEach(async () => { if (server) await new Promise(resolve => server.close(resolve)); server = null; jest.restoreAllMocks(); });
test('server generates independent request IDs and suppresses framework header', async () => {
    await start(); const a = await request('/health', { headers: { 'X-Request-ID': 'attacker' } }); const b = await request();
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
    expect(a.headers['x-powered-by']).toBeUndefined();
});
test('allowed origin gets exact CORS and exposed diagnostic headers', async () => {
    await start(); const res = await request('/health', { headers: { Origin: 'https://allowed.example' } });
    expect(res.status).toBe(200); expect(res.headers['access-control-allow-origin']).toBe('https://allowed.example');
    expect(res.headers['access-control-expose-headers']).toContain('X-Request-ID');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
});
test.each(['https://evil.example', 'null', 'https://allowed.example.evil', 'https://allowed.example/'])('rejects unauthorized origin %s', async origin => {
    await start(); const res = await request('/health', { headers: { Origin: origin } });
    expect(res.status).toBe(403); expect(res.text).not.toContain(origin); expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
});
test('empty development list denies browser origins and allows originless clients', async () => {
    await start({ allowedOrigins: [] }); expect((await request()).status).toBe(200);
    expect((await request('/health', { headers: { Origin: 'http://localhost:3000' } })).status).toBe(403);
});
test.each([[], ['*'], ['null'], ['http://public.example'], ['https://ok.example/path'], ['https://u:p@ok.example']].map(origins => [origins]))('production rejects unsafe configuration %#', origins => {
    expect(() => require('../src/app').createApp({ environment: 'production', allowedOrigins: origins })).toThrow('Configuración HTTP inválida');
});
test('development localhost must be explicitly allowed', async () => {
    await start({ allowedOrigins: ['http://localhost:3000'] });
    expect((await request('/health', { headers: { Origin: 'http://localhost:3000' } })).status).toBe(200);
    expect((await request('/health', { headers: { Origin: 'http://localhost:3001' } })).status).toBe(403);
});
test('preflight permits only declared methods and headers', async () => {
    await start(); const headers = { Origin: 'https://allowed.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' };
    expect((await request('/chat', { method: 'OPTIONS', headers })).status).toBe(204);
    expect((await request('/chat', { method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Method': 'DELETE' } })).status).toBe(403);
    expect((await request('/chat', { method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Headers': 'x-unapproved' } })).status).toBe(403);
});
test('generic errors and diagnostic logs never include raw error or URL', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const routes = express.Router(); routes.get('/fail', () => { throw Object.assign(new Error('PRIVATE_SECRET'), { isOperational: true }); });
    await start({ routes }); const res = await request('/fail?token=PRIVATE_SECRET');
    expect(res.status).toBe(500); expect(res.text).not.toMatch(/PRIVATE_SECRET|stack/);
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_SECRET');
    expect(JSON.stringify(log.mock.calls)).toContain(res.headers['x-request-id']);
});
test('404 does not reflect query strings', async () => {
    await start(); const res = await request('/missing?token=PRIVATE_SECRET');
    expect(res.status).toBe(404); expect(res.text).not.toContain('PRIVATE_SECRET');
});
test('invalid and oversized JSON are sanitized and have request IDs', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {}); await start();
    for (const [body, status] of [['{"PRIVATE_SECRET":', 400], [JSON.stringify({ data: 'x'.repeat(102401) }), 413]]) {
        const res = await request('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        expect(res.status).toBe(status); expect(res.text).not.toContain('PRIVATE_SECRET'); expect(res.headers['x-request-id']).toBeDefined();
    }
});
test('business quota is shared, cannot be bypassed with forwarded IP or route casing', async () => {
    await start();
    for (let i = 0; i < 20; i++) expect((await request('/CHAT/', { method: 'POST', headers: { 'X-Forwarded-For': `192.0.2.${i}` } })).status).toBe(400);
    const res = await request('/ds/movmat'); expect(res.status).toBe(429); expect(res.headers['retry-after']).toMatch(/^\d+$/);
    expect(require('../src/services/DataService').fetchMovMat).not.toHaveBeenCalled();
    expect((await request()).status).toBe(200);
});
test('reload has a tighter quota before invoking the controller', async () => {
    const reload = require('../src/services/DataService').reloadRows.mockResolvedValue([]); reload.mockClear(); await start();
    for (let i = 0; i < 5; i++) expect((await request('/csv/reload', { method: 'POST' })).status).toBe(200);
    expect((await request('/CSV/RELOAD/', { method: 'POST' })).status).toBe(429); expect(reload).toHaveBeenCalledTimes(5);
});
test('global quota also covers health, 404 and OPTIONS', async () => {
    await start(); for (let i = 0; i < 120; i++) await request();
    const res = await request('/absent', { method: 'OPTIONS' }); expect(res.status).toBe(429); expect(res.headers['x-request-id']).toBeDefined();
    const cors = await request('/health', { headers: { Origin: 'https://allowed.example' } });
    expect(cors.status).toBe(429); expect(cors.headers['access-control-allow-origin']).toBe('https://allowed.example');
    expect(cors.headers['cache-control']).toBe('no-store');
});
test('permitted preflights consume global budget without executing controllers', async () => {
    await start();
    for (let i = 0; i < 120; i++) expect((await request('/chat', { method: 'OPTIONS', headers: { Origin: 'https://allowed.example', 'Access-Control-Request-Method': 'POST' } })).status).toBe(204);
    expect((await request('/health')).status).toBe(429);
    expect(require('../src/services/GeminiService').generateResponse).not.toHaveBeenCalled();
});
test('production permits an explicit HTTPS origin without broadening the allowlist', async () => {
    await start({ environment: 'production' });
    expect((await request('/health', { headers: { Origin: 'https://allowed.example' } })).status).toBe(200);
    expect((await request('/health', { headers: { Origin: 'http://allowed.example' } })).status).toBe(403);
});
test('forbidden origins cannot reach a mutating route even with invalid JSON', async () => {
    const reload = require('../src/services/DataService').reloadRows; reload.mockClear(); await start();
    const res = await request('/csv/reload', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{' });
    expect(res.status).toBe(403); expect(reload).not.toHaveBeenCalled();
});
test('compressed JSON is rejected before application handlers', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {}); await start();
    const res = await request('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: require('node:zlib').gzipSync('{}') });
    expect(res.status).toBe(415); expect(res.headers['x-request-id']).toBeDefined();
});
test('development responses never disclose stack traces', async () => {
    const prior = process.env.NODE_ENV; process.env.NODE_ENV = 'development';
    try {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const routes = express.Router(); routes.get('/fail', () => { throw new Error('PRIVATE_SECRET'); });
        await start({ environment: 'development', routes });
        const res = await request('/fail'); expect(res.text).not.toMatch(/PRIVATE_SECRET|stack|\.js/);
    } finally { if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior; }
});
test('business quota admits exactly twenty concurrent requests', async () => {
    await start(); const results = await Promise.all(Array.from({ length: 25 }, () => request('/chat', { method: 'POST' })));
    expect(results.filter(result => result.status === 400)).toHaveLength(20);
    expect(results.filter(result => result.status === 429)).toHaveLength(5);
});
test('limiter blocked attempts do not extend the window or invalidate another client', () => {
    const { rateLimit } = require('../src/middlewares/httpSecurity'); let time = 0;
    const middleware = rateLimit({ limit: 1, windowMs: 1000, now: () => time });
    const next = jest.fn(), res = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
    middleware({ ip: 'a' }, res, next); time = 999;
    middleware({ ip: 'a' }, res, next); expect(res.set).toHaveBeenCalledWith('Retry-After', '1');
    middleware({ ip: 'b' }, res, next); time = 1000; middleware({ ip: 'a' }, res, next);
    expect(next).toHaveBeenCalledTimes(3);
});
test('errors after headers close the response without forwarding a sensitive error', () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = { headersSent: true, destroy: jest.fn() }, next = jest.fn();
    require('../src/middlewares/errorHandler')(new Error('PRIVATE_SECRET'), { requestId: 'server-test-id' }, res, next);
    expect(res.destroy).toHaveBeenCalled(); expect(next).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_SECRET');
});
test('approved analytical errors preserve their contract and request ID', async () => {
    const routes = express.Router(); routes.get('/fail', () => { throw new (require('../src/services/ODataPaginationService').PaginationError)('CONTINUATION_UNCERTIFIED', true); });
    await start({ routes }); const res = await request('/fail');
    expect(res.status).toBe(503); expect(JSON.parse(res.text)).toMatchObject({ code: 'ODATA_COMPLETENESS_ERROR', details: { reason: 'CONTINUATION_UNCERTIFIED' } });
    expect(res.headers['x-request-id']).toBeDefined();
});
test('export errors reach sanitized HTTP error handling', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    require('../src/services/ExportService').exportToCsvBuffer.mockRejectedValue(new Error('PRIVATE_SECRET'));
    await start(); const res = await request('/ds/export/preview?resourcePath=synthetic');
    expect(res.status).toBe(500); expect(res.text).not.toContain('PRIVATE_SECRET');
});
test('limiter expires at boundary, isolates clients and bounds tracked keys', () => {
    const { rateLimit } = require('../src/middlewares/httpSecurity'); let time = 0;
    const middleware = rateLimit({ limit: 1, windowMs: 1000, maxKeys: 2, now: () => time });
    const hit = ip => { const res = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() }; const next = jest.fn(); middleware({ ip }, res, next); return { res, next }; };
    expect(hit('a').next).toHaveBeenCalled(); expect(hit('b').next).toHaveBeenCalled();
    expect(hit('c').res.status).toHaveBeenCalledWith(503); expect(hit('a').res.status).toHaveBeenCalledWith(429);
    time = 1000; expect(hit('c').next).toHaveBeenCalled(); expect(hit('a').next).toHaveBeenCalled();
});

