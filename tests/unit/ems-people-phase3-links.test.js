import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CACHE = '20260909_people_phase4_ux_v1';

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

describe('People Phase 3 — cascade, multi-child links, parent toggle', function () {
    it('Parent_Links activation merges all pending for same tenant', function () {
        const src = read('functions/lib/tenant-links.js');
        expect(src).toContain('activatePendingDocs');
        expect(src).toContain('mergedPending');
        expect(src).toContain('Parent multi-child');
        expect(src).toMatch(/Parent_Links[\s\S]{0,400}limit\(25\)/);
        expect(src).toContain('byTenant');
    });

    it('parent-push reads ParentPermissions under All_Madrasas tenant', function () {
        const src = read('functions/lib/parent-push.js');
        expect(src).toContain(".collection('All_Madrasas').doc(tenantId)");
        expect(src).toContain(".collection('ParentPermissions').doc(studentId)");
        expect(src).not.toMatch(/db\.collection\('ParentPermissions'\)\.doc\(studentId\)/);
    });

    it('admin can toggle parent permission status', function () {
        const src = read('admin-panel.js');
        expect(src).toContain('apToggleParentStatus');
        expect(src).toContain("p.status = (p.status === 'active') ? 'disabled' : 'active'");
    });

    it('registration delete shows cascade checklist', function () {
        const src = read('admission.js');
        expect(src).toContain('emsRegBuildDeleteCascadeChecklist');
        expect(src).toContain('متعلقہ ڈیٹا چیک لسٹ');
        expect(src).toContain('StaffPermissions');
        expect(src).toContain('ParentPermissions');
    });

    it('cache bust matches phase 3 tag', function () {
        expect(read('ems-post-auth-loader.js')).toContain("CACHE_BUST = '" + CACHE + "'");
        expect(read('ems-lazy-loader.js')).toContain("CACHE_BUST = '" + CACHE + "'");
        expect(read('index.html')).toContain('auth.js?v=' + CACHE);
    });
});
