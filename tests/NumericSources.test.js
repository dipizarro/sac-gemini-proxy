jest.mock('../src/config/config', () => ({ datasphere: { exportUrl: 'https://unused.invalid' } }));
jest.mock('../src/providers/ODataProvider', () => ({ loadData: jest.fn() }));
jest.mock('../src/services/ExportService', () => ({ exportToCsvBuffer: jest.fn() }));
const data = require('../src/services/DataService');
const csv = require('../src/providers/CsvProvider');
const odata = require('../src/providers/ODataProvider');
const exporter = require('../src/services/ExportService');
const numeric = require('../src/utils/numeric');
const previousSource = process.env.DATA_SOURCE;
afterEach(() => {
    data.clearCache(); jest.restoreAllMocks();
    if (previousSource === undefined) delete process.env.DATA_SOURCE;
    else process.env.DATA_SOURCE = previousSource;
});
test('OData selected by real factory does not receive CSV profile', async () => {
    process.env.DATA_SOURCE = 'ODATA';
    odata.loadData.mockResolvedValue([{ ID_CENTRO: 'TEST', SUMA_NETA: 1.5 }]);
    const rows = await data.getRowsCached();
    expect(numeric.isCsv(rows)).toBe(false);
    expect(data.sumBy(rows, 'ID_CENTRO', 'SUMA_NETA')).toEqual({ TEST: 1.5 });
});
test('export fallback remains unprofiled even when DATA_SOURCE is CSV', async () => {
    process.env.DATA_SOURCE = 'CSV';
    jest.spyOn(csv, 'loadData').mockRejectedValue(new Error('offline'));
    exporter.exportToCsvBuffer.mockResolvedValue(Buffer.from('ID_CENTRO,SUMA_NETA\nTEST,1.5\n'));
    const rows = await data.getRowsCached();
    expect(numeric.isCsv(rows)).toBe(false);
    expect(data.sumBy(rows, 'ID_CENTRO', 'SUMA_NETA')).toEqual({ TEST: 1.5 });
});
