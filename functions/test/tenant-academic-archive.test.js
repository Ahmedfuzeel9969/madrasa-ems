'use strict';
var assert = require('assert');
var mod = require('../lib/tenant-academic-archive');

var months = mod.archiveMonthsForYear('2024-2025');
assert.ok(months.indexOf('2024-04') >= 0);
assert.ok(months.indexOf('2025-03') >= 0);
assert.strictEqual(mod.monthFromAttDocId('att_rec_2024-06_students_Hifz_all'), '2024-06');

console.log('tenant-academic-archive helpers OK');
