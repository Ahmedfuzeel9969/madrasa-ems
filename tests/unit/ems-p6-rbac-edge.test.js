import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadSecurityLayer(ctx) {
    ctx.global = ctx.window;
    ctx.document = {
        getElementById: function () { return null; },
        querySelectorAll: function () { return []; },
        addEventListener: function () {},
        body: { innerHTML: '' }
    };
    ctx.global.document = ctx.document;
    ctx.global.ADMIN_STAFF_MODULES = [
        { id: 'dashboard' }, { id: 'admission' }, { id: 'attendance' }
    ];
    ctx.global.apGetStaffPerm = function (staffId) {
        return ctx.__perm;
    };
    ctx.global.CURRENT_MADRASA_DATA = { staffLink: { staffId: 'STF001' } };
    ctx.global.CURRENT_STAFF_LINK = { staffId: 'STF001' };
    var src = fs.readFileSync(path.join(ROOT, 'security-layer.js'), 'utf8');
    vm.runInNewContext(src, ctx, { filename: 'security-layer.js' });
}

describe('P6-G — RBAC edge cases (security-layer)', function () {
    it('suspended staff denied module access', function () {
        var ctx = { window: {}, __perm: { status: 'suspended', modules: { admission: true } } };
        loadSecurityLayer(ctx);
        expect(ctx.global.checkStaffModuleAccess('admission', 'view')).toBe(false);
        expect(ctx.global.emsStaffHasAnyModule()).toBe(false);
        expect(ctx.global.emsGetStaffAllowedModules()).toEqual([]);
    });

    it('expired temporary grant denied', function () {
        var ctx = {
            window: {},
            __perm: {
                status: 'active',
                modules: {},
                temporary: { 'attendance.view': { expiry: '2020-01-01' } }
            }
        };
        loadSecurityLayer(ctx);
        expect(ctx.global.checkStaffModuleAccess('attendance', 'view')).toBe(false);
        expect(ctx.global.emsStaffHasAnyModule()).toBe(false);
    });

    it('active temporary grant allowed', function () {
        var ctx = {
            window: {},
            __perm: {
                status: 'active',
                modules: {},
                temporary: { 'attendance.view': { expiry: '2099-12-31' } }
            }
        };
        loadSecurityLayer(ctx);
        expect(ctx.global.checkStaffModuleAccess('attendance', 'view')).toBe(true);
        expect(ctx.global.emsStaffHasAnyModule()).toBe(true);
    });

    it('unlinked parent — checkParentViewAccess false without student link', function () {
        var ctx = { window: {}, __perm: null };
        loadSecurityLayer(ctx);
        ctx.global.CURRENT_USER_TENANT_ROLE = 'parent';
        ctx.global.emsGetLinkedStudentIds = function () { return []; };
        expect(ctx.global.checkParentViewAccess('STD001', 'attendance')).toBe(false);
        expect(ctx.global.emsParentHasAnyView()).toBe(false);
    });
});
