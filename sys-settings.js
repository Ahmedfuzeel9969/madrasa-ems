// ================= شعبۂ سسٹم سیٹنگز — Phase A: Theme Engine + Profiles + Safety =================
(function () {
  'use strict';

  var CONFIG_KEY = 'ems_sys_config_v2';
  var PROFILES_KEY = 'ems_sys_profiles';
  var AUDIT_KEY = 'ems_sys_settings_audit';
  var BACKUP_KEY = 'ems_sys_config_backup';
  var LEGACY_THEME_KEY = 'ems_sys_theme';

  var DEFAULT_COLORS = {
    primary: '#2c3e50', secondary: '#34495e', accent: '#2980b9',
    bg: '#f4f6f7', surface: '#ffffff', text: '#2c3e50',
    ribbon: '#2c3e50', subRibbon: '#eef2f6',
    tableHeader: '#f8fafc', tableRow: '#ffffff',
    btnPrimary: '#2980b9', btnActive: '#1e6fa8',
    success: '#27ae60', danger: '#e74c3c', warning: '#f39c12',
    modFinance: '#16a34a', modLedger: '#7c3aed', modExams: '#d97706',
    modAttendance: '#0284c7', modComplaints: '#dc2626', modAnnounce: '#9333ea'
  };

  var PRESETS = {
    classic: { name: 'روایتی', colors: DEFAULT_COLORS, buttonStyle: 'rounded', fieldStyle: 'rounded', inputBorder: 'normal' },
    modern: {
      name: 'جدید',
      colors: Object.assign({}, DEFAULT_COLORS, { primary: '#1e293b', accent: '#6366f1', ribbon: '#1e293b', btnPrimary: '#6366f1', bg: '#f1f5f9' }),
      buttonStyle: 'pill', fieldStyle: 'soft', inputBorder: 'normal'
    },
    educational: {
      name: 'تعلیمی',
      colors: Object.assign({}, DEFAULT_COLORS, { primary: '#14532d', accent: '#22c55e', ribbon: '#14532d', btnPrimary: '#16a34a', bg: '#f0fdf4' }),
      buttonStyle: 'rounded', fieldStyle: 'rounded', inputBorder: 'normal'
    },
    government: {
      name: 'سرکاری',
      colors: Object.assign({}, DEFAULT_COLORS, { primary: '#1e3a5f', accent: '#b45309', ribbon: '#1e3a5f', btnPrimary: '#1e40af', secondary: '#334155' }),
      buttonStyle: 'square', fieldStyle: 'square', inputBorder: 'bold'
    },
    dark: {
      name: 'تاریک',
      colors: {
        primary: '#0f172a', secondary: '#1e293b', accent: '#38bdf8',
        bg: '#0f172a', surface: '#1e293b', text: '#e2e8f0',
        ribbon: '#020617', subRibbon: '#1e293b',
        tableHeader: '#334155', tableRow: '#1e293b',
        btnPrimary: '#0284c7', btnActive: '#0369a1',
        success: '#22c55e', danger: '#ef4444', warning: '#eab308',
        modFinance: '#4ade80', modLedger: '#a78bfa', modExams: '#fb923c',
        modAttendance: '#38bdf8', modComplaints: '#f87171', modAnnounce: '#c084fc'
      },
      buttonStyle: 'rounded', fieldStyle: 'soft', inputBorder: 'none', darkMode: true
    },
    light: {
      name: 'روشن',
      colors: Object.assign({}, DEFAULT_COLORS, { primary: '#475569', accent: '#0ea5e9', bg: '#ffffff', ribbon: '#f8fafc', text: '#334155' }),
      buttonStyle: 'pill', fieldStyle: 'pill', inputBorder: 'light'
    }
  };

  function readJson(key, fb) {
    try { return JSON.parse(localStorage.getItem(key) || (fb != null ? JSON.stringify(fb) : 'null')); }
    catch (e) { return fb; }
  }

  function saveKey(key, val, opts) {
    var localOnly = key === AUDIT_KEY || key === BACKUP_KEY || key === LEGACY_THEME_KEY;
    var options = localOnly ? {} : Object.assign({ mutation: true, autoDelta: true }, opts || {});
    if (window.emsSaveModuleData) return window.emsSaveModuleData(key, typeof val === 'string' ? val : JSON.stringify(val), options);
    localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
    return Promise.resolve();
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'success');
  }

  window.sysActorName = function () {
    if (typeof window.annActorName === 'function') return window.annActorName();
    if (firebase && firebase.auth && firebase.auth().currentUser) {
      return firebase.auth().currentUser.displayName || firebase.auth().currentUser.email || 'منتظم';
    }
    return 'منتظم';
  };

  window.sysGetConfig = function () {
    var cfg = readJson(CONFIG_KEY, null);
    if (cfg && cfg.colors) return cfg;
    var legacy = readJson(LEGACY_THEME_KEY, null);
    cfg = {
      colors: Object.assign({}, DEFAULT_COLORS),
      buttonStyle: (legacy && legacy.style) || 'rounded',
      fieldStyle: 'rounded',
      inputBorder: 'normal',
      presetId: 'classic',
      darkMode: false
    };
    if (legacy) {
      if (legacy.primary) cfg.colors.primary = legacy.primary;
      if (legacy.accent) cfg.colors.accent = legacy.accent;
      cfg.colors.ribbon = legacy.primary || cfg.colors.ribbon;
      cfg.colors.btnPrimary = legacy.accent || cfg.colors.btnPrimary;
    }
    return cfg;
  };

  window.sysSaveConfig = function (cfg, skipAudit) {
    if (!skipAudit) window.sysBackupConfig('auto-before-save');
    saveKey(CONFIG_KEY, cfg);
    saveKey(LEGACY_THEME_KEY, JSON.stringify({
      primary: cfg.colors.primary,
      accent: cfg.colors.accent,
      style: cfg.buttonStyle
    }));
    if (!skipAudit) window.sysAuditLog('update', 'theme', 'مکمل ظاہری ترتیب محفوظ');
  };

  function hexLuminance(hex) {
    if (!hex || typeof hex !== 'string') return 0.5;
    hex = hex.replace('#', '').trim();
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    if (hex.length < 6) return 0.5;
    var r = parseInt(hex.substr(0, 2), 16) / 255;
    var g = parseInt(hex.substr(2, 2), 16) / 255;
    var b = parseInt(hex.substr(4, 2), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  window.emsApplyRegTopbarContrast = applyRegTopbarContrast;

  function applyRegTopbarContrast(root, c) {
    c = c || DEFAULT_COLORS;
    var barBg = c.ribbon || c.primary || DEFAULT_COLORS.primary;
    var barEnd = c.secondary || c.primary || '#1f3a5f';
    var lum = hexLuminance(barBg);
    root.style.setProperty('--reg-topbar-bg', barBg);
    root.style.setProperty('--reg-topbar-bg-end', barEnd);
    if (lum < 0.55) {
      root.style.setProperty('--reg-topbar-fg', '#ffffff');
      root.style.setProperty('--reg-tab-fg', '#e8edf5');
      root.style.setProperty('--reg-tab-bg', 'rgba(255,255,255,.10)');
      root.style.setProperty('--reg-tab-border', 'rgba(255,255,255,.18)');
      root.style.setProperty('--reg-tab-hover-fg', '#ffffff');
      root.style.setProperty('--reg-tab-hover-bg', 'rgba(255,255,255,.20)');
      root.style.setProperty('--reg-tab-active-bg', '#ffffff');
      root.style.setProperty('--reg-tab-active-fg', c.primary || barBg);
    } else {
      root.style.setProperty('--reg-topbar-fg', c.text || '#1e293b');
      root.style.setProperty('--reg-tab-fg', c.text || '#334155');
      root.style.setProperty('--reg-tab-bg', 'rgba(0,0,0,.06)');
      root.style.setProperty('--reg-tab-border', 'rgba(0,0,0,.12)');
      root.style.setProperty('--reg-tab-hover-fg', c.primary || '#1e293b');
      root.style.setProperty('--reg-tab-hover-bg', 'rgba(0,0,0,.10)');
      root.style.setProperty('--reg-tab-active-bg', c.surface || '#ffffff');
      root.style.setProperty('--reg-tab-active-fg', c.primary || '#1e293b');
    }
    root.style.setProperty('--reg-tab-records-fg', '#15803d');
    root.style.setProperty('--reg-tab-rejected-fg', '#b91c1c');
  }

  var THEME_COLOR_INPUT_IDS = [
    'sys-color-primary', 'sys-color-secondary', 'sys-color-accent', 'sys-color-bg',
    'sys-color-surface', 'sys-color-text', 'sys-color-ribbon', 'sys-color-subribbon',
    'sys-color-table-h', 'sys-color-success', 'sys-color-danger', 'sys-color-warning',
    'sys-color-btn', 'sys-color-btn-active'
  ];

  window.sysApplyThemeFromFormLive = function () {
    window.sysApplyTheme(window.sysCollectThemeFromForm());
  };

  window.sysApplyTheme = function (cfg) {
    cfg = cfg || window.sysGetConfig();
    var c = cfg.colors || DEFAULT_COLORS;
    var root = document.documentElement;
    root.style.setProperty('--primary', c.primary || DEFAULT_COLORS.primary);
    root.style.setProperty('--secondary', c.secondary || DEFAULT_COLORS.secondary);
    root.style.setProperty('--accent', c.accent || DEFAULT_COLORS.accent);
    root.style.setProperty('--bg-light', c.bg || DEFAULT_COLORS.bg);
    root.style.setProperty('--surface', c.surface || DEFAULT_COLORS.surface);
    root.style.setProperty('--text-dark', c.text || DEFAULT_COLORS.text);
    root.style.setProperty('--success', c.success || DEFAULT_COLORS.success);
    root.style.setProperty('--danger', c.danger || DEFAULT_COLORS.danger);
    root.style.setProperty('--warning', c.warning || DEFAULT_COLORS.warning);
    root.style.setProperty('--sys-ribbon', c.ribbon || c.primary || DEFAULT_COLORS.ribbon);
    root.style.setProperty('--sys-sub-ribbon', c.subRibbon || DEFAULT_COLORS.subRibbon);
    root.style.setProperty('--sys-table-header', c.tableHeader || DEFAULT_COLORS.tableHeader);
    root.style.setProperty('--sys-table-row', c.tableRow || DEFAULT_COLORS.tableRow);
    root.style.setProperty('--sys-btn-primary', c.btnPrimary || c.accent || DEFAULT_COLORS.btnPrimary);
    root.style.setProperty('--sys-btn-active', c.btnActive || DEFAULT_COLORS.btnActive);
    Object.keys(c).forEach(function (k) {
      if (k.indexOf('mod') === 0) {
        var cssKey = k.replace(/([A-Z])/g, '-$1').toLowerCase();
        root.style.setProperty('--sys-' + cssKey, c[k]);
      }
    });
    applyRegTopbarContrast(root, c);
    if (document.body) {
      document.body.style.backgroundColor = c.bg || DEFAULT_COLORS.bg;
      document.body.style.color = c.text || DEFAULT_COLORS.text;
    }
    document.body.classList.remove('theme-style-square', 'theme-style-rounded', 'theme-style-pill', 'theme-style-3d');
    document.body.classList.remove('sys-field-style-square', 'sys-field-style-rounded', 'sys-field-style-soft', 'sys-field-style-pill');
    document.body.classList.remove('sys-input-border-normal', 'sys-input-border-bold', 'sys-input-border-light', 'sys-input-border-none');
    document.body.classList.add('theme-style-' + (cfg.buttonStyle || 'rounded'));
    document.body.classList.add('sys-field-style-' + (cfg.fieldStyle || 'rounded'));
    document.body.classList.add('sys-input-border-' + (cfg.inputBorder || 'normal'));
    if (cfg.darkMode) document.body.classList.add('sys-theme-dark');
    else document.body.classList.remove('sys-theme-dark');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', c.primary || c.ribbon || '#2c3e50');
    try {
      window.dispatchEvent(new CustomEvent('ems:theme-applied', { detail: cfg }));
    } catch (e) { /* ignore */ }
  };

  function bindThemeLivePreview() {
    THEME_COLOR_INPUT_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || el._sysThemeBound) return;
      el._sysThemeBound = true;
      el.addEventListener('input', window.sysApplyThemeFromFormLive);
      el.addEventListener('change', window.sysApplyThemeFromFormLive);
    });
    ['sys-button-style', 'theme-style-select', 'sys-field-style', 'sys-input-border'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || el._sysThemeBound) return;
      el._sysThemeBound = true;
      el.addEventListener('change', window.sysApplyThemeFromFormLive);
    });
  }

  window.sysAuditLog = function (action, entity, summary, before, after) {
    var logs = readJson(AUDIT_KEY, []) || [];
    logs.push({
      id: 'SAD-' + Date.now(),
      timestamp: Date.now(),
      userName: window.sysActorName(),
      action: action,
      entity: entity,
      summary: summary || '',
      before: before ? JSON.parse(JSON.stringify(before)) : null,
      after: after ? JSON.parse(JSON.stringify(after)) : null
    });
    if (logs.length > 2000) logs = logs.slice(-2000);
    saveKey(AUDIT_KEY, logs);
    if (typeof window.sysRulesRunOnAudit === 'function') {
      window.sysRulesRunOnAudit(action, entity, summary);
    }
  };

  window.sysBackupConfig = function (reason) {
    var snap = {
      config: window.sysGetConfig(),
      dict: readJson('ems_sys_dict', []),
      customButtons: readJson('ems_custom_buttons', []),
      actionToggles: readJson('ems_btn_action_toggles', null),
      customFields: readJson('ems_custom_fields', []),
      fieldVisibility: readJson('ems_field_visibility', {}),
      layoutConfig: readJson('ems_layout_config', null),
      sysPermissions: readJson('ems_sys_permissions', null),
      autoRules: readJson('ems_sys_auto_rules', []),
      customReports: readJson('ems_custom_reports', []),
      customDashboard: readJson('ems_custom_dashboard', []),
      customFormTemplates: readJson('ems_custom_form_templates', []),
      savedAt: Date.now(),
      reason: reason || 'manual',
      by: window.sysActorName()
    };
    saveKey(BACKUP_KEY, snap);
    return snap;
  };

  window.sysRestoreBackup = function () {
    if (typeof window.sysRequirePerm === 'function' && !window.sysRequirePerm('security', 'restore')) return;
    var snap = readJson(BACKUP_KEY, null);
    if (!snap || !snap.config) return toast('کوئی backup نہیں', 'error');
    if (!confirm('پچھلی محفوظ حالت بحال کریں؟')) return;
    var before = window.sysGetConfig();
    window.sysSaveConfig(snap.config, true);
    if (snap.dict) saveKey('ems_sys_dict', snap.dict);
    if (snap.customButtons) saveKey('ems_custom_buttons', snap.customButtons);
    if (snap.actionToggles) saveKey('ems_btn_action_toggles', snap.actionToggles);
    if (snap.customFields) saveKey('ems_custom_fields', snap.customFields);
    if (snap.fieldVisibility) saveKey('ems_field_visibility', snap.fieldVisibility);
    if (snap.layoutConfig) saveKey('ems_layout_config', snap.layoutConfig);
    if (snap.sysPermissions) saveKey('ems_sys_permissions', snap.sysPermissions);
    if (snap.autoRules) saveKey('ems_sys_auto_rules', snap.autoRules);
    if (snap.customReports) saveKey('ems_custom_reports', snap.customReports);
    if (snap.customDashboard) saveKey('ems_custom_dashboard', snap.customDashboard);
    if (snap.customFormTemplates) saveKey('ems_custom_form_templates', snap.customFormTemplates);
    window.sysApplyTheme(snap.config);
    window.sysAuditLog('restore', 'backup', 'backup سے بحالی', before, snap.config);
    if (typeof window.applyCustomDictionary === 'function') window.applyCustomDictionary();
    if (typeof window.renderCustomButtons === 'function') window.renderCustomButtons();
    if (typeof renderDictionaryTable === 'function') renderDictionaryTable();
    if (typeof window.sysLayoutApplyAll === 'function') window.sysLayoutApplyAll();
    if (typeof window.sysDashRenderCustomWidgets === 'function') window.sysDashRenderCustomWidgets();
    window.sysLoadThemeForm();
    toast('بحال ہو گیا', 'success');
  };

  window.sysApplyPreset = function (presetId) {
    if (typeof window.sysRequirePerm === 'function' && !window.sysRequirePerm('theme', 'edit')) return;
    var p = PRESETS[presetId];
    if (!p) return;
    var before = window.sysGetConfig();
    var cfg = {
      colors: Object.assign({}, DEFAULT_COLORS, p.colors),
      buttonStyle: p.buttonStyle,
      fieldStyle: p.fieldStyle,
      inputBorder: p.inputBorder || 'normal',
      presetId: presetId,
      darkMode: !!p.darkMode
    };
    if (document.getElementById('sys-require-confirm') && document.getElementById('sys-require-confirm').checked) {
      if (!confirm('سانچہ «' + p.name + '» لاگو کریں؟ پہلے backup بنے گا۔')) return;
    }
    window.sysSaveConfig(cfg);
    window.sysApplyTheme(cfg);
    window.sysLoadThemeForm();
    window.sysAuditLog('apply_preset', 'theme', p.name, before, cfg);
    toast('سانچہ: ' + p.name, 'success');
  };

  window.sysLoadThemeForm = function () {
    var cfg = window.sysGetConfig();
    var c = cfg.colors || {};
    var map = {
      'sys-color-primary': c.primary, 'sys-color-secondary': c.secondary, 'sys-color-accent': c.accent,
      'sys-color-bg': c.bg, 'sys-color-surface': c.surface, 'sys-color-text': c.text,
      'sys-color-ribbon': c.ribbon, 'sys-color-subribbon': c.subRibbon,
      'sys-color-table-h': c.tableHeader, 'sys-color-success': c.success,
      'sys-color-danger': c.danger, 'sys-color-warning': c.warning,
      'sys-color-btn': c.btnPrimary, 'sys-color-btn-active': c.btnActive,
      'theme-color-primary': c.primary, 'theme-color-accent': c.accent
    };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && map[id]) el.value = map[id];
    });
    var bs = document.getElementById('sys-button-style') || document.getElementById('theme-style-select');
    if (bs) bs.value = cfg.buttonStyle || 'rounded';
    var fs = document.getElementById('sys-field-style');
    if (fs) fs.value = cfg.fieldStyle || 'rounded';
    var ib = document.getElementById('sys-input-border');
    if (ib) ib.value = cfg.inputBorder || 'normal';
    window.sysRenderPresetCards(cfg.presetId);
  };

  window.sysCollectThemeFromForm = function () {
    var g = function (id, fallback) {
      var el = document.getElementById(id);
      return el ? el.value : fallback;
    };
    var cfg = window.sysGetConfig();
    cfg.colors = {
      primary: g('sys-color-primary', cfg.colors.primary),
      secondary: g('sys-color-secondary', cfg.colors.secondary),
      accent: g('sys-color-accent', cfg.colors.accent),
      bg: g('sys-color-bg', cfg.colors.bg),
      surface: g('sys-color-surface', cfg.colors.surface),
      text: g('sys-color-text', cfg.colors.text),
      ribbon: g('sys-color-ribbon', cfg.colors.ribbon),
      subRibbon: g('sys-color-subribbon', cfg.colors.subRibbon),
      tableHeader: g('sys-color-table-h', cfg.colors.tableHeader),
      tableRow: cfg.colors.tableRow || '#ffffff',
      btnPrimary: g('sys-color-btn', cfg.colors.btnPrimary),
      btnActive: g('sys-color-btn-active', cfg.colors.btnActive),
      success: g('sys-color-success', cfg.colors.success),
      danger: g('sys-color-danger', cfg.colors.danger),
      warning: g('sys-color-warning', cfg.colors.warning),
      modFinance: cfg.colors.modFinance, modLedger: cfg.colors.modLedger, modExams: cfg.colors.modExams,
      modAttendance: cfg.colors.modAttendance, modComplaints: cfg.colors.modComplaints, modAnnounce: cfg.colors.modAnnounce
    };
    cfg.buttonStyle = g('sys-button-style', g('theme-style-select', 'rounded'));
    cfg.fieldStyle = g('sys-field-style', 'rounded');
    cfg.inputBorder = g('sys-input-border', 'normal');
    cfg.presetId = 'custom';
    cfg.darkMode = cfg.colors.bg && cfg.colors.bg.toLowerCase() < '#888888';
    return cfg;
  };

  window.sysSaveAndApplyTheme = function () {
    if (typeof window.sysRequirePerm === 'function' && !window.sysRequirePerm('theme', 'edit')) return;
    if (document.getElementById('sys-require-confirm') && document.getElementById('sys-require-confirm').checked) {
      if (!confirm('ظاہری ترتیب لاگو کریں؟ خودکار backup بنے گا۔')) return;
    }
    var before = window.sysGetConfig();
    var cfg = window.sysCollectThemeFromForm();
    window.sysSaveConfig(cfg);
    window.sysApplyTheme(cfg);
    window.sysAuditLog('update', 'theme', 'رنگ و اسٹائل', before, cfg);
    toast('ترتیب لاگو', 'success');
  };

  window.sysRenderPresetCards = function (activeId) {
    var grid = document.getElementById('sys-preset-grid');
    if (!grid) return;
    grid.innerHTML = Object.keys(PRESETS).map(function (id) {
      var p = PRESETS[id];
      var sel = id === activeId ? ' sys-preset-active' : '';
      return '<button type="button" class="sys-preset-card' + sel + '" onclick="window.sysApplyPreset(\'' + id + '\')" style="background:' + (p.colors.primary || '#333') + ';color:#fff;border:3px solid ' + (id === activeId ? '#fbbf24' : 'transparent') + ';">' +
        '<strong>' + p.name + '</strong><br><small style="opacity:.85;">' + id + '</small></button>';
    }).join('');
  };

  // ——— Profiles ———
  window.sysSaveProfile = function () {
    if (typeof window.sysRequirePerm === 'function' && !window.sysRequirePerm('profiles', 'edit')) return;
    var name = document.getElementById('sys-profile-name') ? document.getElementById('sys-profile-name').value.trim() : '';
    var type = document.getElementById('sys-profile-type') ? document.getElementById('sys-profile-type').value : 'madrasa';
    if (!name) return toast('سانچے کا نام لکھیں', 'error');
    var profiles = readJson(PROFILES_KEY, []) || [];
    profiles.push({
      id: 'PRF-' + Date.now(),
      name: name,
      type: type,
      config: window.sysGetConfig(),
      dict: readJson('ems_sys_dict', []),
      customButtons: readJson('ems_custom_buttons', []),
      actionToggles: readJson('ems_btn_action_toggles', null),
      customFields: readJson('ems_custom_fields', []),
      fieldVisibility: readJson('ems_field_visibility', {}),
      layoutConfig: readJson('ems_layout_config', null),
      sysPermissions: readJson('ems_sys_permissions', null),
      autoRules: readJson('ems_sys_auto_rules', []),
      customReports: readJson('ems_custom_reports', []),
      customDashboard: readJson('ems_custom_dashboard', []),
      customFormTemplates: readJson('ems_custom_form_templates', []),
      fieldStyle: { fieldStyle: window.sysGetConfig().fieldStyle, inputBorder: window.sysGetConfig().inputBorder },
      createdAt: Date.now(),
      createdBy: window.sysActorName()
    });
    saveKey(PROFILES_KEY, profiles);
    window.sysAuditLog('create', 'profile', name);
    window.sysRenderProfiles();
    toast('پروفائل محفوظ', 'success');
  };

  window.sysRestoreProfile = function (id) {
    var profiles = readJson(PROFILES_KEY, []) || [];
    var p = profiles.find(function (x) { return x.id === id; });
    if (!p) return;
    if (!confirm('پروفائل «' + p.name + '» بحال کریں؟')) return;
    window.sysBackupConfig('before-profile-restore');
    var before = window.sysGetConfig();
    window.sysSaveConfig(p.config, true);
    if (p.dict) saveKey('ems_sys_dict', p.dict);
    if (p.customButtons) saveKey('ems_custom_buttons', p.customButtons);
    if (p.actionToggles) saveKey('ems_btn_action_toggles', p.actionToggles);
    if (p.customFields) saveKey('ems_custom_fields', p.customFields);
    if (p.fieldVisibility) saveKey('ems_field_visibility', p.fieldVisibility);
    if (p.layoutConfig) saveKey('ems_layout_config', p.layoutConfig);
    if (p.sysPermissions) saveKey('ems_sys_permissions', p.sysPermissions);
    if (p.autoRules) saveKey('ems_sys_auto_rules', p.autoRules);
    if (p.customReports) saveKey('ems_custom_reports', p.customReports);
    if (p.customDashboard) saveKey('ems_custom_dashboard', p.customDashboard);
    if (p.customFormTemplates) saveKey('ems_custom_form_templates', p.customFormTemplates);
    window.sysApplyTheme(p.config);
    if (typeof window.applyCustomDictionary === 'function') window.applyCustomDictionary();
    if (typeof window.sysBtnRenderAll === 'function') window.sysBtnRenderAll();
    if (typeof window.sysFieldRenderAll === 'function') window.sysFieldRenderAll();
    if (typeof window.sysLayoutApplyAll === 'function') window.sysLayoutApplyAll();
    if (typeof window.sysBtnApplyActionToggles === 'function') window.sysBtnApplyActionToggles(null);
    if (typeof window.sysPermApplyUI === 'function') window.sysPermApplyUI();
    window.sysAuditLog('restore', 'profile', p.name, before, p.config);
    window.sysLoadThemeForm();
    toast('پروفائل بحال', 'success');
  };

  window.sysDeleteProfile = function (id) {
    if (!confirm('پروفائل حذف؟')) return;
    var profiles = (readJson(PROFILES_KEY, []) || []).filter(function (x) { return x.id !== id; });
    saveKey(PROFILES_KEY, profiles);
    window.sysRenderProfiles();
  };

  window.sysExportProfile = function (id) {
    var profiles = readJson(PROFILES_KEY, []) || [];
    var p = profiles.find(function (x) { return x.id === id; });
    if (!p) return;
    var a = document.createElement('a');
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(p, null, 2));
    a.download = 'ems-profile-' + p.name + '.json';
    a.click();
  };

  window.sysImportProfile = function (input) {
    if (!input.files || !input.files[0]) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var p = JSON.parse(e.target.result);
        p.id = 'PRF-' + Date.now();
        p.importedAt = Date.now();
        var profiles = readJson(PROFILES_KEY, []) || [];
        profiles.push(p);
        saveKey(PROFILES_KEY, profiles);
        window.sysRenderProfiles();
        toast('درآمد', 'success');
      } catch (err) { toast('غلط فائل', 'error'); }
    };
    reader.readAsText(input.files[0]);
    input.value = '';
  };

  window.sysRenderProfiles = function () {
    var list = document.getElementById('sys-profiles-list');
    if (!list) return;
    var profiles = readJson(PROFILES_KEY, []) || [];
    if (!profiles.length) { list.innerHTML = '<p style="color:#94a3b8;">کوئی پروفائل نہیں</p>'; return; }
    list.innerHTML = profiles.map(function (p) {
      return '<div class="sys-profile-row"><div><strong>' + p.name + '</strong> <small>(' + (p.type || '—') + ')</small></div><div>' +
        '<button class="btn btn-sm btn-primary" onclick="window.sysRestoreProfile(\'' + p.id + '\')"><i class="fas fa-undo"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="window.sysExportProfile(\'' + p.id + '\')"><i class="fas fa-download"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="window.sysDeleteProfile(\'' + p.id + '\')"><i class="fas fa-trash"></i></button></div></div>';
    }).join('');
  };

  window.sysRenderAudit = function () {
    var tbody = document.getElementById('sys-audit-tbody');
    if (!tbody) return;
    var entityFilter = document.getElementById('sys-audit-filter-entity');
    var actionFilter = document.getElementById('sys-audit-filter-action');
    var entityVal = entityFilter ? entityFilter.value : '';
    var actionVal = actionFilter ? actionFilter.value : '';
    var logs = (readJson(AUDIT_KEY, []) || []).slice().reverse();
    if (entityVal) logs = logs.filter(function (l) { return l.entity === entityVal; });
    if (actionVal) logs = logs.filter(function (l) { return l.action === actionVal; });
    logs = logs.slice(0, 150);
    var canRestore = typeof window.sysCan === 'function' && (window.sysCan('audit', 'restore') || window.sysCan('security', 'restore'));
    if (!logs.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">کوئی لاگ نہیں</td></tr>'; return; }
    tbody.innerHTML = logs.map(function (l) {
      var detailBtn = (l.before || l.after) ? '<button class="btn btn-sm btn-outline sys-perm-keep" onclick="window.sysViewAuditDetail(\'' + l.id + '\')"><i class="fas fa-search"></i></button>' : '';
      var restoreBtn = (canRestore && l.before) ? ' <button class="btn btn-sm btn-warning sys-perm-keep" onclick="window.sysRestoreFromAudit(\'' + l.id + '\')"><i class="fas fa-undo"></i></button>' : '';
      return '<tr><td>' + new Date(l.timestamp).toLocaleString('ur-PK') + '</td><td>' + l.userName + '</td><td>' + l.action + '</td><td>' + (l.entity || '—') + '</td><td>' + (l.summary || '') + '</td><td>' +
        (detailBtn || restoreBtn ? detailBtn + restoreBtn : '—') + '</td></tr>';
    }).join('');
  };

  window.sysRestoreFromAudit = function (id) {
    if (typeof window.sysRequirePerm === 'function' && !window.sysRequirePerm('audit', 'restore') && !window.sysRequirePerm('security', 'restore')) return;
    var log = (readJson(AUDIT_KEY, []) || []).find(function (l) { return l.id === id; });
    if (!log || !log.before) return toast('بحالی کے لیے پرانا ڈیٹا نہیں', 'error');
    if (!confirm('اس لاگ سے «' + (log.summary || log.entity) + '» بحال کریں؟')) return;
    window.sysBackupConfig('before-audit-restore');
    var ent = log.entity;
    var before = log.before;

    if (ent === 'theme' || ent === 'apply_preset') {
      window.sysSaveConfig(before, true);
      window.sysApplyTheme(before);
      window.sysLoadThemeForm();
    } else if (ent === 'terminology') {
      var dict = readJson('ems_sys_dict', []) || [];
      if (Array.isArray(before)) {
        saveKey('ems_sys_dict', before);
      } else if (before && before.oldWord) {
        dict = dict.filter(function (d) { return d.oldWord !== before.oldWord && d.oldWord !== (log.after && log.after.oldWord); });
        dict.push(before);
        saveKey('ems_sys_dict', dict);
      }
      if (typeof window.applyCustomDictionary === 'function') window.applyCustomDictionary();
      if (typeof renderDictionaryTable === 'function') renderDictionaryTable();
      if (typeof window.sysTermInitTree === 'function') window.sysTermInitTree();
    } else if (ent === 'custom_button') {
      if (Array.isArray(before)) saveKey('ems_custom_buttons', before);
      else {
        var btns = readJson('ems_custom_buttons', []) || [];
        btns = btns.filter(function (b) { return b.id !== before.id; });
        btns.push(before);
        saveKey('ems_custom_buttons', btns);
      }
      if (typeof window.sysBtnRenderAll === 'function') window.sysBtnRenderAll();
    } else if (ent === 'action_toggles') {
      saveKey('ems_btn_action_toggles', before);
      if (typeof window.sysBtnApplyActionToggles === 'function') window.sysBtnApplyActionToggles(null);
    } else if (ent === 'custom_field') {
      if (Array.isArray(before)) saveKey('ems_custom_fields', before);
      else {
        var fields = readJson('ems_custom_fields', []) || [];
        fields = fields.filter(function (f) { return f.id !== before.id; });
        fields.push(before);
        saveKey('ems_custom_fields', fields);
      }
      if (typeof window.sysFieldRenderAll === 'function') window.sysFieldRenderAll();
    } else if (ent === 'field_visibility') {
      saveKey('ems_field_visibility', before);
      if (typeof window.sysFieldRenderAll === 'function') window.sysFieldRenderAll();
    } else if (ent === 'layout') {
      saveKey('ems_layout_config', before);
      if (typeof window.sysLayoutApplyAll === 'function') window.sysLayoutApplyAll();
    } else if (ent === 'permissions') {
      saveKey('ems_sys_permissions', before);
      if (typeof window.sysPermApplyUI === 'function') window.sysPermApplyUI();
    } else if (ent === 'custom_report') {
      saveKey('ems_custom_reports', before);
      if (typeof window.sysReportRenderTable === 'function') window.sysReportRenderTable();
    } else if (ent === 'dashboard_widget') {
      saveKey('ems_custom_dashboard', before);
      if (typeof window.sysDashRenderCustomWidgets === 'function') window.sysDashRenderCustomWidgets();
    } else if (ent === 'form_template') {
      saveKey('ems_custom_form_templates', before);
      if (typeof window.sysFormTplRenderTable === 'function') window.sysFormTplRenderTable();
    } else if (ent === 'profile' && before.colors) {
      window.sysSaveConfig(before, true);
      window.sysApplyTheme(before);
    } else {
      return toast('اس قسم کی بحالی ابھی دستیاب نہیں: ' + ent, 'error');
    }
    window.sysAuditLog('restore', ent, 'آڈٹ سے بحالی: ' + (log.summary || id), log.after, before);
    window.sysRenderAudit();
    toast('آڈٹ سے بحال ہو گیا', 'success');
  };

  window.sysViewAuditDetail = function (id) {
    var log = (readJson(AUDIT_KEY, []) || []).find(function (l) { return l.id === id; });
    if (!log) return;
    var body = document.getElementById('sys-audit-detail-body');
    var modal = document.getElementById('sys-audit-detail-modal');
    var canRestore = typeof window.sysCan === 'function' && (window.sysCan('audit', 'restore') || window.sysCan('security', 'restore'));
    var restoreHtml = (canRestore && log.before) ? '<button class="btn btn-warning sys-perm-keep" style="margin-top:10px;" onclick="window.sysRestoreFromAudit(\'' + log.id + '\');document.getElementById(\'sys-audit-detail-modal\').style.display=\'none\'"><i class="fas fa-undo"></i> اس حالت پر بحال</button>' : '';
    if (body) body.innerHTML = '<p style="font-size:13px;color:#64748b;">' + log.action + ' / ' + log.entity + ' — ' + (log.summary || '') + '</p>' +
      '<pre style="font-size:11px;direction:ltr;text-align:left;white-space:pre-wrap;">' +
      JSON.stringify({ before: log.before, after: log.after }, null, 2) + '</pre>' + restoreHtml;
    if (modal) modal.style.display = 'flex';
  };

  window.switchSysTab = function (tabId, btn) {
    document.querySelectorAll('#module-sys-settings .sys-tab-content').forEach(function (el) { el.style.display = 'none'; });
    var p = document.getElementById(tabId);
    if (p) p.style.display = 'block';
    document.querySelectorAll('#sys-ribbon-menu .reg-tab').forEach(function (b) { b.classList.remove('active-sub-tab'); });
    if (btn) btn.classList.add('active-sub-tab');
    if (tabId === 'sys-win-theme') {
      window.sysLoadThemeForm();
      bindThemeLivePreview();
      window.sysApplyTheme(window.sysGetConfig());
    }
    if (tabId === 'sys-win-profiles') window.sysRenderProfiles();
    if (tabId === 'sys-win-audit') window.sysRenderAudit();
    if (tabId === 'sys-win-terminology') {
      if (typeof window.sysTermInitTree === 'function') window.sysTermInitTree();
      else if (typeof renderDictionaryTable === 'function') renderDictionaryTable();
    }
    if (tabId === 'sys-win-buttons' && typeof window.sysBtnInitUI === 'function') window.sysBtnInitUI();
    if (tabId === 'sys-win-fields' && typeof window.sysFieldInitUI === 'function') window.sysFieldInitUI();
    if (tabId === 'sys-win-layout' && typeof window.sysLayoutInitUI === 'function') window.sysLayoutInitUI();
    if (tabId === 'sys-win-permissions' && typeof window.sysPermInitUI === 'function') window.sysPermInitUI();
    if (tabId === 'sys-win-reports' && typeof window.sysReportInitUI === 'function') window.sysReportInitUI();
    if (tabId === 'sys-win-ai') {
      if (typeof window.emsAiSettingsInitUI === 'function') window.emsAiSettingsInitUI();
      if (typeof window.emsAiSettingsLoad === 'function') window.emsAiSettingsLoad();
    }
    if (tabId === 'sys-win-dept-migration' && typeof window.emsDeptMigrationRenderUI === 'function') window.emsDeptMigrationRenderUI();
    if (tabId === 'sys-win-photo-migration') {
      var renderPhotoTab = function () {
        if (typeof window.emsPhotoMigrationRenderUI === 'function') {
          window.emsPhotoMigrationRenderUI();
        } else if (typeof window.showToast === 'function') {
          window.showToast('تصویر مائیگریشن لوڈ نہیں — پہلے آن لائن موڈ آن کریں', 'warning');
        }
      };
      if (typeof window.emsPhotoMigrationRenderUI === 'function') {
        renderPhotoTab();
      } else {
        var chain = Promise.resolve();
        if (typeof window.emsEnableOnlineMode === 'function') {
          chain = window.emsEnableOnlineMode();
        }
        chain.then(function () {
          if (typeof window.emsLoadCloudDeferred === 'function') {
            return window.emsLoadCloudDeferred();
          }
        }).then(renderPhotoTab).catch(function () { renderPhotoTab(); });
      }
    }
    if (tabId === 'sys-win-perf' && typeof window.emsPerfSettingsRenderUI === 'function') window.emsPerfSettingsRenderUI();
    if (tabId === 'sys-win-diagnostics') {
      if (typeof window.emsDiagnosticsUIInit === 'function') window.emsDiagnosticsUIInit();
      if (typeof window.emsDiagnosticsUIRun === 'function') window.emsDiagnosticsUIRun();
    }
    if (typeof window.sysPermApplyUI === 'function') window.sysPermApplyUI();
  };

  window.refreshSysSettings = function () {
    window.sysLoadThemeForm();
    window.sysRenderProfiles();
    if (typeof renderDictionaryTable === 'function') renderDictionaryTable();
    if (typeof window.sysTermInitTree === 'function') window.sysTermInitTree();
    if (typeof window.sysPermApplyUI === 'function') window.sysPermApplyUI();
    if (typeof window.sysDashRenderCustomWidgets === 'function') window.sysDashRenderCustomWidgets();
  };

  function sysBootApplyTheme() {
    window.sysApplyTheme(window.sysGetConfig());
    bindThemeLivePreview();
    if (!readJson(BACKUP_KEY, null)) window.sysBackupConfig('initial');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sysBootApplyTheme);
  } else {
    sysBootApplyTheme();
  }
  window.addEventListener('ems:post-auth-deferred-ready', sysBootApplyTheme);

  document.addEventListener('click', function (e) {
    if (e.target && (e.target.id === 'sys-btn-apply-theme' || e.target.closest('#sys-btn-apply-theme') || e.target.closest('#btn-save-theme'))) {
      window.sysSaveAndApplyTheme();
    }
    if (e.target && (e.target.id === 'sys-btn-restore-backup' || e.target.closest('#sys-btn-restore-backup'))) {
      window.sysRestoreBackup();
    }
    if (e.target && (e.target.id === 'sys-btn-save-profile' || e.target.closest('#sys-btn-save-profile'))) {
      window.sysSaveProfile();
    }
  });

})();
