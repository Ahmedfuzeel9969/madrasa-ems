import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CACHE = '20260911_portal_permissions_cloud_v2';

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

describe('People Phase 4 — UX gaps', function () {
    it('parent attendance accepts month param (client + CF)', function () {
        const portal = read('parent-portal.js');
        expect(portal).toContain('ppReloadAttendanceMonth');
        expect(portal).toContain("type=\"month\"");
        expect(portal).toMatch(/callParentData\('attendance',\s*studentId,\s*\{\s*month:/);
        const cf = read('functions/lib/parent-data.js');
        expect(cf).toContain('parseMonthKey');
        expect(cf).toMatch(/fetchAttendance\(db,\s*tenantId,\s*studentId,\s*month\)/);
    });

    it('teacher portal copy is permission-based; empty teacher gets default template', function () {
        const landing = read('landing.js');
        expect(landing).toContain('صرف وہ ماڈیولز جو ایڈمن نے تفویض کیے');
        expect(landing).not.toContain('حاضری، نصاب، امتحانات، اعلانات اور تدریسی اندراج');
        const admin = read('admin-panel.js');
        expect(admin).toContain('ensureTeacherDefaultPerm');
        expect(admin).toContain("if (!templateKey && type === 'teacher') templateKey = 'teacher'");
        const portal = read('portal-access.js');
        expect(portal).toMatch(/portal === 'teacher'[\s\S]{0,200}emsRoleAllowsModule\('dashboard'\)/);
    });

    it('student enrollmentStatus alumni + promotion keeps active', function () {
        const adm = read('admission.js');
        expect(adm).toContain("user.enrollmentStatus = 'active'");
        expect(adm).toContain('regMarkEnrollmentStatus');
        expect(adm).toContain("filterVal === 'alumni'");
        const exams = read('exams.js');
        expect(exams).toContain("enrollmentStatus: 'active'");
        expect(exams).toMatch(/enrollmentStatus \|\| 'active'[\s\S]{0,40}=== 'active'/);
    });

    it('announcements: type vs audience; parent audience plural; students scoped for parents', function () {
        const ann = read('announcements.js');
        expect(ann).toContain('type = content category; audience = delivery target');
        const typesBlock = ann.match(/var ANN_TYPES = \[([\s\S]*?)\];/);
        expect(typesBlock).toBeTruthy();
        expect(typesBlock[1]).not.toContain("id: 'teachers'");
        expect(typesBlock[1]).not.toContain("id: 'students'");
        expect(typesBlock[1]).not.toContain("id: 'parents'");
        expect(ann).toMatch(/audience === 'staff'[\s\S]{0,120}type === 'staff'/);
        expect(ann).not.toMatch(/audience === 'staff'[\s\S]{0,120}role === 'teacher'/);
        const push = read('functions/lib/parent-push.js');
        expect(push).toContain("audience: 'parents'");
        expect(push).not.toContain("audience: 'parent'");
        const pdata = read('functions/lib/parent-data.js');
        expect(pdata).toMatch(/aud === 'students'[\s\S]{0,400}meta\.className/);
    });

    it('CNIC policy doc + duplicate modal shows existing type', function () {
        expect(fs.existsSync(path.join(ROOT, 'docs/CNIC_DUPLICATE_POLICY.md'))).toBe(true);
        const doc = read('docs/CNIC_DUPLICATE_POLICY.md');
        expect(doc).toContain('Cross-type');
        expect(doc).toContain('Hard block');
        const dup = read('ems-registration-duplicates.js');
        expect(dup).toContain('existingType');
        const adm = read('admission.js');
        expect(adm).toContain('regDupTypeLabel');
        expect(adm).toContain('کراس-ٹائپ');
    });

    it('cache bust matches phase 4 tag', function () {
        expect(read('ems-post-auth-loader.js')).toContain("CACHE_BUST = '" + CACHE + "'");
        expect(read('ems-lazy-loader.js')).toContain("CACHE_BUST = '" + CACHE + "'");
        expect(read('service-worker.js')).toContain(CACHE);
        expect(read('index.html')).toContain(CACHE);
    });
});
