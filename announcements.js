// ================= شعبۂ اعلانات و فیصلے — Enterprise Communication Center =================
(function () {
  'use strict';

  var DB = {
    announcements: 'ems_announcements',
    categories: 'ems_ann_categories',
    programs: 'ems_ann_programs',
    templates: 'ems_ann_poster_templates',
    audit: 'ems_ann_audit_log',
    settings: 'ems_ann_settings',
    groups: 'ems_ann_groups'
  };

  var ANN_TYPES = [
    { id: 'general', name: 'عمومی' }, { id: 'emergency', name: 'ہنگامی' }, { id: 'admin', name: 'انتظامی' },
    { id: 'educational', name: 'تعلیمی' }, { id: 'exam', name: 'امتحانی' }, { id: 'financial', name: 'مالیاتی' },
    { id: 'program', name: 'پروگرام' }, { id: 'teachers', name: 'اساتذہ' }, { id: 'students', name: 'طلبہ' },
    { id: 'parents', name: 'والدین' }, { id: 'staff', name: 'عملہ' }
  ];

  var ANN_KINDS = [
    { id: 'announcement', name: 'اعلان' }, { id: 'decision', name: 'فیصلہ' }, { id: 'meeting', name: 'اجلاس کا فیصلہ' },
    { id: 'instruction', name: 'ہدایت' }, { id: 'circular', name: 'سرکلر' }, { id: 'advice', name: 'مشورہ' },
    { id: 'proposal', name: 'تجویز' }, { id: 'reminder', name: 'یاد دہانی' }, { id: 'urgent', name: 'فوری نوٹس' },
    { id: 'program', name: 'پروگرام اعلان' }, { id: 'campaign', name: 'خصوصی مہم' }
  ];

  var ANN_AUDIENCES = [
    { id: 'all', name: 'تمام مدرسہ' }, { id: 'students', name: 'تمام طلبہ' }, { id: 'teachers', name: 'تمام اساتذہ' },
    { id: 'staff', name: 'تمام ملازمین' }, { id: 'parents', name: 'تمام والدین' }, { id: 'class', name: 'مخصوص درجہ' },
    { id: 'dept', name: 'مخصوص شعبہ' }, { id: 'individual', name: 'مخصوص افراد' }, { id: 'group', name: 'مخصوص گروپ' }
  ];

  window._annArchivePage = 1;
  window._annAuditPage = 1;
  window._annVoiceRecorder = null;
  window._annVoiceChunks = [];
  window._annEditingId = null;
  window._annDesignState = null;
  window._annComposeAttachments = [];
  window._annArchivePageSize = 50;

  function emsSaveKey(key, val, opts) {
    var options = Object.assign({ mutation: true, autoDelta: true }, opts || {});
    if (window.emsSaveModuleData) return window.emsSaveModuleData(key, val, options);
    localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
    return Promise.resolve();
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || (fallback != null ? JSON.stringify(fallback) : '[]')); }
    catch (e) { return fallback != null ? fallback : []; }
  }

  function showToast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'success');
  }

  function annInitOptDeptFilter() {
    if (typeof window.emsMountOptionalDeptFilter === 'function') {
      window.emsMountOptionalDeptFilter('ann-opt-dept-filter', 'announcements', function () {
        window.annRenderDashboard();
        window.annRenderArchive();
      });
    }
  }

  function annGetDisplayList() {
    var list = window.annGetAnnouncements();
    if (typeof window.emsApplyOptionalDeptFilter === 'function') {
      return window.emsApplyOptionalDeptFilter(list, 'announcements');
    }
    return list;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  window.annActorName = function () {
    if (typeof window.emsGetStaffRecordForCurrentUser === 'function') {
      var st = window.emsGetStaffRecordForCurrentUser();
      if (st && st.name) return st.name;
    }
    if (firebase && firebase.auth && firebase.auth().currentUser) {
      return firebase.auth().currentUser.displayName || firebase.auth().currentUser.email || 'منتظم';
    }
    return 'منتظم';
  };

  window.annRequireAction = function (action) {
    return !(typeof window.emsRequireStaffAction === 'function') || window.emsRequireStaffAction('announcements', action);
  };

  window.annCanPublishDecisionDirectly = function () {
    return (typeof window.isSuperAdmin === 'function' && window.isSuperAdmin()) ||
      (typeof window.isMadrasaAdmin === 'function' && window.isMadrasaAdmin());
  };

  window.annResolvePublishStatus = function (kind, existingStatus) {
    if (kind === 'decision' && !window.annCanPublishDecisionDirectly()) return 'pending';
    if (existingStatus === 'pending' && kind === 'decision' && !window.annCanPublishDecisionDirectly()) return 'pending';
    return existingStatus || 'published';
  };

  window.annStatusLabel = function (status) {
    if (status === 'pending') return 'زیرِ منظوری';
    if (status === 'published') return 'شائع';
    return status || 'شائع';
  };

  window.annVoteTallyHtml = function (ann) {
    if (!ann || (ann.kind !== 'proposal' && ann.kind !== 'advice')) return '';
    var tally = ann.voteTally || { agree: 0, disagree: 0 };
    return '<span style="font-size:12px;color:#475569;">متفق: ' + (tally.agree || 0) +
      '، غیر متفق: ' + (tally.disagree || 0) + '</span>';
  };

  window.annNormalizeItem = function (item) {
    if (!item) return null;
    var aud = item.audience || 'all';
    if (aud === 'تمام مدرسہ' || aud === 'تمام مدرسہ (اساتذہ و طلبہ)') aud = 'all';
    else if (aud.indexOf('اساتذہ') >= 0 && aud.indexOf('طلب') >= 0) aud = 'staff';
    else if (aud.indexOf('والد') >= 0) aud = 'parents';
    else if (aud.indexOf('طلب') >= 0) aud = 'students';
    return {
      id: item.id,
      date: item.date || new Date().toISOString().slice(0, 10),
      type: item.type || 'general',
      kind: item.kind || 'announcement',
      category: item.category || 'اعلان',
      priority: item.priority || 'normal',
      audience: aud,
      audienceMeta: item.audienceMeta || {},
      title: item.title || '',
      details: item.details || '',
      keywords: item.keywords || [],
      programId: item.programId || '',
      speaker: item.speaker || '',
      status: item.status || 'published',
      approvedBy: item.approvedBy || '',
      approvedAt: item.approvedAt || null,
      voteTally: item.voteTally || { agree: 0, disagree: 0 },
      createdBy: item.createdBy || '—',
      updatedBy: item.updatedBy || item.createdBy || '—',
      createdAt: item.createdAt || item.timestamp || Date.now(),
      updatedAt: item.updatedAt || item.timestamp || Date.now(),
      timestamp: item.timestamp || Date.now(),
      versions: item.versions || [],
      attachments: item.attachments || [],
      voiceNote: item.voiceNote || null,
      posterId: item.posterId || null,
      sentLog: item.sentLog || [],
      departmentId: item.departmentId || ''
    };
  };

  window.annGetAnnouncements = function () {
    return readJson(DB.announcements, []).map(window.annNormalizeItem);
  };

  window.annSaveAnnouncements = function (list) {
    emsSaveKey(DB.announcements, JSON.stringify(list));
    emsSaveKey('ems_full_announcements', JSON.stringify(list));
  };

  window.annAuditSnapshot = function (obj) {
    if (obj == null) return null;
    try { return JSON.parse(JSON.stringify(obj)); } catch (e) { return obj; }
  };

  window.annAuditLog = function (action, entity, entityId, before, after, summary) {
    var logs = readJson(DB.audit, []);
    logs.push({
      id: (window.generateID ? window.generateID('AUD') : 'AUD-' + Date.now()),
      timestamp: Date.now(),
      userName: window.annActorName(),
      action: action,
      entity: entity,
      entityId: entityId || '',
      summary: summary || '',
      before: window.annAuditSnapshot(before),
      after: window.annAuditSnapshot(after)
    });
    if (logs.length > 5000) logs = logs.slice(-5000);
    emsSaveKey(DB.audit, JSON.stringify(logs));
  };

  window.annTypeName = function (id) {
    var t = ANN_TYPES.find(function (x) { return x.id === id; });
    return t ? t.name : id;
  };

  window.annKindName = function (id) {
    var k = ANN_KINDS.find(function (x) { return x.id === id; });
    return k ? k.name : id;
  };

  window.annAudienceName = function (id) {
    var a = ANN_AUDIENCES.find(function (x) { return x.id === id; });
    return a ? a.name : id;
  };

  window.annGetUsers = function () {
    if (typeof window.emsGetUsersSync === 'function') return window.emsGetUsersSync();
    if (typeof window.emsGetUsersMerged === 'function') return window.emsGetUsersMerged();
    return [];
  };

  window.annResolveRecipients = function (audience, meta) {
    meta = meta || {};
    var users = window.annGetUsers();
    var out = [];
    function add(u, role) {
      if (!u) return;
      var phone = (u.phone || u.whatsapp || u.mobile || '').replace(/\D/g, '');
      if (phone.length >= 10) phone = phone.replace(/^0+/, '');
      out.push({ id: u.id || u.rollNo || u.name, name: u.name || '—', phone: phone, role: role || u.role || '' });
    }
    if (audience === 'all') {
      users.forEach(function (u) { add(u, u.role); });
    } else if (audience === 'students') {
      users.filter(function (u) { return u.role === 'student' || u.type === 'student'; }).forEach(function (u) { add(u, 'student'); });
    } else if (audience === 'teachers') {
      users.filter(function (u) { return u.role === 'teacher' || u.type === 'teacher'; }).forEach(function (u) { add(u, 'teacher'); });
    } else if (audience === 'staff') {
      users.filter(function (u) { return u.role === 'staff' || u.type === 'staff' || u.role === 'teacher'; }).forEach(function (u) { add(u, 'staff'); });
    } else if (audience === 'parents') {
      users.filter(function (u) { return u.role === 'student' || u.type === 'student'; }).forEach(function (u) {
        if (u.fatherPhone || u.guardianPhone) add({ name: (u.name || '') + ' (ولی)', phone: u.fatherPhone || u.guardianPhone, id: u.id + '-p' }, 'parent');
      });
    } else if (audience === 'class' && meta.className) {
      users.filter(function (u) { return (u.class || u.className || '') === meta.className; }).forEach(function (u) { add(u, u.role); });
    } else if (audience === 'dept' && meta.dept) {
      users.filter(function (u) { return (u.department || u.dept || '') === meta.dept; }).forEach(function (u) { add(u, u.role); });
    } else if (audience === 'individual' && meta.ids && meta.ids.length) {
      meta.ids.forEach(function (id) {
        var u = users.find(function (x) { return x.id === id || x.rollNo === id; });
        if (u) add(u, u.role);
      });
    } else if (audience === 'group' && meta.groupId) {
      var groups = readJson(DB.groups, []);
      var g = groups.find(function (x) { return x.id === meta.groupId; });
      if (g && g.memberIds) g.memberIds.forEach(function (id) {
        var u = users.find(function (x) { return x.id === id; });
        if (u) add(u, u.role);
      });
    }
    var seen = {};
    return out.filter(function (r) {
      var k = r.phone + r.name;
      if (seen[k]) return false;
      seen[k] = true;
      return r.phone && r.phone.length >= 10;
    });
  };

  window.annWaLink = function (phone, text) {
    var p = String(phone || '').replace(/\D/g, '').replace(/^0+/, '');
    if (p.length === 10) p = '92' + p;
    else if (p.length === 11 && p[0] === '3') p = '92' + p;
    return 'https://wa.me/' + p + '?text=' + encodeURIComponent(text || '');
  };

  window.annSmsLink = function (phone, text) {
    var p = String(phone || '').replace(/\D/g, '').replace(/^0+/, '');
    if (p.length === 10) p = '0' + p;
    else if (p.length === 12 && p.indexOf('92') === 0) p = '0' + p.slice(2);
    var q = text ? '?body=' + encodeURIComponent(text) : '';
    return 'sms:' + p + q;
  };

  window.annGetArchivePageSize = function () {
    if (window._annArchivePageSize) return Number(window._annArchivePageSize);
    var s = readJson(DB.settings, {});
    return Number(s.archivePageSize) || 50;
  };

// =========================================================
  // دستاویزات (PDF / تصویر)
// =========================================================
  window.annRenderAttachList = function () {
    var el = document.getElementById('ann-attach-list');
    if (!el) return;
    var list = window._annComposeAttachments || [];
    if (!list.length) { el.innerHTML = '<small style="color:#94a3b8;">کوئی فائل نہیں</small>'; return; }
    el.innerHTML = list.map(function (a, i) {
      return '<div style="display:flex;align-items:center;gap:8px;margin:4px 0;padding:6px;background:#fff;border-radius:4px;border:1px solid #e2e8f0;">' +
        '<i class="fas fa-paperclip"></i> ' + a.name + ' <small>(' + Math.round((a.size || 0) / 1024) + ' KB)</small>' +
        ' <button type="button" class="btn btn-sm btn-outline" onclick="window.annPreviewComposeAttach(' + i + ')"><i class="fas fa-eye"></i></button>' +
        ' <button type="button" class="btn btn-sm btn-outline" onclick="window.annRemoveAttachment(' + i + ')"><i class="fas fa-times"></i></button></div>';
    }).join('');
  };

  window.annAddAttachments = function (input) {
    if (!input.files || !input.files.length) return;
    window._annComposeAttachments = window._annComposeAttachments || [];
    var total = window._annComposeAttachments.reduce(function (s, a) { return s + (a.size || 0); }, 0);
    Array.from(input.files).forEach(function (file) {
      if (total + file.size > 3 * 1024 * 1024) return showToast('3MB حد — چھوٹی فائلیں استعمال کریں', 'warning');
      var reader = new FileReader();
      reader.onload = function (e) {
        window._annComposeAttachments.push({
          id: window.generateID ? window.generateID('ATT') : 'ATT-' + Date.now(),
          name: file.name,
          type: file.type,
          size: file.size,
          data: e.target.result,
          addedAt: Date.now()
        });
        total += file.size;
        window.annRenderAttachList();
      };
      reader.readAsDataURL(file);
    });
    input.value = '';
  };

  window.annRemoveAttachment = function (idx) {
    window._annComposeAttachments.splice(idx, 1);
    window.annRenderAttachList();
  };

  window.annPreviewComposeAttach = function (idx) {
    var a = (window._annComposeAttachments || [])[idx];
    if (!a || !a.data) return;
    if (a.type === 'application/pdf') {
      window.open(a.data, '_blank');
    } else if (a.type.indexOf('image') >= 0) {
      var w = window.open('');
      if (w) w.document.write('<img src="' + a.data + '" style="max-width:100%">');
    } else {
      var link = document.createElement('a');
      link.href = a.data;
      link.download = a.name;
      link.click();
    }
  };

  window.annDownloadAttachment = function (annId, attachId) {
    var ann = window.annGetAnnouncements().find(function (a) { return a.id === annId; });
    if (!ann || !ann.attachments) return;
    var att = ann.attachments.find(function (x) { return x.id === attachId; });
    if (!att || !att.data) return showToast('فائل نہیں', 'error');
    var link = document.createElement('a');
    link.href = att.data;
    link.download = att.name || 'attachment';
    link.click();
  };

  window.annRenderPreviewAttachments = function (ann) {
    var wrap = document.getElementById('prt-ann-attachments');
    if (!wrap) return;
    if (!ann.attachments || !ann.attachments.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = '<strong>منسلکات:</strong> ' + ann.attachments.map(function (a) {
      return '<button class="btn btn-sm btn-outline" onclick="window.annDownloadAttachment(\'' + ann.id + '\',\'' + a.id + '\')"><i class="fas fa-download"></i> ' + a.name + '</button>';
    }).join(' ');
  };

  // =========================================================
  // وصول کنندہ گروپ
  // =========================================================
  window.annRenderGroupsUI = function () {
    var sel = document.getElementById('ann-grp-members');
    if (sel) {
      var users = window.annGetUsers();
      sel.innerHTML = users.slice(0, 300).map(function (u) {
        return '<option value="' + (u.id || u.rollNo) + '">' + (u.name || u.id) + '</option>';
      }).join('');
    }
    var list = document.getElementById('ann-groups-list');
    if (!list) return;
    var groups = readJson(DB.groups, []);
    if (!groups.length) { list.innerHTML = '<p style="color:#94a3b8;">کوئی گروپ نہیں</p>'; return; }
    list.innerHTML = groups.map(function (g, idx) {
      return '<div style="padding:10px;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">' +
        '<div><strong>' + g.name + '</strong><br><small>' + (g.memberIds || []).length + ' اراکین</small></div>' +
        '<div><button class="btn btn-sm btn-outline" onclick="window.annEditGroup(' + idx + ')"><i class="fas fa-edit"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="window.annDeleteGroup(' + idx + ')"><i class="fas fa-trash"></i></button></div></div>';
    }).join('');
  };

  window.annSaveGroup = function () {
    if (!window.annRequireAction('edit')) return;
    var name = document.getElementById('ann-grp-name') ? document.getElementById('ann-grp-name').value.trim() : '';
    var sel = document.getElementById('ann-grp-members');
    var ids = sel ? Array.from(sel.selectedOptions).map(function (o) { return o.value; }) : [];
    if (!name) return showToast('گروپ کا نام لکھیں', 'error');
    if (!ids.length) return showToast('کم از کم ایک رکن', 'error');
    var groups = readJson(DB.groups, []);
    var idx = window._annGrpEditIdx;
    if (idx != null && groups[idx]) {
      groups[idx].name = name;
      groups[idx].memberIds = ids;
      groups[idx].updatedAt = Date.now();
      window._annGrpEditIdx = null;
    } else {
      groups.push({
        id: window.generateID ? window.generateID('GRP') : 'GRP-' + Date.now(),
        name: name, memberIds: ids, createdAt: Date.now()
      });
    }
    emsSaveKey(DB.groups, JSON.stringify(groups));
    document.getElementById('ann-grp-name').value = '';
    if (sel) Array.from(sel.options).forEach(function (o) { o.selected = false; });
    window.annRenderGroupsUI();
    window.annUpdateAudienceMeta();
    showToast('گروپ محفوظ', 'success');
  };

  window.annEditGroup = function (idx) {
    var groups = readJson(DB.groups, []);
    var g = groups[idx];
    if (!g) return;
    window._annGrpEditIdx = idx;
    document.getElementById('ann-grp-name').value = g.name;
    var sel = document.getElementById('ann-grp-members');
    if (sel && g.memberIds) {
      Array.from(sel.options).forEach(function (o) { o.selected = g.memberIds.indexOf(o.value) >= 0; });
    }
  };

  window.annDeleteGroup = function (idx) {
    if (!confirm('گروپ حذف؟')) return;
    var groups = readJson(DB.groups, []);
    groups.splice(idx, 1);
    emsSaveKey(DB.groups, JSON.stringify(groups));
    window.annRenderGroupsUI();
  };

  window.annCreateProgramAnnouncement = function (prog) {
    if (!prog) return;
    var list = window.annGetAnnouncements();
    var actor = window.annActorName();
    var details = (prog.details || '') + '\n\n📅 تاریخ: ' + prog.date + '\n📍 مقام: ' + (prog.venue || '—') + '\n🏷 قسم: ' + (prog.type || '—');
    var existing = list.find(function (a) { return a.programId === prog.id; });
    if (existing) {
      var before = window.annAuditSnapshot(existing);
      existing.title = prog.name + ' — پروگرام اعلان';
      existing.details = details;
      existing.date = prog.date;
      existing.updatedAt = Date.now();
      existing.updatedBy = actor;
      window.annAuditLog('update', 'announcement', existing.id, before, existing, 'پروگرام سے اپڈیٹ');
    } else {
      var item = window.annNormalizeItem({
        id: window.generateID ? window.generateID('ANN') : 'ANN-' + Date.now(),
        date: prog.date, type: 'program', kind: 'program', category: 'پروگرام',
        priority: 'important', audience: 'all', title: prog.name + ' — پروگرام اعلان',
        details: details, programId: prog.id, createdBy: actor, updatedBy: actor,
        createdAt: Date.now(), updatedAt: Date.now(), timestamp: Date.now()
      });
      list.push(item);
      window.annAuditLog('create', 'announcement', item.id, null, item, item.title);
    }
    window.annSaveAnnouncements(list);
    window.annRenderDashboard();
    window.annRenderArchive();
  };

  window.annPublishProgramAnnouncement = function (idx) {
    var progs = readJson(DB.programs, []);
    if (!progs[idx]) return;
    window.annCreateProgramAnnouncement(progs[idx]);
    showToast('پروگرام اعلان شائع', 'success');
  };

  window.annBuildMessage = function (ann) {
    return '*اعلانات و فیصلے*\n\n*' + (ann.title || '') + '*\nتاریخ: ' + (ann.date || '') + '\nقسم: ' + window.annKindName(ann.kind) + ' / ' + window.annTypeName(ann.type) + '\nبرائے: ' + window.annAudienceName(ann.audience) + '\n\n' + (ann.details || '') + '\n\n— شعبۂ اعلانات';
  };

  // =========================================================
  // نیویگیشن
  // =========================================================
  window.switchAnnTab = function (tabId, btn) {
    if (typeof window.emsCloseAllModals === 'function') window.emsCloseAllModals();
    document.querySelectorAll('#module-announcements .ann-tab-content').forEach(function (el) { el.style.display = 'none'; });
    var panel = document.getElementById(tabId);
    if (panel) panel.style.display = 'block';
    document.querySelectorAll('#ann-ribbon-menu .reg-tab').forEach(function (b) { b.classList.remove('active-sub-tab'); });
    if (btn) btn.classList.add('active-sub-tab');
    if (tabId === 'ann-win-dashboard') window.annRenderDashboard();
    if (tabId === 'ann-win-archive') window.annRenderArchive();
    if (tabId === 'ann-win-messaging') window.annRenderMessaging();
    if (tabId === 'ann-win-programs') window.annRenderPrograms();
    if (tabId === 'ann-win-templates') window.annRenderTemplates();
    if (tabId === 'ann-win-audit') window.annRenderAuditLog();
    if (tabId === 'ann-win-print') window.annRenderPrintCenter();
    if (tabId === 'ann-win-designer') window.annInitDesigner();
    if (tabId === 'ann-win-settings') { window.annLoadSettingsForm(); window.annRenderGroupsUI(); }
  };

  window.refreshAnnData = function () {
    window.annInitModule();
  };

  window.annInitModule = function () {
    window.annLoadCategories();
    window.annPopulateSelects();
    window.annRenderDashboard();
    window.annRenderArchive();
    var d = document.getElementById('ann-date');
    if (d && !d.value) d.valueAsDate = new Date();
  };

  window.annPopulateSelects = function () {
    var typeEl = document.getElementById('ann-type');
    if (typeEl && !typeEl.options.length) {
      typeEl.innerHTML = ANN_TYPES.map(function (t) { return '<option value="' + t.id + '">' + t.name + '</option>'; }).join('');
    }
    var kindEl = document.getElementById('ann-kind');
    if (kindEl && !kindEl.options.length) {
      kindEl.innerHTML = ANN_KINDS.map(function (k) { return '<option value="' + k.id + '">' + k.name + '</option>'; }).join('');
    }
    var audEl = document.getElementById('ann-audience');
    if (audEl && audEl.options.length <= 3) {
      audEl.innerHTML = ANN_AUDIENCES.map(function (a) { return '<option value="' + a.id + '">' + a.name + '</option>'; }).join('');
    }
    var progSel = document.getElementById('ann-program-link');
    if (progSel) {
      var progs = readJson(DB.programs, []);
      progSel.innerHTML = '<option value="">— پروگرام —</option>' + progs.map(function (p) {
        return '<option value="' + p.id + '">' + p.name + '</option>';
      }).join('');
    }
    window.annUpdateAudienceMeta();
  };

  window.annUpdateAudienceMeta = function () {
    var aud = document.getElementById('ann-audience') ? document.getElementById('ann-audience').value : 'all';
    var wrap = document.getElementById('ann-audience-meta');
    if (!wrap) return;
    var users = window.annGetUsers();
    var classes = [];
    users.forEach(function (u) { if (u.class && classes.indexOf(u.class) < 0) classes.push(u.class); });
    var html = '';
    if (aud === 'class') {
      html = '<select id="ann-meta-class" class="input-control"><option value="">درجہ...</option>' +
        classes.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('') + '</select>';
    } else if (aud === 'dept') {
      html = '<input type="text" id="ann-meta-dept" class="input-control" placeholder="شعبہ کا نام">';
    } else if (aud === 'individual') {
      html = '<select id="ann-meta-individual" class="input-control" multiple size="4" style="height:auto;">' +
        users.slice(0, 200).map(function (u) {
          return '<option value="' + (u.id || u.rollNo) + '">' + (u.name || u.id) + '</option>';
        }).join('') + '</select><small style="color:#64748b;">Ctrl+کلک سے متعدد</small>';
    } else if (aud === 'group') {
      var groups = readJson(DB.groups, []);
      html = '<select id="ann-meta-group" class="input-control"><option value="">گروپ...</option>' +
        groups.map(function (g) { return '<option value="' + g.id + '">' + g.name + '</option>'; }).join('') + '</select>';
    }
    wrap.innerHTML = html;
    wrap.style.display = html ? 'block' : 'none';
  };

  window.annGetAudienceMeta = function () {
    var aud = document.getElementById('ann-audience') ? document.getElementById('ann-audience').value : 'all';
    var meta = {};
    if (aud === 'class') meta.className = document.getElementById('ann-meta-class') ? document.getElementById('ann-meta-class').value : '';
    if (aud === 'dept') meta.dept = document.getElementById('ann-meta-dept') ? document.getElementById('ann-meta-dept').value.trim() : '';
    if (aud === 'individual') {
      var sel = document.getElementById('ann-meta-individual');
      meta.ids = sel ? Array.from(sel.selectedOptions).map(function (o) { return o.value; }) : [];
    }
    if (aud === 'group') meta.groupId = document.getElementById('ann-meta-group') ? document.getElementById('ann-meta-group').value : '';
    return meta;
  };

  // =========================================================
  // ڈیش بورڈ
  // =========================================================
  window.annRenderDashboard = function () {
    var list = annGetDisplayList();
    var progs = readJson(DB.programs, []);
    var now = new Date();
    var monthStr = now.getFullYear() + '-' + pad2(now.getMonth() + 1);
    var monthCount = list.filter(function (a) { return (a.date || '').startsWith(monthStr); }).length;
    var urgent = list.filter(function (a) { return a.priority === 'urgent' || a.type === 'emergency'; }).length;
    var pendingDecisions = list.filter(function (a) { return a.kind === 'decision' && a.status === 'pending'; });
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.innerText = v; };
    set('ann-dash-total', list.length);
    set('ann-dash-month', monthCount);
    set('ann-dash-programs', progs.length);
    set('ann-dash-urgent', urgent);
    var pendingWrap = document.getElementById('ann-pending-queue');
    if (!pendingWrap) {
      var stripEl = document.getElementById('ann-stat-strip');
      if (stripEl && stripEl.parentNode) {
        pendingWrap = document.createElement('div');
        pendingWrap.id = 'ann-pending-queue';
        pendingWrap.style.margin = '0 0 16px';
        stripEl.parentNode.insertBefore(pendingWrap, stripEl.nextSibling);
      }
    }
    if (pendingWrap) {
      if (!pendingDecisions.length) {
        pendingWrap.innerHTML = '';
        pendingWrap.style.display = 'none';
      } else {
        pendingWrap.style.display = 'block';
        pendingWrap.innerHTML = '<div style="background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:12px 14px;">' +
          '<h3 style="margin:0 0 10px;font-size:15px;color:#c2410c;"><i class="fas fa-gavel"></i> زیرِ منظوری فیصلے (' + pendingDecisions.length + ')</h3>' +
          pendingDecisions.slice(0, 5).map(function (a) {
            return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid #ffedd5;">' +
              '<div><strong>' + a.title + '</strong><br><small style="color:#9a3412;">' + a.date + ' · ' + (a.createdBy || '—') + '</small></div>' +
              (window.annCanPublishDecisionDirectly()
                ? '<button class="btn btn-sm btn-success" onclick="window.annApproveDecision(\'' + a.id + '\')"><i class="fas fa-check"></i> منظور / شائع</button>'
                : '<span style="font-size:12px;color:#9a3412;">منتظم کی منظوری درکار</span>') +
              '</div>';
          }).join('') +
          (pendingDecisions.length > 5 ? '<small style="color:#9a3412;">+' + (pendingDecisions.length - 5) + ' مزید — آرکائیو میں دیکھیں</small>' : '') +
          '</div>';
      }
    }
    var strip = document.getElementById('ann-stat-strip');
    if (strip) {
      strip.innerHTML = ANN_KINDS.slice(0, 6).map(function (k) {
        var c = list.filter(function (a) { return a.kind === k.id; }).length;
        return '<div class="cmp-stat-chip"><span class="n">' + c + '</span><span class="l">' + k.name + '</span></div>';
      }).join('');
    }
    var recent = document.getElementById('ann-dash-recent');
    if (recent) {
      var top = list.slice().sort(function (a, b) { return b.timestamp - a.timestamp; }).slice(0, 8);
      recent.innerHTML = top.length ? top.map(function (a) {
        return '<div class="ann-recent-item" onclick="window.annPreview(\'' + a.id + '\')"><strong>' + a.title + '</strong><small>' + a.date + ' · ' + window.annKindName(a.kind) + '</small></div>';
      }).join('') : '<p style="color:#94a3b8;">کوئی اعلان نہیں</p>';
    }
  };

  // =========================================================
  // محفوظ / ترمیم
  // =========================================================
  window.annSaveAnnouncement = function () {
    if (!window.annRequireAction(window._annEditingId ? 'edit' : 'create')) return;
    var date = document.getElementById('ann-date') ? document.getElementById('ann-date').value : '';
    var type = document.getElementById('ann-type') ? document.getElementById('ann-type').value : 'general';
    var kind = document.getElementById('ann-kind') ? document.getElementById('ann-kind').value : 'announcement';
    var category = document.getElementById('ann-category') ? document.getElementById('ann-category').value : '';
    var priority = document.getElementById('ann-priority') ? document.getElementById('ann-priority').value : 'normal';
    var audience = document.getElementById('ann-audience') ? document.getElementById('ann-audience').value : 'all';
    var title = document.getElementById('ann-title') ? document.getElementById('ann-title').value.trim() : '';
    var details = document.getElementById('ann-details') ? document.getElementById('ann-details').value.trim() : '';
    var keywords = document.getElementById('ann-keywords') ? document.getElementById('ann-keywords').value.split(',').map(function (k) { return k.trim(); }).filter(Boolean) : [];
    var programId = document.getElementById('ann-program-link') ? document.getElementById('ann-program-link').value : '';
    var speaker = document.getElementById('ann-speaker') ? document.getElementById('ann-speaker').value.trim() : '';
    if (!date || !title || !details) return showToast('تاریخ، عنوان اور تفصیل لازمی', 'error');

    var list = window.annGetAnnouncements();
    var actor = window.annActorName();
    var meta = window.annGetAudienceMeta();
    var voiceEl = document.getElementById('ann-voice-data');
    var voiceNote = voiceEl ? voiceEl.value || null : null;
    var attachments = window._annComposeAttachments && window._annComposeAttachments.length
      ? window._annComposeAttachments.slice() : null;

    if (window._annEditingId) {
      var idx = list.findIndex(function (a) { return a.id === window._annEditingId; });
      if (idx >= 0) {
        var before = window.annAuditSnapshot(list[idx]);
        var prev = list[idx];
        prev.versions = prev.versions || [];
        prev.versions.push({ snapshot: window.annAuditSnapshot(prev), savedAt: Date.now(), savedBy: actor });
        if (prev.versions.length > 20) prev.versions = prev.versions.slice(-20);
        list[idx] = Object.assign(prev, {
          date: date, type: type, kind: kind, category: category, priority: priority,
          audience: audience, audienceMeta: meta, title: title, details: details,
          keywords: keywords, programId: programId, speaker: speaker, voiceNote: voiceNote || prev.voiceNote,
          attachments: attachments || prev.attachments || [],
          status: window.annResolvePublishStatus(kind, prev.status),
          updatedBy: actor, updatedAt: Date.now(), timestamp: Date.now()
        });
        window.annAuditLog('update', 'announcement', list[idx].id, before, list[idx], title);
        if (list[idx].status === 'pending' && kind === 'decision') {
          showToast('فیصلہ زیرِ منظوری محفوظ', 'info');
        } else {
          showToast('اعلان اپڈیٹ', 'success');
        }
      }
    } else {
      var item = window.annNormalizeItem({
        id: window.generateID ? window.generateID('ANN') : 'ANN-' + Date.now(),
        date: date, type: type, kind: kind, category: category, priority: priority,
        audience: audience, audienceMeta: meta, title: title, details: details,
        keywords: keywords, programId: programId, speaker: speaker, voiceNote: voiceNote,
        attachments: attachments || [],
        status: window.annResolvePublishStatus(kind, null),
        createdBy: actor, updatedBy: actor, createdAt: Date.now(), updatedAt: Date.now(), timestamp: Date.now()
      });
      if (audience === 'all') {
        item.departmentId = window.EMS_DEPARTMENT_ALL || 'all';
      } else if (typeof window.emsStampDepartment === 'function') {
        window.emsStampDepartment(item);
      }
      list.push(item);
      window.annAuditLog('create', 'announcement', item.id, null, item, title);
      if (item.status === 'pending' && kind === 'decision') {
        showToast('فیصلہ زیرِ منظوری بھیج دیا گیا', 'info');
      } else {
        showToast('اعلان شائع', 'success');
      }
      if (typeof window.updateMasterDashboard === 'function') window.updateMasterDashboard();
    }
    window.annSaveAnnouncements(list);
    window.annCancelEdit();
    window.annRenderArchive();
    window.annRenderDashboard();
  };

  window.annCancelEdit = function () {
    window._annEditingId = null;
    window._annComposeAttachments = [];
    window.annRenderAttachList();
    ['ann-title', 'ann-details', 'ann-keywords', 'ann-speaker', 'ann-edit-id', 'ann-voice-data'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    var vd = document.getElementById('ann-voice-player');
    if (vd) { vd.src = ''; vd.style.display = 'none'; }
    var d = document.getElementById('ann-date');
    if (d) d.valueAsDate = new Date();
    var lbl = document.getElementById('ann-compose-label');
    if (lbl) lbl.innerText = 'نیا اعلان / فیصلہ';
    var btn = document.getElementById('btn-save-ann');
    if (btn) btn.innerHTML = '<i class="fas fa-save"></i> شائع کریں';
    var cancel = document.getElementById('btn-cancel-ann-edit');
    if (cancel) cancel.style.display = 'none';
  };

  window.annEditAnnouncement = function (id) {
    if (!window.annRequireAction('edit')) return;
    var ann = window.annGetAnnouncements().find(function (a) { return a.id === id; });
    if (!ann) return;
    window._annEditingId = id;
    switchAnnTab('ann-win-compose', document.querySelector('#ann-ribbon-menu [onclick*=compose]'));
    document.getElementById('ann-date').value = ann.date;
    document.getElementById('ann-type').value = ann.type;
    document.getElementById('ann-kind').value = ann.kind;
    document.getElementById('ann-category').value = ann.category;
    document.getElementById('ann-priority').value = ann.priority || 'normal';
    document.getElementById('ann-audience').value = ann.audience;
    window.annUpdateAudienceMeta();
    var meta = ann.audienceMeta || {};
    if (meta.className && document.getElementById('ann-meta-class')) document.getElementById('ann-meta-class').value = meta.className;
    if (meta.dept && document.getElementById('ann-meta-dept')) document.getElementById('ann-meta-dept').value = meta.dept;
    if (meta.groupId && document.getElementById('ann-meta-group')) document.getElementById('ann-meta-group').value = meta.groupId;
    document.getElementById('ann-title').value = ann.title;
    document.getElementById('ann-details').value = ann.details;
    document.getElementById('ann-keywords').value = (ann.keywords || []).join(', ');
    document.getElementById('ann-speaker').value = ann.speaker || '';
    if (document.getElementById('ann-program-link')) document.getElementById('ann-program-link').value = ann.programId || '';
    if (ann.voiceNote) {
      var vp = document.getElementById('ann-voice-player');
      var vd = document.getElementById('ann-voice-data');
      if (vp) { vp.src = ann.voiceNote; vp.style.display = 'block'; }
      if (vd) vd.value = ann.voiceNote;
    }
    window._annComposeAttachments = (ann.attachments || []).slice();
    window.annRenderAttachList();
    var lbl = document.getElementById('ann-compose-label');
    if (lbl) lbl.innerText = 'ترمیم: ' + ann.title;
    document.getElementById('btn-save-ann').innerHTML = '<i class="fas fa-sync"></i> اپڈیٹ';
    document.getElementById('btn-cancel-ann-edit').style.display = 'inline-flex';
  };

  window.annApproveDecision = function (id) {
    if (!window.annCanPublishDecisionDirectly()) {
      return showToast('صرف منتظم / مہتمم فیصلے منظور کر سکتے ہیں', 'error');
    }
    var list = window.annGetAnnouncements();
    var idx = list.findIndex(function (a) { return a.id === id; });
    if (idx < 0) return showToast('فیصلہ نہیں ملا', 'error');
    var ann = list[idx];
    if (ann.kind !== 'decision') return showToast('یہ اعلان فیصلہ نہیں ہے', 'error');
    if (ann.status === 'published') return showToast('پہلے ہی شائع ہے', 'info');
    var before = window.annAuditSnapshot(ann);
    var actor = window.annActorName();
    ann.status = 'published';
    ann.approvedBy = actor;
    ann.approvedAt = Date.now();
    ann.updatedBy = actor;
    ann.updatedAt = Date.now();
    ann.timestamp = Date.now();
    list[idx] = ann;
    window.annAuditLog('approve', 'announcement', ann.id, before, ann, ann.title);
    window.annSaveAnnouncements(list);
    window.annRenderArchive();
    window.annRenderDashboard();
    showToast('فیصلہ منظور اور شائع ہو گیا', 'success');
  };

  window.annDeleteAnnouncement = function (id) {
    if (!window.annRequireAction('delete')) return;
    if (!confirm('یہ اعلان حذف کریں؟')) return;
    var list = window.annGetAnnouncements();
    var removed = list.find(function (a) { return a.id === id; });
    list = list.filter(function (a) { return a.id !== id; });
    window.annSaveAnnouncements(list);
    window.annAuditLog('delete', 'announcement', id, removed, null, removed ? removed.title : '');
    window.annRenderArchive();
    window.annRenderDashboard();
    showToast('حذف', 'warning');
  };

  // =========================================================
  // آرکائیو
  // =========================================================
  window.annRenderArchive = function (page) {
    if (page) window._annArchivePage = page;
    var tbody = document.querySelector('#table-announcements tbody');
    if (!tbody) return;
    var q = (document.getElementById('ann-search') ? document.getElementById('ann-search').value : '').toLowerCase().trim();
    var typeF = document.getElementById('ann-filter-type') ? document.getElementById('ann-filter-type').value : '';
    var kindF = document.getElementById('ann-filter-kind') ? document.getElementById('ann-filter-kind').value : '';
    var fromD = document.getElementById('ann-filter-from') ? document.getElementById('ann-filter-from').value : '';
    var toD = document.getElementById('ann-filter-to') ? document.getElementById('ann-filter-to').value : '';
    var list = annGetDisplayList();
    if (q) list = list.filter(function (a) {
      return (a.title + ' ' + a.details + ' ' + (a.keywords || []).join(' ') + ' ' + a.speaker).toLowerCase().indexOf(q) >= 0;
    });
    if (typeF) list = list.filter(function (a) { return a.type === typeF; });
    if (kindF) list = list.filter(function (a) { return a.kind === kindF; });
    if (fromD) list = list.filter(function (a) { return (a.date || '') >= fromD; });
    if (toD) list = list.filter(function (a) { return (a.date || '') <= toD; });
    list.sort(function (a, b) { return b.timestamp - a.timestamp; });
    var ps = window.annGetArchivePageSize();
    var pages = Math.max(1, Math.ceil(list.length / ps));
    if (window._annArchivePage > pages) window._annArchivePage = pages;
    var slice = list.slice((window._annArchivePage - 1) * ps, window._annArchivePage * ps);
    var pg = document.getElementById('ann-archive-pager');
    if (pg) {
      pg.innerHTML = list.length ? '<span class="reg-pg-info">' + list.length + ' ریکارڈ — صفحہ ' + window._annArchivePage + '/' + pages + ' (' + ps + '/صفحہ)</span> ' +
        (window._annArchivePage > 1 ? '<button class="btn btn-sm btn-outline" onclick="window.annRenderArchive(' + (window._annArchivePage - 1) + ')">پچھلا</button> ' : '') +
        (window._annArchivePage < pages ? '<button class="btn btn-sm btn-outline" onclick="window.annRenderArchive(' + (window._annArchivePage + 1) + ')">اگلا</button> ' : '') +
        '<select class="input-control input-sm" style="width:auto;margin-right:8px;" onchange="window._annArchivePageSize=+this.value;window._annArchivePage=1;window.annRenderArchive()"><option value="25"' + (ps === 25 ? ' selected' : '') + '>25</option><option value="50"' + (ps === 50 ? ' selected' : '') + '>50</option><option value="100"' + (ps === 100 ? ' selected' : '') + '>100</option></select>' : '';
    }
    if (!slice.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">کوئی ریکارڈ نہیں</td></tr>'; return; }
    tbody.innerHTML = slice.map(function (ann) {
      var pri = ann.priority === 'urgent' ? '<span style="color:#dc2626;">●</span> ' : '';
      var statusBadge = ann.status === 'pending'
        ? ' <span style="font-size:10px;background:#ffedd5;color:#c2410c;padding:2px 6px;border-radius:4px;">زیرِ منظوری</span>' : '';
      var voteLine = (ann.kind === 'proposal' || ann.kind === 'advice') ? '<br>' + window.annVoteTallyHtml(ann) : '';
      var approveBtn = (ann.kind === 'decision' && ann.status === 'pending' && window.annCanPublishDecisionDirectly())
        ? '<button class="btn btn-sm btn-success" onclick="window.annApproveDecision(\'' + ann.id + '\')" title="منظور"><i class="fas fa-check"></i></button> '
        : '';
      return '<tr><td>' + ann.date + '</td><td>' + pri + '<strong>' + ann.title + '</strong>' + statusBadge +
        '<br><small>' + window.annKindName(ann.kind) + ' · ' + window.annTypeName(ann.type) + '</small>' + voteLine + '</td>' +
        '<td>' + window.annAudienceName(ann.audience) + '</td><td>' + (ann.createdBy || '—') + '</td><td>' +
        approveBtn +
        '<button class="icon-btn edit" onclick="window.annEditAnnouncement(\'' + ann.id + '\')" title="ترمیم"><i class="fas fa-edit"></i></button>' +
        '<button class="icon-btn delete" onclick="window.annDeleteAnnouncement(\'' + ann.id + '\')" title="حذف"><i class="fas fa-trash"></i></button>' +
        '<button class="btn btn-outline btn-icon-only" onclick="window.annPreview(\'' + ann.id + '\')" title="پری ویو"><i class="fas fa-eye"></i></button>' +
        '<button class="btn btn-outline btn-icon-only" onclick="window.annShareWA(\'' + ann.id + '\')" title="واٹس ایپ"><i class="fab fa-whatsapp" style="color:green;"></i></button>' +
        '<button class="btn btn-outline btn-icon-only" onclick="window.annDownloadPDF(\'' + ann.id + '\')" title="PDF"><i class="fas fa-file-pdf" style="color:#dc2626;"></i></button>' +
        (ann.voiceNote ? '<button class="btn btn-outline btn-icon-only" onclick="window.annShareVoiceWA(\'' + ann.id + '\')" title="صوتی+WA"><i class="fas fa-microphone" style="color:#7c3aed;"></i></button>' : '') +
        ((ann.attachments && ann.attachments.length) ? '<button class="btn btn-outline btn-icon-only" onclick="window.annPreview(\'' + ann.id + '\')" title="' + ann.attachments.length + ' فائل"><i class="fas fa-paperclip"></i></button>' : '') +
        '</td></tr>';
    }).join('');
  };

  window.annClearArchiveFilters = function () {
    ['ann-search', 'ann-filter-from', 'ann-filter-to'].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });
    ['ann-filter-type', 'ann-filter-kind'].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });
    window._annArchivePage = 1;
    window.annRenderArchive();
  };

  // =========================================================
  // پری ویو / پرنٹ / PDF
  // =========================================================
  window.currentAnnPreviewId = null;

  window.annPreview = function (id) {
    var ann = window.annGetAnnouncements().find(function (a) { return a.id === id; });
    if (!ann) return;
    window.currentAnnPreviewId = id;
    var brand = document.getElementById('ann-print-brand');
    if (brand && typeof window.attBrandHeaderHTML === 'function') brand.innerHTML = window.attBrandHeaderHTML();
    document.getElementById('prt-ann-ref').innerText = ann.id;
    document.getElementById('prt-ann-date').innerText = ann.date;
    document.getElementById('prt-ann-title').innerText = ann.title;
    document.getElementById('prt-ann-meta').innerText = window.annKindName(ann.kind) + ' · ' + window.annTypeName(ann.type) + ' · ' + window.annAudienceName(ann.audience) +
      (ann.status === 'pending' ? ' · زیرِ منظوری' : '');
    document.getElementById('prt-ann-audience').innerText = window.annAudienceName(ann.audience);
    document.getElementById('prt-ann-details').innerText = ann.details;
    var sp = document.getElementById('prt-ann-speaker');
    if (sp) sp.innerText = ann.speaker ? 'مقرر: ' + ann.speaker : '';
    var voteEl = document.getElementById('prt-ann-votes');
    if (!voteEl) {
      voteEl = document.createElement('div');
      voteEl.id = 'prt-ann-votes';
      voteEl.style.margin = '10px 0';
      if (sp && sp.parentNode) sp.parentNode.insertBefore(voteEl, sp.nextSibling);
    }
    if (ann.kind === 'proposal' || ann.kind === 'advice') {
      voteEl.innerHTML = '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;">' +
        '<strong style="color:#15803d;"><i class="fas fa-poll"></i> رائے شماری:</strong> ' + window.annVoteTallyHtml(ann) + '</div>';
      voteEl.style.display = 'block';
    } else {
      voteEl.innerHTML = '';
      voteEl.style.display = 'none';
    }
    var approveEl = document.getElementById('prt-ann-approve');
    if (!approveEl) {
      var wrap = document.getElementById('ann-preview-wrapper');
      var toolbar = wrap ? wrap.querySelector('div[style*="eef2f6"]') : null;
      if (toolbar) {
        approveEl = document.createElement('button');
        approveEl.id = 'prt-ann-approve';
        approveEl.className = 'btn btn-success';
        approveEl.style.display = 'none';
        approveEl.innerHTML = '<i class="fas fa-check"></i> فیصلہ منظور';
        approveEl.onclick = function () {
          if (window.currentAnnPreviewId) window.annApproveDecision(window.currentAnnPreviewId);
        };
        toolbar.insertBefore(approveEl, toolbar.children[1] || null);
      }
    }
    if (approveEl) {
      if (ann.kind === 'decision' && ann.status === 'pending' && window.annCanPublishDecisionDirectly()) {
        approveEl.style.display = 'inline-flex';
      } else {
        approveEl.style.display = 'none';
      }
    }
    var vp = document.getElementById('prt-ann-voice');
    if (vp) {
      if (ann.voiceNote) { vp.innerHTML = '<audio controls src="' + ann.voiceNote + '" style="width:100%;margin:10px 0;"></audio>'; vp.style.display = 'block'; }
      else { vp.innerHTML = ''; vp.style.display = 'none'; }
    }
    window.annRenderPreviewAttachments(ann);
    var wrap = document.getElementById('ann-preview-wrapper');
    if (wrap) { wrap.style.display = 'block'; wrap.scrollIntoView({ behavior: 'smooth' }); }
  };

  window.editFromPreview = function () {
    if (window.currentAnnPreviewId) {
      window.annEditAnnouncement(window.currentAnnPreviewId);
      document.getElementById('ann-preview-wrapper').style.display = 'none';
    }
  };

  window.deleteFromPreview = function () {
    if (window.currentAnnPreviewId) {
      window.annDeleteAnnouncement(window.currentAnnPreviewId);
      document.getElementById('ann-preview-wrapper').style.display = 'none';
    }
  };

  window.previewAnnouncement = window.annPreview;
  window.editAnnouncement = window.annEditAnnouncement;
  window.deleteAnnouncement = window.annDeleteAnnouncement;
  window.cancelAnnEdit = window.annCancelEdit;
  window.renderAnnouncementsTable = function (term) {
    if (term != null && document.getElementById('ann-search')) document.getElementById('ann-search').value = term;
    window.annRenderArchive(1);
  };

  window.annPrint = function (colorMode, sizeClass) {
    var area = document.getElementById('ann-printable-area');
    if (!area) return;
    area.className = 'ann-print-area ' + (sizeClass || 'ann-size-a4') + (colorMode === 'bw' ? ' ann-print-bw' : '');
    if (typeof window.printDiv === 'function') window.printDiv('ann-printable-area');
    else window.print();
    showToast('پرنٹ', 'info');
  };

  window.annDownloadPDF = function (id) {
    if (id) window.annPreview(id);
    setTimeout(function () {
      if (typeof window.finDownloadPDF === 'function') window.finDownloadPDF('ann-printable-area', 'announcement-' + (window.currentAnnPreviewId || 'doc') + '.pdf');
      else if (typeof window.printDiv === 'function') { window.printDiv('ann-printable-area'); showToast('PDF لائبریری نہیں — پرنٹ', 'warning'); }
    }, 400);
  };

  window.annShareWA = function (id) {
    var ann = window.annGetAnnouncements().find(function (a) { return a.id === id; });
    if (!ann) return;
    window.open('https://wa.me/?text=' + encodeURIComponent(window.annBuildMessage(ann)), '_blank');
  };

  window.annShareVoiceWA = function (id) {
    var ann = window.annGetAnnouncements().find(function (a) { return a.id === id; });
    if (!ann) return;
    if (ann.voiceNote) {
      var link = document.createElement('a');
      link.href = ann.voiceNote;
      link.download = 'voice-' + ann.id + '.webm';
      link.click();
    }
    window.annShareWA(id);
    showToast('صوتی فائل ڈاؤنلوڈ — WA میں منسلک کریں', 'info');
  };

  window.shareAnnouncementWA = window.annShareWA;

  window.annShareWAPdf = function (id) {
    window.annDownloadPDF(id);
    showToast('PDF ڈاؤنلوڈ — واٹس ایپ میں فائل منسلک کریں', 'info');
  };

  // =========================================================
  // پیغام رسانی
  // =========================================================
  window.annRenderMessaging = function () {
    var sel = document.getElementById('ann-msg-announcement');
    if (sel) {
      var list = window.annGetAnnouncements();
      sel.innerHTML = '<option value="">— اعلان منتخب —</option>' + list.map(function (a) {
        return '<option value="' + a.id + '">' + a.title + '</option>';
      }).join('');
    }
    window.annUpdateMsgRecipients();
  };

  window.annUpdateMsgRecipients = function () {
    var annId = document.getElementById('ann-msg-announcement') ? document.getElementById('ann-msg-announcement').value : '';
    var aud = document.getElementById('ann-msg-audience') ? document.getElementById('ann-msg-audience').value : 'all';
    var meta = {};
    var ann = null;
    if (annId) {
      ann = window.annGetAnnouncements().find(function (a) { return a.id === annId; });
      if (ann) { aud = ann.audience; meta = ann.audienceMeta || {}; }
    } else if (aud === 'class') meta.className = document.getElementById('ann-msg-class') ? document.getElementById('ann-msg-class').value : '';
    var rec = window.annResolveRecipients(aud, meta);
    var tbody = document.getElementById('ann-msg-recipients-tbody');
    if (!tbody) return;
    if (!rec.length) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">فون نمبر والے وصول کنندہ نہیں — رجسٹریشن میں نمبر درج کریں</td></tr>'; return; }
    var msg = ann ? window.annBuildMessage(ann) : (document.getElementById('ann-msg-custom') ? document.getElementById('ann-msg-custom').value : '');
    window._annMsgText = msg;
    tbody.innerHTML = rec.slice(0, 100).map(function (r) {
      return '<tr><td>' + r.name + '</td><td>' + r.phone + '</td><td>' + (r.role || '—') + '</td><td>' +
        '<button class="btn btn-sm btn-success" onclick="window.annOpenRecipientWA(\'' + r.phone + '\')" title="WA"><i class="fab fa-whatsapp"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="window.annOpenRecipientSMS(\'' + r.phone + '\')" title="SMS"><i class="fas fa-sms"></i></button></td></tr>';
    }).join('');
    if (rec.length > 100) tbody.innerHTML += '<tr><td colspan="4" style="text-align:center;color:#64748b;">+' + (rec.length - 100) + ' مزید...</td></tr>';
    var info = document.getElementById('ann-msg-count');
    if (info) info.innerText = rec.length + ' وصول کنندہ';
  };

  window.annOpenRecipientWA = function (phone) {
    var msg = window._annMsgText || '';
    window.open(window.annWaLink(phone, msg), '_blank');
  };

  window.annOpenRecipientSMS = function (phone) {
    var msg = window._annMsgText || '';
    window.open(window.annSmsLink(phone, msg), '_blank');
  };

  window.annSendBulkSMS = function () {
    var annId = document.getElementById('ann-msg-announcement') ? document.getElementById('ann-msg-announcement').value : '';
    var ann = annId ? window.annGetAnnouncements().find(function (a) { return a.id === annId; }) : null;
    var aud = ann ? ann.audience : (document.getElementById('ann-msg-audience') ? document.getElementById('ann-msg-audience').value : 'all');
    var meta = ann ? (ann.audienceMeta || {}) : {};
    var rec = window.annResolveRecipients(aud, meta);
    if (!rec.length) return showToast('کوئی وصول کنندہ نہیں', 'error');
    var msg = ann ? window.annBuildMessage(ann) : (document.getElementById('ann-msg-custom') ? document.getElementById('ann-msg-custom').value : '');
    rec.slice(0, 10).forEach(function (r, i) {
      setTimeout(function () { window.open(window.annSmsLink(r.phone, msg), '_blank'); }, i * 600);
    });
    if (ann) {
      ann.sentLog = ann.sentLog || [];
      ann.sentLog.push({ at: Date.now(), by: window.annActorName(), count: rec.length, channel: 'sms' });
      var list = window.annGetAnnouncements();
      var idx = list.findIndex(function (a) { return a.id === annId; });
      if (idx >= 0) { list[idx] = ann; window.annSaveAnnouncements(list); }
    }
    showToast('SMS — پہلے ' + Math.min(10, rec.length) + ' وصول کنندگان', 'success');
  };

  window.annSendBulkWA = function () {
    var annId = document.getElementById('ann-msg-announcement') ? document.getElementById('ann-msg-announcement').value : '';
    if (!annId) return showToast('اعلان منتخب کریں', 'error');
    var ann = window.annGetAnnouncements().find(function (a) { return a.id === annId; });
    if (!ann) return;
    var rec = window.annResolveRecipients(ann.audience, ann.audienceMeta || {});
    if (!rec.length) return showToast('کوئی وصول کنندہ نہیں', 'error');
    var msg = window.annBuildMessage(ann);
    rec.slice(0, 15).forEach(function (r, i) {
      setTimeout(function () { window.open(window.annWaLink(r.phone, msg), '_blank'); }, i * 800);
    });
    ann.sentLog = ann.sentLog || [];
    ann.sentLog.push({ at: Date.now(), by: window.annActorName(), count: rec.length, channel: 'whatsapp' });
    var list = window.annGetAnnouncements();
    var idx = list.findIndex(function (a) { return a.id === annId; });
    if (idx >= 0) { list[idx] = ann; window.annSaveAnnouncements(list); }
    showToast(rec.length + ' وصول کنندگان — پہلے 15 ٹیب کھولے', 'success');
  };

  // =========================================================
  // پروگرام / تقریبات
  // =========================================================
  window.annRenderPrograms = function () {
    var tbody = document.getElementById('ann-programs-tbody');
    if (!tbody) return;
    var progs = readJson(DB.programs, []);
    if (!progs.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">کوئی پروگرام نہیں</td></tr>'; return; }
    tbody.innerHTML = progs.map(function (p, idx) {
      return '<tr><td>' + p.date + '</td><td><strong>' + p.name + '</strong></td><td>' + (p.type || '—') + '</td><td>' + (p.venue || '—') + '</td><td>' + (p.status || 'منصوبہ') + '</td><td>' +
        '<button class="btn btn-sm btn-success" onclick="window.annPublishProgramAnnouncement(' + idx + ')" title="اعلان"><i class="fas fa-bullhorn"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="window.annEditProgram(' + idx + ')"><i class="fas fa-edit"></i></button> ' +
        '<button class="btn btn-sm btn-outline" onclick="window.annDeleteProgram(' + idx + ')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  };

  window.annSaveProgram = function () {
    if (!window.annRequireAction('create')) return;
    var name = document.getElementById('ann-prog-name') ? document.getElementById('ann-prog-name').value.trim() : '';
    var date = document.getElementById('ann-prog-date') ? document.getElementById('ann-prog-date').value : '';
    var type = document.getElementById('ann-prog-type') ? document.getElementById('ann-prog-type').value : '';
    var venue = document.getElementById('ann-prog-venue') ? document.getElementById('ann-prog-venue').value.trim() : '';
    var details = document.getElementById('ann-prog-details') ? document.getElementById('ann-prog-details').value.trim() : '';
    if (!name || !date) return showToast('نام اور تاریخ لازمی', 'error');
    var progs = readJson(DB.programs, []);
    var idx = window._annProgEditIdx;
    if (idx != null && progs[idx]) {
      var before = window.annAuditSnapshot(progs[idx]);
      progs[idx] = Object.assign(progs[idx], { name: name, date: date, type: type, venue: venue, details: details, updatedAt: Date.now() });
      window.annAuditLog('update', 'program', progs[idx].id, before, progs[idx], name);
      window._annProgEditIdx = null;
    } else {
      var item = { id: window.generateID ? window.generateID('PRG') : 'PRG-' + Date.now(), name: name, date: date, type: type, venue: venue, details: details, status: 'منصوبہ', createdAt: Date.now() };
      progs.push(item);
      window.annAuditLog('create', 'program', item.id, null, item, name);
    }
    emsSaveKey(DB.programs, JSON.stringify(progs));
    ['ann-prog-name', 'ann-prog-venue', 'ann-prog-details'].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });
    var saved = idx != null ? progs[idx] : progs[progs.length - 1];
    if (document.getElementById('ann-prog-auto-ann') && document.getElementById('ann-prog-auto-ann').checked && saved) {
      window.annCreateProgramAnnouncement(saved);
    }
    window.annRenderPrograms();
    window.annPopulateSelects();
    showToast('پروگرام محفوظ', 'success');
  };

  window.annEditProgram = function (idx) {
    var progs = readJson(DB.programs, []);
    var p = progs[idx];
    if (!p) return;
    window._annProgEditIdx = idx;
    document.getElementById('ann-prog-name').value = p.name;
    document.getElementById('ann-prog-date').value = p.date;
    document.getElementById('ann-prog-type').value = p.type || '';
    document.getElementById('ann-prog-venue').value = p.venue || '';
    document.getElementById('ann-prog-details').value = p.details || '';
  };

  window.annDeleteProgram = function (idx) {
    if (!window.annRequireAction('delete')) return;
    if (!confirm('پروگرام حذف؟')) return;
    var progs = readJson(DB.programs, []);
    var removed = progs[idx];
    progs.splice(idx, 1);
    emsSaveKey(DB.programs, JSON.stringify(progs));
    window.annAuditLog('delete', 'program', removed ? removed.id : '', removed, null, removed ? removed.name : '');
    window.annRenderPrograms();
  };

  // =========================================================
  // پوسٹر ڈیزائنر
  // =========================================================
  window.annInitDesigner = function () {
    if (!window._annDesignState) window._annDesignState = {
      bg: '#1e3a5f', titleColor: '#ffffff', bodyColor: '#e2e8f0', font: 'Noto Nastaliq Urdu', titleSize: 32, bodySize: 18, border: 'double'
    };
    window.annApplyDesignState();
  };

  window.annApplyDesignState = function () {
    var s = window._annDesignState;
    var canvas = document.getElementById('ann-design-canvas');
    if (!canvas || !s) return;
    canvas.style.background = s.bg;
    canvas.style.fontFamily = s.font;
    canvas.style.borderStyle = s.border === 'none' ? 'none' : (s.border === 'dashed' ? 'dashed' : 'double');
    var t = document.getElementById('ann-design-title');
    var b = document.getElementById('ann-design-body');
    if (t) { t.style.color = s.titleColor; t.style.fontSize = s.titleSize + 'px'; }
    if (b) { b.style.color = s.bodyColor; b.style.fontSize = s.bodySize + 'px'; }
    var logo = document.getElementById('ann-design-logo');
    if (logo && s.logoData) { logo.src = s.logoData; logo.style.display = 'block'; }
  };

  window.annDesignControl = function (prop, val) {
    if (!window._annDesignState) window.annInitDesigner();
    window._annDesignState[prop] = val;
    window.annApplyDesignState();
  };

  window.annDesignAddLogo = function (input) {
    if (!input.files || !input.files[0]) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      window._annDesignState.logoData = e.target.result;
      window.annApplyDesignState();
    };
    reader.readAsDataURL(input.files[0]);
    input.value = '';
  };

  window.annDesignAddImage = function (input) {
    if (!input.files || !input.files[0]) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = document.createElement('img');
      img.src = e.target.result;
      img.style.maxWidth = '100%';
      img.style.margin = '10px 0';
      document.getElementById('ann-design-body').appendChild(img);
    };
    reader.readAsDataURL(input.files[0]);
    input.value = '';
  };

  window.annSaveAsTemplate = function () {
    if (!window.annRequireAction('create')) return;
    var name = prompt('سانچے کا نام:');
    if (!name) return;
    var canvas = document.getElementById('ann-design-canvas');
    var templates = readJson(DB.templates, []);
    templates.push({
      id: window.generateID ? window.generateID('TPL') : 'TPL-' + Date.now(),
      name: name,
      state: window.annAuditSnapshot(window._annDesignState),
      html: canvas ? canvas.innerHTML : '',
      createdAt: Date.now(),
      createdBy: window.annActorName()
    });
    emsSaveKey(DB.templates, JSON.stringify(templates));
    window.annAuditLog('create', 'template', templates[templates.length - 1].id, null, { name: name }, 'سانچہ');
    window.annRenderTemplates();
    showToast('سانچہ محفوظ', 'success');
  };

  window.annLoadTemplate = function (id) {
    var templates = readJson(DB.templates, []);
    var t = templates.find(function (x) { return x.id === id; });
    if (!t) return;
    window._annDesignState = t.state || window._annDesignState;
    var canvas = document.getElementById('ann-design-canvas');
    if (canvas && t.html) canvas.innerHTML = t.html;
    window.annApplyDesignState();
    switchAnnTab('ann-win-designer', document.querySelector('#ann-ribbon-menu [onclick*=designer]'));
    showToast('سانچہ لوڈ: ' + t.name, 'info');
  };

  window.annRenderTemplates = function () {
    var grid = document.getElementById('ann-templates-grid');
    if (!grid) return;
    var templates = readJson(DB.templates, []);
    if (!templates.length) { grid.innerHTML = '<p style="color:#94a3b8;">کوئی سانچہ نہیں — ڈیزائنر سے محفوظ کریں</p>'; return; }
    grid.innerHTML = templates.map(function (t) {
      return '<div class="ann-template-card"><strong>' + t.name + '</strong><br><small>' + new Date(t.createdAt).toLocaleDateString('ur-PK') + '</small><div style="margin-top:8px;">' +
        '<button class="btn btn-sm btn-primary" onclick="window.annLoadTemplate(\'' + t.id + '\')"><i class="fas fa-folder-open"></i> کھولیں</button> ' +
        '<button class="btn btn-sm btn-outline" onclick="window.annDeleteTemplate(\'' + t.id + '\')"><i class="fas fa-trash"></i></button></div></div>';
    }).join('');
  };

  window.annDeleteTemplate = function (id) {
    if (!confirm('سانچہ حذف؟')) return;
    var templates = readJson(DB.templates, []).filter(function (t) { return t.id !== id; });
    emsSaveKey(DB.templates, JSON.stringify(templates));
    window.annRenderTemplates();
  };

  window.annExportDesignPNG = function () {
    var el = document.getElementById('ann-design-canvas');
    if (!el) return showToast('کینوس نہیں ملا', 'error');
    function run() {
      if (!window.html2canvas) return showToast('html2canvas نہیں', 'error');
      html2canvas(el, { scale: 2, useCORS: true, backgroundColor: null }).then(function (c) {
        var a = document.createElement('a');
        a.href = c.toDataURL('image/png');
        a.download = 'poster-' + Date.now() + '.png';
        a.click();
        showToast('PNG برآمد — Photoshop/Canva میں کھولیں', 'success');
      });
    }
    if (typeof window.emsLoadPdfLibs === 'function') {
      window.emsLoadPdfLibs().then(run).catch(function () { showToast('html2canvas نہیں', 'error'); });
      return;
    }
    run();
  };

  window.annExportDesignSVG = function () {
    var el = document.getElementById('ann-design-canvas');
    if (!el) return;
    var w = el.offsetWidth || 800;
    var h = el.offsetHeight || 600;
    var inner = el.innerHTML;
    var svg = '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:' + w + 'px;height:' + h + 'px;background:' + (window._annDesignState ? window._annDesignState.bg : '#1e3a5f') + ';">' +
      inner + '</div></foreignObject></svg>';
    var a = document.createElement('a');
    a.href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    a.download = 'poster-' + Date.now() + '.svg';
    a.click();
    showToast('SVG برآمد — Illustrator/Inkscape', 'success');
  };

  window.annExportDesignJSON = function () {
    var canvas = document.getElementById('ann-design-canvas');
    var payload = {
      state: window._annDesignState,
      html: canvas ? canvas.innerHTML : '',
      exportedAt: Date.now()
    };
    var a = document.createElement('a');
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
    a.download = 'poster-template-' + Date.now() + '.json';
    a.click();
    showToast('JSON سانچہ برآمد', 'success');
  };

  window.annImportDesignJSON = function (input) {
    if (!input.files || !input.files[0]) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var payload = JSON.parse(e.target.result);
        window._annDesignState = payload.state || window._annDesignState;
        var canvas = document.getElementById('ann-design-canvas');
        if (canvas && payload.html) canvas.innerHTML = payload.html;
        window.annApplyDesignState();
        showToast('JSON سانچہ درآمد', 'success');
      } catch (err) { showToast('غلط JSON فائل', 'error'); }
    };
    reader.readAsText(input.files[0]);
    input.value = '';
  };

  window.annImportExternalDesign = function (input) {
    if (!input.files || !input.files[0]) return;
    var file = input.files[0];
    var reader = new FileReader();
    reader.onload = function (e) {
      var templates = readJson(DB.templates, []);
      templates.push({
        id: window.generateID ? window.generateID('TPL') : 'TPL-' + Date.now(),
        name: file.name,
        externalFile: e.target.result,
        fileType: file.type,
        importedAt: Date.now()
      });
      emsSaveKey(DB.templates, JSON.stringify(templates));
      window.annRenderTemplates();
      showToast('فائل درآمد — سانچوں میں محفوظ', 'success');
    };
    if (file.type.indexOf('image') >= 0 || file.type === 'application/pdf') reader.readAsDataURL(file);
    else reader.readAsText(file);
    input.value = '';
  };

  window.annPrintDesign = function (size) {
    var el = document.getElementById('ann-design-canvas');
    if (!el) return;
    el.className = 'ann-design-canvas ann-print-area ' + (size || 'ann-size-a4');
    if (typeof window.printDiv === 'function') window.printDiv('ann-design-canvas');
  };

  // =========================================================
  // پرنٹ سینٹر
  // =========================================================
  window.annRenderPrintCenter = function () {
    var sel = document.getElementById('ann-print-select');
    if (sel) {
      sel.innerHTML = '<option value="">— منتخب —</option>' + window.annGetAnnouncements().map(function (a) {
        return '<option value="' + a.id + '">' + a.title + '</option>';
      }).join('');
    }
};

// =========================================================
  // آڈٹ
  // =========================================================
  window.annRenderAuditLog = function (page) {
    if (page) window._annAuditPage = page;
    var tbody = document.getElementById('ann-audit-tbody');
    if (!tbody) return;
    var logs = readJson(DB.audit, []).slice().reverse();
    var ps = 100;
    var pages = Math.max(1, Math.ceil(logs.length / ps));
    if (window._annAuditPage > pages) window._annAuditPage = pages;
    var slice = logs.slice((window._annAuditPage - 1) * ps, window._annAuditPage * ps);
    var pg = document.getElementById('ann-audit-pager');
    if (pg) pg.innerHTML = logs.length ? '<span class="reg-pg-info">' + logs.length + ' لاگ — صفحہ ' + window._annAuditPage + '/' + pages + '</span> ' +
      (window._annAuditPage > 1 ? '<button class="btn btn-sm btn-outline" onclick="window.annRenderAuditLog(' + (window._annAuditPage - 1) + ')">پچھلا</button> ' : '') +
      (window._annAuditPage < pages ? '<button class="btn btn-sm btn-outline" onclick="window.annRenderAuditLog(' + (window._annAuditPage + 1) + ')">اگلا</button>' : '') : '';
    if (!slice.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">کوئی لاگ نہیں</td></tr>'; return; }
    tbody.innerHTML = slice.map(function (l) {
      return '<tr><td>' + new Date(l.timestamp).toLocaleString('ur-PK') + '</td><td>' + l.userName + '</td><td>' + l.action + '</td><td>' + l.entity + '</td><td>' + (l.summary || '') + '</td><td>' +
        (l.before || l.after ? '<button class="btn btn-sm btn-outline" onclick="window.annViewAuditDetail(\'' + l.id + '\')"><i class="fas fa-search-plus"></i></button>' : '—') + '</td></tr>';
    }).join('');
  };

  window.annViewAuditDetail = function (id) {
    var log = readJson(DB.audit, []).find(function (l) { return l.id === id; });
    if (!log) return;
    var body = document.getElementById('ann-audit-detail-body');
    var modal = document.getElementById('ann-audit-detail-modal');
    if (body) body.innerHTML = '<pre style="white-space:pre-wrap;font-size:12px;direction:ltr;text-align:left;">' +
      'BEFORE:\n' + JSON.stringify(log.before, null, 2) + '\n\nAFTER:\n' + JSON.stringify(log.after, null, 2) + '</pre>';
    if (modal) modal.style.display = 'flex';
  };

  window.annViewVersion = function (annId, verIdx) {
    var ann = window.annGetAnnouncements().find(function (a) { return a.id === annId; });
    if (!ann || !ann.versions || !ann.versions[verIdx]) return showToast('نسخہ نہیں', 'error');
    var snap = ann.versions[verIdx].snapshot;
    alert('پرانا نسخہ (' + new Date(ann.versions[verIdx].savedAt).toLocaleString('ur-PK') + '):\n\n' + (snap.title || '') + '\n\n' + (snap.details || ''));
  };

  // =========================================================
  // صوتی پیغام
  // =========================================================
  window.annStartVoiceRecord = function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return showToast('مائیکروفون دستیاب نہیں', 'error');
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      window._annVoiceChunks = [];
      window._annVoiceRecorder = new MediaRecorder(stream);
      window._annVoiceRecorder.ondataavailable = function (e) { if (e.data.size) window._annVoiceChunks.push(e.data); };
      window._annVoiceRecorder.onstop = function () {
        var blob = new Blob(window._annVoiceChunks, { type: 'audio/webm' });
        var reader = new FileReader();
        reader.onload = function (ev) {
          document.getElementById('ann-voice-data').value = ev.target.result;
          var vp = document.getElementById('ann-voice-player');
          if (vp) { vp.src = ev.target.result; vp.style.display = 'block'; }
          showToast('صوتی پیغام محفوظ', 'success');
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(function (t) { t.stop(); });
      };
      window._annVoiceRecorder.start();
      showToast('ریکارڈنگ... دوبارہ دبائیں بند کرنے کے لیے', 'info');
      document.getElementById('btn-ann-voice').innerHTML = '<i class="fas fa-stop"></i> بند';
      document.getElementById('btn-ann-voice').onclick = window.annStopVoiceRecord;
    }).catch(function () { showToast('مائیک کی اجازت دیں', 'error'); });
  };

  window.annStopVoiceRecord = function () {
    if (window._annVoiceRecorder && window._annVoiceRecorder.state !== 'inactive') window._annVoiceRecorder.stop();
    document.getElementById('btn-ann-voice').innerHTML = '<i class="fas fa-microphone"></i> صوتی';
    document.getElementById('btn-ann-voice').onclick = window.annStartVoiceRecord;
  };

  // =========================================================
  // کیٹیگریز (legacy)
// =========================================================
  window.loadAnnCategories = function () {
    window.annLoadCategories();
  };

  window.annLoadCategories = function () {
    var cats = readJson(DB.categories, null);
    if (!cats || !cats.length) {
      cats = ['اعلان', 'فیصلہ', 'سرکلر', 'ہدایت', 'تجویز', 'یاد دہانی', 'فوری نوٹس'];
      emsSaveKey(DB.categories, JSON.stringify(cats));
    }
    var select = document.getElementById('ann-category');
    if (select) {
      var cur = select.value;
      select.innerHTML = cats.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
      if (cur && cats.indexOf(cur) >= 0) select.value = cur;
    }
  };

  window.addAnnCategory = function () {
    var inp = document.getElementById('new-ann-cat');
    if (!inp) return;
    var newCat = inp.value.trim();
    if (!newCat) return showToast('نام لکھیں', 'error');
    var cats = readJson(DB.categories, []);
    if (cats.indexOf(newCat) >= 0) return showToast('پہلے سے موجود', 'warning');
    cats.push(newCat);
    emsSaveKey(DB.categories, JSON.stringify(cats));
    window.annLoadCategories();
    inp.value = '';
    showToast('شامل', 'success');
  };

  window.deleteAnnCategory = function () {
    var select = document.getElementById('ann-category');
    if (!select || !select.value) return;
    if (!confirm('قسم حذف؟')) return;
    var cats = readJson(DB.categories, []).filter(function (c) { return c !== select.value; });
    emsSaveKey(DB.categories, JSON.stringify(cats));
    window.annLoadCategories();
  };

  window.annLoadSettingsForm = function () {
    var s = readJson(DB.settings, {});
    if (document.getElementById('ann-set-brand')) document.getElementById('ann-set-brand').value = s.brandName || '';
    if (document.getElementById('ann-set-footer')) document.getElementById('ann-set-footer').value = s.footerText || '';
    if (document.getElementById('ann-set-page-size')) document.getElementById('ann-set-page-size').value = s.archivePageSize || 50;
    window._annArchivePageSize = s.archivePageSize || 50;
  };

  window.annSaveSettings = function () {
    if (!window.annRequireAction('edit')) return;
    var s = {
      brandName: document.getElementById('ann-set-brand') ? document.getElementById('ann-set-brand').value : '',
      footerText: document.getElementById('ann-set-footer') ? document.getElementById('ann-set-footer').value : '',
      archivePageSize: document.getElementById('ann-set-page-size') ? Number(document.getElementById('ann-set-page-size').value) : 50
    };
    window._annArchivePageSize = s.archivePageSize;
    emsSaveKey(DB.settings, JSON.stringify(s));
    showToast('ترتیبات محفوظ', 'success');
  };

  window.annExportArchiveCSV = function () {
    var list = window.annGetAnnouncements();
    var rows = [['id', 'date', 'type', 'kind', 'title', 'audience', 'createdBy']];
    list.forEach(function (a) { rows.push([a.id, a.date, a.type, a.kind, a.title, a.audience, a.createdBy]); });
    var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c || '').replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\ufeff' + csv);
    a.download = 'announcements-' + Date.now() + '.csv';
    a.click();
  };

  // =========================================================
  // Init
  // =========================================================
  document.addEventListener('click', function (e) {
    if (e.target && (e.target.id === 'tab-announcements' || e.target.closest('#tab-announcements'))) {
      setTimeout(window.annInitModule, 200);
    }
  });

  document.addEventListener('click', function (e) {
    if (e.target && (e.target.id === 'btn-save-ann' || e.target.closest('#btn-save-ann'))) window.annSaveAnnouncement();
  });

  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'ann-search') { window._annArchivePage = 1; window.annRenderArchive(); }
  });

  document.getElementById('tab-announcements')?.addEventListener('click', function () {
    annInitOptDeptFilter();
  });

  if (typeof window.emsRegisterDepartmentRefresh === 'function') {
    window.emsRegisterDepartmentRefresh('announcements', function () {
      annInitOptDeptFilter();
      window.annRenderDashboard();
      window.annRenderArchive();
    });
  }

  annInitOptDeptFilter();

})();
