/**
 * Parent-scoped data API — server filters linked student data + view permissions (Phase 3)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { assertMadrasaActive } = require('./tenant-kill-switch');

const VIEW_MAP = {
    attendance: 'attendance',
    results: 'results',
    fee: 'fee',
    announcements: 'announcements',
    progress: 'progress',
    complaints: 'complaints',
    leave: 'leave',
    teacher_notes: 'teacher_notes',
    training: 'training'
};

function normalizeEmail(email) {
    return (email || '').toLowerCase().trim();
}

function monthKey(d) {
    d = d || new Date();
    return d.toISOString().substring(0, 7);
}

var FIN_RECURRING_CATS = ['ماہانہ فیس', 'رہائش فیس', 'طعام فیس', 'کتابی فیس'];

function num(v) {
    return Number(v) || 0;
}

function finSetupGross(setup) {
    setup = setup || {};
    var gross = 0;
    Object.keys(setup.fees || {}).forEach(function (k) { gross += num(setup.fees[k]); });
    if (!gross && setup.netPayable != null) {
        gross = num(setup.netPayable) + num(setup.discount);
    }
    return gross;
}

function finSetupDiscount(setup) {
    return Math.max(0, num(setup && setup.discount));
}

function finSetupNetPayable(setup) {
    return Math.max(0, finSetupGross(setup) - finSetupDiscount(setup));
}

function finCategoryNetAmount(catAmount, setup) {
    catAmount = num(catAmount);
    if (catAmount <= 0) return 0;
    var gross = finSetupGross(setup);
    var discount = finSetupDiscount(setup);
    if (!discount || gross <= 0) return catAmount;
    return Math.max(0, Math.round(catAmount - discount * (catAmount / gross)));
}

function finGetMonthlyChargeFromSetup(setup) {
    setup = setup || {};
    var sum = 0;
    FIN_RECURRING_CATS.forEach(function (cat) {
        if (setup.fees && setup.fees[cat]) sum += num(setup.fees[cat]);
    });
    if (sum > 0) return finCategoryNetAmount(sum, setup);
    if (setup.netPayable != null) return num(setup.netPayable);
    return finSetupNetPayable(setup);
}

async function assertParentAccess(tenantId, studentId, uid) {
    const db = admin.firestore();
    await assertMadrasaActive(db, tenantId);
    const linkRef = db.collection('All_Madrasas').doc(tenantId).collection('Parent_Links').doc(uid);
    const linkSnap = await linkRef.get();
    if (!linkSnap.exists || linkSnap.data().status !== 'active') {
        throw new functions.https.HttpsError('permission-denied', 'والدین رسائی نہیں۔');
    }
    const studentIds = linkSnap.data().studentIds || [];
    if (studentIds.indexOf(studentId) < 0) {
        throw new functions.https.HttpsError('permission-denied', 'یہ طالبِ علم منسلک نہیں۔');
    }
    return linkSnap.data();
}

async function assertParentViewPermission(tenantId, studentId, viewId) {
    const db = admin.firestore();
    const permRef = db.collection('All_Madrasas').doc(tenantId)
        .collection('ParentPermissions').doc(studentId);
    const permSnap = await permRef.get();
    if (!permSnap.exists) {
        throw new functions.https.HttpsError('permission-denied', 'Parent permissions نہیں ملیں۔');
    }
    const perm = permSnap.data();
    if (perm.status && perm.status !== 'active') {
        throw new functions.https.HttpsError('permission-denied', 'والدین رسائی معطل ہے۔');
    }

    const now = Date.now();
    if (perm.views && perm.views[viewId] === true) {
        return perm;
    }
    const temp = perm.temporary && perm.temporary[viewId];
    if (temp && temp.expiryAt && temp.expiryAt > now) {
        return perm;
    }
    if (temp && temp.expiry && new Date(temp.expiry).getTime() > now) {
        return perm;
    }

    throw new functions.https.HttpsError('permission-denied', 'اس view کی اجازت نہیں: ' + viewId);
}

async function fetchAttendance(db, tenantId, studentId) {
    const mk = monthKey();
    const snap = await db.collection('All_Madrasas').doc(tenantId).collection('Attendance').get();
    const days = [];
    const summary = { present: 0, absent: 0, leave: 0, other: 0 };
    snap.forEach(function (doc) {
        if (!doc.id.startsWith('att_rec_' + mk)) return;
        const data = doc.data() || {};
        const rec = data.records && data.records[studentId];
        if (!rec) return;
        Object.keys(rec).forEach(function (dayNum) {
            const st = rec[dayNum];
            let label = st;
            if (st === 'P' || st === 'حاضر') { summary.present++; label = 'حاضر'; }
            else if (st === 'A' || st === 'غائب') { summary.absent++; label = 'غائب'; }
            else if (st === 'L' || st === 'رخصت') { summary.leave++; label = 'رخصت'; }
            else summary.other++;
            days.push({ day: dayNum, status: label });
        });
    });
    days.sort(function (a, b) { return parseInt(a.day, 10) - parseInt(b.day, 10); });
    return { days: days, summary: summary, month: mk, source: 'server' };
}

async function fetchExamResults(db, tenantId, studentId) {
    const snap = await db.collection('All_Madrasas').doc(tenantId).collection('ExamResults').get();
    const rows = [];
    snap.forEach(function (doc) {
        const d = doc.data() || {};
        if (d.studentId === studentId) rows.push(d);
    });
    rows.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    return rows.slice(0, 30);
}

async function fetchFeeSummary(db, tenantId, studentId) {
    const colSnap = await db.collection('All_Madrasas').doc(tenantId).collection('FeeCollections').get();
    const collections = [];
    colSnap.forEach(function (doc) {
        const d = doc.data() || {};
        if (d.studentId === studentId) collections.push(d);
    });
    collections.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });

    let setup = {};
    const setupSnap = await db.collection('All_Madrasas').doc(tenantId).collection('FeeSetups').doc(studentId).get();
    if (setupSnap.exists) setup = setupSnap.data() || {};

    const billSnap = await db.collection('All_Madrasas').doc(tenantId).collection('FeeBills').get();
    let totalBilled = 0;
    billSnap.forEach(function (doc) {
        const d = doc.data() || {};
        if (d.studentId === studentId) totalBilled += num(d.amount);
    });

    const dueFallback = finSetupNetPayable(setup);
    if (totalBilled === 0 && dueFallback > 0) totalBilled = dueFallback;

    const totalPaid = collections.reduce(function (s, c) {
        if (c.isVoid === true) return s;
        return s + num(c.amount);
    }, 0);
    const arrears = Math.max(0, totalBilled - totalPaid);
    const advanceBalance = Math.max(0, totalPaid - totalBilled);

    return {
        collections: collections.slice(0, 15),
        setup: setup,
        totalPaid: totalPaid,
        totalBilled: totalBilled,
        monthlyCharge: finGetMonthlyChargeFromSetup(setup),
        arrears: arrears,
        advanceBalance: advanceBalance,
        source: 'server_computed'
    };
}

async function fetchStudentProfile(db, tenantId, studentId) {
    const doc = await db.collection('All_Madrasas').doc(tenantId).collection('Registrations').doc(studentId).get();
    if (!doc.exists) {
        return { id: studentId, class: '', className: '', department: '', dept: '' };
    }
    const d = doc.data() || {};
    const cls = d.className || d.class || '';
    const dept = d.department || d.dept || '';
    return {
        id: studentId,
        class: cls,
        className: cls,
        department: dept,
        dept: dept
    };
}

function normalizeAnnouncementAudience(aud) {
    aud = String(aud || 'all').trim();
    if (aud === 'تمام مدرسہ' || aud === 'تمام مدرسہ (اساتذہ و طلبہ)') return 'all';
    var lower = aud.toLowerCase();
    if (lower === 'walidin' || lower === 'والدین' || lower === 'parent' || lower === 'parents') return 'parents';
    if (lower === 'طلبہ' || lower === 'students') return 'students';
    if (lower === 'staff' || lower === 'teachers') return lower;
    return lower;
}

function announcementVisibleToParent(a, studentId, profile) {
    if (!a || !studentId) return false;
    var status = a.status || 'published';
    if (status !== 'published') return false;
    const aud = normalizeAnnouncementAudience(a.audience);
    const meta = a.audienceMeta || {};
    profile = profile || {};

    if (aud === 'staff' || aud === 'teachers') return false;

    if (aud === 'all') return true;

    if (aud === 'parents') {
        if (a.studentId) return String(a.studentId) === String(studentId);
        return true;
    }

    if (aud === 'students') return true;

    if (aud === 'class') {
        const targetClass = meta.className || meta.class || '';
        const studentClass = profile.className || profile.class || '';
        return !!targetClass && targetClass === studentClass;
    }

    if (aud === 'dept') {
        const targetDept = meta.dept || meta.department || '';
        const studentDept = profile.department || profile.dept || '';
        return !!targetDept && targetDept === studentDept;
    }

    if (aud === 'individual') {
        const ids = meta.ids || [];
        if (!Array.isArray(ids)) return false;
        return ids.some(function (id) { return String(id) === String(studentId); });
    }

    if (a.studentId && String(a.studentId) === String(studentId)) return true;
    return false;
}

async function fetchAnnouncements(db, tenantId, studentId, parentUid) {
    const profile = await fetchStudentProfile(db, tenantId, studentId);
    const snap = await db.collection('All_Madrasas').doc(tenantId).collection('Announcements').get();
    const anns = [];
    snap.forEach(function (doc) {
        const a = doc.data() || {};
        if (!announcementVisibleToParent(a, studentId, profile)) return;
        const row = Object.assign({}, a, { id: a.id || doc.id });
        if ((row.kind === 'proposal' || row.kind === 'advice') && parentUid) {
            row.myVote = null;
        }
        anns.push(row);
    });
    if (parentUid) {
        await Promise.all(anns.map(async function (row) {
            if (row.kind !== 'proposal' && row.kind !== 'advice') return;
            const voteId = parentUid + '_' + studentId;
            const voteSnap = await db.collection('All_Madrasas').doc(tenantId)
                .collection('Announcements').doc(row.id)
                .collection('AnnouncementVotes').doc(voteId).get();
            if (voteSnap.exists) row.myVote = voteSnap.data().voteType || null;
        }));
    }
    anns.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    return anns.slice(0, 20);
}

async function fetchTeacherNotes(db, tenantId, studentId, parentUid) {
    const anns = await fetchAnnouncements(db, tenantId, studentId, parentUid);
    return anns.filter(function (a) {
        const cat = (a.category || '').toLowerCase();
        return cat.indexOf('note') >= 0 || cat.indexOf('نوٹ') >= 0;
    });
}

var CMP_STATUS_KEY_UR = {
    pending: 'نئی',
    in_progress: 'کارروائی جاری',
    resolved: 'حل شدہ',
    rejected: 'مسترد',
    needs_info: 'مزید معلومات درکار'
};

function cmpUrFromStatusKey(key) {
    return CMP_STATUS_KEY_UR[key] || 'نئی';
}

function complaintMatchesStudent(c, studentId) {
    if (!c || !studentId) return false;
    if (c.individualId === studentId) return true;
    if (c.studentId === studentId) return true;
    if (c.target && String(c.target).indexOf(studentId) >= 0) return true;
    return false;
}

/** Strip strictly confidential tickets; return parent-safe complaint DTOs only */
function sanitizeComplaintForParent(c) {
    if (!c || c.strictlyConfidential === true) return null;
    var history = Array.isArray(c.resolutionHistory) ? c.resolutionHistory.slice() : [];
    history.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    var latest = history[0] || null;
    var statusKey = c.statusKey || 'pending';
    var latestResolution = null;
    if (latest && (latest.remarks || latest.status_change)) {
        latestResolution = {
            date: latest.date || '',
            remarks: String(latest.remarks || '').trim(),
            statusLabel: latest.status_change ? cmpUrFromStatusKey(latest.status_change) : ''
        };
    }
    return {
        id: c.id || '',
        date: c.date || '',
        type: c.type || '',
        category: c.category || '',
        details: c.details || '',
        status: c.status || cmpUrFromStatusKey(statusKey),
        statusKey: statusKey,
        priority: c.priority || 'معمولی',
        latestResolution: latestResolution
    };
}

async function fetchStudentComplaints(db, tenantId, studentId) {
    const snap = await db.collection('All_Madrasas').doc(tenantId).collection('Complaints').get();
    const rows = [];
    snap.forEach(function (doc) {
        const c = doc.data() || {};
        if (!complaintMatchesStudent(c, studentId)) return;
        const safe = sanitizeComplaintForParent(c);
        if (safe) rows.push(safe);
    });
    rows.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    return rows.slice(0, 30);
}

var TAR_PRAYER_IDS = ['fajr', 'zuhr', 'asr', 'maghrib', 'isha'];
var TAR_PRAYER_SCORES = { jamaat: 100, individual: 80, late: 50, leave: 60, absent: 0 };

function tarCutoffDateIso(days) {
    var d = new Date();
    d.setDate(d.getDate() - (days || 30));
    return d.toISOString().slice(0, 10);
}

async function fetchTrainingCollection(db, tenantId, collectionName, studentId, cutoff) {
    const snap = await db.collection('All_Madrasas').doc(tenantId).collection(collectionName).get();
    const rows = [];
    snap.forEach(function (doc) {
        const d = doc.data() || {};
        if (d.personId !== studentId) return;
        if (d.date && d.date < cutoff) return;
        rows.push(d);
    });
    rows.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    return rows;
}

function tarSummarizePrayer(prayerRows) {
    var totals = { jamaat: 0, individual: 0, late: 0, leave: 0, absent: 0, total: 0 };
    var scoreSum = 0;
    prayerRows.forEach(function (p) {
        TAR_PRAYER_IDS.forEach(function (prId) {
            var st = (p.prayers && p.prayers[prId]) || 'absent';
            totals.total++;
            if (totals[st] != null) totals[st]++;
            else totals.absent++;
            scoreSum += TAR_PRAYER_SCORES[st] != null ? TAR_PRAYER_SCORES[st] : 0;
        });
    });
    return {
        totals: totals,
        compliancePct: totals.total ? Math.round(scoreSum / totals.total) : null,
        daysRecorded: prayerRows.length
    };
}

async function fetchTrainingForStudent(db, tenantId, studentId) {
    const cutoff = tarCutoffDateIso(30);
    const prayerRaw = await fetchTrainingCollection(db, tenantId, 'TrainingPrayer', studentId, cutoff);
    const ethicsRaw = await fetchTrainingCollection(db, tenantId, 'TrainingEthics', studentId, cutoff);
    const disciplineRaw = await fetchTrainingCollection(db, tenantId, 'TrainingDiscipline', studentId, cutoff);

    const prayerSummary = tarSummarizePrayer(prayerRaw);

    return {
        source: 'server',
        periodDays: 30,
        cutoffDate: cutoff,
        prayerSummary: prayerSummary,
        prayer: prayerRaw.slice(0, 15).map(function (p) {
            return { date: p.date, prayers: p.prayers || {} };
        }),
        ethics: ethicsRaw.slice(0, 15).map(function (e) {
            return {
                date: e.date,
                kind: e.kind || 'positive',
                category: e.category || '',
                note: e.note || ''
            };
        }),
        discipline: disciplineRaw.slice(0, 15).map(function (d) {
            return {
                date: d.date,
                type: d.type || '',
                detail: d.detail || '',
                outcome: d.outcome || ''
            };
        }),
        counts: {
            prayer: prayerRaw.length,
            ethics: ethicsRaw.length,
            discipline: disciplineRaw.length
        }
    };
}

/**
 * data = { tenantId, studentId, view: 'attendance'|'results'|'fee'|'announcements' }
 */
const getParentStudentData = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }

    const tenantId = String((data && data.tenantId) || '').trim();
    const studentId = String((data && data.studentId) || '').trim();
    const view = String((data && data.view) || 'attendance').trim();

    if (!tenantId || !studentId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور studentId درکار ہیں۔');
    }

    await assertParentAccess(tenantId, studentId, context.auth.uid);

    const viewPermId = VIEW_MAP[view] || view;
    await assertParentViewPermission(tenantId, studentId, viewPermId);

    const db = admin.firestore();

    if (view === 'attendance') return fetchAttendance(db, tenantId, studentId);
    if (view === 'results' || view === 'progress') return fetchExamResults(db, tenantId, studentId);
    if (view === 'fee') return fetchFeeSummary(db, tenantId, studentId);
    if (view === 'announcements') return fetchAnnouncements(db, tenantId, studentId, context.auth.uid);
    if (view === 'teacher_notes') return fetchTeacherNotes(db, tenantId, studentId, context.auth.uid);
    if (view === 'complaints') return fetchStudentComplaints(db, tenantId, studentId);
    if (view === 'training') return fetchTrainingForStudent(db, tenantId, studentId);

    throw new functions.https.HttpsError('invalid-argument', 'غلط view: ' + view);
});

/**
 * Pull linked student registration records only (for parent portal init)
 * data = { tenantId }
 */
const getParentLinkedStudents = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }

    const db = admin.firestore();
    await assertMadrasaActive(db, tenantId);
    const linkSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Parent_Links').doc(context.auth.uid).get();
    if (!linkSnap.exists || linkSnap.data().status !== 'active') {
        throw new functions.https.HttpsError('permission-denied', 'والدین رسائی نہیں۔');
    }

    const studentIds = linkSnap.data().studentIds || [];
    const students = [];
    for (let i = 0; i < studentIds.length; i++) {
        const sid = studentIds[i];
        const doc = await db.collection('All_Madrasas').doc(tenantId).collection('Registrations').doc(sid).get();
        if (doc.exists) students.push(doc.data());
    }
    return { students: students, studentIds: studentIds, link: linkSnap.data() };
});

/**
 * Parent vote on proposal / consultation announcements.
 * data = { tenantId, studentId, announcementId, voteType: 'agree'|'disagree' }
 */
const submitParentVote = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }

    const tenantId = String((data && data.tenantId) || '').trim();
    const studentId = String((data && data.studentId) || '').trim();
    const announcementId = String((data && data.announcementId) || '').trim();
    const voteType = String((data && data.voteType) || '').trim().toLowerCase() === 'disagree' ? 'disagree' : 'agree';

    if (!tenantId || !studentId || !announcementId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId، studentId اور announcementId درکار ہیں۔');
    }

    await assertParentAccess(tenantId, studentId, context.auth.uid);
    await assertParentViewPermission(tenantId, studentId, 'announcements');

    const db = admin.firestore();
    const annRef = db.collection('All_Madrasas').doc(tenantId).collection('Announcements').doc(announcementId);
    const voteRef = annRef.collection('AnnouncementVotes').doc(context.auth.uid + '_' + studentId);
    const annSnap = await annRef.get();

    if (!annSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'اعلان نہیں ملا۔');
    }

    const ann = annSnap.data() || {};
    const kind = ann.kind || '';
    if (kind !== 'proposal' && kind !== 'advice') {
        throw new functions.https.HttpsError('failed-precondition', 'صرف تجویز / مشورے پر رائے دی جا سکتی ہے۔');
    }
    if ((ann.status || 'published') !== 'published') {
        throw new functions.https.HttpsError('failed-precondition', 'یہ اعلان ابھی شائع نہیں ہوا۔');
    }

    const profile = await fetchStudentProfile(db, tenantId, studentId);
    if (!announcementVisibleToParent(ann, studentId, profile)) {
        throw new functions.https.HttpsError('permission-denied', 'آپ کو اس اعلان پر رائے دینے کی اجازت نہیں۔');
    }

    const voteTally = await db.runTransaction(async function (tx) {
        const annDoc = await tx.get(annRef);
        const prevVoteDoc = await tx.get(voteRef);
        const annData = annDoc.data() || {};
        const tally = annData.voteTally || { agree: 0, disagree: 0 };
        let agree = Number(tally.agree) || 0;
        let disagree = Number(tally.disagree) || 0;

        if (prevVoteDoc.exists) {
            const oldVote = prevVoteDoc.data().voteType;
            if (oldVote === 'agree') agree = Math.max(0, agree - 1);
            if (oldVote === 'disagree') disagree = Math.max(0, disagree - 1);
        }

        if (voteType === 'agree') agree += 1;
        else disagree += 1;

        const nextTally = { agree: agree, disagree: disagree };
        tx.set(voteRef, {
            parentUid: context.auth.uid,
            studentId: studentId,
            announcementId: announcementId,
            voteType: voteType,
            updatedAt: Date.now()
        }, { merge: true });
        tx.update(annRef, {
            voteTally: nextTally,
            updatedAt: Date.now()
        });
        return nextTally;
    });

    return { ok: true, voteType: voteType, voteTally: voteTally };
});

module.exports = {
    getParentStudentData,
    getParentLinkedStudents,
    assertParentViewPermission,
    announcementVisibleToParent,
    normalizeAnnouncementAudience,
    submitParentVote
};
