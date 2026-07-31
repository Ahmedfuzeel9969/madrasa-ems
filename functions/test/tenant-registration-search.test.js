'use strict';
var assert = require('assert');
var mod = require('../lib/tenant-registration-search');

var doc = mod.buildIndexDoc({
    name: 'Ahmad Ali',
    id: 'STD-01',
    cnic: '3520212345671',
    phone: '03001234567',
    type: 'student',
    class: 'Hifz-A'
}, 'STD-01');

assert.strictEqual(doc.id, 'STD-01');
assert.ok(doc.searchText.indexOf('ahmad') >= 0);
assert.ok(doc.searchText.indexOf('35202') >= 0);

console.log('tenant-registration-search helpers OK');
