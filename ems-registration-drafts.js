// ============================================================================
// EMS Registration Drafts — Phase A (Draft Admission + Auto Save)
// Offline-first; separate from registration SSOT until approve path runs.
// Feature flag: EMS_REG_DRAFTS_ENABLED (default false)
// ============================================================================
(function (global) {
    'use strict';

    if (global.EMS_REG_DRAFTS_ENABLED !== true) {
        global.EMS_REG_DRAFTS_ENABLED = false;
    }

    var SCHEMA_VERSION = 1;
    var DEBOUNCE_MS = 1500;
    var TTL_DAYS = 30;
    var MAX_OUTBOX = 200;
    var MAX_PHOTO_BYTES = 400000;
    var MAX_THUMB_CHARS = 11000;
    var DEVICE_KEY = 'ems_reg_draft_device_id';
    var FORM_TYPES = ['student', 'teacher', 'staff'];

    var _debounceTimers = Object.create(null);
    var _initDone = false;
    var _hydrating = false;
    var _lastStatus = Object.create(null);
    var _saveChain = Promise.resolve();

    function enabled() {
        return global.EMS_REG_DRAFTS_ENABLED === true;
    }

    function getTenantId() {
        if (typeof global.emsGetTenantId === 'function') {
            var tid = global.emsGetTenantId();
            if (tid) return tid;
        }
        return global.CURRENT_MADRASA_TENANT_ID || 'anon';
    }

    function getStaffId() {
        if (typeof global.emsGetStaffIdForAccess === 'function') {
            var sid = global.emsGetStaffIdForAccess();
            if (sid) return String(sid);
        }
        if (global.isMadrasaAdmin && global.isMadrasaAdmin()) return 'owner';
        if (global.isSuperAdmin && global.isSuperAdmin()) return 'owner';
        try {
            var u = global.firebase && global.firebase.auth && global.firebase.auth().currentUser;
            if (u && u.uid) return u.uid;
        } catch (e) { /* ignore */ }
        return 'owner';
    }

    function getDeviceId() {
        if (typeof global.emsGetDeviceId === 'function') {
            var d = global.emsGetDeviceId();
            if (d) return d;
        }
        try {
            var existing = localStorage.getItem(DEVICE_KEY);
            if (existing) return existing;
            var id = 'dev-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
            localStorage.setItem(DEVICE_KEY, id);
            return id;
        } catch (e) {
            return 'dev-anon';
        }
    }

    function draftRecordKey(tenantId, staffId, type) {
        return String(tenantId) + '__reg_draft_' + staffId + '_' + type;
    }

    function draftIndexKey(tenantId) {
        return String(tenantId) + '__reg_drafts_index';
    }

    function draftCloudKey(tenantId, staffId, type) {
        return String(tenantId) + '__reg_draft_cloud_' + staffId + '_' + type;
    }

    function draftPhotoKey(tenantId, draftId) {
        return String(tenantId) + '__reg_draft_photo_' + draftId;
    }

    function outboxKey(tenantId) {
        return String(tenantId) + '__reg_draft_outbox';
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

    function kvRemove(key) {
        if (typeof global.emsIdbKvRemove === 'function') {
            return global.emsIdbKvRemove(key).catch(function () { return false; });
        }
        try {
            localStorage.removeItem(key);
            return Promise.resolve(true);
        } catch (e) {
            return Promise.resolve(false);
        }
    }

    function canDraftAction(editingId) {
        if (!enabled()) return false;
        if (typeof global.emsRegCanDraftWrite === 'function') {
            return global.emsRegCanDraftWrite(editingId);
        }
        if (typeof global.emsRegCan !== 'function') return true;
        if (editingId) return global.emsRegCan('edit');
        return global.emsRegCan('create') || global.emsRegCan('edit');
    }

    function val(id) {
        if (typeof document === 'undefined') return '';
        var el = document.getElementById(id);
        if (!el) return '';
        return el.value != null ? String(el.value) : '';
    }

    function setVal(id, v) {
        if (typeof document === 'undefined') return;
        var el = document.getElementById(id);
        if (!el) return;
        el.value = v == null ? '' : String(v);
    }

    function syncCombinedName(prefix) {
        if (typeof global.emsRegSyncCombinedName === 'function') {
            global.emsRegSyncCombinedName(prefix);
        }
    }

    function updateCombinedName(prefix) {
        if (typeof global.emsRegUpdateCombinedName === 'function') {
            global.emsRegUpdateCombinedName(prefix);
        }
    }

    function collectStudentFields() {
        syncCombinedName('stu');
        return {
            id: val('stu-form-no'), date: val('stu-reg-date'),
            name: val('stu-name'), fname: val('stu-fname'), cnic: val('stu-cnic'),
            phone: val('stu-mobile'), dob: val('stu-dob'), bloodGroup: val('stu-blood-group'),
            class: val('stu-req-class'), branch: val('stu-branch'), admType: val('stu-adm-type'),
            resType: val('stu-res-type'), madrasaRollNo: val('stu-madrasa-roll'),
            wifaqRollNo: val('stu-wifaq-roll'), address: val('stu-address'),
            grdName: val('stu-grd-name'), grdRelation: val('stu-grd-relation'),
            grdProfession: val('stu-grd-profession'), grdMobile: val('stu-grd-mobile'),
            grdCnic: val('stu-grd-cnic'), grdEmergency: val('stu-grd-emergency'),
            prevClass: val('stu-prev-class'), prevMarks: val('stu-prev-marks'),
            prevGrade: val('stu-prev-grade'), prevYear: val('stu-prev-year'),
            prevInstitute: val('stu-prev-institute'),
            officeNazra: val('stu-office-nazra'), officeNamaz: val('stu-office-namaz'),
            officeTest: val('stu-office-test'), officeRemarks: val('stu-office-remarks'),
            officeExaminer: val('stu-office-examiner')
        };
    }

    function collectTeacherFields() {
        syncCombinedName('tch');
        return {
            id: val('tch-emp-id'), date: val('tch-reg-date'),
            name: val('tch-name'), fname: val('tch-fname'), dob: val('tch-dob'),
            cnic: val('tch-cnic'), bloodGroup: val('tch-blood-group'), marital: val('tch-marital'),
            phone: val('tch-mobile'), whatsapp: val('tch-whatsapp'), email: val('tch-email'),
            address: val('tch-address'), designation: val('tch-designation'),
            department: val('tch-department'), shift: val('tch-shift'),
            salary: val('tch-salary'), residence: val('tch-residence'), food: val('tch-food'),
            expInstitute: val('tch-exp-institute'), expDesignation: val('tch-exp-designation'),
            expDuration: val('tch-exp-duration'), expReason: val('tch-exp-reason'),
            officeDemo: val('tch-office-demo'), officeNazim: val('tch-office-nazim')
        };
    }

    function collectStaffFields() {
        syncCombinedName('stf');
        return {
            id: val('stf-emp-id'), date: val('stf-reg-date'),
            name: val('stf-name'), fname: val('stf-fname'), dob: val('stf-dob'),
            cnic: val('stf-cnic'), position: val('stf-position'), phone: val('stf-mobile'),
            address: val('stf-address'), guaName: val('stf-gua-name'), guaCnic: val('stf-gua-cnic'),
            guaMobile: val('stf-gua-mobile'), guaRelation: val('stf-gua-relation'),
            guaAddress: val('stf-gua-address'), expDetails: val('stf-exp-details'),
            healthIssue: val('stf-health-issue'), salary: val('stf-office-salary'),
            shift: val('stf-office-shift'), officeNazim: val('stf-office-nazim')
        };
    }

    function applyStudentFields(f) {
        if (!f) return;
        Object.keys(f).forEach(function (k) {
            var map = {
                id: 'stu-form-no', date: 'stu-reg-date', name: 'stu-name', fname: 'stu-fname',
                cnic: 'stu-cnic', phone: 'stu-mobile', dob: 'stu-dob', bloodGroup: 'stu-blood-group',
                class: 'stu-req-class', branch: 'stu-branch', admType: 'stu-adm-type',
                resType: 'stu-res-type', madrasaRollNo: 'stu-madrasa-roll', wifaqRollNo: 'stu-wifaq-roll',
                address: 'stu-address', grdName: 'stu-grd-name', grdRelation: 'stu-grd-relation',
                grdProfession: 'stu-grd-profession', grdMobile: 'stu-grd-mobile',
                grdCnic: 'stu-grd-cnic', grdEmergency: 'stu-grd-emergency',
                prevClass: 'stu-prev-class', prevMarks: 'stu-prev-marks', prevGrade: 'stu-prev-grade',
                prevYear: 'stu-prev-year', prevInstitute: 'stu-prev-institute',
                officeNazra: 'stu-office-nazra', officeNamaz: 'stu-office-namaz',
                officeTest: 'stu-office-test', officeRemarks: 'stu-office-remarks',
                officeExaminer: 'stu-office-examiner'
            };
            if (map[k]) setVal(map[k], f[k]);
        });
        updateCombinedName('stu');
    }

    function applyTeacherFields(f) {
        if (!f) return;
        var map = {
            id: 'tch-emp-id', date: 'tch-reg-date', name: 'tch-name', fname: 'tch-fname',
            dob: 'tch-dob', cnic: 'tch-cnic', bloodGroup: 'tch-blood-group', marital: 'tch-marital',
            phone: 'tch-mobile', whatsapp: 'tch-whatsapp', email: 'tch-email', address: 'tch-address',
            designation: 'tch-designation', department: 'tch-department', shift: 'tch-shift',
            salary: 'tch-salary', residence: 'tch-residence', food: 'tch-food',
            expInstitute: 'tch-exp-institute', expDesignation: 'tch-exp-designation',
            expDuration: 'tch-exp-duration', expReason: 'tch-exp-reason',
            officeDemo: 'tch-office-demo', officeNazim: 'tch-office-nazim'
        };
        Object.keys(map).forEach(function (k) {
            if (f[k] != null) setVal(map[k], f[k]);
        });
        updateCombinedName('tch');
    }

    function applyStaffFields(f) {
        if (!f) return;
        var map = {
            id: 'stf-emp-id', date: 'stf-reg-date', name: 'stf-name', fname: 'stf-fname',
            dob: 'stf-dob', cnic: 'stf-cnic', position: 'stf-position', phone: 'stf-mobile',
            address: 'stf-address', guaName: 'stf-gua-name', guaCnic: 'stf-gua-cnic',
            guaMobile: 'stf-gua-mobile', guaRelation: 'stf-gua-relation', guaAddress: 'stf-gua-address',
            expDetails: 'stf-exp-details', healthIssue: 'stf-health-issue', salary: 'stf-office-salary',
            shift: 'stf-office-shift', officeNazim: 'stf-office-nazim'
        };
        Object.keys(map).forEach(function (k) {
            if (f[k] != null) setVal(map[k], f[k]);
        });
        updateCombinedName('stf');
    }

    function prefixForType(type) {
        return type === 'student' ? 'stu' : type === 'teacher' ? 'tch' : 'stf';
    }

    function collectTerms(type) {
        var p = prefixForType(type);
        var ta = typeof document !== 'undefined' ? document.getElementById(p + '-terms-text') : null;
        return {
            text: ta ? ta.value : '',
            locked: ta ? ta.hasAttribute('readonly') : false
        };
    }

    function applyTerms(type, terms) {
        if (!terms) return;
        var p = prefixForType(type);
        var ta = typeof document !== 'undefined' ? document.getElementById(p + '-terms-text') : null;
        if (!ta) return;
        ta.value = terms.text || '';
        if (terms.locked) ta.setAttribute('readonly', 'true');
        else ta.removeAttribute('readonly');
    }

    function getEditingMeta() {
        return {
            editingId: global.currentEditingId || null,
            isEditingRejected: !!global.isEditingRejected,
            proposedId: null
        };
    }

    function hasMeaningfulContent(fields) {
        if (!fields) return false;
        var keys = Object.keys(fields);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (k === 'id' || k === 'date') continue;
            if (fields[k] && String(fields[k]).trim()) return true;
        }
        return false;
    }

    function simpleChecksum(obj) {
        try {
            return String(JSON.stringify(obj)).length + '-' + (obj.name || '').length;
        } catch (e) {
            return '0';
        }
    }

    function makeThumb(base64) {
        if (!base64 || base64.length <= MAX_THUMB_CHARS) return base64;
        return base64.slice(0, MAX_THUMB_CHARS);
    }

    global.emsRegDraftEnabled = enabled;

    global.emsRegCollectFormSnapshot = function (type, opts) {
        opts = opts || {};
        if (!FORM_TYPES.includes(type)) return null;
        var fields = type === 'student' ? collectStudentFields()
            : type === 'teacher' ? collectTeacherFields() : collectStaffFields();
        var meta = opts.meta || getEditingMeta();
        if (!meta.proposedId) meta.proposedId = fields.id || null;
        var photoBase64 = opts.photoBase64 != null ? opts.photoBase64 : (global.currentUploadedImageBase64 || '');
        var snap = {
            version: SCHEMA_VERSION,
            type: type,
            fields: fields,
            terms: collectTerms(type),
            customFields: typeof global.sysFieldCollect === 'function' ? global.sysFieldCollect(type) : {},
            meta: meta,
            photo: {
                hasPhoto: !!photoBase64,
                blobKey: null,
                thumbBase64: photoBase64 ? makeThumb(photoBase64) : null
            }
        };
        if (typeof opts.scrollY === 'number') snap.meta.scrollY = opts.scrollY;
        return snap;
    };

    function applyPhoto(type, photo, draftId, tenantId) {
        if (!photo || !photo.hasPhoto) return Promise.resolve();
        var p = prefixForType(type);
        var preview = typeof document !== 'undefined' ? document.getElementById(p + '-photo-preview') : null;
        var loadFrom = photo.blobKey
            ? kvGet(photo.blobKey)
            : Promise.resolve(photo.thumbBase64 || null);
        return loadFrom.then(function (src) {
            if (!src) return;
            global.currentUploadedImageBase64 = src;
            if (preview) {
                preview.src = src;
                preview.style.display = 'block';
                var drop = preview.closest('.reg-photo-drop');
                if (drop) {
                    var ph = drop.querySelector('.reg-photo-ph');
                    var hint = drop.querySelector('.reg-photo-hint');
                    if (ph) ph.style.display = 'none';
                    if (hint) hint.style.display = 'none';
                }
            }
        });
    }

    global.emsRegApplyFormSnapshot = function (type, snapshot) {
        if (!snapshot || snapshot.type !== type) return Promise.resolve(false);
        _hydrating = true;
        if (type === 'student') applyStudentFields(snapshot.fields);
        else if (type === 'teacher') applyTeacherFields(snapshot.fields);
        else applyStaffFields(snapshot.fields);
        applyTerms(type, snapshot.terms);
        if (snapshot.customFields && typeof global.sysFieldApply === 'function') {
            global.sysFieldApply(type, snapshot.customFields);
        }
        if (snapshot.meta && snapshot.meta.editingId) {
            global.currentEditingId = snapshot.meta.editingId;
        }
        if (snapshot.meta && snapshot.meta.isEditingRejected) {
            global.isEditingRejected = true;
        }
        var tenantId = getTenantId();
        return applyPhoto(type, snapshot.photo, snapshot.draftId, tenantId).then(function () {
            _hydrating = false;
            if (snapshot.meta && snapshot.meta.scrollY && typeof window !== 'undefined') {
                try { window.scrollTo(0, snapshot.meta.scrollY); } catch (e) { /* ignore */ }
            }
            return true;
        });
    };

    function updateIndex(tenantId, staffId, type, draftId, updatedAt) {
        return kvGet(draftIndexKey(tenantId)).then(function (idx) {
            idx = idx || { version: SCHEMA_VERSION, drafts: {} };
            idx.drafts[type] = { draftId: draftId, staffId: staffId, updatedAt: updatedAt };
            return kvSet(draftIndexKey(tenantId), idx);
        });
    }

    function queueOutbox(tenantId, op, staffId, type, draftId) {
        return kvGet(outboxKey(tenantId)).then(function (box) {
            box = Array.isArray(box) ? box : [];
            box.push({
                op: op,
                staffId: staffId,
                type: type,
                draftId: draftId,
                draftKey: staffId + '_' + type,
                queuedAt: new Date().toISOString(),
                attempts: 0
            });
            if (box.length > MAX_OUTBOX) box = box.slice(box.length - MAX_OUTBOX);
            return kvSet(outboxKey(tenantId), box);
        });
    }

    function pushCloudMirror(draft) {
        var tenantId = draft.tenantId;
        var ck = draftCloudKey(tenantId, draft.staffId, draft.type);
        var slim = JSON.parse(JSON.stringify(draft));
        if (slim.photo) {
            slim.photo = { hasPhoto: !!slim.photo.hasPhoto, thumbBase64: slim.photo.thumbBase64 || null };
            delete slim.photo.blobKey;
        }
        return kvSet(ck, slim).then(function () {
            if (global.firebase && global.firebase.firestore && navigator.onLine !== false) {
                try {
                    var db = global.firebase.firestore();
                    var docId = draft.staffId + '_' + draft.type;
                    return db.collection('RegistrationDrafts').doc(tenantId)
                        .collection('items').doc(docId).set(slim, { merge: true })
                        .then(function () { return { synced: true }; })
                        .catch(function (err) {
                            if (typeof global.emsLogSecurityEvent === 'function') {
                                global.emsLogSecurityEvent('reg_draft_cloud_sync_denied', {
                                    tenantId: tenantId,
                                    staffId: draft.staffId,
                                    type: draft.type,
                                    code: err && err.code ? err.code : 'unknown'
                                });
                            }
                            return queueOutbox(tenantId, 'upsert', draft.staffId, draft.type, draft.draftId)
                                .then(function () { return { synced: false, queued: true }; });
                        });
                } catch (e) { /* ignore */ }
            }
            return true;
        });
    }

    function detectConflict(localDraft, cloudDraft) {
        if (!localDraft || !cloudDraft) return null;
        if (localDraft.revision === cloudDraft.revision && localDraft.deviceId === cloudDraft.deviceId) {
            return null;
        }
        var localTs = new Date(localDraft.updatedAt || 0).getTime();
        var cloudTs = new Date(cloudDraft.updatedAt || 0).getTime();
        if (Math.abs(localTs - cloudTs) < 2000 && localDraft.checksum === cloudDraft.checksum) {
            return null;
        }
        if (cloudTs > localTs && cloudDraft.deviceId !== localDraft.deviceId) {
            return { winner: 'cloud', local: localDraft, cloud: cloudDraft };
        }
        if (localTs > cloudTs && cloudDraft.deviceId !== localDraft.deviceId) {
            return { winner: 'local', local: localDraft, cloud: cloudDraft };
        }
        return null;
    }

    global.emsRegDraftDetectConflict = detectConflict;

    global.emsRegSaveDraft = function (type, opts) {
        opts = opts || {};
        if (!enabled()) return Promise.resolve({ saved: false, reason: 'disabled' });
        if (!FORM_TYPES.includes(type)) return Promise.resolve({ saved: false, reason: 'invalid_type' });
        if (_hydrating) return Promise.resolve({ saved: false, reason: 'hydrating' });

        var meta = getEditingMeta();
        if (!canDraftAction(meta.editingId)) {
            return Promise.resolve({ saved: false, reason: 'permission' });
        }

        var snap = global.emsRegCollectFormSnapshot(type, { meta: meta });
        if (!hasMeaningfulContent(snap.fields) && !(snap.photo && snap.photo.hasPhoto)) {
            return Promise.resolve({ saved: false, reason: 'empty' });
        }

        var tenantId = getTenantId();
        var staffId = getStaffId();
        var rkey = draftRecordKey(tenantId, staffId, type);

        _saveChain = _saveChain.then(function () {
            return kvGet(rkey).then(function (existing) {
                var draftId = (existing && existing.draftId) || ('drf-' + Date.now() + '-' + Math.floor(Math.random() * 100000));
                var revision = (existing && existing.revision ? existing.revision : 0) + 1;
                var photoBase64 = global.currentUploadedImageBase64 || '';
                var blobKey = null;
                var photoPromise = Promise.resolve();
                if (photoBase64 && photoBase64.length <= MAX_PHOTO_BYTES) {
                    blobKey = draftPhotoKey(tenantId, draftId);
                    snap.photo.blobKey = blobKey;
                    snap.photo.hasPhoto = true;
                    snap.photo.thumbBase64 = makeThumb(photoBase64);
                    photoPromise = kvSet(blobKey, photoBase64);
                } else if (photoBase64) {
                    snap.photo.hasPhoto = false;
                }

                var now = new Date().toISOString();
                var draft = {
                    version: SCHEMA_VERSION,
                    draftId: draftId,
                    tenantId: tenantId,
                    staffId: staffId,
                    type: type,
                    revision: revision,
                    updatedAt: now,
                    deviceId: getDeviceId(),
                    deviceLabel: (global.navigator && global.navigator.userAgent) ? 'browser' : 'unknown',
                    reason: opts.reason || 'auto',
                    fields: snap.fields,
                    terms: snap.terms,
                    customFields: snap.customFields,
                    meta: snap.meta,
                    photo: snap.photo,
                    checksum: simpleChecksum(snap.fields)
                };

                if (opts.emergency) {
                    draft.reason = 'emergency';
                }

                return photoPromise.then(function () {
                    return kvSet(rkey, draft).then(function () {
                        return updateIndex(tenantId, staffId, type, draftId, now).then(function () {
                            _lastStatus[type] = { updatedAt: now, offline: navigator.onLine === false };
                            updateStatusUi(type, 'saved');
                            return queueOutbox(tenantId, 'upsert', staffId, type, draftId).then(function () {
                                if (opts.skipCloud) return { saved: true, draftId: draftId, revision: revision };
                                return pushCloudMirror(draft).then(function () {
                                    return { saved: true, draftId: draftId, revision: revision };
                                });
                            });
                        });
                    });
                });
            });
        });
        return _saveChain;
    };

    global.emsRegLoadDraft = function (type, opts) {
        opts = opts || {};
        if (!enabled()) return Promise.resolve(null);
        var tenantId = getTenantId();
        var staffId = opts.staffId || getStaffId();
        if (staffId !== getStaffId() && !(global.isMadrasaAdmin && global.isMadrasaAdmin())) {
            return Promise.resolve(null);
        }
        var rkey = draftRecordKey(tenantId, staffId, type);
        return kvGet(rkey).then(function (local) {
            if (!local) return null;
            if (opts.checkCloud === false) return { draft: local, conflict: null };
            var ck = draftCloudKey(tenantId, staffId, type);
            return kvGet(ck).then(function (cloud) {
                var conflict = detectConflict(local, cloud);
                if (conflict && conflict.winner === 'cloud' && !opts.preferLocal) {
                    return { draft: cloud, conflict: conflict };
                }
                if (conflict && opts.preferCloud) return { draft: cloud, conflict: conflict };
                return { draft: local, conflict: conflict };
            });
        });
    };

    global.emsRegListDrafts = function (opts) {
        opts = opts || {};
        if (!enabled()) return Promise.resolve([]);
        var tenantId = getTenantId();
        var staffId = opts.staffId || getStaffId();
        return kvGet(draftIndexKey(tenantId)).then(function (idx) {
            if (!idx || !idx.drafts) return [];
            var list = [];
            var types = FORM_TYPES;
            var chain = Promise.resolve();
            types.forEach(function (type) {
                chain = chain.then(function () {
                    var ent = idx.drafts[type];
                    if (!ent || ent.staffId !== staffId) return;
                    return kvGet(draftRecordKey(tenantId, staffId, type)).then(function (d) {
                        if (d) list.push(d);
                    });
                });
            });
            return chain.then(function () { return list; });
        });
    };

    global.emsRegDeleteDraft = function (type, opts) {
        opts = opts || {};
        if (!enabled()) return Promise.resolve(false);
        var tenantId = getTenantId();
        var staffId = opts.staffId || getStaffId();
        var rkey = draftRecordKey(tenantId, staffId, type);
        return kvGet(rkey).then(function (draft) {
            var tasks = [kvRemove(rkey)];
            if (draft && draft.photo && draft.photo.blobKey) {
                tasks.push(kvRemove(draft.photo.blobKey));
            }
            tasks.push(kvGet(draftIndexKey(tenantId)).then(function (idx) {
                if (idx && idx.drafts && idx.drafts[type]) {
                    delete idx.drafts[type];
                    return kvSet(draftIndexKey(tenantId), idx);
                }
            }));
            tasks.push(kvRemove(draftCloudKey(tenantId, staffId, type)));
            tasks.push(queueOutbox(tenantId, 'delete', staffId, type, draft ? draft.draftId : null));
            return Promise.all(tasks).then(function () {
                updateDraftBadge();
                return true;
            });
        });
    };

    global.emsRegDraftGetStatus = function (type) {
        return _lastStatus[type] || null;
    };

    global.emsRegDraftFlushSync = function () {
        if (!enabled()) return Promise.resolve({ flushed: 0 });
        var tenantId = getTenantId();
        return kvGet(outboxKey(tenantId)).then(function (box) {
            if (!box || !box.length) return { flushed: 0 };
            var flushed = 0;
            var chain = Promise.resolve();
            box.forEach(function (item) {
                chain = chain.then(function () {
                    if (item.op === 'delete') {
                        flushed++;
                        return kvRemove(draftCloudKey(tenantId, item.staffId, item.type));
                    }
                    return kvGet(draftRecordKey(tenantId, item.staffId, item.type)).then(function (d) {
                        if (d) return pushCloudMirror(d).then(function () { flushed++; });
                    });
                });
            });
            return chain.then(function () {
                return kvSet(outboxKey(tenantId), []).then(function () {
                    return { flushed: flushed };
                });
            });
        });
    };

    function purgeExpiredDrafts() {
        var tenantId = getTenantId();
        var cutoff = Date.now() - TTL_DAYS * 86400000;
        return global.emsRegListDrafts().then(function (list) {
            var chain = Promise.resolve();
            (list || []).forEach(function (d) {
                var ts = new Date(d.updatedAt || 0).getTime();
                if (ts < cutoff) {
                    chain = chain.then(function () {
                        return global.emsRegDeleteDraft(d.type);
                    });
                }
            });
            return chain;
        });
    }

    global.emsRegDraftPurgeSession = function () {
        _lastStatus = Object.create(null);
        Object.keys(_debounceTimers).forEach(function (k) {
            clearTimeout(_debounceTimers[k]);
        });
        _debounceTimers = Object.create(null);
    };

    function updateStatusUi(type, state) {
        if (typeof document === 'undefined') return;
        var el = document.getElementById('reg-draft-status-' + type);
        if (!el) return;
        if (state === 'saving') {
            el.textContent = 'محفوظ ہو رہا ہے…';
            el.className = 'reg-draft-status saving';
        } else if (state === 'saved') {
            var offline = navigator.onLine === false ? ' (آف لائن)' : '';
            el.textContent = '● محفوظ شد' + offline;
            el.className = 'reg-draft-status saved';
        } else {
            el.textContent = '';
            el.className = 'reg-draft-status';
        }
    }

    function updateDraftBadge() {
        if (typeof document === 'undefined') return;
        var badge = document.getElementById('btn-reg-drafts');
        if (!badge) return;
        global.emsRegListDrafts().then(function (list) {
            var n = (list || []).length;
            badge.hidden = n === 0;
            badge.setAttribute('aria-label', 'ڈرافٹ ' + n);
            var cnt = badge.querySelector('.reg-draft-count');
            if (cnt) cnt.textContent = n > 0 ? String(n) : '';
        });
    }

    function scheduleAutoSave(type) {
        if (!enabled() || _hydrating) return;
        if (_debounceTimers[type]) clearTimeout(_debounceTimers[type]);
        updateStatusUi(type, 'saving');
        _debounceTimers[type] = setTimeout(function () {
            global.emsRegSaveDraft(type, { reason: 'auto' });
        }, DEBOUNCE_MS);
    }

    function bindFormListeners() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('module-admission');
        if (!root || root._regDraftBound) return;
        root._regDraftBound = true;
        root.addEventListener('input', function (e) {
            if (!enabled() || _hydrating) return;
            var t = global.currentRegType;
            if (!FORM_TYPES.includes(t)) return;
            if (!e.target || !e.target.closest('#reg-' + t + '-panel')) return;
            scheduleAutoSave(t);
        });
        root.addEventListener('change', function (e) {
            if (!enabled() || _hydrating) return;
            var t = global.currentRegType;
            if (!FORM_TYPES.includes(t)) return;
            if (!e.target || !e.target.closest('#reg-' + t + '-panel')) return;
            scheduleAutoSave(t);
        });
    }

    function bindLifecycleListeners() {
        if (typeof global.addEventListener !== 'function') return;
        if (global._regDraftLifecycleBound) return;
        global._regDraftLifecycleBound = true;
        global.addEventListener('beforeunload', function () {
            if (!enabled()) return;
            var t = global.currentRegType;
            if (FORM_TYPES.includes(t)) {
                global.emsRegSaveDraft(t, { reason: 'emergency', emergency: true, skipCloud: true });
            }
        });
        global.addEventListener('pagehide', function () {
            if (!enabled()) return;
            var t = global.currentRegType;
            if (FORM_TYPES.includes(t)) {
                global.emsRegSaveDraft(t, { reason: 'emergency', emergency: true, skipCloud: true });
            }
        });
        global.addEventListener('online', function () {
            if (enabled()) global.emsRegDraftFlushSync();
        });
    }

    global.emsRegDraftSaveBeforeTabSwitch = function (prevType) {
        if (!enabled() || !FORM_TYPES.includes(prevType)) return Promise.resolve();
        return global.emsRegSaveDraft(prevType, { reason: 'tab_switch' });
    };

    global.emsRegDraftOfferResume = function (type) {
        if (!enabled() || !FORM_TYPES.includes(type)) return Promise.resolve(false);
        return global.emsRegLoadDraft(type).then(function (result) {
            if (!result || !result.draft) return false;
            if (result.conflict && result.conflict.winner === 'cloud') {
                return showConflictModal(result.conflict).then(function (choice) {
                    if (choice === 'cloud') return applyDraft(type, result.conflict.cloud);
                    if (choice === 'local') return applyDraft(type, result.conflict.local);
                    return false;
                });
            }
            return showResumeModal(type, result.draft).then(function (yes) {
                if (yes) return applyDraft(type, result.draft);
                return false;
            });
        });
    };

    function applyDraft(type, draft) {
        return global.emsRegApplyFormSnapshot(type, draft).then(function () {
            updateDraftBadge();
            return true;
        });
    }

    function showResumeModal(type, draft) {
        if (typeof document === 'undefined') return Promise.resolve(false);
        return new Promise(function (resolve) {
            var modal = document.getElementById('reg-draft-resume-modal');
            if (!modal) {
                resolve(false);
                return;
            }
            var title = document.getElementById('reg-draft-resume-title');
            var body = document.getElementById('reg-draft-resume-body');
            var name = (draft.fields && draft.fields.name) || '—';
            if (title) title.textContent = 'ناتمام فارم مل گیا';
            if (body) {
                body.textContent = 'نام: ' + name + ' · آخری محفوظ: ' + (draft.updatedAt || '');
            }
            modal.style.display = 'flex';
            modal._draftType = type;
            modal._resolve = resolve;
        });
    }

    function showConflictModal(conflict) {
        if (typeof document === 'undefined') return Promise.resolve('local');
        return new Promise(function (resolve) {
            var modal = document.getElementById('reg-draft-conflict-modal');
            if (!modal) {
                resolve('local');
                return;
            }
            modal.style.display = 'flex';
            modal._resolve = resolve;
        });
    }

    global.emsRegDraftUiResumeConfirm = function () {
        var modal = document.getElementById('reg-draft-resume-modal');
        var type = modal && modal._draftType;
        if (modal) modal.style.display = 'none';
        var resolve = modal && modal._resolve;
        if (modal) modal._resolve = null;
        if (!resolve) return;
        if (!type) {
            resolve(true);
            return;
        }
        global.emsRegLoadDraft(type, { checkCloud: true }).then(function (result) {
            var draft = result && (result.draft || (result.fields ? result : null));
            if (draft) {
                applyDraft(type, draft).then(function () { resolve(true); });
            } else {
                resolve(false);
            }
        });
    };

    global.emsRegDraftUiResumeDecline = function () {
        var modal = document.getElementById('reg-draft-resume-modal');
        var type = modal && modal._draftType;
        if (modal) modal.style.display = 'none';
        if (type) global.emsRegDeleteDraft(type);
        if (modal && modal._resolve) modal._resolve(false);
    };

    global.emsRegDraftUiConflictChoice = function (choice) {
        var modal = document.getElementById('reg-draft-conflict-modal');
        if (modal) modal.style.display = 'none';
        if (modal && modal._resolve) modal._resolve(choice);
    };

    global.emsRegDraftUiOpenList = function () {
        global.emsRegListDrafts().then(function (list) {
            var modal = document.getElementById('reg-draft-list-modal');
            var body = document.getElementById('reg-draft-list-body');
            if (!modal || !body) return;
            if (!list.length) {
                body.innerHTML = '<p class="reg-m-empty">کوئی ڈرافٹ نہیں</p>';
            } else {
                body.innerHTML = list.map(function (d) {
                    var label = d.type === 'student' ? 'طالب علم' : d.type === 'teacher' ? 'استاذ' : 'عملہ';
                    var name = (d.fields && d.fields.name) || '—';
                    return '<div class="reg-draft-list-item">' +
                        '<div><strong>' + label + '</strong> — ' + name +
                        '<br><small>' + (d.updatedAt || '') + '</small></div>' +
                        '<button type="button" class="btn btn-primary btn-sm" onclick="window.emsRegDraftUiResumeType(\'' + d.type + '\')">جاری رکھیں</button>' +
                        '</div>';
                }).join('');
            }
            modal.style.display = 'flex';
        });
    };

    global.emsRegDraftUiResumeType = function (type) {
        var lm = document.getElementById('reg-draft-list-modal');
        if (lm) lm.style.display = 'none';
        global.emsRegLoadDraft(type, { checkCloud: true }).then(function (result) {
            if (!result) return;
            if (result.conflict && result.conflict.winner === 'cloud') {
                showConflictModal(result.conflict).then(function (choice) {
                    var draft = choice === 'cloud' ? result.conflict.cloud : result.conflict.local;
                    applyDraft(type, draft);
                });
                return;
            }
            var draft = result.draft || result;
            if (draft && draft.fields) applyDraft(type, draft);
            var panelId = 'reg-' + type + '-panel';
            var btn = document.querySelector('#reg-ribbon-menu [onclick*="' + panelId + '"]');
            if (typeof global.switchRegTab === 'function') {
                global.switchRegTab(panelId, btn);
            }
        });
    };

    global.emsRegDraftInit = function () {
        if (!enabled()) return Promise.resolve({ enabled: false });
        if (_initDone) return Promise.resolve({ enabled: true, init: 'already' });
        _initDone = true;
        bindFormListeners();
        bindLifecycleListeners();
        return purgeExpiredDrafts().then(function () {
            return global.emsRegDraftFlushSync().then(function () {
                updateDraftBadge();
                var shown = null;
                try { shown = sessionStorage.getItem('ems_reg_draft_resume_shown'); } catch (e) { /* ignore */ }
                if (!shown) {
                    try { sessionStorage.setItem('ems_reg_draft_resume_shown', '1'); } catch (e2) { /* ignore */ }
                    return global.emsRegListDrafts().then(function (list) {
                        if (list.length === 1) {
                            return global.emsRegDraftOfferResume(list[0].type);
                        }
                        if (list.length > 1) {
                            global.emsRegDraftUiOpenList();
                        }
                        return { enabled: true, drafts: list.length };
                    });
                }
                return { enabled: true };
            });
        });
    };

    if (typeof document !== 'undefined' && document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            if (enabled()) bindFormListeners();
        });
    }

})(typeof window !== 'undefined' ? window : globalThis);
