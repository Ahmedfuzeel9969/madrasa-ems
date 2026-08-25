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
    if (ext === 'xlsx' || ext === 'xls') {
      if (typeof global.emsLoadXlsxLib !== 'function') return Promise.reject(new Error('Excel لائبریری دستیاب نہیں'));
      return global.emsLoadXlsxLib().then(function () {
        return file.arrayBuffer();
      }).then(function (buf) {
        var wb = global.XLSX.read(buf, { type: 'array' });
        return workbookToParsed(wb, wb.SheetNames[0], 0);
      });
    }
    if (ext !== 'csv') return Promise.reject(new Error('صرف Excel (.xlsx/.xls) یا CSV فائل منتخب کریں'));
    return file.text().then(function (text) {
      var rows = csvRows(String(text).replace(/^\uFEFF/, ''));
      if (rows.length < 2) throw new Error('فائل خالی ہے یا کم از کم ایک data row درکار ہے');
      return { headers: rows[0].map(String), rows: rows.slice(1), sheetName: '', sheetNames: [], rawAoa: rows };
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
      if (name) byName[name] = u;
    });
    var valid = [], errors = [], seen = Object.create(null);
    S.parsed.rows.forEach(function (row, i) {
      var rowNo = i + (Number(S.parsed.headerRow) || 0) + 2;
      var sid = String(cell(row, idIx) || '').trim();
      var name = String(cell(row, nameIx) || '').trim();
      var user = (sid && byId[sid]) || (name && byName[name]) || (!sid && name && byName[name]);
      var rowClass = String(cell(row, classIx) || defaultClass).trim();
      var exam = String(cell(row, examIx) || defaultExam).trim();
      var resultDate = dateYmd(cell(row, dateIx) || defaultDate);
      if (!user) return errors.push({ rowNo: rowNo, message: 'طالب علم ID/نام نہیں ملا' });
      if (!rowClass) return errors.push({ rowNo: rowNo, message: 'درجہ خالی ہے' });
      if (defaultClass && rowClass !== defaultClass) return errors.push({ rowNo: rowNo, message: 'درجہ منتخب درجے سے مختلف ہے (' + rowClass + ')' });
      if (!exam) return errors.push({ rowNo: rowNo, message: 'امتحان موجود نہیں' });
      if (!resultDate) return errors.push({ rowNo: rowNo, message: 'نتیجے کی تاریخ درست نہیں' });
      var ukey = String(user.id || sid);
      if (seen[ukey]) return errors.push({ rowNo: rowNo, message: 'یہ طالب علم فائل میں دوبارہ موجود ہے' });
      seen[ukey] = true;
      var marks = {}, marked = 0, badBook = '';
      bookCols.forEach(function (b) {
        var value = mark(cell(row, b.ix), b.max);
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
    body.innerHTML = '<p><b>مرحلہ ۱:</b> Excel یا CSV فائل منتخب کریں۔</p>'
      + '<p class="exam-import-hint">امتحان، درجہ اور تاریخ فائل کے کالم سے بھی آ سکتے ہیں — یا کشف الدرجات میں پہلے سے منتخب کریں۔</p>'
      + '<ul class="exam-import-hint" style="margin:0 0 12px;padding-right:20px;">'
      + '<li>ہر کالم کو اگلے مرحلے میں کسی بھی خانے سے جوڑ سکتے ہیں</li>'
      + '<li>فائل کے کالم کا نام بطور مضمون بھی استعمال ہو سکتا ہے</li>'
      + '<li>Excel میں متعدد شیٹس اور ہیڈر قطار منتخب کریں</li></ul>'
      + (ctx.examName ? '<p>منتخب: <b>' + esc(ctx.examName) + '</b> · ' + esc(ctx.className) + ' · ' + esc(ctx.resultDate) + '</p>' : '<p class="exam-import-hint">(کشف الدرجات میں امتحان/درجہ/تاریخ خالی بھی رہ سکتی ہے اگر فائل میں ہیں)</p>')
      + '<input id="exam-import-file" type="file" accept=".xlsx,.xls,.csv,.json" class="input-control">';
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
    var modal = $('exam-import-modal');
    var body = $('exam-import-body');
    if (!modal || !body || !S) return;
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

  function persist() {
    var p = S.preview;
    if (!p || !p.valid.length) return;
    var lockFn = global.exmIsExamLocked;
    for (var li = 0; li < p.valid.length; li++) {
      var chk = p.valid[li];
      if (typeof lockFn === 'function' && lockFn(chk.examName, chk.className, chk.resultDate)) {
        return toast('لاک شدہ نتیجہ: ' + chk.examName + ' — درآمد ممکن نہیں', 'error');
      }
    }
    var db = readJson(EXAMS_KEY, []);
    var now = Date.now(), inserted = 0, updated = 0;
    p.valid.forEach(function (r) {
      var marks = r.marks;
      var bookNames = Object.keys(marks);
      var total = 0, grand = 0;
      bookNames.forEach(function (bn) {
        grand += bookMaxMarks(r.className, bn);
        var v = marks[bn];
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
      toast(inserted + ' نئے اور ' + updated + ' نتائج محفوظ ہو گئے' + (p.errors.length ? '؛ ' + p.errors.length + ' غلط قطاریں چھوڑی گئیں' : ''), p.errors.length ? 'warning' : 'success');
      global.examCloseResultImport();
      var refresh = $('btn-generate-mark-sheet');
      if (refresh) refresh.click();
    }).catch(function (err) {
      toast((err && err.message) || 'نتائج محفوظ نہیں ہو سکے', 'error');
    });
  }

  function examExportResultsXlsx(format) {
    if (typeof global.emsRequireStaffAction === 'function' && !global.emsRequireStaffAction('exams', 'view')) return;
    var examName = ($('mrk-exam-name') || {}).value || ($('res-exam-name') || {}).value || '';
    var cls = ($('mrk-class') || {}).value || ($('res-class') || {}).value || '';
    var resultDate = (($('mrk-result-date') || {}).value || ($('res-result-date') || {}).value || '').trim();
    var db = readJson(EXAMS_KEY, []);
    var list = db.filter(function (m) {
      if (!m) return false;
      if (examName && m.examName !== examName) return false;
      if (cls && m.class !== cls) return false;
      if (resultDate && String(m.resultDate || '').slice(0, 10) !== resultDate) return false;
      return true;
    });
    if (!list.length) return toast('برآمد کے لیے کوئی نتیجہ نہیں ملا', 'warning');
    var bookSet = {};
    list.forEach(function (r) {
      Object.keys(r.marks || {}).forEach(function (b) { bookSet[b] = true; });
    });
    var books = Object.keys(bookSet).sort();
    var header = ['ID', 'نام', 'درجہ', 'امتحان', 'تاریخ'].concat(books).concat(['کل حاصل', 'کل ممکن', 'فیصد', 'گریڈ']);
    var rows = list.map(function (r) {
      var line = [r.studentId, r.studentName, r.class, r.examName, String(r.resultDate || '').slice(0, 10)];
      books.forEach(function (b) {
        var v = r.marks && r.marks[b];
        line.push(v == null ? '' : v);
      });
      line.push(r.totalObtained, r.grandTotal, r.percentage, r.grade);
      return line;
    });
    var stamp = new Date().toISOString().slice(0, 10);
    var fname = 'نتائج_' + (cls || 'تمام') + '_' + stamp;
    if (format === 'xlsx' && global.XLSX) {
      var ws = global.XLSX.utils.aoa_to_sheet([header].concat(rows));
      var wb = global.XLSX.utils.book_new();
      global.XLSX.utils.book_append_sheet(wb, ws, 'Results');
      global.XLSX.writeFile(wb, fname + '.xlsx');
      toast(list.length + ' نتائج Excel میں برآمد ہوئے', 'success');
      return;
    }
    if (typeof global.examDownloadCSV === 'function') {
      global.examDownloadCSV([header].concat(rows), fname + '.csv');
      toast(list.length + ' نتائج CSV میں برآمد ہوئے', 'success');
    }
  }

  global.examOpenResultExport = function () {
    if (typeof global.emsRequireStaffAction === 'function' && !global.emsRequireStaffAction('exams', 'view')) return;
    var run = function () { examExportResultsXlsx(global.XLSX ? 'xlsx' : 'csv'); };
    if (global.XLSX) run();
    else if (typeof global.emsLoadXlsxLib === 'function') global.emsLoadXlsxLib().then(run).catch(function () { examExportResultsXlsx('csv'); });
    else examExportResultsXlsx('csv');
  };

  global.examOpenResultImport = function () {
    if (typeof global.emsRequireStaffAction === 'function' && !global.emsRequireStaffAction('exams', 'edit')) return;
    S = { file: null, parsed: null, map: {}, customBooks: {}, preview: null, workbook: null, sheetNames: [] };
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
