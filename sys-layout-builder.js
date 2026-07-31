// ================= Layout Customizer — Phase E =================
(function () {
  'use strict';

  var CONFIG_KEY = 'ems_layout_config';

  var DEFAULT = {
    dashboard: {
      order: ['dash-registration', 'dash-finance', 'dash-attendance', 'dash-exams', 'dash-curriculum', 'dash-training', 'dash-complaints', 'dash-announcements'],
      hidden: [],
      bottomOrder: ['dash-trend', 'dash-activity'],
      bottomHidden: []
    },
    ribbon: {
      order: ['dashboard', 'admission', 'attendance', 'curriculum', 'training', 'complaints', 'exams', 'finance', 'ledger', 'announcements', 'sys-settings', 'admin-panel', 'parent-portal', 'superadmin'],
      hidden: []
    },
    modules: {
      admission: { order: ['reg-student-panel', 'reg-teacher-panel', 'reg-staff-panel', 'reg-branding-panel', 'reg-list-panel', 'reg-rejected-panel', 'reg-data-panel'], hidden: [] },
      attendance: { order: ['att-dashboard-panel', 'att-smart-register', 'att-event-register', 'att-timetable', 'att-holiday-management', 'att-reports-panel', 'att-master-settings', 'att-audit-recycle'], hidden: [] },
      finance: { order: ['fee-win-dashboard', 'fee-win-categories', 'fee-win-structure', 'fee-win-bills', 'fee-win-setup', 'fee-win-collect', 'fee-win-bulk', 'fee-win-dues', 'fee-win-report'], hidden: [] },
      ledger: { order: ['ledger-win-dashboard', 'ledger-win-entry', 'ledger-win-salary', 'ledger-win-funds', 'ledger-win-budget', 'ledger-win-approvals', 'ledger-win-liabilities', 'ledger-win-report', 'ledger-win-audit', 'ledger-win-settings'], hidden: [] },
      exams: { order: ['exam-win-settings', 'exam-win-template', 'exam-win-schedule', 'exam-win-marks', 'exam-win-result', 'exam-win-analysis', 'exam-win-promote'], hidden: [] },
      curriculum: { order: ['cur-win-plan', 'cur-win-daily', 'cur-win-monitor', 'cur-win-reports', 'cur-win-performance', 'cur-win-compare', 'cur-win-settings'], hidden: [] },
      training: { order: ['tar-win-dashboard', 'tar-win-students', 'tar-win-staff', 'tar-win-prayer', 'tar-win-discipline', 'tar-win-ethics', 'tar-win-reform', 'tar-win-awards', 'tar-win-warnings', 'tar-win-reports', 'tar-win-analytics'], hidden: [] },
      complaints: { order: ['cmp-list', 'cmp-new', 'cmp-dashboard'], hidden: [] },
      announcements: { order: ['ann-win-dashboard', 'ann-win-compose', 'ann-win-archive', 'ann-win-messaging', 'ann-win-programs', 'ann-win-designer', 'ann-win-templates', 'ann-win-print', 'ann-win-audit', 'ann-win-settings'], hidden: [] },
      'sys-settings': { order: ['sys-win-theme', 'sys-win-terminology', 'sys-win-buttons', 'sys-win-fields', 'sys-win-layout', 'sys-win-reports', 'sys-win-profiles', 'sys-win-permissions', 'sys-win-audit', 'sys-win-security'], hidden: [] }
    },
    tables: {
      'reg-users-table': {
        columns: [
          { id: 'date', label: 'تاریخ', visible: true },
          { id: 'name', label: 'نام', visible: true },
          { id: 'cnic', label: 'CNIC', visible: true },
          { id: 'position', label: 'عہدہ/کلاس', visible: true },
          { id: 'photo', label: 'تصویر', visible: true },
          { id: 'actions', label: 'ایکشن', visible: true }
        ]
      },
      'reg-rejected-table': {
        columns: [
          { id: 'date', label: 'تاریخ', visible: true },
          { id: 'name', label: 'نام', visible: true },
          { id: 'cnic', label: 'CNIC', visible: true },
          { id: 'phone', label: 'رابطہ', visible: true },
          { id: 'type', label: 'قسم', visible: true },
          { id: 'actions', label: 'ایکشن', visible: true }
        ]
      }
    }
  };

  var LABELS = {
    'dash-registration': 'رجسٹریشن', 'dash-finance': 'مالیات', 'dash-attendance': 'حاضری',
    'dash-exams': 'امتحانات', 'dash-curriculum': 'نصاب', 'dash-training': 'تربیت و نظم', 'dash-complaints': 'شکایات', 'dash-announcements': 'اعلانات',
    'dash-trend': '6 ماہی چارٹ', 'dash-activity': 'حالیہ سرگرمی',
    dashboard: 'ڈیش بورڈ', admission: 'رجسٹریشن', attendance: 'حاضری', complaints: 'شکایات',
    exams: 'امتحانات', curriculum: 'نصاب', training: 'تربیت و نظم', finance: 'فیس', ledger: 'مالیات و تنخواہ', announcements: 'اعلانات',
    'sys-settings': 'سیٹنگز', 'admin-panel': 'ایڈمن', 'parent-portal': 'والدین', superadmin: 'سپر ایڈمن'
  };

  var MODULE_MENUS = {
    admission: '#reg-ribbon-menu',
    attendance: '#att-ribbon-menu',
    finance: '#fin-ribbon-menu',
    ledger: '#ldg-ribbon-menu',
    exams: '#exam-ribbon-menu',
    curriculum: '#cur-ribbon-menu',
    training: '#tar-ribbon-menu',
    complaints: '#cmp-ribbon-menu',
    announcements: '#ann-ribbon-menu',
    'sys-settings': '#sys-ribbon-menu',
    superadmin: '#sa-ribbon-menu'
  };

  /** Mobile shell SSOT — read-only accessors (no duplicate catalogs). */
  window.sysLayoutGetModuleMenus = function () { return MODULE_MENUS; };
  window.sysLayoutGetRibbonLabels = function () { return LABELS; };

  function readJson(key, fb) {
    try { return JSON.parse(localStorage.getItem(key) || (fb != null ? JSON.stringify(fb) : 'null')); } catch (e) { return fb; }
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

  function deepMerge(base, over) {
    if (!over) return JSON.parse(JSON.stringify(base));
    var out = JSON.parse(JSON.stringify(base));
    Object.keys(over).forEach(function (k) {
      if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && out[k]) {
        out[k] = deepMerge(out[k], over[k]);
      } else out[k] = over[k];
    });
    return out;
  }

  var LEGACY_RIBBON_ORDER = ['dashboard', 'admission', 'attendance', 'complaints', 'exams', 'curriculum', 'training', 'finance', 'ledger', 'announcements', 'sys-settings', 'admin-panel', 'parent-portal', 'superadmin'];

  function arraysEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  window.sysLayoutGetConfig = function () {
    var cfg = deepMerge(DEFAULT, readJson(CONFIG_KEY, null));
    if (cfg.ribbon && arraysEqual(cfg.ribbon.order, LEGACY_RIBBON_ORDER)) {
      cfg.ribbon.order = DEFAULT.ribbon.order.slice();
    }
    return cfg;
  };

  window.sysLayoutSaveConfig = function (cfg) {
    var before = readJson(CONFIG_KEY, null);
    writeJson(CONFIG_KEY, cfg);
    if (typeof window.sysAuditLog === 'function') window.sysAuditLog('update', 'layout', 'ترتیب محفوظ', before, cfg);
    window.sysLayoutApplyAll();
    toast('ترتیب لاگو', 'success');
  };

  window.sysLayoutReset = function () {
    if (typeof window.sysRequirePerm === 'function' && !window.sysRequirePerm('layout', 'edit')) return;
    if (!confirm('ڈیفالٹ ترتیب بحال؟')) return;
    writeJson(CONFIG_KEY, DEFAULT);
    window.sysLayoutApplyAll();
    window.sysLayoutInitUI();
    toast('ڈیفالٹ بحال', 'warning');
  };

  function reorderChildren(parent, order, hidden, attr) {
    if (!parent) return;
    attr = attr || 'data-layout-id';
    order.forEach(function (id) {
      var el = parent.querySelector('[' + attr + '="' + id + '"]');
      if (!el && attr === 'data-layout-id') el = document.getElementById(id);
      if (!el && attr === 'data-panel-id') el = document.getElementById(id);
      if (!el) {
        el = document.querySelector('[onclick*="' + id + '"]');
      }
      if (el) {
        el.style.display = (hidden && hidden.indexOf(id) >= 0) ? 'none' : '';
        if (el.classList.contains('ribbon-tab') && el.id === 'tab-admin-panel') {
          /* auth may hide — restore inline only if visible in config */
        }
        parent.appendChild(el);
      }
    });
    parent.querySelectorAll('.reg-tabs-sep').forEach(function () { /* separator positions preserved in HTML */ });
  }

  window.sysLayoutApplyDashboard = function (cfg) {
    cfg = cfg || window.sysLayoutGetConfig();
    var grid = document.querySelector('.dash-modules-grid');
    if (grid) reorderChildren(grid, cfg.dashboard.order, cfg.dashboard.hidden, 'data-layout-id');
    var bottom = document.querySelector('.dash-bottom-grid');
    if (bottom) reorderChildren(bottom, cfg.dashboard.bottomOrder, cfg.dashboard.bottomHidden, 'data-layout-id');
  };

  window.sysLayoutApplyRibbon = function (cfg) {
    cfg = cfg || window.sysLayoutGetConfig();
    var wrap = document.querySelector('.ribbon-tabs');
    if (!wrap) return;
    cfg.ribbon.order.forEach(function (id) {
      if (id === 'superadmin') return;
      var tab = document.getElementById('tab-' + id);
      if (!tab) return;
      var hide = cfg.ribbon.hidden.indexOf(id) >= 0;
      if (hide) tab.style.display = 'none';
      else if (!tab.dataset.authHidden) tab.style.display = '';
      wrap.appendChild(tab);
    });
  };

  window.sysLayoutApplyModule = function (modId, cfg) {
    cfg = cfg || window.sysLayoutGetConfig();
    var mc = cfg.modules[modId];
    if (!mc) return;
    var sel = MODULE_MENUS[modId];
    if (!sel) return;
    var menu = document.querySelector(sel);
    if (!menu) return;
    mc.order.forEach(function (panelId) {
      var btn = menu.querySelector('[onclick*="' + panelId + '"]');
      if (!btn) return;
      btn.style.display = mc.hidden.indexOf(panelId) >= 0 ? 'none' : '';
      menu.appendChild(btn);
    });
  };

  window.sysLayoutApplyTables = function (cfg) {
    cfg = cfg || window.sysLayoutGetConfig();
    Object.keys(cfg.tables || {}).forEach(function (tableId) {
      var table = document.getElementById(tableId);
      if (!table) return;
      var tcfg = cfg.tables[tableId];
      var thead = table.querySelector('thead tr');
      if (!thead) return;
      var colMap = {};
      (tcfg.columns || []).forEach(function (c, i) { colMap[c.id] = c; });
      var ths = Array.from(thead.querySelectorAll('th'));
      ths.forEach(function (th, idx) {
        var cid = th.getAttribute('data-col-id') || ('col' + idx);
        var col = colMap[cid];
        if (col) {
          th.style.display = col.visible === false ? 'none' : '';
          if (col.label) th.textContent = col.label;
        }
      });
      (tcfg.columns || []).forEach(function (c) {
        var th = thead.querySelector('th[data-col-id="' + c.id + '"]');
        if (th) thead.appendChild(th);
      });
      var visibleIdx = [];
      Array.from(thead.querySelectorAll('th')).forEach(function (th, i) {
        if (th.style.display !== 'none') visibleIdx.push(i);
      });
      table.querySelectorAll('tbody tr').forEach(function (tr) {
        var tds = Array.from(tr.children);
        tds.forEach(function (td, i) {
          var th = thead.children[i];
          td.style.display = (th && th.style.display === 'none') ? 'none' : '';
        });
      });
    });
  };

  window.sysLayoutApplyAll = function () {
    var cfg = window.sysLayoutGetConfig();
    window.sysLayoutApplyDashboard(cfg);
    window.sysLayoutApplyRibbon(cfg);
    Object.keys(cfg.modules || {}).forEach(function (m) { window.sysLayoutApplyModule(m, cfg); });
    window.sysLayoutApplyTables(cfg);
  };

  function renderSortList(containerId, items, hidden, labels) {
    var box = document.getElementById(containerId);
    if (!box) return;
    box.innerHTML = items.map(function (id, idx) {
      var on = hidden.indexOf(id) < 0;
      return '<div class="sys-layout-row" data-id="' + esc(id) + '">' +
        '<span class="sys-layout-grip"><i class="fas fa-grip-vertical"></i></span>' +
        '<span class="sys-layout-label">' + esc(labels[id] || id) + '</span>' +
        '<label class="sys-layout-vis"><input type="checkbox" data-id="' + esc(id) + '" ' + (on ? 'checked' : '') + '> دکھائیں</label>' +
        '<button type="button" class="btn btn-sm btn-outline sys-layout-up" data-id="' + esc(id) + '"><i class="fas fa-arrow-up"></i></button>' +
        '<button type="button" class="btn btn-sm btn-outline sys-layout-down" data-id="' + esc(id) + '"><i class="fas fa-arrow-down"></i></button></div>';
    }).join('');
  }

  window.sysLayoutInitUI = function () {
    var cfg = window.sysLayoutGetConfig();
    renderSortList('sys-layout-dash-list', cfg.dashboard.order, cfg.dashboard.hidden, LABELS);
    renderSortList('sys-layout-dash-bottom-list', cfg.dashboard.bottomOrder, cfg.dashboard.bottomHidden, LABELS);
    renderSortList('sys-layout-ribbon-list', cfg.ribbon.order, cfg.ribbon.hidden, LABELS);
    var modSel = document.getElementById('sys-layout-module-select');
    if (modSel) window.sysLayoutRenderModuleList(modSel.value || 'admission');
    window.sysLayoutRenderTableEditor();
  };

  window.sysLayoutRenderModuleList = function (modId) {
    var cfg = window.sysLayoutGetConfig();
    var mc = cfg.modules[modId];
    if (!mc) return;
    var labels = {};
    mc.order.forEach(function (id) {
      var btn = document.querySelector((MODULE_MENUS[modId] || '') + ' [onclick*="' + id + '"]');
      labels[id] = btn ? btn.textContent.replace(/\s+/g, ' ').trim() : id;
    });
    renderSortList('sys-layout-module-list', mc.order, mc.hidden, labels);
    var hid = document.getElementById('sys-layout-module-id');
    if (hid) hid.value = modId;
  };

  window.sysLayoutRenderTableEditor = function () {
    var sel = document.getElementById('sys-layout-table-select');
    var box = document.getElementById('sys-layout-table-cols');
    if (!sel || !box) return;
    var cfg = window.sysLayoutGetConfig();
    var tcfg = cfg.tables[sel.value];
    if (!tcfg) { box.innerHTML = ''; return; }
    box.innerHTML = (tcfg.columns || []).map(function (c, idx) {
      return '<div class="sys-layout-row" data-col-id="' + esc(c.id) + '">' +
        '<input type="text" class="input-control sys-layout-col-label" value="' + esc(c.label) + '" style="flex:1;">' +
        '<label><input type="checkbox" class="sys-layout-col-vis" ' + (c.visible !== false ? 'checked' : '') + '> ظاہر</label>' +
        '<button type="button" class="btn btn-sm btn-outline sys-layout-col-up"><i class="fas fa-arrow-up"></i></button>' +
        '<button type="button" class="btn btn-sm btn-outline sys-layout-col-down"><i class="fas fa-arrow-down"></i></button></div>';
    }).join('');
  };

  function collectListOrder(listId) {
    return Array.from(document.querySelectorAll('#' + listId + ' .sys-layout-row')).map(function (r) {
      return r.getAttribute('data-id');
    });
  }

  function collectListHidden(listId) {
    var hidden = [];
    document.querySelectorAll('#' + listId + ' input[type=checkbox]').forEach(function (inp) {
      if (!inp.checked) hidden.push(inp.getAttribute('data-id'));
    });
    return hidden;
  }

  window.sysLayoutSaveFromUI = function () {
    if (typeof window.sysRequirePerm === 'function' && !window.sysRequirePerm('layout', 'edit')) return;
    var cfg = window.sysLayoutGetConfig();
    cfg.dashboard.order = collectListOrder('sys-layout-dash-list');
    cfg.dashboard.hidden = collectListHidden('sys-layout-dash-list');
    cfg.dashboard.bottomOrder = collectListOrder('sys-layout-dash-bottom-list');
    cfg.dashboard.bottomHidden = collectListHidden('sys-layout-dash-bottom-list');
    cfg.ribbon.order = collectListOrder('sys-layout-ribbon-list');
    cfg.ribbon.hidden = collectListHidden('sys-layout-ribbon-list');
    var modId = (document.getElementById('sys-layout-module-id') || {}).value || 'admission';
    if (!cfg.modules[modId]) cfg.modules[modId] = { order: [], hidden: [] };
    cfg.modules[modId].order = collectListOrder('sys-layout-module-list');
    cfg.modules[modId].hidden = collectListHidden('sys-layout-module-list');
    var tableId = (document.getElementById('sys-layout-table-select') || {}).value;
    if (tableId && cfg.tables[tableId]) {
      cfg.tables[tableId].columns = Array.from(document.querySelectorAll('#sys-layout-table-cols .sys-layout-row')).map(function (row) {
        return {
          id: row.getAttribute('data-col-id'),
          label: row.querySelector('.sys-layout-col-label').value,
          visible: row.querySelector('.sys-layout-col-vis').checked
        };
      });
    }
    window.sysLayoutSaveConfig(cfg);
  };

  function moveRow(listId, id, dir) {
    var rows = Array.from(document.querySelectorAll('#' + listId + ' .sys-layout-row'));
    var order = rows.map(function (r) { return r.getAttribute('data-id'); });
    var labels = {};
    rows.forEach(function (r) {
      var lb = r.querySelector('.sys-layout-label');
      labels[r.getAttribute('data-id')] = lb ? lb.textContent : r.getAttribute('data-id');
    });
    var idx = order.indexOf(id);
    if (idx < 0) return;
    var ni = idx + dir;
    if (ni < 0 || ni >= order.length) return;
    order.splice(idx, 1);
    order.splice(ni, 0, id);
    renderSortList(listId, order, collectListHidden(listId), labels);
  }

  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest('#sys-layout-btn-save')) {
      e.preventDefault();
      window.sysLayoutSaveFromUI();
    }
    if (e.target && e.target.closest('#sys-layout-btn-reset')) {
      e.preventDefault();
      window.sysLayoutReset();
    }
    var ltab = e.target && e.target.closest('.sys-layout-tab');
    if (ltab) {
      e.preventDefault();
      document.querySelectorAll('.sys-layout-tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.sys-layout-panel').forEach(function (p) { p.style.display = 'none'; });
      ltab.classList.add('active');
      var panel = document.getElementById(ltab.getAttribute('data-panel'));
      if (panel) panel.style.display = 'block';
    }
    var up = e.target && e.target.closest('.sys-layout-up');
    if (up) {
      e.preventDefault();
      moveRow(up.closest('[id$="-list"]').id, up.getAttribute('data-id'), -1);
    }
    var down = e.target && e.target.closest('.sys-layout-down');
    if (down) {
      e.preventDefault();
      moveRow(down.closest('[id$="-list"]').id, down.getAttribute('data-id'), 1);
    }
    var cup = e.target && e.target.closest('.sys-layout-col-up');
    if (cup) {
      var row = cup.closest('.sys-layout-row');
      var prev = row.previousElementSibling;
      if (prev) row.parentNode.insertBefore(row, prev);
    }
    var cdown = e.target && e.target.closest('.sys-layout-col-down');
    if (cdown) {
      var row2 = cdown.closest('.sys-layout-row');
      var next = row2.nextElementSibling;
      if (next) row2.parentNode.insertBefore(next, row2);
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'sys-layout-module-select') window.sysLayoutRenderModuleList(e.target.value);
    if (e.target && e.target.id === 'sys-layout-table-select') window.sysLayoutRenderTableEditor();
  });

  if (typeof window.emsRunWhenDomReady === 'function') {
    window.emsRunWhenDomReady(function () { setTimeout(window.sysLayoutApplyAll, 800); });
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(window.sysLayoutApplyAll, 800); });
  } else {
    setTimeout(window.sysLayoutApplyAll, 800);
  }

})();
