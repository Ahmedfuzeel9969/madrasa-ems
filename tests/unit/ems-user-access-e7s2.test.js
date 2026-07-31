import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EMS_BUILD } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Enterprise E7-S2 — user access layer', function () {
    it('ems-user-access.js exposes on-demand query API', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-user-access.js'), 'utf8');
        expect(src).toContain('emsGetUsersByCacheKey');
        expect(src).toContain('emsFetchUsersByFilter');
        expect(src).toContain("source: 'server'");
        expect(src).toContain('emsFetchStudentsForClass');
        expect(src).toContain('emsGetUserById');
        expect(src).toContain('emsUserRepository');
        expect(src).toContain('readIdbHydratedCache');
    });

    it('dashboard.js uses emsGetUsersMerged for user reads', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toContain('emsGetUsersMerged');
        expect(src).toContain('emsGetUserById');
    });

    it('finance.js uses emsFetchStudentsForClass for class pickers', function () {
        var src = fs.readFileSync(path.join(ROOT, 'finance.js'), 'utf8');
        expect(src).toContain('emsFetchStudentsForClass');
        expect(src).toContain('emsGetUsersMerged');
    });

    it('attendance.js loads register from repo with local-first fallback', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(src).toContain('attCollectTargetsFromRepo');
        expect(src).toContain('emsRegRepoForEach');
        expect(src).toContain('emsFetchStudentsLocalFirst');
        expect(src).toContain('targetUsers');
    });

    it('post-auth loader includes user-access and user-service', function () {
        var loader = fs.readFileSync(path.join(ROOT, 'ems-post-auth-loader.js'), 'utf8');
        expect(loader).toContain('ems-user-access.js');
        expect(loader).toContain('ems-user-service.js');
        expect(loader).toContain(EMS_BUILD.CACHE_BUST.postAuthLoader);
    });
});
