const { Worker } = require('worker_threads');
const { CsdlError } = require('./errors');
let active = 0;

// Internal runner: the public reader always supplies its fixed worker path.
function runWorker(filename, data, { timeoutMs }) {
    if (active >= 2) return Promise.reject(new CsdlError('BUSY'));
    active++;
    return new Promise((resolve, reject) => {
        let worker, timer, settled = false;
        async function finish(error, value) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { if (worker) await worker.terminate(); } catch { /* sanitize termination errors */ }
            active--;
            if (error) reject(error); else resolve(value);
        }
        try {
            worker = new Worker(filename, {
                workerData: data, env: {}, execArgv: [], stdout: true, stderr: true,
                resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 4 }
            });
            // Never expose parser/native diagnostic streams.
            worker.stdout.resume(); worker.stderr.resume();
            timer = setTimeout(() => finish(new CsdlError('TIME_LIMIT')), timeoutMs);
            worker.once('message', message => {
                if (message && message.ok === true) finish(null, message.model);
                else finish(new CsdlError(message && message.reason));
            });
            worker.once('error', error => finish(new CsdlError(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'MEMORY_LIMIT' : 'WORKER_FAILED')));
            worker.once('exit', () => finish(new CsdlError('WORKER_FAILED')));
        } catch { finish(new CsdlError('WORKER_FAILED')); }
    });
}
module.exports = { runWorker };
