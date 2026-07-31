import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
var RULES = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

/**
 * Mirrors firestore.rules RegistrationDrafts access matrix for unit testing
 * without @firebase/rules-unit-testing (not in project deps).
 */
function simulateDraftAccess(ctx) {
    ctx = ctx || {};
    var signedIn = !!ctx.signedIn;
    var isParent = !!ctx.isParent;
    var isOwner = !!ctx.isOwner;
    var isSuperAdmin = !!ctx.isSuperAdmin;
    var isStaff = !!ctx.isStaff;
    var staffRecordId = ctx.staffRecordId || '';
    var hasAdmissionCreate = !!ctx.hasAdmissionCreate;
    var hasAdmissionEdit = !!ctx.hasAdmissionEdit;
    var resourceStaffId = ctx.resourceStaffId || '';
    var resourceTenantId = ctx.resourceTenantId || ctx.tenantId || '';
    var requestStaffId = ctx.requestStaffId != null ? ctx.requestStaffId : resourceStaffId;
    var tenantId = ctx.tenantId || 'tenant_a';
    var docId = ctx.docId || (requestStaffId + '_student');
    var validPayload = ctx.validPayload !== false;
    var revision = ctx.revision != null ? ctx.revision : 1;

    function canRead() {
        if (!signedIn || isParent) return false;
        if (resourceTenantId !== tenantId) return false;
        if (isSuperAdmin || isOwner) return true;
        return isStaff && resourceStaffId === staffRecordId;
    }

    function canCreate() {
        if (!signedIn || isParent) return false;
        if (!validPayload) return false;
        if (requestStaffId + '_' + (ctx.type || 'student') !== docId) return false;
        if (requestStaffId !== staffRecordId && !(isSuperAdmin || isOwner)) return false;
        if (isSuperAdmin || isOwner) return true;
        return isStaff && (hasAdmissionCreate || hasAdmissionEdit);
    }

    function canUpdate() {
        if (!signedIn || isParent) return false;
        if (!validPayload) return false;
        if (resourceTenantId !== tenantId) return false;
        if (requestStaffId !== resourceStaffId) return false;
        if (isSuperAdmin || isOwner) return true;
        return isStaff && resourceStaffId === staffRecordId && (hasAdmissionCreate || hasAdmissionEdit);
    }

    function canDelete() {
        if (!signedIn || isParent) return false;
        if (resourceTenantId !== tenantId) return false;
        if (isSuperAdmin || isOwner) return true;
        return isStaff && resourceStaffId === staffRecordId;
    }

    return {
        read: canRead(),
        create: canCreate(),
        update: canUpdate(),
        delete: canDelete(),
        revision: revision
    };
}

describe('P0 — RegistrationDrafts Firestore rules', function () {
    it('defines RegistrationDrafts collection with staff isolation helpers', function () {
        expect(RULES).toContain('match /RegistrationDrafts/{tenantId}');
        expect(RULES).toContain('match /items/{docId}');
        expect(RULES).toContain('function canReadRegistrationDraft');
        expect(RULES).toContain('function canCreateRegistrationDraft');
        expect(RULES).toContain('function canUpdateRegistrationDraft');
        expect(RULES).toContain('function canDeleteRegistrationDraft');
        expect(RULES).toContain('function isValidRegistrationDraftData');
        expect(RULES).toContain('!isParentOf(tenantId)');
    });

    it('requires signed-in access — no public reads or writes', function () {
        expect(RULES).toMatch(/canReadRegistrationDraft[\s\S]*isSignedIn\(\)/);
        expect(RULES).toMatch(/canCreateRegistrationDraft[\s\S]*isSignedIn\(\)/);
    });

    it('validates draft payload fields for PII documents', function () {
        expect(RULES).toContain("request.resource.data.keys().hasAll(['staffId', 'tenantId', 'type', 'revision'])");
        expect(RULES).toContain('registrationDraftDocMatchesId(docId)');
    });

    it('SSOT Registrations remain owner-only write', function () {
        expect(RULES).toContain('function canWriteRegistration(madrasaId)');
        expect(RULES).toMatch(/match \/Registrations\/\{studentId\}[\s\S]*allow write: if canWriteRegistration\(madrasaId\)/);
    });

    describe('access matrix (simulated)', function () {
        it('allows staff read/write own draft with admission permission', function () {
            var res = simulateDraftAccess({
                signedIn: true,
                isStaff: true,
                staffRecordId: 'STF-1',
                resourceStaffId: 'STF-1',
                requestStaffId: 'STF-1',
                hasAdmissionCreate: true,
                tenantId: 'tenant_a',
                docId: 'STF-1_student',
                type: 'student'
            });
            expect(res.read).toBe(true);
            expect(res.create).toBe(true);
            expect(res.update).toBe(true);
            expect(res.delete).toBe(true);
        });

        it('denies staff read/write another staff draft', function () {
            var res = simulateDraftAccess({
                signedIn: true,
                isStaff: true,
                staffRecordId: 'STF-1',
                resourceStaffId: 'STF-2',
                requestStaffId: 'STF-2',
                hasAdmissionCreate: true,
                tenantId: 'tenant_a',
                docId: 'STF-2_student',
                type: 'student'
            });
            expect(res.read).toBe(false);
            expect(res.create).toBe(false);
            expect(res.update).toBe(false);
            expect(res.delete).toBe(false);
        });

        it('allows owner read/write any draft in tenant', function () {
            var res = simulateDraftAccess({
                signedIn: true,
                isOwner: true,
                resourceStaffId: 'STF-9',
                requestStaffId: 'STF-9',
                tenantId: 'tenant_a',
                docId: 'STF-9_teacher',
                type: 'teacher'
            });
            expect(res.read).toBe(true);
            expect(res.create).toBe(true);
            expect(res.update).toBe(true);
            expect(res.delete).toBe(true);
        });

        it('denies parent access to drafts', function () {
            var res = simulateDraftAccess({
                signedIn: true,
                isParent: true,
                resourceStaffId: 'STF-1',
                requestStaffId: 'STF-1',
                tenantId: 'tenant_a'
            });
            expect(res.read).toBe(false);
            expect(res.create).toBe(false);
        });

        it('denies cross-tenant access', function () {
            var res = simulateDraftAccess({
                signedIn: true,
                isStaff: true,
                staffRecordId: 'STF-1',
                resourceStaffId: 'STF-1',
                requestStaffId: 'STF-1',
                tenantId: 'tenant_a',
                resourceTenantId: 'tenant_b',
                hasAdmissionCreate: true
            });
            expect(res.read).toBe(false);
            expect(res.update).toBe(false);
        });

        it('denies anonymous access', function () {
            var res = simulateDraftAccess({
                signedIn: false,
                isStaff: true,
                staffRecordId: 'STF-1',
                resourceStaffId: 'STF-1',
                hasAdmissionCreate: true
            });
            expect(res.read).toBe(false);
            expect(res.create).toBe(false);
        });

        it('denies staff without admission module permission', function () {
            var res = simulateDraftAccess({
                signedIn: true,
                isStaff: true,
                staffRecordId: 'STF-1',
                resourceStaffId: 'STF-1',
                requestStaffId: 'STF-1',
                hasAdmissionCreate: false,
                hasAdmissionEdit: false,
                tenantId: 'tenant_a',
                docId: 'STF-1_student',
                type: 'student'
            });
            expect(res.create).toBe(false);
            expect(res.update).toBe(false);
        });

        it('denies create when docId does not match staffId_type', function () {
            var res = simulateDraftAccess({
                signedIn: true,
                isStaff: true,
                staffRecordId: 'STF-1',
                requestStaffId: 'STF-1',
                hasAdmissionCreate: true,
                tenantId: 'tenant_a',
                docId: 'WRONG_ID_student',
                type: 'student'
            });
            expect(res.create).toBe(false);
        });
    });
});
