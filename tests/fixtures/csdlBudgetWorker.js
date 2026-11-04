// Synthetic resource exhaustion only; never imported by the production reader.
const { workerData } = require('worker_threads');
if (workerData.started) Atomics.store(new Int32Array(workerData.started), 0, 1);
if (workerData.mode === 'cpu') { while (true) { /* interruptible only outside this worker */ } }
const retained = [];
while (true) retained.push(new Array(100000).fill('synthetic'));
