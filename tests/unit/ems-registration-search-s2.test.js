import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { readScript } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Sprint 2 — Cloud-first registration search', function () {
    it('ems-enterprise-search.js exposes emsRegSearchRouter with tiered paths', function () {
        var src = readScript(ROOT, 'ems-enterprise-search.js');
        expect(src).toContain('emsRegSearchRouter');
        expect(src).toContain('exactIdSearch');
        expect(src).toContain('readCache');
        expect(src).toContain('writeCache');
        expect(src).toContain('isOnlineSearchPreferred');
        expect(src).toContain('EMS_REG_FORCE_LOCAL_SEARCH');
        expect(src).toContain('EMS_OFFLINE_ONLY');
        expect(src).toContain('emsRegRepoSetSearchResults');
    });

    it('admission regListSearch routes through emsRegSearchRouter (no regRepoActive bypass)', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        var fn = src.match(/window\.regListSearch\s*=\s*function[\s\S]*?},\s*delay\);/);
        expect(fn).toBeTruthy();
        expect(fn[0]).toContain('emsRegSearchRouter');
        expect(fn[0]).not.toMatch(/regRepoActive\(\)[\s\S]*emsRegRepoClearSearch[\s\S]*renderRegTable/);
    });

    it('admission uses faster debounce for exact ID queries', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).toMatch(/isExactId\s*=\s*\/\^\(STD\|TCH\|STF\)-\/i\.test\(query\)/);
        expect(src).toContain('var delay = isExactId ? 80 : 200');
    });

    it('renderRegTableViaRepo skips IDB page scan when search overlay is active', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).toContain('renderRegTableFromSearchOverlay');
        expect(src).toContain('emsRegRepoIsSearchActive');
        expect(src).toContain('emsRegRepoGetSearchResults');
        var repoFn = src.match(/function renderRegTableViaRepo\(\)[\s\S]*?return emsRegEnsureRepoSeeded/);
        expect(repoFn).toBeTruthy();
        expect(repoFn[0]).toContain('emsRegRepoIsSearchActive');
        expect(repoFn[0]).toContain('renderRegTableFromSearchOverlay');
    });

    it('regUpdateCount shows search source badge', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).toContain('regSearchSourceBadge');
        expect(src).toContain('emsEnterpriseSearchGetSource');
        expect(src).toContain('reg-search-source');
    });

    it('repository exposes search overlay helpers', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');
        expect(src).toContain('emsRegRepoIsSearchActive');
        expect(src).toContain('emsRegRepoGetSearchResults');
        expect(src).toContain('emsRegRepoSetSearchResults');
        expect(src).toContain('emsRegRepoClearSearch');
    });
});
