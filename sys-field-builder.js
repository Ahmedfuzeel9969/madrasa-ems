// ================= Field Builder — Phase D: Custom Fields + Visibility =================
(function () {
  'use strict';

  var FIELDS_KEY = 'ems_custom_fields';
  var VIS_KEY = 'ems_field_visibility';

  var FIELD_TYPES = [
    { id: 'text', label: 'متن' },
    { id: 'number', label: 'عدد' },
    { id: 'tel', label: 'فون' },
    { id: 'email', label: 'ای میل' },
    { id: 'date', label: 'تاریخ' },
    { id: 'textarea', label: 'لمبا متن' },
    { id: 'select', label: 'فہرست (Select)' },
    { id: 'checkbox', label: 'ہاں/نہیں' }
  ];

  var FORMS = [
    { id: 'student', label: 'طلباء' },
    { id: 'teacher', label: 'اساتذہ' },
    { id: 'staff', label: 'عملہ' }
  ];

  var SECTIONS = {
    student: [
      { id: 'personal', label: 'ذاتی معلومات' },
      { id: 'guardian', label: 'والد / سرپرست' },
      { id: 'education', label: 'تعلیمی کوائف' },
      { id: 'office', label: 'دفتری کارروائی' },
      { id: 'custom', label: 'نیا حصہ (مخصوص)' }
    ],
    teacher: [
      { id: 'personal', label: 'ذاتی معلومات' },
      { id: 'employment', label: 'ملازمت' },
      { id: 'experience', label: 'تجربہ' },
      { id: 'office', label: 'دفتری' },
      { id: 'custom', label: 'نیا حصہ' }
    ],
    staff: [
      { id: 'personal', label: 'ذاتی' },
      { id: 'guarantor', label: 'ضامن' },
      { id: 'experience', label: 'تجربہ / صحت' },
      { id: 'office', label: 'دفتری' },
      { id: 'custom', label: 'نیا حصہ' }
    ]
  };

  var BUILTIN = {
    student: [
      { id: 'stu-blood-group', label: 'بلڈ گروپ' },
      { id: 'stu-adm-type', label: 'داخلہ نوعیت' },
      { id: 'stu-res-type', label: 'رہائشی نوعیت' },
      { id: 'stu-grd-emergency', label: 'ہنگامی رابطہ' },
      { id: 'stu-office-nazra', label: 'ناظرہ قرآن' }
    ],
    teacher: [
      { id: 'tch-whatsapp', label: 'واٹس ایپ' },
      { id: 'tch-email', label: 'ای میل' },
      { id: 'tch-residence', label: 'رہائش' },
      { id: 'tch-food', label: 'طعام' }
    ],
    staff: [
      { id: 'stf-health-issue', label: 'بیماری/معذوری' },
      { id: 'stf-exp-details', label: 'پچھلا تجربہ' }
    ]
  };

  var PRESETS = [
    { label: 'قومیت', key: 'nationality', type: 'text', form: 'student', section: 'personal', placeholder: 'مثلاً: پاکستانی' },
    { label: 'سرپرست نمبر دو', key: 'guardian_phone2', type: 'tel', form: 'student', section: 'guardian', placeholder: '03xx...' },
    { label: 'تخصص', key: 'specialization', type: 'text', form: 'teacher', section: 'employment', placeholder: 'مثلاً: حدیث' },
    { label: 'رہائشی حیثیت (تفصیل)', key: 'residence_detail', type: 'select', form: 'student', section: 'personal', options: ['مقامی', 'غیر مقامی', 'غیر ملکی'] }
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

  function slugify(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\w\u0600-\u06FF-]/g, '').slice(0, 40) || ('field_' + Date.now());
  }

  function getFields() { return readJson(FIELDS_KEY, []) || []; }

  function getVisibility() { return readJson(VIS_KEY, {}) || {}; }

  function fieldDomId(form, key) { return 'ecf-' + form + '-' + key; }

  function slotId(form, section) { return 'ems-cf-' + form + '-' + section; }

  function collectForm() {
    var g = function (id, fb) {
      var el = document.getElementById(id);
      return el ? el.value : fb;
    };
    var label = g('ecf-label', '').trim();
    var key = g('ecf-key', '').trim() || slugify(label);
    var optsRaw = g('ecf-options', '');
    var options = optsRaw ? optsRaw.split(/[,،\n]/).map(function (s) { return s.trim(); }).filter(Boolean) : [];
    return {
      label: label,
      key: key,
      type: g('ecf-type', 'text'),
      form: g('ecf-form', 'student'),
      section: g('ecf-section', 'personal'),
      sectionTitle: g('ecf-section-title', '').trim(),
      placeholder: g('ecf-placeholder', ''),
      required: document.getElementById('ecf-required') ? document.getElementById('ecf-required').checked : false,
      width: g('ecf-width', 'half'),
      options: options,
      enabled: document.getElementById('ecf-enabled') ? document.getElementById('ecf-enabled').checked : true,
      order: parseInt(g('ecf-order', '50'), 10) || 50
    };
  }

  function buildInputHtml(f) {
    var id = fieldDomId(f.form, f.key);
    var req = f.required ? ' required' : '';
    var ph = f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '';
    var cls = 'input-control ems-custom-field-input';
    if (f.type === 'textarea') {
      return '<textarea id="' + id + '" class="' + cls + '" rows="2"' + req + ph + '></textarea>';
    }
    if (f.type === 'select') {
      var opts = (f.options || []).map(function (o) {
        return '<option value="' + esc(o) + '">' + esc(o) + '</option>';
      }).join('');
      return '<select id="' + id + '" class="' + cls + '"' + req + '><option value="">منتخب...</option>' + opts + '</select>';
    }
    if (f.type === 'checkbox') {
      return '<label class="checkbox-label"><input type="checkbox" id="' + id + '" class="ems-custom-field-input"> ' + esc(f.label) + '</label>';
    }
    return '<input type="' + esc(f.type === 'number' ? 'number' : f.type) + '" id="' + id + '" class="' + cls + '"' + req + ph + '>';
  }

  window.sysFieldRenderAll = function () {
    document.querySelectorAll('.ems-cf-slot').forEach(function (s) { s.innerHTML = ''; });
    document.querySelectorAll('.ems-cf-custom-wrap').forEach(function (w) { w.innerHTML = ''; });

    var fields = getFields().filter(function (f) { return f.enabled !== false; }).sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    });

    var customSections = {};

    fields.forEach(function (f) {
      if (f.section === 'custom' && f.sectionTitle) {
        var ck = f.form + '::' + f.sectionTitle;
        if (!customSections[ck]) customSections[ck] = { form: f.form, title: f.sectionTitle, fields: [] };
        customSections[ck].fields.push(f);
        return;
      }
      var slot = document.getElementById(slotId(f.form, f.section));
      if (!slot) return;
      var wrap = document.createElement('div');
      wrap.className = 'input-group ems-custom-field-group' + (f.width === 'full' ? ' form-grid-full' : '');
      wrap.setAttribute('data-field-id', f.id);
      if (f.type === 'checkbox') {
        wrap.innerHTML = buildInputHtml(f);
      } else {
        wrap.innerHTML = '<label>' + esc(f.label) + (f.required ? ' *' : '') + '</label>' + buildInputHtml(f);
      }
      slot.appendChild(wrap);
    });

    Object.keys(customSections).forEach(function (ck) {
      var block = customSections[ck];
      var panel = document.getElementById('reg-' + block.form + '-panel');
      if (!panel) return;
      var wrap = panel.querySelector('.ems-cf-custom-wrap');
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'ems-cf-custom-wrap';
        var terms = panel.querySelector('.terms-container');
        if (terms) panel.insertBefore(wrap, terms);
        else panel.appendChild(wrap);
      }
      var card = document.createElement('div');
      card.style.marginBottom = '20px';
      card.innerHTML = '<h3 style="color:var(--accent);margin-top:0;"><i class="fas fa-puzzle-piece"></i> ' + esc(block.title) + '</h3>' +
        '<div class="form-grid ems-cf-slot" style="background:#f0fdf4;padding:15px;border-radius:6px;border:1px solid #bbf7d0;" id="ems-cf-custom-' + slugify(block.title) + '"></div>';
      wrap.appendChild(card);
      var grid = card.querySelector('.form-grid');
      block.fields.forEach(function (f) {
        var ig = document.createElement('div');
        ig.className = 'input-group ems-custom-field-group' + (f.width === 'full' ? ' form-grid-full' : '');
        ig.innerHTML = '<label>' + esc(f.label) + (f.required ? ' *' : '') + '</label>' + buildInputHtml(f);
        grid.appendChild(ig);
      });
    });

    FORMS.forEach(function (fm) { window.sysFieldApplyVisibility(fm.id); });
  };

  window.sysFieldApplyVisibility = function (form) {
    var vis = getVisibility()[form] || {};
    Object.keys(vis).forEach(function (fieldId) {
      var el = document.getElementById(fieldId);
      if (!el) return;
      var group = el.closest('.input-group');
      if (group) group.style.display = vis[fieldId] === false ? 'none' : '';
    });
    getFields().filter(function (f) { return f.form === form && f.enabled === false; }).forEach(function (f) {
      var el = document.getElementById(fieldDomId(f.form, f.key));
      if (el) {
        var g = el.closest('.ems-custom-field-group');
        if (g) g.style.display = 'none';
      }
    });
  };

  window.sysFieldCollect = function (form) {
    var out = {};
    getFields().filter(function (f) { return f.form === form && f.enabled !== false; }).forEach(function (f) {
      var el = document.getElementById(fieldDomId(f.form, f.key));
      if (!el) return;
      out[f.key] = el.type === 'checkbox' ? el.checked : el.value;
      out[f.key + '_label'] = f.label;
    });
    return out;
  };

  window.sysFieldPopulate = function (form, user) {
    if (!user || !user.customFields) return;
    Object.keys(user.customFields).forEach(function (k) {
      if (k.indexOf('_label') !== -1) return;
      var el = document.getElementById(fieldDomId(form, k));
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!user.customFields[k];
      else el.value = user.customFields[k] == null ? '' : user.customFields[k];
    });
  };

  window.sysFieldClear = function (form) {
    getFields().filter(function (f) { return f.form === form; }).forEach(function (f) {
      var el = document.getElementById(fieldDomId(f.form, f.key));
      if (!el) return;
      if (el.type === 'checkbox') el.checked = false;
      else el.value = '';
    });
  };

  window.sysFieldSave = function () {
    if (typeof window.sysRequirePerm === 'function' && !window.sysRequirePerm('fields', 'edit')) return;
    var d = collectForm();
    if (!d.label) return toast('لیبل لکھیں', 'error');
    if (!d.key) d.key = slugify(d.label);
    var fields = getFields();
    var beforeFields = JSON.parse(JSON.stringify(fields));
    if (fields.some(function (x) { return x.form === d.form && x.key === d.key && x.id !== (document.getElementById('ecf-edit-id') || {}).value; })) {
      return toast('یہ key پہلے سے موجود', 'error');
    }
    var editId = (document.getElementById('ecf-edit-id') || {}).value;
    if (editId) {
      var idx = fields.findIndex(function (x) { return x.id === editId; });
      if (idx >= 0) fields[idx] = Object.assign({ id: editId, createdAt: fields[idx].createdAt }, d, { updatedAt: Date.now() });
      if (typeof window.sysAuditLog === 'function') window.sysAuditLog('update', 'custom_field', d.label, beforeFields, fields);
    } else {
      fields.push(Object.assign({ id: 'CFLD-' + Date.now(), createdAt: Date.now() }, d));
      if (typeof window.sysAuditLog === 'function') window.sysAuditLog('create', 'custom_field', d.label, beforeFields, fields);
    }
    writeJson(FIELDS_KEY, fields);
    window.sysFieldResetForm();
    window.sysFieldRenderAll();
    window.sysFieldRenderTable();
    toast('خانہ محفوظ', 'success');
  };

  window.sysFieldResetForm = function () {
    ['ecf-label', 'ecf-key', 'ecf-placeholder', 'ecf-options', 'ecf-section-title', 'ecf-edit-id'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    var defs = { 'ecf-type': 'text', 'ecf-form': 'student', 'ecf-section': 'personal', 'ecf-width': 'half', 'ecf-order': '50' };
    Object.keys(defs).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = defs[id];
    });
    ['ecf-required', 'ecf-enabled'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.checked = true;
    });
    window.sysFieldUpdateSectionOptions();
    window.sysFieldUpdatePreview();
  };

  window.sysFieldEdit = function (id) {
    var f = getFields().find(function (x) { return x.id === id; });
    if (!f) return;
    document.getElementById('ecf-edit-id').value = f.id;
    document.getElementById('ecf-label').value = f.label;
    document.getElementById('ecf-key').value = f.key;
    document.getElementById('ecf-type').value = f.type;
    document.getElementById('ecf-form').value = f.form;
    window.sysFieldUpdateSectionOptions();
    document.getElementById('ecf-section').value = f.section;
    document.getElementById('ecf-section-title').value = f.sectionTitle || '';
    document.getElementById('ecf-placeholder').value = f.placeholder || '';
    document.getElementById('ecf-width').value = f.width || 'half';
    document.getElementById('ecf-order').value = f.order || 50;
    document.getElementById('ecf-options').value = (f.options || []).join('، ');
    document.getElementById('ecf-required').checked = !!f.required;
    document.getElementById('ecf-enabled').checked = f.enabled !== false;
    window.sysFieldUpdatePreview();
    toast('ترمیم موڈ', 'warning');
  };

  window.sysFieldDelete = function (id) {
    if (!confirm('یہ خانہ حذف؟')) return;
    writeJson(FIELDS_KEY, getFields().filter(function (x) { return x.id !== id; }));
    window.sysFieldRenderAll();
    window.sysFieldRenderTable();
    toast('حذف', 'warning');
  };

  window.sysFieldToggle = function (id) {
    var fields = getFields();
    var f = fields.find(function (x) { return x.id === id; });
    if (!f) return;
    f.enabled = f.enabled === false;
    writeJson(FIELDS_KEY, fields);
    window.sysFieldRenderAll();
    window.sysFieldRenderTable();
  };

  window.sysFieldApplyPreset = function (idx) {
    var p = PRESETS[idx];
    if (!p) return;
    document.getElementById('ecf-label').value = p.label;
    document.getElementById('ecf-key').value = p.key;
    document.getElementById('ecf-type').value = p.type;
    document.getElementById('ecf-form').value = p.form;
    window.sysFieldUpdateSectionOptions();
    document.getElementById('ecf-section').value = p.section;
    document.getElementById('ecf-placeholder').value = p.placeholder || '';
    if (p.options) document.getElementById('ecf-options').value = p.options.join('، ');
    window.sysFieldUpdatePreview();
  };

  window.sysFieldUpdateSectionOptions = function () {
    var form = (document.getElementById('ecf-form') || {}).value || 'student';
    var sel = document.getElementById('ecf-section');
    if (!sel) return;
    var secs = SECTIONS[form] || SECTIONS.student;
    sel.innerHTML = secs.map(function (s) {
      return '<option value="' + s.id + '">' + s.label + '</option>';
    }).join('');
    var optBox = document.getElementById('ecf-options-wrap');
    var stBox = document.getElementById('ecf-section-title-wrap');
    var type = (document.getElementById('ecf-type') || {}).value;
    if (optBox) optBox.style.display = type === 'select' ? 'block' : 'none';
    if (stBox) stBox.style.display = sel.value === 'custom' ? 'block' : 'none';
  };

  window.sysFieldUpdatePreview = function () {
    var box = document.getElementById('ecf-preview');
    if (!box) return;
    var d = collectForm();
    if (!d.label && !document.getElementById('ecf-edit-id').value) {
      box.innerHTML = '<span style="color:#94a3b8;">preview یہاں...</span>';
      return;
    }
    var fake = Object.assign({ id: 'preview', form: d.form, key: d.key || 'preview' }, d);
    if (fake.type === 'checkbox') {
      box.innerHTML = buildInputHtml(fake);
    } else {
      box.innerHTML = '<label style="display:block;margin-bottom:6px;font-weight:bold;">' + esc(d.label || '—') + '</label>' + buildInputHtml(fake);
    }
  };

  window.sysFieldRenderTable = function () {
    var tbody = document.getElementById('ecf-list-tbody');
    if (!tbody) return;
    var fields = getFields();
    if (!fields.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">کوئی خانہ نہیں</td></tr>';
      return;
    }
    tbody.innerHTML = fields.map(function (f) {
      var formLbl = (FORMS.find(function (x) { return x.id === f.form; }) || {}).label || f.form;
      return '<tr><td>' + esc(f.label) + '<br><small style="color:#94a3b8;">' + esc(f.key) + '</small></td>' +
        '<td>' + formLbl + '</td><td>' + esc(f.type) + '</td><td style="font-size:11px;">' + esc(f.section) + '</td>' +
        '<td>' + (f.enabled !== false ? '<span class="sys-btn-status on">فعال</span>' : '<span class="sys-btn-status off">بند</span>') + '</td>' +
        '<td><button class="btn btn-sm btn-outline" onclick="window.sysFieldEdit(\'' + esc(f.id) + '\')"><i class="fas fa-edit"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="window.sysFieldToggle(\'' + esc(f.id) + '\')"><i class="fas fa-eye-slash"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="window.sysFieldDelete(\'' + esc(f.id) + '\')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  };

  window.sysFieldRenderBuiltinToggles = function () {
    var box = document.getElementById('ecf-builtin-grid');
    if (!box) return;
    var form = (document.getElementById('ecf-vis-form') || {}).value || 'student';
    var vis = getVisibility()[form] || {};
    var list = BUILTIN[form] || [];
    box.innerHTML = list.map(function (b) {
      var on = vis[b.id] !== false;
      return '<label class="sys-toggle-chip' + (on ? ' on' : '') + '"><input type="checkbox" data-builtin-id="' + esc(b.id) + '" ' + (on ? 'checked' : '') + '> ' + esc(b.label) + '</label>';
    }).join('') || '<p style="color:#94a3b8;">کوئی built-in فہرست نہیں</p>';
  };

  window.sysFieldSaveBuiltinVis = function () {
    if (typeof window.sysRequirePerm === 'function' && !window.sysRequirePerm('fields', 'edit')) return;
    var form = (document.getElementById('ecf-vis-form') || {}).value || 'student';
    var vis = getVisibility();
    var before = JSON.parse(JSON.stringify(vis));
    if (!vis[form]) vis[form] = {};
    document.querySelectorAll('#ecf-builtin-grid input[data-builtin-id]').forEach(function (inp) {
      vis[form][inp.getAttribute('data-builtin-id')] = inp.checked;
    });
    writeJson(VIS_KEY, vis);
    window.sysFieldApplyVisibility(form);
    if (typeof window.sysAuditLog === 'function') window.sysAuditLog('update', 'field_visibility', form, before, vis);
    toast('ظاہری ترتیب محفوظ', 'success');
  };

  window.sysFieldInitUI = function () {
    window.sysFieldUpdateSectionOptions();
    window.sysFieldRenderTable();
    window.sysFieldRenderBuiltinToggles();
    window.sysFieldUpdatePreview();
  };

  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest('#ecf-btn-save')) {
      e.preventDefault();
      window.sysFieldSave();
    }
    if (e.target && e.target.closest('#ecf-btn-save-vis')) {
      e.preventDefault();
      window.sysFieldSaveBuiltinVis();
    }
    if (e.target && e.target.closest('.ecf-preset-btn')) {
      e.preventDefault();
      window.sysFieldApplyPreset(parseInt(e.target.closest('.ecf-preset-btn').getAttribute('data-preset'), 10));
    }
  });

  document.addEventListener('change', function (e) {
    if (!e.target) return;
    if (['ecf-form', 'ecf-section', 'ecf-type'].indexOf(e.target.id) !== -1) window.sysFieldUpdateSectionOptions();
    if (e.target.id === 'ecf-vis-form') window.sysFieldRenderBuiltinToggles();
    if (e.target.closest('#sys-win-fields')) window.sysFieldUpdatePreview();
  });

  document.addEventListener('input', function (e) {
    if (e.target && e.target.closest('#sys-win-fields')) window.sysFieldUpdatePreview();
  });

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(window.sysFieldRenderAll, 1500);
  });

})();
