import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadDraftModule(opts) {
    opts = opts || {};
    var store = Object.create(null);
    var g = {
        EMS_REG_DRAFTS_ENABLED: opts.enabled !== false,
        CURRENT_MADRASA_TENANT_ID: opts.tenantId || 'tenant_draft',
        currentEditingId: opts.editingId || null,
        isEditingRejected: false,
        currentUploadedImageBase64: opts.photo || '',
        currentRegType: 'student',
        emsGetTenantId: function () { return opts.tenantId || 'tenant_draft'; },
        emsGetStaffIdForAccess: function () { return opts.staffId || 'STF-DRAFT-1'; },
        emsGetDeviceId: function () { return opts.deviceId || 'dev-test-1'; },
        isMadrasaAdmin: function () { return !!opts.admin; },
        isSuperAdmin: function () { return false },
        emsRegCan: opts.emsRegCan || function (action) {
            if (opts.denyCreate && action === 'create') return false;
            if (opts.denyEdit && action === 'edit') return false;
            return true;
        },
        emsIdbKvGet: function (key) {
            return Promise.resolve(store[key] !== undefined ? JSON.parse(JSON.stringify(store[key])) : null);
        },
        emsIdbKvSet: function (key, value) {
            store[key] = JSON.parse(JSON.stringify(value));
            return Promise.resolve(true);
        },
        emsIdbKvRemove: function (key) {
            delete store[key];
            return Promise.resolve(true);
        },
        navigator: { onLine: opts.online !== false, userAgent: 'vitest' },
        localStorage: {
            _d: {},
            getItem: function (k) { return g.localStorage._d[k] || null; },
            setItem: function (k, v) { g.localStorage._d[k] = v; }
        },
        document: opts.document || { getElementById: function () { return null; }, addEventListener: function () {} }
    };
    var ctx = {
        global: g, window: g, globalThis: g, document: g.document,
        navigator: g.navigator, localStorage: g.localStorage,
        setTimeout: setTimeout, clearTimeout: clearTimeout
    };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'ems-registration-drafts.js'), 'utf8'), ctx);
    return { g: g, store: store };
}

describe('Phase A — Registration drafts', function () {
    it('feature flag off by default in module bootstrap', function () {
        var fresh = { EMS_REG_DRAFTS_ENABLED: undefined };
        var ctx = { global: fresh, window: fresh, globalThis: fresh, document: { getElementById: function () { return null; } }, localStorage: { getItem: function () { return null; }, setItem: function () {} } };
        vm.createContext(ctx);
        vm.runInContext(fs.readFileSync(path.join(ROOT, 'ems-registration-drafts.js'), 'utf8'), ctx);
        expect(fresh.EMS_REG_DRAFTS_ENABLED).toBe(false);
    });

    it('loaders include drafts module after permissions', function () {
        var post = fs.readFileSync(path.join(ROOT, 'ems-post-auth-loader.js'), 'utf8');
        var lazy = fs.readFileSync(path.join(ROOT, 'ems-lazy-loader.js'), 'utf8');
        var perm = post.indexOf('ems-registration-permissions.js');
        var draft = post.indexOf('ems-registration-drafts.js');
        expect(draft).toBeGreaterThan(perm);
        expect(lazy).toContain('ems-registration-drafts.js');
    });

    it('draft create — saves to IDB separate from repo', async function () {
        var env = loadDraftModule({ enabled: true });
        env.g.emsRegCollectFormSnapshot = function () {
            return {
                version: 1, type: 'student',
                fields: { name: 'Test Student', phone: '03001111111', id: 'STD-NEW' },
                terms: { text: '', locked: false },
                customFields: {},
                meta: { editingId: null, isEditingRejected: false, proposedId: 'STD-NEW' },
                photo: { hasPhoto: false, blobKey: null, thumbBase64: null }
            };
        };
        var res = await env.g.emsRegSaveDraft('student', { reason: 'manual' });
        expect(res.saved).toBe(true);
        var key = 'tenant_draft__reg_draft_STF-DRAFT-1_student';
        var draft = env.store[key];
        expect(draft).toBeTruthy();
        expect(draft.fields.name).toBe('Test Student');
        expect(draft.staffId).toBe('STF-DRAFT-1');
    });

    it('auto-save — debounced path accepts auto reason', async function () {
        var env = loadDraftModule({ enabled: true });
        env.g.emsRegCollectFormSnapshot = function () {
            return {
                version: 1, type: 'teacher',
                fields: { name: 'Auto Teacher', id: 'TCH-1' },
                terms: { text: '', locked: false },
                customFields: {},
                meta: { editingId: null, isEditingRejected: false, proposedId: 'TCH-1' },
                photo: { hasPhoto: false }
            };
        };
        var res = await env.g.emsRegSaveDraft('teacher', { reason: 'auto' });
        expect(res.saved).toBe(true);
        expect(env.store['tenant_draft__reg_draft_STF-DRAFT-1_teacher'].reason).toBe('auto');
    });

    it('resume after reload — load returns saved draft', async function () {
        var env = loadDraftModule({ enabled: true });
        env.g.emsRegCollectFormSnapshot = function () {
            return {
                version: 1, type: 'student',
                fields: { name: 'Reload Me', cnic: '11111-1111111-1' },
                terms: { text: 'terms', locked: false },
                customFields: {},
                meta: { editingId: null, isEditingRejected: false, proposedId: 'STD-99' },
                photo: { hasPhoto: false }
            };
        };
        await env.g.emsRegSaveDraft('student');
        var loaded = await env.g.emsRegLoadDraft('student', { checkCloud: false });
        expect(loaded.draft.fields.name).toBe('Reload Me');
        expect(loaded.draft.fields.cnic).toBe('11111-1111111-1');
    });

    it('emergency/pagehide save — emergency flag stored', async function () {
        var env = loadDraftModule({ enabled: true });
        env.g.emsRegCollectFormSnapshot = function () {
            return {
                version: 1, type: 'staff',
                fields: { name: 'Crash Staff' },
                terms: { text: '', locked: false },
                customFields: {},
                meta: { editingId: null, isEditingRejected: false, proposedId: 'STF-1' },
                photo: { hasPhoto: false }
            };
        };
        await env.g.emsRegSaveDraft('staff', { reason: 'emergency', emergency: true, skipCloud: true });
        var d = env.store['tenant_draft__reg_draft_STF-DRAFT-1_staff'];
        expect(d.reason).toBe('emergency');
    });

    it('offline draft — saves without cloud requirement', async function () {
        var env = loadDraftModule({ enabled: true, online: false });
        env.g.emsRegCollectFormSnapshot = function () {
            return {
                version: 1, type: 'student',
                fields: { name: 'Offline Student' },
                terms: { text: '', locked: false },
                customFields: {},
                meta: { editingId: null, isEditingRejected: false, proposedId: 'STD-OFF' },
                photo: { hasPhoto: false }
            };
        };
        var res = await env.g.emsRegSaveDraft('student', { skipCloud: true });
        expect(res.saved).toBe(true);
        var outbox = env.store['tenant_draft__reg_draft_outbox'];
        expect(Array.isArray(outbox)).toBe(true);
        expect(outbox.length).toBeGreaterThan(0);
    });

    it('multi-device conflict — cloud newer different device detected', function () {
        var env = loadDraftModule({ enabled: true });
        var local = {
            revision: 2, updatedAt: '2026-07-09T10:00:00.000Z',
            deviceId: 'dev-a', checksum: 'abc', fields: { name: 'Local' }
        };
        var cloud = {
            revision: 3, updatedAt: '2026-07-09T11:00:00.000Z',
            deviceId: 'dev-b', checksum: 'xyz', fields: { name: 'Cloud' }
        };
        var conflict = env.g.emsRegDraftDetectConflict(local, cloud);
        expect(conflict).toBeTruthy();
        expect(conflict.winner).toBe('cloud');
    });

    it('permission isolation — denied create blocks save', async function () {
        var env = loadDraftModule({ enabled: true, denyCreate: true, denyEdit: true });
        env.g.emsRegCollectFormSnapshot = function () {
            return {
                version: 1, type: 'student',
                fields: { name: 'Blocked' },
                terms: { text: '', locked: false },
                customFields: {},
                meta: { editingId: null, isEditingRejected: false, proposedId: 'STD-X' },
                photo: { hasPhoto: false }
            };
        };
        var res = await env.g.emsRegSaveDraft('student');
        expect(res.saved).toBe(false);
        expect(res.reason).toBe('permission');
    });

    it('permission isolation — list filters by staffId', async function () {
        var env = loadDraftModule({ enabled: true, staffId: 'STF-A' });
        env.g.emsRegCollectFormSnapshot = function () {
            return {
                version: 1, type: 'student',
                fields: { name: 'Staff A Only' },
                terms: { text: '', locked: false },
                customFields: {},
                meta: { editingId: null, isEditingRejected: false, proposedId: 'STD-A' },
                photo: { hasPhoto: false }
            };
        };
        await env.g.emsRegSaveDraft('student');
        var list = await env.g.emsRegListDrafts({ staffId: 'STF-B' });
        expect(list.length).toBe(0);
        var own = await env.g.emsRegListDrafts({ staffId: 'STF-A' });
        expect(own.length).toBe(1);
    });

    it('feature flag off — save and list no-op', async function () {
        var env = loadDraftModule({ enabled: false });
        env.g.EMS_REG_DRAFTS_ENABLED = false;
        var res = await env.g.emsRegSaveDraft('student');
        expect(res.saved).toBe(false);
        expect(res.reason).toBe('disabled');
        var list = await env.g.emsRegListDrafts();
        expect(list).toEqual([]);
    });

    it('delete draft removes IDB record', async function () {
        var env = loadDraftModule({ enabled: true });
        env.g.emsRegCollectFormSnapshot = function () {
            return {
                version: 1, type: 'student',
                fields: { name: 'To Delete' },
                terms: { text: '', locked: false },
                customFields: {},
                meta: { editingId: null, isEditingRejected: false, proposedId: 'STD-DEL' },
                photo: { hasPhoto: false }
            };
        };
        await env.g.emsRegSaveDraft('student');
        await env.g.emsRegDeleteDraft('student');
        var loaded = await env.g.emsRegLoadDraft('student');
        expect(loaded).toBeNull();
    });

    it('admission.js wires draft delete on successful save', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).toContain('emsRegDeleteDraft');
        expect(src).toContain('emsRegDraftSaveBeforeTabSwitch');
        expect(src).toContain('EMS_REG_DRAFTS_ENABLED');
    });

    it('index.html enables Phase A drafts at boot', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('EMS_REG_DRAFTS_ENABLED = true');
    });
});
