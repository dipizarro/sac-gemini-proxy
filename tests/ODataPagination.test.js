jest.mock('../src/config/config', () => ({ datasphere: { url: 'https://example.invalid/api/v1/datasphere/consumption/relational/Space/Asset/Rows' } }));
jest.mock('../src/services/OAuthService', () => ({ getAccessToken: jest.fn(async () => 'synthetic-secret') }));
const base = require('../src/config/config').datasphere.url;
const metadata = require('../src/services/ODataMetadataService');
const schema = require('../src/services/ODataSchemaService');
const numeric = require('../src/utils/numeric');
const transport = require('../src/services/ODataTransport');
const originalFetch = global.fetch;
const xml = type => `<Edmx xmlns="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0"><DataServices><Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="Demo"><EntityType Name="Row"><Property Name="SUMA_NETA" Type="${type}"/></EntityType><EntityContainer Name="Container"><EntitySet Name="Rows" EntityType="Demo.Row"/></EntityContainer></Schema></DataServices></Edmx>`;
const row = (value = '10') => ({ SUMA_NETA: value });
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': transport.FORMAT } });
let pages, requests, metricType;
beforeEach(() => {
    pages = [{ value: [row()] }]; requests = []; metricType = 'Edm.Int64';
    global.fetch = jest.fn(async (url, options) => {
        if (new URL(url).pathname.endsWith('/$metadata')) return new Response(xml(metricType), { headers: { 'Content-Type': 'application/xml' } });
        requests.push({ url: String(url), options });
        const page = pages.shift();
        if (typeof page === 'function') return page(url, options);
        return page instanceof Response ? page : json(page);
    });
});
afterEach(() => { metadata.clear(); global.fetch = originalFetch; jest.restoreAllMocks(); jest.clearAllMocks(); });
const run = options => require('../src/services/ODataPaginationService').traverse({ mode: 'COMPLETE_COLLECTION', select: ['SUMA_NETA'], continuationSupported: true, ...options });
const failure = reason => expect.objectContaining({ details: expect.objectContaining({ reason }) });

test.each([null, [], 7, { mode: 'COMPLETE_COLLECTION', unknown: true }, { mode: 'TOP_N', top: 1, skip: 5 }])('rejects unsupported options with sanitized PaginationError', async options => {
    await expect(require('../src/services/ODataPaginationService').traverse(options)).rejects.toMatchObject({ code: 'ODATA_COMPLETENESS_ERROR', details: { reason: 'INVALID_OPTIONS' } });
    expect(global.fetch).not.toHaveBeenCalled();
});

test('short pages follow opaque relative links; preserve strict context and multiplicity', async () => {
    const token = '?$skiptoken=A%2Bb%2F%3D&custom=x+z';
    pages = [{ value: [row()], '@odata.nextLink': token, '@odata.count': '3' }, { value: [], '@odata.nextLink': '?cursor=2' }, { value: [row(), row()] }];
    const result = await run();
    expect(result.rows).toHaveLength(3);
    expect(result.coverage).toMatchObject({ status: 'COMPLETE', pages: 3, rows: 3, temporalConsistency: 'UNVERIFIED', count: { value: 3, matched: true }, continuation: { followed: 2 } });
    expect(requests[1].url).toBe(base + token);
    for (const request of requests) expect(request.options).toMatchObject({ redirect: 'error', headers: { Accept: transport.FORMAT, Authorization: 'Bearer synthetic-secret' } });
    expect(schema.context(result.rows).source).toBe('ODATA');
    expect(numeric.readMetric(result.rows, result.rows[0], 'SUMA_NETA')).toBe(10);
});
test.each(['https://foreign.invalid/Rows', base.replace('https:', 'http:'), base.replace('example.invalid', 'example.invalid:444'), base.replace('example.invalid', 'u:p@example.invalid'), base.replace('/Rows', '/Other'), base + '#fragment', '', null, 7])('rejects unauthorized or invalid nextLink %s before sending credentials', async link => {
    pages = [{ value: [row()], '@odata.nextLink': link }];
    await expect(run()).rejects.toEqual(failure('NEXT_LINK_REJECTED'));
    expect(requests).toHaveLength(1);
});
test('continuation cycle is rejected', async () => {
    pages = [{ value: [], '@odata.nextLink': '?cursor=1' }, { value: [], '@odata.nextLink': '?cursor=1' }];
    await expect(run()).rejects.toEqual(failure('CONTINUATION_CYCLE'));
    expect(requests).toHaveLength(2);
});
test.each([301, 302, 307, 308])('redirect %s is rejected without following it', async status => {
    pages = [new Response(null, { status, headers: { Location: 'https://foreign.invalid' } })];
    await expect(run()).rejects.toEqual(failure('REDIRECT_REJECTED'));
    expect(requests).toHaveLength(1);
});
test('intermediate transport failure exposes no partial rows or remote message', async () => {
    pages = [{ value: [row()], '@odata.nextLink': '?cursor=1' }, () => { throw new Error('private-url synthetic-secret'); }];
    try { await run(); throw new Error('unexpected success'); } catch (error) {
        expect(error).toEqual(failure('REQUEST_FAILED'));
        expect(error.coverage).toMatchObject({ status: 'FAILED', pages: 1, rows: 1 });
        expect(error.rows).toBeUndefined();
        expect(JSON.stringify(error)).not.toMatch(/private-url|synthetic-secret/);
    }
});
test('transport JSON negotiation is enforced on every page', async () => {
    pages = [{ value: [row()], '@odata.nextLink': '?cursor=1' }, new Response('{"value":[]}', { headers: { 'Content-Type': 'application/json' } })];
    await expect(run()).rejects.toMatchObject({ code: 'ODATA_TRANSPORT_ERROR', details: { reason: 'CONTENT_TYPE' } });
});
test('schema is checked on every page', async () => {
    pages = [{ value: [row()], '@odata.nextLink': '?cursor=1' }, { value: [{ OTHER: '10' }] }];
    await expect(run()).rejects.toEqual(failure('MISSING_REQUIRED_COLUMN'));
});
test('final metadata check rejects a changed contract', async () => {
    pages = [() => { metricType = 'Edm.Decimal'; metadata.clear(); return json({ value: [] }); }];
    await expect(run()).rejects.toEqual(failure('SCHEMA_CHANGED_DURING_LOAD'));
});
test('count mismatch rejects a complete candidate', async () => {
    pages = [{ value: [row()], '@odata.count': '2' }];
    await expect(run()).rejects.toEqual(failure('COUNT_MISMATCH'));
});
test('count changing between pages is rejected', async () => {
    pages = [{ value: [row()], '@odata.count': '2', '@odata.nextLink': '?cursor=1' }, { value: [row()], '@odata.count': '3' }];
    await expect(run()).rejects.toEqual(failure('COUNT_MISMATCH'));
});
test('count absent does not prevent backed server exhaustion', async () => {
    expect((await run()).coverage.count).toEqual({ available: false });
});
test('count matching rows alone does not certify continuation semantics', async () => {
    pages = [{ value: [row()], '@odata.count': '1' }];
    await expect(run({ continuationSupported: false })).rejects.toMatchObject({ coverage: { status: 'INDETERMINATE' }, details: { reason: 'INCOMPLETE_RESULT' } });
});
test('server count retains filter scope without fetching records', async () => {
    pages = [{ value: [], '@odata.count': '123' }];
    const result = await run({ mode: 'SERVER_COUNT', filter: 'SUMA_NETA gt 0' });
    expect(result.count).toBe(123);
    expect(result.coverage.scope.filter).toBe('SUMA_NETA gt 0');
    expect(new URL(requests[0].url).searchParams.get('$top')).toBe('0');
    expect(new URL(requests[0].url).searchParams.get('$count')).toBe('true');
});
test.each([undefined, '9007199254740993', '-1', '2bad'])('invalid or missing server count %s', async count => {
    pages = [{ value: [], ...(count === undefined ? {} : { '@odata.count': count }) }];
    await expect(run({ mode: 'SERVER_COUNT' })).rejects.toThrow();
});
test('global Top N spans pages and is LIMITED even with more records available', async () => {
    pages = [{ value: [row()], '@odata.nextLink': '?cursor=1', '@odata.count': '20' }, { value: [row(), row()], '@odata.nextLink': '?cursor=2' }];
    const result = await run({ mode: 'TOP_N', top: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.coverage).toMatchObject({ status: 'LIMITED', rows: 3, returnedRows: 2, termination: 'TOP_N_REACHED' });
    expect(requests).toHaveLength(2);
});
test('Top N underfilled requires backed exhaustion', async () => {
    await expect(run({ mode: 'TOP_N', top: 5, continuationSupported: false })).rejects.toEqual(failure('INCOMPLETE_RESULT'));
});
test('empty collection is complete only under backed exhaustion', async () => {
    pages = [{ value: [] }];
    expect((await run()).coverage).toMatchObject({ status: 'COMPLETE', rows: 0 });
});
test.each([['maxPages', 1, 'PAGE_LIMIT'], ['maxRows', 1, 'ROW_LIMIT'], ['maxResponseBytes', 10, 'RESPONSE_BYTE_LIMIT'], ['maxBytes', 10, 'TOTAL_BYTE_LIMIT']])('enforces %s', async (key, value, reason) => {
    pages = [{ value: [row()], '@odata.nextLink': '?cursor=1' }, { value: [row()] }];
    await expect(run({ limits: { [key]: value } })).rejects.toMatchObject({ details: { reason }, coverage: { status: 'INDETERMINATE' } });
});
test('streaming limits work without Content-Length', async () => {
    pages = [new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(100)); controller.close(); } }), { headers: { 'Content-Type': transport.FORMAT } })];
    await expect(run({ limits: { maxResponseBytes: 50 } })).rejects.toEqual(failure('RESPONSE_BYTE_LIMIT'));
});
test('request deadline covers a stalled body and aborts the signal', async () => {
    let signal;
    pages = [(_url, options) => { signal = options.signal; return new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': transport.FORMAT } }); }];
    await expect(run({ limits: { requestMs: 30 } })).rejects.toEqual(failure('REQUEST_TIMEOUT'));
    expect(signal.aborted).toBe(true);
});
test('global deadline includes metadata acquisition', async () => {
    jest.spyOn(schema, 'prepare').mockImplementation(() => new Promise(() => {}));
    await expect(run({ limits: { totalMs: 20 } })).rejects.toEqual(failure('GLOBAL_TIMEOUT'));
    expect(requests).toHaveLength(0);
});
test('numeric quality remains independent of coverage and uses strict Int64', async () => {
    pages = [{ value: [row('9007199254740993')] }];
    const result = await run();
    expect(result.coverage.status).toBe('COMPLETE');
    expect(() => numeric.readMetric(result.rows, result.rows[0], 'SUMA_NETA')).toThrow(expect.objectContaining({ code: 'DATA_QUALITY_ERROR' }));
});

test('filtered complete scope never introduces top or skip', async () => {
    const result = await run({ mode: 'COMPLETE_FILTERED', filter: 'SUMA_NETA gt 0', orderby: 'SUMA_NETA asc' });
    const query = new URL(requests[0].url).searchParams;
    expect(query.get('$filter')).toBe('SUMA_NETA gt 0');
    expect(query.has('$top')).toBe(false); expect(query.has('$skip')).toBe(false);
    expect(result.coverage.scope.orderby).toBe('SUMA_NETA asc');
});
test('default continuation capability is unverified', async () => {
    await expect(run({ continuationSupported: undefined })).rejects.toEqual(failure('INCOMPLETE_RESULT'));
});
test('Top N underfilled succeeds only as LIMITED when exhaustion is backed', async () => {
    const result = await run({ mode: 'TOP_N', top: 5 });
    expect(result.coverage).toMatchObject({ status: 'LIMITED', termination: 'SERVER_EXHAUSTED', returnedRows: 1 });
});
test.each([{ value: [row()], '@odata.count': '1' }, { value: [], '@odata.count': '0', '@odata.nextLink': '?cursor=1' }])('count cannot return rows or continuation', async body => {
    pages = [body];
    await expect(run({ mode: 'SERVER_COUNT' })).rejects.toEqual(failure('INVALID_COUNT_RESPONSE'));
});
test('server zero is a legitimate count', async () => {
    pages = [{ value: [], '@odata.count': '0' }];
    expect((await run({ mode: 'SERVER_COUNT' })).count).toBe(0);
});
test('total bytes are accumulated across responses', async () => {
    const first = { value: [row()], '@odata.nextLink': '?cursor=1' };
    const second = { value: [row()] };
    pages = [first, second];
    const limit = Buffer.byteLength(JSON.stringify(first)) + Buffer.byteLength(JSON.stringify(second)) - 1;
    await expect(run({ limits: { maxBytes: limit } })).rejects.toEqual(failure('TOTAL_BYTE_LIMIT'));
    expect(requests).toHaveLength(2);
});
test('exact row/page/byte boundaries permit a terminal page', async () => {
    const bytes = Buffer.byteLength(JSON.stringify(pages[0]));
    const result = await run({ limits: { maxRows: 1, maxPages: 1, maxBytes: bytes, maxResponseBytes: bytes } });
    expect(result.coverage.bytes).toBe(bytes);
});
test('declared oversized response is cancelled without reading', async () => {
    let cancelled = false;
    pages = [new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Length': '500', 'Content-Type': transport.FORMAT } })];
    await expect(run({ limits: { maxResponseBytes: 100 } })).rejects.toEqual(failure('RESPONSE_BYTE_LIMIT'));
    expect(cancelled).toBe(true);
});
test('HTTP error bodies are never parsed or exposed', async () => {
    pages = [new Response('synthetic-secret', { status: 500 })];
    await expect(run()).rejects.toMatchObject({ code: 'ODATA_TRANSPORT_ERROR', details: { reason: 'HTTP_ERROR' } });
});
test('malformed JSON and numeric JSON Int64 are rejected', async () => {
    pages = [new Response('{', { headers: { 'Content-Type': transport.FORMAT } })];
    await expect(run()).rejects.toEqual(failure('INVALID_JSON'));
    pages = [{ value: [row(10)] }];
    await expect(run()).rejects.toEqual(failure('INT64_REPRESENTATION'));
});
test('final metadata validation is covered by the global deadline', async () => {
    await metadata.get();
    jest.spyOn(schema, 'finish').mockImplementation(() => new Promise(() => {}));
    await expect(run({ limits: { totalMs: 50 } })).rejects.toEqual(failure('GLOBAL_TIMEOUT'));
});
test('stalled fetch is aborted without retry', async () => {
    let signal;
    pages = [(_url, options) => { signal = options.signal; return new Promise(() => {}); }];
    await expect(run({ limits: { requestMs: 25 } })).rejects.toEqual(failure('REQUEST_TIMEOUT'));
    expect(signal.aborted).toBe(true); expect(requests).toHaveLength(1);
});
test.each([{ mode: 'OTHER' }, { mode: 'COMPLETE_COLLECTION', filter: 'SUMA_NETA gt 0' }, { mode: 'COMPLETE_FILTERED' }, { mode: 'TOP_N', top: 0 }, { limits: { maxPages: 1001 } }])('invalid options rejected before any network request', async options => {
    await expect(run(options)).rejects.toEqual(failure('INVALID_OPTIONS'));
    expect(global.fetch).not.toHaveBeenCalled();
});
test('global remaining time bounds the request timeout', async () => {
    await metadata.get();
    let signal;
    pages = [(_url, options) => { signal = options.signal; return new Promise(() => {}); }];
    await expect(run({ limits: { totalMs: 60, requestMs: 100 } })).rejects.toEqual(failure('GLOBAL_TIMEOUT'));
    expect(signal.aborted).toBe(true);
});
test('sanitized errors omit query literals and internal scope', async () => {
    pages = [() => { throw new Error('private-body'); }];
    try {
        await run({ mode: 'COMPLETE_FILTERED', filter: "SUMA_NETA eq 'private-literal'" });
        throw new Error('unexpected success');
    } catch (error) {
        expect(error).toEqual(failure('REQUEST_FAILED'));
        expect(error.coverage.scope).toBeUndefined();
        expect(JSON.stringify(error)).not.toMatch(/private-literal|private-body|example.invalid/);
    }
});
