jest.mock('../src/config/config', () => ({ datasphere: {} }));
jest.mock('../src/services/GeminiService', () => ({ generateResponse: jest.fn() }));
jest.mock('../src/services/IntentRouterService', () => ({ route: jest.fn() }));
jest.mock('../src/services/QueryStrategyResolver', () => ({ resolveStrategy: () => 'CSV' }));
const fs = require('fs');
const csv = require('../src/providers/CsvProvider');
const data = require('../src/services/DataService');
const query = require('../src/services/QueryEngineService');
const insight = require('../src/services/InsightEngineService');
const summary = require('../src/services/SummaryService');
const cache = require('../src/services/CacheService');
const router = require('../src/services/IntentRouterService');
const gemini = require('../src/services/GeminiService');
async function fixture(values) {
    const text = 'MATERIAL1,FECHA,ID_CENTRO,GRUPO_ARTICULOS,CLASE_MOVIMIENTO,SUMA_NETA\n' + values.map(v =>
        'TEST,2024-01-01,TEST,TEST,TEST,' + JSON.stringify(v == null ? '' : String(v))).join('\n');
    const originalExists = fs.existsSync;
    const exists = jest.spyOn(fs, 'existsSync').mockImplementation(path => path === csv.csvPath || originalExists(path));
    const originalRead = fs.readFileSync;
    const read = jest.spyOn(fs, 'readFileSync').mockImplementation((path, ...args) => path === csv.csvPath ? Buffer.from(text) : originalRead(path, ...args));
    try { return await csv.loadData(); } finally { exists.mockRestore(); read.mockRestore(); }
}
const calculations = {
    grouped: rows => data.sumBy(rows, 'ID_CENTRO', 'SUMA_NETA'),
    query: rows => query.sumSumaNetaByGroupAndDate(rows, '2024-01-01', 'TEST'),
    monthly: rows => insight.compareSumaNetaMonths(rows, 2024, 1, 2),
    volume: rows => insight.compareTotalVolumeBetweenMonths(rows, 2024, 1, 2),
    summary: rows => summary.buildRichSummary(rows)
};
test.each(Object.keys(calculations))('%s rejects partial conversion', async name => {
    const rows = await fixture(['10', '12bad']);
    expect(() => calculations[name](rows)).toThrow(expect.objectContaining({ code: 'DATA_QUALITY_ERROR' }));
});
test.each(Object.keys(calculations))('%s rejects incomplete coverage', async name => {
    const rows = await fixture(['10', '']);
    expect(() => calculations[name](rows)).toThrow(expect.objectContaining({ code: 'DATA_QUALITY_ERROR' }));
});
test('safe inputs retain sums, statistics and counts', async () => {
    const rows = await fixture(['1,000', '-10', '0']);
    expect(data.sumBy(rows, 'ID_CENTRO', 'SUMA_NETA')).toEqual({ TEST: 990 });
    expect(summary.buildRichSummary(rows).numericStats).toMatchObject({ sum: 990, avg: 330, min: -10, max: 1000, p50: 0, p90: 1000 });
    expect(query.countMovementsByDate(rows, '2024-01-01').movements).toBe(3);
});
test('summary does not corrupt a safe boundary integer by multiplying by 100', async () => {
    const rows = await fixture(['9007199254740991']);
    expect(summary.buildRichSummary(rows).numericStats).toMatchObject({ sum: Number.MAX_SAFE_INTEGER, avg: Number.MAX_SAFE_INTEGER });
});
test('configured COL_8 alias uses the same strict CSV profile', async () => {
    const rows = await fixture(['1,000']);
    rows[0].COL_8 = rows[0].SUMA_NETA;
    delete rows[0].SUMA_NETA;
    expect(summary.buildRichSummary(rows).numericStats.sum).toBe(1000);
    rows[0].COL_8 = 'bad';
    expect(() => summary.buildRichSummary(rows)).toThrow();
});
test('counts remain available for bad metrics', async () => {
    expect(query.countMovementsByDate(await fixture(['bad', '']), '2024-01-01').movements).toBe(2);
});
test('safe individual integers cannot overflow aggregate', async () => {
    const rows = await fixture(['9007199254740991', '1']);
    expect(() => data.sumBy(rows, 'ID_CENTRO', 'SUMA_NETA')).toThrow(expect.objectContaining({ code: 'DATA_QUALITY_ERROR' }));
});
test('unmarked OData/fallback-shaped rows retain legacy interpretation', () => {
    expect(data.sumBy([{ SUMA_NETA: '1.5', ID_CENTRO: 'TEST' }], 'ID_CENTRO', 'SUMA_NETA')).toEqual({ TEST: 1.5 });
});

test.each(Object.keys(calculations))('%s rejects unsafe aggregate', async name => {
    const rows = await fixture(['9007199254740991', '1']);
    expect(() => calculations[name](rows)).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: 'UNSAFE_AGGREGATE' }) }));
});

test('CSV metric without explicit profile is blocked', async () => {
    const rows = await fixture(['10']);
    rows[0].VOLUMEN = '10';
    expect(() => insight.totalVolumeByMonth(rows, 2024, 1, 'VOLUMEN')).toThrow(expect.objectContaining({ details: expect.objectContaining({ status: 'ambiguous' }) }));
});

test('invalid metric outside requested period does not block query', async () => {
    const rows = await fixture(['10', 'bad']);
    rows[1].FECHA = '2024-03-01';
    expect(query.sumSumaNetaByGroupAndDate(rows, '2024-01-01', 'TEST').totalSumaNeta).toBe(10);
    expect(insight.compareSumaNetaMonths(rows, 2024, 1, 2).sumA).toBe(10);
});

test('difference between individually safe monthly totals is checked', async () => {
    const rows = await fixture(['9007199254740991', '-9007199254740991']);
    rows[1].FECHA = '2024-02-01';
    expect(() => insight.compareSumaNetaMonths(rows, 2024, 1, 2)).toThrow();
    expect(() => insight.compareTotalVolumeBetweenMonths(rows, 2024, 1, 2)).toThrow();
});

test.each(Object.keys(calculations))('%s rejects missing metric column', async name => {
    const rows = await fixture(['10']);
    delete rows[0].SUMA_NETA;
    expect(() => calculations[name](rows)).toThrow(expect.objectContaining({ code: 'DATA_QUALITY_ERROR' }));
});

const http = require('http');
let server;
beforeAll(async () => {
    const app = require('express')();
    app.use(require('express').json());
    app.use(require('../src/routes'));
    app.use(require('../src/middlewares/errorHandler'));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
});
afterAll(() => new Promise(resolve => server.close(resolve)));
afterEach(() => { cache.flush(); jest.clearAllMocks(); });
function request(path, body) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path,
            method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' } }, res => {
            let text = ''; res.on('data', c => { text += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
        });
        req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
    });
}
test.each(['/csv/summary', '/csv/query/suma-neta?date=2024-01-01&group=TEST', '/csv/insights/compare-sumaneta?year=2024&a=1&b=2'])('HTTP %s blocks invalid data with structured server error', async path => {
    cache.set('MOVMAT_DATA', await fixture(['SECRET_BAD_VALUE']));
    const result = await request(path);
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ success: false, code: 'DATA_QUALITY_ERROR', details: { source: 'CSV', reason: 'INVALID_FORMAT' } });
    expect(JSON.stringify(result.body)).not.toContain('SECRET_BAD_VALUE');
});
test.each(['sum_suma_neta_by_group_and_date', 'compare_suma_neta_between_months', 'compare_total_volume_between_months'])('chat %s cannot assert exact result on bad data', async intent => {
    cache.set('MOVMAT_DATA', await fixture(['bad']));
    router.route.mockResolvedValue({ intent, slots: { date: '2024-01-01', group: 'TEST', year: 2024, months: [1, 2] } });
    const result = await request('/chat', { message: 'synthetic question' });
    expect(result.status).toBe(500);
    expect(result.body.code).toBe('DATA_QUALITY_ERROR');
    expect(result.body.reply).toBeUndefined();
    expect(gemini.generateResponse).not.toHaveBeenCalled();
});

test('HTTP missing metric and null coverage are server quality errors; counts survive', async () => {
    const rows = await fixture(['10']);
    delete rows[0].SUMA_NETA;
    cache.set('MOVMAT_DATA', rows);
    expect((await request('/csv/summary')).body.details.reason).toBe('MISSING_FIELD');
    cache.set('MOVMAT_DATA', await fixture(['']));
    expect((await request('/csv/summary')).body.details.status).toBe('missing');
    expect((await request('/csv/query/movements?date=2024-01-01')).body.movements).toBe(1);
});

test('valid chat preserves exact response and value', async () => {
    cache.set('MOVMAT_DATA', await fixture(['1,000', '-10']));
    router.route.mockResolvedValue({ intent: 'sum_suma_neta_by_group_and_date', slots: { date: '2024-01-01', group: 'TEST' } });
    const result = await request('/chat', { message: 'synthetic question' });
    expect(result.status).toBe(200);
    expect(result.body.meta.exact).toBe(true);
    expect(result.body.data.totalSumaNeta).toBe(990);
});

test('profile endpoint propagates quality error from rich summary', async () => {
    const rows = await fixture(['bad']);
    const reload = jest.spyOn(data, 'reloadRows').mockResolvedValue(rows);
    try {
        const result = await request('/csv/profile');
        expect(result.status).toBe(500);
        expect(result.body.code).toBe('DATA_QUALITY_ERROR');
    } finally { reload.mockRestore(); }
});
