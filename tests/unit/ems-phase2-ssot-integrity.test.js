import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

describe('Phase 2 — SSOT and data integrity', function () {
    it('admin-panel getUsers prefers merged/repo SSOT over raw DB_USERS', function () {
        const src = read('admin-panel.js');
        expect(src).toContain('emsGetUsersMerged');
        expect(src).toContain('emsRegRepoGetListReadonly');
        expect(src).toContain('function apPersistUserEmail');
        expect(src).toContain('emsRegRepoUpsert');
    });

    it('teacher registration persists termsText and numeric salary', function () {
        const src = read('admission.js');
        expect(src).toContain('user.termsText');
        expect(src).toContain("parseFloat(document.getElementById('tch-salary').value)");
        expect(src).toContain('function regTermsStorageKey');
        expect(src).toContain("ems_global_terms_' + prefix + '_' + tid");
        expect(src).toContain('emsFilterByDepartment');
        expect(src).toContain('needDept');
    });

    it('finance fee setups use cache-aware reader and Finance cloud pull', function () {
        const src = read('finance.js');
        expect(src).toContain('function finReadFeeSetups');
        expect(src).toContain('function finEnsureFinanceCloudPull');
        expect(src).toContain("emsPullModuleGroup('Finance')");
        expect(src).toContain('finReadFeeSetups()');
        expect(src).not.toMatch(/try \{ raw = finReadFeeSetups\(\); \}/);
    });

    it('teacher import template includes salary and email fields', function () {
        const src = read('ems-import-templates.js');
        expect(src).toContain("'تنخواہ': 'salary'");
        expect(src).toContain("'ای میل': 'email'");
    });

    it('parent linked-students CF returns permissions snapshot for session refresh', function () {
        const cf = read('functions/lib/parent-data.js');
        const shared = read('parent-shared.js');
        const portal = read('parent-portal.js');
        const auth = read('auth.js');
        expect(cf).toContain('permissions[sid] = permSnap.data()');
        expect(cf).toContain('permissions: permissions');
        expect(shared).toContain('emsApplyParentPermissionsSnapshot');
        expect(shared).toContain('emsRefreshParentPermissions');
        expect(portal).toContain('emsApplyParentPermissionsSnapshot');
        expect(auth).toContain('emsRefreshParentPermissions');
    });
});
