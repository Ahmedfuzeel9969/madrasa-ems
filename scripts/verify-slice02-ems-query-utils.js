'use strict';
/**
 * Slice #2 verification — Node API parity (wrapper vs canonical).
 */
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');

function keysOf(api) {
    return Object.keys(api || {}).sort();
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

const EXPECTED = [
    'normalizeRegistrationStatus',
    'isActiveRegistrationStatus',
    'filterActiveRegistrations',
    'matchFilter',
    'matchSearch',
    'applySort',
    'pageFromAll',
    'countFromAll',
    'canStreamTopK'
];

delete require.cache[require.resolve(path.join(root, 'ems-query-utils.js'))];
delete require.cache[require.resolve(path.join(root, 'src/shared/utils/ems-query-utils.js'))];

const viaWrapper = require(path.join(root, 'ems-query-utils.js'));
delete require.cache[require.resolve(path.join(root, 'src/shared/utils/ems-query-utils.js'))];
const viaCanonical = require(path.join(root, 'src/shared/utils/ems-query-utils.js'));

const report = { expectedExports: EXPECTED, wrapperKeys: keysOf(viaWrapper), canonicalKeys: keysOf(viaCanonical), checks: [] };

function check(name, fn) {
    try {
        fn();
        report.checks.push({ name: name, ok: true });
    } catch (e) {
        report.checks.push({ name: name, ok: false, error: e.message });
    }
}

check('export_key_parity', function () {
    assert(JSON.stringify(keysOf(viaWrapper)) === JSON.stringify(keysOf(viaCanonical)), 'key mismatch');
    EXPECTED.forEach(function (k) {
        assert(typeof viaWrapper[k] === 'function', 'wrapper missing ' + k);
        assert(typeof viaCanonical[k] === 'function', 'canonical missing ' + k);
    });
});

check('same_module_identity', function () {
    delete require.cache[require.resolve(path.join(root, 'ems-query-utils.js'))];
    delete require.cache[require.resolve(path.join(root, 'src/shared/utils/ems-query-utils.js'))];
    var w = require(path.join(root, 'ems-query-utils.js'));
    var c = require(path.join(root, 'src/shared/utils/ems-query-utils.js'));
    assert(w === c, 'wrapper must re-export same module.exports');
});

check('normalize_and_active', function () {
    assert(viaWrapper.normalizeRegistrationStatus(' Approved ') === 'approved', 'normalize');
    assert(viaWrapper.isActiveRegistrationStatus('approved') === true, 'active approved');
    assert(viaWrapper.isActiveRegistrationStatus('rejected') === false, 'inactive rejected');
    assert(viaWrapper.isActiveRegistrationStatus('') === true, 'empty legacy active');
});

check('filter_search_page', function () {
    var rows = [
        { name: 'Ali', status: 'approved', timestamp: 3 },
        { name: 'Sara', status: 'rejected', timestamp: 2 },
        { name: 'Omar', status: 'enrolled', timestamp: 1 }
    ];
    var active = viaWrapper.filterActiveRegistrations(rows);
    assert(active.length === 2, 'filter active count');
    var page = viaWrapper.pageFromAll(rows, {
        offset: 0,
        limit: 10,
        filter: { statusActive: true },
        sort: { field: 'timestamp', dir: 'desc' },
        search: { text: 'a' }
    });
    var pageC = viaCanonical.pageFromAll(rows, {
        offset: 0,
        limit: 10,
        filter: { statusActive: true },
        sort: { field: 'timestamp', dir: 'desc' },
        search: { text: 'a' }
    });
    assert(JSON.stringify(page) === JSON.stringify(pageC), 'pageFromAll parity');
    assert(viaWrapper.countFromAll(rows, { status: 'rejected' }, null) === 1, 'count');
});

check('wrapper_no_duplicate_impl', function () {
    var wrap = fs.readFileSync(path.join(root, 'ems-query-utils.js'), 'utf8');
    assert(wrap.indexOf('function pageFromAll') === -1, 'wrapper must not redefine pageFromAll');
    assert(wrap.indexOf('function matchFilter') === -1, 'wrapper must not redefine matchFilter');
    assert(wrap.indexOf('src/shared/utils/ems-query-utils.js') >= 0, 'must point at canonical');
});

var failed = report.checks.filter(function (c) { return !c.ok; });
report.passed = failed.length === 0;
report.failedCount = failed.length;
console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
