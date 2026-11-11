// OData literal equality regressions; certification is synthetic only.
jest.mock('../src/config/config', () => ({ datasphere: { url: 'https://example.invalid/api/v1/datasphere/consumption/relational/Space/Asset/Rows' } }));
jest.mock('../src/services/OAuthService', () => ({ getAccessToken: async () => 'synthetic' }));
jest.mock('../src/services/ODataCapabilities', () => ({ forConfiguredAsset: () => ({ continuationSupported: true, serverCount: true }) }));
const provider = require('../src/providers/ODataProvider');
const metadata = require('../src/services/ODataMetadataService');
const engine = require('../src/services/QueryEngineService');
const scope = require('../src/services/ODataQueryScope');
const originalFetch = global.fetch;
const date = '2024-01-01', target = 'GRUPO';
const fields = { MATERIAL1: 'Edm.Int32', FECHA: 'Edm.Date', ID_CENTRO: 'Edm.String', GRUPO_ARTICULOS: 'Edm.String', CLASE_MOVIMIENTO: 'Edm.String', SUMA_NETA: 'Edm.Int64' };
const xml = '<Edmx xmlns="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0"><DataServices><Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="Synthetic"><EntityType Name="Row">' +
    Object.entries(fields).map(([name, type]) => `<Property Name="${name}" Type="${type}"${['FECHA', 'ID_CENTRO'].includes(name) ? ' Nullable="false"' : ''}/>`).join('') +
    '</EntityType><EntityContainer Name="Container"><EntitySet Name="Rows" EntityType="Synthetic.Row"/></EntityContainer></Schema></DataServices></Edmx>';
let records, requestedGroup, violateFilter;
beforeEach(() => {
    records = []; requestedGroup = target; violateFilter = false;
    global.fetch = jest.fn(async url => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/$metadata')) return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
        // Synthetic server obeys literal equality. No claim about SAP collation.
        const filter = parsed.searchParams.get('$filter');
        if (filter) expect(filter).toBe(scope.filter({ kind: 'DATE_GROUP', date, group: requestedGroup }));
        const value = filter && !violateFilter ? records.filter(row => row.FECHA === date && row.GRUPO_ARTICULOS === requestedGroup) : records;
        return new Response(JSON.stringify({ value }), { headers: { 'Content-Type': require('../src/services/ODataTransport').FORMAT } });
    });
});
afterEach(() => { metadata.clear(); global.fetch = originalFetch; jest.clearAllMocks(); });
function make(group, value = '10') {
    return { MATERIAL1: 1, FECHA: date, ID_CENTRO: 'A', GRUPO_ARTICULOS: group, CLASE_MOVIMIENTO: 'C', SUMA_NETA: value };
}
test.each([
    ['exact', 'GRUPO', 10],
    ['prefix', 'PRE_GRUPO', 0],
    ['suffix', 'GRUPO_POST', 0],
    ['case', 'grupo', 0],
    ['spaces', ' GRUPO ', 0],
    ['absent', 'OTRO', 0],
    ['reverse substring', 'GRU', 0],
    ['empty group', '', 0],
    ['null group', null, 0]
])('requires literal equality for %s in full and filtered OData', async (_label, group, exact) => {
    records = [make(group)];
    const full = await provider.loadData();
    const filtered = await provider.executeFilteredQuery({ scope: { kind: 'DATE_GROUP', date, group: target } });
    expect(engine.sumSumaNetaByGroupAndDate(full, date, target).totalSumaNeta).toBe(exact);
    expect(engine.sumSumaNetaByGroupAndDate(filtered, date, target).totalSumaNeta).toBe(exact);
    expect(records.filter(row => row.GRUPO_ARTICULOS === target).reduce((sum, row) => sum + Number(row.SUMA_NETA), 0)).toBe(exact);
});
test('contained group names yield the same literal total for full and filtered OData', async () => {
    records = [make('GRUPO', '10'), make('PRE_GRUPO', '20'), make('GRUPO_POST', '30'), make('GRU', '40'), make('OTRO', '50')];
    const full = await provider.loadData();
    const filtered = await provider.executeFilteredQuery({ scope: { kind: 'DATE_GROUP', date, group: target } });
    const a = engine.sumSumaNetaByGroupAndDate(full, date, target);
    const b = engine.sumSumaNetaByGroupAndDate(filtered, date, target);
    expect(a.totalSumaNeta).toBe(10); expect(a.totals.rowsMatched).toBe(1);
    expect(b.totalSumaNeta).toBe(10); expect(b.totals.rowsMatched).toBe(1);
});
test.each(['grupo', ' GRUPO '])('preserves the accredited literal %s in both results', async group => {
    requestedGroup = group; records = [make(group), make('GRUPO_POST')];
    for (const rows of [await provider.loadData(), await provider.executeFilteredQuery({ scope: { kind: 'DATE_GROUP', date, group } })]) {
        const result = engine.sumSumaNetaByGroupAndDate(rows, date, group);
        expect(result.group).toBe(group); expect(result.totalSumaNeta).toBe(10);
    }
});
test.each(['OTRO', 'PRE_GRUPO', 'GRUPO_POST', 'grupo', ' GRUPO ', '', null])('rejects remote group %s outside DATE_GROUP instead of returning a partial sum', async group => {
    records = [make(target), make(group)]; violateFilter = true;
    await expect(provider.executeFilteredQuery({ scope: { kind: 'DATE_GROUP', date, group: target } })).rejects.toMatchObject({ code: 'ODATA_COMPLETENESS_ERROR', details: { reason: 'SCOPE_PAYLOAD_MISMATCH' }, statusCode: 502 });
});
test('rejects a mutated accredited group before aggregation and sanitizes the HTTP error', async () => {
    records = [make(target)];
    const rows = await provider.executeFilteredQuery({ scope: { kind: 'DATE_GROUP', date, group: target } });
    rows[0].GRUPO_ARTICULOS = 'PRIVATE_GROUP';
    let error;
    try { engine.sumSumaNetaByGroupAndDate(rows, date, target); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: 'ODATA_COMPLETENESS_ERROR', statusCode: 502 });
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    require('../src/middlewares/errorHandler')(error, {}, response, jest.fn());
    expect(JSON.stringify(response.json.mock.calls)).not.toMatch(/PRIVATE_GROUP|GRUPO|example.invalid/);
    expect(response.status).toHaveBeenCalledWith(502);
});
test('undefined group cannot bypass the structural contract', async () => {
    records = [make(undefined)]; violateFilter = true;
    await expect(provider.executeFilteredQuery({ scope: { kind: 'DATE_GROUP', date, group: target } })).rejects.toMatchObject({ code: 'SCHEMA_CONTRACT_MISMATCH' });
});
test('DATE_GROUP cannot certify a projection whose rows omit the group', async () => {
    records = [make(undefined)]; violateFilter = true;
    await expect(provider.executeFilteredQuery({ select: 'SUMA_NETA', scope: { kind: 'DATE_GROUP', date, group: target } }))
        .rejects.toMatchObject({ code: 'ODATA_COMPLETENESS_ERROR', details: { reason: 'SCOPE_PAYLOAD_MISMATCH' } });
});
test('CSV retains case/space normalization and flexible matches', () => {
    const rows = require('../src/utils/numeric').registerCsv([make('pre_grupo', '10'), make(' GRUPO_POST ', '20'), make('GRU', '30')], { SUMA_NETA: 'csv-integer-comma' });
    const result = engine.sumSumaNetaByGroupAndDate(rows, date, ' grupo ');
    expect(result.totalSumaNeta).toBe(60); expect(result.group).toBe('GRUPO');
});
test.each(['9007199254740993', 'invalid'])('literal matching preserves Int64 rejection for %s', async value => {
    records = [make(target, value)];
    const rows = await provider.executeFilteredQuery({ scope: { kind: 'DATE_GROUP', date, group: target } });
    expect(() => engine.sumSumaNetaByGroupAndDate(rows, date, target)).toThrow(expect.objectContaining({ code: 'DATA_QUALITY_ERROR' }));
});
