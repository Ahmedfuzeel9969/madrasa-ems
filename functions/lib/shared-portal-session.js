/**
 * Server-side guard for short-lived shared-portal synthetic identities.
 * Firebase Admin SDK bypasses Firestore Rules, therefore every callable that
 * trusts Staff_Links/Parent_Links must invoke this guard for shared tokens.
 */
const functions = require('firebase-functions');

function denied(message) {
    return new functions.https.HttpsError(
        'permission-denied',
        message || 'مشترک پورٹل نشست ختم یا مسترد ہو چکی ہے۔'
    );
}

function isSharedPortalContext(context) {
    return !!(context
        && context.auth
        && context.auth.token
        && context.auth.token.sharedPortal === true);
}

async function assertSharedPortalSessionActive(db, tenantId, context, linkData, expectedPortal) {
    if (!isSharedPortalContext(context)) return { shared: false };
    const token = context.auth.token || {};
    const uid = String(context.auth.uid || '');
    const portal = String(token.portalRole || token.portal || '');
    const personId = String(token.personId || token.principalId || '');
    const sessionId = String(token.portalSessionId || token.sessionId || '');
    const revision = Number(token.gatewayConfigRevision || token.sessionVersion || 0);
    const expiresAtMs = Number(token.sessionExpiresAtMs || 0);
    const link = linkData || {};
    const now = Date.now();

    if (!tenantId || String(token.tenantId || '') !== String(tenantId)
        || !uid || !sessionId || !personId
        || portal !== String(expectedPortal || '')
        || expiresAtMs <= now
        || link.status !== 'active'
        || link.identityMode !== 'shared_gateway'
        || String(link.portalRole || '') !== portal
        || String(link.sessionId || '') !== sessionId
        || Number(link.gatewayConfigRevision || 0) !== revision
        || Number(link.sessionExpiresAtMs || 0) <= now) {
        throw denied();
    }
    if (portal === 'teacher' && String(link.staffId || '') !== personId) throw denied();
    if (portal === 'parent') {
        const ids = Array.isArray(link.studentIds) ? link.studentIds.map(String) : [];
        if (String(link.personId || '') !== personId || ids.length !== 1 || ids[0] !== personId) {
            throw denied();
        }
    }

    const base = db.collection('All_Madrasas').doc(String(tenantId));
    const accessRef = portal === 'teacher'
        ? base.collection('StaffPermissions').doc(personId)
        : base.collection('ParentPermissions').doc(personId);
    const registrationRef = portal === 'parent'
        ? base.collection('Registrations').doc(personId)
        : null;
    const reads = [
        base.collection('SharedPortalSessions').doc(sessionId).get(),
        base.collection('TenantSettings').doc('sharedPortalGateway').get(),
        accessRef.get(),
        base.collection('SecuritySettings').doc('mfa').get()
    ];
    if (registrationRef) reads.push(registrationRef.get());
    const snaps = await Promise.all(reads);
    if (!snaps[0].exists || !snaps[1].exists || !snaps[2].exists) throw denied();
    const session = snaps[0].data() || {};
    const config = snaps[1].data() || {};
    const access = snaps[2].data() || {};
    const mfa = snaps[3].exists ? (snaps[3].data() || {}) : {};
    const portalConfig = config.portals && config.portals[portal];
    if (session.status !== 'active'
        || String(session.syntheticUid || '') !== uid
        || String(session.portal || '') !== portal
        || String(session.personId || '') !== personId
        || Number(session.gatewayConfigRevision || 0) !== revision
        || Number(session.expiresAtMs || 0) <= now
        || config.enabled !== true
        || Number(config.revision || 0) !== revision
        || !portalConfig
        || portalConfig.enabled !== true
        || access.status !== 'active'
        || (portal === 'teacher' && mfa.requireMfaForStaff === true)
        || (portal === 'parent' && mfa.requireMfaForParent === true)) {
        throw denied();
    }
    if (portal === 'parent') {
        if (!snaps[4] || !snaps[4].exists) throw denied();
        const registration = snaps[4].data() || {};
        const registrationStatus = String(registration.status || 'active').trim().toLowerCase();
        if (['inactive', 'disabled', 'suspended', 'withdrawn', 'alumni', 'deleted'].indexOf(registrationStatus) >= 0) {
            throw denied();
        }
    }
    return {
        shared: true,
        portal: portal,
        personId: personId,
        sessionId: sessionId,
        access: access
    };
}

function permissionActionActive(access, moduleId, actionId, now) {
    access = access || {};
    const permanent = access.modules && access.modules[moduleId] === true
        && access.actions && access.actions[moduleId]
        && access.actions[moduleId][actionId] === true;
    if (permanent) return true;
    const temp = access.temporary && access.temporary[moduleId + '.' + actionId];
    if (!temp) return false;
    if (Number(temp.expiryAt || 0) > now) return true;
    return !!(temp.expiry && new Date(temp.expiry).getTime() > now);
}

/** Admin SDK bypasses Rules, so callables must repeat exact shared RBAC. */
async function assertSharedPortalStaffAction(db, tenantId, context, linkData, moduleId, actionId) {
    const result = await assertSharedPortalSessionActive(
        db,
        tenantId,
        context,
        linkData,
        'teacher'
    );
    if (!result.shared) return result;
    if (!permissionActionActive(result.access, moduleId, actionId, Date.now())) {
        throw denied('اس عمل کا اختیار مشترک پورٹل صارف کو نہیں دیا گیا۔');
    }
    return result;
}

module.exports = {
    isSharedPortalContext,
    assertSharedPortalSessionActive,
    assertSharedPortalStaffAction,
    permissionActionActive
};
