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

describe('Admin Security Phase A — IAM lockdown & fail-closed gates', function () {
    it('PE-03: StaffPermissions read limited to self or access managers', function () {
        var block = extractMatchBlock('StaffPermissions');
        expect(block).not.toContain('allow read: if canReadTenantStaff(madrasaId)');
        expect(block).toContain('staffRecordId(madrasaId) == docId');
        expect(block).toContain('canManageTenantAccess(madrasaId)');
    });

    it('PE-05 / AU-01: EmsAudit create binds uid to authenticated session', function () {
        expect(RULES).toMatch(/function isValidEmsAuditCreate\(\)[\s\S]*request\.resource\.data\.uid == request\.auth\.uid/);
        var block = extractMatchBlock('EmsAudit');
        expect(block).toContain('isValidEmsAuditCreate()');
    });

    it('PE-05 / AU-01: SecurityLog create binds uid to authenticated session', function () {
        expect(RULES).toMatch(/function isValidSecurityLogCreate\(\)[\s\S]*request\.resource\.data\.uid == request\.auth\.uid/);
        var block = extractMatchBlock('SecurityLog');
        expect(block).toContain('isValidSecurityLogCreate()');
    });

    it('TH-03: identity-gate admin MFA gate fails closed on CF error', function () {
        var src = fs.readFileSync(path.join(ROOT, 'identity-gate.js'), 'utf8');
        expect(src).toContain('function haltOnSecurityCheckFailure(user)');
        expect(src).toContain('سیکیورٹی چیک ناکام ہو گیا۔ براہ کرم دوبارہ لاگ ان کریں۔');
        expect(src).toMatch(/proceedAdminMfaGate[\s\S]{0,1200}haltOnSecurityCheckFailure\(user\)/);
        expect(src).not.toMatch(/proceedAdminMfaGate[\s\S]{0,800}\}\)\.catch\(function \(\) \{\s*completeAdmin\(user, ctx\)/);
    });

    it('TH-02: session idle watch uses lastActivity consistently', function () {
        var src = fs.readFileSync(path.join(ROOT, 'security-layer.js'), 'utf8');
        expect(src).toContain('lastActivity: Date.now()');
        expect(src).toContain('s.lastActivity = Date.now()');
        expect(src).toMatch(/emsStartSessionIdleWatch[\s\S]{0,400}meta\.lastActivity/);
        expect(src).not.toMatch(/emsStartSessionIdleWatch[\s\S]{0,400}lastActive/);
    });

    it('audit clients include uid in SecurityLog and EmsAudit payloads', function () {
        var audit = fs.readFileSync(path.join(ROOT, 'ems-audit.js'), 'utf8');
        var security = fs.readFileSync(path.join(ROOT, 'security-layer.js'), 'utf8');
        expect(audit).toContain('uid: user.uid');
        expect(security).toMatch(/emsLogSecurityEvent[\s\S]{0,600}uid: user\.uid/);
    });
});
