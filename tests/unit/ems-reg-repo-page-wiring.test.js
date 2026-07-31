import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Registration list wired to emsRepo.page() (live pagination)', function () {
    var admission = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
    var repo = fs.readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');

    it('renderRegTable routes to the emsRepo page path when active', function () {
        expect(admission).toContain('function renderRegTableViaRepo');
        expect(admission).toContain("window.emsRepo.page('registrations'");
        expect(admission).toContain('window.renderRegTable = function');
        expect(admission).toContain('return renderRegTableViaRepo();');
    });

    it('keeps the legacy renderer as a safe fallback', function () {
        expect(admission).toContain('function renderRegTableLegacy');
        expect(admission).toContain('window.renderRegTableLegacy = renderRegTableLegacy;');
        // repo path falls back to legacy on empty/error
        expect(admission).toContain('return renderRegTableLegacy();');
    });

    it('paginates + filters + searches through the repository params', function () {
        expect(admission).toMatch(/offset:\s*offset/);
        expect(admission).toMatch(/limit:\s*perPage/);
        expect(admission).toMatch(/filter:\s*filter/);
        expect(admission).toMatch(/search:\s*search/);
    });

    it('scopes the repository to the current tenant', function () {
        expect(admission).toContain('function regRepoUseTenant');
        expect(admission).toContain('window.emsRepo.useTenant');
    });

    it('search box routes through cloud-first router with local fallback', function () {
        expect(admission).toContain('emsRegSearchRouter');
        expect(admission).toContain('renderRegTableFromSearchOverlay');
        expect(admission).toContain('emsRegRepoIsSearchActive');
    });

    it('index.html loads ems-repository.js before the lazy admission module', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ems-repository.js');
    });

    // ---- Incremental mirroring (no full-collection rewrite per change) -------

    it('admission seeds the repository once (cold start) without clearing it', function () {
        expect(admission).toContain('function emsRegEnsureRepoSeeded');
        // seed only when empty, then bulkPut the existing list — never clear
        expect(admission).toMatch(/emsRepo\.count\('registrations'\)/);
        expect(admission).toContain("window.emsRepo.bulkPut('registrations', list)");
        expect(admission).not.toContain("window.emsRepo.clear('registrations')");
        // the per-render full-rewrite mirror is gone
        expect(admission).not.toContain('emsRegSyncAllToRepoIfNeeded');
        expect(admission).not.toContain('_regMirrorSig');
    });

    it('repository exposes incremental mirror helpers (put/remove/bulk/reset)', function () {
        expect(repo).toContain('function repoMirrorPut');
        expect(repo).toContain('function repoMirrorRemove');
        expect(repo).toContain('function repoMirrorBulk');
        expect(repo).toContain('function repoMirrorReset');
        expect(repo).toContain("REPO_MIRROR_COLLECTION = 'registrations'");
        expect(repo).toContain('global.emsRepo.put(REPO_MIRROR_COLLECTION, record)');
        expect(repo).toContain('global.emsRepo.remove(REPO_MIRROR_COLLECTION, id)');
    });

    it('single add/edit mirrors ONE put through emsRegRepoUpsert', function () {
        // approved upsert → repoMirrorPut (per-record, not bulk)
        expect(repo).toMatch(/mergeRecord\(user\);[\s\S]{0,220}repoMirrorPut\(/);
    });

    it('single delete mirrors ONE remove through emsRegRepoRemove', function () {
        expect(repo).toMatch(/state\.order = state\.order\.filter[\s\S]{0,400}repoMirrorRemove\(id\)/);
    });

    it('moving a record to rejected removes it from the approved mirror', function () {
        expect(repo).toMatch(/mergeRejected\(user\);[\s\S]{0,400}repoMirrorRemove\(user\.id\)/);
    });

    it('batch loads (hydrate / load-more) bulk only the fresh rows', function () {
        expect(repo).toContain('repoMirrorBulk(repoListFromState())'); // idb hydrate seed
        expect(repo).toContain('repoMirrorBulk(res.rows)'); // load-more / bulk pages
    });

    it('tenant scope is applied for mirror writes', function () {
        expect(repo).toContain('function repoMirrorScope');
        expect(repo).toContain('global.emsRepo.useTenant(state.tenantId)');
    });
});
