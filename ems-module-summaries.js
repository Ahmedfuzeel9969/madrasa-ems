// ============================================================================
// EMS Module Summaries — Finance, Attendance, Exam, Curriculum (E8/E9)
// ============================================================================
(function (global) {
    'use strict';

    var state = {
        active: false,
        unsubs: [],
        finance: Object.create(null),
        attendance: Object.create(null),
        examination: Object.create(null),
        curriculum: Object.create(null)
    };

    function getTenantId() {
        if (typeof global.emsGetTenantId === 'function') {
            var tid = global.emsGetTenantId();
            if (tid) return tid;
        }
        if (global.CURRENT_MADRASA_TENANT_ID) return global.CURRENT_MADRASA_TENANT_ID;
        try {
            var u = firebase.auth && firebase.auth().currentUser;
            return u ? u.uid : null;
        } catch (e) {
            return null;
        }
    }

    function getDb() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    function lastNMonths(n) {
        var arr = [];
        var now = new Date();
        for (var i = 0; i < n; i++) {
            var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            arr.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
        }
        return arr;
    }

    function notifyFinance(monthKey) {
        if (typeof global.emsOnFinanceSummaryUpdate === 'function') {
            global.emsOnFinanceSummaryUpdate(monthKey, state.finance[monthKey] || null);
        }
    }

    function notifyAttendance(monthKey) {
        if (typeof global.emsOnAttendanceSummaryUpdate === 'function') {
            global.emsOnAttendanceSummaryUpdate(monthKey, state.attendance[monthKey] || null);
        }
    }

    function notifyCurriculum(yearKey) {
        if (typeof global.emsOnCurriculumSummaryUpdate === 'function') {
            global.emsOnCurriculumSummaryUpdate(yearKey, state.curriculum[yearKey] || null);
        }
    }

    function notifyExamination() {
        if (typeof global.emsOnExaminationSummaryUpdate === 'function') {
            global.emsOnExaminationSummaryUpdate(state.examination._overview || null);
        }
    }

    global.emsGetExaminationOverview = function () {
        return state.examination._overview || null;
    };

    global.emsGetExaminationSummary = function (termId) {
        return state.examination[termId] || null;
    };

    global.emsGetExaminationSummaries = function () {
        var out = Object.create(null);
        Object.keys(state.examination).forEach(function (k) { out[k] = state.examination[k]; });
        return out;
    };

    global.emsGetCurriculumSummary = function (yearKey) {
        return state.curriculum[yearKey] || null;
    };

    global.emsGetCurriculumSummaries = function () {
        var out = Object.create(null);
        Object.keys(state.curriculum).forEach(function (k) { out[k] = state.curriculum[k]; });
        return out;
    };

    global.emsGetFinanceSummary = function (monthKey) {
        return state.finance[monthKey] || null;
    };

    global.emsGetFinanceSummaries = function () {
        var out = Object.create(null);
        Object.keys(state.finance).forEach(function (k) { out[k] = state.finance[k]; });
        return out;
    };

    global.emsGetAttendanceSummary = function (monthKey) {
        return state.attendance[monthKey] || null;
    };

    global.emsStartModuleSummariesListener = function () {
        if (state.active) return;
        var db = getDb();
        var tid = getTenantId();
        if (!db || !tid) return;

        state.active = true;
        lastNMonths(6).forEach(function (monthKey) {
            try {
                var finUnsub = db.collection('All_Madrasas').doc(tid)
                    .collection('FinanceSummary').doc('monthly_' + monthKey)
                    .onSnapshot(function (doc) {
                        if (doc.exists) state.finance[monthKey] = doc.data();
                        else delete state.finance[monthKey];
                        notifyFinance(monthKey);
                    }, function () { /* permission */ });
                var attUnsub = db.collection('All_Madrasas').doc(tid)
                    .collection('AttendanceSummary').doc(monthKey)
                    .onSnapshot(function (doc) {
                        if (doc.exists) state.attendance[monthKey] = doc.data();
                        else delete state.attendance[monthKey];
                        notifyAttendance(monthKey);
                    }, function () { /* permission */ });
                state.unsubs.push(finUnsub, attUnsub);
            } catch (e) { /* ignore */ }
        });

        try {
            var examUnsub = db.collection('All_Madrasas').doc(tid).collection('ExaminationSummary')
                .onSnapshot(function (snap) {
                    state.examination = Object.create(null);
                    snap.forEach(function (doc) {
                        state.examination[doc.id] = doc.data();
                    });
                    notifyExamination();
                }, function () { /* permission */ });
            var curUnsub = db.collection('All_Madrasas').doc(tid).collection('CurriculumSummary')
                .onSnapshot(function (snap) {
                    state.curriculum = Object.create(null);
                    snap.forEach(function (doc) {
                        state.curriculum[doc.id] = doc.data();
                    });
                    Object.keys(state.curriculum).forEach(notifyCurriculum);
                }, function () { /* permission */ });
            state.unsubs.push(examUnsub, curUnsub);
        } catch (e2) { /* ignore */ }
    };

    global.emsStopModuleSummariesListener = function () {
        state.unsubs.forEach(function (unsub) {
            try { unsub(); } catch (e) { /* ignore */ }
        });
        state.unsubs = [];
        state.active = false;
        state.finance = Object.create(null);
        state.attendance = Object.create(null);
        state.examination = Object.create(null);
        state.curriculum = Object.create(null);
    };
})(typeof window !== 'undefined' ? window : globalThis);
