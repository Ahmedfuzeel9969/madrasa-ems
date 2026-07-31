import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
var preflightPath = path.join(ROOT, 'scripts', 'android-asset-preflight.js');

function readDbVersion(relPath) {
    var fp = path.join(ROOT, relPath);
    var text = fs.readFileSync(fp, 'utf8');
    var match = text.match(/DB_VERSION\s*=\s*(\d+)/);
    return match ? parseInt(match[1], 10) : null;
}

function runPreflight(extraArgs) {
    return spawnSync(process.execPath, [preflightPath].concat(extraArgs || []), {
        cwd: ROOT,
        encoding: 'utf8'
    });
}

describe('Phase 4 P4 — Android/Web IndexedDB asset sync', function () {
    it('Web source ems-idb-engine.js uses DB_VERSION 4', function () {
        expect(readDbVersion('ems-idb-engine.js')).toBe(4);
    });

    it('dist ems-idb-engine.js matches Web DB_VERSION', function () {
        expect(readDbVersion('dist/ems-idb-engine.js')).toBe(4);
    });

    it('Android asset ems-idb-engine.js matches Web DB_VERSION', function () {
        expect(readDbVersion('android/app/src/main/assets/public/ems-idb-engine.js')).toBe(4);
    });

    it('Web, dist, and Android DB_VERSION are equal', function () {
        var web = readDbVersion('ems-idb-engine.js');
        var dist = readDbVersion('dist/ems-idb-engine.js');
        var android = readDbVersion('android/app/src/main/assets/public/ems-idb-engine.js');
        expect(web).toBe(dist);
        expect(web).toBe(android);
    });

    it('android-asset-preflight.js is wired in package.json', function () {
        var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.scripts['preflight:android']).toContain('android-asset-preflight.js');
        expect(pkg.scripts['android:sync']).toContain('android-asset-preflight.js --write-sync-manifest');
    });

    it('preflight passes when Web and Android assets match', function () {
        var result = runPreflight();
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Android Asset Preflight PASSED');
    });

    it('preflight fails on simulated mismatch', function () {
        var result = runPreflight(['--simulate-mismatch']);
        expect(result.status).toBe(1);
        expect(result.stderr + result.stdout).toMatch(/Simulated Android\/Web asset mismatch/);
    });
});
