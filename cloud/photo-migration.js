// ============================================================================
// EMS Photo Migration — base64 → Firebase Storage (Phase A2)
// ============================================================================
(function (global) {
    'use strict';

    var LOG_KEY = 'ems_photo_migration_log';
    var BATCH_SIZE = 5;
    var SCAN_PAGE_SIZE = 200;

    function getDb() {
        if (typeof global.getDbOrNull === 'function') return global.getDbOrNull();
        return typeof db !== 'undefined' ? db : null;
    }

    function getTenantId() {
        if (typeof global.emsGetTenantId === 'function') {
            var tid = global.emsGetTenantId();
            if (tid) return tid;
        }
        if (global.CURRENT_MADRASA_TENANT_ID) return global.CURRENT_MADRASA_TENANT_ID;
        try {
            var u = firebase.auth && firebase.auth().currentUser;
            return u ? u.uid : null;
        } catch (e) {
            return null;
        }
    }

    function appendLog(entry) {
        var log = [];
        try { log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { log = []; }
        log.unshift(Object.assign({ ts: new Date().toISOString() }, entry));
        if (log.length > 100) log.length = 100;
        localStorage.setItem(LOG_KEY, JSON.stringify(log));
    }

    function classifyPhotoDoc(doc) {
        var d = doc.data() || {};
        if (!d.photoBase64) {
            return d.photoUrl ? 'url_only' : 'none';
        }
        if (d.photoUrl) return 'both';
        return 'base64_only';
    }

    /** Paginated scan — safe for large Registrations collections. */
    function scanCollection(colName) {
        var firestore = getDb();
        var tenant = getTenantId();
        if (!firestore || !tenant) {
            return Promise.resolve({
                collection: colName,
                total: 0,
                withBase64: 0,
                withUrl: 0,
                stripOnly: 0,
                docs: []
            });
        }

        var colRef = firestore.collection('All_Madrasas').doc(tenant).collection(colName);
        var total = 0;
        var withBase64 = 0;
        var withUrl = 0;
        var stripOnly = 0;
        var docs = [];
        var lastDoc = null;

        function nextPage() {
            var q = colRef.orderBy(firebase.firestore.FieldPath.documentId()).limit(SCAN_PAGE_SIZE);
            if (lastDoc) q = q.startAfter(lastDoc);
            return q.get().then(function (snap) {
                if (snap.empty) {
                    return {
                        collection: colName,
                        total: total,
                        withBase64: withBase64,
                        withUrl: withUrl,
                        stripOnly: stripOnly,
                        docs: docs
                    };
                }
                snap.forEach(function (doc) {
                    total++;
                    var kind = classifyPhotoDoc(doc);
                    var d = doc.data() || {};
                    if (kind === 'base64_only') {
                        withBase64++;
                        docs.push({ id: doc.id, type: d.type || 'student', mode: 'upload' });
                    } else if (kind === 'both') {
                        withBase64++;
                        stripOnly++;
                        docs.push({ id: doc.id, type: d.type || 'student', mode: 'strip' });
                    } else if (kind === 'url_only') {
                        withUrl++;
                    }
                });
                lastDoc = snap.docs[snap.docs.length - 1];
                if (snap.size < SCAN_PAGE_SIZE) {
                    return {
                        collection: colName,
                        total: total,
                        withBase64: withBase64,
                        withUrl: withUrl,
                        stripOnly: stripOnly,
                        docs: docs
                    };
                }
                return nextPage();
            });
        }

        return nextPage();
    }

    global.emsPhotoMigrationScan = function () {
        return Promise.all([
            scanCollection('Registrations'),
            scanCollection('Rejected')
        ]).then(function (results) {
            var totalBase64 = results.reduce(function (s, r) { return s + r.withBase64; }, 0);
            var totalDocs = results.reduce(function (s, r) { return s + r.total; }, 0);
            var totalStrip = results.reduce(function (s, r) { return s + (r.stripOnly || 0); }, 0);
            return {
                collections: results,
                totalDocs: totalDocs,
                totalWithBase64: totalBase64,
                totalStripOnly: totalStrip,
                ready: totalBase64 === 0,
                storageReady: typeof global.emsIsPhotoStorageReady === 'function'
                    ? global.emsIsPhotoStorageReady()
                    : false
            };
        });
    };

    function stripBase64Only(colName, docMeta) {
        var firestore = getDb();
        var tenant = getTenantId();
        if (!firestore || !tenant) return Promise.reject(new Error('Firestore دستیاب نہیں'));
        return firestore.collection('All_Madrasas').doc(tenant).collection(colName).doc(docMeta.id)
            .update({
                photoBase64: firebase.firestore.FieldValue.delete(),
                hasPhoto: true
            })
            .then(function () {
                return { id: docMeta.id, ok: true, stripped: true };
            });
    }

    function migrateOneDoc(colName, docMeta) {
        if (docMeta.mode === 'strip') {
            return stripBase64Only(colName, docMeta);
        }

        var firestore = getDb();
        var tenant = getTenantId();
        if (!firestore || !tenant || !global.emsUploadRegistrationPhoto) {
            return Promise.reject(new Error('Firestore یا photo upload دستیاب نہیں'));
        }
        return firestore.collection('All_Madrasas').doc(tenant).collection(colName).doc(docMeta.id).get()
            .then(function (docSnap) {
                if (!docSnap.exists) return { id: docMeta.id, skipped: true };
                var data = docSnap.data();
                if (!data.photoBase64) {
                    return { id: docMeta.id, skipped: true, reason: 'already_migrated' };
                }
                if (data.photoUrl) {
                    return stripBase64Only(colName, docMeta);
                }
                return global.emsUploadRegistrationPhoto(data.photoBase64, docMeta.id, data.type || docMeta.type)
                    .then(function (photoResult) {
                        if (!photoResult.photoUrl) {
                            return { id: docMeta.id, error: 'upload_failed' };
                        }
                        var update = {
                            photoUrl: photoResult.photoUrl,
                            hasPhoto: true,
                            photoStoragePath: photoResult.storagePath || null,
                            photoBase64: firebase.firestore.FieldValue.delete()
                        };
                        return docSnap.ref.update(update).then(function () {
                            return { id: docMeta.id, ok: true, photoUrl: photoResult.photoUrl };
                        });
                    });
            });
    }

    function notifyProgress(options, done, total, migrated, errors) {
        if (options && typeof options.onProgress === 'function') {
            options.onProgress({ done: done, total: total, migrated: migrated, errors: errors });
        }
        var bar = document.getElementById('photo-mig-progress-bar');
        var label = document.getElementById('photo-mig-progress-label');
        if (bar && total > 0) {
            var pct = Math.min(100, Math.round((done / total) * 100));
            bar.style.width = pct + '%';
        }
        if (label) {
            label.textContent = done + ' / ' + total + ' (منتقل: ' + migrated + ', خرابی: ' + errors + ')';
        }
    }

    global.emsPhotoMigrationRun = function (options) {
        options = options || {};
        var dryRun = !!options.dryRun;

        var readyChain = typeof global.emsEnsurePhotoStorageReady === 'function'
            ? global.emsEnsurePhotoStorageReady()
            : Promise.resolve(true);

        return readyChain.then(function () {
            return global.emsPhotoMigrationScan();
        }).then(function (scan) {
            if (dryRun) return { dryRun: true, scan: scan, migrated: 0 };

            if (scan.totalWithBase64 === 0) {
                return global.emsPurgeLocalPhotoBase64().then(function (purge) {
                    return {
                        scan: scan,
                        migrated: 0,
                        purged: purge,
                        message: 'کوئی base64 تصویر نہیں ملی — local cache صاف'
                    };
                });
            }

            if (!global.emsIsPhotoStorageReady || !global.emsIsPhotoStorageReady()) {
                return Promise.reject(new Error('Firebase Storage SDK لوڈ نہیں ہوا — صفحہ refresh کریں'));
            }

            var queue = [];
            scan.collections.forEach(function (col) {
                col.docs.forEach(function (d) {
                    queue.push({ col: col.collection, doc: d });
                });
            });

            var migrated = 0;
            var stripped = 0;
            var errors = 0;
            var idx = 0;
            var total = queue.length;

            notifyProgress(options, 0, total, 0, 0);

            function nextBatch() {
                if (idx >= queue.length) {
                    appendLog({
                        action: 'migrate_complete',
                        migrated: migrated,
                        stripped: stripped,
                        errors: errors,
                        total: queue.length
                    });
                    if (typeof global.emsCacheInvalidate === 'function') global.emsCacheInvalidate();
                    return global.emsPurgeLocalPhotoBase64().then(function (purge) {
                        return {
                            scan: scan,
                            migrated: migrated,
                            stripped: stripped,
                            errors: errors,
                            total: queue.length,
                            purged: purge
                        };
                    });
                }
                var batch = queue.slice(idx, idx + BATCH_SIZE);
                idx += BATCH_SIZE;
                return Promise.all(batch.map(function (item) {
                    return migrateOneDoc(item.col, item.doc)
                        .then(function (res) {
                            if (res.ok) {
                                if (res.stripped) stripped++;
                                else migrated++;
                            } else if (res.error) {
                                errors++;
                            }
                        })
                        .catch(function () { errors++; });
                })).then(function () {
                    notifyProgress(options, Math.min(idx, total), total, migrated + stripped, errors);
                    return nextBatch();
                });
            }

            appendLog({ action: 'migrate_start', total: queue.length });
            return nextBatch();
        });
    };

    global.emsPhotoMigrationRenderUI = function () {
        var summaryEl = document.getElementById('photo-mig-summary');
        var tbody = document.querySelector('#photo-mig-table tbody');
        var logEl = document.getElementById('photo-mig-log');
        var storageEl = document.getElementById('photo-mig-storage-status');
        if (!summaryEl || !tbody) return;

        summaryEl.innerHTML = '<p style="color:#64748b;margin:0;"><i class="fas fa-spinner fa-spin"></i> اسکین جاری...</p>';
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8;">لوڈ...</td></tr>';

        var storageReady = typeof global.emsIsPhotoStorageReady === 'function' && global.emsIsPhotoStorageReady();
        if (storageEl) {
            storageEl.innerHTML = storageReady
                ? '<span style="color:#059669;"><i class="fas fa-check-circle"></i> Firebase Storage SDK تیار</span>'
                : '<span style="color:#b45309;"><i class="fas fa-hourglass-half"></i> Storage SDK لوڈ ہو رہا ہے...</span>';
        }

        if (!storageReady && typeof global.emsEnsurePhotoStorageReady === 'function') {
            global.emsEnsurePhotoStorageReady().then(function () {
                if (storageEl) {
                    storageEl.innerHTML = global.emsIsPhotoStorageReady()
                        ? '<span style="color:#059669;"><i class="fas fa-check-circle"></i> Firebase Storage SDK تیار</span>'
                        : '<span style="color:#b91c1c;"><i class="fas fa-times-circle"></i> Storage SDK دستیاب نہیں — Console میں Storage initialize کریں</span>';
                }
            });
        }

        global.emsPhotoMigrationScan().then(function (scan) {
            summaryEl.innerHTML = scan.totalWithBase64 === 0
                ? '<div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;padding:12px;color:#065f46;"><i class="fas fa-check-circle"></i> تمام تصاویر Storage URL پر ہیں یا inline base64 نہیں ہے۔</div>'
                : '<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px;color:#92400e;"><i class="fas fa-exclamation-triangle"></i> <b>' + scan.totalWithBase64 + '</b> ریکارڈز میں inline base64 ہے'
                    + (scan.totalStripOnly ? ' (' + scan.totalStripOnly + ' میں URL پہلے سے ہے — صرف base64 ہٹے گا)' : '')
                    + ' — مائیگریشن چلائیں۔</div>';

            tbody.innerHTML = scan.collections.map(function (c) {
                return '<tr><td>' + c.collection + '</td><td>' + c.total + '</td><td>' + c.withBase64 + '</td><td>' + (c.stripOnly || 0) + '</td><td>' + c.withUrl + ' URL</td></tr>';
            }).join('');

            if (logEl) {
                var log = [];
                try { log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { log = []; }
                logEl.innerHTML = log.length === 0
                    ? '<p style="color:#94a3b8;margin:0;">ابھی کوئی لاگ نہیں</p>'
                    : log.slice(0, 20).map(function (l) {
                        return '<div style="font-size:12px;border-bottom:1px solid #e2e8f0;padding:4px 0;">' +
                            (l.ts || '') + ' — ' + (l.action || '') +
                            (l.migrated != null ? ' migrated=' + l.migrated : '') +
                            (l.stripped != null ? ' stripped=' + l.stripped : '') +
                            (l.errors != null ? ' errors=' + l.errors : '') + '</div>';
                    }).join('');
            }
        }).catch(function (err) {
            summaryEl.innerHTML = '<div style="color:#b91c1c;">اسکین ناکام: ' + (err.message || err) + '</div>';
        });
    };

    global.emsPhotoMigrationRunFromUI = function () {
        if (!confirm('Firestore میں base64 تصاویر Storage پر منتقل ہوں گی۔ پہلے backup لینا یقینی بنائیں۔ جاری رکھیں؟')) return;
        var btn = document.getElementById('photo-mig-run');
        var progressWrap = document.getElementById('photo-mig-progress-wrap');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> مائیگریشن...'; }
        if (progressWrap) progressWrap.style.display = 'block';
        notifyProgress(null, 0, 1, 0, 0);

        global.emsPhotoMigrationRun().then(function (res) {
            var msg = 'مکمل: ' + (res.migrated || 0) + ' اپ لوڈ، ' + (res.stripped || 0) + ' صاف، ' + (res.errors || 0) + ' خرابی';
            if (res.purged) {
                msg += '\nLocal cache: ' + (res.purged.users || 0) + ' users, ' + (res.purged.rejected || 0) + ' rejected صاف';
            }
            alert(msg);
            global.emsPhotoMigrationRenderUI();
        }).catch(function (err) {
            alert('خرابی: ' + (err.message || err));
        }).finally(function () {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Storage مائیگریشن چلائیں'; }
            if (progressWrap) progressWrap.style.display = 'none';
        });
    };

    global.emsPhotoMigrationDryRunFromUI = function () {
        global.emsPhotoMigrationRun({ dryRun: true }).then(function (res) {
            var s = res.scan || {};
            alert('Dry run: ' + (s.totalWithBase64 || 0) + ' base64 ریکارڈز ملے (کوئی تبدیلی نہیں ہوئی)');
            global.emsPhotoMigrationRenderUI();
        }).catch(function (err) {
            alert('خرابی: ' + (err.message || err));
        });
    };

    global.emsPhotoMigrationPurgeLocalFromUI = function () {
        if (!confirm('براؤزر کی local cache سے photoBase64 ہٹایا جائے گا (Firestore نہیں چھوڑے گا)۔ جاری رکھیں؟')) return;
        if (typeof global.emsPurgeLocalPhotoBase64 !== 'function') {
            alert('emsPurgeLocalPhotoBase64 دستیاب نہیں');
            return;
        }
        global.emsPurgeLocalPhotoBase64().then(function (purge) {
            alert('Local cache صاف: users=' + (purge.users || 0) + ', rejected=' + (purge.rejected || 0));
            global.emsPhotoMigrationRenderUI();
        }).catch(function (err) {
            alert('خرابی: ' + (err.message || err));
        });
    };
})(typeof window !== 'undefined' ? window : globalThis);
