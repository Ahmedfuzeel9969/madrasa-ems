// ============================================================================
// EMS Cloud Pull — unified manual Firebase download (enterprise / global UX)
// Uses ems-firestore-paths.js SSOT — same path as admission.js save/write.
// ============================================================================
(function (global) {
    'use strict';

    if (global.__EMS_CLOUD_PULL_MODULE__) {
        if (typeof global.emsCloudPullInitUI === 'function') {
            global.emsCloudPullInitUI();
        }
        return;
    }
    global.__EMS_CLOUD_PULL_MODULE__ = true;

    var inflight = null;
    var lastResult = null;

    function resolveTenantId() {
        // Cloud pull is a live data write. Only the verified session tenant is
        // allowed — never auth.uid fallback (staff UID ≠ madrasa) and never a
        // stale persisted tenant from a previous Gmail.
        if (global.CURRENT_MADRASA_TENANT_ID) return global.CURRENT_MADRASA_TENANT_ID;
        if (global.EMS_ACTIVE_TENANT_ID) return global.EMS_ACTIVE_TENANT_ID;
        return null;
    }

    function firestorePathFor(tenantId, scope) {
        if (scope === 'attendance') {
            return tenantId ? ('All_Madrasas/' + tenantId + '/Attendance') : '—';
        }
        if (scope === 'exams') {
            return tenantId ? ('All_Madrasas/' + tenantId + '/ExamResults') : '—';
        }
        if (typeof global.emsFirestoreRegistrationsPath === 'function') {
            return global.emsFirestoreRegistrationsPath(tenantId);
        }
        return tenantId ? ('All_Madrasas/' + tenantId + '/Registrations') : '—';
    }

    function localAttendanceSheetCount() {
        try {
            if (typeof global.emsOfflineListAttendanceKeys === 'function') {
                var month = '';
                try {
                    month = new Intl.DateTimeFormat('en-CA', {
                        timeZone: 'Asia/Karachi',
                        year: 'numeric',
                        month: '2-digit'
                    }).format(new Date()).slice(0, 7);
                } catch (eM) {
                    month = new Date().toISOString().slice(0, 7);
                }
                var keys = global.emsOfflineListAttendanceKeys(month) || [];
                return keys.length;
            }
        } catch (e) { /* ignore */ }
        return 0;
    }

    function localExamsRecordCount() {
        if (typeof global.emsExamsLocalKeyStats === 'function') {
            var s = global.emsExamsLocalKeyStats();
            return (s && s.total) || 0;
        }
        try {
            var raw = null;
            if (typeof global.emsCacheGet === 'function') {
                var cached = global.emsCacheGet('ems_full_exams', null);
                if (Array.isArray(cached)) return cached.length;
            }
            raw = localStorage.getItem('ems_full_exams');
            if (!raw) return 0;
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.length : 0;
        } catch (e) {
            return 0;
        }
    }

    function isDeptPullScope(scope) {
        return scope === 'attendance' || scope === 'exams';
    }

    function getPreflight() {
        var tenantId = resolveTenantId();
        var signedIn = false;
        try {
            signedIn = !!(firebase.auth().currentUser);
        } catch (e) { /* ignore */ }
        if (!signedIn && typeof global.emsIsCloudSignedIn === 'function') {
            signedIn = global.emsIsCloudSignedIn();
        }
        if (!signedIn && global.EMS_MANUAL_CLOUD_SYNC === true) {
            var snap = typeof global.emsReadOfflineSession === 'function'
                ? global.emsReadOfflineSession() : null;
            signedIn = !!(snap && snap.authUid && snap.tenantId);
        }
        var online = global.EMS_OFFLINE_ONLY !== true;
        if (typeof global.emsIsOnlineModeEnabled === 'function') {
            online = global.emsIsOnlineModeEnabled();
        }
        var network = typeof global.emsIsNetworkAvailable === 'function'
            ? global.emsIsNetworkAvailable()
            : (global.navigator ? global.navigator.onLine : true);
        return {
            ok: !!(tenantId && signedIn && network),
            tenantId: tenantId,
            firestorePath: firestorePathFor(tenantId),
            signedIn: signedIn,
            online: online,
            network: network,
            firestoreReady: !!(typeof global.emsFirestoreGetDb === 'function'
                ? global.emsFirestoreGetDb()
                : (typeof global.getDbOrNull === 'function' && global.getDbOrNull()))
        };
    }

    function ensureCloudReady() {
        var chain = Promise.resolve();
        if (typeof global.emsEnableOnlineMode === 'function') {
            chain = global.emsEnableOnlineMode();
        } else if (typeof global.emsLoadCloudStack === 'function') {
            chain = global.emsLoadCloudStack();
        }
        return chain.then(function () {
            if (typeof global.emsEnsureFirebaseAuthReady === 'function') {
                return global.emsEnsureFirebaseAuthReady();
            }
            if (typeof global.emsInitFirebase === 'function') {
                global.emsInitFirebase();
            }
            return true;
        }).then(function () {
            if (typeof global.emsFirestoreEnsureAuthToken === 'function') {
                return global.emsFirestoreEnsureAuthToken();
            }
        }).then(function () {
            if (typeof global.emsFirestoreGetDb === 'function' && global.emsFirestoreGetDb()) {
                return true;
            }
            return !!(typeof global.getDbOrNull === 'function' && global.getDbOrNull());
        });
    }

    function localRecordCount() {
        return typeof global.emsRegRepoGetList === 'function'
            ? global.emsRegRepoGetList().length
            : 0;
    }

    function updateProgressUI(detail) {
        detail = detail || {};
        var modal = document.getElementById('ems-cloud-pull-progress-modal');
        var bar = document.getElementById('ems-cloud-pull-progress-bar');
        var label = document.getElementById('ems-cloud-pull-progress-label');
        if (modal) modal.style.display = 'flex';
        if (label) {
            var parts = [detail.message || 'کلاؤڈ سے ڈاؤن لوڈ…'];
            if (detail.path) parts.push(detail.path);
            if (detail.records != null) parts.push(detail.records + ' ریکارڈ');
            if (detail.page != null) parts.push('صفحہ ' + detail.page);
            label.textContent = parts.join(' · ');
        }
        if (bar) {
            var pct = detail.percent != null ? detail.percent : null;
            if (pct == null && detail.records != null && detail.records > 0) {
                pct = Math.min(92, 20 + Math.floor(Math.log10(detail.records + 1) * 25));
            }
            bar.style.width = (pct != null ? Math.min(100, pct) : 35) + '%';
        }
    }

    function updateProbeUI(show, message) {
        if (show) {
            updateProgressUI({ message: message || 'Firebase تلاش…', percent: 12 });
        } else {
            var modal = document.getElementById('ems-cloud-pull-progress-modal');
            if (modal && modal.style.display === 'flex') {
                var label = document.getElementById('ems-cloud-pull-progress-label');
                if (label && (label.textContent || '').indexOf('تلاش') >= 0) {
                    hideProgressUI();
                }
            }
        }
    }

    function hideProgressUI() {
        var modal = document.getElementById('ems-cloud-pull-progress-modal');
        if (modal) modal.style.display = 'none';
        var bar = document.getElementById('ems-cloud-pull-progress-bar');
        if (bar) bar.style.width = '0%';
    }

    function clearTriggerInflight(btn) {
        if (btn) btn._emsCloudPullClickInflight = false;
    }

    function markTriggerProbeBusy(btn, busy) {
        if (!btn) return;
        if (busy) {
            if (!btn._emsPrevHtml) btn._emsPrevHtml = btn.innerHTML;
            btn.disabled = true;
            btn.setAttribute('aria-busy', 'true');
            btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> ' +
                (btn.getAttribute('data-ems-probe-label') || btn.getAttribute('data-ems-busy-label') || 'براہ کرم انتظار…');
        } else if (btn._emsPrevHtml) {
            btn.innerHTML = btn._emsPrevHtml;
            delete btn._emsPrevHtml;
            btn.disabled = false;
            btn.setAttribute('aria-busy', 'false');
        }
    }

    function resolvePullTarget() {
        return ensureCloudReady().then(function (dbReady) {
            if (!dbReady) {
                return { ok: false, reason: 'firestore_unavailable' };
            }
            if (typeof global.emsFirestoreFindTenantWithRegistrationData === 'function') {
                return global.emsFirestoreFindTenantWithRegistrationData();
            }
            var tid = resolveTenantId();
            return {
                ok: true,
                tenantId: tid,
                path: firestorePathFor(tid),
                hasData: null,
                count: null
            };
        });
    }

    function showConfirmModal(opts) {
        return new Promise(function (resolve) {
            if (opts.skipConfirm) return resolve(true);
            var modal = document.getElementById('ems-cloud-pull-confirm-modal');
            if (!modal) {
                var deltaNote = opts.deltaPull
                    ? '\n\n(Delta pull — only changed module/direct docs after first sync; registrations use disaster-recovery path.)'
                    : '';
                var ok = global.confirm(
                    'کلاؤڈ سے ڈاؤن لوڈ مقامی IndexedDB کو تبدیل کر دے گا۔\n' +
                    'Path: ' + (opts.firestorePath || '?') + '\n' +
                    'Tenant: ' + (opts.tenantId || '?') + deltaNote + '\n\nجاری رکھیں؟'
                );
                return resolve(!!ok);
            }
            modal.style.display = 'flex';
            var tenantEl = document.getElementById('ems-cloud-pull-confirm-tenant');
            if (tenantEl) tenantEl.textContent = opts.tenantId || '—';
            var pathEl = document.getElementById('ems-cloud-pull-confirm-path');
            if (pathEl) pathEl.textContent = opts.firestorePath || '—';
            var cloudCountEl = document.getElementById('ems-cloud-pull-confirm-cloud-count');
            if (cloudCountEl) {
                if (opts.probeError) {
                    cloudCountEl.textContent = 'خرابی: ' + opts.probeError;
                } else if (opts.cloudCount != null) {
                    cloudCountEl.textContent = opts.cloudCount > 0
                        ? (opts.cloudCount + (opts.cloudTruncated ? '+' : '') + ' (Firebase)')
                        : '0 — اس path پر کوئی ریکارڈ نہیں';
                } else {
                    cloudCountEl.textContent = '…';
                }
            }
            var localEl = document.getElementById('ems-cloud-pull-confirm-local');
            if (localEl) {
                localEl.textContent = String(
                    opts.localCount != null ? opts.localCount : localRecordCount()
                );
            }
            var btnOk = document.getElementById('ems-cloud-pull-confirm-go');
            var btnCancel = document.getElementById('ems-cloud-pull-confirm-cancel');
            function cleanup() {
                modal.style.display = 'none';
                if (btnOk) btnOk.onclick = null;
                if (btnCancel) btnCancel.onclick = null;
            }
            if (btnCancel) {
                btnCancel.onclick = function () {
                    cleanup();
                    resolve(false);
                };
            }
            if (btnOk) {
                btnOk.disabled = !!opts.probeError;
                btnOk.onclick = function () {
                    cleanup();
                    resolve(true);
                };
            }
        });
    }

    function setButtonsBusy(busy) {
        var selector = '[data-ems-cloud-pull], #btn-reg-cloud-sync, #ems-cloud-pull-btn, #ems-diag-btn-rebuild-cache, #btn-global-cloud-sync, #btn-dash-global-sync';
        document.querySelectorAll(selector).forEach(function (btn) {
            btn.disabled = !!busy;
            btn.setAttribute('aria-busy', busy ? 'true' : 'false');
            if (busy) {
                if (!btn._emsPrevHtml) btn._emsPrevHtml = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> ' +
                    (btn.getAttribute('data-ems-busy-label') || 'ڈاؤن لوڈ…');
            } else if (btn._emsPrevHtml) {
                btn.innerHTML = btn._emsPrevHtml;
                delete btn._emsPrevHtml;
            }
        });
    }

    function pullRegistrations(tenantId, pullOpts) {
        pullOpts = pullOpts || {};
        if (typeof global.emsForceCloudDisasterRecoverySync === 'function') {
            return global.emsForceCloudDisasterRecoverySync(tenantId, {
                skipProbe: true,
                source: pullOpts.source || 'cloud_pull_confirm'
            });
        }
        if (typeof global.emsForceFullTenantDownload === 'function') {
            return global.emsForceFullTenantDownload(tenantId);
        }
        console.error('[EMS] cloud pull: disaster recovery function not loaded');
        return Promise.resolve({ ok: false, source: 'no_fn', count: 0, error: 'Cloud pull not loaded' });
    }

    function pullAttendance(tenantId, pullOpts) {
        pullOpts = pullOpts || {};
        if (typeof global.emsPullAttendanceFromCloud === 'function') {
            return global.emsPullAttendanceFromCloud(tenantId, {
                source: pullOpts.source || 'cloud_pull_execute'
            });
        }
        if (typeof global.emsPullModuleGroup === 'function') {
            return global.emsPullModuleGroup('Attendance').then(function (r) {
                return {
                    ok: true,
                    count: (r && r.pulled) || 0,
                    settingsOnly: true,
                    source: 'attendance_settings_fallback'
                };
            });
        }
        console.error('[EMS] cloud pull: attendance pull function not loaded');
        return Promise.resolve({
            ok: false,
            source: 'no_fn',
            count: 0,
            error: 'Attendance cloud pull not loaded'
        });
    }

    function pullExams(tenantId, pullOpts) {
        pullOpts = pullOpts || {};
        if (typeof global.emsPullExamsFromCloud === 'function') {
            return global.emsPullExamsFromCloud(tenantId, {
                source: pullOpts.source || 'cloud_pull_execute'
            });
        }
        if (global.EmsDirect && typeof global.EmsDirect.pullGroup === 'function') {
            return global.EmsDirect.pullGroup('Exams', { forceFull: true, delta: false, forceApply: false }).then(function (r) {
                return {
                    ok: true,
                    count: localExamsRecordCount() || ((r && r.pulled) || 0),
                    pulled: (r && r.pulled) || 0,
                    keysPulled: (r && r.details) || [],
                    byKey: (r && r.keys) || {},
                    source: 'exams_direct_fallback'
                };
            });
        }
        if (typeof global.emsPullModuleGroup === 'function') {
            return global.emsPullModuleGroup('Exams').then(function (r) {
                return {
                    ok: true,
                    count: localExamsRecordCount() || ((r && r.pulled) || 0),
                    pulled: (r && r.pulled) || 0,
                    source: 'exams_module_fallback'
                };
            });
        }
        console.error('[EMS] cloud pull: exams pull function not loaded');
        return Promise.resolve({
            ok: false,
            source: 'no_fn',
            count: 0,
            error: 'Exams cloud pull not loaded'
        });
    }

    function countFromResult(res) {
        if (res && res.count != null) return res.count;
        if (res && res.sheets != null) return res.sheets;
        if (res && res.memoryCount != null) return res.memoryCount;
        return localRecordCount();
    }

    function refreshUIAfterPull(res, scope) {
        var n = countFromResult(res);
        if (scope === 'attendance') {
            if (typeof global.emsInvalidateAttDashboardCache === 'function') {
                global.emsInvalidateAttDashboardCache();
            }
            if (typeof global.renderAttDashboard === 'function') {
                try { global.renderAttDashboard(); } catch (eAtt) { /* ignore */ }
            }
            try {
                var loadBtn = document.getElementById('btn-load-smart-register');
                if (loadBtn && global.currentAttState && global.currentAttState.dbKey) {
                    loadBtn.click();
                }
            } catch (eReload) { /* ignore */ }
            if (typeof global.updateMasterDashboard === 'function') global.updateMasterDashboard();
            return;
        }
        if (scope === 'exams') {
            if (typeof global.refreshExamData === 'function') {
                try { global.refreshExamData(); } catch (eEx) { /* ignore */ }
            }
            if (typeof global.updateMasterDashboard === 'function') global.updateMasterDashboard();
            return;
        }
        if (typeof global.emsMarkRepositoryReady === 'function') {
            global.emsMarkRepositoryReady(n, { bootComplete: n > 0, empty: n === 0 });
        }
        if (typeof global.renderRegTable === 'function') global.renderRegTable();
        if (typeof global.updateMasterDashboard === 'function') global.updateMasterDashboard();
        if (typeof global.emsPerfSettingsRenderUI === 'function') global.emsPerfSettingsRenderUI();
        if (typeof global.emsDiagnosticsUIRun === 'function') global.emsDiagnosticsUIRun();
    }

    function toastOutcome(res, tenantId, path, scope) {
        if (typeof global.showToast !== 'function') return;
        var n = countFromResult(res);
        if (res && res.reason === 'cancelled') return;
        if (res && res.ok === false && res.reason) {
            var reasons = {
                offline_mode: 'پہلے آن لائن موڈ آن کریں',
                no_network: 'انٹرنیٹ دستیاب نہیں',
                not_signed_in: 'پہلے Gmail / Firebase لاگ ان کریں',
                no_tenant: 'Tenant ID نہیں ملی',
                firestore_unavailable: 'Firestore دستیاب نہیں'
            };
            global.showToast(reasons[res.reason] || res.error || 'کلاؤڈ بحالی ناکام', 'error');
            return;
        }
        var unit = 'ریکارڈ';
        if (scope === 'attendance') unit = 'حاضری شیٹ';
        else if (scope === 'exams') unit = 'امتحانی آئٹم';
        if (n > 0 && res && res.ok !== false) {
            if (scope === 'exams') {
                var keysN = (res.keysPulled && res.keysPulled.length)
                    || (res.pulled)
                    || 0;
                var expected = (res.keysExpected && res.keysExpected.length) || 5;
                global.showToast(
                    '✅ امتحانات کلاؤڈ بحالی مکمل: ' + n + ' ' + unit +
                    ' · ' + keysN + '/' + expected + ' ذخیرے (ترتیبات، ماسٹر شیٹ، نمبرز، لاکس)',
                    'success'
                );
            } else {
                global.showToast('✅ کلاؤڈ بحالی مکمل: ' + n + ' ' + unit, 'success');
            }
        } else if (n === 0) {
            global.showToast(
                '⚠️ Firebase path ' + (path || firestorePathFor(tenantId, scope)) + ' پر ڈاؤن لوڈ ناکام — ' +
                ((res && res.error) || 'کوئی ریکارڈ محفوظ نہیں'),
                'warning'
            );
        } else if (res && res.error) {
            global.showToast('کلاؤڈ بحالی ناکام: ' + res.error, 'error');
        }
    }

    global.emsCloudPullGetStatus = function () {
        var pre = getPreflight();
        if (typeof global.emsFirestorePathMeta === 'function') {
            pre.pathMeta = global.emsFirestorePathMeta();
        }
        return Object.assign({}, pre, {
            inflight: !!inflight,
            lastResult: lastResult
        });
    };

    global.emsCloudPullExecute = function (opts) {
        opts = opts || {};
        var triggerBtn = opts.triggerButton || null;

        if (inflight) {
            setButtonsBusy(true);
            updateProbeUI(true, 'پہلے سے چیک ہو رہا ہے…');
            return inflight;
        }

        setButtonsBusy(true);
        updateProbeUI(true, 'کلاؤڈ کنیکشن تیار…');

        var prep = (typeof global.emsPrepareManualCloudSync === 'function')
            ? global.emsPrepareManualCloudSync()
            : Promise.resolve({ ok: true });

        inflight = prep.then(function (prepRes) {
            if (prepRes && prepRes.ok === false) {
                clearTriggerInflight(triggerBtn);
                markTriggerProbeBusy(triggerBtn, false);
                hideProgressUI();
                setButtonsBusy(false);
                if (prepRes.reason === 'not_signed_in' || prepRes.needsReauth) {
                    toastOutcome({ ok: false, reason: 'not_signed_in' }, null);
                    if (typeof global.showToast === 'function') {
                        global.showToast('کلاؤڈ ڈاؤن لوڈ کے لیے Gmail دوبارہ لاگ ان کریں', 'warning');
                    }
                    if (typeof global.loginWithGoogle === 'function') {
                        setTimeout(function () { global.loginWithGoogle(); }, 400);
                    }
                } else {
                    toastOutcome(prepRes, null);
                }
                return prepRes;
            }

            var pre = getPreflight();

            if (!pre.signedIn) {
                clearTriggerInflight(triggerBtn);
                markTriggerProbeBusy(triggerBtn, false);
                toastOutcome({ ok: false, reason: 'not_signed_in' }, null);
                return { ok: false, reason: 'not_signed_in' };
            }
            if (!pre.network) {
                clearTriggerInflight(triggerBtn);
                markTriggerProbeBusy(triggerBtn, false);
                toastOutcome({ ok: false, reason: 'no_network' }, null);
                return { ok: false, reason: 'no_network' };
            }

            updateProbeUI(true, 'Firebase سے ریکارڈز تلاش…');

            var pullScope = opts.scope || 'registrations';

            return resolvePullTarget().then(function (target) {
            if (target && target.reason === 'firestore_unavailable') {
                throw new Error('Firestore دستیاب نہیں — آن لائن موڈ آن کریں');
            }
            var pullTenant = (target && target.tenantId) || opts.tenantId || resolveTenantId();
            var verified = resolveTenantId();
            if (!pullTenant || !verified || String(pullTenant) !== String(verified)) {
                toastOutcome({ ok: false, reason: 'no_tenant' }, null, null, pullScope);
                return { ok: false, reason: 'tenant_mismatch' };
            }
            var pullPath = isDeptPullScope(pullScope)
                ? firestorePathFor(pullTenant, pullScope)
                : ((target && target.path) || firestorePathFor(pullTenant, pullScope));

            if (typeof global.emsPipelineDebug === 'function') {
                global.emsPipelineDebug('cloud_pull_probe', {
                    tenantId: pullTenant,
                    firestorePath: pullPath,
                    scope: pullScope,
                    probeSource: target && target.source,
                    probeCount: target && target.count,
                    hasData: target && target.hasData
                });
            }

            setButtonsBusy(false);
            markTriggerProbeBusy(triggerBtn, false);
            clearTriggerInflight(triggerBtn);
            updateProbeUI(false);

            var confirmLocalCount = null;
            if (pullScope === 'attendance') confirmLocalCount = localAttendanceSheetCount();
            else if (pullScope === 'exams') confirmLocalCount = localExamsRecordCount();

            return showConfirmModal({
                skipConfirm: !!opts.skipConfirm,
                deltaPull: pullScope === 'all',
                tenantId: pullTenant,
                firestorePath: pullPath,
                cloudCount: isDeptPullScope(pullScope) ? null : (target && target.count),
                cloudTruncated: target && target.truncated,
                probeError: target && target.error,
                localCount: confirmLocalCount
            }).then(function (confirmed) {
                if (!confirmed) return { ok: false, reason: 'cancelled' };

                setButtonsBusy(true);
                updateProgressUI({ message: 'کنیکشن تیار…', percent: 8, path: pullPath });

                if (typeof global.emsFirestoreAlignSessionTenant === 'function') {
                    global.emsFirestoreAlignSessionTenant(pullTenant);
                } else if (typeof global.emsActivateTenantStorage === 'function') {
                    global.emsActivateTenantStorage(pullTenant);
                }
                if (!isDeptPullScope(pullScope) && typeof global.emsShowRegistrationBootOverlay === 'function') {
                    global.emsShowRegistrationBootOverlay(true, 'کلاؤڈ سے ڈیٹا ڈاؤن لوڈ…');
                }

                var tbody = document.querySelector('#reg-users-table tbody');
                if (tbody && pullScope !== 'all' && !isDeptPullScope(pullScope)) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;">کلاؤڈ سے ڈیٹا ڈاؤن لوڈ ہو رہا ہے…<br><small>' + pullPath + '</small></td></tr>';
                }

                var progressMsg = 'Firebase سے ڈاؤن لوڈ…';
                if (pullScope === 'attendance') progressMsg = 'حاضری ڈیٹا ڈاؤن لوڈ…';
                else if (pullScope === 'exams') progressMsg = 'امتحانات ڈیٹا ڈاؤن لوڈ…';
                updateProgressUI({
                    message: progressMsg,
                    percent: 18,
                    path: pullPath
                });

                if (pullScope === 'all' && typeof global.emsCloudPullNow === 'function') {
                    return global.emsCloudPullNow();
                }
                if (pullScope === 'attendance') {
                    return pullAttendance(pullTenant, { source: 'cloud_pull_execute' });
                }
                if (pullScope === 'exams') {
                    return pullExams(pullTenant, { source: 'cloud_pull_execute' });
                }
                return pullRegistrations(pullTenant, { source: 'cloud_pull_execute' });
            }).then(function (res) {
                if (!res || res.reason === 'cancelled') return res;
                lastResult = Object.assign({}, res || {}, {
                    tenantId: pullTenant,
                    firestorePath: pullPath,
                    scope: pullScope,
                    at: Date.now()
                });
                refreshUIAfterPull(lastResult, pullScope);
                toastOutcome(lastResult, pullTenant, pullPath, pullScope);
                try {
                    global.dispatchEvent(new CustomEvent('ems:cloud-pull-complete', { detail: lastResult }));
                } catch (e) { /* ignore */ }
                return lastResult;
            });
        }).catch(function (err) {
            console.error('[EMS] cloud pull failed', err);
            lastResult = {
                ok: false,
                error: err && err.message ? err.message : String(err),
                tenantId: resolveTenantId()
            };
            toastOutcome(lastResult, lastResult.tenantId);
            return lastResult;
        }).finally(function () {
            inflight = null;
            setButtonsBusy(false);
            markTriggerProbeBusy(triggerBtn, false);
            clearTriggerInflight(triggerBtn);
            hideProgressUI();
            if (typeof global.emsFinishManualCloudSync === 'function') {
                global.emsFinishManualCloudSync();
            }
            if (typeof global.emsShowRegistrationBootOverlay === 'function') {
                global.emsShowRegistrationBootOverlay(false);
            }
        });
        });

        return inflight;
    };

    function waitAndExecute(btn) {
        var scope = btn.getAttribute('data-ems-cloud-pull') || 'registrations';
        markTriggerProbeBusy(btn, true);
        updateProbeUI(true, 'ماڈیول لوڈ…');

        function run() {
            global.emsCloudPullExecute({ scope: scope, triggerButton: btn });
        }

        if (typeof global.emsEnsurePostAuthScripts === 'function') {
            global.emsEnsurePostAuthScripts().then(function () {
                if (typeof global.emsCloudPullExecute === 'function') {
                    run();
                    return;
                }
                throw new Error('cloud_pull_not_ready');
            }).catch(function (err) {
                console.error('[EMS] cloud pull bootstrap failed', err);
                markTriggerProbeBusy(btn, false);
                clearTriggerInflight(btn);
                updateProbeUI(false);
                if (typeof global.showToast === 'function') {
                    global.showToast('کلاؤڈ ماڈیول لوڈ نہیں — صفحہ ریفریش کریں', 'error');
                }
            });
            return;
        }

        if (typeof global.emsCloudPullExecute === 'function') {
            run();
            return;
        }

        var attempts = 0;
        var timer = setInterval(function () {
            attempts += 1;
            if (typeof global.emsCloudPullExecute === 'function') {
                clearInterval(timer);
                run();
            } else if (attempts > 150) {
                clearInterval(timer);
                markTriggerProbeBusy(btn, false);
                clearTriggerInflight(btn);
                updateProbeUI(false);
                if (typeof global.showToast === 'function') {
                    global.showToast('کلاؤڈ ماڈیول لوڈ نہیں — دوبارہ کوشش کریں', 'error');
                }
            }
        }, 200);
    }

    function onCloudPullButtonClick(btn) {
        if (!btn || btn.disabled || btn._emsCloudPullClickInflight) return;
        btn._emsCloudPullClickInflight = true;

        if (typeof global.emsRegRepoGetList !== 'function' && typeof global.emsEnsurePostAuthScripts === 'function') {
            waitAndExecute(btn);
            return;
        }

        markTriggerProbeBusy(btn, true);
        updateProbeUI(true, 'Firebase سے ریکارڈز تلاش…');
        global.emsCloudPullExecute({
            scope: btn.getAttribute('data-ems-cloud-pull') || 'registrations',
            triggerButton: btn
        });
    }

    function bindCloudPullDelegation() {
        if (global.__EMS_CLOUD_PULL_CLICK_BOUND__) return;
        global.__EMS_CLOUD_PULL_CLICK_BOUND__ = true;
        document.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest ? e.target.closest('[data-ems-cloud-pull]') : null;
            if (!btn) return;
            onCloudPullButtonClick(btn);
        }, false);
    }

    function bindCloudPullButtons() {
        bindCloudPullDelegation();
    }

    global.emsCloudPullInitUI = bindCloudPullButtons;

    global.addEventListener('ems:cloud-pull-progress', function (e) {
        updateProgressUI(e.detail || {});
    });

    bindCloudPullDelegation();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindCloudPullButtons);
    }
    global.addEventListener('ems:post-auth-deferred-ready', bindCloudPullButtons);

})(typeof window !== 'undefined' ? window : globalThis);
