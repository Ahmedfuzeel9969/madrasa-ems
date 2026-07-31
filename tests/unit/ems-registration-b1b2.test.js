import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { readScript } from '../helpers/boot-manifest.js';

var root = join(process.cwd());

describe('Phase B1/B2 — Registration permanent local cache', function () {
    it('repository hardcodes desktop unlimited and anti-shrink IDB persist', function () {
        var src = readFileSync(join(root, 'ems-registration-repository.js'), 'utf8');
        expect(src).toContain('EMS_DESKTOP_UNLIMITED');
        expect(src).toContain('allowShrink: false');
        expect(src).toContain('desktop_idb_empty');
        expect(src).toContain('persistRepoToIdb');
        expect(src).toContain('forceFull');
    });

    it('preload exposes EMS_DESKTOP_UNLIMITED and IDB-only boot flag', function () {
        var preload = readFileSync(join(root, 'desktop/preload.js'), 'utf8');
        var repo = readFileSync(join(root, 'ems-registration-repository.js'), 'utf8');
        expect(preload).toContain('EMS_DESKTOP_UNLIMITED');
        expect(preload).toContain('unlimitedCache');
        expect(repo).toContain('EMS_REGISTRATION_IDB_ONLY_BOOT');
    });

    it('tenant storage does not wipe tenant IDB cache on login', function () {
        var src = readFileSync(join(root, 'ems-tenant-storage.js'), 'utf8');
        expect(src).toContain('emsIdbPurgeLegacyKeys');
        expect(src).not.toMatch(/removeLegacyGlobalKeys[\s\S]*emsIdbRemove\(base\)/);
    });

    it('ensureInitial never auto-fetches page 1 on desktop when IDB empty', function () {
        var src = readFileSync(join(root, 'ems-registration-repository.js'), 'utf8');
        expect(src).toMatch(/desktop_idb_empty[\s\S]*fetchPage/);
    });

    it('blocks automatic fetchPage on IDB-only boot', function () {
        var src = readFileSync(join(root, 'ems-registration-repository.js'), 'utf8');
        expect(src).toContain('EMS_REGISTRATION_ALLOW_SERVER_FETCH');
        expect(src).toContain('repo_fetch_blocked_idb_only');
        expect(src).toContain('emsRegRepoRebuildLocalCacheFromServer');
    });

    it('dashboard overrides server KPIs with local repo on desktop', function () {
        var dash = readFileSync(join(root, 'dashboard.js'), 'utf8');
        expect(dash).toContain('emsDashApplyLocalStudentCounts');
        expect(dash).toContain('EMS_DESKTOP_UNLIMITED');
    });

    it('boot paths hydrate IDB instead of force server fetch on desktop', function () {
        var users = readFileSync(join(root, 'ems-user-service.js'), 'utf8');
        var firebase = readScript(root, 'ems-firebase-read-api.js');
        expect(users).toContain('desktopHydrateOnly');
        expect(firebase).toContain('emsRegRepoHydrateFullFromIdb');
        expect(firebase).toContain('force: !!opts.force && !isDesktopEnv()');
    });

    it('local entity list default limit is not 500', function () {
        var cfg = readFileSync(join(root, 'ems-offline-config.js'), 'utf8');
        expect(cfg).toContain('LOCAL_BROWSER_CACHE_LIMIT:');
        expect(cfg).not.toContain('LOCAL_BROWSER_CACHE_LIMIT: 500');
    });
});
