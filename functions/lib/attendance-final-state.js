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

function isCanonicalRegisterDocId(docId, monthKey) {
    var id = String(docId || '');
    if (!isMonthlyRegisterDocId(id, monthKey) || id.indexOf('att_evt_') === 0) return false;
    return /_(students_.+|teachers_|staff_)_all$/.test(id);
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
    (docs || []).forEach(function (entry) {
        var id = String(entry && entry.id || '');
        var data = entry && entry.data || {};
        if (!isMonthlyRegisterDocId(id, monthKey) || id.indexOf('att_evt_') === 0) return;
        var typeMatch = id.match(/^att_rec_\d{4}-\d{2}_(students|teachers|staff)_/);
        var type = typeMatch && typeMatch[1];
        if (!type || includeTypes.indexOf(type) < 0) return;
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
    });
    return final;
}

module.exports = {
    statusBucket: statusBucket,
    isMonthlyRegisterDocId: isMonthlyRegisterDocId,
    isCanonicalRegisterDocId: isCanonicalRegisterDocId,
    buildFinalAttendanceState: buildFinalAttendanceState
};
