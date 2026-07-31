import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EMS_BUILD } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Lightweight login shell (regent7)', function () {
    it('index.html does not load heavy CDN libs at boot', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).not.toContain('xlsx.full.min.js');
        expect(html).not.toContain('html2canvas');
        expect(html).not.toContain('firebase-storage-compat');
        expect(html).not.toContain('firebase-messaging-compat');
    });

    it('index.html uses defer and post-auth loader', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ems-post-auth-loader.js?v=' + EMS_BUILD.CACHE_BUST.postAuthLoader);
        expect(html).toContain('ems-deferred-libs.js?v=');
        expect(html).toMatch(/defer src="auth\.js\?v=/);
        expect(html).not.toContain('ems-registration-repository.js?v=');
    });

    it('post-auth bundle splits critical and deferred loads', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-post-auth-loader.js'), 'utf8');
        expect(src).toContain('OFFLINE_FOUNDATION');
        expect(src).toContain('OFFLINE_CORE');
        expect(src).toContain('OFFLINE_DEFERRED');
        expect(src).toContain('loadParallel(OFFLINE_CORE)');
        expect(src).toContain('post-auth-critical-done');
        expect(src).toContain('ems-registration-repository.js');
        expect(src).toContain('sys-report-builder.js');
    });

    it('core.js does not start dict observer before auth', function () {
        var core = fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8');
        expect(core).toContain('emsStartDictObserver');
        expect(core).not.toMatch(/startDictObserver\(\);\s*\/\/ پیج لوڈ/);
    });
});
