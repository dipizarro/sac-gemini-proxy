const path = require('path');
const { runWorker } = require('./csdl/isolatedWorker');
const { fail } = require('./csdl/errors');
const LIMITS = Object.freeze({ maxBytes: 2 * 1024 * 1024, maxDepth: 64, maxNodes: 50000, maxAttributes: 128, timeoutMs: 2000 });

async function read(input, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        Object.keys(options).some(k => !['entitySet', 'container', 'limits'].includes(k)) ||
        typeof options.entitySet !== 'string' || !options.entitySet || options.entitySet.length > 1024 ||
        (options.container !== undefined && (typeof options.container !== 'string' || !options.container || options.container.length > 1024))) fail('INVALID_OPTIONS');
    const limits = { ...LIMITS };
    if (options.limits !== undefined) {
        if (!options.limits || typeof options.limits !== 'object' || Array.isArray(options.limits)) fail('INVALID_OPTIONS');
        for (const [key, value] of Object.entries(options.limits)) {
            if (!Object.hasOwn(LIMITS, key) || !Number.isSafeInteger(value) || value < 1 || value > LIMITS[key]) fail('INVALID_OPTIONS');
            limits[key] = value;
        }
    }
    if (typeof input !== 'string' && !Buffer.isBuffer(input)) fail('INVALID_OPTIONS');
    if ((typeof input === 'string' ? Buffer.byteLength(input, 'utf8') : input.length) > limits.maxBytes) fail('INPUT_LIMIT');
    let xml;
    try { xml = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input); }
    catch { fail('UNSUPPORTED_ENCODING'); }
    return runWorker(path.join(__dirname, 'csdl/worker.js'), { xml, entitySet: options.entitySet, container: options.container, limits }, limits);
}
module.exports = { read, LIMITS };
