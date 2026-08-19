// ============================================================================
// اجتماعی حاضری — ایک روزہ گھنٹہ وار رجسٹر (مرکزی periodRecords کے ساتھ)
// ============================================================================
(function (global) {
  'use strict';

  var PAGE_SIZE = 50;
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

  function selectedClassIds() {
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
    syncScopeUi();
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

  function periodLabel(p, mode) {
    if (!p) return '';
    if (mode === 'teacher') return p.teacherName || 'استاد؟';
    var book = p.bookName && p.bookName !== '-' ? p.bookName : '';
    return book || p.name || 'مضمون';
  }

  function periodMeta(p, mode) {
    var parts = [];
    if (mode !== 'teacher' && p.teacherName) parts.push(p.teacherName);
    if (mode === 'teacher' && p.bookName && p.bookName !== '-') parts.push(p.bookName);
    var time = (p.start ? p.start : '') + (p.end ? '–' + p.end : '');
    if (time) parts.push(time);
    return parts.join(' · ');
  }

  function studentPeriods(className, weekday) {
    if (typeof global.attStudentPeriodsForWeekday !== 'function') return [];
    return global.attStudentPeriodsForWeekday(className, weekday) || [];
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

  function confirmBulk(studentCount, periodCount, actionLabel) {
    return confirm(
      actionLabel +
      '\n\nمتاثر طلبہ: ' + studentCount +
      '\nمتاثر گھنٹے: ' + periodCount +
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
    (classIds || []).forEach(function (cid) {
      var sh = _state && _state.sheets && _state.sheets[cid];
      if (sh) out[cid] = cloneData(sh.data);
    });
    return out;
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
    if (!_state || !row || !period) return false;
    var sheet = _state.sheets[row.className];
    if (!sheet) return false;
    if (sheetLocked(sheet, _state.day)) return false;
    var ids = (row.periods || []).map(function (p) { return p.id; });
    if (typeof global.attWritePeriodOnSheetData === 'function') {
      global.attWritePeriodOnSheetData(sheet.data, row.uid, _state.day, period.id, status, ids);
      return true;
    }
    return false;
  }

  function currentStatus(row, period) {
    if (!_state || !row || !period) return '';
    var sheet = _state.sheets[row.className];
    if (!sheet || !sheet.data || !sheet.data.periodRecords) return '';
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
      var sheet = _state.sheets[row.className];
      if (sheetLocked(sheet, _state.day)) return;
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

  function resultMessage(scope, statusKindVal, studentCount, periodCount) {
    if (scope === 'period') {
      if (!statusKindVal) return 'صرف یہ گھنٹہ صاف کردیا گیا۔';
      if (statusKindVal === 'P') return 'صرف یہ گھنٹہ حاضر کردیا گیا۔';
      if (statusKindVal === 'A') return 'صرف یہ گھنٹہ غیر حاضر کردیا گیا۔';
      return 'صرف یہ گھنٹہ رخصت کردیا گیا۔';
    }
    if (!statusKindVal) {
      if (scope === 'student') {
        return 'اس طالب علم کے ' + periodCount + ' گھنٹے صاف کردیے گئے۔';
      }
      return studentCount + ' طلبہ کے تمام گھنٹے صاف کردیے گئے۔';
    }
    var verb = statusKindVal === 'P' ? 'حاضر' : (statusKindVal === 'A' ? 'غیر حاضر' : 'رخصت');
    if (scope === 'student') {
      return 'اس طالب علم کے ' + periodCount + ' گھنٹے ' + verb + ' کردیے گئے۔';
    }
    return studentCount + ' طلبہ کے تمام گھنٹے ' + verb + ' کردیے گئے۔';
  }

  function applyTargets(targets, status, undoLabel, scope) {
    if (!targets.length) {
      toast('پہلے سے یہی حالت ہے — کوئی تبدیلی نہیں', 'info');
      return;
    }
    var classSet = {};
    targets.forEach(function (t) { classSet[t.row.className] = true; });
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
      persistSheet(_state.sheets[cid], { quiet: true, deferCloud: true, flushDeferred: false });
    });
    if (typeof global.attFlushAllDeferredCloud === 'function') {
      global.attFlushAllDeferredCloud();
    }
    renderTable();
    setSaving(false);
    toast(resultMessage(scope || 'all', kindVal, studentCount, periodCount), 'success');
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
      if (!confirmBulk(studentCount, periodCount, actionLabel || 'اجتماعی حاضری')) return;
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
      summary.textContent = 'طلبہ: ' + rows.length + ' · درجات: ' + _state.classIds.length
        + ' · تاریخ: ' + _state.date;
    }

    if (!rows.length) {
      wrap.innerHTML = '<p class="att-col-placeholder">منتخب درجات میں کوئی طالب علم نہیں ملا</p>';
      if (pager) pager.classList.add('att-col-hidden');
      return;
    }

    var totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (_state.page > totalPages) _state.page = totalPages;
    var start = (_state.page - 1) * PAGE_SIZE;
    var pageRows = rows.slice(start, start + PAGE_SIZE);
    var head = '<th class="att-col-name">طالب علم کا نام</th>';
    var i;
    for (i = 0; i < maxP; i++) {
      head += '<th>گھنٹہ ' + (i + 1) + '</th>';
    }
    if (!maxP) head += '<th>گھنٹے</th>';

    var sym = symbols();
    var body = pageRows.map(function (row) {
      var locked = _state.blocked || sheetLocked(_state.sheets[row.className], _state.day);
      var aggKind = studentAggregateKind(row);
      var stuActions = locked ? '' : (
        '<div class="att-col-stu-actions">'
        + '<div class="att-col-stu-actions-title">اس طالب علم کے تمام گھنٹے</div>'
        + markBtn('student', row.uid, '', aggKind)
        + '</div>'
      );
      var nameCell = '<td class="att-col-name"><div class="att-col-stu-name">' + escHtml(row.name) + '</div>'
        + '<div class="att-col-stu-sub">' + escHtml(row.uid) + ' · ' + escHtml(row.className) + '</div>'
        + stuActions
        + '</td>';
      var cells = '';
      if (!row.periods.length) {
        cells = '<td colspan="' + Math.max(1, maxP) + '" class="att-col-empty-period">اس دن نظام الاوقات میں کوئی گھنٹہ نہیں</td>';
      } else {
        for (var pi = 0; pi < maxP; pi++) {
          var p = row.periods[pi];
          if (!p) {
            cells += '<td class="att-col-period"></td>';
            continue;
          }
          var st = currentStatus(row, p);
          var cellClass = 'att-col-period';
          if (!st) cellClass += ' att-cell-empty';
          else if (st === sym.P) cellClass += ' att-cell-p';
          else if (st === sym.A) cellClass += ' att-cell-a';
          else if (st === sym.L) cellClass += ' att-cell-l';
          var meta = periodMeta(p, _state.labelMode);
          cells += '<td class="' + cellClass + '">'
            + '<div class="att-col-period-label">' + escHtml(periodLabel(p, _state.labelMode)) + '</div>'
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
    var classIds = selectedClassIds();
    if (!classIds.length) {
      var scope = scopeValue();
      if (scope === 'one') return toast('ایک درجہ منتخب کریں', 'error');
      if (scope === 'multi') return toast('کم از کم ایک درجہ چیک کریں', 'error');
      return toast('کم از کم ایک درجہ منتخب کریں', 'error');
    }
    var modeEl = document.getElementById('att-col-label-mode');
    var labelMode = modeEl ? modeEl.value : 'book';
    var month = monthOf(dateStr);
    var day = dayNumOf(dateStr);
    var weekday = weekdayOf(dateStr);
    var block = isBlockedDate(dateStr);

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

    toast('رجسٹر تیار ہو رہا ہے…', 'info');
    _opening = true;
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
      rows.sort(function (a, b) {
        var c = String(a.className).localeCompare(String(b.className), 'ur');
        if (c) return c;
        return String(a.uid).localeCompare(String(b.uid));
      });
      _state = {
        date: dateStr,
        month: month,
        day: day,
        weekday: weekday,
        classIds: classIds,
        labelMode: labelMode,
        rows: rows,
        sheets: sheets,
        page: 1,
        blocked: block.blocked,
        blockReason: block.reason,
        maxPeriods: 0
      };
      if (typeof global.attSaveStatusSetCollectiveDocs === 'function') {
        global.attSaveStatusSetCollectiveDocs(classIds.map(function (cid) {
          var sh = sheets[cid];
          return sh && sh.keys ? (sh.keys.cloudDocId || sh.keys.localKey) : cid;
        }));
      }
      _undo = null;
      var undoBtn = document.getElementById('btn-att-col-undo');
      if (undoBtn) undoBtn.disabled = true;
      renderTable();
      toast('ایک روزہ اجتماعی رجسٹر کھل گیا', 'success');
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
      persistSheet(_state.sheets[cid], { quiet: true, deferCloud: true, flushDeferred: false, clearCells: [] });
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
      if (t.name === 'att_col_scope') syncScopeUi();
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
    setStatus(status || '', uid, '', 'طالب علم', 'student');
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
