/**
 * ExaminationSummary + CurriculumSummary (E9-S1)
 * Trigger: ModuleData writes (Exams / Curriculum sync blobs)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const logger = require('./logger');

function num(v) {
    return Number(v) || 0;
}

function parseModulePayload(snap) {
    if (!snap || !snap.exists) return null;
    var d = snap.data() || {};
    var raw = d.data;
    if (raw == null) return null;
    if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch (e) { return null; }
    }
    return raw;
}

function parseModuleArray(snap) {
    var raw = parseModulePayload(snap);
    return Array.isArray(raw) ? raw : [];
}

function termDocId(examName) {
    return String(examName || 'general')
        .replace(/[\/\\.#$\[\]]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 120) || 'general';
}

function examinationSummaryRef(db, tenantId, termId) {
    return db.collection('All_Madrasas').doc(tenantId).collection('ExaminationSummary').doc(termId);
}

function curriculumSummaryRef(db, tenantId, yearKey) {
    return db.collection('All_Madrasas').doc(tenantId).collection('CurriculumSummary').doc(String(yearKey));
}

function moduleDataRef(db, tenantId, docId) {
    return db.collection('All_Madrasas').doc(tenantId).collection('ModuleData').doc(docId);
}

async function readModuleDoc(db, tenantId, docId) {
    var snap = await moduleDataRef(db, tenantId, docId).get();
    return snap.exists ? snap : null;
}

async function recomputeExaminationSummaries(db, tenantId, exams) {
    exams = exams || [];
    var byTerm = Object.create(null);
    exams.forEach(function (row) {
        if (!row) return;
        var term = row.examName || row.examType || 'general';
        if (!byTerm[term]) byTerm[term] = [];
        byTerm[term].push(row);
    });

    var overallTotal = 0;
    var overallPctSum = 0;
    var overallPass = 0;
    var termCount = 0;

    var terms = Object.keys(byTerm);
    for (var i = 0; i < terms.length; i++) {
        var term = terms[i];
        var rows = byTerm[term];
        var pctSum = 0;
        var pass = 0;
        var byClass = Object.create(null);
        var students = Object.create(null);

        rows.forEach(function (r) {
            var pct = num(r.percentage);
            pctSum += pct;
            if (pct >= 40) pass++;
            if (r.studentId) students[r.studentId] = true;
            var cls = r.class || r.className || 'نامعلوم';
            if (!byClass[cls]) byClass[cls] = { count: 0, pctSum: 0 };
            byClass[cls].count++;
            byClass[cls].pctSum += pct;
        });

        var avgPct = rows.length ? Math.round(pctSum / rows.length) : 0;
        overallTotal += rows.length;
        overallPctSum += pctSum;
        overallPass += pass;
        termCount++;

        await examinationSummaryRef(db, tenantId, termDocId(term)).set({
            version: 1,
            term: term,
            examName: term,
            totalResults: rows.length,
            uniqueStudents: Object.keys(students).length,
            avgPercentage: avgPct,
            passCount: pass,
            failCount: Math.max(0, rows.length - pass),
            byClass: byClass,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }

    await examinationSummaryRef(db, tenantId, '_overview').set({
        version: 1,
        totalResults: overallTotal,
        overallAvgPct: overallTotal ? Math.round(overallPctSum / overallTotal) : 0,
        passCount: overallPass,
        termCount: termCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
}

function parsePageExclusions(spec) {
    var set = Object.create(null);
    if (!spec || !String(spec).trim()) return set;
    String(spec).split(/[,،;]+/).forEach(function (part) {
        part = part.trim();
        if (!part) return;
        var rangeIdx = part.indexOf('-');
        if (rangeIdx > 0) {
            var a = parseInt(part.slice(0, rangeIdx), 10);
            var b = parseInt(part.slice(rangeIdx + 1), 10);
            if (!isNaN(a) && !isNaN(b)) {
                var lo = Math.min(a, b);
                var hi = Math.max(a, b);
                for (var pg = lo; pg <= hi; pg++) set[pg] = true;
            }
        } else {
            var n = parseInt(part, 10);
            if (!isNaN(n) && n > 0) set[n] = true;
        }
    });
    return set;
}

function getExcludedPageSet(plan) {
    var set = Object.create(null);
    var a = parsePageExclusions(plan && plan.excludedPages);
    var b = parsePageExclusions(plan && plan.excludedSections);
    Object.keys(a).forEach(function (k) { set[k] = true; });
    Object.keys(b).forEach(function (k) { set[k] = true; });
    return set;
}

function isPageExcluded(plan, pageNum) {
    pageNum = num(pageNum);
    if (pageNum < 1) return false;
    return !!getExcludedPageSet(plan)[pageNum];
}

function countExcludedPagesUpTo(plan, maxPage) {
    maxPage = num(maxPage);
    if (maxPage < 1) return 0;
    var set = getExcludedPageSet(plan);
    var n = 0;
    Object.keys(set).forEach(function (k) {
        if (num(k) <= maxPage) n++;
    });
    return n;
}

function positionToUnits(plan, page, line) {
    page = num(page);
    line = num(line);
    var lpp = num(plan.linesPerPage) || 15;
    if (plan.measureMode === 'pages') return page;
    if (plan.measureMode === 'both') return page * lpp + line;
    return (page - 1) * lpp + line;
}

function teachableUnitsBetween(plan, fromPage, fromLine, toPage, toLine) {
    fromPage = num(fromPage) || 1;
    fromLine = num(fromLine) || 1;
    toPage = num(toPage);
    toLine = num(toLine);
    if (!toPage || toPage < fromPage || (toPage === fromPage && toLine < fromLine)) return 0;

    var lpp = num(plan.linesPerPage) || 15;
    var mode = plan.measureMode || 'lines';
    var total = 0;

    if (mode === 'both') {
        var raw = Math.max(0, positionToUnits(plan, toPage, toLine) - positionToUnits(plan, fromPage, fromLine));
        for (var bp = fromPage; bp <= toPage; bp++) {
            if (isPageExcluded(plan, bp)) raw -= lpp;
        }
        return Math.max(0, raw);
    }

    for (var p = fromPage; p <= toPage; p++) {
        if (isPageExcluded(plan, p)) continue;
        var lineStart = (p === fromPage) ? fromLine : 1;
        var lineEnd = (p === toPage) ? toLine : lpp;
        if (lineEnd < lineStart) continue;
        if (mode === 'pages') total += 1;
        else total += (lineEnd - lineStart + 1);
    }
    return total;
}

function scopeUnits(plan, scope) {
    if (!scope) return 0;
    return teachableUnitsBetween(plan, scope.fromPage || 1, scope.fromLine || 1, scope.toPage, scope.toLine || 1);
}

function totalScopeUnits(plan) {
    var ann = plan.annual || {};
    if (ann.toPage) {
        return teachableUnitsBetween(plan, ann.fromPage || 1, ann.fromLine || 1, ann.toPage, ann.toLine || 1) || 1;
    }
    var lpp = num(plan.linesPerPage) || 15;
    var totalPages = num(plan.totalPages);
    var excludedCount = countExcludedPagesUpTo(plan, totalPages);
    var teachPages = num(plan.teachablePages) || Math.max(0, totalPages - excludedCount);
    if (num(plan.teachableLines) > 0) return num(plan.teachableLines);
    if (plan.measureMode === 'pages') return teachPages || 1;
    return (teachPages * lpp) || 1;
}

function annualScopeStart(plan) {
    var ann = plan.annual || {};
    return { page: ann.fromPage || 1, line: ann.fromLine || 1 };
}

function progressUnitsInScope(plan, page, line) {
    var start = annualScopeStart(plan);
    return teachableUnitsBetween(plan, start.page, start.line, page, line);
}

function hasMonthPacing(plan) {
    return (plan.months || []).some(function (m) { return m && num(m.toPage) > 0; });
}

function monthCumulativeTargets(plan) {
    var start = annualScopeStart(plan);
    var months = plan.months || [];
    var targets = [];
    var last = 0;
    for (var i = 0; i < 12; i++) {
        var m = months[i];
        if (m && num(m.toPage) > 0) {
            last = Math.max(last, teachableUnitsBetween(plan, start.page, start.line, m.toPage, m.toLine || 1));
        }
        targets.push(last);
    }
    return targets;
}

function expectedUnitsLinear(plan, dateStr, yearStart, yearEnd, total) {
    var startMs = new Date(yearStart).getTime();
    var endMs = new Date(yearEnd).getTime();
    var curMs = new Date(dateStr).getTime();
    var ratio = (curMs - startMs) / Math.max(1, endMs - startMs);
    return Math.round(total * Math.min(1, Math.max(0, ratio)));
}

function expectedUnitsByDate(plan, dateStr, settings) {
    dateStr = dateStr || new Date().toISOString().split('T')[0];
    var total = totalScopeUnits(plan);
    var yearStart = (settings && settings.yearStart) || (new Date().getFullYear() + '-07-01');
    var yearEnd = (settings && settings.yearEnd) || ((new Date().getFullYear() + 1) + '-06-30');
    if (dateStr < yearStart) return 0;
    if (dateStr > yearEnd) return total;
    if (!hasMonthPacing(plan)) {
        return expectedUnitsLinear(plan, dateStr, yearStart, yearEnd, total);
    }

    var startMs = new Date(yearStart).getTime();
    var endMs = new Date(yearEnd).getTime();
    var curMs = new Date(dateStr).getTime();
    var monthLen = (endMs - startMs) / 12;
    var monthIdx = Math.min(11, Math.max(0, Math.floor((curMs - startMs) / Math.max(1, monthLen))));
    var monthStartMs = startMs + monthIdx * monthLen;
    var monthEndMs = startMs + (monthIdx + 1) * monthLen;
    var targets = monthCumulativeTargets(plan);
    var prev = monthIdx > 0 ? targets[monthIdx - 1] : 0;
    var target = Math.min(total, Math.max(prev, targets[monthIdx] || total));

    if (curMs <= monthStartMs) return prev;
    if (curMs >= monthEndMs) return target;
    var ratio = (curMs - monthStartMs) / Math.max(1, monthEndMs - monthStartMs);
    return Math.round(prev + ratio * (target - prev));
}

function latestProgress(plan, daily) {
    var rows = daily.filter(function (d) { return d.bookId === plan.id || d.bookName === plan.bookName; });
    if (!rows.length) return { units: 0 };
    rows.sort(function (a, b) { return (b.date || '').localeCompare(a.date || '') || num(b.timestamp) - num(a.timestamp); });
    var last = rows[0];
    return { units: progressUnitsInScope(plan, last.page, last.line) };
}

function computeCurriculumStats(plans, daily, settings) {
    settings = settings || {};
    var yellowPct = num(settings.yellowPct) || 5;
    var redPct = num(settings.redPct) || 15;
    var today = new Date().toISOString().split('T')[0];
    var green = 0;
    var yellow = 0;
    var red = 0;
    var pctSum = 0;

    plans.forEach(function (plan) {
        var prog = latestProgress(plan, daily);
        var total = totalScopeUnits(plan);
        var pct = total ? Math.round((prog.units / total) * 100) : 0;
        var expected = expectedUnitsByDate(plan, today, settings);
        var expPct = total ? Math.round((expected / total) * 100) : 0;
        var gap = expPct - pct;
        if (gap > redPct) red++;
        else if (gap > yellowPct) yellow++;
        else green++;
        pctSum += pct;
    });

    var y = new Date().getFullYear();
    var academicYear = settings.academicYear || (y + '-' + (y + 1));

    return {
        version: 1,
        academicYear: academicYear,
        books: plans.length,
        green: green,
        yellow: yellow,
        red: red,
        avgPct: plans.length ? Math.round(pctSum / plans.length) : 0,
        dailyEntries: daily.length,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
}

async function recomputeCurriculumSummary(db, tenantId) {
    var plansSnap = await readModuleDoc(db, tenantId, 'Curriculum__ems_curriculum_plans');
    var dailySnap = await readModuleDoc(db, tenantId, 'Curriculum__ems_curriculum_daily');
    var settingsSnap = await readModuleDoc(db, tenantId, 'Curriculum__ems_curriculum_settings');

    var plans = parseModuleArray(plansSnap);
    var daily = parseModuleArray(dailySnap);
    var settings = parseModulePayload(settingsSnap) || {};

    var stats = computeCurriculumStats(plans, daily, settings);
    await curriculumSummaryRef(db, tenantId, stats.academicYear).set(stats, { merge: true });
    return stats;
}

async function recomputeAllExamCurriculumSummaries(db, tenantId) {
    var examsSnap = await readModuleDoc(db, tenantId, 'Exams__ems_full_exams');
    await recomputeExaminationSummaries(db, tenantId, parseModuleArray(examsSnap));
    await recomputeCurriculumSummary(db, tenantId);
}

function makeModuleDataSummaryHandler() {
    return functions.firestore
        .document('All_Madrasas/{tenantId}/ModuleData/{docId}')
        .onWrite(async function (change, context) {
            var docId = context.params.docId || '';
            var tenantId = context.params.tenantId;
            var db = admin.firestore();
            try {
                if (docId === 'Exams__ems_full_exams') {
                    await recomputeExaminationSummaries(db, tenantId, parseModuleArray(change.after));
                } else if (
                    docId === 'Curriculum__ems_curriculum_daily' ||
                    docId === 'Curriculum__ems_curriculum_plans' ||
                    docId === 'Curriculum__ems_curriculum_settings'
                ) {
                    await recomputeCurriculumSummary(db, tenantId);
                }
            } catch (err) {
                await logger.logError('onModuleDataSummaryWrite', err, { tenantId: tenantId, docId: docId });
            }
            return null;
        });
}

module.exports = {
    termDocId,
    recomputeExaminationSummaries,
    recomputeCurriculumSummary,
    recomputeAllExamCurriculumSummaries,
    onModuleDataSummaryWrite: makeModuleDataSummaryHandler()
};
