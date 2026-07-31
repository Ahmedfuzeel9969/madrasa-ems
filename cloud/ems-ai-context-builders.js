// ============================================================================
// EMS AI — Structured Context Pack builders (no raw dumps)
// Reuses 360 Report Engine data patterns from dashboard.js
// ============================================================================
(function (global) {
    'use strict';

    var SCP_VERSION = 1;

    function tenantId() {
        if (typeof global.emsRequireTenantId === 'function') {
            var t = global.emsRequireTenantId();
            if (t) return t;
        }
        return global.CURRENT_MADRASA_TENANT_ID || '';
    }

    function recordMatches(record, user, fields) {
        if (typeof global.emsRecordMatchesUserId === 'function') {
            return global.emsRecordMatchesUserId(record, user, fields);
        }
        return (fields || []).some(function (f) { return record[f] === user.id; });
    }

    function lookupFeeSetup(map, user) {
        if (!map || !user) return null;
        var canon = typeof global.emsResolveCanonicalUserId === 'function'
            ? global.emsResolveCanonicalUserId(user) : (user.id || '');
        if (canon && map[canon]) return map[canon];
        var aliases = typeof global.emsCollectUserIdAliases === 'function'
            ? global.emsCollectUserIdAliases(user) : [user.id];
        for (var i = 0; i < aliases.length; i++) {
            if (map[aliases[i]]) return map[aliases[i]];
        }
        return null;
    }

    function collectAttendance(user) {
        var aliases = typeof global.emsCollectUserIdAliases === 'function'
            ? global.emsCollectUserIdAliases(user) : [user.id];
        var aliasSet = Object.create(null);
        aliases.forEach(function (a) {
            aliasSet[String(a)] = true;
            aliasSet[String(a).toUpperCase()] = true;
        });
        var stats = { present: 0, absent: 0, leave: 0, total: 0, rate: 0 };
        var months = [];
        var now = new Date();
        for (var m = 0; m < 3; m++) {
            months.push(new Date(now.getFullYear(), now.getMonth() - m, 1).toISOString().substring(0, 7));
        }
        function classify(st) {
            if (st === 'P' || st === 'حاضر') return 'present';
            if (st === 'A' || st === 'غائب') return 'absent';
            if (st === 'L' || st === 'رخصت') return 'leave';
            return 'other';
        }
        function scanSheet(sheet) {
            if (!sheet || !sheet.records) return;
            Object.keys(sheet.records).forEach(function (uid) {
                if (!aliasSet[uid] && !aliasSet[String(uid).toUpperCase()]) return;
                var dayRec = sheet.records[uid];
                Object.keys(dayRec || {}).forEach(function (day) {
                    var b = classify(dayRec[day]);
                    if (b === 'present') stats.present++;
                    else if (b === 'absent') stats.absent++;
                    else if (b === 'leave') stats.leave++;
                    stats.total++;
                });
            });
        }
        months.forEach(function (month) {
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (!key || key.indexOf('att_rec_' + month) !== 0) continue;
                try { scanSheet(JSON.parse(localStorage.getItem(key))); } catch (e) { /* skip */ }
            }
        });
        if (stats.total > 0) stats.rate = Math.round((stats.present / stats.total) * 100);
        return stats;
    }

    function examTrend(stdRes) {
        return (stdRes || []).slice(-6).map(function (r) {
            return {
                examName: (r.examName || '—').substring(0, 40),
                percentage: Number(r.percentage) || 0,
                grade: r.grade || '',
                date: r.date || r.examDate || ''
            };
        });
    }

    function complaintSummary(stdCmp) {
        var severe = 0;
        var medium = 0;
        (stdCmp || []).slice(0, 8).forEach(function (c) {
            var d = c.details || '';
            if (/لڑائی|سنگین|مار/.test(d)) severe++;
            else if (/تاخیر|دیر|شور/.test(d)) medium++;
        });
        return {
            total: (stdCmp || []).length,
            severe: severe,
            medium: medium,
            recentSample: (stdCmp || []).slice(-3).map(function (c) {
                return { date: c.date || '', type: c.type || '', severityHint: c.details ? c.details.substring(0, 80) : '' };
            })
        };
    }

    global.emsAiBuildStudentContextPack = function (studentId) {
        return Promise.resolve().then(function () {
            var loadUser = typeof global.emsGetUserById === 'function'
                ? global.emsGetUserById(studentId)
                : Promise.resolve(null);
            return loadUser;
        }).then(function (user) {
            if (!user) throw new Error('student_not_found');
            var dbExams = typeof global.emsCacheGet === 'function'
                ? (global.emsCacheGet('ems_full_exams', null) || global.emsCacheGet('ems_exams_db', []))
                : [];
            if (!Array.isArray(dbExams)) dbExams = [];
            var feeCollections = typeof global.emsCacheGet === 'function'
                ? global.emsCacheGet('ems_fee_collections', []) : [];
            var feeSetups = typeof global.emsCacheGet === 'function'
                ? global.emsCacheGet('ems_student_fee_setup', {}) : {};
            var complaints = typeof global.emsCacheGet === 'function'
                ? global.emsCacheGet('ems_complaints_db', []) : [];

            var stdRes = dbExams.filter(function (e) {
                return recordMatches(e, user, ['studentId', 'id', 'regId', 'uid', 'docId']);
            });
            var stdCmp = (complaints || []).filter(function (c) {
                return recordMatches(c, user, ['individualId', 'studentId', 'id', 'regId', 'uid', 'docId']);
            });
            var matchedCollections = (feeCollections || []).filter(function (c) {
                return recordMatches(c, user, ['studentId', 'id', 'regId', 'uid', 'docId']);
            });
            var setup = lookupFeeSetup(feeSetups, user) || { netPayable: 0, discount: 0 };
            var att = collectAttendance(user);
            var totalPaid = matchedCollections.reduce(function (s, c) { return s + (Number(c.amount) || 0); }, 0);
            var netP = Number(setup.netPayable) || 0;
            var percentPaid = netP > 0 ? Math.round((totalPaid / netP) * 100) : 100;

            return {
                scpVersion: SCP_VERSION,
                intent: 'student_performance',
                generatedAt: new Date().toISOString(),
                tenantId: tenantId(),
                scope: { studentId: user.id, class: user.class || user.dept || '' },
                summary: {
                    profile: {
                        id: user.id,
                        name: user.name || '',
                        type: user.type || 'student',
                        class: user.class || user.dept || '',
                        phoneMasked: user.phone ? ('***' + String(user.phone).slice(-4)) : ''
                    },
                    attendance3mo: att,
                    finance: user.type === 'student' ? {
                        netPayable: netP,
                        totalPaid: totalPaid,
                        percentPaid: percentPaid,
                        outstanding: Math.max(0, netP - totalPaid)
                    } : null,
                    exams: {
                        count: stdRes.length,
                        trend: examTrend(stdRes),
                        latestPct: stdRes.length ? (Number(stdRes[stdRes.length - 1].percentage) || 0) : null
                    },
                    discipline: complaintSummary(stdCmp)
                }
            };
        });
    };

    global.emsAiBuildClassCompareContextPack = function (classA, classB) {
        var users = typeof global.emsGetUsersMerged === 'function' ? global.emsGetUsersMerged() : [];
        var dbExams = typeof global.emsCacheGet === 'function'
            ? (global.emsCacheGet('ems_full_exams', null) || global.emsCacheGet('ems_exams_db', []))
            : [];

        function classStats(cls) {
            var students = users.filter(function (u) {
                return u.type === 'student' && (u.class === cls || u.dept === cls);
            });
            var ids = Object.create(null);
            students.forEach(function (s) { ids[s.id] = true; });
            var examScores = [];
            (dbExams || []).forEach(function (e) {
                var sid = e.studentId || e.id;
                if (ids[sid]) examScores.push(Number(e.percentage) || 0);
            });
            var avg = examScores.length
                ? Math.round(examScores.reduce(function (a, b) { return a + b; }, 0) / examScores.length)
                : 0;
            var attRates = students.map(function (s) { return collectAttendance(s).rate; }).filter(function (r) { return r > 0; });
            var attAvg = attRates.length
                ? Math.round(attRates.reduce(function (a, b) { return a + b; }, 0) / attRates.length)
                : 0;
            return {
                className: cls,
                studentCount: students.length,
                avgExamPct: avg,
                avgAttendancePct: attAvg,
                sampleSizeExams: examScores.length
            };
        }

        return Promise.resolve({
            scpVersion: SCP_VERSION,
            intent: 'class_compare',
            generatedAt: new Date().toISOString(),
            tenantId: tenantId(),
            scope: { classA: classA, classB: classB },
            summary: {
                classA: classStats(classA),
                classB: classStats(classB)
            }
        });
    };

    global.emsAiBuildInstitutionContextPack = function () {
        var stats = typeof global.emsGetDashboardStats === 'function'
            ? global.emsGetDashboardStats() : null;
        var users = typeof global.emsGetUsersMerged === 'function' ? global.emsGetUsersMerged() : [];
        var students = users.filter(function (u) { return u.type === 'student'; }).length;
        var teachers = users.filter(function (u) { return u.type === 'teacher'; }).length;

        var summary = {
            headcounts: {
                students: (stats && stats.counts && stats.counts.students) || students,
                teachers: (stats && stats.counts && stats.counts.teachers) || teachers,
                staff: (stats && stats.counts && stats.counts.staff) || 0,
                announcements: (stats && stats.counts && stats.counts.announcements) || 0
            },
            finance: stats && stats.finance ? {
                totalIncome: stats.finance.totalIncome || 0,
                totalArrears: stats.finance.totalArrears || 0,
                ledgerExpenseToday: stats.finance.ledgerExpenseToday || 0
            } : null,
            attendanceToday: stats && stats.attendance ? {
                present: stats.attendance.todayPresent || 0,
                absent: stats.attendance.todayAbsent || 0
            } : null,
            source: stats && stats.version >= 2 ? 'DashboardStats' : 'local_repo_fallback'
        };

        return Promise.resolve({
            scpVersion: SCP_VERSION,
            intent: 'institution_kpi',
            generatedAt: new Date().toISOString(),
            tenantId: tenantId(),
            scope: { level: 'institution' },
            summary: summary
        });
    };
})(typeof window !== 'undefined' ? window : globalThis);
