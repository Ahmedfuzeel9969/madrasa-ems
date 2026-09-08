import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

describe('Portal login gate fixes (parent + teacher)', function () {
    it('parent auth sets tenant/link before refresh and passes tenantId', function () {
        const src = read('auth.js');
        const fnStart = src.indexOf('window.emsAuthContinueAsParent');
        expect(fnStart).toBeGreaterThan(-1);
        const slice = src.slice(fnStart, fnStart + 3200);
        expect(slice).toContain('CURRENT_MADRASA_TENANT_ID = ctx.tenantId');
        expect(slice).toContain('CURRENT_PARENT_LINK = ctx.link');
        expect(slice.indexOf('CURRENT_MADRASA_TENANT_ID')).toBeLessThan(slice.indexOf('finishParentUnlock'));
        expect(slice).toContain('emsRefreshParentPermissions(ctx.tenantId)');
    });

    it('emsRefreshParentPermissions accepts explicit tenantId', function () {
        const src = read('parent-shared.js');
        expect(src).toContain('function (explicitTenantId)');
        expect(src).toContain('explicitTenantId || parentGetTenantId()');
        expect(src).toContain('studentIds: data.studentIds');
    });

    it('security-layer resolves staff perms without apGetStaffPerm', function () {
        const src = read('security-layer.js');
        expect(src).toContain('function resolveStaffPerm');
        expect(src).toContain('emsResolveStaffPerm');
        expect(src).toContain("STAFF_PERM_KEY = 'ems_staff_permissions'");
        expect(src).not.toMatch(/emsStaffHasAnyModule[\s\S]{0,200}apGetStaffPerm !== 'function'\) return false/);
    });

    it('resolveStaffPerm reads localStorage when admin-panel not loaded', function () {
        const src = read('security-layer.js');
        const sandbox = {
            window: null,
            document: {
                addEventListener: function () {},
                body: {}
            },
            firebase: undefined,
            localStorage: {
                _data: {
                    ems_staff_permissions: JSON.stringify({
                        T1: { status: 'active', modules: { attendance: true, exams: false }, actions: {}, temporary: {} }
                    })
                },
                getItem: function (k) { return this._data[k] || null; },
                setItem: function (k, v) { this._data[k] = String(v); }
            },
            console: console
        };
        sandbox.window = sandbox;
        sandbox.global = sandbox;
        vm.runInNewContext(src, sandbox);
        sandbox.CURRENT_STAFF_LINK = { staffId: 'T1' };
        expect(sandbox.emsStaffHasAnyModule()).toBe(true);
        expect(sandbox.checkStaffModuleAccess('attendance', 'view')).toBe(true);
        expect(sandbox.checkStaffModuleAccess('finance', 'view')).toBe(false);
    });
});
