// ============================================================================
// اجتماعی حاضری — ماہانہ حاضری دیکھیں (صرف پڑھنے والا رجسٹر، پرنٹ اور PDF)
// یہ ماڈیول صرف canonical attendance readers استعمال کرتا ہے؛ کوئی write API نہیں۔
// ============================================================================
(function (global) {
  'use strict';

  var EXPORT_ROWS_PER_PAGE = 19;
  var _bound = false;
  var _mode = 'entry';
  var _roster = [];
  var _selected = Object.create(null);
  var _viewState = null;
  var _rosterRequest = 0;
  var _viewRequest = 0;
  var _pdfBusy = false;

  function byId(id) {
    return global.document && global.document.getElementById
      ? global.document.getElementById(id)
      : null;
  }

  function root() {
    return byId('att-collective-register');
  }

  function toast(message, type) {
    if (typeof global.showToast === 'function') global.showToast(message, type || 'info');
  }

  function escHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function todayMonth() {
    var now = new Date();
    var month = now.getMonth() + 1;
    return now.getFullYear() + '-' + (month < 10 ? '0' + month : month);
  }

  function validMonth(value) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
  }

  function daysInMonth(month) {
    if (!validMonth(month)) return 0;
    var parts = month.split('-');
    return new Date(Number(parts[0]), Number(parts[1]), 0).getDate();
  }

  function isoDate(month, day) {
    var n = Number(day) || 0;
    return month + '-' + (n < 10 ? '0' + n : String(n));
  }

  function weekdayOf(month, day) {
    var parts = String(month || '').split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(day)).getDay();
  }

  function weekdayShort(month, day) {
    return ['ات', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'][weekdayOf(month, day)] || '';
  }

  function monthLabel(month) {
    if (!validMonth(month)) return String(month || '');
    var names = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'];
    var parts = month.split('-');
    return names[Number(parts[1]) - 1] + ' ' + parts[0];
  }

  function tenantContext() {
    var tenant = typeof global.emsGetTenantId === 'function'
      ? String(global.emsGetTenantId() || '')
      : String(global.CURRENT_MADRASA_TENANT_ID || '');
    var generation = typeof global.emsGetTenantGeneration === 'function'
      ? global.emsGetTenantGeneration()
      : null;
    return { tenant: tenant, generation: generation };
  }

  function tenantContextMatches(context) {
    if (!context) return false;
    var current = tenantContext();
    return current.tenant === context.tenant
      && (context.generation == null || current.generation === context.generation);
  }

  function roleLabel(role) {
    if (role === 'teachers') return 'اساتذہ';
    if (role === 'staff') return 'عملہ';
    return 'طلباء';
  }

  function roleSingular(role) {
    if (role === 'teachers') return 'استاد';
    if (role === 'staff') return 'عملہ';
    return 'طالب علم';
  }

  function roleOrder(role) {
    return role === 'students' ? 1 : (role === 'teachers' ? 2 : 3);
  }

  function userId(user) {
    if (typeof global.attGetUserId === 'function') return global.attGetUserId(user);
    return String(user && (user.id || user.regId || user.uid || user.docId) || '').trim();
  }

  function userClass(user) {
    if (typeof global.attGetUserClass === 'function') return global.attGetUserClass(user);
    return String(user && (user.class || user.className || user.grade || user.section) || '').trim();
  }

  function userName(user) {
    if (!user) return '';
    return String(user.name || user.fullName || user.nameUrdu || user.urduName
      || user.studentName || user.teacherName || user.employeeName || '').trim();
  }

  function personKey(role, uid) {
    return role + ':' + String(uid || '');
  }

  function normalizePeople(users, role) {
    var seen = Object.create(null);
    var rows = [];
    (users || []).forEach(function (user) {
      var uid = userId(user);
      if (!uid) return;
      var key = personKey(role, uid);
      if (seen[key]) return;
      seen[key] = true;
      rows.push({
        key: key,
        role: role,
        uid: uid,
        name: userName(user) || uid,
        className: userClass(user),
        department: String(user.department || user.dept || user.designation || '').trim(),
        user: user
      });
    });
    return rows;
  }

  function sortPeople(a, b) {
    var roleDiff = roleOrder(a.role) - roleOrder(b.role);
    if (roleDiff) return roleDiff;
    var nameDiff = String(a.name || '').localeCompare(String(b.name || ''), 'ur');
    return nameDiff || String(a.uid || '').localeCompare(String(b.uid || ''));
  }

  function selectedRoles() {
    if (!root() || !root().querySelectorAll) return [];
    return Array.prototype.map.call(
      root().querySelectorAll('input[name="att_col_view_role"]:checked'),
      function (node) { return node.value; }
    ).filter(function (role) {
      return role === 'students' || role === 'teachers' || role === 'staff';
    });
  }

  function peopleMode() {
    var node = root() && root().querySelector
      ? root().querySelector('input[name="att_col_view_people"]:checked')
      : null;
    return node && node.value === 'selected' ? 'selected' : 'all';
  }

  function readTimetablePeriods() {
    var rows = [];
    if (typeof global.attReadAllTimetablePeriodsRaw === 'function') {
      rows = global.attReadAllTimetablePeriodsRaw() || [];
    } else if (typeof global.attActiveTimetablePeriods === 'function') {
      rows = global.attActiveTimetablePeriods() || [];
    }
    return Array.isArray(rows) ? rows.filter(function (period) { return period && period.id; }) : [];
  }

  function selectedClassId() {
    var node = byId('att-col-view-class');
    return String(node && node.value || '').trim();
  }

  function selectedPeriodId() {
    var node = byId('att-col-view-period');
    return String(node && node.value || 'all').trim() || 'all';
  }

  function findPeriod(periodId) {
    var id = String(periodId || '').trim();
    if (!id || id === 'all') return null;
    var rows = readTimetablePeriods();
    for (var i = 0; i < rows.length; i += 1) {
      if (String(rows[i].id) === id) return rows[i];
    }
    if (typeof global.attResolvePeriodById === 'function') return global.attResolvePeriodById(id);
    return null;
  }

  function viewScope() {
    var classId = selectedClassId();
    var periodId = classId ? selectedPeriodId() : 'all';
    return {
      classId: classId,
      periodId: periodId,
      period: periodId !== 'all' ? findPeriod(periodId) : null
    };
  }

  function periodLabel(period) {
    if (!period) return 'گھنٹہ نامعلوم';
    var main = period.bookName || period.name || 'گھنٹہ';
    var details = [];
    if (period.name && period.name !== main) details.push(period.name);
    if (period.teacherName) details.push(period.teacherName);
    if (period.start) details.push(period.start + (period.end ? ' تا ' + period.end : ''));
    var archived = period.archived === true || period.deleted === true ? ' — محفوظ پرانا گھنٹہ' : '';
    return main + (details.length ? ' (' + details.join(' • ') + ')' : '') + archived;
  }

  function fillViewClassSelect() {
    var select = byId('att-col-view-class');
    if (!select) return;
    var current = String(select.value || '');
    var classes = typeof global.attListAttendanceClasses === 'function'
      ? (global.attListAttendanceClasses() || [])
      : [];
    readTimetablePeriods().forEach(function (period) {
      var name = String(period.className || '').trim();
      if (name && name !== '-' && name !== 'نامعلوم') classes.push(name);
    });
    classes = classes.filter(function (name, index, all) {
      return name && all.indexOf(name) === index;
    }).sort(function (a, b) { return String(a).localeCompare(String(b), 'ur'); });
    select.innerHTML = '<option value="">تمام درجات</option>' + classes.map(function (name) {
      return '<option value="' + escHtml(name) + '">' + escHtml(name) + '</option>';
    }).join('');
    if (current && classes.indexOf(current) >= 0) select.value = current;
  }

  function fillViewPeriodSelect() {
    var select = byId('att-col-view-period');
    if (!select) return;
    var classId = selectedClassId();
    var current = String(select.value || 'all');
    var seen = Object.create(null);
    var periods = classId ? readTimetablePeriods().filter(function (period) {
      if (String(period.className || '').trim() !== classId) return false;
      var id = String(period.id || '');
      if (!id || seen[id]) return false;
      seen[id] = true;
      return true;
    }).sort(function (a, b) {
      var time = String(a.start || '').localeCompare(String(b.start || ''));
      return time || periodLabel(a).localeCompare(periodLabel(b), 'ur');
    }) : [];
    select.innerHTML = '<option value="all">تمام گھنٹے / روزانہ خلاصہ</option>' + periods.map(function (period) {
      return '<option value="' + escHtml(period.id) + '">' + escHtml(periodLabel(period)) + '</option>';
    }).join('');
    select.disabled = !classId;
    var valid = current === 'all' || periods.some(function (period) { return String(period.id) === current; });
    select.value = valid ? current : 'all';
  }

  function updateScopeNote() {
    var note = byId('att-col-view-scope-note');
    if (!note) return;
    var roles = selectedRoles();
    var scope = viewScope();
    var parts = [];
    if (roles.indexOf('students') >= 0) {
      parts.push(scope.classId
        ? 'طلباء: ' + scope.classId + (scope.periodId === 'all' ? ' کے تمام گھنٹوں کا خلاصہ' : ' کا منتخب گھنٹہ')
        : 'طلباء: تمام درجات کا روزانہ خلاصہ');
    }
    if (roles.indexOf('teachers') >= 0) {
      parts.push(scope.classId
        ? 'اساتذہ: ' + scope.classId + (scope.periodId === 'all' ? ' پڑھانے والے تمام اساتذہ' : ' کے منتخب گھنٹے کے استاد')
        : 'اساتذہ: تمام اساتذہ');
    }
    if (roles.indexOf('staff') >= 0) parts.push('عملہ: روزانہ حاضری');
    note.textContent = parts.join('۔ ') + (parts.length ? '۔' : 'کم از کم ایک قسم منتخب کریں۔');
  }

  function syncScopeControls() {
    var roles = selectedRoles();
    var relevant = roles.indexOf('students') >= 0 || roles.indexOf('teachers') >= 0;
    var wrap = byId('att-col-view-register-scope');
    if (wrap) wrap.classList.toggle('att-col-hidden', !relevant);
    fillViewClassSelect();
    fillViewPeriodSelect();
    updateScopeNote();
  }

  function periodMatchesTeacher(period, user) {
    if (!period || !user) return false;
    var uid = userId(user);
    if (typeof global.attPeriodTeacherIdMatches === 'function') {
      return global.attPeriodTeacherIdMatches(period, uid);
    }
    return String(period.teacherId || '').trim() === uid;
  }

  function filterUsersForScope(users, role, scope) {
    if (!scope || !scope.classId || role === 'staff') return users || [];
    if (role === 'students') {
      return (users || []).filter(function (user) { return userClass(user) === scope.classId; });
    }
    if (role === 'teachers') {
      var periods = readTimetablePeriods().filter(function (period) {
        return String(period.className || '').trim() === scope.classId;
      });
      if (scope.periodId !== 'all') {
        periods = periods.filter(function (period) { return String(period.id) === scope.periodId; });
      }
      return (users || []).filter(function (user) {
        return periods.some(function (period) { return periodMatchesTeacher(period, user); });
      });
    }
    return users || [];
  }

  function resolveRoster(roles, requestId, context, scope) {
    if (typeof global.attResolveTargetUsers !== 'function') {
      return Promise.reject(new Error('attendance roster reader unavailable'));
    }
    return Promise.all((roles || []).map(function (role) {
      var classArg = role === 'students' && scope && scope.classId ? scope.classId : '';
      return Promise.resolve(global.attResolveTargetUsers(role, classArg)).then(function (users) {
        return normalizePeople(filterUsersForScope(users, role, scope), role);
      });
    })).then(function (groups) {
      if (requestId !== _rosterRequest && requestId !== _viewRequest) return [];
      if (!tenantContextMatches(context)) return [];
      return Array.prototype.concat.apply([], groups).sort(sortPeople);
    });
  }

  function personSearchText(person) {
    return [person.name, person.uid, person.className, person.department, roleLabel(person.role)]
      .join(' ').toLocaleLowerCase();
  }

  function visibleRoster() {
    var search = byId('att-col-view-search');
    var query = String(search && search.value || '').trim().toLocaleLowerCase();
    if (!query) return _roster.slice();
    return _roster.filter(function (person) { return personSearchText(person).indexOf(query) >= 0; });
  }

  function updateSelectedCount() {
    var node = byId('att-col-view-selected-count');
    if (!node) return;
    var count = Object.keys(_selected).filter(function (key) { return !!_selected[key]; }).length;
    node.textContent = 'منتخب افراد: ' + count;
  }

  function syncSelectedFromDom() {
    var list = byId('att-col-view-people-list');
    if (!list || !list.querySelectorAll) return;
    Array.prototype.forEach.call(list.querySelectorAll('input[data-att-col-person]'), function (box) {
      var key = box.getAttribute('data-att-col-person');
      if (!key) return;
      if (box.checked) _selected[key] = true;
      else delete _selected[key];
    });
    updateSelectedCount();
  }

  function renderPicker() {
    var list = byId('att-col-view-people-list');
    if (!list) return;
    var visible = visibleRoster();
    if (!_roster.length) {
      list.innerHTML = '<span class="att-col-placeholder">منتخب قسم میں کوئی فرد نہیں ملا۔</span>';
      updateSelectedCount();
      return;
    }
    if (!visible.length) {
      list.innerHTML = '<span class="att-col-placeholder">تلاش کے مطابق کوئی فرد نہیں ملا۔</span>';
      updateSelectedCount();
      return;
    }
    list.innerHTML = visible.map(function (person) {
      var sub = roleLabel(person.role);
      if (person.className) sub += ' • ' + person.className;
      else if (person.department) sub += ' • ' + person.department;
      sub += ' • ' + person.uid;
      return '<label class="att-col-view-person">'
        + '<input type="checkbox" data-att-col-person="' + escHtml(person.key) + '"'
        + (_selected[person.key] ? ' checked' : '') + '>'
        + '<span><strong>' + escHtml(person.name) + '</strong><small>' + escHtml(sub) + '</small></span>'
        + '</label>';
    }).join('');
    updateSelectedCount();
  }

  function setPickerBusy(busy) {
    var list = byId('att-col-view-people-list');
    if (busy && list) list.innerHTML = '<span class="att-col-placeholder"><i class="fas fa-spinner fa-spin"></i> افراد لوڈ ہو رہے ہیں…</span>';
  }

  function refreshPicker() {
    var picker = byId('att-col-view-picker');
    var selectedOnly = peopleMode() === 'selected';
    if (picker) picker.classList.toggle('att-col-hidden', !selectedOnly);
    if (!selectedOnly) return Promise.resolve([]);
    var roles = selectedRoles();
    if (!roles.length) {
      _roster = [];
      renderPicker();
      return Promise.resolve([]);
    }
    var requestId = ++_rosterRequest;
    var context = tenantContext();
    var scope = viewScope();
    setPickerBusy(true);
    return resolveRoster(roles, requestId, context, scope).then(function (rows) {
      if (requestId !== _rosterRequest || !tenantContextMatches(context)) return [];
      _roster = rows;
      renderPicker();
      return rows;
    }).catch(function (error) {
      if (requestId !== _rosterRequest) return [];
      console.error('[EMS] collective month roster', error);
      _roster = [];
      renderPicker();
      toast('افراد کی فہرست لوڈ نہیں ہو سکی', 'error');
      return [];
    });
  }

  function setMode(mode) {
    _mode = mode === 'view' ? 'view' : 'entry';
    var entry = byId('att-col-entry-mode');
    var view = byId('att-col-view-mode');
    var entryBtn = byId('btn-att-col-mode-entry');
    var viewBtn = byId('btn-att-col-mode-view');
    if (entry) entry.classList.toggle('att-col-hidden', _mode !== 'entry');
    if (view) view.classList.toggle('att-col-hidden', _mode !== 'view');
    if (entryBtn) {
      entryBtn.classList.toggle('btn-primary', _mode === 'entry');
      entryBtn.classList.toggle('btn-outline', _mode !== 'entry');
      entryBtn.classList.toggle('active', _mode === 'entry');
      entryBtn.setAttribute('aria-selected', _mode === 'entry' ? 'true' : 'false');
    }
    if (viewBtn) {
      viewBtn.classList.toggle('btn-primary', _mode === 'view');
      viewBtn.classList.toggle('btn-outline', _mode !== 'view');
      viewBtn.classList.toggle('active', _mode === 'view');
      viewBtn.setAttribute('aria-selected', _mode === 'view' ? 'true' : 'false');
    }
    var month = byId('att-col-view-month');
    if (month && !month.value) month.value = todayMonth();
    if (_mode === 'view') {
      syncScopeControls();
      refreshPicker();
    }
  }

  function holidays() {
    try {
      var rows = JSON.parse(global.localStorage.getItem('ems_att_holidays') || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      return [];
    }
  }

  function holidayReason(month, day, savedHolidays) {
    var date = isoDate(month, day);
    if (weekdayOf(month, day) === 5) return 'جمعہ';
    for (var i = 0; i < savedHolidays.length; i += 1) {
      var item = savedHolidays[i] || {};
      var start = String(item.start || item.date || '');
      var end = String(item.end || item.date || start);
      if (start && date >= start && date <= end) return String(item.title || 'تعطیل');
    }
    return '';
  }

  function safeSheetData(sheet) {
    var data = sheet && sheet.data ? sheet.data : sheet;
    data = data && typeof data === 'object' ? data : {};
    return {
      records: data.records && typeof data.records === 'object' ? data.records : {},
      periodRecords: data.periodRecords && typeof data.periodRecords === 'object' ? data.periodRecords : {}
    };
  }

  function loadSheetsForRows(month, rows, requestId, context) {
    var classMap = Object.create(null);
    rows.forEach(function (person) {
      if (person.role === 'students' && person.className) classMap[person.className] = true;
    });
    var classIds = Object.keys(classMap);
    var tasks = [];
    classIds.forEach(function (classId) {
      tasks.push(Promise.resolve(global.attLoadCanonicalClassSheet(month, classId)).then(function (sheet) {
        return { key: 'students:' + classId, data: safeSheetData(sheet) };
      }));
    });
    if (rows.some(function (person) { return person.role === 'teachers'; })) {
      tasks.push(Promise.resolve(global.attLoadStaffTypeSheet(month, 'teachers')).then(function (sheet) {
        return { key: 'teachers', data: safeSheetData(sheet) };
      }));
    }
    if (rows.some(function (person) { return person.role === 'staff'; })) {
      tasks.push(Promise.resolve(global.attLoadStaffTypeSheet(month, 'staff')).then(function (sheet) {
        return { key: 'staff', data: safeSheetData(sheet) };
      }));
    }
    return Promise.all(tasks).then(function (loaded) {
      if (requestId !== _viewRequest || !tenantContextMatches(context)) return null;
      var sheets = Object.create(null);
      loaded.forEach(function (item) { sheets[item.key] = item.data; });
      return sheets;
    });
  }

  function sheetForPerson(person, sheets) {
    if (person.role === 'students') return sheets['students:' + person.className] || safeSheetData(null);
    return sheets[person.role] || safeSheetData(null);
  }

  function rawDayStatus(person, sheet, month, day, symbols, scope) {
    scope = scope || { classId: '', periodId: 'all' };
    var daily = sheet.records[person.uid] && sheet.records[person.uid][day];
    var periodMap = sheet.periodRecords[person.uid] && sheet.periodRecords[person.uid][day];

    // Exact hour view reads the very same periodRecords cell written by
    // collective attendance; a daily rollup is not evidence for that hour.
    if (scope.periodId && scope.periodId !== 'all' && person.role !== 'staff') {
      var one = periodMap && periodMap[scope.periodId];
      return one != null && one !== '' ? one : '';
    }

    // A class-specific teacher register must include only that class's hours.
    // The teacher daily record may also contain lessons from other classes.
    if (person.role === 'teachers' && scope.classId) {
      if (!periodMap || typeof periodMap !== 'object' || !Object.keys(periodMap).length) return '';
      var teacherPeriods = typeof global.attTeacherPeriodsForRegisterDay === 'function'
        ? (global.attTeacherPeriodsForRegisterDay(
          person.uid,
          person.name,
          day,
          weekdayOf(month, day),
          periodMap
        ) || [])
        : [];
      var teacherIds = teacherPeriods.filter(function (period) {
        return period && String(period.className || '').trim() === scope.classId;
      }).map(function (period) { return period.id; }).filter(Boolean);
      if (!teacherIds.length) return '';
      return typeof global.attRollupPeriodDayStatus === 'function'
        ? (global.attRollupPeriodDayStatus(periodMap, symbols, teacherIds) || '')
        : '';
    }

    // Canonical daily records are also used by dashboard/reports.  Prefer them
    // so the monthly view cannot diverge merely because a timetable changed.
    if (daily != null && daily !== '') return daily;
    if (person.role === 'staff') return '';

    if (!periodMap || typeof periodMap !== 'object' || !Object.keys(periodMap).length) return '';
    var periods = [];
    var weekday = weekdayOf(month, day);
    if (person.role === 'teachers' && typeof global.attTeacherPeriodsForRegisterDay === 'function') {
      periods = global.attTeacherPeriodsForRegisterDay(person.uid, person.name, day, weekday, periodMap) || [];
    } else if (person.role === 'students' && typeof global.attStudentPeriodsForRegisterDay === 'function') {
      periods = global.attStudentPeriodsForRegisterDay(person.className, day, weekday, periodMap) || [];
    }
    var expectedIds = periods.map(function (period) { return period && period.id; }).filter(Boolean);
    if (typeof global.attRollupPeriodDayStatus === 'function') {
      return global.attRollupPeriodDayStatus(periodMap, symbols, expectedIds) || '';
    }
    return '';
  }

  function statusKind(raw, symbols) {
    if (typeof global.attStatusKind === 'function') return global.attStatusKind(raw, symbols);
    var text = String(raw == null ? '' : raw).trim();
    if (!text) return '';
    if (text === symbols.P || text === 'P' || text === 'ح') return 'P';
    if (text === symbols.A || text === 'A' || text === 'غ') return 'A';
    if (text === symbols.L || text === 'L' || text === 'ر') return 'L';
    if (text === 'جزوی حاضری') return 'partial';
    if (text === 'نامکمل') return 'incomplete';
    return 'other';
  }

  function displayStatus(raw, kind, symbols) {
    if (kind === 'partial') return 'ج';
    if (kind === 'incomplete') return 'ن';
    if (typeof global.attDisplayStatus === 'function') return global.attDisplayStatus(raw, symbols);
    if (kind === 'P') return symbols.P || 'P';
    if (kind === 'A') return symbols.A || 'A';
    if (kind === 'L') return symbols.L || 'L';
    return raw == null ? '' : String(raw);
  }

  function cellClass(kind) {
    if (kind === 'P') return 'att-month-p';
    if (kind === 'A') return 'att-month-a';
    if (kind === 'L') return 'att-month-l';
    if (kind === 'partial') return 'att-month-partial';
    if (kind === 'incomplete') return 'att-month-incomplete';
    return '';
  }

  function buildMarks(person, sheet, month, dayCount, symbols, savedHolidays, scope) {
    var marks = [];
    var totals = { P: 0, A: 0, L: 0, partial: 0, incomplete: 0 };
    for (var day = 1; day <= dayCount; day += 1) {
      var raw = rawDayStatus(person, sheet, month, day, symbols, scope);
      var kind = statusKind(raw, symbols);
      var holiday = !kind ? holidayReason(month, day, savedHolidays) : '';
      if (totals[kind] != null) totals[kind] += 1;
      marks.push({
        day: day,
        raw: raw,
        kind: kind,
        holiday: holiday,
        text: kind ? displayStatus(raw, kind, symbols) : (holiday ? 'تعطیل' : '—')
      });
    }
    person.marks = marks;
    person.totals = totals;
    return person;
  }

  function holidayCellHtml(label, span) {
    var word = 'تعطیل';
    var title = label ? String(label) : word;
    var rows = Math.max(1, Number(span) || 1);
    /* بڑا rowspan = لمبا عمودی کالم؛ فونٹ قدرے بڑا تاکہ اوپر سے نیچے مناسب فاصلہ نظر آئے */
    var fontPx = Math.max(12, Math.min(20, 11 + rows * 1.2));
    return '<span class="att-month-holiday-text" style="font-size:' + fontPx + 'px" aria-label="'
      + escHtml(title) + '">' + escHtml(word) + '</span>';
  }

  function holidayRowSpanAt(rows, rowIndex, dayIndex, grouped) {
    var person = rows[rowIndex];
    var mark = person && person.marks ? person.marks[dayIndex] : null;
    if (!mark || !mark.holiday) return 0;
    if (rowIndex > 0) {
      var prev = rows[rowIndex - 1];
      var prevMark = prev && prev.marks ? prev.marks[dayIndex] : null;
      if (prevMark && prevMark.holiday && (!grouped || prev.role === person.role)) {
        return 0;
      }
    }
    var span = 1;
    for (var j = rowIndex + 1; j < rows.length; j += 1) {
      if (grouped && rows[j].role !== person.role) break;
      var nextMark = rows[j].marks[dayIndex];
      if (!nextMark || !nextMark.holiday) break;
      span += 1;
    }
    return span;
  }

  function setLoadBusy(busy) {
    var button = byId('btn-att-col-view-open');
    if (!button) return;
    button.disabled = !!busy;
    button.innerHTML = busy
      ? '<i class="fas fa-spinner fa-spin"></i> حاضری لوڈ ہو رہی ہے…'
      : '<i class="fas fa-eye"></i> ماہانہ حاضری دکھائیں';
  }

  function roleSummary(roles) {
    return (roles || []).map(roleLabel).join('، ');
  }

  function scopeSummary(state) {
    var scope = state && state.scope ? state.scope : { classId: '', periodId: 'all', period: null };
    var parts = [];
    parts.push(scope.classId ? 'درجہ: ' + scope.classId : 'تمام درجات');
    parts.push(scope.periodId && scope.periodId !== 'all'
      ? 'گھنٹہ: ' + periodLabel(scope.period)
      : 'تمام گھنٹے / روزانہ خلاصہ');
    return parts.join(' — ');
  }

  function registerTitle(state) {
    return 'ماہانہ اجتماعی حاضری — ' + monthLabel(state.month) + ' — ' + scopeSummary(state);
  }

  function tableHeadHtml(state) {
    var holidayDays = {};
    (state.rows || []).forEach(function (person) {
      (person.marks || []).forEach(function (mark) {
        if (mark && mark.holiday) holidayDays[mark.day] = mark.holiday;
      });
    });
    var html = '<thead><tr><th class="att-col-month-name">نام / شناخت</th><th class="att-col-month-role">قسم</th>';
    for (var day = 1; day <= state.dayCount; day += 1) {
      var hol = holidayDays[day];
      html += '<th class="att-col-month-day' + (hol ? ' att-col-month-day-holiday' : '') + '"'
        + (hol ? ' title="' + escHtml(hol) + '"' : '') + '>'
        + day + '<small>' + escHtml(weekdayShort(state.month, day)) + '</small></th>';
    }
    html += '<th class="att-col-month-summary">ح</th><th class="att-col-month-summary">غ</th><th class="att-col-month-summary">ر</th></tr></thead>';
    return html;
  }

  function tableBodyHtml(rows, state, grouped) {
    var html = '<tbody>';
    var lastRole = '';
    (rows || []).forEach(function (person, rowIndex) {
      if (grouped && person.role !== lastRole) {
        html += '<tr class="att-col-month-group"><td colspan="' + (state.dayCount + 5) + '">' + escHtml(roleLabel(person.role)) + '</td></tr>';
        lastRole = person.role;
      }
      var sub = person.uid;
      if (person.className) sub += ' • ' + person.className;
      else if (person.department) sub += ' • ' + person.department;
      html += '<tr><td class="att-col-month-name"><strong>' + escHtml(person.name) + '</strong>'
        + '<span class="att-col-month-person-meta">' + escHtml(sub) + '</span></td>'
        + '<td class="att-col-month-role">' + escHtml(roleSingular(person.role)) + '</td>';
      person.marks.forEach(function (mark, dayIndex) {
        if (mark.holiday) {
          var span = holidayRowSpanAt(rows, rowIndex, dayIndex, !!grouped);
          if (!span) return;
          html += '<td class="att-month-holiday" rowspan="' + span + '"'
            + ' title="' + escHtml(mark.holiday || 'تعطیل') + '">'
            + holidayCellHtml(mark.holiday, span) + '</td>';
          return;
        }
        var cls = mark.kind ? cellClass(mark.kind) : '';
        var title = mark.kind === 'partial' ? 'جزوی حاضری'
          : (mark.kind === 'incomplete' ? 'نامکمل حاضری' : '');
        html += '<td class="' + cls + '"' + (title ? ' title="' + escHtml(title) + '"' : '') + '>'
          + escHtml(mark.text) + '</td>';
      });
      html += '<td class="att-month-p att-col-month-summary">' + person.totals.P + '</td>'
        + '<td class="att-month-a att-col-month-summary">' + person.totals.A + '</td>'
        + '<td class="att-month-l att-col-month-summary">' + person.totals.L + '</td></tr>';
    });
    return html + '</tbody>';
  }

  function tableHtml(rows, state, grouped) {
    return '<table class="data-table att-col-month-table" dir="rtl">'
      + tableHeadHtml(state) + tableBodyHtml(rows, state, grouped) + '</table>';
  }

  function overallTotals(rows) {
    var out = { P: 0, A: 0, L: 0, partial: 0, incomplete: 0 };
    (rows || []).forEach(function (person) {
      Object.keys(out).forEach(function (key) { out[key] += Number(person.totals[key] || 0); });
    });
    return out;
  }

  function renderMonthly(state) {
    var wrap = byId('att-col-view-table-wrap');
    var actions = byId('att-col-view-actions');
    var title = byId('att-col-view-title');
    var summary = byId('att-col-view-summary');
    if (!wrap) return;
    if (!state || !state.rows.length) {
      wrap.innerHTML = '<p class="att-col-placeholder">منتخب افراد کے لیے کوئی رجسٹر دستیاب نہیں۔</p>';
      if (actions) actions.classList.add('att-col-hidden');
      return;
    }
    var totals = overallTotals(state.rows);
    state.totals = totals;
    wrap.innerHTML = tableHtml(state.rows, state, true);
    if (title) title.textContent = registerTitle(state);
    if (summary) summary.textContent = 'افراد: ' + state.rows.length
      + ' | حاضر: ' + totals.P + ' | غیر حاضر: ' + totals.A + ' | رخصت: ' + totals.L;
    if (actions) actions.classList.remove('att-col-hidden');
  }

  function loadMonthlyView() {
    var monthNode = byId('att-col-view-month');
    var month = String(monthNode && monthNode.value || '');
    var roles = selectedRoles();
    if (!validMonth(month)) return toast('درست مہینہ منتخب کریں', 'warning');
    if (!roles.length) return toast('طلباء، اساتذہ یا عملہ میں سے کم از کم ایک قسم منتخب کریں', 'warning');
    if (typeof global.attLoadCanonicalClassSheet !== 'function'
        || typeof global.attLoadStaffTypeSheet !== 'function') {
      return toast('حاضری کا مرکزی ریکارڈ ابھی تیار نہیں؛ صفحہ دوبارہ کھولیں', 'error');
    }

    var requestId = ++_viewRequest;
    var context = tenantContext();
    var mode = peopleMode();
    var scope = viewScope();
    setLoadBusy(true);
    // Resolve again at open time: a role, repository, or tenant may have changed
    // after the picker was rendered. This is read-only and prevents stale people.
    var rosterPromise = resolveRoster(roles, requestId, context, scope);
    rosterPromise.then(function (allRows) {
      if (requestId !== _viewRequest || !tenantContextMatches(context)) return null;
      var rows = allRows;
      if (mode === 'selected') {
        syncSelectedFromDom();
        rows = allRows.filter(function (person) { return !!_selected[person.key]; });
        if (!rows.length) throw new Error('NO_SELECTED_PEOPLE');
      }
      if (!rows.length) throw new Error('NO_PEOPLE');
      return loadSheetsForRows(month, rows, requestId, context).then(function (sheets) {
        return sheets ? { rows: rows, sheets: sheets } : null;
      });
    }).then(function (payload) {
      if (!payload || requestId !== _viewRequest || !tenantContextMatches(context)) return;
      var symbols = typeof global.attGetAttSymbols === 'function'
        ? global.attGetAttSymbols()
        : { P: 'P', A: 'A', L: 'L' };
      var dayCount = daysInMonth(month);
      var savedHolidays = holidays();
      payload.rows.forEach(function (person) {
        buildMarks(person, sheetForPerson(person, payload.sheets), month, dayCount, symbols, savedHolidays, scope);
      });
      _viewState = {
        month: month,
        dayCount: dayCount,
        roles: roles.slice(),
        scope: scope,
        rows: payload.rows.sort(sortPeople),
        tenant: context.tenant,
        generation: context.generation,
        createdAt: new Date()
      };
      renderMonthly(_viewState);
    }).catch(function (error) {
      if (requestId !== _viewRequest) return;
      if (error && error.message === 'NO_SELECTED_PEOPLE') {
        toast('کم از کم ایک فرد منتخب کریں', 'warning');
      } else if (error && error.message === 'NO_PEOPLE') {
        toast(scope.classId ? 'منتخب درجہ یا گھنٹے میں کوئی متعلقہ فرد نہیں ملا' : 'منتخب قسم میں کوئی فرد نہیں ملا', 'warning');
      } else {
        console.error('[EMS] collective month view', error);
        toast('ماہانہ حاضری لوڈ نہیں ہو سکی', 'error');
      }
    }).finally(function () {
      if (requestId === _viewRequest) setLoadBusy(false);
    });
  }

  function brandHeaderHtml() {
    try {
      return typeof global.attBrandHeaderHTML === 'function' ? global.attBrandHeaderHTML() : '';
    } catch (error) {
      return '';
    }
  }

  function signatureFooterHtml() {
    try {
      return typeof global.attSignFooterHTML === 'function' ? global.attSignFooterHTML() : '';
    } catch (error) {
      return '';
    }
  }

  function exportStyleHtml() {
    return '<style>'
      + '@page{size:A3 landscape;margin:7mm;}'
      + '.att-col-month-export-page{box-sizing:border-box;width:100%;min-height:270mm;padding:3mm;background:#fff;color:#0f172a;direction:rtl;page-break-after:always;break-after:page;}'
      + '.att-col-month-export-page:last-child{page-break-after:auto;break-after:auto;}'
      + '.att-col-month-export-page table{border-collapse:collapse;width:100%;table-layout:fixed;font-family:"Jameel Noori Nastaleeq","Noto Nastaliq Urdu",serif;font-size:8px;text-align:center;}'
      + '.att-col-month-export-page th,.att-col-month-export-page td{border:1px solid #64748b;padding:2px 1px;height:28px;vertical-align:middle;text-align:center;overflow:hidden;}'
      + '.att-col-month-export-page th{background:#1e293b!important;color:#fff!important;}'
      + '.att-col-month-export-page .att-col-month-name{width:40mm;text-align:right;padding-right:3px;}'
      + '.att-col-month-export-page .att-col-month-role{width:14mm;}.att-col-month-export-page .att-col-month-day{width:auto;}'
      + '.att-col-month-export-page .att-col-month-summary{width:7mm;font-weight:800;}'
      + '.att-col-month-export-page .att-col-month-day small,.att-col-month-person-meta{display:block;font-size:6px;}'
      + '.att-col-month-export-page .att-month-p{background:#dcfce7!important;color:#166534!important;font-weight:900;}'
      + '.att-col-month-export-page .att-month-a{background:#fee2e2!important;color:#b91c1c!important;font-weight:900;}'
      + '.att-col-month-export-page .att-month-l{background:#fef3c7!important;color:#92400e!important;font-weight:900;}'
      + '.att-col-month-export-page .att-month-partial{background:#dbeafe!important;color:#1d4ed8!important;font-weight:800;}'
      + '.att-col-month-export-page .att-month-incomplete{background:#f1f5f9!important;color:#475569!important;}'
      + '.att-col-month-export-page .att-month-holiday{background:#fff1f2!important;color:#be123c!important;padding:4px 0;vertical-align:middle;overflow:hidden;}'
      + '.att-col-month-export-page .att-month-holiday-text{display:inline-block;font-family:"Jameel Noori Nastaleeq","Noto Nastaliq Urdu",serif;font-weight:700;line-height:1.2;white-space:nowrap;transform:rotate(-90deg);transform-origin:center center;color:#be123c;}'
      + '.att-col-month-export-page .att-col-month-day-holiday{background:#9f1239!important;}'
      + '.att-col-month-export-title{text-align:center;margin:2px 0 5px;font-size:18px;font-family:"Jameel Noori Nastaleeq","Noto Nastaliq Urdu",serif;}'
      + '.att-col-month-export-meta{display:flex;justify-content:space-between;gap:8px;margin-bottom:5px;padding:4px 7px;border:1px solid #94a3b8;font:9px "Jameel Noori Nastaleeq","Noto Nastaliq Urdu",serif;}'
      + '.att-col-month-page-number{text-align:center;margin-top:4px;font:8px Arial,sans-serif;color:#64748b;}'
      + '*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}'
      + '</style>';
  }

  function exportPagesHtml(state) {
    var pages = [];
    for (var start = 0; start < state.rows.length; start += EXPORT_ROWS_PER_PAGE) {
      pages.push(state.rows.slice(start, start + EXPORT_ROWS_PER_PAGE));
    }
    var header = brandHeaderHtml();
    var footer = signatureFooterHtml();
    return exportStyleHtml() + pages.map(function (rows, index) {
      var pageNo = index + 1;
      return '<section class="att-col-month-export-page">'
        + header
        + '<h2 class="att-col-month-export-title">' + escHtml(registerTitle(state)) + '</h2>'
        + '<div class="att-col-month-export-meta"><span>اقسام: ' + escHtml(roleSummary(state.roles))
        + '</span><span>' + escHtml(scopeSummary(state)) + '</span><span>افراد: ' + state.rows.length
        + '</span><span>صفحہ: ' + pageNo + ' / ' + pages.length + '</span></div>'
        + tableHtml(rows, state, false)
        + (pageNo === pages.length ? footer : '')
        + '<div class="att-col-month-page-number">' + pageNo + ' / ' + pages.length + '</div>'
        + '</section>';
    }).join('');
  }

  function makeExportHost(state) {
    var old = byId('att-col-month-export-temp');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var host = global.document.createElement('div');
    host.id = 'att-col-month-export-temp';
    host.className = 'att-col-month-export-host';
    host.setAttribute('dir', 'rtl');
    host.innerHTML = exportPagesHtml(state);
    global.document.body.appendChild(host);
    return host;
  }

  function waitForExportAssets(host) {
    var tasks = [];
    if (global.document && global.document.fonts && global.document.fonts.ready) {
      tasks.push(Promise.resolve(global.document.fonts.ready).catch(function () {}));
    }
    if (host && host.querySelectorAll) {
      Array.prototype.forEach.call(host.querySelectorAll('img'), function (img) {
        if (img.complete) return;
        tasks.push(new Promise(function (resolve) {
          var done = false;
          function finish() {
            if (done) return;
            done = true;
            resolve();
          }
          img.addEventListener('load', finish, { once: true });
          img.addEventListener('error', finish, { once: true });
          global.setTimeout(finish, 2500);
        }));
      });
    }
    return Promise.all(tasks);
  }

  function printMonthly() {
    if (!_viewState || !_viewState.rows.length) return toast('پہلے ماہانہ حاضری دکھائیں', 'warning');
    if (!tenantContextMatches({ tenant: _viewState.tenant, generation: _viewState.generation })) {
      return toast('مدرسہ تبدیل ہو چکا ہے؛ ماہانہ حاضری دوبارہ لوڈ کریں', 'warning');
    }
    var host = makeExportHost(_viewState);
    if (typeof global.printDiv !== 'function') {
      if (host.parentNode) host.parentNode.removeChild(host);
      return toast('پرنٹ کی سہولت دستیاب نہیں', 'error');
    }
    global.printDiv(host.id);
    global.setTimeout(function () {
      if (host.parentNode) host.parentNode.removeChild(host);
    }, 2500);
  }

  function setPdfBusy(busy) {
    _pdfBusy = !!busy;
    var button = byId('btn-att-col-view-pdf');
    if (!button) return;
    button.disabled = !!busy;
    button.innerHTML = busy
      ? '<i class="fas fa-spinner fa-spin"></i> PDF بن رہی ہے…'
      : '<i class="fas fa-file-pdf"></i> PDF ڈاؤنلوڈ';
  }

  function exportMonthlyPdf() {
    if (_pdfBusy) return;
    if (!_viewState || !_viewState.rows.length) return toast('پہلے ماہانہ حاضری دکھائیں', 'warning');
    if (!tenantContextMatches({ tenant: _viewState.tenant, generation: _viewState.generation })) {
      return toast('مدرسہ تبدیل ہو چکا ہے؛ ماہانہ حاضری دوبارہ لوڈ کریں', 'warning');
    }
    if (typeof global.emsLoadPdfLibs !== 'function') return toast('PDF کی سہولت دستیاب نہیں', 'error');
    var state = _viewState;
    var host = null;
    setPdfBusy(true);
    global.emsLoadPdfLibs().then(function () {
      host = makeExportHost(state);
      return waitForExportAssets(host).then(function () {
        var pages = Array.prototype.slice.call(host.querySelectorAll('.att-col-month-export-page'));
        if (!pages.length) throw new Error('no export pages');
        var pdf = new global.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3', compress: true });
        var pageWidth = pdf.internal.pageSize.getWidth();
        var pageHeight = pdf.internal.pageSize.getHeight();
        var margin = 5;
        var chain = Promise.resolve();
        pages.forEach(function (page, index) {
          chain = chain.then(function () {
            return global.html2canvas(page, {
              scale: 1.2,
              useCORS: true,
              allowTaint: false,
              logging: false,
              backgroundColor: '#ffffff',
              windowWidth: Math.max(1560, page.scrollWidth || 1560)
            }).then(function (canvas) {
              if (index > 0) pdf.addPage('a3', 'landscape');
              var imageWidth = pageWidth - (margin * 2);
              var imageHeight = canvas.height * imageWidth / canvas.width;
              var maxHeight = pageHeight - (margin * 2);
              if (imageHeight > maxHeight) {
                imageHeight = maxHeight;
                imageWidth = canvas.width * imageHeight / canvas.height;
              }
              var x = (pageWidth - imageWidth) / 2;
              pdf.addImage(canvas.toDataURL('image/jpeg', 0.94), 'JPEG', x, margin, imageWidth, imageHeight, undefined, 'FAST');
            });
          });
        });
        return chain.then(function () {
          pdf.save('collective-attendance-' + state.month + '.pdf');
          toast('ماہانہ حاضری کی PDF تیار ہو گئی', 'success');
        });
      });
    }).catch(function (error) {
      console.error('[EMS] collective month PDF', error);
      toast('PDF تیار نہیں ہو سکی؛ پرنٹ کے ذریعے PDF محفوظ کی جا سکتی ہے', 'error');
    }).finally(function () {
      if (host && host.parentNode) host.parentNode.removeChild(host);
      setPdfBusy(false);
    });
  }

  function selectVisible(value) {
    visibleRoster().forEach(function (person) {
      if (value) _selected[person.key] = true;
      else delete _selected[person.key];
    });
    renderPicker();
  }

  function clearSelection() {
    _selected = Object.create(null);
    renderPicker();
  }

  function invalidateRenderedView(message) {
    _viewState = null;
    var actions = byId('att-col-view-actions');
    var wrap = byId('att-col-view-table-wrap');
    if (actions) actions.classList.add('att-col-hidden');
    if (wrap) {
      wrap.innerHTML = '<p class="att-col-placeholder">'
        + escHtml(message || 'نئے انتخاب کے مطابق «ماہانہ حاضری دکھائیں» دوبارہ دبائیں۔')
        + '</p>';
    }
  }

  function bind() {
    if (_bound || !root()) return;
    _bound = true;
    var panel = root();
    panel.addEventListener('click', function (event) {
      var modeButton = event.target && event.target.closest ? event.target.closest('[data-att-col-mode]') : null;
      if (modeButton) {
        event.preventDefault();
        setMode(modeButton.getAttribute('data-att-col-mode'));
        return;
      }
      var open = event.target && event.target.closest ? event.target.closest('#btn-att-col-view-open') : null;
      if (open) { event.preventDefault(); loadMonthlyView(); return; }
      var all = event.target && event.target.closest ? event.target.closest('#btn-att-col-view-select-all') : null;
      if (all) { event.preventDefault(); selectVisible(true); return; }
      var clear = event.target && event.target.closest ? event.target.closest('#btn-att-col-view-clear') : null;
      if (clear) { event.preventDefault(); clearSelection(); return; }
      var print = event.target && event.target.closest ? event.target.closest('#btn-att-col-view-print') : null;
      if (print) { event.preventDefault(); printMonthly(); return; }
      var pdf = event.target && event.target.closest ? event.target.closest('#btn-att-col-view-pdf') : null;
      if (pdf) { event.preventDefault(); exportMonthlyPdf(); }
    });
    panel.addEventListener('change', function (event) {
      var target = event.target;
      if (!target) return;
      if (target.name === 'att_col_view_role') {
        syncScopeControls();
        invalidateRenderedView();
        refreshPicker();
      } else if (target.name === 'att_col_view_people') {
        invalidateRenderedView();
        refreshPicker();
      } else if (target.id === 'att-col-view-class') {
        fillViewPeriodSelect();
        updateScopeNote();
        invalidateRenderedView();
        refreshPicker();
      } else if (target.id === 'att-col-view-period') {
        updateScopeNote();
        invalidateRenderedView();
        refreshPicker();
      } else if (target.id === 'att-col-view-month') {
        invalidateRenderedView();
      } else if (target.hasAttribute && target.hasAttribute('data-att-col-person')) {
        syncSelectedFromDom();
        invalidateRenderedView();
      }
    });
    panel.addEventListener('input', function (event) {
      if (event.target && event.target.id === 'att-col-view-search') renderPicker();
    });
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('ems:repository-ready', function () {
        if (_mode !== 'view') return;
        syncScopeControls();
        if (peopleMode() === 'selected') refreshPicker();
      });
      global.addEventListener('ems:users-changed', function () {
        if (_mode !== 'view') return;
        syncScopeControls();
        invalidateRenderedView('افراد یا درجات کی فہرست بدلی ہے؛ ماہانہ حاضری دوبارہ لوڈ کریں۔');
        if (peopleMode() === 'selected') refreshPicker();
      });
      global.addEventListener('ems:tenant-changed', function () {
        _roster = [];
        _selected = Object.create(null);
        _viewState = null;
        var actions = byId('att-col-view-actions');
        var wrap = byId('att-col-view-table-wrap');
        if (actions) actions.classList.add('att-col-hidden');
        if (wrap) wrap.innerHTML = '<p class="att-col-placeholder">مدرسہ تبدیل ہوا ہے؛ ماہانہ حاضری دوبارہ لوڈ کریں۔</p>';
        if (_mode === 'view') {
          syncScopeControls();
          refreshPicker();
        }
      });
    }
  }

  function boot() {
    bind();
    var month = byId('att-col-view-month');
    if (month && !month.value) month.value = todayMonth();
    syncScopeControls();
  }

  global.attCollectiveViewBoot = boot;
  global.attCollectiveViewSetMode = setMode;
  global.attCollectiveViewDaysInMonth = daysInMonth;
  global.attCollectiveViewStatusKind = statusKind;
  global.attCollectiveViewBuildPages = exportPagesHtml;
  global.attCollectiveViewRawDayStatus = rawDayStatus;
  global.attCollectiveViewFilterUsersForScope = filterUsersForScope;

  if (typeof global.emsRunWhenDomReady === 'function') {
    global.emsRunWhenDomReady(boot);
  } else if (global.document && global.document.readyState !== 'loading') {
    boot();
  } else if (global.document) {
    global.document.addEventListener('DOMContentLoaded', boot);
  }
})(typeof window !== 'undefined' ? window : globalThis);
