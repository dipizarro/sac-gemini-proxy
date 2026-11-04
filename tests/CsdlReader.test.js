const path = require('path');
const http = require('http');
const EDM = 'http://docs.oasis-open.org/odata/ns/edm';
const EDMX = 'http://docs.oasis-open.org/odata/ns/edmx';
const schema = (body, name = 'Demo', alias = 'D') => `<Schema xmlns="${EDM}" Namespace="${name}" Alias="${alias}">${body}</Schema>`;
const wrap = body => `<e:Edmx xmlns:e="${EDMX}" Version="4.0"><e:DataServices>${body}</e:DataServices></e:Edmx>`;
const property = '<Property Name="SUMA_NETA" Type="Edm.Int64"/>';
const model = (props = property, extra = '') => wrap(schema(`<EntityType Name="Row">${props}</EntityType><EntityContainer Name="Container"><EntitySet Name="Rows" EntityType="D.Row"/></EntityContainer>${extra}`));
const read = (xml, options = {}) => require('../src/services/CsdlReader').read(xml, { entitySet: 'Rows', ...options });
const fails = (xml, reason, options) => expect(read(xml, options)).rejects.toMatchObject({ code: 'CSDL_READER_ERROR', details: { reason } });

test('normalizes the exact set/type and scalar Int64 without inventing facetas', async () => {
    const result = await read(model());
    expect(result).toMatchObject({ version: '4.0', container: 'Demo.Container', entitySet: 'Rows', entityType: 'Demo.Row',
        properties: [{ name: 'SUMA_NETA', type: 'Edm.Int64', collection: false, nullable: true, nullableDeclared: false, facets: {} }] });
});
test('Decimal and explicit Nullable retain declared applicable facets', async () => {
    const r = await read(model('<Property Name="SUMA_NETA" Type="Edm.Decimal" Nullable="false" Precision="18" Scale="2"/>'));
    expect(r.properties[0]).toMatchObject({ type: 'Edm.Decimal', nullable: false, nullableDeclared: true, facets: { precision: 18, scale: 2 } });
});
test('prefixes, schema aliases and multiple schemas do not confuse repeated property names', async () => {
    const xml = wrap(schema('<EntityType Name="Other"><Property Name="SUMA_NETA" Type="Edm.String"/></EntityType>', 'Other', 'O') +
        schema(`<EntityType Name="Row">${property}</EntityType>`, 'Target', 'T') +
        schema('<EntityContainer Name="Container"><EntitySet Name="Rows" EntityType="T.Row"/></EntityContainer>'));
    expect((await read(xml.replaceAll('e:', 'alternate:').replace('xmlns:e=', 'xmlns:alternate='))).properties[0].type).toBe('Edm.Int64');
});
test('inherits properties and distinguishes collection/navigation', async () => {
    const xml = wrap(schema(`<EntityType Name="Base">${property}</EntityType><EntityType Name="Row" BaseType="D.Base"><Property Name="Tags" Type="Collection(Edm.String)"/><NavigationProperty Name="Parent" Type="D.Base" Nullable="false"/></EntityType><EntityContainer Name="Container"><EntitySet Name="Rows" EntityType="D.Row"/></EntityContainer>`));
    const r = await read(xml);
    expect(r.properties.map(p => p.name)).toEqual(['SUMA_NETA', 'Tags']);
    expect(r.properties[1]).toMatchObject({ type: 'Edm.String', collection: true });
    expect(r.navigationProperties[0]).toMatchObject({ type: 'Demo.Base', collection: false, nullable: false });
});
test('preserves inline and targeted external annotations without interpreting labels', async () => {
    const r = await read(model('<Property Name="SUMA_NETA" Type="Edm.Int64"><Annotation Term="D.Unit" Path="Currency"/></Property>', '<Annotations Target="D.Row/SUMA_NETA"><Annotation Term="D.Label" String="synthetic"/></Annotations>'));
    expect(r.properties[0].annotations).toEqual([
        { term: 'Demo.Unit', qualifier: null, expression: { kind: 'Path', value: 'Currency' } },
        { term: 'Demo.Label', qualifier: null, expression: { kind: 'String', value: 'synthetic' } }
    ]);
});
test('explicit container disambiguates sets', async () => {
    const xml = model(property, '<EntityContainer Name="Second"><EntitySet Name="Rows" EntityType="D.Row"/></EntityContainer>');
    await fails(xml, 'AMBIGUOUS_ENTITY_SET');
    expect((await read(xml, { container: 'D.Second' })).container).toBe('Demo.Second');
});
test.each([
    ['missing set', model(), 'ENTITY_SET_NOT_FOUND', { entitySet: 'Absent' }],
    ['wrong case', model(), 'ENTITY_SET_NOT_FOUND', { entitySet: 'rows' }],
    ['unresolved type', model().replace('EntityType="D.Row"', 'EntityType="D.Absent"'), 'UNRESOLVED_REFERENCE'],
    ['cyclic base', model().replace('Name="Row">', 'Name="Row" BaseType="D.Row">'), 'CYCLIC_INHERITANCE'],
    ['duplicate property', model(property + property), 'DUPLICATE_DECLARATION'],
    ['duplicate type', model(property, '<EntityType Name="Row"/>'), 'DUPLICATE_DECLARATION'],
    ['duplicate set', model().replace('</EntityContainer>', '<EntitySet Name="Rows" EntityType="D.Row"/></EntityContainer>'), 'DUPLICATE_DECLARATION'],
    ['alias conflict', wrap(schema('') + schema('', 'Other', 'D')), 'DUPLICATE_DECLARATION'],
    ['bad nullable', model(property.replace('/>', ' Nullable="maybe"/>')), 'INVALID_FACET'],
    ['Int64 scale', model(property.replace('/>', ' Scale="0"/>')), 'INVALID_FACET'],
    ['partial precision', model('<Property Name="SUMA_NETA" Type="Edm.Decimal" Precision="18bad"/>'), 'INVALID_FACET'],
    ['unresolved navigation', model(property + '<NavigationProperty Name="Nav" Type="D.Absent"/>'), 'UNRESOLVED_REFERENCE'],
    ['complex metric', model('<Property Name="SUMA_NETA" Type="D.Complex"/>', '<ComplexType Name="Complex"/>'), 'UNSUPPORTED_STRUCTURE'],
    ['namespace', model().replace(EDM, 'urn:wrong'), 'INVALID_STRUCTURE'],
    ['version', model().replace('Version="4.0"', 'Version="4.01"'), 'UNSUPPORTED_VERSION'],
    ['missing services', `<e:Edmx xmlns:e="${EDMX}" Version="4.0"/>`, 'INVALID_STRUCTURE'],
    ['invalid XML', model().slice(0, -10), 'INVALID_XML'],
    ['recoverable attribute', model().replace('Name="Row"', 'Name=Row'), 'INVALID_XML'],
    ['duplicate XML attribute', model().replace('Name="Row"', 'Name="Row" Name="Other"'), 'INVALID_XML'],
    ['recoverable end tag', model().replace('</EntityType>', '</EntityType\n private>'), 'INVALID_XML'],
    ['text in structural element', model().replace('<EntityType ', 'unexpected<EntityType '), 'INVALID_STRUCTURE'],
    ['unbound entity', model(property.replace('SUMA_NETA', '&unknown;')), 'INVALID_XML'],
    ['DTD', '<!DOCTYPE e:Edmx>' + model(), 'FORBIDDEN_DECLARATION'],
    ['entity declaration', '<!DOCTYPE e:Edmx [<!ENTITY secret "x">]>' + model(), 'FORBIDDEN_DECLARATION'],
    ['encoding', '<?xml version="1.0" encoding="UTF-16"?>' + model(), 'UNSUPPORTED_ENCODING'],
].map(([label, xml, reason, options = {}]) => [label, xml, reason, options]))('%s is explicitly rejected', async (_label, xml, reason, options) => fails(xml, reason, options));

test.each([
    ['INPUT_LIMIT', { maxBytes: 10 }],
    ['DEPTH_LIMIT', { maxDepth: 3 }],
    ['NODE_LIMIT', { maxNodes: 3 }],
    ['ATTRIBUTE_LIMIT', { maxAttributes: 1 }],
    ['TIME_LIMIT', { timeoutMs: 1 }],
])('enforces %s with a real worker', async (reason, limits) => fails(model(), reason, { limits }));
test('large input fails before parsing and invalid UTF8 is rejected', async () => {
    await fails(' '.repeat(2 * 1024 * 1024 + 1), 'INPUT_LIMIT');
    await fails(Buffer.from([0xff]), 'UNSUPPORTED_ENCODING');
});
test('cannot raise safety ceilings', async () => fails(model(), 'INVALID_OPTIONS', { limits: { maxBytes: 1e9 } }));
test('private identifiers and parser diagnostics never escape errors', async () => {
    try { await read(model().replace('</EntityType>', '</PRIVATE_SECRET>')); throw Error('expected rejection'); }
    catch (e) {
        expect(e.code).toBe('CSDL_READER_ERROR');
        expect(JSON.stringify(e) + e.message + e.stack).not.toContain('PRIVATE_SECRET');
        expect(e.cause).toBeUndefined();
    }
});
test('DTD and external references cannot trigger network access', async () => {
    let requests = 0;
    const server = http.createServer((_req, res) => { requests++; res.end('blocked'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const url = `http://127.0.0.1:${server.address().port}/external`;
        await fails(`<!DOCTYPE e:Edmx SYSTEM "${url}">` + model(), 'FORBIDDEN_DECLARATION');
        const xml = model().replace('<e:DataServices>', `<e:Reference Uri="${url}"><e:Include Namespace="Vocabulary" Alias="V"/></e:Reference><e:DataServices>`);
        expect((await read(xml)).properties[0].type).toBe('Edm.Int64');
        await fails(xml.replace('EntityType="D.Row"', 'EntityType="V.Row"'), 'UNRESOLVED_REFERENCE');
        expect(requests).toBe(0);
    } finally { await new Promise(resolve => server.close(resolve)); }
});
test.each(['cpu', 'memory'])('worker isolation interrupts real %s exhaustion', async mode => {
    const { runWorker } = require('../src/services/csdl/isolatedWorker');
    const reason = mode === 'cpu' ? 'TIME_LIMIT' : 'MEMORY_LIMIT';
    const started = new SharedArrayBuffer(4);
    await expect(runWorker(path.join(__dirname, 'fixtures/csdlBudgetWorker.js'), { mode, started }, { timeoutMs: mode === 'cpu' ? 500 : 4000 }))
        .rejects.toMatchObject({ code: 'CSDL_READER_ERROR', details: { reason } });
    expect(Atomics.load(new Int32Array(started), 0)).toBe(1);
    expect((await read(model())).entityType).toBe('Demo.Row');
});

test('default depth ceiling rejects an actually deep document', async () => {
    await fails(model(property.replace('/>', '><Annotation Term="D.Deep">' + '<Collection>'.repeat(70) + '</Collection>'.repeat(70) + '</Annotation></Property>')), 'DEPTH_LIMIT');
});
test('inherited duplicate names and unknown required attributes are rejected', async () => {
    const xml = model(property, `<EntityType Name="Base">${property}</EntityType>`).replace('Name="Row">', 'Name="Row" BaseType="D.Base">');
    await fails(xml, 'DUPLICATE_DECLARATION');
    await fails(model(property.replace('/>', ' Unsupported="private"/>')), 'UNSUPPORTED_STRUCTURE');
});
test('nullable true and primitive collection item nullability are explicit', async () => {
    const r = await read(model('<Property Name="SUMA_NETA" Type="Edm.Int64" Nullable="true"/><Property Name="Tags" Type="Collection(Edm.String)" Nullable="false"/>'));
    expect(r.properties[0]).toMatchObject({ nullable: true, nullableDeclared: true });
    expect(r.properties[1]).toMatchObject({ collection: true, nullable: false, nullableDeclared: true });
});
test('key references must resolve to scalar non-nullable properties', async () => {
    const xml = model('<Key><PropertyRef Name="SUMA_NETA"/></Key><Property Name="SUMA_NETA" Type="Edm.Int64" Nullable="false"/>');
    expect((await read(xml)).properties[0].nullable).toBe(false);
    await fails(xml.replace('PropertyRef Name="SUMA_NETA"', 'PropertyRef Name="Missing"'), 'UNRESOLVED_REFERENCE');
});
test('concurrency is bounded and capacity is released after termination', async () => {
    const { runWorker } = require('../src/services/csdl/isolatedWorker');
    const worker = path.join(__dirname, 'fixtures/csdlBudgetWorker.js');
    const jobs = [0, 1].map(() => runWorker(worker, { mode: 'cpu' }, { timeoutMs: 500 }).catch(e => e.details.reason));
    await expect(read(model())).rejects.toMatchObject({ details: { reason: 'BUSY' } });
    expect(await Promise.all(jobs)).toEqual(['TIME_LIMIT', 'TIME_LIMIT']);
    expect((await read(model())).entityType).toBe('Demo.Row');
});
