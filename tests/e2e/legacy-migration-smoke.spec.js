// @ts-check
// Phase A/B smoke — legacy localStorage blob → IDB mirror migration + pagination
const { test, expect } = require('@playwright/test');

var TENANT = 'test_tenant';
var LEGACY_KEY = 'ems_reg_full_v2_' + TENANT;
var RECORD_COUNT = 700;
var BATCH_SIZE = 500;

test.describe('Legacy blob migration & paginated IDB reads', function () {
    test('Check A–D: migrate 700 records, cleanup blob, paginate, no blob sync', async function ({ page }) {
        await page.goto('/scripts/smoke-legacy-migration.html');
        await page.waitForFunction(function () {
            return typeof window.emsRegRepoInit === 'function'
                && typeof window.emsRepo === 'object'
                && typeof window.emsGetUsersPage === 'function';
        }, null, { timeout: 30000 });

        var result = await page.evaluate(async function (cfg) {
            var TENANT = cfg.tenant;
            var LEGACY_KEY = cfg.legacyKey;
            var RECORD_COUNT = cfg.recordCount;
            var BATCH_SIZE = cfg.batchSize;

            function makeStudent(i) {
                return {
                    id: 'STD-' + String(i).padStart(4, '0'),
                    type: 'student',
                    name: 'طالب ' + i,
                    fname: 'ولی ' + i,
                    class: 'جماعت ' + ((i % 12) + 1),
                    phone: '0300' + String(1000000 + i),
                    cnic: String(3520000000000 + i),
                    timestamp: Date.now() - i * 1000
                };
            }

            var checks = {
                A: { pass: false, detail: '' },
                B: { pass: false, detail: '' },
                C: { pass: false, detail: '' },
                D: { pass: false, detail: '' }
            };

            // ---- Reset environment ------------------------------------------
            await new Promise(function (resolve) {
                var req = indexedDB.deleteDatabase('ems_durable_v1');
                req.onsuccess = req.onerror = req.onblocked = function () { resolve(); };
            });
            localStorage.clear();

            // Instrument bulk writes to count migration batches
            var bulkCalls = [];
            var blobWrites = [];
            var origBulk = window.emsRepo.bulkPut.bind(window.emsRepo);
            window.emsRepo.bulkPut = function (col, rows) {
                bulkCalls.push({ col: col, count: rows ? rows.length : 0 });
                return origBulk(col, rows);
            };
            var origCacheSet = window.emsCacheSet.bind(window);
            window.emsCacheSet = function (key, value, opts) {
                if (String(key).indexOf('ems_reg_full_v2_') === 0) {
                    blobWrites.push({ key: key, len: Array.isArray(value) ? value.length : 0 });
                }
                return origCacheSet(key, value, opts);
            };

            // ---- Step 1: Inject legacy blob (700 records) -------------------
            var legacyRows = [];
            for (var i = 1; i <= RECORD_COUNT; i++) legacyRows.push(makeStudent(i));
            localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyRows));

            // Confirm mirror empty before boot
            window.emsRepo.useTenant(TENANT);
            var mirrorBefore = await window.emsRepo.count('registrations');

            // ---- Step 2: Boot / migrate -------------------------------------
            if (typeof window.emsRegRepoReset === 'function') window.emsRegRepoReset();
            window.emsRegRepoInit(TENANT);
            await window.emsRegRepoMigrateLegacyBlob(TENANT);

            var mirrorAfter = await window.emsRepo.count('registrations');
            var migFlag = localStorage.getItem('ems_reg_mirror_migrated_v1_' + TENANT);

            // ---- Check A: Migration into IDB mirror in batches --------------
            checks.A.pass = mirrorBefore === 0
                && mirrorAfter === RECORD_COUNT
                && bulkCalls.length >= 2
                && bulkCalls.some(function (b) { return b.count === BATCH_SIZE; })
                && bulkCalls.reduce(function (s, b) { return s + b.count; }, 0) === RECORD_COUNT;
            checks.A.detail = 'mirrorBefore=' + mirrorBefore
                + ' mirrorAfter=' + mirrorAfter
                + ' bulkCalls=' + bulkCalls.length
                + ' batched=' + bulkCalls.map(function (b) { return b.count; }).join('+');

            // ---- Check B: Legacy blob deleted -------------------------------
            var rawLegacy = localStorage.getItem(LEGACY_KEY);
            var cacheLegacy = window.emsCacheGet(LEGACY_KEY, null);
            checks.B.pass = (rawLegacy === null || rawLegacy === '[]')
                && (!Array.isArray(cacheLegacy) || cacheLegacy.length === 0)
                && migFlag !== null;
            checks.B.detail = 'rawLegacy=' + (rawLegacy ? rawLegacy.length + 'b' : 'null')
                + ' cacheLen=' + (Array.isArray(cacheLegacy) ? cacheLegacy.length : 'null')
                + ' migFlag=' + !!migFlag;

            // ---- Check C: Pagination without full RAM load ------------------
            window.EMS_REPOSITORY_BOOT_COMPLETE = true;
            window.EMS_REPOSITORY_READY = true;
            var memBefore = window.emsRegRepoGetCount ? window.emsRegRepoGetCount() : -1;

            var pageRes = await window.emsGetUsersPage({ offset: 0, limit: 500, type: 'student' });
            var merged = window.emsGetUsersMerged({ limit: 500, type: 'student' });
            var memAfter = window.emsRegRepoGetCount ? window.emsRegRepoGetCount() : -1;

            checks.C.pass = pageRes.rows.length === 500
                && pageRes.total === RECORD_COUNT
                && merged.length <= 500
                && memAfter < RECORD_COUNT;
            checks.C.detail = 'pageRows=' + pageRes.rows.length
                + ' pageTotal=' + pageRes.total
                + ' mergedLen=' + merged.length
                + ' memBefore=' + memBefore
                + ' memAfter=' + memAfter;

            // ---- Check D: persistRepoBlobSync inactive ----------------------
            checks.D.pass = typeof window.persistRepoBlobSync === 'undefined'
                && blobWrites.length === 0;
            checks.D.detail = 'persistRepoBlobSync=' + typeof window.persistRepoBlobSync
                + ' blobWrites=' + blobWrites.length;

            return {
                checks: checks,
                allPass: checks.A.pass && checks.B.pass && checks.C.pass && checks.D.pass,
                bulkCalls: bulkCalls,
                mirrorAfter: mirrorAfter
            };
        }, { tenant: TENANT, legacyKey: LEGACY_KEY, recordCount: RECORD_COUNT, batchSize: BATCH_SIZE });

        console.log('\n=== Smoke Test Results ===');
        ['A', 'B', 'C', 'D'].forEach(function (k) {
            var c = result.checks[k];
            console.log('Check ' + k + ': ' + (c.pass ? 'PASS' : 'FAIL') + ' — ' + c.detail);
        });
        console.log('Bulk batches:', result.bulkCalls);
        console.log('Overall:', result.allPass ? 'ALL PASS' : 'FAILURES DETECTED');

        expect(result.checks.A.pass, 'Check A (Migration): ' + result.checks.A.detail).toBe(true);
        expect(result.checks.B.pass, 'Check B (Cleanup): ' + result.checks.B.detail).toBe(true);
        expect(result.checks.C.pass, 'Check C (Pagination/RAM): ' + result.checks.C.detail).toBe(true);
        expect(result.checks.D.pass, 'Check D (Durability): ' + result.checks.D.detail).toBe(true);
    });
});
