/**
 * Shared portal gateway
 * --------------------------------------------------------------------------
 * A shared Google account is only an institution/portal gateway. It never
 * becomes a Staff_Links, Parent_Links or Student_Links identity. After the
 * person access key is verified on the server, this module issues a short
 * lived custom token for a deterministic, person-scoped synthetic uid.
 *
 * Firestore integration (required before enabling this feature):
 * - deny all client access to TenantSettings/sharedPortalGateway,
 *   SharedPortalPrincipals, SharedPortalSessions and SharedPortalAttempts;
 * - allow a shared synthetic link only when token.sharedPortal === true,
 *   token.tenantId/portalRole/personId match the link, the token session id
 *   matches the link session id, the link is unexpired, and the configuration
 *   revision still matches;
 * - never treat the raw gateway uid as a tenant business identity.
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const crypto = require('crypto');
const { hashAccessKey, isKeyExpired } = require('./access-keys');
const { assertMadrasaActive } = require('./tenant-kill-switch');
const { writeSecurityLog } = require('./security-log-write');
const { assertSharedPortalSessionActive, isSharedPortalContext } = require('./shared-portal-session');
const {
    parseDomains,
    emailMatchesDomains,
    providerAllowed
} = require('./sso-policy');

const CONFIG_DOC_ID = 'sharedPortalGateway';
const SCHEMA_VERSION = 1;
const MODES = ['individual', 'single', 'separate'];
const PORTALS = ['teacher', 'parent', 'student'];
const DEFAULT_SESSION_MINUTES = 45;
const MIN_SESSION_MINUTES = 10;
const MAX_SESSION_MINUTES = 55;
const DEFAULT_MAX_ATTEMPTS = 5;
const MIN_MAX_ATTEMPTS = 3;
const MAX_MAX_ATTEMPTS = 10;
const DEFAULT_GATEWAY_MAX_ATTEMPTS = 20;
const DEFAULT_LOCKOUT_MINUTES = 15;
const MAX_LOCKOUT_MINUTES = 60;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ACTIVE_SESSION_REVOKES = 100;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_ABSOLUTE_SESSION_MS = 8 * 60 * 60 * 1000;
// طالب علم پورٹل ابھی مکمل/فعال نہیں؛ صرف اس کا Gmail پیشگی محفوظ ہو سکتا ہے۔
const STUDENT_PORTAL_SERVER_READY = false;

function httpsError(code, message) {
    return new functions.https.HttpsError(code, message);
}

function requiredString(value, fieldName, maxLength) {
    const result = String(value || '').trim();
    if (!result || result.length > (maxLength || 256)) {
        throw httpsError('invalid-argument', fieldName + ' درست طور پر درکار ہے۔');
    }
    return result;
}

function normalizePortal(value) {
    const portal = String(value || '').trim().toLowerCase();
    if (PORTALS.indexOf(portal) === -1) {
        throw httpsError('invalid-argument', 'portal درست نہیں۔');
    }
    return portal;
}

/**
 * Google returns a verified canonical email, but Gmail dot/plus aliases are
 * normalized as defence in depth and to catch duplicate configuration.
 */
function normalizeGatewayEmail(value) {
    const email = String(value || '').trim().toLowerCase();
    const match = email.match(/^([^@\s]{1,64})@([^@\s]{1,253})$/);
    if (!match) return '';
    let local = match[1];
    let domain = match[2];
    if (domain === 'googlemail.com') domain = 'gmail.com';
    if (domain === 'gmail.com') {
        local = local.split('+')[0].replace(/\./g, '');
    }
    return local && domain ? local + '@' + domain : '';
}

function maskEmail(email) {
    const normalized = normalizeGatewayEmail(email);
    if (!normalized) return '';
    const parts = normalized.split('@');
    const local = parts[0];
    const shown = local.length < 3 ? local.charAt(0) : local.substring(0, 2);
    return shown + '***@' + parts[1];
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function tenantHash(tenantId, purpose, value) {
    return sha256('ems-shared-portal-v1:' + tenantId + ':' + purpose + ':' + value);
}

function safeEqual(a, b) {
    const left = Buffer.from(String(a || ''), 'utf8');
    const right = Buffer.from(String(b || ''), 'utf8');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function integerOption(value, fallback, min, max, fieldName) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw httpsError('invalid-argument', fieldName + ' کی حد درست نہیں۔');
    }
    return parsed;
}

function ownerEmailSet(ownerEmails) {
    const set = new Set();
    (ownerEmails || []).forEach(function (email) {
        const normalized = normalizeGatewayEmail(email);
        if (normalized) set.add(normalized);
    });
    return set;
}

function requestedPortalFlags(data, mode) {
    const flags = (data && data.portalEnabled && typeof data.portalEnabled === 'object')
        ? data.portalEnabled
        : {};
    if (mode === 'individual') {
        return { teacher: false, parent: false, student: false };
    }
    return {
        teacher: flags.teacher !== false,
        parent: flags.parent !== false,
        // Client input cannot turn on an unfinished student data surface.
        student: STUDENT_PORTAL_SERVER_READY
            && flags.student === true
            && data.studentPortalExplicitlyEnabled === true
    };
}

/** Pure configuration builder; raw addresses stay in the owner-only tenant doc. */
function buildGatewayConfig(data, tenantId, previous, ownerEmails, now) {
    data = data || {};
    const mode = String(data.mode || 'individual').trim().toLowerCase();
    if (MODES.indexOf(mode) === -1) {
        throw httpsError('invalid-argument', 'مشترک پورٹل طریقہ درست نہیں۔');
    }

    const enabled = requestedPortalFlags(data, mode);
    const rawEmails = (data.gatewayEmails && typeof data.gatewayEmails === 'object')
        ? data.gatewayEmails
        : ((data.emails && typeof data.emails === 'object') ? data.emails : {});
    const singleEmail = normalizeGatewayEmail(rawEmails.single || data.gatewayEmail || data.singleEmail);
    const configuredEmails = {};

    if (mode === 'single') {
        if (!singleEmail) {
            throw httpsError('invalid-argument', 'مشترک گوگل برقی پتہ درکار ہے۔');
        }
        PORTALS.forEach(function (portal) {
            configuredEmails[portal] = singleEmail;
        });
    } else if (mode === 'separate') {
        PORTALS.forEach(function (portal) {
            const email = normalizeGatewayEmail(rawEmails[portal]);
            if (!email) {
                throw httpsError('invalid-argument', portal + ' پورٹل کا گوگل برقی پتہ درکار ہے۔');
            }
            configuredEmails[portal] = email;
        });
        const unique = new Set(Object.keys(configuredEmails).map(function (portal) {
            return configuredEmails[portal];
        }));
        if (unique.size !== Object.keys(configuredEmails).length) {
            throw httpsError('invalid-argument', 'الگ طریقے میں ہر فعال پورٹل کا برقی پتہ الگ ہونا چاہیے۔');
        }
    }

    if (mode !== 'individual' && !Object.keys(configuredEmails).length) {
        throw httpsError('invalid-argument', 'کم از کم ایک پورٹل فعال ہونا چاہیے۔');
    }

    const ownerSet = ownerEmailSet(ownerEmails);
    Object.keys(configuredEmails).forEach(function (portal) {
        if (ownerSet.has(configuredEmails[portal])) {
            throw httpsError(
                'failed-precondition',
                'مالک کا برقی پتہ مشترک پورٹل کے لیے استعمال نہیں کیا جا سکتا۔'
            );
        }
    });

    const portals = {};
    PORTALS.forEach(function (portal) {
        const email = configuredEmails[portal] || '';
        portals[portal] = {
            configured: !!email,
            enabled: !!email && enabled[portal] === true,
            email: email,
            emailHash: email ? tenantHash(tenantId, 'gateway-email', email) : '',
            emailHint: email ? maskEmail(email) : ''
        };
    });

    const previousRevision = Number(previous && previous.revision) || 0;
    return {
        schemaVersion: SCHEMA_VERSION,
        mode: mode,
        enabled: mode !== 'individual',
        portals: portals,
        // Bindings are intentionally reset whenever an owner saves settings.
        // The next verified Google login binds the stable raw gateway uid.
        gatewayUidHashes: {},
        revision: previousRevision + 1,
        sessionTtlMinutes: integerOption(
            data.sessionTtlMinutes,
            DEFAULT_SESSION_MINUTES,
            MIN_SESSION_MINUTES,
            MAX_SESSION_MINUTES,
            'نشست کی مدت'
        ),
        maxAttemptsPerPerson: integerOption(
            data.maxAttemptsPerPerson,
            DEFAULT_MAX_ATTEMPTS,
            MIN_MAX_ATTEMPTS,
            MAX_MAX_ATTEMPTS,
            'کوششوں کی تعداد'
        ),
        maxAttemptsPerGateway: integerOption(
            data.maxAttemptsPerGateway,
            DEFAULT_GATEWAY_MAX_ATTEMPTS,
            DEFAULT_MAX_ATTEMPTS,
            50,
            'مجموعی کوششوں کی تعداد'
        ),
        lockoutMinutes: integerOption(
            data.lockoutMinutes,
            DEFAULT_LOCKOUT_MINUTES,
            5,
            MAX_LOCKOUT_MINUTES,
            'عارضی پابندی کی مدت'
        ),
        studentPortalExplicitlyEnabled: STUDENT_PORTAL_SERVER_READY && enabled.student === true,
        updatedAtMs: now || Date.now()
    };
}

function publicGatewayConfig(config) {
    config = config || {};
    const portals = {};
    PORTALS.forEach(function (portal) {
        const p = (config.portals && config.portals[portal]) || {};
        portals[portal] = {
            configured: p.configured === true || !!p.emailHash,
            enabled: p.enabled === true,
            emailHint: p.emailHint || ''
        };
    });
    return {
        schemaVersion: config.schemaVersion || SCHEMA_VERSION,
        mode: MODES.indexOf(config.mode) >= 0 ? config.mode : 'individual',
        enabled: config.enabled === true,
        portals: portals,
        revision: Number(config.revision) || 0,
        sessionTtlMinutes: Number(config.sessionTtlMinutes) || DEFAULT_SESSION_MINUTES,
        maxAttemptsPerPerson: Number(config.maxAttemptsPerPerson) || DEFAULT_MAX_ATTEMPTS,
        maxAttemptsPerGateway: Number(config.maxAttemptsPerGateway) || DEFAULT_GATEWAY_MAX_ATTEMPTS,
        lockoutMinutes: Number(config.lockoutMinutes) || DEFAULT_LOCKOUT_MINUTES,
        studentPortalExplicitlyEnabled: config.studentPortalExplicitlyEnabled === true
    };
}

/** Owner-only response. Shared raw users never receive these addresses. */
function ownerGatewayConfig(config) {
    const safe = publicGatewayConfig(config);
    const portals = config && config.portals ? config.portals : {};
    const emails = {
        teacher: normalizeGatewayEmail(portals.teacher && portals.teacher.email),
        parent: normalizeGatewayEmail(portals.parent && portals.parent.email),
        student: normalizeGatewayEmail(portals.student && portals.student.email)
    };
    return Object.assign({}, safe, {
        singleEmail: safe.mode === 'single' ? (emails.teacher || emails.parent || emails.student) : '',
        emails: emails
    });
}

function assertSignedIn(context) {
    if (!context || !context.auth || !context.auth.uid) {
        throw httpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    return context.auth;
}

function assertGoogleGatewayContext(context) {
    const auth = assertSignedIn(context);
    const token = auth.token || {};
    const provider = token.firebase && token.firebase.sign_in_provider;
    if (token.sharedPortal === true) {
        throw httpsError('failed-precondition', 'یہ نشست مشترک دروازہ نہیں ہے۔');
    }
    if (provider !== 'google.com' || token.email_verified !== true) {
        throw httpsError('failed-precondition', 'تصدیق شدہ گوگل لاگ اِن درکار ہے۔');
    }
    const email = normalizeGatewayEmail(token.email);
    if (!email) {
        throw httpsError('failed-precondition', 'تصدیق شدہ گوگل برقی پتہ درکار ہے۔');
    }
    return { uid: auth.uid, email: email };
}

function ownerUidFor(tenantId, madrasa) {
    return String((madrasa && madrasa.ownerUid) || tenantId || '').trim();
}

function assertOwner(tenantId, madrasa, context) {
    const auth = assertSignedIn(context);
    const ownerUid = ownerUidFor(tenantId, madrasa);
    if (!ownerUid || auth.uid !== ownerUid) {
        throw httpsError('permission-denied', 'صرف ادارے کا مالک یہ عمل کر سکتا ہے۔');
    }
    return auth;
}

function collectOwnerEmails(madrasa, auth, authUser) {
    const token = (auth && auth.token) || {};
    return [
        token.email,
        authUser && authUser.email,
        madrasa && madrasa.ownerEmail,
        madrasa && madrasa.adminEmail,
        madrasa && madrasa.email
    ].filter(Boolean);
}

function configRef(db, tenantId) {
    return db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc(CONFIG_DOC_ID);
}

function directoryDocId(email) {
    return sha256('ems-shared-portal-directory-v1:' + normalizeGatewayEmail(email));
}

function directoryRef(db, email) {
    return db.collection('SharedPortalGatewayDirectory').doc(directoryDocId(email));
}

function configuredEmails(config) {
    const out = {};
    PORTALS.forEach(function (portal) {
        const entry = config && config.portals && config.portals[portal];
        const email = normalizeGatewayEmail(entry && entry.email);
        if (email) out[portal] = email;
    });
    return out;
}

function directoryPlan(config) {
    const byDoc = {};
    const emails = configuredEmails(config);
    Object.keys(emails).forEach(function (portal) {
        const id = directoryDocId(emails[portal]);
        if (!byDoc[id]) byDoc[id] = { email: emails[portal], roles: [] };
        // Student email may be reserved now, but is not discoverable until ready.
        if (config.portals[portal].enabled === true) byDoc[id].roles.push(portal);
    });
    return byDoc;
}

function challengeRef(db, tenantId, challengeId) {
    return tenantSubcollection(db, tenantId, 'SharedPortalChallenges').doc(challengeId);
}

function tenantSubcollection(db, tenantId, collectionName) {
    return db.collection('All_Madrasas').doc(tenantId).collection(collectionName);
}

async function safeSecurityAudit(db, tenantId, event) {
    try {
        await writeSecurityLog(db, tenantId, event);
    } catch (err) {
        functions.logger.error('Shared portal audit write failed', {
            tenantId: tenantId,
            action: event && event.action,
            error: err && err.message
        });
    }
}

async function revokeActiveSessions(db, authApi, tenantId, actorUid, now, reason) {
    const snap = await tenantSubcollection(db, tenantId, 'SharedPortalSessions')
        .where('status', '==', 'active').limit(MAX_ACTIVE_SESSION_REVOKES).get();
    if (snap.empty) return { revoked: 0, truncated: false };

    const batch = db.batch();
    const syntheticUids = new Set();
    snap.docs.forEach(function (doc) {
        const item = doc.data() || {};
        if (item.syntheticUid) syntheticUids.add(item.syntheticUid);
        batch.set(doc.ref, {
            status: 'revoked',
            revokedAtMs: now,
            revokedByUid: actorUid,
            revokeReason: reason || 'owner_revoke'
        }, { merge: true });
    });
    await batch.commit();
    await Promise.all(Array.from(syntheticUids).map(function (uid) {
        return authApi.revokeRefreshTokens(uid).catch(function (err) {
            if (err && err.code === 'auth/user-not-found') return null;
            functions.logger.warn('Shared portal refresh-token revoke failed', {
                tenantId: tenantId,
                syntheticUid: uid,
                error: err && err.message
            });
            return null;
        });
    }));
    return {
        revoked: snap.size,
        truncated: snap.size >= MAX_ACTIVE_SESSION_REVOKES
    };
}

async function configureSharedPortalGatewayHandler(data, context) {
    data = data || {};
    const tenantId = requiredString(data.tenantId, 'tenantId', 128);
    const requested = data.config && typeof data.config === 'object' ? data.config : data;
    const db = admin.firestore();
    const madrasa = await assertMadrasaActive(db, tenantId);
    const auth = assertOwner(tenantId, madrasa, context);
    let authUser = null;
    try {
        authUser = await admin.auth().getUser(auth.uid);
    } catch (err) {
        if (!err || err.code !== 'auth/user-not-found') throw err;
    }

    const ref = configRef(db, tenantId);
    const oldSnap = await ref.get();
    const oldConfig = oldSnap.exists ? oldSnap.data() : {};
    const now = Date.now();
    const next = buildGatewayConfig(
        requested,
        tenantId,
        oldConfig,
        collectOwnerEmails(madrasa, auth, authUser),
        now
    );
    next.ownerUid = auth.uid;
    next.updatedByUid = auth.uid;
    next.updatedByEmail = normalizeGatewayEmail(auth.token && auth.token.email);
    next.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    const previousDirectory = directoryPlan(oldConfig);
    const nextDirectory = directoryPlan(next);
    const nextDirectoryIds = Object.keys(nextDirectory).filter(function (id) {
        return nextDirectory[id].roles.length > 0;
    });

    // Do not hijack an account that already represents an owner, staff member,
    // parent, or student anywhere in the platform.
    const uniqueNextEmails = Array.from(new Set(nextDirectoryIds.map(function (id) {
        return nextDirectory[id].email;
    }).filter(Boolean)));
    for (let emailIndex = 0; emailIndex < uniqueNextEmails.length; emailIndex++) {
        let gatewayUser = null;
        try {
            gatewayUser = await admin.auth().getUserByEmail(uniqueNextEmails[emailIndex]);
        } catch (err) {
            if (!err || err.code !== 'auth/user-not-found') throw err;
        }
        if (gatewayUser && gatewayUser.uid) {
            await assertRawGatewayIsNotBusinessIdentity(db, tenantId, gatewayUser.uid);
        }
    }

    next.directoryDocIds = nextDirectoryIds;
    const removalIds = Object.keys(previousDirectory).filter(function (id) {
        return nextDirectoryIds.indexOf(id) < 0;
    });

    // Directory uniqueness and configuration must be one atomic decision. A
    // read-then-batch sequence lets two institutions claim the same Gmail in
    // a race; the last writer would silently steal the gateway directory.
    await db.runTransaction(async function (tx) {
        const currentConfigSnap = await tx.get(ref);
        const currentRevision = currentConfigSnap.exists
            ? Number((currentConfigSnap.data() || {}).revision || 0)
            : 0;
        if (currentRevision !== Number(oldConfig.revision || 0)) {
            throw httpsError('aborted', 'ترتیبات بدل گئی ہیں؛ دوبارہ لوڈ کر کے محفوظ کریں۔');
        }
        const nextRefs = nextDirectoryIds.map(function (id) {
            return db.collection('SharedPortalGatewayDirectory').doc(id);
        });
        const removalRefs = removalIds.map(function (id) {
            return db.collection('SharedPortalGatewayDirectory').doc(id);
        });
        const nextSnaps = [];
        const removalSnaps = [];
        for (let i = 0; i < nextRefs.length; i++) nextSnaps.push(await tx.get(nextRefs[i]));
        for (let i = 0; i < removalRefs.length; i++) removalSnaps.push(await tx.get(removalRefs[i]));

        nextSnaps.forEach(function (snap) {
            if (!snap.exists) return;
            const existing = snap.data() || {};
            if (existing.status === 'active' && String(existing.tenantId || '') !== tenantId) {
                throw httpsError(
                    'already-exists',
                    'یہ مشترک گوگل کھاتہ پہلے ہی کسی دوسرے ادارے کے ساتھ منسلک ہے۔'
                );
            }
        });
        removalSnaps.forEach(function (snap) {
            if (snap.exists && String((snap.data() || {}).tenantId || '') === tenantId) {
                tx.delete(snap.ref);
            }
        });
        nextRefs.forEach(function (directoryDocument, index) {
            const id = nextDirectoryIds[index];
            tx.set(directoryDocument, {
                tenantId: tenantId,
                roles: nextDirectory[id].roles,
                status: 'active',
                configRevision: next.revision,
                updatedAtMs: now,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: false });
        });
        tx.set(ref, next, { merge: false });
    });

    // The new revision invalidates old sessions in Rules immediately. These
    // writes also revoke refresh tokens and make the revocation explicit.
    const revokeResult = await revokeActiveSessions(
        db,
        admin.auth(),
        tenantId,
        auth.uid,
        now,
        'configuration_changed'
    );
    await safeSecurityAudit(db, tenantId, {
        action: 'shared_portal_gateway_configured',
        uid: auth.uid,
        email: auth.token && auth.token.email,
        details: {
            mode: next.mode,
            revision: next.revision,
            enabledPortals: PORTALS.filter(function (portal) {
                return next.portals[portal].enabled;
            }),
            sessionsRevoked: revokeResult.revoked,
            revokeTruncated: revokeResult.truncated
        }
    });
    return {
        ok: true,
        sessionsRevoked: revokeResult.revoked,
        config: ownerGatewayConfig(next)
    };
}

async function getSharedPortalGatewayConfigHandler(data, context) {
    const tenantId = requiredString(data && data.tenantId, 'tenantId', 128);
    const db = admin.firestore();
    const madrasa = await assertMadrasaActive(db, tenantId);
    assertOwner(tenantId, madrasa, context);
    const snap = await configRef(db, tenantId).get();
    return { config: ownerGatewayConfig(snap.exists ? snap.data() : {}) };
}

function madrasaDisplayName(madrasa) {
    madrasa = madrasa || {};
    return String(
        madrasa.name
        || madrasa.madrasaName
        || madrasa.institutionName
        || madrasa.schoolName
        || ''
    ).trim().substring(0, 160);
}

/**
 * Resolve the institution exclusively from the verified Google email. The
 * client never supplies a tenant id, so it cannot probe another institution.
 */
async function resolveSharedPortalGatewayHandler(data, context) {
    data = data || {};
    const gateway = assertGoogleGatewayContext(context);
    const db = admin.firestore();
    const dirSnap = await directoryRef(db, gateway.email).get();
    if (!dirSnap.exists) return { matched: false };

    const directory = dirSnap.data() || {};
    if (directory.status !== 'active') return { matched: false };
    const tenantId = requiredString(directory.tenantId, 'tenantId', 128);
    const madrasa = await assertMadrasaActive(db, tenantId);
    const ownerUid = ownerUidFor(tenantId, madrasa);
    // Do not include the current raw gateway token here; doing so would
    // incorrectly classify every configured gateway address as an owner.
    const knownOwnerEmails = ownerEmailSet(collectOwnerEmails(madrasa, null, null));
    if (gateway.uid === ownerUid || knownOwnerEmails.has(gateway.email)) {
        throw httpsError('failed-precondition', 'مالک کا کھاتہ مشترک پورٹل نہیں بن سکتا۔');
    }

    const confSnap = await configRef(db, tenantId).get();
    if (!confSnap.exists) return { matched: false };
    const config = confSnap.data() || {};
    await assertRawGatewayIsNotBusinessIdentity(db, tenantId, gateway.uid);

    const directoryRoles = Array.isArray(directory.roles) ? directory.roles : [];
    const allowedPortals = PORTALS.filter(function (portal) {
        if (directoryRoles.indexOf(portal) === -1) return false;
        try {
            assertGatewayConfigAllows(config, tenantId, portal, gateway.email);
            return true;
        } catch (err) {
            return false;
        }
    });
    if (!allowedPortals.length) return { matched: false };

    const now = Date.now();
    const expiresAtMs = now + CHALLENGE_TTL_MS;
    const challengeId = crypto.randomBytes(24).toString('base64url');
    await challengeRef(db, tenantId, challengeId).set({
        status: 'active',
        rawGatewayUidHash: tenantHash(tenantId, 'gateway-uid', gateway.uid),
        gatewayEmailHash: tenantHash(tenantId, 'gateway-email', gateway.email),
        allowedPortals: allowedPortals,
        configRevision: Number(config.revision) || 0,
        createdAtMs: now,
        expiresAtMs: expiresAtMs,
        expiresAtTtl: admin.firestore.Timestamp.fromMillis(expiresAtMs)
    }, { merge: false });

    await safeSecurityAudit(db, tenantId, {
        action: 'shared_portal_gateway_resolved',
        uid: gateway.uid,
        email: gateway.email,
        details: { allowedPortals: allowedPortals, expiresAtMs: expiresAtMs }
    });
    return {
        matched: true,
        challengeId: challengeId,
        allowedPortals: allowedPortals,
        tenantId: tenantId,
        institutionName: madrasaDisplayName(madrasa),
        expiresAt: expiresAtMs
    };
}

function configPortalEntry(config, portal) {
    return config && config.portals && config.portals[portal]
        ? config.portals[portal]
        : {};
}

function assertGatewayConfigAllows(config, tenantId, portal, email) {
    if (!config || config.enabled !== true || config.mode === 'individual') {
        throw httpsError('failed-precondition', 'مشترک پورٹل فعال نہیں۔');
    }
    const entry = configPortalEntry(config, portal);
    if (entry.enabled !== true || !entry.emailHash) {
        throw httpsError('permission-denied', 'پورٹل رسائی منظور نہیں۔');
    }
    if (portal === 'student' && config.studentPortalExplicitlyEnabled !== true) {
        throw httpsError('failed-precondition', 'طالب علم پورٹل فعال نہیں۔');
    }
    const suppliedHash = tenantHash(tenantId, 'gateway-email', email);
    if (!safeEqual(suppliedHash, entry.emailHash)) {
        throw httpsError('permission-denied', 'پورٹل رسائی منظور نہیں۔');
    }
    return entry;
}

async function assertRawGatewayIsNotBusinessIdentity(db, tenantId, rawUid) {
    const base = db.collection('All_Madrasas').doc(tenantId);
    const exactSnaps = await Promise.all([
        base.collection('Staff_Links').doc(rawUid).get(),
        base.collection('Parent_Links').doc(rawUid).get(),
        base.collection('Student_Links').doc(rawUid).get(),
        db.collection('All_Madrasas').doc(rawUid).get()
    ]);
    const groupSnaps = await Promise.all([
        db.collectionGroup('Staff_Links').where('authUid', '==', rawUid).limit(1).get(),
        db.collectionGroup('Parent_Links').where('authUid', '==', rawUid).limit(1).get(),
        db.collectionGroup('Student_Links').where('authUid', '==', rawUid).limit(1).get(),
        db.collection('All_Madrasas').where('ownerUid', '==', rawUid).limit(1).get()
    ]);
    if (exactSnaps.some(function (snap) { return snap.exists; })
        || groupSnaps.some(function (snap) { return !snap.empty; })) {
        throw httpsError(
            'failed-precondition',
            'یہ گوگل کھاتہ پہلے ہی کسی ادارے میں انفرادی شناخت یا ملکیت سے منسلک ہے؛ مشترک کھاتے کے لیے الگ برقی پتہ رکھیں۔'
        );
    }
}

async function bindGatewayUid(db, tenantId, portal, rawUid, email, expectedRevision) {
    const ref = configRef(db, tenantId);
    const rawUidHash = tenantHash(tenantId, 'gateway-uid', rawUid);
    await db.runTransaction(async function (tx) {
        const snap = await tx.get(ref);
        if (!snap.exists) throw httpsError('failed-precondition', 'مشترک پورٹل فعال نہیں۔');
        const current = snap.data() || {};
        if (Number(current.revision) !== Number(expectedRevision)) {
            throw httpsError('aborted', 'ترتیبات بدل گئی ہیں؛ دوبارہ کوشش کریں۔');
        }
        assertGatewayConfigAllows(current, tenantId, portal, email);
        const bindingKey = current.mode === 'single' ? 'single' : portal;
        const existing = current.gatewayUidHashes && current.gatewayUidHashes[bindingKey];
        if (existing && !safeEqual(existing, rawUidHash)) {
            throw httpsError(
                'permission-denied',
                'یہ مشترک برقی پتہ کسی دوسری شناخت سے بندھا ہوا ہے؛ مالک ترتیبات دوبارہ محفوظ کرے۔'
            );
        }
        if (!existing) {
            const update = {};
            update['gatewayUidHashes.' + bindingKey] = rawUidHash;
            update['gatewayUidBoundAtMs.' + bindingKey] = Date.now();
            tx.update(ref, update);
        }
    });
    return rawUidHash;
}

function attemptDocId(tenantId, rawUid, portal, personId) {
    return tenantHash(tenantId, 'attempt', rawUid + ':' + portal + ':' + personId).substring(0, 48);
}

function gatewayAttemptDocId(tenantId, rawUid, portal) {
    return tenantHash(tenantId, 'attempt-gateway', rawUid + ':' + portal).substring(0, 48);
}

async function reserveAttempt(db, tenantId, rawUid, portal, personId, config, now) {
    const col = tenantSubcollection(db, tenantId, 'SharedPortalAttempts');
    const refs = [
        {
            ref: col.doc(attemptDocId(tenantId, rawUid, portal, personId)),
            max: Number(config.maxAttemptsPerPerson) || DEFAULT_MAX_ATTEMPTS,
            scope: 'person'
        },
        {
            ref: col.doc(gatewayAttemptDocId(tenantId, rawUid, portal)),
            max: Number(config.maxAttemptsPerGateway) || DEFAULT_GATEWAY_MAX_ATTEMPTS,
            scope: 'gateway'
        }
    ];
    await db.runTransaction(async function (tx) {
        const snaps = [];
        for (let i = 0; i < refs.length; i++) snaps.push(await tx.get(refs[i].ref));
        for (let i = 0; i < refs.length; i++) {
            const old = snaps[i].exists ? (snaps[i].data() || {}) : {};
            if (Number(old.blockedUntilMs) > now) {
                throw httpsError('resource-exhausted', 'کوششیں زیادہ ہو گئی ہیں؛ کچھ دیر بعد دوبارہ کوشش کریں۔');
            }
            const windowStart = Number(old.windowStartedAtMs) || now;
            const expiredWindow = now - windowStart >= ATTEMPT_WINDOW_MS;
            const count = expiredWindow ? 1 : (Number(old.count) || 0) + 1;
            tx.set(refs[i].ref, {
                scope: refs[i].scope,
                portal: portal,
                count: count,
                maxAttempts: refs[i].max,
                windowStartedAtMs: expiredWindow ? now : windowStart,
                lastAttemptAtMs: now,
                blockedUntilMs: 0
            }, { merge: true });
        }
    });
    return refs.map(function (item) { return item.ref; });
}

async function recordFailedAttempt(db, refs, config, now) {
    const lockoutMs = (Number(config.lockoutMinutes) || DEFAULT_LOCKOUT_MINUTES) * 60000;
    await db.runTransaction(async function (tx) {
        const snaps = [];
        for (let i = 0; i < refs.length; i++) snaps.push(await tx.get(refs[i]));
        for (let i = 0; i < refs.length; i++) {
            if (!snaps[i].exists) continue;
            const state = snaps[i].data() || {};
            if ((Number(state.count) || 0) >= (Number(state.maxAttempts) || DEFAULT_MAX_ATTEMPTS)) {
                tx.set(refs[i], { blockedUntilMs: now + lockoutMs }, { merge: true });
            }
        }
    });
}

async function clearAttempts(refs) {
    await Promise.all((refs || []).map(function (ref) {
        return ref.delete().catch(function () { return null; });
    }));
}

function timestampMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    return Number(value) || 0;
}

function keyUsable(keyData, plainKey) {
    if (!keyData || !keyData.accessKeyHash || isKeyExpired({
        accessKeyExpiresAt: timestampMillis(keyData.accessKeyExpiresAt)
    })) return false;
    return safeEqual(hashAccessKey(plainKey), keyData.accessKeyHash);
}

function activeStatus(data) {
    return !!data && String(data.status || '').toLowerCase() === 'active';
}

async function verifyTeacherPerson(base, personId, plainKey) {
    const results = await Promise.all([
        base.collection('StaffPermissions').doc(personId).get(),
        base.collection('StaffAccessKeys').doc(personId).get()
    ]);
    const perm = results[0].exists ? (results[0].data() || {}) : null;
    if (!activeStatus(perm)) return false;
    let keyData = results[1].exists ? (results[1].data() || {}) : null;
    // Existing installations may still have the key only in StaffPermissions.
    if (!keyData || !keyData.accessKeyHash) keyData = perm;
    return keyUsable(keyData, plainKey);
}

async function verifyParentPerson(base, personId, plainKey) {
    const results = await Promise.all([
        base.collection('Registrations').doc(personId).get(),
        base.collection('ParentPermissions').doc(personId).get(),
        base.collection('ParentAccessKeys').doc(personId).get()
    ]);
    if (!results[0].exists || !registrationIsActive(results[0].data() || {})) return false;
    const permission = results[1].exists ? (results[1].data() || {}) : null;
    if (!activeStatus(permission)) return false;
    const keyData = results[2].exists ? (results[2].data() || {}) : null;
    // Exact document only: one child's key can never unlock siblings.
    return keyUsable(keyData, plainKey);
}

function registrationIsActive(data) {
    if (!data) return false;
    const status = String(data.status || 'active').trim().toLowerCase();
    return ['inactive', 'disabled', 'suspended', 'withdrawn', 'alumni', 'deleted'].indexOf(status) === -1;
}

async function verifyStudentPerson(base, personId, plainKey, config) {
    if (!config || config.studentPortalExplicitlyEnabled !== true) return false;
    const results = await Promise.all([
        base.collection('Registrations').doc(personId).get(),
        base.collection('StudentAccessKeys').doc(personId).get()
    ]);
    if (!results[0].exists || !registrationIsActive(results[0].data() || {})) return false;
    const keyData = results[1].exists ? (results[1].data() || {}) : null;
    return keyUsable(keyData, plainKey);
}

async function verifyPortalPerson(db, tenantId, portal, personId, plainKey, config) {
    const base = db.collection('All_Madrasas').doc(tenantId);
    if (portal === 'teacher') return verifyTeacherPerson(base, personId, plainKey);
    if (portal === 'parent') return verifyParentPerson(base, personId, plainKey);
    return verifyStudentPerson(base, personId, plainKey, config);
}

async function assertGatewayTenantSecurityAllows(db, tenantId, portal, gatewayEmail) {
    const base = db.collection('All_Madrasas').doc(tenantId);
    const snaps = await Promise.all([
        base.collection('TenantSettings').doc('ssoPolicy').get(),
        base.collection('SecuritySettings').doc('mfa').get()
    ]);
    const sso = snaps[0].exists ? (snaps[0].data() || {}) : {};
    if (!providerAllowed(sso, 'google.com')) {
        throw httpsError('permission-denied', 'اس ادارے کی داخلہ پالیسی مشترک گوگل کھاتے کی اجازت نہیں دیتی۔');
    }
    const domains = parseDomains(sso.allowedEmailDomains);
    const enforceDomain = portal === 'parent'
        ? sso.enforceParentEmailDomain === true
        : sso.enforceStaffEmailDomain === true;
    if (enforceDomain && !emailMatchesDomains(gatewayEmail, domains)) {
        throw httpsError('permission-denied', 'مشترک گوگل پتے کا دائرہ اس ادارے کے لیے مجاز نہیں۔');
    }

    // A custom-token session cannot inherit the raw account's Firebase MFA
    // proof. Fail closed instead of silently bypassing an institution policy.
    const mfa = snaps[1].exists ? (snaps[1].data() || {}) : {};
    const mfaRequired = portal === 'parent'
        ? mfa.requireMfaForParent === true
        : mfa.requireMfaForStaff === true;
    if (mfaRequired) {
        throw httpsError(
            'failed-precondition',
            'اس پورٹل پر دو مرحلہ تصدیق لازم ہے؛ مشترک گوگل کھاتہ استعمال نہیں ہو سکتا۔'
        );
    }
}

async function assertAndConsumeChallenge(
    db,
    tenantId,
    challengeId,
    portal,
    personId,
    gateway,
    expectedRevision,
    now
) {
    challengeId = requiredString(challengeId, 'challengeId', 128);
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(challengeId)) {
        throw httpsError('invalid-argument', 'عارضی اجازت درست نہیں۔');
    }
    const ref = challengeRef(db, tenantId, challengeId);
    await db.runTransaction(async function (tx) {
        const snap = await tx.get(ref);
        if (!snap.exists) throw httpsError('permission-denied', 'عارضی اجازت موجود نہیں۔');
        const item = snap.data() || {};
        const expectedUidHash = tenantHash(tenantId, 'gateway-uid', gateway.uid);
        const expectedEmailHash = tenantHash(tenantId, 'gateway-email', gateway.email);
        const allowed = Array.isArray(item.allowedPortals) ? item.allowedPortals : [];
        if (item.status !== 'active'
            || Number(item.expiresAtMs) <= now
            || Number(item.configRevision) !== Number(expectedRevision)
            || allowed.indexOf(portal) === -1
            || !safeEqual(item.rawGatewayUidHash, expectedUidHash)
            || !safeEqual(item.gatewayEmailHash, expectedEmailHash)) {
            throw httpsError('permission-denied', 'عارضی اجازت ختم یا مسترد ہو چکی ہے۔');
        }
        tx.set(ref, {
            status: 'used',
            usedAtMs: now,
            portal: portal,
            personIdHash: tenantHash(tenantId, 'challenge-person', portal + ':' + personId)
        }, { merge: true });
    });
}

function syntheticUid(tenantId, portal, personId) {
    return 'spg_' + tenantHash(tenantId, 'principal', portal + ':' + personId).substring(0, 56);
}

function principalDocId(tenantId, portal, personId) {
    return tenantHash(tenantId, 'principal-doc', portal + ':' + personId).substring(0, 48);
}

function linkPayload(portal, syntheticUserUid, personId, sessionId, expiresAtMs, revision, absoluteExpiresAtMs) {
    const common = {
        authUid: syntheticUserUid,
        email: '',
        status: 'active',
        identityMode: 'shared_gateway',
        portalRole: portal,
        personId: personId,
        sessionId: sessionId,
        sessionExpiresAtMs: expiresAtMs,
        sessionAbsoluteExpiresAtMs: Number(absoluteExpiresAtMs) || expiresAtMs,
        gatewayConfigRevision: Number(revision) || 0,
        activatedAtMs: Date.now()
    };
    if (portal === 'teacher') {
        common.staffId = personId;
        common.studentIds = [];
    } else if (portal === 'parent') {
        // Deliberately exact: never merge a shared parent's other children here.
        common.staffId = '';
        common.studentIds = [personId];
    } else {
        common.studentId = personId;
        common.staffId = '';
        common.studentIds = [personId];
    }
    return common;
}

function linkCollectionFor(portal) {
    if (portal === 'teacher') return 'Staff_Links';
    if (portal === 'parent') return 'Parent_Links';
    return 'Student_Links';
}

function validatePersonId(value) {
    const personId = requiredString(value, 'personId', 128);
    if (/[\/\x00-\x1f]/.test(personId) || personId.indexOf('pending_') === 0) {
        throw httpsError('invalid-argument', 'personId درست نہیں۔');
    }
    return personId;
}

function validatePlainKey(value) {
    const key = requiredString(value, 'accessKey', 64);
    if (!/^[0-9A-Za-z\s-]{4,64}$/.test(key)) {
        throw httpsError('invalid-argument', 'رسائی کلید درست نہیں۔');
    }
    return key;
}

async function persistSyntheticSession(db, authApi, tenantId, portal, personId, rawGatewayUidHash, config) {
    const now = Date.now();
    const expiresAtMs = now + (Number(config.sessionTtlMinutes) || DEFAULT_SESSION_MINUTES) * 60000;
    const absoluteExpiresAtMs = now + MAX_ABSOLUTE_SESSION_MS;
    const sessionId = crypto.randomBytes(18).toString('base64url');
    const uid = syntheticUid(tenantId, portal, personId);
    const principalId = principalDocId(tenantId, portal, personId);
    const claims = {
        sharedPortal: true,
        emsSharedPortalPrincipal: true,
        tenantId: tenantId,
        portal: portal,
        portalRole: portal,
        principalId: personId,
        personId: personId,
        sessionId: sessionId,
        portalSessionId: sessionId,
        sessionVersion: Number(config.revision) || 0,
        gatewayConfigRevision: Number(config.revision) || 0,
        sessionExpiresAtMs: expiresAtMs,
        sessionAbsoluteExpiresAtMs: absoluteExpiresAtMs
    };

    try {
        await authApi.revokeRefreshTokens(uid);
    } catch (err) {
        if (!err || err.code !== 'auth/user-not-found') throw err;
    }
    const customToken = await authApi.createCustomToken(uid, claims);
    const base = db.collection('All_Madrasas').doc(tenantId);
    const principalRef = base.collection('SharedPortalPrincipals').doc(principalId);
    const oldPrincipal = await principalRef.get();
    const batch = db.batch();
    if (oldPrincipal.exists && oldPrincipal.data().currentSessionId) {
        batch.set(base.collection('SharedPortalSessions').doc(oldPrincipal.data().currentSessionId), {
            status: 'revoked',
            revokedAtMs: now,
            revokeReason: 'superseded'
        }, { merge: true });
    }
    batch.set(principalRef, {
        portal: portal,
        personId: personId,
        syntheticUid: uid,
        status: 'active',
        currentSessionId: sessionId,
        gatewayConfigRevision: Number(config.revision) || 0,
        updatedAtMs: now
    }, { merge: true });
    batch.set(base.collection('SharedPortalSessions').doc(sessionId), {
        sessionId: sessionId,
        portal: portal,
        personId: personId,
        principalId: principalId,
        syntheticUid: uid,
        rawGatewayUidHash: rawGatewayUidHash,
        gatewayConfigRevision: Number(config.revision) || 0,
        status: 'active',
        createdAtMs: now,
        expiresAtMs: expiresAtMs,
        absoluteExpiresAtMs: absoluteExpiresAtMs,
        expiresAtTtl: admin.firestore.Timestamp.fromMillis(expiresAtMs)
    });
    batch.set(
        base.collection(linkCollectionFor(portal)).doc(uid),
        linkPayload(portal, uid, personId, sessionId, expiresAtMs, config.revision, absoluteExpiresAtMs),
        { merge: false }
    );
    await batch.commit();
    return {
        customToken: customToken,
        customUid: uid,
        tenantId: tenantId,
        portal: portal,
        personId: personId,
        sessionId: sessionId,
        expiresAtMs: expiresAtMs,
        absoluteExpiresAtMs: absoluteExpiresAtMs
    };
}

async function renewSharedPortalSessionHandler(data, context) {
    if (!isSharedPortalContext(context)) {
        throw httpsError('permission-denied', 'صرف فعال مشترک پورٹل نشست کی تجدید ہو سکتی ہے۔');
    }
    const token = context.auth.token || {};
    const tenantId = requiredString(token.tenantId, 'tenantId', 128);
    const portal = normalizePortal(token.portalRole || token.portal);
    const personId = validatePersonId(token.personId || token.principalId);
    const sessionId = requiredString(token.portalSessionId || token.sessionId, 'sessionId', 128);
    const db = admin.firestore();
    await assertMadrasaActive(db, tenantId);
    const base = db.collection('All_Madrasas').doc(tenantId);
    const linkRef = base.collection(linkCollectionFor(portal)).doc(context.auth.uid);
    const linkSnap = await linkRef.get();
    if (!linkSnap.exists) throw httpsError('permission-denied', 'مشترک پورٹل شناخت موجود نہیں۔');
    await assertSharedPortalSessionActive(db, tenantId, context, linkSnap.data() || {}, portal);

    const refs = [
        base.collection('SharedPortalSessions').doc(sessionId),
        configRef(db, tenantId)
    ];
    const snaps = await Promise.all(refs.map(function (ref) { return ref.get(); }));
    const session = snaps[0].data() || {};
    const config = snaps[1].data() || {};
    const now = Date.now();
    const absoluteExpiresAtMs = Number(session.absoluteExpiresAtMs || token.sessionAbsoluteExpiresAtMs || 0);
    if (!absoluteExpiresAtMs || absoluteExpiresAtMs <= now) {
        throw httpsError('permission-denied', 'مشترک پورٹل کی زیادہ سے زیادہ نشست مکمل ہو گئی؛ دوبارہ داخل ہوں۔');
    }
    const proposed = now + (Number(config.sessionTtlMinutes) || DEFAULT_SESSION_MINUTES) * 60000;
    const expiresAtMs = Math.min(proposed, absoluteExpiresAtMs);
    const revision = Number(config.revision) || 0;
    const claims = {
        sharedPortal: true,
        emsSharedPortalPrincipal: true,
        tenantId: tenantId,
        portal: portal,
        portalRole: portal,
        principalId: personId,
        personId: personId,
        sessionId: sessionId,
        portalSessionId: sessionId,
        sessionVersion: revision,
        gatewayConfigRevision: revision,
        sessionExpiresAtMs: expiresAtMs,
        sessionAbsoluteExpiresAtMs: absoluteExpiresAtMs
    };
    const batch = db.batch();
    batch.set(refs[0], {
        expiresAtMs: expiresAtMs,
        expiresAtTtl: admin.firestore.Timestamp.fromMillis(expiresAtMs),
        renewedAtMs: now
    }, { merge: true });
    batch.set(linkRef, {
        sessionExpiresAtMs: expiresAtMs,
        sessionAbsoluteExpiresAtMs: absoluteExpiresAtMs,
        renewedAtMs: now
    }, { merge: true });
    await batch.commit();
    await admin.auth().setCustomUserClaims(context.auth.uid, claims);
    await safeSecurityAudit(db, tenantId, {
        action: 'shared_portal_gateway_session_renewed',
        uid: context.auth.uid,
        details: { portal: portal, personId: personId, sessionId: sessionId, expiresAtMs: expiresAtMs }
    });
    return {
        ok: true,
        tenantId: tenantId,
        portal: portal,
        personId: personId,
        sessionId: sessionId,
        expiresAtMs: expiresAtMs,
        absoluteExpiresAtMs: absoluteExpiresAtMs,
        sessionVersion: revision
    };
}

async function exchangeSharedPortalTokenHandler(data, context) {
    data = data || {};
    const gateway = assertGoogleGatewayContext(context);
    const portal = normalizePortal(data.portal);
    const personId = validatePersonId(data.personId);
    const plainKey = validatePlainKey(data.accessKey || data.plainKey);
    const db = admin.firestore();
    const dirSnap = await directoryRef(db, gateway.email).get();
    if (!dirSnap.exists || (dirSnap.data() || {}).status !== 'active') {
        throw httpsError('permission-denied', 'یہ گوگل کھاتہ مشترک پورٹل کے لیے مقرر نہیں۔');
    }
    const directory = dirSnap.data() || {};
    const tenantId = requiredString(directory.tenantId, 'tenantId', 128);
    const madrasa = await assertMadrasaActive(db, tenantId);
    const ownerUid = ownerUidFor(tenantId, madrasa);
    const knownOwnerEmails = ownerEmailSet(collectOwnerEmails(madrasa, null, null));
    if (gateway.uid === ownerUid || knownOwnerEmails.has(gateway.email)) {
        throw httpsError('failed-precondition', 'مالک کا کھاتہ مشترک پورٹل نہیں بن سکتا۔');
    }

    const confSnap = await configRef(db, tenantId).get();
    if (!confSnap.exists) throw httpsError('failed-precondition', 'مشترک پورٹل فعال نہیں۔');
    const config = confSnap.data() || {};
    assertGatewayConfigAllows(config, tenantId, portal, gateway.email);
    await assertRawGatewayIsNotBusinessIdentity(db, tenantId, gateway.uid);
    await assertGatewayTenantSecurityAllows(db, tenantId, portal, gateway.email);
    const rawGatewayUidHash = await bindGatewayUid(
        db,
        tenantId,
        portal,
        gateway.uid,
        gateway.email,
        config.revision
    );

    const now = Date.now();
    let attemptRefs;
    try {
        attemptRefs = await reserveAttempt(db, tenantId, gateway.uid, portal, personId, config, now);
    } catch (err) {
        await safeSecurityAudit(db, tenantId, {
            action: 'shared_portal_gateway_rate_limited',
            uid: gateway.uid,
            email: gateway.email,
            details: { portal: portal, personId: personId }
        });
        throw err;
    }

    const verified = await verifyPortalPerson(db, tenantId, portal, personId, plainKey, config);
    if (!verified) {
        await recordFailedAttempt(db, attemptRefs, config, now);
        await safeSecurityAudit(db, tenantId, {
            action: 'shared_portal_gateway_rejected',
            uid: gateway.uid,
            email: gateway.email,
            details: { portal: portal, personId: personId, reason: 'credential_rejected' }
        });
        throw httpsError('permission-denied', 'شناخت یا رسائی کلید درست نہیں۔');
    }

    // A challenge is consumed only after credentials pass, and exactly once.
    // A racing replay can therefore never obtain a second principal session.
    await assertAndConsumeChallenge(
        db,
        tenantId,
        data.challengeId,
        portal,
        personId,
        gateway,
        config.revision,
        now
    );

    await clearAttempts(attemptRefs);
    const result = await persistSyntheticSession(
        db,
        admin.auth(),
        tenantId,
        portal,
        personId,
        rawGatewayUidHash,
        config
    );
    await safeSecurityAudit(db, tenantId, {
        action: 'shared_portal_gateway_session_issued',
        uid: gateway.uid,
        email: gateway.email,
        details: {
            portal: portal,
            personId: personId,
            sessionId: result.sessionId,
            expiresAtMs: result.expiresAtMs,
            gatewayConfigRevision: Number(config.revision) || 0
        }
    });
    return result;
}

async function revokeSharedPortalSessionHandler(data, context) {
    data = data || {};
    const tenantId = requiredString(data.tenantId, 'tenantId', 128);
    const sessionId = requiredString(data.sessionId, 'sessionId', 128);
    const db = admin.firestore();
    const madrasa = await assertMadrasaActive(db, tenantId);
    const auth = assertOwner(tenantId, madrasa, context);
    const base = db.collection('All_Madrasas').doc(tenantId);
    const sessionRef = base.collection('SharedPortalSessions').doc(sessionId);
    const snap = await sessionRef.get();
    if (!snap.exists) throw httpsError('not-found', 'مشترک پورٹل نشست نہیں ملی۔');
    const session = snap.data() || {};
    const now = Date.now();
    const batch = db.batch();
    batch.set(sessionRef, {
        status: 'revoked',
        revokedAtMs: now,
        revokedByUid: auth.uid,
        revokeReason: 'owner_revoke'
    }, { merge: true });
    if (session.syntheticUid) {
        const linkRef = base.collection(linkCollectionFor(session.portal)).doc(session.syntheticUid);
        batch.set(linkRef, {
            status: 'revoked',
            revokedAtMs: now,
            revokedByUid: auth.uid
        }, { merge: true });
    }
    await batch.commit();
    if (session.syntheticUid) {
        try {
            await admin.auth().revokeRefreshTokens(session.syntheticUid);
        } catch (err) {
            if (!err || err.code !== 'auth/user-not-found') throw err;
        }
    }
    await safeSecurityAudit(db, tenantId, {
        action: 'shared_portal_gateway_session_revoked',
        uid: auth.uid,
        email: auth.token && auth.token.email,
        details: { sessionId: sessionId, portal: session.portal, personId: session.personId }
    });
    return { ok: true, sessionId: sessionId };
}

const configureSharedPortalGateway = functions.https.onCall(configureSharedPortalGatewayHandler);
const getSharedPortalGatewayConfig = functions.https.onCall(getSharedPortalGatewayConfigHandler);
const resolveSharedPortalGateway = functions.https.onCall(resolveSharedPortalGatewayHandler);
const exchangeSharedPortalToken = functions.https.onCall(exchangeSharedPortalTokenHandler);
const renewSharedPortalSession = functions.https.onCall(renewSharedPortalSessionHandler);
const revokeSharedPortalSession = functions.https.onCall(revokeSharedPortalSessionHandler);

module.exports = {
    CONFIG_DOC_ID,
    SCHEMA_VERSION,
    MODES,
    PORTALS,
    normalizeGatewayEmail,
    maskEmail,
    tenantHash,
    safeEqual,
    buildGatewayConfig,
    publicGatewayConfig,
    ownerGatewayConfig,
    directoryDocId,
    directoryPlan,
    assertGoogleGatewayContext,
    assertGatewayConfigAllows,
    keyUsable,
    syntheticUid,
    principalDocId,
    linkPayload,
    linkCollectionFor,
    configureSharedPortalGatewayHandler,
    getSharedPortalGatewayConfigHandler,
    resolveSharedPortalGatewayHandler,
    exchangeSharedPortalTokenHandler,
    renewSharedPortalSessionHandler,
    revokeSharedPortalSessionHandler,
    configureSharedPortalGateway,
    getSharedPortalGatewayConfig,
    resolveSharedPortalGateway,
    exchangeSharedPortalToken,
    renewSharedPortalSession,
    revokeSharedPortalSession
};
