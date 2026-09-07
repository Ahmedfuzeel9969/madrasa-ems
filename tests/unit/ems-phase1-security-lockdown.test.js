import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

describe('Phase 1 — teachers/parents/students security lockdown', function () {
    it('ParentMessages rules require parentUid or outbound direction for parents', function () {
        const rules = read('firestore.rules');
        const block = (rules.match(/match \/ParentMessages\/\{msgId\}[\s\S]*?\n      \}/) || [''])[0];
        expect(block).toContain('parentHasLinkedStudent(madrasaId, resource.data.studentId)');
        expect(block).toContain("resource.data.parentUid == request.auth.uid");
        expect(block).toContain("resource.data.direction == 'out'");
        expect(block).not.toContain("!('parentUid' in resource.data)");
        expect(block).toContain("parentHasView(madrasaId, request.resource.data.studentId, 'leave')");
    });

    it('Registrations writes use admission create/update/delete RBAC', function () {
        const rules = read('firestore.rules');
        expect(rules).toContain('function canCreateRegistration(madrasaId)');
        expect(rules).toContain("canStaffCreate(madrasaId, 'admission')");
        expect(rules).toContain("canStaffUpdate(madrasaId, 'admission')");
        expect(rules).toContain("canStaffDelete(madrasaId, 'admission')");
    });

    it('storage registration photos are tenant-scoped (not any signed-in user)', function () {
        const rules = read('storage.rules');
        expect(rules).toContain('isTenantStaff(tenantId)');
        expect(rules).toContain('parentCanReadRegistrationFile');
        expect(rules).not.toMatch(/match \/registrations\/\{tenantId\}[\s\S]{0,200}allow read: if isSignedIn\(\);/);
        expect(rules).not.toMatch(/match \/ledger\/\{tenantId\}[\s\S]{0,120}allow read: if isSignedIn\(\);/);
    });

    it('parent-messages CF asserts leave view and filters by parentUid', function () {
        const src = read('functions/lib/parent-messages.js');
        expect(src).toContain('assertParentLeaveView');
        expect(src).toContain("assertParentViewPermission(tenantId, studentId, 'leave')");
        expect(src).toContain('filterMessagesForParent');
        expect(src).toContain('msg.parentUid === uid');
    });

    it('parent-shared enforces parentMessagingCfOnly and leave gate', function () {
        const src = read('parent-shared.js');
        expect(src).toContain('parentMessagingCfOnly');
        expect(src).toContain("parentCanView(studentId, 'leave')");
        expect(src).toContain('Cloud Function required');
    });

    it('parent-portal enforces parentDataCfOnly / messaging CF path', function () {
        const src = read('parent-portal.js');
        expect(src).toContain('parentDataCfOnly');
        expect(src).toContain('parentMessagingCfOnly');
    });

    it('filterMessagesForParent hides other parents inbound messages', function () {
        const sandbox = {
            module: { exports: {} },
            exports: {},
            require: function (name) {
                if (name === 'firebase-admin') {
                    return { firestore: { FieldValue: { serverTimestamp: function () { return null; } } } };
                }
                if (name === 'firebase-functions') {
                    return {
                        https: {
                            onCall: function (fn) { return fn; },
                            HttpsError: function (code, message) {
                                const err = new Error(message);
                                err.code = code;
                                return err;
                            }
                        }
                    };
                }
                if (name === './parent-data') {
                    return { assertParentViewPermission: function () { return Promise.resolve({}); } };
                }
                throw new Error('unexpected require: ' + name);
            },
            console: console
        };
        sandbox.module.exports = sandbox.exports;
        vm.runInNewContext(read('functions/lib/parent-messages.js'), sandbox);
        const filter = sandbox.module.exports.filterMessagesForParent;
        const rows = filter([
            { studentId: 'S1', direction: 'in', parentUid: 'p1', text: 'mine' },
            { studentId: 'S1', direction: 'in', parentUid: 'other', text: 'leak' },
            { studentId: 'S1', direction: 'out', text: 'reply' },
            { studentId: 'S2', direction: 'in', parentUid: 'p1', text: 'other-child' }
        ], 'p1', ['S1']);
        expect(rows.map(function (r) { return r.text; })).toEqual(['mine', 'reply']);
    });
});
