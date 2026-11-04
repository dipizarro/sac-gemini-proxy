jest.mock('../src/config/config', () => ({ datasphere: { exportUrl: 'https://unused.invalid' } }));
jest.mock('../src/services/ExportService', () => ({ exportToCsvBuffer: jest.fn() }));
const fs = require('fs');
const csv = require('../src/providers/CsvProvider');
const header = 'MATERIAL1,FECHA,ID_CENTRO,GRUPO_ARTICULOS,CLASE_MOVIMIENTO,SUMA_NETA';
const row = 'TEST,2024-01-01,A,G,C,10';
async function load(text, action = () => csv.loadData()) {
    const read = fs.readFileSync, exists = fs.existsSync;
    const a = jest.spyOn(fs, 'readFileSync').mockImplementation((p, ...args) => p === csv.csvPath ? Buffer.from(text) : read(p, ...args));
    const b = jest.spyOn(fs, 'existsSync').mockImplementation(p => p === csv.csvPath || exists(p));
    try { return await action(); } finally { a.mockRestore(); b.mockRestore(); }
}
test.each([
    header+'\n'+row+',99', header+'\nTEST,2024-01-01,A,G,C',
    header+',SUMA_NETA\n'+row+',99', header+',ID CENTRO\n'+row+',B',
    header.replace('FECHA','OTRA')+'\n'+row,
    ',SUMA_NETA\n'+header+'\n'+row,
    header+'\n"broken',
])('rejects invalid structural fixture %#', async text => {
    await expect(load(text)).rejects.toMatchObject({ code: 'SCHEMA_CONTRACT_MISMATCH' });
});
test('valid double header and empty data', async () => {
    const text = ',,,,,SUMA_NETA\n'+header.replace('SUMA_NETA','');
    expect(await load(text+'\n'+row)).toHaveLength(1);
    expect(await load(header+'\n')).toEqual([]);
});
test('additional, anonymous, reordered and multiline columns survive', async () => {
    const rows = await load('SUMA_NETA,,MATERIAL1,FECHA,ID_CENTRO,GRUPO_ARTICULOS,CLASE_MOVIMIENTO,EXTRA\n10,opaque,TEST,2024-01-01,A,G,C,"line1\nline2"');
    expect(rows[0]).toMatchObject({ SUMA_NETA: '10', COL_1: 'opaque', EXTRA: 'line1\nline2' });
});
test('explicit copy context is required and validated', async () => {
    const rows = await load(header+'\n'+row);
    const data = require('../src/services/DataService');
    expect(() => data.sumBy(rows.slice(), 'ID_CENTRO', 'SUMA_NETA')).toThrow();
    const numeric = require('../src/utils/numeric');
    const copied = numeric.copyCsvContext(rows, rows.slice());
    expect(data.sumBy(copied, 'ID_CENTRO', 'SUMA_NETA')).toEqual({ A: 10 });
    expect(() => numeric.copyCsvContext(rows, [{ ...rows[0], EXTRA: 'new' }])).toThrow();
});
test('failed reload preserves snapshot, index and profile and never exports', async () => {
    const data = require('../src/services/DataService'), cache = require('../src/services/CacheService');
    const previous = process.env.DATA_SOURCE; process.env.DATA_SOURCE = 'CSV'; data.clearCache();
    try {
        const rows = await load(header+'\n'+row, () => data.reloadRows());
        await require('../src/services/QueryService').countDistinctCentersByDate('2024-01-01');
        require('../src/services/DatasetProfileService').getDatasetProfile(rows);
        const index = cache.get('MOVMAT_INDEX_V1'), profile = cache.get('MOVMAT_PROFILE_V1');
        await expect(load(header+'\n'+row+',extra', () => data.reloadRows())).rejects.toThrow();
        expect(cache.get('MOVMAT_DATA')).toBe(rows);
        expect(cache.get('MOVMAT_INDEX_V1')).toBe(index);
        expect(cache.get('MOVMAT_PROFILE_V1')).toBe(profile);
        data.clearCache();
        await expect(load(header+'\n'+row+',extra', () => data.getRowsCached())).rejects.toThrow();
        expect(require('../src/services/ExportService').exportToCsvBuffer).not.toHaveBeenCalled();
        await load(header+'\n'+row, () => data.reloadRows());
        expect(cache.get('MOVMAT_INDEX_V1')).toBeNull();
        expect(cache.get('MOVMAT_PROFILE_V1')).toBeNull();
    } finally { data.clearCache(); if (previous === undefined) delete process.env.DATA_SOURCE; else process.env.DATA_SOURCE = previous; }
});
test('declared padding must be empty and anonymous COL_2 is preserved', async () => {
    expect((await load(','+header+'\n,'+row))[0].SUMA_NETA).toBe('10');
    await expect(load(','+header+'\nsecret,'+row)).rejects.toMatchObject({ details: { reason: 'INCOMPATIBLE_COLUMN_LAYOUT' } });
    const h = header.replace('ID_CENTRO', ',ID_CENTRO');
    expect((await load(h+'\n'+row.replace(',A,',',opaque,A,')))[0].COL_2).toBe('opaque');
});
test('COL_8 without an approved historical layout cannot replace SUMA_NETA', async () => {
    await expect(load(header.replace('SUMA_NETA','COL_8')+'\n'+row)).rejects.toMatchObject({
        code: 'SCHEMA_CONTRACT_MISMATCH', details: { reason: 'MISSING_REQUIRED_COLUMN' }
    });
    await expect(load(header.replace('SUMA_NETA','')+'\n'+row)).rejects.toThrow();
});

test('COL_8 remains an additional column when the canonical metric exists', async () => {
    const rows = await load(header+',COL_8\n'+row+',other');
    expect(rows[0]).toMatchObject({ SUMA_NETA: '10', COL_8: 'other' });
    expect(require('../src/utils/numeric').readMetric(rows, rows[0], 'SUMA_NETA')).toBe(10);
});

// Count array element reads instead of relying on machine-dependent timings.
function trackReads(rows) {
    let reads = 0;
    return { rows: new Proxy(rows, { get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver);
    } }), count: () => reads };
}

test('context copy uses linear membership checks and preserves row identity', async () => {
    const numeric = require('../src/utils/numeric');
    const original = await load(header+'\n'+Array(100).fill(row).join('\n'));
    const tracked = trackReads(original);
    const context = numeric.assertCsvContext(original);
    numeric.registerValidatedCsv({ ...context, rows: tracked.rows });
    const before = tracked.count();
    const copied = numeric.copyCsvContext(tracked.rows, original.slice().reverse());
    expect(copied[0]).toBe(original[99]);
    expect(tracked.count() - before).toBeLessThan(100 * 5);
    expect(() => numeric.copyCsvContext(original, [{ ...original[0] }])).toThrow();
});

test('metric reads do not repeatedly traverse unregistered arrays', () => {
    const numeric = require('../src/utils/numeric');
    const tracked = trackReads(Array.from({ length: 100 }, () => ({ SUMA_NETA: '10' })));
    for (const item of tracked.rows) expect(numeric.readMetric(tracked.rows, item, 'SUMA_NETA')).toBe(10);
    expect(tracked.count()).toBeLessThan(100 * 3);
});

test('unregistered copies and mixed arrays reject reused CSV rows even after earlier reads', async () => {
    const numeric = require('../src/utils/numeric');
    const original = await load(header+'\n'+row);
    const mixed = [{ ID_CENTRO: 'A', SUMA_NETA: '10' }];
    expect(numeric.readMetric(mixed, mixed[0], 'SUMA_NETA')).toBe(10);
    mixed.push(original[0]);
    expect(() => numeric.readMetric(mixed, original[0], 'SUMA_NETA')).toThrow(expect.objectContaining({
        code: 'SCHEMA_CONTRACT_MISMATCH', details: { reason: 'UNVALIDATED_SNAPSHOT', source: 'CSV' }
    }));
    expect(() => require('../src/services/DataService').sumBy(mixed, 'ID_CENTRO', 'SUMA_NETA')).toThrow();
    expect(() => numeric.readMetric(original.slice(), original[0], 'SUMA_NETA')).toThrow();
});
