import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function createAuditEnv(opts) {
    opts = opts || {};
    var store = Object.create(null);
    var g = {
        CURRENT_MADRASA_TENANT_ID: opts.tenantId || 'tenant_test',
        emsGetTenantId: function () { return opts.tenantId || 'tenant_test'; },
        emsIdbKvGet: function (key) {
            return Promise.resolve(store[key] !== undefined ? JSON.parse(JSON.stringify(store[key])) : null);
        },
        emsIdbKvSet: function (key, value) {
            store[key] = JSON.parse(JSON.stringify(value));
            return Promise.resolve(true);
        },
        emsGetDeviceId: function () { return 'dev-test-1'; },
        emsGetLoginSessionId: function () { return 'sess-test-abc'; },
        isMadrasaAdmin: function () { return !!opts.isAdmin; },
        isSuperAdmin: function () { return false; },
        emsIsStaffUser: function () { return !!opts.isStaff; },
        checkStaffModuleAccess: function (mod, action) {
            if (opts.staffCanView) return mod === 'admission' && (action === 'view' || action === 'edit');
            return false;
        },
        navigator: { onLine: opts.online !== false, userAgent: 'vitest', platform: 'test', language: 'ur' },
        screen: { width: 1920, height: 1080 },
        firebase: opts.firebase || null
    };
    var ctx = { global: g, window: g, globalThis: g, navigator: g.navigator, screen: g.screen };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'ems-registration-audit.js'), 'utf8'), ctx);
    return { g: g, store: store };
}

describe('Sprint 4 — Registration audit trail', function () {
    it('ems-registration-audit.js exposes offline-first audit API', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-audit.js'), 'utf8');
        expect(src).toContain('emsRegLogAudit');
        expect(src).toContain('emsRegAuditFlushQueue');
        expect(src).toContain('emsRegDiffRecord');
        expect(src).toContain('emsRegGetAuditTrail');
        expect(src).toContain('emsRegCanViewAudit');
    });

    it('post-auth loader loads audit after duplicates', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-post-auth-loader.js'), 'utf8');
        var dupIdx = src.indexOf('ems-registration-duplicates.js');
        var audIdx = src.indexOf('ems-registration-audit.js');
        expect(dupIdx).toBeGreaterThan(-1);
        expect(audIdx).toBeGreaterThan(dupIdx);
    });

    it('admission.js wires emsRegLogAudit for save and delete', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).toContain('emsRegLogAudit');
        expect(src).toContain('regBeforeSnapshotPromise');
        expect(src).toContain('emsRegResolveRegistrationAction');
        expect(src).toContain("emsRegLogAudit('delete'");
        expect(src).toContain('print_letter');
    });

    it('import/export hooks call emsRegLogAudit', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-import-export.js'), 'utf8');
        expect(src).toContain('regAuditImport');
        expect(src).toContain('regAuditExport');
        expect(src).toContain("emsRegLogAudit('import'");
        expect(src).toContain("emsRegLogAudit('export'");
    });

    it('create log — local IDB append with actor context', async function () {
        var env = createAuditEnv({ isAdmin: true });
        await env.g.emsRegLogAudit('create', 'STD-100', {
            entityType: 'student',
            source: 'form',
            afterSummary: { id: 'STD-100', name: 'Test' }
        });
        var log = await env.g.emsIdbKvGet('tenant_test__reg_audit_log');
        expect(Array.isArray(log)).toBe(true);
        expect(log.length).toBe(1);
        expect(log[0].action).toBe('create');
        expect(log[0].entityId).toBe('STD-100');
        expect(log[0].tenantId).toBe('tenant_test');
        expect(log[0].actorRole).toBe('owner');
        expect(log[0].device.userAgent).toContain('vitest');
        expect(log[0].sessionId).toBe('sess-test-abc');
    });

    it('edit log — field diff captured', async function () {
        var env = createAuditEnv({ isAdmin: true });
        var changes = env.g.emsRegDiffRecord(
            { id: 'STD-1', name: 'Ali', phone: '03001111111', class: 'جماعت اول' },
            { id: 'STD-1', name: 'Ali', phone: '03002222222', class: 'جماعت دوم' }
        );
        expect(changes.length).toBe(2);
        expect(changes.some(function (c) { return c.field === 'phone'; })).toBe(true);
        await env.g.emsRegLogAudit('edit', 'STD-1', { changes: changes, source: 'form' });
        var log = await env.g.emsIdbKvGet('tenant_test__reg_audit_log');
        expect(log[0].action).toBe('edit');
        expect(log[0].details.changes.length).toBe(2);
    });

    it('delete log — beforeSummary stored', async function () {
        var env = createAuditEnv({ isAdmin: true });
        await env.g.emsRegLogAudit('delete', 'STD-9', {
            source: 'form',
            beforeSummary: { id: 'STD-9', name: 'Removed', cnic: '3520212345671' }
        });
        var log = await env.g.emsIdbKvGet('tenant_test__reg_audit_log');
        expect(log[0].action).toBe('delete');
        expect(log[0].details.beforeSummary.id).toBe('STD-9');
    });

    it('duplicate override log — reason required in details', async function () {
        var env = createAuditEnv({ isAdmin: true });
        await env.g.emsRegLogAudit('duplicate_override', 'STD-55', {
            hard: true,
            rules: ['D1'],
            reason: 'Same family re-admission approved by owner'
        });
        var log = await env.g.emsIdbKvGet('tenant_test__reg_audit_log');
        expect(log[0].action).toBe('duplicate_override');
        expect(log[0].details.reason).toContain('owner');
    });

    it('offline audit queue — outbox when cloud unavailable', async function () {
        var env = createAuditEnv({ online: false, firebase: null });
        await env.g.emsRegLogAudit('import', 'batch-1', { added: 10, source: 'import' });
        var outbox = await env.g.emsIdbKvGet('tenant_test__reg_audit_outbox');
        expect(Array.isArray(outbox)).toBe(true);
        expect(outbox.length).toBe(1);
        expect(outbox[0].entry.action).toBe('import');
        var log = await env.g.emsIdbKvGet('tenant_test__reg_audit_log');
        expect(log[0].synced).toBe(false);
        expect(log[0].offline).toBe(true);
    });

    it('permission visibility — staff masked vs admin full CNIC', async function () {
        var adminEnv = createAuditEnv({ isAdmin: true });
        await adminEnv.g.emsRegLogAudit('edit', 'STD-1', {
            changes: [{ field: 'cnic', old: '3520212345671', new: '3520299999999' }]
        });
        var adminTrail = await adminEnv.g.emsRegGetAuditTrail('STD-1');
        expect(adminTrail[0].details.changes[0].old).toBe('3520212345671');

        var staffEnv = createAuditEnv({ isStaff: true, staffCanView: true });
        staffEnv.store['tenant_test__reg_audit_log'] = adminTrail;
        var staffTrail = await staffEnv.g.emsRegGetAuditTrail('STD-1');
        expect(staffTrail[0].details.changes[0].old).toContain('***');

        var deniedEnv = createAuditEnv({ isStaff: true, staffCanView: false });
        deniedEnv.store['tenant_test__reg_audit_log'] = adminTrail;
        var denied = await deniedEnv.g.emsRegGetAuditTrail('STD-1');
        expect(denied.length).toBe(0);
    });

    it('emsRegResolveRegistrationAction maps save paths', function () {
        var env = createAuditEnv();
        expect(env.g.emsRegResolveRegistrationAction({ status: 'approved', currentEditingId: null }))
            .toBe('create');
        expect(env.g.emsRegResolveRegistrationAction({ status: 'approved', currentEditingId: 'STD-1', isEditingRejected: false }))
            .toBe('edit');
        expect(env.g.emsRegResolveRegistrationAction({ status: 'approved', currentEditingId: 'STD-1', isEditingRejected: true }))
            .toBe('restore');
        expect(env.g.emsRegResolveRegistrationAction({ status: 'rejected' }))
            .toBe('reject');
    });
});
