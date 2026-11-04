const { parentPort, workerData } = require('worker_threads');
const { DOMParser } = require('@xmldom/xmldom');
const { fail, CsdlError } = require('./errors');
const EDM = 'http://docs.oasis-open.org/odata/ns/edm';
const EDMX = 'http://docs.oasis-open.org/odata/ns/edmx';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const primitives = new Set(['Binary', 'Boolean', 'Byte', 'Date', 'DateTimeOffset', 'Decimal', 'Double', 'Duration', 'Guid', 'Int16', 'Int32', 'Int64', 'SByte', 'Single', 'Stream', 'String', 'TimeOfDay'].map(t => 'Edm.' + t));
const children = node => Array.from(node.childNodes || []).filter(n => n.nodeType === 1);
const attr = (node, key) => node.hasAttribute(key) ? node.getAttribute(key) : undefined;
function required(node, key) { const v = attr(node, key); if (!v) fail('INVALID_STRUCTURE'); return v; }
function named(node, uri, name) { return node.namespaceURI === uri && node.localName === name; }
function unique(map, key, value) { if (map.has(key)) fail('DUPLICATE_DECLARATION'); map.set(key, value); }
function allowed(node, names, uri = EDM) {
    for (const c of Array.from(node.childNodes || [])) {
        if ((c.nodeType === 3 || c.nodeType === 4) && c.data.trim()) fail('INVALID_STRUCTURE');
    }
    for (const c of children(node)) if (c.namespaceURI !== uri || !names.includes(c.localName)) fail('UNSUPPORTED_STRUCTURE');
}
function attributes(node, names) {
    for (const a of Array.from(node.attributes || [])) {
        if (a.namespaceURI === XMLNS) continue;
        if (a.namespaceURI || !names.includes(a.name)) fail('UNSUPPORTED_STRUCTURE');
    }
}
function boolean(node, key, fallback) {
    const v = attr(node, key);
    if (v === undefined) return fallback;
    if (!['true', 'false'].includes(v)) fail('INVALID_FACET');
    return v === 'true';
}
function integer(text, minimum = 0) {
    if (!/^(0|[1-9][0-9]*)$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < minimum) fail('INVALID_FACET');
    return Number(text);
}

function parse({ xml, entitySet, container, limits }) {
    // Conservative deny-list, not XML extraction. Even declarations inside comments are rejected.
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) fail('FORBIDDEN_DECLARATION');
    const declaration = xml.match(/^\uFEFF?<\?xml\s[^?]*\?>/);
    if (declaration && /encoding\s*=\s*['"](?!utf-8['"])[^'"]+['"]/i.test(declaration[0])) fail('UNSUPPORTED_ENCODING');
    let doc;
    try { doc = new DOMParser({ onError() { fail('INVALID_XML'); } }).parseFromString(xml, 'application/xml'); }
    catch { fail('INVALID_XML'); }
    if (doc.doctype) fail('FORBIDDEN_DECLARATION');
    let count = 0;
    const stack = [[doc, 0]];
    while (stack.length) {
        const [n, depth] = stack.pop();
        if (++count > limits.maxNodes) fail('NODE_LIMIT');
        if (depth > limits.maxDepth) fail('DEPTH_LIMIT');
        if (n.attributes && n.attributes.length > limits.maxAttributes) fail('ATTRIBUTE_LIMIT');
        for (let c = n.lastChild; c; c = c.previousSibling) stack.push([c, depth + 1]);
    }
    const root = doc.documentElement;
    if (!root || !named(root, EDMX, 'Edmx')) fail('INVALID_STRUCTURE');
    attributes(root, ['Version']);
    if (attr(root, 'Version') !== '4.0') fail('UNSUPPORTED_VERSION');
    allowed(root, ['DataServices', 'Reference'], EDMX);
    const services = children(root).filter(n => named(n, EDMX, 'DataServices'));
    if (services.length !== 1) fail('INVALID_STRUCTURE');
    attributes(services[0], []);
    allowed(services[0], ['Schema']);
    const schemas = children(services[0]);
    if (!schemas.length || schemas.some(n => !named(n, EDM, 'Schema'))) fail('INVALID_STRUCTURE');
    const aliases = new Map(), namespaces = new Set(), types = new Map(), containers = new Map(), external = [];
    const qualify = value => {
        const i = value.lastIndexOf('.');
        if (i <= 0 || i === value.length - 1) fail('UNRESOLVED_REFERENCE');
        const prefix = value.slice(0, i), local = value.slice(i + 1);
        if (prefix === 'Edm') return value;
        if (namespaces.has(prefix)) return value;
        if (aliases.has(prefix)) return aliases.get(prefix) + '.' + local;
        fail('UNRESOLVED_REFERENCE');
    };
    function registerNamespace(namespace, alias) {
        if (!namespace || namespace === 'Edm' || aliases.has(namespace) || namespaces.has(namespace)) fail('DUPLICATE_DECLARATION');
        namespaces.add(namespace);
        if (alias !== undefined) {
            if (!alias || alias === 'Edm' || namespaces.has(alias)) fail('DUPLICATE_DECLARATION');
            unique(aliases, alias, namespace);
        }
    }
    for (const s of schemas) {
        attributes(s, ['Namespace', 'Alias']);
        registerNamespace(required(s, 'Namespace'), attr(s, 'Alias'));
    }
    for (const ref of children(root).filter(n => named(n, EDMX, 'Reference'))) {
        required(ref, 'Uri'); // Deliberately never fetched or returned.
        allowed(ref, ['Include', 'IncludeAnnotations'], EDMX);
        for (const inc of children(ref).filter(n => named(n, EDMX, 'Include'))) registerNamespace(required(inc, 'Namespace'), attr(inc, 'Alias'));
    }
    for (const s of schemas) {
        const ns = required(s, 'Namespace'), declarations = new Map();
        allowed(s, ['EntityType', 'ComplexType', 'EnumType', 'TypeDefinition', 'EntityContainer', 'Annotations', 'Term', 'Annotation', 'Action', 'Function']);
        for (const n of children(s)) {
            if (n.localName === 'Annotations') { external.push(n); continue; }
            if (n.localName === 'Annotation') continue;
            const name = ns + '.' + required(n, 'Name');
            // Overloads are outside this reader's subset; don't guess among them.
            unique(declarations, name, n);
            if (n.localName === 'EntityContainer') unique(containers, name, n);
            if (['EntityType', 'ComplexType', 'EnumType', 'TypeDefinition'].includes(n.localName)) unique(types, name, n);
        }
    }
    const candidates = [];
    const chosenContainer = container === undefined ? undefined : qualify(container);
    for (const [name, c] of containers) {
        const members = new Map();
        for (const member of children(c)) {
            if (member.localName === 'Annotation') continue;
            unique(members, required(member, 'Name'), member);
            if (named(member, EDM, 'EntitySet') && attr(member, 'Name') === entitySet && (chosenContainer === undefined || name === chosenContainer)) candidates.push({ name, c, set: member });
        }
    }
    if (!candidates.length) fail('ENTITY_SET_NOT_FOUND');
    if (candidates.length !== 1) fail('AMBIGUOUS_ENTITY_SET');
    const selected = candidates[0];
    if (attr(selected.c, 'Extends') !== undefined) fail('UNSUPPORTED_STRUCTURE');
    attributes(selected.c, ['Name']);
    attributes(selected.set, ['Name', 'EntityType', 'IncludeInServiceDocument']);
    boolean(selected.set, 'IncludeInServiceDocument', true);
    allowed(selected.c, ['EntitySet', 'Singleton', 'ActionImport', 'FunctionImport', 'Annotation']);
    allowed(selected.set, ['NavigationPropertyBinding', 'Annotation']);
    const selectedType = qualify(required(selected.set, 'EntityType'));
    function entity(name) {
        const n = types.get(name);
        if (!n) fail('UNRESOLVED_REFERENCE');
        if (!named(n, EDM, 'EntityType')) fail('UNSUPPORTED_STRUCTURE');
        return n;
    }
    const chain = [], visiting = new Set();
    function inherit(name) {
        if (visiting.has(name)) fail('CYCLIC_INHERITANCE');
        if (chain.length + visiting.size >= limits.maxDepth) fail('DEPTH_LIMIT');
        visiting.add(name);
        const n = entity(name);
        attributes(n, ['Name', 'BaseType', 'Abstract', 'OpenType', 'HasStream']);
        if (boolean(n, 'HasStream', false)) fail('UNSUPPORTED_STRUCTURE');
        boolean(n, 'Abstract', false);
        allowed(n, ['Key', 'Property', 'NavigationProperty', 'Annotation']);
        if (boolean(n, 'OpenType', false)) fail('UNSUPPORTED_STRUCTURE');
        const base = attr(n, 'BaseType');
        if (base) inherit(qualify(base));
        chain.push([name, n]); visiting.delete(name);
    }
    inherit(selectedType);

    // Annotations are preserved as syntax, not interpreted as units or numeric contracts.
    const expressionKinds = new Set(['String', 'Bool', 'Int', 'Float', 'Decimal', 'Date', 'DateTimeOffset', 'Duration', 'Guid', 'TimeOfDay', 'Binary', 'EnumMember', 'Path', 'PropertyPath', 'NavigationPropertyPath', 'AnnotationPath', 'Null', 'Collection', 'Record', 'PropertyValue']);
    function expression(n) {
        if (n.namespaceURI !== EDM || !expressionKinds.has(n.localName)) fail('UNSUPPORTED_STRUCTURE');
        const attributes = Object.fromEntries(Array.from(n.attributes).filter(a => a.namespaceURI !== XMLNS).map(a => [a.name, a.value]));
        return { kind: n.localName, attributes, text: Array.from(n.childNodes).filter(c => c.nodeType === 3 || c.nodeType === 4).map(c => c.data).join(''), children: children(n).map(expression) };
    }
    function annotation(n) {
        attributes(n, ['Term', 'Qualifier', ...expressionKinds]);
        const term = qualify(required(n, 'Term')), qualifier = attr(n, 'Qualifier') ?? null;
        const shorthand = Array.from(n.attributes).filter(a => expressionKinds.has(a.name));
        const elements = children(n);
        if (shorthand.length + elements.length > 1) fail('UNSUPPORTED_STRUCTURE');
        const value = shorthand.length ? { kind: shorthand[0].name, value: shorthand[0].value }
            : elements.length ? expression(elements[0]) : null;
        return { term, qualifier, expression: value };
    }
    function annotations(n, target) {
        const result = children(n).filter(c => named(c, EDM, 'Annotation')).map(annotation);
        for (const block of external) {
            const raw = required(block, 'Target'), parts = raw.split('/');
            const canonical = qualify(parts[0]) + (parts.length > 1 ? '/' + parts.slice(1).join('/') : '');
            if (canonical !== target) continue;
            allowed(block, ['Annotation']);
            for (const a of children(block)) {
                const normalized = annotation(a);
                const q = attr(block, 'Qualifier');
                if (q !== undefined) {
                    if (normalized.qualifier !== null) fail('UNSUPPORTED_STRUCTURE');
                    normalized.qualifier = q;
                }
                result.push(normalized);
            }
        }
        const keys = new Set();
        for (const a of result) { const key = JSON.stringify([a.term, a.qualifier]); if (keys.has(key)) fail('DUPLICATE_DECLARATION'); keys.add(key); }
        return result;
    }
    function facets(n, type) {
        const result = {};
        const temporal = ['Edm.DateTimeOffset', 'Edm.Duration', 'Edm.TimeOfDay'].includes(type);
        for (const key of ['Precision', 'Scale', 'MaxLength', 'Unicode', 'SRID']) {
            const v = attr(n, key); if (v === undefined) continue;
            if (key === 'Precision' && (type === 'Edm.Decimal' || temporal)) result.precision = integer(v, temporal ? 0 : 1);
            else if (key === 'Scale' && type === 'Edm.Decimal') result.scale = v === 'variable' ? v : integer(v);
            else if (key === 'MaxLength' && ['Edm.String', 'Edm.Binary'].includes(type)) result.maxLength = v === 'max' ? v : integer(v, 1);
            else if (key === 'Unicode' && type === 'Edm.String') result.unicode = boolean(n, key, true);
            else fail('INVALID_FACET');
        }
        if (temporal && result.precision > 12) fail('INVALID_FACET');
        if (typeof result.scale === 'number' && result.precision !== undefined && result.scale > result.precision) fail('INVALID_FACET');
        return result;
    }
    const properties = [], navigationProperties = [], names = new Set(), typeAnnotations = [];
    for (const [owner, n] of chain) {
        typeAnnotations.push({ target: owner, annotations: annotations(n, owner) });
        for (const p of children(n).filter(c => ['Property', 'NavigationProperty'].includes(c.localName))) {
            attributes(p, ['Name', 'Type', 'Nullable', 'Precision', 'Scale', 'MaxLength', 'Unicode', 'SRID', 'DefaultValue', 'Partner', 'ContainsTarget']);
            const name = required(p, 'Name');
            if (names.has(name)) fail('DUPLICATE_DECLARATION'); names.add(name);
            const rawType = required(p, 'Type');
            const match = /^Collection\(([^()]+)\)$/.exec(rawType);
            const collection = !!match, type = qualify(match ? match[1] : rawType);
            const navigation = p.localName === 'NavigationProperty';
            if (navigation) { entity(type); allowed(p, ['Annotation']); }
            else {
                if (!primitives.has(type)) fail(types.has(type) ? 'UNSUPPORTED_STRUCTURE' : 'UNRESOLVED_REFERENCE');
                allowed(p, ['Annotation']);
            }
            if (attr(p, 'DefaultValue') !== undefined || attr(p, 'Partner') !== undefined || boolean(p, 'ContainsTarget', false)) fail('UNSUPPORTED_STRUCTURE');
            if (navigation && collection && attr(p, 'Nullable') !== undefined) fail('INVALID_FACET');
            const normalized = { name, type, collection, nullable: navigation && collection ? null : boolean(p, 'Nullable', true),
                nullableDeclared: attr(p, 'Nullable') !== undefined, facets: facets(p, type), annotations: annotations(p, owner + '/' + name) };
            (navigation ? navigationProperties : properties).push(normalized);
        }
    }
    // Keys are not needed for analytics, but malformed required references cannot be ignored.
    const keys = chain.flatMap(([, n]) => children(n).filter(c => named(c, EDM, 'Key')));
    if (keys.length > 1) fail('UNSUPPORTED_STRUCTURE');
    for (const key of keys) {
        attributes(key, []); allowed(key, ['PropertyRef']);
        if (!children(key).length) fail('INVALID_STRUCTURE');
        const refs = new Set();
        for (const ref of children(key)) {
            attributes(ref, ['Name']); allowed(ref, []);
            const name = required(ref, 'Name');
            if (refs.has(name)) fail('DUPLICATE_DECLARATION'); refs.add(name);
            const p = properties.find(p => p.name === name);
            if (!p) fail('UNRESOLVED_REFERENCE');
            if (p.collection || p.nullable) fail('UNSUPPORTED_STRUCTURE');
        }
    }
    return { version: '4.0', container: selected.name, entitySet, entityType: selectedType, baseTypes: chain.slice(0, -1).map(([name]) => name),
        properties, navigationProperties, annotations: { container: annotations(selected.c, selected.name), entitySet: annotations(selected.set, selected.name + '/' + entitySet), types: typeAnnotations } };
}
try { parentPort.postMessage({ ok: true, model: parse(workerData) }); }
catch (error) { parentPort.postMessage({ ok: false, reason: error instanceof CsdlError ? error.details.reason : 'INVALID_XML' }); }
