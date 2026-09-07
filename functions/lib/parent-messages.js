/**
 * Parent messaging API — server-validated threads (Phase 5)
 * Phase 1: leave-view permission + parentUid scoping on reads
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');

function normalizeText(str, maxLen) {
    return String(str || '').trim().slice(0, maxLen || 4000);
}

async function assertParentStudentLink(tenantId, studentId, uid) {
    const db = admin.firestore();
    const linkSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Parent_Links').doc(uid).get();
    if (!linkSnap.exists || linkSnap.data().status !== 'active') {
        throw new functions.https.HttpsError('permission-denied', 'والدین رسائی نہیں۔');
    }
    const studentIds = linkSnap.data().studentIds || [];
    if (studentIds.indexOf(studentId) < 0) {
        throw new functions.https.HttpsError('permission-denied', 'یہ طالبِ علم منسلک نہیں۔');
    }
    return linkSnap.data();
}

/** Local copy — avoid requiring heavy parent-data during functions analysis. */
async function assertParentLeaveView(tenantId, studentId) {
    const db = admin.firestore();
    const permSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('ParentPermissions').doc(studentId).get();
    if (!permSnap.exists) {
        throw new functions.https.HttpsError('permission-denied', 'Parent permissions نہیں ملیں۔');
    }
    const perm = permSnap.data() || {};
    if (perm.status && perm.status !== 'active') {
        throw new functions.https.HttpsError('permission-denied', 'والدین رسائی معطل ہے۔');
    }
    const viewId = 'leave';
    const now = Date.now();
    if (perm.views && perm.views[viewId] === true) return perm;
    const temp = perm.temporary && perm.temporary[viewId];
    if (temp && temp.expiryAt && temp.expiryAt > now) return perm;
    if (temp && temp.expiry && new Date(temp.expiry).getTime() > now) return perm;
    throw new functions.https.HttpsError('permission-denied', 'اس view کی اجازت نہیں: ' + viewId);
}

function messageVisibleToParent(msg, uid, studentIds) {
    if (!msg || !msg.studentId) return false;
    if (studentIds.indexOf(msg.studentId) < 0) return false;
    if (msg.direction === 'out') return true;
    return msg.parentUid === uid;
}

function filterMessagesForParent(messages, uid, studentIds) {
    return (messages || []).filter(function (msg) {
        return messageVisibleToParent(msg, uid, studentIds);
    });
}

async function assertStaffOrParentRead(tenantId, studentId, uid, email) {
    const db = admin.firestore();
    try {
        await assertParentStudentLink(tenantId, studentId, uid);
        await assertParentLeaveView(tenantId, studentId);
        return 'parent';
    } catch (e) {
        if (e.code !== 'permission-denied') throw e;
    }
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (madrasaSnap.exists && madrasaSnap.data().ownerUid === uid) return 'owner';
    const staffLink = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Staff_Links').doc(uid).get();
    if (staffLink.exists && staffLink.data().status === 'active') return 'staff';
    throw new functions.https.HttpsError('permission-denied', 'پیغامات دیکھنے کی اجازت نہیں۔');
}

function buildMessageId() {
    return 'MSG-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
}

/**
 * data = { tenantId, studentId, category, format, text, voice? }
 */
const submitParentMessage = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const studentId = String((data && data.studentId) || '').trim();
    const category = normalizeText(data && data.category, 64) || 'inquiry';
    const format = (data && data.format) === 'voice' ? 'voice' : 'text';
    const text = normalizeText(data && data.text, 4000);
    const voice = format === 'voice' ? String((data && data.voice) || '').slice(0, 500000) : '';

    if (!tenantId || !studentId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور studentId درکار ہیں۔');
    }
    if (format === 'text' && !text) {
        throw new functions.https.HttpsError('invalid-argument', 'پیغام خالی نہیں ہو سکتا۔');
    }
    if (format === 'voice' && !voice) {
        throw new functions.https.HttpsError('invalid-argument', 'صوتی پیغام درکار ہے۔');
    }

    await assertParentStudentLink(tenantId, studentId, context.auth.uid);
    await assertParentLeaveView(tenantId, studentId);

    const db = admin.firestore();
    let studentName = studentId;
    const regSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Registrations').doc(studentId).get();
    if (regSnap.exists) {
        studentName = regSnap.data().name || studentId;
    }

    const msg = {
        id: buildMessageId(),
        tenantId: tenantId,
        studentId: studentId,
        studentName: studentName,
        direction: 'in',
        category: category,
        format: format,
        text: text,
        voice: voice,
        by: 'والد (' + (context.auth.token.email || context.auth.uid) + ')',
        parentUid: context.auth.uid,
        at: new Date().toISOString(),
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('All_Madrasas').doc(tenantId)
        .collection('ParentMessages').doc(msg.id).set(msg);

    return { ok: true, message: msg };
});

/**
 * data = { tenantId, studentId?, limit? }
 */
const getParentMessages = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const studentId = String((data && data.studentId) || '').trim();
    const limit = Math.min(Math.max(parseInt(data && data.limit, 10) || 100, 1), 200);
    const uid = context.auth.uid;

    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }

    const db = admin.firestore();
    const col = db.collection('All_Madrasas').doc(tenantId).collection('ParentMessages');

    if (studentId) {
        const role = await assertStaffOrParentRead(tenantId, studentId, uid, context.auth.token.email);
        const snap = await col.where('studentId', '==', studentId).limit(limit).get();
        let messages = [];
        snap.forEach(function (doc) { messages.push(doc.data()); });
        if (role === 'parent') {
            messages = filterMessagesForParent(messages, uid, [studentId]);
        }
        messages.sort(function (a, b) { return (a.at || '').localeCompare(b.at || ''); });
        return { messages: messages, studentId: studentId };
    }

    const linkSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Parent_Links').doc(uid).get();
    if (!linkSnap.exists || linkSnap.data().status !== 'active') {
        throw new functions.https.HttpsError('permission-denied', 'والدین رسائی نہیں۔');
    }
    const studentIds = linkSnap.data().studentIds || [];
    const allowedIds = [];
    for (let i = 0; i < studentIds.length; i++) {
        try {
            await assertParentLeaveView(tenantId, studentIds[i]);
            allowedIds.push(studentIds[i]);
        } catch (e) {
            if (e.code !== 'permission-denied') throw e;
        }
    }
    const all = [];
    for (let j = 0; j < allowedIds.length; j++) {
        const sid = allowedIds[j];
        const snap = await col.where('studentId', '==', sid).limit(limit).get();
        snap.forEach(function (doc) { all.push(doc.data()); });
    }
    const scoped = filterMessagesForParent(all, uid, allowedIds);
    scoped.sort(function (a, b) { return (a.at || '').localeCompare(b.at || ''); });
    return { messages: scoped.slice(-limit), studentIds: allowedIds };
});

/**
 * Admin/staff: list threads summary
 * data = { tenantId, limit? }
 */
const listParentMessageThreads = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const limit = Math.min(Math.max(parseInt(data && data.limit, 10) || 200, 1), 500);
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }

    const db = admin.firestore();
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    const uid = context.auth.uid;
    const isOwner = madrasaSnap.exists && madrasaSnap.data().ownerUid === uid;
    const staffLink = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Staff_Links').doc(uid).get();
    const isStaff = staffLink.exists && staffLink.data().status === 'active';
    if (!isOwner && !isStaff) {
        throw new functions.https.HttpsError('permission-denied', 'عملہ رسائی نہیں۔');
    }

    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('ParentMessages').orderBy('createdAt', 'desc').limit(limit).get();
    const threads = {};
    snap.forEach(function (doc) {
        const m = doc.data();
        if (!m || !m.studentId) return;
        if (!threads[m.studentId]) {
            threads[m.studentId] = {
                studentId: m.studentId,
                studentName: m.studentName || m.studentId,
                last: m,
                count: 0,
                unread: 0
            };
        }
        const th = threads[m.studentId];
        th.count++;
        if ((m.at || '') >= (th.last.at || '')) th.last = m;
        if (m.direction === 'in' && !m.read) th.unread++;
    });
    return { threads: Object.keys(threads).map(function (k) { return threads[k]; }) };
});

/**
 * Mark messages read — read receipts (Phase 6)
 * data = { tenantId, studentId, role: 'staff'|'parent' }
 * staff → marks direction 'in' as read
 * parent → marks direction 'out' as read (readByParent)
 */
const markParentMessagesRead = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const studentId = String((data && data.studentId) || '').trim();
    const role = String((data && data.role) || '').trim();

    if (!tenantId || !studentId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور studentId درکار ہیں۔');
    }

    const db = admin.firestore();
    const col = db.collection('All_Madrasas').doc(tenantId).collection('ParentMessages');
    const now = Date.now();
    const reader = context.auth.token.email || context.auth.uid;
    let marked = 0;

    if (role === 'parent') {
        await assertParentStudentLink(tenantId, studentId, context.auth.uid);
        await assertParentLeaveView(tenantId, studentId);
        const snap = await col.where('studentId', '==', studentId).limit(200).get();
        const batch = db.batch();
        snap.forEach(function (doc) {
            const m = doc.data();
            if (m.direction === 'out' && !m.readByParent) {
                batch.update(doc.ref, {
                    readByParent: true,
                    readByParentAt: now,
                    readByParentUid: context.auth.uid
                });
                marked++;
            }
        });
        if (marked) await batch.commit();
        return { ok: true, marked: marked, role: 'parent' };
    }

    await assertStaffOrParentRead(tenantId, studentId, context.auth.uid, context.auth.token.email);
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    const isOwner = madrasaSnap.exists && madrasaSnap.data().ownerUid === context.auth.uid;
    const staffLink = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Staff_Links').doc(context.auth.uid).get();
    const isStaff = staffLink.exists && staffLink.data().status === 'active';
    if (!isOwner && !isStaff) {
        throw new functions.https.HttpsError('permission-denied', 'عملہ رسائی نہیں۔');
    }

    const snap = await col.where('studentId', '==', studentId).limit(200).get();
    const batch = db.batch();
    snap.forEach(function (doc) {
        const m = doc.data();
        if (m.direction === 'in' && !m.read) {
            batch.update(doc.ref, {
                read: true,
                readAt: now,
                readBy: reader
            });
            marked++;
        }
    });
    if (marked) await batch.commit();
    return { ok: true, marked: marked, role: 'staff' };
});

module.exports = {
    submitParentMessage,
    getParentMessages,
    listParentMessageThreads,
    markParentMessagesRead,
    filterMessagesForParent,
    messageVisibleToParent
};
