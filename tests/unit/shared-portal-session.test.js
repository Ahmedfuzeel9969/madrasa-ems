import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const sessionGuard = require('../../functions/lib/shared-portal-session.js');

function snapshot(value) {
    return {
        exists: value !== undefined,
        data: function () { return value; }
    };
}

function fakeDb(documents) {
    function ref(parts) {
        return {
            collection: function (name) { return ref(parts.concat(name)); },
            doc: function (id) { return ref(parts.concat(String(id))); },
            get: function () { return Promise.resolve(snapshot(documents[parts.join('/')])); }
        };
    }
    return { collection: function (name) { return ref([name]); } };
}

function context(portal, personId) {
    return {
        auth: {
            uid: 'spg-user',
            token: {
                sharedPortal: true,
                tenantId: 'tenant-a',
                portalRole: portal,
                personId: personId,
                portalSessionId: 'session-a',
                gatewayConfigRevision: 7,
                sessionExpiresAtMs: Date.now() + 600000
            }
        }
    };
}

function link(portal, personId) {
    return {
        status: 'active',
        identityMode: 'shared_gateway',
        portalRole: portal,
        personId: personId,
        staffId: portal === 'teacher' ? personId : '',
        studentIds: portal === 'parent' ? [personId] : [],
        sessionId: 'session-a',
        gatewayConfigRevision: 7,
        sessionExpiresAtMs: Date.now() + 600000
    };
}

function baseDocuments(portal, personId) {
    const base = 'All_Madrasas/tenant-a/';
    const docs = {};
    docs[base + 'SharedPortalSessions/session-a'] = {
        status: 'active', syntheticUid: 'spg-user', portal: portal,
        personId: personId, gatewayConfigRevision: 7,
        expiresAtMs: Date.now() + 600000
    };
    docs[base + 'TenantSettings/sharedPortalGateway'] = {
        enabled: true, revision: 7,
        portals: { teacher: { enabled: true }, parent: { enabled: true } }
    };
    docs[base + (portal === 'teacher' ? 'StaffPermissions/' : 'ParentPermissions/') + personId] = portal === 'teacher'
        ? {
            status: 'active',
            modules: { dashboard: true },
            actions: { dashboard: { view: true } },
            temporary: {}
        }
        : { status: 'active' };
    if (portal === 'parent') {
        docs[base + 'Registrations/' + personId] = { status: 'active' };
    }
    return docs;
}

describe('shared portal server session guard', function () {
    it('accepts only the matching active teacher and rejects suspension or a new MFA requirement', async function () {
        const portal = 'teacher';
        const personId = 'TCH-1';
        const docs = baseDocuments(portal, personId);
        const auth = context(portal, personId);
        const activeLink = link(portal, personId);

        await expect(sessionGuard.assertSharedPortalSessionActive(
            fakeDb(docs), 'tenant-a', auth, activeLink, portal
        )).resolves.toMatchObject({ shared: true, personId: personId });
        await expect(sessionGuard.assertSharedPortalStaffAction(
            fakeDb(docs), 'tenant-a', auth, activeLink, 'dashboard', 'view'
        )).resolves.toMatchObject({ shared: true, personId: personId });
        await expect(sessionGuard.assertSharedPortalStaffAction(
            fakeDb(docs), 'tenant-a', auth, activeLink, 'exams', 'view'
        )).rejects.toMatchObject({ code: 'permission-denied' });

        docs['All_Madrasas/tenant-a/StaffPermissions/TCH-1'].status = 'suspended';
        await expect(sessionGuard.assertSharedPortalSessionActive(
            fakeDb(docs), 'tenant-a', auth, activeLink, portal
        )).rejects.toMatchObject({ code: 'permission-denied' });

        docs['All_Madrasas/tenant-a/StaffPermissions/TCH-1'].status = 'active';
        docs['All_Madrasas/tenant-a/SecuritySettings/mfa'] = { requireMfaForStaff: true };
        await expect(sessionGuard.assertSharedPortalSessionActive(
            fakeDb(docs), 'tenant-a', auth, activeLink, portal
        )).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('rejects a parent session as soon as the exact linked student becomes inactive', async function () {
        const portal = 'parent';
        const personId = 'STD-1';
        const docs = baseDocuments(portal, personId);
        const auth = context(portal, personId);
        const activeLink = link(portal, personId);

        await expect(sessionGuard.assertSharedPortalSessionActive(
            fakeDb(docs), 'tenant-a', auth, activeLink, portal
        )).resolves.toMatchObject({ shared: true, personId: personId });

        docs['All_Madrasas/tenant-a/Registrations/STD-1'].status = 'withdrawn';
        await expect(sessionGuard.assertSharedPortalSessionActive(
            fakeDb(docs), 'tenant-a', auth, activeLink, portal
        )).rejects.toMatchObject({ code: 'permission-denied' });
    });
});
