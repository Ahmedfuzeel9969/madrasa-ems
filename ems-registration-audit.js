// ============================================================================
// EMS Registration Audit Trail — Sprint 4 (offline-first, local IDB + cloud sync)
// ============================================================================
(function (global) {
    'use strict';

    var MODULE = 'admission';
    var LOG_SUFFIX = '__reg_audit_log';
    var OUTBOX_SUFFIX = '__reg_audit_outbox';
    var MAX_LOG = 10000;
    var MAX_OUTBOX = 5000;
    var _flushPromise = null;

    var TRACKED_FIELDS = [
        'name', 'fname', 'cnic', 'phone', 'bform', 'class', 'type', 'status',
        'designation', 'position', 'grade', 'section', 'rollNo',
        'madrasaRollNo', 'wifaqRollNo', 'address', 'branch', 'admType', 'resType'
    ];

    var SKIP_DIFF = {
        photoBase64: true,
        photoUrl: true,
        timestamp: true,
        _duplicateOverride: true,
        _duplicateOverrideReason: true
    };

    function getTenantId() {
        if (typeof global.emsGetTenantId === 'function') {
            var tid = global.emsGetTenantId();
            if (tid) return tid;
        }
        if (global.CURRENT_MADRASA_TENANT_ID) return global.CURRENT_MADRASA_TENANT_ID;
        try {
            var u = global.firebase && global.firebase.auth && global.firebase.auth().currentUser;
            return u ? u.uid : null;
        } catch (e) {
            return null;
        }
    }

    function logKey(tenantId) {
        return String(tenantId || 'anon') + LOG_SUFFIX;
    }

    function outboxKey(tenantId) {
        return String(tenantId || 'anon') + OUTBOX_SUFFIX;
    }

    function newId() {
        return 'aud-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
    }

    function kvGet(key) {
        if (typeof global.emsIdbKvGet === 'function') {
            return global.emsIdbKvGet(key).then(function (v) { return v; });
        }
        try {
            var raw = localStorage.getItem(key);
            return Promise.resolve(raw ? JSON.parse(raw) : null);
        } catch (e) {
            return Promise.resolve(null);
        }
    }

    function kvSet(key, value) {
        if (typeof global.emsIdbKvSet === 'function') {
            return global.emsIdbKvSet(key, value).catch(function () { return false; });
        }
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return Promise.resolve(true);
        } catch (e) {
            return Promise.resolve(false);
        }
    }

    function trimList(list, max) {
        if (!list || list.length <= max) return list || [];
        return list.slice(list.length - max);
    }

    function getActorRole() {
        if (global.isSuperAdmin && global.isSuperAdmin()) return 'owner';
        if (global.isMadrasaAdmin && global.isMadrasaAdmin()) return 'owner';
        if (global.emsIsStaffUser && global.emsIsStaffUser()) {
            if (typeof global.sysPermGetConfig === 'function' && typeof global.emsGetStaffRecordForCurrentUser === 'function') {
                var cfg = global.sysPermGetConfig();
                var staff = global.emsGetStaffRecordForCurrentUser();
                if (staff && staff.templateId && cfg.templateMap && cfg.templateMap[staff.templateId]) {
                    return cfg.templateMap[staff.templateId];
                }
                if (staff && staff.role) return staff.role;
            }
            return 'staff';
        }
        return 'viewer';
    }

    function getActorName(user) {
        if (user && user.displayName) return user.displayName;
        if (global.emsGetStaffRecordForCurrentUser) {
            var staff = global.emsGetStaffRecordForCurrentUser();
            if (staff && staff.name) return staff.name;
        }
        if (user && user.email) return user.email.split('@')[0];
        return '';
    }

    function buildDeviceInfo() {
        var nav = typeof navigator !== 'undefined' ? navigator : {};
        var scr = typeof screen !== 'undefined' ? screen : {};
        return {
            userAgent: String(nav.userAgent || '').substring(0, 200),
            platform: nav.platform || '',
            language: nav.language || '',
            screenSize: (scr.width || 0) + 'x' + (scr.height || 0),
            online: typeof nav.onLine === 'boolean' ? nav.onLine : true,
            deviceId: typeof global.emsGetDeviceId === 'function' ? global.emsGetDeviceId() : null
        };
    }

    function maskCnic(val) {
        var d = String(val || '').replace(/\D/g, '');
        if (d.length < 8) return '***';
        return d.slice(0, 5) + '-***-' + d.slice(-4);
    }

    function summarizeRecord(rec) {
        if (!rec) return null;
        return {
            id: rec.id || '',
            name: rec.name || '',
            type: rec.type || '',
            class: rec.class || rec.designation || rec.position || '',
            cnic: rec.cnic ? maskCnic(rec.cnic) : '',
            phone: rec.phone ? String(rec.phone).replace(/\d(?=\d{4})/g, '*') : '',
            status: rec.status || ''
        };
    }

    global.emsRegDiffRecord = function (before, after) {
        before = before || {};
        after = after || {};
        var changes = [];
        var i, field, oldV, newV;
        for (i = 0; i < TRACKED_FIELDS.length; i++) {
            field = TRACKED_FIELDS[i];
            if (SKIP_DIFF[field]) continue;
            oldV = before[field];
            newV = after[field];
            if (String(oldV || '') === String(newV || '')) continue;
            changes.push({
                field: field,
                old: oldV == null ? '' : String(oldV).substring(0, 120),
                new: newV == null ? '' : String(newV).substring(0, 120)
            });
        }
        if ((before.photoBase64 || before.photoUrl || before.hasPhoto) !== (after.photoBase64 || after.photoUrl || after.hasPhoto)) {
            if (!!before.hasPhoto !== !!after.hasPhoto || before.photoUrl !== after.photoUrl || !!before.photoBase64 !== !!after.photoBase64) {
                changes.push({ field: 'photo', old: before.hasPhoto || before.photoUrl ? 'yes' : 'no', new: after.hasPhoto || after.photoUrl ? 'yes' : 'no' });
            }
        }
        return changes;
    };

    global.emsRegCanViewAudit = function () {
        if (typeof global.emsRegCan === 'function') {
            return global.emsRegCan('audit_view');
        }
        if (global.isSuperAdmin && global.isSuperAdmin()) return true;
        if (global.isMadrasaAdmin && global.isMadrasaAdmin()) return true;
        if (global.emsIsStaffUser && !global.emsIsStaffUser()) return true;
        if (typeof global.checkStaffModuleAccess === 'function') {
            return global.checkStaffModuleAccess('admission', 'view') || global.checkStaffModuleAccess('admission', 'edit');
        }
        return false;
    };

    global.emsRegSanitizeAuditEntryForViewer = function (entry) {
        if (!entry) return entry;
        if ((global.isSuperAdmin && global.isSuperAdmin()) || (global.isMadrasaAdmin && global.isMadrasaAdmin())) {
            return entry;
        }
        var copy = JSON.parse(JSON.stringify(entry));
        if (copy.details && copy.details.changes) {
            copy.details.changes = copy.details.changes.map(function (c) {
                if (c.field === 'cnic' || c.field === 'bform') {
                    return { field: c.field, old: maskCnic(c.old), new: maskCnic(c.new) };
                }
                if (c.field === 'phone') {
                    return { field: c.field, old: '***', new: '***' };
                }
                return c;
            });
        }
        if (copy.details && copy.details.beforeSummary && copy.details.beforeSummary.cnic) {
            copy.details.beforeSummary.cnic = maskCnic(copy.details.beforeSummary.cnic);
        }
        if (copy.details && copy.details.afterSummary && copy.details.afterSummary.cnic) {
            copy.details.afterSummary.cnic = maskCnic(copy.details.afterSummary.cnic);
        }
        return copy;
    };

    function buildEntry(action, entityId, details) {
        details = details && typeof details === 'object' ? details : {};
        var tenantId = getTenantId();
        var user = null;
        try {
            user = global.firebase && global.firebase.auth && global.firebase.auth().currentUser;
        } catch (eU) { /* ignore */ }

        var online = true;
        try { online = typeof navigator !== 'undefined' ? navigator.onLine : true; } catch (eO) { /* ignore */ }

        var sessionUser = user || (tenantId ? { uid: tenantId } : null);

        return {
            id: newId(),
            module: MODULE,
            action: String(action || '').substring(0, 40),
            entityId: entityId ? String(entityId).substring(0, 120) : '',
            tenantId: tenantId || '',
            uid: user ? user.uid : (details.uid || ''),
            email: user ? (user.email || '') : (details.email || ''),
            actorName: getActorName(user),
            actorRole: getActorRole(),
            timestamp: Date.now(),
            clientTs: Date.now(),
            device: buildDeviceInfo(),
            sessionId: sessionUser && typeof global.emsGetLoginSessionId === 'function'
                ? global.emsGetLoginSessionId(sessionUser)
                : (details.sessionId || null),
            details: details,
            synced: false,
            syncedAt: null,
            cloudId: null,
            offline: !online
        };
    }

    function appendLocalLog(entry) {
        var tenantId = entry.tenantId || getTenantId();
        if (!tenantId) return Promise.resolve(entry);
        var key = logKey(tenantId);
        return kvGet(key).then(function (list) {
            list = Array.isArray(list) ? list : [];
            list.push(entry);
            list = trimList(list, MAX_LOG);
            return kvSet(key, list).then(function () { return entry; });
        }).catch(function () { return entry; });
    }

    function appendOutbox(entry) {
        var tenantId = entry.tenantId || getTenantId();
        if (!tenantId) return Promise.resolve(entry);
        var key = outboxKey(tenantId);
        return kvGet(key).then(function (list) {
            list = Array.isArray(list) ? list : [];
            list.push({ id: entry.id, entry: entry, queuedAt: Date.now() });
            list = trimList(list, MAX_OUTBOX);
            return kvSet(key, list).then(function () { return entry; });
        }).catch(function () { return entry; });
    }

    function markEntrySynced(entryId, cloudId) {
        var tenantId = getTenantId();
        if (!tenantId) return Promise.resolve(false);
        return kvGet(logKey(tenantId)).then(function (list) {
            if (!Array.isArray(list)) return false;
            var changed = false;
            list.forEach(function (row) {
                if (row.id === entryId) {
                    row.synced = true;
                    row.syncedAt = Date.now();
                    row.cloudId = cloudId || null;
                    changed = true;
                }
            });
            if (!changed) return false;
            return kvSet(logKey(tenantId), list);
        });
    }

    function removeFromOutbox(entryId) {
        var tenantId = getTenantId();
        if (!tenantId) return Promise.resolve(false);
        return kvGet(outboxKey(tenantId)).then(function (list) {
            if (!Array.isArray(list)) return false;
            var next = list.filter(function (row) { return row.id !== entryId; });
            if (next.length === list.length) return false;
            return kvSet(outboxKey(tenantId), next);
        });
    }

    function cloudWrite(entry) {
        if (typeof global.firebase === 'undefined' || !global.firebase || !global.firebase.firestore) {
            return Promise.resolve({ ok: false, offline: true });
        }
        var db = typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
        var tenantId = entry.tenantId || getTenantId();
        if (!db || !tenantId) return Promise.resolve({ ok: false, offline: true });

        var payload = {
            module: entry.module,
            action: entry.action,
            entityId: entry.entityId,
            details: entry.details || {},
            uid: entry.uid || '',
            email: entry.email || '',
            actorName: entry.actorName || '',
            actorRole: entry.actorRole || '',
            device: entry.device || {},
            sessionId: entry.sessionId || null,
            clientTs: entry.clientTs || entry.timestamp || Date.now(),
            offline: !!entry.offline,
            syncedAt: null,
            timestamp: global.firebase.firestore.FieldValue.serverTimestamp()
        };

        return db.collection('All_Madrasas').doc(tenantId).collection('EmsAudit')
            .add(payload)
            .then(function (ref) {
                return { ok: true, cloudId: ref.id };
            })
            .catch(function (err) {
                return { ok: false, error: err && err.message };
            });
    }

    function tryCloudSync(entry) {
        var online = true;
        try { online = typeof navigator !== 'undefined' ? navigator.onLine : true; } catch (e) { /* ignore */ }
        if (!online) return appendOutbox(entry).then(function () { return { local: true, queued: true }; });

        return cloudWrite(entry).then(function (res) {
            if (res && res.ok) {
                return markEntrySynced(entry.id, res.cloudId).then(function () {
                    return removeFromOutbox(entry.id).then(function () {
                        return { local: true, synced: true, cloudId: res.cloudId };
                    });
                });
            }
            return appendOutbox(entry).then(function () {
                return { local: true, queued: true, error: res && res.error };
            });
        });
    }

    /**
     * Registration audit log — always local-first, never blocks caller.
     * @param {string} action create|edit|delete|approve|reject|restore|import|export|print_idcard|print_letter|duplicate_override
     */
    global.emsRegLogAudit = function (action, entityId, details) {
        var entry = buildEntry(action, entityId, details);
        var chain = appendLocalLog(entry).then(function () {
            return tryCloudSync(entry);
        });
        chain.catch(function (err) {
            console.warn('[EMS] reg audit log failed (non-blocking):', err && err.message);
        });
        return chain;
    };

    global.emsRegAuditFlushQueue = function () {
        if (_flushPromise) return _flushPromise;
        var tenantId = getTenantId();
        if (!tenantId) return Promise.resolve({ flushed: 0 });

        _flushPromise = kvGet(outboxKey(tenantId)).then(function (list) {
            list = Array.isArray(list) ? list : [];
            if (!list.length) return { flushed: 0 };
            var flushed = 0;
            var chain = Promise.resolve();
            list.forEach(function (row) {
                chain = chain.then(function () {
                    return cloudWrite(row.entry).then(function (res) {
                        if (res && res.ok) {
                            flushed++;
                            return markEntrySynced(row.id, res.cloudId).then(function () {
                                return removeFromOutbox(row.id);
                            });
                        }
                        return null;
                    });
                });
            });
            return chain.then(function () { return { flushed: flushed, remaining: Math.max(0, list.length - flushed) }; });
        }).finally(function () {
            _flushPromise = null;
        });
        return _flushPromise;
    };

    global.emsRegGetAuditTrail = function (entityId, opts) {
        opts = opts || {};
        var tenantId = getTenantId();
        if (!tenantId) return Promise.resolve([]);
        if (!global.emsRegCanViewAudit()) return Promise.resolve([]);

        return kvGet(logKey(tenantId)).then(function (list) {
            list = Array.isArray(list) ? list : [];
            var filtered = list;
            if (entityId) {
                filtered = list.filter(function (row) {
                    return String(row.entityId) === String(entityId);
                });
            }
            filtered.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
            if (opts.limit) filtered = filtered.slice(0, opts.limit);
            if (opts.maskForViewer !== false) {
                filtered = filtered.map(function (row) {
                    return global.emsRegSanitizeAuditEntryForViewer(row);
                });
            }
            return filtered;
        });
    };

    global.emsRegAuditSummarizeRecord = summarizeRecord;

    global.emsRegResolveRegistrationAction = function (opts) {
        opts = opts || {};
        var status = opts.status;
        var currentEditingId = opts.currentEditingId;
        var isEditingRejected = opts.isEditingRejected;
        if (status === 'rejected') return 'reject';
        if (status === 'approved') {
            if (isEditingRejected && currentEditingId) return 'restore';
            if (!currentEditingId) return 'create';
            return 'edit';
        }
        return 'edit';
    };

    try {
        global.addEventListener('online', function () {
            if (typeof global.emsRegAuditFlushQueue === 'function') {
                global.emsRegAuditFlushQueue();
            }
        });
    } catch (eListen) { /* ignore */ }

    try {
        global.addEventListener('ems:post-auth-ready', function () {
            if (typeof global.emsRegAuditFlushQueue === 'function') {
                global.emsRegAuditFlushQueue();
            }
        });
    } catch (eEvt) { /* ignore */ }

})(typeof window !== 'undefined' ? window : globalThis);
