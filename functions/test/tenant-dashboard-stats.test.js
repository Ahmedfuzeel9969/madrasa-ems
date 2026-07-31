'use strict';
/** Unit tests for tenant-dashboard-stats pure helpers */
const assert = require('assert');

function userTypeCountsDelta(before, after) {
    var delta = { students: 0, teachers: 0, staff: 0 };
    function bump(type, n) {
        if (type === 'student') delta.students += n;
        else if (type === 'teacher') delta.teachers += n;
        else if (type === 'staff') delta.staff += n;
    }
    if (before && before.exists) bump(before.data().type, -1);
    if (after && after.exists) bump(after.data().type, 1);
    return delta;
}

var d1 = userTypeCountsDelta(
    { exists: false },
    { exists: true, data: function () { return { type: 'student' }; } }
);
assert.strictEqual(d1.students, 1);

var d2 = userTypeCountsDelta(
    { exists: true, data: function () { return { type: 'student' }; } },
    { exists: false }
);
assert.strictEqual(d2.students, -1);

var statsMod = require('../lib/tenant-dashboard-stats');
assert.strictEqual(statsMod.monthFromAttDocId('att_rec_2026-06_student_1A_p1'), '2026-06');
assert.strictEqual(statsMod.monthFromAttDocId('other_doc'), null);
assert.strictEqual(statsMod.defaultFinanceSummary('2026-06').monthKey, '2026-06');

console.log('tenant-dashboard-stats helpers OK');
