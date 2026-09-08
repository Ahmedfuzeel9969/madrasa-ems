import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

describe('Portal unlock hydrate v2', function () {
    it('teacher login hydrates StaffPermissions via single-doc read', function () {
        const src = read('auth.js');
        expect(src).toContain('emsHydrateStaffPermissionsForLogin');
        expect(src).toContain("collection('StaffPermissions').doc(staffId)");
        const teacherStart = src.indexOf('window.emsAuthContinueAsTeacher');
        const parentStart = src.indexOf('window.emsAuthContinueAsParent');
        const teacherFn = src.slice(teacherStart, parentStart > teacherStart ? parentStart : teacherStart + 2500);
        expect(teacherFn).toContain('emsHydrateStaffPermissionsForLogin');
        expect(teacherFn).not.toContain("emsPullModuleGroup('Admin')");
    });

    it('parent login falls back to ParentPermissions hydrate', function () {
        const src = read('auth.js');
        expect(src).toContain('emsHydrateParentPermissionsForLogin');
        expect(src).toContain("collection('ParentPermissions').doc(sid)");
    });

    it('access-keys.js is in cloud boot before identity-gate', function () {
        const src = read('cloud/ems-cloud-manifest.js');
        const boot = src.slice(src.indexOf('boot:'), src.indexOf('foundation:'));
        expect(boot.indexOf("'access-keys.js'")).toBeGreaterThan(-1);
        expect(boot.indexOf("'access-keys.js'")).toBeLessThan(boot.indexOf("'identity-gate.js'"));
    });

    it('access key gate allows login when no key was issued', function () {
        const src = read('identity-gate.js');
        expect(src).toContain("typeof global.emsGetTeacherAccessKeyHash !== 'function'");
        expect(src).toContain("typeof global.emsGetParentAccessKeyHashes !== 'function'");
        expect(src).toContain('Enforce only when admin has actually issued a key');
        expect(src).toContain('Enforce only when admin has issued at least one key');
    });

    it('index.html bumps auth.js cache bust', function () {
        const html = read('index.html');
        expect(html).toContain('auth.js?v=20260908_portal_unlock_hydrate_v2');
    });

    it('offline module store includes Admin permission keys', function () {
        const src = read('ems-offline-module-store.js');
        expect(src).toContain("Admin: ['ems_staff_permissions'");
    });
});
