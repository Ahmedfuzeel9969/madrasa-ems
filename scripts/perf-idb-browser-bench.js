'use strict';

/**
 * Real browser IndexedDB benchmark runner (Playwright + servor).
 * Run: npm run benchmark:idb
 * Run: npm run benchmark:idb -- --scale=10000
 */
var path = require('path');
var { spawnSync } = require('child_process');

var scales = process.env.EMS_IDB_BENCH_SCALES || '10000,50000,100000';
process.argv.slice(2).forEach(function (arg) {
    if (arg.indexOf('--scale=') === 0) scales = arg.split('=')[1];
    if (arg.indexOf('--scales=') === 0) scales = arg.split('=')[1];
});

process.env.EMS_IDB_BENCH_SCALES = scales;

console.log('[benchmark:idb] scales=' + scales);

var install = spawnSync('npx', ['playwright', 'install', 'chromium'], {
    cwd: path.join(__dirname, '..'),
    shell: true,
    stdio: 'inherit'
});
if (install.status !== 0) process.exit(install.status || 1);

var run = spawnSync('npx', ['playwright', 'test', '-c', 'playwright.bench.config.js'], {
    cwd: path.join(__dirname, '..'),
    shell: true,
    stdio: 'inherit',
    env: Object.assign({}, process.env, { EMS_IDB_BENCH_SCALES: scales })
});

process.exit(run.status || 0);
