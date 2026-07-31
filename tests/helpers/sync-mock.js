// @ts-check
const path = require('path');

var ROOT = path.resolve(__dirname, '../..');

async function loadSyncBenchStack(page) {
    await page.goto('/bench/sync-bench.html');
    await page.waitForFunction(function () {
        return typeof window.__emsSyncBenchReady === 'function'
            && typeof window.emsOfflineFlushAll === 'function'
            && typeof window.emsRepo === 'object';
    }, null, { timeout: 60000 });
}

async function installMockCloud(page, tenantId, deviceLabel) {
    await page.evaluate(function (cfg) {
        return window.__emsSyncBenchReady(cfg);
    }, { tenantId: tenantId, deviceLabel: deviceLabel || 'device-a' });
}

async function resetSyncBenchDb(page) {
    await page.evaluate(function () {
        return window.__emsSyncBenchReset();
    });
}

async function exportCloudSnapshot(page) {
    return page.evaluate(function () {
        return window.__emsSyncBenchExportCloud();
    });
}

async function importCloudSnapshot(page, snapshot) {
    await page.evaluate(function (snap) {
        window.__emsSyncBenchImportCloud(snap);
    }, snapshot);
}

async function pullCloudToLocal(page) {
    return page.evaluate(function () {
        return window.__emsSyncBenchPullToLocal();
    });
}

async function pushLocalRegistrationsToCloud(page) {
    return page.evaluate(function () {
        return window.__emsSyncBenchPushLocalToCloud();
    });
}

async function localRegistrationCount(page) {
    return page.evaluate(function () {
        return window.__emsSyncBenchLocalCount();
    });
}

module.exports = {
    ROOT: ROOT,
    loadSyncBenchStack: loadSyncBenchStack,
    installMockCloud: installMockCloud,
    resetSyncBenchDb: resetSyncBenchDb,
    exportCloudSnapshot: exportCloudSnapshot,
    importCloudSnapshot: importCloudSnapshot,
    pullCloudToLocal: pullCloudToLocal,
    pushLocalRegistrationsToCloud: pushLocalRegistrationsToCloud,
    localRegistrationCount: localRegistrationCount
};
