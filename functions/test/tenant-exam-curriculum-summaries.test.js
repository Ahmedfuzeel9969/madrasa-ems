'use strict';
var assert = require('assert');
var mod = require('../lib/tenant-exam-curriculum-summaries');

assert.strictEqual(mod.termDocId('سالانہ امتحان'), mod.termDocId('سالانہ امتحان'));
assert.ok(mod.termDocId('Half/1 Test').indexOf('/') < 0);

console.log('tenant-exam-curriculum-summaries helpers OK');
