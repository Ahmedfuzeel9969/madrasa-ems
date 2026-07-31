// ============================================================================
// EMS Sync Failure UI — compact floating indicator (replaces full-width banner)
// ============================================================================
(function (global) {
    'use strict';

    var _retryInflight = false;
    var _panelOpen = false;
    var _userDismissed = false;
    var _lastState = null;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function ensureWidget() {
        if (!global.document) return null;
        var root = global.document.getElementById('ems-sync-indicator');
        if (root) return root;

        root = global.document.createElement('div');
        root.id = 'ems-sync-indicator';
        root.className = 'ems-sync-indicator';
        root.setAttribute('role', 'status');
        root.setAttribute('aria-live', 'polite');
        root.innerHTML =
            '<button type="button" id="ems-sync-indicator-btn" class="ems-sync-indicator-btn" aria-expanded="false" aria-controls="ems-sync-indicator-panel">' +
            '<span class="ems-sync-indicator-icon"><i class="fas fa-cloud" aria-hidden="true"></i></span>' +
            '<span id="ems-sync-indicator-badge" class="ems-sync-indicator-badge" hidden>0</span>' +
            '</button>' +
            '<div id="ems-sync-indicator-panel" class="ems-sync-indicator-panel" hidden>' +
            '<div class="ems-sync-indicator-panel-head">' +
            '<strong id="ems-sync-indicator-title">سنک کی حالت</strong>' +
            '<button type="button" id="ems-sync-indicator-close" class="ems-sync-indicator-close" aria-label="بند کریں اور dead-letter صاف کریں" title="بند / صاف کریں">×</button>' +
            '</div>' +
            '<p id="ems-sync-indicator-msg" class="ems-sync-indicator-msg"></p>' +
            '<div class="ems-sync-indicator-actions">' +
            '<button type="button" id="ems-sync-indicator-retry" class="btn btn-sm btn-primary"><i class="fas fa-redo"></i> دوبارہ کوشش</button>' +
            '</div>' +
            '</div>';

        global.document.body.appendChild(root);

        var btn = global.document.getElementById('ems-sync-indicator-btn');
        var closeBtn = global.document.getElementById('ems-sync-indicator-close');
        var retryBtn = global.document.getElementById('ems-sync-indicator-retry');

        if (btn && !btn._emsBound) {
            btn._emsBound = true;
            btn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                togglePanel();
            });
        }
        if (closeBtn && !closeBtn._emsBound) {
            closeBtn._emsBound = true;
            closeBtn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                global.emsSyncFailureDismiss();
            });
        }
        if (retryBtn && !retryBtn._emsBound) {
            retryBtn._emsBound = true;
            retryBtn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                global.emsSyncFailureRetryAll();
            });
        }

        if (!global.document._emsSyncIndicatorDocBound) {
            global.document._emsSyncIndicatorDocBound = true;
            global.document.addEventListener('click', function (ev) {
                if (!_panelOpen) return;
                var panel = global.document.getElementById('ems-sync-indicator-panel');
                var trigger = global.document.getElementById('ems-sync-indicator-btn');
                if (panel && !panel.contains(ev.target) && ev.target !== trigger && !trigger.contains(ev.target)) {
                    setPanelOpen(false);
                }
            });
        }

        return root;
    }

    function setPanelOpen(open) {
        _panelOpen = !!open;
        var panel = global.document.getElementById('ems-sync-indicator-panel');
        var btn = global.document.getElementById('ems-sync-indicator-btn');
        if (panel) panel.hidden = !open;
        if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function togglePanel() {
        setPanelOpen(!_panelOpen);
    }

    function hideLegacyBanner() {
        var legacy = global.document.getElementById('ems-sync-status-bar');
        if (legacy) {
            legacy.style.display = 'none';
            legacy.innerHTML = '';
            legacy.setAttribute('aria-hidden', 'true');
        }
    }

    function renderIndicator(state) {
        hideLegacyBanner();
        state = state || {};
        _lastState = state;

        var failed = state.failed || 0;
        var pending = state.pending || 0;
        var deadLetter = state.deadLetter || 0;
        var cleared = !!state.cleared;
        var flushing = !!state.flushing;
        var hasError = failed > 0 || deadLetter > 0;

        if (_userDismissed && !state.forceShow) {
            var rootHidden = global.document.getElementById('ems-sync-indicator');
            if (rootHidden) rootHidden.hidden = true;
            return;
        }

        if (!flushing && failed <= 0 && pending <= 0 && deadLetter <= 0) {
            var emptyRoot = global.document.getElementById('ems-sync-indicator');
            if (emptyRoot) emptyRoot.hidden = true;
            setPanelOpen(false);
            return;
        }

        var root = ensureWidget();
        if (!root) return;
        root.hidden = false;

        var btn = global.document.getElementById('ems-sync-indicator-btn');
        var badge = global.document.getElementById('ems-sync-indicator-badge');
        var title = global.document.getElementById('ems-sync-indicator-title');
        var msg = global.document.getElementById('ems-sync-indicator-msg');
        var retryBtn = global.document.getElementById('ems-sync-indicator-retry');
        var icon = root.querySelector('.ems-sync-indicator-icon i');

        root.classList.remove('ems-sync-indicator--error', 'ems-sync-indicator--pending', 'ems-sync-indicator--syncing');

        if (flushing) {
            root.classList.add('ems-sync-indicator--syncing');
            if (icon) icon.className = 'fas fa-sync fa-spin';
            if (badge) badge.hidden = true;
            if (title) title.textContent = 'کلاؤڈ سنک';
            if (msg) msg.textContent = 'سنک جاری ہے…';
            if (retryBtn) retryBtn.style.display = 'none';
            return;
        }

        if (hasError) {
            root.classList.add('ems-sync-indicator--error');
            if (icon) icon.className = 'fas fa-cloud-upload-alt';
            if (badge) {
                badge.hidden = false;
                badge.textContent = String(Math.max(failed, deadLetter));
            }
            if (title) title.textContent = 'Sync Failed';
            var parts = [];
            if (failed > 0) parts.push(failed + ' زیرِ انتظار');
            if (deadLetter > 0) parts.push(deadLetter + ' dead-letter');
            if (msg) {
                msg.textContent = 'Sync Failed — ' + parts.join('، ') +
                    (state.error ? ' (' + esc(state.error) + ')' : '') +
                    (state.code ? ' [' + esc(state.code) + ']' : '');
            }
            if (retryBtn) retryBtn.style.display = '';
            return;
        }

        if (pending > 0 && !cleared) {
            root.classList.add('ems-sync-indicator--pending');
            if (icon) icon.className = 'fas fa-cloud-upload-alt';
            if (badge) {
                badge.hidden = false;
                badge.textContent = String(pending);
            }
            if (title) title.textContent = 'سنک منتظر';
            if (msg) msg.textContent = pending + ' تبدیلیاں سنک کے منتظر — «کلاؤڈ سنک» یا انٹرنیٹ چیک کریں';
            if (retryBtn) retryBtn.style.display = '';
        }
    }

    global.emsSyncFailureDismiss = function () {
        var chain = Promise.resolve({ ok: true, cleared: 0 });
        if (typeof global.emsOfflineClearDeadLetterQueue === 'function') {
            chain = global.emsOfflineClearDeadLetterQueue();
        }
        return chain.then(function (res) {
            _userDismissed = true;
            setPanelOpen(false);
            var root = global.document.getElementById('ems-sync-indicator');
            if (root) root.hidden = true;
            if (typeof global.showToast === 'function' && res && res.cleared > 0) {
                global.showToast('Dead-letter قطار صاف کر دی گئی (' + res.cleared + ')', 'info');
            }
            if (typeof global.emsSyncFailureRefreshUi === 'function') {
                return global.emsSyncFailureRefreshUi({ cleared: true, forceShow: false });
            }
            return res;
        }).catch(function (err) {
            console.error('[EMS] sync indicator dismiss failed', err);
            if (typeof global.showToast === 'function') {
                global.showToast('Dead-letter صاف نہیں ہو سکی', 'error');
            }
        });
    };

    global.emsSyncFailureRefreshUi = function (detail) {
        detail = detail || {};
        if (detail.deadLettered || (typeof detail.failed === 'number' && detail.failed > 0)) {
            _userDismissed = false;
        }
        if (typeof detail.failed === 'number' || typeof detail.pending === 'number' || typeof detail.deadLetter === 'number' || detail.flushing) {
            renderIndicator(detail);
            return;
        }
        if (typeof global.emsOfflineGetSyncFailureState === 'function') {
            global.emsOfflineGetSyncFailureState().then(function (counts) {
                renderIndicator(Object.assign({}, counts, {
                    error: detail.error || counts.lastError
                }, detail));
            }).catch(function () { /* ignore */ });
        }
    };

    global.emsSyncFailureRetryAll = function () {
        if (_retryInflight) return _retryInflight;
        _retryInflight = true;
        renderIndicator(Object.assign({}, _lastState || {}, { flushing: true }));
        var chain;
        if (typeof global.emsOfflineRetryFailedSync === 'function') {
            chain = global.emsOfflineRetryFailedSync();
        } else if (typeof global.emsCloudFlushPendingMutations === 'function') {
            chain = global.emsCloudFlushPendingMutations();
        } else {
            chain = Promise.resolve({ ok: false, reason: 'retry_unavailable' });
        }
        _retryInflight = chain.then(function (res) {
            if (typeof global.showToast === 'function') {
                if (res && res.stillFailed > 0) {
                    global.showToast('⚠️ کچھ تبدیلیاں اب بھی ناکام — دوبارہ کوشش کریں', 'warning');
                } else if (res && res.retried > 0) {
                    global.showToast('✅ ناکام سنک دوبارہ بھیج دی گئیں', 'success');
                }
            }
            global.emsSyncFailureRefreshUi();
            return res;
        }).catch(function (err) {
            console.error('[EMS] sync failure retry failed', err);
            if (typeof global.showToast === 'function') {
                global.showToast('سنک ری ٹرائی ناکام: ' + (err && err.message ? err.message : String(err)), 'error');
            }
            global.emsSyncFailureRefreshUi();
            return { ok: false, error: err && err.message ? err.message : String(err) };
        }).finally(function () {
            _retryInflight = false;
        });
        return _retryInflight;
    };

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('ems:sync-failure', function (ev) {
            global.emsSyncFailureRefreshUi((ev && ev.detail) || {});
        });
        global.addEventListener('online', function () {
            setTimeout(function () { global.emsSyncFailureRefreshUi(); }, 800);
        });
    }

    if (global.document) {
        var boot = function () {
            hideLegacyBanner();
            global.emsSyncFailureRefreshUi();
        };
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', boot);
        } else {
            setTimeout(boot, 0);
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
