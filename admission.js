// =========================================================================
// ایڈوانسڈ رجسٹریشن ماڈیول - جاوا اسکرپٹ (No Dummy Code, 100% Functional)
// =========================================================================
// 1. گلوبل ویری ایبلز اور ڈیٹا بیس کی (Database Keys)
// DB_USERS / DB_REJECTED — deprecated for reads; SSOT via emsRegRepo* / emsGetUserById
const DB_CLASSES = 'ems_classes';
let currentEditingId = null;
let currentUploadedImageBase64 = '';
let currentRegType = 'student';
window.currentRegType = currentRegType;
let isEditingRejected = false;
// =========================================================
// 2. ربن مینیو اور ٹیب سوئچر (Tab Switching Logic)
// =========================================================
window.switchRegTab = function (panelId, btnElement) {
  var prevRegType = currentRegType;
  if (window.EMS_REG_DRAFTS_ENABLED === true
      && typeof window.emsRegDraftSaveBeforeTabSwitch === 'function'
      && ['student', 'teacher', 'staff'].indexOf(prevRegType) >= 0) {
    window.emsRegDraftSaveBeforeTabSwitch(prevRegType);
  }

  document.querySelectorAll('.reg-panel').forEach((panel) => {
    panel.style.display = 'none';
  });
  document.getElementById(panelId).style.display = 'block';

  document
    .querySelectorAll('#reg-ribbon-menu .btn, #reg-ribbon-menu .reg-tab')
    .forEach((btn) => {
      btn.classList.remove('active-sub-tab');
    });
  if (btnElement) btnElement.classList.add('active-sub-tab');

  if (panelId === 'reg-student-panel') currentRegType = 'student';
  else if (panelId === 'reg-teacher-panel') currentRegType = 'teacher';
  else if (panelId === 'reg-staff-panel') currentRegType = 'staff';
  else if (panelId === 'reg-rejected-panel') currentRegType = 'rejected';
  else if (panelId === 'reg-dashboard-panel') currentRegType = 'dashboard';
  else currentRegType = 'list';
  window.currentRegType = currentRegType;

  if (panelId === 'reg-student-panel' && typeof window.sysFieldApplyVisibility === 'function') window.sysFieldApplyVisibility('student');
  if (panelId === 'reg-teacher-panel' && typeof window.sysFieldApplyVisibility === 'function') window.sysFieldApplyVisibility('teacher');
  if (panelId === 'reg-staff-panel' && typeof window.sysFieldApplyVisibility === 'function') window.sysFieldApplyVisibility('staff');
  if (typeof window.sysFieldRenderAll === 'function' && ['reg-student-panel', 'reg-teacher-panel', 'reg-staff-panel'].indexOf(panelId) >= 0) {
    window.sysFieldRenderAll();
  }

  if (
    !currentEditingId &&
    ['student', 'teacher', 'staff'].includes(currentRegType)
  ) {
    if (window.EMS_REG_DRAFTS_ENABLED === true && typeof window.emsRegLoadDraft === 'function') {
      window.emsRegLoadDraft(currentRegType, { checkCloud: false }).then(function (res) {
        var d = res && (res.draft || (res.fields ? res : null));
        if (d && d.fields && (d.fields.name || d.fields.phone || d.fields.cnic)) {
          window.emsRegApplyFormSnapshot(currentRegType, d);
        } else {
          window.resetRegForm(currentRegType);
        }
      }).catch(function () {
        window.resetRegForm(currentRegType);
      });
    } else {
      window.resetRegForm(currentRegType);
    }
  }

  if (currentRegType === 'list') {
    var doRender = function () {
      window.renderRegTable();
    };
    if (typeof window.emsGuardRegistrationListRender === 'function') {
      window.emsGuardRegistrationListRender(doRender);
    } else {
      var ensureFn = typeof window.emsEnsureRegistrationSync === 'function'
        ? window.emsEnsureRegistrationSync()
        : Promise.resolve();
      ensureFn.then(function () {
        doRender();
      });
    }
  }
  if (currentRegType === 'rejected') {
    if (typeof window.emsRegRepoEnsureRejectedInitial === 'function') {
      window.emsRegRepoEnsureRejectedInitial().then(function () {
        window.renderRejectedTable();
      });
    } else {
      window.renderRejectedTable();
    }
  }
  if (panelId === 'reg-branding-panel' && typeof window.emsBrandLoadUI === 'function') {
    window.emsBrandLoadUI();
  }
  if (panelId === 'reg-data-panel' && typeof window.emsOnDataPanel === 'function') {
    window.emsOnDataPanel();
  }
  if (panelId === 'reg-dashboard-panel' && typeof window.renderRegDashboard === 'function') {
    window.renderRegDashboard();
  }
  if (window.EmsI18n && typeof window.EmsI18n.refresh === 'function') {
    window.EmsI18n.refresh();
  }
};

// =========================================================
// 3. آٹو آئی ڈی جنریٹر (Sequential ID)
// =========================================================
window.generateAutoID = function (type) {
  let prefix = type === 'student' ? 'STD' : type === 'teacher' ? 'TCH' : 'STF';
  let users = [];
  if (typeof window.emsRegRepoGetList === 'function') {
    users = window.emsRegRepoGetList().concat(
      typeof window.emsRegRepoGetRejectedList === 'function' ? window.emsRegRepoGetRejectedList() : []
    );
  }
  let typeUsers = users.filter((u) => u.type === type);
  let maxNum = 0;
  typeUsers.forEach((u) => {
    let parts = u.id.split('-');
    if (parts.length > 1) {
      let num = parseInt(parts[1]);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  });
  let nextNum = maxNum + 1;
  let formattedNum = nextNum < 10 ? '0' + nextNum : nextNum;
  return prefix + '-' + formattedNum;
};

window.generateAutoIDAsync = function (type) {
  let prefix = type === 'student' ? 'STD' : type === 'teacher' ? 'TCH' : 'STF';
  if (typeof window.emsRegRepoFetchMaxIdNum === 'function' && getAdmissionTenantId()) {
    return window.emsRegRepoFetchMaxIdNum(type).then(function (maxNum) {
      let nextNum = maxNum + 1;
      let formattedNum = nextNum < 10 ? '0' + nextNum : nextNum;
      return prefix + '-' + formattedNum;
    });
  }
  return Promise.resolve(window.generateAutoID(type));
};

// =========================================================
// 4. فارم ری سیٹ (Reset Form)
// =========================================================
window.resetRegForm = function (type) {
  currentEditingId = null;
  currentUploadedImageBase64 = '';
  isEditingRejected = false;

  document.querySelectorAll(`#reg-${type}-panel input`).forEach((input) => {
    if (input.type !== 'date') input.value = '';
  });
  document
    .querySelectorAll(`#reg-${type}-panel textarea`)
    .forEach((ta) => (ta.value = ''));
  document
    .querySelectorAll(`#reg-${type}-panel select`)
    .forEach((sel) => (sel.selectedIndex = 0));

  let today = new Date().toISOString().split('T')[0];
  let dateInput = document.getElementById(
    type === 'student'
      ? 'stu-reg-date'
      : type === 'teacher'
      ? 'tch-reg-date'
      : 'stf-reg-date'
  );
  if (dateInput) dateInput.value = today;

  let idInput = document.getElementById(
    type === 'student'
      ? 'stu-form-no'
      : type === 'teacher'
      ? 'tch-emp-id'
      : 'stf-emp-id'
  );
  if (idInput) {
    window.generateAutoIDAsync(type).then(function (id) {
      idInput.value = id;
    });
  }

  let prefix = type === 'student' ? 'stu' : type === 'teacher' ? 'tch' : 'stf';
  let imgPreview = document.getElementById(`${prefix}-photo-preview`);
  ['-photo-upload-camera', '-photo-upload-gallery', '-photo-upload'].forEach(function (suffix) {
    let fileInput = document.getElementById(`${prefix}${suffix}`);
    if (fileInput) fileInput.value = '';
  });
  if (imgPreview) {
    imgPreview.src = '';
    imgPreview.style.display = 'none';
    regPhotoTogglePlaceholder(imgPreview, true);
  }
  let combinedName = document.getElementById(`${prefix}-name-with-fname`);
  if (combinedName) combinedName.value = '';
  let nameEl = document.getElementById(`${prefix}-name`);
  let fnameEl = document.getElementById(`${prefix}-fname`);
  if (nameEl) nameEl.value = '';
  if (fnameEl) fnameEl.value = '';

  // ماسٹر شرائط نامہ (Global Template) لوڈ کرنا
  let termsInput = document.getElementById(`${prefix}-terms-text`);
  if (termsInput) {
    let savedTerms = localStorage.getItem(`ems_global_terms_${prefix}`);
    if (savedTerms) {
      // اگر پہلے سے سیو اور لاک ہے تو اسے ڈبے میں ڈال کر لاک کر دو
      termsInput.value = savedTerms;
      termsInput.setAttribute('readonly', 'true');
      let btnLock = document.getElementById(`btn-${prefix}-terms-lock`);
      let btnEdit = document.getElementById(`btn-${prefix}-terms-edit`);
      if (btnLock) btnLock.style.display = 'none';
      if (btnEdit) btnEdit.style.display = 'inline-flex';
    } else {
      // اگر کچھ سیو نہیں ہے تو ڈبہ خالی اور ان لاک رکھو
      termsInput.value = '';
      termsInput.removeAttribute('readonly');
      let btnLock = document.getElementById(`btn-${prefix}-terms-lock`);
      let btnEdit = document.getElementById(`btn-${prefix}-terms-edit`);
      if (btnLock) btnLock.style.display = 'inline-flex';
      if (btnEdit) btnEdit.style.display = 'none';
    }
  }

  if (typeof window.sysFieldClear === 'function') window.sysFieldClear(type);

  let btnApprove = document.getElementById(`btn-${prefix}-approve`);
  if (btnApprove) {
    if (type === 'student')
      btnApprove.innerHTML =
        '<i class="fas fa-check-circle"></i> داخلہ منظور کریں (مستقل ریکارڈ میں شامل کریں)';
    else if (type === 'teacher')
      btnApprove.innerHTML =
        '<i class="fas fa-check-circle"></i> تقرری منظور کریں (اساتذہ کے فائنل ڈیٹا میں ڈالیں)';
    else
      btnApprove.innerHTML =
        '<i class="fas fa-check-circle"></i> ملازم کو بھرتی کریں (مستقل ریکارڈ میں)';
  }

  let btnCancel = document.getElementById(`btn-${prefix}-cancel-edit`);
  if (btnCancel) btnCancel.style.display = 'none';
};

// =========================================================
// 5. تصویر اپلوڈ کی لاجک (Image Upload Handling)
// =========================================================
function regPhotoTogglePlaceholder(preview, show) {
  if (!preview) return;
  var drop = preview.closest('.reg-photo-drop');
  if (!drop) return;
  var wrap = drop.querySelector('.reg-photo-ph-wrap');
  var hint = drop.querySelector('.reg-photo-hint');
  var ph = drop.querySelector('.reg-photo-ph');
  if (wrap) wrap.style.display = show ? '' : 'none';
  if (hint) hint.style.display = show ? '' : 'none';
  if (ph && !wrap) ph.style.display = show ? '' : 'none';
}

function handleImageUpload(inputId, previewId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);

  if (input && preview) {
    input.addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function (event) {
          currentUploadedImageBase64 = event.target.result;
          preview.src = currentUploadedImageBase64;
          preview.style.display = 'block';
          regPhotoTogglePlaceholder(preview, false);
        };
        reader.readAsDataURL(file);
      }
    });
  }
}

function bindRegPhotoUploads(prefix) {
  handleImageUpload(prefix + '-photo-upload-camera', prefix + '-photo-preview');
  handleImageUpload(prefix + '-photo-upload-gallery', prefix + '-photo-preview');
  handleImageUpload(prefix + '-photo-upload', prefix + '-photo-preview');
}

// =========================================================
// 5.5. فائر بیس لائیو سنک (Real-time Multi-User Sync)
// tenantId = emsGetTenantId() — staff/parent کے لیے owner uid نہیں
// =========================================================
var _regFilteredCache = [];
var _regSearchTimer = null;
var _regListAutoFetchAttempted = false;

function getAdmissionTenantId() {
  if (typeof window.emsResolveFirestoreTenantId === 'function') {
    var firestoreTid = window.emsResolveFirestoreTenantId();
    if (firestoreTid) return firestoreTid;
  }
  if (typeof window.emsRequireTenantId === 'function') {
    var required = window.emsRequireTenantId();
    if (required) return required;
  }
  if (typeof window.emsGetTenantId === 'function') {
    var tid = window.emsGetTenantId();
    if (tid) return tid;
  }
  if (window.CURRENT_MADRASA_TENANT_ID) return window.CURRENT_MADRASA_TENANT_ID;
  if (window.EMS_ACTIVE_TENANT_ID) return window.EMS_ACTIVE_TENANT_ID;
  if (typeof window.emsReadPersistedBootTenantId === 'function') {
    var persisted = window.emsReadPersistedBootTenantId();
    if (persisted) return persisted;
  }
  var u = firebase.auth().currentUser;
  return u ? u.uid : null;
}

function stopRegistrationFirestoreSync() {
  if (typeof window.emsStopRegistrationSync === 'function') {
    window.emsStopRegistrationSync();
  }
}

// emsStartRegistrationSync / emsStopRegistrationSync — see ems-registration-bootstrap.js (boot)

window.regRepoLoadMore = function () {
  if (typeof window.emsRegRepoLoadMore !== 'function') return;
  window.emsRegRepoLoadMore().then(function (res) {
    window.renderRegTable();
    if (res && res.added > 0 && typeof window.showToast === 'function') {
      window.showToast(res.added + ' مزید ریکارڈ لوڈ', 'success');
    }
  });
};

window.regRepoLoadMoreRejected = function () {
  if (typeof window.emsRegRepoLoadMoreRejected !== 'function') return;
  window.emsRegRepoLoadMoreRejected().then(function (res) {
    window.renderRejectedTable();
    if (res && res.added > 0 && typeof window.showToast === 'function') {
      window.showToast(res.added + ' مزید مسترد ریکارڈ لوڈ', 'success');
    }
  });
};

function regRepoEnsureCloudReadyForPull() {
  var chain = Promise.resolve();
  if (typeof window.emsEnableOnlineMode === 'function') {
    chain = window.emsEnableOnlineMode();
  } else if (typeof window.emsLoadCloudStack === 'function') {
    chain = window.emsLoadCloudStack();
  }
  return chain.then(function () {
    if (typeof window.emsEnsureFirebaseAuthReady === 'function') {
      return window.emsEnsureFirebaseAuthReady();
    }
    if (typeof window.emsInitFirebase === 'function') {
      window.emsInitFirebase();
    }
    return true;
  }).then(function () {
    if (typeof window.getDbOrNull === 'function' && window.getDbOrNull()) {
      return { ok: true };
    }
    return { ok: false, reason: 'firestore_unavailable' };
  });
}

window.regRepoDisasterRecoverySync = function () {
  if (typeof window.emsCloudPullExecute === 'function') {
    return window.emsCloudPullExecute({ scope: 'registrations' });
  }
  var tenantId = getAdmissionTenantId();
  if (!tenantId) {
    if (typeof window.showToast === 'function') window.showToast('Tenant ID نہیں ملی — Gmail سے دوبارہ لاگ ان کریں', 'error');
    return Promise.resolve({ ok: false, source: 'no_tenant' });
  }
  if (typeof window.emsForceCloudDisasterRecoverySync !== 'function') {
    if (typeof window.showToast === 'function') window.showToast('Cloud Sync not available', 'error');
    return Promise.resolve({ ok: false, source: 'no_fn' });
  }
  return window.emsForceCloudDisasterRecoverySync(tenantId);
};

window.regRepoRebuildCache = function () {
  return window.regRepoDisasterRecoverySync();
};

// Auth logout cleanup — handled in ems-registration-bootstrap.js

// =========================================================
// 6. ڈیٹا محفوظ — SSOT: repo/IndexedDB پہلے، پھر sync queue (Firebase)
// Feature flag: EMS_REGISTRATION_LEGACY_FIRESTORE=true → پرانا براہ راست Firestore راستہ
// =========================================================
function admissionRegistrationSsotEnabled() {
  if (window.EMS_REGISTRATION_LEGACY_FIRESTORE === true) return false;
  if (window.EMS_REGISTRATION_SSOT_OFFLINE === false) return false;
  return true;
}

function regDupEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function regDupRuleLabel(rule) {
  var labels = {
    D1: 'شناختی کارڈ (CNIC)',
    D2: 'B-Form',
    D3: 'فون نمبر',
    D4: 'نام + ولدیت',
    D5: 'نام + جماعت',
    D6: 'رول نمبر',
    D7: 'نام + فون (جزوی)'
  };
  return labels[rule] || rule;
}

function regShowDuplicateModal(dupResult, user, onProceed) {
  var existing = document.getElementById('reg-dup-modal');
  if (existing) existing.remove();

  var hard = dupResult.hard || [];
  var soft = dupResult.soft || [];
  var isHard = hard.length > 0;
  var canOverrideHard = typeof window.emsRegCanOverrideHardDuplicate === 'function'
    && window.emsRegCanOverrideHardDuplicate();

  var rows = (isHard ? hard : soft).map(function (m) {
    return '<tr><td>' + regDupEsc(regDupRuleLabel(m.rule)) + '</td>' +
      '<td><b>' + regDupEsc(m.existingId) + '</b><br>' + regDupEsc(m.existingName) +
      (m.existingClass ? '<br><small>' + regDupEsc(m.existingClass) + '</small>' : '') + '</td>' +
      '<td>' + regDupEsc(m.value) + '</td></tr>';
  }).join('');

  var overlay = document.createElement('div');
  overlay.id = 'reg-dup-modal';
  overlay.className = 'modal-overlay';
  overlay.style.display = 'flex';
  overlay.innerHTML =
    '<div class="modal-box" style="max-width:560px;text-align:right;">' +
    '<h3 style="margin:0 0 12px;color:' + (isHard ? '#b91c1c' : '#b45309') + ';">' +
    (isHard ? '⚠️ Duplicate ریکارڈ — محفوظ نہیں ہو سکتا' : '⚠️ ممکنہ duplicate — احتیاط') +
    '</h3>' +
    '<p style="color:#64748b;font-size:14px;">' +
    (isHard
      ? 'یہ شناخت پہلے سے رجسٹرڈ ہے۔ عام عملہ override نہیں کر سکتا۔'
      : 'ملتی جلتی معلومات موجود ہیں۔ جاری رکھنے سے پہلے چیک کریں۔') +
    '</p>' +
    '<table class="data-table" style="width:100%;margin:12px 0;font-size:13px;"><thead><tr>' +
    '<th>قاعدہ</th><th>موجودہ ریکارڈ</th><th>قدر</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:16px;">' +
    '<button type="button" class="btn btn-secondary" data-dup-cancel>منسوخ</button>' +
    (soft.length && hard.length === 0
      ? '<button type="button" class="btn btn-warning" data-dup-view>موجودہ ریکارڈ دیکھیں</button>' +
        '<button type="button" class="btn btn-primary" data-dup-continue>جاری رکھیں</button>'
      : '') +
    (isHard && canOverrideHard
      ? '<button type="button" class="btn btn-danger" data-dup-override>پھر بھی محفوظ (Owner)</button>'
      : '') +
    '</div></div>';
  document.body.appendChild(overlay);

  function closeModal() {
    overlay.remove();
  }

  function logOverride(reason) {
    if (typeof window.emsRegLogAudit === 'function') {
      window.emsRegLogAudit('duplicate_override', user.id, {
        entityType: user.type,
        source: 'form',
        hard: isHard,
        rules: (dupResult.matches || []).map(function (m) { return m.rule; }),
        reason: reason || ''
      });
    } else if (typeof window.emsLogAudit === 'function') {
      window.emsLogAudit('admission', 'duplicate_override', user.id, {
        hard: isHard,
        rules: (dupResult.matches || []).map(function (m) { return m.rule; }),
        reason: reason || ''
      });
    }
  }

  overlay.querySelector('[data-dup-cancel]').addEventListener('click', closeModal);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeModal();
  });

  var viewBtn = overlay.querySelector('[data-dup-view]');
  if (viewBtn) {
    viewBtn.addEventListener('click', function () {
      var first = soft[0] || hard[0];
      if (first && typeof window.editRegistration === 'function') {
        closeModal();
        window.editRegistration(first.existingId, user.type || 'student', first.listKind === 'rejected');
      }
    });
  }

  var continueBtn = overlay.querySelector('[data-dup-continue]');
  if (continueBtn) {
    continueBtn.addEventListener('click', function () {
      closeModal();
      onProceed({ duplicateAcknowledged: true, softOnly: true });
    });
  }

  var overrideBtn = overlay.querySelector('[data-dup-override]');
  if (overrideBtn) {
    overrideBtn.addEventListener('click', function () {
      if (typeof window.emsRegRequire === 'function' && !window.emsRegRequire('duplicate_override', { id: user.id })) {
        return;
      }
      var reason = prompt('Hard duplicate override — وجہ درج کریں (Owner):');
      if (!reason || !String(reason).trim()) return;
      logOverride(String(reason).trim());
      closeModal();
      onProceed({ duplicateOverride: true, hard: true, reason: String(reason).trim() });
    });
  }
}

function regRunDuplicateGate(user, onProceed) {
  if (typeof window.emsRegCheckDuplicatesAsync !== 'function') {
    onProceed({});
    return;
  }
  window.emsRegCheckDuplicatesAsync(user, {
    excludeId: currentEditingId || user.id,
    scope: 'all'
  }).then(function (result) {
    if (!result || (!result.hasHard && !result.hasSoft)) {
      onProceed({});
      return;
    }
    if (result.hasHard) {
      regShowDuplicateModal(result, user, onProceed);
      return;
    }
    regShowDuplicateModal(result, user, onProceed);
  }).catch(function () {
    onProceed({});
  });
}

function regDupSetFieldHint(input, state, message) {
  if (!input) return;
  input.classList.remove('reg-dup-ok', 'reg-dup-warn', 'reg-dup-block');
  if (state === 'ok') input.classList.add('reg-dup-ok');
  else if (state === 'warn') input.classList.add('reg-dup-warn');
  else if (state === 'block') input.classList.add('reg-dup-block');
  if (message) input.title = message;
  else input.removeAttribute('title');
}

function regDupCheckFieldOnBlur(input, field) {
  if (!input || typeof window.emsRegCheckFieldDuplicate !== 'function') return;
  var val = (input.value || '').trim();
  if (!val) {
    regDupSetFieldHint(input, null, '');
    return;
  }
  var res = window.emsRegCheckFieldDuplicate(field, val, {
    excludeId: currentEditingId || null,
    scope: 'all'
  });
  if (!res) return;
  if (res.hasHard) {
    var m = (res.hard && res.hard[0]) || (res.matches && res.matches[0]);
    regDupSetFieldHint(input, 'block', 'Duplicate: ' + (m ? m.existingId : ''));
  } else if (res.hasSoft) {
    regDupSetFieldHint(input, 'warn', 'ممکنہ duplicate');
  } else {
    regDupSetFieldHint(input, 'ok', 'منفرد');
  }
}

function regDupWireBlurChecks() {
  var fields = [
    { id: 'stu-cnic', field: 'cnic' },
    { id: 'stu-mobile', field: 'phone' },
    { id: 'tch-cnic', field: 'cnic' },
    { id: 'tch-mobile', field: 'phone' },
    { id: 'stf-cnic', field: 'cnic' },
    { id: 'stf-mobile', field: 'phone' }
  ];
  fields.forEach(function (cfg) {
    var el = document.getElementById(cfg.id);
    if (!el || el._regDupBound) return;
    el.addEventListener('blur', function () {
      regDupCheckFieldOnBlur(el, cfg.field);
    });
    el._regDupBound = true;
  });
}

function regRequireSavePermission(status) {
  if (typeof window.emsRegRequireSsotSave === 'function') {
    return window.emsRegRequireSsotSave(status, currentEditingId, isEditingRejected);
  }
  var perm = typeof window.emsRegPermForSave === 'function'
    ? window.emsRegPermForSave(status, currentEditingId, isEditingRejected)
    : (status === 'approved' ? (currentEditingId ? 'edit' : 'create') : 'reject');
  if (typeof window.emsRegRequire === 'function') {
    return window.emsRegRequire(perm, { status: status, editingId: currentEditingId });
  }
  if (typeof window.emsRequireStaffAction === 'function') {
    return window.emsRequireStaffAction('admission', status === 'approved' ? 'edit' : 'create');
  }
  return true;
}

window.processRegistration = function (type, status) {
  if (!regRequireSavePermission(status)) return;
  let uid = getAdmissionTenantId();
  if (!uid) {
    alert("خرابی: پہلے جی میل سے لاگ ان کریں!");
    return;
  }

  let user = {
    type: type,
    status: status,
    timestamp: new Date().getTime(),
  };
  var photoInput = currentUploadedImageBase64;

  if (typeof window.emsRegSyncCombinedName === 'function') {
    window.emsRegSyncCombinedName(type === 'student' ? 'stu' : type === 'teacher' ? 'tch' : 'stf');
  }

  if (type === 'student') {
    user.id = document.getElementById('stu-form-no').value;
    user.date = document.getElementById('stu-reg-date').value;
    user.name = document.getElementById('stu-name').value;
    user.fname = document.getElementById('stu-fname').value;
    user.cnic = document.getElementById('stu-cnic').value;
    user.phone = document.getElementById('stu-mobile').value;
    user.dob = document.getElementById('stu-dob').value;
    user.bloodGroup = document.getElementById('stu-blood-group').value;
    user.class = document.getElementById('stu-req-class').value || 'نامعلوم';
    user.branch = document.getElementById('stu-branch').value;
    user.admType = document.getElementById('stu-adm-type').value;
    user.resType = document.getElementById('stu-res-type').value;
    user.madrasaRollNo = document.getElementById('stu-madrasa-roll').value;
    user.wifaqRollNo = document.getElementById('stu-wifaq-roll').value;
    user.address = document.getElementById('stu-address').value;
    user.grdName = document.getElementById('stu-grd-name').value;
    user.grdRelation = document.getElementById('stu-grd-relation').value;
    user.grdProfession = document.getElementById('stu-grd-profession').value;
    user.grdMobile = document.getElementById('stu-grd-mobile').value;
    user.grdCnic = document.getElementById('stu-grd-cnic').value;
    user.grdEmergency = document.getElementById('stu-grd-emergency').value;
    user.prevClass = document.getElementById('stu-prev-class').value;
    user.prevMarks = document.getElementById('stu-prev-marks').value;
    user.prevGrade = document.getElementById('stu-prev-grade').value;
    user.prevYear = document.getElementById('stu-prev-year').value;
    user.prevInstitute = document.getElementById('stu-prev-institute').value;
    user.officeNazra = document.getElementById('stu-office-nazra').value;
    user.officeNamaz = document.getElementById('stu-office-namaz').value;
    user.officeTest = document.getElementById('stu-office-test').value;
    user.officeRemarks = document.getElementById('stu-office-remarks').value;
    user.officeExaminer = document.getElementById('stu-office-examiner').value;
    if (typeof window.sysFieldCollect === 'function') user.customFields = window.sysFieldCollect('student');
  } else if (type === 'teacher') {
    user.id = document.getElementById('tch-emp-id').value;
    user.date = document.getElementById('tch-reg-date').value;
    user.name = document.getElementById('tch-name').value;
    user.fname = document.getElementById('tch-fname').value;
    user.dob = document.getElementById('tch-dob').value;
    user.cnic = document.getElementById('tch-cnic').value;
    user.bloodGroup = document.getElementById('tch-blood-group').value;
    user.marital = document.getElementById('tch-marital').value;
    user.phone = document.getElementById('tch-mobile').value;
    user.whatsapp = document.getElementById('tch-whatsapp').value;
    user.email = document.getElementById('tch-email').value;
    user.address = document.getElementById('tch-address').value;
    user.designation = document.getElementById('tch-designation').value;
    user.department = document.getElementById('tch-department').value;
    user.shift = document.getElementById('tch-shift').value;
    user.salary = document.getElementById('tch-salary').value || 0;
    user.residence = document.getElementById('tch-residence').value;
    user.food = document.getElementById('tch-food').value;
    user.expInstitute = document.getElementById('tch-exp-institute').value;
    user.expDesignation = document.getElementById('tch-exp-designation').value;
    user.expDuration = document.getElementById('tch-exp-duration').value;
    user.expReason = document.getElementById('tch-exp-reason').value;
    user.officeDemo = document.getElementById('tch-office-demo').value;
    user.officeNazim = document.getElementById('tch-office-nazim').value;
    if (typeof window.sysFieldCollect === 'function') user.customFields = window.sysFieldCollect('teacher');
  } else if (type === 'staff') {
    user.id = document.getElementById('stf-emp-id').value;
    user.date = document.getElementById('stf-reg-date').value;
    user.name = document.getElementById('stf-name').value;
    user.fname = document.getElementById('stf-fname').value;
    user.dob = document.getElementById('stf-dob').value;
    user.cnic = document.getElementById('stf-cnic').value;
    user.position = document.getElementById('stf-position').value;
    user.phone = document.getElementById('stf-mobile').value;
    user.address = document.getElementById('stf-address').value;
    user.guaName = document.getElementById('stf-gua-name').value;
    user.guaCnic = document.getElementById('stf-gua-cnic').value;
    user.guaMobile = document.getElementById('stf-gua-mobile').value;
    user.guaRelation = document.getElementById('stf-gua-relation').value;
    user.guaAddress = document.getElementById('stf-gua-address').value;
    user.expDetails = document.getElementById('stf-exp-details').value;
    user.healthIssue = document.getElementById('stf-health-issue').value;
    user.salary = document.getElementById('stf-office-salary').value || 0;
    user.shift = document.getElementById('stf-office-shift').value;
    user.officeNazim = document.getElementById('stf-office-nazim').value;
    if (typeof window.sysFieldCollect === 'function') user.customFields = window.sysFieldCollect('staff');
  }

  if (!user.name || user.name.trim() === '') {
    alert('براہ کرم نام درج کرنا لازمی ہے!');
    return;
  }

  if (typeof window.emsStampDepartment === 'function') {
    window.emsStampDepartment(user);
  }

  var regBeforeSnapshotPromise = (currentEditingId && typeof window.emsRegGetRecordById === 'function')
    ? window.emsRegGetRecordById(currentEditingId, { fromRejected: isEditingRejected })
    : Promise.resolve(null);

  var useSsot = admissionRegistrationSsotEnabled()
    && typeof window.emsRegRepoPersistRegistration === 'function';

  function finishRegistrationSave(res) {
    if (status === 'approved') {
      if (type === 'student' && user.class && user.class !== 'نامعلوم') {
        let classes = typeof window.emsCacheGet === 'function'
          ? window.emsCacheGet(DB_CLASSES, [])
          : JSON.parse(localStorage.getItem(DB_CLASSES) || '[]');
        if (!classes.includes(user.class)) {
          classes.push(user.class);
          if (typeof window.emsCacheSet === 'function') window.emsCacheSet(DB_CLASSES, classes);
          else localStorage.setItem(DB_CLASSES, JSON.stringify(classes));
          window.loadClassesList();
        }
      }
    }

    if (res && res.offline && !res.synced && typeof window.showToast === 'function') {
      window.showToast('📴 آف لائن محفوظ — انٹرنیٹ پر sync ہو گا', 'warning');
    }
    if (res && res.synced === false && !res.offline && typeof window.emsSyncFailureRefreshUi === 'function') {
      window.emsSyncFailureRefreshUi({ error: res.error, code: res.code, docId: user.id });
    }

    if (window.EMS_REG_DRAFTS_ENABLED === true && typeof window.emsRegDeleteDraft === 'function') {
      window.emsRegDeleteDraft(type);
    }

    window.resetRegForm(type);
    var repoChain = Promise.resolve();
    var ssotAlreadySaved = useSsot && res && res.idb !== undefined;
    if (!ssotAlreadySaved && typeof window.emsRegRepoUpsert === 'function') {
      var leanUser = typeof window.emsLeanUserForLocalStorage === 'function'
        ? window.emsLeanUserForLocalStorage(user) : user;
      if (typeof window.emsRegRepoInit === 'function' && uid) {
        window.emsRegRepoInit(uid);
      }
      if (status === 'approved') {
        repoChain = Promise.resolve(window.emsRegRepoUpsert(leanUser, false));
        if (currentEditingId && isEditingRejected && typeof window.emsRegRepoRemove === 'function') {
          repoChain = repoChain.then(function () { return window.emsRegRepoRemove(currentEditingId, true); });
        } else if (currentEditingId && !isEditingRejected && currentEditingId !== user.id && typeof window.emsRegRepoRemove === 'function') {
          repoChain = repoChain.then(function () { return window.emsRegRepoRemove(currentEditingId, false); });
        }
      } else {
        repoChain = Promise.resolve(window.emsRegRepoUpsert(leanUser, true));
        if (currentEditingId && !isEditingRejected && typeof window.emsRegRepoRemove === 'function') {
          repoChain = repoChain.then(function () { return window.emsRegRepoRemove(currentEditingId, false); });
        }
      }
    }
    repoChain.then(function () {
    _regListAutoFetchAttempted = false;
    if (document.getElementById('reg-users-table')) {
      if (typeof window.emsGuardRegistrationListRender === 'function') {
        window.emsGuardRegistrationListRender(window.renderRegTable);
      } else {
        window.renderRegTable();
      }
    }
    if (document.getElementById('reg-rejected-table')) window.renderRejectedTable();
    regBeforeSnapshotPromise.then(function (before) {
      if (typeof window.emsRegLogAudit !== 'function') return;
      var auditAction = typeof window.emsRegResolveRegistrationAction === 'function'
        ? window.emsRegResolveRegistrationAction({
            status: status,
            currentEditingId: currentEditingId,
            isEditingRejected: isEditingRejected
          })
        : (status === 'approved' ? 'approve' : 'reject');
      var changes = (before && typeof window.emsRegDiffRecord === 'function')
        ? window.emsRegDiffRecord(before, user)
        : [];
      window.emsRegLogAudit(auditAction, user.id, {
        entityType: type,
        source: 'form',
        changes: changes,
        beforeSummary: typeof window.emsRegAuditSummarizeRecord === 'function'
          ? window.emsRegAuditSummarizeRecord(before)
          : null,
        afterSummary: typeof window.emsRegAuditSummarizeRecord === 'function'
          ? window.emsRegAuditSummarizeRecord(user)
          : null,
        offline: !!(res && res.offline && !res.synced),
        duplicateOverride: !!user._duplicateOverride,
        reason: user._duplicateOverrideReason || null
      });
    });
    }).catch(function (err) {
      console.warn('Registration repo persist failed:', err);
    });
  }

  function registrationSuccessAlert() {
    if (status === 'approved') {
      if (currentEditingId) {
        if (isEditingRejected) {
          alert('✅ ریکارڈ مسترد شدہ ہسٹری سے نکال کر مین لسٹ میں بحال (Restore) کر دیا گیا!');
        } else {
          alert('✅ ریکارڈ کی تبدیلیاں کامیابی سے محفوظ کر LI گئیں!');
        }
      } else {
        alert('✅ نیا ریکارڈ کامیابی سے منظور اور محفوظ کر لیا گیا!');
      }
    } else {
      if (currentEditingId) {
        if (isEditingRejected) {
          alert('❌ مسترد شدہ ریکارڈ کی تفصیلات اپڈیٹ کر دی گئی ہیں۔');
        } else {
          alert('❌ یہ ریکارڈ مین لسٹ سے خارج کر کے مسترد شدہ (Rejected) ہسٹری میں ڈال دیا گیا ہے۔');
        }
      } else {
        alert('❌ فارم مسترد (Reject) کر کے ہسٹری میں ڈال دیا گیا ہے۔');
      }
    }
  }

  function persistUserToFirestore() {
    var persistOpts = {
      status: status,
      type: type,
      tenantId: uid,
      currentEditingId: currentEditingId,
      isEditingRejected: isEditingRejected,
      merge: !!(currentEditingId && !isEditingRejected && status === 'approved')
    };
    var firestoreDoc = typeof window.emsPrepareFirestoreUserDoc === 'function'
      ? window.emsPrepareFirestoreUserDoc(user)
      : user;
    var chain;

    if (useSsot) {
      chain = window.emsRegRepoPersistRegistration(user, persistOpts);
    } else if (typeof window.emsOfflinePersistRegistration === 'function') {
      chain = window.emsOfflinePersistRegistration(firestoreDoc, persistOpts);
    } else {
      alert('خرابی: سنک outbox تیار نہیں — صفحہ دوبارہ لوڈ کریں۔');
      return;
    }

    chain.then(function (res) {
      if (!res || !res.ok) {
        alert('محفوظ نہیں ہوا — دوبارہ کوشش کریں۔');
        return;
      }
      registrationSuccessAlert();
      finishRegistrationSave(res);
    }).catch(function (err) {
      alert('محفوظ کرنے میں مسئلہ: ' + (err && err.message ? err.message : 'unknown'));
    });
  }

  var uploadPromise = typeof window.emsUploadRegistrationPhoto === 'function'
    ? window.emsUploadRegistrationPhoto(photoInput, user.id, type)
    : Promise.resolve(photoInput ? { keepBase64: photoInput } : {});

  function proceedRegistrationSave(dupMeta) {
    dupMeta = dupMeta || {};
    uploadPromise.then(function (photoResult) {
      if (typeof window.emsApplyPhotoFieldsToUser === 'function') {
        window.emsApplyPhotoFieldsToUser(user, photoResult);
      } else if (photoInput) {
        user.photoBase64 = photoInput;
      }
      if (dupMeta.duplicateOverride) {
        user._duplicateOverride = true;
        user._duplicateOverrideReason = dupMeta.reason || '';
      }
      persistUserToFirestore();
    }).catch(function (err) {
      alert('تصویر اپ لوڈ میں مسئلہ: ' + (err.message || err) + '\nریکارڈ بغیر تصویر محفوظ نہیں کیا گیا۔');
    });
  }

  regRunDuplicateGate(user, proceedRegistrationSave);
};

// =========================================================
// 7. کلاس کے اضافے اور ڈیلیٹ کی لاجک (Class Management)
// =========================================================
window.loadClassesList = function () {
  let classes = JSON.parse(localStorage.getItem(DB_CLASSES) || '[]');
  let dataList = document.getElementById('stu-class-list');
  if (dataList) {
    dataList.innerHTML = '';
    classes.forEach((c) => {
      let option = document.createElement('option');
      option.value = c;
      dataList.appendChild(option);
    });
  }
};

window.addNewClassBtn = function () {
  let input = document.getElementById('stu-req-class');
  let val = input.value.trim();
  if (!val) {
    alert('پہلے خانے میں کلاس کا نام لکھیں!');
    return;
  }

  let classes = JSON.parse(localStorage.getItem(DB_CLASSES) || '[]');
  if (classes.includes(val)) {
    alert('یہ کلاس پہلے سے لسٹ میں موجود ہے!');
  } else {
    classes.push(val);
    localStorage.setItem(DB_CLASSES, JSON.stringify(classes));
    window.loadClassesList();
    alert(`✅ کلاس "${val}" کامیابی سے لسٹ میں محفوظ ہو گئی!`);
  }
};

window.deleteClassBtn = function () {
  let input = document.getElementById('stu-req-class');
  let val = input.value.trim();
  if (!val) {
    alert('پہلے وہ کلاس منتخب کریں جسے ڈیلیٹ کرنا ہے!');
    return;
  }

  let classes = JSON.parse(localStorage.getItem(DB_CLASSES) || '[]');
  if (!classes.includes(val)) {
    alert('یہ کلاس لسٹ میں موجود نہیں ہے!');
  } else {
    if (confirm(`کیا آپ واقعی کلاس "${val}" کو لسٹ سے ڈیلیٹ کرنا چاہتے ہیں؟`)) {
      classes = classes.filter((c) => c !== val);
      localStorage.setItem(DB_CLASSES, JSON.stringify(classes));
      window.loadClassesList();
      input.value = '';
      alert(`🗑️ کلاس "${val}" لسٹ سے ڈیلیٹ کر دی گئی!`);
    }
  }
};

// =========================================================
// 8. ٹیبل رینڈرنگ (Saved Records Table)
// =========================================================
window._regListState = window._regListState || { page: 1, perPage: 25, q: '' };

function regListIsDesktopUi() {
  try {
    if (window.EMS_DESKTOP_UNLIMITED === true) return true;
    if (window.emsDesktop && window.emsDesktop.isDesktop) return true;
    if (window.location && window.location.search) {
      if (window.location.search.indexOf('desktop=1') >= 0) return true;
      if (window.location.search.indexOf('localBundle=1') >= 0) return true;
    }
  } catch (e) { /* ignore */ }
  if (typeof window.emsIsDesktopEnvironment === 'function') {
    return window.emsIsDesktopEnvironment();
  }
  return false;
}

function regListBuildDesktopRecoveryButtons() {
  var html = '<button class="btn btn-warning btn-sm" id="btn-reg-cloud-sync" type="button" data-ems-cloud-pull="registrations" data-ems-busy-label="ڈاؤن لوڈ…" data-ems-probe-label="براہ کرم انتظار…" title="Firebase سے مکمل رجسٹریشن ڈیٹا بحالی — مقامی IndexedDB کو تبدیل کرتا ہے" aria-label="Firebase cloud recovery download"><i class="fas fa-cloud-download-alt" aria-hidden="true"></i> کلاؤڈ سے بحالی</button>';
  if (regListIsDesktopUi()) {
    html += '<span style="margin:0 8px;"></span>'
      + '<button class="btn btn-outline btn-sm" id="btn-reg-load-disk" type="button" onclick="window.regRepoLoadFromDisk()" title="IndexedDB / ڈسک سے مقامی کیش لوڈ کریں"><i class="fas fa-hdd"></i> Load from Disk</button>';
  }
  return html;
}

window.regRepoLoadFromDisk = function () {
  var tenantId = getAdmissionTenantId();
  if (!tenantId) {
    if (typeof window.showToast === 'function') window.showToast('Tenant ID missing — log in again', 'error');
    return;
  }
  if (typeof window.emsActivateTenantStorage === 'function') {
    window.emsActivateTenantStorage(tenantId);
  }
  if (typeof window.emsRegRepoInit === 'function') {
    window.emsRegRepoInit(tenantId);
  }
  var btn = document.getElementById('btn-reg-load-disk');
  var tbody = document.querySelector('#reg-users-table tbody');
  if (btn) btn.disabled = true;
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;">ڈسک سے لوڈ ہو رہا ہے…</td></tr>';
  }
  var hydrate = (typeof window.emsRegRepoHydrateFullFromIdb === 'function')
    ? window.emsRegRepoHydrateFullFromIdb(tenantId)
    : Promise.resolve({ count: 0, source: 'no_hydrate_fn' });
  hydrate.then(function (res) {
    var count = (typeof window.emsRegRepoGetList === 'function')
      ? window.emsRegRepoGetList().length
      : ((res && res.count) || 0);
    _regListAutoFetchAttempted = true;
    if (typeof window.emsPipelineDebug === 'function') {
      window.emsPipelineDebug('reg_load_from_disk_done', {
        tenantId: tenantId,
        recordCount: count,
        source: res && res.source
      });
    }
    if (typeof window.showToast === 'function') {
      if (count > 0) {
        window.showToast('✅ ڈسک سے لوڈ: ' + count + ' ریکارڈ', 'success');
      } else {
        window.showToast('⚠️ ڈسک پر کوئی کیش نہیں — Cloud Sync (Disaster Recovery) استعمال کریں', 'warning');
      }
    }
    if (typeof window.renderRegTable === 'function') {
      window.renderRegTable();
    } else if (typeof window.regListApplyPager === 'function') {
      window.regListApplyPager(count);
    }
  }).catch(function (err) {
    console.warn('[EMS] regRepoLoadFromDisk failed:', err);
    if (typeof window.showToast === 'function') {
      window.showToast('ڈسک لوڈ ناکام: ' + (err && err.message ? err.message : 'unknown'), 'error');
    }
  }).finally(function () {
    if (btn) btn.disabled = false;
  });
};

function regListBuildPagerHtml(total, users) {
  var pagerParts = [];
  pagerParts.push(regListBuildDesktopRecoveryButtons());
  var hasMore = false;
  try {
    hasMore = typeof window.emsRegRepoHasMore === 'function' && window.emsRegRepoHasMore();
  } catch (hasMoreErr) {
    console.warn('[EMS] emsRegRepoHasMore:', hasMoreErr);
  }
  if (hasMore) {
    pagerParts.push('<button class="btn btn-outline btn-sm" id="btn-reg-load-more" onclick="window.regRepoLoadMore()"><i class="fas fa-plus-circle"></i> ' +
      ((typeof window.emsIsUnlimitedLocalCache === 'function' && window.emsIsUnlimitedLocalCache())
        ? 'مزید لوڈ کریں'
        : ('مزید لوڈ کریں (' + ((typeof window.emsRegRepoPageSize === 'function') ? window.emsRegRepoPageSize() : 50) + ')')) +
      '</button>');
  }
  if (total > 0) {
    var st = window._regListState || { page: 1, perPage: 25, q: '' };
    var perPage = st.perPage || 25;
    var pages = Math.ceil(total / perPage);
    if (st.page > pages) st.page = pages || 1;
    if (st.page < 1) st.page = 1;
    if (pages > 1) {
      var pgHtml = '';
      pgHtml += '<button class="reg-pg-btn" ' + (st.page === 1 ? 'disabled' : '') + ' onclick="window.regListGoPage(' + (st.page - 1) + ')"><i class="fas fa-angle-right"></i></button>';
      var from = Math.max(1, st.page - 2), to = Math.min(pages, st.page + 2);
      if (from > 1) pgHtml += '<button class="reg-pg-btn" onclick="window.regListGoPage(1)">1</button>' + (from > 2 ? '<span class="reg-pg-dots">…</span>' : '');
      for (var p = from; p <= to; p++) {
        pgHtml += '<button class="reg-pg-btn ' + (p === st.page ? 'active' : '') + '" onclick="window.regListGoPage(' + p + ')">' + p + '</button>';
      }
      if (to < pages) pgHtml += (to < pages - 1 ? '<span class="reg-pg-dots">…</span>' : '') + '<button class="reg-pg-btn" onclick="window.regListGoPage(' + pages + ')">' + pages + '</button>';
      pgHtml += '<button class="reg-pg-btn" ' + (st.page === pages ? 'disabled' : '') + ' onclick="window.regListGoPage(' + (st.page + 1) + ')"><i class="fas fa-angle-left"></i></button>';
      pagerParts.push(pgHtml);
    }
  }
  return pagerParts.join('<span style="margin:0 8px;"></span>');
}

function regListSetPagerHtml(total, users) {
  var pagerEl = document.getElementById('reg-list-pager');
  if (!pagerEl) return;
  pagerEl.innerHTML = regListBuildPagerHtml(total != null ? total : 0, users || []);
  if (typeof window.emsCloudPullInitUI === 'function') window.emsCloudPullInitUI();
}

window.regListIsDesktopUi = regListIsDesktopUi;
window.regListBuildPagerHtml = regListBuildPagerHtml;
window.regListBuildDesktopRecoveryButtons = regListBuildDesktopRecoveryButtons;
window.regListApplyPager = function (total) {
  regListSetPagerHtml(total, []);
};

window.regListSearch = function (q) {
  if (_regSearchTimer) clearTimeout(_regSearchTimer);
  var query = (q || '').trim();
  var isExactId = /^(STD|TCH|STF)-/i.test(query);
  var delay = isExactId ? 80 : 200;
  _regSearchTimer = setTimeout(function () {
    window._regListState.q = query.toLowerCase();
    window._regListState.page = 1;

    if (query.length < 2) {
      if (typeof window.emsEnterpriseSearchClear === 'function') {
        window.emsEnterpriseSearchClear();
      } else if (typeof window.emsRegRepoClearSearch === 'function') {
        window.emsRegRepoClearSearch();
      }
      window.renderRegTable();
      return;
    }

    var router = typeof window.emsRegSearchRouter === 'function'
      ? window.emsRegSearchRouter
      : (typeof window.emsEnterpriseSearchRegistrations === 'function'
        ? function (qq) {
            return window.emsEnterpriseSearchRegistrations(qq).then(function (rows) {
              return { rows: rows, source: window.emsEnterpriseSearchGetSource ? window.emsEnterpriseSearchGetSource() : 'cloud' };
            });
          }
        : null);

    if (!router) {
      if (typeof window.emsRegRepoClearSearch === 'function') window.emsRegRepoClearSearch();
      window.renderRegTable();
      return;
    }

    router(query).then(function () {
      window.renderRegTable();
    }).catch(function () {
      if (typeof window.emsRegRepoClearSearch === 'function') window.emsRegRepoClearSearch();
      window.renderRegTable();
    });
  }, delay);
};

window.regListGoPage = function (p) {
  window._regListState.page = p;
  window.renderRegTable();
};

function buildRegFilteredUsers() {
  const filterEl = document.getElementById('reg-list-filter');
  const filterVal = filterEl ? filterEl.value : 'all';
  const st = window._regListState || { page: 1, perPage: 25, q: '' };

  if (typeof window.emsRegRepoGetListPage === 'function') {
    const perPage = st.perPage || 25;
    const offset = Math.max(0, ((st.page || 1) - 1) * perPage);
    return window.emsRegRepoGetListPage({
      offset: offset,
      limit: perPage,
      type: filterVal,
      q: st.q
    });
  }

  let users = typeof window.emsRegRepoGetListReadonly === 'function'
    ? window.emsRegRepoGetListReadonly().slice()
    : (typeof window.emsRegRepoGetList === 'function'
      ? window.emsRegRepoGetList()
      : (typeof window.emsGetUsersMerged === 'function' ? window.emsGetUsersMerged() : []));
  if (!Array.isArray(users)) users = [];

  if (filterVal !== 'all') {
    users = users.filter((u) => u.type === filterVal);
  }

  if (st.q && typeof window.emsRegRepoSearch !== 'function') {
    users = users.filter((u) => {
      const hay = [u.name, u.id, u.cnic, u.phone, u.class, u.designation, u.position, u.fname, u.madrasaRollNo, u.wifaqRollNo]
        .map((x) => String(x || '').toLowerCase()).join(' ');
      return hay.indexOf(st.q) >= 0;
    });
  }

  return { rows: users, total: users.length };
}

function regUserTypeMeta(user) {
  if (user.type === 'student') {
    return {
      badge: '<span style="background:var(--accent);color:white;padding:2px 8px;border-radius:4px;font-size:11px;">طالب علم</span>',
      position: user.class || '-'
    };
  }
  if (user.type === 'teacher') {
    return {
      badge: '<span style="background:var(--success);color:white;padding:2px 8px;border-radius:4px;font-size:11px;">استاذ</span>',
      position: user.designation || '-'
    };
  }
  return {
    badge: '<span style="background:#8e44ad;color:white;padding:2px 8px;border-radius:4px;font-size:11px;">عملہ</span>',
    position: user.position || '-'
  };
}

function renderRegRowHtml(user) {
  var meta = regUserTypeMeta(user);
  let photoHtml = `<i class="fas fa-user-circle" style="color:#bdc3c7; font-size: 35px;"></i>`;
  var photoSrc = typeof window.emsGetUserPhotoSrc === 'function' ? window.emsGetUserPhotoSrc(user) : (user.photoBase64 || user.photoUrl || '');
  if (photoSrc) {
    photoHtml = `<img src="${photoSrc}" style="width: 40px; height: 40px; border-radius: 6px; object-fit: cover; border: 1px solid #cbd5e1;">`;
  }

  return `
            <td>${user.date || '-'}</td>
            <td><strong>${user.name}</strong><br><small style="color:#7f8c8d;">ID: ${user.id}</small> <br>${meta.badge}</td>
            <td>${user.cnic || '-'}</td>
            <td>${meta.position}</td>
            <td>${photoHtml}</td>
            <td class="action-cell">
                <button class="icon-btn reg-m-action-btn icon-only" data-reg-perm="print" style="color: var(--accent); background: #e3f2fd;" onclick="window.openIDCardModal('${user.id}')" title="شناختی کارڈ اور QR"><i class="fas fa-id-badge"></i></button>
                <button class="icon-btn reg-m-action-btn icon-only" data-reg-perm="print" style="color: var(--success); background: #e8f5e9;" onclick="window.openLetterModal('${user.id}')" title="بطاقۃ القبول / تقرر نامہ"><i class="fas fa-envelope-open-text"></i></button>
                <button class="icon-btn edit reg-m-action-btn icon-only" data-reg-perm="edit" style="color: var(--warning); background: #fff3cd;" onclick="window.editRegistration('${user.id}', '${user.type}', false)" title="ترمیم کریں"><i class="fas fa-edit"></i></button>
                <button class="icon-btn delete reg-m-action-btn icon-only" data-reg-perm="delete" style="color: var(--danger); background: #ffebee;" onclick="window.deleteRegistration('${user.id}', false)" title="حذف کریں"><i class="fas fa-trash-alt"></i></button>
            </td>
        `;
}

function renderRegMobileCardHtml(user) {
  var meta = regUserTypeMeta(user);
  var photoSrc = typeof window.emsGetUserPhotoSrc === 'function' ? window.emsGetUserPhotoSrc(user) : (user.photoBase64 || user.photoUrl || '');
  var photoBlock = photoSrc
    ? '<img class="reg-m-card-photo" src="' + photoSrc + '" alt="">'
    : '<div class="reg-m-card-photo-ph"><i class="fas fa-user-circle"></i></div>';
  return '<article class="reg-m-card">' +
    '<div class="reg-m-card-head">' + photoBlock +
    '<div><h3 class="reg-m-card-title">' + (user.name || '-') + '</h3>' +
    '<div class="reg-m-card-meta">ID: ' + (user.id || '-') + '<br>' +
    (user.date || '-') + ' · ' + meta.badge + '<br>CNIC: ' + (user.cnic || '-') + '<br>' + meta.position + '</div></div></div>' +
    '<div class="reg-m-card-actions">' +
    '<button type="button" class="reg-m-action-btn" data-reg-perm="print" style="color:var(--accent);background:#e3f2fd;" onclick="window.openIDCardModal(\'' + user.id + '\')"><i class="fas fa-id-badge"></i> کارڈ</button>' +
    '<button type="button" class="reg-m-action-btn" data-reg-perm="print" style="color:var(--success);background:#e8f5e9;" onclick="window.openLetterModal(\'' + user.id + '\')"><i class="fas fa-envelope-open-text"></i> خط</button>' +
    '<button type="button" class="reg-m-action-btn" data-reg-perm="edit" style="color:var(--warning);background:#fff3cd;" onclick="window.editRegistration(\'' + user.id + '\', \'' + user.type + '\', false)"><i class="fas fa-edit"></i> ترمیم</button>' +
    '<button type="button" class="reg-m-action-btn" data-reg-perm="delete" style="color:var(--danger);background:#ffebee;" onclick="window.deleteRegistration(\'' + user.id + '\', false)"><i class="fas fa-trash-alt"></i> حذف</button>' +
    '</div></article>';
}
window.renderRegMobileCardHtml = renderRegMobileCardHtml;

function renderRegRejectedMobileCardHtml(user) {
  var typeBadge = user.type === 'student' ? 'طالب علم' : (user.type === 'teacher' ? 'استاذ' : 'عملہ');
  return '<article class="reg-m-card">' +
    '<div class="reg-m-card-head"><div class="reg-m-card-photo-ph"><i class="fas fa-user-times"></i></div>' +
    '<div><h3 class="reg-m-card-title">' + (user.name || '-') + '</h3>' +
    '<div class="reg-m-card-meta">ID: ' + (user.id || '-') + '<br>' +
    (user.date || '-') + ' · <span style="background:#e74c3c;color:white;padding:2px 8px;border-radius:4px;font-size:12px;">' + typeBadge + '</span><br>CNIC: ' + (user.cnic || '-') + '<br>' + (user.phone || '-') + '</div></div></div>' +
    '<div class="reg-m-card-actions">' +
    '<button type="button" class="reg-m-action-btn" data-reg-perm="view" style="color:var(--primary);background:#eef2f6;" onclick="window.viewRejectedInfo(\'' + user.id + '\')"><i class="fas fa-eye"></i> تفصیل</button>' +
    '<button type="button" class="reg-m-action-btn" data-reg-perm="approve" style="color:var(--success);background:#e8f5e9;" onclick="window.editRegistration(\'' + user.id + '\', \'' + user.type + '\', true)"><i class="fas fa-undo"></i> بحال</button>' +
    '<button type="button" class="reg-m-action-btn" data-reg-perm="delete" style="color:var(--danger);background:#ffebee;" onclick="window.deleteRegistration(\'' + user.id + '\', true)"><i class="fas fa-trash-alt"></i> حذف</button>' +
    '</div></article>';
}
window.renderRegRejectedMobileCardHtml = renderRegRejectedMobileCardHtml;

function renderRegTableLegacy() {
  try {
  const tbody = document.querySelector('#reg-users-table tbody');
  if (!tbody) return;

  _regFilteredCache = buildRegFilteredUsers();
  var pageData = _regFilteredCache;
  var users, total;
  if (pageData && pageData.rows && pageData.total != null) {
    users = pageData.rows;
    total = pageData.total;
  } else {
    users = Array.isArray(pageData) ? pageData : [];
    total = users.length;
  }

  if (total > 0) {
    _regListAutoFetchAttempted = true;
  }

  if (total === 0 && !_regListAutoFetchAttempted && window.EMS_REBUILD_IN_PROGRESS !== true) {
    if (window.EMS_LITE_LOGIN === true && window.EMS_REPOSITORY_BOOT_COMPLETE !== true) {
      tbody.innerHTML =
        '<tr><td colspan="6" style="text-align:center; padding: 20px;">مقامی ڈیٹا لوڈ ہو رہا ہے…</td></tr>';
      return;
    }
    _regListAutoFetchAttempted = true;
    var countElEarly = document.getElementById('reg-list-count');
    var pagerElEarly = document.getElementById('reg-list-pager');
    if (typeof window.emsVirtualTableDestroy === 'function') window.emsVirtualTableDestroy('reg-users');
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center; padding: 20px;">لوڈ ہو رہا ہے… Cloud Sync (Disaster Recovery) بھی استعمال کر سکتے ہیں</td></tr>';
    if (countElEarly) countElEarly.textContent = '';
    if (pagerElEarly) regListSetPagerHtml(0, users);
    if (typeof window.emsPipelineDebug === 'function') {
      window.emsPipelineDebug('reg_table_empty_auto_fetch', {
        recordCount: 0,
        source: 'auto_retry'
      });
    }
    var offlineFirst = window.EMS_OFFLINE_FIRST_SSOT === true
      || (typeof window.emsIsDesktopEnvironment === 'function' && window.emsIsDesktopEnvironment());
    var retry;
    if (offlineFirst && typeof window.emsRegRepoEnsureHydratedFromIdb === 'function') {
      var tid = (typeof window.emsRequireTenantId === 'function' && window.emsRequireTenantId())
        || (typeof window.emsGetTenantId === 'function' && window.emsGetTenantId())
        || window.CURRENT_MADRASA_TENANT_ID;
      retry = window.emsRegRepoEnsureHydratedFromIdb(tid, { skipFirstLoginCloud: true });
    } else if (typeof window.emsFirebaseLoadListForUI === 'function') {
      retry = window.emsFirebaseLoadListForUI({ force: true });
    } else if (typeof window.emsEnsureRegistrationSync === 'function') {
      retry = window.emsEnsureRegistrationSync();
    } else {
      retry = Promise.resolve();
    }
    retry.then(function (res) {
      if (typeof window.emsPipelineDebug === 'function') {
        window.emsPipelineDebug('reg_table_auto_fetch_done', {
          recordCount: res && res.count != null ? res.count : (typeof window.emsRegRepoGetList === 'function' ? window.emsRegRepoGetList().length : 0),
          source: res && res.source
        });
      }
      window.renderRegTable();
    }).catch(function () {
      window.renderRegTable();
    });
    return;
  }

  const countEl = document.getElementById('reg-list-count');
  const pagerEl = document.getElementById('reg-list-pager');
  const scrollEl = document.querySelector('#reg-list-panel .table-responsive');

  if (total === 0) {
    if (typeof window.emsVirtualTableDestroy === 'function') window.emsVirtualTableDestroy('reg-users');
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center; padding: 20px;">کوئی ریکارڈ موجود نہیں — «کلاؤڈ سے بحالی» بٹن استعمال کریں</td></tr>';
    if (countEl) countEl.textContent = '';
    if (pagerEl) regListSetPagerHtml(0, users);
    return;
  }

  if (countEl) {
    var moreHint = (typeof window.emsRegRepoHasMore === 'function' && window.emsRegRepoHasMore())
      ? ' — مزید دستیاب' : '';
    var dashNote = '';
    if (typeof window.emsGetDashboardStats === 'function') {
      var dst = window.emsGetDashboardStats();
      if (dst && dst.counts && dst.counts.students > total) {
        dashNote = ' (Dashboard کل: ' + dst.counts.students + ' — مزید لوڈ کریں)';
      }
    }
    countEl.innerHTML = 'کل <b>' + total + '</b> ریکارڈ' + dashNote + ((window._regListState && window._regListState.q) ? ' (تلاش)' : '') + moreHint;
  }

  if (typeof window.emsVirtualTableDestroy === 'function') window.emsVirtualTableDestroy('reg-users');

  // Reliable DOM pagination (virtual scroll disabled — caused empty visible rows)
  const st = window._regListState || { page: 1, perPage: 25, q: '' };
  const perPage = st.perPage || 25;
  const pages = Math.ceil(total / perPage);
  if (st.page > pages) st.page = pages || 1;
  if (st.page < 1) st.page = 1;
  const start = (st.page - 1) * perPage;
  const pageUsers = (pageData && pageData.rows && pageData.total != null && typeof window.emsRegRepoGetListPage === 'function')
    ? users
    : users.slice(start, start + perPage);

  tbody.innerHTML = '';
  pageUsers.forEach((user) => {
    if (!user) return;
    const tr = document.createElement('tr');
    tr.innerHTML = renderRegRowHtml(user);
    tbody.appendChild(tr);
  });

  if (typeof window.emsPipelineDebug === 'function') {
    window.emsPipelineDebug('reg_table_render', {
      recordCount: total,
      repoCount: typeof window.emsRegRepoGetList === 'function' ? window.emsRegRepoGetList().length : 0,
      source: 'dom_pagination',
      pageRows: pageUsers.length
    });
  }

  if (pagerEl) {
    regListSetPagerHtml(total, users);
  }

  if (typeof window.emsRegApplyTableActionGuards === 'function') {
    window.emsRegApplyTableActionGuards();
  }
  if (typeof window.emsRegMobileSyncSavedList === 'function') {
    window.emsRegMobileSyncSavedList(pageUsers);
  }

  if (typeof window.sysLayoutApplyTables === 'function') window.sysLayoutApplyTables();
  } catch (err) {
    console.error('[EMS] renderRegTable failed:', err);
    var tbodyErr = document.querySelector('#reg-users-table tbody');
    var pagerErr = document.getElementById('reg-list-pager');
    if (tbodyErr) {
      tbodyErr.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--danger);">لوڈنگ خرابی — console دیکھیں</td></tr>';
    }
    if (pagerErr) {
      try { regListSetPagerHtml(0, []); } catch (e2) { /* ignore */ }
    }
  }
}
window.renderRegTableLegacy = renderRegTableLegacy;

// =========================================================
// 8b. Smart Manager pagination — emsRepo.page() live path
// The saved-records list is paged directly from the decoupled repository
// (IndexedDB now, better-sqlite3/native later) instead of slicing a full
// in-memory array. UI/state/pagination stay 100% decoupled from storage.
// =========================================================
window.EMS_REG_USE_REPO_PAGE = (window.EMS_REG_USE_REPO_PAGE !== false);
var _regRepoRenderToken = 0;

function regRepoActive() {
  return window.EMS_REG_USE_REPO_PAGE !== false
    && window.emsRepo
    && typeof window.emsRepo.page === 'function';
}

function regRepoUseTenant() {
  if (window.emsRepo && typeof window.emsRepo.useTenant === 'function') {
    var tid = (typeof getAdmissionTenantId === 'function' && getAdmissionTenantId())
      || (typeof window.emsRequireTenantId === 'function' && window.emsRequireTenantId())
      || window.CURRENT_MADRASA_TENANT_ID || null;
    if (tid) window.emsRepo.useTenant(tid);
  }
}

function regGetTypeFilter() {
  var el = document.getElementById('reg-list-filter');
  return el ? el.value : 'all';
}

// One-time cold-start seed: the registration repository mirrors every add/edit/
// delete into emsRepo INCREMENTALLY (per-record put/remove) and bulk-seeds on
// hydrate. This helper only covers the edge case where emsRepo is still empty
// but the in-memory SSOT already has rows (e.g. data loaded before emsRepo was
// ready). It NEVER clears or rewrites the whole collection — that would defeat
// the incremental design required to scale to 1,000,000 records.
function emsRegEnsureRepoSeeded() {
  if (!regRepoActive() || typeof window.emsRepo.count !== 'function') {
    return Promise.resolve(false);
  }
  regRepoUseTenant();
  return window.emsRepo.count('registrations').then(function (n) {
    if (n > 0) return false; // already populated (incremental mirror keeps it fresh)
    var list = typeof window.emsRegRepoGetList === 'function' ? window.emsRegRepoGetList() : [];
    if (!Array.isArray(list) || !list.length) return false;
    if (typeof window.emsRepo.bulkPut !== 'function') return false;
    return window.emsRepo.bulkPut('registrations', list).then(function () { return true; });
  }).catch(function (e) {
    console.warn('[EMS] reg repo seed failed:', e);
    return false;
  });
}
window.emsRegEnsureRepoSeeded = emsRegEnsureRepoSeeded;

function regRenderRows(rows) {
  var tbody = document.querySelector('#reg-users-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  (rows || []).forEach(function (user) {
    if (!user) return;
    var tr = document.createElement('tr');
    tr.innerHTML = renderRegRowHtml(user);
    tbody.appendChild(tr);
  });
}

function regSearchSourceBadge() {
  var src = typeof window.emsEnterpriseSearchGetSource === 'function'
    ? window.emsEnterpriseSearchGetSource()
    : '';
  if (!src || src === 'none') return '';
  var labels = {
    typesense: '☁️ Cloud',
    firestore: '☁️ Cloud',
    'firestore-client': '☁️ Cloud',
    cache: '⚡ کیش',
    'id-direct': '⚡ ID',
    'local-index': '📴 آف لائن'
  };
  var label = labels[src] || src;
  return ' <span class="reg-search-source" style="font-size:12px;color:#64748b;">(' + label + ')</span>';
}

function regUpdateCount(total) {
  var countEl = document.getElementById('reg-list-count');
  if (!countEl) return;
  var note = (window._regListState && window._regListState.q) ? ' (تلاش)' : '';
  countEl.innerHTML = 'کل <b>' + (Number(total) || 0).toLocaleString() + '</b> ریکارڈ' + note + regSearchSourceBadge();
}

// ---- Infinite local scroll (strictly emsRepo.page — zero Firebase) ------------
var REG_INFINITE_INITIAL = 100;
var REG_INFINITE_BATCH = 50;
var _regInfinite = {
  rows: [],
  total: 0,
  offset: 0,
  loading: false,
  hasMore: false,
  observer: null,
  renderToken: 0
};

function regInfiniteTeardown() {
  if (_regInfinite.observer) {
    try { _regInfinite.observer.disconnect(); } catch (e) { /* ignore */ }
    _regInfinite.observer = null;
  }
}

function regInfiniteBuildPageOpts(offset, limit) {
  var st = window._regListState || { q: '' };
  var typeFilter = regGetTypeFilter();
  var filter = (typeFilter && typeFilter !== 'all') ? { type: typeFilter } : null;
  var search = st.q
    ? { text: st.q, fields: ['name', 'id', 'cnic', 'phone', 'class', 'designation', 'position', 'fname'] }
    : null;
  return {
    offset: offset || 0,
    limit: limit || REG_INFINITE_BATCH,
    filter: filter,
    search: search,
    sort: { field: 'timestamp', dir: 'desc' }
  };
}

function regInfiniteEnsureSentinel(tbody) {
  if (!tbody) return null;
  var sentinel = document.getElementById('reg-infinite-sentinel');
  if (!sentinel) {
    sentinel = document.createElement('tr');
    sentinel.id = 'reg-infinite-sentinel';
    sentinel.innerHTML = '<td colspan="6" style="height:2px;padding:0;border:none;background:transparent;"></td>';
  }
  tbody.appendChild(sentinel);
  return sentinel;
}

function regInfiniteAppendRows(rows) {
  var tbody = document.querySelector('#reg-users-table tbody');
  if (!tbody) return;
  var sentinel = document.getElementById('reg-infinite-sentinel');
  (rows || []).forEach(function (user) {
    if (!user) return;
    var tr = document.createElement('tr');
    tr.innerHTML = renderRegRowHtml(user);
    if (sentinel && sentinel.parentNode === tbody) {
      tbody.insertBefore(tr, sentinel);
    } else {
      tbody.appendChild(tr);
    }
  });
  regInfiniteEnsureSentinel(tbody);
  if (typeof window.emsRegApplyTableActionGuards === 'function') {
    window.emsRegApplyTableActionGuards(document.getElementById('module-admission'));
  }
  if (typeof window.emsRegMobileSyncSavedList === 'function') {
    window.emsRegMobileSyncSavedList(_regInfinite.rows && _regInfinite.rows.length ? _regInfinite.rows : rows);
  }
}

function regInfiniteUpdateStatus() {
  var pagerEl = document.getElementById('reg-list-pager');
  if (!pagerEl) return;
  var inf = _regInfinite;
  var parts = [regListBuildDesktopRecoveryButtons()];
  var idxSt = window.__emsSearchIndexStatus;
  if (idxSt && idxSt.pending && !idxSt.complete) {
    var pct = idxSt.percent != null ? (' (' + idxSt.percent + '%)') : '';
    parts.push('<span style="font-size:12px;color:#b45309;">تلاش انڈیکس: <b>'
      + (idxSt.processed || 0).toLocaleString() + '</b>'
      + (idxSt.total ? ' / ' + idxSt.total.toLocaleString() : '')
      + pct + '…</span>');
  }
  if (inf.total > 0) {
    parts.push('<span style="font-size:13px;color:#64748b;">نمایاں: <b>'
      + inf.rows.length.toLocaleString() + '</b> / <b>' + inf.total.toLocaleString() + '</b>'
      + (inf.loading ? ' — لوڈ…' : (inf.hasMore ? '' : ' (تمام)')) + '</span>');
  }
  pagerEl.innerHTML = parts.join('<span style="margin:0 8px;"></span>');
  if (typeof window.emsCloudPullInitUI === 'function') window.emsCloudPullInitUI();
}

function regInfiniteEnsureObserver() {
  var scrollEl = document.querySelector('#reg-list-panel .table-responsive');
  if (!scrollEl || typeof IntersectionObserver === 'undefined') return;
  regInfiniteTeardown();
  var sentinel = document.getElementById('reg-infinite-sentinel');
  if (!sentinel) return;
  _regInfinite.observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) window.regInfiniteLoadMoreLocal();
    });
  }, { root: scrollEl, rootMargin: '160px', threshold: 0 });
  _regInfinite.observer.observe(sentinel);
}

window.regInfiniteLoadMoreLocal = function () {
  var inf = _regInfinite;
  if (inf.loading || !inf.hasMore) return Promise.resolve();
  var token = inf.renderToken;
  inf.loading = true;
  regInfiniteUpdateStatus();
  regRepoUseTenant();
  return window.emsRepo.page('registrations', regInfiniteBuildPageOpts(inf.offset, REG_INFINITE_BATCH))
    .then(function (res) {
      if (token !== inf.renderToken) return;
      var batch = (res && res.rows) || [];
      inf.total = (res && res.total != null) ? res.total : inf.total;
      batch.forEach(function (r) { inf.rows.push(r); });
      regInfiniteAppendRows(batch);
      inf.offset += batch.length;
      inf.hasMore = inf.offset < inf.total && batch.length > 0;
      inf.loading = false;
      regUpdateCount(inf.total);
      regInfiniteUpdateStatus();
    })
    .catch(function (err) {
      console.warn('[EMS] regInfiniteLoadMoreLocal:', err);
      inf.loading = false;
      regInfiniteUpdateStatus();
    });
};

function renderRegTableFromSearchOverlay(token) {
  var tbody = document.querySelector('#reg-users-table tbody');
  if (!tbody) return Promise.resolve();
  var rows = typeof window.emsRegRepoGetSearchResults === 'function'
    ? window.emsRegRepoGetSearchResults()
    : (typeof window.emsRegRepoGetListReadonly === 'function' ? window.emsRegRepoGetListReadonly() : []);
  var typeFilter = regGetTypeFilter();
  if (typeFilter && typeFilter !== 'all') {
    rows = (rows || []).filter(function (u) { return u && u.type === typeFilter; });
  }
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;">اس فلٹر/تلاش پر کوئی ریکارڈ نہیں</td></tr>';
    regUpdateCount(0);
    regInfiniteUpdateStatus();
    if (typeof window.emsRegMobileSyncSavedList === 'function') window.emsRegMobileSyncSavedList([]);
    return Promise.resolve();
  }
  _regInfinite.rows = rows.slice();
  _regInfinite.total = rows.length;
  _regInfinite.offset = rows.length;
  _regInfinite.hasMore = false;
  _regInfinite.loading = false;
  regInfiniteAppendRows(rows);
  regUpdateCount(rows.length);
  regInfiniteUpdateStatus();
  if (typeof window.sysLayoutApplyTables === 'function') window.sysLayoutApplyTables();
  return Promise.resolve();
}

function renderRegTableViaRepo() {
  var tbody = document.querySelector('#reg-users-table tbody');
  if (!tbody) return Promise.resolve();
  var token = ++_regRepoRenderToken;
  regRepoUseTenant();
  regInfiniteTeardown();
  _regInfinite.rows = [];
  _regInfinite.total = 0;
  _regInfinite.offset = 0;
  _regInfinite.loading = false;
  _regInfinite.hasMore = false;
  _regInfinite.renderToken = token;

  if (typeof window.emsVirtualTableDestroy === 'function') window.emsVirtualTableDestroy('reg-users');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;">لوڈ ہو رہا ہے…</td></tr>';

  if (typeof window.emsRegRepoIsSearchActive === 'function' && window.emsRegRepoIsSearchActive()) {
    return renderRegTableFromSearchOverlay(token);
  }

  return emsRegEnsureRepoSeeded().then(function () {
    regRepoUseTenant();
    return window.emsRepo.page('registrations', regInfiniteBuildPageOpts(0, REG_INFINITE_INITIAL));
  }).then(function (res) {
    if (token !== _regRepoRenderToken) return;
    if (!res) { return renderRegTableLegacy(); }
    var baseTotal = res.total != null ? res.total : (res.rows || []).length;
    if (!baseTotal) { return renderRegTableLegacy(); }
    _regInfinite.total = baseTotal;
    var batch = res.rows || [];
    if (res.total != null) _regInfinite.total = res.total;
    _regInfinite.rows = batch.slice();
    _regInfinite.offset = batch.length;
    _regInfinite.hasMore = _regInfinite.offset < _regInfinite.total && batch.length > 0;
    tbody.innerHTML = '';
    if (!batch.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;">اس فلٹر/تلاش پر کوئی ریکارڈ نہیں</td></tr>';
      regUpdateCount(0);
      regInfiniteUpdateStatus();
      return;
    }
    _regListAutoFetchAttempted = true;
    regInfiniteAppendRows(batch);
    regUpdateCount(_regInfinite.total);
    regInfiniteUpdateStatus();
    regInfiniteEnsureObserver();
    if (typeof window.emsPipelineDebug === 'function') {
      window.emsPipelineDebug('reg_table_render', {
        recordCount: _regInfinite.total,
        source: 'emsRepo.infinite',
        pageRows: batch.length,
        loaded: _regInfinite.offset
      });
    }
    if (typeof window.sysLayoutApplyTables === 'function') window.sysLayoutApplyTables();
  }).catch(function (err) {
    console.error('[EMS] renderRegTableViaRepo failed:', err);
    return renderRegTableLegacy();
  });
}
window.renderRegTableViaRepo = renderRegTableViaRepo;

// The actual renderer (routes to emsRepo page path or legacy fallback).
window.renderRegTableImmediate = function () {
  if (regRepoActive()) {
    return renderRegTableViaRepo();
  }
  return renderRegTableLegacy();
};

// Coalesced public entry: many listeners (users-changed / repo-hydrated /
// registration-ready / department refresh / search / pagination) can fire in
// the same tick. Collapse them into ONE render per animation frame so a single
// data change never triggers a storm of full table rebuilds.
(function () {
  var _scheduled = false;
  function _raf(cb) {
    return (typeof window.requestAnimationFrame === 'function')
      ? window.requestAnimationFrame(cb)
      : setTimeout(cb, 16);
  }
  window.renderRegTable = function () {
    var admissionActive = typeof window.emsIsAdmissionModuleActive === 'function'
      ? window.emsIsAdmissionModuleActive()
      : !!document.querySelector('#module-admission.active');
    if (!admissionActive) return;
    if (_scheduled) return;
    _scheduled = true;
    _raf(function () {
      _scheduled = false;
      try { window.renderRegTableImmediate(); } catch (e) { /* ignore */ }
    });
  };
})();

// =========================================================
// 9. مسترد شدہ ریکارڈ کی ٹیبل اور فنکشنز (Rejected History)
// =========================================================
window.renderRejectedTable = function () {
  const tbody = document.querySelector('#reg-rejected-table tbody');
  if (!tbody) return;

  const countEl = document.getElementById('reg-rejected-count');
  const pagerEl = document.getElementById('reg-rejected-pager');

  if (typeof window.emsRegRepoIsRejectedLoading === 'function' && window.emsRegRepoIsRejectedLoading()) {
    if (countEl) countEl.textContent = 'لوڈ ہو رہا ہے…';
    return;
  }

  let rejectedUsers = typeof window.emsRegRepoGetRejectedList === 'function'
    ? window.emsRegRepoGetRejectedList()
    : [];

  if (typeof window.emsFilterByDepartment === 'function') {
    rejectedUsers = window.emsFilterByDepartment(rejectedUsers);
  }

  rejectedUsers = rejectedUsers.slice().reverse();
  window._regRejectedCache = rejectedUsers;
  const total = rejectedUsers.length;

  if (total === 0) {
    if (typeof window.emsVirtualTableDestroy === 'function') window.emsVirtualTableDestroy('reg-rejected');
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center; padding: 20px; font-weight: bold; color: var(--danger);">کوئی مسترد شدہ ریکارڈ موجود نہیں</td></tr>';
    if (countEl) countEl.textContent = '';
    if (pagerEl) pagerEl.innerHTML = '';
    return;
  }

  if (countEl) {
    var moreHint = (typeof window.emsRegRepoHasMoreRejected === 'function' && window.emsRegRepoHasMoreRejected())
      ? ' — مزید دستیاب' : '';
    countEl.innerHTML = 'کل <b>' + total + '</b> مسترد ریکارڈ' + moreHint + ' — virtual scroll';
  }
  if (pagerEl) {
    if (typeof window.emsRegRepoHasMoreRejected === 'function' && window.emsRegRepoHasMoreRejected()) {
      pagerEl.innerHTML = '<button class="btn btn-outline btn-sm" id="btn-reg-rejected-load-more" onclick="window.regRepoLoadMoreRejected()"><i class="fas fa-plus-circle"></i> ' +
        ((typeof window.emsIsUnlimitedLocalCache === 'function' && window.emsIsUnlimitedLocalCache())
          ? 'مزید لوڈ کریں'
          : ('مزید لوڈ کریں (' + ((typeof window.emsRegRepoPageSize === 'function') ? window.emsRegRepoPageSize() : 50) + ')')) +
        '</button>';
    } else {
      pagerEl.innerHTML = '';
    }
  }

  const scrollEl = document.querySelector('#reg-rejected-panel .table-responsive');
  if (scrollEl && typeof window.emsVirtualTableMount === 'function') {
    if (!scrollEl.style.maxHeight) scrollEl.style.maxHeight = '58vh';
    scrollEl.style.overflowY = 'auto';
    window.emsVirtualTableMount('reg-rejected', {
      scrollEl: scrollEl,
      tbody: tbody,
      rowHeight: 52,
      getData: function () { return window._regRejectedCache || []; },
      renderRow: function (i, user) {
        let typeBadge = '';
        if (user.type === 'student') typeBadge = 'طالب علم';
        else if (user.type === 'teacher') typeBadge = 'استاذ';
        else typeBadge = 'عملہ';
        var tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${user.date || '-'}</td>
            <td><strong>${user.name}</strong><br><small>آئی ڈی: ${user.id}</small></td>
            <td>${user.cnic || '-'}</td>
            <td>${user.phone || '-'}</td>
            <td><span style="background:#e74c3c;color:white;padding:3px 8px;border-radius:4px;font-size:12px;">${typeBadge}</span></td>
            <td class="action-cell">
                <button class="icon-btn" data-reg-perm="view" style="color: var(--primary); background: #eef2f6; padding: 6px; border-radius: 4px;" onclick="window.viewRejectedInfo('${user.id}')" title="تفصیل دیکھیں"><i class="fas fa-eye"></i></button>
                <button class="icon-btn edit" data-reg-perm="approve" style="color: var(--success); background: #e8f5e9; padding: 6px; border-radius: 4px;" onclick="window.editRegistration('${user.id}', '${user.type}', true)" title="فارم میں لائیں اور بحال (Restore) کریں"><i class="fas fa-undo"></i></button>
                <button class="icon-btn delete" data-reg-perm="delete" style="color: var(--danger); background: #ffebee; padding: 6px; border-radius: 4px;" onclick="window.deleteRegistration('${user.id}', true)" title="مستقل حذف کریں"><i class="fas fa-trash-alt"></i></button>
            </td>`;
        return tr;
      },
      emptyHtml: '<tr><td colspan="6" style="text-align:center;padding:20px;font-weight:bold;color:var(--danger);">کوئی مسترد شدہ ریکارڈ موجود نہیں</td></tr>'
    });
    if (typeof window.sysLayoutApplyTables === 'function') window.sysLayoutApplyTables();
    if (typeof window.emsRegMobileSyncRejectedList === 'function') {
      window.emsRegMobileSyncRejectedList(window._regRejectedCache || []);
    }
    return;
  }

  tbody.innerHTML = '';
  rejectedUsers.forEach((user) => {
    const tr = document.createElement('tr');

    let typeBadge = '';
    if (user.type === 'student') typeBadge = 'طالب علم';
    else if (user.type === 'teacher') typeBadge = 'استاذ';
    else typeBadge = 'عملہ';

    tr.innerHTML = `
            <td>${user.date || '-'}</td>
            <td><strong>${user.name}</strong><br><small>آئی ڈی: ${
      user.id
    }</small></td>
            <td>${user.cnic || '-'}</td>
            <td>${user.phone || '-'}</td>
            <td><span style="background:#e74c3c;color:white;padding:3px 8px;border-radius:4px;font-size:12px;">${typeBadge}</span></td>

            <td class="action-cell">
                <button class="icon-btn" style="color: var(--primary); background: #eef2f6; padding: 6px; border-radius: 4px;" onclick="window.viewRejectedInfo('${
                  user.id
                }')" title="تفصیل دیکھیں"><i class="fas fa-eye"></i></button>
                <button class="icon-btn edit" style="color: var(--success); background: #e8f5e9; padding: 6px; border-radius: 4px;" onclick="window.editRegistration('${
                  user.id
                }', '${
      user.type
    }', true)" title="فارم میں لائیں اور بحال (Restore) کریں"><i class="fas fa-undo"></i></button>
                <button class="icon-btn delete" style="color: var(--danger); background: #ffebee; padding: 6px; border-radius: 4px;" onclick="window.deleteRegistration('${
                  user.id
                }', true)" title="مستقل حذف کریں"><i class="fas fa-trash-alt"></i></button>
            </td>
        `;
    tbody.appendChild(tr);
  });
  if (typeof window.emsRegApplyTableActionGuards === 'function') window.emsRegApplyTableActionGuards();
  if (typeof window.emsRegMobileSyncRejectedList === 'function') {
    window.emsRegMobileSyncRejectedList(rejectedUsers);
  }
  if (typeof window.sysLayoutApplyTables === 'function') window.sysLayoutApplyTables();
};

window.viewRejectedInfo = function (id) {
  var showDetails = function (user) {
    if (!user) return;
    let details = `مسترد شدہ امیدوار کی تفصیل:\n\nنام: ${user.name}\nآئی ڈی: ${
      user.id
    }\nفون: ${user.phone || '-'}\nشناختی کارڈ: ${user.cnic || '-'}`;
    if (user.type === 'student') details += `\nدرجہ: ${user.class || '-'}`;
    if (user.type === 'teacher')
      details += `\nعہدہ: ${user.designation || '-'}\nسابقہ تجربہ: ${
        user.expInstitute || '-'
      }`;
    alert(details);
  };
  if (typeof window.emsRegRepoGetById === 'function') {
    window.emsRegRepoGetById(id, true).then(showDetails);
    return;
  }
  if (typeof window.emsGetUserById === 'function') {
    window.emsGetUserById(id, true).then(showDetails);
    return;
  }
  alert('ریکارڈ نہیں ملا — ریپوزٹری تیار نہیں');
};

window.clearRejectedHistory = function () {
  if (confirm('کیا آپ واقعی پوری مسترد شدہ ہسٹری (Rejected Records) کو ہمیشہ کے لیے ڈیلیٹ کرنا چاہتے ہیں؟ یہ عمل واپس نہیں ہو سکتا!')) {
    let uid = getAdmissionTenantId();
    if (!uid) return;

    var done = function () {
      alert('ہسٹری مکمل طور پر صاف کر دی گئی ہے۔');
      if (document.getElementById('reg-rejected-table')) window.renderRejectedTable();
    };

    if (typeof window.emsRegRepoClearAllRejected === 'function') {
      window.emsRegRepoClearAllRejected().then(done);
      return;
    }

    alert('خرابی: ریپوزٹری لوڈ نہیں — صفحہ ریفریش کریں۔');
  }
};

// =========================================================
// 10. یونیورسل ایڈیٹ اور ڈیلیٹ لاجک (Firebase Cloud Delete)
// =========================================================
window.deleteRegistration = function (id, fromRejected = false) {
  if (typeof window.emsRegRequire === 'function' && !window.emsRegRequire('delete', { id: id, fromRejected: fromRejected })) {
    return;
  }
  if (confirm('کیا آپ واقعی یہ ریکارڈ مستقل طور پر حذف (Delete) کرنا چاہتے ہیں؟')) {
    let uid = getAdmissionTenantId();
    if (!uid) return alert("خرابی: جی میل کنکشن موجود نہیں!");

    var beforeDeletePromise = (typeof window.emsRegGetRecordById === 'function')
      ? window.emsRegGetRecordById(id, { fromRejected: fromRejected })
      : Promise.resolve(null);

    function afterLocalDelete(res) {
      if (fromRejected && document.getElementById('reg-rejected-table')) window.renderRejectedTable();
      else if (document.getElementById('reg-users-table')) window.renderRegTable();
      if (res && res.offline && !res.synced && typeof window.showToast === 'function') {
        window.showToast('📴 آف لائن حذف — انٹرنیٹ پر sync ہو گا', 'warning');
      }
      alert('ریکارڈ کامیابی سے ڈیلیٹ کر دیا گیا!');
    }

    function logDeleteAudit(before) {
      if (typeof window.emsRegLogAudit !== 'function') return;
      window.emsRegLogAudit('delete', id, {
        entityType: before && before.type,
        source: 'form',
        fromRejected: fromRejected,
        beforeSummary: typeof window.emsRegAuditSummarizeRecord === 'function'
          ? window.emsRegAuditSummarizeRecord(before)
          : null
      });
    }

    if (admissionRegistrationSsotEnabled() && typeof window.emsRegRepoDeleteRegistration === 'function') {
      beforeDeletePromise.then(function (before) {
        window.emsRegRepoDeleteRegistration(id, fromRejected).then(function (res) {
          if (!res || !res.ok) {
            alert('ڈیلیٹ نہیں ہوا — دوبارہ کوشش کریں۔');
            return;
          }
          logDeleteAudit(before);
          afterLocalDelete(res);
        }).catch(function (error) {
          alert('ڈیلیٹ کرنے میں مسئلہ آیا: ' + (error && error.message ? error.message : error));
        });
      });
      return;
    }

    function afterLegacyRepoDelete(before) {
      if (typeof window.emsRegRepoRemove === 'function') {
        window.emsRegRepoRemove(id, fromRejected);
      }
      logDeleteAudit(before);
      afterLocalDelete();
    }

    if (typeof window.emsOfflineDeleteRegistration === 'function') {
      beforeDeletePromise.then(function (before) {
        window.emsOfflineDeleteRegistration(id, fromRejected).then(function (res) {
          if (!res || !res.ok) {
            alert('ڈیلیٹ نہیں ہوا — دوبارہ کوشش کریں۔');
            return;
          }
          afterLegacyRepoDelete(before);
        }).catch(function (error) {
          alert('ڈیلیٹ کرنے میں مسئلہ آیا: ' + (error && error.message ? error.message : error));
        });
      });
      return;
    }

    alert('خرابی: سنک outbox تیار نہیں — صفحہ دوبارہ لوڈ کریں۔');
  }
};

window.editRegistration = function (id, type, fromRejected = false) {
  var editPerm = fromRejected ? 'approve' : 'edit';
  if (typeof window.emsRegRequire === 'function' && !window.emsRegRequire(editPerm, { id: id, fromRejected: fromRejected })) {
    return;
  }
  var loadPromise;
  if (typeof window.emsRegGetRecordById === 'function') {
    loadPromise = window.emsRegGetRecordById(id, { fromRejected: fromRejected });
  } else if (typeof window.emsGetUserById === 'function') {
    loadPromise = window.emsGetUserById(id, fromRejected);
  } else if (typeof window.emsRegRepoGetById === 'function') {
    loadPromise = window.emsRegRepoGetById(id, fromRejected);
  } else {
    loadPromise = Promise.resolve(null);
  }

  loadPromise.then(function (user) {
  if (!user) {
    alert('ریکارڈ نہیں ملا — تلاش کریں یا مزید لوڈ کریں');
    return;
  }

  currentEditingId = id;
  isEditingRejected = fromRejected;
  currentUploadedImageBase64 = typeof window.emsGetUserPhotoSrc === 'function'
    ? window.emsGetUserPhotoSrc(user)
    : (user.photoBase64 || user.photoUrl || '');

  function applyPhotoPreview(src) {
    if (!src) return;
    currentUploadedImageBase64 = src;
    let prefix = type === 'student' ? 'stu' : type === 'teacher' ? 'tch' : 'stf';
    let imgPreview = document.getElementById(`${prefix}-photo-preview`);
    if (imgPreview) {
      imgPreview.src = src;
      imgPreview.style.display = 'block';
      regPhotoTogglePlaceholder(imgPreview, false);
    }
  }

  if (!currentUploadedImageBase64 && user.hasPhoto && typeof window.emsFetchRegistrationPhoto === 'function') {
    window.emsFetchRegistrationPhoto(id, fromRejected).then(applyPhotoPreview);
  }

  let btnId = type === 'student' ? 0 : type === 'teacher' ? 1 : 2;
  let ribbonBtns = document.querySelectorAll('#reg-ribbon-menu .reg-tab, #reg-ribbon-menu .btn');
  window.switchRegTab(`reg-${type}-panel`, ribbonBtns[btnId]);

  // ---- ڈیٹا فارم میں بھرنا ----
  if (type === 'student') {
    document.getElementById('stu-form-no').value = user.id;
    document.getElementById('stu-reg-date').value = user.date || '';
    document.getElementById('stu-name').value = user.name || '';
    document.getElementById('stu-fname').value = user.fname || '';
    if (typeof window.emsRegUpdateCombinedName === 'function') window.emsRegUpdateCombinedName('stu');
    document.getElementById('stu-cnic').value = user.cnic || '';
    document.getElementById('stu-mobile').value = user.phone || '';
    document.getElementById('stu-dob').value = user.dob || '';
    document.getElementById('stu-blood-group').value = user.bloodGroup || '';
    document.getElementById('stu-req-class').value = user.class || '';
    document.getElementById('stu-branch').value = user.branch || '';
    document.getElementById('stu-adm-type').value = user.admType || 'نیا';
    document.getElementById('stu-res-type').value = user.resType || '';
    document.getElementById('stu-madrasa-roll').value = user.madrasaRollNo || '';
    document.getElementById('stu-wifaq-roll').value = user.wifaqRollNo || '';
    document.getElementById('stu-address').value = user.address || '';
    document.getElementById('stu-grd-name').value = user.grdName || '';
    document.getElementById('stu-grd-relation').value = user.grdRelation || '';
    document.getElementById('stu-grd-profession').value =
      user.grdProfession || '';
    document.getElementById('stu-grd-mobile').value = user.grdMobile || '';
    document.getElementById('stu-grd-cnic').value = user.grdCnic || '';
    document.getElementById('stu-grd-emergency').value =
      user.grdEmergency || '';
    document.getElementById('stu-prev-class').value = user.prevClass || '';
    document.getElementById('stu-prev-marks').value = user.prevMarks || '';
    document.getElementById('stu-prev-grade').value = user.prevGrade || '';
    document.getElementById('stu-prev-year').value = user.prevYear || '';
    document.getElementById('stu-prev-institute').value =
      user.prevInstitute || '';
    document.getElementById('stu-office-nazra').value = user.officeNazra || '';
    document.getElementById('stu-office-namaz').value = user.officeNamaz || '';
    document.getElementById('stu-office-test').value = user.officeTest || '';
    document.getElementById('stu-office-remarks').value =
      user.officeRemarks || '';
    document.getElementById('stu-office-examiner').value =
      user.officeExaminer || '';
  } else if (type === 'teacher') {
    document.getElementById('tch-emp-id').value = user.id;
    document.getElementById('tch-reg-date').value = user.date || '';
    document.getElementById('tch-name').value = user.name || '';
    document.getElementById('tch-fname').value = user.fname || '';
    if (typeof window.emsRegUpdateCombinedName === 'function') window.emsRegUpdateCombinedName('tch');
    document.getElementById('tch-dob').value = user.dob || '';
    document.getElementById('tch-cnic').value = user.cnic || '';
    document.getElementById('tch-blood-group').value = user.bloodGroup || '';
    document.getElementById('tch-marital').value = user.marital || 'شادی شدہ';
    document.getElementById('tch-mobile').value = user.phone || '';
    document.getElementById('tch-whatsapp').value = user.whatsapp || '';
    document.getElementById('tch-email').value = user.email || '';
    document.getElementById('tch-address').value = user.address || '';
    document.getElementById('tch-designation').value = user.designation || '';
    document.getElementById('tch-department').value = user.department || '';
    document.getElementById('tch-shift').value = user.shift || '';
    document.getElementById('tch-salary').value = user.salary || '';
    document.getElementById('tch-residence').value = user.residence || 'نہیں';
    document.getElementById('tch-food').value = user.food || 'نہیں';
    document.getElementById('tch-exp-institute').value =
      user.expInstitute || '';
    document.getElementById('tch-exp-designation').value =
      user.expDesignation || '';
    document.getElementById('tch-exp-duration').value = user.expDuration || '';
    document.getElementById('tch-exp-reason').value = user.expReason || '';
    document.getElementById('tch-office-demo').value = user.officeDemo || '';
    document.getElementById('tch-office-nazim').value = user.officeNazim || '';
  } else if (type === 'staff') {
    document.getElementById('stf-emp-id').value = user.id;
    document.getElementById('stf-reg-date').value = user.date || '';
    document.getElementById('stf-name').value = user.name || '';
    document.getElementById('stf-fname').value = user.fname || '';
    if (typeof window.emsRegUpdateCombinedName === 'function') window.emsRegUpdateCombinedName('stf');
    document.getElementById('stf-dob').value = user.dob || '';
    document.getElementById('stf-cnic').value = user.cnic || '';
    document.getElementById('stf-position').value = user.position || '';
    document.getElementById('stf-mobile').value = user.phone || '';
    document.getElementById('stf-address').value = user.address || '';
    document.getElementById('stf-gua-name').value = user.guaName || '';
    document.getElementById('stf-gua-cnic').value = user.guaCnic || '';
    document.getElementById('stf-gua-mobile').value = user.guaMobile || '';
    document.getElementById('stf-gua-relation').value = user.guaRelation || '';
    document.getElementById('stf-gua-address').value = user.guaAddress || '';
    document.getElementById('stf-exp-details').value = user.expDetails || '';
    document.getElementById('stf-health-issue').value = user.healthIssue || '';
    document.getElementById('stf-office-salary').value = user.salary || '';
    document.getElementById('stf-office-shift').value = user.shift || '';
    document.getElementById('stf-office-nazim').value = user.officeNazim || '';
  }

  if (typeof window.sysFieldPopulate === 'function') window.sysFieldPopulate(type, user);

  let prefix = type === 'student' ? 'stu' : type === 'teacher' ? 'tch' : 'stf';
  var editPhotoSrc = typeof window.emsGetUserPhotoSrc === 'function'
    ? window.emsGetUserPhotoSrc(user)
    : (user.photoBase64 || user.photoUrl || '');
  if (editPhotoSrc) {
    let imgPreview = document.getElementById(`${prefix}-photo-preview`);
    if (imgPreview) {
      imgPreview.src = editPhotoSrc;
      imgPreview.style.display = 'block';
      regPhotoTogglePlaceholder(imgPreview, false);
    }
  }

  // بٹنز کا نام بدلنا
  let btnApprove = document.getElementById(`btn-${prefix}-approve`);
  if (fromRejected) {
    btnApprove.innerHTML =
      '<i class="fas fa-undo"></i> اپروو کریں (اور مین لسٹ میں بحال کریں)';
  } else {
    btnApprove.innerHTML =
      '<i class="fas fa-save"></i> تبدیلیاں محفوظ کریں (Update)';
  }

  document.getElementById(`btn-${prefix}-cancel-edit`).style.display =
    'inline-flex';
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (fromRejected) {
    alert(
      'یہ مسترد شدہ امیدوار کا فارم ہے۔ اگر آپ اسے منظور (Approve) کریں گے تو یہ دوبارہ مین ریکارڈ میں بحال ہو جائے گا۔'
    );
  }
  });
};

// =========================================================
// 11. ماڈیول init — lazy load safe (no DOMContentLoaded)
// =========================================================
function initializeRegistrationModule() {
  window.resetRegForm('student');
  window.resetRegForm('teacher');
  window.resetRegForm('staff');

  bindRegPhotoUploads('stu');
  bindRegPhotoUploads('tch');
  bindRegPhotoUploads('stf');

  const btnStuApprove = document.getElementById('btn-stu-approve');
  const btnStuReject = document.getElementById('btn-stu-reject');
  const btnStuCancel = document.getElementById('btn-stu-cancel-edit');
  if (btnStuApprove && !btnStuApprove._emsBound)
    btnStuApprove.addEventListener('click', () =>
      window.processRegistration('student', 'approved')
    );
  if (btnStuApprove) btnStuApprove._emsBound = true;
  if (btnStuReject && !btnStuReject._emsBound)
    btnStuReject.addEventListener('click', () =>
      window.processRegistration('student', 'rejected')
    );
  if (btnStuReject) btnStuReject._emsBound = true;
  if (btnStuCancel && !btnStuCancel._emsBound)
    btnStuCancel.addEventListener('click', () =>
      window.resetRegForm('student')
    );
  if (btnStuCancel) btnStuCancel._emsBound = true;

  const btnTchApprove = document.getElementById('btn-tch-approve');
  const btnTchReject = document.getElementById('btn-tch-reject');
  const btnTchCancel = document.getElementById('btn-tch-cancel-edit');
  if (btnTchApprove && !btnTchApprove._emsBound)
    btnTchApprove.addEventListener('click', () =>
      window.processRegistration('teacher', 'approved')
    );
  if (btnTchApprove) btnTchApprove._emsBound = true;
  if (btnTchReject && !btnTchReject._emsBound)
    btnTchReject.addEventListener('click', () =>
      window.processRegistration('teacher', 'rejected')
    );
  if (btnTchReject) btnTchReject._emsBound = true;
  if (btnTchCancel && !btnTchCancel._emsBound)
    btnTchCancel.addEventListener('click', () =>
      window.resetRegForm('teacher')
    );
  if (btnTchCancel) btnTchCancel._emsBound = true;

  const btnStfApprove = document.getElementById('btn-stf-approve');
  const btnStfReject = document.getElementById('btn-stf-reject');
  const btnStfCancel = document.getElementById('btn-stf-cancel-edit');
  if (btnStfApprove && !btnStfApprove._emsBound)
    btnStfApprove.addEventListener('click', () =>
      window.processRegistration('staff', 'approved')
    );
  if (btnStfApprove) btnStfApprove._emsBound = true;
  if (btnStfReject && !btnStfReject._emsBound)
    btnStfReject.addEventListener('click', () =>
      window.processRegistration('staff', 'rejected')
    );
  if (btnStfReject) btnStfReject._emsBound = true;
  if (btnStfCancel && !btnStfCancel._emsBound)
    btnStfCancel.addEventListener('click', () => window.resetRegForm('staff'));
  if (btnStfCancel) btnStfCancel._emsBound = true;

  const regFilter = document.getElementById('reg-list-filter');
  if (regFilter && !regFilter._emsBound) {
    regFilter.addEventListener('change', window.renderRegTable);
    regFilter._emsBound = true;
  }

  window.loadClassesList();
  regDupWireBlurChecks();
  if (typeof window.emsRegRefreshPermCache === 'function') window.emsRegRefreshPermCache();
  if (typeof window.emsRegGuardUI === 'function') window.emsRegGuardUI();
  if (typeof window.emsRegMobileInit === 'function') window.emsRegMobileInit();
  if (typeof window.emsRegMobileBuildAllSectionNavs === 'function') window.emsRegMobileBuildAllSectionNavs();
  if (typeof window.emsRegDraftInit === 'function') window.emsRegDraftInit();
}

window.RegistrationModule = {
  _initialized: false,
  init: function () {
    if (this._initialized) return;
    initializeRegistrationModule();
    this._initialized = true;
  },
  destroy: function () {
    this._initialized = false;
  }
};

window.initializeRegistrationModule = initializeRegistrationModule;

if (typeof window.emsRegisterDepartmentRefresh === 'function') {
  window.emsRegisterDepartmentRefresh('admission', function () {
    if (currentRegType === 'list') window.renderRegTable();
    else if (currentRegType === 'rejected') window.renderRejectedTable();
  });
}

function emsOnRepoDataChanged() {
  if (typeof window.emsRegRepoGetCount === 'function') {
    if (window.emsRegRepoGetCount() > 0) _regListAutoFetchAttempted = true;
  } else if (typeof window.emsRegRepoGetList === 'function' && window.emsRegRepoGetList().length > 0) {
    _regListAutoFetchAttempted = true;
  }
  var admissionActive = typeof window.emsIsAdmissionModuleActive === 'function'
    ? window.emsIsAdmissionModuleActive()
    : !!document.querySelector('#module-admission.active');
  if (admissionActive && typeof window.renderRegTable === 'function' && document.querySelector('#reg-users-table tbody')) {
    window.renderRegTable();
  }
  if (admissionActive && typeof window.renderRegDashboard === 'function') {
    var regDash = document.getElementById('reg-dashboard-panel');
    if (regDash && regDash.style.display !== 'none') {
      try { window.renderRegDashboard(); } catch (e) { /* ignore */ }
    }
  }
  var dashActive = typeof window.emsIsDashboardModuleActive === 'function'
    ? window.emsIsDashboardModuleActive()
    : !!document.querySelector('#module-dashboard.active');
  if (dashActive && typeof window.updateMasterDashboard === 'function') {
    try { window.updateMasterDashboard(); } catch (e) { /* ignore */ }
  }
}
window.addEventListener('ems:users-changed', emsOnRepoDataChanged);
window.addEventListener('ems:repo-hydrated', emsOnRepoDataChanged);
window.addEventListener('ems:registration-ready', emsOnRepoDataChanged);

window.addEventListener('ems:search-index-progress', function () {
  if (typeof regInfiniteUpdateStatus === 'function') regInfiniteUpdateStatus();
});
window.addEventListener('ems:search-index-complete', function () {
  if (typeof window.renderRegTable === 'function' && document.querySelector('#reg-users-table tbody')) {
    window.renderRegTable();
  }
  if (typeof regInfiniteUpdateStatus === 'function') regInfiniteUpdateStatus();
});

// =========================================================
// ماسٹر شرائط نامہ (Global Form Templates) کنٹرولز
// =========================================================
window.lockTerms = function (prefix) {
  let textarea = document.getElementById(`${prefix}-terms-text`);
  if (textarea.value.trim() === '') {
    alert('پہلے کچھ شرائط درج کریں تاکہ اسے لاک کیا جا سکے۔');
    return;
  }

  // شرائط کو ماسٹر ٹیمپلیٹ کے طور پر ہمیشہ کے لیے محفوظ کریں
  localStorage.setItem(`ems_global_terms_${prefix}`, textarea.value);

  textarea.setAttribute('readonly', 'true');
  document.getElementById(`btn-${prefix}-terms-lock`).style.display = 'none';
  document.getElementById(`btn-${prefix}-terms-edit`).style.display =
    'inline-flex';
  alert('اس فارم کا شرائط نامہ مستقل طور پر محفوظ اور لاک ہو گیا ہے!');
};

window.editTerms = function (prefix) {
  let textarea = document.getElementById(`${prefix}-terms-text`);
  textarea.removeAttribute('readonly');
  document.getElementById(`btn-${prefix}-terms-lock`).style.display =
    'inline-flex';
  document.getElementById(`btn-${prefix}-terms-edit`).style.display = 'none';
  textarea.focus();
};

window.deleteTerms = function (prefix) {
  if (
    confirm(
      'کیا آپ واقعی اس فارم کے ماسٹر شرائط نامے کو ہمیشہ کے لیے ڈیلیٹ کرنا چاہتے ہیں؟'
    )
  ) {
    let textarea = document.getElementById(`${prefix}-terms-text`);
    textarea.value = '';

    // ماسٹر ٹیمپلیٹ کو میموری سے ڈیلیٹ کریں
    localStorage.removeItem(`ems_global_terms_${prefix}`);

    textarea.removeAttribute('readonly');
    document.getElementById(`btn-${prefix}-terms-lock`).style.display =
      'inline-flex';
    document.getElementById(`btn-${prefix}-terms-edit`).style.display = 'none';
  }
};

// =========================================================
// 12. آئی ڈی کارڈ — canonical implementation in ems-idcard.js (SSOT via emsGetUserById)
// =========================================================

// =========================================================
// 13. بطاقۃ القبول / تقرر نامہ (Official Letter) کی لاجک
// =========================================================
function renderLetterModalContent(user) {
  if (!user) return;
  let today = new Date().toLocaleDateString('ur-PK');
  let content = '';
  let B = window.EmsBranding;
  let header = B
    ? B.letterHeaderHTML()
    : '<h4 style="text-align:center; color:#7f8c8d; margin-top: 0;">جامعہ / مدرسہ انتظامیہ</h4><hr style="margin-bottom:20px;">';

  if (user.type === 'student') {
    let sigs = B
      ? `<div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top: 50px;">
                ${B.signatureBlock('دستخط ناظمِ تعلیمات', 'sigNazimTaleem')}
                ${B.sealHTML(90)}
                ${B.signatureBlock('دستخط مہتمم', 'sigMohtamim')}
            </div>`
      : `<div style="display:flex; justify-content:space-between; margin-top: 40px;">
                <div style="text-align:center; width:200px; border-top:1px solid #000;">دستخط ناظمِ تعلیمات</div>
                <div style="text-align:center; width:200px; border-top:1px solid #000;">دستخط مہتمم</div>
            </div>`;
    content = `
            ${header}
            <h3 style="text-align:center; color:var(--primary); margin: 4px 0 14px;">بطاقۃ القبول (Admission Letter)</h3>
            <div style="display:flex; justify-content:space-between; margin-bottom: 20px; font-family: Arial, sans-serif;">
                <div><strong>تاریخ:</strong> ${today}</div>
                <div><strong>آئی ڈی نمبر:</strong> ${user.id}</div>
            </div>
            <p style="font-size: 18px;">عزیز طالب علم <strong>${user.name}</strong> سلمہ،</p>
            <p style="font-size: 18px; text-align: justify;">ہمیں آپ کو یہ بتاتے ہوئے خوشی ہو رہی ہے کہ جامعہ میں آپ کا داخلہ درجہ <strong>${
              user.class || 'نامعلوم'
            }</strong> میں منظور کر لیا گیا ہے۔ آپ کی سابقہ تعلیم اور کوائف کی جانچ پڑتال کے بعد انتظامیہ نے آپ کو داخلہ دینے کا فیصلہ کیا ہے۔</p>
            <p style="font-size: 18px; text-align: justify;">امید ہے کہ آپ جامعہ کے تمام قواعد و ضوابط اور <strong>طے شدہ شرائط نامہ</strong> کی مکمل پابندی کریں گے اور اپنی تعلیم پر پوری توجہ دیں گے۔</p>
            ${sigs}
        `;
  } else {
    let positionTitle =
      user.type === 'teacher'
        ? user.designation || 'استاذ'
        : user.position || 'عملہ';
    let sigs = B
      ? `<div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top: 50px;">
                ${B.signatureBlock('دستخط ناظمِ دفتر', 'sigNazimDaftar')}
                ${B.sealHTML(90)}
                ${B.signatureBlock('دستخط مہتمم', 'sigMohtamim')}
            </div>`
      : `<div style="display:flex; justify-content:space-between; margin-top: 40px;">
                <div style="text-align:center; width:200px; border-top:1px solid #000;">دستخط ناظمِ دفتر</div>
                <div style="text-align:center; width:200px; border-top:1px solid #000;">دستخط مہتمم</div>
            </div>`;
    content = `
            ${header}
            <h3 style="text-align:center; color:var(--primary); margin: 4px 0 14px;">تقرر نامہ (Appointment Letter)</h3>
            <div style="display:flex; justify-content:space-between; margin-bottom: 20px; font-family: Arial, sans-serif;">
                <div><strong>تاریخ:</strong> ${today}</div>
                <div><strong>آئی ڈی نمبر:</strong> ${user.id}</div>
            </div>
            <p style="font-size: 18px;">محترم <strong>${user.name}</strong> صاحب،</p>
            <p style="font-size: 18px; text-align: justify;">جامعہ انتظامیہ کی جانب سے آپ کو <strong>${positionTitle}</strong> کے عہدے پر تقرری کی پیشکش کی جاتی ہے۔</p>
            <p style="font-size: 18px; text-align: justify;">آپ کی مقررہ تنخواہ <strong>${
              user.salary || 'طے شدہ'
            } روپے</strong> ہوگی۔ ہم امید کرتے ہیں کہ آپ اپنی ذمہ داریاں دیانتداری، محنت اور ادارے کے <strong>طے شدہ شرائط نامہ</strong> کے مطابق پوری کریں گے۔</p>
            ${sigs}
        `;
  }

  document.getElementById('letter-print-area').innerHTML = content;
  document.getElementById('letter-modal').style.display = 'flex';
  window._regLastLetterEntityId = user.id;
  window._regLastLetterEntityType = user.type;
}

window.openLetterModal = function (id) {
  if (typeof window.emsRegRequire === 'function' && !window.emsRegRequire('print', { id: id, kind: 'letter' })) {
    return;
  }
  var loadFn = typeof window.emsRegGetRecordById === 'function'
    ? function (i) { return window.emsRegGetRecordById(i, { fromRejected: false }); }
    : (typeof window.emsGetUserById === 'function'
      ? function (i) { return window.emsGetUserById(i, false); }
      : null);
  if (!loadFn) {
    alert('ریکارڈ لوڈ نہیں ہو سکا — ریپوزٹری تیار نہیں');
    return;
  }
  loadFn(id).then(function (user) {
    if (!user) {
      alert('ریکارڈ نہیں ملا');
      return;
    }
    renderLetterModalContent(user);
  });
};

// =========================================================
// 14. نیا محفوظ پرنٹنگ فنکشن (سافٹ ویئر کو خراب ہونے سے بچانے کے لیے)
// =========================================================
window.printElement = function (elementId) {
  if (typeof window.emsRegRequire === 'function' && !window.emsRegRequire('print', { elementId: elementId })) {
    return;
  }
  let printContent = document.getElementById(elementId).innerHTML;
  let printWindow = window.open('', '', 'height=600,width=800');

  // ایک نیا صاف ستھرا پیج بنا کر صرف وہ لیٹر یا کارڈ پرنٹ کرنا
  printWindow.document.write('<html><head><title>Print</title>');
  printWindow.document.write('<style>');
  printWindow.document.write(
    'body { font-family: "Noto Nastaliq Urdu", Arial, sans-serif; direction: rtl; text-align: right; padding: 20px; }'
  );
  printWindow.document.write(
    '@media print { body { margin: 0; padding: 0; } }'
  );
  printWindow.document.write('</style>');
  printWindow.document.write('</head><body>');
  printWindow.document.write(printContent);
  printWindow.document.write('</body></html>');

  printWindow.document.close();
  printWindow.focus();

  // تھوڑا سا انتظار (تاکہ تصاویر وغیرہ لوڈ ہو جائیں) پھر پرنٹ
  setTimeout(function () {
    if (typeof window.emsRegLogAudit === 'function') {
      var printAction = elementId === 'letter-print-area' ? 'print_letter' : 'print';
      var printId = (elementId === 'letter-print-area' && window._regLastLetterEntityId)
        ? window._regLastLetterEntityId
        : (elementId || 'unknown');
      window.emsRegLogAudit(printAction, printId, {
        source: 'form',
        elementId: elementId,
        entityType: window._regLastLetterEntityType || null
      });
    }
    printWindow.print();
    printWindow.close();
  }, 500);
};

/** Image preview modal — print */
window.printSpecificImage = function () {
  var img = document.getElementById('full-size-image');
  if (!img || !img.src) {
    if (typeof showToast === 'function') showToast('تصویر نہیں ملی', 'error');
    return;
  }
  var w = window.open('', '', 'height=700,width=560');
  if (!w) {
    if (typeof showToast === 'function') showToast('پاپ اپ بند ہے', 'error');
    return;
  }
  w.document.write('<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>تصویر پرنٹ</title>');
  w.document.write('<style>@page{margin:10mm;} body{margin:0;padding:16px;text-align:center;background:#fff;} img{max-width:100%;height:auto;}</style>');
  w.document.write('</head><body><img src="' + img.src.replace(/"/g, '&quot;') + '" alt="preview"></body></html>');
  w.document.close();
  w.focus();
  setTimeout(function () { try { w.print(); } catch (e) { /* ignore */ } }, 400);
};

/** Image preview modal — real PDF download */
window.downloadSpecificImagePDF = function () {
  var img = document.getElementById('full-size-image');
  if (!img || !img.src) {
    if (typeof showToast === 'function') showToast('تصویر نہیں ملی', 'error');
    return;
  }
  var wrap = document.getElementById('ems-image-pdf-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'ems-image-pdf-wrap';
    wrap.style.cssText = 'position:fixed;left:-12000px;top:0;padding:12px;background:#fff;';
    document.body.appendChild(wrap);
  }
  wrap.innerHTML = '<img src="' + img.src.replace(/"/g, '&quot;') + '" style="max-width:700px;height:auto;display:block;" alt="preview">';
  if (typeof window.finDownloadPDF === 'function') {
    window.finDownloadPDF('ems-image-pdf-wrap', 'image-preview.pdf');
    return;
  }
  window.printSpecificImage();
  if (typeof showToast === 'function') showToast('PDF لائبریری نہیں — پرنٹ کھول دیا', 'warning');
};

window.closeModal = function (modalId) {
  document.getElementById(modalId).style.display = 'none';
};


