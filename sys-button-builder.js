// ================= شعبۂ بٹن ساز — Phase C: Color, Icon, Edit, Action Toggles =================
(function () {
  'use strict';

  var BTNS_KEY = 'ems_custom_buttons';
  var TOGGLES_KEY = 'ems_btn_action_toggles';

  var ICONS = [
    'fa-bolt', 'fa-print', 'fa-save', 'fa-download', 'fa-upload', 'fa-sync-alt', 'fa-plus', 'fa-trash', 'fa-edit',
    'fa-search', 'fa-file-pdf', 'fa-file-excel', 'fa-cog', 'fa-user', 'fa-users', 'fa-calendar-check', 'fa-money-bill-wave',
    'fa-bullhorn', 'fa-lock', 'fa-unlock', 'fa-calculator', 'fa-chart-bar', 'fa-list', 'fa-eye', 'fa-hammer',
    'fa-whatsapp', 'fa-external-link-alt', 'fa-undo', 'fa-check', 'fa-times', 'fa-star', 'fa-wallet', 'fa-graduation-cap'
  ];

  var COLOR_PRESETS = [
    { id: 'primary', label: 'مرکزی', hex: '#2980b9' },
    { id: 'success', label: 'کامیابی', hex: '#27ae60' },
    { id: 'warning', label: 'انتباہ', hex: '#f39c12' },
    { id: 'danger', label: 'خطرہ', hex: '#e74c3c' },
    { id: 'accent', label: 'ہائی لائٹ', hex: '#6366f1' },
    { id: 'dark', label: 'گہرا', hex: '#334155' },
    { id: 'custom', label: 'اپنا رنگ', hex: '' }
  ];

  var CORE_ACTIONS = [
    { key: 'save', label: 'محفوظ کریں', icon: 'fa-save' },
    { key: 'edit', label: 'ترمیم', icon: 'fa-edit' },
    { key: 'delete', label: 'حذف', icon: 'fa-trash' },
    { key: 'search', label: 'تلاش', icon: 'fa-search' },
    { key: 'print', label: 'پرنٹ', icon: 'fa-print' },
    { key: 'export', label: 'برآمد', icon: 'fa-download' }
  ];

  var MODULES = [
    { id: 'global', label: 'عمومی (تمام شعبے)' },
    { id: 'dashboard', label: 'ڈیش بورڈ' },
    { id: 'admission', label: 'رجسٹریشن' },
    { id: 'attendance', label: 'حاضری' },
    { id: 'finance', label: 'فیس' },
    { id: 'ledger', label: 'مالیات و تنخواہ' },
    { id: 'exams', label: 'امتحانات' },
    { id: 'complaints', label: 'شکایات' },
    { id: 'announcements', label: 'اعلانات' }
  ];

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

  function getBtns() { return readJson(BTNS_KEY, []) || []; }

  function defaultToggles() {
    var t = {};
    MODULES.forEach(function (m) {
      t[m.id] = { save: true, edit: true, delete: true, search: true, print: true, export: true };
    });
    return t;
  }

  function getToggles() {
    var t = readJson(TOGGLES_KEY, null);
    if (!t || typeof t !== 'object') t = defaultToggles();
    MODULES.forEach(function (m) {
      if (!t[m.id]) t[m.id] = { save: true, edit: true, delete: true, search: true, print: true, export: true };
    });
    return t;
  }

  function collectForm() {
    var g = function (id, fb) {
      var el = document.getElementById(id);
      return el ? el.value : fb;
    };
    return {
      name: g('custom-btn-name', '').trim(),
      size: g('custom-btn-size', 'btn-md'),
      module: g('custom-btn-module', 'dashboard'),
      loc: g('custom-btn-location', 'top-action-bar'),
      action: g('custom-btn-action', ''),
      url: g('custom-btn-url', '').trim(),
      colorPreset: g('custom-btn-color-preset', 'primary'),
      color: g('custom-btn-color', '#2980b9'),
      icon: g('custom-btn-icon', 'fa-bolt'),
      variant: g('custom-btn-variant', 'solid'),
      enabled: document.getElementById('custom-btn-enabled') ? document.getElementById('custom-btn-enabled').checked : true
    };
  }

  function applyForm(data) {
    if (!data) return;
    var set = function (id, v) { var el = document.getElementById(id); if (el && v != null) el.value = v; };
    set('custom-btn-name', data.name);
    set('custom-btn-size', data.size);
    set('custom-btn-module', data.module);
    set('custom-btn-location', data.loc);
    set('custom-btn-action', data.action);
    set('custom-btn-url', data.url || '');
    set('custom-btn-color-preset', data.colorPreset || 'primary');
    set('custom-btn-color', data.color || '#2980b9');
    set('custom-btn-icon', data.icon || 'fa-bolt');
    set('custom-btn-variant', data.variant || 'solid');
    var en = document.getElementById('custom-btn-enabled');
    if (en) en.checked = data.enabled !== false;
    var urlBox = document.getElementById('custom-url-box');
    if (urlBox) urlBox.style.display = (data.action === 'cmd_open_custom_url') ? 'block' : 'none';
    window.sysBtnUpdatePreview();
    window.sysBtnHighlightIcon(data.icon || 'fa-bolt');
  }

  window.sysBtnUpdatePreview = function () {
    var prev = document.getElementById('custom-btn-preview');
    if (!prev) return;
    var d = collectForm();
    var icon = d.icon || 'fa-bolt';
    prev.innerHTML = '<i class="fas ' + esc(icon) + '"></i> ' + esc(d.name || 'بٹن کا نام');
    prev.className = 'btn injected-custom-btn ' + (d.size || 'btn-md');
    if (d.variant === 'outline') prev.classList.add('btn-outline');
    else prev.classList.add('btn-primary');
    prev.style.cssText = '';
    if (d.colorPreset === 'custom' && d.color) {
      if (d.variant === 'outline') {
        prev.style.background = 'transparent';
        prev.style.color = d.color;
        prev.style.border = '2px solid ' + d.color;
      } else {
        prev.style.background = d.color;
        prev.style.borderColor = d.color;
        prev.style.color = '#fff';
      }
    } else if (d.colorPreset && d.colorPreset !== 'primary') {
      prev.classList.remove('btn-primary');
      prev.classList.add('btn-' + d.colorPreset);
    }
    if (d.size === 'btn-block') prev.style.width = '100%';
  };

  window.sysBtnHighlightIcon = function (icon) {
    document.querySelectorAll('.sys-btn-icon-pick').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-icon') === icon);
    });
  };

  window.sysBtnRenderIconGrid = function () {
    var grid = document.getElementById('custom-btn-icon-grid');
    if (!grid) return;
    grid.innerHTML = ICONS.map(function (ic) {
      return '<button type="button" class="sys-btn-icon-pick" data-icon="' + ic + '" title="' + ic + '"><i class="fas ' + ic + '"></i></button>';
    }).join('');
  };

  window.sysBtnRenderTable = function () {
    var tbody = document.getElementById('custom-btns-tbody');
    if (!tbody) return;
    var btns = getBtns();
    if (!btns.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">کوئی بٹن نہیں</td></tr>';
      return;
    }
    tbody.innerHTML = btns.map(function (b) {
      var st = b.enabled !== false ? '<span class="sys-btn-status on">فعال</span>' : '<span class="sys-btn-status off">بند</span>';
      return '<tr>' +
        '<td><i class="fas ' + esc(b.icon || 'fa-bolt') + '"></i> ' + esc(b.name) + '</td>' +
        '<td style="font-size:11px;">' + esc(b.module) + '</td>' +
        '<td style="font-size:11px;">' + esc(b.action) + '</td>' +
        '<td>' + st + '</td>' +
        '<td><span class="sys-btn-color-dot" style="background:' + esc(b.colorPreset === 'custom' ? b.color : (COLOR_PRESETS.find(function (p) { return p.id === b.colorPreset; }) || {}).hex || '#2980b9') + '"></span></td>' +
        '<td>' +
        '<button class="btn btn-sm btn-outline" onclick="window.sysBtnEdit(\'' + esc(b.id) + '\')" title="ترمیم"><i class="fas fa-edit"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="window.sysBtnToggleEnabled(\'' + esc(b.id) + '\')" title="آن/آف"><i class="fas fa-power-off"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="window.sysBtnDelete(\'' + esc(b.id) + '\')" title="حذف"><i class="fas fa-trash"></i></button>' +
        '</td></tr>';
    }).join('');
  };

  window.sysBtnEdit = function (id) {
    var b = getBtns().find(function (x) { return x.id === id; });
    if (!b) return;
    var hid = document.getElementById('custom-btn-id-hidden');
    if (hid) hid.value = b.id;
    applyForm(b);
    var btn = document.getElementById('btn-create-custom-btn');
    if (btn) btn.innerHTML = '<i class="fas fa-save"></i> تبدیلیاں محفوظ کریں';
    toast('ترمیم موڈ — تبدیل کر کے محفوظ کریں', 'warning');
  };

  window.sysBtnToggleEnabled = function (id) {
    var btns = getBtns();
    var b = btns.find(function (x) { return x.id === id; });
    if (!b) return;
    b.enabled = b.enabled === false;
    writeJson(BTNS_KEY, btns);
    window.sysBtnRenderAll();
    window.sysBtnRenderTable();
    if (typeof window.sysAuditLog === 'function') window.sysAuditLog('toggle', 'custom_button', b.name + ' → ' + (b.enabled !== false ? 'فعال' : 'بند'));
    toast(b.enabled !== false ? 'بٹن فعال' : 'بٹن بند', 'success');
  };

  window.sysBtnDelete = function (id) {
    if (!confirm('یہ بٹن حذف کریں؟')) return;
    var btns = getBtns().filter(function (x) { return x.id !== id; });
    writeJson(BTNS_KEY, btns);
    window.sysBtnRenderAll();
    window.sysBtnRenderTable();
    if (typeof window.sysAuditLog === 'function') window.sysAuditLog('delete', 'custom_button', id);
    toast('حذف ہو گیا', 'warning');
  };

  window.sysBtnSave = function () {
    if (typeof window.sysRequirePerm === 'function' && !window.sysRequirePerm('buttons', 'edit')) return;
    var d = collectForm();
    if (!d.name || !d.action) return toast('نام اور Action لازمی', 'error');
    if (d.action === 'cmd_open_custom_url' && !d.url) return toast('URL درج کریں', 'error');
    var btns = getBtns();
    var beforeBtns = JSON.parse(JSON.stringify(btns));
    var editId = (document.getElementById('custom-btn-id-hidden') || {}).value || '';
    var entry = Object.assign({}, d, { updatedAt: Date.now() });
    if (editId) {
      var idx = btns.findIndex(function (b) { return b.id === editId; });
      if (idx >= 0) btns[idx] = Object.assign({ id: editId, createdAt: btns[idx].createdAt }, entry);
      if (typeof window.sysAuditLog === 'function') window.sysAuditLog('update', 'custom_button', d.name, beforeBtns, btns);
      toast('بٹن اپڈیٹ', 'success');
    } else {
      entry.id = 'CBTN-' + Date.now();
      entry.createdAt = Date.now();
      btns.push(entry);
      if (typeof window.sysAuditLog === 'function') window.sysAuditLog('create', 'custom_button', d.name, beforeBtns, btns);
      toast('نیا بٹن شامل', 'success');
    }
    writeJson(BTNS_KEY, btns);
    window.sysBtnResetForm();
    window.sysBtnRenderAll();
    window.sysBtnRenderTable();
  };

  window.sysBtnResetForm = function () {
    var hid = document.getElementById('custom-btn-id-hidden');
    if (hid) hid.value = '';
    applyForm({
      name: '', size: 'btn-md', module: 'dashboard', loc: 'top-action-bar', action: '',
      url: '', colorPreset: 'primary', color: '#2980b9', icon: 'fa-bolt', variant: 'solid', enabled: true
    });
    var btn = document.getElementById('btn-create-custom-btn');
    if (btn) btn.innerHTML = '<i class="fas fa-hammer"></i> بٹن محفوظ + لگائیں';
  };

  function styleButtonEl(btnEl, btnData) {
    var preset = btnData.colorPreset || 'primary';
    var variant = btnData.variant || 'solid';
    btnEl.className = 'btn injected-custom-btn ' + (btnData.size || 'btn-md');
    if (variant === 'outline') btnEl.classList.add('btn-outline', 'btn-' + (preset === 'custom' ? 'primary' : preset));
    else btnEl.classList.add('btn-' + (preset === 'custom' ? 'primary' : preset));
    if (preset === 'custom' && btnData.color) {
      if (variant === 'outline') {
        btnEl.style.background = 'transparent';
        btnEl.style.color = btnData.color;
        btnEl.style.border = '2px solid ' + btnData.color;
      } else {
        btnEl.style.backgroundColor = btnData.color;
        btnEl.style.borderColor = btnData.color;
        btnEl.style.color = '#fff';
      }
    }
    if (btnData.size === 'btn-block') { btnEl.style.width = '100%'; btnEl.style.marginTop = '10px'; }
  }

  function findModuleDiv(mod) {
    return document.getElementById('module-' + mod) || document.getElementById(mod) || document.querySelector('[id*="' + mod + '"]');
  }

  function placeButton(btnEl, btnData, moduleDiv) {
    if (btnData.loc === 'bottom-area') {
      moduleDiv.appendChild(btnEl);
      return;
    }
    if (btnData.loc === 'beside-save-btn') {
      var saveBtn = moduleDiv.querySelector('.btn-success, [id*="save"], [id*="Save"]');
      if (saveBtn && saveBtn.parentElement) {
        saveBtn.parentElement.insertBefore(btnEl, saveBtn.nextSibling);
        btnEl.style.marginRight = '8px';
        return;
      }
    }
    var actionBox = moduleDiv.querySelector('.custom-btn-container[data-loc="' + (btnData.loc || 'top') + '"]');
    if (!actionBox) {
      actionBox = document.createElement('div');
      actionBox.className = 'custom-btn-container';
      actionBox.setAttribute('data-loc', btnData.loc || 'top-action-bar');
      actionBox.style.cssText = 'padding:12px;background:#eef2f6;border-radius:8px;margin-bottom:16px;border:1px dashed var(--primary);display:flex;gap:10px;flex-wrap:wrap;align-items:center;';
      var titleEl = document.createElement('div');
      titleEl.style.cssText = 'width:100%;font-size:12px;color:var(--primary);font-weight:bold;';
      titleEl.innerHTML = '<i class="fas fa-tools"></i> شارٹ کٹ بٹن';
      actionBox.appendChild(titleEl);
      if (btnData.loc === 'bottom-area') moduleDiv.appendChild(actionBox);
      else moduleDiv.insertBefore(actionBox, moduleDiv.firstChild);
    }
    actionBox.appendChild(btnEl);
  }

  window.sysBtnRenderAll = function () {
    document.querySelectorAll('.injected-custom-btn, .custom-btn-container').forEach(function (e) { e.remove(); });
    var btns = getBtns().filter(function (b) { return b.enabled !== false; });
    btns.forEach(function (btnData) {
      var btnEl = document.createElement('button');
      btnEl.type = 'button';
      btnEl.className = 'btn injected-custom-btn';
      btnEl.innerHTML = '<i class="fas ' + (btnData.icon || 'fa-bolt') + '"></i> ' + btnData.name;
      btnEl.setAttribute('data-action', btnData.action);
      btnEl.setAttribute('data-cbtn-id', btnData.id);
      btnEl.title = btnData.action;
      styleButtonEl(btnEl, btnData);
      btnEl.addEventListener('click', function (e) {
        e.preventDefault();
        window.sysBtnExecuteAction(btnData.action, btnData.url, btnData.module);
      });
      if (btnData.module === 'ribbon') {
        var tabSys = document.getElementById('tab-sys-settings');
        if (tabSys && tabSys.parentElement) {
          btnEl.className = 'ribbon-tab injected-custom-btn';
          styleButtonEl(btnEl, btnData);
          tabSys.parentElement.appendChild(btnEl);
        }
      } else {
        var moduleDiv = findModuleDiv(btnData.module);
        if (moduleDiv) placeButton(btnEl, btnData, moduleDiv);
      }
    });
  };

  window.renderCustomButtons = window.sysBtnRenderAll;

  window.sysBtnExecuteAction = function (action, url) {
    if (typeof window.executeCustomAction === 'function') window.executeCustomAction(action, url);
  };

  window.sysBtnTagCoreActions = function () {
    var patterns = {
      save: /محفوظ|save|store/i,
      edit: /ترمیم|edit|modify/i,
      delete: /حذف|delete|remove|trash/i,
      search: /تلاش|search|filter/i,
      print: /پرنٹ|print|pdf/i,
      export: /برآمد|export|csv|excel|download/i
    };
    document.querySelectorAll('.module-view button, .module-view .btn, .premium-card button').forEach(function (btn) {
      if (btn.classList.contains('injected-custom-btn')) return;
      var blob = (btn.id + ' ' + btn.className + ' ' + btn.textContent).toLowerCase();
      Object.keys(patterns).forEach(function (key) {
        if (patterns[key].test(blob)) btn.classList.add('ems-action-' + key);
      });
    });
  };

  window.sysBtnApplyActionToggles = function (modId) {
    var toggles = getToggles();
    var mod = modId === 'sys-settings' ? 'global' : (modId || 'global');
    var global = toggles.global || {};
    var modCfg = toggles[mod] || {};
    var body = document.body;
    CORE_ACTIONS.forEach(function (a) {
      var val = modCfg[a.key];
      if (val === undefined) val = global[a.key];
      if (val === undefined) val = true;
      body.classList.toggle('ems-hide-' + a.key, val === false);
    });
    body.setAttribute('data-ems-action-module', mod);
  };

  window.sysBtnRenderToggleGrid = function () {
    var box = document.getElementById('sys-action-toggles-grid');
    if (!box) return;
    var toggles = getToggles();
    var mod = (document.getElementById('sys-toggle-module') || {}).value || 'global';
    var cfg = toggles[mod] || {};
    box.innerHTML = CORE_ACTIONS.map(function (a) {
      var on = cfg[a.key] !== false;
      return '<label class="sys-toggle-chip' + (on ? ' on' : '') + '">' +
        '<input type="checkbox" data-action-key="' + a.key + '" ' + (on ? 'checked' : '') + '>' +
        '<i class="fas ' + a.icon + '"></i> ' + a.label + '</label>';
    }).join('');
  };

  window.sysBtnSaveToggles = function () {
    if (typeof window.sysRequirePerm === 'function' && !window.sysRequirePerm('buttons', 'edit')) return;
    var mod = (document.getElementById('sys-toggle-module') || {}).value || 'global';
    var toggles = getToggles();
    var before = JSON.parse(JSON.stringify(toggles));
    if (!toggles[mod]) toggles[mod] = {};
    document.querySelectorAll('#sys-action-toggles-grid input[data-action-key]').forEach(function (inp) {
      toggles[mod][inp.getAttribute('data-action-key')] = inp.checked;
    });
    writeJson(TOGGLES_KEY, toggles);
    if (typeof window.sysAuditLog === 'function') window.sysAuditLog('update', 'action_toggles', mod, before, toggles);
    window.sysBtnApplyActionToggles(mod === 'global' ? null : mod);
    toast('اختیارات محفوظ', 'success');
  };

  window.sysBtnInitUI = function () {
    window.sysBtnRenderIconGrid();
    window.sysBtnUpdatePreview();
    window.sysBtnRenderTable();
    window.sysBtnRenderToggleGrid();
    window.sysBtnTagCoreActions();
  };

  window.renderCustomButtonsTable = window.sysBtnRenderTable;

  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest('#btn-create-custom-btn')) {
      e.preventDefault();
      window.sysBtnSave();
    }
    var ic = e.target && e.target.closest('.sys-btn-icon-pick');
    if (ic) {
      e.preventDefault();
      var iconInp = document.getElementById('custom-btn-icon');
      if (iconInp) iconInp.value = ic.getAttribute('data-icon');
      window.sysBtnHighlightIcon(ic.getAttribute('data-icon'));
      window.sysBtnUpdatePreview();
    }
    if (e.target && e.target.closest('#sys-btn-save-toggles')) {
      e.preventDefault();
      window.sysBtnSaveToggles();
    }
  });

  document.addEventListener('change', function (e) {
    if (!e.target) return;
    if (e.target.id === 'custom-btn-action') {
      var urlBox = document.getElementById('custom-url-box');
      if (urlBox) urlBox.style.display = (e.target.value === 'cmd_open_custom_url') ? 'block' : 'none';
    }
    if (e.target.id === 'custom-btn-color-preset') {
      var cp = COLOR_PRESETS.find(function (p) { return p.id === e.target.value; });
      var colorInp = document.getElementById('custom-btn-color');
      if (colorInp && cp && cp.hex) colorInp.value = cp.hex;
      var wrap = document.getElementById('custom-btn-color-wrap');
      if (wrap) wrap.style.display = (e.target.value === 'custom') ? 'block' : 'none';
    }
    if (e.target.id === 'sys-toggle-module') window.sysBtnRenderToggleGrid();
    if (e.target.closest('#sys-win-buttons')) window.sysBtnUpdatePreview();
  });

  document.addEventListener('input', function (e) {
    if (e.target && e.target.closest('#sys-win-buttons')) window.sysBtnUpdatePreview();
  });

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      window.sysBtnTagCoreActions();
      window.sysBtnRenderAll();
    }, 1200);
  });

})();
