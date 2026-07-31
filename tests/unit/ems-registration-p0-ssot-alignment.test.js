import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadPermModule(opts) {
    opts = opts || {};
    var g = {
        CURRENT_MADRASA_TENANT_ID: opts.tenantId || 'tenant_p0',
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
        emsLogSecurityEvent: function (type, payload) {
            g._securityEvents = g._securityEvents || [];
            g._securityEvents.push({ type: type, payload: payload });
        },
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

function loadDraftModule(opts) {
    opts = opts || {};
    var store = Object.create(null);
    var g = loadPermModule(opts);
    g.EMS_REG_DRAFTS_ENABLED = true;
    g.currentEditingId = opts.editingId || null;
    g.isEditingRejected = false;
    g.currentUploadedImageBase64 = '';
    g.emsGetTenantId = function () { return opts.tenantId || 'tenant_p0'; };
    g.emsGetStaffIdForAccess = function () { return opts.staffId || 'STF-DRAFT-1'; };
    g.emsGetDeviceId = function () { return 'dev-p0'; };
    g.emsIdbKvGet = function (key) {
        return Promise.resolve(store[key] !== undefined ? JSON.parse(JSON.stringify(store[key])) : null);
    };
    g.emsIdbKvSet = function (key, value) {
        store[key] = JSON.parse(JSON.stringify(value));
        return Promise.resolve(true);
    };
    g.emsIdbKvRemove = function () { return Promise.resolve(true); };
    g.navigator = { onLine: opts.online !== false, userAgent: 'vitest' };
    g.document = { getElementById: function () { return null; }, addEventListener: function () {} };
    g.firebase = opts.firebase || null;
    var ctx = {
        global: g, window: g, globalThis: g, document: g.document,
        navigator: g.navigator, localStorage: g.localStorage,
        setTimeout: setTimeout, clearTimeout: clearTimeout
    };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'ems-registration-drafts.js'), 'utf8'), ctx);
    return { g: g, store: store };
}

describe('P0 — Registration SSOT permission alignment (Model C)', function () {
    it('documents Model C in permissions module', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-permissions.js'), 'utf8');
        expect(src).toContain('emsRegCanWriteSsot');
        expect(src).toContain('emsRegRequireSsotSave');
        expect(src).toContain('emsRegCanDraftWrite');
    });

    it('admission.js gates SSOT save via emsRegRequireSsotSave', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).toContain('emsRegRequireSsotSave');
    });

    it('owner/admin can SSOT create/edit (approve path)', function () {
        var owner = loadPermModule({ admin: true });
        expect(owner.emsRegCanWriteSsot()).toBe(true);
        expect(owner.emsRegRequireSsotSave('approved', null, false)).toBe(true);
        expect(owner.emsRegRequireSsotSave('rejected', 'STD-1', false)).toBe(true);
    });

    it('staff with create/edit cannot SSOT approve/reject', function () {
        var staff = loadPermModule({
            staff: true,
            staffId: 'STF-R1',
            actions: { view: true, create: true, edit: true, print: true }
        });
        expect(staff.emsRegCan('create')).toBe(true);
        expect(staff.emsRegCan('edit')).toBe(true);
        expect(staff.emsRegCan('approve')).toBe(false);
        expect(staff.emsRegCan('reject')).toBe(false);
        expect(staff.emsRegCanWriteSsot()).toBe(false);
        expect(staff.emsRegRequireSsotSave('approved', null, false)).toBe(false);
        expect(staff._securityEvents.some(function (e) { return e.type === 'reg_ssot_write_denied'; })).toBe(true);
    });

    it('staff can draft write but not SSOT write', function () {
        var staff = loadPermModule({
            staff: true,
            staffId: 'STF-R1',
            actions: { create: true, edit: true }
        });
        expect(staff.emsRegCanDraftWrite(null)).toBe(true);
        expect(staff.emsRegCanDraftWrite('STD-1')).toBe(true);
        expect(staff.emsRegCanWriteSsot()).toBe(false);
    });

    it('teacher cannot draft write or SSOT write', function () {
        var teacher = loadPermModule({
            staff: true,
            staffId: 'TCH-1',
            templateId: 'teacher',
            actions: { view: true, print: true }
        });
        expect(teacher.emsRegCanDraftWrite(null)).toBe(false);
        expect(teacher.emsRegCanWriteSsot()).toBe(false);
    });

    it('parent has no registration or draft access', function () {
        var parent = loadPermModule({ tenantRole: 'parent', staff: false, hasMadrasaData: false });
        expect(parent.emsRegCanWriteSsot()).toBe(false);
        expect(parent.emsRegCanDraftWrite(null)).toBe(false);
    });

    it('staff draft save works offline (local IDB)', async function () {
        var env = loadDraftModule({
            staff: true,
            staffId: 'STF-DRAFT-1',
            actions: { create: true, edit: true },
            online: false
        });
        env.g.emsRegCollectFormSnapshot = function () {
            return {
                version: 1, type: 'student',
                fields: { name: 'Offline Student', phone: '03001234567' },
                terms: { text: '', locked: false },
                customFields: {},
                meta: { editingId: null, isEditingRejected: false, proposedId: 'STD-OFF' },
                photo: { hasPhoto: false }
            };
        };
        var res = await env.g.emsRegSaveDraft('student', { reason: 'manual' });
        expect(res.saved).toBe(true);
        expect(env.store['tenant_p0__reg_draft_STF-DRAFT-1_student']).toBeTruthy();
    });

    it('staff draft cloud sync queues on Firestore denial', async function () {
        var env = loadDraftModule({
            staff: true,
            staffId: 'STF-DRAFT-1',
            actions: { create: true, edit: true },
            firebase: {
                firestore: function () {
                    return {
                        collection: function () {
                            return {
                                doc: function () {
                                    return {
                                        collection: function () {
                                            return {
                                                doc: function () {
                                                    return {
                                                        set: function () {
                                                            return Promise.reject({ code: 'permission-denied' });
                                                        }
                                                    };
                                                }
                                            };
                                        }
                                    };
                                }
                            };
                        }
                    };
                }
            }
        });
        env.g.emsRegCollectFormSnapshot = function () {
            return {
                version: 1, type: 'student',
                fields: { name: 'Cloud Student' },
                terms: { text: '', locked: false },
                customFields: {},
                meta: { editingId: null, isEditingRejected: false, proposedId: 'STD-C' },
                photo: { hasPhoto: false }
            };
        };
        var res = await env.g.emsRegSaveDraft('student', { reason: 'manual' });
        expect(res.saved).toBe(true);
        expect(env.g._securityEvents.some(function (e) { return e.type === 'reg_draft_cloud_sync_denied'; })).toBe(true);
        var outbox = env.store['tenant_p0__reg_draft_outbox'];
        expect(Array.isArray(outbox)).toBe(true);
        expect(outbox.length).toBeGreaterThan(0);
    });

    it('rejected unauthorized SSOT write is blocked at permission layer', function () {
        var staff = loadPermModule({
            staff: true,
            staffId: 'STF-X',
            actions: { create: true, edit: true, approve1: true }
        });
        expect(staff.emsRegRequireSsotSave('approved', null, false)).toBe(false);
    });
});
