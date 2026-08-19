// ============================================================================
// Exams results import — Excel/CSV with field mapping, preview and local-first save
// ============================================================================
(function (global) {
  'use strict';

  var S = null;
  var EXAMS_KEY = 'ems_full_exams';

  function $(id) { return document.getElementById(id); }
  function toast(msg, type) { if (typeof global.showToast === 'function') global.showToast(msg, type || 'info'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[\s_.\-\/]+/g, '').trim(); }
  function readJson(key, fallback) {
    try {
      var raw = typeof global.emsCacheGetRaw === 'function' ? global.emsCacheGetRaw(key) : localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function dateYmd(v) {
    var s = String(v == null ? '' : v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return '';
  }
  function currentContext() {
    return {
      examName: (($('mrk-exam-name') || {}).value || '').trim(),
      className: (($('mrk-class') || {}).value || '').trim(),
      resultDate: (($('mrk-result-date') || {}).value || '').trim()
    };
  }
  function activeBooks(cls) {
    var templates = readJson('ems_exam_templates', []);
    var tpl = (templates || []).find(function (t) { return t && t.class === cls; });
    return (tpl && Array.isArray(tpl.books) ? tpl.books : []).filter(function (b) { return b && b.name; });
  }
  function fieldDefs() {
    var c = currentContext();
    var out = [
      { key: 'studentId', label: 'طالب علم ID / رول نمبر', aliases: ['id', 'studentid', 'roll', 'rollno', 'رول', 'رولنمبر', 'آئیدی', 'آئیڈی'] },
      { key: 'studentName', label: 'طالب علم کا نام', aliases: ['name', 'studentname', 'student', 'نام', 'طالبعلم', 'طالبعلمکانام'] },
      { key: 'className', label: 'درجہ', aliases: ['class', 'grade', 'کلاس', 'درجہ'] },
      { key: 'examName', label: 'امتحان', aliases: ['exam', 'examname', 'امتحان'] },
      { key: 'resultDate', label: 'نتیجے کی تاریخ', aliases: ['date', 'resultdate', 'تاریخ', 'نتیجےکیتاریخ'] }
    ];
    activeBooks(c.className).forEach(function (b) {
      out.push({ key: 'book:' + b.name, label: 'کتاب: ' + b.name, aliases: [b.name] });
    });
    return out;
  }
  function autoMap(headers) {
    var defs = fieldDefs();
    var map = {};
    headers.forEach(function (header, idx) {
      var h = norm(header);
      defs.some(function (d) {
        var match = norm(d.label) === h || d.aliases.some(function (a) {
          var n = norm(a);
          return n && (n === h || h.indexOf(n) >= 0 || n.indexOf(h) >= 0);
        });
        if (match && Object.keys(map).every(function (key) { return map[key] !== d.key; })) {
          map[idx] = d.key;
          return true;
        }
        return false;
      });
    });
    return map;
  }
  function csvRows(text) {
    var rows = [], row = [], cell = '', quoted = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (quoted) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { cell += '"'; i++; }
          else quoted = false;
        } else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
  }
  function parseFile(file) {
    var ext = String(file.name || '').split('.').pop().toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      if (typeof global.emsLoadXlsxLib !== 'function') return Promise.reject(new Error('Excel لائبریری دستیاب نہیں'));
      return global.emsLoadXlsxLib().then(function () {
        return file.arrayBuffer();
      }).then(function (buf) {
        var wb = global.XLSX.read(buf, { type: 'array' });
        var name = wb.SheetNames[0];
        var rows = global.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
        if (rows.length < 2) throw new Error('فائل خالی ہے یا کم از کم ایک data row درکار ہے');
        return { headers: rows[0].map(String), rows: rows.slice(1), sheetName: name };
      });
    }
    if (ext !== 'csv') return Promise.reject(new Error('صرف Excel (.xlsx/.xls) یا CSV فائل منتخب کریں'));
    return file.text().then(function (text) {
      var rows = csvRows(String(text).replace(/^\uFEFF/, ''));
      if (rows.length < 2) throw new Error('فائل خالی ہے یا کم از کم ایک data row درکار ہے');
      return { headers: rows[0].map(String), rows: rows.slice(1), sheetName: '' };
    });
  }
  function usersForClass(cls) {
    var users = typeof global.emsGetUsersMerged === 'function' ? global.emsGetUsersMerged()
      : (typeof global.emsGetUsersSync === 'function' ? global.emsGetUsersSync() : []);
    if (typeof global.emsFilterByDepartment === 'function') users = global.emsFilterByDepartment(users || []);
    return (users || []).filter(function (u) {
      var type = String(u.type || '').toLowerCase();
      var className = String(u.class || u.className || u.grade || '').trim();
      return (type === 'student' || type === 'students' || !type) && (!cls || className === cls);
    });
  }
  function cell(row, headerIndex) { return headerIndex == null ? '' : row[Number(headerIndex)]; }
  function mapIndex(field) {
    var keys = Object.keys(S.map || {});
    for (var i = 0; i < keys.length; i++) if (S.map[keys[i]] === field) return Number(keys[i]);
    return null;
  }
  function mark(raw, max) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s || /^ab$/i.test(s) || s === 'غ' || /غیر\s*حاضر/.test(s)) return 'AB';
    var n = Number(s);
    if (isNaN(n)) return null;
    return Math.max(0, Math.min(n, Number(max) || 0));
  }
  function grade(percent) {
    if (percent >= 90) return 'ممتاز مرتفع';
    if (percent >= 80) return 'ممتاز';
    if (percent >= 60) return 'جید جدا';
    if (percent >= 50) return 'جید';
    if (percent >= 40) return 'مقبول';
    return 'راسب';
  }
  function buildPreview() {
    var ctx = currentContext();
    var idIx = mapIndex('studentId');
    var nameIx = mapIndex('studentName');
    var classIx = mapIndex('className');
    var examIx = mapIndex('examName');
    var dateIx = mapIndex('resultDate');
    var books = activeBooks(ctx.className);
    var users = usersForClass(ctx.className);
    var byId = Object.create(null), byName = Object.create(null);
    users.forEach(function (u) {
      var id = String(u.id || u.regId || u.uid || '').trim();
      var name = String(u.name || '').trim();
      if (id) byId[id] = u;
      if (name) byName[name] = u;
    });
    var valid = [], errors = [], seen = Object.create(null);
    S.parsed.rows.forEach(function (row, i) {
      var rowNo = i + 2;
      var sid = String(cell(row, idIx) || '').trim();
      var name = String(cell(row, nameIx) || '').trim();
      var user = (sid && byId[sid]) || (!sid && name && byName[name]);
      var rowClass = String(cell(row, classIx) || ctx.className).trim();
      var exam = String(cell(row, examIx) || ctx.examName).trim();
      var resultDate = dateYmd(cell(row, dateIx) || ctx.resultDate);
      if (!user) return errors.push({ rowNo: rowNo, message: 'طالب علم ID/نام نہیں ملا' });
      if (!rowClass || rowClass !== ctx.className) return errors.push({ rowNo: rowNo, message: 'درجہ منتخب درجے سے مختلف ہے' });
      if (!exam) return errors.push({ rowNo: rowNo, message: 'امتحان موجود نہیں' });
      if (!resultDate) return errors.push({ rowNo: rowNo, message: 'نتیجے کی تاریخ درست نہیں' });
      if (seen[user.id || sid]) return errors.push({ rowNo: rowNo, message: 'یہ طالب علم فائل میں دوبارہ موجود ہے' });
      seen[user.id || sid] = true;
      var marks = {}, marked = 0, badBook = '';
      books.forEach(function (b) {
        var ix = mapIndex('book:' + b.name);
        if (ix == null) return;
        var value = mark(cell(row, ix), b.marks);
        if (value == null) { badBook = b.name; return; }
        marks[b.name] = value; marked++;
      });
      if (badBook) return errors.push({ rowNo: rowNo, message: 'غلط نمبر: ' + badBook });
      if (!marked) return errors.push({ rowNo: rowNo, message: 'کوئی کتاب/مضمون لنک نہیں کیا گیا' });
      valid.push({ rowNo: rowNo, user: user, examName: exam, className: rowClass, resultDate: resultDate, marks: marks });
    });
    S.preview = { valid: valid, errors: errors, books: books, ctx: ctx };
  }
  function render() {
    var modal = $('exam-import-modal');
    var body = $('exam-import-body');
    if (!modal || !body || !S) return;
    var ctx = currentContext();
    if (!S.parsed) {
      body.innerHTML = '<p>نتائج کی Excel یا CSV فائل منتخب کریں۔ پہلے کشف الدرجات میں <b>امتحان، درجہ اور نتیجے کی تاریخ</b> منتخب کرنا ضروری ہے۔</p>'
        + '<p class="exam-import-hint">فائل میں ID/رول یا نام لازمی ہے۔ کتاب/مضمون کے کالم آپ اگلے مرحلے میں خود لنک کر سکیں گے۔</p>'
        + '<input id="exam-import-file" type="file" accept=".xlsx,.xls,.csv" class="input-control">';
      var fileEl = $('exam-import-file');
      if (fileEl) fileEl.onchange = function () {
        var f = this.files && this.files[0];
        if (!f) return;
        if (!ctx.examName || !ctx.className || !ctx.resultDate) return toast('پہلے امتحان، درجہ اور نتیجے کی تاریخ منتخب کریں', 'error');
        body.innerHTML = '<p>فائل پڑھی جا رہی ہے…</p>';
        parseFile(f).then(function (parsed) {
          S.file = f; S.parsed = parsed; S.map = autoMap(parsed.headers); render();
        }).catch(function (err) { toast(err.message || 'فائل پڑھنے میں مسئلہ', 'error'); S = null; global.examOpenResultImport(); });
      };
      return;
    }
    var defs = fieldDefs();
    var opts = '<option value="">— نظر انداز —</option>' + defs.map(function (d) {
      return '<option value="' + esc(d.key) + '">' + esc(d.label) + '</option>';
    }).join('');
    var rows = S.parsed.headers.map(function (h, i) {
      var selected = S.map[i] || '';
      var sample = S.parsed.rows.slice(0, 3).map(function (r) { return cell(r, i); }).filter(Boolean)[0] || '';
      return '<tr><td><b>' + esc(h || ('کالم ' + (i + 1))) + '</b><br><small>' + esc(String(sample).slice(0, 32)) + '</small></td>'
        + '<td><select class="input-control exam-import-map" data-index="' + i + '">' + opts.replace('value="' + esc(selected) + '"', 'value="' + esc(selected) + '" selected') + '</select></td></tr>';
    }).join('');
    body.innerHTML = '<p><b>' + esc(S.file.name) + '</b> — ' + S.parsed.rows.length + ' قطاریں</p>'
      + '<p class="exam-import-hint">ہر فائل کالم کو مناسب خانے سے جوڑیں۔ کتاب کے نام بھی ماسٹر شیٹ والی کتاب سے دستی طور پر لنک ہو سکتے ہیں۔</p>'
      + '<div class="table-responsive"><table class="data-table"><thead><tr><th>فائل کا کالم</th><th>سافٹ ویئر کا خانہ</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '<div class="btn-action-group" style="margin-top:14px"><button class="btn btn-primary" id="btn-exam-import-preview">پیش منظر اور توثیق</button></div>';
    Array.prototype.forEach.call(document.querySelectorAll('.exam-import-map'), function (el) {
      el.onchange = function () { S.map[this.dataset.index] = this.value; };
    });
    var previewBtn = $('btn-exam-import-preview');
    if (previewBtn) previewBtn.onclick = function () { buildPreview(); renderPreview(); };
  }
  function renderPreview() {
    var body = $('exam-import-body');
    var p = S.preview;
    var validRows = p.valid.slice(0, 8).map(function (r) {
      return '<tr><td>' + r.rowNo + '</td><td>' + esc(r.user.name) + '</td><td>' + esc(r.user.id) + '</td><td>' + esc(Object.keys(r.marks).join('، ')) + '</td></tr>';
    }).join('');
    var errors = p.errors.slice(0, 12).map(function (r) { return '<li>قطار ' + r.rowNo + ': ' + esc(r.message) + '</li>'; }).join('');
    body.innerHTML = '<h4>پیش منظر اور توثیق</h4>'
      + '<p><b style="color:#166534">درست: ' + p.valid.length + '</b> · <b style="color:#b91c1c">غلط/چھوڑی: ' + p.errors.length + '</b></p>'
      + (validRows ? '<div class="table-responsive"><table class="data-table"><thead><tr><th>قطار</th><th>طالب علم</th><th>ID</th><th>لنک شدہ کتب</th></tr></thead><tbody>' + validRows + '</tbody></table></div>' : '')
      + (errors ? '<div class="exam-import-errors"><b>غلط قطاریں:</b><ul>' + errors + '</ul></div>' : '')
      + '<p class="exam-import-hint">صرف درست قطاریں محفوظ ہوں گی۔ موجودہ امتحان/درجہ/تاریخ کے اسی طالب علم کا پرانا نتیجہ اپڈیٹ ہوگا۔</p>'
      + '<div class="btn-action-group"><button class="btn btn-outline" id="btn-exam-import-back">کالم میپنگ پر واپس</button>'
      + '<button class="btn btn-success" id="btn-exam-import-confirm" ' + (!p.valid.length ? 'disabled' : '') + '>درست نتائج محفوظ کریں (' + p.valid.length + ')</button></div>';
    $('btn-exam-import-back').onclick = render;
    var confirmBtn = $('btn-exam-import-confirm');
    if (confirmBtn) confirmBtn.onclick = persist;
  }
  function persist() {
    var p = S.preview;
    if (!p || !p.valid.length) return;
    var lockFn = global.exmIsExamLocked;
    if (typeof lockFn === 'function' && lockFn(p.ctx.examName, p.ctx.className, p.ctx.resultDate)) {
      return toast('یہ نتیجہ لاک ہو چکا ہے — درآمد ممکن نہیں', 'error');
    }
    var db = readJson(EXAMS_KEY, []);
    var now = Date.now(), inserted = 0, updated = 0;
    p.valid.forEach(function (r) {
      var marks = r.marks;
      var total = 0, grand = 0;
      p.books.forEach(function (b) {
        grand += Number(b.marks) || 0;
        var v = marks[b.name];
        if (v != null && v !== 'AB') total += Number(v) || 0;
      });
      var percentage = grand > 0 ? (total / grand) * 100 : 0;
      var existingIndex = db.findIndex(function (x) {
        return x && x.examName === r.examName && x.class === r.className
          && String(x.studentId) === String(r.user.id) && String(x.resultDate || '').slice(0, 10) === r.resultDate;
      });
      var record = {
        id: existingIndex >= 0 ? db[existingIndex].id : ('RES' + now + '_' + r.user.id),
        examName: r.examName, class: r.className, studentId: r.user.id, studentName: r.user.name || '',
        studentPhoto: r.user.photoBase64 || r.user.photoUrl || '',
        marks: marks, totalObtained: total, grandTotal: grand,
        percentage: percentage.toFixed(1), grade: grade(percentage), resultDate: r.resultDate, timestamp: now
      };
      if (typeof global.emsStampDepartment === 'function') global.emsStampDepartment(record, r.user.departmentId);
      if (existingIndex >= 0) { db[existingIndex] = record; updated++; } else { db.push(record); inserted++; }
    });
    var save = typeof global.emsSaveModuleData === 'function'
      ? global.emsSaveModuleData(EXAMS_KEY, JSON.stringify(db), { mutation: true, autoDelta: true })
      : Promise.resolve(localStorage.setItem(EXAMS_KEY, JSON.stringify(db)));
    Promise.resolve(save).then(function () {
      toast(inserted + ' نئے اور ' + updated + ' نتائج محفوظ ہو گئے' + (p.errors.length ? '؛ ' + p.errors.length + ' غلط قطاریں چھوڑ دی گئیں' : ''), p.errors.length ? 'warning' : 'success');
      global.examCloseResultImport();
      var refresh = $('btn-generate-mark-sheet');
      if (refresh) refresh.click();
    }).catch(function () { toast('نتائج محفوظ نہیں ہو سکے', 'error'); });
  }
  global.examOpenResultImport = function () {
    if (typeof global.emsRequireStaffAction === 'function' && !global.emsRequireStaffAction('exams', 'edit')) return;
    S = { file: null, parsed: null, map: {}, preview: null };
    var modal = $('exam-import-modal');
    if (modal) modal.style.display = 'flex';
    render();
  };
  global.examCloseResultImport = function () {
    var modal = $('exam-import-modal');
    if (modal) modal.style.display = 'none';
    S = null;
  };
})(typeof window !== 'undefined' ? window : globalThis);
