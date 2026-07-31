// @ts-check
const { test, expect } = require('@playwright/test');
var sync = require('../helpers/sync-mock');

var TENANT = 'p5b_offline_crud_tenant';

test.describe('P5B — offline CRUD → reconnect flush', function () {
    test('create, update, delete offline then reconnect synchronizes without duplicates', async function ({ context, page }) {
        test.setTimeout(180000);
        await sync.loadSyncBenchStack(page);
        await sync.resetSyncBenchDb(page);
        await sync.installMockCloud(page, TENANT, 'offline-device');

        await page.evaluate(function () {
            window.__emsBlockAutoFlush = true;
        });

        await context.setOffline(true);

        var offlineOps = await page.evaluate(async function () {
            var results = [];
            results.push(await window.emsOfflinePersistRegistration({
                id: 'STD-O1', type: 'student', name: 'Offline One', timestamp: 1, clientUpdatedAt: 100
            }, { status: 'approved' }));
            results.push(await window.emsOfflinePersistRegistration({
                id: 'STD-O2', type: 'student', name: 'Offline Two', timestamp: 2, clientUpdatedAt: 200
            }, { status: 'approved' }));
            results.push(await window.emsOfflinePersistRegistration({
                id: 'STD-O1', type: 'student', name: 'Offline One Updated', timestamp: 3, clientUpdatedAt: 300
            }, { status: 'approved', currentEditingId: 'STD-O1' }));
            results.push(await window.emsOfflineDeleteRegistration('STD-O2', false));
            return {
                results: results,
                pending: await window.emsPendingSyncCount(),
                localCount: await window.__emsSyncBenchLocalCount()
            };
        });

        expect(offlineOps.localCount).toBe(1);
        expect(offlineOps.pending).toBeGreaterThan(0);

        await context.setOffline(false);

        var flush = await page.evaluate(function () {
            window.__emsWriteLog = [];
            return window.emsOfflineFlushAll({ force: true }).then(function (r) {
                return window.emsPendingSyncCount().then(function (pending) {
                    return {
                        flushed: r.flushed,
                        pending: pending,
                        writeLogLen: (window.__emsWriteLog || []).length,
                        cloudCount: window.__emsSyncBenchExportCloud().count
                    };
                });
            });
        });
        await page.evaluate(function () { window.__emsBlockAutoFlush = false; });

        expect(flush.pending).toBe(0);
        expect(flush.cloudCount).toBe(1);

        var cloud = await sync.exportCloudSnapshot(page);
        expect(cloud.count).toBe(1);
        expect(cloud.registrations[0].id).toBe('STD-O1');
        expect(cloud.registrations[0].name).toBe('Offline One Updated');
        expect(cloud.registrations.some(function (r) { return r.id === 'STD-O2'; })).toBe(false);

        var dupFlush = await page.evaluate(function () {
            window.__emsWriteLog = [];
            return window.emsOfflineFlushAll({ force: true }).then(function (r) {
                return window.emsPendingSyncCount().then(function (pending) {
                    return {
                        flushed: r.flushed,
                        writeLogLen: (window.__emsWriteLog || []).length,
                        pending: pending
                    };
                });
            });
        });
        expect(dupFlush.pending).toBe(0);
        expect(dupFlush.writeLogLen).toBe(0);
    });

    test('reconnect triggers auto-flush when queue was blocked offline', async function ({ context, page }) {
        test.setTimeout(120000);
        await sync.loadSyncBenchStack(page);
        await sync.resetSyncBenchDb(page);
        await sync.installMockCloud(page, TENANT, 'auto-flush-device');

        await context.setOffline(true);
        await page.evaluate(function () {
            window.__emsBlockAutoFlush = true;
            return window.emsOfflinePersistFeeRecord({ id: 'FEE-AF-1', amount: 100, studentId: 'STD-1' });
        });
        var pendingOffline = await page.evaluate(function () {
            return window.emsPendingSyncCount();
        });
        expect(pendingOffline).toBe(1);

        await context.setOffline(false);
        await page.evaluate(function () {
            window.__emsBlockAutoFlush = false;
            window.EMS_OFFLINE_ONLY = false;
            if (typeof window.dispatchEvent === 'function') {
                window.dispatchEvent(new Event('online'));
            }
            return window.emsOfflineFlushAll({ force: true });
        });

        var cloud = await page.evaluate(function () {
            return window.emsPendingSyncCount().then(function (pending) {
                return { pending: pending, writeLog: (window.__emsWriteLog || []).length };
            });
        });
        expect(cloud.pending).toBe(0);
    });
});
