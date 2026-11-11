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
    'MATERIAL1,FECHA,ID_CENTRO,GRUPO_ARTICULOS,CLASE_MOVIMIENTO,SUMA_NETA\nTEST,2024-01-01,A,G,C,25\n',
    ',,,,,SUMA_NETA\nMATERIAL1,FECHA,ID_CENTRO,GRUPO_ARTICULOS,CLASE_MOVIMIENTO,\nTEST,2024-01-01,A,G,C,25\n'
])('real CSV parser and factory publish synthetic CSV', async text => {
    process.env.DATA_SOURCE = 'CSV';
    const originalRead = fs.readFileSync;
    const originalExists = fs.existsSync;
    jest.spyOn(fs, 'existsSync').mockImplementation(path => path === csv.csvPath || originalExists(path));
    jest.spyOn(fs, 'readFileSync').mockImplementation((path, ...args) => path === csv.csvPath ? Buffer.from(text) : originalRead(path, ...args));
    const rows = await data.reloadRows();
    expect(rows).toEqual([{ MATERIAL1: 'TEST', FECHA: '2024-01-01', ID_CENTRO: 'A', GRUPO_ARTICULOS: 'G', CLASE_MOVIMIENTO: 'C', SUMA_NETA: '25' }]);
    expect(await data.getRowsCached()).toBe(rows);
});

test('real factory selects asynchronous OData provider but cannot trust an unregistered cached array', async () => {
    process.env.DATA_SOURCE = 'ODATA';
    const rows = [{ FECHA: '2025-01-01', ID_CENTRO: 'B', SUMA_NETA: 25 }];
    odata.loadData.mockResolvedValue(rows);
    expect(await data.reloadRows()).toBe(rows);
    await expect(data.getRowsCached()).rejects.toMatchObject({ code: 'ODATA_COMPLETENESS_ERROR' });
    expect(odata.loadData).toHaveBeenCalledTimes(1);
});
