import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
var RULES = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

function extractMatchBlock(collection) {
    var re = new RegExp('match /' + collection + '/\\{[^}]+\\}\\s*\\{[\\s\\S]*?\\n      \\}');
    var m = RULES.match(re);
    if (!m) throw new Error('Block not found: ' + collection);
    return m[0];
}

describe('Super Admin Phase C — lockdown & tenant kill switch', function () {
    it('P0: Platform_Users create blocks self super_admin injection', function () {
        var block = extractMatchBlock('Platform_Users');
        expect(block).toMatch(/allow create:[\s\S]*!?\('super_admin' in request\.resource\.data\.globalRoles\)/);
        expect(block).toMatch(/allow create:[\s\S]*isSuperAdmin\(\)/);
    });

    it('P0: isMadrasaActive helper defined', function () {
        expect(RULES).toContain('function isMadrasaActive(madrasaId)');
        expect(RULES).toMatch(/function isMadrasaActive[\s\S]*subStatus.*!= 'suspended'/);
    });

    it('P0: canStaff* functions gate on isMadrasaActive', function () {
        ['canStaffReadModule', 'canStaffCreate', 'canStaffUpdate', 'canStaffDelete'].forEach(function (fn) {
            expect(RULES).toMatch(new RegExp('function ' + fn + '\\([\\s\\S]*?isMadrasaActive\\(madrasaId\\)'));
        });
    });

    it('P0: parent portal rules require active madrasa', function () {
        var parentLinks = extractMatchBlock('Parent_Links');
        expect(parentLinks).toMatch(/isMadrasaActive\(madrasaId\).*isParentOf\(madrasaId\)/);
        var announcements = extractMatchBlock('Announcements');
        expect(announcements).toMatch(/isMadrasaActive\(madrasaId\)/);
    });

    it('P0: tenant-kill-switch enforced in parent-data and tenant-links', function () {
        var parentData = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'parent-data.js'), 'utf8');
        var tenantLinks = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'tenant-links.js'), 'utf8');
        var killSwitch = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'tenant-kill-switch.js'), 'utf8');
        expect(killSwitch).toContain("HttpsError('madrassa-suspended'");
        expect(killSwitch).toContain('یہ مدرسہ معطل کر دیا گیا ہے۔');
        expect(parentData).toContain("require('./tenant-kill-switch')");
        expect(parentData).toContain('assertMadrasaActive(db, tenantId)');
        expect(tenantLinks).toContain('assertMadrasaActive(db, madrasaId)');
        expect(tenantLinks).toContain('assertMadrasaActive(db, tenantId)');
    });

    it('P2: sa-core fails closed to support role on lookup failure', function () {
        var src = fs.readFileSync(path.join(ROOT, 'sa', 'sa-core.js'), 'utf8');
        expect(src).toMatch(/SA_LEGACY_ROLE = 'support'/);
        expect(src).not.toMatch(/\.catch\(function \(\) \{\s*global\.SA_LEGACY_ROLE = 'owner'/);
        expect(src).not.toMatch(/global\.SA_LEGACY_ROLE = 'owner';\s*return global\.SA_LEGACY_ROLE;\s*\}\)\s*\.catch/);
    });
});
