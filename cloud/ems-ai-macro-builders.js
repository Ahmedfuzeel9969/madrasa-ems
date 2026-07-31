// ============================================================================
// EMS AI — Macro Structured Context Pack builders (department-level KPIs only)
// Phase 2: Deep Dive — no raw student rows or large arrays
// ============================================================================
(function (global) {
    'use strict';

    var SCP_VERSION = 1;
    var MAX_CLASS_BREAKDOWN = 12;

    var DATE_RANGE_LABELS = {
        '1m': 'آخری 1 ماہ',
        '3m': 'آخری 3 ماہ',
        all: 'تمام وقت'
    };

    function tenantId() {
        if (typeof global.emsRequireTenantId === 'function') {
            var t = global.emsRequireTenantId();
            if (t) return t;
        }
        return global.CURRENT_MADRASA_TENANT_ID || '';
    }

    function cacheGet(key, fb) {
        if (typeof global.emsCacheGet === 'function') {
            return global.emsCacheGet(key, fb);
        }
        try {
            return JSON.parse(localStorage.getItem(key) || (fb != null ? JSON.stringify(fb) : 'null'));
        } catch (e) {
            return fb;
        }
    }

    function dateRangeCutoff(rangeKey) {
        var now = new Date();
        if (rangeKey === '1m') {
            return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        }
        if (rangeKey === '3m') {
            return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
        }
        return null;
    }

    function inDateRange(dateStr, cutoff) {
        if (!cutoff) return true;
        if (!dateStr) return true;
        var d = new Date(dateStr);
        if (isNaN(d.getTime())) return true;
        return d >= cutoff;
    }

    function monthKeysFromCutoff(cutoff) {
        var keys = [];
        var now = new Date();
        var cursor = new Date(now.getFullYear(), now.getMonth(), 1);
        var limit = cutoff ? new Date(cutoff.getFullYear(), cutoff.getMonth(), 1) : null;
        for (var i = 0; i < 36; i++) {
            keys.push(cursor.toISOString().substring(0, 7));
            if (limit && cursor <= limit) break;
            cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
            if (!cutoff && i >= 11) break;
        }
        return keys;
    }

    function scopeStudents(departmentId, className) {
        var users = typeof global.emsGetUsersMerged === 'function' ? global.emsGetUsersMerged() : [];
        return users.filter(function (u) {
            if (!u || u.type !== 'student') return false;
            if (typeof global.emsRecordMatchesDepartment === 'function') {
                if (!global.emsRecordMatchesDepartment(u, departmentId)) return false;
            } else if (u.departmentId && u.departmentId !== departmentId) {
                return false;
            }
            if (className && className !== '__all__') {
                var cls = String(u.class || u.dept || '').trim();
                if (cls !== className) return false;
            }
            return true;
        });
    }

    function buildStudentIndex(students) {
        var aliasSet = Object.create(null);
        students.forEach(function (s) {
            var aliases = typeof global.emsCollectUserIdAliases === 'function'
                ? global.emsCollectUserIdAliases(s)
                : [s.id];
            aliases.forEach(function (a) {
                aliasSet[String(a)] = true;
                aliasSet[String(a).toUpperCase()] = true;
            });
        });
        return { aliasSet: aliasSet, count: students.length };
    }

    function recordMatchesStudent(record, aliasSet, fields) {
        fields = fields || ['studentId', 'id', 'regId', 'uid', 'docId'];
        for (var i = 0; i < fields.length; i++) {
            var val = record[fields[i]];
            if (val == null || val === '') continue;
            var key = String(val);
            if (aliasSet[key] || aliasSet[key.toUpperCase()]) return true;
        }
        return false;
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

    function classifyAttendance(st) {
        if (st === 'P' || st === 'حاضر') return 'present';
        if (st === 'A' || st === 'غائب') return 'absent';
        if (st === 'L' || st === 'رخصت') return 'leave';
        return 'other';
    }

    function aggregateAttendance(students, cutoff) {
        var index = buildStudentIndex(students);
        var stats = { present: 0, absent: 0, leave: 0, totalMarks: 0, ratePct: 0, studentsWithMarks: 0 };
        var perStudent = Object.create(null);
        var months = monthKeysFromCutoff(cutoff);

        function bump(uid, bucket) {
            if (!perStudent[uid]) perStudent[uid] = { present: 0, absent: 0, leave: 0, total: 0 };
            perStudent[uid][bucket]++;
            perStudent[uid].total++;
        }

        function scanSheet(sheet) {
            if (!sheet || !sheet.records) return;
            Object.keys(sheet.records).forEach(function (uid) {
                if (!index.aliasSet[uid] && !index.aliasSet[String(uid).toUpperCase()]) return;
                var dayRec = sheet.records[uid] || {};
                Object.keys(dayRec).forEach(function (day) {
                    var bucket = classifyAttendance(dayRec[day]);
                    if (bucket === 'present') {
                        stats.present++;
                        bump(uid, 'present');
                    } else if (bucket === 'absent') {
                        stats.absent++;
                        bump(uid, 'absent');
                    } else if (bucket === 'leave') {
                        stats.leave++;
                        bump(uid, 'leave');
                    }
                    stats.totalMarks++;
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

        var rateSum = 0;
        var rateCount = 0;
        Object.keys(perStudent).forEach(function (uid) {
            var row = perStudent[uid];
            if (row.total > 0) {
                rateSum += Math.round((row.present / row.total) * 100);
                rateCount++;
            }
        });
        stats.studentsWithMarks = rateCount;
        stats.ratePct = stats.totalMarks > 0 ? Math.round((stats.present / stats.totalMarks) * 100) : 0;
        stats.avgStudentRatePct = rateCount > 0 ? Math.round(rateSum / rateCount) : 0;
        return stats;
    }

    function aggregateFees(students, cutoff) {
        var collections = cacheGet('ems_fee_collections', []);
        var setups = cacheGet('ems_student_fee_setup', {});
        if (!Array.isArray(collections)) collections = [];

        var totalNet = 0;
        var totalPaid = 0;
        var studentsWithArrears = 0;
        var studentsWithSetup = 0;

        students.forEach(function (user) {
            var setup = lookupFeeSetup(setups, user) || { netPayable: 0, discount: 0 };
            var netP = Number(setup.netPayable) || 0;
            if (netP <= 0) return;
            studentsWithSetup++;

            var paid = 0;
            collections.forEach(function (c) {
                if (!recordMatchesStudent(c, buildStudentIndex([user]).aliasSet)) return;
                if (!inDateRange(c.date || c.collectionDate || c.createdAt, cutoff)) return;
                paid += Number(c.amount) || 0;
            });

            totalNet += netP;
            totalPaid += paid;
            if (paid < netP) studentsWithArrears++;
        });

        var arrears = Math.max(0, totalNet - totalPaid);
        return {
            totalNetPayable: Math.round(totalNet),
            totalCollected: Math.round(totalPaid),
            totalArrears: Math.round(arrears),
            collectionRatePct: totalNet > 0 ? Math.round((totalPaid / totalNet) * 100) : 0,
            studentsWithSetup: studentsWithSetup,
            studentsWithArrears: studentsWithArrears
        };
    }

    function aggregateExams(students, cutoff) {
        var dbExams = cacheGet('ems_full_exams', null) || cacheGet('ems_exams_db', []);
        if (!Array.isArray(dbExams)) dbExams = [];
        var index = buildStudentIndex(students);
        var scores = [];
        var gradeCounts = Object.create(null);
        var studentsSeen = Object.create(null);

        dbExams.forEach(function (e) {
            if (!recordMatchesStudent(e, index.aliasSet)) return;
            if (!inDateRange(e.date || e.examDate || e.createdAt, cutoff)) return;
            var pct = Number(e.percentage);
            if (!isNaN(pct)) scores.push(pct);
            var sid = e.studentId || e.id;
            if (sid) studentsSeen[String(sid)] = true;
            var grade = String(e.grade || '').trim();
            if (grade) gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;
        });

        var avg = scores.length
            ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length)
            : 0;
        var min = scores.length ? Math.min.apply(null, scores) : null;
        var max = scores.length ? Math.max.apply(null, scores) : null;

        return {
            examRecordsInScope: scores.length,
            studentsAssessed: Object.keys(studentsSeen).length,
            avgPercentage: avg,
            minPercentage: min,
            maxPercentage: max,
            gradeDistribution: gradeCounts
        };
    }

    function aggregateDiscipline(students, cutoff) {
        var complaints = cacheGet('ems_complaints_db', []);
        if (!Array.isArray(complaints)) complaints = [];
        var index = buildStudentIndex(students);
        var severe = 0;
        var medium = 0;
        var mild = 0;
        var typeCounts = Object.create(null);

        complaints.forEach(function (c) {
            if (!recordMatchesStudent(c, index.aliasSet, ['individualId', 'studentId', 'id', 'regId', 'uid', 'docId'])) {
                return;
            }
            if (!inDateRange(c.date || c.createdAt, cutoff)) return;
            var details = c.details || '';
            if (/لڑائی|سنگین|مار/.test(details)) severe++;
            else if (/تاخیر|دیر|شور/.test(details)) medium++;
            else mild++;
            var type = String(c.type || 'other').substring(0, 32);
            typeCounts[type] = (typeCounts[type] || 0) + 1;
        });

        return {
            totalComplaints: severe + medium + mild,
            severeCount: severe,
            mediumCount: medium,
            mildCount: mild,
            typeDistribution: typeCounts
        };
    }

    function classBreakdown(students, cutoff, domains) {
        var byClass = Object.create(null);
        students.forEach(function (s) {
            var cls = String(s.class || s.dept || '—').trim() || '—';
            if (!byClass[cls]) byClass[cls] = [];
            byClass[cls].push(s);
        });

        var rows = Object.keys(byClass).map(function (cls) {
            var subset = byClass[cls];
            var row = {
                className: cls,
                studentCount: subset.length
            };
            if (domains.attendance) {
                row.avgAttendancePct = aggregateAttendance(subset, cutoff).avgStudentRatePct;
            }
            if (domains.exams) {
                row.avgExamPct = aggregateExams(subset, cutoff).avgPercentage;
            }
            return row;
        });

        rows.sort(function (a, b) { return b.studentCount - a.studentCount; });
        return rows.slice(0, MAX_CLASS_BREAKDOWN);
    }

    function listClassesForDepartment(departmentId) {
        var seen = Object.create(null);
        scopeStudents(departmentId, null).forEach(function (s) {
            var cls = String(s.class || s.dept || '').trim();
            if (cls) seen[cls] = true;
        });
        return Object.keys(seen).sort();
    }

    global.emsAiListStudioClasses = function (departmentId) {
        return listClassesForDepartment(departmentId || (global.emsGetDepartmentId && global.emsGetDepartmentId()));
    };

    global.emsAiBuildMacroContextPack = function (opts) {
        opts = opts || {};
        var departmentId = opts.departmentId || (global.emsGetDepartmentId && global.emsGetDepartmentId()) || '';
        var className = opts.className || '__all__';
        var dateRange = opts.dateRange || '3m';
        var domains = Object.assign({
            attendance: true,
            fees: true,
            exams: true,
            discipline: true
        }, opts.domains || {});

        if (!departmentId) {
            return Promise.reject(new Error('department_required'));
        }

        var cutoff = dateRangeCutoff(dateRange);
        var students = scopeStudents(departmentId, className);
        var deptLabel = typeof global.emsGetDepartmentLabel === 'function'
            ? global.emsGetDepartmentLabel(departmentId)
            : departmentId;

        var summary = {
            scope: {
                departmentId: departmentId,
                departmentLabel: deptLabel,
                classFilter: className === '__all__' ? 'تمام کلاسیں' : className,
                dateRange: DATE_RANGE_LABELS[dateRange] || dateRange,
                studentCount: students.length,
                enabledDomains: Object.keys(domains).filter(function (k) { return domains[k]; })
            },
            headcounts: {
                studentsInScope: students.length,
                classesRepresented: listClassesForDepartment(departmentId).length
            }
        };

        if (domains.attendance) summary.attendance = aggregateAttendance(students, cutoff);
        if (domains.fees) summary.finance = aggregateFees(students, cutoff);
        if (domains.exams) summary.exams = aggregateExams(students, cutoff);
        if (domains.discipline) summary.discipline = aggregateDiscipline(students, cutoff);

        if (className === '__all__' && students.length > 0) {
            summary.classBreakdown = classBreakdown(students, cutoff, domains);
        }

        return Promise.resolve({
            scpVersion: SCP_VERSION,
            intent: 'institutional_deep_dive',
            generatedAt: new Date().toISOString(),
            tenantId: tenantId(),
            scope: {
                departmentId: departmentId,
                className: className,
                dateRange: dateRange,
                domains: domains
            },
            summary: summary
        });
    };
})(typeof window !== 'undefined' ? window : globalThis);
