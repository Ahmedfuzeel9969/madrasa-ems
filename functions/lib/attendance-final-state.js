'use strict';

function statusBucket(status) {
    if (status === 'P' || status === 'حاضر') return 'present';
    if (status === 'A' || status === 'غائب') return 'absent';
    if (status === 'L' || status === 'رخصت') return 'leave';
    return status == null || status === '' ? null : 'other';
}

function isMonthlyRegisterDocId(docId, monthKey) {
    return String(docId || '').indexOf('att_rec_' + String(monthKey || '') + '_') === 0;
}

function parseRegisterIdentity(docId, monthKey) {
    var id = String(docId || '');
    var head = 'att_rec_' + String(monthKey || '') + '_';
    if (id.indexOf(head) !== 0) return null;
    var segments = id.slice(head.length).split('_');
    var type = segments[0] || '';
    if (['students', 'teachers', 'staff'].indexOf(type) < 0) return null;
    if (segments.length === 1) return { type: type, classId: '', period: 'all' };
    if (segments.length === 2) return { type: type, classId: segments[1], period: 'all' };
    return {
        type: type,
        classId: segments.slice(1, -1).join('_'),
        period: segments[segments.length - 1] || 'all'
    };
}

function isCanonicalRegisterDocId(docId, monthKey) {
    var parsed = parseRegisterIdentity(docId, monthKey);
    if (!parsed || parsed.period !== 'all') return false;
    if (parsed.type === 'students') return !!parsed.classId;
    return !parsed.classId;
}

function registerGroup(identity) {
    if (!identity) return '';
    return identity.type === 'students'
        ? ('students|' + (identity.classId || ''))
        : (identity.type + '|');
}

function normalizeDottedAttendanceFields(data) {
    data = data || {};
    var out = Object.assign({}, data);
    ['records', 'remarks', 'late', 'periodRecords', 'dailyLocks', 'clearedCells'].forEach(function (field) {
        var source = data[field];
        if (source && typeof source === 'object' && !Array.isArray(source)) {
            try { out[field] = JSON.parse(JSON.stringify(source)); }
            catch (eClone) { out[field] = Object.assign({}, source); }
        }
    });
    Object.keys(data).forEach(function (literalPath) {
        if (!/^(records|remarks|late|periodRecords|dailyLocks|clearedCells)\./.test(literalPath)) return;
        var parts = literalPath.split('.');
        var cursor = out;
        for (var i = 0; i < parts.length - 1; i++) {
            if (!cursor[parts[i]] || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {};
            cursor = cursor[parts[i]];
        }
        var leaf = parts[parts.length - 1];
        // A proper nested value is newer/authoritative when both shapes exist.
        if (!Object.prototype.hasOwnProperty.call(cursor, leaf)) cursor[leaf] = data[literalPath];
    });
    return out;
}

function recordTimestamp(data) {
    data = data || {};
    var value = data.timestamp || data.clientUpdatedAt || data.updatedAt || 0;
    if (typeof value === 'number') return value;
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value === 'string') return Date.parse(value) || 0;
    return 0;
}

function docPriority(docId, monthKey) {
    return isCanonicalRegisterDocId(docId, monthKey) ? 2 : 1;
}

/**
 * Collapse canonical + retained legacy sheets into one deterministic person/day state.
 * Canonical wins over legacy; within the same kind the newer edit wins.
 */
function buildFinalAttendanceState(docs, monthKey, opts) {
    opts = opts || {};
    var includeTypes = opts.includeTypes || ['students'];
    var final = Object.create(null);
    var canonicalGroups = Object.create(null);
    (docs || []).forEach(function (entry) {
        var identity = parseRegisterIdentity(entry && entry.id, monthKey);
        if (!identity || includeTypes.indexOf(identity.type) < 0) return;
        if (isCanonicalRegisterDocId(entry.id, monthKey)
            && entry && entry.data && entry.data.canonicalComplete === true) {
            canonicalGroups[registerGroup(identity)] = true;
        }
    });
    (docs || []).forEach(function (entry) {
        var id = String(entry && entry.id || '');
        var data = normalizeDottedAttendanceFields(entry && entry.data || {});
        if (!isMonthlyRegisterDocId(id, monthKey) || id.indexOf('att_evt_') === 0) return;
        var identity = parseRegisterIdentity(id, monthKey);
        var type = identity && identity.type;
        if (!identity || includeTypes.indexOf(type) < 0) return;
        if (canonicalGroups[registerGroup(identity)] && !isCanonicalRegisterDocId(id, monthKey)) return;
        var priority = docPriority(id, monthKey);
        var timestamp = recordTimestamp(data);
        Object.keys(data.records || {}).forEach(function (personId) {
            Object.keys(data.records[personId] || {}).forEach(function (day) {
                var status = data.records[personId][day];
                if (status == null || status === '') return;
                var key = String(personId) + '|' + String(Number(day));
                var previous = final[key];
                if (!previous || priority > previous.priority
                    || (priority === previous.priority && timestamp >= previous.timestamp)) {
                    final[key] = {
                        personId: String(personId), day: String(Number(day)), status: status,
                        bucket: statusBucket(status), sourceDocId: id,
                        priority: priority, timestamp: timestamp
                    };
                }
            });
        });
        if (priority === 2) {
            var clearedDays = data.clearedCells && data.clearedCells.days;
            Object.keys(clearedDays || {}).forEach(function (personId) {
                Object.keys(clearedDays[personId] || {}).forEach(function (day) {
                    if (clearedDays[personId][day] !== true) return;
                    var ownDay = data.records && data.records[personId];
                    var ownValue = ownDay && (ownDay[day] != null ? ownDay[day] : ownDay[String(Number(day))]);
                    if (ownValue != null && ownValue !== '') return;
                    var key = String(personId) + '|' + String(Number(day));
                    var previous = final[key];
                    if (!previous || priority > previous.priority
                        || (priority === previous.priority && timestamp >= previous.timestamp)) {
                        final[key] = {
                            personId: String(personId), day: String(Number(day)), status: '',
                            bucket: null, sourceDocId: id, priority: priority,
                            timestamp: timestamp, cleared: true
                        };
                    }
                });
            });
        }
    });
    Object.keys(final).forEach(function (key) {
        if (final[key] && final[key].cleared) delete final[key];
    });
    return final;
}

module.exports = {
    statusBucket: statusBucket,
    isMonthlyRegisterDocId: isMonthlyRegisterDocId,
    parseRegisterIdentity: parseRegisterIdentity,
    isCanonicalRegisterDocId: isCanonicalRegisterDocId,
    normalizeDottedAttendanceFields: normalizeDottedAttendanceFields,
    buildFinalAttendanceState: buildFinalAttendanceState
};
