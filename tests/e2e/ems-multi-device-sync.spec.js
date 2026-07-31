// @ts-check
const { test, expect } = require('@playwright/test');
var sync = require('../helpers/sync-mock');

var TENANT = 'p5b_multi_device_tenant';

test.describe('P5B — multi-device / multi-profile sync simulation', function () {
    test.describe.configure({ mode: 'serial' });

    test('device A push → device B pull achieves parity; B add → A pull converges', async function ({ browser }) {
        test.setTimeout(180000);
        var ctxA = await browser.newContext();
        var ctxB = await browser.newContext();
        var pageA = await ctxA.newPage();
        var pageB = await ctxB.newPage();

        await sync.loadSyncBenchStack(pageA);
        await sync.loadSyncBenchStack(pageB);
        await sync.resetSyncBenchDb(pageA);
        await sync.resetSyncBenchDb(pageB);
        await sync.installMockCloud(pageA, TENANT, 'device-a');
        await sync.installMockCloud(pageB, TENANT, 'device-b');

        await pageA.evaluate(function () {
            return window.__emsSyncBenchSeedLocal([
                { id: 'STD-001', type: 'student', name: 'Alpha', timestamp: 100, clientUpdatedAt: 100 },
                { id: 'STD-002', type: 'student', name: 'Beta', timestamp: 200, clientUpdatedAt: 200 },
                { id: 'STD-003', type: 'teacher', name: 'Gamma', timestamp: 300, clientUpdatedAt: 300 }
            ]);
        });
        expect(await sync.localRegistrationCount(pageA)).toBe(3);

        var pushA = await sync.pushLocalRegistrationsToCloud(pageA);
        expect(pushA.pushed).toBe(3);
        var cloudSnap = await sync.exportCloudSnapshot(pageA);
        expect(cloudSnap.count).toBe(3);

        expect(await sync.localRegistrationCount(pageB)).toBe(0);
        await sync.importCloudSnapshot(pageB, cloudSnap);
        var pullB = await sync.pullCloudToLocal(pageB);
        expect(pullB.pulled).toBe(3);
        expect(await sync.localRegistrationCount(pageB)).toBe(3);

        await pageB.evaluate(function () {
            return window.__emsSyncBenchSeedLocal([
                { id: 'STD-004', type: 'student', name: 'Delta', timestamp: 400, clientUpdatedAt: 400 }
            ]).then(function () {
                return window.emsRepo.page('registrations', { offset: 0, limit: 100 });
            }).then(function (res) {
                return window.__emsSyncBenchPushLocalToCloud();
            });
        });
        var cloudB = await sync.exportCloudSnapshot(pageB);
        expect(cloudB.count).toBe(4);

        await sync.importCloudSnapshot(pageA, cloudB);
        await sync.pullCloudToLocal(pageA);
        expect(await sync.localRegistrationCount(pageA)).toBe(4);

        var idsA = await pageA.evaluate(function () {
            return window.emsRepo.page('registrations', { offset: 0, limit: 100 }).then(function (r) {
                return (r.rows || []).map(function (x) { return x.id; }).sort();
            });
        });
        expect(idsA).toEqual(['STD-001', 'STD-002', 'STD-003', 'STD-004']);

        await pageA.close();
        await pageB.close();
        await ctxA.close();
        await ctxB.close();
    });

    test('conflicting update — newer clientUpdatedAt wins after pull', async function ({ browser }) {
        test.setTimeout(120000);
        var ctxA = await browser.newContext();
        var ctxB = await browser.newContext();
        var pageA = await ctxA.newPage();
        var pageB = await ctxB.newPage();

        await sync.loadSyncBenchStack(pageA);
        await sync.loadSyncBenchStack(pageB);
        await sync.resetSyncBenchDb(pageA);
        await sync.resetSyncBenchDb(pageB);
        await sync.installMockCloud(pageA, TENANT, 'device-a');
        await sync.installMockCloud(pageB, TENANT, 'device-b');

        await pageA.evaluate(function () {
            return window.__emsSyncBenchSeedLocal([
                { id: 'STD-CONFLICT', type: 'student', name: 'Version A-old', timestamp: 1, clientUpdatedAt: 1000 }
            ]).then(function () { return window.__emsSyncBenchPushLocalToCloud(); });
        });
        var snap = await sync.exportCloudSnapshot(pageA);
        await sync.importCloudSnapshot(pageB, snap);
        await sync.pullCloudToLocal(pageB);

        await pageB.evaluate(function () {
            return window.__emsSyncBenchSeedLocal([
                { id: 'STD-CONFLICT', type: 'student', name: 'Version B-newer', timestamp: 2, clientUpdatedAt: 5000 }
            ]).then(function () { return window.__emsSyncBenchPushLocalToCloud(); });
        });
        var newerSnap = await sync.exportCloudSnapshot(pageB);
        await sync.importCloudSnapshot(pageA, newerSnap);
        await sync.pullCloudToLocal(pageA);

        var name = await pageA.evaluate(function () {
            return window.emsRepo.get('registrations', 'STD-CONFLICT').then(function (r) { return r && r.name; });
        });
        expect(name).toBe('Version B-newer');

        await pageA.close();
        await pageB.close();
        await ctxA.close();
        await ctxB.close();
    });
});
