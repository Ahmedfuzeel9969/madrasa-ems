// ================= Phase G: Report + Dashboard Widget + Form Print Builder =================
(function () {
  'use strict';

  var REPORTS_KEY = 'ems_custom_reports';
  var WIDGETS_KEY = 'ems_custom_dashboard';
  var FORMS_KEY = 'ems_custom_form_templates';

  var SOURCES = {
    registration: {
      label: 'رجسٹریشن',
      load: function () {
        return loadRegistrationRows();
      },
      columns: [
        { id: 'name', label: 'نام', val: function (r) { return r.name || r.fullName || '—'; } },
        { id: 'type', label: 'قسم', val: function (r) { return r.type || '—'; } },
        { id: 'class', label: 'کلاس/شعبہ', val: function (r) { return r.class || r.dept || '—'; } },
        { id: 'cnic', label: 'CNIC', val: function (r) { return r.cnic || '—'; } },
        { id: 'phone', label: 'رابطہ', val: function (r) { return r.phone || r.contact || '—'; } },
        { id: 'father', label: 'ولدیت', val: function (r) { return r.fatherName || r.guardian || '—'; } },
        { id: 'address', label: 'پتہ', val: function (r) { return r.address || '—'; } },
        { id: 'regDate', label: 'تاریخ', val: function (r) { return r.regDate || r.createdAt || '—'; } }
      ],
      typeFilter: true
    },
    finance: {
      label: 'فیس وصولی',
      load: function () {
        return cacheGet('ems_fee_collections', []);
      },
      columns: [
        { id: 'date', label: 'تاریخ', val: function (r) { return r.date || '—'; } },
        { id: 'student', label: 'طالب', val: function (r) { return r.studentName || r.studentId || '—'; } },
        { id: 'amount', label: 'رقم', val: function (r) { return Number(r.amount) || 0; } },
        { id: 'mode', label: 'طریقہ', val: function (r) { return r.paymentMode || r.mode || '—'; } },
        { id: 'receipt', label: 'رسید', val: function (r) { return r.receiptNo || r.id || '—'; } }
      ]
    },
    ledger: {
      label: 'روزنامچہ',
      load: function () {
        return cacheGet('ems_full_ledger', null) || cacheGet('ems_ledger_db', []);
      },
      columns: [
        { id: 'date', label: 'تاریخ', val: function (r) { return r.date || '—'; } },
        { id: 'type', label: 'قسم', val: function (r) { return r.type || '—'; } },
        { id: 'category', label: 'زمرہ', val: function (r) { return r.category || r.head || '—'; } },
        { id: 'amount', label: 'رقم', val: function (r) { return Number(r.amount) || 0; } },
        { id: 'desc', label: 'تفصیل', val: function (r) { return r.description || r.note || '—'; } },
        { id: 'fund', label: 'فنڈ', val: function (r) { return r.fund || '—'; } }
      ],
      typeFilter: true,
      typeOptions: [{ id: 'all', label: 'سب' }, { id: 'Income', label: 'آمدن' }, { id: 'Expense', label: 'خرچ' }]
    },
    exams: {
      label: 'امتحانات',
      load: function () {
        return cacheGet('ems_full_exams', null) || cacheGet('ems_exams_db', []);
      },
      columns: [
        { id: 'student', label: 'طالب', val: function (r) { return r.studentName || r.studentId || '—'; } },
        { id: 'exam', label: 'امتحان', val: function (r) { return r.examName || r.examType || '—'; } },
        { id: 'marks', label: 'حاصل', val: function (r) { return r.obtained != null ? r.obtained : (r.marks || '—'); } },
        { id: 'total', label: 'کل', val: function (r) { return r.total || r.maxMarks || '—'; } },
        { id: 'percent', label: 'فیصد', val: function (r) { return r.percentage || r.percent || '—'; } },
        { id: 'grade', label: 'گریڈ', val: function (r) { return r.grade || '—'; } }
      ]
    }
  };

  var REPORT_PRESETS = [
    { name: 'تمام طلباء', source: 'registration', filterType: 'student', columns: ['name', 'class', 'phone', 'cnic'] },
    { name: 'اساتذہ فہرست', source: 'registration', filterType: 'teacher', columns: ['name', 'phone', 'class', 'cnic'] },
    { name: 'فیس وصولی', source: 'finance', columns: ['date', 'student', 'amount', 'receipt'] },
    { name: 'آمدن (Ledger)', source: 'ledger', filterType: 'Income', columns: ['date', 'category', 'amount', 'desc'] },
    { name: 'امتحانی نتائج', source: 'exams', columns: ['student', 'exam', 'marks', 'total', 'grade'] }
  ];

  var WIDGET_PRESETS = [
    { name: 'کل طلباء', type: 'stat', source: 'registration', filterType: 'student', metric: 'count', color: '#3498db', icon: 'fa-user-graduate' },
    { name: 'آج کی وصولی', type: 'stat', source: 'finance', metric: 'sum', field: 'amount', dateFilter: 'today', color: '#27ae60', icon: 'fa-coins' },
    { name: 'کل آمدن', type: 'stat', source: 'ledger', filterType: 'Income', metric: 'sum', field: 'amount', color: '#16a34a', icon: 'fa-arrow-up' }
  ];

  var FORM_BUILTIN = {
    student: [
      { id: 'name', label: 'نام' }, { id: 'fatherName', label: 'ولدیت' }, { id: 'class', label: 'کلاس' },
      { id: 'cnic', label: 'CNIC' }, { id: 'phone', label: 'رابطہ' }, { id: 'address', label: 'پتہ' }
    ],
    teacher: [
      { id: 'name', label: 'نام' }, { id: 'subject', label: 'مضمون' }, { id: 'phone', label: 'رابطہ' }, { id: 'cnic', label: 'CNIC' }
    ],
    staff: [
      { id: 'name', label: 'نام' }, { id: 'dept', label: 'شعبہ' }, { id: 'phone', label: 'رابطہ' }, { id: 'cnic', label: 'CNIC' }
    ]
  };

  function readJson(key, fb) {
    if (typeof window.emsCacheGet === 'function') return window.emsCacheGet(key, fb);
    try { return JSON.parse(localStorage.getItem(key) || (fb != null ? JSON.stringify(fb) : 'null')); } catch (e) { return fb; }
  }

  function cacheGet(key, fb) {
    return readJson(key, fb);
  }

  function loadRegistrationRows() {
    if (typeof window.emsGetUsersMerged === 'function') return window.emsGetUsersMerged();
    return [];
  }

  function writeJson(key, val) {
    if (window.emsSaveModuleData) return window.emsSaveModuleData(key, JSON.stringify(val), { mutation: true, autoDelta: true });
    localStorage.setItem(key, JSON.stringify(val));
    return Promise.resolve();
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'success');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function todayStr() {
    return new Date().toISOString().split('T')[0];
  }

  function applyReportFilters(rows, cfg) {
    rows = rows.slice();
    if (cfg.filterType && cfg.filterType !== 'all') {
      if (cfg.source === 'registration') rows = rows.filter(function (r) { return r.type === cfg.filterType; });
      else if (cfg.source === 'ledger') rows = rows.filter(function (r) { return r.type === cfg.filterType; });
    }
    if (cfg.filterClass) {
      rows = rows.filter(function (r) { return (r.class || r.dept || '') === cfg.filterClass; });
    }
    if (cfg.dateFrom) rows = rows.filter(function (r) { return (r.date || r.regDate || '') >= cfg.dateFrom; });
    if (cfg.dateTo) rows = rows.filter(function (r) { return (r.date || r.regDate || '') <= cfg.dateTo; });
    if (cfg.dateFilter === 'today') {
      var t = todayStr();
      rows = rows.filter(function (r) { return (r.date || '') === t; });
    }
    if (cfg.dateFilter === 'month') {
      var m = todayStr().substring(0, 7);
      rows = rows.filter(function (r) { return (r.date || r.regDate || '').substring(0, 7) === m; });
    }
    var src = SOURCES[cfg.source];
    if (cfg.sortBy && src) {
      var col = src.columns.find(function (c) { return c.id === cfg.sortBy; });
      if (col) {
        rows.sort(function (a, b) {
          var va = col.val(a); var vb = col.val(b);
          if (typeof va === 'number' && typeof vb === 'number') return cfg.sortDir === 'desc' ? vb - va : va - vb;
          va = String(va); vb = String(vb);
          return cfg.sortDir === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb);
        });
      }
    }
    if (cfg.limit) rows = rows.slice(0, cfg.limit);
    return rows;
  }

  window.sysReportQuery = function (cfg) {
    var src = SOURCES[cfg.source];
    if (!src) return { headers: [], rows: [], cfg: cfg };
    var cols = (cfg.columns || []).map(function (cid) {
      return src.columns.find(function (c) { return c.id === cid; });
    }).filter(Boolean);
    if (!cols.length) cols = src.columns.slice(0, 4);
    var data = applyReportFilters(src.load(), cfg);
    return {
      headers: cols.map(function (c) { return c.label; }),
      colIds: cols.map(function (c) { return c.id; }),
      rows: data.map(function (row) {
        return cols.map(function (c) {
          var v = c.val(row);
          return typeof v === 'number' ? v.toLocaleString('ur-PK') : v;
        });
      }),
      rawCount: data.length,
      cfg: cfg
    };
  };

  window.sysReportGetAll = function () { return readJson(REPORTS_KEY, []) || []; };
  window.sysWidgetGetAll = function () { return readJson(WIDGETS_KEY, []) || []; };
  window.sysFormTplGetAll = function () { return readJson(FORMS_KEY, []) || []; };

  window.sysReportRun = function (id) {
    var r = window.sysReportGetAll().find(function (x) { return x.id === id; });
    if (!r) return null;
    return window.sysReportQuery(r);
  };

  window.sysReportSave = function (data) {
    if (typeof window.sysRequirePerm === 'function' && !window.sysRequirePerm('reports', 'edit')) return;
    var list = window.sysReportGetAll();
    var before = JSON.parse(JSON.stringify(list));
    if (data.id) {
      var idx = list.findIndex(function (x) { return x.id === data.id; });
      if (idx >= 0) list[idx] = Object.assign({}, list[idx], data, { updatedAt: Date.now() });
    } else {
      data.id = 'RPT-' + Date.now();
      data.createdAt = Date.now();
      list.push(data);
    }
    writeJson(REPORTS_KEY, list);
    if (typeof window.sysAuditLog === 'function') window.sysAuditLog('update', 'custom_report', data.name, before, list);
    window.sysReportRenderTable();
    toast('رپورٹ محفوظ', 'success');
  };

  window.sysReportDelete = function (id) {
    if (typeof window.sysRequirePerm === 'function' && !window.sysRequirePerm('reports', 'edit')) return;
    if (!confirm('رپورٹ حذف؟')) return;
    writeJson(REPORTS_KEY, window.sysReportGetAll().filter(function (x) { return x.id !== id; }));
    window.sysReportRenderTable();
  };

  window.sysWidgetSave = function (data) {
    if (typeof window.sysRequirePerm === 'function' && !window.sysRequirePerm('reports', 'edit')) return;
    var list = window.sysWidgetGetAll();
    if (data.id) {
      var idx = list.findIndex(function (x) { return x.id === data.id; });
      if (idx >= 0) list[idx] = Object.assign({}, list[idx], data, { updatedAt: Date.now() });
    } else {
      data.id = 'DWG-' + Date.now();
      data.createdAt = Date.now();
      list.push(data);
    }
    writeJson(WIDGETS_KEY, list);
    if (typeof window.sysAuditLog === 'function') window.sysAuditLog('update', 'dashboard_widget', data.name);
    window.sysWidgetRenderTable();
    window.sysDashRenderCustomWidgets();
    toast('Widget محفوظ', 'success');
  };

  window.sysWidgetDelete = function (id) {
    if (typeof window.sysRequirePerm === 'function' && !window.sysRequirePerm('reports', 'edit')) return;
    if (!confirm('Widget حذف؟')) return;
    writeJson(WIDGETS_KEY, window.sysWidgetGetAll().filter(function (x) { return x.id !== id; }));
    window.sysWidgetRenderTable();
    window.sysDashRenderCustomWidgets();
  };

  window.sysFormTplSave = function (data) {
    if (typeof window.sysRequirePerm === 'function' && !window.sysRequirePerm('reports', 'edit')) return;
    var list = window.sysFormTplGetAll();
    if (data.id) {
      var idx = list.findIndex(function (x) { return x.id === data.id; });
      if (idx >= 0) list[idx] = Object.assign({}, list[idx], data, { updatedAt: Date.now() });
    } else {
      data.id = 'FRM-' + Date.now();
      data.createdAt = Date.now();
      list.push(data);
    }
    writeJson(FORMS_KEY, list);
    if (typeof window.sysAuditLog === 'function') window.sysAuditLog('update', 'form_template', data.name);
    window.sysFormTplRenderTable();
    toast('فارم سانچہ محفوظ', 'success');
  };

  window.sysReportExportCsv = function (id) {
    if (typeof window.sysRequirePerm === 'function' && !window.sysRequirePerm('reports', 'export')) return;
    var result = window.sysReportRun(id);
    if (!result) return;
    var csv = result.headers.join(',') + '\n' + result.rows.map(function (row) {
      return row.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
    var a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,\ufeff' + encodeURIComponent(csv);
    a.download = 'report-' + id + '.csv';
    a.click();
  };

  window.sysReportPrint = function (id) {
    if (typeof window.sysRequirePerm === 'function' && !window.sysRequirePerm('reports', 'export')) return;
    var result = window.sysReportRun(id);
    if (!result) return;
    var r = window.sysReportGetAll().find(function (x) { return x.id === id; });
    var html = '<html dir="rtl"><head><meta charset="utf-8"><title>' + esc(r ? r.name : 'Report') + '</title>' +
      '<style>body{font-family:serif;padding:20px;} table{width:100%;border-collapse:collapse;} th,td{border:1px solid #333;padding:6px;font-size:12px;} th{background:#eee;}</style></head><body>' +
      '<h2 style="text-align:center;">' + esc(r ? r.name : 'رپورٹ') + '</h2>' +
      '<table><thead><tr>' + result.headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      result.rows.map(function (row) { return '<tr>' + row.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table><p style="font-size:11px;color:#666;">کل: ' + result.rawCount + ' — ' + new Date().toLocaleString('ur-PK') + '</p></body></html>';
    var w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  };

  window.sysReportPreview = function (id) {
    var box = document.getElementById('sys-report-preview');
    if (!box) return;
    var result = id ? window.sysReportRun(id) : window.sysReportQuery(window.sysReportCollectForm());
    if (!result.rows.length) { box.innerHTML = '<p style="color:#94a3b8;text-align:center;">کوئی ڈیٹا نہیں</p>'; return; }
    box.innerHTML = '<table class="data-table"><thead><tr>' + result.headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + result.rows.slice(0, 50).map(function (row) {
        return '<tr>' + row.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>' +
      (result.rawCount > 50 ? '<p style="font-size:12px;color:#64748b;">پہلے 50 از ' + result.rawCount + '</p>' : '<p style="font-size:12px;color:#64748b;">کل: ' + result.rawCount + '</p>');
  };

  window.sysReportCollectForm = function () {
    var g = function (id, fb) { var el = document.getElementById(id); return el ? el.value : fb; };
    var cols = [];
    document.querySelectorAll('#sys-report-cols input:checked').forEach(function (cb) { cols.push(cb.value); });
    return {
      id: g('sys-report-edit-id', ''),
      name: g('sys-report-name', '').trim(),
      source: g('sys-report-source', 'registration'),
      filterType: g('sys-report-filter-type', 'all'),
      filterClass: g('sys-report-filter-class', ''),
      dateFrom: g('sys-report-date-from', ''),
      dateTo: g('sys-report-date-to', ''),
      sortBy: g('sys-report-sort', ''),
      sortDir: g('sys-report-sort-dir', 'asc'),
      limit: parseInt(g('sys-report-limit', '0'), 10) || 0,
      columns: cols,
      enabled: document.getElementById('sys-report-enabled') ? document.getElementById('sys-report-enabled').checked : true
    };
  };

  window.sysReportResetForm = function () {
    ['sys-report-edit-id', 'sys-report-name', 'sys-report-filter-class', 'sys-report-date-from', 'sys-report-date-to'].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
    var lim = document.getElementById('sys-report-limit'); if (lim) lim.value = '0';
    if (document.getElementById('sys-report-enabled')) document.getElementById('sys-report-enabled').checked = true;
    window.sysReportUpdateColumnGrid();
    window.sysReportPreview();
  };

  window.sysReportUpdateColumnGrid = function () {
    var srcId = (document.getElementById('sys-report-source') || {}).value || 'registration';
    var src = SOURCES[srcId];
    var grid = document.getElementById('sys-report-cols');
    if (!grid || !src) return;
    grid.innerHTML = src.columns.map(function (c) {
      return '<label class="sys-toggle-chip on"><input type="checkbox" value="' + c.id + '" checked onchange="window.sysReportPreview()"> ' + esc(c.label) + '</label>';
    }).join('');
    var typeWrap = document.getElementById('sys-report-type-wrap');
    if (typeWrap) {
      if (src.typeFilter) {
        typeWrap.style.display = '';
        var sel = document.getElementById('sys-report-filter-type');
        if (sel) {
          var opts = src.typeOptions || [{ id: 'all', label: 'سب' }, { id: 'student', label: 'طلباء' }, { id: 'teacher', label: 'اساتذہ' }, { id: 'staff', label: 'عملہ' }];
          if (srcId === 'ledger') opts = src.typeOptions;
          sel.innerHTML = opts.map(function (o) { return '<option value="' + o.id + '">' + o.label + '</option>'; }).join('');
        }
      } else typeWrap.style.display = 'none';
    }
    var sortSel = document.getElementById('sys-report-sort');
    if (sortSel) sortSel.innerHTML = '<option value="">—</option>' + src.columns.map(function (c) {
      return '<option value="' + c.id + '">' + c.label + '</option>';
    }).join('');
  };

  window.sysReportRenderTable = function () {
    var tbody = document.getElementById('sys-report-list-tbody');
    if (!tbody) return;
    var list = window.sysReportGetAll();
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8;">کوئی رپورٹ نہیں</td></tr>'; return; }
    tbody.innerHTML = list.map(function (r) {
      return '<tr><td>' + esc(r.name) + '</td><td>' + esc(SOURCES[r.source] ? SOURCES[r.source].label : r.source) + '</td><td>' + (r.enabled !== false ? 'فعال' : 'بند') + '</td><td>' + (r.columns ? r.columns.length : 0) + '</td><td>' +
        '<button class="btn btn-sm btn-outline" onclick="window.sysReportPreview(\'' + r.id + '\')"><i class="fas fa-eye"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="window.sysReportEdit(\'' + r.id + '\')"><i class="fas fa-pen"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="window.sysReportPrint(\'' + r.id + '\')"><i class="fas fa-print"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="window.sysReportExportCsv(\'' + r.id + '\')"><i class="fas fa-file-csv"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="window.sysReportDelete(\'' + r.id + '\')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  };

  window.sysReportEdit = function (id) {
    var r = window.sysReportGetAll().find(function (x) { return x.id === id; });
    if (!r) return;
    document.getElementById('sys-report-edit-id').value = r.id;
    document.getElementById('sys-report-name').value = r.name || '';
    document.getElementById('sys-report-source').value = r.source || 'registration';
    window.sysReportUpdateColumnGrid();
    if (r.filterType) document.getElementById('sys-report-filter-type').value = r.filterType;
    if (document.getElementById('sys-report-filter-class')) document.getElementById('sys-report-filter-class').value = r.filterClass || '';
    if (document.getElementById('sys-report-date-from')) document.getElementById('sys-report-date-from').value = r.dateFrom || '';
    if (document.getElementById('sys-report-date-to')) document.getElementById('sys-report-date-to').value = r.dateTo || '';
    if (document.getElementById('sys-report-sort')) document.getElementById('sys-report-sort').value = r.sortBy || '';
    if (document.getElementById('sys-report-sort-dir')) document.getElementById('sys-report-sort-dir').value = r.sortDir || 'asc';
    if (document.getElementById('sys-report-limit')) document.getElementById('sys-report-limit').value = r.limit || 0;
    if (document.getElementById('sys-report-enabled')) document.getElementById('sys-report-enabled').checked = r.enabled !== false;
    document.querySelectorAll('#sys-report-cols input').forEach(function (cb) {
      cb.checked = !r.columns || r.columns.indexOf(cb.value) >= 0;
    });
    window.sysReportPreview(id);
  };

  window.sysWidgetCollectForm = function () {
    var g = function (id, fb) { var el = document.getElementById(id); return el ? el.value : fb; };
    return {
      id: g('sys-widget-edit-id', ''),
      name: g('sys-widget-name', '').trim(),
      type: g('sys-widget-type', 'stat'),
      source: g('sys-widget-source', 'registration'),
      filterType: g('sys-widget-filter-type', 'all'),
      metric: g('sys-widget-metric', 'count'),
      field: g('sys-widget-field', 'amount'),
      dateFilter: g('sys-widget-date-filter', ''),
      color: g('sys-widget-color', '#3498db'),
      icon: g('sys-widget-icon', 'fa-chart-bar'),
      limit: parseInt(g('sys-widget-limit', '5'), 10) || 5,
      enabled: document.getElementById('sys-widget-enabled') ? document.getElementById('sys-widget-enabled').checked : true
    };
  };

  window.sysWidgetCompute = function (w) {
    var cfg = {
      source: w.source,
      filterType: w.filterType,
      dateFilter: w.dateFilter,
      limit: w.limit || 5,
      columns: w.type === 'mini_table' ? (w.columns || ['name', 'amount']) : []
    };
    var rows = applyReportFilters(SOURCES[w.source] ? SOURCES[w.source].load() : [], cfg);
    if (w.type === 'stat') {
      if (w.metric === 'sum') {
        var field = w.field || 'amount';
        var src = SOURCES[w.source];
        var col = src && src.columns.find(function (c) { return c.id === field; });
        var sum = rows.reduce(function (s, r) { return s + (col ? Number(col.val(r)) || 0 : 0); }, 0);
        return { value: sum.toLocaleString('ur-PK'), label: w.name };
      }
      return { value: String(rows.length), label: w.name };
    }
    if (w.type === 'mini_table') {
      var q = window.sysReportQuery(Object.assign({}, w, { columns: w.columns || ['name', 'class'] }));
      return { headers: q.headers, rows: q.rows.slice(0, w.limit || 5) };
    }
    return { value: '—', label: w.name };
  };

  window.sysDashRenderCustomWidgets = function () {
    var grid = document.getElementById('dash-custom-widgets-grid');
    if (!grid) return;
    var widgets = window.sysWidgetGetAll().filter(function (w) { return w.enabled !== false; });
    if (!widgets.length) { grid.style.display = 'none'; grid.innerHTML = ''; return; }
    grid.style.display = 'grid';
    grid.innerHTML = widgets.map(function (w) {
      var computed = window.sysWidgetCompute(w);
      if (w.type === 'mini_table' && computed.rows) {
        return '<div class="dash-panel sys-custom-widget" data-layout-id="dwg-' + w.id + '">' +
          '<div class="dash-panel-head"><div class="dash-panel-ic" style="background:' + esc(w.color || '#6366f1') + ';"><i class="fas ' + esc(w.icon || 'fa-table') + '"></i></div>' +
          '<div><div class="t">' + esc(w.name) + '</div><div class="s">کسٹم جدول</div></div></div>' +
          '<div class="table-responsive" style="max-height:160px;overflow:auto;"><table class="data-table"><thead><tr>' +
          computed.headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          computed.rows.map(function (row) { return '<tr>' + row.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') +
          '</tbody></table></div></div>';
      }
      return '<div class="dash-panel sys-custom-widget" data-layout-id="dwg-' + w.id + '">' +
        '<div class="dash-panel-head"><div class="dash-panel-ic" style="background:' + esc(w.color || '#3498db') + ';"><i class="fas ' + esc(w.icon || 'fa-chart-bar') + '"></i></div>' +
        '<div><div class="t">' + esc(computed.label) + '</div><div class="s">کسٹم KPI</div></div></div>' +
        '<div class="sys-widget-stat-value">' + esc(computed.value) + '</div></div>';
    }).join('');
  };

  window.sysWidgetRenderTable = function () {
    var tbody = document.getElementById('sys-widget-list-tbody');
    if (!tbody) return;
    var list = window.sysWidgetGetAll();
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">کوئی widget نہیں</td></tr>'; return; }
    tbody.innerHTML = list.map(function (w) {
      return '<tr><td>' + esc(w.name) + '</td><td>' + esc(w.type) + '</td><td>' + (w.enabled !== false ? 'فعال' : 'بند') + '</td><td>' +
        '<button class="btn btn-sm btn-outline" onclick="window.sysWidgetEdit(\'' + w.id + '\')"><i class="fas fa-pen"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="window.sysWidgetDelete(\'' + w.id + '\')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  };

  window.sysWidgetEdit = function (id) {
    var w = window.sysWidgetGetAll().find(function (x) { return x.id === id; });
    if (!w) return;
    document.getElementById('sys-widget-edit-id').value = w.id;
    document.getElementById('sys-widget-name').value = w.name || '';
    document.getElementById('sys-widget-type').value = w.type || 'stat';
    document.getElementById('sys-widget-source').value = w.source || 'registration';
    document.getElementById('sys-widget-filter-type').value = w.filterType || 'all';
    document.getElementById('sys-widget-metric').value = w.metric || 'count';
    document.getElementById('sys-widget-field').value = w.field || 'amount';
    document.getElementById('sys-widget-date-filter').value = w.dateFilter || '';
    document.getElementById('sys-widget-color').value = w.color || '#3498db';
    document.getElementById('sys-widget-icon').value = w.icon || 'fa-chart-bar';
    if (document.getElementById('sys-widget-limit')) document.getElementById('sys-widget-limit').value = w.limit || 5;
    if (document.getElementById('sys-widget-enabled')) document.getElementById('sys-widget-enabled').checked = w.enabled !== false;
  };

  window.sysFormTplRenderTable = function () {
    var tbody = document.getElementById('sys-formtpl-list-tbody');
    if (!tbody) return;
    var list = window.sysFormTplGetAll();
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">کوئی سانچہ نہیں</td></tr>'; return; }
    tbody.innerHTML = list.map(function (f) {
      return '<tr><td>' + esc(f.name) + '</td><td>' + esc(f.form) + '</td><td>' + (f.fields ? f.fields.length : 0) + '</td><td>' +
        '<button class="btn btn-sm btn-primary" onclick="window.sysFormTplPrint(\'' + f.id + '\')"><i class="fas fa-print"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="window.sysFormTplEdit(\'' + f.id + '\')"><i class="fas fa-pen"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="window.sysFormTplDelete(\'' + f.id + '\')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  };

  window.sysFormTplDelete = function (id) {
    if (!confirm('سانچہ حذف؟')) return;
    writeJson(FORMS_KEY, window.sysFormTplGetAll().filter(function (x) { return x.id !== id; }));
    window.sysFormTplRenderTable();
  };

  window.sysFormTplEdit = function (id) {
    var f = window.sysFormTplGetAll().find(function (x) { return x.id === id; });
    if (!f) return;
    document.getElementById('sys-formtpl-edit-id').value = f.id;
    document.getElementById('sys-formtpl-name').value = f.name || '';
    document.getElementById('sys-formtpl-form').value = f.form || 'student';
    document.getElementById('sys-formtpl-header').value = f.headerText || '';
    document.getElementById('sys-formtpl-footer').value = f.footerText || '';
    window.sysFormTplUpdateFields();
    (f.fields || []).forEach(function (fid) {
      var cb = document.querySelector('#sys-formtpl-fields input[value="' + fid + '"]');
      if (cb) cb.checked = true;
    });
  };

  window.sysFormTplUpdateFields = function () {
    var form = (document.getElementById('sys-formtpl-form') || {}).value || 'student';
    var wrap = document.getElementById('sys-formtpl-fields');
    if (!wrap) return;
    var builtins = FORM_BUILTIN[form] || [];
    var custom = [];
    try {
      custom = (JSON.parse(localStorage.getItem('ems_custom_fields')) || []).filter(function (cf) {
        return cf.form === form && cf.enabled !== false;
      }).map(function (cf) { return { id: 'cf:' + cf.key, label: cf.label }; });
    } catch (e) { /* ignore */ }
    var all = builtins.concat(custom);
    wrap.innerHTML = all.map(function (f) {
      return '<label class="sys-toggle-chip on"><input type="checkbox" value="' + esc(f.id) + '" checked> ' + esc(f.label) + '</label>';
    }).join('');
  };

  window.sysFormTplCollect = function () {
    var fields = [];
    document.querySelectorAll('#sys-formtpl-fields input:checked').forEach(function (cb) { fields.push(cb.value); });
    return {
      id: (document.getElementById('sys-formtpl-edit-id') || {}).value,
      name: (document.getElementById('sys-formtpl-name') || {}).value.trim(),
      form: (document.getElementById('sys-formtpl-form') || {}).value,
      headerText: (document.getElementById('sys-formtpl-header') || {}).value,
      footerText: (document.getElementById('sys-formtpl-footer') || {}).value,
      fields: fields
    };
  };

  window.sysFormTplPrint = function (id) {
    var tpl = window.sysFormTplGetAll().find(function (x) { return x.id === id; });
    if (!tpl) return;
    var users = loadRegistrationRows();
    users = users.filter(function (u) { return u.type === tpl.form; }).slice(0, 1);
    var sample = users[0] || { name: '—', fatherName: '—', class: '—' };
    var customFields = [];
    try { customFields = JSON.parse(localStorage.getItem('ems_custom_fields')) || []; } catch (e) { /* ignore */ }
    var rows = (tpl.fields || []).map(function (fid) {
      var label = fid;
      var val = '—';
      if (fid.indexOf('cf:') === 0) {
        var key = fid.slice(3);
        var cf = customFields.find(function (c) { return c.key === key; });
        if (cf) label = cf.label;
        val = sample.customFields && sample.customFields[key] ? sample.customFields[key] : '—';
      } else {
        var b = (FORM_BUILTIN[tpl.form] || []).find(function (x) { return x.id === fid; });
        if (b) label = b.label;
        val = sample[fid] || '—';
      }
      return '<tr><th style="width:35%;background:#f8fafc;">' + esc(label) + '</th><td>' + esc(val) + '</td></tr>';
    }).join('');
    var html = '<html dir="rtl"><head><meta charset="utf-8"><title>' + esc(tpl.name) + '</title>' +
      '<style>body{font-family:serif;padding:30px;max-width:700px;margin:0 auto;} table{width:100%;border-collapse:collapse;margin:16px 0;} th,td{border:1px solid #333;padding:10px;text-align:right;} h1{text-align:center;}</style></head><body>' +
      (tpl.headerText ? '<p style="text-align:center;">' + esc(tpl.headerText) + '</p>' : '') +
      '<h1>' + esc(tpl.name) + '</h1><table>' + rows + '</table>' +
      (tpl.footerText ? '<p style="text-align:center;font-size:12px;">' + esc(tpl.footerText) + '</p>' : '') +
      '</body></html>';
    var w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  };

  window.sysReportInitUI = function () {
    window.sysReportUpdateColumnGrid();
    window.sysReportRenderTable();
    window.sysWidgetRenderTable();
    window.sysFormTplRenderTable();
    window.sysFormTplUpdateFields();
    window.sysReportPreview();
  };

  window.sysReportApplyPreset = function (idx) {
    var p = REPORT_PRESETS[idx];
    if (!p) return;
    document.getElementById('sys-report-edit-id').value = '';
    document.getElementById('sys-report-name').value = p.name;
    document.getElementById('sys-report-source').value = p.source;
    window.sysReportUpdateColumnGrid();
    if (p.filterType && document.getElementById('sys-report-filter-type')) {
      document.getElementById('sys-report-filter-type').value = p.filterType;
    }
    document.querySelectorAll('#sys-report-cols input').forEach(function (cb) {
      cb.checked = p.columns.indexOf(cb.value) >= 0;
    });
    window.sysReportPreview();
  };

  window.sysWidgetApplyPreset = function (idx) {
    var p = WIDGET_PRESETS[idx];
    if (!p) return;
    document.getElementById('sys-widget-edit-id').value = '';
    Object.keys(p).forEach(function (k) {
      var el = document.getElementById('sys-widget-' + k.replace(/([A-Z])/g, function (m) { return '-' + m.toLowerCase(); }));
      if (!el) {
        el = document.getElementById('sys-widget-' + k);
      }
      if (el && p[k] != null) el.value = p[k];
    });
    if (document.getElementById('sys-widget-name')) document.getElementById('sys-widget-name').value = p.name;
    if (document.getElementById('sys-widget-type')) document.getElementById('sys-widget-type').value = p.type;
    if (document.getElementById('sys-widget-source')) document.getElementById('sys-widget-source').value = p.source;
    if (document.getElementById('sys-widget-filter-type') && p.filterType) document.getElementById('sys-widget-filter-type').value = p.filterType;
    if (document.getElementById('sys-widget-metric')) document.getElementById('sys-widget-metric').value = p.metric || 'count';
    if (document.getElementById('sys-widget-field') && p.field) document.getElementById('sys-widget-field').value = p.field;
    if (document.getElementById('sys-widget-date-filter') && p.dateFilter) document.getElementById('sys-widget-date-filter').value = p.dateFilter;
    if (document.getElementById('sys-widget-color')) document.getElementById('sys-widget-color').value = p.color || '#3498db';
    if (document.getElementById('sys-widget-icon')) document.getElementById('sys-widget-icon').value = p.icon || 'fa-chart-bar';
  };

  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'sys-report-btn-save') {
      var d = window.sysReportCollectForm();
      if (!d.name) return toast('رپورٹ کا نام لکھیں', 'error');
      window.sysReportSave(d);
      window.sysReportResetForm();
    }
    if (e.target && e.target.closest('#sys-widget-btn-save')) {
      var w = window.sysWidgetCollectForm();
      if (!w.name) return toast('Widget نام لکھیں', 'error');
      window.sysWidgetSave(w);
    }
    if (e.target && e.target.closest('#sys-formtpl-btn-save')) {
      var f = window.sysFormTplCollect();
      if (!f.name) return toast('سانچے کا نام لکھیں', 'error');
      window.sysFormTplSave(f);
    }
    if (e.target && e.target.classList.contains('sys-report-preset-btn')) {
      window.sysReportApplyPreset(parseInt(e.target.getAttribute('data-preset'), 10));
    }
    if (e.target && e.target.classList.contains('sys-widget-preset-btn')) {
      window.sysWidgetApplyPreset(parseInt(e.target.getAttribute('data-preset'), 10));
    }
    var tab = e.target && e.target.closest('.sys-rpt-tab');
    if (tab) {
      document.querySelectorAll('.sys-rpt-tab').forEach(function (b) { b.classList.remove('active'); });
      tab.classList.add('active');
      document.querySelectorAll('#sys-win-reports .sys-layout-panel').forEach(function (p) { p.style.display = 'none'; });
      var panel = document.getElementById(tab.getAttribute('data-panel'));
      if (panel) panel.style.display = 'block';
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'sys-report-source') {
      window.sysReportUpdateColumnGrid();
      window.sysReportPreview();
    } else if (e.target && e.target.closest('#sys-report-cols')) {
      window.sysReportPreview();
    }
    if (e.target && e.target.id === 'sys-formtpl-form') window.sysFormTplUpdateFields();
  });

  function sysReportBootWidgets() {
    if (typeof window.emsCanRunEnterpriseBoot === 'function' && !window.emsCanRunEnterpriseBoot()) {
      return;
    }
    if (typeof window.sysDashRenderCustomWidgets === 'function') window.sysDashRenderCustomWidgets();
  }

  if (typeof window.emsRunWhenDomReady === 'function') {
    window.emsRunWhenDomReady(sysReportBootWidgets);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sysReportBootWidgets);
  } else {
    sysReportBootWidgets();
  }
  window.addEventListener('ems:post-auth-deferred-ready', sysReportBootWidgets);

  window.SYS_REPORT_SOURCES = SOURCES;

})();
