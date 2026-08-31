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

    test('an older in-flight attendance save cannot dequeue a newer edit', async function ({ browser }) {
        test.setTimeout(120000);
        var context = await browser.newContext();
        var page = await context.newPage();
        await page.goto('/bench/idb-scale-bench.html');
        await page.addScriptTag({ path: require('path').join(__dirname, '../../ems-outbox-lock.js') });
        await page.addScriptTag({ path: require('path').join(__dirname, '../../ems-idb-engine.js') });
        await page.addScriptTag({ path: require('path').join(__dirname, '../../ems-offline-write.js') });
        await page.addScriptTag({ path: require('path').join(__dirname, '../../ems-cloud-mutation.js') });

        await page.evaluate(function () {
            window.emsGetTenantId = function () { return 'attendance-race-tenant'; };
            window.emsMayPushToCloud = function () { return true; };
            window.__attWrites = [];
            window.__releaseFirstAttendanceWrite = null;
            var updateCount = 0;
            var ref = {
                get: function () {
                    return Promise.resolve({ exists: false, data: function () { return {}; } });
                },
                update: function (patch) {
                    updateCount++;
                    window.__attWrites.push(Object.assign({}, patch));
                    if (updateCount === 1) {
                        return new Promise(function (resolve) {
                            window.__releaseFirstAttendanceWrite = resolve;
                        });
                    }
                    return Promise.resolve();
                },
                set: function () { return Promise.resolve(); }
            };
            window.__emsMockDb = {
                collection: function () {
                    return {
                        doc: function () {
                            return {
                                collection: function () {
                                    return { doc: function () { return ref; } };
                                }
                            };
                        }
                    };
                }
            };
            window.getDbOrNull = function () { return window.__emsMockDb; };
        });

        await page.evaluate(function () {
            return new Promise(function (resolve) {
                var req = indexedDB.deleteDatabase('EMS_OfflineWriteDB');
                req.onsuccess = req.onerror = req.onblocked = function () { resolve(true); };
            });
        });

        await page.evaluate(function () {
            var docId = 'att_rec_2026-08_students_اولی_all';
            var localKey = 'att_rec_attendance-race-tenant_2026-08_students_اولی_all';
            window.__firstSave = window.emsOfflinePersistAttendance(docId, {
                timestamp: 100,
                records: { u1: { '1': 'ح' } }
            }, {
                localKey: localKey,
                tenantId: 'attendance-race-tenant',
                mutationAt: 100,
                patch: { 'records.u1.1': 'ح', timestamp: 100 }
            });
        });

        await expect.poll(function () {
            return page.evaluate(function () { return typeof window.__releaseFirstAttendanceWrite === 'function'; });
        }).toBe(true);

        await page.evaluate(function () {
            var docId = 'att_rec_2026-08_students_اولی_all';
            var localKey = 'att_rec_attendance-race-tenant_2026-08_students_اولی_all';
            window.__secondSave = window.emsOfflinePersistAttendance(docId, {
                timestamp: 101,
                records: { u1: { '1': 'ح', '2': 'غ' } }
            }, {
                localKey: localKey,
                tenantId: 'attendance-race-tenant',
                mutationAt: 101,
                patch: { 'records.u1.2': 'غ', timestamp: 101 }
            });
        });

        var queuedDuringFirst = await page.evaluate(function () {
            return window.emsOfflineListQueue().then(function (rows) {
                return rows.map(function (row) { return row.payload; });
            });
        });
        expect(queuedDuringFirst).toHaveLength(1);
        expect(queuedDuringFirst[0]['records.u1.1']).toBe('ح');
        expect(queuedDuringFirst[0]['records.u1.2']).toBe('غ');

        await page.evaluate(function () { window.__releaseFirstAttendanceWrite(); });
        var result = await page.evaluate(function () {
            return Promise.all([window.__firstSave, window.__secondSave]).then(function (saves) {
                return Promise.all([Promise.resolve(saves), window.emsOfflineListQueue()]);
            }).then(function (parts) {
                return { saves: parts[0], queue: parts[1], writes: window.__attWrites };
            });
        });

        expect(result.writes).toHaveLength(2);
        expect(result.writes[1]['records.u1.1']).toBe('ح');
        expect(result.writes[1]['records.u1.2']).toBe('غ');
        expect(result.queue).toHaveLength(0);
        expect(result.saves[0].synced).toBe(false);
        expect(result.saves[0].queued).toBe(true);
        expect(result.saves[1].synced).toBe(true);

        await page.close();
        await context.close();
    });
});
