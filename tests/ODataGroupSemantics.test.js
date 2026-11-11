// Characterization only: demonstrates the mismatch without changing production semantics.
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
let records;
beforeEach(() => {
    records = [];
    global.fetch = jest.fn(async url => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/$metadata')) return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
        // Synthetic server obeys the proposed literal equality. No claim about SAP collation.
        const filter = parsed.searchParams.get('$filter');
        if (filter) expect(filter).toBe(scope.filter({ kind: 'DATE_GROUP', date, group: target }));
        const value = filter ? records.filter(row => row.FECHA === date && row.GRUPO_ARTICULOS === target) : records;
        return new Response(JSON.stringify({ value }), { headers: { 'Content-Type': require('../src/services/ODataTransport').FORMAT } });
    });
});
afterEach(() => { metadata.clear(); global.fetch = originalFetch; jest.clearAllMocks(); });
function make(group, value = '10') {
    return { MATERIAL1: 1, FECHA: date, ID_CENTRO: 'A', GRUPO_ARTICULOS: group, CLASE_MOVIMIENTO: 'C', SUMA_NETA: value };
}
test.each([
    ['exact', 'GRUPO', 10, 10],
    ['prefix', 'PRE_GRUPO', 10, 0],
    ['suffix', 'GRUPO_POST', 10, 0],
    ['case', 'grupo', 10, 0],
    ['spaces', ' GRUPO ', 10, 0],
    ['absent', 'OTRO', 0, 0],
    ['reverse substring', 'GRU', 10, 0],
    ['empty group', '', 10, 0],
    ['null group', null, 10, 0]
])('characterizes %s: current full collection versus exact filtered contract', async (_label, group, current, exact) => {
    records = [make(group)];
    const full = await provider.loadData();
    const filtered = await provider.executeFilteredQuery({ scope: { kind: 'DATE_GROUP', date, group: target } });
    expect(engine.sumSumaNetaByGroupAndDate(full, date, target).totalSumaNeta).toBe(current);
    expect(engine.sumSumaNetaByGroupAndDate(filtered, date, target).totalSumaNeta).toBe(exact);
    expect(records.filter(row => row.GRUPO_ARTICULOS === target).reduce((sum, row) => sum + Number(row.SUMA_NETA), 0)).toBe(exact);
});
test('contained group names yield different totals for full and filtered OData', async () => {
    records = [make('GRUPO', '10'), make('PRE_GRUPO', '20'), make('GRUPO_POST', '30'), make('GRU', '40'), make('OTRO', '50')];
    const full = await provider.loadData();
    const filtered = await provider.executeFilteredQuery({ scope: { kind: 'DATE_GROUP', date, group: target } });
    const a = engine.sumSumaNetaByGroupAndDate(full, date, target);
    const b = engine.sumSumaNetaByGroupAndDate(filtered, date, target);
    expect(a.totalSumaNeta).toBe(100); expect(a.totals.rowsMatched).toBe(4);
    expect(b.totalSumaNeta).toBe(10); expect(b.totals.rowsMatched).toBe(1);
});
