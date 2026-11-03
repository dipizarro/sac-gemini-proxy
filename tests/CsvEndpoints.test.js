const mockLoad = jest.fn();
jest.mock('../src/config/config', () => ({ datasphere: {} }));
jest.mock('../src/services/GeminiService', () => ({}));
jest.mock('../src/providers/DataProviderFactory', () => ({ getDataProvider: () => ({ loadData: mockLoad }) }));
const express = require('express');
const http = require('http');
const cache = require('../src/services/CacheService');
const rows = [{ MATERIAL1: 'TEST', FECHA: '2024-01-01', ID_CENTRO: 'A', SUMA_NETA: '25', COL_8: '99', CLASE_MOVIMIENTO: 'TEST' }];
let server;
beforeAll(async () => {
    const app = express();
    app.use(require('../src/routes'));
    app.use(require('../src/middlewares/errorHandler'));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
});
afterAll(() => new Promise(resolve => server.close(resolve)));
beforeEach(() => { cache.flush(); mockLoad.mockReset().mockResolvedValue(rows); });
function request(path, method = 'GET') {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method }, res => {
            let text = '';
            res.on('data', chunk => { text += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
        });
        req.on('error', reject);
        req.end();
    });
}
test.each(['/csv/summary', '/csv/profile', '/csv/preview', '/csv/query/distinct-centers?date=2024-01-01'])('cold HTTP %s succeeds', async path => {
    const result = await request(path);
    expect(result.status).toBe(200);
    expect(mockLoad).toHaveBeenCalledTimes(1);
    if (path.includes('distinct-centers')) expect(result.body.distinctCenters).toBe(1);
    if (path === '/csv/preview') expect(result.body).toEqual({ count: 1, sample: rows });
});
test('summary prioritizes SUMA_NETA even when COL_8 exists', async () => {
    cache.set('MOVMAT_DATA', rows);
    expect((await request('/csv/summary')).body.topCentros).toEqual([['A', 25]]);
});
test('summary falls back to an existing COL_8', async () => {
    cache.set('MOVMAT_DATA', [{ ID_CENTRO: 'A', COL_8: '99' }]);
    expect((await request('/csv/summary')).body.topCentros).toEqual([['A', 99]]);
});
test('summary does not invent zero sums without either metric', async () => {
    cache.set('MOVMAT_DATA', [{ ID_CENTRO: 'A' }]);
    expect((await request('/csv/summary')).body.topCentros).toEqual([]);
});
test('reload responds with existing contract; failure preserves last dataset', async () => {
    const result = await request('/csv/reload', 'POST');
    expect(result).toEqual({ status: 200, body: { ok: true, message: 'CSV reloaded and cached', rows: 1 } });
    mockLoad.mockRejectedValue(new Error('offline'));
    expect((await request('/csv/reload', 'POST')).status).toBe(500);
    expect(cache.get('MOVMAT_DATA')).toBe(rows);
});
test('status reports the CSV provider path without reading real data', async () => {
    const result = await request('/csv/status');
    expect(result.status).toBe(200);
    expect(result.body.file.path).toBe(require('../src/providers/CsvProvider').csvPath);
});

test('HTTP reload refreshes query and temporal profile together', async () => {
    await request('/csv/query/distinct-centers?date=2024-01-01');
    const profile = require('../src/services/DatasetProfileService');
    expect(profile.getDatasetProfile(rows).defaultYear).toBe(2024);
    const updated = [{ ...rows[0], FECHA: '2025-01-01', ID_CENTRO: 'B' }];
    mockLoad.mockResolvedValue(updated);
    expect((await request('/csv/reload', 'POST')).status).toBe(200);
    expect((await request('/csv/query/distinct-centers?date=2024-01-01')).body.distinctCenters).toBe(0);
    expect((await request('/csv/query/distinct-centers?date=2025-01-01')).body.sampleCenters).toEqual(['B']);
    expect(profile.getDatasetProfile(updated).defaultYear).toBe(2025);
});

test('missing date keeps existing 400 contract', async () => {
    expect(await request('/csv/query/distinct-centers')).toEqual({ status: 400, body: { error: 'Missing date param (YYYY-MM-DD)' } });
    expect(mockLoad).not.toHaveBeenCalled();
});
