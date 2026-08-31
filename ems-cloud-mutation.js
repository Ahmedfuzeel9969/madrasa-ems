// ============================================================================
// EMS Cloud Mutation Bus — action-triggered doc-level push (Phase B)
// Local SSOT first; queue + single-row background flush via ems-offline-write.js
// ============================================================================
(function (global) {
    'use strict';

    if (global.__EMS_CLOUD_MUTATION_INIT) return;
    global.__EMS_CLOUD_MUTATION_INIT = true;

    var VALID_OPS = { create: true, update: true, delete: true, upsert: true };

    function normalizeOp(op) {
        op = String(op || 'update').toLowerCase();
        if (op === 'upsert') return 'update';
        if (!VALID_OPS[op] && op !== 'update') return 'update';
        return op;
    }

    function queueTypeForEnvelope(env) {
        var domain = String(env.domain || '').toLowerCase();
        var rawOp = String(env.op || 'update').toLowerCase();

        if (domain === 'registration') {
            if (rawOp === 'atomic' || (env.meta && env.meta.atomicMove)) {
                return 'registration_atomic';
            }
            var op = normalizeOp(env.op);
            return op === 'delete' ? 'registration_delete' : 'registration';
        }
        var op = normalizeOp(env.op);
        if (domain === 'attendance') return 'attendance';
        if (domain === 'attendance_patch') return 'attendance_patch';
        if (domain === 'fee' || domain === 'finance') return 'fee';
        if (domain === 'module_item') return 'module_item';
        if (domain === 'module_blob') return 'module_blob';
        if (domain === 'module_map') return 'module_map';
        return domain || 'mutation';
    }

    function envelopeToRow(env) {
        env = env || {};
        var docId = env.docId != null ? String(env.docId) : '';
        if (!docId) {
            return { ok: false, reason: 'no_docId' };
        }

        var domain = String(env.domain || '').toLowerCase();
        var rawOp = String(env.op || 'update').toLowerCase();
        var op = rawOp === 'atomic' ? 'atomic' : normalizeOp(env.op);
        var queueType = queueTypeForEnvelope(env);
        var tenantId = env.tenantId
            || global.CURRENT_MADRASA_TENANT_ID
            || global.EMS_ACTIVE_TENANT_ID
            || null;
        if (!tenantId) {
            return { ok: false, reason: 'no_tenant' };
        }

        var meta = Object.assign({}, env.meta || {});
        if (domain === 'registration') {
            if (meta.fromRejected == null && env.fromRejected != null) {
                meta.fromRejected = !!env.fromRejected;
            }
            if (meta.merge == null && env.merge != null) {
                meta.merge = !!env.merge;
            }
            if (env.status != null) {
                meta.fromRejected = env.status !== 'approved';
            }
            if (meta.collection == null) {
                meta.collection = meta.fromRejected ? 'Rejected' : 'Registrations';
            }
        }

        var payload = env.payload;
        if (payload == null && env.patch != null) {
            payload = env.patch;
        }
        if (payload == null && op !== 'delete' && env.doc) {
            payload = env.doc;
        }
        if (payload && typeof payload === 'object' && (domain === 'registration' || domain === 'attendance')) {
            var isRegistrationAtomic = domain === 'registration'
                && (rawOp === 'atomic' || (meta && meta.atomicMove));
            if (!isRegistrationAtomic && global.EmsUtils && typeof global.EmsUtils.stampCloudVersion === 'function') {
                payload = global.EmsUtils.stampCloudVersion(payload);
            }
        }

        return {
            ok: true,
            type: queueType,
            docId: docId,
            domain: domain,
            op: op,
            payload: payload,
            localKey: env.localKey || null,
            tenantId: tenantId,
            meta: meta
        };
    }

    function canPushNow(opts) {
        if (typeof global.emsOfflineCanMutationPush === 'function') {
            return global.emsOfflineCanMutationPush(opts);
        }
        if (global.EMS_OFFLINE_ONLY === true) return false;
        if (typeof global.emsMayPushToCloud === 'function') {
            return global.emsMayPushToCloud(Object.assign({ mutation: true }, opts || {}));
        }
        if (typeof global.emsIsNetworkAvailable === 'function') {
            return global.emsIsNetworkAvailable();
        }
        return !!(global.navigator && global.navigator.onLine);
    }

    function notifyRegistrationWrite(row) {
        if (row.type === 'registration_atomic') return;
        if (row.type !== 'registration' && row.type !== 'registration_delete') return;
        if (typeof global.emsRegRepoNotifyRemoteWrite !== 'function') return;
        try {
            global.emsRegRepoNotifyRemoteWrite({
                collection: (row.meta && row.meta.collection) || 'Registrations',
                id: row.docId,
                op: row.type === 'registration_delete' ? 'delete' : 'upsert',
                tenantId: row.tenantId
            });
        } catch (eNotify) { /* ignore */ }
    }

    /**
     * Emit a cloud mutation — enqueue by docId, flush single row when online.
     * @param {object} envelope
     * @returns {Promise<{ok:boolean,synced?:boolean,offline?:boolean,queued?:boolean,...}>}
     */
    global.emsCloudEmitMutation = function (envelope) {
        var row = envelopeToRow(envelope);
        if (!row.ok) return Promise.resolve(row);

        if (typeof global.emsOfflineQueueUpsert !== 'function') {
            return Promise.resolve({ ok: false, reason: 'queue_not_ready' });
        }

        var queueRow = {
            type: row.type,
            docId: row.docId,
            payload: row.payload,
            localKey: row.localKey,
            tenantId: row.tenantId,
            meta: row.meta
        };

        return global.emsOfflineQueueUpsert(row.type, row.docId, queueRow).then(function (storedRow) {
            // Queue upsert may have coalesced an older offline patch with this
            // edit. Flush that exact stored version, not the unmerged input.
            storedRow = storedRow || queueRow;
            if (!canPushNow({ mutation: true })) {
                var offlineRes = typeof global.emsNormalizeCloudResult === 'function'
                    ? global.emsNormalizeCloudResult({
                        synced: false, offline: true, queued: true, docId: row.docId
                    }, { localSaved: true, docId: row.docId, type: row.type })
                    : {
                        ok: true, queued: true, synced: false, offline: true,
                        localSaved: true, cloudState: 'offline',
                        docId: row.docId, type: row.type, domain: row.domain, op: row.op
                    };
                offlineRes.domain = row.domain;
                offlineRes.op = row.op;
                return offlineRes;
            }
            if (typeof global.emsOfflineFlushMutationRow !== 'function') {
                var queuedRes = typeof global.emsNormalizeCloudResult === 'function'
                    ? global.emsNormalizeCloudResult({
                        synced: false, queued: true, offline: true, docId: row.docId
                    }, { localSaved: true, docId: row.docId, type: row.type })
                    : {
                        ok: true, queued: true, synced: false, offline: true,
                        localSaved: true, cloudState: 'queued',
                        docId: row.docId, type: row.type
                    };
                queuedRes.domain = row.domain;
                queuedRes.op = row.op;
                return queuedRes;
            }
            return global.emsOfflineFlushMutationRow(storedRow).then(function (flushRes) {
                var synced = !!(flushRes && flushRes.synced);
                if (synced) {
                    notifyRegistrationWrite(row);
                } else if (flushRes && flushRes.error && typeof global.emsSyncFailureRefreshUi === 'function') {
                    global.emsSyncFailureRefreshUi({
                        error: flushRes.error,
                        code: flushRes.code,
                        docId: row.docId,
                        type: row.type
                    });
                }
                var out = typeof global.emsNormalizeCloudResult === 'function'
                    ? global.emsNormalizeCloudResult(flushRes, {
                        localSaved: true, docId: row.docId, type: row.type
                    })
                    : {
                        ok: true,
                        queued: !synced,
                        synced: synced,
                        offline: !synced,
                        error: flushRes && flushRes.error,
                        code: flushRes && flushRes.code,
                        docId: row.docId,
                        type: row.type
                    };
                out.domain = row.domain;
                out.op = row.op;
                out.docId = row.docId;
                out.type = row.type;
                return out;
            });
        }).catch(function (err) {
            console.warn('[EMS] cloud mutation failed', row.docId, err);
            return {
                ok: false,
                docId: row.docId,
                type: row.type,
                error: err && err.message ? err.message : String(err)
            };
        });
    };

    /** Retry all pending mutations (online recovery / admin). */
    global.emsCloudFlushPendingMutations = function () {
        if (typeof global.emsOfflineFlushAll === 'function') {
            return global.emsOfflineFlushAll({ manual: true });
        }
        return Promise.resolve({ ok: false, reason: 'flush_not_available' });
    };

    global.emsCloudMutationQueueTypeFor = queueTypeForEnvelope;

    var CURRICULUM_MODULE_DATA_KEYS = {
        'ems_curriculum_plans': true,
        'ems_curriculum_daily': true,
        'ems_curriculum_settings': true,
        'ems_curriculum_audit': true
    };

    function resolveModuleBlobTarget(moduleKey, cfg) {
        moduleKey = String(moduleKey || '');
        if (cfg && cfg.type === 'module_data_blob') {
            return {
                collection: 'ModuleData',
                blobDocId: (cfg.module || 'Curriculum') + '__' + moduleKey,
                moduleKey: moduleKey,
                moduleName: cfg.module || 'Curriculum',
                storage: 'module_data_blob'
            };
        }
        return {
            collection: cfg && cfg.collection,
            blobDocId: (cfg && cfg.docId) || moduleKey,
            moduleKey: moduleKey,
            moduleName: cfg && cfg.group,
            storage: cfg && cfg.type
        };
    }

    function isCurriculumModuleDataKey(moduleKey) {
        return !!CURRICULUM_MODULE_DATA_KEYS[String(moduleKey || '')];
    }

    /**
     * Push one array/map item to Firestore (EmsDirect collections).
     */
    global.emsCloudEmitModuleItem = function (moduleKey, op, item, itemId, meta) {
        moduleKey = String(moduleKey || '');
        itemId = itemId != null ? String(itemId) : '';
        op = normalizeOp(op || 'update');
        if (!moduleKey || !itemId) {
            return Promise.resolve({ ok: false, reason: 'invalid_module_item' });
        }
        var cfg = (global.EmsDirect && typeof global.EmsDirect.getKeyConfig === 'function')
            ? global.EmsDirect.getKeyConfig(moduleKey) : null;
        if (isCurriculumModuleDataKey(moduleKey)) {
            var localStr = null;
            if (typeof global.emsCacheGetRaw === 'function') {
                localStr = global.emsCacheGetRaw(moduleKey);
            } else if (typeof global.emsSafeLocalGet === 'function') {
                localStr = global.emsSafeLocalGet(moduleKey);
            } else {
                try { localStr = localStorage.getItem(moduleKey); } catch (eGet) { localStr = null; }
            }
            if (localStr == null) {
                return Promise.resolve({ ok: false, reason: 'curriculum_blob_missing' });
            }
            return global.emsCloudEmitModuleBlob(moduleKey, localStr, meta);
        }
        return global.emsCloudEmitMutation({
            domain: 'module_item',
            op: op === 'delete' ? 'delete' : 'update',
            docId: itemId,
            payload: op === 'delete' ? null : item,
            localKey: moduleKey,
            meta: Object.assign({
                moduleKey: moduleKey,
                collection: cfg && cfg.collection,
                directType: cfg && cfg.type,
                idField: cfg && cfg.idField,
        op: op === 'delete' ? 'delete' : 'update'
            }, meta || {})
        });
    };

    /** Push full config blob (settings, exam_types, etc.). */
    global.emsCloudEmitModuleBlob = function (moduleKey, jsonStr, meta) {
        moduleKey = String(moduleKey || '');
        if (!moduleKey) return Promise.resolve({ ok: false, reason: 'invalid_blob_key' });
        var cfg = (global.EmsDirect && typeof global.EmsDirect.getKeyConfig === 'function')
            ? global.EmsDirect.getKeyConfig(moduleKey) : null;
        var target = resolveModuleBlobTarget(moduleKey, cfg);
        var str = typeof jsonStr === 'string' ? jsonStr : JSON.stringify(jsonStr);
        return global.emsCloudEmitMutation({
            domain: 'module_blob',
            op: 'update',
            docId: target.blobDocId,
            payload: str,
            localKey: moduleKey,
            meta: Object.assign({
                moduleKey: moduleKey,
                collection: target.collection,
                blobDocId: target.blobDocId,
                moduleName: target.moduleName,
                directType: target.storage || 'blob'
            }, meta || {})
        });
    };

    /** Push one map entry doc. */
    global.emsCloudEmitModuleMapItem = function (moduleKey, mapKey, value, op, meta) {
        moduleKey = String(moduleKey || '');
        mapKey = mapKey != null ? String(mapKey) : '';
        if (!moduleKey || !mapKey) {
            return Promise.resolve({ ok: false, reason: 'invalid_map_item' });
        }
        var cfg = (global.EmsDirect && typeof global.EmsDirect.getKeyConfig === 'function')
            ? global.EmsDirect.getKeyConfig(moduleKey) : null;
        return global.emsCloudEmitMutation({
            domain: 'module_map',
            op: normalizeOp(op || 'update'),
            docId: mapKey,
            payload: op === 'delete' ? null : value,
            localKey: moduleKey,
            meta: Object.assign({
                moduleKey: moduleKey,
                collection: cfg && cfg.collection,
                mapKey: mapKey,
                op: op || 'update'
            }, meta || {})
        });
    };

    /** Field-path attendance patch (records.uid.day = symbol). */
    global.emsCloudEmitAttendancePatch = function (cloudDocId, patch, meta) {
        if (!cloudDocId || !patch || !Object.keys(patch).length) {
            return Promise.resolve({ ok: false, reason: 'empty_patch' });
        }
        return global.emsCloudEmitMutation({
            domain: 'attendance_patch',
            op: 'update',
            docId: cloudDocId,
            patch: patch,
            payload: patch,
            localKey: meta && meta.localKey,
            tenantId: meta && meta.tenantId,
            meta: Object.assign({}, meta || {}, {
                mutationAt: Number(meta && meta.mutationAt) || Number(patch && patch.timestamp) || Date.now()
            })
        });
    };
})(typeof window !== 'undefined' ? window : globalThis);
