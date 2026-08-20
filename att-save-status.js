// ============================================================================
// حاضری محفوظ — Local-First Status (Phases 1–5)
// مقامی محفوظ → مستقل قطار → پس منظر Firebase — UI کبھی Firebase پر نہیں روکتا
// ============================================================================
(function (global) {
  'use strict';

  var _docs = Object.create(null);
  var _smartDocId = null;
  var _collectiveDocIds = [];
  var _bound = false;
  var _queueRefreshTimer = null;
  var _lastQueueSummary = { pending: 0, failed: 0, deadLetter: 0, rows: [] };

  function now() { return Date.now(); }

  function log(phase, docId, msg, detail) {
    try {
      console.log('[EMS att-save]', phase, docId || '-', msg, detail || '');
    } catch (eLog) { /* ignore */ }
  }

  function ensureDoc(docId) {
    if (!docId) return null;
    if (!_docs[docId]) {
      _docs[docId] = { local: 'idle', cloud: 'idle', updatedAt: 0, error: '', code: '' };
    }
    return _docs[docId];
  }

  function isAttQueueType(type) {
    return type === 'attendance' || type === 'attendance_patch';
  }

  function cloudRank(state) {
    var ranks = { failed: 0, conflict: 1, queued: 2, offline: 3, syncing: 4, synced: 5, idle: 6 };
    return ranks[state] != null ? ranks[state] : 3;
  }

  function localRank(state) {
    var ranks = { failed: 0, writing: 1, saved: 2, idle: 3 };
    return ranks[state] != null ? ranks[state] : 3;
  }

  function pickAggregate(docIds) {
    // Only sheets with a real save attempt have a status; an untouched register stays blank.
    var ids = (docIds || []).filter(function (id) {
      if (!id || !_docs[id]) return false;
      return _docs[id].local !== 'idle' || _docs[id].cloud !== 'idle';
    });
    if (!ids.length) return { local: 'idle', cloud: 'idle', labelKey: 'idle', pending: 0 };
    var agg = { local: 'saved', cloud: 'synced', labelKey: 'local_and_cloud', pending: 0 };
    ids.forEach(function (id) {
      var d = _docs[id] || { local: 'idle', cloud: 'idle' };
      if (localRank(d.local) < localRank(agg.local)) agg.local = d.local;
      if (cloudRank(d.cloud) < cloudRank(agg.cloud)) agg.cloud = d.cloud;
      if (d.cloud === 'queued' || d.cloud === 'offline' || d.cloud === 'syncing') agg.pending++;
    });
    if (agg.local === 'failed') agg.labelKey = 'local_failed';
    else if (agg.cloud === 'conflict' || agg.cloud === 'failed') agg.labelKey = 'cloud_failed';
    else if (agg.cloud === 'synced') agg.labelKey = 'local_and_cloud';
    // Offline and queued writes are local-only until Firebase confirms success.
    // Do not describe an unconfirmed write as a cloud success or "waiting".
    else agg.labelKey = 'local_only';
    return agg;
  }

  function labelFor(key, pending) {
    var labels = {
      idle: '',
      local_writing: 'مقامی طور پر محفوظ',
      local_only: 'مقامی طور پر محفوظ',
      local_and_cloud: 'کلاؤڈ پر محفوظ',
      local_cloud_pending: 'مقامی طور پر محفوظ',
      cloud_syncing: 'مقامی طور پر محفوظ',
      local_cloud_conflict: 'مقامی طور پر محفوظ — کلاؤڈ پر ناکام',
      cloud_failed: 'مقامی طور پر محفوظ — کلاؤڈ پر ناکام',
      local_failed: 'اس آلے پر محفوظ ناکام'
    };
    return labels[key] || labels.local_only;
  }

  function chipClass(key) {
    if (key === 'local_failed' || key === 'local_cloud_conflict' || key === 'cloud_failed') return 'att-save-status--failed';
    if (key === 'local_cloud_pending' || key === 'cloud_syncing' || key === 'local_writing') {
      return 'att-save-status--pending';
    }
    if (key === 'local_and_cloud' || key === 'local_only') return 'att-save-status--ok';
    return 'att-save-status--idle';
  }

  function renderChip(el, docIds, clickable) {
    if (!el) return;
    var agg = pickAggregate(docIds);
    if (agg.labelKey === 'idle') {
      el.textContent = '';
      el.className = 'att-save-status-chip att-save-status--idle att-save-status-hidden';
      el.setAttribute('aria-hidden', 'true');
      return;
    }
    el.className = 'att-save-status-chip ' + chipClass(agg.labelKey) + (clickable ? ' att-save-status-clickable' : '');
    el.textContent = labelFor(agg.labelKey, agg.pending);
    el.removeAttribute('aria-hidden');
    el.title = clickable ? 'سنک قطار دیکھیں / دوبارہ بھیجیں' : '';
  }

  function renderQueuePanel() {
    var panel = global.document && global.document.getElementById('att-save-queue-panel');
    var summary = global.document && global.document.getElementById('att-save-queue-summary');
    var list = global.document && global.document.getElementById('att-save-queue-list');
    if (!panel || !summary || !list) return;
    var q = _lastQueueSummary;
    var attRows = (q.rows || []).filter(function (r) { return r && isAttQueueType(r.type); });
    if (!attRows.length && !q.deadLetter) {
      summary.textContent = q.pending
        ? ('کل ' + q.pending + ' سنک قطار میں — حاضری: 0 (دیگر ماڈیول)')
        : 'کوئی حاضری سنک انتظار نہیں — سب Firebase پر پہنچ چکی ہے۔';
      list.innerHTML = '';
      return;
    }
    summary.textContent = attRows.length + ' حاضری رجسٹر سنک انتظار'
      + (q.failed ? (' · ' + q.failed + ' ناکام') : '')
      + (q.deadLetter ? (' · ' + q.deadLetter + ' dead-letter') : '');
    list.innerHTML = attRows.map(function (r) {
      var st = _docs[r.docId] || {};
      var err = r.lastError || st.error || '';
      return '<li><code>' + escHtml(r.docId) + '</code>'
        + ' <span class="att-save-queue-type">' + escHtml(r.type) + '</span>'
        + (r.failed ? ' <span class="att-save-queue-fail">ناکام</span>' : '')
        + (err ? '<div class="att-save-queue-err">' + escHtml(String(err).slice(0, 120)) + '</div>' : '')
        + '</li>';
    }).join('') || '<li>قطار خالی</li>';
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderAll() {
    renderChip(global.document && global.document.getElementById('att-save-status-chip'), _smartDocId ? [_smartDocId] : [], true);
    renderChip(global.document && global.document.getElementById('att-col-save-status-chip'), _collectiveDocIds, true);
    renderQueuePanel();
    var legacy = global.document && global.document.getElementById('att-col-saving');
    if (legacy && legacy.classList) {
      var colAgg = pickAggregate(_collectiveDocIds);
      var showLegacy = colAgg.labelKey === 'local_writing';
      legacy.classList.toggle('att-col-hidden', !showLegacy);
      if (showLegacy) legacy.textContent = 'اس آلے پر محفوظ…';
    }
  }

  function emit(docId, patch) {
    log(patch && patch.phase || 'event', docId, patch && patch.cloud ? patch.cloud : (patch && patch.local) || '', patch);
    try {
      global.dispatchEvent(new CustomEvent('ems:att-save-status', {
        detail: Object.assign({ docId: docId, ts: now() }, patch || {})
      }));
    } catch (eEmit) { /* ignore */ }
    renderAll();
  }

  function interpretCloudResult(res) {
    var n = typeof global.emsNormalizeCloudResult === 'function'
      ? global.emsNormalizeCloudResult(res || {}, { localSaved: true })
      : null;
    if (n) {
      return {
        cloud: n.cloudState,
        error: n.error || '',
        code: n.code || '',
        localSaved: n.localSaved,
        synced: n.synced,
        queued: n.queued,
        offline: n.offline
      };
    }
    if (!res) return { cloud: 'failed', error: 'unknown', code: '' };
    if (res.synced) return { cloud: 'synced', error: res.error || '', code: res.code || '' };
    if (res.code === 'VERSION_CONFLICT') {
      return { cloud: 'conflict', error: res.error || '', code: res.code };
    }
    if (res.code === 'TENANT_PENDING' || res.code === 'TENANT_MISMATCH' || res.code === 'TENANT_REQUIRED') {
      return { cloud: 'queued', error: res.error || res.reason || '', code: res.code };
    }
    if (res.code === 'PERMISSION_DENIED' || res.code === 'permission-denied') {
      return { cloud: 'failed', error: res.error || 'permission denied', code: res.code };
    }
    if (res.offline || res.queued) {
      return { cloud: res.offline ? 'offline' : 'queued', error: res.error || '', code: res.code || '' };
    }
    if (res.ok === false) return { cloud: 'failed', error: res.error || res.reason || '', code: res.code || '' };
    return { cloud: 'queued', error: res.error || '', code: res.code || '' };
  }

  global.attNormalizeSaveResult = function (res, extras) {
    if (typeof global.emsNormalizeCloudResult === 'function') {
      return global.emsNormalizeCloudResult(res, extras);
    }
    var parsed = interpretCloudResult(res || {});
    return {
      localSaved: extras && extras.localSaved != null ? !!extras.localSaved : true,
      cloudState: parsed.cloud,
      synced: parsed.cloud === 'synced',
      queued: parsed.cloud === 'queued',
      offline: parsed.cloud === 'offline',
      error: parsed.error || '',
      code: parsed.code || '',
      ok: extras && extras.localSaved === false ? false : true
    };
  };

  function refreshQueueSummary() {
    var chain = Promise.resolve({ pending: 0, failed: 0, deadLetter: 0, rows: [] });
    if (typeof global.emsOfflineGetSyncFailureState === 'function') {
      chain = global.emsOfflineGetSyncFailureState();
    }
    return chain.then(function (state) {
      state = state || {};
      var rows = [];
      if (typeof global.emsOfflineListQueue === 'function') {
        return global.emsOfflineListQueue().then(function (qRows) {
          rows = qRows || [];
          _lastQueueSummary = {
            pending: state.pending != null ? state.pending : rows.length,
            failed: state.failed || 0,
            deadLetter: state.deadLetter || 0,
            rows: rows
          };
          rows.filter(function (r) { return r && isAttQueueType(r.type) && r.docId; }).forEach(function (r) {
            if (r.failed) {
              var parsed = interpretCloudResult({
                ok: false,
                error: r.lastError,
                code: r.lastErrorCode,
                synced: false
              });
              global.attSaveStatusMarkCloud(r.docId, parsed.cloud, parsed);
            } else {
              global.attSaveStatusMarkCloud(r.docId, 'queued');
            }
          });
          renderAll();
          return _lastQueueSummary;
        });
      }
      _lastQueueSummary = { pending: state.pending || 0, failed: state.failed || 0, deadLetter: state.deadLetter || 0, rows: [] };
      renderAll();
      return _lastQueueSummary;
    }).catch(function () { return _lastQueueSummary; });
  }

  function scheduleQueueRefresh() {
    if (typeof global.setTimeout !== 'function') {
      refreshQueueSummary();
      return;
    }
    if (_queueRefreshTimer) clearTimeout(_queueRefreshTimer);
    _queueRefreshTimer = setTimeout(function () {
      _queueRefreshTimer = null;
      refreshQueueSummary();
    }, 400);
  }

  function toggleQueuePanel(show) {
    var panel = global.document && global.document.getElementById('att-save-queue-panel');
    if (!panel) return;
    var open = show != null ? !!show : panel.classList.contains('att-col-hidden');
    panel.classList.toggle('att-col-hidden', !open);
    if (open) refreshQueueSummary();
  }

  global.attSaveStatusSetSmartDoc = function (docId) {
    _smartDocId = docId || null;
    renderAll();
  };

  global.attSaveStatusSetCollectiveDocs = function (docIds) {
    _collectiveDocIds = Array.isArray(docIds) ? docIds.filter(Boolean) : [];
    renderAll();
  };

  global.attSaveStatusMarkLocal = function (docId, state) {
    var d = ensureDoc(docId);
    if (!d) return;
    d.local = state || 'idle';
    d.updatedAt = now();
    if (state !== 'failed') d.error = '';
    emit(docId, { local: d.local, phase: 'local' });
  };

  global.attSaveStatusMarkCloud = function (docId, state, meta) {
    var d = ensureDoc(docId);
    if (!d) return;
    d.cloud = state || 'idle';
    d.updatedAt = now();
    if (meta && meta.error) d.error = meta.error;
    if (meta && meta.code) d.code = meta.code;
    emit(docId, Object.assign({ cloud: d.cloud, phase: 'cloud' }, meta || {}));
    if (state === 'queued' || state === 'offline' || state === 'conflict' || state === 'failed') scheduleQueueRefresh();
  };

  global.attSaveStatusOnCloudResult = function (docId, res) {
    var parsed = interpretCloudResult(res || {});
    global.attSaveStatusMarkCloud(docId, parsed.cloud, parsed);
    scheduleQueueRefresh();
  };

  global.attSaveStatusOnOutboxEvent = function (detail) {
    detail = detail || {};
    if (!detail.docId || !isAttQueueType(detail.type)) return;
    if (detail.cloud) {
      global.attSaveStatusMarkCloud(detail.docId, detail.cloud, detail);
    } else if (detail.synced) {
      global.attSaveStatusMarkCloud(detail.docId, 'synced');
    } else if (detail.code === 'VERSION_CONFLICT') {
      global.attSaveStatusMarkCloud(detail.docId, 'conflict', detail);
    } else if (detail.error || detail.code) {
      global.attSaveStatusMarkCloud(detail.docId, 'failed', detail);
    }
    scheduleQueueRefresh();
  };

  global.attSaveStatusRefreshQueue = refreshQueueSummary;

  global.attSaveStatusRetryPending = function (opts) {
    opts = opts || {};
    log('retry', '', opts.forceLocal ? 'force-local' : 'normal', opts);
    var chain;
    if (opts.forceLocal && typeof global.emsOfflineListQueue === 'function') {
      chain = global.emsOfflineListQueue().then(function (rows) {
        var attRows = (rows || []).filter(function (r) { return r && isAttQueueType(r.type); });
        return Promise.all(attRows.map(function (row) {
          row.meta = Object.assign({}, row.meta || {}, { forceLocal: true });
          row.failed = false;
          row.retryCount = 0;
          if (typeof global.emsOfflineFlushMutationRow === 'function') {
            return global.emsOfflineFlushMutationRow(row);
          }
          return Promise.resolve({ ok: false });
        }));
      });
    } else if (typeof global.emsOfflineRetryFailedSync === 'function') {
      chain = global.emsOfflineRetryFailedSync();
    } else if (typeof global.emsCloudFlushPendingMutations === 'function') {
      chain = global.emsCloudFlushPendingMutations();
    } else {
      chain = Promise.resolve({ ok: false, reason: 'no_flush' });
    }
    return chain.then(function (res) {
      scheduleQueueRefresh();
      if (typeof global.showToast === 'function') {
        global.showToast('حاضری سنک دوبارہ کوشش — پس منظر میں', 'info');
      }
      return res;
    });
  };

  function bindUi() {
    var doc = global.document;
    if (!doc) return;
    ['att-save-status-chip', 'att-col-save-status-chip'].forEach(function (id) {
      var el = doc.getElementById(id);
      if (el && !el._attSaveBound && typeof el.addEventListener === 'function') {
        el._attSaveBound = true;
        el.addEventListener('click', function () { toggleQueuePanel(true); });
      }
    });
    var closeBtn = doc.getElementById('att-save-queue-close');
    if (closeBtn && !closeBtn._attSaveBound && typeof closeBtn.addEventListener === 'function') {
      closeBtn._attSaveBound = true;
      closeBtn.addEventListener('click', function () { toggleQueuePanel(false); });
    }
    var retryBtn = doc.getElementById('att-save-queue-retry');
    if (retryBtn && !retryBtn._attSaveBound && typeof retryBtn.addEventListener === 'function') {
      retryBtn._attSaveBound = true;
      retryBtn.addEventListener('click', function () { global.attSaveStatusRetryPending({}); });
    }
    var forceBtn = doc.getElementById('att-save-queue-force');
    if (forceBtn && !forceBtn._attSaveBound && typeof forceBtn.addEventListener === 'function') {
      forceBtn._attSaveBound = true;
      forceBtn.addEventListener('click', function () { global.attSaveStatusRetryPending({ forceLocal: true }); });
    }
  }

  function bind() {
    if (_bound) return;
    _bound = true;
    if (typeof global.addEventListener !== 'function') return;
    global.addEventListener('ems:att-save-status', function (ev) {
      if (ev && ev.detail && ev.detail.docId && ev.detail.source === 'outbox') {
        global.attSaveStatusOnOutboxEvent(ev.detail);
      }
    });
    global.addEventListener('ems:sync-failure', function (ev) {
      var d = (ev && ev.detail) || {};
      if (!isAttQueueType(d.type) || !d.docId) {
        scheduleQueueRefresh();
        return;
      }
      global.attSaveStatusMarkCloud(d.docId, 'failed', d);
    });
    global.addEventListener('online', function () {
      (_collectiveDocIds.concat(_smartDocId ? [_smartDocId] : [])).forEach(function (id) {
        var st = _docs[id];
        if (st && (st.cloud === 'offline' || st.cloud === 'queued')) {
          global.attSaveStatusMarkCloud(id, 'syncing');
        }
      });
      scheduleQueueRefresh();
    });
    if (global.document && global.document.readyState !== 'loading') bindUi();
    else if (global.document) global.document.addEventListener('DOMContentLoaded', bindUi);
  }

  global.attSaveStatusBoot = function () {
    bind();
    bindUi();
    refreshQueueSummary();
    renderAll();
  };

  bind();
})(typeof window !== 'undefined' ? window : globalThis);
