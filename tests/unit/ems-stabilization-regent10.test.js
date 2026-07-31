import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Enterprise stabilization sprint (regent10)', function () {
    it('loads tenant storage before auth', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ems-tenant-storage.js?v=');
        var ctxIdx = html.indexOf('tenant-context.js?v=');
        var storeIdx = html.indexOf('ems-tenant-storage.js?v=');
        expect(ctxIdx).toBeGreaterThan(-1);
        expect(storeIdx).toBeGreaterThan(ctxIdx);
    });

    it('tenant storage scopes registration cache keys', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-tenant-storage.js'), 'utf8');
        expect(src).toContain('emsScopedKey');
        expect(src).toContain('ems_repo_');
        expect(src).toContain('ems_full_users');
        expect(src).toContain('emsPurgeLegacyRegistrationCaches');
        expect(src).toContain('emsLiteLoginPrepare');
    });

    it('emsGetTenantId does not fall back to auth.uid', function () {
        var src = fs.readFileSync(path.join(ROOT, 'tenant-context.js'), 'utf8');
        var fnMatch = src.match(/global\.emsGetTenantId = function \(\) \{[\s\S]*?\};/);
        expect(fnMatch).toBeTruthy();
        expect(fnMatch[0]).not.toMatch(/firebase\.auth\(\)\.currentUser/);
        expect(fnMatch[0]).toContain('CURRENT_MADRASA_TENANT_ID || null');
    });

    it('bootstrap uses lite login not bulk hydrate at boot', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-bootstrap.js'), 'utf8');
        expect(src).toContain('emsBootLiteLogin');
        expect(src).toContain('emsBootRegistrationModule');
        expect(src).not.toContain('mergeIdbUsersIntoRepo');
        expect(src).not.toContain('readLegacyLocalStorageUsers');
    });

    it('finishMadrasaLogin unlocks UI before registration module load', function () {
        var src = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
        var start = src.indexOf('function finishMadrasaLogin');
        var end = src.indexOf('function applyMadrasaProfile', start);
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        var fn = src.slice(start, end);
        expect(fn).toContain('skipRegistrationBoot: true');
        expect(fn).toContain('emsLiteLoginPrepare');
        expect(fn).toContain('emsStartDashboardStatsListener');
        expect(fn).not.toContain('emsEnsureRepositoryReady()');
    });

    it('repository uses PAGE_SIZE 500', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');
        expect(src).toMatch(/PAGE_SIZE = 500/);
        expect(src).toContain('getMemoryCap');
        expect(src).toContain('emsGetLocalCacheLimit');
    });

    it('dashboard uses server stats fast path without repo boot', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toContain('emsGetDashboardStats');
        expect(src).toContain('emsLoadDashboardFilterDetails');
        expect(src).not.toMatch(/emsForceReloadRegistrationData/);
    });

    it('production diagnostic and performance report exist', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-production-diagnostic.js'), 'utf8');
        expect(src).toContain('tenantIsolationStatus');
        expect(src).toContain('emsPerformanceReport');
        expect(src).toContain('memoryUsageMB');
    });

    it('user-access does not overwrite emsGetUsers from user-service', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-user-access.js'), 'utf8');
        expect(src).toContain('scopedQueryKey');
        expect(src).toContain('emsGetUsersByCacheKey');
        expect(src).not.toMatch(/global\.emsGetUsers = function/);
    });

    it('logout purges IDB legacy keys', function () {
        var src = fs.readFileSync(path.join(ROOT, 'security-layer.js'), 'utf8');
        expect(src).toContain('emsIdbPurgeLegacyKeys');
    });
});
