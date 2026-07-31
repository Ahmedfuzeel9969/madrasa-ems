// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Phase 4 P1 — multi-tab outbox flush deduplication', function () {
    test('concurrent flush from 2 tabs produces one cloud write', async function ({ browser }) {
        test.setTimeout(120000);
        var context = await browser.newContext();
        var pages = [];
        for (var i = 0; i < 2; i++) {
            var p = await context.newPage();
            await p.goto('/bench/idb-scale-bench.html');
            await p.addScriptTag({ path: require('path').join(__dirname, '../../ems-outbox-lock.js') });
            await p.addScriptTag({ path: require('path').join(__dirname, '../../ems-idb-engine.js') });
            await p.addScriptTag({ path: require('path').join(__dirname, '../../ems-offline-write.js') });
            await p.evaluate(function () {
                window.getDbOrNull = function () { return window.__emsMockDb || null; };
                window.emsGetTenantId = function () { return 'outbox_lock_test'; };
                window.emsMayPushToCloud = function () { return !window.__emsBlockAutoFlush; };
                window.__emsWriteLog = [];
                window.__emsMockDb = {
                    collection: function () {
                        return {
                            doc: function () {
                                return {
                                    collection: function () {
                                        return {
                                            doc: function () {
                                                return {
                                                    get: function () {
                                                        return Promise.resolve({ exists: false, data: function () { return {}; } });
                                                    },
                                                    set: function () {
                                                        window.__emsWriteLog.push({ op: 'set', t: Date.now() });
                                                        return Promise.resolve();
                                                    },
                                                    update: function () {
                                                        window.__emsWriteLog.push({ op: 'update', t: Date.now() });
                                                        return Promise.resolve();
                                                    }
                                                };
                                            }
                                        };
                                    },
                                    get: function () {
                                        return Promise.resolve({ exists: false, data: function () { return {}; } });
                                    },
                                    set: function () {
                                        window.__emsWriteLog.push({ op: 'docSet', t: Date.now() });
                                        return Promise.resolve();
                                    }
                                };
                            }
                        };
                    },
                    batch: function () {
                        return {
                            set: function () { return this; },
                            delete: function () { return this; },
                            commit: function () { return Promise.resolve(); }
                        };
                    }
                };
            });
            pages.push(p);
        }

        await pages[0].evaluate(function () {
            return new Promise(function (resolve) {
                var req = indexedDB.deleteDatabase('EMS_OfflineWriteDB');
                req.onsuccess = req.onerror = req.onblocked = function () { resolve(true); };
            });
        });

        await pages[0].evaluate(function () {
            window.__emsBlockAutoFlush = true;
            return window.emsOfflinePersistFeeRecord({ id: 'FEE-LOCK-1', amount: 500, studentId: 'STU-1' });
        });

        var pendingBefore = await pages[0].evaluate(function () {
            return window.emsPendingSyncCount();
        });
        expect(pendingBefore).toBe(1);

        await pages[0].evaluate(function () { window.__emsBlockAutoFlush = false; });
        await pages[1].evaluate(function () { window.__emsBlockAutoFlush = false; });

        var flushResults = await Promise.all(pages.map(function (p) {
            return p.evaluate(function () {
                window.__emsWriteLog = [];
                return window.emsOfflineFlushAll({ force: true }).then(function (r) {
                    return {
                        flushed: r.flushed,
                        writeLogLen: (window.__emsWriteLog || []).length,
                        reason: r.reason,
                        skipped: r.skipped
                    };
                });
            });
        }));

        var totalFlushed = flushResults.reduce(function (s, r) { return s + (r.flushed || 0); }, 0);
        var totalWrites = flushResults.reduce(function (s, r) { return s + (r.writeLogLen || 0); }, 0);
        var queueRemaining = await pages[0].evaluate(function () { return window.emsPendingSyncCount(); });

        expect(totalFlushed).toBe(1);
        expect(totalWrites).toBeLessThanOrEqual(1);
        expect(queueRemaining).toBe(0);

        for (var j = 0; j < pages.length; j++) await pages[j].close();
        await context.close();
    });
});
