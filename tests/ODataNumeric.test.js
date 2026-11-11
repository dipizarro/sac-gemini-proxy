// Only this synthetic service is certified; production remains disabled.
jest.mock('../src/services/ODataCapabilities', () => ({ forConfiguredAsset: () => ({ continuationSupported: true, serverCount: true }) }));
jest.mock('../src/config/config', () => ({ datasphere: { url: 'https://example.invalid/api/v1/datasphere/consumption/relational/Space/Asset/Rows' } }));
jest.mock('../src/services/OAuthService', () => ({ getAccessToken: async () => 'synthetic' }));
jest.mock('../src/services/GeminiService', () => ({ generateResponse: jest.fn() }));
jest.mock('../src/services/QueryStrategyResolver', () => ({ resolveStrategy: () => 'ODATA' }));
jest.mock('../src/services/IntentRouterService', () => ({ route: async () => ({ intent: 'sum_suma_neta_by_group_and_date', slots: { date: '2024-01-01', group: 'TEST' } }) }));
const provider = require('../src/providers/ODataProvider');
const data = require('../src/services/DataService');
const numeric = require('../src/utils/numeric');
const format = 'application/json;IEEE754Compatible=true';
const originalFetch = global.fetch;
beforeEach(async () => {
    // Provide a real synthetic structural contract before exercising the existing numeric cases.
    const fields = { MATERIAL1: 'Edm.Int32', FECHA: 'Edm.Date', ID_CENTRO: 'Edm.String', GRUPO_ARTICULOS: 'Edm.String', CLASE_MOVIMIENTO: 'Edm.String', SUMA_NETA: 'Edm.Int64', OTHER: 'Edm.String' };
    const xml = '<e:Edmx xmlns:e="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0"><e:DataServices><Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="Test"><EntityType Name="Row">' +
        Object.entries(fields).map(([name, type]) => `<Property Name="${name}" Type="${type}"${['FECHA', 'ID_CENTRO'].includes(name) ? ' Nullable="false"' : ''}/>`).join('') +
        '</EntityType><EntityContainer Name="Container"><EntitySet Name="Rows" EntityType="Test.Row"/></EntityContainer></Schema></e:DataServices></e:Edmx>';
    global.fetch = jest.fn().mockResolvedValue(new Response(xml, { headers: { 'Content-Type': 'application/xml' } }));
    await require('../src/services/ODataMetadataService').get({ force: true });
    global.fetch = jest.fn();
});
afterEach(() => { require('../src/services/ODataMetadataService').clear(); global.fetch = originalFetch; });
function response(value, type = format) {
    value = value.map(row => ({ MATERIAL1: 1, FECHA: '2024-01-01', ID_CENTRO: 'TEST', GRUPO_ARTICULOS: 'TEST', CLASE_MOVIMIENTO: 'TEST', OTHER: '1', ...row }));
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ value }), { headers: { 'Content-Type': type } }));
}
test.each(['loadData', 'executeFilteredQuery'])('%s negotiates and registers OData', async method => {
    response([{ ID_CENTRO: 'TEST', SUMA_NETA: '1234' }]);
    const rows = await provider[method]();
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('$format')).toBe(format);
    expect(fetch.mock.calls[0][1].headers.Accept).toBe(format);
    expect(data.sumBy(rows, 'ID_CENTRO', 'SUMA_NETA')).toEqual({ TEST: 1234 });
    expect(numeric.isCsv(rows)).toBe(false);
});
test.each(['application/json', 'text/html', 'application/json;IEEE754Compatible=false'])('rejects transport %s', async type => {
    response([{ SUMA_NETA: '1' }], type);
    await expect(provider.executeFilteredQuery()).rejects.toMatchObject({ code: 'ODATA_TRANSPORT_ERROR' });
});
test('rejects numeric Int64 token', async () => {
    response([{ SUMA_NETA: 1 }]);
    await expect(provider.executeFilteredQuery()).rejects.toMatchObject({ code: 'ODATA_TRANSPORT_ERROR' });
});
test.each(['-12', '0', '12'])('valid canonical %s', async value => {
    response([{ SUMA_NETA: value }]);
    const rows = await provider.executeFilteredQuery();
    expect(data.sumBy(rows, 'K', 'SUMA_NETA').SIN_DATO).toBe(Number(value));
});
test.each([null, undefined, '', '1,234', '1.0', '1e3', '123bad', '9007199254740993'])('blocks metric %s', async value => {
    response([{ SUMA_NETA: value }]);
    if (value === undefined) {
        await expect(provider.executeFilteredQuery()).rejects.toMatchObject({ code: 'SCHEMA_CONTRACT_MISMATCH', details: { reason: 'MISSING_REQUIRED_COLUMN' } });
        return;
    }
    const rows = await provider.executeFilteredQuery();
    expect(() => data.sumBy(rows, 'K', 'SUMA_NETA')).toThrow();
});
test('overflow and unknown metric are blocked', async () => {
    response([{ SUMA_NETA: '9007199254740991', OTHER: '1' }, { SUMA_NETA: '1' }]);
    const rows = await provider.loadData();
    expect(() => data.sumBy(rows, 'K', 'SUMA_NETA')).toThrow();
    expect(() => data.sumBy(rows, 'K', 'OTHER')).toThrow();
    expect(() => numeric.difference(rows, Number.MAX_SAFE_INTEGER, -1)).toThrow();
});
test.each(['0', '42', '-1', '9007199254740993', 42, null, undefined])('count validation %s', async count => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ value: [], '@odata.count': count }), { headers: { 'Content-Type': format } }));
    if (count === '0' || count === '42') expect(await provider.executeFilteredQuery({ count: true })).toBe(Number(count));
    else await expect(provider.executeFilteredQuery({ count: true })).rejects.toThrow();
});
test('fetchMovMat validates transport too', async () => {
    response([{ SUMA_NETA: 1 }]);
    await expect(data.fetchMovMat()).rejects.toMatchObject({ code: 'ODATA_TRANSPORT_ERROR' });
});

test.each([['1', format, 200], [null, format, 500], [1, format, 502], ['1', 'application/json', 502]])('HTTP chat respects OData contract %s', async (value, type, status) => {
    response([{ SUMA_NETA: value, FECHA: '2024-01-01', ID_CENTRO: 'TEST', GRUPO_ARTICULOS: 'TEST' }], type);
    const app = require('express')();
    app.use(require('express').json()); app.use(require('../src/routes')); app.use(require('../src/middlewares/errorHandler'));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
        const result = await new Promise((resolve, reject) => {
            const req = require('http').request({ hostname: '127.0.0.1', port: server.address().port, path: '/chat', method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
                let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
            }); req.on('error', reject); req.end(JSON.stringify({ message: 'synthetic' }));
        });
        expect(result.status).toBe(status);
        if (status === 200) expect(result.body.data.totalSumaNeta).toBe(1);
        else { expect(result.body.details.source).toBe('ODATA'); expect(result.body.reply).toBeUndefined(); }
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('CSV/OData parity and sanitized upstream errors', async () => {
    response([{ SUMA_NETA: '1234' }]);
    const rows = await provider.loadData();
    const csv = numeric.registerCsv([{ SUMA_NETA: '1,234' }], { SUMA_NETA: 'csv-integer-comma' });
    expect(data.sumBy(rows, 'K', 'SUMA_NETA')).toEqual(data.sumBy(csv, 'K', 'SUMA_NETA'));
    fetch.mockResolvedValue(new Response('SECRET_BODY', { status: 500 }));
    await expect(provider.loadData()).rejects.toMatchObject({ code: 'ODATA_TRANSPORT_ERROR', details: { reason: 'HTTP_ERROR' } });
});
