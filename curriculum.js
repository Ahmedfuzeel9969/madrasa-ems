// ================= شعبۂ نصاب — Curriculum Management & Monitoring =================
(function () {
  'use strict';

  var PLANS_KEY = 'ems_curriculum_plans';
  var DAILY_KEY = 'ems_curriculum_daily';
  var SETTINGS_KEY = 'ems_curriculum_settings';
  var AUDIT_KEY = 'ems_curriculum_audit';
  var LIB_KEY = 'ems_library_books';

  var ISLAMIC_MONTHS = [
    { id: 'shawwal', label: 'شوال' }, { id: 'dhu_qidah', label: 'ذوالقعدہ' },
    { id: 'dhu_hijjah', label: 'ذوالحجہ' }, { id: 'muharram', label: 'محرم' },
    { id: 'safar', label: 'صفر' }, { id: 'rabi1', label: 'ربیع الاول' },
    { id: 'rabi2', label: 'ربیع الآخر' }, { id: 'jumada1', label: 'جمادی الاولیٰ' },
    { id: 'jumada2', label: 'جمادی الآخرہ' }, { id: 'rajab', label: 'رجب' },
    { id: 'shaban', label: 'شعبان' }, { id: 'ramadan', label: 'رمضان' }
  ];

  function readJson(key, fb) {
    try { return JSON.parse(localStorage.getItem(key) || (fb != null ? JSON.stringify(fb) : 'null')); }
    catch (e) { return fb; }
  }

  /** مرکزی کتب خانہ — same durable SSOT as Exams / Attendance (not localStorage-only). */
  function curReadLibraryBooks() {
    if (typeof window.attReadLibraryBooks === 'function') {
      try {
        var fromAtt = window.attReadLibraryBooks();
        if (Array.isArray(fromAtt)) return fromAtt;
      } catch (eAtt) { /* fall through */ }
    }
    var books = [];
    try {
      if (typeof window.emsCacheGetRaw === 'function') {
        var cached = window.emsCacheGetRaw(LIB_KEY);
        if (cached) {
          var parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) books = parsed;
        }
      }
    } catch (eCache) { /* ignore */ }
    if (!books.length && typeof window.emsDurableReadRaw === 'function') {
      try {
        var raw = window.emsDurableReadRaw(LIB_KEY);
        if (raw) {
          var parsedDurable = JSON.parse(raw);
          if (Array.isArray(parsedDurable)) books = parsedDurable;
        }
      } catch (eDurable) { /* ignore */ }
    }
    if (!books.length) {
      try {
        var ls = JSON.parse(localStorage.getItem(LIB_KEY) || '[]');
        if (Array.isArray(ls)) books = ls;
      } catch (eLs) { /* ignore */ }
    }
    return books
      .map(function (b) {
        if (typeof b === 'string') return String(b).trim();
        if (b && typeof b === 'object') return String(b.name || b.title || '').trim();
        return '';
      })
      .filter(Boolean);
  }

  function writeJson(key, val, opts) {
    opts = opts || {};
    if (!opts.skipStaffGate && typeof window.emsRequireStaffAction === 'function') {
      if (!window.emsRequireStaffAction('curriculum', 'edit')) return Promise.resolve({ blocked: true });
    }
    var options = Object.assign({ mutation: true, autoDelta: true }, opts || {});
    delete options.skipStaffGate;
    if (window.emsSaveModuleData) return window.emsSaveModuleData(key, typeof val === 'string' ? val : JSON.stringify(val), options);
    localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
    return Promise.resolve();
  }

  /** Sync module JSON read — cache → durable memory → localStorage (blob keys leave LS empty). */
  function curReadModuleJson(key, fb) {
    var raw = null;
    try {
      if (typeof window.emsCacheGetRaw === 'function') {
        raw = window.emsCacheGetRaw(key);
      }
    } catch (eCache) { /* ignore */ }
    if ((raw == null || raw === '') && typeof window.emsDurableReadRaw === 'function') {
      try { raw = window.emsDurableReadRaw(key); } catch (eDur) { /* ignore */ }
    }
    if (raw == null || raw === '') {
      try { raw = localStorage.getItem(key); } catch (eLs) { /* ignore */ }
    }
    if (raw == null || raw === '') return fb;
    try {
      var parsed = JSON.parse(raw);
      return parsed == null ? fb : parsed;
    } catch (eParse) {
      return fb;
    }
  }

  function curPersistPlans(plans) {
    var str = JSON.stringify(Array.isArray(plans) ? plans : []);
    if (typeof window.emsDurableWriteRaw === 'function') {
      try { window.emsDurableWriteRaw(PLANS_KEY, str); } catch (eW) { /* ignore */ }
    } else {
      try { localStorage.setItem(PLANS_KEY, str); } catch (eLs) { /* ignore */ }
    }
    if (typeof window.emsCacheInvalidate === 'function') {
      try { window.emsCacheInvalidate(PLANS_KEY); } catch (eInv) { /* ignore */ }
    }
    return writeJson(PLANS_KEY, plans, { skipStaffGate: true });
  }

  /** Ensure library + plans blobs are loaded from IndexedDB into memory before sync/UI. */
  function curEnsureLibraryReady() {
    var keys = [LIB_KEY, PLANS_KEY];
    return keys.reduce(function (chain, key) {
      return chain.then(function () {
        if (typeof window.emsDurableEnsureKey === 'function') {
          return window.emsDurableEnsureKey(key);
        }
      });
    }, Promise.resolve()).then(function () {
      /* Drop stale sync-cache so reads prefer freshly hydrated durable memory. */
      if (typeof window.emsCacheInvalidate === 'function') {
        keys.forEach(function (key) {
          try { window.emsCacheInvalidate(key); } catch (eInv) { /* ignore */ }
        });
      }
    });
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'success');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function slugId(prefix, name) {
    return prefix + '-' + String(name || '').replace(/\s+/g, '_').replace(/[^\w\u0600-\u06FF-]/g, '').slice(0, 40) + '-' + Date.now().toString(36);
  }

  function defaultMonthSlots() {
    return ISLAMIC_MONTHS.map(function (m) {
      return { id: m.id, label: m.label, fromPage: null, toPage: null, fromLine: null, toLine: null };
    });
  }

  function defaultPlan(bookName, opts) {
    opts = opts || {};
    var p = {
      id: slugId('CUR', bookName),
      bookName: bookName,
      grade: '',
      totalPages: 0,
      teachablePages: 0,
      teachableLines: 0,
      linesPerPage: 15,
      excludedPages: '',
      excludedSections: '',
      measureMode: 'lines',
      annual: { fromPage: 1, toPage: 0, fromLine: 1, toLine: 0 },
      half1: { fromPage: 1, toPage: 0, fromLine: 1, toLine: 0 },
      half2: { fromPage: 1, toPage: 0, fromLine: 1, toLine: 0 },
      months: defaultMonthSlots(),
      examLink: { half1: '', half2: '', quarterly: '', annual: '' },
      updatedAt: Date.now(),
      fromCentralLibrary: !!opts.fromCentralLibrary
    };
    if (opts.fromCentralLibrary) {
      /* مرکزی کتب خانہ ادارہ-واسع — ہر شعبے میں نظر آئے */
      p.departmentId = (typeof window.EMS_DEPARTMENT_ALL !== 'undefined')
        ? window.EMS_DEPARTMENT_ALL
        : 'all';
    } else if (typeof window.emsStampDepartment === 'function') {
      window.emsStampDepartment(p);
    }
    return p;
  }

  function parsePageExclusions(spec) {
    var set = Object.create(null);
    if (!spec || !String(spec).trim()) return set;
    String(spec).split(/[,،;]+/).forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var rangeIdx = part.indexOf('-');
      if (rangeIdx > 0) {
        var a = parseInt(part.slice(0, rangeIdx), 10);
        var b = parseInt(part.slice(rangeIdx + 1), 10);
        if (!isNaN(a) && !isNaN(b)) {
          var lo = Math.min(a, b);
          var hi = Math.max(a, b);
          for (var pg = lo; pg <= hi; pg++) set[pg] = true;
        }
      } else {
        var n = parseInt(part, 10);
        if (!isNaN(n) && n > 0) set[n] = true;
      }
    });
    return set;
  }

  function getExcludedPageSet(plan) {
    var set = Object.create(null);
    var a = parsePageExclusions(plan && plan.excludedPages);
    var b = parsePageExclusions(plan && plan.excludedSections);
    Object.keys(a).forEach(function (k) { set[k] = true; });
    Object.keys(b).forEach(function (k) { set[k] = true; });
    return set;
  }

  function isPageExcluded(plan, pageNum) {
    pageNum = Number(pageNum) || 0;
    if (pageNum < 1) return false;
    return !!getExcludedPageSet(plan)[pageNum];
  }

  function countExcludedPagesUpTo(plan, maxPage) {
    maxPage = Number(maxPage) || 0;
    if (maxPage < 1) return 0;
    var set = getExcludedPageSet(plan);
    var n = 0;
    Object.keys(set).forEach(function (k) {
      if (Number(k) <= maxPage) n++;
    });
    return n;
  }

  function getDeptPlans() {
    var plans = window.curGetPlans();
    var libSet = Object.create(null);
    try {
      curReadLibraryBooks().forEach(function (n) {
        var name = String(n || '').trim();
        if (name) libSet[name] = true;
      });
    } catch (eLib) { /* ignore */ }
    if (typeof window.emsFilterByDepartment !== 'function') return plans;
    return plans.filter(function (p) {
      var bn = String((p && p.bookName) || '').trim();
      /* Library books are institution-wide — never hide by department filter. */
      if (bn && libSet[bn]) return true;
      if (p && (p.fromCentralLibrary || p.departmentId === 'all'
          || (typeof window.EMS_DEPARTMENT_ALL !== 'undefined' && p.departmentId === window.EMS_DEPARTMENT_ALL))) {
        return true;
      }
      return window.emsRecordMatchesDepartment(p);
    });
  }

  window.curGetSettings = function () {
    var s = curReadModuleJson(SETTINGS_KEY, null);
    var y = new Date().getFullYear();
    if (!s) s = { measureMode: 'lines', academicYear: y + '-' + (y + 1), yellowPct: 5, redPct: 15, yearStart: y + '-07-01', yearEnd: (y + 1) + '-06-30' };
    if (!s.yearStart) s.yearStart = y + '-07-01';
    if (!s.yearEnd) s.yearEnd = (y + 1) + '-06-30';
    return s;
  };

  window.curSaveSettings = function (s) {
    writeJson(SETTINGS_KEY, s);
  };

  window.curGetPlans = function () {
    var plans = curReadModuleJson(PLANS_KEY, []);
    return Array.isArray(plans) ? plans : [];
  };

  window.curGetDaily = function () {
    var daily = curReadModuleJson(DAILY_KEY, []);
    return Array.isArray(daily) ? daily : [];
  };

  window.curAudit = function (action, summary, before, after) {
    var logs = readJson(AUDIT_KEY, []) || [];
    logs.push({
      id: 'CUR-A-' + Date.now(),
      timestamp: Date.now(),
      user: (typeof window.sysActorName === 'function') ? window.sysActorName() : 'user',
      action: action,
      summary: summary,
      before: before ? JSON.parse(JSON.stringify(before)) : null,
      after: after ? JSON.parse(JSON.stringify(after)) : null
    });
    if (logs.length > 3000) logs = logs.slice(-3000);
    writeJson(AUDIT_KEY, logs);
  };

  window.curSyncFromLibrary = function () {
    var lib = curReadLibraryBooks();
    var names = [];
    var seen = {};
    lib.forEach(function (b) {
      var name = typeof b === 'string' ? String(b).trim() : String((b && (b.name || b.title)) || '').trim();
      if (!name) return;
      var key = name.toLocaleLowerCase ? name.toLocaleLowerCase('ur') : name.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      names.push(name);
    });
    var plans = window.curGetPlans().slice();
    var added = 0;
    var promoted = 0;
    names.forEach(function (name) {
      var existing = null;
      for (var i = 0; i < plans.length; i++) {
        if (String(plans[i].bookName || '').trim() === name) {
          existing = plans[i];
          break;
        }
      }
      if (!existing) {
        plans.push(defaultPlan(name, { fromCentralLibrary: true }));
        added++;
        return;
      }
      /* Promote older plans so department filter does not hide central library books */
      if (!existing.fromCentralLibrary
          || (existing.departmentId && existing.departmentId !== 'all'
            && existing.departmentId !== window.EMS_DEPARTMENT_ALL)) {
        existing.fromCentralLibrary = true;
        existing.departmentId = (typeof window.EMS_DEPARTMENT_ALL !== 'undefined')
          ? window.EMS_DEPARTMENT_ALL
          : 'all';
        existing.updatedAt = Date.now();
        promoted++;
      }
    });
    if (added || promoted) {
      curPersistPlans(plans);
      if (added) {
        window.curAudit('sync', 'مرکزی کتب خانہ سے ' + added + ' کتابیں', null, { added: added, promoted: promoted });
      }
    }
    return { added: added, promoted: promoted, total: names.length, plans: plans.length };
  };

  window.curReadLibraryBooks = curReadLibraryBooks;
  window.curEnsureLibraryReady = curEnsureLibraryReady;

  function positionToUnits(plan, page, line) {
    page = Number(page) || 0;
    line = Number(line) || 0;
    var lpp = Number(plan.linesPerPage) || 15;
    if (plan.measureMode === 'pages') return page;
    if (plan.measureMode === 'both') return page * lpp + line;
    return (page - 1) * lpp + line;
  }

  function teachableUnitsBetween(plan, fromPage, fromLine, toPage, toLine) {
    fromPage = Number(fromPage) || 1;
    fromLine = Number(fromLine) || 1;
    toPage = Number(toPage) || 0;
    toLine = Number(toLine) || 0;
    if (!toPage || toPage < fromPage || (toPage === fromPage && toLine < fromLine)) return 0;

    var lpp = Number(plan.linesPerPage) || 15;
    var mode = plan.measureMode || 'lines';
    var total = 0;

    if (mode === 'both') {
      var raw = Math.max(0, positionToUnits(plan, toPage, toLine) - positionToUnits(plan, fromPage, fromLine));
      for (var bp = fromPage; bp <= toPage; bp++) {
        if (isPageExcluded(plan, bp)) raw -= lpp;
      }
      return Math.max(0, raw);
    }

    for (var p = fromPage; p <= toPage; p++) {
      if (isPageExcluded(plan, p)) continue;
      var lineStart = (p === fromPage) ? fromLine : 1;
      var lineEnd = (p === toPage) ? toLine : lpp;
      if (lineEnd < lineStart) continue;
      if (mode === 'pages') total += 1;
      else total += (lineEnd - lineStart + 1);
    }
    return total;
  }

  function scopeUnits(plan, scope) {
    if (!scope) return 0;
    return teachableUnitsBetween(
      plan,
      scope.fromPage || 1,
      scope.fromLine || 1,
      scope.toPage,
      scope.toLine || 1
    );
  }

  function totalScopeUnits(plan) {
    var ann = plan.annual || {};
    if (ann.toPage) {
      return teachableUnitsBetween(plan, ann.fromPage || 1, ann.fromLine || 1, ann.toPage, ann.toLine || 1) || 1;
    }
    var lpp = Number(plan.linesPerPage) || 15;
    var totalPages = Number(plan.totalPages) || 0;
    var excludedCount = countExcludedPagesUpTo(plan, totalPages);
    var teachPages = Number(plan.teachablePages) || Math.max(0, totalPages - excludedCount);
    if (Number(plan.teachableLines) > 0) return Number(plan.teachableLines);
    if (plan.measureMode === 'pages') return teachPages || 1;
    return (teachPages * lpp) || 1;
  }

  function annualScopeStart(plan) {
    var ann = plan.annual || {};
    return { page: ann.fromPage || 1, line: ann.fromLine || 1 };
  }

  function progressUnitsInScope(plan, page, line) {
    var start = annualScopeStart(plan);
    return teachableUnitsBetween(plan, start.page, start.line, page, line);
  }

  function hasMonthPacing(plan) {
    return (plan.months || []).some(function (m) { return m && Number(m.toPage) > 0; });
  }

  function monthCumulativeTargets(plan) {
    var start = annualScopeStart(plan);
    var months = plan.months || [];
    var targets = [];
    var last = 0;
    for (var i = 0; i < 12; i++) {
      var m = months[i];
      if (m && Number(m.toPage) > 0) {
        last = Math.max(last, teachableUnitsBetween(
          plan,
          start.page,
          start.line,
          m.toPage,
          m.toLine || 1
        ));
      }
      targets.push(last);
    }
    return targets;
  }

  function expectedUnitsLinear(plan, dateStr, yearStart, yearEnd, total) {
    var startMs = new Date(yearStart).getTime();
    var endMs = new Date(yearEnd).getTime();
    var curMs = new Date(dateStr).getTime();
    var ratio = (curMs - startMs) / Math.max(1, endMs - startMs);
    return Math.round(total * Math.min(1, Math.max(0, ratio)));
  }

  function expectedUnitsByDate(plan, dateStr) {
    dateStr = dateStr || new Date().toISOString().split('T')[0];
    var settings = window.curGetSettings();
    var yearStart = settings.yearStart || (new Date().getFullYear() + '-07-01');
    var yearEnd = settings.yearEnd || (new Date().getFullYear() + 1 + '-06-30');
    var total = totalScopeUnits(plan);
    if (dateStr < yearStart) return 0;
    if (dateStr > yearEnd) return total;
    if (!hasMonthPacing(plan)) {
      return expectedUnitsLinear(plan, dateStr, yearStart, yearEnd, total);
    }

    var startMs = new Date(yearStart).getTime();
    var endMs = new Date(yearEnd).getTime();
    var curMs = new Date(dateStr).getTime();
    var monthLen = (endMs - startMs) / 12;
    var monthIdx = Math.min(11, Math.max(0, Math.floor((curMs - startMs) / Math.max(1, monthLen))));
    var monthStartMs = startMs + monthIdx * monthLen;
    var monthEndMs = startMs + (monthIdx + 1) * monthLen;
    var targets = monthCumulativeTargets(plan);
    var prev = monthIdx > 0 ? targets[monthIdx - 1] : 0;
    var target = Math.min(total, Math.max(prev, targets[monthIdx] || total));

    if (curMs <= monthStartMs) return prev;
    if (curMs >= monthEndMs) return target;
    var ratio = (curMs - monthStartMs) / Math.max(1, monthEndMs - monthStartMs);
    return Math.round(prev + ratio * (target - prev));
  }

  function getLatestProgress(plan, daily, teacherId) {
    var rows = daily.filter(function (d) { return d.bookId === plan.id || d.bookName === plan.bookName; });
    if (teacherId) rows = rows.filter(function (d) { return d.teacherId === teacherId; });
    if (!rows.length) return { page: 0, line: 0, date: null, units: 0 };
    rows.sort(function (a, b) { return (b.date || '').localeCompare(a.date || '') || (b.timestamp || 0) - (a.timestamp || 0); });
    var last = rows[0];
    return {
      page: last.page,
      line: last.line,
      date: last.date,
      units: progressUnitsInScope(plan, last.page, last.line)
    };
  }

  window.curComputeStatus = function (plan, daily, teacherId, dateStr) {
    var prog = getLatestProgress(plan, daily, teacherId);
    var expected = expectedUnitsByDate(plan, dateStr);
    var total = totalScopeUnits(plan);
    var actual = prog.units;
    var pct = total ? curClampPct((actual / total) * 100) : 0;
    var expPct = total ? curClampPct((expected / total) * 100) : 0;
    var gap = expPct - pct;
    var settings = window.curGetSettings();
    var status = 'green';
    if (gap > (settings.redPct || 15)) status = 'red';
    else if (gap > (settings.yellowPct || 5)) status = 'yellow';
    return {
      status: status,
      pct: pct,
      expectedPct: expPct,
      gap: gap,
      remaining: Math.max(0, total - actual),
      completed: actual,
      total: total,
      progress: prog
    };
  };

  window.curGetExamScope = function (bookName, term) {
    var plan = window.curGetPlans().find(function (p) { return p.bookName === bookName; });
    if (!plan) return null;
    term = term || 'annual';
    var scope;
    if (term === 'half1') scope = plan.half1;
    else if (term === 'half2') scope = plan.half2;
    else if (term === 'quarterly') scope = plan.quarterly || plan.half1;
    else scope = plan.annual;
    return {
      bookName: plan.bookName,
      grade: plan.grade,
      scope: scope,
      examNote: (plan.examLink && plan.examLink[term]) || ''
    };
  };

  window.curGetDashboardStats = function () {
    var settings = window.curGetSettings();
    var yearKey = settings.academicYear;
    var summary = typeof window.emsGetCurriculumSummary === 'function'
      ? window.emsGetCurriculumSummary(yearKey) : null;
    if (!curIsTeacherOnly() && summary && summary.version >= 1) {
      return {
        books: summary.books,
        green: summary.green,
        yellow: summary.yellow,
        red: summary.red,
        avgPct: summary.avgPct
      };
    }

    window.curSyncFromLibrary();
    var plans = getDeptPlans();
    var daily = curGetScopedDaily();
    var teacherIds = {};
    getTeachers().forEach(function (t) { teacherIds[t.id] = true; });
    daily = daily.filter(function (d) { return teacherIds[d.teacherId]; });
    var teacherId = curScopedTeacherId();
    var green = 0, yellow = 0, red = 0;
    plans.forEach(function (p) {
      var st = window.curComputeStatus(p, daily, teacherId);
      if (st.status === 'green') green++;
      else if (st.status === 'yellow') yellow++;
      else red++;
    });
    var avg = plans.length ? Math.round(plans.reduce(function (s, p) {
      return s + window.curComputeStatus(p, daily, teacherId).pct;
    }, 0) / plans.length) : 0;
    return { books: plans.length, green: green, yellow: yellow, red: red, avgPct: avg };
  };

  function getTeachers() {
    try {
      var all = typeof window.emsGetUsersSync === 'function'
        ? window.emsGetUsersSync()
        : (typeof window.emsGetUsersMerged === 'function' ? window.emsGetUsersMerged() : []);
      var list = all.filter(function (u) {
        return u && u.type === 'teacher';
      });
      if (typeof window.emsFilterByDepartment === 'function') {
        return window.emsFilterByDepartment(list);
      }
      return list;
    } catch (e) { return []; }
  }

  var CUR_ADMIN_TABS = ['cur-win-plan', 'cur-win-settings', 'cur-win-compare'];

  function curIsCurriculumAdmin() {
    if (typeof window.isSuperAdmin === 'function' && window.isSuperAdmin()) return true;
    if (typeof window.isMadrasaAdmin === 'function' && window.isMadrasaAdmin()) return true;
    return false;
  }

  function curIsTeacherOnly() {
    if (curIsCurriculumAdmin()) return false;
    return !!(typeof window.emsIsStaffUser === 'function' && window.emsIsStaffUser());
  }

  function curGetCurrentTeacherRecord() {
    if (!curIsTeacherOnly()) return null;
    var staff = typeof window.emsGetStaffRecordForCurrentUser === 'function'
      ? window.emsGetStaffRecordForCurrentUser() : null;
    if (!staff) return null;
    var teachers = getTeachers();
    var byId = teachers.find(function (t) { return t.id === staff.id; });
    if (byId) return byId;
    var email = (staff.email || staff.gmail || '').toLowerCase();
    if (email) {
      var byEmail = teachers.find(function (t) {
        return ((t.email || t.gmail || '').toLowerCase() === email);
      });
      if (byEmail) return byEmail;
    }
    return staff;
  }

  function curGetCurrentTeacherId() {
    var t = curGetCurrentTeacherRecord();
    return t ? t.id : null;
  }

  function curGetScopedDaily() {
    var daily = window.curGetDaily();
    if (!curIsTeacherOnly()) return daily;
    var tid = curGetCurrentTeacherId();
    return tid ? daily.filter(function (d) { return d.teacherId === tid; }) : [];
  }

  function curScopedTeacherId() {
    return curIsTeacherOnly() ? curGetCurrentTeacherId() : null;
  }

  function curApplyRoleUi() {
    var isTeacher = curIsTeacherOnly();
    document.querySelectorAll('#cur-ribbon-menu .reg-tab').forEach(function (btn) {
      var onclick = btn.getAttribute('onclick') || '';
      var isAdminTab = CUR_ADMIN_TABS.some(function (tab) { return onclick.indexOf(tab) !== -1; });
      btn.style.display = (isTeacher && isAdminTab) ? 'none' : '';
    });
  }

  function curResolveTabForRole(tabId) {
    if (curIsTeacherOnly() && CUR_ADMIN_TABS.indexOf(tabId) >= 0) return 'cur-win-daily';
    return tabId;
  }

  function curTabButton(tabId) {
    return document.querySelector('#cur-ribbon-menu .reg-tab[onclick*="' + tabId + '"]');
  }

  function curClampPct(n) {
    return Math.min(100, Math.max(0, Math.round(Number(n) || 0)));
  }

  function curTodayStr() {
    return new Date().toISOString().split('T')[0];
  }

  function curNormPageLine(val, fallback) {
    var n = Math.floor(Number(val));
    if (isNaN(n) || n < 1) return fallback != null ? fallback : 1;
    return n;
  }

  function curNormNonNegInt(val, fallback) {
    var n = Math.floor(Number(val));
    if (isNaN(n) || n < 0) return fallback != null ? fallback : 0;
    return n;
  }

  function curScopePairValid(fromPage, fromLine, toPage, toLine) {
    fromPage = curNormNonNegInt(fromPage, 0);
    toPage = curNormNonNegInt(toPage, 0);
    fromLine = curNormNonNegInt(fromLine, 0);
    toLine = curNormNonNegInt(toLine, 0);
    if (!toPage) return true;
    if (!fromPage) fromPage = 1;
    if (toPage < fromPage) return false;
    if (toPage === fromPage && toLine && fromLine && toLine < fromLine) return false;
    return true;
  }

  function curValidatePlan(p) {
    if (!p) return 'کتاب منتخب کریں';
    p.totalPages = curNormNonNegInt(p.totalPages, 0);
    p.teachablePages = curNormNonNegInt(p.teachablePages, 0);
    p.teachableLines = curNormNonNegInt(p.teachableLines, 0);
    p.linesPerPage = Math.max(1, curNormPageLine(p.linesPerPage, 15));
    if (p.teachablePages && p.totalPages && p.teachablePages > p.totalPages) {
      return 'قابلِ تدریس صفحات کل صفحات سے زیادہ نہیں ہو سکتے';
    }
    var scopes = ['annual', 'half1', 'half2'];
    for (var si = 0; si < scopes.length; si++) {
      var sc = p[scopes[si]] || {};
      if (!curScopePairValid(sc.fromPage, sc.fromLine, sc.toPage, sc.toLine)) {
        return scopes[si] + ' نصاب: "صفحہ تا" "صفحہ از" سے کم نہیں ہو سکتا';
      }
    }
    var months = p.months || [];
    for (var mi = 0; mi < months.length; mi++) {
      var m = months[mi];
      if (!m) continue;
      var mfp = m.fromPage != null ? curNormNonNegInt(m.fromPage, 0) : 0;
      var mtp = m.toPage != null ? curNormNonNegInt(m.toPage, 0) : 0;
      if (mtp && mfp && mtp < mfp) {
        return (m.label || ('ماہ ' + (mi + 1))) + ': "صفحہ تا" "صفحہ از" سے کم نہیں ہو سکتا';
      }
      if (m.fromPage != null) m.fromPage = mfp || null;
      if (m.toPage != null) m.toPage = mtp || null;
      if (m.fromLine != null) m.fromLine = curNormNonNegInt(m.fromLine, 0) || null;
      if (m.toLine != null) m.toLine = curNormNonNegInt(m.toLine, 0) || null;
    }
    return null;
  }

  function getClasses() {
    try {
      var c = JSON.parse(localStorage.getItem('ems_classes'));
      if (Array.isArray(c) && c.length) return c;
    } catch (e) { /* ignore */ }
    var set = {};
    window.curGetPlans().forEach(function (p) { if (p.grade) set[p.grade] = true; });
    getTeachers().forEach(function (t) {
      if (t.class) set[t.class] = true;
      if (t.dept) set[t.dept] = true;
    });
    return Object.keys(set);
  }

  function getTeacherPeriods(teacherId) {
    try {
      var periods = JSON.parse(localStorage.getItem('ems_att_periods')) || [];
      var teacher = getTeachers().find(function (t) { return t.id === teacherId; });
      var name = teacher ? (teacher.name || teacher.fullName) : '';
      return periods.filter(function (p) {
        return p.teacherId === teacherId || (name && p.teacherName === name);
      });
    } catch (e) { return []; }
  }

  function progressBarHtml(pct, color) {
    pct = Math.min(100, Math.max(0, Number(pct) || 0));
    color = color || (pct >= 80 ? '#22c55e' : pct >= 50 ? '#eab308' : '#ef4444');
    return '<div class="cur-progress-wrap"><div class="cur-progress-bar" style="width:' + pct + '%;background:' + color + ';"></div><span class="cur-progress-txt">' + pct + '%</span></div>';
  }

  function statusLabel(st) {
    return st === 'green' ? 'ہدف پر' : (st === 'yellow' ? 'معمولی تاخیر' : 'نمایاں تاخیر');
  }

  function statusColor(st) {
    return st === 'green' ? '#22c55e' : (st === 'yellow' ? '#eab308' : '#ef4444');
  }

  function formatTs(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleString('ur-PK'); } catch (e) { return '—'; }
  }

  window.curAutoCalcLines = function () {
    var pages = Number((document.getElementById('cur-plan-teach-pages') || {}).value) || 0;
    var totalPages = Number((document.getElementById('cur-plan-total-pages') || {}).value) || 0;
    var lpp = Number((document.getElementById('cur-plan-lines-pp') || {}).value) || 15;
    var measure = (document.getElementById('cur-plan-measure') || {}).value || 'lines';
    if (!pages && totalPages) {
      var draft = {
        excludedPages: (document.getElementById('cur-plan-excluded-pages') || {}).value || '',
        excludedSections: (document.getElementById('cur-plan-excluded-sections') || {}).value || '',
        totalPages: totalPages,
        linesPerPage: lpp,
        measureMode: measure
      };
      pages = Math.max(0, totalPages - countExcludedPagesUpTo(draft, totalPages));
    }
    var el = document.getElementById('cur-plan-teach-lines');
    if (el && pages) {
      el.value = measure === 'pages' ? pages : pages * lpp;
      toast('سطور خودکار حساب (غیر شامل صفحات خارج)', 'success');
    } else toast('قابلِ تدریس صفحات درج کریں', 'error');
  };

  window.curAutoSplitMonths = function () {
    var p = window.curCollectPlanForm();
    if (!p) return toast('پہلے کتاب منتخب کریں', 'error');
    var sc = p.annual;
    if (!sc || !sc.toPage) return toast('سالانہ نصاب (صفحہ تا) درج کریں', 'error');
    var lpp = Number(p.linesPerPage) || 15;
    var fromU = positionToUnits(p, sc.fromPage, sc.fromLine);
    var toU = positionToUnits(p, sc.toPage, sc.toLine);
    var total = Math.max(1, toU - fromU);
    var chunk = Math.ceil(total / 12);
    if (!p.months) p.months = defaultMonthSlots();
    for (var i = 0; i < 12; i++) {
      var startU = fromU + i * chunk;
      var endU = Math.min(toU, startU + chunk);
      if (startU >= toU) {
        p.months[i].fromPage = null; p.months[i].toPage = null;
        p.months[i].fromLine = null; p.months[i].toLine = null;
        continue;
      }
      if (p.measureMode === 'pages') {
        p.months[i].fromPage = startU; p.months[i].toPage = endU;
        p.months[i].fromLine = 1; p.months[i].toLine = lpp;
      } else {
        p.months[i].fromPage = Math.floor(startU / lpp) + 1;
        p.months[i].fromLine = (startU % lpp) || lpp;
        p.months[i].toPage = Math.floor(endU / lpp) + 1;
        p.months[i].toLine = (endU % lpp) || lpp;
      }
    }
    window.curFillPlanForm(p);
    toast('12 ماہ میں تقسیم ہو گئی — محفوظ کریں', 'success');
  };

  window.curRenderSettings = function () {
    var s = window.curGetSettings();
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; };
    set('cur-set-year-start', s.yearStart);
    set('cur-set-year-end', s.yearEnd);
    set('cur-set-measure', s.measureMode || 'lines');
    set('cur-set-yellow', s.yellowPct != null ? s.yellowPct : 5);
    set('cur-set-red', s.redPct != null ? s.redPct : 15);
    var tbody = document.getElementById('cur-audit-tbody');
    if (tbody) {
      var logs = (readJson(AUDIT_KEY, []) || []).slice().reverse().slice(0, 80);
      if (!logs.length) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">کوئی ریکارڈ نہیں</td></tr>';
      else tbody.innerHTML = logs.map(function (l) {
        return '<tr><td style="font-size:11px;">' + formatTs(l.timestamp) + '</td><td>' + esc(l.user) + '</td><td>' + esc(l.action) + '</td><td>' + esc(l.summary) + '</td></tr>';
      }).join('');
    }
  };

  window.curSaveSettingsForm = function () {
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    var before = window.curGetSettings();
    var s = {
      measureMode: g('cur-set-measure') || 'lines',
      yearStart: g('cur-set-year-start'),
      yearEnd: g('cur-set-year-end'),
      yellowPct: Number(g('cur-set-yellow')) || 5,
      redPct: Number(g('cur-set-red')) || 15,
      academicYear: (g('cur-set-year-start') || '').substring(0, 4) + '-' + (g('cur-set-year-end') || '').substring(0, 4)
    };
    window.curSaveSettings(s);
    window.curAudit('settings', 'ترتیبات اپڈیٹ', before, s);
    toast('ترتیبات محفوظ', 'success');
    window.curRenderSettings();
  };

  function pieSvg(parts, colors) {
    var total = parts.reduce(function (a, b) { return a + b; }, 0) || 1;
    var r = 42, cx = 50, cy = 50, start = 0, paths = '';
    parts.forEach(function (v, i) {
      if (v <= 0) return;
      var angle = (v / total) * Math.PI * 2;
      var x1 = cx + r * Math.cos(start);
      var y1 = cy + r * Math.sin(start);
      start += angle;
      var x2 = cx + r * Math.cos(start);
      var y2 = cy + r * Math.sin(start);
      var large = angle > Math.PI ? 1 : 0;
      paths += '<path d="M' + cx + ',' + cy + ' L' + x1 + ',' + y1 + ' A' + r + ',' + r + ' 0 ' + large + ' 1 ' + x2 + ',' + y2 + ' Z" fill="' + (colors[i] || '#94a3b8') + '"/>';
    });
    return '<svg viewBox="0 0 100 100" width="120" height="120">' + paths + '</svg>';
  }

  function pieCountSvg(parts, colors, centerVal) {
    var svg = pieSvg(parts, colors);
    var label = (centerVal == null ? '' : String(centerVal));
    return svg.replace('</svg>',
      '<text x="50" y="54" text-anchor="middle" font-size="20" font-weight="bold" fill="#1e293b">' + label + '</text></svg>');
  }

  function barSvg(labels, values, color) {
    var max = Math.max.apply(null, values.concat([1]));
    var bars = values.map(function (v, i) {
      var h = Math.round((v / max) * 70);
      return '<rect x="' + (8 + i * 28) + '" y="' + (80 - h) + '" width="22" height="' + h + '" fill="' + (color || '#6366f1') + '" rx="2"/><text x="' + (19 + i * 28) + '" y="92" font-size="6" text-anchor="middle" fill="#64748b">' + esc(labels[i] || '') + '</text>';
    }).join('');
    return '<svg viewBox="0 0 120 100" width="100%" height="100">' + bars + '</svg>';
  }

  function lineSvg(points, color) {
    if (typeof window.emsLineChartSVG === 'function' && points.length) {
      return window.emsLineChartSVG(points.map(function (p) { return { label: p.label, value: p.value }; }), color || '#7c3aed');
    }
    if (!points.length) return '<p style="color:#94a3b8;font-size:12px;text-align:center;">کوئی ڈیٹا نہیں</p>';
    var w = 560, h = 120, padX = 36, padY = 20;
    var max = Math.max.apply(null, points.map(function (p) { return p.value; }).concat([1]));
    var plotW = w - padX * 2, plotH = h - padY * 2;
    var coords = points.map(function (p, i) {
      var x = padX + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
      var y = padY + plotH - (p.value / max) * plotH;
      return { x: x, y: y, p: p };
    });
    var path = coords.map(function (c, i) { return (i ? 'L' : 'M') + c.x + ',' + c.y; }).join(' ');
    var dots = coords.map(function (c) {
      return '<circle cx="' + c.x + '" cy="' + c.y + '" r="4" fill="' + (color || '#7c3aed') + '"><title>' + esc(c.p.label) + ': ' + c.p.value + '</title></circle>' +
        '<text x="' + c.x + '" y="' + (h - 4) + '" text-anchor="middle" font-size="10" fill="#64748b">' + esc(c.p.label) + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" style="max-height:140px;">' +
      '<line x1="' + padX + '" y1="' + (padY + plotH) + '" x2="' + (w - padX) + '" y2="' + (padY + plotH) + '" stroke="#e2e8f0"/>' +
      '<path d="' + path + '" fill="none" stroke="' + (color || '#7c3aed') + '" stroke-width="2.5"/>' + dots + '</svg>';
  }

  function last6MonthKeys() {
    var arr = [], now = new Date();
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      arr.push({ key: d.toISOString().substring(0, 7), label: d.toLocaleDateString('ur-PK', { month: 'short' }) });
    }
    return arr;
  }

  window.curMonthlyEntryTrend = function (daily, filterFn) {
    return last6MonthKeys().map(function (m) {
      var cnt = daily.filter(function (d) {
        if ((d.date || '').substring(0, 7) !== m.key) return false;
        return filterFn ? filterFn(d) : true;
      }).length;
      return { label: m.label, value: cnt };
    });
  };

  window.curFormatScopeText = function (scopeObj) {
    if (!scopeObj) return '—';
    if (scopeObj.examNote) return scopeObj.examNote;
    var sc = scopeObj.scope;
    if (!sc || !sc.toPage) return '—';
    return 'ص ' + sc.fromPage + '–' + sc.toPage + ' / س ' + sc.fromLine + '–' + sc.toLine;
  };

  function scopeToLinkText(plan, scope) {
    if (!scope || !scope.toPage) return '';
    if (plan.measureMode === 'pages') return 'صفحہ ' + scope.fromPage + ' تا ' + scope.toPage;
    if (plan.measureMode === 'both') {
      return 'ص ' + scope.fromPage + ' س ' + scope.fromLine + ' تا ص ' + scope.toPage + ' س ' + scope.toLine;
    }
    return 'صفحہ ' + scope.fromPage + ' سطر ' + scope.fromLine + ' تا صفحہ ' + scope.toPage + ' سطر ' + scope.toLine;
  }

  function autoExamLinks(p) {
    if (!p.examLink) p.examLink = { half1: '', half2: '', quarterly: '', annual: '' };
    if (!p.examLink.quarterly) p.examLink.quarterly = '';
    ['half1', 'half2', 'annual'].forEach(function (k) {
      if (!p.examLink[k] && p[k] && p[k].toPage) p.examLink[k] = scopeToLinkText(p, p[k]);
    });
  }

  function teacherMetrics(teacherId, daily, plans) {
    var rows = daily.filter(function (d) { return d.teacherId === teacherId; });
    var bookIds = {};
    rows.forEach(function (d) { bookIds[d.bookId] = true; });
    var pcts = [], green = 0, yellow = 0, red = 0;
    Object.keys(bookIds).forEach(function (bid) {
      var plan = plans.find(function (p) { return p.id === bid; });
      if (!plan) return;
      var st = window.curComputeStatus(plan, daily, teacherId);
      pcts.push(st.pct);
      if (st.status === 'green') green++;
      else if (st.status === 'yellow') yellow++;
      else red++;
    });
    var avg = pcts.length ? Math.round(pcts.reduce(function (a, b) { return a + b; }, 0) / pcts.length) : 0;
    return { entries: rows.length, books: pcts.length, avgPct: avg, green: green, yellow: yellow, red: red };
  }

  function gradeMetrics(grade, daily, plans) {
    var gPlans = plans.filter(function (p) { return p.grade === grade; });
    if (!gPlans.length) return { books: 0, avgPct: 0, green: 0, yellow: 0, red: 0, entries: 0 };
    var pcts = [], green = 0, yellow = 0, red = 0;
    gPlans.forEach(function (p) {
      var st = window.curComputeStatus(p, daily);
      pcts.push(st.pct);
      if (st.status === 'green') green++;
      else if (st.status === 'yellow') yellow++;
      else red++;
    });
    var entries = daily.filter(function (d) {
      return gPlans.some(function (p) { return p.id === d.bookId; });
    }).length;
    return {
      books: gPlans.length,
      avgPct: pcts.length ? Math.round(pcts.reduce(function (a, b) { return a + b; }, 0) / pcts.length) : 0,
      green: green, yellow: yellow, red: red, entries: entries
    };
  }

  window.curRefreshComparePickers = function () {
    var mode = (document.getElementById('cur-compare-mode') || {}).value || 'book';
    document.querySelectorAll('.cur-compare-pick').forEach(function (el) {
      el.style.display = el.getAttribute('data-for') === mode ? '' : 'none';
    });
    var plans = getDeptPlans();
    var fill = function (id, items, valKey, labelFn) {
      var sel = document.getElementById(id);
      if (!sel) return;
      var cur = sel.value;
      sel.innerHTML = items.map(function (it) {
        var v = typeof it === 'string' ? it : it[valKey];
        return '<option value="' + esc(v) + '">' + esc(labelFn ? labelFn(it) : v) + '</option>';
      }).join('');
      if (cur) sel.value = cur;
    };
    fill('cur-compare-book-a', plans, 'id', function (p) { return p.bookName; });
    fill('cur-compare-book-b', plans, 'id', function (p) { return p.bookName; });
    var teachers = getTeachers();
    fill('cur-compare-teacher-a', teachers, 'id', function (t) { return t.name || t.fullName; });
    fill('cur-compare-teacher-b', teachers, 'id', function (t) { return t.name || t.fullName; });
    var grades = getClasses();
    if (grades.length) {
      fill('cur-compare-grade-a', grades);
      fill('cur-compare-grade-b', grades);
    }
  };

  window.switchCurTab = function (tabId, btn) {
    document.querySelectorAll('#module-curriculum .cur-tab-content').forEach(function (el) { el.style.display = 'none'; });
    var p = document.getElementById(tabId);
    if (p) p.style.display = 'block';
    document.querySelectorAll('#cur-ribbon-menu .reg-tab').forEach(function (b) { b.classList.remove('active-sub-tab'); });
    if (btn) btn.classList.add('active-sub-tab');
    if (tabId === 'cur-win-plan') window.curRenderPlanning();
    if (tabId === 'cur-win-daily') window.curRenderDaily();
    if (tabId === 'cur-win-monitor') window.curRenderMonitor();
    if (tabId === 'cur-win-reports') window.curRenderReports();
    if (tabId === 'cur-win-performance') window.curRenderPerformance();
    if (tabId === 'cur-win-compare') { window.curRefreshComparePickers(); window.curRenderCompare(); }
    if (tabId === 'cur-win-settings') window.curRenderSettings();
  };

  window.curInitModule = function () {
    function bootUi() {
      window.curSyncFromLibrary();
      curApplyRoleUi();
      if (curIsTeacherOnly()) {
        window.switchCurTab('cur-win-daily', curTabButton('cur-win-daily'));
        return;
      }
      var active = document.querySelector('#cur-ribbon-menu .reg-tab.active-sub-tab');
      if (active && active.style.display !== 'none') active.click();
      else window.switchCurTab('cur-win-plan', curTabButton('cur-win-plan'));
    }
    curEnsureLibraryReady().then(bootUi).catch(bootUi);
  };

  window.curRenderPlanning = function () {
    function paint() {
      window.curSyncFromLibrary();
      var plans = getDeptPlans();
      var libCount = 0;
      try { libCount = curReadLibraryBooks().length; } catch (eC) { libCount = 0; }
      var sel = document.getElementById('cur-plan-book-select');
      if (sel) {
        sel.innerHTML = '<option value="">کتاب منتخب کریں</option>' + plans.map(function (p) {
          return '<option value="' + esc(p.id) + '">' + esc(p.bookName) + (p.grade ? ' (' + esc(p.grade) + ')' : '') + '</option>';
        }).join('');
      }
      var tbody = document.getElementById('cur-plan-list-tbody');
      var q = ((document.getElementById('cur-plan-search') || {}).value || '').trim().toLowerCase();
      var filtered = q ? plans.filter(function (p) {
        return (p.bookName || '').toLowerCase().indexOf(q) >= 0 || (p.grade || '').toLowerCase().indexOf(q) >= 0;
      }) : plans;
      window._curPlanFiltered = filtered;
      var scrollEl = tbody ? tbody.closest('.table-responsive') : null;
      if (tbody) {
        if (!filtered.length) {
          if (typeof window.emsVirtualTableDestroy === 'function') window.emsVirtualTableDestroy('cur-plan-list');
          var emptyMsg = q
            ? 'کوئی نتیجہ نہیں'
            : (libCount
              ? 'سنک جاری… «مرکزی کتب خانہ سے sync» دوبارہ دبائیں'
              : 'امتحانات → ترتیبات و کتب خانہ میں پہلے کتابیں شامل کریں');
          tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">' + emptyMsg + '</td></tr>';
        } else if (scrollEl && typeof window.emsVirtualTableMount === 'function') {
          scrollEl.style.maxHeight = scrollEl.style.maxHeight || '40vh';
          scrollEl.style.overflowY = 'auto';
          window.emsVirtualTableMount('cur-plan-list', {
            scrollEl: scrollEl,
            tbody: tbody,
            rowHeight: 44,
            getData: function () { return window._curPlanFiltered || []; },
            renderRow: function (i, p) {
              var st = window.curComputeStatus(p, window.curGetDaily());
              var tr = document.createElement('tr');
              tr.style.cursor = 'pointer';
              tr.setAttribute('onclick', "window.curLoadPlanForm('" + p.id + "')");
              tr.innerHTML = '<td>' + esc(p.bookName) + '</td><td>' + esc(p.grade || '—') + '</td><td>' + p.totalPages + '</td><td>' + p.teachableLines + '</td><td>' + progressBarHtml(st.pct, statusColor(st.status)) + '</td><td><button class="btn btn-sm btn-outline" onclick="event.stopPropagation();window.curLoadPlanForm(\'' + p.id + '\')"><i class="fas fa-pen"></i></button></td>';
              return tr;
            },
            emptyHtml: '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">کوئی نتیجہ نہیں</td></tr>'
          });
        } else {
          tbody.innerHTML = filtered.map(function (p) {
            var st = window.curComputeStatus(p, window.curGetDaily());
            return '<tr onclick="window.curLoadPlanForm(\'' + p.id + '\')" style="cursor:pointer;"><td>' + esc(p.bookName) + '</td><td>' + esc(p.grade || '—') + '</td><td>' + p.totalPages + '</td><td>' + p.teachableLines + '</td><td>' + progressBarHtml(st.pct, statusColor(st.status)) + '</td><td><button class="btn btn-sm btn-outline" onclick="event.stopPropagation();window.curLoadPlanForm(\'' + p.id + '\')"><i class="fas fa-pen"></i></button></td></tr>';
          }).join('');
        }
      }
      var gsel = document.getElementById('cur-mon-filter-grade');
      if (gsel && gsel.options.length <= 1) {
        gsel.innerHTML = '<option value="">تمام درجات</option>' + getClasses().map(function (c) {
          return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
        }).join('');
      }
    }
    curEnsureLibraryReady().then(paint).catch(paint);
  };

  window.curLoadPlanForm = function (id) {
    var p = window.curGetPlans().find(function (x) { return x.id === id; });
    if (!p) return;
    var sel = document.getElementById('cur-plan-book-select');
    if (sel) sel.value = p.id;
    window.curFillPlanForm(p);
  };

  window.curFillPlanForm = function (p) {
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; };
    set('cur-plan-edit-id', p.id);
    set('cur-plan-grade', p.grade);
    set('cur-plan-total-pages', p.totalPages);
    set('cur-plan-teach-pages', p.teachablePages);
    set('cur-plan-teach-lines', p.teachableLines);
    set('cur-plan-lines-pp', p.linesPerPage || 15);
    set('cur-plan-excluded-pages', p.excludedPages);
    set('cur-plan-excluded-sections', p.excludedSections);
    set('cur-plan-measure', p.measureMode || 'lines');
    ['annual', 'half1', 'half2'].forEach(function (k) {
      var sc = p[k] || {};
      set('cur-' + k + '-fp', sc.fromPage); set('cur-' + k + '-tp', sc.toPage);
      set('cur-' + k + '-fl', sc.fromLine); set('cur-' + k + '-tl', sc.toLine);
    });
    set('cur-exam-h1', (p.examLink && p.examLink.half1) || '');
    set('cur-exam-h2', (p.examLink && p.examLink.half2) || '');
    set('cur-exam-quarterly', (p.examLink && p.examLink.quarterly) || '');
    set('cur-exam-annual', (p.examLink && p.examLink.annual) || '');
    autoExamLinks(p);
    set('cur-exam-h1', (p.examLink && p.examLink.half1) || '');
    set('cur-exam-h2', (p.examLink && p.examLink.half2) || '');
    set('cur-exam-quarterly', (p.examLink && p.examLink.quarterly) || '');
    set('cur-exam-annual', (p.examLink && p.examLink.annual) || '');
    var mgrid = document.getElementById('cur-months-grid');
    if (mgrid) {
      mgrid.innerHTML = (p.months || defaultMonthSlots()).map(function (m, idx) {
        return '<div class="cur-month-row"><strong>' + esc(m.label) + '</strong>' +
          '<input type="number" class="input-control input-sm cur-m-fp" data-idx="' + idx + '" placeholder="صفحہ از" value="' + (m.fromPage || '') + '">' +
          '<input type="number" class="input-control input-sm cur-m-tp" data-idx="' + idx + '" placeholder="صفحہ تا" value="' + (m.toPage || '') + '">' +
          '<input type="number" class="input-control input-sm cur-m-fl" data-idx="' + idx + '" placeholder="سطر از" value="' + (m.fromLine || '') + '">' +
          '<input type="number" class="input-control input-sm cur-m-tl" data-idx="' + idx + '" placeholder="سطر تا" value="' + (m.toLine || '') + '"></div>';
      }).join('');
    }
  };

  window.curCollectPlanForm = function () {
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    var id = g('cur-plan-edit-id');
    var sel = document.getElementById('cur-plan-book-select');
    var plans = window.curGetPlans();
    var p = id ? plans.find(function (x) { return x.id === id; }) : null;
    if (!p && sel && sel.value) p = plans.find(function (x) { return x.id === sel.value; });
    if (!p) return null;
    p.grade = g('cur-plan-grade').trim();
    p.totalPages = Number(g('cur-plan-total-pages')) || 0;
    p.teachablePages = Number(g('cur-plan-teach-pages')) || 0;
    p.teachableLines = Number(g('cur-plan-teach-lines')) || 0;
    p.linesPerPage = Number(g('cur-plan-lines-pp')) || 15;
    p.excludedPages = g('cur-plan-excluded-pages');
    p.excludedSections = g('cur-plan-excluded-sections');
    p.measureMode = g('cur-plan-measure') || 'lines';
    ['annual', 'half1', 'half2'].forEach(function (k) {
      p[k] = {
        fromPage: Number(g('cur-' + k + '-fp')) || 0,
        toPage: Number(g('cur-' + k + '-tp')) || 0,
        fromLine: Number(g('cur-' + k + '-fl')) || 0,
        toLine: Number(g('cur-' + k + '-tl')) || 0
      };
    });
    p.examLink = {
      half1: g('cur-exam-h1'),
      half2: g('cur-exam-h2'),
      quarterly: g('cur-exam-quarterly'),
      annual: g('cur-exam-annual')
    };
    if (!p.months) p.months = defaultMonthSlots();
    document.querySelectorAll('.cur-month-row').forEach(function (row, idx) {
      if (!p.months[idx]) p.months[idx] = { id: ISLAMIC_MONTHS[idx].id, label: ISLAMIC_MONTHS[idx].label };
      p.months[idx].fromPage = Number(row.querySelector('.cur-m-fp').value) || null;
      p.months[idx].toPage = Number(row.querySelector('.cur-m-tp').value) || null;
      p.months[idx].fromLine = Number(row.querySelector('.cur-m-fl').value) || null;
      p.months[idx].toLine = Number(row.querySelector('.cur-m-tl').value) || null;
    });
    p.updatedAt = Date.now();
    autoExamLinks(p);
    return p;
  };

  window.curSavePlan = function () {
    var p = window.curCollectPlanForm();
    if (!p) return toast('کتاب منتخب کریں', 'error');
    var planErr = curValidatePlan(p);
    if (planErr) return toast(planErr, 'error');
    autoExamLinks(p);
    if (typeof window.emsStampDepartment === 'function') window.emsStampDepartment(p);
    var plans = window.curGetPlans();
    var idx = plans.findIndex(function (x) { return x.id === p.id; });
    var before = idx >= 0 ? JSON.parse(JSON.stringify(plans[idx])) : null;
    if (idx >= 0) plans[idx] = p;
    else plans.push(p);
    writeJson(PLANS_KEY, plans);
    window.curAudit('update', 'نصاب: ' + p.bookName, before, p);
    toast('نصاب محفوظ', 'success');
    window.curRenderPlanning();
    if (typeof window.curUpdateDashboardCard === 'function') window.curUpdateDashboardCard();
  };

  window.curRenderDaily = function () {
    var teachers = getTeachers();
    var teacherOnly = curIsTeacherOnly();
    var selfTeacher = curGetCurrentTeacherRecord();
    var tsel = document.getElementById('cur-daily-teacher');
    var tWrap = document.getElementById('cur-daily-teacher-wrap');
    if (tsel) {
      if (teacherOnly && selfTeacher) {
        tsel.innerHTML = '<option value="' + esc(selfTeacher.id) + '">' + esc(selfTeacher.name || selfTeacher.fullName) + '</option>';
        tsel.value = selfTeacher.id;
        tsel.disabled = true;
        tsel.classList.add('cur-teacher-locked');
        if (tWrap) tWrap.classList.add('cur-teacher-locked-wrap');
      } else {
        tsel.disabled = false;
        tsel.classList.remove('cur-teacher-locked');
        if (tWrap) tWrap.classList.remove('cur-teacher-locked-wrap');
        tsel.innerHTML = teachers.map(function (t) {
          return '<option value="' + esc(t.id) + '">' + esc(t.name || t.fullName) + '</option>';
        }).join('');
      }
    }
    var dEl = document.getElementById('cur-daily-date');
    if (dEl) {
      if (!dEl.value) dEl.value = curTodayStr();
      dEl.max = curTodayStr();
    }
    window.curRefreshDailyBooks();
    window.curShowLastProgress();
    var tbody = document.getElementById('cur-daily-log-tbody');
    if (!tbody) return;
    var daily = curGetScopedDaily();
    var teacherIds = {};
    getTeachers().forEach(function (t) { teacherIds[t.id] = true; });
    daily = daily.filter(function (d) { return teacherIds[d.teacherId]; }).slice().reverse().slice(0, 50);
    if (!daily.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">کوئی اندراج نہیں</td></tr>'; return; }
    tbody.innerHTML = daily.map(function (d) {
      return '<tr><td>' + esc(d.date) + '</td><td>' + esc(d.teacherName) + '</td><td>' + esc(d.bookName) + '</td><td>' + d.page + '</td><td>' + d.line + '</td><td>' + esc(d.note || '—') + '</td><td><button class="btn btn-sm btn-outline" onclick="window.curDeleteDaily(\'' + d.id + '\')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  };

  window.curRefreshDailyBooks = function () {
    var tid = (document.getElementById('cur-daily-teacher') || {}).value;
    var plans = window.curGetPlans();
    var bsel = document.getElementById('cur-daily-book');
    if (!bsel) return;
    var teacher = getTeachers().find(function (t) { return t.id === tid; });
    var periodBooks = {};
    getTeacherPeriods(tid).forEach(function (p) { if (p.bookName) periodBooks[p.bookName] = true; });
    var list = plans.slice();
    if (Object.keys(periodBooks).length) {
      list.sort(function (a, b) {
        var ab = periodBooks[a.bookName] ? 0 : 1;
        var bb = periodBooks[b.bookName] ? 0 : 1;
        return ab - bb;
      });
    }
    bsel.innerHTML = list.map(function (p) {
      var tag = periodBooks[p.bookName] ? ' ★' : '';
      return '<option value="' + esc(p.id) + '">' + esc(p.bookName) + tag + '</option>';
    }).join('');
    var info = document.getElementById('cur-daily-teacher-info');
    if (info && teacher) {
      info.innerHTML = '<strong>' + esc(teacher.name || teacher.fullName) + '</strong> — کلاس: ' + esc(teacher.class || teacher.dept || '—');
    }
    var sched = document.getElementById('cur-daily-schedule');
    if (sched) {
      var periods = getTeacherPeriods(tid);
      if (!periods.length) sched.innerHTML = '<i class="fas fa-clock"></i> وقت جدول: حاضری میں درج نہیں';
      else sched.innerHTML = '<i class="fas fa-clock"></i> <strong>تدریسی اوقات:</strong> ' + periods.map(function (p) {
        return esc(p.className || '—') + ' · ' + esc(p.bookName || '—') + ' (' + esc(p.name || p.time || '') + ')';
      }).join(' | ');
    }
    window.curShowDailyExpected();
  };

  window.curShowDailyExpected = function () {
    var bookId = (document.getElementById('cur-daily-book') || {}).value;
    var dateStr = (document.getElementById('cur-daily-date') || {}).value || new Date().toISOString().split('T')[0];
    var tid = (document.getElementById('cur-daily-teacher') || {}).value || curGetCurrentTeacherId();
    var plan = window.curGetPlans().find(function (p) { return p.id === bookId; });
    var box = document.getElementById('cur-daily-expected');
    if (!box || !plan) return;
    var st = window.curComputeStatus(plan, curGetScopedDaily(), tid, dateStr);
    var pace = st.expectedPct > st.pct ? ('تاخیر: ' + st.gap + '%') : (st.pct > st.expectedPct ? 'آگے: +' + Math.abs(st.gap) + '%' : 'ہدف پر');
    box.innerHTML = '<i class="fas fa-bullseye"></i> آج کا متوقع: <strong>' + st.expectedPct + '%</strong> · حقیقی: <strong>' + st.pct + '%</strong> · ' + pace + ' · باقی: ' + st.remaining;
  };

  window.curShowLastProgress = function () {
    var bookId = (document.getElementById('cur-daily-book') || {}).value;
    var tid = (document.getElementById('cur-daily-teacher') || {}).value;
    var plan = window.curGetPlans().find(function (p) { return p.id === bookId; });
    var box = document.getElementById('cur-last-progress');
    if (!box || !plan) return;
    var prog = getLatestProgress(plan, curGetScopedDaily(), tid);
    box.innerHTML = prog.date ? ('<i class="fas fa-history"></i> آخری: ' + prog.date + ' — صفحہ ' + prog.page + '، سطر ' + prog.line) : '<i class="fas fa-seedling"></i> پہلا اندراج';
    window.curShowDailyExpected();
  };

  window.curSaveDaily = function () {
    var tid = (document.getElementById('cur-daily-teacher') || {}).value;
    if (curIsTeacherOnly()) {
      var selfId = curGetCurrentTeacherId();
      if (!selfId) return toast('آپ کا استاد ریکارڈ نہیں ملا', 'error');
      tid = selfId;
    }
    var bookId = (document.getElementById('cur-daily-book') || {}).value;
    var plan = window.curGetPlans().find(function (p) { return p.id === bookId; });
    var teacher = getTeachers().find(function (t) { return t.id === tid; });
    if (!plan || !teacher) return toast('استاد و کتاب منتخب کریں', 'error');
    var pageRaw = Number((document.getElementById('cur-daily-page') || {}).value);
    var lineRaw = Number((document.getElementById('cur-daily-line') || {}).value);
    if (isNaN(pageRaw) || pageRaw < 1) return toast('صفحہ نمبر درست درج کریں (کم از کم 1)', 'error');
    if (isNaN(lineRaw) || lineRaw < 1) return toast('سطر نمبر درست درج کریں (کم از کم 1)', 'error');
    var page = Math.floor(pageRaw);
    var line = Math.floor(lineRaw);
    var dateStr = (document.getElementById('cur-daily-date') || {}).value || curTodayStr();
    if (dateStr > curTodayStr()) return toast('مستقبل کی تاریخ درج نہیں کی جا سکتی', 'error');
    var daily = window.curGetDaily();
    var last = getLatestProgress(plan, daily, tid);
    var newU = positionToUnits(plan, page, line);
    var maxUnits = totalScopeUnits(plan);
    if (newU > maxUnits) {
      return toast('یہ پیش رفت کل نصاب (' + maxUnits + ' اکائیاں) سے زیادہ ہے', 'error');
    }
    if (last.units && newU < last.units) {
      if (!confirm('نئی پیش رفت (' + page + '/' + line + ') گزشتہ (' + last.page + '/' + last.line + ') سے کم ہے۔ محفوظ کریں؟')) return;
    }
    var entry = {
      id: 'CD-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      date: dateStr,
      teacherId: tid,
      teacherName: teacher.name || teacher.fullName,
      bookId: plan.id,
      bookName: plan.bookName,
      page: page,
      line: line,
      note: (document.getElementById('cur-daily-note') || {}).value.trim(),
      timestamp: Date.now()
    };
    if (typeof window.emsStampDepartment === 'function') window.emsStampDepartment(entry);
    daily.push(entry);
    writeJson(DAILY_KEY, daily);
    window.curAudit('create', 'روزانہ: ' + entry.bookName, null, entry);
    toast('درج ہو گیا', 'success');
    var pg = document.getElementById('cur-daily-page');
    var ln = document.getElementById('cur-daily-line');
    var nt = document.getElementById('cur-daily-note');
    if (pg) pg.value = '';
    if (ln) ln.value = '';
    if (nt) nt.value = '';
    window.curRenderDaily();
    if (typeof window.curUpdateDashboardCard === 'function') window.curUpdateDashboardCard();
  };

  window.curDeleteDaily = function (id) {
    if (curIsTeacherOnly()) {
      var entry = window.curGetDaily().find(function (d) { return d.id === id; });
      if (!entry || entry.teacherId !== curGetCurrentTeacherId()) {
        return toast('صرف اپنے اندراجات حذف کر سکتے ہیں', 'error');
      }
    }
    if (!confirm('حذف؟')) return;
    writeJson(DAILY_KEY, window.curGetDaily().filter(function (d) { return d.id !== id; }));
    window.curRenderDaily();
  };

  window.curRenderMonitor = function () {
    var plans = window.curGetPlans();
    var daily = curGetScopedDaily();
    var teacherId = curScopedTeacherId();
    var fGrade = (document.getElementById('cur-mon-filter-grade') || {}).value;
    var fStatus = (document.getElementById('cur-mon-filter-status') || {}).value;
    var q = ((document.getElementById('cur-mon-search') || {}).value || '').trim().toLowerCase();
    var gsel = document.getElementById('cur-mon-filter-grade');
    if (gsel && gsel.options.length <= 1) {
      gsel.innerHTML = '<option value="">تمام درجات</option>' + getClasses().map(function (c) {
        return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
      }).join('');
    }
    var list = plans.filter(function (p) {
      if (fGrade && p.grade !== fGrade) return false;
      if (q && (p.bookName || '').toLowerCase().indexOf(q) < 0 && (p.grade || '').toLowerCase().indexOf(q) < 0) return false;
      if (fStatus && window.curComputeStatus(p, daily, teacherId).status !== fStatus) return false;
      return true;
    });
    var kpi = document.getElementById('cur-monitor-kpi');
    if (kpi) {
      var g = 0, y = 0, r = 0;
      list.forEach(function (p) {
        var st = window.curComputeStatus(p, daily, teacherId);
        if (st.status === 'green') g++; else if (st.status === 'yellow') y++; else r++;
      });
      kpi.innerHTML = '<div class="cur-kpi"><span class="v" style="color:#22c55e;">' + g + '</span><span class="l">ہدف پر</span></div>' +
        '<div class="cur-kpi"><span class="v" style="color:#eab308;">' + y + '</span><span class="l">معمولی</span></div>' +
        '<div class="cur-kpi"><span class="v" style="color:#ef4444;">' + r + '</span><span class="l">تاخیر</span></div>' +
        '<div class="cur-kpi"><span class="v">' + list.length + '</span><span class="l">کتابیں</span></div>';
    }
    var tbody = document.getElementById('cur-monitor-tbody');
    if (!tbody) return;
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#94a3b8;">کوئی نتیجہ نہیں</td></tr>'; return; }
    tbody.innerHTML = list.map(function (p) {
      var st = window.curComputeStatus(p, daily, teacherId);
      var speed = st.gap > 0 ? ('-' + st.gap + '%') : ('+' + Math.abs(st.gap) + '%');
      return '<tr onclick="window.curDrillBook(\'' + p.id + '\')" class="cur-row-' + st.status + '" style="cursor:pointer;">' +
        '<td><strong>' + esc(p.bookName) + '</strong></td><td>' + esc(p.grade || '—') + '</td>' +
        '<td style="min-width:120px;">' + progressBarHtml(st.pct, statusColor(st.status)) + '</td>' +
        '<td>' + st.expectedPct + '%</td><td>' + st.pct + '%</td><td>' + st.remaining + '</td>' +
        '<td style="color:' + (st.gap > 0 ? '#ef4444' : '#22c55e') + ';">' + speed + '</td>' +
        '<td><span class="cur-badge cur-' + st.status + '">' + statusLabel(st.status) + '</span></td></tr>';
    }).join('');
  };

  window.curRenderPerformance = function () {
    var stats = window.curGetDashboardStats();
    var el = document.getElementById('cur-perf-stats');
    if (el) {
      el.innerHTML = pieSvg([stats.green, stats.yellow, stats.red], ['#22c55e', '#eab308', '#ef4444']) +
        '<div class="cur-perf-legend"><span class="cur-badge cur-green">' + stats.green + ' ہدف پر</span> ' +
        '<span class="cur-badge cur-yellow">' + stats.yellow + ' معمولی</span> ' +
        '<span class="cur-badge cur-red">' + stats.red + ' تاخیر</span></div>';
    }
    var plans = window.curGetPlans();
    var daily = curGetScopedDaily();
    var teacherId = curScopedTeacherId();
    var barEl = document.getElementById('cur-perf-bar');
    if (barEl && plans.length) {
      var top = plans.slice(0, 6);
      barEl.innerHTML = barSvg(top.map(function (p) { return p.bookName.slice(0, 6); }),
        top.map(function (p) { return window.curComputeStatus(p, daily, teacherId).pct; }), '#7c3aed');
    }
    var filtGrade = (document.getElementById('cur-perf-filter-grade') || {}).value;
    var tbody = document.getElementById('cur-perf-tbody');
    if (tbody) {
      var list = plans.filter(function (p) { return !filtGrade || p.grade === filtGrade; });
      tbody.innerHTML = list.map(function (p) {
        var st = window.curComputeStatus(p, daily, teacherId);
        return '<tr onclick="window.curDrillBook(\'' + p.id + '\')" style="cursor:pointer;"><td>' + esc(p.bookName) + '</td><td>' + esc(p.grade || '—') + '</td><td>' + progressBarHtml(st.pct, statusColor(st.status)) + '</td><td>' + st.remaining + '</td><td><span class="cur-badge cur-' + st.status + '">' + statusLabel(st.status) + '</span></td></tr>';
      }).join('');
    }
    var gsel = document.getElementById('cur-perf-filter-grade');
    if (gsel && !gsel.options.length) {
      gsel.innerHTML = '<option value="">تمام درجات</option>' + getClasses().map(function (c) {
        return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
      }).join('');
    }
    var lineEl = document.getElementById('cur-perf-line');
    if (lineEl) {
      var filt = (document.getElementById('cur-perf-filter-grade') || {}).value;
      lineEl.innerHTML = lineSvg(window.curMonthlyEntryTrend(daily, filt ? function (d) {
        var p = plans.find(function (x) { return x.id === d.bookId; });
        return p && p.grade === filt;
      } : null), '#7c3aed');
    }
  };

  window.curDrillBook = function (bookId) {
    var p = window.curGetPlans().find(function (x) { return x.id === bookId; });
    if (!p || typeof window.emsDrillOpen !== 'function') return;
    var dailyAll = curGetScopedDaily();
    var teacherId = curScopedTeacherId();
    var daily = dailyAll.filter(function (d) { return d.bookId === bookId; }).slice().reverse();
    var st = window.curComputeStatus(p, dailyAll, teacherId);
    window.emsDrillOpen({
      title: '<i class="fas fa-book"></i> ' + esc(p.bookName),
      crumb: p.bookName,
      render: function (g, b) {
        g.innerHTML = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;text-align:center;margin-bottom:10px;">' +
          '<div class="cur-kpi"><span class="v">' + st.pct + '%</span><span class="l">تکمیل</span></div>' +
          '<div class="cur-kpi"><span class="v">' + st.expectedPct + '%</span><span class="l">متوقع</span></div>' +
          '<div class="cur-kpi"><span class="v">' + st.remaining + '</span><span class="l">باقی</span></div>' +
          '<div class="cur-kpi"><span class="v" style="color:' + statusColor(st.status) + ';">' + statusLabel(st.status) + '</span><span class="l">حالت</span></div></div>' +
          progressBarHtml(st.pct, statusColor(st.status));
        if (!daily.length) { b.innerHTML = '<p style="text-align:center;color:#94a3b8;">کوئی روزانہ اندراج نہیں</p>'; return; }
        b.innerHTML = '<table class="data-table"><thead><tr><th>تاریخ</th><th>استاد</th><th>صفحہ</th><th>سطر</th><th>نوٹ</th></tr></thead><tbody>' +
          daily.slice(0, 40).map(function (d) {
            return '<tr><td>' + esc(d.date) + '</td><td>' + esc(d.teacherName) + '</td><td>' + d.page + '</td><td>' + d.line + '</td><td>' + esc(d.note || '—') + '</td></tr>';
          }).join('') + '</tbody></table>';
      }
    });
  };

  window.curRenderCompare = function () {
    var mode = (document.getElementById('cur-compare-mode') || {}).value || 'book';
    var plans = window.curGetPlans();
    var daily = window.curGetDaily();
    var box = document.getElementById('cur-compare-result');
    var chartBox = document.getElementById('cur-compare-chart');
    if (!box) return;

    function cmpTable(titleA, titleB, rows) {
      return '<table class="data-table"><thead><tr><th></th><th>' + esc(titleA) + '</th><th>' + esc(titleB) + '</th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>'; }).join('') +
        '</tbody></table>';
    }

    if (mode === 'book') {
      var idA = (document.getElementById('cur-compare-book-a') || {}).value;
      var idB = (document.getElementById('cur-compare-book-b') || {}).value;
      var a = plans.find(function (p) { return p.id === idA; }) || plans[0];
      var b = plans.find(function (p) { return p.id === idB; }) || plans[1];
      if (!a || !b || a.id === b.id) {
        box.innerHTML = '<p style="color:#64748b;">دو مختلف کتابیں منتخب کریں</p>';
        if (chartBox) chartBox.innerHTML = '';
        return;
      }
      var sa = window.curComputeStatus(a, daily), sb = window.curComputeStatus(b, daily);
      if (chartBox) chartBox.innerHTML = barSvg([a.bookName.slice(0, 8), b.bookName.slice(0, 8)], [sa.pct, sb.pct], '#7c3aed');
      box.innerHTML = cmpTable(a.bookName, b.bookName, [
        ['تکمیل', sa.pct + '%', sb.pct + '%'],
        ['متوقع', sa.expectedPct + '%', sb.expectedPct + '%'],
        ['باقی', sa.remaining, sb.remaining],
        ['فرق (ہدف)', sa.gap + '%', sb.gap + '%']
      ]);
      return;
    }

    if (mode === 'teacher') {
      var tA = (document.getElementById('cur-compare-teacher-a') || {}).value;
      var tB = (document.getElementById('cur-compare-teacher-b') || {}).value;
      var teachers = getTeachers();
      var ta = teachers.find(function (t) { return t.id === tA; });
      var tb = teachers.find(function (t) { return t.id === tB; });
      if (!ta || !tb || ta.id === tb.id) {
        box.innerHTML = '<p style="color:#64748b;">دو مختلف اساتذہ منتخب کریں</p>';
        if (chartBox) chartBox.innerHTML = '';
        return;
      }
      var ma = teacherMetrics(ta.id, daily, plans);
      var mb = teacherMetrics(tb.id, daily, plans);
      if (chartBox) {
        chartBox.innerHTML = lineSvg([
          { label: (ta.name || '').slice(0, 6), value: ma.avgPct },
          { label: (tb.name || '').slice(0, 6), value: mb.avgPct }
        ], '#6366f1');
      }
      box.innerHTML = cmpTable(ta.name || ta.fullName, tb.name || tb.fullName, [
        ['اوسط تکمیل', ma.avgPct + '%', mb.avgPct + '%'],
        ['کتابیں', ma.books, mb.books],
        ['اندراجات کی تعداد', ma.entries, mb.entries],
        ['ہدف پر', ma.green, mb.green],
        ['تاخیر', ma.red, mb.red]
      ]);
      return;
    }

    if (mode === 'grade') {
      var gA = (document.getElementById('cur-compare-grade-a') || {}).value;
      var gB = (document.getElementById('cur-compare-grade-b') || {}).value;
      if (!gA || !gB || gA === gB) {
        box.innerHTML = '<p style="color:#64748b;">دو مختلف درجات منتخب کریں</p>';
        if (chartBox) chartBox.innerHTML = '';
        return;
      }
      var ga = gradeMetrics(gA, daily, plans);
      var gb = gradeMetrics(gB, daily, plans);
      if (chartBox) chartBox.innerHTML = barSvg([gA.slice(0, 8), gB.slice(0, 8)], [ga.avgPct, gb.avgPct], '#0ea5e9');
      box.innerHTML = cmpTable(gA, gB, [
        ['اوسط تکمیل', ga.avgPct + '%', gb.avgPct + '%'],
        ['کتابیں', ga.books, gb.books],
        ['اندراجات کی تعداد', ga.entries, gb.entries],
        ['ہدف پر', ga.green, gb.green],
        ['تاخیر', ga.red, gb.red]
      ]);
      return;
    }

    if (mode === 'month' || mode === 'half' || mode === 'year') {
      var now = new Date();
      var curCnt = 0, prevCnt = 0;
      var curLabel = 'موجودہ', prevLabel = 'گزشتہ';
      if (mode === 'month') {
        var curM = now.toISOString().substring(0, 7);
        var prevD = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        var prevM = prevD.toISOString().substring(0, 7);
        curCnt = daily.filter(function (d) { return (d.date || '').substring(0, 7) === curM; }).length;
        prevCnt = daily.filter(function (d) { return (d.date || '').substring(0, 7) === prevM; }).length;
        curLabel = curM; prevLabel = prevM;
      } else if (mode === 'half') {
        var m = now.getMonth() + 1;
        curCnt = daily.filter(function (d) {
          var dm = parseInt((d.date || '').substring(5, 7), 10) || 0;
          return m <= 6 ? dm >= 1 && dm <= 6 : dm >= 7 && dm <= 12;
        }).length;
        prevCnt = daily.filter(function (d) {
          var dm = parseInt((d.date || '').substring(5, 7), 10) || 0;
          return m <= 6 ? dm >= 7 && dm <= 12 : dm >= 1 && dm <= 6;
        }).length;
        curLabel = m <= 6 ? 'پہلی ششماہی' : 'دوسری ششماہی';
        prevLabel = m <= 6 ? 'گزشتہ ششماہی' : 'پہلی ششماہی';
      } else {
        var y = String(now.getFullYear());
        curCnt = daily.filter(function (d) { return (d.date || '').substring(0, 4) === y; }).length;
        prevCnt = daily.filter(function (d) { return (d.date || '').substring(0, 4) === String(now.getFullYear() - 1); }).length;
        curLabel = y; prevLabel = String(now.getFullYear() - 1);
      }
      if (chartBox) chartBox.innerHTML = lineSvg(window.curMonthlyEntryTrend(daily), '#7c3aed');
      box.innerHTML = '<p style="font-size:13px;color:#64748b;margin:0 0 10px;"><i class="fas fa-info-circle"></i> یہ موازنہ روزانہ اندراجات کی تعداد پر مبنی ہے — نصابی پیش رفت نہیں۔</p>' +
        cmpTable(curLabel, prevLabel, [
        ['اندراجات کی تعداد', curCnt, prevCnt],
        ['فرق (اندراجات)', (curCnt - prevCnt), '—']
      ]);
      return;
    }

    box.innerHTML = '<p style="color:#64748b;">موازنہ کے لیے ڈیٹا درکار</p>';
    if (chartBox) chartBox.innerHTML = '';
  };

  window.curRenderReports = function () {
    var plans = window.curGetPlans();
    var daily = curGetScopedDaily();
    var teacherId = curScopedTeacherId();
    var stats = window.curGetDashboardStats();
    var box = document.getElementById('cur-reports-summary');
    if (!box) return;
    if (!plans.length) {
      box.innerHTML = '<p style="color:#94a3b8;text-align:center;">پہلے کتب خانے میں کتابیں شامل کریں</p>';
      return;
    }
    var rows = plans.map(function (p) {
      var st = window.curComputeStatus(p, daily, teacherId);
      return '<tr><td>' + esc(p.bookName) + '</td><td>' + esc(p.grade || '—') + '</td><td>' + st.expectedPct + '%</td><td>' + st.pct + '%</td><td>' + st.gap + '%</td><td>' + st.remaining + '</td><td><span class="cur-badge cur-' + st.status + '">●</span></td></tr>';
    }).join('');
    box.innerHTML = '<div class="dashboard-grid" style="grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">' +
      '<div class="dash-subcard"><div class="v">' + stats.books + '</div><div class="l">کتابیں</div></div>' +
      '<div class="dash-subcard"><div class="v">' + stats.avgPct + '%</div><div class="l">اوسط تکمیل</div></div>' +
      '<div class="dash-subcard"><div class="v" style="color:#22c55e;">' + stats.green + '</div><div class="l">ہدف پر</div></div>' +
      '<div class="dash-subcard"><div class="v" style="color:#ef4444;">' + stats.red + '</div><div class="l">تاخیر</div></div></div>' +
      '<div class="table-responsive" style="max-height:50vh;overflow-y:auto;"><table class="data-table"><thead><tr>' +
      '<th>کتاب</th><th>درجہ</th><th>متوقع%</th><th>حقیقی%</th><th>فرق</th><th>باقی</th><th>حالت</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>';
    var lineEl = document.getElementById('cur-reports-line');
    if (lineEl) lineEl.innerHTML = lineSvg(window.curMonthlyEntryTrend(daily), '#6366f1');
  };

  window.curExportReport = function (fmt) {
    var plans = window.curGetPlans();
    var daily = curGetScopedDaily();
    var teacherId = curScopedTeacherId();
    var rows = [['کتاب', 'درجہ', 'متوقع%', 'حقیقی%', 'باقی', 'حالت']];
    plans.forEach(function (p) {
      var st = window.curComputeStatus(p, daily, teacherId);
      rows.push([p.bookName, p.grade || '', st.expectedPct, st.pct, st.remaining, st.status]);
    });
    if (fmt === 'csv' || fmt === 'excel') {
      if (typeof XLSX !== 'undefined') {
        var ws = XLSX.utils.aoa_to_sheet(rows);
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Curriculum');
        XLSX.writeFile(wb, 'curriculum-report.xlsx');
      } else {
        var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
        var a = document.createElement('a');
        a.href = 'data:text/csv;charset=utf-8,\ufeff' + encodeURIComponent(csv);
        a.download = 'curriculum-report.csv';
        a.click();
      }
      return;
    }
    if (fmt === 'print' || fmt === 'pdf') {
      var html = '<html dir="rtl"><head><meta charset="utf-8"><title>نصاب رپورٹ</title><style>table{width:100%;border-collapse:collapse}td,th{border:1px solid #333;padding:6px;font-size:12px}</style></head><body><h2 style="text-align:center">نصاب رپورٹ</h2><table><thead><tr>' +
        rows[0].map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.slice(1).map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') +
        '</tbody></table></body></html>';
      var w = window.open('', '_blank');
      if (w) { w.document.write(html); w.document.close(); w.print(); }
    }
  };

  window.curUpdateDashboardCard = function () {
    var st = window.curGetDashboardStats();
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.innerText = v; };
    set('dash-cur-books', st.books);
    set('dash-cur-avg', st.avgPct + '%');
    set('dash-cur-green', st.green);
    set('dash-cur-red', st.red);
    var chart = document.getElementById('chart-curriculum');
    if (chart) {
      chart.innerHTML = pieCountSvg(
        [st.green, st.yellow, st.red],
        ['#22c55e', '#eab308', '#ef4444'],
        st.books || (st.green + st.yellow + st.red)
      );
    }
  };

  window.curOpenFromDashboard = function (subTab) {
    var tab = document.getElementById('tab-curriculum');
    if (tab) tab.click();
    setTimeout(function () {
      curApplyRoleUi();
      subTab = curResolveTabForRole(subTab || (curIsTeacherOnly() ? 'cur-win-daily' : 'cur-win-plan'));
      var btn = curTabButton(subTab);
      window.switchCurTab(subTab, btn);
    }, 200);
  };

  document.addEventListener('change', function (e) {
    if (e.target && (e.target.id === 'cur-daily-teacher' || e.target.id === 'cur-daily-book' || e.target.id === 'cur-daily-date')) {
      window.curRefreshDailyBooks();
      window.curShowLastProgress();
    }
    if (e.target && e.target.id === 'cur-plan-book-select') {
      var p = window.curGetPlans().find(function (x) { return x.id === e.target.value; });
      if (p) window.curFillPlanForm(p);
    }
  });

  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest('#cur-btn-save-plan')) window.curSavePlan();
    if (e.target && e.target.closest('#cur-btn-sync-lib')) {
      var btn = e.target.closest('#cur-btn-sync-lib');
      if (btn) btn.disabled = true;
      curEnsureLibraryReady().then(function () {
        var syncRes = window.curSyncFromLibrary();
        window.curRenderPlanning();
        var addedN = syncRes && typeof syncRes === 'object' ? (syncRes.added || 0) : (Number(syncRes) || 0);
        var totalN = syncRes && typeof syncRes === 'object' ? (syncRes.total || 0) : 0;
        if (addedN > 0) toast('مرکزی کتب خانہ سے ' + addedN + ' نئی کتاب شامل ہوئیں', 'success');
        else if (totalN > 0) toast('کتب خانہ ہم آہنگ ہے — ' + totalN + ' کتابیں دستیاب', 'success');
        else toast('امتحانات → ترتیبات و کتب خانہ میں پہلے کتابیں شامل کریں', 'warning');
      }).catch(function () {
        toast('کتب خانہ لوڈ نہیں ہو سکی — دوبارہ کوشش کریں', 'error');
      }).then(function () {
        if (btn) btn.disabled = false;
      });
    }
    if (e.target && e.target.closest('#cur-btn-auto-lines')) window.curAutoCalcLines();
    if (e.target && e.target.closest('#cur-btn-auto-months')) window.curAutoSplitMonths();
    if (e.target && e.target.closest('#cur-btn-save-settings')) window.curSaveSettingsForm();
    if (e.target && e.target.closest('#cur-btn-save-daily')) window.curSaveDaily();
    if (e.target && e.target.closest('#cur-btn-export-print')) window.curExportReport('print');
    if (e.target && e.target.closest('#cur-btn-export-excel')) window.curExportReport('excel');
  });

  if (typeof window.emsRegisterDepartmentRefresh === 'function') {
    window.emsRegisterDepartmentRefresh('curriculum', function () {
      var tab = document.querySelector('#cur-ribbon-menu .reg-tab.active-sub-tab');
      if (tab && typeof tab.click === 'function') tab.click();
      if (typeof window.curUpdateDashboardCard === 'function') window.curUpdateDashboardCard();
    });
  }

  if (!window._curSummaryHook) {
    window._curSummaryHook = true;
    window.emsOnCurriculumSummaryUpdate = function () {
      if (typeof window.curUpdateDashboardCard === 'function') window.curUpdateDashboardCard();
      if (document.getElementById('cur-win-performance') &&
          document.getElementById('cur-win-performance').style.display !== 'none' &&
          typeof window.curRenderPerformance === 'function') {
        window.curRenderPerformance();
      }
    };
  }

})();
