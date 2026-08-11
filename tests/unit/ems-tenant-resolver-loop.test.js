import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Tenant resolver recursion guard', function () {
    it('source avoids resolve → getTenantId → require cycle', function () {
        var resolver = fs.readFileSync(path.join(ROOT, 'ems-tenant-resolver.js'), 'utf8');
        var paths = fs.readFileSync(path.join(ROOT, 'ems-firestore-paths.js'), 'utf8');
        expect(resolver).toContain('Prefer already-known session tenant BEFORE firestore helper');
        expect(resolver).toContain('_resolvingTenant');
        expect(paths).toContain('skipLegacyGetTenantId');
        expect(paths).toContain('Do NOT call emsGetTenantId here');
    });

    it('does not stack-overflow when CURRENT tenant is empty', function () {
        var sandbox = {
            console: { warn: function () {}, info: function () {}, error: function () {} },
            firebase: { auth: function () { return { currentUser: null }; } },
            localStorage: {
                getItem: function () { return 'persisted-tenant-xyz'; },
                setItem: function () {}
            },
            window: null,
            globalThis: null,
            document: undefined
        };
        sandbox.window = sandbox;
        sandbox.globalThis = sandbox;
        sandbox.CURRENT_MADRASA_TENANT_ID = null;
        sandbox.EMS_ACTIVE_TENANT_ID = null;
        sandbox.CURRENT_USER_TENANT_ROLE = null;

        var pathsSrc = fs.readFileSync(path.join(ROOT, 'ems-firestore-paths.js'), 'utf8');
        var resolverSrc = fs.readFileSync(path.join(ROOT, 'ems-tenant-resolver.js'), 'utf8');
        vm.runInNewContext(pathsSrc + '\n' + resolverSrc, sandbox, { timeout: 1000 });

        var tid = null;
        expect(function () {
            tid = sandbox.emsRequireTenantId();
        }).not.toThrow();
        expect(tid).toBe('persisted-tenant-xyz');
    });
});
