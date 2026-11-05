jest.mock('../src/config/config', () => ({ datasphere: { url: 'https://example.invalid/api/v1/datasphere/consumption/relational/Space/Asset/Rows', exportUrl: 'https://unused.invalid' } }));
jest.mock('../src/services/OAuthService', () => ({ getAccessToken: jest.fn(async () => 'synthetic') }));
jest.mock('../src/services/ExportService', () => ({ exportToCsvBuffer: jest.fn() }));
jest.mock('../src/services/GeminiService', () => ({ generateResponse: jest.fn() }));
jest.mock('../src/services/QueryStrategyResolver', () => ({ resolveStrategy: () => 'ODATA' }));
jest.mock('../src/services/IntentRouterService', () => ({ route: async () => ({ intent: 'sum_suma_neta_by_group_and_date', slots: { date: '2024-01-01', group: 'TEST' } }) }));
const config = require('../src/config/config');
const provider = require('../src/providers/ODataProvider');
const data = require('../src/services/DataService');
const cache = require('../src/services/CacheService');
const format = require('../src/services/ODataTransport').FORMAT;
const originalFetch = global.fetch, originalSource = process.env.DATA_SOURCE;
const metadata = () => require('../src/services/ODataMetadataService');
const schema = () => require('../src/services/ODataSchemaService');
const row = () => ({ MATERIAL1: 1, FECHA: '2024-01-01', ID_CENTRO: 'A', GRUPO_ARTICULOS: 'TEST', CLASE_MOVIMIENTO: 'C', SUMA_NETA: '10' });
function xml({ omit, metric = 'Edm.Int64', extra = '', unit = false, nullable = 'false' } = {}) {
    const properties = { MATERIAL1: 'Edm.Int32', FECHA: 'Edm.Date', ID_CENTRO: 'Edm.String', GRUPO_ARTICULOS: 'Edm.String', CLASE_MOVIMIENTO: 'Edm.String', SUMA_NETA: metric };
    return '<e:Edmx xmlns:e="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0"><e:DataServices><Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="Demo" Alias="D"><EntityType Name="Row">' +
        Object.entries(properties).filter(([name]) => name !== omit).map(([name, type]) => `<Property Name="${name}" Type="${type}"${['FECHA', 'ID_CENTRO'].includes(name) ? ` Nullable="${nullable}"` : ''}>${name === 'SUMA_NETA' && unit ? '<Annotation Term="D.UnapprovedUnit" String="private"/>' : ''}</Property>`).join('') + extra +
        '</EntityType><EntityContainer Name="Container"><EntitySet Name="Rows" EntityType="D.Row"/></EntityContainer></Schema></e:DataServices></e:Edmx>';
}
let currentXml, pages, metaCalls, dataCalls;
beforeEach(() => {
    currentXml = xml(); pages = [{ value: [row()] }]; metaCalls = 0; dataCalls = 0;
    process.env.DATA_SOURCE = 'ODATA'; provider.pageSize = 1000;
    global.fetch = jest.fn(async url => {
        if (new URL(url).pathname.endsWith('/$metadata')) { metaCalls++; return new Response(currentXml, { headers: { 'Content-Type': 'application/xml', 'OData-Version': '4.0' } }); }
        dataCalls++; return new Response(JSON.stringify(pages.shift() || { value: [] }), { headers: { 'Content-Type': format } });
    });
});
afterEach(() => {
    // Module does not exist during the initial red run.
    try { metadata().clear(); } catch { /* regression-before-implementation */ }
    data.clearCache(); jest.restoreAllMocks(); jest.clearAllMocks(); global.fetch = originalFetch;
    if (originalSource === undefined) delete process.env.DATA_SOURCE; else process.env.DATA_SOURCE = originalSource;
});

test.each([
    'http://example.invalid/api/v1/datasphere/consumption/relational/S/A/Rows',
    'https://user:secret@example.invalid/api/v1/datasphere/consumption/relational/S/A/Rows',
    'https://example.invalid/api/v1/datasphere/consumption/relational/S/A/Rows?x=1',
    'https://example.invalid/api/v1/datasphere/consumption/relational/S/A/Bad%2FName',
    'https://example.invalid/arbitrary/Rows'
])('rejects unsafe metadata derivation %#', async base => {
    await expect(metadata().get({ base })).rejects.toMatchObject({ code: 'ODATA_METADATA_ERROR', details: { reason: 'INVALID_ENDPOINT' } });
    expect(fetch).not.toHaveBeenCalled();
});
test('body limit is enforced both with and without Content-Length', async () => {
    fetch.mockResolvedValueOnce(new Response('x', { headers: { 'Content-Type': 'application/xml', 'Content-Length': '2097153' } }));
    await expect(metadata().get()).rejects.toMatchObject({ details: { reason: 'INPUT_LIMIT' } });
    fetch.mockResolvedValueOnce(new Response('x'.repeat(2097153), { headers: { 'Content-Type': 'application/xml' } }));
    await expect(metadata().get()).rejects.toMatchObject({ details: { reason: 'INPUT_LIMIT' } });
});
test('metadata cannot use a redirected XML response and never exposes auth errors', async () => {
    const response = new Response(xml(), { headers: { 'Content-Type': 'application/xml' } });
    Object.defineProperty(response, 'redirected', { value: true }); fetch.mockResolvedValueOnce(response);
    await expect(metadata().get()).rejects.toMatchObject({ details: { reason: 'HTTP_OR_REDIRECT' } });
    require('../src/services/OAuthService').getAccessToken.mockRejectedValueOnce(new Error('PRIVATE_TOKEN'));
    await expect(metadata().get()).rejects.toMatchObject({ code: 'METADATA_UNAVAILABLE', details: { reason: 'REQUEST_FAILED' } });
});
test('auth has a bounded wait without altering OAuthService', async () => {
    jest.useFakeTimers();
    require('../src/services/OAuthService').getAccessToken.mockImplementationOnce(() => new Promise(() => {}));
    try {
        const expectation = expect(metadata().get()).rejects.toMatchObject({ details: { reason: 'AUTH_TIMEOUT' } });
        await jest.advanceTimersByTimeAsync(15001); await expectation;
    } finally { jest.useRealTimers(); }
});
test('a compatible forced refresh publishes new data and invalidates both derivatives', async () => {
    const previous = await data.reloadRows();
    await require('../src/services/QueryService').countDistinctCentersByDate('2024-01-01');
    require('../src/services/DatasetProfileService').getDatasetProfile(previous);
    currentXml = xml({ extra: '<Property Name="ADDED" Type="Edm.String"/>' }); pages = [{ value: [{ ...row(), ADDED: 'new' }] }];
    const next = await data.reloadRows();
    expect(next).not.toBe(previous); expect(metaCalls).toBe(2);
    expect(cache.get('MOVMAT_DATA')).toBe(next);
    expect(cache.get('MOVMAT_INDEX_V1')).toBeNull(); expect(cache.get('MOVMAT_PROFILE_V1')).toBeNull();
});
test('a newer schema discovered between pages prevents old-generation publication', async () => {
    const original = fetch.getMockImplementation();
    provider.pageSize = 1; pages = [{ value: [row()] }, { value: [] }];
    fetch.mockImplementation(async (url, options) => {
        const response = await original(url, options);
        if (!new URL(url).pathname.endsWith('/$metadata') && dataCalls === 1) {
            currentXml = xml({ metric: 'Edm.Decimal' }); await metadata().get({ force: true });
        }
        return response;
    });
    await expect(data.getRowsCached()).rejects.toMatchObject({ details: { reason: 'SCHEMA_CHANGED_DURING_LOAD' } });
    expect(cache.get('MOVMAT_DATA')).toBeNull();
});
test('metadata expiry during a load requires successful revalidation', async () => {
    let now = Date.now(); jest.spyOn(Date, 'now').mockImplementation(() => now);
    const original = fetch.getMockImplementation();
    fetch.mockImplementation(async (url, options) => {
        if (new URL(url).pathname.endsWith('/$metadata') && metaCalls) throw new Error('offline');
        const response = await original(url, options);
        if (!new URL(url).pathname.endsWith('/$metadata')) now += 300001;
        return response;
    });
    await expect(data.getRowsCached()).rejects.toMatchObject({ code: 'METADATA_UNAVAILABLE' });
    expect(cache.get('MOVMAT_DATA')).toBeNull();
    expect(require('../src/services/ExportService').exportToCsvBuffer).not.toHaveBeenCalled();
});
test('normalization collisions are rejected, nullable metric still allows counts', async () => {
    currentXml = xml({ extra: '<Property Name="ID CENTRO" Type="Edm.String"/>' });
    await expect(provider.loadData()).rejects.toMatchObject({ details: { reason: 'COLUMN_COLLISION' } });
    metadata().clear(); currentXml = xml(); pages = [{ value: [{ ...row(), SUMA_NETA: null }] }];
    const rows = await provider.loadData();
    expect(require('../src/services/QueryEngineService').countMovementsByDate(rows, '2024-01-01').movements).toBe(1);
    expect(() => data.sumBy(rows, 'ID_CENTRO', 'SUMA_NETA')).toThrow(expect.objectContaining({ code: 'DATA_QUALITY_ERROR' }));
});
test('a copied snapshot retains strict quality and rejects changed row types', async () => {
    const rows = await provider.loadData(); const copied = schema().copyContext(rows, rows.slice());
    rows[0].SUMA_NETA = 'bad';
    expect(() => data.sumBy(copied, 'ID_CENTRO', 'SUMA_NETA')).toThrow(expect.objectContaining({ code: 'DATA_QUALITY_ERROR' }));
    rows[0].ID_CENTRO = 5;
    expect(() => provider.assertSnapshot(rows)).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: 'PAYLOAD_TYPE_MISMATCH' }) }));
});
test('valid data JSON transport errors retain their previous code', async () => {
    const original = fetch.getMockImplementation();
    fetch.mockImplementation((url, options) => new URL(url).pathname.endsWith('/$metadata') ? original(url, options) : Promise.resolve(new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
    await expect(provider.loadData()).rejects.toMatchObject({ code: 'ODATA_TRANSPORT_ERROR' });
});
test('cosmetic labels are compatible and vocabulary references never trigger GET', async () => {
    currentXml = xml().replace('<e:DataServices>', '<e:Reference Uri="https://unused.invalid/vocab"><e:Include Namespace="com.sap.vocabularies.Common.v1" Alias="Common"/></e:Reference><e:DataServices>')
        .replace('<Property Name="SUMA_NETA" Type="Edm.Int64">', '<Property Name="SUMA_NETA" Type="Edm.Int64"><Annotation Term="Common.Label" String="display only"/>');
    expect((await provider.loadData())[0].SUMA_NETA).toBe('10');
    expect(fetch).toHaveBeenCalledTimes(2);
});
test('empty data cannot bypass an incompatible schema and counts check their filter types', async () => {
    currentXml = xml({ metric: 'Edm.Decimal' }); pages = [{ value: [] }];
    await expect(provider.loadData()).rejects.toMatchObject({ details: { reason: 'INCOMPATIBLE_METRIC_TYPE' } });
    metadata().clear(); currentXml = xml().replace('Name="FECHA" Type="Edm.Date"', 'Name="FECHA" Type="Edm.String"');
    await expect(provider.executeFilteredQuery({ count: true, filter: 'FECHA eq 2024-01-01' })).rejects.toMatchObject({ details: { reason: 'INCOMPATIBLE_EDM_TYPE' } });
});
test('additional properties do not inherit JS prototype roles and collections cannot be null', async () => {
    currentXml = xml({ extra: '<Property Name="constructor" Type="Edm.String"/><Property Name="TAGS" Type="Collection(Edm.String)"/>' });
    pages = [{ value: [{ ...row(), constructor: 'opaque', TAGS: ['a', null] }] }];
    expect((await provider.loadData())[0].constructor).toBe('opaque');
    pages = [{ value: [{ ...row(), constructor: 'opaque', TAGS: null }] }];
    await expect(provider.loadData()).rejects.toMatchObject({ details: { reason: 'PAYLOAD_TYPE_MISMATCH' } });
});
test.each([
    [503, 'application/xml', 'private', 503, 'METADATA_UNAVAILABLE'],
    [200, 'application/xml', '<private-broken', 502, 'ODATA_METADATA_ERROR']
])('middleware returns safe metadata errors without logging bodies %#', async (status, mime, body, expectedStatus, code) => {
    fetch.mockResolvedValue(new Response(body, { status, headers: { 'Content-Type': mime } }));
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    let error;
    try { await provider.loadData(); } catch (e) { error = e; }
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    require('../src/middlewares/errorHandler')(error, {}, response, jest.fn());
    expect(response.status).toHaveBeenCalledWith(expectedStatus);
    const output = response.json.mock.calls[0][0];
    expect(output.code).toBe(code); expect(JSON.stringify(output)).not.toContain('private'); expect(log).not.toHaveBeenCalled();
});
test('first full load validates metadata, negotiates XML and attaches an immutable contract', async () => {
    const rows = await provider.loadData();
    expect(metaCalls).toBe(1); expect(dataCalls).toBe(1);
    const [url, options] = fetch.mock.calls[0];
    expect(new URL(url).pathname.endsWith('/Asset/$metadata')).toBe(true);
    expect(new URL(url).search).toBe(''); expect(options.headers.Accept).toBe('application/xml'); expect(options.redirect).toBe('error');
    expect(schema().context(rows)).toMatchObject({ source: 'ODATA', revision: 'movmat-odata-1', projection: expect.arrayContaining(['SUMA_NETA']) });
    expect(Object.isFrozen(schema().context(rows))).toBe(true);
});
test('metadata cache shares concurrent requests, expires and does not renew after failure', async () => {
    let now = Date.now(); jest.spyOn(Date, 'now').mockImplementation(() => now);
    const [a, b] = await Promise.all([metadata().get(), metadata().get()]);
    expect(a).toBe(b); expect(metaCalls).toBe(1);
    expect(await metadata().get()).toBe(a);
    now += 300001; await metadata().get(); expect(metaCalls).toBe(2);
    now += 300001; fetch.mockRejectedValue(new Error('PRIVATE_URL_TOKEN'));
    await expect(metadata().get()).rejects.toMatchObject({ code: 'METADATA_UNAVAILABLE' });
    await expect(metadata().get()).rejects.toMatchObject({ code: 'METADATA_UNAVAILABLE' });
});
test.each([
    [{ metric: 'Edm.Decimal' }, 'INCOMPATIBLE_METRIC_TYPE'],
    [{ omit: 'FECHA' }, 'MISSING_REQUIRED_COLUMN'],
    [{ nullable: 'true' }, 'INCOMPATIBLE_NULLABILITY'],
    [{ unit: true }, 'INCOMPATIBLE_SEMANTICS']
])('rejects incompatible metadata before data fetch %#', async (options, reason) => {
    currentXml = xml(options);
    await expect(provider.loadData()).rejects.toMatchObject({ code: 'SCHEMA_CONTRACT_MISMATCH', details: { reason } });
    expect(dataCalls).toBe(0);
});
test('compatible additional property and empty snapshot are accepted', async () => {
    currentXml = xml({ extra: '<Property Name="EXTRA" Type="Edm.String"/>' }); pages = [{ value: [{ ...row(), EXTRA: 'opaque' }] }];
    expect((await provider.loadData())[0].EXTRA).toBe('opaque');
    pages = [{ value: [] }]; const empty = await provider.loadData();
    expect(empty).toEqual([]); expect(schema().context(empty).source).toBe('ODATA');
});
test('partial projection validates filter fields without requiring them in the returned row', async () => {
    currentXml = xml({ omit: 'MATERIAL1' }); pages = [{ value: [{ SUMA_NETA: '10' }] }];
    const rows = await provider.executeFilteredQuery({ select: 'SUMA_NETA', filter: "FECHA eq 2024-01-01 and GRUPO_ARTICULOS eq 'TEST'" });
    expect(rows).toEqual([{ SUMA_NETA: '10' }]);
    expect(schema().context(rows).projection).toEqual(['SUMA_NETA']);
});
test('count without metric succeeds but missing filter field fails', async () => {
    currentXml = xml({ omit: 'SUMA_NETA' }); pages = [{ value: [], '@odata.count': '7' }];
    expect(await provider.executeFilteredQuery({ count: true, filter: 'FECHA eq 2024-01-01', select: 'SUMA_NETA', orderby: 'SUMA_NETA desc' })).toBe(7);
    metadata().clear(); currentXml = xml({ omit: 'FECHA' });
    await expect(provider.executeFilteredQuery({ count: true, filter: 'FECHA eq 2024-01-01' })).rejects.toMatchObject({ details: { reason: 'MISSING_REQUIRED_COLUMN' } });
});
test.each([
    [() => { const r = row(); delete r.SUMA_NETA; return r; }, 'MISSING_REQUIRED_COLUMN'],
    [() => ({ ...row(), FECHA: null }), 'PAYLOAD_TYPE_MISMATCH'],
    [() => ({ ...row(), MATERIAL1: '1' }), 'PAYLOAD_TYPE_MISMATCH'],
    [() => ({ ...row(), ID_CENTRO: {} }), 'PAYLOAD_TYPE_MISMATCH'],
    [() => ({ ...row(), UNKNOWN: 'x' }), 'UNDECLARED_PROPERTY']
])('payload is checked before normalization %#', async (make, reason) => {
    pages = [{ value: [make()] }];
    await expect(provider.loadData()).rejects.toMatchObject({ code: 'SCHEMA_CONTRACT_MISMATCH', details: { reason } });
});
test('inconsistent page cannot publish a partial dataset', async () => {
    provider.pageSize = 1; pages = [{ value: [row()] }, { value: [{ SUMA_NETA: '2' }] }];
    await expect(data.getRowsCached()).rejects.toMatchObject({ code: 'SCHEMA_CONTRACT_MISMATCH' });
    expect(cache.get('MOVMAT_DATA')).toBeNull(); expect(dataCalls).toBe(2);
});
test('explicit incompatible reload preserves dataset, index, profile and original expiry; no export', async () => {
    const rows = await data.reloadRows();
    await require('../src/services/QueryService').countDistinctCentersByDate('2024-01-01');
    require('../src/services/DatasetProfileService').getDatasetProfile(rows);
    const entries = ['MOVMAT_DATA', 'MOVMAT_INDEX_V1', 'MOVMAT_PROFILE_V1'].map(k => cache.cache.get(k));
    currentXml = xml({ metric: 'Edm.Decimal' });
    await expect(data.reloadRows()).rejects.toMatchObject({ code: 'SCHEMA_CONTRACT_MISMATCH' });
    expect(metaCalls).toBe(2);
    ['MOVMAT_DATA', 'MOVMAT_INDEX_V1', 'MOVMAT_PROFILE_V1'].forEach((k, i) => expect(cache.cache.get(k)).toBe(entries[i]));
    expect(require('../src/services/ExportService').exportToCsvBuffer).not.toHaveBeenCalled();
});
test('DataService direct fetch validates structural payload and context', async () => {
    pages = [{ value: [{ SUMA_NETA: '10' }] }];
    const result = await data.fetchMovMat({ select: ['SUMA_NETA'] });
    expect(schema().context(result.value).projection).toEqual(['SUMA_NETA']);
    pages = [{ value: [{}] }];
    await expect(data.fetchMovMat({ select: 'SUMA_NETA' })).rejects.toMatchObject({ details: { reason: 'MISSING_REQUIRED_COLUMN' } });
});
test('registered copies preserve validated identity; unrelated clones cannot inherit it', async () => {
    const rows = await provider.loadData();
    const copied = schema().copyContext(rows, rows.slice());
    expect(schema().context(copied).parentSnapshotId).toBe(schema().context(rows).snapshotId);
    expect(require('../src/utils/numeric').isStrict(copied)).toBe(true);
    expect(() => schema().copyContext(rows, [{ ...rows[0] }])).toThrow();
});
test.each([
    [503, 'application/xml', 'PRIVATE', 'METADATA_UNAVAILABLE'],
    [200, 'application/json', '{}', 'ODATA_METADATA_ERROR'],
    [200, 'application/xml', '<broken', 'ODATA_METADATA_ERROR'],
    [302, 'application/xml', '', 'METADATA_UNAVAILABLE']
])('metadata errors are safe %#', async (status, mime, body, code) => {
    fetch.mockResolvedValue(new Response(body, { status, headers: { 'Content-Type': mime } }));
    await expect(provider.loadData()).rejects.toMatchObject({ code });
    try { await metadata().get(); } catch (e) { expect(JSON.stringify(e) + e.message).not.toContain('PRIVATE'); }
});
test('metadata failure propagates safely through chat without a generated numeric response', async () => {
    currentXml = xml({ metric: 'Edm.Decimal' });
    const app = require('express')(); app.use(require('express').json()); app.use(require('../src/routes')); app.use(require('../src/middlewares/errorHandler'));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
        const result = await new Promise((resolve, reject) => {
            const req = require('http').request({ hostname: '127.0.0.1', port: server.address().port, path: '/chat', method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
                let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
            }); req.on('error', reject); req.end(JSON.stringify({ message: 'synthetic' }));
        });
        expect(result.status).toBe(502); expect(result.body.code).toBe('SCHEMA_CONTRACT_MISMATCH'); expect(result.body.reply).toBeUndefined();
        expect(require('../src/services/GeminiService').generateResponse).not.toHaveBeenCalled();
    } finally { await new Promise(resolve => server.close(resolve)); }
});
