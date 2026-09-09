import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const gateway = require('../../functions/lib/shared-portal-gateway.js');
const accessKeys = require('../../functions/lib/access-keys.js');

function singleConfig(overrides) {
    return gateway.buildGatewayConfig(Object.assign({
        mode: 'single',
        gatewayEmails: { single: 'portal.school@gmail.com' },
        portalEnabled: { teacher: true, parent: true, student: false }
    }, overrides || {}), 'tenant-a', {}, ['owner@gmail.com'], 1000);
}

describe('shared portal gateway security contract', function () {
    it('canonicalizes Gmail aliases before comparison', function () {
        expect(gateway.normalizeGatewayEmail('Portal.School+Login@GoogleMail.com'))
            .toBe('portalschool@gmail.com');
        expect(gateway.normalizeGatewayEmail('Admin@School.ORG')).toBe('admin@school.org');
        expect(gateway.normalizeGatewayEmail('not-an-email')).toBe('');
    });

    it('supports individual, one-account and separate-account modes', function () {
        const individual = gateway.buildGatewayConfig(
            { mode: 'individual' }, 'tenant-a', { revision: 4 }, [], 1000
        );
        expect(individual.enabled).toBe(false);
        expect(individual.revision).toBe(5);

        const single = singleConfig();
        expect(single.portals.teacher.emailHash).toBe(single.portals.parent.emailHash);
        expect(single.gatewayUidHashes).toEqual({});

        const separate = gateway.buildGatewayConfig({
            mode: 'separate',
            gatewayEmails: {
                teacher: 'teachers@gmail.com',
                parent: 'parents@gmail.com',
                student: 'students@gmail.com'
            },
            portalEnabled: { teacher: true, parent: true, student: true },
            studentPortalExplicitlyEnabled: true
        }, 'tenant-a', {}, [], 1000);
        expect(separate.portals.teacher.enabled).toBe(true);
        expect(separate.portals.parent.enabled).toBe(true);
        expect(separate.portals.student.configured).toBe(true);
        expect(separate.portals.student.enabled).toBe(false);
    });

    it('hides the raw gateway email from public responses but returns it to the owner view', function () {
        const config = singleConfig();
        expect(config.portals.teacher.email).toBe('portalschool@gmail.com');
        expect(config.portals.teacher.emailHint).toBe('po***@gmail.com');
        const visible = gateway.publicGatewayConfig(config);
        const owner = gateway.ownerGatewayConfig(config);
        expect(JSON.stringify(visible)).not.toContain('portalschool@gmail.com');
        expect(JSON.stringify(visible)).not.toContain('emailHash');
        expect(JSON.stringify(visible)).not.toContain('gatewayUidHashes');
        expect(owner.singleEmail).toBe('portalschool@gmail.com');
    });

    it('rejects the owner email and alias-equivalent owner email', function () {
        expect(function () {
            gateway.buildGatewayConfig({
                mode: 'single',
                gatewayEmails: { single: 'Ow.Ner+portal@gmail.com' }
            }, 'tenant-a', {}, ['owner@gmail.com'], 1000);
        }).toThrow(/مالک/);
    });

    it('requires distinct accounts in separate mode', function () {
        expect(function () {
            gateway.buildGatewayConfig({
                mode: 'separate',
                gatewayEmails: {
                    teacher: 'same@gmail.com',
                    parent: 's.a.m.e+parents@gmail.com',
                    student: 'students@gmail.com'
                }
            }, 'tenant-a', {}, [], 1000);
        }).toThrow(/الگ/);
    });

    it('keeps the unfinished student portal disabled even when its email is configured', function () {
        const notExplicit = singleConfig({
            portalEnabled: { teacher: true, parent: true, student: true }
        });
        expect(notExplicit.portals.student.enabled).toBe(false);

        const explicit = singleConfig({
            portalEnabled: { teacher: true, parent: true, student: true },
            studentPortalExplicitlyEnabled: true
        });
        expect(explicit.portals.student.configured).toBe(true);
        expect(explicit.portals.student.enabled).toBe(false);
        expect(explicit.studentPortalExplicitlyEnabled).toBe(false);
    });

    it('accepts only verified Google gateway sessions, not synthetic sessions', function () {
        const good = {
            auth: {
                uid: 'raw-google-uid',
                token: {
                    email: 'Portal.School@gmail.com',
                    email_verified: true,
                    firebase: { sign_in_provider: 'google.com' }
                }
            }
        };
        expect(gateway.assertGoogleGatewayContext(good)).toEqual({
            uid: 'raw-google-uid', email: 'portalschool@gmail.com'
        });
        expect(function () {
            gateway.assertGoogleGatewayContext({
                auth: { uid: 'x', token: { email_verified: true, firebase: { sign_in_provider: 'password' } } }
            });
        }).toThrow(/گوگل/);
        good.auth.token.sharedPortal = true;
        expect(function () { gateway.assertGoogleGatewayContext(good); }).toThrow(/دروازہ/);
    });

    it('reuses existing access-key hashes and rejects expired keys', function () {
        const plainKey = '482910';
        const keyData = {
            accessKeyHash: accessKeys.hashAccessKey(plainKey),
            accessKeyExpiresAt: Date.now() + 60000
        };
        expect(gateway.keyUsable(keyData, plainKey)).toBe(true);
        expect(gateway.keyUsable(keyData, '482911')).toBe(false);
        keyData.accessKeyExpiresAt = Date.now() - 1;
        expect(gateway.keyUsable(keyData, plainKey)).toBe(false);
    });

    it('creates tenant/person-scoped synthetic identities without exposing person id', function () {
        const a = gateway.syntheticUid('tenant-a', 'teacher', 'STF-1');
        const again = gateway.syntheticUid('tenant-a', 'teacher', 'STF-1');
        const otherTenant = gateway.syntheticUid('tenant-b', 'teacher', 'STF-1');
        const otherRole = gateway.syntheticUid('tenant-a', 'parent', 'STF-1');
        expect(a).toBe(again);
        expect(a).not.toBe(otherTenant);
        expect(a).not.toBe(otherRole);
        expect(a).not.toContain('STF-1');
        expect(a.length).toBeLessThanOrEqual(128);
    });

    it('scopes parent link to the exact verified child and never merges siblings', function () {
        const parent = gateway.linkPayload('parent', 'spg_x', 'STD-7', 'session-1', 5000, 3);
        expect(parent.studentIds).toEqual(['STD-7']);
        expect(parent.personId).toBe('STD-7');
        expect(parent.identityMode).toBe('shared_gateway');
        expect(parent.sessionId).toBe('session-1');
        expect(parent.gatewayConfigRevision).toBe(3);

        const teacher = gateway.linkPayload('teacher', 'spg_y', 'STF-2', 'session-2', 5000, 3);
        expect(teacher.staffId).toBe('STF-2');
        expect(teacher.studentIds).toEqual([]);
    });

    it('never verifies a parent key for a student outside the authenticated link', function () {
        const source = accessKeys.verifyParentAccessKey.toString();
        expect(source).toContain('linkedIds');
        expect(source).toContain('linkedIds.indexOf(sid) === -1');
    });

    it('exports deployable callables and separately testable handlers', function () {
        expect(typeof gateway.configureSharedPortalGateway).toBe('function');
        expect(typeof gateway.getSharedPortalGatewayConfig).toBe('function');
        expect(typeof gateway.resolveSharedPortalGateway).toBe('function');
        expect(typeof gateway.exchangeSharedPortalToken).toBe('function');
        expect(typeof gateway.renewSharedPortalSession).toBe('function');
        expect(typeof gateway.revokeSharedPortalSession).toBe('function');
        expect(typeof gateway.configureSharedPortalGatewayHandler).toBe('function');
        expect(typeof gateway.resolveSharedPortalGatewayHandler).toBe('function');
        expect(typeof gateway.exchangeSharedPortalTokenHandler).toBe('function');
        expect(typeof gateway.renewSharedPortalSessionHandler).toBe('function');
    });

    it('claims the global Gmail directory atomically before revoking old sessions', function () {
        const source = gateway.configureSharedPortalGatewayHandler.toString();
        expect(source).toContain('db.runTransaction');
        expect(source).toContain('currentRevision');
        expect(source).toContain("existing.status === 'active'");
        expect(source.indexOf('db.runTransaction')).toBeLessThan(source.indexOf('revokeActiveSessions'));
    });
});
