'use strict';
/**
 * Slice #1 verification — Node API parity (wrapper vs canonical).
 * Does not modify source. Exit 0 = pass.
 */
const path = require('path');
const root = path.resolve(__dirname, '..');

function keysOf(api) {
  return Object.keys(api || {}).sort();
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Fresh requires
delete require.cache[require.resolve(path.join(root, 'ems-utils.js'))];
delete require.cache[require.resolve(path.join(root, 'src/shared/utils/ems-utils.js'))];

const viaWrapper = require(path.join(root, 'ems-utils.js'));
delete require.cache[require.resolve(path.join(root, 'src/shared/utils/ems-utils.js'))];
const viaCanonical = require(path.join(root, 'src/shared/utils/ems-utils.js'));

const EXPECTED = [
  'sanitize',
  'escAttr',
  'saEmailDocKey',
  'resolvePullConflict',
  'simpleHash',
  'stampCloudVersion'
];

const report = {
  expectedExports: EXPECTED,
  wrapperKeys: keysOf(viaWrapper),
  canonicalKeys: keysOf(viaCanonical),
  checks: []
};

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

check('sanitize', function () {
  var s = '<a "b" & c>';
  assert(viaWrapper.sanitize(s) === viaCanonical.sanitize(s), 'sanitize differ');
  assert(viaWrapper.sanitize(s) === '&lt;a &quot;b&quot; &amp; c&gt;', 'sanitize value');
  assert(viaWrapper.sanitize(null) === '' && viaCanonical.sanitize(undefined) === '', 'nullish');
});

check('escAttr', function () {
  assert(viaWrapper.escAttr('<x>') === viaCanonical.escAttr('<x>'), 'escAttr');
  assert(viaWrapper.escAttr('<x>') === viaWrapper.sanitize('<x>'), 'escAttr===sanitize');
});

check('saEmailDocKey', function () {
  assert(viaWrapper.saEmailDocKey('Admin@Example.COM') === 'admin_example_com', 'email key');
  assert(viaWrapper.saEmailDocKey('') === '' && viaWrapper.saEmailDocKey(null) === '', 'empty');
});

check('simpleHash', function () {
  assert(viaWrapper.simpleHash('abc') === viaCanonical.simpleHash('abc'), 'hash');
  assert(typeof viaWrapper.simpleHash('abc') === 'string', 'hash type');
});

check('resolvePullConflict', function () {
  var cases = [
    [{}, '[]', 'remote', 1],
    [{}, '{"a":1}', '{"a":1}', 1],
    [{ dirty: false, localUpdatedAt: 10 }, '{"a":1}', '{"b":2}', 99],
    [{ dirty: true, localUpdatedAt: 10 }, '{"a":1}', '{"b":2}', 99],
    [{ dirty: true, localUpdatedAt: 100 }, '{"a":1}', '{"b":2}', 50]
  ];
  cases.forEach(function (c, i) {
    var w = viaWrapper.resolvePullConflict(c[0], c[1], c[2], c[3]);
    var k = viaCanonical.resolvePullConflict(c[0], c[1], c[2], c[3]);
    assert(JSON.stringify(w) === JSON.stringify(k), 'conflict case ' + i);
  });
});

check('stampCloudVersion', function () {
  assert(viaWrapper.stampCloudVersion(null) === null, 'null passthrough');
  var a = viaWrapper.stampCloudVersion({ _version: 2, x: 1 });
  assert(a._version === 3 && a.x === 1 && typeof a.clientUpdatedAt === 'number', 'stamp');
  var b = viaCanonical.stampCloudVersion({ _version: 2, x: 1 });
  assert(b._version === 3, 'canonical stamp');
});

check('same_function_identity_via_wrapper_require', function () {
  // Wrapper require returns the same module.exports object as canonical
  delete require.cache[require.resolve(path.join(root, 'ems-utils.js'))];
  delete require.cache[require.resolve(path.join(root, 'src/shared/utils/ems-utils.js'))];
  var w = require(path.join(root, 'ems-utils.js'));
  var c = require(path.join(root, 'src/shared/utils/ems-utils.js'));
  assert(w === c, 'wrapper should re-export same module.exports object');
  assert(w.sanitize === c.sanitize, 'same sanitize ref');
});

check('wrapper_has_no_duplicate_impl', function () {
  var fs = require('fs');
  var wrap = fs.readFileSync(path.join(root, 'ems-utils.js'), 'utf8');
  assert(wrap.indexOf('function sanitize') === -1, 'wrapper must not redefine sanitize');
  assert(wrap.indexOf('resolvePullConflict') === -1 || wrap.indexOf('canonical') >= 0, 'ok');
  assert(wrap.indexOf('stampCloudVersion') === -1, 'wrapper must not redefine stampCloudVersion');
  assert(wrap.indexOf('src/shared/utils/ems-utils.js') >= 0, 'wrapper must point at canonical');
});

check('globalThis_EmsUtils_after_canonical', function () {
  assert(globalThis.EmsUtils && typeof globalThis.EmsUtils.sanitize === 'function', 'EmsUtils global');
});

var failed = report.checks.filter(function (c) { return !c.ok; });
report.passed = failed.length === 0;
report.failedCount = failed.length;

console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
