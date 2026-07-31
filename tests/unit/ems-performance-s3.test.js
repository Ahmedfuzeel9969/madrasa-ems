import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { readAppScriptManifest, readScript } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Phase 2 Sprint 3 — performance modules', function () {
    it('ems-idb-engine.js exposes IndexedDB cache API', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-idb-engine.js'), 'utf8');
        expect(src).toContain('emsIdbKvSet');
        expect(src).toContain('emsIdbKvGet');
        expect(src).toContain('emsIdbColPage');
    });

    it('ems-data-cache.js mirrors large keys to IndexedDB', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-data-cache.js'), 'utf8');
        expect(src).toContain('emsIdbKvSet');
        expect(src).toMatch(/emsIsLargeBlobKey[\s\S]*emsDurableWriteRaw/);
    });

    it('ems-virtual-table.js exposes virtual scroll mount', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-virtual-table.js'), 'utf8');
        expect(src).toContain('emsVirtualTableMount');
        expect(src).toContain('emsVirtualTableRefresh');
    });

    it('admission.js uses debounced search, virtual table, paginated sync', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).toContain('setTimeout');
        expect(src).toContain('var delay = isExactId ? 80 : 200');
        expect(src).toContain('emsVirtualTableMount');
        expect(src).toContain('emsRegRepoLoadMore');
    });

    it('ems-registration-sync.js supports pause and resume', function () {
        var src = readScript(ROOT, 'ems-registration-sync.js');
        expect(src).toContain('emsPauseRegistrationSync');
        expect(src).toContain('emsResumeRegistrationSync');
        var boot = fs.readFileSync(path.join(ROOT, 'ems-registration-bootstrap.js'), 'utf8');
        expect(boot).toContain('emsStartRegistrationWriteSync');
    });

    it('auth.js keeps repository alive across module navigation (regent2)', function () {
        var src = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
        expect(src).not.toMatch(/emsPauseRegistrationSync/);
        expect(src).toContain('RegistrationModule.init');
    });

    it('ems-perf-settings.js exposes dashboard stats refresh UI', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-perf-settings.js'), 'utf8');
        expect(src).toContain('emsPerfRefreshDashboardStats');
        expect(src).toContain('emsRefreshDashboardStats');
    });

    it('post-auth bundle loads Sprint 3 scripts and perf settings tab in HTML', function () {
        var m = readAppScriptManifest(ROOT);
        expect(m.combined).toContain('ems-idb-engine.js');
        expect(m.combined).toContain('ems-virtual-table.js');
        expect(m.combined).toContain('ems-perf-settings.js');
        expect(m.html).toContain('sys-win-perf');
    });

    it('perf-load-sim.js supports --max and Map arrears benchmark', function () {
        var src = fs.readFileSync(path.join(ROOT, 'scripts', 'perf-load-sim.js'), 'utf8');
        expect(src).toContain('--max=');
        expect(src).toContain('arrears O(n+m) Map');
    });
});
