import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadPermModule(opts) {
    opts = opts || {};
    var store = Object.create(null);
    var g = {
        CURRENT_MADRASA_TENANT_ID: opts.tenantId || 'tenant_perm',
        CURRENT_MADRASA_DATA: opts.hasMadrasaData !== false ? { id: 't1' } : null,
        CURRENT_USER_TENANT_ROLE: opts.tenantRole || null,
        isSuperAdmin: function () { return !!opts.superAdmin; },
        isMadrasaAdmin: function () { return !!opts.admin; },
        emsIsStaffUser: function () { return !!opts.staff; },
        emsGetStaffIdForAccess: function () { return opts.staffId || null; },
        emsGetStaffRecordForCurrentUser: function () {
            return opts.staffRecord || (opts.staff ? { id: opts.staffId || 'STF-1', templateId: opts.templateId || 'reception' } : null);
        },
        apGetStaffPerm: opts.apGetStaffPerm || function () {
            return opts.perm || {
                status: 'active',
                modules: { admission: true },
                actions: { admission: opts.actions || {} }
            };
        },
        staffCanDo: function (staffId, mod, act) {
            var p = g.apGetStaffPerm(staffId);
            return !!(p && p.modules[mod] && p.actions[mod] && p.actions[mod][act]);
        },
        checkStaffModuleAccess: function (mod, act) {
            return g.staffCanDo(opts.staffId || 'STF-1', mod, act);
        },
        emsLogSecurityEvent: function () {},
        localStorage: {
            _d: {},
            getItem: function (k) { return g.localStorage._d[k] || null; },
            setItem: function (k, v) { g.localStorage._d[k] = v; }
        }
    };
    var ctx = { global: g, window: g, globalThis: g, localStorage: g.localStorage };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'ems-registration-permissions.js'), 'utf8'), ctx);
    return g;
}

describe('Sprint 5 — Registration permissions', function () {
    it('module exposes fine-grained registration permission API', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-permissions.js'), 'utf8');
        expect(src).toContain('emsRegCan');
        expect(src).toContain('emsRegRequire');
        expect(src).toContain('emsRegGuardUI');
        expect(src).toContain('duplicate_override');
        expect(src).toContain('audit_view');
    });

    it('post-auth loader loads permissions after audit module', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-post-auth-loader.js'), 'utf8');
        var aud = src.indexOf('ems-registration-audit.js');
        var perm = src.indexOf('ems-registration-permissions.js');
        expect(aud).toBeGreaterThan(-1);
        expect(perm).toBeGreaterThan(aud);
    });

    it('admission.js protects save/delete/edit/print APIs', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).toContain('regRequireSavePermission');
        expect(src).toContain("emsRegRequire('delete'");
        expect(src).toContain("emsRegRequire('print'");
        expect(src).toContain('data-reg-perm');
    });

    it('owner/admin has all registration permissions', function () {
        var owner = loadPermModule({ admin: true });
        expect(owner.emsRegCan('view')).toBe(true);
        expect(owner.emsRegCan('delete')).toBe(true);
        expect(owner.emsRegCan('import')).toBe(true);
        expect(owner.emsRegCan('duplicate_override')).toBe(true);
        expect(owner.emsRegGetRole()).toBe('admin');
    });

    it('parent role has no registration access', function () {
        var parent = loadPermModule({ tenantRole: 'parent', staff: false });
        expect(parent.emsRegCan('view')).toBe(false);
        expect(parent.emsRegCan('print')).toBe(false);
        expect(parent.emsRegGetRole()).toBe('parent');
    });

    it('teacher role — view/print only by template defaults', function () {
        var teacher = loadPermModule({
            staff: true,
            staffId: 'TCH-1',
            templateId: 'teacher',
            actions: { view: true, print: true }
        });
        expect(teacher.emsRegGetRole()).toBe('teacher');
        expect(teacher.emsRegCan('view')).toBe(true);
        expect(teacher.emsRegCan('print')).toBe(true);
        expect(teacher.emsRegCan('delete')).toBe(false);
        expect(teacher.emsRegCan('create')).toBe(false);
    });

    it('reception staff — create/edit without delete (cross-role)', function () {
        var reception = loadPermModule({
            staff: true,
            staffId: 'STF-R1',
            templateId: 'reception',
            actions: { view: true, create: true, edit: true, print: true }
        });
        expect(reception.emsRegCan('create')).toBe(true);
        expect(reception.emsRegCan('edit')).toBe(true);
        expect(reception.emsRegCan('delete')).toBe(false);
        expect(reception.emsRegCan('import')).toBe(false);
    });

    it('emsRegRequire blocks escalation and returns false', function () {
        var reception = loadPermModule({
            staff: true,
            staffId: 'STF-R1',
            actions: { view: true, create: true, edit: true }
        });
        expect(reception.emsRegRequire('delete')).toBe(false);
        expect(reception.emsRegRequire('create')).toBe(true);
    });

    it('offline permission cache snapshot persists staff perm', function () {
        var env = loadPermModule({
            staff: true,
            staffId: 'STF-9',
            actions: { view: true, print: true },
            apGetStaffPerm: function () {
                return { status: 'active', modules: { admission: true }, actions: { admission: { view: true, print: true } } };
            }
        });
        env.emsRegRefreshPermCache();
        var raw = env.localStorage.getItem('ems_reg_perm_snapshot_v1');
        expect(raw).toBeTruthy();
        var snap = JSON.parse(raw);
        expect(snap.staffId).toBe('STF-9');
        expect(snap.perm.modules.admission).toBe(true);
    });

    it('audit_view follows view permission for staff', function () {
        var staff = loadPermModule({
            staff: true,
            staffId: 'STF-2',
            actions: { view: true }
        });
        expect(staff.emsRegCan('audit_view')).toBe(true);
        var noView = loadPermModule({
            staff: true,
            staffId: 'STF-3',
            actions: {}
        });
        expect(noView.emsRegCan('audit_view')).toBe(false);
    });

    it('duplicate override requires approve1/owner', function () {
        var staff = loadPermModule({
            staff: true,
            staffId: 'STF-4',
            actions: { view: true, create: true, edit: true }
        });
        expect(staff.emsRegCan('duplicate_override')).toBe(false);
        var owner = loadPermModule({ admin: true });
        expect(owner.emsRegCan('duplicate_override')).toBe(true);
    });

    it('ADMIN_ACTIONS includes print and import for backward-compatible admin panel', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admin-panel.js'), 'utf8');
        expect(src).toContain("{ id: 'print'");
        expect(src).toContain("{ id: 'import'");
        expect(src).toContain("admission: ['view', 'print']");
    });
});
