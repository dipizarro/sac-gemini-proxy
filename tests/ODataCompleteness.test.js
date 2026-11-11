jest.mock('../src/config/config', () => ({ datasphere: { url: 'https://example.invalid/api/v1/datasphere/consumption/relational/Space/Asset/Rows', exportUrl: 'https://unused.invalid' } }));
jest.mock('../src/services/OAuthService', () => ({ getAccessToken: async () => 'synthetic' }));
jest.mock('../src/services/GeminiService', () => ({ generateResponse: jest.fn(async () => 'synthetic') }));
jest.mock('../src/services/ExportService', () => ({ exportToCsvBuffer: jest.fn() }));
jest.mock('../src/services/QueryStrategyResolver', () => ({ resolveStrategy: () => 'ODATA' }));
jest.mock('../src/services/IntentRouterService', () => ({ route: jest.fn() }));
const provider = require('../src/providers/ODataProvider');
const data = require('../src/services/DataService');
const cache = require('../src/services/CacheService');
const metadata = require('../src/services/ODataMetadataService');
const schema = require('../src/services/ODataSchemaService');
const transport = require('../src/services/ODataTransport');
const query = require('../src/services/QueryEngineService');
const originalFetch = global.fetch, originalSource = process.env.DATA_SOURCE;
const row = () => ({ MATERIAL1: 1, FECHA: '2024-01-01', ID_CENTRO: 'A', GRUPO_ARTICULOS: 'TEST', CLASE_MOVIMIENTO: 'C', SUMA_NETA: '10' });
const fields = { MATERIAL1: 'Edm.Int32', FECHA: 'Edm.Date', ID_CENTRO: 'Edm.String', GRUPO_ARTICULOS: 'Edm.String', CLASE_MOVIMIENTO: 'Edm.String', SUMA_NETA: 'Edm.Int64' };
const xml = '<Edmx xmlns="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0"><DataServices><Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="Demo"><EntityType Name="Row">' + Object.entries(fields).map(([name, type]) => `<Property Name="${name}" Type="${type}"${['FECHA', 'ID_CENTRO'].includes(name) ? ' Nullable="false"' : ''}/>`).join('') + '</EntityType><EntityContainer Name="Container"><EntitySet Name="Rows" EntityType="Demo.Row"/></EntityContainer></Schema></DataServices></Edmx>';
let pages, calls;
beforeEach(() => {
    process.env.DATA_SOURCE = 'ODATA'; pages = [{ value: [row()] }]; calls = 0;
    require('../src/services/IntentRouterService').route.mockResolvedValue({ intent: 'sum_suma_neta_by_group_and_date', slots: { date: '2024-01-01', group: 'TEST' } });
    global.fetch = jest.fn(async url => {
        if (new URL(url).pathname.endsWith('/$metadata')) return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
        calls++; const page = pages.shift();
        if (page instanceof Error) throw page;
        return new Response(JSON.stringify(page), { headers: { 'Content-Type': transport.FORMAT } });
    });
});
afterEach(() => { metadata.clear(); data.clearCache(); jest.restoreAllMocks(); jest.clearAllMocks(); global.fetch = originalFetch; if (originalSource === undefined) delete process.env.DATA_SOURCE; else process.env.DATA_SOURCE = originalSource; });
function certifySynthetic() { jest.spyOn(require('../src/services/ODataCapabilities'), 'forConfiguredAsset').mockReturnValue({ continuationSupported: true, serverCount: true }); }
async function chat(path = '/chat', method = 'POST') {
    const app = require('express')(); app.use(require('express').json()); app.use(require('../src/routes')); app.use(require('../src/middlewares/errorHandler'));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try { return await new Promise((resolve, reject) => {
        const req = require('http').request({ hostname: '127.0.0.1', port: server.address().port, path, method, headers: { 'Content-Type': 'application/json' } }, res => {
            let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(text) }); } catch (error) { reject(error); }
            });
        }); req.on('error', reject); req.end(method === 'GET' ? undefined : JSON.stringify({ message: 'synthetic' }));
    }); } finally { await new Promise(resolve => server.close(resolve)); }
}
test('uncertified nextLink chat cannot claim exact totals or send partial figures to Gemini', async () => {
    pages = [{ value: [row()], '@odata.nextLink': '?cursor=1' }];
    const result = await chat();
    expect(result.status).toBe(503); expect(result.body.code).toBe('ODATA_COMPLETENESS_ERROR');
    expect(result.body.reply).toBeUndefined(); expect(calls).toBe(0);
    expect(require('../src/services/GeminiService').generateResponse).not.toHaveBeenCalled();
});
test('certified synthetic chain calculates all rows but never promises temporal exactness', async () => {
    certifySynthetic(); pages = [{ value: [row()], '@odata.nextLink': '?cursor=1' }, { value: [row()] }];
    const result = await chat();
    expect(result.status).toBe(200); expect(result.body.data.totalSumaNeta).toBe(20);
    expect(result.body.meta.exact).toBe(false); expect(result.body.meta.temporalConsistency).toBe('UNVERIFIED'); expect(calls).toBe(2);
});
test('verified server count remains operational and is identified as reported count', async () => {
    pages = [{ value: [], '@odata.count': '7' }];
    require('../src/services/IntentRouterService').route.mockResolvedValue({ intent: 'count_movements_by_date', slots: { date: '2024-01-01' } });
    const result = await chat();
    expect(result.status).toBe(200); expect(result.body.meta.exact).toBe(false); expect(result.body.meta.countBasis).toBe('SERVER_REPORTED');
});
test('TOP_N stays limited and cannot feed aggregations', async () => {
    const rows = await provider.executeFilteredQuery({ top: 1 });
    expect(rows).toHaveLength(1);
    expect(() => query.countMovementsByDate(rows, '2024-01-01')).toThrow(expect.objectContaining({ code: 'ODATA_COMPLETENESS_ERROR' }));
});
test.each(['slice', 'filter', 'copyContext'])('transformation %s never inherits completeness', async method => {
    certifySynthetic(); const rows = await provider.loadData();
    const copy = method === 'copyContext' ? schema.copyContext(rows, rows.slice()) : method === 'slice' ? rows.slice() : rows.filter(() => true);
    expect(() => query.countMovementsByDate(copy, '2024-01-01')).toThrow(expect.objectContaining({ code: 'ODATA_COMPLETENESS_ERROR' }));
});
test.each([new Error('private-token'), { value: [{ SUMA_NETA: '1' }] }])('second page failure rejects reload and retains all caches', async failure => {
    certifySynthetic(); const old = await data.reloadRows();
    const index = {}, profile = {}; cache.set('MOVMAT_INDEX_V1', index, 10000); cache.set('MOVMAT_PROFILE_V1', profile, 10000);
    const entries = ['MOVMAT_DATA', 'MOVMAT_INDEX_V1', 'MOVMAT_PROFILE_V1'].map(key => cache.cache.get(key));
    pages = [{ value: [row()], '@odata.nextLink': '?cursor=1' }, failure];
    await expect(data.reloadRows()).rejects.toThrow();
    expect(cache.get('MOVMAT_DATA')).toBe(old); expect(cache.get('MOVMAT_INDEX_V1')).toBe(index); expect(cache.get('MOVMAT_PROFILE_V1')).toBe(profile);
    ['MOVMAT_DATA', 'MOVMAT_INDEX_V1', 'MOVMAT_PROFILE_V1'].forEach((key, i) => expect(cache.cache.get(key)).toBe(entries[i]));
    expect(require('../src/services/ExportService').exportToCsvBuffer).not.toHaveBeenCalled();
});
test('pagination budget failure reaches HTTP without partial numeric context', async () => {
    certifySynthetic(); const paginator = require('../src/services/ODataPaginationService'); const original = paginator.traverse;
    jest.spyOn(paginator, 'traverse').mockImplementation(options => original({ ...options, limits: { maxPages: 1 } }));
    pages = [{ value: [row()], '@odata.nextLink': '?cursor=1' }];
    require('../src/services/IntentRouterService').route.mockResolvedValue({ intent: 'compare_total_volume_between_months', slots: { year: 2024, monthA: 1, monthB: 2 } });
    const result = await chat();
    expect(result.status).toBe(503); expect(result.body.details.reason).toBe('PAGE_LIMIT'); expect(calls).toBe(1);
    expect(JSON.stringify(result.body)).not.toMatch(/example.invalid|synthetic|cursor|SUMA_NETA/);
    expect(require('../src/services/GeminiService').generateResponse).not.toHaveBeenCalled();
});
test('second-page failure cannot send partial comparison figures to Gemini', async () => {
    certifySynthetic(); pages = [{ value: [row()], '@odata.nextLink': '?cursor=1' }, new Error('private-token')];
    require('../src/services/IntentRouterService').route.mockResolvedValue({ intent: 'compare_suma_neta_between_months', slots: { year: 2024, monthA: 1, monthB: 2 } });
    const result = await chat(); expect(result.status).toBe(502); expect(result.body.code).toBe('ODATA_TRANSPORT_ERROR');
    expect(JSON.stringify(result.body)).not.toContain('private-token');
    expect(require('../src/services/GeminiService').generateResponse).not.toHaveBeenCalled();
});
test.each([
    rows => data.sumBy(rows, 'ID_CENTRO', 'SUMA_NETA'),
    rows => data.countBy(rows, 'ID_CENTRO'),
    rows => query.countDistinctCentersByDate(rows, '2024-01-01'),
    rows => query.topCentersByMovementsOnDate(rows, '2024-01-01'),
    rows => require('../src/services/InsightEngineService').compareMonths(rows, 2024, 1, 2),
    rows => require('../src/services/InsightEngineService').diffDistinctCentersMonths(rows, 2024, 1, 2),
    rows => require('../src/services/InsightEngineService').compareTotalVolumeBetweenMonths(rows, 2024, 1, 2),
    rows => require('../src/services/SummaryService').buildRichSummary(rows),
    rows => require('../src/services/DatasetProfileService').getDatasetProfile(rows)
])('analytic entry point %# blocks LIMITED before calculation', async calculate => {
    const rows = await provider.executeFilteredQuery({ top: 1 });
    expect(() => calculate(rows)).toThrow(expect.objectContaining({ code: 'ODATA_COMPLETENESS_ERROR' }));
});
test('mutating a registered array invalidates its coverage', async () => {
    certifySynthetic(); const rows = await provider.loadData(); rows.length = 0;
    expect(() => query.countMovementsByDate(rows, '2024-01-01')).toThrow(expect.objectContaining({ details: { source: 'ODATA', reason: 'SNAPSHOT_CHANGED' } }));
});
test('no coverage is inferred for deep clones or empty slices', async () => {
    certifySynthetic(); const rows = await provider.loadData(); const coverage = require('../src/services/ODataCoverageService');
    for (const copy of [rows.slice(0, 0), rows.map(row => ({ ...row }))]) {
        expect(coverage.get(copy)).toBeUndefined(); expect(() => coverage.requireComplete(copy)).toThrow();
    }
});
test('empty certified snapshot is allowed and does not invent a numeric failure', async () => {
    certifySynthetic(); pages = [{ value: [] }]; const rows = await data.reloadRows();
    expect(query.countMovementsByDate(rows, '2024-01-01').movements).toBe(0);
});
test('partial projection remains structurally validated in TOP_N direct fetch', async () => {
    pages = [{ value: [{ SUMA_NETA: '10' }] }];
    const result = await data.fetchMovMat({ top: 1, select: ['SUMA_NETA'] });
    expect(result.coverage.status).toBe('LIMITED'); expect(schema.context(result.value).projection).toEqual(['SUMA_NETA']);
});
test('a failed uncertified reload keeps prior certified snapshot and does not extend TTL', async () => {
    certifySynthetic(); await data.reloadRows(); const entry = cache.cache.get('MOVMAT_DATA');
    require('../src/services/ODataCapabilities').forConfiguredAsset.mockReturnValue({ continuationSupported: false, serverCount: true });
    await expect(data.reloadRows()).rejects.toMatchObject({ code: 'ODATA_COMPLETENESS_ERROR' });
    expect(cache.cache.get('MOVMAT_DATA')).toBe(entry);
});
test('an unexpected OData load failure cannot activate EXPORT', async () => {
    jest.spyOn(provider, 'loadData').mockRejectedValue(new Error('private-error'));
    await expect(data.getRowsCached()).rejects.toMatchObject({ code: 'ODATA_TRANSPORT_ERROR' });
    expect(require('../src/services/ExportService').exportToCsvBuffer).not.toHaveBeenCalled();
});
test('TOP_N underfilled without certification remains indeterminate', async () => {
    await expect(provider.executeFilteredQuery({ top: 2 })).rejects.toMatchObject({ code: 'ODATA_COMPLETENESS_ERROR', details: { reason: 'INCOMPLETE_RESULT' } });
});
test('a mock result without registered context is blocked at the chat boundary', async () => {
    jest.spyOn(provider, 'executeFilteredQuery').mockResolvedValue([row()]);
    const result = await chat(); expect(result.status).toBe(503); expect(result.body.details.reason).toBe('UNVALIDATED_COVERAGE');
    expect(require('../src/services/GeminiService').generateResponse).not.toHaveBeenCalled();
});
test('certified grouped ranking consumes the entire scope, not TOP_N rows', async () => {
    certifySynthetic();
    require('../src/services/IntentRouterService').route.mockResolvedValue({ intent: 'top_centers_by_movements_on_date', slots: { date: '2024-01-01', topN: 1 } });
    pages = [{ value: [row()], '@odata.nextLink': '?cursor=1' }, { value: [{ ...row(), ID_CENTRO: 'B' }, { ...row(), ID_CENTRO: 'B' }] }];
    const result = await chat(); expect(result.status).toBe(200); expect(result.body.data[0].center).toBe('B'); expect(calls).toBe(2);
    const requests = fetch.mock.calls.filter(([url]) => !new URL(url).pathname.endsWith('/$metadata'));
    expect(new URL(requests[0][0]).searchParams.has('$top')).toBe(false);
});
test('certified insight templates expose temporal uncertainty without invoking Gemini', async () => {
    certifySynthetic(); require('../src/services/IntentRouterService').route.mockResolvedValue({ intent: 'compare_total_volume_between_months', slots: { year: 2024, months: [1, 2] } });
    const result = await chat(); expect(result.status).toBe(200); expect(result.body.meta.exact).toBe(false); expect(result.body.meta.temporalConsistency).toBe('UNVERIFIED');
});
test.each([[50, 200], [1, 503]])('raw HTTP preview of %s rows is limited or explicitly indeterminate', async (size, status) => {
    pages = [{ value: Array.from({ length: size }, row) }];
    const result = await chat('/ds/movmat', 'GET'); expect(result.status).toBe(status);
    if (status === 200) { expect(result.body.value).toHaveLength(50); expect(result.body.coverage.status).toBe('LIMITED'); }
    else { expect(result.body.code).toBe('ODATA_COMPLETENESS_ERROR'); expect(result.body.value).toBeUndefined(); }
});
test('HTTP reload cannot report success using an older valid snapshot', async () => {
    certifySynthetic(); const old = await data.reloadRows();
    require('../src/services/ODataCapabilities').forConfiguredAsset.mockReturnValue({ continuationSupported: false, serverCount: true });
    const result = await chat('/csv/reload'); expect(result.status).toBe(503); expect(result.body.success).toBe(false);
    expect(cache.get('MOVMAT_DATA')).toBe(old);
});
test('uncertified insights and raw fetch reject instead of providing partial context', async () => {
    await expect(data.getInsights()).rejects.toMatchObject({ code: 'ODATA_COMPLETENESS_ERROR' });
    await expect(data.fetchMovMat({ top: null })).rejects.toMatchObject({ code: 'ODATA_COMPLETENESS_ERROR' });
});
