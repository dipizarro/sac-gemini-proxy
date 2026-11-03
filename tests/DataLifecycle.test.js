jest.mock('../src/config/config', () => ({ datasphere: {} }));
jest.mock('../src/providers/DataProviderFactory', () => ({
    getDataProvider: jest.fn(() => ({ loadData: mockLoad }))
}));
jest.mock('../src/services/ExportService', () => ({ exportToCsvBuffer: jest.fn() }));
const mockLoad = jest.fn();
const data = require('../src/services/DataService');
const cache = require('../src/services/CacheService');
const query = require('../src/services/QueryService');
const profile = require('../src/services/DatasetProfileService');
const config = require('../src/config/config');
const exportsService = require('../src/services/ExportService');
const a = [{ FECHA: '2024-01-01', ID_CENTRO: 'A' }];
const b = [{ FECHA: '2025-01-01', ID_CENTRO: 'B' }, { FECHA: '2025-01-01', ID_CENTRO: 'C' }];

beforeEach(() => {
    cache.flush();
    jest.clearAllMocks();
    mockLoad.mockReset().mockResolvedValue(a);
    delete config.datasphere.exportUrl;
});

test('cold query awaits provider and warm query reuses data', async () => {
    expect((await query.countDistinctCentersByDate('2024-01-01')).sampleCenters).toEqual(['A']);
    await query.countDistinctCentersByDate('2024-01-01');
    expect(mockLoad).toHaveBeenCalledTimes(1);
});

test('successful reload replaces data and invalidates both derivatives', async () => {
    await data.getRowsCached();
    await query.countDistinctCentersByDate('2024-01-01');
    profile.getDatasetProfile(a);
    mockLoad.mockResolvedValue(b);
    await data.reloadRows();
    expect(cache.get('MOVMAT_INDEX_V1')).toBeNull();
    expect(cache.get('MOVMAT_PROFILE_V1')).toBeNull();
    expect((await query.countDistinctCentersByDate('2025-01-01')).distinctCenters).toBe(2);
    expect(profile.getDatasetProfile(b).defaultYear).toBe(2025);
});

test('failed reload preserves dataset, index and profile even with export configured', async () => {
    await data.getRowsCached();
    await query.countDistinctCentersByDate('2024-01-01');
    profile.getDatasetProfile(a);
    const keys = ['MOVMAT_DATA', 'MOVMAT_INDEX_V1', 'MOVMAT_PROFILE_V1'];
    const previous = keys.map(k => cache.get(k));
    config.datasphere.exportUrl = 'https://unused.invalid';
    mockLoad.mockRejectedValue(new Error('offline'));
    await expect(data.reloadRows()).rejects.toThrow('offline');
    keys.forEach((k, i) => expect(cache.get(k)).toBe(previous[i]));
    expect(exportsService.exportToCsvBuffer).not.toHaveBeenCalled();
});

test('expired data refreshes before using a still-live index', async () => {
    await data.getRowsCached();
    await query.countDistinctCentersByDate('2024-01-01');
    profile.getDatasetProfile(a);
    cache.set('MOVMAT_DATA', a, -1);
    mockLoad.mockResolvedValue(b);
    expect((await query.countDistinctCentersByDate('2025-01-01')).distinctCenters).toBe(2);
    expect(profile.getDatasetProfile(b).defaultYear).toBe(2025);
});

test('clearCache removes all three entries', async () => {
    await data.getRowsCached();
    await query.countDistinctCentersByDate('2024-01-01');
    profile.getDatasetProfile(a);
    data.clearCache();
    for (const key of ['MOVMAT_DATA', 'MOVMAT_INDEX_V1', 'MOVMAT_PROFILE_V1']) expect(cache.get(key)).toBeNull();
});

test('concurrent cold readers share one load', async () => {
    const results = await Promise.all([data.getRowsCached(), data.getRowsCached()]);
    expect(results).toEqual([a, a]);
    expect(mockLoad).toHaveBeenCalledTimes(1);
});

test('empty dataset is valid and cached', async () => {
    mockLoad.mockResolvedValue([]);
    expect(await data.getRowsCached()).toEqual([]);
    expect(await data.getRowsCached()).toEqual([]);
    expect(mockLoad).toHaveBeenCalledTimes(1);
});

test('profile of a different snapshot cannot reuse or overwrite current profile', async () => {
    await data.getRowsCached();
    const current = profile.getDatasetProfile(a);
    expect(profile.getDatasetProfile(b).defaultYear).toBe(2025);
    expect(cache.get('MOVMAT_PROFILE_V1')).toBe(current);
});

test('cold provider failure retains export fallback', async () => {
    config.datasphere.exportUrl = 'https://unused.invalid';
    mockLoad.mockRejectedValue(new Error('offline'));
    exportsService.exportToCsvBuffer.mockResolvedValue(Buffer.from('FECHA,ID_CENTRO\n2025-01-01,B\n'));
    expect(await data.getRowsCached()).toEqual([b[0]]);
    expect(cache.get('MOVMAT_DATA')).toEqual([b[0]]);
});

test.each([null, {}, [null]])('invalid provider result %j preserves last valid snapshot', async invalid => {
    await data.getRowsCached();
    await query.countDistinctCentersByDate('2024-01-01');
    const currentProfile = profile.getDatasetProfile(a);
    const currentIndex = cache.get('MOVMAT_INDEX_V1');
    mockLoad.mockResolvedValue(invalid);
    await expect(data.reloadRows()).rejects.toThrow('array of records');
    expect(cache.get('MOVMAT_DATA')).toBe(a);
    expect(cache.get('MOVMAT_INDEX_V1')).toBe(currentIndex);
    expect(cache.get('MOVMAT_PROFILE_V1')).toBe(currentProfile);
});

test('readers retain old snapshot while reload is pending, then see the new one', async () => {
    await data.getRowsCached();
    let finish;
    mockLoad.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const reload = data.reloadRows();
    expect(await data.getRowsCached()).toBe(a);
    finish(b);
    await reload;
    expect(await data.getRowsCached()).toBe(b);
});

test('clear during I/O prevents an older load from overwriting a newer dataset', async () => {
    let finish;
    mockLoad.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const oldLoad = data.getRowsCached();
    data.clearCache();
    mockLoad.mockResolvedValue(b);
    await data.getRowsCached();
    const currentProfile = profile.getDatasetProfile(b);
    finish(a);
    await oldLoad;
    expect(cache.get('MOVMAT_DATA')).toBe(b);
    expect(cache.get('MOVMAT_PROFILE_V1')).toBe(currentProfile);
});

test('explicit reload waits for cold load and then fetches fresh data', async () => {
    let finish;
    mockLoad.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(b);
    const coldLoad = data.getRowsCached();
    const reload = data.reloadRows();
    expect(mockLoad).toHaveBeenCalledTimes(1);
    finish(a);
    await coldLoad;
    expect(await reload).toBe(b);
    expect(mockLoad).toHaveBeenCalledTimes(2);
    expect(cache.get('MOVMAT_DATA')).toBe(b);
});
