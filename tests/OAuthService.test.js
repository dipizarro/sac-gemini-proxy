jest.mock('../src/config/config', () => ({ datasphere: { oauth: {} } }));
const originalFetch = global.fetch;
let config, oauth, now;
const valid = (extra = {}) => ({ access_token: 'synthetic.token', token_type: 'Bearer', expires_in: 3600, ...extra });
const response = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
    jest.resetModules();
    config = require('../src/config/config');
    config.datasphere.oauth = { tokenUrl: 'https://issuer.invalid/token', clientId: 'synthetic-client', clientSecret: 'synthetic-secret' };
    now = 0; jest.spyOn(require('node:perf_hooks').performance, 'now').mockImplementation(() => now);
    oauth = require('../src/services/OAuthService');
    global.fetch = jest.fn(async () => response(valid()));
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); global.fetch = originalFetch; });
const failure = reason => expect.objectContaining({ code: 'OAUTH_ERROR', details: { reason } });

test('client_credentials POST returns a string and reuses a valid token', async () => {
    expect(await oauth.getAccessToken()).toBe('synthetic.token');
    expect(await oauth.getAccessToken()).toBe('synthetic.token');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://issuer.invalid/token');
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(options.body.toString()).toBe('grant_type=client_credentials');
    expect(options.signal).toBeInstanceOf(AbortSignal);
});
test('encodes both Basic components as form data before base64', async () => {
    config.datasphere.oauth.clientId = 'id:a b'; config.datasphere.oauth.clientSecret = 's+e:c&é';
    await oauth.getAccessToken();
    expect(Buffer.from(fetch.mock.calls[0][1].headers.Authorization.slice(6), 'base64').toString()).toBe('id%3Aa+b:s%2Be%3Ac%26%C3%A9');
});
test('shares a single cold request among concurrent consumers', async () => {
    const values = await Promise.all(Array.from({ length: 30 }, () => oauth.getAccessToken()));
    expect(values.every(value => value === 'synthetic.token')).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
});
test('refreshes at the margin and shares concurrent refresh', async () => {
    await oauth.getAccessToken(); now = 3539999; await oauth.getAccessToken(); expect(fetch).toHaveBeenCalledTimes(1);
    now = 3540000; await Promise.all([oauth.getAccessToken(), oauth.getAccessToken()]); expect(fetch).toHaveBeenCalledTimes(2);
});
test('short lifetime has a proportional margin, not an immediate refresh loop', async () => {
    fetch.mockImplementation(async () => response(valid({ expires_in: 10 })));
    await oauth.getAccessToken(); now = 8999; await oauth.getAccessToken(); expect(fetch).toHaveBeenCalledTimes(1);
    now = 9000; await oauth.getAccessToken(); expect(fetch).toHaveBeenCalledTimes(2);
});
test('uses request start time, rejects already stale tokens after slow responses', async () => {
    fetch.mockImplementation(async () => { now += 1000; return response(valid({ expires_in: 1 })); });
    await expect(oauth.getAccessToken()).rejects.toEqual(failure('TOKEN_EXPIRED'));
});
test('wall clock rollback cannot extend the cache', async () => {
    await oauth.getAccessToken(); jest.spyOn(Date, 'now').mockReturnValue(0); now = 3600000;
    await oauth.getAccessToken(); expect(fetch).toHaveBeenCalledTimes(2);
});
test('missing expires_in returns a token but never invents a cache lifetime', async () => {
    fetch.mockImplementation(async () => response(valid({ expires_in: undefined })));
    await oauth.getAccessToken(); await oauth.getAccessToken(); expect(fetch).toHaveBeenCalledTimes(2);
});
test.each([0, -1, null, 'invalid', '1.5', 1.5, '', true, '9007199254740993'])('invalid lifetime %# is rejected and not cached', async expires_in => {
    fetch.mockImplementationOnce(async () => response(valid({ expires_in })));
    await expect(oauth.getAccessToken()).rejects.toEqual(failure('INVALID_EXPIRY'));
    await expect(oauth.getAccessToken()).resolves.toBe('synthetic.token'); expect(fetch).toHaveBeenCalledTimes(2);
});
test.each([{ access_token: '' }, { access_token: 123 }, { access_token: 'a\r\nb' }, { access_token: 'has space' }, { token_type: 'MAC' }, { token_type: undefined }])('invalid token response %# is rejected', async extra => {
    fetch.mockImplementation(async () => response(valid(extra)));
    await expect(oauth.getAccessToken()).rejects.toEqual(failure('INVALID_TOKEN'));
});
test.each(['http://issuer.invalid/token', 'https://user:pass@issuer.invalid/token', 'https://issuer.invalid/token#fragment', 'not-a-url'])('unsafe configured endpoint %# makes no request', async tokenUrl => {
    config.datasphere.oauth.tokenUrl = tokenUrl;
    await expect(oauth.getAccessToken()).rejects.toEqual(failure('INVALID_CONFIG')); expect(fetch).not.toHaveBeenCalled();
});
test('missing configuration rejects even if a token was cached', async () => {
    await oauth.getAccessToken(); config.datasphere.oauth.clientSecret = '';
    await expect(oauth.getAccessToken()).rejects.toEqual(failure('INVALID_CONFIG')); expect(fetch).toHaveBeenCalledTimes(1);
});
test('credential rotation invalidates cache', async () => {
    await oauth.getAccessToken(); config.datasphere.oauth.clientSecret = 'rotated-synthetic';
    await oauth.getAccessToken(); expect(fetch).toHaveBeenCalledTimes(2);
});
test('HTTP failure is shared, remote error body is never read, next call can recover', async () => {
    const remote = new Response('PRIVATE_REMOTE_BODY', { status: 401 });
    const read = jest.spyOn(remote, 'text');
    fetch.mockResolvedValueOnce(remote);
    const results = await Promise.allSettled([oauth.getAccessToken(), oauth.getAccessToken()]);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(results[0].reason).toEqual(failure('HTTP_ERROR'));
    expect(JSON.stringify(results)).not.toContain('PRIVATE_REMOTE_BODY'); expect(read).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(oauth.getAccessToken()).resolves.toBe('synthetic.token');
});
test('network errors are sanitized without retaining the original cause', async () => {
    fetch.mockRejectedValue(new Error('PRIVATE_REMOTE_BODY synthetic-secret https://issuer.invalid/token'));
    try { await oauth.getAccessToken(); throw new Error('unexpected success'); } catch (error) {
        expect(error).toEqual(failure('REQUEST_FAILED'));
        expect(error.cause).toBeUndefined();
        expect(error.message + error.stack + JSON.stringify(error)).not.toMatch(/PRIVATE_REMOTE_BODY|synthetic-secret|issuer.invalid/);
    }
});
test('refresh failure never serves stale token and permits recovery', async () => {
    await oauth.getAccessToken(); now = 3600000;
    fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(oauth.getAccessToken()).rejects.toEqual(failure('REQUEST_FAILED'));
    await expect(oauth.getAccessToken()).resolves.toBe('synthetic.token'); expect(fetch).toHaveBeenCalledTimes(3);
});
test('rejects redirects', async () => {
    fetch.mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://foreign.invalid' } }));
    await expect(oauth.getAccessToken()).rejects.toEqual(failure('REDIRECT_REJECTED'));
    expect(fetch).toHaveBeenCalledTimes(1);
});
test('bounds streamed response before parsing', async () => {
    fetch.mockResolvedValue(new Response('x'.repeat(65537), { headers: { 'Content-Type': 'application/json' } }));
    await expect(oauth.getAccessToken()).rejects.toEqual(failure('RESPONSE_LIMIT'));
});
test('rejects non-JSON content and malformed JSON', async () => {
    fetch.mockResolvedValueOnce(new Response('private', { headers: { 'Content-Type': 'text/html' } }));
    await expect(oauth.getAccessToken()).rejects.toEqual(failure('CONTENT_TYPE'));
    fetch.mockResolvedValueOnce(new Response('{', { headers: { 'Content-Type': 'application/json' } }));
    await expect(oauth.getAccessToken()).rejects.toEqual(failure('INVALID_JSON'));
});
test('deadline aborts stalled fetch and resets single-flight', async () => {
    jest.useFakeTimers(); let signal;
    fetch.mockImplementationOnce((_url, options) => { signal = options.signal; return new Promise(() => {}); });
    const check = expect(oauth.getAccessToken()).rejects.toEqual(failure('TIMEOUT'));
    await jest.advanceTimersByTimeAsync(10001); await check; expect(signal.aborted).toBe(true);
    await expect(oauth.getAccessToken()).resolves.toBe('synthetic.token');
});
test('deadline covers body reading as well as headers', async () => {
    jest.useFakeTimers(); let cancelled = false;
    fetch.mockResolvedValue(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'application/json' } }));
    const check = expect(oauth.getAccessToken()).rejects.toEqual(failure('TIMEOUT'));
    await jest.advanceTimersByTimeAsync(10001); await check; expect(cancelled).toBe(true);
});
test('a late success after timeout cannot overwrite a recovered token', async () => {
    jest.useFakeTimers(); let finish;
    fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const check = expect(oauth.getAccessToken()).rejects.toEqual(failure('TIMEOUT'));
    await jest.advanceTimersByTimeAsync(10001); await check;
    await expect(oauth.getAccessToken()).resolves.toBe('synthetic.token');
    finish(response(valid({ access_token: 'synthetic.old' })));
    await jest.advanceTimersByTimeAsync(0);
    await expect(oauth.getAccessToken()).resolves.toBe('synthetic.token'); expect(fetch).toHaveBeenCalledTimes(2);
});
test('rotation aborts the prior flight and does not clear the new cache', async () => {
    let finish, signal;
    fetch.mockImplementationOnce((_url, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
    const check = expect(oauth.getAccessToken()).rejects.toEqual(failure('CONFIG_CHANGED'));
    config.datasphere.oauth.clientSecret = 'rotated-synthetic';
    await expect(oauth.getAccessToken()).resolves.toBe('synthetic.token'); await check; expect(signal.aborted).toBe(true);
    finish(response(valid({ access_token: 'synthetic.old' })));
    await Promise.resolve(); await Promise.resolve();
    await expect(oauth.getAccessToken()).resolves.toBe('synthetic.token'); expect(fetch).toHaveBeenCalledTimes(2);
});
test('rotation without a second caller also rejects the obsolete result', async () => {
    let finish;
    fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const check = expect(oauth.getAccessToken()).rejects.toEqual(failure('CONFIG_CHANGED'));
    config.datasphere.oauth.clientId = 'rotated-client'; finish(response(valid())); await check;
    await expect(oauth.getAccessToken()).resolves.toBe('synthetic.token');
});
test('invalid configuration aborts a pending acquisition', async () => {
    fetch.mockImplementationOnce(() => new Promise(() => {}));
    const first = expect(oauth.getAccessToken()).rejects.toEqual(failure('CONFIG_CHANGED'));
    delete config.datasphere.oauth.clientId;
    await expect(oauth.getAccessToken()).rejects.toEqual(failure('INVALID_CONFIG')); await first;
});
test('successful headers with oversized content length cancel without reading', async () => {
    let cancelled = false;
    fetch.mockResolvedValue(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'application/json', 'Content-Length': '65537' } }));
    await expect(oauth.getAccessToken()).rejects.toEqual(failure('RESPONSE_LIMIT')); expect(cancelled).toBe(true);
});
test('long lifetimes are capped for reuse without extending issuer expiry', async () => {
    fetch.mockImplementation(async () => response(valid({ expires_in: 172800 })));
    await oauth.getAccessToken(); now = 86400000;
    await oauth.getAccessToken(); expect(fetch).toHaveBeenCalledTimes(2);
});
test('canonical string lifetime and case-insensitive Bearer remain compatible', async () => {
    fetch.mockImplementation(async () => response(valid({ expires_in: '3600', token_type: 'bearer' })));
    await oauth.getAccessToken(); await oauth.getAccessToken(); expect(fetch).toHaveBeenCalledTimes(1);
});
test('invalid UTF-8 is not silently replaced before JSON decoding', async () => {
    fetch.mockResolvedValue(new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } }));
    await expect(oauth.getAccessToken()).rejects.toEqual(failure('INVALID_JSON'));
});
test('manual script never logs tokens or raw failures and makes no request on import', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const manual = require('../src/test-oauth-manual'); expect(fetch).not.toHaveBeenCalled();
    expect(await manual.runManualCheck()).toBe(0);
    now = 3600000; fetch.mockRejectedValue(new Error('PRIVATE_REMOTE_BODY'));
    expect(await manual.runManualCheck()).toBe(1);
    expect(JSON.stringify([...log.mock.calls, ...error.mock.calls])).not.toMatch(/synthetic.token|synthetic-secret|PRIVATE_REMOTE_BODY/);
});
test('metadata, paginated records and export retain the shared getAccessToken interface', async () => {
    config.datasphere.url = 'https://data.invalid/api/v1/datasphere/consumption/relational/Space/Asset/Rows';
    config.datasphere.exportUrl = 'https://export.invalid';
    const xml = '<Edmx xmlns="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0"><DataServices><Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="Demo"><EntityType Name="Row"><Property Name="SUMA_NETA" Type="Edm.Int64"/></EntityType><EntityContainer Name="Container"><EntitySet Name="Rows" EntityType="Demo.Row"/></EntityContainer></Schema></DataServices></Edmx>';
    fetch.mockImplementation(async (url, options) => {
        const target = new URL(url);
        if (target.hostname === 'issuer.invalid') return response(valid());
        expect(options.headers.Authorization).toBe('Bearer synthetic.token');
        if (target.pathname.endsWith('/$metadata')) return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
        if (target.hostname === 'export.invalid') return response({ id: 'synthetic-job' });
        return new Response(JSON.stringify({ value: [{ SUMA_NETA: '7' }] }), { headers: { 'Content-Type': 'application/json;IEEE754Compatible=true' } });
    });
    const [entry, job] = await Promise.all([
        require('../src/services/ODataMetadataService').get(),
        require('../src/services/ExportService').createExportJob({ resourcePath: 'synthetic' })
    ]);
    expect(entry.model.entitySet).toBe('Rows'); expect(job).toBe('synthetic-job');
    const result = await require('../src/services/ODataPaginationService').traverse({ mode: 'TOP_N', top: 1, select: ['SUMA_NETA'] });
    expect(result.rows[0].SUMA_NETA).toBe('7');
    expect(fetch.mock.calls.filter(([url]) => new URL(url).hostname === 'issuer.invalid')).toHaveLength(1);
});
