// ================= Phase F: Settings Permissions + Auto-Rules =================
(function () {
  'use strict';

  var PERM_KEY = 'ems_sys_permissions';
  var RULES_KEY = 'ems_sys_auto_rules';

  var AREAS = [
    { id: 'theme', tab: 'sys-win-theme', label: 'ظاہری شکل', icon: 'fa-palette' },
    { id: 'terminology', tab: 'sys-win-terminology', label: 'اصطلاحات', icon: 'fa-language' },
    { id: 'buttons', tab: 'sys-win-buttons', label: 'بٹن ساز', icon: 'fa-mouse-pointer' },
    { id: 'fields', tab: 'sys-win-fields', label: 'فیلڈ ساز', icon: 'fa-th-large' },
    { id: 'layout', tab: 'sys-win-layout', label: 'ترتیب', icon: 'fa-columns' },
    { id: 'reports', tab: 'sys-win-reports', label: 'رپورٹ و ڈیش بورڈ', icon: 'fa-chart-bar' },
    { id: 'profiles', tab: 'sys-win-profiles', label: 'سانچے', icon: 'fa-clone' },
    { id: 'permissions', tab: 'sys-win-permissions', label: 'اختیارات', icon: 'fa-user-shield' },
    { id: 'audit', tab: 'sys-win-audit', label: 'آڈٹ', icon: 'fa-shield-alt' },
    { id: 'security', tab: 'sys-win-security', label: 'حفاظت', icon: 'fa-lock' },
    { id: 'rules', tab: 'sys-win-permissions', label: 'خودکار قواعد', icon: 'fa-robot' }
  ];

  var ACTIONS = [
    { id: 'view', label: 'دیکھیں' },
    { id: 'edit', label: 'ترمیم' },
    { id: 'export', label: 'برآمد' },
    { id: 'restore', label: 'بحالی' }
  ];

  var ROLE_LABELS = {
    owner: 'منتظم / مہتمم',
    staff: 'عملہ (عام)',
    viewer: 'صرف دیکھیں'
  };

  function fullAccess() {
    var a = {};
    AREAS.forEach(function (ar) {
      a[ar.id] = { view: true, edit: true, export: true, restore: true };
    });
    return a;
  }

  function viewOnlyAccess() {
    var a = {};
    AREAS.forEach(function (ar) {
      a[ar.id] = {
        view: ar.id !== 'permissions' && ar.id !== 'rules',
        edit: false,
        export: false,
        restore: false
      };
    });
    a.audit.view = true;
    a.security.view = true;
    return a;
  }

  function staffDefaultAccess() {
    var a = viewOnlyAccess();
    a.theme.view = true;
    a.terminology.view = true;
    a.buttons.view = true;
    a.fields.view = true;
    a.layout.view = true;
    a.reports.view = true;
    return a;
  }

  var DEFAULT = {
    version: 1,
    roles: {
      owner: fullAccess(),
      staff: staffDefaultAccess(),
      viewer: viewOnlyAccess()
    },
    templateMap: {
      teacher: 'staff',
      reception: 'staff',
      accountant: 'viewer',
      exam_officer: 'staff',
      edu_supervisor: 'staff'
    }
  };

  var TRIGGERS = [
    { id: 'on_theme_change', label: 'تھیم تبدیل' },
    { id: 'on_dict_change', label: 'اصطلاحات تبدیل' },
    { id: 'on_button_change', label: 'بٹن تبدیل' },
    { id: 'on_field_change', label: 'فیلڈ تبدیل' },
    { id: 'on_layout_change', label: 'ترتیب تبدیل' },
    { id: 'on_any_settings_change', label: 'کوئی بھی سیٹنگ تبدیل' },
    { id: 'on_permission_change', label: 'اختیارات تبدیل' }
  ];

  var RULE_ACTIONS = [
    { id: 'auto_backup', label: 'خودکار Backup' },
    { id: 'toast_alert', label: 'اطلاع (Toast)' },
    { id: 'audit_note', label: 'آڈٹ نوٹ' }
  ];

  function readJson(key, fb) {
    try { return JSON.parse(localStorage.getItem(key) || (fb != null ? JSON.stringify(fb) : 'null')); }
    catch (e) { return fb; }
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
      if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        out[k] = deepMerge(out[k], over[k]);
      } else out[k] = over[k];
    });
    return out;
  }

  function resolveUserRole() {
    if (window.isSuperAdmin && window.isSuperAdmin()) return 'owner';
    if (window.isMadrasaAdmin && window.isMadrasaAdmin()) return 'owner';
    if (window.emsIsStaffUser && window.emsIsStaffUser()) {
      var cfg = window.sysPermGetConfig();
      var staff = window.emsGetStaffRecordForCurrentUser && window.emsGetStaffRecordForCurrentUser();
      if (staff && staff.templateId && cfg.templateMap[staff.templateId]) {
        return cfg.templateMap[staff.templateId];
      }
      if (staff && staff.role && cfg.roles[staff.role]) return staff.role;
      return 'staff';
    }
    return 'viewer';
  }

  window.sysPermGetConfig = function () {
    return deepMerge(DEFAULT, readJson(PERM_KEY, null));
  };

  window.sysPermSaveConfig = function (cfg) {
    var before = readJson(PERM_KEY, null);
    writeJson(PERM_KEY, cfg);
    if (typeof window.sysAuditLog === 'function') {
      window.sysAuditLog('update', 'permissions', 'سیٹنگز اختیارات محفوظ', before, cfg);
    }
    window.sysPermApplyUI();
    toast('اختیارات محفوظ', 'success');
  };

  window.sysCan = function (area, action) {
    action = action || 'view';
    if (window.isSuperAdmin && window.isSuperAdmin()) return true;
    var cfg = window.sysPermGetConfig();
    var role = resolveUserRole();
    var perms = (cfg.roles && cfg.roles[role]) || cfg.roles.viewer || viewOnlyAccess();
    var areaPerm = perms[area] || { view: false, edit: false, export: false, restore: false };
    if (action === 'edit' && areaPerm.edit) return true;
    if (action === 'export' && areaPerm.export) return true;
    if (action === 'restore' && areaPerm.restore) return true;
    if (action === 'view' && areaPerm.view) return true;
    if (action === 'view' && areaPerm.edit) return true;
    return false;
  };

  window.sysRequirePerm = function (area, action) {
    if (window.sysCan(area, action)) return true;
    toast('اس حصے کی اجازت نہیں: ' + area, 'error');
    if (typeof window.emsLogSecurityEvent === 'function') {
      window.emsLogSecurityEvent('sys_settings_denied', { area: area, action: action });
    }
    return false;
  };

  function areaTabMap() {
    var m = {};
    AREAS.forEach(function (a) { if (a.tab) m[a.id] = a.tab; });
    return m;
  }

  window.sysPermApplyUI = function () {
    var tabMap = areaTabMap();
    AREAS.forEach(function (ar) {
      if (!ar.tab || ar.id === 'rules') return;
      var canView = window.sysCan(ar.id, 'view');
      var canEdit = window.sysCan(ar.id, 'edit');
      var tabBtn = document.querySelector('#sys-ribbon-menu .reg-tab[onclick*="' + ar.tab + '"]');
      if (tabBtn) tabBtn.style.display = canView ? '' : 'none';
      var panel = document.getElementById(ar.tab);
      if (panel) {
        panel.classList.toggle('sys-perm-readonly', canView && !canEdit);
        panel.querySelectorAll('button, input, select, textarea').forEach(function (el) {
          if (el.closest('#sys-audit-detail-modal')) return;
          if (el.classList.contains('sys-perm-keep')) return;
          if (!canEdit && (el.type === 'button' || el.type === 'submit' || el.tagName === 'BUTTON')) {
            if (el.id && (el.id.indexOf('sys-audit') >= 0 || el.onclick && String(el.onclick).indexOf('sysViewAudit') >= 0)) return;
            el.disabled = true;
          } else if (canEdit) {
            el.disabled = false;
          }
          if (!canEdit && el.tagName !== 'BUTTON' && el.type !== 'button') {
            el.readOnly = !canEdit;
            if (el.tagName === 'SELECT' || el.type === 'checkbox') el.disabled = !canEdit;
          }
        });
      }
    });
    var permPanel = document.getElementById('sys-win-permissions');
    if (permPanel) {
      var permEdit = window.sysCan('permissions', 'edit');
      permPanel.querySelectorAll('#sys-perm-matrix input, #sys-perm-matrix select, #sys-perm-save, #sys-rule-add, .sys-rule-toggle, .sys-rule-del').forEach(function (el) {
        el.disabled = !permEdit;
      });
    }
  };

  window.sysPermInitUI = function () {
    var cfg = window.sysPermGetConfig();
    var matrix = document.getElementById('sys-perm-matrix');
    if (!matrix) return;

    var roleSelect = document.getElementById('sys-perm-role-select');
    var role = roleSelect ? roleSelect.value : 'owner';

    var html = '<table class="data-table sys-perm-table"><thead><tr><th>حصہ</th>';
    ACTIONS.forEach(function (act) {
      html += '<th>' + act.label + '</th>';
    });
    html += '</tr></thead><tbody>';
    AREAS.forEach(function (ar) {
      if (ar.id === 'rules') return;
      html += '<tr><td><i class="fas ' + ar.icon + '"></i> ' + esc(ar.label) + '</td>';
      ACTIONS.forEach(function (act) {
        var checked = cfg.roles[role] && cfg.roles[role][ar.id] && cfg.roles[role][ar.id][act.id];
        html += '<td style="text-align:center;"><input type="checkbox" data-role="' + role + '" data-area="' + ar.id + '" data-action="' + act.id + '"' + (checked ? ' checked' : '') + '></td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    matrix.innerHTML = html;

    var tmpl = document.getElementById('sys-perm-template-map');
    if (tmpl) {
      var templates = window.ADMIN_TEMPLATES || {};
      tmpl.innerHTML = Object.keys(templates).map(function (tid) {
        var t = templates[tid];
        var cur = cfg.templateMap[tid] || 'staff';
        return '<div class="sys-perm-tmpl-row"><span>' + esc(t.name || tid) + '</span>' +
          '<select class="input-control sys-perm-tmpl-select" data-template="' + tid + '">' +
          Object.keys(ROLE_LABELS).map(function (r) {
            return '<option value="' + r + '"' + (cur === r ? ' selected' : '') + '>' + ROLE_LABELS[r] + '</option>';
          }).join('') + '</select></div>';
      }).join('') || '<p style="color:#94a3b8;">Admin Panel templates لوڈ نہیں</p>';
    }

    window.sysRulesRenderList();
    window.sysPermApplyUI();
  };

  window.sysPermCollectFromUI = function () {
    var cfg = window.sysPermGetConfig();
    document.querySelectorAll('#sys-perm-matrix input[type=checkbox]').forEach(function (cb) {
      var role = cb.getAttribute('data-role');
      var area = cb.getAttribute('data-area');
      var action = cb.getAttribute('data-action');
      if (!cfg.roles[role]) cfg.roles[role] = {};
      if (!cfg.roles[role][area]) cfg.roles[role][area] = {};
      cfg.roles[role][area][action] = cb.checked;
    });
    document.querySelectorAll('.sys-perm-tmpl-select').forEach(function (sel) {
      cfg.templateMap[sel.getAttribute('data-template')] = sel.value;
    });
    return cfg;
  };

  window.sysPermSaveFromUI = function () {
    if (!window.sysRequirePerm('permissions', 'edit')) return;
    window.sysPermSaveConfig(window.sysPermCollectFromUI());
  };

  window.sysPermResetDefaults = function () {
    if (!window.sysRequirePerm('permissions', 'edit')) return;
    if (!confirm('ڈیفالٹ اختیارات بحال؟')) return;
    writeJson(PERM_KEY, DEFAULT);
    window.sysPermInitUI();
    toast('ڈیفالٹ بحال', 'warning');
  };

  // ——— Auto Rules ———
  window.sysRulesGetAll = function () {
    return readJson(RULES_KEY, []) || [];
  };

  window.sysRulesSaveAll = function (rules) {
    writeJson(RULES_KEY, rules);
  };

  window.sysRulesRenderList = function () {
    var list = document.getElementById('sys-rules-list');
    if (!list) return;
    var rules = window.sysRulesGetAll();
    if (!rules.length) {
      list.innerHTML = '<p style="color:#94a3b8;font-size:13px;">کوئی خودکار قاعدہ نہیں — نیچے شامل کریں</p>';
      return;
    }
    list.innerHTML = rules.map(function (r) {
      return '<div class="sys-rule-row">' +
        '<label class="checkbox-label"><input type="checkbox" class="sys-rule-toggle" data-id="' + r.id + '"' + (r.enabled !== false ? ' checked' : '') + '> ' + esc(r.name) + '</label>' +
        '<small style="color:#64748b;">' + esc(r.trigger) + ' → ' + esc(r.action) + '</small>' +
        '<button type="button" class="btn btn-sm btn-outline sys-rule-del sys-perm-keep" data-id="' + r.id + '"><i class="fas fa-trash"></i></button></div>';
    }).join('');
  };

  window.sysRulesAddFromUI = function () {
    if (!window.sysRequirePerm('permissions', 'edit')) return;
    var nameEl = document.getElementById('sys-rule-name');
    var trigEl = document.getElementById('sys-rule-trigger');
    var actEl = document.getElementById('sys-rule-action');
    var msgEl = document.getElementById('sys-rule-message');
    var name = nameEl ? nameEl.value.trim() : '';
    if (!name) return toast('قاعدے کا نام لکھیں', 'error');
    var rules = window.sysRulesGetAll();
    rules.push({
      id: 'RUL-' + Date.now(),
      name: name,
      trigger: trigEl ? trigEl.value : 'on_any_settings_change',
      action: actEl ? actEl.value : 'auto_backup',
      params: { message: msgEl ? msgEl.value.trim() : '' },
      enabled: true,
      createdAt: Date.now()
    });
    window.sysRulesSaveAll(rules);
    if (nameEl) nameEl.value = '';
    if (msgEl) msgEl.value = '';
    window.sysRulesRenderList();
    toast('قاعدہ شامل', 'success');
  };

  function entityToTrigger(entity, action) {
    if (entity === 'theme' || entity === 'apply_preset') return 'on_theme_change';
    if (entity === 'terminology') return 'on_dict_change';
    if (entity === 'custom_button' || entity === 'action_toggles') return 'on_button_change';
    if (entity === 'custom_field' || entity === 'field_visibility') return 'on_field_change';
    if (entity === 'layout') return 'on_layout_change';
    if (entity === 'permissions') return 'on_permission_change';
    return 'on_any_settings_change';
  }

  window.sysRulesRunOnAudit = function (action, entity, summary) {
    var rules = window.sysRulesGetAll().filter(function (r) { return r.enabled !== false; });
    if (!rules.length) return;
    var trig = entityToTrigger(entity, action);
    rules.forEach(function (rule) {
      if (rule.trigger !== trig && rule.trigger !== 'on_any_settings_change') return;
      if (rule.action === 'auto_backup' && typeof window.sysBackupConfig === 'function') {
        window.sysBackupConfig('auto-rule-' + rule.id);
      }
      if (rule.action === 'toast_alert' && typeof window.showToast === 'function') {
        window.showToast(rule.params && rule.params.message ? rule.params.message : ('قاعدہ: ' + rule.name), 'warning');
      }
      if (rule.action === 'audit_note' && typeof window.sysAuditLog === 'function') {
        window.sysAuditLog('rule', 'auto_rule', rule.name + ': ' + (summary || entity));
      }
    });
  };

  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'sys-perm-save') window.sysPermSaveFromUI();
    if (e.target && e.target.closest('#sys-perm-reset')) window.sysPermResetDefaults();
    if (e.target && e.target.id === 'sys-rule-add') window.sysRulesAddFromUI();
    if (e.target && e.target.classList.contains('sys-rule-del')) {
      if (!window.sysRequirePerm('permissions', 'edit')) return;
      var id = e.target.closest('.sys-rule-del').getAttribute('data-id');
      window.sysRulesSaveAll(window.sysRulesGetAll().filter(function (r) { return r.id !== id; }));
      window.sysRulesRenderList();
    }
    if (e.target && e.target.classList.contains('sys-rule-toggle')) {
      if (!window.sysRequirePerm('permissions', 'edit')) { e.target.checked = !e.target.checked; return; }
      var rid = e.target.getAttribute('data-id');
      var rules = window.sysRulesGetAll();
      rules.forEach(function (r) { if (r.id === rid) r.enabled = e.target.checked; });
      window.sysRulesSaveAll(rules);
    }
  });

  if (document.getElementById('sys-perm-role-select')) {
    document.getElementById('sys-perm-role-select').addEventListener('change', function () {
      var cfg = window.sysPermCollectFromUI();
      writeJson(PERM_KEY, cfg);
      window.sysPermInitUI();
    });
  }

  window.SYS_PERM_AREAS = AREAS;
  window.SYS_PERM_TRIGGERS = TRIGGERS;
  window.SYS_PERM_RULE_ACTIONS = RULE_ACTIONS;

})();
