// ================= شعبۂ تربیت و نظم — Training & Discipline =================
(function () {
  'use strict';

  var PRAYER_KEY = 'ems_tar_prayer';
  var ETHICS_KEY = 'ems_tar_ethics';
  var DISC_KEY = 'ems_tar_discipline';
  var REFORM_KEY = 'ems_tar_reform';
  var AWARD_KEY = 'ems_tar_awards';
  var WARN_KEY = 'ems_tar_warnings';
  var SETTINGS_KEY = 'ems_tar_settings';
  var AUDIT_KEY = 'ems_tar_audit';

  var PRAYERS = [
    { id: 'fajr', label: 'فجر' }, { id: 'zuhr', label: 'ظہر' },
    { id: 'asr', label: 'عصر' }, { id: 'maghrib', label: 'مغرب' },
    { id: 'isha', label: 'عشاء' }
  ];

  var PRAYER_STATUS = [
    { id: 'jamaat', label: 'باجماعت', score: 100 },
    { id: 'individual', label: 'انفرادی', score: 80 },
    { id: 'late', label: 'تاخیر', score: 50 },
    { id: 'leave', label: 'رخصت', score: 60 },
    { id: 'absent', label: 'غیر حاضر', score: 0 }
  ];

  var ETHICS_POS = ['حسن اخلاق', 'امانت داری', 'ادب', 'تعاون', 'ذمہ داری', 'صفائی', 'وقت کی پابندی'];
  var ETHICS_NEG = ['تاخیر', 'بد نظمی', 'غیر ذمہ داری', 'نامناسب رویہ', 'صفائی میں کوتاہی'];
  var DISC_TYPES = ['تنبیہ', 'زبانی ہدایت', 'تحریری تنبیہ', 'والدین سے رابطہ', 'اصلاحی نشست', 'انتظامی کارروائی'];
  var REFORM_TYPES = ['خصوصی ملاقات', 'تربیتی نشست', 'مشاورتی گفتگو', 'اضافی نگرانی'];
  var AWARD_TYPES = ['بہترین اخلاق', 'بہترین نماز پابندی', 'بہترین حاضری', 'بہترین نظم', 'بہترین صفائی', 'مثالی طالب علم'];

  function readJson(key, fb) {
    try { return JSON.parse(localStorage.getItem(key) || (fb != null ? JSON.stringify(fb) : 'null')); }
    catch (e) { return fb; }
  }

  function writeJson(key, val, opts) {
    if (typeof window.emsRequireStaffAction === 'function') {
      if (!window.emsRequireStaffAction('training', 'edit')) return Promise.resolve();
    }
    var options = Object.assign({ mutation: true, autoDelta: true }, opts || {});
    if (window.emsSaveModuleData) return window.emsSaveModuleData(key, typeof val === 'string' ? val : JSON.stringify(val), options);
    localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
    return Promise.resolve();
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'success');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
  }

  function slug(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6); }

  function getUsers() {
    try {
      var u = typeof window.emsGetUsersSync === 'function'
        ? window.emsGetUsersSync()
        : (typeof window.emsGetUsersMerged === 'function' ? window.emsGetUsersMerged() : []);
      if (typeof window.emsFilterByDepartment === 'function') {
        return window.emsFilterByDepartment(u);
      }
      return u;
    } catch (e) { return []; }
  }

  function deptFilterRecords(list) {
    if (typeof window.emsFilterByDepartment === 'function') {
      return window.emsFilterByDepartment(list);
    }
    return list;
  }

  window.tarGetSettings = function () {
    var s = readJson(SETTINGS_KEY, null);
    if (!s) s = {
      alertPrayerDays: 3, alertScoreDrop: 10, alertScoreDropDays: 7, alertMinScore: 50,
      weightPrayer: 35, weightEthics: 30, weightDiscipline: 20, weightOther: 15
    };
    if (s.alertScoreDropDays == null) s.alertScoreDropDays = 7;
    return s;
  };

  window.tarSaveSettings = function (s) { writeJson(SETTINGS_KEY, s); };

  var TAR_ADMIN_TABS = [
    'tar-win-dashboard', 'tar-win-students', 'tar-win-staff', 'tar-win-reform',
    'tar-win-warnings', 'tar-win-reports', 'tar-win-analytics', 'tar-win-settings'
  ];
  var TAR_STAFF_DEFAULT_TAB = 'tar-win-prayer';

  function tarIsTrainingAdmin() {
    if (typeof window.isSuperAdmin === 'function' && window.isSuperAdmin()) return true;
    if (typeof window.isMadrasaAdmin === 'function' && window.isMadrasaAdmin()) return true;
    return false;
  }

  function tarIsTeacherOnly() {
    if (tarIsTrainingAdmin()) return false;
    return !!(typeof window.emsIsStaffUser === 'function' && window.emsIsStaffUser());
  }
  window.tarIsTeacherOnly = tarIsTeacherOnly;

  function tarResolveTabForRole(tabId) {
    if (tarIsTeacherOnly() && TAR_ADMIN_TABS.indexOf(tabId) >= 0) return TAR_STAFF_DEFAULT_TAB;
    if (!tarIsTrainingAdmin() && tabId === 'tar-win-settings') return TAR_STAFF_DEFAULT_TAB;
    return tabId;
  }

  function tarApplyRoleUi() {
    var isTeacher = tarIsTeacherOnly();
    var isAdmin = tarIsTrainingAdmin();
    document.querySelectorAll('#tar-ribbon-menu .reg-tab').forEach(function (btn) {
      var onclick = btn.getAttribute('onclick') || '';
      var isAdminTab = TAR_ADMIN_TABS.some(function (tab) { return onclick.indexOf(tab) !== -1; });
      if (isTeacher && isAdminTab) {
        btn.style.display = 'none';
        return;
      }
      if (!isAdmin && onclick.indexOf('tar-win-settings') !== -1) {
        btn.style.display = 'none';
        return;
      }
      btn.style.display = '';
    });
  }

  function tarGetDefaultTabId() {
    return tarIsTeacherOnly() ? TAR_STAFF_DEFAULT_TAB : 'tar-win-dashboard';
  }

  function tarGetFilteredStudents() {
    var f = getFilterValues();
    if (f.type === 'staff') return [];
    return getUsers().filter(function (u) { return u.type === 'student'; }).filter(function (u) {
      if (f.grade && u.class !== f.grade) return false;
      if (f.dept && u.dept !== f.dept && u.class !== f.dept) return false;
      if (f.personId && u.id !== f.personId) return false;
      return true;
    });
  }

  function prayerSelectOptionsHtml(selected) {
    return PRAYER_STATUS.map(function (s) {
      var short = s.id === 'jamaat' ? 'جماعت' : s.label;
      return '<option value="' + s.id + '"' + (selected === s.id ? ' selected' : '') + '>' + short + '</option>';
    }).join('');
  }

  function tarSetPrayerEntryMode(mode) {
    var single = document.getElementById('tar-prayer-single-panel');
    var bulk = document.getElementById('tar-prayer-bulk-panel');
    var btnSingle = document.getElementById('tar-btn-mode-single');
    var btnBulk = document.getElementById('tar-btn-mode-bulk');
    var isBulk = mode === 'bulk';
    if (single) single.style.display = isBulk ? 'none' : '';
    if (bulk) bulk.style.display = isBulk ? 'block' : 'none';
    if (btnSingle) {
      btnSingle.classList.toggle('btn-primary', !isBulk);
      btnSingle.classList.toggle('btn-outline', isBulk);
      btnSingle.classList.toggle('active-mode', !isBulk);
    }
    if (btnBulk) {
      btnBulk.classList.toggle('btn-primary', isBulk);
      btnBulk.classList.toggle('btn-outline', !isBulk);
      btnBulk.classList.toggle('active-mode', isBulk);
    }
    if (isBulk) window.tarRenderBulkPrayerGrid();
  }
  window.tarSetPrayerEntryMode = tarSetPrayerEntryMode;

  function tarBindDateMax(ids) {
    var maxD = todayIso();
    (ids || []).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.setAttribute('max', maxD);
    });
  }

  function tarCreatePrayerEntry(user, date, prayers) {
    var entry = {
      id: slug('TPR'), date: date,
      personId: user.id, personType: user.type, personName: user.name || user.fullName,
      grade: user.class || '', dept: user.dept || user.class || '',
      prayers: prayers, timestamp: Date.now()
    };
    if (typeof window.emsStampDepartment === 'function') window.emsStampDepartment(entry);
    return entry;
  }

  function tarPrayerExists(list, personId, date) {
    return list.some(function (r) { return r.personId === personId && r.date === date; });
  }

  window.tarRenderBulkPrayerGrid = function () {
    var tbody = document.getElementById('tar-bulk-prayer-tbody');
    var hint = document.getElementById('tar-bulk-filter-hint');
    if (!tbody) return;
    var students = tarGetFilteredStudents();
    var f = getFilterValues();
    if (hint) {
      var parts = [];
      if (f.grade) parts.push('درجہ: ' + f.grade);
      if (f.dept) parts.push('شعبہ: ' + f.dept);
      hint.textContent = students.length
        ? (parts.length ? parts.join(' · ') + ' — ' : '') + students.length + ' طلبہ'
        : 'فلٹر کے مطابق کوئی طالب علم نہیں — درجہ/شعبہ منتخب کریں';
    }
    if (!students.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">درجہ یا شعبہ فلٹر سے طلبہ منتخب کریں</td></tr>';
      return;
    }
    tbody.innerHTML = students.map(function (u) {
      var cells = PRAYERS.map(function (p) {
        return '<td><select class="tar-bulk-pr-sel input-control input-sm" data-prayer="' + p.id + '">' +
          prayerSelectOptionsHtml('jamaat') + '</select></td>';
      }).join('');
      return '<tr data-person-id="' + escAttr(u.id) + '"><td><strong>' + esc(u.name || u.fullName) + '</strong></td><td>' + esc(u.class || '—') + '</td>' + cells + '</tr>';
    }).join('');
  };

  window.tarRenderSettings = function () {
    if (!tarIsTrainingAdmin()) return;
    var s = window.tarGetSettings();
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.value = v; };
    set('tar-set-weight-prayer', s.weightPrayer);
    set('tar-set-weight-ethics', s.weightEthics);
    set('tar-set-weight-discipline', s.weightDiscipline);
    set('tar-set-weight-other', s.weightOther);
    set('tar-set-alert-min', s.alertMinScore);
    set('tar-set-alert-prayer-days', s.alertPrayerDays);
    set('tar-set-alert-drop', s.alertScoreDrop);
    set('tar-set-alert-drop-days', s.alertScoreDropDays);
    window.tarUpdateWeightSumHint();
  };

  window.tarUpdateWeightSumHint = function () {
    var hint = document.getElementById('tar-weight-sum-hint');
    if (!hint) return;
    var ids = ['tar-set-weight-prayer', 'tar-set-weight-ethics', 'tar-set-weight-discipline', 'tar-set-weight-other'];
    var sum = 0;
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      sum += el ? (parseInt(el.value, 10) || 0) : 0;
    });
    hint.textContent = 'مجموعہ: ' + sum + (sum === 100 ? ' ✓' : ' (100 ہونا چاہیے)');
    hint.style.color = sum === 100 ? '#0f766e' : '#dc2626';
  };

  window.tarSaveSettingsForm = function () {
    if (!tarIsTrainingAdmin()) return toast('صرف منتظم ترتیبات بدل سکتا ہے', 'error');
    var wP = parseInt((document.getElementById('tar-set-weight-prayer') || {}).value, 10) || 0;
    var wE = parseInt((document.getElementById('tar-set-weight-ethics') || {}).value, 10) || 0;
    var wD = parseInt((document.getElementById('tar-set-weight-discipline') || {}).value, 10) || 0;
    var wO = parseInt((document.getElementById('tar-set-weight-other') || {}).value, 10) || 0;
    if (wP + wE + wD + wO !== 100) {
      return toast('وزن کا مجموعہ بالکل 100 ہونا چاہیے (اب: ' + (wP + wE + wD + wO) + ')', 'error');
    }
    var next = {
      weightPrayer: wP,
      weightEthics: wE,
      weightDiscipline: wD,
      weightOther: wO,
      alertMinScore: parseInt((document.getElementById('tar-set-alert-min') || {}).value, 10) || 50,
      alertPrayerDays: parseInt((document.getElementById('tar-set-alert-prayer-days') || {}).value, 10) || 3,
      alertScoreDrop: parseInt((document.getElementById('tar-set-alert-drop') || {}).value, 10) || 10,
      alertScoreDropDays: parseInt((document.getElementById('tar-set-alert-drop-days') || {}).value, 10) || 7
    };
    var before = window.tarGetSettings();
    window.tarSaveSettings(next);
    window.tarAudit('update', 'ترتیبات', before, next);
    window.tarUpdateWeightSumHint();
    toast('ترتیبات محفوظ', 'success');
  };

  window.tarSaveBulkPrayer = function () {
    var date = (document.getElementById('tar-bulk-prayer-date') || {}).value || todayIso();
    var dateErr = tarValidateEntryDate(date);
    if (dateErr) return toast(dateErr, 'error');
    var students = tarGetFilteredStudents();
    if (!students.length) return toast('فلٹر کے مطابق کوئی طالب علم نہیں', 'error');
    var list = window.tarGetPrayer().slice();
    var newEntries = [];
    var skipped = 0;
    var tbody = document.getElementById('tar-bulk-prayer-tbody');
    var rows = tbody ? tbody.querySelectorAll('tr[data-person-id]') : [];
    rows.forEach(function (tr) {
      var uid = tr.getAttribute('data-person-id');
      var user = students.find(function (u) { return u.id === uid; });
      if (!user) return;
      if (tarPrayerExists(list, user.id, date) || tarPrayerExists(newEntries, user.id, date)) {
        skipped++;
        return;
      }
      var prayers = {};
      PRAYERS.forEach(function (p) {
        var sel = tr.querySelector('.tar-bulk-pr-sel[data-prayer="' + p.id + '"]');
        prayers[p.id] = sel ? sel.value : 'jamaat';
      });
      newEntries.push(tarCreatePrayerEntry(user, date, prayers));
    });
    if (!newEntries.length) {
      return toast(skipped ? 'سب طلبہ کے لیے اس تاریخ کا ریکارڈ پہلے سے موجود ہے' : 'کچھ محفوظ نہیں ہوا', 'warning');
    }
    writeJson(PRAYER_KEY, list.concat(newEntries));
    newEntries.forEach(function (entry) {
      window.tarAudit('create', 'نماز (اجتماعی): ' + entry.personName, null, entry);
    });
    toast(newEntries.length + ' محفوظ' + (skipped ? '، ' + skipped + ' پہلے سے موجود' : ''), 'success');
    window.tarRenderPrayer();
    if (typeof window.tarUpdateDashboardCard === 'function') window.tarUpdateDashboardCard();
  };

  window.tarGetPrayer = function () { return readJson(PRAYER_KEY, []) || []; };
  window.tarGetEthics = function () { return readJson(ETHICS_KEY, []) || []; };
  window.tarGetDiscipline = function () { return readJson(DISC_KEY, []) || []; };
  window.tarGetReform = function () { return readJson(REFORM_KEY, []) || []; };
  window.tarGetAwards = function () { return readJson(AWARD_KEY, []) || []; };
  window.tarGetWarnings = function () { return readJson(WARN_KEY, []) || []; };

  window.tarAudit = function (action, summary, before, after) {
    var logs = readJson(AUDIT_KEY, []) || [];
    logs.push({
      id: slug('TA'), timestamp: Date.now(),
      user: (typeof window.sysActorName === 'function') ? window.sysActorName() : 'user',
      action: action, summary: summary,
      before: before ? JSON.parse(JSON.stringify(before)) : null,
      after: after ? JSON.parse(JSON.stringify(after)) : null
    });
    if (logs.length > 3000) logs = logs.slice(-3000);
    writeJson(AUDIT_KEY, logs);
  };

  window.tarSyncFromRegistration = function () {
    return getUsers().filter(function (u) { return u && (u.type === 'student' || u.type === 'staff' || u.type === 'teacher'); }).length;
  };

  function getFilterValues() {
    return {
      year: (document.getElementById('tar-filter-year') || {}).value || '',
      month: (document.getElementById('tar-filter-month') || {}).value || '',
      grade: (document.getElementById('tar-filter-grade') || {}).value || '',
      dept: (document.getElementById('tar-filter-dept') || {}).value || '',
      personId: (document.getElementById('tar-filter-person') || {}).value || '',
      type: (document.getElementById('tar-filter-type') || {}).value || 'student'
    };
  }

  function todayIso() {
    return new Date().toISOString().split('T')[0];
  }

  function isoDaysAgo(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  }

  function tarValidateEntryDate(dateStr) {
    if (!dateStr) return 'تاریخ درج کریں';
    if (dateStr > todayIso()) return 'مستقبل کی تاریخ درج نہیں ہو سکتی';
    return null;
  }

  function tarFormatScore(val, suffix) {
    suffix = suffix == null ? '%' : suffix;
    if (val == null || val === '' || (typeof val === 'number' && isNaN(val))) return '—';
    return String(val) + suffix;
  }

  function tarScoreColor(overall) {
    if (overall == null) return '#94a3b8';
    if (overall >= 80) return '#22c55e';
    if (overall >= 60) return '#eab308';
    return '#ef4444';
  }

  function recordMatchesFilter(rec, f) {
    if (!rec || !rec.date) return false;
    if (f.year && rec.date.substring(0, 4) !== f.year) return false;
    if (f.month && rec.date.substring(0, 7) !== f.month) return false;
    if (f.dateFrom && rec.date < f.dateFrom) return false;
    if (f.dateTo && rec.date > f.dateTo) return false;
    return true;
  }

  function matchDate(d, f) {
    return recordMatchesFilter({ date: d }, f);
  }

  function matchPerson(rec, f, user) {
    if (f.personId && rec.personId !== f.personId) return false;
    if (f.grade && rec.grade !== f.grade && (!user || user.class !== f.grade)) return false;
    if (f.dept && rec.dept !== f.dept && (!user || (user.dept || user.class) !== f.dept)) return false;
    if (f.type === 'student' && rec.personType !== 'student') return false;
    if (f.type === 'staff' && rec.personType !== 'staff' && rec.personType !== 'teacher') return false;
    return matchDate(rec.date, f);
  }

  function prayerScore(status) {
    var s = PRAYER_STATUS.find(function (x) { return x.id === status; });
    return s ? s.score : 0;
  }

  window.tarFormatScore = tarFormatScore;

  window.tarComputePersonScore = function (personId, filterOverride) {
    var f = filterOverride || getFilterValues();
    var prayer = window.tarGetPrayer().filter(function (r) { return r.personId === personId && recordMatchesFilter(r, f); });
    var ethics = window.tarGetEthics().filter(function (r) { return r.personId === personId && recordMatchesFilter(r, f); });
    var disc = window.tarGetDiscipline().filter(function (r) { return r.personId === personId && recordMatchesFilter(r, f); });
    var awards = window.tarGetAwards().filter(function (r) { return r.personId === personId && recordMatchesFilter(r, f); });
    var settings = window.tarGetSettings();

    var prayerPct = null;
    if (prayer.length) {
      var total = 0, cnt = 0;
      prayer.forEach(function (p) {
        PRAYERS.forEach(function (pr) {
          total += prayerScore((p.prayers && p.prayers[pr.id]) || 'absent');
          cnt++;
        });
      });
      prayerPct = cnt ? Math.round(total / cnt) : null;
    }

    var ethicsPct = null;
    if (ethics.length) {
      var ethicsBase = 50;
      ethics.forEach(function (e) {
        if (e.kind === 'positive') ethicsBase += 4;
        else ethicsBase -= 6;
      });
      ethicsPct = Math.min(100, Math.max(0, ethicsBase));
    }

    var discScore = null;
    if (disc.length) {
      discScore = Math.max(0, 100 - disc.length * 8);
    }

    var otherScore = null;
    if (awards.length) {
      otherScore = Math.min(100, 50 + awards.length * 5);
    }

    var hasScoreData = prayer.length > 0 || ethics.length > 0 || disc.length > 0 || awards.length > 0;

    var wP = settings.weightPrayer || 35;
    var wE = settings.weightEthics || 30;
    var wD = settings.weightDiscipline || 20;
    var wO = settings.weightOther || 15;

    var overall = null;
    if (hasScoreData) {
      var sum = 0, totalW = 0;
      if (prayerPct != null) { sum += prayerPct * wP; totalW += wP; }
      if (ethicsPct != null) { sum += ethicsPct * wE; totalW += wE; }
      if (discScore != null) { sum += discScore * wD; totalW += wD; }
      if (otherScore != null) { sum += otherScore * wO; totalW += wO; }
      overall = totalW ? Math.round(sum / totalW) : null;
    }

    return {
      overall: overall,
      prayer: prayerPct,
      ethics: ethicsPct,
      discipline: discScore,
      responsibility: otherScore,
      hasScoreData: hasScoreData,
      positiveCount: ethics.filter(function (e) { return e.kind === 'positive'; }).length,
      negativeCount: ethics.filter(function (e) { return e.kind === 'negative'; }).length,
      discCount: disc.length,
      awardCount: awards.length
    };
  };

  function tarComputePersonScoreInRange(personId, dateFrom, dateTo) {
    return window.tarComputePersonScore(personId, {
      year: '', month: '', grade: '', dept: '', personId: '', type: 'student',
      dateFrom: dateFrom, dateTo: dateTo
    });
  }

  window.tarGetDashboardStats = function () {
    window.tarSyncFromRegistration();
    var students = getUsers().filter(function (u) { return u.type === 'student'; });
    var scored = students.map(function (s) {
      return { user: s, score: window.tarComputePersonScore(s.id) };
    }).filter(function (x) { return x.score.hasScoreData && x.score.overall != null; });

    var avg = null;
    var avgPrayer = null;
    if (scored.length) {
      avg = Math.round(scored.reduce(function (a, b) { return a + b.score.overall; }, 0) / scored.length);
      var prayerScored = scored.filter(function (x) { return x.score.prayer != null; });
      avgPrayer = prayerScored.length
        ? Math.round(prayerScored.reduce(function (a, b) { return a + b.score.prayer; }, 0) / prayerScored.length)
        : null;
    }

    var top = scored.slice().sort(function (a, b) { return b.score.overall - a.score.overall; })[0];
    var weak = scored.slice().sort(function (a, b) { return a.score.overall - b.score.overall; })[0];

    return {
      students: students.length,
      scoredStudents: scored.length,
      staff: getUsers().filter(function (u) { return u.type === 'staff' || u.type === 'teacher'; }).length,
      avgScore: avg,
      avgPrayer: avgPrayer,
      topStudent: top ? top.user.name : '—',
      topScore: top ? top.score.overall : null,
      weakArea: weak && weak.score.overall < 50 ? (weak.user.class || 'عمومی') : '—',
      alerts: window.tarGetAlerts().length
    };
  };

  window.tarGetAlerts = function () {
    var alerts = [];
    var settings = window.tarGetSettings();
    var students = getUsers().filter(function (u) { return u.type === 'student'; });
    var dropDays = Number(settings.alertScoreDropDays) || 7;
    var dropThreshold = Number(settings.alertScoreDrop) || 10;
    var recentStart = isoDaysAgo(dropDays);
    var priorStart = isoDaysAgo(dropDays * 2);
    var priorEnd = isoDaysAgo(dropDays + 1);

    students.forEach(function (s) {
      var score = window.tarComputePersonScore(s.id);
      if (score.hasScoreData && score.overall != null && score.overall < (settings.alertMinScore || 50)) {
        alerts.push({ type: 'score', personId: s.id, name: s.name, msg: 'تربیتی اسکور کم: ' + score.overall + '%' });
      }

      var recentSc = tarComputePersonScoreInRange(s.id, recentStart, todayIso());
      var priorSc = tarComputePersonScoreInRange(s.id, priorStart, priorEnd);
      if (recentSc.hasScoreData && priorSc.hasScoreData &&
          recentSc.overall != null && priorSc.overall != null) {
        var drop = priorSc.overall - recentSc.overall;
        if (drop >= dropThreshold) {
          alerts.push({
            type: 'drop', personId: s.id, name: s.name,
            msg: 'اسکور میں ' + drop + ' پوائنٹ کمی (' + dropDays + ' دنوں میں)'
          });
        }
      }

      var records = window.tarGetPrayer().filter(function (p) { return p.personId === s.id; }).slice(-(settings.alertPrayerDays || 3));
      var badDays = 0;
      records.forEach(function (p) {
        var abs = PRAYERS.filter(function (pr) { return (p.prayers && p.prayers[pr.id]) === 'absent'; }).length;
        if (abs >= 3) badDays++;
      });
      if (badDays >= 2) {
        alerts.push({ type: 'prayer', personId: s.id, name: s.name, msg: 'نماز میں مسلسل کمی' });
      }
      if (score.negativeCount >= 3 && score.positiveCount < score.negativeCount) {
        alerts.push({ type: 'ethics', personId: s.id, name: s.name, msg: 'اخلاقی مشاہدات میں خرابی' });
      }
    });
    return alerts;
  };

  function pieSvg(parts, colors) {
    var total = parts.reduce(function (a, b) { return a + b; }, 0) || 1;
    var r = 42, cx = 50, cy = 50, start = 0, paths = '';
    parts.forEach(function (v, i) {
      if (v <= 0) return;
      var angle = (v / total) * Math.PI * 2;
      var x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
      start += angle;
      var x2 = cx + r * Math.cos(start), y2 = cy + r * Math.sin(start);
      paths += '<path d="M' + cx + ',' + cy + ' L' + x1 + ',' + y1 + ' A' + r + ',' + r + ' 0 ' + (angle > Math.PI ? 1 : 0) + ' 1 ' + x2 + ',' + y2 + ' Z" fill="' + (colors[i] || '#94a3b8') + '"/>';
    });
    return '<svg viewBox="0 0 100 100" width="110" height="110">' + paths + '</svg>';
  }

  function pieCountSvg(parts, colors, centerVal) {
    var svg = pieSvg(parts, colors);
    var label = (centerVal == null ? '' : String(centerVal));
    return svg.replace('</svg>',
      '<text x="50" y="54" text-anchor="middle" font-size="20" font-weight="bold" fill="#1e293b">' + label + '</text></svg>');
  }

  function barSvg(labels, values, color) {
    var max = Math.max.apply(null, values.concat([1]));
    return '<svg viewBox="0 0 120 100" width="100%" height="100%">' + values.map(function (v, i) {
      var h = Math.round((v / max) * 70);
      return '<rect x="' + (8 + i * 22) + '" y="' + (80 - h) + '" width="18" height="' + h + '" fill="' + (color || '#0d9488') + '" rx="2"/>' +
        '<text x="' + (17 + i * 22) + '" y="92" font-size="5" text-anchor="middle" fill="#64748b">' + esc((labels[i] || '').slice(0, 5)) + '</text>';
    }).join('') + '</svg>';
  }

  function progressBar(pct, color) {
    if (pct == null) {
      return '<div class="tar-progress" style="background:#e2e8f0;"><span style="color:#64748b;font-size:10px;">—</span></div>';
    }
    pct = Math.min(100, Math.max(0, pct));
    return '<div class="tar-progress"><div class="tar-progress-bar" style="width:' + pct + '%;background:' + (color || '#0d9488') + ';"></div><span>' + pct + '%</span></div>';
  }

  function fillPersonSelect(id, type) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var users = getUsers().filter(function (u) {
      if (type === 'student') return u.type === 'student';
      if (type === 'staff') return u.type === 'staff' || u.type === 'teacher';
      return u.type === 'student' || u.type === 'staff' || u.type === 'teacher';
    });
    sel.innerHTML = '<option value="">منتخب کریں...</option>' + users.map(function (u) {
      return '<option value="' + esc(u.id) + '" data-grade="' + esc(u.class || '') + '" data-dept="' + esc(u.dept || u.class || '') + '">' + esc(u.name || u.fullName) + ' (' + esc(u.id) + ')</option>';
    }).join('');
  }

  function fillFilterDropdowns() {
    var grades = {}, depts = {};
    getUsers().forEach(function (u) {
      if (u.class) grades[u.class] = true;
      if (u.dept) depts[u.dept] = true;
      if (u.class && u.type === 'student') depts[u.class] = true;
    });
    var gsel = document.getElementById('tar-filter-grade');
    if (gsel && gsel.options.length <= 1) {
      gsel.innerHTML = '<option value="">تمام درجات</option>' + Object.keys(grades).map(function (g) {
        return '<option value="' + esc(g) + '">' + esc(g) + '</option>';
      }).join('');
    }
    var dsel = document.getElementById('tar-filter-dept');
    if (dsel && dsel.options.length <= 1) {
      dsel.innerHTML = '<option value="">تمام شعبے</option>' + Object.keys(depts).map(function (d) {
        return '<option value="' + esc(d) + '">' + esc(d) + '</option>';
      }).join('');
    }
    var ysel = document.getElementById('tar-filter-year');
    if (ysel && ysel.options.length <= 1) {
      var y = new Date().getFullYear();
      ysel.innerHTML = '<option value="">تمام</option>' + [y, y - 1].map(function (yr) {
        return '<option value="' + yr + '">' + yr + '</option>';
      }).join('');
    }
    var psel = document.getElementById('tar-filter-person');
    if (psel && psel.options.length <= 1) {
      var users = getUsers().filter(function (u) { return u.type === 'student' || u.type === 'staff' || u.type === 'teacher'; });
      psel.innerHTML = '<option value="">تمام</option>' + users.map(function (u) {
        return '<option value="' + esc(u.id) + '">' + esc(u.name || u.fullName) + '</option>';
      }).join('');
    }
  }

  window.switchTarTab = function (tabId, btn) {
    tabId = tarResolveTabForRole(tabId);
    if (!btn || btn.style.display === 'none') {
      btn = document.querySelector('#tar-ribbon-menu .reg-tab[onclick*="' + tabId + '"]');
    }
    document.querySelectorAll('#module-training .tar-tab-content').forEach(function (el) { el.style.display = 'none'; });
    var p = document.getElementById(tabId);
    if (p) p.style.display = 'block';
    document.querySelectorAll('#tar-ribbon-menu .reg-tab').forEach(function (b) { b.classList.remove('active-sub-tab'); });
    if (btn && btn.style.display !== 'none') btn.classList.add('active-sub-tab');
    fillFilterDropdowns();
    if (tabId === 'tar-win-dashboard') window.tarRenderDashboard();
    if (tabId === 'tar-win-students') window.tarRenderStudentRecords();
    if (tabId === 'tar-win-staff') window.tarRenderStaffRecords();
    if (tabId === 'tar-win-prayer') window.tarRenderPrayer();
    if (tabId === 'tar-win-discipline') window.tarRenderDiscipline();
    if (tabId === 'tar-win-ethics') window.tarRenderEthics();
    if (tabId === 'tar-win-reform') window.tarRenderReform();
    if (tabId === 'tar-win-awards') window.tarRenderAwards();
    if (tabId === 'tar-win-warnings') window.tarRenderWarnings();
    if (tabId === 'tar-win-reports') window.tarRenderReports();
    if (tabId === 'tar-win-analytics') window.tarRenderAnalytics();
    if (tabId === 'tar-win-settings') window.tarRenderSettings();
  };

  window.tarInitModule = function () {
    window.tarSyncFromRegistration();
    tarApplyRoleUi();
    fillFilterDropdowns();
    var d = todayIso();
    tarBindDateMax(['tar-prayer-date', 'tar-disc-date', 'tar-ethics-date', 'tar-reform-date', 'tar-award-date', 'tar-warn-date', 'tar-bulk-prayer-date']);
    ['tar-prayer-date', 'tar-disc-date', 'tar-ethics-date', 'tar-reform-date', 'tar-award-date', 'tar-warn-date', 'tar-bulk-prayer-date'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && !el.value) el.value = d;
    });
    tarSetPrayerEntryMode('single');
    var defaultTab = tarGetDefaultTabId();
    var defaultBtn = document.querySelector('#tar-ribbon-menu .reg-tab[onclick*="' + defaultTab + '"]');
    var active = document.querySelector('#tar-ribbon-menu .reg-tab.active-sub-tab');
    if (active && active.style.display !== 'none' && !tarIsTeacherOnly()) {
      active.click();
    } else {
      window.switchTarTab(defaultTab, defaultBtn);
    }
  };

  window.tarRenderDashboard = function () {
    var st = window.tarGetDashboardStats();
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.innerText = v; };
    set('tar-dash-students', st.students);
    set('tar-dash-avg', tarFormatScore(st.avgScore));
    set('tar-dash-prayer', tarFormatScore(st.avgPrayer));
    set('tar-dash-alerts', st.alerts);
    set('tar-dash-top', st.topScore != null ? ((st.topStudent || '—') + ' (' + st.topScore + '%)') : '—');
    var alertsEl = document.getElementById('tar-dash-alerts-list');
    if (alertsEl) {
      var alerts = window.tarGetAlerts().slice(0, 8);
      alertsEl.innerHTML = alerts.length ? alerts.map(function (a) {
        return '<div class="tar-alert-item tar-alert-' + a.type + '"><i class="fas fa-bell"></i> <strong>' + esc(a.name) + '</strong> — ' + esc(a.msg) + '</div>';
      }).join('') : '<p style="color:#94a3b8;text-align:center;">کوئی الرٹ نہیں</p>';
    }
    var chart = document.getElementById('tar-dash-chart');
    if (chart) {
      var students = getUsers().filter(function (u) { return u.type === 'student'; });
      var byGrade = {};
      students.forEach(function (s) {
        var sc = window.tarComputePersonScore(s.id);
        if (!sc.hasScoreData || sc.overall == null) return;
        var g = s.class || 'عمومی';
        if (!byGrade[g]) byGrade[g] = [];
        byGrade[g].push(sc.overall);
      });
      var labels = Object.keys(byGrade).slice(0, 6);
      var vals = labels.map(function (g) {
        var arr = byGrade[g];
        return arr.length ? Math.round(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length) : 0;
      });
      chart.innerHTML = labels.length ? barSvg(labels, vals, '#0d9488') : '<p style="color:#94a3b8;text-align:center;padding:20px;">کوئی اسکور شدہ ڈیٹا نہیں</p>';
    }
  };

  function renderPersonTable(tbodyId, type) {
    var tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    var f = getFilterValues();
    var users = getUsers().filter(function (u) {
      if (type === 'student') return u.type === 'student';
      return u.type === 'staff' || u.type === 'teacher';
    }).filter(function (u) {
      if (f.grade && u.class !== f.grade) return false;
      if (f.dept && u.dept !== f.dept && u.class !== f.dept) return false;
      if (f.personId && u.id !== f.personId) return false;
      return true;
    });
    if (!users.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#94a3b8;">کوئی ریکارڈ نہیں</td></tr>'; return; }
    tbody.innerHTML = users.map(function (u) {
      var sc = window.tarComputePersonScore(u.id);
      var color = tarScoreColor(sc.overall);
      return '<tr onclick="window.tarDrillPerson(\'' + u.id + '\')" style="cursor:pointer;">' +
        '<td>' + esc(u.id) + '</td><td><strong>' + esc(u.name || u.fullName) + '</strong></td>' +
        '<td>' + esc(u.class || u.dept || '—') + '</td>' +
        '<td>' + progressBar(sc.overall, color) + '</td>' +
        '<td>' + tarFormatScore(sc.prayer) + '</td><td>' + tarFormatScore(sc.ethics) + '</td><td>' + tarFormatScore(sc.discipline) + '</td>' +
        '<td><span class="tar-badge" style="background:' + color + '20;color:' + color + ';">' + tarFormatScore(sc.overall) + '</span></td></tr>';
    }).join('');
  }

  window.tarRenderStudentRecords = function () { fillPersonSelect('tar-student-select', 'student'); renderPersonTable('tar-students-tbody', 'student'); };
  window.tarRenderStaffRecords = function () { fillPersonSelect('tar-staff-select', 'staff'); renderPersonTable('tar-staff-tbody', 'staff'); };

  window.tarRenderPrayer = function () {
    fillPersonSelect('tar-prayer-person', 'student');
    tarBindDateMax(['tar-prayer-date', 'tar-bulk-prayer-date']);
    var bulkDate = document.getElementById('tar-bulk-prayer-date');
    if (bulkDate && !bulkDate.value) bulkDate.value = todayIso();
    var bulkPanel = document.getElementById('tar-prayer-bulk-panel');
    if (bulkPanel && bulkPanel.style.display !== 'none') window.tarRenderBulkPrayerGrid();
    var tbody = document.getElementById('tar-prayer-tbody');
    if (!tbody) return;
    var f = getFilterValues();
    var rows = deptFilterRecords(window.tarGetPrayer()).filter(function (r) { return matchPerson(r, f); }).slice().reverse().slice(0, 80);
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#94a3b8;">کوئی اندراج نہیں</td></tr>'; return; }
    tbody.innerHTML = rows.map(function (r) {
      var cells = PRAYERS.map(function (p) {
        var st = (r.prayers && r.prayers[p.id]) || '—';
        var lbl = PRAYER_STATUS.find(function (x) { return x.id === st; });
        return '<td>' + esc(lbl ? lbl.label : st) + '</td>';
      }).join('');
      return '<tr><td>' + esc(r.date) + '</td><td>' + esc(r.personName) + '</td><td>' + esc(r.grade || '—') + '</td>' + cells +
        '<td><button class="btn btn-sm btn-outline" onclick="window.tarDeleteRecord(\'prayer\',\'' + r.id + '\')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  };

  function renderEntryTable(key, tbodyId, cols) {
    var tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    var f = getFilterValues();
    var dataFn = { ethics: window.tarGetEthics, discipline: window.tarGetDiscipline, reform: window.tarGetReform, awards: window.tarGetAwards, warnings: window.tarGetWarnings };
    var rows = deptFilterRecords(dataFn[key] ? dataFn[key]() : []).filter(function (r) { return matchPerson(r, f); }).slice().reverse().slice(0, 80);
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="' + cols + '" style="text-align:center;color:#94a3b8;">کوئی اندراج نہیں</td></tr>'; return; }
    return rows;
  }

  window.tarRenderEthics = function () {
    fillPersonSelect('tar-ethics-person', 'student');
    var rows = renderEntryTable('ethics', 'tar-ethics-tbody', 7);
    var tbody = document.getElementById('tar-ethics-tbody');
    if (!rows || !tbody) return;
    tbody.innerHTML = rows.map(function (r) {
      return '<tr><td>' + esc(r.date) + '</td><td>' + esc(r.personName) + '</td><td>' + (r.kind === 'positive' ? '<span style="color:#22c55e;">+</span>' : '<span style="color:#ef4444;">−</span>') + '</td>' +
        '<td>' + esc(r.category) + '</td><td>' + esc(r.note || '—') + '</td><td>' + esc(r.recordedBy || '—') + '</td>' +
        '<td><button class="btn btn-sm btn-outline" onclick="window.tarDeleteRecord(\'ethics\',\'' + r.id + '\')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  };

  window.tarRenderDiscipline = function () {
    fillPersonSelect('tar-disc-person', 'student');
    var rows = renderEntryTable('discipline', 'tar-disc-tbody', 7);
    var tbody = document.getElementById('tar-disc-tbody');
    if (!rows || !tbody) return;
    tbody.innerHTML = rows.map(function (r) {
      return '<tr><td>' + esc(r.date) + '</td><td>' + esc(r.personName) + '</td><td>' + esc(r.type) + '</td><td>' + esc(r.responsible || '—') + '</td>' +
        '<td>' + esc((r.detail || '').slice(0, 40)) + '</td><td>' + esc(r.outcome || '—') + '</td>' +
        '<td><button class="btn btn-sm btn-outline" onclick="window.tarDeleteRecord(\'discipline\',\'' + r.id + '\')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  };

  window.tarRenderReform = function () {
    fillPersonSelect('tar-reform-person', 'student');
    var rows = renderEntryTable('reform', 'tar-reform-tbody', 7);
    var tbody = document.getElementById('tar-reform-tbody');
    if (!rows || !tbody) return;
    tbody.innerHTML = rows.map(function (r) {
      var imp = r.improved === true ? 'ہوئی' : r.improved === false ? 'نہیں' : 'جاری';
      return '<tr><td>' + esc(r.date) + '</td><td>' + esc(r.personName) + '</td><td>' + esc(r.type) + '</td><td>' + esc((r.detail || '').slice(0, 40)) + '</td>' +
        '<td>' + imp + '</td><td>' + esc(r.followUp || '—') + '</td>' +
        '<td><button class="btn btn-sm btn-outline" onclick="window.tarDeleteRecord(\'reform\',\'' + r.id + '\')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  };

  window.tarRenderAwards = function () {
    fillPersonSelect('tar-award-person', 'student');
    var rows = renderEntryTable('awards', 'tar-awards-tbody', 6);
    var tbody = document.getElementById('tar-awards-tbody');
    if (!rows || !tbody) return;
    tbody.innerHTML = rows.map(function (r) {
      return '<tr><td>' + esc(r.date) + '</td><td>' + esc(r.personName) + '</td><td>' + esc(r.type) + '</td><td>' + esc(r.period || '—') + '</td><td>' + esc(r.detail || '—') + '</td>' +
        '<td><button class="btn btn-sm btn-outline" onclick="window.tarDeleteRecord(\'awards\',\'' + r.id + '\')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  };

  window.tarRenderWarnings = function () {
    fillPersonSelect('tar-warn-person', 'student');
    var rows = renderEntryTable('warnings', 'tar-warn-tbody', 6);
    var tbody = document.getElementById('tar-warn-tbody');
    if (!rows || !tbody) return;
    tbody.innerHTML = rows.map(function (r) {
      return '<tr><td>' + esc(r.date) + '</td><td>' + esc(r.personName) + '</td><td>' + esc(r.type) + '</td><td>' + esc(r.severity || '—') + '</td><td>' + esc((r.detail || '').slice(0, 50)) + '</td>' +
        '<td><button class="btn btn-sm btn-outline" onclick="window.tarDeleteRecord(\'warnings\',\'' + r.id + '\')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  };

  window.tarRenderAnalytics = function () {
    var students = getUsers().filter(function (u) { return u.type === 'student'; });
    var f = getFilterValues();
    var byGrade = {};
    students.forEach(function (s) {
      if (f.grade && s.class !== f.grade) return;
      var sc = window.tarComputePersonScore(s.id, f);
      if (!sc.hasScoreData || sc.overall == null) return;
      var g = s.class || 'عمومی';
      if (!byGrade[g]) byGrade[g] = { scores: [], prayer: [] };
      byGrade[g].scores.push(sc.overall);
      if (sc.prayer != null) byGrade[g].prayer.push(sc.prayer);
    });
    var rankings = Object.keys(byGrade).map(function (g) {
      var arr = byGrade[g].scores;
      var prayerArr = byGrade[g].prayer;
      return {
        grade: g,
        avg: arr.length ? Math.round(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length) : null,
        prayer: prayerArr.length ? Math.round(prayerArr.reduce(function (a, b) { return a + b; }, 0) / prayerArr.length) : null,
        count: arr.length
      };
    }).sort(function (a, b) { return (b.avg || 0) - (a.avg || 0); });
    var box = document.getElementById('tar-analytics-rank');
    if (box) {
      box.innerHTML = rankings.length
        ? '<table class="data-table"><thead><tr><th>درجہ</th><th>تربیتی%</th><th>نماز%</th><th>طلبہ</th></tr></thead><tbody>' +
          rankings.map(function (r, i) {
            return '<tr><td>' + (i === 0 ? '🏆 ' : '') + esc(r.grade) + '</td><td>' + tarFormatScore(r.avg) + '</td><td>' + tarFormatScore(r.prayer) + '</td><td>' + r.count + '</td></tr>';
          }).join('') + '</tbody></table>'
        : '<p style="color:#94a3b8;">کوئی اسکور شدہ ڈیٹا نہیں</p>';
    }
    var topBox = document.getElementById('tar-analytics-top');
    if (topBox) {
      var ranked = students.map(function (s) {
        return { u: s, sc: window.tarComputePersonScore(s.id, f) };
      }).filter(function (r) { return r.sc.hasScoreData && r.sc.overall != null; })
        .sort(function (a, b) { return b.sc.overall - a.sc.overall; }).slice(0, 10);
      topBox.innerHTML = ranked.length ? ranked.map(function (r, i) {
        return '<div class="tar-rank-row"><span class="tar-rank-n">' + (i + 1) + '</span><span>' + esc(r.u.name) + '</span><span>' + esc(r.u.class || '—') + '</span><strong>' + tarFormatScore(r.sc.overall) + '</strong></div>';
      }).join('') : '<p style="color:#94a3b8;">کوئی اسکور شدہ طالب علم نہیں</p>';
    }
    var chart = document.getElementById('tar-analytics-chart');
    if (chart) {
      if (rankings.length) {
        chart.innerHTML = barSvg(rankings.slice(0, 6).map(function (r) { return r.grade; }), rankings.slice(0, 6).map(function (r) { return r.avg || 0; }), '#6366f1');
      } else {
        chart.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:20px;">کوئی اسکور شدہ ڈیٹا نہیں</p>';
      }
    }
  };

  window.tarRenderReports = function () {
    var box = document.getElementById('tar-reports-summary');
    if (!box) return;
    var st = window.tarGetDashboardStats();
    box.innerHTML = '<div class="tar-kpi-row">' +
      '<div class="tar-kpi"><span class="v">' + tarFormatScore(st.avgScore) + '</span><span class="l">اوسط تربیتی اسکور</span></div>' +
      '<div class="tar-kpi"><span class="v">' + tarFormatScore(st.avgPrayer) + '</span><span class="l">نماز پابندی</span></div>' +
      '<div class="tar-kpi"><span class="v">' + st.students + '</span><span class="l">طلبہ</span></div>' +
      '<div class="tar-kpi"><span class="v">' + st.alerts + '</span><span class="l">الرٹس</span></div></div>';
  };

  window.tarSavePrayer = function () {
    var sel = document.getElementById('tar-prayer-person');
    var uid = sel ? sel.value : '';
    var user = getUsers().find(function (u) { return u.id === uid; });
    if (!user) return toast('طالب علم منتخب کریں', 'error');
    var date = (document.getElementById('tar-prayer-date') || {}).value || todayIso();
    var dateErr = tarValidateEntryDate(date);
    if (dateErr) return toast(dateErr, 'error');
    var list = window.tarGetPrayer();
    if (list.some(function (r) { return r.personId === uid && r.date === date; })) {
      return toast('اس تاریخ کی نماز کا ریکارڈ پہلے سے موجود ہے', 'error');
    }
    var prayers = {};
    PRAYERS.forEach(function (p) {
      var el = document.getElementById('tar-pr-' + p.id);
      prayers[p.id] = el ? el.value : 'absent';
    });
    var entry = tarCreatePrayerEntry(user, date, prayers);
    list.push(entry);
    writeJson(PRAYER_KEY, list);
    window.tarAudit('create', 'نماز: ' + entry.personName, null, entry);
    toast('نماز محفوظ', 'success');
    window.tarRenderPrayer();
    if (typeof window.tarUpdateDashboardCard === 'function') window.tarUpdateDashboardCard();
  };

  function saveEntry(key, storageKey, getFn, personSelId, buildFn) {
    var sel = document.getElementById(personSelId);
    var uid = sel ? sel.value : '';
    var user = getUsers().find(function (u) { return u.id === uid; });
    if (!user) return toast('فرد منتخب کریں', 'error');
    var entry = buildFn(user, uid);
    var dateErr = tarValidateEntryDate(entry.date);
    if (dateErr) return toast(dateErr, 'error');
    if (typeof window.emsStampDepartment === 'function') window.emsStampDepartment(entry);
    var list = getFn();
    list.push(entry);
    writeJson(storageKey, list);
    window.tarAudit('create', key + ': ' + entry.personName, null, entry);
    toast('محفوظ', 'success');
  }

  window.tarSaveEthics = function () {
    saveEntry('ethics', ETHICS_KEY, window.tarGetEthics, 'tar-ethics-person', function (user, uid) {
      return {
        id: slug('TET'), date: (document.getElementById('tar-ethics-date') || {}).value || todayIso(),
        personId: uid, personType: user.type, personName: user.name || user.fullName, grade: user.class || '',
        kind: (document.getElementById('tar-ethics-kind') || {}).value || 'positive',
        category: (document.getElementById('tar-ethics-cat') || {}).value,
        note: (document.getElementById('tar-ethics-note') || {}).value.trim(),
        recordedBy: (typeof window.sysActorName === 'function') ? window.sysActorName() : 'user',
        timestamp: Date.now()
      };
    });
    window.tarRenderEthics();
  };

  window.tarSaveDiscipline = function () {
    saveEntry('discipline', DISC_KEY, window.tarGetDiscipline, 'tar-disc-person', function (user, uid) {
      return {
        id: slug('TDC'), date: (document.getElementById('tar-disc-date') || {}).value || todayIso(),
        personId: uid, personType: user.type, personName: user.name || user.fullName, grade: user.class || '',
        type: (document.getElementById('tar-disc-type') || {}).value,
        responsible: (document.getElementById('tar-disc-responsible') || {}).value.trim(),
        detail: (document.getElementById('tar-disc-detail') || {}).value.trim(),
        outcome: (document.getElementById('tar-disc-outcome') || {}).value.trim(),
        timestamp: Date.now()
      };
    });
    window.tarRenderDiscipline();
  };

  window.tarSaveReform = function () {
    saveEntry('reform', REFORM_KEY, window.tarGetReform, 'tar-reform-person', function (user, uid) {
      var imp = (document.getElementById('tar-reform-improved') || {}).value;
      return {
        id: slug('TRF'), date: (document.getElementById('tar-reform-date') || {}).value || todayIso(),
        personId: uid, personType: user.type, personName: user.name || user.fullName, grade: user.class || '',
        type: (document.getElementById('tar-reform-type') || {}).value,
        detail: (document.getElementById('tar-reform-detail') || {}).value.trim(),
        improved: imp === 'yes' ? true : imp === 'no' ? false : null,
        followUp: (document.getElementById('tar-reform-follow') || {}).value.trim(),
        timestamp: Date.now()
      };
    });
    window.tarRenderReform();
  };

  window.tarSaveAward = function () {
    saveEntry('awards', AWARD_KEY, window.tarGetAwards, 'tar-award-person', function (user, uid) {
      return {
        id: slug('TAW'), date: (document.getElementById('tar-award-date') || {}).value || todayIso(),
        personId: uid, personType: user.type, personName: user.name || user.fullName, grade: user.class || '',
        type: (document.getElementById('tar-award-type') || {}).value,
        period: (document.getElementById('tar-award-period') || {}).value,
        detail: (document.getElementById('tar-award-detail') || {}).value.trim(),
        timestamp: Date.now()
      };
    });
    window.tarRenderAwards();
  };

  window.tarSaveWarning = function () {
    saveEntry('warnings', WARN_KEY, window.tarGetWarnings, 'tar-warn-person', function (user, uid) {
      return {
        id: slug('TWN'), date: (document.getElementById('tar-warn-date') || {}).value || todayIso(),
        personId: uid, personType: user.type, personName: user.name || user.fullName, grade: user.class || '',
        type: (document.getElementById('tar-warn-type') || {}).value.trim(),
        severity: (document.getElementById('tar-warn-severity') || {}).value,
        detail: (document.getElementById('tar-warn-detail') || {}).value.trim(),
        timestamp: Date.now()
      };
    });
    window.tarRenderWarnings();
  };

  window.tarDeleteRecord = function (kind, id) {
    if (!confirm('حذف کریں؟')) return;
    var map = {
      prayer: [PRAYER_KEY, window.tarGetPrayer, window.tarRenderPrayer],
      ethics: [ETHICS_KEY, window.tarGetEthics, window.tarRenderEthics],
      discipline: [DISC_KEY, window.tarGetDiscipline, window.tarRenderDiscipline],
      reform: [REFORM_KEY, window.tarGetReform, window.tarRenderReform],
      awards: [AWARD_KEY, window.tarGetAwards, window.tarRenderAwards],
      warnings: [WARN_KEY, window.tarGetWarnings, window.tarRenderWarnings]
    };
    var m = map[kind];
    if (!m) return;
    writeJson(m[0], m[1]().filter(function (r) { return r.id !== id; }));
    window.tarAudit('delete', kind + ' ' + id, { id: id }, null);
    m[2]();
  };

  window.tarDrillPerson = function (personId) {
    if (typeof window.emsDrillOpen !== 'function') return;
    var u = getUsers().find(function (x) { return x.id === personId; });
    if (!u) return;
    var sc = window.tarComputePersonScore(personId);
    window.emsDrillOpen({
      title: '<i class="fas fa-user-graduate"></i> ' + esc(u.name || u.id),
      crumb: u.name || u.id,
      render: function (g, b) {
        g.innerHTML = '<div class="tar-kpi-row">' +
          '<div class="tar-kpi"><span class="v">' + tarFormatScore(sc.overall) + '</span><span class="l">مجموعی</span></div>' +
          '<div class="tar-kpi"><span class="v">' + tarFormatScore(sc.prayer) + '</span><span class="l">نماز</span></div>' +
          '<div class="tar-kpi"><span class="v">' + tarFormatScore(sc.ethics) + '</span><span class="l">اخلاق</span></div>' +
          '<div class="tar-kpi"><span class="v">' + tarFormatScore(sc.discipline) + '</span><span class="l">نظم</span></div></div>';
        var prayer = window.tarGetPrayer().filter(function (p) { return p.personId === personId; }).slice(-5).reverse();
        b.innerHTML = '<h4>حالیہ نماز</h4><table class="data-table"><thead><tr><th>تاریخ</th>' +
          PRAYERS.map(function (p) { return '<th>' + p.label + '</th>'; }).join('') + '</tr></thead><tbody>' +
          (prayer.length ? prayer.map(function (r) {
            return '<tr><td>' + r.date + '</td>' + PRAYERS.map(function (p) {
              var st = PRAYER_STATUS.find(function (x) { return x.id === ((r.prayers && r.prayers[p.id]) || ''); });
              return '<td>' + esc(st ? st.label : '—') + '</td>';
            }).join('') + '</tr>';
          }).join('') : '<tr><td colspan="6">—</td></tr>') + '</tbody></table>';
      }
    });
  };

  window.tarExportReport = function (fmt) {
    var students = getUsers().filter(function (u) { return u.type === 'student'; });
    var rows = [['ID', 'نام', 'درجہ', 'مجموعی%', 'نماز%', 'اخلاق%', 'نظم%']];
    students.forEach(function (s) {
      var sc = window.tarComputePersonScore(s.id);
      rows.push([
        s.id, s.name, s.class || '',
        sc.hasScoreData ? (sc.overall != null ? sc.overall : '—') : '—',
        sc.prayer != null ? sc.prayer : '—',
        sc.ethics != null ? sc.ethics : '—',
        sc.discipline != null ? sc.discipline : '—'
      ]);
    });
    if (fmt === 'excel' || fmt === 'csv') {
      if (typeof XLSX !== 'undefined') {
        var ws = XLSX.utils.aoa_to_sheet(rows);
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Training');
        XLSX.writeFile(wb, 'tarbiyat-report.xlsx');
      } else {
        var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
        var a = document.createElement('a');
        a.href = 'data:text/csv;charset=utf-8,\ufeff' + encodeURIComponent(csv);
        a.download = 'tarbiyat-report.csv';
        a.click();
      }
      return;
    }
    var html = '<html dir="rtl"><head><meta charset="utf-8"><title>تربیت و نظم</title><style>table{width:100%;border-collapse:collapse}td,th{border:1px solid #333;padding:6px;font-size:12px}</style></head><body><h2 style="text-align:center">تربیت و نظم رپورٹ</h2><table><thead><tr>' +
      rows[0].map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.slice(1).map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></body></html>';
    var w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  };

  window.tarUpdateDashboardCard = function () {
    var st = window.tarGetDashboardStats();
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.innerText = v; };
    set('dash-tar-score', tarFormatScore(st.avgScore));
    set('dash-tar-prayer', tarFormatScore(st.avgPrayer));
    set('dash-tar-top', st.topScore != null ? (st.topStudent || '—').toString().slice(0, 12) : '—');
    set('dash-tar-alerts', st.alerts);
    var chart = document.getElementById('chart-training');
    if (chart) {
      chart.innerHTML = pieCountSvg(
        [Math.max(0, st.avgScore || 0), Math.max(0, st.avgPrayer || 0)],
        ['#0d9488', '#6366f1'],
        st.scoredStudents || 0
      );
    }
  };

  window.tarOpenFromDashboard = function (subTab) {
    var tab = document.getElementById('tab-training');
    if (tab) tab.click();
    setTimeout(function () {
      var resolved = tarResolveTabForRole(subTab || tarGetDefaultTabId());
      var btn = document.querySelector('#tar-ribbon-menu .reg-tab[onclick*="' + resolved + '"]');
      window.switchTarTab(resolved, btn);
    }, 200);
  };

  window.tarApplyFilters = function () {
    var tab = document.querySelector('#tar-ribbon-menu .reg-tab.active-sub-tab');
    if (tab && tab.style.display !== 'none') tab.click();
    else window.switchTarTab(tarGetDefaultTabId(), document.querySelector('#tar-ribbon-menu .reg-tab[onclick*="' + tarGetDefaultTabId() + '"]'));
  };

  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest('#tar-btn-save-prayer')) window.tarSavePrayer();
    if (e.target && e.target.closest('#tar-btn-save-bulk-prayer')) window.tarSaveBulkPrayer();
    if (e.target && e.target.closest('#tar-btn-mode-single')) window.tarSetPrayerEntryMode('single');
    if (e.target && e.target.closest('#tar-btn-mode-bulk')) window.tarSetPrayerEntryMode('bulk');
    if (e.target && e.target.closest('#tar-btn-save-settings')) window.tarSaveSettingsForm();
    if (e.target && e.target.closest('#tar-btn-save-ethics')) window.tarSaveEthics();
    if (e.target && e.target.closest('#tar-btn-save-disc')) window.tarSaveDiscipline();
    if (e.target && e.target.closest('#tar-btn-save-reform')) window.tarSaveReform();
    if (e.target && e.target.closest('#tar-btn-save-award')) window.tarSaveAward();
    if (e.target && e.target.closest('#tar-btn-save-warn')) window.tarSaveWarning();
    if (e.target && e.target.closest('#tar-btn-export-print')) window.tarExportReport('print');
    if (e.target && e.target.closest('#tar-btn-export-excel')) window.tarExportReport('excel');
  });

  document.addEventListener('input', function (e) {
    if (!e.target) return;
    var id = e.target.id || '';
    if (id.indexOf('tar-set-weight-') === 0) window.tarUpdateWeightSumHint();
  });

  if (typeof window.emsRegisterDepartmentRefresh === 'function') {
    window.emsRegisterDepartmentRefresh('training', function () {
      tarApplyRoleUi();
      var tab = document.querySelector('#tar-ribbon-menu .reg-tab.active-sub-tab');
      if (tab && tab.style.display !== 'none' && typeof tab.click === 'function') tab.click();
      else window.switchTarTab(tarGetDefaultTabId(), document.querySelector('#tar-ribbon-menu .reg-tab[onclick*="' + tarGetDefaultTabId() + '"]'));
      if (typeof window.tarUpdateDashboardCard === 'function') window.tarUpdateDashboardCard();
    });
  }

})();
