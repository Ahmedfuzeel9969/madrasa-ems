import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Hybrid Offline-First Phase 1', function () {
    it('offline foundation modules exist', function () {
        var files = [
            'ems-offline-config.js',
            'ems-offline-mode.js',
            'ems-device-identity.js',
            'ems-offline-write.js',
            'ems-offline-module-store.js',
            'ems-offline-policy.js'
        ];
        files.forEach(function (f) {
            expect(fs.existsSync(path.join(ROOT, f))).toBe(true);
        });
    });

    it('post-auth loader wires hybrid stack', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-post-auth-loader.js'), 'utf8');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(src).toContain('ems-offline-write.js');
        expect(src).toContain('ems-offline-module-store.js');
        expect(html).toContain('ems-offline-config.js');
        expect(html).toContain('ems-device-identity.js');
    });

    it('browser cache limit defaults to 50 and is configurable', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-config.js'), 'utf8');
        expect(src).toContain('LOCAL_BROWSER_CACHE_LIMIT:');
        expect(src).toContain('emsOfflineConfigSetAdmin');
    });

    it('registration repo uses dynamic memory cap', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');
        expect(src).toContain('getMemoryCap');
        expect(src).toContain('emsGetLocalCacheLimit');
        expect(src).toContain('emsIsUnlimitedLocalCache');
        expect(src).not.toContain('var MEMORY_CAP = 200');
    });

    it('installed/desktop cache is unlimited by default', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-config.js'), 'utf8');
        expect(src).toContain('emsIsUnlimitedLocalCache');
        expect(src).toContain('emsResolveFetchLimit');
        expect(src).toContain('INSTALLED_CACHE_LIMIT: 0');
    });

    it('pending sync queue has required fields', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(src).toContain('retryCount');
        expect(src).toContain('emsOfflineFlushRow');
        expect(src).toContain('nextRetryAt');
    });

    it('entity metadata includes version and deviceId', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-offline-write.js'), 'utf8');
        expect(src).toContain('updatedAt');
        expect(src).toContain('_version');
        expect(fs.readFileSync(path.join(ROOT, 'ems-device-identity.js'), 'utf8')).toContain('emsEnsureDeviceId');
    });

    it('auth initializes hybrid sync coordinator', function () {
        var src = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
        expect(src).toContain('emsHybridSyncInit');
    });
});
