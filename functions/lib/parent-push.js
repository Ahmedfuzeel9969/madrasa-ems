/**
 * Parent push notifications — admin reply alerts (Phase 8)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { sendFcmToTokens, sendEmailSmtp } = require('./notification-delivery');

function uniqueUids(list) {
    const seen = {};
    const out = [];
    (list || []).forEach(function (uid) {
        if (uid && !seen[uid]) {
            seen[uid] = true;
            out.push(uid);
        }
    });
    return out;
}

async function findParentUidsForStudent(db, tenantId, studentId) {
    const uids = [];
    const permSnap = await db.collection('ParentPermissions').doc(studentId).get();
    if (permSnap.exists && permSnap.data().tenantId === tenantId && permSnap.data().parentUid) {
        uids.push(permSnap.data().parentUid);
    }
    const linksSnap = await db.collection('All_Madrasas').doc(tenantId).collection('Parent_Links').get();
    linksSnap.forEach(function (doc) {
        const d = doc.data() || {};
        if (d.status === 'active' && (d.studentIds || []).indexOf(studentId) >= 0) {
            uids.push(doc.id);
        }
    });
    return uniqueUids(uids);
}

async function loadParentTokens(db, tenantId, parentUid) {
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('ParentDeviceTokens').doc(parentUid).get();
    if (!snap.exists) return [];
    const data = snap.data() || {};
    return Array.isArray(data.tokens) ? data.tokens : (data.token ? [data.token] : []);
}

function previewMessage(data) {
    if (data.format === 'voice') return 'صوتی پیغام';
    const text = String(data.text || '').trim();
    return text.length > 120 ? text.slice(0, 117) + '...' : text;
}

async function executeParentPushDelivery(db, tenantId, msg, policy, notifyId, now, priorAttempts) {
    const studentId = msg.studentId;
    const parentUids = await findParentUidsForStudent(db, tenantId, studentId);
    const title = 'ادارے کا جواب — ' + (msg.studentName || studentId);
    const body = previewMessage(msg);
    let fcmSent = 0;
    let emailSent = 0;
    let deliveryError = '';
    const tokens = [];

    for (let i = 0; i < parentUids.length; i++) {
        const parentTokens = await loadParentTokens(db, tenantId, parentUids[i]);
        parentTokens.forEach(function (t) { tokens.push(t); });
        if (policy.enableEmailDelivery !== false) {
            const linkSnap = await db.collection('All_Madrasas').doc(tenantId)
                .collection('Parent_Links').doc(parentUids[i]).get();
            const email = linkSnap.exists ? (linkSnap.data().email || '') : '';
            if (email) {
                const res = await sendEmailSmtp(email, title, body);
                if (res.sent) emailSent++;
                else if (res.reason && res.reason !== 'smtp_not_configured') deliveryError = res.reason;
            }
        }
    }

    if (policy.enablePushDelivery !== false && tokens.length) {
        const fcmRes = await sendFcmToTokens(tokens, title, body, {
            type: 'parent_reply',
            tenantId: tenantId,
            studentId: studentId,
            messageId: msg.id || ''
        });
        fcmSent = fcmRes.sent || 0;
        if (!fcmSent && fcmRes.reason) deliveryError = fcmRes.reason;
    }

    let deliveryStatus = fcmSent > 0 || emailSent > 0 ? 'sent' : 'in_app_only';
    if (deliveryStatus === 'in_app_only' && policy.enablePushDelivery !== false && tokens.length && !fcmSent) {
        deliveryStatus = 'failed';
    }
    if (deliveryStatus === 'in_app_only' && policy.enableEmailDelivery !== false && deliveryError) {
        deliveryStatus = 'failed';
    }

    const payload = {
        deliveryStatus: deliveryStatus,
        fcmSent: fcmSent,
        emailSent: emailSent,
        parentUids: parentUids,
        deliveryAttempts: (priorAttempts || 0) + 1,
        deliveryError: deliveryStatus === 'failed' ? (deliveryError || 'delivery_failed') : admin.firestore.FieldValue.delete(),
        deliveredAt: deliveryStatus === 'sent' ? now : admin.firestore.FieldValue.delete(),
        updatedAt: now
    };
    await db.collection('All_Madrasas').doc(tenantId)
        .collection('ParentPushNotifications').doc(notifyId)
        .set(payload, { merge: true });

    return { deliveryStatus: deliveryStatus, fcmSent: fcmSent, emailSent: emailSent, notifyId: notifyId };
}

async function dispatchParentReplyNotification(db, tenantId, msg, now) {
    const studentId = msg.studentId;
    if (!studentId) return { skipped: true, reason: 'no_student' };

    const policySnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('securityPolicy').get();
    const policy = policySnap.exists ? policySnap.data() : {};
    if (policy.notifyParentOnAdminReply === false) {
        return { skipped: true, reason: 'policy_disabled' };
    }

    const title = 'ادارے کا جواب — ' + (msg.studentName || studentId);
    const body = previewMessage(msg);
    const notifyId = 'parent-reply-' + (msg.id || now);

    await db.collection('All_Madrasas').doc(tenantId)
        .collection('ParentPushNotifications').doc(notifyId)
        .set({
            id: notifyId,
            tenantId: tenantId,
            studentId: studentId,
            studentName: msg.studentName || studentId,
            messageId: msg.id,
            title: title,
            body: body,
            deliveryStatus: 'queued',
            createdAt: now,
            updatedAt: now
        }, { merge: true });

    await db.collection('All_Madrasas').doc(tenantId).collection('Announcements')
        .doc(notifyId)
        .set({
            title: title,
            details: body,
            audience: 'parent',
            studentId: studentId,
            category: 'message',
            timestamp: now,
            source: 'admin_reply'
        }, { merge: true });

    const result = await executeParentPushDelivery(db, tenantId, msg, policy, notifyId, now, 0);
    return { ok: true, notifyId: notifyId, fcmSent: result.fcmSent, emailSent: result.emailSent };
}

async function redeliverParentPushNotification(db, tenantId, msg, now) {
    const policySnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('securityPolicy').get();
    const policy = policySnap.exists ? policySnap.data() : {};
    const notifyId = 'parent-reply-' + (msg.id || now);
    const existing = await db.collection('All_Madrasas').doc(tenantId)
        .collection('ParentPushNotifications').doc(notifyId).get();
    const priorAttempts = existing.exists ? (existing.data().deliveryAttempts || 0) : 0;
    return executeParentPushDelivery(db, tenantId, msg, policy, notifyId, now, priorAttempts);
}

const onParentMessageCreated = functions.firestore
    .document('All_Madrasas/{tenantId}/ParentMessages/{msgId}')
    .onCreate(async function (snap, context) {
        const data = snap.data() || {};
        if (data.direction !== 'out') return null;
        try {
            return await dispatchParentReplyNotification(
                admin.firestore(),
                context.params.tenantId,
                data,
                Date.now()
            );
        } catch (err) {
            console.error('onParentMessageCreated', err);
            return null;
        }
    });

function mergeTokens(existing, token) {
    const list = Array.isArray(existing) ? existing.slice() : [];
    if (token && list.indexOf(token) < 0) list.push(token);
    return list.slice(-10);
}

const registerParentDeviceToken = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const token = String((data && data.token) || '').trim();
    if (!tenantId || !token) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور token درکار ہیں۔');
    }
    const db = admin.firestore();
    const linkSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Parent_Links').doc(context.auth.uid).get();
    if (!linkSnap.exists || linkSnap.data().status !== 'active') {
        throw new functions.https.HttpsError('permission-denied', 'والدین رسائی نہیں۔');
    }
    const ref = db.collection('All_Madrasas').doc(tenantId)
        .collection('ParentDeviceTokens').doc(context.auth.uid);
    const existing = await ref.get();
    const tokens = mergeTokens(existing.exists ? existing.data().tokens : [], token);
    await ref.set({
        uid: context.auth.uid,
        tokens: tokens,
        updatedAt: Date.now()
    }, { merge: true });
    return { ok: true, count: tokens.length };
});

const registerOwnerDeviceToken = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const token = String((data && data.token) || '').trim();
    if (!tenantId || !token) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور token درکار ہیں۔');
    }
    const db = admin.firestore();
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== context.auth.uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک register کر سکتا ہے۔');
    }
    const ref = db.collection('All_Madrasas').doc(tenantId)
        .collection('OwnerDeviceTokens').doc(context.auth.uid);
    const existing = await ref.get();
    const tokens = mergeTokens(existing.exists ? existing.data().tokens : [], token);
    await ref.set({
        uid: context.auth.uid,
        tokens: tokens,
        updatedAt: Date.now()
    }, { merge: true });
    return { ok: true, count: tokens.length };
});

module.exports = {
    findParentUidsForStudent,
    previewMessage,
    executeParentPushDelivery,
    dispatchParentReplyNotification,
    redeliverParentPushNotification,
    onParentMessageCreated,
    registerParentDeviceToken,
    registerOwnerDeviceToken
};
