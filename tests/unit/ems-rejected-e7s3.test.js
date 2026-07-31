import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Enterprise E7-S3 — Rejected pagination parity', function () {
    it('repository defers rejected load until tab open', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');
        expect(src).toContain('emsRegRepoEnsureRejectedInitial');
        expect(src).toContain('emsRegRepoLoadMoreRejected');
        expect(src).toContain('emsRegRepoHasMoreRejected');
        expect(src).toContain('emsRegRepoClearAllRejected');
        var initBlock = src.match(/global\.emsRegRepoEnsureInitial = function[\s\S]*?global\.emsRegRepoEnsureRejectedInitial/);
        expect(initBlock).toBeTruthy();
        expect(initBlock[0]).not.toContain("fetchPage('Rejected'");
    });

    it('admission.js lazy-loads rejected tab with load more', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).toContain('emsRegRepoEnsureRejectedInitial');
        expect(src).toContain('regRepoLoadMoreRejected');
        expect(src).toContain('reg-rejected-pager');
        expect(src).toContain('emsRegRepoClearAllRejected');
        expect(src).not.toMatch(/collection\('Rejected'\)\.get\(\)/);
    });

    it('index.html has rejected count and pager UI', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('reg-rejected-count');
        expect(html).toContain('reg-rejected-pager');
    });

    it('training, curriculum, idcard use cache layer not raw JSON.parse', function () {
        var training = fs.readFileSync(path.join(ROOT, 'training.js'), 'utf8');
        var curriculum = fs.readFileSync(path.join(ROOT, 'curriculum.js'), 'utf8');
        var idcard = fs.readFileSync(path.join(ROOT, 'ems-idcard.js'), 'utf8');
        expect(training).toContain('emsGetUsersMerged');
        expect(curriculum).toContain('emsGetUsersMerged');
        expect(idcard).toContain('emsGetUserById');
        expect(training).not.toMatch(/JSON\.parse\(localStorage\.getItem\('ems_full_users'\)/);
        expect(curriculum).not.toMatch(/JSON\.parse\(localStorage\.getItem\('ems_full_users'\)/);
    });
});
