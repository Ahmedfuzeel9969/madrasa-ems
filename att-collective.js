// ============================================================================
// اجتماعی حاضری — ایک روزہ گھنٹہ وار رجسٹر (مرکزی periodRecords کے ساتھ)
// ============================================================================
(function (global) {
  'use strict';

  var PAGE_SIZE = 50;
  var COL_SHEET_SHARED = '__col_shared__';
  var _bound = false;
  var _state = null;
  var _undo = null;
  var _saving = false;

  function toast(msg, type) {
    if (typeof global.showToast === 'function') global.showToast(msg, type || 'info');
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escJs(s) {
    if (typeof global.attEscJsStr === 'function') return global.attEscJsStr(s);
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  function todayIso() {
    var d = new Date();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function monthOf(dateStr) {
    return String(dateStr || '').substring(0, 7);
  }

  function dayNumOf(dateStr) {
    var p = String(dateStr || '').split('-');
    return Number(p[2]) || 0;
  }

  function weekdayOf(dateStr) {
    return new Date(dateStr).getDay();
  }

  function symbols() {
    return typeof global.attGetAttSymbols === 'function'
      ? global.attGetAttSymbols()
      : { P: 'P', A: 'A', L: 'L' };
  }

  /** Canonical P/A/L from stored mark — styling symbol text پر منحصر نہیں */
  function statusKind(st) {
    if (st == null || st === '') return '';
    var sym = symbols();
    if (st === sym.P || st === 'P') return 'P';
    if (st === sym.A || st === 'A') return 'A';
    if (st === sym.L || st === 'L') return 'L';
    return '';
  }

  function symForKind(kind) {
    var sym = symbols();
    if (kind === 'P') return sym.P;
    if (kind === 'A') return sym.A;
    if (kind === 'L') return sym.L;
    return '';
  }

  function holidays() {
    try {
      var list = JSON.parse(localStorage.getItem('ems_att_holidays') || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function isBlockedDate(dateStr) {
    var wd = weekdayOf(dateStr);
    if (wd === 5) return { blocked: true, reason: 'جمعہ — تعطیل' };
    var hols = holidays();
    for (var i = 0; i < hols.length; i++) {
      var h = hols[i];
      if (h && dateStr >= h.start && dateStr <= h.end) {
        return { blocked: true, reason: (h.title || 'تعطیل') };
      }
    }
    return { blocked: false, reason: '' };
  }

  function collectiveRoot() {
    return global.document && global.document.getElementById
      ? global.document.getElementById('att-collective-register')
      : null;
  }

  function scopeValue() {
    var root = collectiveRoot();
    var el = root && root.querySelector
      ? root.querySelector('input[name="att_col_scope"]:checked')
      : null;
    return el ? el.value : 'all';
  }

  function registerTypeValue() {
    var root = collectiveRoot();
    var el = root && root.querySelector
      ? root.querySelector('input[name="att_col_register_type"]:checked')
      : null;
    return el ? el.value : 'students';
  }

  function syncRegisterTypeUi() {
    var regType = registerTypeValue();
    var scopePanel = document.getElementById('att-col-scope-panel');
    var staffNote = document.getElementById('att-col-staff-note');
    var labelWrap = document.getElementById('att-col-label-mode-wrap');
    var labelSel = document.getElementById('att-col-label-mode');
    var allLbl = document.getElementById('att-col-scope-all-label');
    var oneLbl = document.getElementById('att-col-scope-one-label');
    var multiLbl = document.getElementById('att-col-scope-multi-label');
    if (scopePanel) scopePanel.classList.toggle('att-col-hidden', regType === 'staff');
    if (staffNote) staffNote.classList.toggle('att-col-hidden', regType !== 'staff');
    if (regType === 'students') {
      if (allLbl) allLbl.textContent = 'تمام طلباء';
      if (oneLbl) oneLbl.textContent = 'ایک درجہ';
      if (multiLbl) multiLbl.textContent = 'ایک سے زیادہ درجات';
      if (labelWrap) labelWrap.classList.remove('att-col-hidden');
      if (labelSel) {
        labelSel.innerHTML = '<option value="book">کتاب یا مضمون کا نام</option>'
          + '<option value="teacher">استاد کا نام</option>';
      }
    } else if (regType === 'teachers') {
      if (allLbl) allLbl.textContent = 'تمام اساتذہ';
      if (oneLbl) oneLbl.textContent = 'ایک درجہ (وہ اساتذہ جو پڑھاتے ہیں)';
      if (multiLbl) multiLbl.textContent = 'متعدد درجات کے اساتذہ';
      if (labelWrap) labelWrap.classList.remove('att-col-hidden');
      if (labelSel) {
        labelSel.innerHTML = '<option value="period">گھنٹے کا نام</option>'
          + '<option value="class">درجہ / کلاس</option>'
          + '<option value="book">کتاب / مضمون</option>';
      }
    } else {
      if (labelWrap) labelWrap.classList.add('att-col-hidden');
    }
    syncScopeUi();
  }

  function selectedClassIds() {
    var regType = registerTypeValue();
    if (regType === 'staff') return [];
    var scope = scopeValue();
    var all = typeof global.attListAttendanceClasses === 'function'
      ? global.attListAttendanceClasses()
      : [];
    if (scope === 'all') return all.slice();
    if (scope === 'one') {
      var one = document.getElementById('att-col-class-one');
      return one && one.value ? [one.value] : [];
    }
    var picked = [];
    document.querySelectorAll('#att-col-class-list input[type="checkbox"]:checked').forEach(function (cb) {
      if (cb.value) picked.push(cb.value);
    });
    return picked;
  }

  function fillClassOneSelect(classes) {
    classes = classes || (typeof global.attListAttendanceClasses === 'function'
      ? global.attListAttendanceClasses() : []);
    var sel = document.getElementById('att-col-class-one');
    if (!sel) return;
    var curr = sel.value;
    var html = '<option value="">درجہ منتخب کریں...</option>' + classes.map(function (c) {
      return '<option value="' + escHtml(c) + '">' + escHtml(c) + '</option>';
    }).join('');
    sel.innerHTML = html;
    if (curr && classes.indexOf(curr) >= 0) sel.value = curr;
  }

  function fillClasses(classes) {
    classes = classes || (typeof global.attListAttendanceClasses === 'function'
      ? global.attListAttendanceClasses() : []);
    fillClassOneSelect(classes);
    var box = document.getElementById('att-col-class-list');
    if (!box) return;
    var prev = {};
    box.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      if (cb.checked) prev[cb.value] = true;
    });
    box.innerHTML = classes.map(function (c) {
      var checked = prev[c] ? ' checked' : '';
      return '<label><input type="checkbox" value="' + escHtml(c) + '"' + checked + '> ' + escHtml(c) + '</label>';
    }).join('') || '<span style="color:#94a3b8;">کوئی درجہ نہیں ملا</span>';
  }

  function refreshFilters() {
    fillClasses();
    syncRegisterTypeUi();
    syncAutoDate();
  }

  function syncScopeUi() {
    var scope = scopeValue();
    var oneWrap = document.getElementById('att-col-one-wrap');
    var multiWrap = document.getElementById('att-col-multi-wrap');
    if (oneWrap) oneWrap.classList.toggle('att-col-hidden', scope !== 'one');
    if (multiWrap) multiWrap.classList.toggle('att-col-hidden', scope !== 'multi');
  }

  function syncAutoDate() {
    var auto = document.getElementById('att-col-auto-date');
    var dateEl = document.getElementById('att-col-date');
    if (!dateEl) return;
    var on = !!(auto && auto.checked);
    if (on) dateEl.value = todayIso();
    dateEl.disabled = on;
    dateEl.readOnly = on;
    dateEl.style.pointerEvents = on ? 'none' : '';
  }

  function periodLabel(p, mode, regType) {
    if (!p) return '';
    if (regType === 'teachers') {
      if (mode === 'class') return p.className && p.className !== '-' ? p.className : 'درجہ؟';
      if (mode === 'book') return (p.bookName && p.bookName !== '-') ? p.bookName : (p.name || 'مضمون');
      return p.name || 'گھنٹہ';
    }
    if (mode === 'teacher') return p.teacherName || 'استاد؟';
    var book = p.bookName && p.bookName !== '-' ? p.bookName : '';
    return book || p.name || 'مضمون';
  }

  function periodMeta(p, mode, regType) {
    var parts = [];
    if (regType === 'teachers') {
      if (mode !== 'class' && p.className && p.className !== '-') parts.push(p.className);
      if (mode !== 'book' && p.bookName && p.bookName !== '-') parts.push(p.bookName);
      var time = (p.start ? p.start : '') + (p.end ? '–' + p.end : '');
      if (time) parts.push(time);
      return parts.join(' · ');
    }
    if (mode !== 'teacher' && p.teacherName) parts.push(p.teacherName);
    if (mode === 'teacher' && p.bookName && p.bookName !== '-') parts.push(p.bookName);
    var time2 = (p.start ? p.start : '') + (p.end ? '–' + p.end : '');
    if (time2) parts.push(time2);
    return parts.join(' · ');
  }

  function studentPeriods(className, weekday) {
    if (typeof global.attStudentPeriodsForWeekday !== 'function') return [];
    return global.attStudentPeriodsForWeekday(className, weekday) || [];
  }

  function teacherPeriods(uid, name, weekday) {
    if (typeof global.attTeacherPeriodsForWeekday !== 'function') return [];
    return global.attTeacherPeriodsForWeekday(uid, name, weekday) || [];
  }

  function rosterLabel(regType) {
    if (regType === 'teachers') return 'اساتذہ';
    if (regType === 'staff') return 'عملہ';
    return 'طلبہ';
  }

  function cloneData(data) {
    try {
      return JSON.parse(JSON.stringify(data || {}));
    } catch (e) {
      return data;
    }
  }

  function sheetLocked(sheet, day) {
    if (!sheet || !sheet.data) return false;
    if (sheet.data.locked) return true;
    var locks = sheet.data.dailyLocks || {};
    return !!(locks[day] || locks[String(day)]);
  }

  function setSaving(on) {
    _saving = !!on;
    var savingEl = document.getElementById('att-col-saving');
    if (savingEl) savingEl.classList.toggle('att-col-hidden', !on);
    document.querySelectorAll('#att-col-register-strip .att-cell-btn, #att-col-table .att-cell-btn').forEach(function (btn) {
      btn.disabled = on || btn.getAttribute('data-col-disabled') === '1';
    });
    var undoBtn = document.getElementById('btn-att-col-undo');
    if (undoBtn && on) undoBtn.disabled = true;
    else if (undoBtn && !on) undoBtn.disabled = !_undo;
  }

  function confirmBulk(personCount, periodCount, actionLabel, regType) {
    var noun = rosterLabel(regType || (_state && _state.registerType) || 'students');
    return confirm(
      actionLabel +
      '\n\nمتاثر ' + noun + ': ' + personCount +
      (periodCount > 1 || (_state && _state.registerType === 'staff') ? '' : ('\nمتاثر گھنٹے: ' + periodCount)) +
      (periodCount > 1 ? ('\nمتاثر گھنٹے: ' + periodCount) : '') +
      '\n\nجاری رکھیں؟'
    );
  }

  function pushUndo(snapshots, label) {
    _undo = { snapshots: snapshots, label: label || '' };
    var btn = document.getElementById('btn-att-col-undo');
    if (btn && !_saving) btn.disabled = false;
  }

  function snapshotSheets(classIds) {
    var out = {};
    if (_state && (_state.registerType === 'teachers' || _state.registerType === 'staff')) {
      var sh = _state.sheets && _state.sheets[COL_SHEET_SHARED];
      if (sh) out[COL_SHEET_SHARED] = cloneData(sh.data);
      return out;
    }
    (classIds || []).forEach(function (cid) {
      var sh = _state && _state.sheets && _state.sheets[cid];
      if (sh) out[cid] = cloneData(sh.data);
    });
    return out;
  }

  function rowSheet(row) {
    if (!_state || !row) return null;
    if (_state.registerType === 'teachers' || _state.registerType === 'staff') {
      return _state.sheets[COL_SHEET_SHARED];
    }
    return _state.sheets[row.className];
  }

  function persistSheet(sheet, opts) {
    if (!sheet || typeof global.attPersistSheetPayload !== 'function') return false;
    var data = sheet.data;
    data.timestamp = Date.now();
    data.records = typeof global.attPruneDayStatusMap === 'function'
      ? global.attPruneDayStatusMap(data.records || {}) : (data.records || {});
    data.periodRecords = typeof global.attPrunePeriodRecordsMap === 'function'
      ? global.attPrunePeriodRecordsMap(data.periodRecords || {}) : (data.periodRecords || {});
    var keys = sheet.keys || {};
    var docId = keys.cloudDocId || keys.localKey;
    if (typeof global.attSaveStatusMarkLocal === 'function' && docId) {
      global.attSaveStatusMarkLocal(docId, 'writing');
    }
    var ok = global.attPersistSheetPayload(keys, data, Object.assign(
      { quiet: true, deferCloud: true, flushDeferred: false, classId: sheet.classId, month: _state && _state.month },
      opts || {}
    ));
    if (typeof global.attSaveStatusMarkLocal === 'function' && docId) {
      global.attSaveStatusMarkLocal(docId, ok ? 'saved' : 'failed');
    }
    return ok;
  }

  function writeMark(row, period, status) {
    if (!_state || !row) return false;
    var sheet = rowSheet(row);
    if (!sheet) return false;
    if (sheetLocked(sheet, _state.day)) return false;
    if (_state.registerType === 'staff') {
      if (typeof global.attWriteDayMarkOnSheetData === 'function') {
        global.attWriteDayMarkOnSheetData(sheet.data, row.uid, _state.day, status || '');
        return true;
      }
      return false;
    }
    if (!period) return false;
    var ids = (row.periods || []).map(function (p) { return p.id; });
    if (typeof global.attWritePeriodOnSheetData === 'function') {
      global.attWritePeriodOnSheetData(sheet.data, row.uid, _state.day, period.id, status, ids);
      return true;
    }
    return false;
  }

  function currentStatus(row, period) {
    if (!_state || !row) return '';
    var sheet = rowSheet(row);
    if (!sheet || !sheet.data) return '';
    if (_state.registerType === 'staff') {
      return (sheet.data.records && sheet.data.records[row.uid]
        && sheet.data.records[row.uid][_state.day]) || '';
    }
    if (!period || !sheet.data.periodRecords) return '';
    var pmap = sheet.data.periodRecords[row.uid] && sheet.data.periodRecords[row.uid][_state.day];
    return (pmap && pmap[period.id]) || '';
  }

  function studentAggregateKind(row) {
    var kinds = [];
    (row.periods || []).forEach(function (p) {
      kinds.push(statusKind(currentStatus(row, p)));
    });
    if (!kinds.length) return '';
    var filled = kinds.filter(function (k) { return !!k; });
    if (!filled.length) return '';
    var first = filled[0];
    if (filled.length !== kinds.length) return '';
    return filled.every(function (k) { return k === first; }) ? first : '';
  }

  function collectTargets(status, uid, periodId) {
    if (!_state) return [];
    var symStatus = status ? symForKind(statusKind(status) || status) : '';
    if (status && !symStatus) symStatus = status;
    var out = [];
    _state.rows.forEach(function (row) {
      if (uid && row.uid !== uid) return;
      var sheet = rowSheet(row);
      if (sheetLocked(sheet, _state.day)) return;
      if (_state.registerType === 'staff') {
        var curStaff = currentStatus(row, null);
        var nextStaff = symStatus || '';
        if (curStaff !== nextStaff) out.push({ row: row, period: null, from: curStaff, to: nextStaff });
        return;
      }
      (row.periods || []).forEach(function (p) {
        if (periodId && p.id !== periodId) return;
        var cur = currentStatus(row, p);
        var next = symStatus || '';
        if (cur === next) return;
        out.push({ row: row, period: p, from: cur, to: next });
      });
    });
    return out;
  }

  function resultMessage(scope, statusKindVal, personCount, periodCount, regType) {
    var noun = rosterLabel(regType || (_state && _state.registerType) || 'students');
    var oneNoun = regType === 'teachers' ? 'اس استاد' : (regType === 'staff' ? 'اس عملے کے رکن' : 'اس طالب علم');
    if (scope === 'period') {
      if (!statusKindVal) return 'صرف یہ گھنٹہ صاف کردیا گیا۔';
      if (statusKindVal === 'P') return 'صرف یہ گھنٹہ حاضر کردیا گیا۔';
      if (statusKindVal === 'A') return 'صرف یہ گھنٹہ غیر حاضر کردیا گیا۔';
      return 'صرف یہ گھنٹہ رخصت کردیا گیا۔';
    }
    if (!statusKindVal) {
      if (scope === 'student') {
        if (regType === 'staff') return oneNoun + ' کی حاضری صاف کردی گئی۔';
        return oneNoun + ' کے ' + periodCount + ' گھنٹے صاف کردیے گئے۔';
      }
      return personCount + ' ' + noun + ' کے تمام گھنٹے صاف کردیے گئے۔';
    }
    var verb = statusKindVal === 'P' ? 'حاضر' : (statusKindVal === 'A' ? 'غیر حاضر' : 'رخصت');
    if (scope === 'student') {
      if (regType === 'staff') return oneNoun + ' کو ' + verb + ' کردیا گیا۔';
      return oneNoun + ' کے ' + periodCount + ' گھنٹے ' + verb + ' کردیے گئے۔';
    }
    return personCount + ' ' + noun + ' کے تمام گھنٹے ' + verb + ' کردیے گئے۔';
  }

  function applyTargets(targets, status, undoLabel, scope) {
    if (!targets.length) {
      toast('پہلے سے یہی حالت ہے — کوئی تبدیلی نہیں', 'info');
      return;
    }
    var classSet = {};
    targets.forEach(function (t) {
      if (_state.registerType === 'teachers' || _state.registerType === 'staff') {
        classSet[COL_SHEET_SHARED] = true;
      } else {
        classSet[t.row.className] = true;
      }
    });
    var stuSet = {};
    targets.forEach(function (t) { stuSet[t.row.uid] = true; });
    var studentCount = Object.keys(stuSet).length;
    var periodCount = targets.length;
    var symStatus = status ? symForKind(statusKind(status) || status) : '';
    if (status && !symStatus) symStatus = status;
    var kindVal = statusKind(symStatus);

    setSaving(true);
    pushUndo(snapshotSheets(Object.keys(classSet)), undoLabel);
    targets.forEach(function (t) {
      writeMark(t.row, t.period, symStatus || '');
    });
    Object.keys(classSet).forEach(function (cid) {
      var sheet = _state.sheets[cid];
      if (!sheet) return;
      var persistOpts = { quiet: true, deferCloud: true, flushDeferred: false };
      if (cid !== COL_SHEET_SHARED) {
        persistOpts.classId = sheet.classId;
        persistOpts.month = _state.month;
      }
      persistSheet(sheet, persistOpts);
    });
    if (typeof global.attFlushAllDeferredCloud === 'function') {
      global.attFlushAllDeferredCloud();
    }
    renderTable();
    setSaving(false);
    toast(resultMessage(scope || 'all', kindVal, studentCount, periodCount, _state.registerType), 'success');
  }

  function setStatus(status, uid, periodId, actionLabel, scope) {
    if (!_state || _saving) return;
    if (_state.blocked) {
      toast(_state.blockReason || 'اس دن حاضری نہیں ہو سکتی', 'warning');
      return;
    }
    var targets = collectTargets(status, uid, periodId);
    var stuSet = {};
    targets.forEach(function (t) { stuSet[t.row.uid] = true; });
    var studentCount = Object.keys(stuSet).length;
    var periodCount = targets.length;
    var isBulkAll = scope === 'all' && periodCount > 1;
    if (isBulkAll) {
      if (!confirmBulk(studentCount, periodCount, actionLabel || 'اجتماعی حاضری', _state.registerType)) return;
    }
    applyTargets(targets, status, actionLabel, scope || (periodId ? 'period' : (uid ? 'student' : 'all')));
  }

  function renderRegisterStripButtons() {
    var sym = symbols();
    var host = document.getElementById('att-col-bulk-all');
    if (!host) return;
    var blocked = _state && _state.blocked;
    var disabled = blocked || _saving;
    var disAttr = disabled ? ' disabled' : '';
    var disData = blocked ? ' data-col-disabled="1"' : '';
    host.className = 'att-cell-controls att-col-register-controls';
    host.innerHTML =
      '<button type="button" class="att-cell-btn" style="color:green;border-color:green;" data-col-all="P"' + disAttr + disData + '>'
      + escHtml(sym.P) + '</button>'
      + '<button type="button" class="att-cell-btn" style="color:red;border-color:red;" data-col-all="A"' + disAttr + disData + '>'
      + escHtml(sym.A) + '</button>'
      + '<button type="button" class="att-cell-btn" style="color:orange;border-color:orange;" data-col-all="L"' + disAttr + disData + '>'
      + escHtml(sym.L) + '</button>'
      + '<button type="button" class="att-cell-btn status-clear" data-col-all="" title="صاف / خالی"' + disAttr + disData + '>×</button>';
  }

  function markBtn(scope, uid, periodId, activeKind, currentSt) {
    var sym = symbols();
    var marks = [
      { kind: 'P', sym: sym.P, cls: 'status-p' },
      { kind: 'A', sym: sym.A, cls: 'status-a' },
      { kind: 'L', sym: sym.L, cls: 'status-l' },
      { kind: '', sym: '×', cls: 'status-clear' }
    ];
    var html = '<div class="att-cell-controls">';
    marks.forEach(function (m) {
      var active = '';
      if (scope === 'period') {
        if (m.kind === 'P') active = currentSt === sym.P ? ' active' : '';
        else if (m.kind === 'A') active = currentSt === sym.A ? ' active' : '';
        else if (m.kind === 'L') active = currentSt === sym.L ? ' active' : '';
        else active = !currentSt ? ' active' : '';
      } else if (scope === 'student') {
        if (m.kind === 'P') active = activeKind === 'P' ? ' active' : '';
        else if (m.kind === 'A') active = activeKind === 'A' ? ' active' : '';
        else if (m.kind === 'L') active = activeKind === 'L' ? ' active' : '';
        else active = !activeKind ? ' active' : '';
      }
      var call = scope === 'student'
        ? 'attColSetStudent(\'' + escJs(uid) + '\', \'' + escJs(m.kind) + '\')'
        : 'attColSetPeriod(\'' + escJs(uid) + '\', \'' + escJs(periodId) + '\', \'' + escJs(m.kind) + '\')';
      html += '<button type="button" class="att-cell-btn ' + m.cls + active + '"'
        + (m.kind === '' ? ' title="صاف / خالی"' : '')
        + ' onclick="event.stopPropagation(); ' + call + '">' + escHtml(m.sym) + '</button>';
    });
    html += '</div>';
    return html;
  }

  function renderTable() {
    var wrap = document.getElementById('att-col-table-wrap');
    var pager = document.getElementById('att-col-pager');
    var strip = document.getElementById('att-col-register-strip');
    var summary = document.getElementById('att-col-summary');
    if (!wrap || !_state) return;
    if (strip) strip.classList.remove('att-col-hidden');
    var rows = _state.rows || [];
    var maxP = 0;
    rows.forEach(function (r) {
      if (r.periods.length > maxP) maxP = r.periods.length;
    });
    _state.maxPeriods = maxP;
    if (summary) {
      var regLbl = rosterLabel(_state.registerType);
      var scopeTxt = _state.registerType === 'staff'
        ? 'تمام عملہ'
        : ('درجات: ' + (_state.classIds.length || '—'));
      summary.textContent = regLbl + ': ' + rows.length + ' · ' + scopeTxt
        + ' · تاریخ: ' + _state.date;
    }

    if (!rows.length) {
      var emptyMsg = _state.registerType === 'teachers'
        ? 'منتخب درجات میں کوئی استاد نہیں ملا (نظام الاوقات چیک کریں)'
        : (_state.registerType === 'staff'
          ? 'کوئی عملہ ریکارڈ نہیں ملا'
          : 'منتخب درجات میں کوئی طالب علم نہیں ملا');
      wrap.innerHTML = '<p class="att-col-placeholder">' + emptyMsg + '</p>';
      if (pager) pager.classList.add('att-col-hidden');
      return;
    }

    var totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (_state.page > totalPages) _state.page = totalPages;
    var start = (_state.page - 1) * PAGE_SIZE;
    var pageRows = rows.slice(start, start + PAGE_SIZE);
    var isStaff = _state.registerType === 'staff';
    var isTeacher = _state.registerType === 'teachers';
    var nameHead = isStaff ? 'عملے کا نام' : (isTeacher ? 'استاد کا نام' : 'طالب علم کا نام');
    var head = '<th class="att-col-name">' + nameHead + '</th>';
    if (isStaff) {
      head += '<th>روزانہ حاضری</th>';
    } else {
      for (var i = 0; i < maxP; i++) {
        head += '<th>گھنٹہ ' + (i + 1) + '</th>';
      }
      if (!maxP) head += '<th>گھنٹے</th>';
    }

    var sym = symbols();
    var body = pageRows.map(function (row) {
      var locked = _state.blocked || sheetLocked(rowSheet(row), _state.day);
      var aggKind = studentAggregateKind(row);
      var rowActionLabel = isStaff ? 'اس رکن کی حاضری' : (isTeacher ? 'اس استاد کے تمام گھنٹے' : 'اس طالب علم کے تمام گھنٹے');
      var stuActions = locked ? '' : (
        '<div class="att-col-stu-actions">'
        + '<div class="att-col-stu-actions-title">' + rowActionLabel + '</div>'
        + markBtn('student', row.uid, '', aggKind)
        + '</div>'
      );
      var subLine = row.uid + (row.subLabel ? (' · ' + row.subLabel) : (row.className ? (' · ' + row.className) : ''));
      var nameCell = '<td class="att-col-name"><div class="att-col-stu-name">' + escHtml(row.name) + '</div>'
        + '<div class="att-col-stu-sub">' + escHtml(subLine) + '</div>'
        + stuActions
        + '</td>';
      var cells = '';
      if (isStaff) {
        var stStaff = currentStatus(row, null);
        var cellClass = 'att-col-period';
        if (!stStaff) cellClass += ' att-cell-empty';
        else if (stStaff === sym.P) cellClass += ' att-cell-p';
        else if (stStaff === sym.A) cellClass += ' att-cell-a';
        else if (stStaff === sym.L) cellClass += ' att-cell-l';
        cells = '<td class="' + cellClass + '">'
          + (locked ? '<div>' + escHtml(stStaff || '—') + '</div>' : markBtn('period', row.uid, '__day__', '', stStaff))
          + '</td>';
      } else if (!row.periods.length) {
        cells = '<td colspan="' + Math.max(1, maxP) + '" class="att-col-empty-period">اس دن نظام الاوقات میں کوئی گھنٹہ نہیں</td>';
      } else {
        for (var pi = 0; pi < maxP; pi++) {
          var p = row.periods[pi];
          if (!p) {
            cells += '<td class="att-col-period"></td>';
            continue;
          }
          var st = currentStatus(row, p);
          var cellClass2 = 'att-col-period';
          if (!st) cellClass2 += ' att-cell-empty';
          else if (st === sym.P) cellClass2 += ' att-cell-p';
          else if (st === sym.A) cellClass2 += ' att-cell-a';
          else if (st === sym.L) cellClass2 += ' att-cell-l';
          var meta = periodMeta(p, _state.labelMode, _state.registerType);
          cells += '<td class="' + cellClass2 + '">'
            + '<div class="att-col-period-label">' + escHtml(periodLabel(p, _state.labelMode, _state.registerType)) + '</div>'
            + (meta ? '<div class="att-col-period-meta">' + escHtml(meta) + '</div>' : '')
            + (locked
              ? '<div>' + escHtml(st || '—') + '</div>'
              : markBtn('period', row.uid, p.id, '', st))
            + '</td>';
        }
      }
      return '<tr>' + nameCell + cells + '</tr>';
    }).join('');

    wrap.innerHTML = '<table class="data-table" id="att-col-table"><thead><tr>' + head + '</tr></thead><tbody>'
      + body + '</tbody></table>';

    if (pager) {
      if (totalPages > 1) {
        pager.classList.remove('att-col-hidden');
        pager.innerHTML = '<span>صفحہ ' + _state.page + ' / ' + totalPages + '</span> '
          + '<button type="button" class="btn btn-outline btn-sm" ' + (_state.page <= 1 ? 'disabled' : '')
          + ' onclick="attColGotoPage(' + (_state.page - 1) + ')">پچھلا</button> '
          + '<button type="button" class="btn btn-outline btn-sm" ' + (_state.page >= totalPages ? 'disabled' : '')
          + ' onclick="attColGotoPage(' + (_state.page + 1) + ')">اگلا</button>';
      } else {
        pager.classList.add('att-col-hidden');
      }
    }

    renderRegisterStripButtons();

    var notice = document.getElementById('att-col-notice');
    if (notice) {
      if (_state.blocked) {
        notice.textContent = _state.blockReason + ' — اس دن حاضری نہیں لگے گی۔';
        notice.classList.remove('att-col-hidden');
      } else {
        notice.classList.add('att-col-hidden');
      }
    }
    setSaving(_saving);
  }

  var _opening = false;

  function openRegister() {
    if (_opening) return;
    var dateEl = document.getElementById('att-col-date');
    var auto = document.getElementById('att-col-auto-date');
    if (auto && auto.checked) syncAutoDate();
    var dateStr = dateEl && dateEl.value ? dateEl.value : todayIso();
    if (!dateStr) return toast('تاریخ منتخب کریں', 'error');
    refreshFilters();
    var regType = registerTypeValue();
    var classIds = selectedClassIds();
    var scope = scopeValue();
    if (regType === 'students' || regType === 'teachers') {
      if (scope === 'all' && !classIds.length) {
        return toast('کوئی درجہ نہیں ملا — رجسٹریشن چیک کریں', 'error');
      }
      if (scope === 'one' && !classIds.length) return toast('ایک درجہ منتخب کریں', 'error');
      if (scope === 'multi' && !classIds.length) return toast('کم از کم ایک درجہ چیک کریں', 'error');
    }
    var modeEl = document.getElementById('att-col-label-mode');
    var labelMode = modeEl ? modeEl.value : 'book';
    var month = monthOf(dateStr);
    var day = dayNumOf(dateStr);
    var weekday = weekdayOf(dateStr);
    var block = isBlockedDate(dateStr);

    toast('رجسٹر تیار ہو رہا ہے…', 'info');
    _opening = true;

    function finish(rows, sheets, scopeClassIds) {
      rows.sort(function (a, b) {
        var c = String(a.name || '').localeCompare(String(b.name || ''), 'ur');
        if (c) return c;
        return String(a.uid).localeCompare(String(b.uid));
      });
      _state = {
        registerType: regType,
        date: dateStr,
        month: month,
        day: day,
        weekday: weekday,
        classIds: scopeClassIds || classIds,
        labelMode: labelMode,
        rows: rows,
        sheets: sheets,
        page: 1,
        blocked: block.blocked,
        blockReason: block.reason,
        maxPeriods: 0
      };
      var docIds = [];
      if (regType === 'teachers' || regType === 'staff') {
        var sh = sheets[COL_SHEET_SHARED];
        if (sh && sh.keys) docIds.push(sh.keys.cloudDocId || sh.keys.localKey);
      } else {
        (scopeClassIds || classIds).forEach(function (cid) {
          var sh2 = sheets[cid];
          if (sh2 && sh2.keys) docIds.push(sh2.keys.cloudDocId || sh2.keys.localKey);
        });
      }
      if (typeof global.attSaveStatusSetCollectiveDocs === 'function') {
        global.attSaveStatusSetCollectiveDocs(docIds);
      }
      _undo = null;
      var undoBtn = document.getElementById('btn-att-col-undo');
      if (undoBtn) undoBtn.disabled = true;
      renderTable();
      toast('ایک روزہ اجتماعی رجسٹر کھل گیا', 'success');
    }

    if (regType === 'staff') {
      var loadStaff = typeof global.attLoadStaffTypeSheet === 'function'
        ? global.attLoadStaffTypeSheet(month, 'staff')
        : Promise.resolve({ keys: {}, data: { records: {}, periodRecords: {} } });
      var collectStaff = typeof global.attResolveTargetUsers === 'function'
        ? global.attResolveTargetUsers('staff', '')
        : Promise.resolve([]);
      Promise.all([loadStaff, collectStaff]).then(function (pair) {
        var sheetPack = pair[0];
        var users = pair[1] || [];
        var sheets = {};
        sheets[COL_SHEET_SHARED] = {
          keys: sheetPack.keys,
          classId: '',
          data: sheetPack.data
        };
        var rows = users.map(function (u) {
          var uid = typeof global.attGetUserId === 'function' ? global.attGetUserId(u) : String(u.id || '');
          return { uid: uid, name: u.name || '', className: '', periods: [], subLabel: 'عملہ' };
        }).filter(function (r) { return !!r.uid; });
        finish(rows, sheets, []);
      }).catch(function (err) {
        console.error('[EMS] collective staff register', err);
        toast('رجسٹر کھولنے میں مسئلہ', 'error');
      }).finally(function () { _opening = false; });
      return;
    }

    if (regType === 'teachers') {
      var loadTeacherSheet = typeof global.attLoadStaffTypeSheet === 'function'
        ? global.attLoadStaffTypeSheet(month, 'teachers')
        : Promise.resolve({ keys: {}, data: { records: {}, periodRecords: {} } });
      var collectTeachers = typeof global.attResolveTargetUsers === 'function'
        ? global.attResolveTargetUsers('teachers', '')
        : Promise.resolve([]);
      Promise.all([loadTeacherSheet, collectTeachers]).then(function (pair) {
        var sheetPack = pair[0];
        var users = pair[1] || [];
        if (scope !== 'all' && typeof global.attFilterTeachersByClassScopes === 'function') {
          users = global.attFilterTeachersByClassScopes(users, classIds);
        }
        var sheets = {};
        sheets[COL_SHEET_SHARED] = {
          keys: sheetPack.keys,
          classId: '',
          data: sheetPack.data
        };
        var rows = users.map(function (u) {
          var uid = typeof global.attGetUserId === 'function' ? global.attGetUserId(u) : String(u.id || '');
          var periods = teacherPeriods(uid, u.name || '', weekday);
          return {
            uid: uid,
            name: u.name || '',
            className: '',
            periods: periods,
            subLabel: periods.length ? (periods.length + ' گھنٹے') : 'بغیر نظام الاوقات'
          };
        }).filter(function (r) { return !!r.uid; });
        finish(rows, sheets, classIds);
      }).catch(function (err) {
        console.error('[EMS] collective teacher register', err);
        toast('رجسٹر کھولنے میں مسئلہ', 'error');
      }).finally(function () { _opening = false; });
      return;
    }

    var collect = function (cid) {
      if (typeof global.attResolveTargetUsers === 'function') {
        return global.attResolveTargetUsers('students', cid);
      }
      if (typeof global.attCollectTargetsFromRepo === 'function') {
        return Promise.resolve(global.attCollectTargetsFromRepo('students', cid));
      }
      return Promise.resolve([]);
    };

    var loadSheet = function (cid) {
      if (typeof global.attLoadCanonicalClassSheet === 'function') {
        return global.attLoadCanonicalClassSheet(month, cid);
      }
      return Promise.resolve({
        keys: typeof global.attCanonicalStudentKeys === 'function'
          ? global.attCanonicalStudentKeys(month, cid) : {},
        classId: cid,
        data: { records: {}, periodRecords: {}, remarks: {}, late: {}, dailyLocks: {}, locked: false }
      });
    };

    Promise.all(classIds.map(function (cid) {
      return Promise.all([collect(cid), loadSheet(cid)]).then(function (pair) {
        return { classId: cid, users: pair[0] || [], sheet: pair[1] };
      });
    })).then(function (packs) {
      var rows = [];
      var sheets = {};
      packs.forEach(function (pack) {
        sheets[pack.classId] = pack.sheet;
        (pack.users || []).forEach(function (u) {
          var uid = typeof global.attGetUserId === 'function' ? global.attGetUserId(u) : String(u.id || '');
          if (!uid) return;
          var cls = typeof global.attGetUserClass === 'function' ? global.attGetUserClass(u) : (u.class || pack.classId);
          rows.push({
            uid: uid,
            name: u.name || '',
            className: cls || pack.classId,
            periods: studentPeriods(cls || pack.classId, weekday)
          });
        });
      });
      finish(rows, sheets, classIds);
    }).catch(function (err) {
      console.error('[EMS] collective register', err);
      toast('رجسٹر کھولنے میں مسئلہ', 'error');
    }).finally(function () {
      _opening = false;
    });
  }

  function undoLast() {
    if (!_state || _saving) return;
    if (!_undo) return toast('واپس کرنے کے لیے کوئی تبدیلی نہیں', 'info');
    setSaving(true);
    Object.keys(_undo.snapshots).forEach(function (cid) {
      if (!_state.sheets[cid]) return;
      _state.sheets[cid].data = cloneData(_undo.snapshots[cid]);
      var persistOpts = { quiet: true, deferCloud: true, flushDeferred: false, clearCells: [] };
      if (cid !== COL_SHEET_SHARED) persistOpts.classId = _state.sheets[cid].classId;
      persistOpts.month = _state.month;
      persistSheet(_state.sheets[cid], persistOpts);
    });
    if (typeof global.attFlushAllDeferredCloud === 'function') {
      global.attFlushAllDeferredCloud();
    }
    _undo = null;
    var btn = document.getElementById('btn-att-col-undo');
    if (btn) btn.disabled = true;
    renderTable();
    setSaving(false);
    toast('آخری اجتماعی کارروائی واپس کر دی گئی — اصل حالت بحال', 'success');
  }

  function ensureBound() {
    if (_bound) return;
    var root = collectiveRoot();
    if (!root) return;
    _bound = true;
    root.addEventListener('change', function (ev) {
      var t = ev.target;
      if (!t) return;
      if (t.name === 'att_col_scope' || t.name === 'att_col_register_type') syncRegisterTypeUi();
      if (t.id === 'att-col-auto-date') syncAutoDate();
    });
    root.addEventListener('click', function (ev) {
      var openBtn = ev.target && ev.target.closest ? ev.target.closest('#btn-att-col-open') : null;
      if (openBtn) {
        ev.preventDefault();
        openRegister();
        return;
      }
      var undoBtn = ev.target && ev.target.closest ? ev.target.closest('#btn-att-col-undo') : null;
      if (undoBtn) {
        ev.preventDefault();
        undoLast();
        return;
      }
      var bulkBtn = ev.target && ev.target.closest ? ev.target.closest('[data-col-all]') : null;
      if (bulkBtn && !bulkBtn.disabled) {
        var val = bulkBtn.getAttribute('data-col-all');
        var labels = { P: 'سب حاضر', A: 'سب غیر حاضر', L: 'سب رخصت' };
        var label = val ? (labels[val] || 'اجتماعی حاضری') : 'پورا رجسٹر صاف';
        setStatus(val || '', '', '', label, 'all');
      }
    });
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('ems:repository-ready', function () {
        if (typeof global.emsAttPanelIsVisible === 'function'
            && !global.emsAttPanelIsVisible('att-collective-register')) return;
        refreshFilters();
      });
      global.addEventListener('ems:users-changed', function () {
        if (typeof global.emsAttPanelIsVisible === 'function'
            && !global.emsAttPanelIsVisible('att-collective-register')) return;
        refreshFilters();
      });
    }
  }

  function bind() {
    ensureBound();
  }

  global.attCollectiveFillClasses = fillClasses;
  global.attCollectiveRefreshFilters = refreshFilters;
  global.attCollectiveBoot = function () {
    ensureBound();
    refreshFilters();
    if (typeof global.attSaveStatusBoot === 'function') global.attSaveStatusBoot();
  };
  global.attColSetAll = function (status) {
    var labels = { P: 'سب حاضر', A: 'سب غیر حاضر', L: 'سب رخصت' };
    setStatus(status || '', '', '', status ? labels[status] : 'پورا رجسٹر صاف', 'all');
  };
  global.attColSetStudent = function (uid, status) {
    var reg = _state && _state.registerType;
    var label = reg === 'teachers' ? 'استاد' : (reg === 'staff' ? 'عملے کا رکن' : 'طالب علم');
    setStatus(status || '', uid, '', label, 'student');
  };
  global.attColSetPeriod = function (uid, periodId, status) {
    setStatus(status || '', uid, periodId, 'ایک گھنٹہ', 'period');
  };
  global.attColGotoPage = function (page) {
    if (!_state) return;
    _state.page = Math.max(1, Number(page) || 1);
    renderTable();
  };

  /** Test exports */
  global.attColStatusKind = statusKind;
  global.attColStudentAggregateKind = studentAggregateKind;
  global.attColResultMessage = resultMessage;

  function initCollectiveModule() {
    if (!collectiveRoot()) {
      ensureBound();
      return;
    }
    if (global._attCurrentTabId === 'att-collective-register') {
      global.attCollectiveBoot();
    } else {
      ensureBound();
      refreshFilters();
    }
  }

  if (typeof global.emsRunWhenDomReady === 'function') {
    global.emsRunWhenDomReady(initCollectiveModule);
  } else if (global.document && global.document.readyState !== 'loading') {
    initCollectiveModule();
  } else if (global.document) {
    global.document.addEventListener('DOMContentLoaded', initCollectiveModule);
  } else {
    initCollectiveModule();
  }

  if (global._attCurrentTabId === 'att-collective-register'
      && typeof global.emsReplayAttTabBoot === 'function') {
    global.emsReplayAttTabBoot('att-collective-register');
  }
})(typeof window !== 'undefined' ? window : globalThis);
