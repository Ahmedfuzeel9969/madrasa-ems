import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('P6 preprod — Android lock asset parity', function () {
    it('android assets include search index lock + storage quota modules', function () {
        var androidRoot = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public');
        expect(fs.existsSync(path.join(androidRoot, 'ems-search-index-lock.js'))).toBe(true);
        expect(fs.existsSync(path.join(androidRoot, 'ems-storage-quota.js'))).toBe(true);
        var lockSrc = fs.readFileSync(path.join(androidRoot, 'ems-search-index-lock.js'), 'utf8');
        expect(lockSrc).toContain('BroadcastChannel');
        expect(lockSrc).toContain('navigator.locks.request');
        expect(lockSrc).toContain('emsSearchIndexLeaderSimulateCrash');
    });

    it('dist hosting bundle includes lock + quota modules', function () {
        var distRoot = path.join(ROOT, 'dist');
        expect(fs.existsSync(path.join(distRoot, 'ems-search-index-lock.js'))).toBe(true);
        expect(fs.existsSync(path.join(distRoot, 'ems-storage-quota.js'))).toBe(true);
    });

    it('index.html loads lock and quota in offline boot stack', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ems-search-index-lock.js');
        expect(html).toContain('ems-storage-quota.js');
    });
});
