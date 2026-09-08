import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CACHE = '20260908_portal_p2_student_keys_v1';

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

describe('Portal P2 — student card policy + StaffAccessKeys + Student_Links', function () {
    it('C10: student portal card hidden until available', function () {
        const pa = read('portal-access.js');
        expect(pa).toContain('emsShouldShowStudentPortalCard');
        expect(pa).toContain('emsApplyStudentPortalCardVisibility');
        expect(pa).toContain('return false');
        const landing = read('landing.js');
        expect(landing).toContain('emsApplyStudentPortalCardVisibility');
    });

    it('C11: teacher keys dual-write StaffAccessKeys + StaffPermissions', function () {
        const ak = read('access-keys.js');
        expect(ak).toContain("collection('StaffAccessKeys')");
        expect(ak).toContain('StaffPermissions dual-write');
        const cf = read('functions/lib/access-keys.js');
        expect(cf).toContain("collection('StaffAccessKeys')");
        expect(cf).toContain("collection('StaffPermissions')");
        const rules = read('firestore.rules');
        expect(rules).toContain('match /StaffAccessKeys/{staffId}');
    });

    it('Student_Links foundation helpers and rules', function () {
        const tc = read('tenant-context.js');
        expect(tc).toContain('emsCreateStudentLink');
        expect(tc).toContain("collection('Student_Links')");
        const rules = read('firestore.rules');
        expect(rules).toContain('match /Student_Links/{linkId}');
    });

    it('cache bust matches P2 tag', function () {
        expect(read('ems-post-auth-loader.js')).toContain("CACHE_BUST = '" + CACHE + "'");
        expect(read('ems-lazy-loader.js')).toContain("CACHE_BUST = '" + CACHE + "'");
        expect(read('index.html')).toContain('auth.js?v=' + CACHE);
        expect(read('service-worker.js')).toContain(CACHE);
    });
});
