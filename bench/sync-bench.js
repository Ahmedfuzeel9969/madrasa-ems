// P5B — isolated harness for multi-device sync + offline CRUD browser verification
(function (global) {
    'use strict';

    var COL = 'registrations';
    var state = {
        tenantId: 'sync_bench_tenant',
        deviceLabel: 'device-a',
        cloud: { registrations: Object.create(null) }
    };

    function log(msg) {
        var el = document.getElementById('bench-log');
        if (el) el.textContent += msg + '\n';
        console.log('[sync-bench]', msg);
    }

    function scopedCol() {
        return state.tenantId + '__' + COL;
    }

    function getRepo() {
        return global.emsRepo;
    }

    function cloneRow(row) {
        var out = {};
        for (var k in row) {
            if (Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k];
        }
        return out;
    }

    function docRef(pathParts) {
        return {
            _path: pathParts.slice(),
            get: function () {
                var key = pathParts[pathParts.length - 1];
                var col = pathParts[pathParts.length - 2];
                if (col === 'Registrations' || col === 'Rejected') {
                    var hit = state.cloud.registrations[key];
                    return Promise.resolve({
                        exists: !!hit,
                        data: function () { return hit ? cloneRow(hit) : {}; }
                    });
                }
                return Promise.resolve({ exists: false, data: function () { return {}; } });
            },
            set: function (payload, opts) {
                global.__emsWriteLog.push({ op: 'set', path: pathParts.join('/'), t: Date.now() });
                if (pathParts[pathParts.length - 2] === 'Registrations') {
                    var id = String(pathParts[pathParts.length - 1]);
                    var merged = cloneRow(payload || {});
                    merged.id = merged.id || id;
                    state.cloud.registrations[id] = merged;
                }
                return Promise.resolve();
            },
            update: function (payload) {
                global.__emsWriteLog.push({ op: 'update', path: pathParts.join('/'), t: Date.now() });
                return this.set(payload, { merge: true });
            },
            delete: function () {
                global.__emsWriteLog.push({ op: 'delete', path: pathParts.join('/'), t: Date.now() });
                if (pathParts[pathParts.length - 2] === 'Registrations') {
                    delete state.cloud.registrations[String(pathParts[pathParts.length - 1])];
                }
                return Promise.resolve();
            },
            collection: function (name) {
                return collectionRef(pathParts.concat([name]));
            }
        };
    }

    function collectionRef(pathParts) {
        return {
            doc: function (id) {
                return docRef(pathParts.concat([String(id)]));
            },
            get: function () {
                return Promise.resolve({ exists: false, data: function () { return {}; } });
            }
        };
    }

    function installMockFirestore() {
        global.__emsWriteLog = [];
        global.__emsMockCloud = state.cloud;
        global.getDbOrNull = function () {
            return {
                collection: function (name) {
                    return collectionRef([String(name)]);
                },
                batch: function () {
                    var ops = [];
                    return {
                        set: function (ref, payload, opts) {
                            ops.push({ type: 'set', ref: ref, payload: payload, opts: opts });
                            return this;
                        },
                        delete: function (ref) {
                            ops.push({ type: 'delete', ref: ref });
                            return this;
                        },
                        commit: function () {
                            global.__emsWriteLog.push({ op: 'batchCommit', count: ops.length, t: Date.now() });
                            ops.forEach(function (op) {
                                if (!op.ref || !op.ref._path) return;
                                var path = op.ref._path;
                                if (op.type === 'delete' && path[path.length - 2] === 'Registrations') {
                                    delete state.cloud.registrations[String(path[path.length - 1])];
                                }
                                if (op.type === 'set' && path[path.length - 2] === 'Registrations') {
                                    var id = String(path[path.length - 1]);
                                    var merged = cloneRow(op.payload || {});
                                    merged.id = merged.id || id;
                                    state.cloud.registrations[id] = merged;
                                }
                            });
                            return Promise.resolve();
                        }
                    };
                }
            };
        };
        global.emsGetTenantId = function () { return state.tenantId; };
        global.emsMayPushToCloud = function (opts) {
            opts = opts || {};
            if (opts.force || opts.manual) return true;
            return !global.__emsBlockAutoFlush;
        };
        global.emsRequireTenantId = function () { return state.tenantId; };
        global.CURRENT_MADRASA_TENANT_ID = state.tenantId;
    }

    global.__emsSyncBenchReady = function (cfg) {
        cfg = cfg || {};
        state.tenantId = cfg.tenantId || state.tenantId;
        state.deviceLabel = cfg.deviceLabel || state.deviceLabel;
        state.cloud = { registrations: Object.create(null) };
        installMockFirestore();
        if (typeof global.emsEnsureDeviceId === 'function') global.emsEnsureDeviceId();
        var repo = getRepo();
        repo.useTenant(state.tenantId);
        if (typeof global.emsRegRepoReset === 'function') global.emsRegRepoReset();
        if (typeof global.emsRegRepoInit === 'function') global.emsRegRepoInit(state.tenantId);
        document.getElementById('bench-status').textContent = 'Ready — ' + state.deviceLabel;
        log('ready tenant=' + state.tenantId + ' device=' + state.deviceLabel);
        return Promise.resolve({ ok: true, tenantId: state.tenantId, device: state.deviceLabel });
    };

    global.__emsSyncBenchReset = function () {
        var deletes = [
            new Promise(function (resolve) {
                var req = indexedDB.deleteDatabase('ems_durable_v1');
                req.onsuccess = req.onerror = req.onblocked = function () { resolve(true); };
            }),
            new Promise(function (resolve) {
                var req = indexedDB.deleteDatabase('EMS_OfflineWriteDB');
                req.onsuccess = req.onerror = req.onblocked = function () { resolve(true); };
            })
        ];
        return Promise.all(deletes).then(function () {
            state.cloud = { registrations: Object.create(null) };
            installMockFirestore();
            var repo = getRepo();
            repo.useTenant(state.tenantId);
            if (typeof global.emsRegRepoReset === 'function') global.emsRegRepoReset();
            if (typeof global.emsRegRepoInit === 'function') global.emsRegRepoInit(state.tenantId);
            return repo.clear(COL);
        });
    };

    global.__emsSyncBenchExportCloud = function () {
        var rows = [];
        var map = state.cloud.registrations;
        for (var id in map) {
            if (Object.prototype.hasOwnProperty.call(map, id)) rows.push(cloneRow(map[id]));
        }
        return {
            tenantId: state.tenantId,
            deviceLabel: state.deviceLabel,
            registrations: rows,
            count: rows.length
        };
    };

    global.__emsSyncBenchImportCloud = function (snap) {
        snap = snap || {};
        state.cloud.registrations = Object.create(null);
        (snap.registrations || []).forEach(function (row) {
            if (row && row.id != null) state.cloud.registrations[String(row.id)] = cloneRow(row);
        });
        return { imported: Object.keys(state.cloud.registrations).length };
    };

    global.__emsSyncBenchPullToLocal = function () {
        var repo = getRepo();
        repo.useTenant(state.tenantId);
        var rows = [];
        var map = state.cloud.registrations;
        for (var id in map) {
            if (Object.prototype.hasOwnProperty.call(map, id)) rows.push(cloneRow(map[id]));
        }
        return repo.bulkPut(COL, rows).then(function (n) {
            return { pulled: n, cloudCount: rows.length, localCount: rows.length };
        });
    };

    global.__emsSyncBenchPushLocalToCloud = function () {
        var repo = getRepo();
        repo.useTenant(state.tenantId);
        return repo.page(COL, { offset: 0, limit: 100000 }).then(function (res) {
            var rows = res.rows || [];
            rows.forEach(function (row) {
                row.clientUpdatedAt = row.clientUpdatedAt || Date.now();
                state.cloud.registrations[String(row.id)] = cloneRow(row);
            });
            return { pushed: rows.length, cloudCount: Object.keys(state.cloud.registrations).length };
        });
    };

    global.__emsSyncBenchLocalCount = function () {
        var repo = getRepo();
        repo.useTenant(state.tenantId);
        return repo.count(COL);
    };

    global.__emsSyncBenchSeedLocal = function (rows) {
        var repo = getRepo();
        repo.useTenant(state.tenantId);
        return repo.bulkPut(COL, rows || []);
    };

})(typeof window !== 'undefined' ? window : globalThis);
