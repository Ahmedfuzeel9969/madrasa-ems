import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { readScript } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Phase 2 Sprint 5 — virtual tables & listener dedup', function () {
    it('dashboard.js uses live stats listeners without legacy collection hooks', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).not.toContain('emsStopDashboardLegacyListeners');
        expect(src).toContain('emsStartDashboardLive');
        expect(src).toContain('emsStartDashboardStatsListener');
    });

    it('ems-dashboard-stats applies attendance to dash-att-rate', function () {
        var src = readScript(ROOT, 'ems-dashboard-stats.js');
        expect(src).toContain('dash-att-rate');
        expect(src).not.toContain('dash-attendance-percent');
    });

    it('sync-engine online handler does not pullAllModules', function () {
        var src = readScript(ROOT, 'sync-engine.js');
        expect(src).not.toMatch(/addEventListener\('online'[\s\S]*pullAllModules/);
    });

    it('finance.js uses virtual table and debounced dues search', function () {
        var src = fs.readFileSync(path.join(ROOT, 'finance.js'), 'utf8');
        expect(src).toContain('finDuesSearch');
        expect(src).toContain('300');
        expect(src).toContain('_finDuesRows');
        expect(src).toContain('emsVirtualTableDestroy');
    });

    it('admission.js virtual scroll for rejected table', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).toContain('reg-rejected');
        expect(src).toContain('_regRejectedCache');
        expect(src).toContain('emsVirtualTableMount');
    });

    it('index.html wires debounced fin-dues search', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('finDuesSearch');
    });
});
