// ============================================================================
// Exams results import/export — Excel/CSV with full column mapping (registration-grade)
// ============================================================================
(function (global) {
  'use strict';

  var S = null;
  var EXAMS_KEY = 'ems_full_exams';
  var PROFILES_KEY = 'ems_exam_import_profiles_v1';

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
      var raw = typeof global.emsCacheGetRaw === 'function' ? global.emsCacheGetRaw(key) : null;
      if ((raw == null || raw === '') && typeof global.emsDurableReadRaw === 'function'
          && typeof global.emsIsLargeBlobKey === 'function' && global.emsIsLargeBlobKey(key)) {
        raw = global.emsDurableReadRaw(key);
      }
      if (raw == null || raw === '') {
        raw = typeof global.emsSafeLocalGet === 'function' ? global.emsSafeLocalGet(key) : localStorage.getItem(key);
      }
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      if (key && typeof global.showToast === 'function') {
        global._exmImportJsonWarned = global._exmImportJsonWarned || Object.create(null);
        if (!global._exmImportJsonWarned[key]) {
          global._exmImportJsonWarned[key] = true;
          global.showToast('امتحانات کا ڈیٹا خراب لگ رہا ہے — کلاؤڈ سے بحالی کریں', 'error');
        }
      }
      return fallback;
    }
  }
  function dateYmd(v) {
    if (v instanceof Date && !isNaN(v.getTime())) {
      return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
    }
    var s = String(v == null ? '' : v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var ymd = s.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/);
    if (ymd) return ymd[1] + '-' + String(ymd[2]).padStart(2, '0') + '-' + String(ymd[3]).padStart(2, '0');
    var dmy = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
    if (dmy) return dmy[3] + '-' + String(dmy[2]).padStart(2, '0') + '-' + String(dmy[1]).padStart(2, '0');
    var serial = Number(v);
    if (isFinite(serial) && serial > 1 && serial < 100000) {
      if (global.XLSX && global.XLSX.SSF && typeof global.XLSX.SSF.parse_date_code === 'function') {
        var parsed = global.XLSX.SSF.parse_date_code(serial);
        if (parsed && parsed.y) return parsed.y + '-' + String(parsed.m).padStart(2, '0') + '-' + String(parsed.d).padStart(2, '0');
      }
      var excelDate = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
      return excelDate.getUTCFullYear() + '-' + String(excelDate.getUTCMonth() + 1).padStart(2, '0') + '-' + String(excelDate.getUTCDate()).padStart(2, '0');
    }
    var d = new Date(s);
    if (!isNaN(d.getTime())) return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return '';
  }
  function currentContext() {
    return {
      examName: ((($('exam-data-exam-name') || {}).value || ($('mrk-exam-name') || {}).value) || '').trim(),
      className: ((($('exam-data-class') || {}).value || ($('mrk-class') || {}).value) || '').trim(),
      resultDate: ((($('exam-data-result-date') || {}).value || ($('mrk-result-date') || {}).value) || '').trim()
    };
  }

  function contextLocked() {
    var ctx = currentContext();
    return !!(ctx.examName && ctx.className && ctx.resultDate
      && typeof global.exmIsExamLocked === 'function'
      && global.exmIsExamLocked(ctx.examName, ctx.className, ctx.resultDate));
  }

  function resultDateOf(row) {
    if (!row) return '';
    if (row.resultDate) return dateYmd(row.resultDate);
    if (row.timestamp) return dateYmd(new Date(row.timestamp));
    return '';
  }
  function activeBooks(cls) {
    var templates = readJson('ems_exam_templates', []);
    var tpl = (templates || []).find(function (t) { return t && t.class === cls; });
    return (tpl && Array.isArray(tpl.books) ? tpl.books : []).filter(function (b) { return b && b.name; });
  }
  function bookMaxMarks(cls, bookName) {
    var hit = activeBooks(cls).find(function (b) { return b.name === bookName; });
    return hit ? (Number(hit.marks) || 100) : 100;
  }

  function staticFieldDefs() {
    return [
      { key: 'studentId', label: 'طالب علم ID / رول نمبر', group: 'بنیادی', aliases: ['id', 'studentid', 'roll', 'rollno', 'رول', 'رولنمبر', 'آئیدی', 'آئیڈی', 'formno'] },
      { key: 'studentName', label: 'طالب علم کا نام', group: 'بنیادی', aliases: ['name', 'studentname', 'student', 'نام', 'طالبعلم', 'طالبعلمکانام'] },
      { key: 'className', label: 'درجہ', group: 'بنیادی', aliases: ['class', 'grade', 'کلاس', 'درجہ'] },
      { key: 'examName', label: 'امتحان', group: 'بنیادی', aliases: ['exam', 'examname', 'امتحان'] },
      { key: 'resultDate', label: 'نتیجے کی تاریخ', group: 'بنیادی', aliases: ['date', 'resultdate', 'تاریخ', 'نتیجےکیتاریخ'] },
      { key: 'totalObtained', label: 'کل حاصل کردہ', group: 'اضافی', aliases: ['total', 'obtained', 'حاصل', 'کلحاصل'] },
      { key: 'grandTotal', label: 'کل ممکن', group: 'اضافی', aliases: ['grand', 'max', 'کل', 'ممکن'] },
      { key: 'percentage', label: 'فیصد', group: 'اضافی', aliases: ['percent', 'percentage', 'فیصد'] },
      { key: 'grade', label: 'درجہ (گریڈ)', group: 'اضافی', aliases: ['grade', 'گریڈ', 'درجہبندی'] },
      { key: 'bookhdr', label: 'مضمون: فائل کالم کا نام', group: 'مضامین', aliases: [] },
      { key: 'bookcustom', label: 'مضمون: اپنی نام سے', group: 'مضامین', aliases: [] }
    ];
  }

  function fieldDefs() {
    var c = currentContext();
    var out = staticFieldDefs().slice();
    activeBooks(c.className).forEach(function (b) {
      out.push({
        key: 'book:' + b.name,
        label: 'کتاب (سانچہ): ' + b.name,
        group: 'سانچہ کی کتب',
        aliases: [b.name, norm(b.name)]
      });
    });
    return out;
  }

  function mappingOptionsHtml(selected) {
    var defs = fieldDefs();
    var groups = {};
    defs.forEach(function (d) {
      var g = d.group || 'دیگر';
      if (!groups[g]) groups[g] = [];
      groups[g].push(d);
    });
    var html = '<option value="">— نظر انداز —</option>';
    Object.keys(groups).forEach(function (g) {
      html += '<optgroup label="' + esc(g) + '">';
      groups[g].forEach(function (d) {
        var sel = selected === d.key ? ' selected' : '';
        html += '<option value="' + esc(d.key) + '"' + sel + '>' + esc(d.label) + '</option>';
      });
      html += '</optgroup>';
    });
    return html;
  }

  function autoMap(headers) {
    var defs = fieldDefs();
    var map = {};
    headers.forEach(function (header, idx) {
      var h = norm(header);
      if (!h) return;
      defs.some(function (d) {
        if (d.key === 'bookcustom' || d.key === 'bookhdr') return false;
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
      if (!map[idx]) {
        var books = activeBooks(currentContext().className);
        books.some(function (b) {
          if (norm(b.name) === h || h.indexOf(norm(b.name)) >= 0) {
            map[idx] = 'book:' + b.name;
            return true;
          }
          return false;
        });
        if (!map[idx] && h && /نمبر|marks|score|حاصل|مضمون|کتاب|subject/i.test(String(header))) {
          map[idx] = 'bookhdr';
        }
      }
    });
    return map;
  }

  function parseFile(file) {
    if (global.EmsImportExport && typeof global.EmsImportExport.parseFile === 'function') {
      return global.EmsImportExport.parseFile(file).then(function (parsed) {
        return enrichParsedWorkbook(file, parsed);
      });
    }
    return parseFileLocal(file);
  }

  function parseFileLocal(file) {
    var ext = String(file.name || '').split('.').pop().toLowerCase();
    if (ext === 'json') {
      return file.text().then(function (text) {
        var data = JSON.parse(String(text).replace(/^\uFEFF/, ''));
        if (!Array.isArray(data)) {
          if (data && Array.isArray(data.records)) data = data.records;
          else if (data && Array.isArray(data.results)) data = data.results;
        }
        if (!Array.isArray(data) || !data.length) throw new Error('JSON میں نتائج کی فہرست موجود نہیں');
        var headers = [];
        data.forEach(function (obj) {
          if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
          Object.keys(obj).forEach(function (k) { if (headers.indexOf(k) < 0) headers.push(k); });
        });
        if (!headers.length) throw new Error('JSON ریکارڈ درست نہیں');
        return { headers: headers, rows: data.map(function (obj) { return headers.map(function (h) { return obj && obj[h] != null ? obj[h] : ''; }); }), sheetName: '', sheetNames: [], rawAoa: [] };
      });
    }
    if (ext === 'xlsx' || ext === 'xls') {
      if (typeof global.emsLoadXlsxLib !== 'function') return Promise.reject(new Error('Excel لائبریری دستیاب نہیں'));
      return global.emsLoadXlsxLib().then(function () {
        return file.arrayBuffer();
      }).then(function (buf) {
        var wb = global.XLSX.read(buf, { type: 'array' });
        return workbookToParsed(wb, wb.SheetNames[0], 0);
      });
    }
    if (ext !== 'csv') return Promise.reject(new Error('صرف Excel، CSV یا JSON فائل منتخب کریں'));
    return file.text().then(function (text) {
      var rows = csvRows(String(text).replace(/^\uFEFF/, ''));
      if (rows.length < 2) throw new Error('فائل خالی ہے یا کم از کم ایک data row درکار ہے');
      return { headers: rows[0].map(String), rows: rows.slice(1), sheetName: '', sheetNames: [], rawAoa: rows, headerRow: 0 };
    });
  }

  function enrichParsedWorkbook(file, parsed) {
    var ext = String(file.name || '').split('.').pop().toLowerCase();
    parsed.sheetNames = parsed.sheetNames || [];
    parsed.headerRowOptions = parsed.rawAoa ? Math.min(20, parsed.rawAoa.length) : 1;
    if ((ext === 'xlsx' || ext === 'xls') && typeof global.emsLoadXlsxLib === 'function') {
      return global.emsLoadXlsxLib().then(function () {
        return file.arrayBuffer();
      }).then(function (buf) {
        var wb = global.XLSX.read(buf, { type: 'array' });
        S.workbook = wb;
        S.sheetNames = wb.SheetNames || [];
        if (!parsed.sheetName && S.sheetNames.length) parsed.sheetName = S.sheetNames[0];
        return parsed;
      });
    }
    return parsed;
  }

  function workbookToParsed(wb, sheetName, headerRow) {
    var ws = wb.Sheets[sheetName];
    if (!ws) throw new Error('شیٹ نہیں ملی');
    var aoa = global.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
    if (!aoa.length) throw new Error('شیٹ خالی ہے');
    headerRow = Math.max(0, Math.min(Number(headerRow) || 0, aoa.length - 1));
    var headers = (aoa[headerRow] || []).map(function (h) { return String(h).trim(); });
    var rows = aoa.slice(headerRow + 1).filter(function (row) {
      return row && row.some(function (cell) { return String(cell == null ? '' : cell).trim() !== ''; });
    });
    return {
      headers: headers,
      rows: rows,
      sheetName: sheetName,
      sheetNames: wb.SheetNames || [],
      rawAoa: aoa,
      headerRow: headerRow
    };
  }

  function reparseSheet() {
    if (!S || !S.workbook || !S.sheetName) return;
    S.parsed = workbookToParsed(S.workbook, S.sheetName, S.headerRow || 0);
    S.map = autoMap(S.parsed.headers);
    S.customBooks = {};
    render();
  }

  function reparseFromRawAoa() {
    if (!S || !S.parsed || !S.parsed.rawAoa || !S.parsed.rawAoa.length) return;
    var aoa = S.parsed.rawAoa;
    var headerRow = Math.max(0, Math.min(Number(S.headerRow) || 0, aoa.length - 1));
    var headers = (aoa[headerRow] || []).map(function (h) { return String(h).trim(); });
    var rows = aoa.slice(headerRow + 1).filter(function (row) {
      return row && row.some(function (cell) { return String(cell == null ? '' : cell).trim() !== ''; });
    });
    S.parsed = {
      headers: headers,
      rows: rows,
      sheetName: S.parsed.sheetName || '',
      sheetNames: S.sheetNames || [],
      rawAoa: aoa,
      headerRow: headerRow
    };
    S.map = autoMap(headers);
    S.customBooks = {};
    render();
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

  function loadProfiles() {
    try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveProfile(name, map, customBooks) {
    var list = loadProfiles();
    list.push({
      id: 'p_' + Date.now(),
      name: name,
      map: map,
      customBooks: customBooks || {},
      savedAt: Date.now()
    });
    try { localStorage.setItem(PROFILES_KEY, JSON.stringify(list.slice(-20))); } catch (e) { /* quota */ }
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

  function resolveBookColumn(colIndex, header) {
    var m = (S.map || {})[colIndex];
    if (!m) return null;
    if (m.indexOf('book:') === 0) return { name: m.slice(5), max: null };
    if (m === 'bookhdr') {
      var hn = String(header || '').trim();
      return hn ? { name: hn, max: null } : null;
    }
    if (m === 'bookcustom') {
      var custom = (S.customBooks || {})[colIndex];
      custom = String(custom || '').trim();
      return custom ? { name: custom, max: null } : null;
    }
    return null;
  }

  function collectBookColumns(ctxClass) {
    var out = [];
    (S.parsed.headers || []).forEach(function (h, i) {
      var b = resolveBookColumn(i, h);
      if (!b) return;
      b.max = bookMaxMarks(ctxClass, b.name);
      b.ix = i;
      out.push(b);
    });
    return out;
  }

  function buildPreview() {
    var ctx = currentContext();
    var idIx = mapIndex('studentId');
    var nameIx = mapIndex('studentName');
    var classIx = mapIndex('className');
    var examIx = mapIndex('examName');
    var dateIx = mapIndex('resultDate');
    if (idIx == null && nameIx == null) {
      toast('کم از کم ID یا نام کا کالم لنک کریں', 'error');
      return;
    }
    var defaultClass = ctx.className || '';
    var defaultExam = ctx.examName || '';
    var defaultDate = ctx.resultDate || '';
    if (!defaultClass && classIx == null) {
      toast('درجہ فائل میں لنک کریں یا اوپر منتخب کریں', 'error');
      return;
    }
    if (!defaultExam && examIx == null) {
      toast('امتحان فائل میں لنک کریں یا اوپر منتخب کریں', 'error');
      return;
    }
    if (!defaultDate && dateIx == null) {
      toast('تاریخ فائل میں لنک کریں یا اوپر منتخب کریں', 'error');
      return;
    }
    var bookCols = collectBookColumns(defaultClass);
    if (!bookCols.length) {
      toast('کم از کم ایک مضمون/کتاب کا کالم لنک کریں', 'error');
      return;
    }
    var users = usersForClass('');
    var byId = Object.create(null), byName = Object.create(null);
    users.forEach(function (u) {
      var id = String(u.id || u.regId || u.uid || '').trim();
      var name = String(u.name || '').trim();
      if (id) byId[id] = u;
      if (name) byName[name] = Object.prototype.hasOwnProperty.call(byName, name) ? false : u;
    });
    var valid = [], errors = [], seen = Object.create(null);
    S.parsed.rows.forEach(function (row, i) {
      var rowNo = i + (Number(S.parsed.headerRow) || 0) + 2;
      var sid = String(cell(row, idIx) || '').trim();
      var name = String(cell(row, nameIx) || '').trim();
      var user = sid ? byId[sid] : (name ? byName[name] : null);
      var rowClass = String(cell(row, classIx) || defaultClass).trim();
      var exam = String(cell(row, examIx) || defaultExam).trim();
      var resultDate = dateYmd(cell(row, dateIx) || defaultDate);
      if (!sid && name && byName[name] === false) return errors.push({ rowNo: rowNo, message: 'یہ نام ایک سے زیادہ طلبہ کا ہے؛ درست ID/رول نمبر دیں' });
      if (!user) return errors.push({ rowNo: rowNo, message: sid ? 'طالب علم ID/رول نمبر نہیں ملا' : 'طالب علم نام نہیں ملا' });
      if (!rowClass) return errors.push({ rowNo: rowNo, message: 'درجہ خالی ہے' });
      if (defaultClass && rowClass !== defaultClass) return errors.push({ rowNo: rowNo, message: 'درجہ منتخب درجے سے مختلف ہے (' + rowClass + ')' });
      if (!exam) return errors.push({ rowNo: rowNo, message: 'امتحان موجود نہیں' });
      if (!resultDate) return errors.push({ rowNo: rowNo, message: 'نتیجے کی تاریخ درست نہیں' });
      var ukey = [String(user.id || sid), exam, rowClass, resultDate].join('||');
      if (seen[ukey]) return errors.push({ rowNo: rowNo, message: 'اسی طالب علم، امتحان، درجہ اور تاریخ کی قطار فائل میں دوبارہ موجود ہے' });
      seen[ukey] = true;
      var marks = {}, marked = 0, badBook = '';
      bookCols.forEach(function (b) {
        var value = mark(cell(row, b.ix), bookMaxMarks(rowClass, b.name));
        if (value == null && String(cell(row, b.ix) || '').trim() !== '') { badBook = b.name; return; }
        if (value == null) return;
        marks[b.name] = value;
        marked++;
      });
      if (badBook) return errors.push({ rowNo: rowNo, message: 'غلط نمبر: ' + badBook });
      if (!marked) return errors.push({ rowNo: rowNo, message: 'کوئی درست نمبر نہیں ملا' });
      valid.push({
        rowNo: rowNo,
        user: user,
        examName: exam,
        className: rowClass,
        resultDate: resultDate,
        marks: marks,
        bookCols: bookCols
      });
    });
    S.preview = { valid: valid, errors: errors, bookCols: bookCols, ctx: ctx };
  }

  function renderFileStep() {
    var ctx = currentContext();
    var body = $('exam-import-body');
    if (!body) return;
    var locked = contextLocked();
    body.innerHTML = '<p><b>مرحلہ ۱:</b> Excel، CSV یا JSON فائل منتخب کریں۔</p>'
      + '<p class="exam-import-hint">امتحان، درجہ اور تاریخ فائل کے کالم سے بھی آ سکتے ہیں — یا کشف الدرجات میں پہلے سے منتخب کریں۔</p>'
      + '<ul class="exam-import-hint" style="margin:0 0 12px;padding-right:20px;">'
      + '<li>ہر کالم کو اگلے مرحلے میں کسی بھی خانے سے جوڑ سکتے ہیں</li>'
      + '<li>فائل کے کالم کا نام بطور مضمون بھی استعمال ہو سکتا ہے</li>'
      + '<li>Excel میں متعدد شیٹس اور ہیڈر قطار منتخب کریں</li></ul>'
      + (ctx.examName ? '<p>منتخب: <b>' + esc(ctx.examName) + '</b> · ' + esc(ctx.className) + ' · ' + esc(ctx.resultDate) + '</p>' : '<p class="exam-import-hint">(کشف الدرجات میں امتحان/درجہ/تاریخ خالی بھی رہ سکتی ہے اگر فائل میں ہیں)</p>')
      + (locked ? '<div class="exam-data-note"><b>یہ نتیجہ لاک ہے۔</b> ایکسپورٹ کیا جا سکتا ہے مگر اسی دائرے میں امپورٹ محفوظ نہیں ہوگا۔</div>' : '')
      + '<input id="exam-import-file" type="file" accept=".xlsx,.xls,.csv,.json" class="input-control"' + (locked ? ' disabled' : '') + '>';
    var fileEl = $('exam-import-file');
    if (fileEl) fileEl.onchange = function () {
      var f = this.files && this.files[0];
      if (!f) return;
      body.innerHTML = '<p>فائل پڑھی جا رہی ہے…</p>';
      parseFile(f).then(function (parsed) {
        S.file = f;
        S.parsed = parsed;
        S.sheetNames = parsed.sheetNames || S.sheetNames || [];
        S.sheetName = parsed.sheetName || (S.sheetNames[0] || '');
        S.headerRow = parsed.headerRow || 0;
        S.map = autoMap(parsed.headers);
        S.customBooks = {};
        render();
      }).catch(function (err) {
        toast(err.message || 'فائل پڑھنے میں مسئلہ', 'error');
        S = { step: 'file' };
        render();
      });
    };
  }

  function render() {
    var body = $('exam-import-body');
    if (!body || !S) return;
    if (!S.parsed) {
      renderFileStep();
      return;
    }

    var sheetBar = '';
    if (S.sheetNames && S.sheetNames.length > 1) {
      sheetBar = '<div class="input-group" style="max-width:320px;margin-bottom:10px;"><label>Excel شیٹ</label><select id="exam-import-sheet" class="input-control">'
        + S.sheetNames.map(function (n) {
          return '<option value="' + esc(n) + '"' + (n === S.sheetName ? ' selected' : '') + '>' + esc(n) + '</option>';
        }).join('') + '</select></div>';
    }
    var headerBar = '<div class="input-group" style="max-width:220px;margin-bottom:10px;"><label>ہیڈر قطار (۰ = پہلی)</label>'
      + '<input type="number" id="exam-import-header-row" class="input-control" min="0" max="19" value="' + (S.headerRow || 0) + '"></div>';

    var profiles = loadProfiles();
    var profileOpts = '<option value="">— محفوظ میپنگ —</option>'
      + profiles.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('');

    var rows = S.parsed.headers.map(function (h, i) {
      var selected = S.map[i] || '';
      var samples = S.parsed.rows.slice(0, 3).map(function (r) { return cell(r, i); }).filter(function (v) {
        return String(v || '').trim() !== '';
      });
      var sample = samples[0] != null ? String(samples[0]).slice(0, 40) : '';
      var customWrap = selected === 'bookcustom'
        ? '<input type="text" class="input-control exam-import-custom-book" data-index="' + i + '" placeholder="مضمون کا نام" value="' + esc((S.customBooks || {})[i] || '') + '" style="margin-top:6px;">'
        : '';
      return '<tr><td><b>' + esc(h || ('کالم ' + (i + 1))) + '</b><br><small class="exam-import-hint">' + esc(sample) + '</small></td>'
        + '<td><select class="input-control exam-import-map" data-index="' + i + '">' + mappingOptionsHtml(selected) + '</select>' + customWrap + '</td></tr>';
    }).join('');

    body.innerHTML = '<p><b>مرحلہ ۲:</b> کالم میپنگ — <span class="exam-import-hint">' + esc(S.file.name) + ' · ' + S.parsed.rows.length + ' قطاریں</span></p>'
      + '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;">' + sheetBar + headerBar + '</div>'
      + '<div id="exam-import-template-bar"></div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0;align-items:center;">'
      + '<select id="exam-import-profile" class="input-control" style="max-width:220px;">' + profileOpts + '</select>'
      + '<button type="button" class="btn btn-outline btn-sm" id="btn-exam-import-load-profile">میپنگ لوڈ</button>'
      + '<button type="button" class="btn btn-outline btn-sm" id="btn-exam-import-save-profile">میپنگ محفوظ</button>'
      + '<button type="button" class="btn btn-outline btn-sm" id="btn-exam-import-automap"><i class="fas fa-magic"></i> خودکار میپ</button>'
      + '</div>'
      + '<div class="table-responsive"><table class="data-table"><thead><tr><th>فائل کا کالم (نمونہ)</th><th>سافٹ ویئر کا خانہ</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '<div class="btn-action-group" style="margin-top:14px">'
      + '<button class="btn btn-outline" id="btn-exam-import-back-file">فائل بدلیں</button>'
      + '<button class="btn btn-primary" id="btn-exam-import-preview">پیش منظر اور توثیق</button></div>';

    if (typeof global.emsImportTemplatesBar === 'function') {
      global.emsImportTemplatesBar('exam-import-template-bar', 'exam_result', S.parsed.headers, function (map) {
        Object.keys(map).forEach(function (k) { S.map[k] = map[k]; });
        render();
      });
    }

    var sheetSel = $('exam-import-sheet');
    if (sheetSel) sheetSel.onchange = function () {
      S.sheetName = this.value;
      S.headerRow = 0;
      reparseSheet();
    };
    var headerInput = $('exam-import-header-row');
    if (headerInput) headerInput.onchange = function () {
      S.headerRow = Math.max(0, Math.min(19, Number(this.value) || 0));
      if (S.workbook) reparseSheet();
      else reparseFromRawAoa();
    };

    Array.prototype.forEach.call(document.querySelectorAll('.exam-import-map'), function (el) {
      el.onchange = function () {
        S.map[this.dataset.index] = this.value;
        if (this.value !== 'bookcustom') delete (S.customBooks || {})[this.dataset.index];
        render();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.exam-import-custom-book'), function (el) {
      el.oninput = function () { S.customBooks[this.dataset.index] = this.value; };
    });

    var autoBtn = $('btn-exam-import-automap');
    if (autoBtn) autoBtn.onclick = function () { S.map = autoMap(S.parsed.headers); render(); };

    var loadProf = $('btn-exam-import-load-profile');
    if (loadProf) loadProf.onclick = function () {
      var id = ($('exam-import-profile') || {}).value;
      var hit = profiles.find(function (p) { return p.id === id; });
      if (!hit) return toast('پروفائل منتخب کریں', 'warning');
      S.map = Object.assign({}, hit.map);
      S.customBooks = Object.assign({}, hit.customBooks || {});
      render();
      toast('میپنگ لوڈ ہو گئی', 'success');
    };
    var saveProf = $('btn-exam-import-save-profile');
    if (saveProf) saveProf.onclick = function () {
      var name = prompt('اس میپنگ کا نام (مثلاً: وفاقی نتائج فارمیٹ):');
      if (!name) return;
      saveProfile(name.trim(), S.map, S.customBooks);
      toast('میپنگ محفوظ ہو گئی', 'success');
      render();
    };

    $('btn-exam-import-back-file').onclick = function () {
      S.parsed = null;
      S.file = null;
      S.workbook = null;
      render();
    };
    var previewBtn = $('btn-exam-import-preview');
    if (previewBtn) previewBtn.onclick = function () { buildPreview(); if (S.preview) renderPreview(); };
  }

  function renderPreview() {
    var body = $('exam-import-body');
    var p = S.preview;
    var bookList = (p.bookCols || []).map(function (b) { return b.name; }).join('، ');
    var validRows = p.valid.slice(0, 10).map(function (r) {
      return '<tr><td>' + r.rowNo + '</td><td>' + esc(r.user.name) + '</td><td>' + esc(r.user.id) + '</td><td>' + esc(r.examName) + '</td><td>' + esc(r.className) + '</td><td>' + esc(Object.keys(r.marks).join('، ')) + '</td></tr>';
    }).join('');
    var errors = p.errors.slice(0, 20).map(function (r) { return '<li>قطار ' + r.rowNo + ': ' + esc(r.message) + '</li>'; }).join('');
    body.innerHTML = '<h4>مرحلہ ۳: پیش منظر اور توثیق</h4>'
      + '<p><b style="color:#166534">درست: ' + p.valid.length + '</b> · <b style="color:#b91c1c">غلط/چھوڑی: ' + p.errors.length + '</b></p>'
      + '<p class="exam-import-hint">لنک شدہ مضامین: ' + esc(bookList) + '</p>'
      + (validRows ? '<div class="table-responsive"><table class="data-table"><thead><tr><th>قطار</th><th>طالب علم</th><th>ID</th><th>امتحان</th><th>درجہ</th><th>مضامین</th></tr></thead><tbody>' + validRows + '</tbody></table></div>' : '')
      + (errors ? '<div class="exam-import-errors"><b>غلط قطاریں:</b><ul>' + errors + '</ul></div>' : '')
      + '<p class="exam-import-hint">صرف درست قطاریں محفوظ ہوں گی۔ موجودہ امتحان/درجہ/تاریخ کے اسی طالب علم کا پرانا نتیجہ اپڈیٹ ہوگا۔</p>'
      + '<div class="btn-action-group"><button class="btn btn-outline" id="btn-exam-import-back">کالم میپنگ پر واپس</button>'
      + '<button class="btn btn-success" id="btn-exam-import-confirm" ' + (!p.valid.length ? 'disabled' : '') + '>درست نتائج محفوظ کریں (' + p.valid.length + ')</button></div>';
    $('btn-exam-import-back').onclick = render;
    var confirmBtn = $('btn-exam-import-confirm');
    if (confirmBtn) confirmBtn.onclick = persist;
  }

  function findExistingResult(rows, result) {
    var matches = (rows || []).filter(function (x) {
      return x && x.examName === result.examName && x.class === result.className
        && String(x.studentId) === String(result.user.id)
        && resultDateOf(x) === result.resultDate;
    });
    matches.sort(function (a, b) { return Number(b.timestamp || 0) - Number(a.timestamp || 0); });
    return matches[0] || null;
  }

  function summarizeMarks(className, marks) {
    var total = 0, grand = 0;
    Object.keys(marks || {}).forEach(function (bookName) {
      grand += bookMaxMarks(className, bookName);
      var value = marks[bookName];
      if (value != null && value !== 'AB') total += Number(value) || 0;
    });
    var percentage = grand > 0 ? (total / grand) * 100 : 0;
    return { total: total, grand: grand, percentage: percentage, grade: grade(percentage) };
  }

  function persist() {
    var p = S.preview;
    if (!p || !p.valid.length) return;
    if (typeof global.emsRequireStaffAction === 'function' && !global.emsRequireStaffAction('exams', 'edit')) return;
    var confirmBtn = $('btn-exam-import-confirm');
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> محفوظ ہو رہا ہے…'; }
    var lockFn = global.exmIsExamLocked;
    for (var li = 0; li < p.valid.length; li++) {
      var chk = p.valid[li];
      if (typeof lockFn === 'function' && lockFn(chk.examName, chk.className, chk.resultDate)) {
        if (confirmBtn) confirmBtn.disabled = false;
        return toast('لاک شدہ نتیجہ: ' + chk.examName + ' — درآمد ممکن نہیں', 'error');
      }
    }
    function doPersistWrite() {
      var db = readJson(EXAMS_KEY, []);
      if (!Array.isArray(db)) db = [];
      var now = Date.now(), inserted = 0, updated = 0, healed = 0;
      p.valid.forEach(function (r) {
        var existing = findExistingResult(db, r);
        var marks = Object.assign({}, existing && existing.marks || {}, r.marks || {});
        var summary = summarizeMarks(r.className, marks);
        var record = Object.assign({}, existing || {}, {
          id: existing && existing.id
            ? existing.id
            : (typeof global.exmCanonicalResultId === 'function'
              ? global.exmCanonicalResultId(r.examName, r.className, r.user.id, r.resultDate)
              : ('RES-' + now + '-' + r.rowNo)),
          examName: r.examName, class: r.className, studentId: r.user.id, studentName: r.user.name || '',
          studentPhoto: r.user.photoBase64 || r.user.photoUrl || '',
          marks: marks, totalObtained: summary.total, grandTotal: summary.grand,
          percentage: summary.percentage.toFixed(1), grade: summary.grade, resultDate: r.resultDate, timestamp: now
        });
        if (typeof global.emsStampDepartment === 'function') global.emsStampDepartment(record, r.user.departmentId);
        if (typeof global.exmUpsertResultByIdentity === 'function') {
          var upsert = global.exmUpsertResultByIdentity(db, record);
          if (upsert.inserted) inserted++; else updated++;
          healed += Number(upsert.duplicatesRemoved || 0);
        } else if (existing) {
          var existingIndex = db.indexOf(existing);
          db[existingIndex] = record; updated++;
        } else {
          db.push(record); inserted++;
        }
      });
      var save = typeof global.emsSaveModuleData === 'function'
        ? global.emsSaveModuleData(EXAMS_KEY, JSON.stringify(db), { mutation: true, autoDelta: true })
        : Promise.resolve(localStorage.setItem(EXAMS_KEY, JSON.stringify(db)));
      return Promise.resolve(save).then(function () {
        return { inserted: inserted, updated: updated, healed: healed };
      });
    }

    var chain = typeof global.emsDurableEnsureKey === 'function'
      ? global.emsDurableEnsureKey(EXAMS_KEY)
      : Promise.resolve();
    chain = chain.then(function () {
      if (typeof global.exmRunExamsPersist === 'function') {
        return global.exmRunExamsPersist(doPersistWrite);
      }
      return doPersistWrite();
    });
    Promise.resolve(chain).then(function (stats) {
      stats = stats || {};
      toast((stats.inserted || 0) + ' نئے اور ' + (stats.updated || 0) + ' نتائج محفوظ ہو گئے'
        + (stats.healed ? '؛ ' + stats.healed + ' پرانی نقلیں ختم ہوئیں' : '')
        + (p.errors.length ? '؛ ' + p.errors.length + ' غلط قطاریں چھوڑی گئیں' : ''), p.errors.length ? 'warning' : 'success');
      S = { file: null, parsed: null, map: {}, customBooks: {}, preview: null, workbook: null, sheetNames: [] };
      render();
      if (typeof global.examUpdateExportSummary === 'function') global.examUpdateExportSummary();
    }).catch(function (err) {
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'دوبارہ محفوظ کریں'; }
      toast((err && err.message) || 'نتائج محفوظ نہیں ہو سکے', 'error');
    });
  }

  function filteredResults() {
    var ctx = currentContext();
    var allDates = !!(($('exam-export-all-dates') || {}).checked);
    var db = readJson(EXAMS_KEY, []);
    if (!Array.isArray(db)) db = [];
    return db.filter(function (m) {
      if (!m) return false;
      if (ctx.examName && m.examName !== ctx.examName) return false;
      if (ctx.className && m.class !== ctx.className) return false;
      if (!allDates && ctx.resultDate && resultDateOf(m) !== ctx.resultDate) return false;
      return true;
    });
  }

  function exportMatrix(list) {
    var bookSet = {};
    list.forEach(function (r) {
      Object.keys(r.marks || {}).forEach(function (b) { bookSet[b] = true; });
    });
    var books = Object.keys(bookSet).sort();
    var header = ['ID', 'نام', 'درجہ', 'امتحان', 'تاریخ'].concat(books).concat(['کل حاصل', 'کل ممکن', 'فیصد', 'گریڈ']);
    var rows = list.map(function (r) {
      var line = [r.studentId, r.studentName, r.class, r.examName, resultDateOf(r)];
      books.forEach(function (b) {
        var v = r.marks && r.marks[b];
        line.push(v == null ? '' : v);
      });
      line.push(r.totalObtained, r.grandTotal, r.percentage, r.grade);
      return line;
    });
    return { header: header, rows: rows, books: books };
  }

  function downloadBlob(content, filename, type) {
    var blob = new Blob([content], { type: type || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  function examExportResultsXlsx(format) {
    var list = filteredResults();
    if (!list.length) return toast('منتخب دائرے میں برآمد کے لیے کوئی نتیجہ نہیں ملا', 'warning');
    var matrix = exportMatrix(list);
    var ctx = currentContext();
    var stamp = new Date().toISOString().slice(0, 10);
    var fname = 'نتائج_' + (ctx.className || 'تمام') + '_' + stamp;
    if (format === 'xlsx' && global.XLSX) {
      var ws = global.XLSX.utils.aoa_to_sheet([matrix.header].concat(matrix.rows));
      var wb = global.XLSX.utils.book_new();
      global.XLSX.utils.book_append_sheet(wb, ws, 'Results');
      global.XLSX.writeFile(wb, fname + '.xlsx');
      toast(list.length + ' نتائج Excel میں برآمد ہوئے', 'success');
      return;
    }
    if (format === 'json') {
      var clean = list.map(function (r) {
        var row = Object.assign({}, r);
        delete row.studentPhoto;
        return row;
      });
      downloadBlob(JSON.stringify(clean, null, 2), fname + '.json', 'application/json;charset=utf-8');
      toast(list.length + ' نتائج JSON میں برآمد ہوئے', 'success');
      return;
    }
    if (typeof global.examDownloadCSV === 'function') {
      global.examDownloadCSV([matrix.header].concat(matrix.rows), fname + '.csv');
      toast(list.length + ' نتائج CSV میں برآمد ہوئے', 'success');
    }
  }

  global.examRunResultExport = function (format) {
    if (typeof global.emsRequireStaffAction === 'function' && !global.emsRequireStaffAction('exams', 'view')) return;
    format = format || 'xlsx';
    if (format !== 'xlsx') return examExportResultsXlsx(format);
    if (global.XLSX) return examExportResultsXlsx('xlsx');
    if (typeof global.emsLoadXlsxLib === 'function') {
      global.emsLoadXlsxLib().then(function () { examExportResultsXlsx('xlsx'); })
        .catch(function () { toast('Excel لائبریری لوڈ نہیں ہوئی؛ CSV استعمال کریں', 'error'); });
      return;
    }
    toast('Excel لائبریری دستیاب نہیں؛ CSV استعمال کریں', 'error');
  };

  global.examExportResultsXlsx = examExportResultsXlsx;

  function setDataField(id, value) {
    var el = $(id);
    if (!el || value == null || value === '') return;
    el.value = String(value);
  }

  function focusDataCard(mode) {
    var importCard = $('exam-import-card');
    var exportCard = $('exam-export-card');
    if (importCard) importCard.classList.toggle('is-focused', mode === 'import');
    if (exportCard) exportCard.classList.toggle('is-focused', mode === 'export');
  }

  global.examUpdateDataPageState = function () {
    var locked = contextLocked();
    var status = $('exam-data-lock-status');
    var note = $('exam-import-permission-note');
    if (status) {
      status.classList.toggle('is-locked', locked);
      status.innerHTML = locked ? '<i class="fas fa-lock"></i>&nbsp; نتیجہ لاک ہے' : '<i class="fas fa-lock-open"></i>&nbsp; امپورٹ کے لیے کھلا';
    }
    if (note) {
      note.hidden = !locked;
      note.innerHTML = locked ? '<b>محفوظ کرنا بند ہے:</b> منتخب امتحان، درجہ اور تاریخ لاک ہیں۔ ایکسپورٹ بدستور دستیاب ہے۔' : '';
    }
    var file = $('exam-import-file');
    if (file) file.disabled = locked;
  };

  global.examUpdateExportSummary = function () {
    var list = filteredResults();
    var summary = $('exam-export-summary');
    var preview = $('exam-export-preview');
    var classSet = {}, bookSet = {};
    list.forEach(function (r) {
      if (r.class) classSet[r.class] = true;
      Object.keys(r.marks || {}).forEach(function (b) { bookSet[b] = true; });
    });
    if (summary) summary.innerHTML = ''
      + '<div class="exam-export-stat"><strong>' + list.length + '</strong><span>نتائج</span></div>'
      + '<div class="exam-export-stat"><strong>' + Object.keys(classSet).length + '</strong><span>درجات</span></div>'
      + '<div class="exam-export-stat"><strong>' + Object.keys(bookSet).length + '</strong><span>مضامین</span></div>';
    if (!preview) return;
    if (!list.length) {
      preview.innerHTML = '<p class="exam-import-hint" style="padding:14px;margin:0;">منتخب دائرے میں کوئی محفوظ نتیجہ نہیں۔</p>';
      return;
    }
    var sample = list.slice(0, 10);
    preview.innerHTML = '<table class="data-table"><thead><tr><th>ID</th><th>نام</th><th>درجہ</th><th>امتحان</th><th>تاریخ</th><th>فیصد</th></tr></thead><tbody>'
      + sample.map(function (r) {
        return '<tr><td>' + esc(r.studentId) + '</td><td>' + esc(r.studentName) + '</td><td>' + esc(r.class) + '</td><td>' + esc(r.examName) + '</td><td>' + esc(resultDateOf(r)) + '</td><td>' + esc(r.percentage) + '%</td></tr>';
      }).join('') + '</tbody></table>'
      + (list.length > sample.length ? '<p class="exam-import-hint" style="padding:8px 12px;margin:0;">پہلے 10 نتائج دکھائے گئے؛ فائل میں تمام ' + list.length + ' شامل ہوں گے۔</p>' : '');
  };

  global.examPrepareDataPage = function (mode) {
    var seed = global._examDataSeed || {};
    setDataField('exam-data-exam-name', seed.examName);
    setDataField('exam-data-class', seed.className);
    setDataField('exam-data-result-date', seed.resultDate || dateYmd(new Date()));
    global._examDataSeed = null;
    if (!S) S = { file: null, parsed: null, map: {}, customBooks: {}, preview: null, workbook: null, sheetNames: [] };
    render();
    global.examUpdateDataPageState();
    global.examUpdateExportSummary();
    focusDataCard(mode || '');
    ['exam-data-exam-name', 'exam-data-class', 'exam-data-result-date', 'exam-export-all-dates'].forEach(function (id) {
      var el = $(id);
      if (!el || el._examDataBound) return;
      el._examDataBound = true;
      el.addEventListener('change', function () {
        global.examUpdateDataPageState();
        global.examUpdateExportSummary();
        if (S && !S.parsed) render();
      });
    });
  };

  global.examOpenDataPage = function (mode) {
    if (typeof global.emsRequireStaffAction === 'function' && !global.emsRequireStaffAction('exams', 'view')) return;
    global._examDataSeed = {
      examName: (($('mrk-exam-name') || {}).value || '').trim(),
      className: (($('mrk-class') || {}).value || '').trim(),
      resultDate: (($('mrk-result-date') || {}).value || '').trim()
    };
    var nav = document.querySelector('#exam-ribbon-menu [onclick*="exam-win-data"]');
    if (typeof global.switchExamTab === 'function') global.switchExamTab('exam-win-data', nav);
    global.examPrepareDataPage(mode || 'import');
  };

  global.examDownloadResultTemplate = function () {
    var ctx = currentContext();
    var books = activeBooks(ctx.className).map(function (b) { return b.name; });
    var header = ['طالب علم ID / رول نمبر', 'طالب علم کا نام', 'درجہ', 'امتحان', 'نتیجے کی تاریخ'].concat(books);
    var row = ['', '', ctx.className || '', ctx.examName || '', ctx.resultDate || dateYmd(new Date())].concat(books.map(function () { return ''; }));
    var run = function () {
      if (!global.XLSX) {
        if (typeof global.examDownloadCSV === 'function') global.examDownloadCSV([header, row], 'امتحانی_نتائج_سانچہ.csv');
        return;
      }
      var ws = global.XLSX.utils.aoa_to_sheet([header, row]);
      var wb = global.XLSX.utils.book_new();
      global.XLSX.utils.book_append_sheet(wb, ws, 'Results Template');
      global.XLSX.writeFile(wb, 'امتحانی_نتائج_سانچہ.xlsx');
    };
    if (global.XLSX) run();
    else if (typeof global.emsLoadXlsxLib === 'function') global.emsLoadXlsxLib().then(run).catch(run);
    else run();
  };

  global.examOpenResultExport = function () { global.examOpenDataPage('export'); };

  global.examOpenResultImport = function () {
    if (typeof global.emsRequireStaffAction === 'function' && !global.emsRequireStaffAction('exams', 'edit')) return;
    S = { file: null, parsed: null, map: {}, customBooks: {}, preview: null, workbook: null, sheetNames: [] };
    global.examOpenDataPage('import');
  };
  global.examCloseResultImport = function () {
    S = null;
    var nav = document.querySelector('#exam-ribbon-menu [onclick*="exam-win-marks"]');
    if (typeof global.switchExamTab === 'function') global.switchExamTab('exam-win-marks', nav);
  };
})(typeof window !== 'undefined' ? window : globalThis);
