import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CACHE = '20260908_portal_p0_ready_v1';

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

describe('Portal P0 — perm cloud push + parent hydrate gate', function () {
    it('admin pushes StaffPermissions / ParentPermissions to Firestore on save', function () {
        const src = read('admin-panel.js');
        expect(src).toContain('function apPushPermissionDoc');
        expect(src).toContain("apPushPermissionDoc('StaffPermissions'");
        expect(src).toContain("apPushPermissionDoc('ParentPermissions'");
        expect(src).toContain('function apConfirmCloudPushAfterPermSave');
        expect(src).toContain('emsCloudPushNow');
    });

    it('admin staff modal shows portal readiness checklist', function () {
        const src = read('admin-panel.js');
        expect(src).toContain('function apRenderStaffReadinessBox');
        expect(src).toContain('استاد پورٹل readiness');
        expect(src).toContain('apStaffPortalReadinessSync');
        expect(src).toContain('readinessHtml');
    });

    it('emsRefreshParentPermissions fails closed (no Admin module pull fallback)', function () {
        const src = read('parent-shared.js');
        const start = src.indexOf('global.emsRefreshParentPermissions');
        expect(start).toBeGreaterThan(-1);
        const slice = src.slice(start, start + 1200);
        expect(slice).toContain("loadFailed: true");
        expect(slice).toContain("getParentLinkedStudents");
        expect(slice).not.toContain("emsPullModuleGroup('Admin')");
        expect(slice).not.toContain('emsPullModuleGroup("Admin")');
    });

    it('parent unlock distinguishes loadFailed vs no views', function () {
        const src = read('auth.js');
        const start = src.indexOf('window.emsAuthContinueAsParent');
        const slice = src.slice(start, start + 3200);
        expect(slice).toContain('function denyLoadFailed');
        expect(slice).toContain('function denyNoViews');
        expect(slice).toContain('function finishParentUnlock');
        expect(slice).toContain('opts.loadFailed');
        expect(slice).toContain('اجازتیں لوڈ نہیں ہوئیں');
        expect(slice).toContain('کوئی Parent View Access نہیں');
        expect(slice.indexOf('CURRENT_MADRASA_TENANT_ID')).toBeLessThan(slice.indexOf('emsRefreshParentPermissions'));
    });

    it('parent portal prefers CF-linked student records for names', function () {
        const src = read('parent-portal.js');
        expect(src).toContain('_ppLinkedStudentsById');
        expect(src).toContain('function ppResolveStudent');
        expect(src).toContain('ppResolveStudent(sid)');
        expect(src).toContain('ppResolveStudent(studentId)');
    });

    it('cache bust matches P0 tag', function () {
        expect(read('ems-post-auth-loader.js')).toContain("CACHE_BUST = '" + CACHE + "'");
        expect(read('ems-lazy-loader.js')).toContain("CACHE_BUST = '" + CACHE + "'");
        expect(read('service-worker.js')).toContain(CACHE);
        expect(read('index.html')).toContain('auth.js?v=' + CACHE);
    });
});
