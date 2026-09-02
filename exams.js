    // ================= 9. امتحانات (Exams - Final Pro Plan) =================

  /** Durable-aware read — exam keys live in IDB/memory, not localStorage. */
  function exmReadRaw(key) {
    if (!key) return null;
    if (typeof window.emsCacheGetRaw === 'function') {
      var cached = window.emsCacheGetRaw(key);
      if (cached != null && cached !== '') return cached;
    }
    if (typeof window.emsDurableReadRaw === 'function'
        && typeof window.emsIsLargeBlobKey === 'function'
        && window.emsIsLargeBlobKey(key)) {
      var durable = window.emsDurableReadRaw(key);
      if (durable != null && durable !== '') return durable;
    }
    if (typeof window.emsSafeLocalGet === 'function') return window.emsSafeLocalGet(key);
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function exmReadJson(key, fallback) {
    try {
      var raw = exmReadRaw(key);
      if (raw == null || raw === '') {
        return fallback !== undefined ? fallback : null;
      }
      return JSON.parse(raw);
    } catch (e) {
      if (key && typeof window.showToast === 'function') {
        window._exmJsonWarned = window._exmJsonWarned || Object.create(null);
        if (!window._exmJsonWarned[key]) {
          window._exmJsonWarned[key] = true;
          window.showToast('امتحانات کا ڈیٹا خراب لگ رہا ہے (' + key + ') — کلاؤڈ سے بحالی کریں', 'error');
        }
      }
      return fallback !== undefined ? fallback : null;
    }
  }

  var EXM_DEFAULT_EXAM_TYPES = ['ماہانہ امتحان', 'سہ ماہی امتحان', 'ششماہی امتحان', 'سالانہ امتحان'];
  var EXM_BLOB_KEYS = [
    'ems_exam_types',
    'ems_library_books',
    'ems_exam_templates',
    'ems_exam_locks',
    'ems_master_sheet_meta'
  ];

  function exmWarmCacheAfterSave(key, str) {
    if (typeof window.emsCacheSet === 'function') {
      try { window.emsCacheSet(key, str); } catch (eCache) { /* ignore */ }
    }
  }

  /** IndexedDB blobs → memory before sync reads (dates/templates after reload). */
  function exmEnsureBlobsReady() {
    if (typeof window.emsDurableEnsureKey !== 'function') return Promise.resolve();
    return EXM_BLOB_KEYS.reduce(function (chain, key) {
      return chain.then(function () { return window.emsDurableEnsureKey(key); });
    }, Promise.resolve());
  }
  window.exmEnsureBlobsReady = exmEnsureBlobsReady;

  var _exmExamsPersistChain = Promise.resolve();
  var _exmMarksSaveBusy = false;

  window.exmRunExamsPersist = function (task) {
    _exmExamsPersistChain = _exmExamsPersistChain.then(task).catch(function (err) {
      console.error('exmRunExamsPersist', err);
      throw err;
    });
    return _exmExamsPersistChain;
  };

  function exmStaffHasExamsEdit() {
    if (window.exmIsAdminOrOwner()) return true;
    if (typeof window.emsIsStaffUser === 'function' && !window.emsIsStaffUser()) return true;
    return typeof window.checkStaffModuleAccess === 'function'
      && window.checkStaffModuleAccess('exams', 'edit');
  }

  function exmStaffHasExamsView() {
    if (window.exmIsAdminOrOwner()) return true;
    if (typeof window.emsIsStaffUser === 'function' && !window.emsIsStaffUser()) return true;
    if (typeof window.checkStaffModuleAccess === 'function') {
      return window.checkStaffModuleAccess('exams', 'view') || window.checkStaffModuleAccess('exams', 'edit');
    }
    return true;
  }

  function exmPurgeUnscopedLegacyKey(baseKey) {
    if (!baseKey) return;
    try {
      if (window._emsOriginalRemoveItem) window._emsOriginalRemoveItem.call(localStorage, baseKey);
      else localStorage.removeItem(baseKey);
    } catch (ePur) { /* ignore */ }
  }

  function exmStampBlobOwner(baseKey) {
    var tid = typeof window.emsGetCanonicalTenantId === 'function'
      ? window.emsGetCanonicalTenantId()
      : (window.EMS_ACTIVE_TENANT_ID || window.CURRENT_MADRASA_TENANT_ID || null);
    if (!tid || !baseKey) return;
    try {
      var ownerKey = 'ems_blob_owner__' + baseKey;
      if (window._emsOriginalSetItem) window._emsOriginalSetItem.call(localStorage, ownerKey, String(tid));
      else localStorage.setItem(ownerKey, String(tid));
    } catch (eOwn) { /* ignore */ }
  }

  function exmEnsureQuarterlyExamType(types) {
    if (!Array.isArray(types)) types = [];
    var quarterly = 'سہ ماہی امتحان';
    if (types.indexOf(quarterly) >= 0) return { types: types, changed: false };
    var monthlyIdx = types.indexOf('ماہانہ امتحان');
    if (monthlyIdx >= 0) types.splice(monthlyIdx + 1, 0, quarterly);
    else {
      var halfIdx = types.indexOf('ششماہی امتحان');
      if (halfIdx >= 0) types.splice(halfIdx, 0, quarterly);
      else types.push(quarterly);
    }
    return { types: types, changed: true };
  }

  function emsSaveKey(key, val, opts) {
    var options = Object.assign({ mutation: true, autoDelta: true }, opts || {});
    var str = typeof val === 'string' ? val : JSON.stringify(val);
    // Do NOT pre-write durable here — emsSaveModuleData must read oldStr first
    // so array/blob cloud deltas (outbox / Firestore) are non-empty.
    var p = window.emsSaveModuleData
      ? window.emsSaveModuleData(key, str, options)
      : (localStorage.setItem(key, str), Promise.resolve());
    return Promise.resolve(p).then(function (res) {
      exmWarmCacheAfterSave(key, str);
      if (typeof window.emsLogAudit === 'function') {
        window.emsLogAudit('exams', 'save', key, { storageKey: key });
      }
      return res;
    });
  }

  function exmGetUsers() {
    var users = typeof window.emsGetUsersSync === 'function'
      ? window.emsGetUsersSync()
      : (typeof window.emsGetUsersMerged === 'function' ? window.emsGetUsersMerged() : []);
    if (typeof window.emsFilterByDepartment === 'function') {
      return window.emsFilterByDepartment(users);
    }
    return users;
  }

  // =========================================================
  // Phase B — RBAC, result lock, role helpers
  // =========================================================
  var EXM_LOCKS_KEY = 'ems_exam_locks';

  window.exmIsAdminOrOwner = function () {
    if (typeof window.isSuperAdmin === 'function' && window.isSuperAdmin()) return true;
    if (typeof window.isMadrasaAdmin === 'function' && window.isMadrasaAdmin()) return true;
    if (typeof window.emsIsTenantOwner === 'function' && window.emsIsTenantOwner()) return true;
    return false;
  };

  window.exmIsTeacherOnly = function () {
    if (window.exmIsAdminOrOwner()) return false;
    return !!(typeof window.emsIsStaffUser === 'function' && window.emsIsStaffUser());
  };

  window.exmGetCurrentTeacherName = function () {
    var staff = typeof window.emsGetStaffRecordForCurrentUser === 'function'
      ? window.emsGetStaffRecordForCurrentUser()
      : null;
    if (staff && staff.name) return String(staff.name).trim();
    if (window.CURRENT_USER_DISPLAY_NAME) return String(window.CURRENT_USER_DISPLAY_NAME).trim();
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
      var u = firebase.auth().currentUser;
      return String(u.displayName || u.email || u.uid || '').trim();
    }
    return '';
  };

  function exmTeacherNamesMatch(assigned, current) {
    if (!assigned || !current) return false;
    return String(assigned).trim().toLowerCase() === String(current).trim().toLowerCase();
  }

  function exmReadLocks() {
    try {
      return exmReadJson(EXM_LOCKS_KEY, {});
    } catch (e) {
      return {};
    }
  }

  function exmLockStorageKey(examName, cls, resultDate) {
    var base = String(examName || '').trim() + '||' + String(cls || '').trim();
    var d = resultDate ? String(resultDate).trim().slice(0, 10) : '';
    return d ? (base + '||' + d) : base;
  }

  function exmPad2(n) {
    return (n < 10 ? '0' : '') + String(n);
  }

  function exmTodayYmd() {
    var d = new Date();
    return d.getFullYear() + '-' + exmPad2(d.getMonth() + 1) + '-' + exmPad2(d.getDate());
  }

  /** نتیجے کی تاریخ — نئے ریکارڈز میں resultDate؛ پرانے میں timestamp سے */
  function exmResultDateOf(m) {
    if (!m) return '';
    if (m.resultDate) return String(m.resultDate).trim().slice(0, 10);
    if (m.timestamp) {
      var d = new Date(m.timestamp);
      if (!isNaN(d.getTime())) {
        return d.getFullYear() + '-' + exmPad2(d.getMonth() + 1) + '-' + exmPad2(d.getDate());
      }
    }
    return '';
  }

  function exmResultIdentityMatches(a, b) {
    if (!a || !b) return false;
    return String(a.examName || '').trim() === String(b.examName || '').trim()
      && String(a.class || '').trim() === String(b.class || '').trim()
      && String(a.studentId == null ? '' : a.studentId).trim() === String(b.studentId == null ? '' : b.studentId).trim()
      && exmResultDateOf(a) === exmResultDateOf(b);
  }

  function exmIdentityHash(value, seed) {
    var h = seed >>> 0;
    var str = String(value || '');
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  /** ایک ہی طالب علم/امتحان/درجہ/تاریخ کے لیے ہر آلے پر یکساں ID۔ */
  window.exmCanonicalResultId = function (examName, cls, studentId, resultDate) {
    var key = [examName, cls, studentId, resultDate].map(function (v) {
      return String(v == null ? '' : v).trim().toLocaleLowerCase();
    }).join('||');
    return 'RES-' + exmIdentityHash(key, 2166136261) + exmIdentityHash(key, 2246822519);
  };

  /** Identity-based upsert؛ پرانی duplicate rows بھی اسی save میں ختم ہو جاتی ہیں۔ */
  window.exmUpsertResultByIdentity = function (rows, record) {
    rows = Array.isArray(rows) ? rows : [];
    var matches = [];
    for (var i = 0; i < rows.length; i++) {
      if (exmResultIdentityMatches(rows[i], record)) matches.push(i);
    }
    if (!matches.length) {
      record.id = record.id || window.exmCanonicalResultId(record.examName, record.class, record.studentId, exmResultDateOf(record));
      rows.push(record);
      return { inserted: true, updated: false, duplicatesRemoved: 0, record: record };
    }
    var keepIndex = matches[0];
    matches.forEach(function (idx) {
      if (Number(rows[idx] && rows[idx].timestamp || 0) > Number(rows[keepIndex] && rows[keepIndex].timestamp || 0)) keepIndex = idx;
    });
    record.id = (rows[keepIndex] && rows[keepIndex].id)
      || record.id
      || window.exmCanonicalResultId(record.examName, record.class, record.studentId, exmResultDateOf(record));
    rows[keepIndex] = record;
    var removed = 0;
    for (var ri = matches.length - 1; ri >= 0; ri--) {
      var duplicateIndex = matches[ri];
      if (duplicateIndex === keepIndex) continue;
      rows.splice(duplicateIndex, 1);
      removed++;
      if (duplicateIndex < keepIndex) keepIndex--;
    }
    return { inserted: false, updated: true, duplicatesRemoved: removed, record: record };
  };

  function exmReadResultDateInput(prefix) {
    var el = document.getElementById(prefix + '-result-date');
    return el && el.value ? String(el.value).trim().slice(0, 10) : '';
  }

  function exmResolveResultDateForContext(prefix) {
    return exmReadResultDateInput(prefix) || exmTodayYmd();
  }

  function exmNormClass(cls) {
    return String(cls == null ? '' : cls).trim().replace(/\s+/g, ' ');
  }

  function exmClassEquals(a, b) {
    return exmNormClass(a) === exmNormClass(b);
  }

  /** رجسٹرڈ طلبہ — درجہ نام کی خالی جگہ / ہجے کی معمولی تفریق برداشت۔ */
  function exmStudentsInClass(cls) {
    var want = exmNormClass(cls);
    if (!want) return [];
    return exmGetUsers().filter(function (u) {
      return u && u.type === 'student' && exmClassEquals(u.class, want);
    });
  }

  function exmFindClassTpl(templates, cls) {
    var want = exmNormClass(cls);
    return (templates || []).find(function (t) { return t && exmClassEquals(t.class, want); }) || null;
  }

  /**
   * تجزیہ: ایک طالب علم ایک بار — ایک ہی امتحان+درجہ+تاریخ پر متعدد ریکارڈ ہوں تو تازہ ترین رکھیں۔
   * اختیاری: صرف رجسٹرڈ طلبہ (پرانا/منتقل شدہ نتیجہ الگ گنتی میں)۔
   */
  function exmDedupeAnalysisRows(list, opts) {
    opts = opts || {};
    var bySid = Object.create(null);
    (list || []).forEach(function (m) {
      if (!m) return;
      var sid = String(m.studentId == null ? '' : m.studentId).trim();
      if (!sid) sid = '__name__' + String(m.studentName || '').trim();
      var key = opts.uniqueStudent
          ? (sid + '||' + exmNormClass(m.class))
          : (sid + '||' + exmNormClass(m.class) + '||' + exmResultDateOf(m));
      var prev = bySid[key];
      if (!prev || Number(m.timestamp || 0) >= Number(prev.timestamp || 0)) bySid[key] = m;
    });
    var rows = Object.keys(bySid).map(function (k) { return bySid[k]; });
    var orphaned = 0;
    if (opts.activeOnly) {
      var activeIds = Object.create(null);
      (opts.activeStudents || []).forEach(function (s) {
        if (s && s.id != null) activeIds[String(s.id).trim()] = true;
      });
      var kept = [];
      rows.forEach(function (m) {
        var sid = String(m.studentId == null ? '' : m.studentId).trim();
        if (activeIds[sid]) kept.push(m);
        else orphaned++;
      });
      rows = kept;
    }
    return { rows: rows, orphaned: orphaned, rawCount: (list || []).length };
  }

  /** نئی شیٹ: تاریخ خالی ہو تو آج کی تاریخ خودکار بھر دیں۔ */
  function exmEnsureResultDateFilled(prefix) {
    var el = document.getElementById(prefix + '-result-date');
    if (!el) return exmTodayYmd();
    var v = String(el.value || '').trim().slice(0, 10);
    if (v) return v;
    var today = exmTodayYmd();
    el.value = today;
    return today;
  }

  function exmFormatResultDateLabel(ymd) {
    if (!ymd) return '—';
    var parts = String(ymd).split('-');
    if (parts.length !== 3) return ymd;
    return parts[2] + '-' + parts[1] + '-' + parts[0];
  }

  /** ایک امتحان+درجہ کی محفوظ شدہ تمام تواریخ (نیا سے پرانا) */
  function exmListResultDates(examName, cls) {
    var dbMarks = exmReadJson(DB.exams, []);
    var set = Object.create(null);
    (dbMarks || []).forEach(function (m) {
      if (!m) return;
      if (examName && m.examName !== examName) return;
      if (cls && m.class !== cls) return;
      var d = exmResultDateOf(m);
      if (d) set[d] = true;
    });
    return Object.keys(set).sort(function (a, b) { return b.localeCompare(a); });
  }

  function exmFindStudentResult(dbMarks, examName, cls, studentId, resultDate) {
    var want = resultDate ? String(resultDate).slice(0, 10) : '';
    var exact = null;
    for (var i = 0; i < (dbMarks || []).length; i++) {
      var m = dbMarks[i];
      if (!m || m.examName !== examName || !exmClassEquals(m.class, cls)
          || String(m.studentId == null ? '' : m.studentId) !== String(studentId == null ? '' : studentId)) continue;
      var d = exmResultDateOf(m);
      if (want && d === want && (!exact || Number(m.timestamp || 0) > Number(exact.timestamp || 0))) exact = m;
    }
    if (exact) return exact;
    return null;
  }

  window.exmRefreshResultDateOptions = function (prefix) {
    prefix = prefix || 'mrk';
    var examEl = document.getElementById(prefix + '-exam-name');
    var classId = prefix === 'mrk' ? 'mrk-class' : (prefix === 'ana' ? 'ana-class' : 'res-class');
    var classEl = document.getElementById(classId);
    var dateEl = document.getElementById(prefix + '-result-date');
    var sessEl = document.getElementById(prefix + '-result-session');
    if (!dateEl) return;
    var examName = examEl ? examEl.value : '';
    var cls = classEl ? classEl.value : '';
    var dates = exmListResultDates(examName, cls);
    if (sessEl) {
      var cur = dateEl.value;
      var html = '<option value="">— نیا / دستی تاریخ —</option>';
      dates.forEach(function (d) {
        html += '<option value="' + d + '">' + exmFormatResultDateLabel(d) +
          (d === exmTodayYmd() ? ' (آج)' : '') + '</option>';
      });
      sessEl.innerHTML = html;
      if (cur && dates.indexOf(cur) >= 0) sessEl.value = cur;
      else if (!cur) sessEl.value = '';
    }
  };

  window.exmOnResultSessionPick = function (prefix) {
    prefix = prefix || 'mrk';
    var sessEl = document.getElementById(prefix + '-result-session');
    var dateEl = document.getElementById(prefix + '-result-date');
    if (!sessEl || !dateEl) return;
    if (sessEl.value) dateEl.value = sessEl.value;
    else dateEl.value = '';
  };

  window.exmIsExamLocked = function (examName, cls, resultDate) {
    if (!examName || !cls) return false;
    var locks = exmReadLocks();
    var d = resultDate ? String(resultDate).slice(0, 10) : '';
    if (d) {
      var dated = locks[exmLockStorageKey(examName, cls, d)];
      if (dated && dated.locked) return true;
      return false;
    }
    var legacy = locks[exmLockStorageKey(examName, cls)];
    return !!(legacy && legacy.locked);
  };

  function exmIsMarksContextLocked() {
    var examName = (document.getElementById('mrk-exam-name') || {}).value;
    var cls = (document.getElementById('mrk-class') || {}).value;
    var resultDate = exmReadResultDateInput('mrk') || exmTodayYmd();
    return window.exmIsExamLocked(examName, cls, resultDate);
  }

  window.exmCanEditBookColumn = function (book) {
    if (exmIsMarksContextLocked()) return false;
    if (!exmStaffHasExamsEdit()) return false;
    if (window.exmIsAdminOrOwner()) return true;
    if (!window.exmIsTeacherOnly()) return true;
    var current = window.exmGetCurrentTeacherName();
    if (!book || !book.teacher) return true;
    return exmTeacherNamesMatch(book.teacher, current);
  };

  window.exmUpdateLockUi = function () {
    var marksExam = (document.getElementById('mrk-exam-name') || {}).value;
    var marksCls = (document.getElementById('mrk-class') || {}).value;
    var marksDate = exmResolveResultDateForContext('mrk');
    var resExam = (document.getElementById('res-exam-name') || {}).value;
    var resCls = (document.getElementById('res-class') || {}).value;
    var resDate = exmResolveResultDateForContext('res');

    var marksLocked = window.exmIsExamLocked(marksExam, marksCls, marksDate);
    var marksBadge = document.getElementById('exm-marks-lock-badge');
    if (marksBadge) marksBadge.style.display = marksLocked ? 'flex' : 'none';

    var resBadge = document.getElementById('exm-result-lock-badge');
    if (resBadge) resBadge.style.display = window.exmIsExamLocked(resExam, resCls, resDate) ? 'flex' : 'none';

    var toolbar = document.getElementById('exm-lock-toolbar');
    var toggleBtn = document.getElementById('btn-exm-lock-toggle');
    var lockMeta = document.getElementById('exm-lock-meta');
    if (toolbar) toolbar.style.display = window.exmIsAdminOrOwner() ? 'flex' : 'none';

    if (toggleBtn) {
      var resLocked = window.exmIsExamLocked(resExam, resCls, resDate);
      toggleBtn.disabled = !resExam || !resCls;
      toggleBtn.innerHTML = resLocked
        ? '<i class="fas fa-unlock"></i> نتیجہ کھولیں (Unlock)'
        : '<i class="fas fa-lock"></i> نتیجہ لاک کریں';
      toggleBtn.className = resLocked ? 'btn btn-warning' : 'btn btn-danger';
    }

    if (lockMeta) {
      var entry = exmReadLocks()[exmLockStorageKey(resExam, resCls, resDate)]
        || exmReadLocks()[exmLockStorageKey(resExam, resCls)];
      if (entry && entry.locked) {
        var when = entry.lockedAt ? new Date(entry.lockedAt).toLocaleString('ur-PK') : '—';
        lockMeta.textContent = 'لاک: ' + (entry.lockedBy || '—') + ' | ' + when +
          (resDate ? (' | تاریخ: ' + exmFormatResultDateLabel(resDate)) : '');
        lockMeta.style.display = 'block';
      } else {
        lockMeta.style.display = 'none';
      }
    }

    window.exmApplyMarksLockUi();
  };

  window.exmApplyMarksLockUi = function () {
    var locked = exmIsMarksContextLocked();
    var saveBtn = document.getElementById('btn-save-all-marks');
    var dataPageBtn = document.getElementById('btn-exam-data-page');
    var frBtn = document.getElementById('btn-find-replace');
    var frMarks = document.getElementById('fr-marks');

    if (saveBtn) {
      saveBtn.disabled = locked;
      saveBtn.title = locked ? 'یہ نتیجہ لاک ہو چکا ہے' : '';
    }
    if (dataPageBtn) dataPageBtn.title = locked
      ? 'یہ نتیجہ لاک ہے؛ ایکسپورٹ دستیاب ہے مگر اسی دائرے میں امپورٹ محفوظ نہیں ہوگا'
      : 'امپورٹ اور ایکسپورٹ کے الگ صفحے پر جائیں';
    if (frBtn) frBtn.disabled = locked;
    if (frMarks) frMarks.disabled = locked;

    document.querySelectorAll('.mark-val-input').forEach(function (inp) {
      var subject = inp.getAttribute('data-subject');
      var book = currentClassTemplateBooks.find(function (b) { return b.name === subject; });
      var canEdit = window.exmCanEditBookColumn(book);
      inp.disabled = !canEdit;
      inp.readOnly = !canEdit;
      if (!canEdit) {
        inp.title = locked ? 'یہ نتیجہ لاک ہو چکا ہے' : 'آپ اس مضمون کے مجاز استاد نہیں';
      }
    });
    if (typeof window.examUpdateDataPageState === 'function') window.examUpdateDataPageState();
  };

  window.exmToggleExamLock = function () {
    if (!window.exmIsAdminOrOwner()) {
      return showToast('صرف ایڈمن نتیجہ لاک / کھول سکتا ہے', 'error');
    }
    var examName = (document.getElementById('res-exam-name') || {}).value;
    var cls = (document.getElementById('res-class') || {}).value;
    var resultDate = exmResolveResultDateForContext('res');
    if (!examName || !cls) return showToast('امتحان اور درجہ منتخب کریں!', 'error');

    var locks = exmReadLocks();
    var key = exmLockStorageKey(examName, cls, resultDate);
    var legacyKey = exmLockStorageKey(examName, cls);
    var isLocked = (locks[key] && locks[key].locked) || (locks[legacyKey] && locks[legacyKey].locked);
    if (isLocked) {
      if (!confirm('کیا آپ واقعی اس تاریخ (' + exmFormatResultDateLabel(resultDate) + ') کا نتیجہ کھولنا چاہتے ہیں؟')) return;
      delete locks[key];
      delete locks[legacyKey];
      emsSaveKey(EXM_LOCKS_KEY, JSON.stringify(locks));
      showToast('نتیجہ کھولا گیا — نمبرات اب تبدیل ہو سکتے ہیں', 'success');
    } else {
      if (!confirm('لاک کے بعد اس تاریخ کا نتیجہ تبدیل نہیں ہو سکے گا جب تک آپ دوبارہ نہ کھولیں۔')) return;
      locks[key] = {
        locked: true,
        lockedAt: Date.now(),
        lockedBy: window.exmGetCurrentTeacherName() || 'ایڈمن',
        resultDate: resultDate
      };
      emsSaveKey(EXM_LOCKS_KEY, JSON.stringify(locks));
      showToast('نتیجہ کامیابی سے لاک ہو گیا (' + exmFormatResultDateLabel(resultDate) + ')', 'success');
    }
    window.exmUpdateLockUi();
    if (currentGridData.length) renderMarksGrid();
  };

    // printDiv lives in ems-utils.js (global). Never install a stub that blocks printing.
    if (typeof window.printDiv !== 'function') {
      window.printDiv = function (divId) {
        var el = document.getElementById(divId);
        if (!el) {
          if (typeof window.showToast === 'function') window.showToast('پرنٹ ایریا نہیں ملا', 'error');
          return;
        }
        var w = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
        if (!w) {
          if (typeof window.showToast === 'function') window.showToast('پرنٹ ونڈو نہیں کھلی', 'error');
          return;
        }
        w.document.write('<!DOCTYPE html><html dir="rtl" lang="ur"><head><meta charset="utf-8"><title>پرنٹ</title>' +
          '<style>body{font-family:"Noto Nastaliq Urdu",serif;direction:rtl;padding:14px;}' +
          'table{border-collapse:collapse;width:100%;} th,td{border:1px solid #333;padding:6px;}' +
          '@media print{body,body *{visibility:visible!important;}}</style></head><body>' +
          el.innerHTML + '</body></html>');
        w.document.close();
        setTimeout(function () { try { w.focus(); w.print(); } catch (eP) { /* ignore */ } }, 400);
      };
    }

  // =========================================================
  // جدید نیویگیشن + ڈیفالٹ صفحہ + ماڈیول علیحدگی (مرحلہ 1)
  // =========================================================
  window._exmDropdownGen = -1;
  window._exmActiveTab = 'exam-win-settings';
  window._exmLazyPickersBound = false;

  window.exmEnsureLazyPickers = function () {
    if (window._exmLazyPickersBound) return;
    window._exmLazyPickersBound = true;
    var resClass = document.getElementById('res-class');
    var resStudent = document.getElementById('res-student');
    if (typeof window.emsBindLazyStudentSelect === 'function' && resClass && resStudent) {
      window.emsBindLazyStudentSelect(resStudent, resClass, { moduleActive: window.emsIsExamsModuleActive });
    }
  };

  window.switchExamTab = function (tabId, btn) {
    if (typeof window.emsIsExamsModuleActive === 'function' && !window.emsIsExamsModuleActive()) return;
    if (typeof window.emsCloseAllModals === 'function') window.emsCloseAllModals();
    document.querySelectorAll('#module-exams .exam-tab-content').forEach(function (el) { el.style.display = 'none'; });
    var panel = document.getElementById(tabId);
    if (panel) panel.style.display = 'block';
    document.querySelectorAll('#exam-ribbon-menu .reg-tab').forEach(function (b) { b.classList.remove('active-sub-tab'); });
    if (btn) btn.classList.add('active-sub-tab');
    window._exmActiveTab = tabId;
    if (typeof window.refreshExamData === 'function') window.refreshExamData(tabId);
  };

  window.emsOpenExams = function () {
    if (typeof window.emsCloseAllModals === 'function') window.emsCloseAllModals();
    var firstBtn = document.querySelector('#exam-ribbon-menu [onclick*="exam-win-settings"]');
    window.switchExamTab('exam-win-settings', firstBtn);
  };

  window.refreshExamData = function (activeTabId) {
      if (typeof window.emsIsExamsModuleActive === 'function' && !window.emsIsExamsModuleActive()) return;
      activeTabId = activeTabId || window._exmActiveTab || 'exam-win-settings';

      function exmRefreshExamDataInner() {
      (function exmRefreshCurriculumLibrary() {
          function afterLibReady() {
              if (typeof window.curSyncFromLibrary === 'function') {
                  try { window.curSyncFromLibrary(); } catch (eSync) { /* ignore */ }
              }
              if (typeof window.curRenderPlanning === 'function'
                  && document.getElementById('module-curriculum')
                  && document.getElementById('module-curriculum').classList.contains('active')) {
                  try { window.curRenderPlanning(); } catch (eCur) { /* ignore */ }
              }
          }
          if (typeof window.curEnsureLibraryReady === 'function') {
              window.curEnsureLibraryReady().then(afterLibReady).catch(afterLibReady);
          } else {
              afterLibReady();
          }
      })();

      var gen = typeof window.emsReadRepoCacheGen === 'function' ? window.emsReadRepoCacheGen() : 0;
      if (window._exmDropdownGen !== gen) {
          window._exmDropdownGen = gen;
          document.querySelectorAll('.exm-dynamic-student').forEach(function (select) {
              select.innerHTML = '<option value="">پہلے درجہ منتخب کریں…</option>';
          });
          document.querySelectorAll('.exm-dynamic-teacher').forEach(function (select) {
              select._emsStaffLazyLoaded = false;
              select.innerHTML = '<option value="">…</option>';
          });
      }
      if (typeof window.exmFillClassSelects === 'function') {
          window.exmFillClassSelects('.exm-dynamic-class');
      } else if (typeof window.emsFillClassSelects === 'function') {
          window.emsFillClassSelects('.exm-dynamic-class');
      }
      if (typeof window.exmEnsureTplAllClassesOption === 'function') {
          window.exmEnsureTplAllClassesOption();
      }

      window.exmEnsureLazyPickers();
      document.querySelectorAll('.exm-dynamic-teacher').forEach(function (select) {
          if (typeof window.emsBindLazyStaffSelect === 'function' && !select._emsStaffLazyLoaded) {
              window.emsBindLazyStaffSelect(select, 'teacher', {
                  moduleActive: window.emsIsExamsModuleActive,
                  valueField: 'name',
                  placeholder: 'استاد منتخب کریں...'
              });
          }
      });

      if (activeTabId === 'exam-win-settings' || activeTabId === 'exam-win-marks' || activeTabId === 'exam-win-schedule' || activeTabId === 'exam-win-template' || activeTabId === 'exam-win-analysis' || activeTabId === 'exam-win-data') {
          renderSettingsData();
          if (activeTabId === 'exam-win-template' && typeof window.exmSyncTimetableBooksToMasterSheet === 'function') {
              try {
                  window.exmSyncTimetableBooksToMasterSheet({ silent: true });
              } catch (eSync) { /* ignore */ }
          }
          renderQuickAccessTabs();
          if (activeTabId === 'exam-win-template') {
              var tplSel = document.getElementById('tpl-class-select');
              if (tplSel && tplSel.value && typeof window.renderTemplateTable === 'function') {
                  window.renderTemplateTable(tplSel.value);
              }
          }
          if (activeTabId === 'exam-win-analysis' && typeof window.exmUpdateAnaScopeUi === 'function') {
              window.exmUpdateAnaScopeUi();
          }
          if (activeTabId === 'exam-win-data' && typeof window.examPrepareDataPage === 'function') {
              window.examPrepareDataPage();
          }
      }
      if (typeof window.examUpdateTplScopePreview === 'function') window.examUpdateTplScopePreview();
      if (typeof window.exmUpdateLockUi === 'function') window.exmUpdateLockUi();
      }

      exmEnsureBlobsReady().then(exmRefreshExamDataInner).catch(exmRefreshExamDataInner);
  };

  /** نصاب شعبے سے امتحانی حصہ — خودکار لنک */
  window.examResolveCurTerm = function (examName) {
      var n = String(examName || '');
      if (/پہلی|اول|first|half\s*1|\bh1\b/i.test(n)) return 'half1';
      if (/دوسری|second|half\s*2|\bh2\b/i.test(n)) return 'half2';
      if (/ششما/i.test(n) && /دوس/i.test(n)) return 'half2';
      if (/ششما/i.test(n)) return 'half1';
      if (/سہ\s*ماہی|سہماہی|quarterly|\bq[1-4]\b/i.test(n)) return 'quarterly';
      if (/سالان|annual|\byear\b/i.test(n)) return 'annual';
      return 'annual';
  };

  window.examGetCurScopeForBook = function (bookName, examName) {
      if (typeof window.curGetExamScope !== 'function') return null;
      return window.curGetExamScope(bookName, window.examResolveCurTerm(examName));
  };

  window.examFormatCurScope = function (scopeObj) {
      if (typeof window.curFormatScopeText === 'function') return window.curFormatScopeText(scopeObj);
      if (!scopeObj || !scopeObj.scope) return '—';
      var sc = scopeObj.scope;
      if (scopeObj.examNote) return scopeObj.examNote;
      if (!sc.toPage) return '—';
      return 'ص ' + sc.fromPage + '–' + sc.toPage + ' / س ' + sc.fromLine + '–' + sc.toLine;
  };

  window.examUpdateTplScopePreview = function () {
      var bookSel = document.getElementById('tpl-book-select');
      var examSel = document.getElementById('sch-exam-name');
      var book = bookSel ? bookSel.value : '';
      var examName = examSel ? examSel.value : 'سالانہ امتحان';
      var box = document.getElementById('tpl-cur-scope-preview');
      var txt = document.getElementById('tpl-cur-scope-text');
      if (!box || !txt) return;
      if (!book) { box.style.display = 'none'; return; }
      box.style.display = 'block';
      var scopeObj = window.examGetCurScopeForBook(book, examName);
      if (scopeObj && scopeObj.scope && scopeObj.scope.toPage) {
          txt.textContent = window.examFormatCurScope(scopeObj);
      } else {
          txt.textContent = 'نصاب میں درج نہیں — شعبۂ نصاب میں منصوبہ بندی کریں';
      }
  };

  document.getElementById('tpl-book-select')?.addEventListener('change', window.examUpdateTplScopePreview);
  document.getElementById('sch-exam-name')?.addEventListener('change', window.examUpdateTplScopePreview);

  function renderSettingsData() {

      var examTypesRaw = exmReadRaw('ems_exam_types');
      let examTypes = exmReadJson('ems_exam_types', EXM_DEFAULT_EXAM_TYPES.slice());
      if (!Array.isArray(examTypes) || !examTypes.length) examTypes = EXM_DEFAULT_EXAM_TYPES.slice();
      var quarterlyMerge = exmEnsureQuarterlyExamType(examTypes);
      examTypes = quarterlyMerge.types;
      // صرف پہلی مرتبہ default بنائیں؛ موجودہ فہرست میں سہ ماہی ایک بار شامل کریں۔
      if (examTypesRaw == null || examTypesRaw === '' || quarterlyMerge.changed) {
        emsSaveKey('ems_exam_types', JSON.stringify(examTypes));
      }

      

      const typeTbody = document.querySelector('#table-exam-names tbody');

      if(typeTbody) {
          typeTbody.textContent = '';
          examTypes.forEach(function (type) {
              var tr = document.createElement('tr');
              var nameTd = document.createElement('td');
              var actionTd = document.createElement('td');
              var editBtn = document.createElement('button');
              var deleteBtn = document.createElement('button');
              nameTd.textContent = type;
              editBtn.className = 'icon-btn edit'; editBtn.innerHTML = '<i class="fas fa-edit"></i>';
              deleteBtn.className = 'icon-btn delete'; deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
              editBtn.addEventListener('click', function () { window.editExamType(type); });
              deleteBtn.addEventListener('click', function () { window.deleteExamType(type); });
              actionTd.appendChild(editBtn); actionTd.appendChild(document.createTextNode(' ')); actionTd.appendChild(deleteBtn);
              tr.appendChild(nameTd); tr.appendChild(actionTd); typeTbody.appendChild(tr);
          });
      }

      document.querySelectorAll('.exm-dynamic-examnames').forEach(sel => {
          let v = sel.value; sel.textContent = '';
          examTypes.forEach(function (t) { var opt = document.createElement('option'); opt.value = t; opt.textContent = t; sel.appendChild(opt); });
          sel.value = v;
      });



      if (typeof window.attMigratePeriodBooksToLibrary === 'function') {
          try { window.attMigratePeriodBooksToLibrary({ skipRefresh: true }); } catch (eMig) { /* ignore */ }
      }

      let libBooks = exmReadJson('ems_library_books', []);
      if (!Array.isArray(libBooks)) libBooks = [];

      const libTbody = document.querySelector('#table-lib-books tbody');

      if(libTbody) {

          libTbody.innerHTML = '';

          libBooks.forEach(function (book) {
              var safeAttr = String(book).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
              var safeText = typeof window.emsSanitize === 'function'
                  ? window.emsSanitize(String(book))
                  : String(book).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              libTbody.innerHTML += '<tr><td>' + safeText + '</td><td>' +
                  '<button class="icon-btn edit" onclick="editLibBook(\'' + safeAttr + '\')"><i class="fas fa-edit"></i></button> ' +
                  '<button class="icon-btn delete" onclick="deleteLibBook(\'' + safeAttr + '\')"><i class="fas fa-trash"></i></button></td></tr>';
          });

      }

      document.querySelectorAll('.exm-dynamic-lib').forEach(sel => {
          let v = sel.value; sel.textContent = '';
          var first = document.createElement('option'); first.value = ''; first.textContent = 'لائبریری سے کتابیں...'; sel.appendChild(first);
          libBooks.forEach(function (b) { var opt = document.createElement('option'); opt.value = b; opt.textContent = b; sel.appendChild(opt); });
          sel.value = v;
      });

      if (typeof window.attRefreshPeriodBookSelect === 'function') {
          try { window.attRefreshPeriodBookSelect(); } catch (eAttLib) { /* ignore */ }
      }

  }



  document.getElementById('btn-add-exam-name')?.addEventListener('click', () => {

      let name = document.getElementById('set-exam-name').value.trim();

      if(!name) return;

      let types = exmReadJson('ems_exam_types', EXM_DEFAULT_EXAM_TYPES.slice());

      if(!types.includes(name)) { types.push(name); emsSaveKey('ems_exam_types', JSON.stringify(types)); document.getElementById('set-exam-name').value = ''; refreshExamData(); }

  });

  window.deleteExamType = function(name) { if(confirm("حذف کریں؟")) { let types = exmReadJson('ems_exam_types', []); emsSaveKey('ems_exam_types', JSON.stringify(types.filter(t => t !== name))); refreshExamData(); } };

  window.editExamType = function(oldName) { let newName = prompt("نیا نام لکھیں:", oldName); if(newName && newName.trim() !== '') { let types = exmReadJson('ems_exam_types', []); types[types.indexOf(oldName)] = newName.trim(); emsSaveKey('ems_exam_types', JSON.stringify(types)); refreshExamData(); } };



  document.getElementById('btn-add-lib-book')?.addEventListener('click', function () {
      window.exmAddLibraryBook();
  });
  document.getElementById('set-lib-book')?.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
          e.preventDefault();
          window.exmAddLibraryBook();
      }
  });

  window.exmAddLibraryBook = function (nameOpt) {
      var input = document.getElementById('set-lib-book');
      var name = (nameOpt != null ? String(nameOpt) : (input ? input.value : '')).trim();
      if (!name) {
          if (typeof window.showToast === 'function') window.showToast('کتاب کا نام لکھیں', 'warning');
          return false;
      }
      var books = exmReadJson('ems_library_books', []);
      if (!Array.isArray(books)) books = [];
      if (books.includes(name)) {
          if (typeof window.showToast === 'function') window.showToast('یہ کتاب پہلے سے موجود ہے', 'warning');
          return false;
      }
      books.push(name);
      emsSaveKey('ems_library_books', JSON.stringify(books));
      if (input) input.value = '';
      if (typeof window.refreshExamData === 'function') window.refreshExamData();
      if (typeof window.showToast === 'function') window.showToast('کتاب محفوظ ہو گئی', 'success');
      return true;
  };

  window.deleteLibBook = function (name) {
      if (!confirm('حذف کریں؟')) return;
      var books = exmReadJson('ems_library_books', []);
      if (!Array.isArray(books)) books = [];
      emsSaveKey('ems_library_books', JSON.stringify(books.filter(function (b) { return b !== name; })));
      if (typeof window.refreshExamData === 'function') window.refreshExamData();
      if (typeof window.showToast === 'function') window.showToast('کتاب حذف ہو گئی', 'success');
  };

  window.editLibBook = function (oldName) {
      var newName = prompt('نیا نام لکھیں:', oldName);
      if (!newName || newName.trim() === '') return;
      newName = newName.trim();
      var books = exmReadJson('ems_library_books', []);
      if (!Array.isArray(books)) books = [];
      var idx = books.indexOf(oldName);
      if (idx < 0) return;
      books[idx] = newName;
      emsSaveKey('ems_library_books', JSON.stringify(books));
      if (typeof window.refreshExamData === 'function') window.refreshExamData();
      if (typeof window.showToast === 'function') window.showToast('کتاب اپڈیٹ ہو گئی', 'success');
  };



  var EXM_TPL_ALL_CLASSES = '__ALL_CLASSES__';

  window.exmEnsureTplAllClassesOption = function () {
      ['tpl-class-select', 'sch-class-select'].forEach(function (selId) {
          var sel = document.getElementById(selId);
          if (!sel) return;
          var cur = sel.value;
          var existing = null;
          Array.from(sel.options).forEach(function (o) {
              if (o.value === EXM_TPL_ALL_CLASSES) existing = o;
          });
          if (existing) existing.remove();
          var opt = document.createElement('option');
          opt.value = EXM_TPL_ALL_CLASSES;
          opt.textContent = 'تمام درجات';
          if (sel.options.length > 0) {
              var insertBefore = sel.options[0] && !String(sel.options[0].value || '').trim()
                  ? (sel.options[1] || null)
                  : sel.options[0];
              sel.insertBefore(opt, insertBefore);
          } else {
              sel.appendChild(opt);
          }
          if (cur) sel.value = cur;
      });
  };

  function exmListMasterSheetClasses() {
      if (typeof window.exmCollectAllClasses === 'function') {
          var merged = window.exmCollectAllClasses();
          if (merged.length) return merged.slice();
      }
      if (typeof window.emsCollectClasses === 'function') {
          var fromRepo = window.emsCollectClasses() || [];
          if (fromRepo.length) return fromRepo.slice();
      }
      var sel = document.getElementById('tpl-class-select');
      var out = [];
      if (sel) {
          Array.from(sel.options).forEach(function (o) {
              var v = String(o.value || '').trim();
              if (!v || v === EXM_TPL_ALL_CLASSES) return;
              out.push(v);
          });
      }
      return out;
  }

  function exmEnsureClassTemplate(templates, cls) {
      var classTpl = templates.find(function (t) { return t.class === cls; });
      if (!classTpl) {
          classTpl = {
              class: cls,
              sheetName: '',
              books: [],
              removedBooks: [],
              customHeader: '',
              fontSize: 16,
              textAlign: 'right',
              showBorder: true
          };
          templates.push(classTpl);
      }
      if (!Array.isArray(classTpl.books)) classTpl.books = [];
      if (!Array.isArray(classTpl.removedBooks)) classTpl.removedBooks = [];
      if (typeof classTpl.sheetName !== 'string') classTpl.sheetName = classTpl.sheetName ? String(classTpl.sheetName) : '';
      return classTpl;
  }

  function exmTplRemovedSet(classTpl) {
      var set = Object.create(null);
      (classTpl && classTpl.removedBooks ? classTpl.removedBooks : []).forEach(function (k) {
          if (k) set[String(k)] = true;
      });
      return set;
  }

  function exmTplMarkBookRemoved(classTpl, bookName) {
      if (!classTpl) return;
      if (!Array.isArray(classTpl.removedBooks)) classTpl.removedBooks = [];
      var key = exmTplBookDedupeKey(bookName);
      if (!key) return;
      if (classTpl.removedBooks.indexOf(key) < 0) classTpl.removedBooks.push(key);
  }

  function exmTplClearBookRemoved(classTpl, bookName) {
      if (!classTpl || !Array.isArray(classTpl.removedBooks)) return;
      var key = exmTplBookDedupeKey(bookName);
      if (!key) return;
      classTpl.removedBooks = classTpl.removedBooks.filter(function (k) { return k !== key; });
  }

  function exmTplDisplayName(tpl) {
      if (!tpl) return '';
      var named = tpl.sheetName ? String(tpl.sheetName).trim() : '';
      if (named) return named;
      return String(tpl.class || '');
  }

  function exmReadMasterSheetMeta() {
      try {
          var raw = typeof exmReadRaw === 'function'
              ? exmReadRaw('ems_master_sheet_meta')
              : localStorage.getItem('ems_master_sheet_meta');
          if (!raw) return {};
          var parsed = JSON.parse(raw);
          return parsed && typeof parsed === 'object' ? parsed : {};
      } catch (eMeta) {
          return {};
      }
  }

  function exmWriteMasterSheetMeta(meta) {
      var str = JSON.stringify(meta || {});
      try {
          emsSaveKey('ems_master_sheet_meta', str);
      } catch (eWrite) {
          try { localStorage.setItem('ems_master_sheet_meta', str); } catch (eLs) { /* ignore */ }
          exmWarmCacheAfterSave('ems_master_sheet_meta', str);
      }
  }

  function exmPersistMatrixMetaFromUi() {
      var meta = exmReadMasterSheetMeta();
      var titleEl = document.getElementById('tpl-matrix-title');
      var timeEl = document.getElementById('tpl-matrix-time');
      var nameEl = document.getElementById('tpl-sheet-name');
      if (titleEl) meta.matrixTitle = String(titleEl.value || '').trim();
      if (timeEl) meta.matrixTime = String(timeEl.value || '').trim();
      if (nameEl) meta.allSheetName = String(nameEl.value || '').trim();
      exmWriteMasterSheetMeta(meta);
  }

  function exmApplyMasterSheetMetaToUi(meta) {
      meta = meta || exmReadMasterSheetMeta();
      var titleEl = document.getElementById('tpl-matrix-title');
      var timeEl = document.getElementById('tpl-matrix-time');
      if (titleEl && meta.matrixTitle) titleEl.value = meta.matrixTitle;
      if (timeEl && meta.matrixTime) timeEl.value = meta.matrixTime;
  }

  function exmBuildTplBookEntry(bookName, marks, date, time, room, invigilator, teacher, paperType) {
      var curScope = window.examFormatCurScope(window.examGetCurScopeForBook(bookName, 'سالانہ امتحان'));
      return {
          id: generateID('B'),
          name: bookName,
          marks: marks,
          date: date,
          time: time,
          room: room,
          invigilator: invigilator,
          teacher: teacher,
          paperType: paperType,
          curScope: curScope
      };
  }

  function exmTplBookDedupeKey(name) {
      var s = String(name == null ? '' : name).trim().replace(/\s+/g, ' ');
      if (!s) return '';
      try { s = s.normalize('NFC'); } catch (eNfc) { /* ignore */ }
      try { return s.toLocaleLowerCase('ur'); } catch (eUr) {
          try { return s.toLowerCase(); } catch (eLow) { return s; }
      }
  }

  function exmReadAttendancePeriodsForTpl() {
      if (typeof window.attActiveTimetablePeriods === 'function') {
          return window.attActiveTimetablePeriods() || [];
      }
      if (typeof window.attReadTimetablePeriods === 'function') {
          return window.attReadTimetablePeriods() || [];
      }
      try {
          var raw = exmReadRaw('ems_att_periods');
          if (raw == null || raw === '') {
              raw = localStorage.getItem('ems_att_periods');
          }
          var periods = raw ? JSON.parse(raw) : [];
          return Array.isArray(periods) ? periods : [];
      } catch (e) {
          return [];
      }
  }

  function exmCollectClassesFromTimetable() {
      var periods = exmReadAttendancePeriodsForTpl();
      var seen = Object.create(null);
      var out = [];
      (periods || []).forEach(function (p) {
          if (!p || p.archived) return;
          var cls = String(p.className || '').trim();
          if (!cls || cls === '-' || cls === 'نامعلوم' || seen[cls]) return;
          seen[cls] = true;
          out.push(cls);
      });
      out.sort();
      return out;
  }

  function exmCollectClassesFromTemplates() {
      var templates = exmReadJson('ems_exam_templates', []);
      var seen = Object.create(null);
      var out = [];
      (templates || []).forEach(function (t) {
          var cls = String(t && t.class || '').trim();
          if (!cls || seen[cls]) return;
          seen[cls] = true;
          out.push(cls);
      });
      out.sort();
      return out;
  }

  /** رجسٹریشن + نظام الاوقات + ماسٹر شیٹ — تمام درجات */
  window.exmCollectAllClasses = function () {
      var seen = Object.create(null);
      var out = [];
      function addList(list) {
          (list || []).forEach(function (c) {
              c = String(c || '').trim();
              if (!c || c === 'نامعلوم' || seen[c]) return;
              seen[c] = true;
              out.push(c);
          });
      }
      addList(typeof window.emsCollectClasses === 'function' ? window.emsCollectClasses() : []);
      addList(exmCollectClassesFromTimetable());
      addList(exmCollectClassesFromTemplates());
      out.sort();
      return out;
  };

  window.exmFillClassSelects = function (selector, opts) {
      opts = opts || {};
      var classes = window.exmCollectAllClasses();
      document.querySelectorAll(selector).forEach(function (selectEl) {
          if (!selectEl) return;
          var current = selectEl.value;
          var first = opts.allLabel != null
              ? opts.allLabel
              : (selectEl.id && selectEl.id.indexOf('filter') >= 0 ? 'تمام درجات' : 'درجہ منتخب کریں...');
          if (selectEl.id === 'exam-data-class') first = 'تمام / فائل سے';
          if (selectEl.id === 'mrk-class' || selectEl.id === 'res-class') first = 'منتخب کریں...';
          var html = '<option value="">' + first + '</option>';
          classes.forEach(function (c) {
              html += '<option value="' + String(c).replace(/"/g, '&quot;') + '">' + c + '</option>';
          });
          selectEl.innerHTML = html;
          if (current) selectEl.value = current;
      });
  };

  /**
   * نظام الاوقات: ہر درجہ کی کتاب → ماسٹر شیٹ کے اسی درجے میں منسلک۔
   * Idempotent — صرف نئی کتابیں شامل ہوتی ہیں۔
   */
  window.exmSyncTimetableBooksToMasterSheet = function (opts) {
      opts = opts || {};
      if (typeof window.attMigratePeriodBooksToLibrary === 'function') {
          try { window.attMigratePeriodBooksToLibrary({ skipRefresh: true }); } catch (eLib) { /* ignore */ }
      }
      var periods = exmReadAttendancePeriodsForTpl();
      var byClass = Object.create(null);
      periods.forEach(function (p) {
          if (!p) return;
          var cls = String(p.className || '').trim();
          if (!cls || cls === '-') return;
          var book = String(p.bookName || '').trim().replace(/\s+/g, ' ');
          if (!book || book === '-') return;
          var key = exmTplBookDedupeKey(book);
          if (!key) return;
          if (!byClass[cls]) byClass[cls] = Object.create(null);
          if (byClass[cls][key]) return;
          var teacher = String(p.teacherName || '').replace(/\[.*?\]\s*/g, '').trim();
          if (teacher === '-') teacher = '';
          byClass[cls][key] = { name: book, teacher: teacher };
      });
      var classNames = Object.keys(byClass);
      if (!classNames.length) {
          return { added: 0, classes: 0, changed: false };
      }

      var templates = exmReadJson('ems_exam_templates', []);
      if (!Array.isArray(templates)) templates = [];
      var added = 0;
      classNames.forEach(function (cls) {
          var classTpl = exmEnsureClassTemplate(templates, cls);
          var existing = Object.create(null);
          var removed = exmTplRemovedSet(classTpl);
          classTpl.books.forEach(function (b) {
              var k = exmTplBookDedupeKey(b && b.name);
              if (k) existing[k] = true;
          });
          Object.keys(byClass[cls]).forEach(function (bk) {
              if (existing[bk] || removed[bk]) return;
              var info = byClass[cls][bk];
              classTpl.books.push(exmBuildTplBookEntry(
                  info.name,
                  100,
                  '',
                  '',
                  '',
                  '',
                  info.teacher || '',
                  'تحریری'
              ));
              existing[bk] = true;
              added++;
          });
      });

      if (added > 0) {
          emsSaveKey('ems_exam_templates', JSON.stringify(templates));
          if (!opts.silent && typeof showToast === 'function') {
              showToast(added + ' کتاب نظام الاوقات سے ماسٹر شیٹ (مطلوبہ درجات) میں منسلک ہو گئیں', 'success');
          }
      }
      return { added: added, classes: classNames.length, changed: added > 0 };
  };

  function renderQuickAccessTabs() {

      const tabsContainer = document.getElementById('quick-access-tabs');

      if(!tabsContainer) return;

      const templates = exmReadJson('ems_exam_templates', []);

      tabsContainer.innerHTML = '';

      var allMeta = exmReadMasterSheetMeta();
      var allLabel = (allMeta.allSheetName && String(allMeta.allSheetName).trim()) || 'تمام درجات';
      tabsContainer.innerHTML += `<button class="btn btn-outline" style="padding:6px 12px; border-radius:20px;" onclick="loadTemplateForClass('${EXM_TPL_ALL_CLASSES}')" title="تمام درجات">${exmTplEscapeHtml(allLabel)}</button>`;

      templates.forEach(tpl => {
          if (!tpl || !tpl.class) return;
          var label = exmTplDisplayName(tpl);
          var titleAttr = tpl.sheetName ? (' title="' + exmTplEscapeAttr(tpl.class) + '"') : '';
          tabsContainer.innerHTML += `<button class="btn btn-outline" style="padding:6px 12px; border-radius:20px;" onclick="loadTemplateForClass('${exmTplEscapeAttr(tpl.class)}')"${titleAttr}>${exmTplEscapeHtml(label)}</button>`;
      });

  }



  window.loadTemplateForClass = function(cls) { document.getElementById('tpl-class-select').value = cls; renderTemplateTable(cls); };

  document.getElementById('tpl-class-select')?.addEventListener('change', function() { renderTemplateTable(this.value); });



  document.getElementById('btn-add-tpl-book')?.addEventListener('click', () => {

      const cls = document.getElementById('tpl-class-select').value;

      const bookName = document.getElementById('tpl-book-select').value;

      const marks = parseInt(document.getElementById('tpl-book-marks').value) || 100;

      const date = document.getElementById('tpl-book-date').value;

      const time = document.getElementById('tpl-book-time').value.trim();

      const room = (document.getElementById('tpl-book-room')?.value || '').trim();

      const invigilator = (document.getElementById('tpl-book-invig')?.value || '').trim();

      const teacher = (document.getElementById('tpl-book-teacher')?.value || '').trim();

      const paperType = document.getElementById('tpl-book-type')?.value || 'تحریری';



      if(!cls || !bookName) return showToast("درجہ اور کتاب کا انتخاب لازمی ہے!", "error");



      let templates = exmReadJson('ems_exam_templates', []);

      if (cls === EXM_TPL_ALL_CLASSES) {
          var allClasses = exmListMasterSheetClasses();
          if (!allClasses.length) {
              return showToast("کوئی درجہ دستیاب نہیں — پہلے رجسٹریشن میں درجات درج کریں", "error");
          }
          var added = 0;
          var skipped = 0;
          allClasses.forEach(function (c) {
              var classTpl = exmEnsureClassTemplate(templates, c);
              exmTplClearBookRemoved(classTpl, bookName);
              if (!classTpl.books.find(function (b) { return b.name === bookName; })) {
                  classTpl.books.push(exmBuildTplBookEntry(bookName, marks, date, time, room, invigilator, teacher, paperType));
                  added++;
              } else {
                  skipped++;
              }
          });
          emsSaveKey('ems_exam_templates', JSON.stringify(templates));
          if (added > 0) {
              showToast(added + ' درجات کی شیٹ میں کتاب شامل ہو گئی' + (skipped ? ' (' + skipped + ' پہلے سے موجود)' : '') + '!', "success");
          } else {
              showToast("یہ کتاب تمام درجات کی شیٹ میں پہلے سے موجود ہے!", "warning");
          }
          renderTemplateTable(EXM_TPL_ALL_CLASSES);
          renderQuickAccessTabs();
          return;
      }

      let classTpl = exmEnsureClassTemplate(templates, cls);
      exmTplClearBookRemoved(classTpl, bookName);

      

      if(!classTpl.books.find(b => b.name === bookName)) {

          classTpl.books.push(exmBuildTplBookEntry(bookName, marks, date, time, room, invigilator, teacher, paperType));

          emsSaveKey('ems_exam_templates', JSON.stringify(templates));

          showToast("شیٹ میں کتاب شامل کر دی گئی!", "success");

          renderTemplateTable(cls); renderQuickAccessTabs();

      } else { showToast("یہ کتاب اس درجے کی شیٹ میں پہلے سے ہے!", "warning"); }

  });



  function exmTplEscapeHtml(s) {
      return String(s == null ? '' : s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
  }

  function exmTplEscapeAttr(s) {
      return String(s == null ? '' : s)
          .replace(/\\/g, '\\\\')
          .replace(/'/g, "\\'");
  }

  var EXM_TPL_DETAIL_HEADERS =
      '<th>درجہ</th><th>کتاب</th><th>نصاب حصہ</th><th>کل نمبرات</th><th>تاریخ</th><th>وقت</th><th>کمرہ</th><th>نگران</th><th>استاد</th><th>نوعیت</th><th>ایکشن</th>';

  var EXM_PAPER_ORDINALS = [
      'الورقة الأولى', 'الورقة الثانية', 'الورقة الثالثة', 'الورقة الرابعة',
      'الورقة الخامسة', 'الورقة السادسة', 'الورقة السابعة', 'الورقة الثامنة',
      'الورقة التاسعة', 'الورقة العاشرة', 'الورقة الحادية عشرة', 'الورقة الثانية عشرة'
  ];

  function exmSetTplTableMode(mode) {
      var detail = document.getElementById('tpl-detail-table-wrap');
      var matrix = document.getElementById('tpl-all-matrix-wrap');
      if (detail) detail.style.display = mode === 'all' ? 'none' : '';
      if (matrix) matrix.style.display = mode === 'all' ? 'block' : 'none';
      if (mode !== 'all') {
          var headRow = document.querySelector('#tpl-books-table thead tr');
          if (headRow) headRow.innerHTML = EXM_TPL_DETAIL_HEADERS;
      }
      exmApplyTplExtraSettingsUi(mode === 'all');
  }

  function exmTplExtraSettingsIsOpen() {
      var root = document.getElementById('exam-win-template');
      return !!(root && root.classList.contains('tpl-extra-open'));
  }

  function exmUpdateTplExtraSettingsButton() {
      var btn = document.getElementById('btn-tpl-extra-settings');
      if (!btn) return;
      var open = exmTplExtraSettingsIsOpen();
      btn.innerHTML = open
          ? '<i class="fas fa-times"></i> سیٹنگز چھپائیں'
          : '<i class="fas fa-cog"></i> اضافی سیٹنگز';
      btn.setAttribute('aria-pressed', open ? 'true' : 'false');
  }

  function exmApplyTplExtraSettingsUi(isAllMode) {
      var root = document.getElementById('exam-win-template');
      var toggleWrap = document.getElementById('tpl-settings-toggle-wrap');
      if (!root) return;
      if (toggleWrap) toggleWrap.style.display = isAllMode ? '' : 'none';
      if (!isAllMode) {
          root.classList.add('tpl-extra-open');
          exmUpdateTplExtraSettingsButton();
          return;
      }
      var saved = null;
      try { saved = sessionStorage.getItem('ems_tpl_extra_open'); } catch (eSave) { saved = null; }
      if (saved === '1') root.classList.add('tpl-extra-open');
      else root.classList.remove('tpl-extra-open');
      exmUpdateTplExtraSettingsButton();
  }

  window.exmToggleTplExtraSettings = function () {
      var root = document.getElementById('exam-win-template');
      var sel = document.getElementById('tpl-class-select');
      if (!root || !sel || sel.value !== EXM_TPL_ALL_CLASSES) return;
      var open = root.classList.toggle('tpl-extra-open');
      try { sessionStorage.setItem('ems_tpl_extra_open', open ? '1' : '0'); } catch (eSet) { /* ignore */ }
      exmUpdateTplExtraSettingsButton();
  };

  function exmPaperOrdinalLabel(index) {
      return EXM_PAPER_ORDINALS[index] || ('الورقة ' + (index + 1));
  }

  function exmSortTplBooksForMatrix(books) {
      return (books || []).slice().sort(function (a, b) {
          var ma = a && typeof a.matrixOrder === 'number' ? a.matrixOrder : null;
          var mb = b && typeof b.matrixOrder === 'number' ? b.matrixOrder : null;
          if (ma != null && mb != null && ma !== mb) return ma - mb;
          if (ma != null && mb == null) return -1;
          if (ma == null && mb != null) return 1;
          var da = a && a.date ? String(a.date) : '';
          var db = b && b.date ? String(b.date) : '';
          if (da && db && da !== db) return da.localeCompare(db);
          if (da && !db) return -1;
          if (!da && db) return 1;
          var ta = a && a.time ? String(a.time) : '';
          var tb = b && b.time ? String(b.time) : '';
          if (ta !== tb) return ta.localeCompare(tb);
          return String((a && a.name) || '').localeCompare(String((b && b.name) || ''), 'ur');
      });
  }

  /** اوپر کی اوراق قطار: کالم گھسیٹ کر / بٹن سے ترتیب۔ */
  window.exmReorderMatrixPaperColumns = function (fromIdx, toIdx) {
      fromIdx = parseInt(fromIdx, 10);
      toIdx = parseInt(toIdx, 10);
      if (!isFinite(fromIdx) || !isFinite(toIdx) || fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
      var templates = exmReadJson('ems_exam_templates', []);
      if (!Array.isArray(templates)) templates = [];
      var changed = false;
      templates.forEach(function (tpl) {
          if (!tpl || !Array.isArray(tpl.books) || !tpl.books.length) return;
          var books = exmSortTplBooksForMatrix(tpl.books);
          if (fromIdx >= books.length) return;
          var moved = books.splice(fromIdx, 1)[0];
          if (!moved) return;
          var insertAt = toIdx;
          if (insertAt > books.length) insertAt = books.length;
          books.splice(insertAt, 0, moved);
          books.forEach(function (b, i) {
              if (b) b.matrixOrder = i;
          });
          changed = true;
      });
      if (!changed) return;
      emsSaveKey('ems_exam_templates', JSON.stringify(templates));
      if (typeof showToast === 'function') showToast('اوراق کی ترتیب محفوظ ہو گئی', 'success');
      renderTemplateTable(EXM_TPL_ALL_CLASSES);
  };

  window.exmMoveMatrixPaperCol = function (colIdx, delta) {
      colIdx = parseInt(colIdx, 10);
      delta = parseInt(delta, 10) || 0;
      if (!isFinite(colIdx)) return;
      window.exmReorderMatrixPaperColumns(colIdx, colIdx + delta);
  };

  /** اوپر اوراق ہیڈر: پورے کالم کی تاریخ بدلنا (تمام درجات کی اس ورق کی کتابوں پر)۔ */
  window.exmSetMatrixPaperColumnDate = function (colIdx, dateVal) {
      colIdx = parseInt(colIdx, 10);
      if (!isFinite(colIdx) || colIdx < 0) return;
      var dateStr = dateVal ? String(dateVal) : '';
      var templates = exmReadJson('ems_exam_templates', []);
      if (!Array.isArray(templates)) templates = [];
      var updated = 0;
      templates.forEach(function (tpl) {
          if (!tpl || !Array.isArray(tpl.books) || !tpl.books.length) return;
          var books = exmSortTplBooksForMatrix(tpl.books);
          var book = books[colIdx];
          if (!book) return;
          book.date = dateStr;
          // کالم پوزیشن برقرار رکھیں
          if (typeof book.matrixOrder !== 'number') book.matrixOrder = colIdx;
          updated++;
      });
      if (!updated) {
          if (typeof showToast === 'function') showToast('اس ورق میں کوئی کتاب نہیں', 'warning');
          return;
      }
      emsSaveKey('ems_exam_templates', JSON.stringify(templates));
      if (typeof showToast === 'function') showToast('ورق کی تاریخ محفوظ ہو گئی', 'success');
      renderTemplateTable(EXM_TPL_ALL_CLASSES);
  };

  function exmBindMatrixPaperColumnDrag(table) {
      if (!table) return;
      table.querySelectorAll('th.tpl-matrix-paper-head').forEach(function (th) {
          th.setAttribute('draggable', 'true');
          th.addEventListener('dragstart', function (e) {
              var from = th.getAttribute('data-col-index');
              th.classList.add('tpl-paper-dragging');
              try {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', String(from));
              } catch (err) { /* ignore */ }
          });
          th.addEventListener('dragend', function () {
              th.classList.remove('tpl-paper-dragging');
              table.querySelectorAll('.tpl-paper-drag-over').forEach(function (el) {
                  el.classList.remove('tpl-paper-drag-over');
              });
          });
          th.addEventListener('dragover', function (e) {
              e.preventDefault();
              th.classList.add('tpl-paper-drag-over');
          });
          th.addEventListener('dragleave', function () {
              th.classList.remove('tpl-paper-drag-over');
          });
          th.addEventListener('drop', function (e) {
              e.preventDefault();
              th.classList.remove('tpl-paper-drag-over');
              var to = parseInt(th.getAttribute('data-col-index'), 10);
              var from = NaN;
              try { from = parseInt(e.dataTransfer.getData('text/plain'), 10); } catch (err2) { from = NaN; }
              if (isFinite(from) && isFinite(to)) window.exmReorderMatrixPaperColumns(from, to);
          });
      });
  }

  function exmClassMatrixSort(a, b) {
      var na = String(a).match(/(\d+)/);
      var nb = String(b).match(/(\d+)/);
      if (na && nb) return parseInt(nb[1], 10) - parseInt(na[1], 10);
      try { return String(a).localeCompare(String(b), 'ur'); }
      catch (e) { return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0; }
  }

  function exmFindClassTemplate(templates, cls) {
      return (templates || []).find(function (t) { return t && t.class === cls; }) || null;
  }

  /** درجات کی ترتیب: محفوظ sortOrder، ورنہ ڈیفالٹ۔ */
  function exmOrderedMatrixClasses(templates, byClass) {
      var names = Object.keys(byClass || {}).filter(function (c) {
          return (byClass[c] || []).length > 0;
      });
      var listClasses = exmListMasterSheetClasses();
      listClasses.forEach(function (c) {
          if (byClass[c] && byClass[c].length && names.indexOf(c) < 0) names.push(c);
      });
      names.sort(function (a, b) {
          var ta = exmFindClassTemplate(templates, a);
          var tb = exmFindClassTemplate(templates, b);
          var oa = ta && typeof ta.sortOrder === 'number' ? ta.sortOrder : null;
          var ob = tb && typeof tb.sortOrder === 'number' ? tb.sortOrder : null;
          if (oa != null && ob != null && oa !== ob) return oa - ob;
          if (oa != null && ob == null) return -1;
          if (oa == null && ob != null) return 1;
          return exmClassMatrixSort(a, b);
      });
      return names;
  }

  function exmRewriteClassSortOrders(templates, orderedNames) {
      (orderedNames || []).forEach(function (name, idx) {
          var tpl = exmEnsureClassTemplate(templates, name);
          tpl.sortOrder = idx + 1;
      });
  }

  window.exmSetTplBookDate = function (cls, bookId, dateVal) {
      var templates = exmReadJson('ems_exam_templates', []);
      if (!Array.isArray(templates)) templates = [];
      var classTpl = exmFindClassTemplate(templates, cls);
      if (!classTpl || !Array.isArray(classTpl.books)) {
          return showToast('درجہ/کتاب نہیں ملی', 'error');
      }
      var book = classTpl.books.find(function (b) { return b && b.id === bookId; });
      if (!book) return showToast('کتاب نہیں ملی', 'error');
      book.date = dateVal ? String(dateVal) : '';
      emsSaveKey('ems_exam_templates', JSON.stringify(templates));
      if (typeof showToast === 'function') showToast('تاریخ محفوظ ہو گئی', 'success');
      renderTemplateTable(EXM_TPL_ALL_CLASSES);
  };

  window.exmSetClassMatrixOrder = function (cls, orderRaw) {
      var templates = exmReadJson('ems_exam_templates', []);
      if (!Array.isArray(templates)) templates = [];
      var byClass = Object.create(null);
      templates.forEach(function (tpl) {
          if (!tpl || !tpl.class) return;
          if ((tpl.books || []).length) byClass[tpl.class] = tpl.books;
      });
      var names = exmOrderedMatrixClasses(templates, byClass);
      if (names.indexOf(cls) < 0) names.push(cls);
      var order = parseInt(orderRaw, 10);
      if (!isFinite(order) || order < 1) order = 1;
      if (order > names.length) order = names.length;
      names = names.filter(function (n) { return n !== cls; });
      names.splice(order - 1, 0, cls);
      exmRewriteClassSortOrders(templates, names);
      emsSaveKey('ems_exam_templates', JSON.stringify(templates));
      if (typeof showToast === 'function') showToast('درجہ کی ترتیب اپڈیٹ ہو گئی', 'success');
      renderTemplateTable(EXM_TPL_ALL_CLASSES);
  };

  window.exmMoveClassMatrix = function (cls, delta) {
      var templates = exmReadJson('ems_exam_templates', []);
      if (!Array.isArray(templates)) templates = [];
      var byClass = Object.create(null);
      templates.forEach(function (tpl) {
          if (!tpl || !tpl.class) return;
          if ((tpl.books || []).length) byClass[tpl.class] = tpl.books;
      });
      var names = exmOrderedMatrixClasses(templates, byClass);
      var idx = names.indexOf(cls);
      if (idx < 0) return;
      var next = idx + (parseInt(delta, 10) || 0);
      if (next < 0 || next >= names.length) return;
      window.exmSetClassMatrixOrder(cls, next + 1);
  };

  function exmMatrixDayName(dateStr) {
      if (!dateStr) return '';
      var d = new Date(String(dateStr) + 'T12:00:00');
      if (isNaN(d.getTime())) return '';
      var days = (typeof SCH_DAYS_URDU !== 'undefined')
          ? SCH_DAYS_URDU
          : ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'];
      return days[d.getDay()] || '';
  }

  function exmMatrixDateLabel(dateStr) {
      if (!dateStr) return '';
      var d = new Date(String(dateStr) + 'T12:00:00');
      if (isNaN(d.getTime())) return exmTplEscapeHtml(dateStr);
      var g = d.getDate() + '-' + (d.getMonth() + 1) + '-' + d.getFullYear();
      var day = exmMatrixDayName(dateStr);
      return exmTplEscapeHtml(g) + (day ? '<br><span style="font-size:11px;font-weight:600;">' + exmTplEscapeHtml(day) + '</span>' : '');
  }

  function exmInferPaperColumnDate(sortedByClass, colIndex) {
      var counts = Object.create(null);
      Object.keys(sortedByClass).forEach(function (cls) {
          var book = sortedByClass[cls][colIndex];
          if (book && book.date) {
              var key = String(book.date);
              counts[key] = (counts[key] || 0) + 1;
          }
      });
      var best = '';
      var bestN = 0;
      Object.keys(counts).forEach(function (k) {
          if (counts[k] > bestN) {
              bestN = counts[k];
              best = k;
          }
      });
      return best;
  }

  function exmInferMatrixTime(sortedByClass) {
      var times = [];
      Object.keys(sortedByClass).forEach(function (cls) {
          (sortedByClass[cls] || []).forEach(function (b) {
              var t = b && b.time ? String(b.time).trim() : '';
              if (t && times.indexOf(t) < 0) times.push(t);
          });
      });
      return times[0] || '';
  }

  function exmDefaultMatrixTitle() {
      var examSel = document.getElementById('sch-exam-name') || document.getElementById('mrk-exam-name');
      var examName = examSel && examSel.value ? examSel.value : 'امتحان';
      var year = new Date().getFullYear();
      return 'جدول اختبار — ' + examName + ' — ' + year + 'م';
  }

  function exmRenderAllClassesMatrix(templates, opts) {
      opts = opts || {};
      var prefix = opts.prefix || 'tpl';
      var editMode = opts.editMode !== false;
      var table = document.getElementById(prefix + '-matrix-table');
      var heading = document.getElementById(prefix + '-matrix-heading');
      var brand = document.getElementById(prefix + '-matrix-brand');
      if (!table) return;

      if (brand && typeof window.attBrandHeaderHTML === 'function') {
          try { brand.innerHTML = window.attBrandHeaderHTML(); } catch (eBrand) { brand.innerHTML = ''; }
      } else if (brand) {
          brand.innerHTML = '';
      }

      var byClass = Object.create(null);
      (templates || []).forEach(function (tpl) {
          if (!tpl || !tpl.class) return;
          byClass[tpl.class] = exmSortTplBooksForMatrix(tpl.books || []);
      });

      var classOrder = exmOrderedMatrixClasses(templates, byClass);

      var maxCols = 0;
      classOrder.forEach(function (c) {
          maxCols = Math.max(maxCols, (byClass[c] || []).length);
      });

      var titleEl = prefix === 'tpl' ? document.getElementById('tpl-matrix-title') : null;
      var timeEl = prefix === 'tpl' ? document.getElementById('tpl-matrix-time') : null;
      if (titleEl && !String(titleEl.value || '').trim()) {
          titleEl.value = exmDefaultMatrixTitle();
      }
      if (timeEl && !String(timeEl.value || '').trim()) {
          timeEl.value = exmInferMatrixTime(byClass) || '8:15 — 11:30';
      }
      var title = titleEl ? String(titleEl.value || '').trim() : exmDefaultMatrixTitle();
      var timeText = timeEl
          ? String(timeEl.value || '').trim()
          : (exmInferMatrixTime(byClass) || '8:15 — 11:30');

      if (heading) {
          heading.innerHTML =
              '<div style="font-size:26px; font-weight:800; color:#1e3a5f; font-family:\'Noto Nastaliq Urdu\', serif; line-height:1.6;">' +
              exmTplEscapeHtml(title) + '</div>' +
              (timeText
                  ? '<div style="font-size:16px; font-weight:700; color:#334155; margin-top:4px;">الزمن: ' +
                    exmTplEscapeHtml(timeText) + '</div>'
                  : '');
      }

      if (!classOrder.length || maxCols < 1) {
          table.innerHTML = '<tbody><tr><td style="text-align:center;padding:20px;">تمام درجات کی شیٹ میں کوئی کتاب نہیں</td></tr></tbody>';
          if (prefix === 'tpl') exmSyncScheduleMatrixMirror(templates);
          return;
      }

      var headCells = '<th class="tpl-matrix-class">الصفوف الدراسية<br><small>درجات / ترتیب</small></th>';
      for (var i = 0; i < maxCols; i++) {
          var colDate = exmInferPaperColumnDate(byClass, i);
          var dayName = colDate ? exmMatrixDayName(colDate) : '';
          headCells +=
              '<th class="tpl-matrix-paper-head" data-col-index="' + i + '"' +
              (editMode ? ' title="گھسیٹ کر اوراق کی ترتیب بدلیں"' : '') + '>' +
              (editMode
                  ? '<div class="tpl-matrix-ctrl" style="cursor:grab;font-size:14px;color:#64748b;margin-bottom:2px;">⠿ گھسیٹیں</div>'
                  : '') +
              '<div>' + exmTplEscapeHtml(exmPaperOrdinalLabel(i)) + '</div>' +
              (editMode
                  ? ('<div class="tpl-matrix-ctrl" style="margin-top:6px;">' +
                     '<label style="display:block;font-size:11px;color:#64748b;margin-bottom:2px;">تاریخ</label>' +
                     '<input type="date" value="' + exmTplEscapeHtml(colDate || '') + '" ' +
                     'style="max-width:150px;padding:3px 4px;font-size:12px;" title="اس ورق کی تاریخ منتخب کریں" ' +
                     'onclick="event.stopPropagation()" onmousedown="event.stopPropagation()" ' +
                     'onchange="event.stopPropagation();exmSetMatrixPaperColumnDate(' + i + ', this.value)">' +
                     (dayName ? '<div style="margin-top:3px;font-size:11px;font-weight:600;">' + exmTplEscapeHtml(dayName) + '</div>' : '') +
                     '</div>')
                  : '') +
              '<div class="tpl-paper-date-print" style="' + (editMode ? 'display:none;' : '') + 'margin-top:4px;font-weight:600;">' +
              (colDate ? exmMatrixDateLabel(colDate) : '—') +
              '</div>' +
              (editMode
                  ? ('<div class="tpl-matrix-ctrl" style="margin-top:6px;display:flex;gap:4px;justify-content:center;">' +
                     '<button type="button" class="btn btn-outline btn-sm" style="padding:2px 6px;" title="دائیں (پچھلا ورق)" ' +
                     'onclick="event.stopPropagation();exmMoveMatrixPaperCol(' + i + ', -1)">→</button>' +
                     '<button type="button" class="btn btn-outline btn-sm" style="padding:2px 6px;" title="بائیں (اگلا ورق)" ' +
                     'onclick="event.stopPropagation();exmMoveMatrixPaperCol(' + i + ', 1)">←</button>' +
                     '</div>')
                  : '') +
              '</th>';
      }

      var bodyHtml = '';
      classOrder.forEach(function (className, rowIdx) {
          var books = byClass[className] || [];
          var safeCls = exmTplEscapeAttr(className);
          var pos = rowIdx + 1;
          bodyHtml +=
              '<tr><td class="tpl-matrix-class">' +
              '<div>' + exmTplEscapeHtml(className) + '</div>' +
              (editMode
                  ? ('<div class="tpl-matrix-ctrl" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;align-items:center;justify-content:center;">' +
                     '<small style="color:#64748b;">ترتیب</small>' +
                     '<input type="number" min="1" max="' + classOrder.length + '" value="' + pos + '" ' +
                     'style="width:52px;padding:2px 4px;text-align:center;" title="قطار نمبر" ' +
                     "onchange=\"exmSetClassMatrixOrder('" + safeCls + "', this.value)\">" +
                     '<button type="button" class="btn btn-outline btn-sm" style="padding:2px 6px;" title="اوپر" ' +
                     "onclick=\"exmMoveClassMatrix('" + safeCls + "', -1)\">↑</button>" +
                     '<button type="button" class="btn btn-outline btn-sm" style="padding:2px 6px;" title="نیچے" ' +
                     "onclick=\"exmMoveClassMatrix('" + safeCls + "', 1)\">↓</button>" +
                     '</div>')
                  : '') +
              '</td>';
          for (var c = 0; c < maxCols; c++) {
              var book = books[c];
              if (!book) {
                  bodyHtml += '<td class="tpl-matrix-cell">—</td>';
                  continue;
              }
              var safeId = exmTplEscapeAttr(book.id);
              var dateVal = book.date ? String(book.date) : '';
              bodyHtml +=
                  '<td class="tpl-matrix-cell">' +
                  '<div><strong>' + exmTplEscapeHtml(book.name) + '</strong></div>' +
                  (editMode
                      ? ('<div class="tpl-matrix-ctrl" style="margin-top:6px;">' +
                         '<input type="date" value="' + exmTplEscapeHtml(dateVal) + '" ' +
                         'style="max-width:140px;padding:2px 4px;font-size:12px;" title="امتحانی تاریخ" ' +
                         "onchange=\"exmSetTplBookDate('" + safeCls + "', '" + safeId + "', this.value)\">" +
                         '</div>' +
                         '<button type="button" class="icon-btn delete tpl-matrix-del" title="حذف" ' +
                         "onclick=\"deleteTplBook('" + safeCls + "', '" + safeId + "')\">" +
                         '<i class="fas fa-trash"></i></button>')
                      : (dateVal
                          ? '<div class="tpl-paper-date-print" style="margin-top:4px;font-size:12px;">' + exmMatrixDateLabel(dateVal) + '</div>'
                          : '')) +
                  '</td>';
          }
          bodyHtml += '</tr>';
      });

      table.innerHTML = '<thead><tr>' + headCells + '</tr></thead><tbody>' + bodyHtml + '</tbody>';
      if (editMode) exmBindMatrixPaperColumnDrag(table);
      if (prefix === 'tpl') exmSyncScheduleMatrixMirror(templates);
  }

  function exmSyncScheduleMatrixMirror(templates) {
      var wrap = document.getElementById('sch-matrix-wrap');
      if (!wrap || wrap.style.display === 'none') return;
      exmRenderAllClassesMatrix(templates, { prefix: 'sch', editMode: false });
  }

  function exmShowScheduleAllClassesMatrix() {
      if (typeof window.exmSyncTimetableBooksToMasterSheet === 'function') {
          try { window.exmSyncTimetableBooksToMasterSheet({ silent: true }); } catch (eSyncSch) { /* ignore */ }
      }
      var templates = exmReadJson('ems_exam_templates', []);
      var toolbar = document.getElementById('sch-format-toolbar');
      var flat = document.getElementById('sch-printable-area');
      var matrix = document.getElementById('sch-matrix-wrap');
      if (toolbar) toolbar.style.display = 'none';
      if (flat) flat.style.display = 'none';
      if (matrix) matrix.style.display = 'block';
      exmRenderAllClassesMatrix(templates, { prefix: 'sch', editMode: false });
      var hasBooks = (templates || []).some(function (t) { return t && (t.books || []).length; });
      if (!hasBooks) return showToast('ماسٹر شیٹ میں کوئی کتاب نہیں ملی!', 'error');
      showToast('تمام درجات کا نقشہ تیار ہے!', 'success');
  }

  window.renderTemplateTable = function(cls) {

      const tbody = document.querySelector('#tpl-books-table tbody');

      if(!tbody && cls !== EXM_TPL_ALL_CLASSES) return;

      if (typeof window.exmSyncTimetableBooksToMasterSheet === 'function') {
          try { window.exmSyncTimetableBooksToMasterSheet({ silent: true }); } catch (eSync2) { /* ignore */ }
      }

      let templates = exmReadJson('ems_exam_templates', []);

      var examName = (document.getElementById('sch-exam-name') || {}).value || 'سالانہ امتحان';

      if (cls === EXM_TPL_ALL_CLASSES) {
          exmSetTplTableMode('all');
          exmApplyMasterSheetMetaToUi(exmReadMasterSheetMeta());
          exmRenderAllClassesMatrix(templates);
          exmFillTplSheetNameField(EXM_TPL_ALL_CLASSES);
          return;
      }

      exmSetTplTableMode('detail');
      if (!tbody) return;
      tbody.innerHTML = '';
      exmFillTplSheetNameField(cls);

      let classTpl = templates.find(t => t.class === cls);

      if(!classTpl || classTpl.books.length === 0) { tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;">اس درجے کی شیٹ میں کوئی کتاب نہیں</td></tr>'; return; }

      classTpl.books.forEach(book => {

          var scopeTxt = window.examFormatCurScope(window.examGetCurScopeForBook(book.name, examName)) || book.curScope || '—';

          var safeCls = exmTplEscapeAttr(classTpl.class);
          var safeId = exmTplEscapeAttr(book.id);
          var sheetLabel = exmTplDisplayName(classTpl);

          tbody.innerHTML += `<tr><td><strong>${exmTplEscapeHtml(sheetLabel)}</strong>${classTpl.sheetName ? '<div style="font-size:11px;color:#64748b;">' + exmTplEscapeHtml(classTpl.class) + '</div>' : ''}</td><td>${exmTplEscapeHtml(book.name)}</td><td style="font-size:12px;color:#5b21b6;">${exmTplEscapeHtml(scopeTxt)}</td><td>${book.marks}</td><td>${book.date || '-'}</td><td>${exmTplEscapeHtml(book.time || '-')}</td><td>${exmTplEscapeHtml(book.room || '-')}</td><td>${exmTplEscapeHtml(book.invigilator || '-')}</td><td>${exmTplEscapeHtml(book.teacher || '-')}</td><td>${exmTplEscapeHtml(book.paperType || 'تحریری')}</td>

                              <td><button class="icon-btn delete" onclick="deleteTplBook('${safeCls}', '${safeId}')" title="صرف اس ماسٹر شیٹ سے ہٹائیں"><i class="fas fa-trash"></i></button></td></tr>`;

      });

  };



  document.getElementById('tpl-matrix-title')?.addEventListener('change', function () {
      if ((document.getElementById('tpl-class-select') || {}).value === EXM_TPL_ALL_CLASSES) {
          exmPersistMatrixMetaFromUi();
          renderTemplateTable(EXM_TPL_ALL_CLASSES);
      }
  });
  document.getElementById('tpl-matrix-time')?.addEventListener('change', function () {
      if ((document.getElementById('tpl-class-select') || {}).value === EXM_TPL_ALL_CLASSES) {
          exmPersistMatrixMetaFromUi();
          renderTemplateTable(EXM_TPL_ALL_CLASSES);
      }
  });

  window.deleteTplBook = function(cls, bookId) {

      if(!confirm("یہ کتاب صرف اسی ماسٹر شیٹ سے ہٹے گی۔ لائبریری یا نظام الاوقات سے نہیں ہٹے گی۔ جاری رکھیں؟")) {
          return;
      }

      let templates = exmReadJson('ems_exam_templates', []);
      let classTpl = templates.find(t => t.class === cls);
      if (!classTpl || !Array.isArray(classTpl.books)) return;

      var removedBook = classTpl.books.find(function (b) { return b && b.id === bookId; });
      classTpl.books = classTpl.books.filter(function (b) { return !b || b.id !== bookId; });
      if (removedBook) exmTplMarkBookRemoved(classTpl, removedBook.name);
      emsSaveKey('ems_exam_templates', JSON.stringify(templates));
      var viewCls = (document.getElementById('tpl-class-select') || {}).value || cls;
      renderTemplateTable(viewCls);
      renderQuickAccessTabs();
      if (typeof showToast === 'function') {
          showToast('کتاب اس ماسٹر شیٹ سے ہٹا دی گئی (صرف شیٹ سے)', 'success');
      }
  };

  function exmFillTplSheetNameField(cls) {
      var nameEl = document.getElementById('tpl-sheet-name');
      if (!nameEl) return;
      if (!cls) {
          nameEl.value = '';
          return;
      }
      if (cls === EXM_TPL_ALL_CLASSES) {
          var meta = exmReadMasterSheetMeta();
          var titleEl = document.getElementById('tpl-matrix-title');
          nameEl.value = (meta.allSheetName || (titleEl && titleEl.value) || '').trim();
          return;
      }
      var templates = exmReadJson('ems_exam_templates', []);
      var classTpl = (templates || []).find(function (t) { return t && t.class === cls; });
      nameEl.value = classTpl && classTpl.sheetName
          ? String(classTpl.sheetName)
          : String(cls);
  }

  window.exmSaveTplSheet = function () {
      var cls = (document.getElementById('tpl-class-select') || {}).value;
      var nameEl = document.getElementById('tpl-sheet-name');
      var sheetName = nameEl ? String(nameEl.value || '').trim() : '';
      if (!cls) return showToast('پہلے درجہ / شیٹ منتخب کریں', 'error');
      if (!sheetName) return showToast('شیٹ کا نام لکھیں', 'error');

      if (cls === EXM_TPL_ALL_CLASSES) {
          var meta = exmReadMasterSheetMeta();
          meta.allSheetName = sheetName;
          var titleEl = document.getElementById('tpl-matrix-title');
          var timeEl = document.getElementById('tpl-matrix-time');
          if (titleEl) {
              if (!String(titleEl.value || '').trim()) titleEl.value = sheetName;
              meta.matrixTitle = String(titleEl.value || '').trim();
          } else {
              meta.matrixTitle = sheetName;
          }
          if (timeEl) meta.matrixTime = String(timeEl.value || '').trim();
          exmWriteMasterSheetMeta(meta);
          renderTemplateTable(EXM_TPL_ALL_CLASSES);
          renderQuickAccessTabs();
          showToast('تمام درجات شیٹ کا نام محفوظ ہو گیا', 'success');
          return;
      }

      var templates = exmReadJson('ems_exam_templates', []);
      if (!Array.isArray(templates)) templates = [];
      var classTpl = exmEnsureClassTemplate(templates, cls);
      classTpl.sheetName = sheetName;
      emsSaveKey('ems_exam_templates', JSON.stringify(templates));
      renderTemplateTable(cls);
      renderQuickAccessTabs();
      showToast('شیٹ کا نام محفوظ ہو گیا: ' + sheetName, 'success');
  };



  let activeSchClass = "";
  const SCH_DAYS_URDU = ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'];

  window.examBuildScheduleRows = function (aggregate, cls, examName) {
      let templates = exmReadJson('ems_exam_templates', []);
      let rows = [];
      let src = aggregate ? templates : templates.filter(t => t.class === cls);
      examName = examName || (document.getElementById('sch-exam-name') || {}).value || 'سالانہ امتحان';
      src.forEach(tpl => {
          (tpl.books || []).forEach(book => {
              var scopeTxt = window.examFormatCurScope(window.examGetCurScopeForBook(book.name, examName)) || book.curScope || '—';
              rows.push({ cls: tpl.class, name: book.name, marks: book.marks, date: book.date || '', time: book.time || '', room: book.room || '', invigilator: book.invigilator || '', teacher: book.teacher || '', paperType: book.paperType || 'تحریری', curScope: scopeTxt });
          });
      });
      // تاریخ کے لحاظ سے ترتیب (خالی تاریخ آخر میں)
      rows.sort((a, b) => {
          if (!a.date) return 1; if (!b.date) return -1;
          return a.date.localeCompare(b.date);
      });
      return rows;
  };

  document.getElementById('btn-generate-schedule')?.addEventListener('click', () => {

      const examName = document.getElementById('sch-exam-name').value;
      const aggregate = document.getElementById('sch-aggregate')?.checked;
      const cls = document.getElementById('sch-class-select').value;
      var showAllMatrix = aggregate || cls === EXM_TPL_ALL_CLASSES;
      activeSchClass = showAllMatrix ? '' : cls;

      if(!showAllMatrix && !cls) return showToast("درجہ منتخب کریں، 'تمام درجات' چنیں، یا 'اجتماعی نقشہ' پر نشان لگائیں!", "error");

      if (showAllMatrix) {
          exmShowScheduleAllClassesMatrix();
          return;
      }

      let rows = window.examBuildScheduleRows(aggregate, cls, examName);
      if(rows.length === 0) return showToast("ماسٹر شیٹ میں کوئی کتاب نہیں ملی!", "error");

      let templates = exmReadJson('ems_exam_templates', []);
      let classTpl = templates.find(t => t.class === cls) || { customHeader: '', fontSize: 16, textAlign: 'right', showBorder: true };

      var schMatrix = document.getElementById('sch-matrix-wrap');
      if (schMatrix) schMatrix.style.display = 'none';
      document.getElementById('sch-format-toolbar').style.display = 'flex';
      document.getElementById('sch-printable-area').style.display = 'block';

      // مدرسہ برانڈنگ ہیڈر/فوٹر خودکار
      var bh = document.getElementById('sch-brand-header');
      if (bh && typeof window.attBrandHeaderHTML === 'function') bh.innerHTML = window.attBrandHeaderHTML();
      var bf = document.getElementById('sch-brand-footer');
      if (bf && typeof window.attSignFooterHTML === 'function') bf.innerHTML = window.attSignFooterHTML();

      document.getElementById('sch-custom-header').value = classTpl.customHeader || '';
      document.getElementById('sch-print-header').innerText = classTpl.customHeader || '';
      document.getElementById('sch-border-toggle').checked = classTpl.showBorder !== false;

      const table = document.getElementById('sch-print-table');
      table.style.textAlign = classTpl.textAlign || 'right';
      table.style.fontSize = (classTpl.fontSize || 16) + 'px';
      table.style.fontFamily = classTpl.fontFamily || "'Noto Nastaliq Urdu', serif";
      table.style.color = classTpl.textColor || '#1e293b';
      table.border = classTpl.showBorder !== false ? "1" : "0";
      var thead = document.getElementById('sch-print-thead');
      if (thead) thead.style.background = classTpl.headColor || '#eef2f6';
      if (document.getElementById('sch-font-family')) document.getElementById('sch-font-family').value = classTpl.fontFamily || "'Noto Nastaliq Urdu', serif";
      if (document.getElementById('sch-head-color')) document.getElementById('sch-head-color').value = classTpl.headColor || '#eef2f6';
      if (document.getElementById('sch-text-color')) document.getElementById('sch-text-color').value = classTpl.textColor || '#1e293b';

      document.getElementById('sch-print-title').innerText = `${examName} - ${cls}`;

      // ہیڈر کالم
      if (thead) {
          thead.innerHTML = '<tr><th>تاریخ</th><th>دن</th><th>وقت</th><th>کتاب / پرچہ</th><th>نصاب حصہ</th><th>استاد</th><th>کمرہ</th><th>نگران</th><th>نوعیت</th></tr>';
      }

      const tbody = document.getElementById('sch-print-tbody');
      tbody.innerHTML = '';
      rows.forEach(r => {
          let dayName = "-";
          if(r.date) { let d = new Date(r.date); dayName = SCH_DAYS_URDU[d.getDay()]; }
          tbody.innerHTML += '<tr>' +
              `<td>${r.date || 'طے نہیں'}</td><td>${dayName}</td><td>${r.time || '-'}</td><td><strong>${r.name}</strong></td><td style="font-size:12px;color:#5b21b6;">${r.curScope || '—'}</td><td>${r.teacher || '-'}</td><td>${r.room || '-'}</td><td>${r.invigilator || '-'}</td><td>${r.paperType || 'تحریری'}</td></tr>`;
      });
      showToast("نقشہ تیار ہے! آپ فارمیٹنگ و رنگ کے ٹولز استعمال کر سکتے ہیں۔", "success");

  });

  window.changeSchFormat = function(type, val) {
      const table = document.getElementById('sch-print-table');
      const thead = document.getElementById('sch-print-thead');
      if(type === 'align') table.style.textAlign = val;
      if(type === 'size') { let curr = parseInt(table.style.fontSize) || 16; table.style.fontSize = (curr + (val*2)) + 'px'; }
      if(type === 'border') table.border = val ? "1" : "0";
      if(type === 'font') table.style.fontFamily = val;
      if(type === 'headcolor' && thead) thead.style.background = val;
      if(type === 'textcolor') table.style.color = val;
  };

  // امتحانی نقشہ → Excel/CSV برآمد
  window.examExportSchedule = function () {
      const aggregate = document.getElementById('sch-aggregate')?.checked;
      const cls = document.getElementById('sch-class-select').value;
      const examName = document.getElementById('sch-exam-name').value || 'امتحان';
      var asAll = aggregate || cls === EXM_TPL_ALL_CLASSES;
      let rows = window.examBuildScheduleRows(asAll, asAll ? '' : cls, examName);
      if (!rows.length) return showToast("پہلے نقشہ بنائیں!", "error");
      let header = (asAll ? ['درجہ'] : []).concat(['تاریخ', 'دن', 'وقت', 'کتاب', 'نصاب حصہ', 'استاد', 'کمرہ', 'نگران', 'نوعیت']);
      let data = rows.map(r => {
          let day = r.date ? SCH_DAYS_URDU[new Date(r.date).getDay()] : '-';
          return (asAll ? [r.cls] : []).concat([r.date || '', day, r.time || '', r.name, r.curScope || '—', r.teacher || '', r.room || '', r.invigilator || '', r.paperType || '']);
      });
      window.examDownloadCSV([header].concat(data), `نقشہ_${examName}.csv`);
  };



  document.getElementById('sch-custom-header')?.addEventListener('input', function() { document.getElementById('sch-print-header').innerText = this.value; });



  window.saveSchTemplate = function() {

      if(!activeSchClass) return;

      let templates = exmReadJson('ems_exam_templates', []);

      let classTpl = templates.find(t => t.class === activeSchClass);

      if(classTpl) {

          const table = document.getElementById('sch-print-table');
          classTpl.customHeader = document.getElementById('sch-custom-header').value;
          classTpl.textAlign = table.style.textAlign;
          classTpl.fontSize = parseInt(table.style.fontSize);
          classTpl.showBorder = document.getElementById('sch-border-toggle').checked;
          classTpl.fontFamily = document.getElementById('sch-font-family')?.value || table.style.fontFamily;
          classTpl.headColor = document.getElementById('sch-head-color')?.value || '#eef2f6';
          classTpl.textColor = document.getElementById('sch-text-color')?.value || '#1e293b';
          emsSaveKey('ems_exam_templates', JSON.stringify(templates));
          showToast("فارمیٹنگ، رنگ اور ہیڈر ماسٹر شیٹ میں محفوظ ہو گئے!", "success");

      } else {
          showToast("اجتماعی نقشے کی سیٹنگ محفوظ نہیں ہوتی — درجہ منتخب کر کے محفوظ کریں۔", "warning");
      }

  };

  // =========================================================
  // CSV/Excel برآمد کا مشترکہ helper (BOM کے ساتھ تاکہ اردو درست کھلے)
  // =========================================================
  window.examDownloadCSV = function (rows, filename) {
      var csv = rows.map(function (r) {
          return r.map(function (cell) {
              var s = String(cell == null ? '' : cell);
              if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
              return s;
          }).join(',');
      }).join('\r\n');
      var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename || 'export.csv';
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
      if (typeof showToast === 'function') showToast('فائل برآمد ہو گئی: ' + (filename || 'export.csv'), 'success');
  };

  // =========================================================
  // Phase A: marks math — cap, absent (AB), %, grade, ranking
  // =========================================================
  var EXM_PASS_PERCENT = 40;

  function exmIsAbsentMark(val) {
      if (val == null) return false;
      if (val === 'AB') return true;
      var s = String(val).trim();
      if (s === '') return false;
      return /^ab$/i.test(s) || s === 'غ' || /غیر\s*حاضر/i.test(s);
  }

  /** Grid cell display — never show English AB; empty = غیر حاضر / خالی. */
  function exmGridMarkDisplay(val) {
      if (val === undefined || val === null || val === '') return '';
      if (exmIsAbsentMark(val)) return '';
      return val;
  }

  function exmHasNumericMarks(marks) {
      if (!marks) return false;
      var keys = Object.keys(marks);
      for (var i = 0; i < keys.length; i++) {
          var v = marks[keys[i]];
          if (exmIsAbsentMark(v)) continue;
          if (v === '' || v == null) continue;
          if (!isNaN(Number(v))) return true;
      }
      return false;
  }

  /** حاصل کردہ — صرف جب حقیقی نمبر ہوں؛ ورنہ خالی (0/پرانے AB مجموعے نہ دکھائیں). */
  function exmGridObtainedDisplay(marks, totalObtained) {
      if (!exmHasNumericMarks(marks)) return '';
      var n = Number(totalObtained);
      if (isNaN(n)) n = exmSumMarks(marks);
      return String(n);
  }

  function exmDisplayMark(val) {
      if (val == null || val === '') return '-';
      if (exmIsAbsentMark(val)) return 'غیر حاضر';
      return val;
  }

  function exmGetBookMax(bookName) {
      var b = currentClassTemplateBooks.find(function (x) { return x.name === bookName; });
      return b ? (Number(b.marks) || 0) : 100;
  }

  /** Normalize raw cell → number (clamped) or 'AB'. Empty → 'AB'. */
  function exmNormalizeMarkRaw(raw, maxMarks) {
      if (raw == null) return 'AB';
      var s = String(raw).trim();
      if (s === '') return 'AB';
      if (/^ab$/i.test(s) || s === 'غ' || /غیر\s*حاضر/i.test(s)) return 'AB';
      var n = Number(s);
      if (isNaN(n)) return 'AB';
      if (n < 0) n = 0;
      var max = Number(maxMarks);
      if (isNaN(max) || max <= 0) return 0;
      if (n > max) n = max;
      return n;
  }

  function exmSumMarks(marks) {
      var sum = 0;
      if (!marks) return 0;
      Object.keys(marks).forEach(function (k) {
          var v = marks[k];
          if (exmIsAbsentMark(v)) return;
          var n = Number(v);
          if (!isNaN(n)) sum += n;
      });
      return sum;
  }

  function exmCalcPercentage(totalObtained, totalPossible) {
      var obt = Number(totalObtained) || 0;
      var poss = Number(totalPossible) || 0;
      if (poss <= 0) return 0;
      var pct = (obt / poss) * 100;
      return isNaN(pct) || !isFinite(pct) ? 0 : pct;
  }

  function exmGradeFromPercentage(percentage) {
      var pct = Number(percentage) || 0;
      if (pct >= 90) return 'ممتاز مرتفع';
      if (pct >= 80) return 'ممتاز';
      if (pct >= 60) return 'جید جدا';
      if (pct >= 50) return 'جید';
      if (pct >= EXM_PASS_PERCENT) return 'مقبول';
      return 'راسب';
  }

  function exmIsPassingResult(res) {
      if (!res) return false;
      if (String(res.grade || '').includes('راسب')) return false;
      var pct = parseFloat(res.percentage);
      if (isNaN(pct)) pct = exmCalcPercentage(res.totalObtained, res.grandTotal);
      return pct >= EXM_PASS_PERCENT;
  }

  function exmAssignPositions(classResults) {
      var posMap = ['اول', 'دوم', 'سوم', 'چہارم', 'پنجم', 'ششم', 'ہفتم', 'ہشتم', 'نہم', 'دہم'];
      var passing = classResults.filter(exmIsPassingResult);
      var uniqueScores = [];
      passing.forEach(function (r) {
          var t = Number(r.totalObtained) || 0;
          if (uniqueScores.indexOf(t) < 0) uniqueScores.push(t);
      });
      uniqueScores.sort(function (a, b) { return b - a; });
      classResults.forEach(function (res) {
          if (!exmIsPassingResult(res)) {
              res.positionStr = 'راسب';
              return;
          }
          var rankNum = uniqueScores.indexOf(Number(res.totalObtained) || 0);
          res.positionStr = rankNum < 10 ? posMap[rankNum] : String(rankNum + 1);
      });
  }

  /** Branded کشف النتیجہ HTML — shared with parent portal print */
  window.exmBuildStudentCardHtml = function (res, examName) {
      if (!res) return '<p style="text-align:center;color:red;">نتيجہ دستیاب نہیں</p>';
      examName = examName || res.examName || 'امتحان';
      var templates = exmReadJson('ems_exam_templates', []);
      var tplBooks = (templates.find(function (t) { return t.class === res.class; }) || {}).books || [];
      var brandHeader = (typeof window.attBrandHeaderHTML === 'function') ? window.attBrandHeaderHTML() : '';
      var brandFooter = (typeof window.attSignFooterHTML === 'function') ? window.attSignFooterHTML() : '';
      var gradeColor = String(res.grade || '').includes('راسب') ? 'red' : 'green';
      var photoHtml = res.studentPhoto
          ? '<img src="' + res.studentPhoto + '" style="width:90px; height:90px; border-radius:8px; border:2px solid #ccc; object-fit:cover;">'
          : '<i class="fas fa-user-circle fa-4x" style="color:#bdc3c7;"></i>';
      var positionStr = res.positionStr || '—';
      var html = '<div style="border: 4px double #2c3e50; padding: 30px; text-align: right; max-width: 800px; margin: 0 auto; background: #fffaf0; position:relative;">' +
          brandHeader +
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 20px;">' +
          '<div>' + photoHtml + '</div>' +
          '<div style="text-align:center;"><h1 style="color:#2c3e50; font-family:\'Noto Nastaliq Urdu\', serif; font-size:32px; margin:0;">کشف النتیجہ</h1>' +
          '<h3 style="color:#7f8c8d; margin-top:5px;">' + examName + '</h3></div>' +
          '<div style="text-align:center; border:1px solid #cbd5e1; border-radius:8px; padding:8px 12px; background:#fff;">' +
          '<div style="font-size:11px; color:#94a3b8;">رول نمبر</div>' +
          '<div style="font-weight:bold; font-size:18px; color:#2c3e50;">' + (res.studentId || '') + '</div></div></div>' +
          '<div style="display:flex; justify-content:space-between; border-top:2px solid #2c3e50; border-bottom:2px solid #2c3e50; padding:10px 0; font-size:18px; font-weight:bold;">' +
          '<div>نام: <span style="color:var(--accent);">' + (res.studentName || '') + '</span></div>' +
          '<div>درجہ: <span style="color:var(--accent);">' + (res.class || '') + '</span></div>' +
          '<div>رول نمبر: <span style="color:var(--accent);">' + (res.studentId || '') + '</span></div></div>' +
          '<table style="width:100%; border-collapse: collapse; margin-top:20px; text-align:right;" border="1">' +
          '<thead style="background:#2c3e50; color:white;"><tr><th style="padding:8px;">مضمون / کتاب</th>' +
          '<th style="text-align:center; padding:8px;">کل نمبر</th><th style="text-align:center; padding:8px;">حاصل کردہ</th></tr></thead><tbody>';
      tplBooks.forEach(function (book) {
          var bookTotal = book.marks || 100;
          var obtained = exmDisplayMark(res.marks && res.marks[book.name]);
          html += '<tr><td style="padding:8px;"><strong>' + book.name + '</strong></td>' +
              '<td style="text-align:center; padding:8px;">' + bookTotal + '</td>' +
              '<td style="text-align:center; font-size:18px; padding:8px; font-weight:bold;">' + obtained + '</td></tr>';
      });
      if (!tplBooks.length && res.marks) {
          Object.keys(res.marks).forEach(function (book) {
              html += '<tr><td style="padding:8px;"><strong>' + book + '</strong></td>' +
                  '<td style="text-align:center; padding:8px;">100</td>' +
                  '<td style="text-align:center; font-size:18px; padding:8px; font-weight:bold;">' +
                  exmDisplayMark(res.marks[book]) + '</td></tr>';
          });
      }
      html += '</tbody></table>' +
          '<div style="display:flex; justify-content:space-around; margin-top:30px; background:#eef2f6; padding:15px; border:1px solid #2c3e50; border-radius:8px;">' +
          '<div style="text-align:center;"><strong>کل نمبرات</strong><br><span style="font-size:24px;">' + (res.grandTotal || '—') + '</span></div>' +
          '<div style="text-align:center;"><strong>حاصل کردہ</strong><br><span style="font-size:24px; color:var(--accent); font-weight:bold;">' + (res.totalObtained || '—') + '</span></div>' +
          '<div style="text-align:center;"><strong>فیصد</strong><br><span style="font-size:24px;">' + (res.percentage != null ? res.percentage : '—') + '%</span></div>' +
          '<div style="text-align:center;"><strong>درجہ (گریڈ)</strong><br><span style="font-size:22px; color:' + gradeColor + '; font-weight:bold;">' + (res.grade || '—') + '</span></div>' +
          '<div style="text-align:center;"><strong>پوزیشن</strong><br><span style="font-size:26px; color:var(--warning); font-weight:bold;">' + positionStr + '</span></div>' +
          '</div>' + brandFooter + '</div>';
      return html;
  };

  window.exmPrintStudentCard = function (res, examName, targetId) {
      targetId = targetId || 'pp-result-print-area';
      var area = document.getElementById(targetId) || document.getElementById('result-printable-area');
      if (!area) return false;
      area.innerHTML = window.exmBuildStudentCardHtml(res, examName);
      area.style.display = 'block';
      if (typeof window.printDiv === 'function') {
          window.printDiv(area.id);
      } else {
          window.print();
      }
      return true;
  };

  function exmNormalizeRowMarks(marks) {
      var out = {};
      currentClassTemplateBooks.forEach(function (b) {
          out[b.name] = exmNormalizeMarkRaw(marks && marks[b.name], b.marks);
      });
      return out;
  }

  function exmMergeMarksForSave(rowMarks, existingMarks) {
      var out = {};
      existingMarks = existingMarks || {};
      currentClassTemplateBooks.forEach(function (b) {
          if (window.exmCanEditBookColumn(b)) {
              out[b.name] = exmNormalizeMarkRaw(rowMarks && rowMarks[b.name], b.marks);
          } else if (existingMarks[b.name] !== undefined) {
              out[b.name] = existingMarks[b.name];
          } else if (!window.exmIsTeacherOnly()) {
              out[b.name] = exmNormalizeMarkRaw(rowMarks && rowMarks[b.name], b.marks);
          }
      });
      Object.keys(existingMarks).forEach(function (bookName) {
          if (out[bookName] === undefined) out[bookName] = existingMarks[bookName];
      });
      return out;
  }

  function exmMarkSortValue(v) {
      if (exmIsAbsentMark(v)) return -1;
      return Number(v) || 0;
  }

  let currentGridData = []; 

  let currentTotalPossibleMarks = 0;

  let currentClassTemplateBooks = [];

  

  document.getElementById('btn-generate-mark-sheet')?.addEventListener('click', () => {

      const examName = document.getElementById('mrk-exam-name').value;

      const cls = document.getElementById('mrk-class').value;

      const resultDate = exmEnsureResultDateFilled('mrk');



      if(!examName) return showToast("امتحان منتخب کرنا لازمی ہے!", "error");

      if(!cls) return showToast("درجہ منتخب کرنا لازمی ہے!", "error");

      if (!resultDate) return showToast("نتیجے کی تاریخ منتخب کریں!", "error");

      function exmBuildMarkSheetGrid() {

      let templates = exmReadJson('ems_exam_templates', []);

      let classTpl = exmFindClassTpl(templates, cls);

      if(!classTpl || !Array.isArray(classTpl.books) || classTpl.books.length === 0) return showToast("اس درجے کی ماسٹر شیٹ میں کوئی کتاب نہیں ہے۔ پہلے ماسٹر شیٹ میں کتابیں شامل کریں۔", "error");



      currentClassTemplateBooks = classTpl.books;

      const students = exmStudentsInClass(cls);



      if(students.length === 0) return showToast("اس درجے میں کوئی طالب علم رجسٹرڈ نہیں!", "error");



      const theadTr = document.getElementById('mrk-entry-headers');

      

      let headerHTML = '<th>طالب علم کا نام / ID</th>';

      currentTotalPossibleMarks = 0;

      

      const frBookSelect = document.getElementById('fr-book');

      const sortBookSelect = document.getElementById('mrk-sort-book');

      frBookSelect.innerHTML = '<option value="">کتاب منتخب کریں...</option>';

      sortBookSelect.innerHTML = '<option value="">کتاب منتخب کریں...</option>';



      classTpl.books.forEach(b => { 

          headerHTML += `<th>${b.name} <br><small>(${b.marks})</small></th>`; 

          currentTotalPossibleMarks += Number(b.marks) || 0;

          frBookSelect.innerHTML += `<option value="${b.name}">${b.name}</option>`;

          sortBookSelect.innerHTML += `<option value="${b.name}">${b.name}</option>`;

      });

      headerHTML += '<th>کل نمبر</th><th>حاصل کردہ</th>';

      theadTr.innerHTML = headerHTML;



      const dbMarks = exmReadJson(DB.exams, []);

      const frStudentSelect = document.getElementById('fr-student');

      frStudentSelect.innerHTML = '<option value="">طالب علم تلاش کریں...</option>';



      currentGridData = students.map(std => {

          let existingRecord = exmFindStudentResult(dbMarks, examName, classTpl.class || cls, std.id, resultDate);

          frStudentSelect.innerHTML += `<option value="${std.id}">${std.name} (${std.id})</option>`;

          return {

              student: std,

              marks: existingRecord ? (existingRecord.marks || {}) : {},

              totalObtained: existingRecord ? exmSumMarks(existingRecord.marks || {}) : 0,

          };

      });



      document.getElementById('mrk-filters-area').style.display = 'block';

      document.getElementById('btn-save-all-marks').style.display = 'inline-flex';
      if (document.getElementById('btn-exam-data-page')) document.getElementById('btn-exam-data-page').style.display = 'inline-flex';
      var navPad = document.getElementById('mrk-nav-pad');
      if (navPad) navPad.style.display = 'flex';

      

      currentGridData.sort((a, b) => a.student.id.localeCompare(b.student.id));

      renderMarksGrid(); 

      if (typeof window.exmRefreshResultDateOptions === 'function') window.exmRefreshResultDateOptions('mrk');
      if (typeof window.exmUpdateLockUi === 'function') window.exmUpdateLockUi();

      showToast("ایکسل گرڈ تیار ہے! " + students.length + " طلبہ — تاریخ: " + exmFormatResultDateLabel(resultDate), "success");

      }

      var ensureMarks = typeof window.emsDurableEnsureKey === 'function'
        ? Promise.all([
            window.emsDurableEnsureKey(DB.exams),
            window.emsDurableEnsureKey('ems_exam_templates')
          ])
        : Promise.resolve();
      Promise.resolve(ensureMarks).then(exmBuildMarkSheetGrid).catch(exmBuildMarkSheetGrid);

  });



  function renderMarksGrid() {

      const tbody = document.getElementById('mrk-entry-tbody');
      if (!tbody) return;
      const scrollEl = tbody.closest('.table-responsive');

      if (!currentGridData.length) {
          if (typeof window.emsVirtualTableDestroy === 'function') window.emsVirtualTableDestroy('mrk-entry');
          tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">کوئی طالب علم نہیں</td></tr>';
          return;
      }

      function bindMarkInputs(tr, index) {
          var stdId = tr.getAttribute('data-std-id');
          tr.querySelectorAll('.mark-val-input').forEach(function (input) {
              function syncRowFromInputs() {
                  if (input.disabled) return;
                  var rowIndex = index;
                  if (stdId) {
                      var found = currentGridData.findIndex(function (r) {
                          return r.student && r.student.id === stdId;
                      });
                      if (found >= 0) rowIndex = found;
                  }
                  if (!currentGridData[rowIndex]) return;
                  tr.querySelectorAll('.mark-val-input').forEach(function (inp) {
                      if (inp.disabled) return;
                      var subject = inp.getAttribute('data-subject');
                      var max = exmGetBookMax(subject);
                      var normalized = exmNormalizeMarkRaw(inp.value, max);
                      currentGridData[rowIndex].marks[subject] = normalized;
                      if (normalized === 'AB') {
                          inp.value = '';
                      } else if (String(normalized) !== String(inp.value).trim()) {
                          inp.value = normalized;
                      }
                  });
                  currentGridData[rowIndex].totalObtained = exmSumMarks(currentGridData[rowIndex].marks);
                  var totEl = tr.querySelector('.row-obtained-total');
                  if (totEl) {
                      totEl.innerText = exmGridObtainedDisplay(
                          currentGridData[rowIndex].marks,
                          currentGridData[rowIndex].totalObtained
                      );
                  }
              }
              input.addEventListener('input', syncRowFromInputs);
              input.addEventListener('blur', syncRowFromInputs);
              exmBindMarkNavKeys(input);
          });
      }

      function renderMarkRow(index, row) {
          var tr = document.createElement('tr');
          tr.className = 'mark-entry-row';
          tr.setAttribute('data-index', index);
          tr.setAttribute('data-std-id', row.student.id);
          var trHTML = '<td><strong>' + row.student.name + '</strong> <br><small>' + row.student.id + '</small></td>';
          currentClassTemplateBooks.forEach(function (b, colIdx) {
              var val = row.marks[b.name];
              var displayVal = exmGridMarkDisplay(val);
              var canEdit = window.exmCanEditBookColumn(b);
              var lockHint = exmIsMarksContextLocked() ? 'یہ نتیجہ لاک ہو چکا ہے' : 'آپ اس مضمون کے مجاز استاد نہیں';
              var disAttr = canEdit ? '' : ' disabled readonly';
              var titleAttr = canEdit ? 'خالی یا غ = غیر حاضر | تیر والے بٹن سے حرکت' : lockHint;
              trHTML += '<td><input type="text" class="input-control mark-val-input" data-subject="' + b.name +
                  '" data-max="' + b.marks + '" data-row="' + index + '" data-col="' + colIdx +
                  '" value="' + displayVal + '" placeholder="" title="' + titleAttr + '"' + disAttr +
                  ' style="width: 70px; text-align:center;"></td>';
          });
          trHTML += '<td style="font-weight:bold;">' + currentTotalPossibleMarks + '</td>' +
              '<td class="row-obtained-total" style="font-weight:bold; color:var(--accent); font-size:16px;">' +
              exmGridObtainedDisplay(row.marks, row.totalObtained) + '</td>';
          tr.innerHTML = trHTML;
          bindMarkInputs(tr, index);
          return tr;
      }

      if (scrollEl && typeof window.emsVirtualTableMount === 'function') {
          scrollEl.style.maxHeight = scrollEl.style.maxHeight || '58vh';
          scrollEl.style.overflowY = 'auto';
          window.emsVirtualTableMount('mrk-entry', {
              scrollEl: scrollEl,
              tbody: tbody,
              rowHeight: 52,
              getData: function () { return currentGridData; },
              renderRow: function (i, row) { return renderMarkRow(i, row); },
              emptyHtml: '<tr><td colspan="3" style="text-align:center;">کوئی طالب علم نہیں</td></tr>'
          });
          if (typeof window.exmApplyMarksLockUi === 'function') window.exmApplyMarksLockUi();
          return;
      }

      tbody.innerHTML = '';
      currentGridData.forEach(function (row, index) {
          tbody.appendChild(renderMarkRow(index, row));
      });
      if (typeof window.exmApplyMarksLockUi === 'function') window.exmApplyMarksLockUi();
  }

  function exmEditableMarkCols() {
      var cols = [];
      (currentClassTemplateBooks || []).forEach(function (b, idx) {
          if (window.exmCanEditBookColumn(b)) cols.push(idx);
      });
      return cols;
  }

  function exmFindMarkInput(rowIdx, colIdx) {
      var tbody = document.getElementById('mrk-entry-tbody');
      if (!tbody) return null;
      return tbody.querySelector(
          '.mark-val-input[data-row="' + rowIdx + '"][data-col="' + colIdx + '"]:not([disabled])'
      );
  }

  function exmScrollMarkRowIntoView(rowIdx, colIdx) {
      var scrollEl = document.querySelector('#mrk-entry-tbody') &&
          document.getElementById('mrk-entry-tbody').closest('.table-responsive');
      if (!scrollEl) return Promise.resolve();
      var rowHeight = 52;
      var top = rowIdx * rowHeight;
      var bottom = top + rowHeight;
      var viewTop = scrollEl.scrollTop;
      var viewBot = viewTop + scrollEl.clientHeight;
      if (top < viewTop) scrollEl.scrollTop = top;
      else if (bottom > viewBot) scrollEl.scrollTop = Math.max(0, bottom - scrollEl.clientHeight);
      if (typeof window.emsVirtualTableRefresh === 'function') {
          window.emsVirtualTableRefresh('mrk-entry');
      }
      return new Promise(function (resolve) {
          requestAnimationFrame(function () {
              requestAnimationFrame(function () { resolve(); });
          });
      });
  }

  function exmFocusMarkCell(rowIdx, colIdx) {
      var el = exmFindMarkInput(rowIdx, colIdx);
      if (!el) return false;
      document.querySelectorAll('.mark-val-input.is-mrk-focus').forEach(function (n) {
          n.classList.remove('is-mrk-focus');
      });
      el.classList.add('is-mrk-focus');
      el.focus();
      try { el.select(); } catch (eSel) { /* ignore */ }
      return true;
  }

  window.exmMoveMarkFocus = function (dir) {
      var active = document.activeElement;
      if (!active || !active.classList || !active.classList.contains('mark-val-input')) {
          var first = document.querySelector('#mrk-entry-tbody .mark-val-input:not([disabled])');
          if (first) {
              active = first;
              first.focus();
          } else {
              return false;
          }
      }
      var row = parseInt(active.getAttribute('data-row'), 10);
      var col = parseInt(active.getAttribute('data-col'), 10);
      if (!isFinite(row)) {
          var tr = active.closest('tr');
          row = tr ? parseInt(tr.getAttribute('data-index'), 10) : 0;
      }
      if (!isFinite(col)) col = 0;
      var editable = exmEditableMarkCols();
      if (!editable.length) return false;
      var colPos = editable.indexOf(col);
      if (colPos < 0) colPos = 0;
      var maxRow = (currentGridData || []).length - 1;
      var nextRow = row;
      var nextCol = editable[colPos];

      if (dir === 'up') nextRow = Math.max(0, row - 1);
      else if (dir === 'down' || dir === 'enter') nextRow = Math.min(maxRow, row + 1);
      else if (dir === 'left') {
          /* RTL جدول: بایاں تیر = اگلا مضمون (DOM میں آگے) */
          if (colPos < editable.length - 1) nextCol = editable[colPos + 1];
          else if (row < maxRow) {
              nextRow = row + 1;
              nextCol = editable[0];
          }
      } else if (dir === 'right') {
          /* دایاں تیر = پچھلا مضمون */
          if (colPos > 0) nextCol = editable[colPos - 1];
          else if (row > 0) {
              nextRow = row - 1;
              nextCol = editable[editable.length - 1];
          }
      } else {
          return false;
      }

      if (nextRow === row && nextCol === col) return false;
      active.dispatchEvent(new Event('blur'));
      return exmScrollMarkRowIntoView(nextRow, nextCol).then(function () {
          if (!exmFocusMarkCell(nextRow, nextCol)) {
              /* دوبارہ کوشش — ورچوئل رینڈر تاخیر */
              return exmScrollMarkRowIntoView(nextRow, nextCol).then(function () {
                  return exmFocusMarkCell(nextRow, nextCol);
              });
          }
          return true;
      });
  };

  function exmBindMarkNavKeys(input) {
      if (!input || input._exmNavBound) return;
      input._exmNavBound = true;
      input.addEventListener('keydown', function (e) {
          var key = e.key;
          var dir = null;
          if (key === 'ArrowUp') dir = 'up';
          else if (key === 'ArrowDown') dir = 'down';
          else if (key === 'ArrowLeft') dir = 'left';
          else if (key === 'ArrowRight') dir = 'right';
          else if (key === 'Enter' && !e.shiftKey) dir = 'enter';
          if (!dir) return;
          e.preventDefault();
          e.stopPropagation();
          window.exmMoveMarkFocus(dir);
      });
      input.addEventListener('focus', function () {
          document.querySelectorAll('.mark-val-input.is-mrk-focus').forEach(function (n) {
              n.classList.remove('is-mrk-focus');
          });
          input.classList.add('is-mrk-focus');
      });
  }

  document.getElementById('mrk-nav-pad')?.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-mrk-nav]') : null;
      if (!btn) return;
      e.preventDefault();
      window.exmMoveMarkFocus(btn.getAttribute('data-mrk-nav'));
  });

  document.getElementById('btn-find-replace')?.addEventListener('click', () => {

      const stdId = document.getElementById('fr-student').value;

      const bookName = document.getElementById('fr-book').value;

      const newMarks = document.getElementById('fr-marks').value;



      if(!stdId || !bookName || newMarks === '') return showToast("تمام خانے پُر کریں!", "error");

      if (exmIsMarksContextLocked()) return showToast("یہ نتیجہ لاک ہو چکا ہے — ترمیم ممنوع", "error");

      var bookTpl = currentClassTemplateBooks.find(function (b) { return b.name === bookName; });
      if (!window.exmCanEditBookColumn(bookTpl)) return showToast("آپ اس مضمون کے نمبرات تبدیل نہیں کر سکتے", "error");



      let studentIndex = currentGridData.findIndex(r => r.student.id === stdId);

      if(studentIndex !== -1) {

          var bookMax = exmGetBookMax(bookName);
          currentGridData[studentIndex].marks[bookName] = exmNormalizeMarkRaw(newMarks, bookMax);
          currentGridData[studentIndex].totalObtained = exmSumMarks(currentGridData[studentIndex].marks);

          renderMarksGrid(); document.getElementById('fr-marks').value = ''; showToast("نمبر کامیابی سے تبدیل کر دیے گئے!", "success");

      }

  });



  document.getElementById('mrk-search-input')?.addEventListener('input', function() {

      const term = this.value.toLowerCase();

      document.querySelectorAll('#mrk-entry-tbody tr').forEach(row => { row.style.display = row.cells[0].innerText.toLowerCase().includes(term) ? '' : 'none'; });

  });



  document.getElementById('mrk-sort-select')?.addEventListener('change', function() {

      const sortType = this.value;

      if(sortType === 'name_asc') currentGridData.sort((a, b) => a.student.name.localeCompare(b.student.name, 'ur'));

      else if(sortType === 'id_asc') currentGridData.sort((a, b) => a.student.id.localeCompare(b.student.id));

      else if(sortType === 'total_desc') currentGridData.sort((a, b) => b.totalObtained - a.totalObtained);

      renderMarksGrid(); 

  });



  document.getElementById('mrk-sort-book')?.addEventListener('change', function() {

      const bookName = this.value;

      if(bookName) {

          currentGridData.sort((a, b) => exmMarkSortValue(b.marks[bookName]) - exmMarkSortValue(a.marks[bookName]));

          renderMarksGrid(); showToast(`${bookName} کے ٹاپرز اوپر آ گئے ہیں!`, "success");

      }

  });



  function exmFlushVisibleMarkInputsToGrid() {
      var tbody = document.getElementById('mrk-entry-tbody');
      if (!tbody || !currentGridData.length) return;
      tbody.querySelectorAll('tr.mark-entry-row').forEach(function (tr) {
          var sid = tr.getAttribute('data-std-id');
          var rowIndex = -1;
          if (sid) {
              rowIndex = currentGridData.findIndex(function (r) {
                  return r.student && r.student.id === sid;
              });
          }
          if (rowIndex < 0) {
              rowIndex = parseInt(tr.getAttribute('data-index'), 10);
          }
          if (!isFinite(rowIndex) || rowIndex < 0 || !currentGridData[rowIndex]) return;
          tr.querySelectorAll('.mark-val-input').forEach(function (inp) {
              if (inp.disabled) return;
              var subject = inp.getAttribute('data-subject');
              var max = exmGetBookMax(subject);
              currentGridData[rowIndex].marks[subject] = exmNormalizeMarkRaw(inp.value, max);
          });
          currentGridData[rowIndex].totalObtained = exmSumMarks(currentGridData[rowIndex].marks);
      });
  }

  document.getElementById('btn-save-all-marks')?.addEventListener('click', () => {

      if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('exams', 'edit')) return;
      if (_exmMarksSaveBusy) return showToast('محفوظ جاری ہے — تھوڑی دیر انتظار کریں', 'warning');

      const examName = document.getElementById('mrk-exam-name').value;

      const cls = document.getElementById('mrk-class').value;
      const resultDate = exmEnsureResultDateFilled('mrk');

      if (!examName) return showToast("امتحان منتخب کرنا لازمی ہے!", "error");
      if (!cls) return showToast("درجہ منتخب کرنا لازمی ہے!", "error");
      if (window.exmIsExamLocked(examName, cls, resultDate)) {
          return showToast("یہ نتیجہ لاک ہو چکا ہے — محفوظ نہیں ہو سکتا", "error");
      }
      if (!resultDate) return showToast("نتیجے کی تاریخ منتخب کریں!", "error");

      exmFlushVisibleMarkInputsToGrid();

      var saveBtn = document.getElementById('btn-save-all-marks');
      _exmMarksSaveBusy = true;
      if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> محفوظ ہو رہا ہے…';
      }

      var finishSave = function () {
      return window.exmRunExamsPersist(function () {
      let dbMarks = exmReadJson(DB.exams, []);

      currentGridData.forEach(row => {

          var existingRecord = exmFindStudentResult(dbMarks, examName, cls, row.student.id, resultDate);
          var existingMarks = existingRecord ? (existingRecord.marks || {}) : {};
          var normalizedMarks = exmMergeMarksForSave(row.marks, existingMarks);

          var totalObtained = exmSumMarks(normalizedMarks);
          var percentage = exmCalcPercentage(totalObtained, currentTotalPossibleMarks);
          var grade = exmGradeFromPercentage(percentage);

          let recordObj = {

              id: window.exmCanonicalResultId(examName, cls, row.student.id, resultDate), examName: examName, class: cls, studentId: row.student.id,

              studentName: row.student.name, studentPhoto: (typeof window.emsGetUserPhotoSrc === 'function' ? window.emsGetUserPhotoSrc(row.student) : (row.student.photoBase64 || row.student.photoUrl || '')),

              marks: normalizedMarks, totalObtained: totalObtained, grandTotal: currentTotalPossibleMarks,

              percentage: percentage.toFixed(1), grade: grade,
              resultDate: resultDate,
              timestamp: new Date().getTime()

          };

          if (typeof window.emsStampDepartment === 'function') {
              window.emsStampDepartment(recordObj, row.student.departmentId);
          }

          row.marks = normalizedMarks;
          row.totalObtained = totalObtained;

          window.exmUpsertResultByIdentity(dbMarks, recordObj);

      });

      return Promise.resolve(emsSaveKey(DB.exams, JSON.stringify(dbMarks))).then(function (res) {
          var status = res && res.status;
          if (typeof window.exmRefreshResultDateOptions === 'function') window.exmRefreshResultDateOptions('mrk');
          if (status === 'synced') {
              showToast("نمبرات محفوظ (" + exmFormatResultDateLabel(resultDate) + ") — مقامی + کلاؤڈ", "success");
          } else if (status === 'offline_queued') {
              showToast("نمبرات مقامی محفوظ (" + exmFormatResultDateLabel(resultDate) + ") — کلاؤڈ بعد میں", "success");
          } else {
              showToast("نمبرات محفوظ ہو گئے! تاریخ: " + exmFormatResultDateLabel(resultDate), "success");
          }
      }).catch(function (err) {
          console.error('Exam marks save failed', err);
          showToast("نمبرات محفوظ نہیں ہو سکے — دوبارہ کوشش کریں", "error");
      }).finally(function () {
          _exmMarksSaveBusy = false;
          if (saveBtn) {
              saveBtn.disabled = exmIsMarksContextLocked();
              saveBtn.innerHTML = '<i class="fas fa-save"></i> تمام نمبرات ڈیٹا بیس میں محفوظ کریں';
          }
      });
      });
      };

      var ensureMarks = typeof window.emsDurableEnsureKey === 'function'
        ? window.emsDurableEnsureKey(DB.exams)
        : Promise.resolve();
      Promise.resolve(ensureMarks).then(finishSave).catch(finishSave);

  });



  document.getElementById('res-type')?.addEventListener('change', function() {

      document.getElementById('res-student-container').style.display = (this.value === 'student_card') ? 'flex' : 'none';

  });



  document.getElementById('btn-fetch-result')?.addEventListener('click', () => {

      const examName = document.getElementById('res-exam-name').value;

      const resType = document.getElementById('res-type').value;

      const cls = document.getElementById('res-class').value;

      const stdId = document.getElementById('res-student').value;
      const resultDate = exmReadResultDateInput('res');

      const printArea = document.getElementById('result-printable-area');



      if(!examName) return showToast("پہلے امتحان منتخب کریں!", "error");

      if(!cls) return showToast("پہلے درجہ منتخب کریں!", "error");

      if(resType === 'student_card' && !stdId) return showToast("طالب علم کا انتخاب لازمی ہے!", "error");



      const dbMarks = exmReadJson(DB.exams, []);

      let classResults = dbMarks.filter(function (m) {
          return m.examName === examName && m.class === cls && exmResultDateOf(m) === resultDate;
      });
      // لیگیسی: اگر اس تاریخ پر کچھ نہ ملے اور صرف بلا تاریخ/ایک ہی سیشن ہو
      if (!classResults.length) {
          var allForClass = dbMarks.filter(function (m) { return m.examName === examName && m.class === cls; });
          var dates = exmListResultDates(examName, cls);
          if (dates.length <= 1 && allForClass.length) {
              classResults = allForClass.filter(function (m) {
                  var d = exmResultDateOf(m);
                  return !d || d === resultDate || dates[0] === resultDate;
              });
              if (!classResults.length) classResults = allForClass;
          }
      }



      if(classResults.length === 0) { printArea.innerHTML = '<h3 style="text-align:center; color:red;">اس تاریخ (' + exmFormatResultDateLabel(resultDate) + ') کا کوئی رزلٹ موجود نہیں!</h3>'; printArea.style.display = 'block'; return; }

      exmAssignPositions(classResults);

      classResults.sort((a, b) => b.totalObtained - a.totalObtained);



      let html = '';

      let templates = exmReadJson('ems_exam_templates', []);

      let tplBooks = templates.find(t => t.class === cls)?.books || [];



      var brandHeader = (typeof window.attBrandHeaderHTML === 'function') ? window.attBrandHeaderHTML() : '';
      var brandFooter = (typeof window.attSignFooterHTML === 'function') ? window.attSignFooterHTML() : '';

      if(resType === 'class_summary') {

          html += brandHeader;

          html += `<h3 style="text-align:center; margin-top: 0; color:#7f8c8d;">کشف النتیجہ (درجہ وار)</h3>`;

          html += `<p style="text-align:center; font-weight:bold;">امتحان: ${examName} | درجہ: ${cls} | تاریخ: ${exmFormatResultDateLabel(resultDate)}</p>`;

          

          html += `<table style="width:100%; border-collapse: collapse; margin-top:20px; text-align:right;" border="1">

                      <thead style="background:#eef2f6;"><tr><th>پوزیشن</th><th>نام / ID</th>`;

          tplBooks.forEach(b => { html += `<th>${b.name}</th>`; });

          html += `<th>کل نمبر</th><th>حاصل کردہ</th><th>فیصد</th><th>درجہ (Grade)</th></tr></thead><tbody>`;

          

          classResults.forEach(res => {

              let gradeColor = String(res.grade || '').includes('راسب') ? 'red' : 'green';

              html += `<tr>

                          <td style="font-weight:bold; text-align:center; color:var(--warning); font-size:16px;">${res.positionStr}</td>

                          <td><strong>${res.studentName}</strong> <br><small>${res.studentId}</small></td>`;

              tplBooks.forEach(b => { html += `<td>${exmDisplayMark((res.marks || {})[b.name])}</td>`; });

              html += `<td>${res.grandTotal}</td><td style="font-weight:bold;">${res.totalObtained}</td><td>${res.percentage}%</td><td style="color:${gradeColor}; font-weight:bold;">${res.grade}</td></tr>`;

          });

          html += `</tbody></table>`;

          html += brandFooter;

      } 

      else if (resType === 'student_card') {

          let res = classResults.find(r => String(r.studentId) === String(stdId));

          if(!res) { printArea.innerHTML = '<p>اس طالب علم کا اس تاریخ کا رزلٹ موجود نہیں!</p>'; printArea.style.display='block'; return; }

          html += window.exmBuildStudentCardHtml(res, examName);

      }

      printArea.innerHTML = html; printArea.style.display = 'block';
      if (typeof window.exmRefreshResultDateOptions === 'function') window.exmRefreshResultDateOptions('res');
      if (typeof window.exmUpdateLockUi === 'function') window.exmUpdateLockUi();
      var rsw = document.getElementById('res-search-wrap');
      if (rsw) { rsw.style.display = (resType === 'class_summary') ? 'flex' : 'none'; var ri = document.getElementById('res-search'); if (ri) ri.value = ''; }
      showToast("رزلٹ اور پری ویو تیار ہو گیا!", "success");

  });

  // =========================================================
  // مرحلہ 3: نمبرات گرڈ برآمد + ذہین درآمد + نتائج برآمد
  // =========================================================
  window.examExportMarksGrid = function () {
      if (!exmStaffHasExamsView()) {
          if (typeof window.emsRequireStaffAction === 'function') window.emsRequireStaffAction('exams', 'view');
          return;
      }
      if (!currentGridData || !currentGridData.length) return showToast("پہلے گرڈ تیار کریں!", "error");
      var bookNames = currentClassTemplateBooks.map(function (b) { return b.name; });
      var header = ['ID', 'نام'].concat(bookNames).concat(['کل ممکن', 'حاصل کردہ']);
      var data = currentGridData.map(function (row) {
          var line = [row.student.id, row.student.name];
          bookNames.forEach(function (bn) {
              var v = row.marks[bn];
              line.push(v != null ? (exmIsAbsentMark(v) ? 'AB' : v) : '');
          });
          line.push(currentTotalPossibleMarks, row.totalObtained);
          return line;
      });
      var cls = document.getElementById('mrk-class').value || 'درجہ';
      window.examDownloadCSV([header].concat(data), 'نمبرات_' + cls + '.csv');
  };

  // ذہین CSV درآمد — کالم خودکار شناخت (ID/نام + کتاب کے نام)
  window.examImportMarksCSV = function (input) {
      if (!exmStaffHasExamsEdit()) {
          if (typeof window.emsRequireStaffAction === 'function') window.emsRequireStaffAction('exams', 'edit');
          input.value = '';
          return;
      }
      var file = input.files && input.files[0];
      if (!file) return;
      if (exmIsMarksContextLocked()) {
          showToast("یہ نتیجہ لاک ہو چکا ہے — درآمد ممنوع", "error");
          input.value = '';
          return;
      }
      var reader = new FileReader();
      reader.onload = function (e) {
          try {
              var text = String(e.target.result).replace(/^\uFEFF/, '');
              var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
              if (lines.length < 2) { showToast("فائل خالی یا ناقص ہے!", "error"); return; }
              var parse = function (line) {
                  var out = [], cur = '', q = false;
                  for (var i = 0; i < line.length; i++) {
                      var c = line[i];
                      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
                      else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
                  }
                  out.push(cur); return out;
              };
              var headers = parse(lines[0]).map(function (h) { return h.trim(); });
              // کالم شناخت
              var idCol = headers.findIndex(function (h) { return /^id$|آئی|شناخت|roll|رول/i.test(h); });
              var nameCol = headers.findIndex(function (h) { return /name|نام/i.test(h); });
              if (idCol < 0 && nameCol < 0) { showToast("ID یا نام کا کالم نہیں ملا!", "error"); return; }
              var bookNames = currentClassTemplateBooks.map(function (b) { return b.name; });
              // ہر کتاب کے لیے متعلقہ کالم
              var bookColMap = {};
              bookNames.forEach(function (bn) {
                  var ci = headers.findIndex(function (h) { return h === bn; });
                  if (ci >= 0) bookColMap[bn] = ci;
              });
              var matched = 0, missing = 0, unknownBooks = bookNames.filter(function (bn) { return bookColMap[bn] == null; });
              for (var r = 1; r < lines.length; r++) {
                  var cells = parse(lines[r]);
                  var sid = idCol >= 0 ? (cells[idCol] || '').trim() : '';
                  var sname = nameCol >= 0 ? (cells[nameCol] || '').trim() : '';
                  var gi = currentGridData.findIndex(function (g) {
                      return (sid && g.student.id === sid) || (!sid && sname && g.student.name === sname);
                  });
                  if (gi < 0) { missing++; continue; }
                  bookNames.forEach(function (bn) {
                      if (bookColMap[bn] != null) {
                          var bookTpl = currentClassTemplateBooks.find(function (b) { return b.name === bn; });
                          if (!window.exmCanEditBookColumn(bookTpl)) return;
                          var rawCell = (cells[bookColMap[bn]] || '').trim();
                          var bookMax = bookTpl ? bookTpl.marks : 100;
                          currentGridData[gi].marks[bn] = exmNormalizeMarkRaw(rawCell, bookMax);
                      }
                  });
                  currentGridData[gi].totalObtained = exmSumMarks(currentGridData[gi].marks);
                  matched++;
              }
              renderMarksGrid();
              var msg = matched + " طلبہ کے نمبرات درآمد ہوئے۔";
              if (missing) msg += " " + missing + " قطاریں میل نہیں کھائیں۔";
              if (unknownBooks.length) msg += " غیر شناخت شدہ کتب: " + unknownBooks.join('، ');
              showToast(msg, missing || unknownBooks.length ? "warning" : "success");
          } catch (err) {
              console.error(err); showToast("درآمد میں خرابی: " + err.message, "error");
          }
          input.value = '';
      };
      reader.readAsText(file, 'UTF-8');
  };

  // محفوظ شدہ نتائج برآمد (منتخب امتحان/درجہ)
  window.examExportResults = function () {
      if (!exmStaffHasExamsView()) {
          if (typeof window.emsRequireStaffAction === 'function') window.emsRequireStaffAction('exams', 'view');
          return;
      }
      var examName = document.getElementById('res-exam-name').value;
      var cls = document.getElementById('res-class').value;
      var resultDate = exmResolveResultDateForContext('res');
      var dbMarks = exmReadJson(DB.exams, []);
      var list = dbMarks.filter(function (m) {
          return m.examName === examName && (!cls || m.class === cls) && exmResultDateOf(m) === resultDate;
      });
      if (!list.length) return showToast("اس تاریخ کا کوئی نتیجہ موجود نہیں!", "error");
      var allBooks = [];
      list.forEach(function (r) { Object.keys(r.marks || {}).forEach(function (b) { if (allBooks.indexOf(b) < 0) allBooks.push(b); }); });
      var header = ['تاریخ', 'درجہ', 'ID', 'نام'].concat(allBooks).concat(['کل ممکن', 'حاصل کردہ', 'فیصد', 'درجہ بندی']);
      var data = list.sort(function (a, b) { return b.totalObtained - a.totalObtained; }).map(function (r) {
          var line = [exmResultDateOf(r) || resultDate, r.class, r.studentId, r.studentName];
          allBooks.forEach(function (b) {
              var v = r.marks[b];
              line.push(v != null ? (exmIsAbsentMark(v) ? 'AB' : v) : '');
          });
          line.push(r.grandTotal, r.totalObtained, r.percentage + '%', r.grade);
          return line;
      });
      window.examDownloadCSV([header].concat(data), 'نتائج_' + (examName || 'امتحان') + '_' + resultDate + '.csv');
  };

  // =========================================================
  // مرحلہ 4: کارکردگی کا تجزیہ و شماریات
  // =========================================================
  window.exmPopulateAnaMultiClasses = function () {
      var box = document.getElementById('ana-class-multi-list');
      if (!box) return;
      var classes = [];
      if (typeof window.exmCollectAllClasses === 'function') {
          classes = window.exmCollectAllClasses() || [];
      } else if (typeof window.emsCollectClasses === 'function') {
          classes = window.emsCollectClasses() || [];
      }
      if (!classes.length) {
          var sel = document.getElementById('ana-class');
          if (sel) {
              Array.from(sel.options).forEach(function (o) {
                  var v = String(o.value || '').trim();
                  if (v) classes.push(v);
              });
          }
      }
      var prev = Object.create(null);
      box.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
          if (cb.checked) prev[cb.value] = true;
      });
      if (!classes.length) {
          box.innerHTML = '<span style="color:#94a3b8;">کوئی درجہ دستیاب نہیں</span>';
          return;
      }
      box.innerHTML = classes.map(function (c) {
          var safe = String(c).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
          var checked = prev[c] ? ' checked' : '';
          return '<label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">' +
              '<input type="checkbox" value="' + safe + '"' + checked + '> ' + safe + '</label>';
      }).join('');
  };

  window.exmUpdateAnaScopeUi = function () {
      var modeEl = document.getElementById('ana-scope-mode');
      var mode = modeEl ? modeEl.value : 'one';
      var oneWrap = document.getElementById('ana-class-one-wrap');
      var multiWrap = document.getElementById('ana-class-multi-wrap');
      if (oneWrap) oneWrap.style.display = mode === 'one' ? '' : 'none';
      if (multiWrap) multiWrap.style.display = mode === 'multi' ? '' : 'none';
      if (mode === 'multi') window.exmPopulateAnaMultiClasses();
  };

  window.exmAnaMultiSelectAll = function (on) {
      document.querySelectorAll('#ana-class-multi-list input[type="checkbox"]').forEach(function (cb) {
          cb.checked = !!on;
      });
  };

  /** @returns {{ mode: string, classes: string[]|null, label: string }} classes=null → تمام */
  function exmResolveAnaScope() {
      var modeEl = document.getElementById('ana-scope-mode');
      var mode = modeEl ? modeEl.value : 'one';
      if (mode === 'all') {
          return { mode: 'all', classes: null, label: 'تمام درجات (ایک ساتھ)' };
      }
      if (mode === 'multi') {
          var picked = [];
          document.querySelectorAll('#ana-class-multi-list input[type="checkbox"]:checked').forEach(function (cb) {
              var v = String(cb.value || '').trim();
              if (v) picked.push(v);
          });
          return {
              mode: 'multi',
              classes: picked,
              label: picked.length ? ('منتخب درجات: ' + picked.join('، ')) : 'منتخب درجات'
          };
      }
      var one = ((document.getElementById('ana-class') || {}).value || '').trim();
      return {
          mode: 'one',
          classes: one ? [one] : [],
          label: one ? ('درجہ: ' + one) : 'ایک درجہ'
      };
  }

  window.renderExamAnalysis = function () {
      var box = document.getElementById('exam-analysis-content');
      if (!box) return;
      var examName = document.getElementById('ana-exam-name').value;
      var scope = exmResolveAnaScope();
      if (scope.mode === 'one' && (!scope.classes || !scope.classes.length)) {
          return showToast('ایک درجہ منتخب کریں، یا تجزیہ کی قسم بدلیں', 'error');
      }
      if (scope.mode === 'multi' && (!scope.classes || !scope.classes.length)) {
          return showToast('کم از کم ایک درجہ منتخب کریں', 'error');
      }

      var classSet = null;
      if (scope.classes) {
          classSet = Object.create(null);
          scope.classes.forEach(function (c) { classSet[c] = true; });
      }

      var dbMarks = exmReadJson(DB.exams, []);
      var anaDateEl = document.getElementById('ana-result-date');
      var anaAllDates = document.getElementById('ana-all-dates');
      var useAllDates = !!(anaAllDates && anaAllDates.checked);
      var resultDate = useAllDates ? '' : (exmReadResultDateInput('ana') || exmEnsureResultDateFilled('ana'));
      var rawList = dbMarks.filter(function (m) {
          if (!m) return false;
          if (examName && m.examName !== examName) return false;
          if (classSet) {
              var mc = exmNormClass(m.class);
              var hit = false;
              Object.keys(classSet).forEach(function (c) {
                  if (exmClassEquals(c, mc)) hit = true;
              });
              if (!hit) return false;
          }
          if (!useAllDates && resultDate && exmResultDateOf(m) !== resultDate) return false;
          return true;
      });

      var activeStudents = [];
      if (scope.mode === 'one' && scope.classes && scope.classes[0]) {
          activeStudents = exmStudentsInClass(scope.classes[0]);
      } else if (scope.classes && scope.classes.length) {
          scope.classes.forEach(function (c) {
              activeStudents = activeStudents.concat(exmStudentsInClass(c));
          });
      } else {
          activeStudents = exmGetUsers().filter(function (u) { return u && u.type === 'student'; });
      }

      var deduped = exmDedupeAnalysisRows(rawList, {
          activeOnly: true,
          activeStudents: activeStudents,
          uniqueStudent: !!useAllDates
      });
      var list = deduped.rows;
      if (!list.length) {
          box.innerHTML = '<p style="color:#dc2626;">منتخب کسوٹی پر کوئی نتیجہ موجود نہیں۔'
              + (deduped.orphaned ? ' (' + deduped.orphaned + ' پرانے نتائج رجسٹرڈ طلبہ سے میل نہیں کھاتے)' : '')
              + '</p>';
          return;
      }

      var pass = list.filter(exmIsPassingResult).length;
      var fail = list.length - pass;
      var avg = (list.reduce(function (s, r) { return s + parseFloat(r.percentage || 0); }, 0) / list.length).toFixed(1);
      var registeredCount = activeStudents.length;
      var orphanNote = deduped.orphaned
          ? ('<div style="margin-bottom:10px;padding:8px 10px;background:#fff7ed;border:1px solid #fdba74;border-radius:6px;color:#9a3412;font-size:12px;">'
              + '<i class="fas fa-info-circle"></i> ' + deduped.orphaned
              + ' پرانا نتیجہ رجسٹرڈ فہرست سے باہر ہے (منتقل/حذف شدہ) — گنتی میں شامل نہیں۔'
              + (registeredCount ? (' رجسٹرڈ طلبہ: ' + registeredCount) : '')
              + '</div>')
          : (registeredCount && list.length !== registeredCount
              ? ('<div style="margin-bottom:10px;padding:8px 10px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;color:#075985;font-size:12px;">'
                  + 'نتائج والے طلبہ: ' + list.length + ' / رجسٹرڈ: ' + registeredCount
                  + '</div>')
              : '');

      // درجہ بندی تقسیم
      var gradeColors = { 'ممتاز مرتفع': '#16a34a', 'ممتاز': '#22c55e', 'جید جدا': '#0891b2', 'جید': '#3b82f6', 'مقبول': '#d97706', 'راسب': '#dc2626' };
      var gradeSegs = Object.keys(gradeColors).map(function (g) {
          return { label: g, value: list.filter(function (r) { return r.grade === g; }).length, color: gradeColors[g] };
      }).filter(function (s) { return s.value > 0; });

      // درجہ وار اوسط + جدول
      var byClass = {};
      list.forEach(function (r) { (byClass[r.class] = byClass[r.class] || []).push(r); });
      var classKeys = Object.keys(byClass).sort(function (a, b) {
          return String(a).localeCompare(String(b), 'ur');
      });
      var classItems = classKeys.map(function (c) {
          var rows = byClass[c];
          var a = rows.reduce(function (s, r) { return s + parseFloat(r.percentage || 0); }, 0) / rows.length;
          return { label: c, value: Math.round(a), display: Math.round(a) + '%' };
      });
      var classTableHtml = '';
      if (scope.mode !== 'one' && classKeys.length) {
          classTableHtml =
              '<div class="table-responsive" style="margin-top:10px;"><table class="data-table" style="width:100%;font-size:13px;">' +
              '<thead><tr><th>درجہ</th><th>طلبہ</th><th>اوسط %</th><th>کامیاب</th><th>ناکام</th><th>کامیابی %</th></tr></thead><tbody>' +
              classKeys.map(function (c) {
                  var rows = byClass[c];
                  var p = rows.filter(exmIsPassingResult).length;
                  var f = rows.length - p;
                  var a = rows.reduce(function (s, r) { return s + parseFloat(r.percentage || 0); }, 0) / rows.length;
                  var passPct = rows.length ? Math.round((p / rows.length) * 100) : 0;
                  return '<tr><td><strong>' + String(c).replace(/</g, '&lt;') + '</strong></td><td>' + rows.length +
                      '</td><td>' + a.toFixed(1) + '%</td><td style="color:#16a34a;">' + p +
                      '</td><td style="color:#dc2626;">' + f + '</td><td>' + passPct + '%</td></tr>';
              }).join('') +
              '</tbody></table></div>';
      }

      // مضمون وار اوسط
      var bookSum = {}, bookCnt = {}, bookMax = {};
      list.forEach(function (r) {
          Object.keys(r.marks || {}).forEach(function (b) {
              if (exmIsAbsentMark(r.marks[b])) return;
              bookSum[b] = (bookSum[b] || 0) + Number(r.marks[b] || 0); bookCnt[b] = (bookCnt[b] || 0) + 1;
          });
      });
      var tpls = exmReadJson('ems_exam_templates', []);
      tpls.forEach(function (t) {
          if (classSet && !classSet[t.class] && !Object.keys(classSet).some(function (c) { return exmClassEquals(c, t.class); })) return;
          (t.books || []).forEach(function (b) { bookMax[b.name] = b.marks; });
      });
      var bookItems = Object.keys(bookSum).map(function (b) {
          var avgB = bookSum[b] / bookCnt[b]; var mx = bookMax[b] || 100;
          var pct = Math.round((avgB / mx) * 100);
          return { label: b, value: pct, display: pct + '%' };
      }).sort(function (a, b) { return b.value - a.value; });

      // استاد وار کارکردگی (ماسٹر شیٹ میں مضمون → استاد منسلک)
      var bookTeacher = {};
      tpls.forEach(function (t) {
          if (classSet && !classSet[t.class] && !Object.keys(classSet).some(function (c) { return exmClassEquals(c, t.class); })) return;
          (t.books || []).forEach(function (b) {
              if (b.teacher) bookTeacher[b.name] = b.teacher;
          });
      });
      var tObt = {}, tMax = {};
      list.forEach(function (r) {
          Object.keys(r.marks || {}).forEach(function (bn) {
              if (exmIsAbsentMark(r.marks[bn])) return;
              var teacher = bookTeacher[bn];
              if (!teacher) return;
              tObt[teacher] = (tObt[teacher] || 0) + Number(r.marks[bn] || 0);
              tMax[teacher] = (tMax[teacher] || 0) + (bookMax[bn] || 100);
          });
      });
      var teacherItems = Object.keys(tObt).map(function (t) {
          var pct = tMax[t] ? Math.round((tObt[t] / tMax[t]) * 100) : 0;
          return { label: t, value: pct, display: pct + '%' };
      }).sort(function (a, b) { return b.value - a.value; });

      var passSegs = [{ label: 'کامیاب', value: pass, color: '#16a34a' }, { label: 'ناکام', value: fail, color: '#dc2626' }];

      // سال بہ سال موازنہ — اصل resultDate کو ترجیح، timestamp صرف legacy fallback۔
      var byYear = {};
      list.forEach(function (r) {
          var resultYmd = exmResultDateOf(r);
          var y = resultYmd ? Number(resultYmd.slice(0, 4))
              : (r.timestamp ? new Date(r.timestamp).getFullYear() : (new Date().getFullYear()));
          (byYear[y] = byYear[y] || []).push(parseFloat(r.percentage || 0));
      });
      var yearKeys = Object.keys(byYear).sort();
      var yearItems = yearKeys.map(function (y) {
          var arr = byYear[y]; var a = arr.reduce(function (s, x) { return s + x; }, 0) / arr.length;
          return { label: String(y), value: Math.round(a) };
      });

      var donutGrade = (typeof window.emsDonutSVG === 'function') ? window.emsDonutSVG(gradeSegs, list.length, 'کل طلبہ') : '';
      var donutPass = (typeof window.emsDonutSVG === 'function') ? window.emsDonutSVG(passSegs, Math.round((pass / list.length) * 100) + '%', 'کامیابی') : '';
      var barClass = (typeof window.emsBarChartSVG === 'function') ? window.emsBarChartSVG(classItems) : '';
      var barBook = (typeof window.emsBarChartSVG === 'function') ? window.emsBarChartSVG(bookItems) : '';
      var barTeacher = (teacherItems.length && typeof window.emsBarChartSVG === 'function') ? window.emsBarChartSVG(teacherItems)
          : '<p style="color:#94a3b8;">استاد وار تجزیے کے لیے ماسٹر شیٹ میں ہر کتاب کے ساتھ "مضمون کا استاد" منتخب کریں۔</p>';
      var lineYear = (yearItems.length > 1 && typeof window.emsLineChartSVG === 'function') ? window.emsLineChartSVG(yearItems, '#7c3aed')
          : '<p style="color:#94a3b8;">سال بہ سال موازنے کے لیے کم از کم دو مختلف سالوں کا ریکارڈ درکار ہے۔</p>';

      var scopeBanner =
          '<div style="margin-bottom:12px;padding:10px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;color:#1e40af;font-size:13px;">' +
          '<i class="fas fa-filter"></i> <strong>' + String(scope.label).replace(/</g, '&lt;') + '</strong>' +
          (examName ? ' — امتحان: ' + String(examName).replace(/</g, '&lt;') : '') +
          (useAllDates
              ? ' — تمام محفوظ شدہ تواریخ'
              : (' — تاریخ: ' + exmFormatResultDateLabel(resultDate))) +
          (scope.mode !== 'one' ? ' — شامل درجات: ' + classKeys.length : '') +
          '</div>';

      box.innerHTML =
          scopeBanner + orphanNote +
          '<div class="cmp-stat-strip" style="margin-bottom:16px;">' +
            statCard('کل طلبہ', list.length, '#2563eb', 'fa-users') +
            statCard('اوسط فیصد', avg + '%', '#7c3aed', 'fa-percent') +
            statCard('کامیاب', pass, '#16a34a', 'fa-check') +
            statCard('ناکام', fail, '#dc2626', 'fa-times') +
          '</div>' +
          '<div class="cmp-dash-grid">' +
            '<div class="cmp-dash-card"><h4>درجہ بندی کی تقسیم</h4>' + donutGrade + '</div>' +
            '<div class="cmp-dash-card"><h4>کامیابی / ناکامی</h4>' + donutPass + '</div>' +
            '<div class="cmp-dash-card cmp-dash-wide"><h4>درجہ وار اوسط کارکردگی</h4>' + barClass + classTableHtml + '</div>' +
            '<div class="cmp-dash-card cmp-dash-wide"><h4>مضمون وار اوسط (کمزور مضامین کی نشاندہی)</h4>' + barBook + '</div>' +
            '<div class="cmp-dash-card cmp-dash-wide"><h4>استاد وار اوسط کارکردگی</h4>' + barTeacher + '</div>' +
            '<div class="cmp-dash-card cmp-dash-wide"><h4>سال بہ سال موازنہ (اوسط فیصد)</h4>' + lineYear + '</div>' +
          '</div>';

      function statCard(l, v, c, i) {
          return '<div class="cmp-stat" style="border-top:3px solid ' + c + ';"><div class="cmp-stat-ico" style="color:' + c + ';"><i class="fas ' + i + '"></i></div><div class="cmp-stat-v">' + v + '</div><div class="cmp-stat-l">' + l + '</div></div>';
      }
  };

  document.getElementById('btn-run-analysis')?.addEventListener('click', window.renderExamAnalysis);
  if (typeof window.exmUpdateAnaScopeUi === 'function') {
      try { window.exmUpdateAnaScopeUi(); } catch (eAnaUi) { /* ignore */ }
  }

  // مرحلہ 6: نتائج کی فوری تلاش (درجہ وار چارٹ کی قطاروں پر)
  window.examResultSearch = function (val) {
      var term = (val || '').toLowerCase().trim();
      var rows = document.querySelectorAll('#result-printable-area table tbody tr');
      rows.forEach(function (tr) {
          tr.style.display = (!term || tr.innerText.toLowerCase().indexOf(term) >= 0) ? '' : 'none';
      });
  };

  // =========================================================
  // ترقی و تنزلی کا نظام (Promotion) — نکتہ 2
  // =========================================================
  window._promoRows = [];

  document.getElementById('btn-load-promote')?.addEventListener('click', function () {
      var examName = document.getElementById('promo-exam-name').value;
      var fromClass = document.getElementById('promo-from-class').value;
      var promoDateEl = document.getElementById('promo-result-date');
      var promoDate = promoDateEl && promoDateEl.value ? String(promoDateEl.value).trim().slice(0, 10) : '';
      if (!fromClass) return showToast("موجودہ درجہ منتخب کریں!", "error");
      var dbMarks = exmReadJson(DB.exams, []);
      var users = exmGetUsers();
      var students = users.filter(function (u) { return u.type === 'student' && u.class === fromClass; });
      if (!students.length) return showToast("اس درجے میں کوئی طالب علم نہیں!", "error");

      window._promoRows = students.map(function (std) {
          var candidates = dbMarks.filter(function (m) {
              if (m.examName !== examName || m.class !== fromClass || String(m.studentId) !== String(std.id)) return false;
              if (promoDate && exmResultDateOf(m) !== promoDate) return false;
              return true;
          });
          candidates.sort(function (a, b) {
              var dateCmp = exmResultDateOf(b).localeCompare(exmResultDateOf(a));
              return dateCmp || ((b.timestamp || 0) - (a.timestamp || 0));
          });
          var res = candidates[0] || null;
          var passing = res ? exmIsPassingResult(res) : false;
          return {
              id: std.id, name: std.name,
              student: std,
              totalObtained: res ? res.totalObtained : '-',
              percentage: res ? res.percentage : '-',
              grade: res ? res.grade : 'نتیجہ نہیں',
              resultDate: res ? exmResultDateOf(res) : '',
              passing: passing,
              selected: passing
          };
      });
      window.promoRenderTable();
      document.getElementById('promo-toolbar').style.display = 'flex';
      showToast(students.length + " طلبہ کی فہرست تیار — کامیاب طلبہ خودکار منتخب ہیں۔", "success");
  });

  window.promoRenderTable = function () {
      var tbody = document.querySelector('#promo-table tbody');
      if (!tbody) return;
      var scrollEl = tbody.closest('.table-responsive');
      var rows = window._promoRows || [];

      if (!rows.length) {
          if (typeof window.emsVirtualTableDestroy === 'function') window.emsVirtualTableDestroy('promo-table');
          tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8;">کوئی ریکارڈ نہیں</td></tr>';
          window.promoUpdateCount();
          return;
      }

      function renderPromoRow(i, r) {
          var gradeColor = String(r.grade).includes('راسب') ? '#dc2626' : (r.grade === 'نتیجہ نہیں' ? '#94a3b8' : '#16a34a');
          var resultTag = r.passing ? '<span style="color:#16a34a; font-weight:bold;">کامیاب</span>' : (r.grade === 'نتیجہ نہیں' ? '<span style="color:#94a3b8;">—</span>' : '<span style="color:#dc2626; font-weight:bold;">ناکام</span>');
          var tr = document.createElement('tr');
          tr.innerHTML =
              '<td style="text-align:center;"><input type="checkbox" ' + (r.selected ? 'checked' : '') + ' onchange="window.promoToggle(' + i + ', this.checked)"></td>' +
              '<td><strong>' + r.name + '</strong><br><small>' + r.id + '</small></td>' +
              '<td>' + r.totalObtained + '</td>' +
              '<td>' + (r.percentage !== '-' ? r.percentage + '%' : '-') + '</td>' +
              '<td style="color:' + gradeColor + '; font-weight:bold;">' + r.grade + '</td>' +
              '<td>' + resultTag + '</td>';
          return tr;
      }

      if (scrollEl && typeof window.emsVirtualTableMount === 'function') {
          scrollEl.style.maxHeight = scrollEl.style.maxHeight || '58vh';
          scrollEl.style.overflowY = 'auto';
          window.emsVirtualTableMount('promo-table', {
              scrollEl: scrollEl,
              tbody: tbody,
              rowHeight: 48,
              getData: function () { return window._promoRows || []; },
              renderRow: renderPromoRow,
              emptyHtml: '<tr><td colspan="6" style="text-align:center; color:#94a3b8;">کوئی ریکارڈ نہیں</td></tr>'
          });
          window.promoUpdateCount();
          return;
      }

      tbody.innerHTML = '';
      rows.forEach(function (r, i) { tbody.appendChild(renderPromoRow(i, r)); });
      window.promoUpdateCount();
  };

  window.promoToggle = function (i, checked) { if (window._promoRows[i]) window._promoRows[i].selected = checked; window.promoUpdateCount(); };
  window.promoSelectAll = function (val) { window._promoRows.forEach(function (r) { r.selected = val; }); window.promoRenderTable(); };
  window.promoSelectPassing = function () { window._promoRows.forEach(function (r) { r.selected = r.passing; }); window.promoRenderTable(); };
  window.promoUpdateCount = function () {
      var n = window._promoRows.filter(function (r) { return r.selected; }).length;
      var el = document.getElementById('promo-count');
      if (el) el.innerText = n + ' / ' + window._promoRows.length + ' منتخب';
  };

  window.promoApply = async function () {
      var fromClass = document.getElementById('promo-from-class').value;
      var toClass = document.getElementById('promo-to-class').value;
      var selected = window._promoRows.filter(function (r) { return r.selected; });
      if (!toClass) return showToast("اگلا درجہ (ترقی) منتخب کریں!", "error");
      if (toClass === fromClass) return showToast("موجودہ اور اگلا درجہ ایک جیسا نہیں ہو سکتا!", "error");
      if (!selected.length) return showToast("کم از کم ایک طالب علم منتخب کریں!", "error");
      if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('exams', 'edit')) return;
      if (!confirm(selected.length + " طلبہ کو '" + fromClass + "' سے '" + toClass + "' میں ترقی دی جائے؟")) return;

      var ts = new Date().getTime();
      var tenantId = (typeof window.emsGetTenantId === 'function' && window.emsGetTenantId())
          || window.CURRENT_MADRASA_TENANT_ID || window.EMS_ACTIVE_TENANT_ID || null;
      if (!tenantId) return showToast("مدرسہ شناخت دستیاب نہیں — ترقی محفوظ نہیں کی گئی", "error");

      try {
          if (typeof window.emsRegRepoPersistRegistration === 'function') {
              var okCount = 0;
              var failCount = 0;
              for (var pi = 0; pi < selected.length; pi++) {
                  var r = selected[pi];
                  var source = r.student || {};
                  var updated = Object.assign({}, source, {
                      id: r.id,
                      class: toClass,
                      prevClass: fromClass,
                      promotedAt: ts,
                      promotedFrom: fromClass
                  });
                  try {
                      var res = await window.emsRegRepoPersistRegistration(updated, {
                          tenantId: tenantId,
                          status: 'approved',
                          type: updated.type || 'student',
                          currentEditingId: r.id,
                          isEditingRejected: false
                      });
                      if (res && res.ok === false) throw new Error(res.reason || 'registration_save_failed');
                      okCount++;
                  } catch (oneErr) {
                      failCount++;
                      console.error('Promotion failed for', r.id, oneErr);
                  }
              }
              if (failCount && okCount) {
                  showToast(okCount + ' ترقی ہوئی، ' + failCount + ' ناکام — دوبارہ چیک کریں', 'warning');
                  return;
              }
              if (failCount && !okCount) throw new Error('promotion_batch_failed');
          } else {
              var fdb = window.EMS_FIRESTORE_DB;
              if (fdb) {
                  var col = fdb.collection('All_Madrasas').doc(tenantId).collection('Registrations');
                  var batch = fdb.batch();
                  selected.forEach(function (r) {
                      batch.set(col.doc(String(r.id)), { class: toClass, prevClass: fromClass, promotedAt: ts, promotedFrom: fromClass }, { merge: true });
                  });
                  await batch.commit();
              } else {
                  var users = typeof window.emsGetUsersMerged === 'function' ? window.emsGetUsersMerged() : [];
                  var map = {}; selected.forEach(function (r) { map[String(r.id)] = true; });
                  users.forEach(function (u) {
                      if (u.type === 'student' && map[String(u.id)]) {
                          u.prevClass = u.class; u.class = toClass; u.promotedAt = ts; u.promotedFrom = fromClass;
                      }
                  });
                  await emsSaveKey(DB.users, JSON.stringify(users));
              }
          }
      } catch (err) {
          console.error('Promotion save failed', err);
          showToast("ترقی محفوظ نہیں ہو سکی: " + (err && err.message ? err.message : 'نامعلوم خرابی'), "error");
          return;
      }

      showToast(selected.length + " طلبہ کو کامیابی سے ترقی دے دی گئی!", "success");
      // فہرست تازہ کریں
      setTimeout(function () {
          if (typeof window.refreshExamData === 'function') window.refreshExamData();
          document.getElementById('btn-load-promote').click();
      }, 600);
  };

if (typeof window.emsRegisterDepartmentRefresh === 'function') {
  window.emsRegisterDepartmentRefresh('exams', function () {
    if (typeof window.emsIsExamsModuleActive === 'function' && !window.emsIsExamsModuleActive()) return;
    window._exmDropdownGen = -1;
    if (typeof window.refreshExamData === 'function') window.refreshExamData(window._exmActiveTab);
  });
}

if (typeof window.addEventListener === 'function') {
  ['ems:repository-ready', 'ems:users-changed'].forEach(function (evName) {
    window.addEventListener(evName, function () {
      if (typeof window.emsIsExamsModuleActive === 'function' && !window.emsIsExamsModuleActive()) return;
      if (typeof window.exmFillClassSelects === 'function') window.exmFillClassSelects('.exm-dynamic-class');
      if (typeof window.exmEnsureTplAllClassesOption === 'function') window.exmEnsureTplAllClassesOption();
    });
  });
}

['mrk-exam-name', 'mrk-class', 'res-exam-name', 'res-class', 'ana-exam-name', 'ana-class'].forEach(function (selId) {
  var el = document.getElementById(selId);
  if (el) el.addEventListener('change', function () {
    var prefix = selId.indexOf('mrk') === 0 ? 'mrk' : (selId.indexOf('ana') === 0 ? 'ana' : 'res');
    if (typeof window.exmRefreshResultDateOptions === 'function') window.exmRefreshResultDateOptions(prefix);
    if (typeof window.exmUpdateLockUi === 'function') window.exmUpdateLockUi();
  });
});

['mrk-result-date', 'res-result-date', 'ana-result-date'].forEach(function (id) {
  var el = document.getElementById(id);
  if (el && !el.value) el.value = (typeof exmTodayYmd === 'function') ? exmTodayYmd() : '';
});
if (typeof window.exmRefreshResultDateOptions === 'function') {
  try {
    window.exmRefreshResultDateOptions('mrk');
    window.exmRefreshResultDateOptions('res');
    window.exmRefreshResultDateOptions('ana');
  } catch (eDates) { /* ignore */ }
}

document.getElementById('btn-exm-lock-toggle')?.addEventListener('click', function () {
  if (typeof window.exmToggleExamLock === 'function') window.exmToggleExamLock();
});

/**
 * Manual cloud pull — ALL Exams department keys:
 * settings (types/books), master sheet/templates, marks, locks.
 * Full read with conflict protection؛ dirty/newer local work is never silently overwritten.
 */
window.EMS_EXAMS_CLOUD_KEYS = [
  'ems_full_exams',
  'ems_exam_types',
  'ems_library_books',
  'ems_exam_templates',
  'ems_exam_locks',
  'ems_master_sheet_meta'
];

window.emsExamsLocalKeyStats = function () {
  var stats = {};
  var total = 0;
  (window.EMS_EXAMS_CLOUD_KEYS || []).forEach(function (key) {
    var n = 0;
    try {
      var raw = exmReadRaw(key);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) n = parsed.length;
        else if (parsed && typeof parsed === 'object') n = Object.keys(parsed).length;
        else if (typeof parsed === 'string') n = parsed ? 1 : 0;
        else n = 1;
      }
    } catch (e) { n = 0; }
    stats[key] = n;
    total += n;
  });
  return { byKey: stats, total: total };
};

function exmApplyPulledModuleData(key, remoteStr, remoteAt) {
  if (window.EmsCachePolicy && typeof window.EmsCachePolicy.markSynced === 'function') {
    window.EmsCachePolicy.markSynced(key, remoteAt || Date.now());
  }
  if (typeof window.emsSaveModuleData === 'function') {
    return window.emsSaveModuleData(key, remoteStr, { mutation: false, autoDelta: false }).then(function () {
      exmPurgeUnscopedLegacyKey(key);
      exmStampBlobOwner(key);
      exmWarmCacheAfterSave(key, remoteStr);
      return true;
    }).catch(function () { return false; });
  }
  try {
    if (typeof window.emsDurableWriteRaw === 'function') {
      window.emsDurableWriteRaw(key, remoteStr);
    } else if (window._emsOriginalSetItem) {
      window._emsOriginalSetItem.call(localStorage, key, remoteStr);
    } else {
      localStorage.setItem(key, remoteStr);
    }
    exmWarmCacheAfterSave(key, remoteStr);
    exmPurgeUnscopedLegacyKey(key);
    exmStampBlobOwner(key);
    return Promise.resolve(true);
  } catch (eWrite) {
    return Promise.resolve(false);
  }
}

function exmPullModuleDataFallback(tenantId, key) {
  var db = typeof window.getDbOrNull === 'function' ? window.getDbOrNull() : null;
  if (!db || !tenantId || !key) return Promise.resolve(false);
  var docId = 'Exams__' + key;
  var ref = typeof window.emsFirestoreSubColRef === 'function'
    ? window.emsFirestoreSubColRef(db, tenantId, 'ModuleData').doc(docId)
    : db.collection('All_Madrasas').doc(tenantId).collection('ModuleData').doc(docId);

  return ref.get({ source: 'server' }).then(function (doc) {
    if (!doc.exists) return false;
    var d = doc.data() || {};
    if (d.data == null) return false;
    var remoteStr = typeof d.data === 'string' ? d.data : JSON.stringify(d.data);
    var remoteAt = typeof window.EmsCachePolicy.remoteDocTimestamp === 'function'
      ? window.EmsCachePolicy.remoteDocTimestamp(d)
      : 0;
    if (window.EmsCachePolicy && typeof window.EmsCachePolicy.resolvePullConflict === 'function') {
      var localStr = exmReadRaw(key) || '';
      var decision = window.EmsCachePolicy.resolvePullConflict(key, localStr, remoteStr, remoteAt);
      if (!decision.apply) {
        if (decision.markSync && typeof window.EmsCachePolicy.markSynced === 'function') {
          window.EmsCachePolicy.markSynced(key, remoteAt || Date.now());
          return true;
        }
        return false;
      }
    }
    return exmApplyPulledModuleData(key, remoteStr, remoteAt);
  }).catch(function () { return false; });
}

window.emsPullExamsFromCloud = function (tenantId, opts) {
  opts = opts || {};
  tenantId = tenantId
    || (typeof window.emsGetCanonicalTenantId === 'function' && window.emsGetCanonicalTenantId())
    || (typeof window.emsGetTenantId === 'function' && window.emsGetTenantId())
    || window.CURRENT_MADRASA_TENANT_ID
    || null;
  if (!tenantId) {
    return Promise.resolve({ ok: false, reason: 'no_tenant', count: 0, source: 'exams_cloud_pull' });
  }

  var pullOpts = { forceFull: true, delta: false, forceApply: false };
  var keys = window.EMS_EXAMS_CLOUD_KEYS.slice();
  var byKey = {};
  keys.forEach(function (k) { byKey[k] = false; });

  var chain;
  if (window.EmsDirect && typeof window.EmsDirect.pullGroup === 'function') {
    chain = window.EmsDirect.pullGroup('Exams', pullOpts);
  } else if (typeof window.emsPullModuleGroup === 'function') {
    chain = window.emsPullModuleGroup('Exams');
  } else {
    return Promise.resolve({
      ok: false,
      source: 'no_fn',
      count: 0,
      error: 'Exams cloud pull not loaded'
    });
  }

  return Promise.resolve(chain).then(function (r) {
    if (r && r.keys) {
      Object.keys(r.keys).forEach(function (k) { byKey[k] = !!r.keys[k]; });
    } else if (r && r.pulled) {
      keys.forEach(function (k) { byKey[k] = true; });
    }

    // Legacy ModuleData fallback for config blobs not yet in Exams_Config
    var blobKeys = ['ems_exam_types', 'ems_library_books', 'ems_exam_templates', 'ems_exam_locks', 'ems_master_sheet_meta'];
    var fb = Promise.resolve();
    blobKeys.forEach(function (key) {
      fb = fb.then(function () {
        if (byKey[key]) return null;
        return exmPullModuleDataFallback(tenantId, key).then(function (ok) {
          if (ok) byKey[key] = true;
        });
      });
    });
    return fb.then(function () { return r; });
  }).then(function (r) {
    var stats = window.emsExamsLocalKeyStats();
    var pulledKeys = Object.keys(byKey).filter(function (k) { return byKey[k]; });
    if (typeof window.refreshExamData === 'function') {
      try { window.refreshExamData(); } catch (eRefresh) { /* ignore */ }
    }
    return {
      ok: true,
      count: stats.total,
      marksCount: (stats.byKey && stats.byKey.ems_full_exams) || 0,
      pulled: (r && r.pulled) || pulledKeys.length,
      keysPulled: pulledKeys,
      keysExpected: keys,
      byKey: byKey,
      keyStats: stats.byKey,
      source: 'exams_cloud_pull',
      tenantId: tenantId,
      coverage: 'all_exams_subsections'
    };
  }).catch(function (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
      count: 0,
      source: 'exams_cloud_pull',
      tenantId: tenantId
    };
  });
};
