jest.mock('../src/config/config', () => ({ datasphere: {} }));
jest.mock('../src/providers/ODataProvider', () => ({ loadData: jest.fn() }));
const fs = require('fs');
const data = require('../src/services/DataService');
const csv = require('../src/providers/CsvProvider');
const odata = require('../src/providers/ODataProvider');
const originalSource = process.env.DATA_SOURCE;
afterEach(() => {
    jest.restoreAllMocks();
    data.clearCache();
    if (originalSource === undefined) delete process.env.DATA_SOURCE;
    else process.env.DATA_SOURCE = originalSource;
});

test.each([
    'MATERIAL1,FECHA,ID_CENTRO,SUMA_NETA\nTEST,2024-01-01,A,25\n',
    ',,,SUMA_NETA\nMATERIAL1,FECHA,ID_CENTRO,\nTEST,2024-01-01,A,25\n'
])('real CSV parser and factory publish synthetic CSV', async text => {
    process.env.DATA_SOURCE = 'CSV';
    const originalRead = fs.readFileSync;
    const originalExists = fs.existsSync;
    jest.spyOn(fs, 'existsSync').mockImplementation(path => path === csv.csvPath || originalExists(path));
    jest.spyOn(fs, 'readFileSync').mockImplementation((path, ...args) => path === csv.csvPath ? Buffer.from(text) : originalRead(path, ...args));
    const rows = await data.reloadRows();
    expect(rows).toEqual([{ MATERIAL1: 'TEST', FECHA: '2024-01-01', ID_CENTRO: 'A', SUMA_NETA: '25' }]);
    expect(await data.getRowsCached()).toBe(rows);
});

test('real factory selects asynchronous OData provider without accessing the network', async () => {
    process.env.DATA_SOURCE = 'ODATA';
    const rows = [{ FECHA: '2025-01-01', ID_CENTRO: 'B', SUMA_NETA: 25 }];
    odata.loadData.mockResolvedValue(rows);
    expect(await data.reloadRows()).toBe(rows);
    expect(await data.getRowsCached()).toBe(rows);
    expect(odata.loadData).toHaveBeenCalledTimes(1);
});
