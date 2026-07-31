    // ================= 11. مالیات و تنخواہ (Ledger & Payroll — Enterprise Grade) =================

  var LDG_DEFAULT_FUNDS = [
    { id: 'Zakat', name: 'زکوٰۃ و صدقات فنڈ', color: '#16a34a', active: true, order: 1 },
    { id: 'General', name: 'عمومی فنڈ (تنخواہ و بل)', color: '#2563eb', active: true, order: 2 },
    { id: 'Permanent', name: 'مستقل تجارتی آمدنی فنڈ', color: '#d97706', active: true, order: 3 }
  ];

  window._ldgPayrollData = [];
  window._ldgLastReportRows = null;
  window._ldgEntryPage = 1;
  window._ldgEntryPageSize = 50;
  window._ldgFilteredCache = [];
  var currentUploadedLedgerFiles = [];

  function ldgGetUsers() {
    if (typeof window.emsGetUsersSync === 'function') return window.emsGetUsersSync();
    if (typeof window.emsGetUsersMerged === 'function') return window.emsGetUsersMerged();
    return [];
  }

  function ldgInitOptDeptFilter() {
    if (typeof window.emsMountOptionalDeptFilter === 'function') {
      window.emsMountOptionalDeptFilter('ldg-opt-dept-filter', 'ledger', function () {
        if (typeof window.emsIsLedgerModuleActive === 'function' && !window.emsIsLedgerModuleActive()) return;
        if (typeof window.refreshLedgerData === 'function') window.refreshLedgerData(window._ldgActiveTab);
        if (window._ldgActiveTab === 'ledger-win-dashboard' && typeof window.ldgRenderDashboard === 'function') window.ldgRenderDashboard();
        if (window._ldgActiveTab === 'ledger-win-entry' && typeof window.ldgRenderEntryList === 'function') window.ldgRenderEntryList(1, 'reset');
        if (window._ldgActiveTab === 'ledger-win-salary' && typeof window.ldgRenderPayrollHistory === 'function') window.ldgRenderPayrollHistory();
      });
    }
  }

  function ldgApplyOptDeptFilter(rows) {
    if (typeof window.emsApplyOptionalDeptFilter === 'function') {
      return window.emsApplyOptionalDeptFilter(rows, 'ledger');
    }
    return rows;
  }

  function ldgGetPayrollStaff(users, staffType) {
    users = users || ldgGetUsers();
    var staffList = users.filter(function (u) { return u.type === 'teacher' || u.type === 'staff'; });
    if (staffType === 'teacher') staffList = staffList.filter(function (u) { return u.type === 'teacher'; });
    if (staffType === 'staff') staffList = staffList.filter(function (u) { return u.type === 'staff'; });
    if (typeof window.emsIsOptionalDeptFilterOn === 'function' && window.emsIsOptionalDeptFilterOn('ledger')) {
      if (typeof window.emsFilterByDepartment === 'function') staffList = window.emsFilterByDepartment(staffList);
    }
    return staffList;
  }

  window.ldgGetSettings = function () {
    var s = JSON.parse(localStorage.getItem('ems_ledger_settings') || 'null');
    if (!s) s = { requireApproval: true, approvalThreshold: 25000, level2Threshold: 100000, storageOnlyAttachments: false, useFirestorePagination: true, hideArchived: true };
    return s;
  };

  window.ldgSaveSettings = function () {
    if (!window.ldgRequireEdit()) return;
    var s = {
      requireApproval: document.getElementById('ldg-set-require-approval') ? document.getElementById('ldg-set-require-approval').checked : true,
      approvalThreshold: Number(document.getElementById('ldg-set-threshold') ? document.getElementById('ldg-set-threshold').value : 25000) || 0,
      level2Threshold: Number(document.getElementById('ldg-set-threshold2') ? document.getElementById('ldg-set-threshold2').value : 100000) || 0,
      storageOnlyAttachments: document.getElementById('ldg-set-storage-only') ? document.getElementById('ldg-set-storage-only').checked : false,
      useFirestorePagination: document.getElementById('ldg-set-fs-pagination') ? document.getElementById('ldg-set-fs-pagination').checked : true,
      hideArchived: document.getElementById('ldg-set-hide-archived') ? document.getElementById('ldg-set-hide-archived').checked : true
    };
    emsSaveKey('ems_ledger_settings', JSON.stringify(s));
    window.ldgAuditLog('update', 'settings', 'ledger', null, s, 'ترتیبات اپڈیٹ');
    showToast('ترتیبات محفوظ', 'success');
  };

  window.ldgIsApproved = function (entry) {
    if (entry.approvalStatus === 'rejected') return false;
    if (entry.approvalStatus === 'approved') return true;
    if (entry.approvalStatus === 'pending') return false;
    return true;
  };

  window.ldgGetEntryApprovalLevel = function (item) {
    if (!item) return 0;
    return item.approvalLevelRequired || item.approvalLevel || window.ldgApprovalLevel(item.amount || 0);
  };

  window.ldgGetApprovalStageLabel = function (item) {
    if (item.approvalStatus !== 'pending') return '—';
    var req = window.ldgGetEntryApprovalLevel(item);
    if (req >= 2) {
      if (item.level1ApprovedBy) return '<span style="color:#7c3aed;">سطح 2 منتظر</span><br><small>سطح 1: ' + item.level1ApprovedBy + '</small>';
      return '<span style="color:#d97706;">سطح 1 منتظر</span>';
    }
    return '<span style="color:#d97706;">سطح 1 منتظر</span>';
  };

  window.ldgCanApproveEntry = function (item, actor) {
    actor = actor || window.ldgActorName();
    if ((item.createdBy || '') === actor) return { ok: false, msg: 'درخواست کنندہ خود منظور نہیں کر سکتا' };
    var req = window.ldgGetEntryApprovalLevel(item);
    var needLevel = (req >= 2 && item.level1ApprovedBy) ? 2 : 1;
    if (!window.ldgHasApprovePermission(needLevel)) {
      return { ok: false, msg: (needLevel === 2 ? 'سطح 2' : 'سطح 1') + ' منظوری کی اجازت نہیں — Admin Panel میں approve' + needLevel + ' دیں' };
    }
    if (req >= 2 && item.level1ApprovedBy && item.level1ApprovedBy === actor) {
      return { ok: false, msg: 'سطح 1 منظور کنندہ سطح 2 نہیں کر سکتا — دوسرا منتظم درکار' };
    }
    return { ok: true };
  };

  window.ldgHasApprovePermission = function (level) {
    level = level || 1;
    if (typeof window.isSuperAdmin === 'function' && window.isSuperAdmin()) return true;
    if (typeof window.isMadrasaAdmin === 'function' && window.isMadrasaAdmin()) return true;
    if (typeof window.emsIsStaffUser === 'function' && !window.emsIsStaffUser()) return true;
    var action = level >= 2 ? 'approve2' : 'approve1';
    if (typeof window.checkStaffModuleAccess === 'function' && window.checkStaffModuleAccess('ledger', action)) return true;
    if (level === 1 && typeof window.checkStaffModuleAccess === 'function' && window.checkStaffModuleAccess('ledger', 'edit')) return true;
    return false;
  };

  window.ldgAuditSnapshot = function (obj) {
    if (obj == null) return null;
    try { return JSON.parse(JSON.stringify(obj)); } catch (e) { return obj; }
  };

  window.ldgIsApprovedEntry = function (item) {
    return window.ldgIsApproved(item);
  };

  window.ldgSumMonth = function (ledgerDB, monthStr, type) {
    return ledgerDB.filter(function (i) {
      return window.ldgIsApproved(i) && i.type === type && (i.date || '').startsWith(monthStr);
    }).reduce(function (s, i) { return s + Number(i.amount || 0); }, 0);
  };

  window.ldgNeedsApproval = function (type, amount) {
    var s = window.ldgGetSettings();
    if (!s.requireApproval || type !== 'Expense') return false;
    return amount >= (s.approvalThreshold || 0);
  };

  window.ldgApprovalLevel = function (amount) {
    var s = window.ldgGetSettings();
    if (amount >= (s.level2Threshold || 999999999)) return 2;
    if (amount >= (s.approvalThreshold || 0)) return 1;
    return 0;
  };

  window.ldgGetStorage = function () {
    try {
      if (typeof firebase !== 'undefined' && firebase.storage) return firebase.storage();
    } catch (e) { /* ignore */ }
    return null;
  };

  window.ldgUploadAttachments = function (files, entryId) {
    files = files || [];
    if (!files.length) return Promise.resolve([]);
    var storage = window.ldgGetStorage();
    var settings = window.ldgGetSettings();
    var tenant = window.CURRENT_MADRASA_TENANT_ID || (firebase.auth && firebase.auth().currentUser ? firebase.auth().currentUser.uid : 'local');
    var user = window.ldgActorName();
    if (!storage) {
      if (settings.storageOnlyAttachments) {
        return Promise.reject(new Error('Firebase Storage درکار — آف لائن میں فائل منسلک نہیں ہو سکتی'));
      }
      return Promise.resolve(files.map(function (f) {
        return { name: f.name, type: f.type, dataBase64: f.dataBase64, storage: 'local' };
      }));
    }
    return Promise.all(files.map(function (f) {
      if (!f.dataBase64) return Promise.resolve(null);
      var safeName = (f.name || 'file').replace(/[^\w.\-]+/g, '_');
      var path = 'ledger/' + tenant + '/' + entryId + '/' + Date.now() + '_' + safeName;
      var ref = storage.ref(path);
      return fetch(f.dataBase64).then(function (r) { return r.blob(); }).then(function (blob) {
        return ref.put(blob, { contentType: f.type || blob.type, customMetadata: { uploadedBy: user } });
      }).then(function () { return ref.getDownloadURL(); }).then(function (url) {
        return { name: f.name, type: f.type, url: url, storagePath: path, storage: 'firebase' };
      }).catch(function (err) {
        if (settings.storageOnlyAttachments) throw err || new Error('Storage اپ لوڈ ناکام');
        return { name: f.name, type: f.type, dataBase64: f.dataBase64, storage: 'local' };
      });
    })).then(function (arr) { return arr.filter(Boolean); });
  };

  function emsSaveKey(key, val, opts) {
    var options = Object.assign({ mutation: true, autoDelta: true }, opts || {});
    if (window.emsSaveModuleData) return window.emsSaveModuleData(key, val, options);
    localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
    return Promise.resolve();
  }

  window.ldgActorName = function () {
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
      return firebase.auth().currentUser.email || firebase.auth().currentUser.displayName || 'عملہ';
    }
    return 'عملہ';
  };

  window.ldgRequireEdit = function () {
    return !(typeof window.emsRequireStaffAction === 'function') || window.emsRequireStaffAction('ledger', 'edit');
  };

  window.ldgRequireApproveModeration = function () {
    if (window.ldgHasApprovePermission(1) || window.ldgHasApprovePermission(2)) return true;
    return window.ldgRequireEdit();
  };

  // =========================================================
  // نیویگیشن
  // =========================================================
  window._ldgActiveTab = 'ledger-win-dashboard';
  window._ldgStaffDropdownGen = -1;
  window._ldgApprovalPage = 1;

  function ldgBuildLedgerMonthIndex(ledgerDB) {
    var idx = Object.create(null);
    (ledgerDB || []).forEach(function (x) {
      if (!window.ldgIsApproved(x)) return;
      var m = (x.date || '').slice(0, 7);
      if (!m) return;
      if (!idx[m]) idx[m] = { income: 0, expense: 0 };
      if (x.type === 'Income') idx[m].income += Number(x.amount || 0);
      else if (x.type === 'Expense') idx[m].expense += Number(x.amount || 0);
    });
    return idx;
  }

  window.ldgEnsureStaffDropdowns = function (force) {
    if (typeof window.emsIsLedgerModuleActive === 'function' && !window.emsIsLedgerModuleActive()) return;
    var gen = typeof window.emsReadRepoCacheGen === 'function' ? window.emsReadRepoCacheGen() : 0;
    if (!force && window._ldgStaffDropdownGen === gen) return;
    window._ldgStaffDropdownGen = gen;
    var placeholders = { 'ldg-sal-staff': 'ملازم منتخب...', 'ldg-spec-staff': 'منتخب...', 'ldg-due-staff': 'منتخب...' };
    ['ldg-sal-staff', 'ldg-spec-staff', 'ldg-due-staff'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el._emsStaffLazyLoaded = false;
      if (typeof window.emsBindLazyStaffSelect === 'function') {
        window.emsBindLazyStaffSelect(el, 'teacher', {
          moduleActive: window.emsIsLedgerModuleActive,
          valueField: 'id',
          placeholder: placeholders[id] || 'منتخب...'
        });
      }
    });
  };

  window.switchLedgerTab = function (tabId, btn) {
    if (typeof window.emsIsLedgerModuleActive === 'function' && !window.emsIsLedgerModuleActive()) return;
    if (typeof window.emsCloseAllModals === 'function') window.emsCloseAllModals();
    document.querySelectorAll('#module-ledger .ledger-tab-content').forEach(function (el) { el.style.display = 'none'; });
    var panel = document.getElementById(tabId);
    if (panel) panel.style.display = 'block';
    document.querySelectorAll('#ldg-ribbon-menu .reg-tab').forEach(function (b) { b.classList.remove('active-sub-tab'); });
    if (btn) btn.classList.add('active-sub-tab');
    window._ldgActiveTab = tabId;
    if (typeof window.refreshLedgerData === 'function') window.refreshLedgerData(tabId);
    if (tabId === 'ledger-win-dashboard' && typeof window.ldgRenderDashboard === 'function') {
      if (typeof window.emsDeferModuleWork === 'function') {
        window.emsDeferModuleWork(window.ldgRenderDashboard, { idle: true, timeout: 400 });
      } else {
        window.ldgRenderDashboard();
      }
    }
    if (tabId === 'ledger-win-entry' && typeof window.ldgRenderEntryList === 'function') window.ldgRenderEntryList();
    if (tabId === 'ledger-win-audit' && typeof window.ldgRenderAuditLog === 'function') window.ldgRenderAuditLog();
    if (tabId === 'ledger-win-budget' && typeof window.ldgRenderBudget === 'function') window.ldgRenderBudget();
    if (tabId === 'ledger-win-approvals' && typeof window.ldgRenderApprovals === 'function') window.ldgRenderApprovals();
    if (tabId === 'ledger-win-liabilities' && typeof window.ldgRenderLiabilities === 'function') window.ldgRenderLiabilities();
    if (tabId === 'ledger-win-salary') {
      if (typeof window.ldgRenderPayrollHistory === 'function') window.ldgRenderPayrollHistory();
      if (typeof window.ldgRenderEmployeeDues === 'function') window.ldgRenderEmployeeDues();
      if (typeof window.ldgRenderSpecialPayments === 'function') window.ldgRenderSpecialPayments();
      if (typeof window.ldgRenderPayrollAnnualSummary === 'function') window.ldgRenderPayrollAnnualSummary();
    }
    if (tabId === 'ledger-win-report') {
      if (typeof window.ldgRenderAnnualReview === 'function') window.ldgRenderAnnualReview();
      if (typeof window.ldgRenderFundPerformance === 'function') window.ldgRenderFundPerformance();
    }
    if (tabId === 'ledger-win-settings' && typeof window.ldgRenderArchivePanel === 'function') window.ldgRenderArchivePanel();
  };

  window.emsOpenLedger = function () {
    if (typeof window.emsCloseAllModals === 'function') window.emsCloseAllModals();
    var btn = document.querySelector('#ldg-ribbon-menu [onclick*="ledger-win-dashboard"]');
    window.switchLedgerTab('ledger-win-dashboard', btn);
  };

  // =========================================================
  // آڈٹ لاگ
  // =========================================================
  window.ldgAuditLog = function (action, entity, entityId, before, after, summary) {
    var logs = JSON.parse(localStorage.getItem('ems_ledger_audit_log') || '[]');
    logs.push({
      id: generateID('AUD'),
      action: action,
      entity: entity,
      entityId: entityId || '',
      userName: window.ldgActorName(),
      timestamp: Date.now(),
      before: before || null,
      after: after || null,
      summary: summary || ''
    });
    if (logs.length > 5000) logs = logs.slice(-5000);
    emsSaveKey('ems_ledger_audit_log', JSON.stringify(logs));
  };

  // =========================================================
  // فنڈز (لچکدار)
  // =========================================================
  window.ldgGetFunds = function () {
    var funds = JSON.parse(localStorage.getItem('ems_ledger_funds') || 'null');
    if (!funds || !funds.length) {
      funds = LDG_DEFAULT_FUNDS.slice();
      emsSaveKey('ems_ledger_funds', JSON.stringify(funds));
    }
    return funds.filter(function (f) { return f.active !== false; }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  };

  window.ldgFundName = function (fundId) {
    var f = window.ldgGetFunds().find(function (x) { return x.id === fundId; });
    return f ? f.name : fundId;
  };

  window.ldgPopulateFundSelects = function () {
    var funds = window.ldgGetFunds();
    var opts = funds.map(function (f) { return '<option value="' + f.id + '">' + f.name + '</option>'; }).join('');
    var allOpts = '<option value="all">تمام فنڈز</option>' + opts;
    ['ldg-entry-fund', 'ldg-budget-fund', 'rep-ldg-fund', 'ldg-liab-fund', 'ldg-edit-fund'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var cur = el.value;
      el.innerHTML = id === 'rep-ldg-fund' ? allOpts : opts;
      if (cur) el.value = cur;
    });
  };

  window.ldgAddFund = function () {
    if (!window.ldgRequireEdit()) return;
    var name = (document.getElementById('ldg-new-fund-name') || {}).value;
    name = (name || '').trim();
    if (!name) return showToast('فنڈ کا نام درج کریں', 'error');
    var funds = JSON.parse(localStorage.getItem('ems_ledger_funds') || '[]');
    if (!funds.length) funds = LDG_DEFAULT_FUNDS.slice();
    var id = 'FND-' + Date.now().toString(36).toUpperCase();
    var item = { id: id, name: name, color: '#7c3aed', active: true, order: funds.length + 1 };
    funds.push(item);
    emsSaveKey('ems_ledger_funds', JSON.stringify(funds));
    window.ldgAuditLog('create', 'fund', id, null, item, 'نیا فنڈ: ' + name);
    document.getElementById('ldg-new-fund-name').value = '';
    window.refreshLedgerData();
    showToast('فنڈ شامل ہو گیا', 'success');
  };

  window.ldgRenameFund = function (fundId) {
    if (!window.ldgRequireEdit()) return;
    var funds = JSON.parse(localStorage.getItem('ems_ledger_funds') || '[]');
    var f = funds.find(function (x) { return x.id === fundId; });
    if (!f) return;
    var nn = prompt('نیا نام:', f.name);
    if (!nn || !nn.trim()) return;
    var before = Object.assign({}, f);
    f.name = nn.trim();
    emsSaveKey('ems_ledger_funds', JSON.stringify(funds));
    window.ldgAuditLog('update', 'fund', fundId, before, f, 'فنڈ نام تبدیل');
    window.refreshLedgerData();
  };

  window.ldgDeactivateFund = function (fundId) {
    if (!window.ldgRequireEdit()) return;
    if (['Zakat', 'General', 'Permanent'].indexOf(fundId) >= 0) return showToast('بنیادی فنڈز غیر فعال نہیں ہو سکتے', 'warning');
    if (!confirm('یہ فنڈ غیر فعال کریں؟')) return;
    var funds = JSON.parse(localStorage.getItem('ems_ledger_funds') || '[]');
    var f = funds.find(function (x) { return x.id === fundId; });
    if (f) { f.active = false; emsSaveKey('ems_ledger_funds', JSON.stringify(funds)); window.ldgAuditLog('delete', 'fund', fundId, f, null, 'فنڈ غیر فعال'); }
    window.refreshLedgerData();
  };

  window.ldgRenderFundsTable = function () {
    var tbody = document.getElementById('ldg-funds-tbody');
    if (!tbody) return;
    var funds = window.ldgGetFunds();
    var balances = window.ldgComputeFundBalances();
    tbody.innerHTML = '';
    funds.forEach(function (f) {
      var bal = balances[f.id] || 0;
      tbody.innerHTML += '<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + (f.color || '#64748b') + ';margin-left:6px;"></span><strong>' + f.name + '</strong><br><small>' + f.id + '</small></td><td style="font-weight:bold;color:' + (bal >= 0 ? '#16a34a' : '#dc2626') + ';">Rs ' + bal.toLocaleString() + '</td><td><button class="btn btn-sm btn-outline" onclick="window.ldgRenameFund(\'' + f.id + '\')"><i class="fas fa-edit"></i></button> <button class="btn btn-sm btn-outline" onclick="window.ldgDeactivateFund(\'' + f.id + '\')"><i class="fas fa-ban"></i></button></td></tr>';
    });
  };

  window.ldgComputeFundBalances = function () {
    var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
    var feeCollections = JSON.parse(localStorage.getItem('ems_fee_collections')) || [];
    var funds = window.ldgGetFunds();
    var bal = {};
    funds.forEach(function (f) { bal[f.id] = 0; });
    ledgerDB.forEach(function (item) {
      if (!window.ldgIsApproved(item)) return;
      var amt = Number(item.amount) || 0;
      var fid = item.fund;
      if (bal[fid] == null) bal[fid] = 0;
      bal[fid] += item.type === 'Income' ? amt : -amt;
    });
    if (bal.General != null) {
      feeCollections.forEach(function (c) {
        if (typeof window.finCollectionEffectiveAmount === 'function') {
          bal.General += window.finCollectionEffectiveAmount(c);
        } else if (!c.isVoid) {
          bal.General += Number(c.amount) || 0;
        }
      });
    }
    return bal;
  };

  // =========================================================
  // مدات (Categories)
  // =========================================================
  function getMasterCategories() {
    var cats = JSON.parse(localStorage.getItem('ems_ledger_master_categories'));
    if (!cats) {
      cats = [
        { id: 'CAT-1', name: 'عام عطیات', type: 'Income' },
        { id: 'CAT-2', name: 'امداد', type: 'Income' },
        { id: 'CAT-3', name: 'دکانوں کا کرایہ', type: 'Income' },
        { id: 'CAT-4', name: 'طعام و مطبخ', type: 'Expense' },
        { id: 'CAT-5', name: 'تعمیرات', type: 'Expense' },
        { id: 'CAT-6', name: 'بجلی بل', type: 'Expense' },
        { id: 'CAT-7', name: 'امتحانی خرچ', type: 'Expense' },
        { id: 'CAT-8', name: 'طعام و تنخواہ', type: 'Expense' }
      ];
      emsSaveKey('ems_ledger_master_categories', JSON.stringify(cats));
    }
    return cats;
  }

  function updateLedgerCategoriesDropdown() {
    var type = document.getElementById('ldg-entry-type') ? document.getElementById('ldg-entry-type').value : 'Income';
    var select = document.getElementById('ldg-entry-cat');
    var repSelect = document.getElementById('rep-ldg-cat');
    if (!select) return;
    var cats = getMasterCategories().filter(function (c) { return c.type === type; });
    select.innerHTML = cats.map(function (c) { return '<option value="' + c.name + '">' + c.name + '</option>'; }).join('');
    if (repSelect) {
      var all = getMasterCategories();
      repSelect.innerHTML = '<option value="all">تمام مدات</option>' + all.map(function (c) {
        return '<option value="' + c.name + '">' + c.name + ' (' + (c.type === 'Income' ? 'آمدن' : 'خرچ') + ')</option>';
      }).join('');
    }
  }

  window.deleteMasterCat = function (index) {
    if (!window.ldgRequireEdit()) return;
    if (!confirm('کیا آپ واقعی یہ مد حذف کرنا چاہتے ہیں؟')) return;
    var cats = getMasterCategories();
    var removed = cats[index];
    cats.splice(index, 1);
    emsSaveKey('ems_ledger_master_categories', JSON.stringify(cats));
    window.ldgAuditLog('delete', 'category', removed ? removed.name : '', removed, null, 'مد حذف');
    window.refreshLedgerData();
  };

  function renderMasterCategoriesTable() {
    var tbody = document.querySelector('#table-master-cats tbody');
    if (!tbody) return;
    var cats = getMasterCategories();
    tbody.innerHTML = cats.map(function (c, index) {
      return '<tr><td><strong>' + c.name + '</strong></td><td>' + (c.type === 'Income' ? '<span style="color:green;">آمدن</span>' : '<span style="color:red;">خرچ</span>') + '</td><td><button class="icon-btn delete" onclick="deleteMasterCat(' + index + ')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  }

  // =========================================================
  // بلیک آؤٹ
  // =========================================================
  function renderBlackoutsTable() {
    var tbody = document.querySelector('#table-blackouts tbody');
    if (!tbody) return;
    var blackouts = JSON.parse(localStorage.getItem('ems_ledger_blackouts')) || [];
    if (!blackouts.length) { tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#94a3b8;">کوئی ممنوعہ ایام نہیں</td></tr>'; return; }
    tbody.innerHTML = blackouts.map(function (b) {
      return '<tr><td>' + b.start + '</td><td>' + b.end + '</td><td><button class="icon-btn delete" onclick="deleteBlackout(\'' + b.id + '\')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  }

  window.deleteBlackout = function (id) {
    if (!window.ldgRequireEdit()) return;
    if (!confirm('حذف کریں؟')) return;
    var blackouts = JSON.parse(localStorage.getItem('ems_ledger_blackouts')) || [];
    emsSaveKey('ems_ledger_blackouts', JSON.stringify(blackouts.filter(function (b) { return b.id !== id; })));
    window.refreshLedgerData();
  };

  // =========================================================
  // CSV / PDF
  // =========================================================
  window.ldgDownloadCSV = function (rows, filename) {
    if (typeof window.finDownloadCSV === 'function') return window.finDownloadCSV(rows, filename);
    var csv = rows.map(function (r) { return r.map(function (c) { var s = String(c == null ? '' : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(','); }).join('\r\n');
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = filename || 'ledger.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  };

  window.ldgExportPDF = function (elementId, title) {
    if (typeof window.finDownloadPDF === 'function') window.finDownloadPDF(elementId, (title || 'ledger') + '.pdf');
    else if (typeof window.printDiv === 'function') window.printDiv(elementId);
  };

  window.ldgExportExcel = function (rows, filename, sheetName) {
    filename = filename || 'ledger.xlsx';
    if (typeof XLSX === 'undefined') {
      window.ldgDownloadCSV(rows, filename.replace('.xlsx', '.csv'));
      return showToast('Excel نہ ملا — CSV برآمد', 'warning');
    }
    var ws = XLSX.utils.aoa_to_sheet(rows);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName || 'مالیات');
    XLSX.writeFile(wb, filename);
    if (typeof showToast === 'function') showToast('Excel: ' + filename, 'success');
  };

  window.ldgGetFilteredEntries = function (source) {
    source = source || 'entry';
    var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
    var rows = ledgerDB.slice().sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    var q, typeF, fundF, fromD, toD, deptF, catF, amtMin, amtMax, statusF;
    if (source === 'report') {
      typeF = document.getElementById('rep-ldg-type') ? document.getElementById('rep-ldg-type').value : '';
      fundF = document.getElementById('rep-ldg-fund') ? document.getElementById('rep-ldg-fund').value : 'all';
      catF = document.getElementById('rep-ldg-cat') ? document.getElementById('rep-ldg-cat').value : 'all';
      fromD = document.getElementById('rep-ldg-from') ? document.getElementById('rep-ldg-from').value : '';
      toD = document.getElementById('rep-ldg-to') ? document.getElementById('rep-ldg-to').value : '';
      deptF = document.getElementById('rep-ldg-dept') ? document.getElementById('rep-ldg-dept').value.trim().toLowerCase() : '';
      amtMin = document.getElementById('rep-ldg-amt-min') ? Number(document.getElementById('rep-ldg-amt-min').value) : 0;
      q = '';
    } else {
      q = (document.getElementById('ldg-entry-search') ? document.getElementById('ldg-entry-search').value : '').toLowerCase().trim();
      typeF = document.getElementById('ldg-entry-filter-type') ? document.getElementById('ldg-entry-filter-type').value : '';
      fundF = document.getElementById('ldg-entry-filter-fund') ? document.getElementById('ldg-entry-filter-fund').value : '';
      fromD = document.getElementById('ldg-entry-from') ? document.getElementById('ldg-entry-from').value : '';
      toD = document.getElementById('ldg-entry-to') ? document.getElementById('ldg-entry-to').value : '';
      deptF = (document.getElementById('ldg-entry-filter-dept') ? document.getElementById('ldg-entry-filter-dept').value : '').toLowerCase().trim();
      catF = document.getElementById('ldg-entry-filter-cat') ? document.getElementById('ldg-entry-filter-cat').value : '';
      amtMin = document.getElementById('ldg-entry-amt-min') ? Number(document.getElementById('ldg-entry-amt-min').value) : 0;
      amtMax = document.getElementById('ldg-entry-amt-max') ? Number(document.getElementById('ldg-entry-amt-max').value) : 0;
      statusF = document.getElementById('ldg-entry-filter-status') ? document.getElementById('ldg-entry-filter-status').value : '';
    }
    if (typeF) rows = rows.filter(function (r) { return r.type === typeF; });
    if (fundF && fundF !== 'all') rows = rows.filter(function (r) { return r.fund === fundF; });
    if (catF && catF !== 'all') rows = rows.filter(function (r) { return r.category === catF; });
    if (fromD) rows = rows.filter(function (r) { return (r.date || '') >= fromD; });
    if (toD) rows = rows.filter(function (r) { return (r.date || '') <= toD; });
    if (deptF) rows = rows.filter(function (r) { return (r.department || '').toLowerCase().indexOf(deptF) >= 0; });
    if (amtMin > 0) rows = rows.filter(function (r) { return Number(r.amount) >= amtMin; });
    if (amtMax > 0) rows = rows.filter(function (r) { return Number(r.amount) <= amtMax; });
    if (statusF === 'pending') rows = rows.filter(function (r) { return r.approvalStatus === 'pending'; });
    else if (statusF === 'approved') rows = rows.filter(function (r) { return window.ldgIsApproved(r); });
    else if (statusF === 'rejected') rows = rows.filter(function (r) { return r.approvalStatus === 'rejected'; });
    if (source === 'report') rows = rows.filter(function (r) { return window.ldgIsApproved(r); });
    var hideArch = window.ldgGetSettings().hideArchived !== false;
    if (hideArch && source !== 'report') rows = rows.filter(function (r) { return !r.archived; });
    if (q) rows = rows.filter(function (r) {
      return (r.details + ' ' + r.category + ' ' + r.fund + ' ' + r.responsiblePerson + ' ' + r.department + ' ' + r.amount + ' ' + window.ldgFundName(r.fund)).toLowerCase().indexOf(q) >= 0;
    });
    rows = ldgApplyOptDeptFilter(rows);
    if (typeof window.emsArchiveFilterByDate === 'function') {
      rows = window.emsArchiveFilterByDate(rows, 'date');
    }
    return rows;
  };

  window.ldgExportEntriesCSV = function () {
    var rows = window.ldgGetFilteredEntries('entry');
    var data = [['تاریخ', 'قسم', 'فنڈ', 'مد', 'رقم', 'حالت', 'ذمہ دار', 'شعبہ', 'تفصیل']];
    rows.forEach(function (item) {
      data.push([item.date, item.type === 'Income' ? 'آمدن' : 'خرچ', window.ldgFundName(item.fund), item.category, item.amount, item.approvalStatus || 'approved', item.responsiblePerson, item.department, item.details]);
    });
    window.ldgDownloadCSV(data, 'روزنامچہ_' + new Date().toISOString().slice(0, 10) + '.csv');
  };

  window.ldgExportEntriesExcel = function () {
    var rows = window.ldgGetFilteredEntries('entry');
    var data = [['تاریخ', 'قسم', 'فنڈ', 'مد', 'رقم', 'حالت', 'ذمہ دار', 'شعبہ', 'تفصیل']];
    rows.forEach(function (item) {
      data.push([item.date, item.type === 'Income' ? 'آمدن' : 'خرچ', window.ldgFundName(item.fund), item.category, item.amount, item.approvalStatus || 'approved', item.responsiblePerson, item.department, item.details]);
    });
    window.ldgExportExcel(data, 'روزنامچہ_' + new Date().toISOString().slice(0, 10) + '.xlsx', 'روزنامچہ');
  };

  window.ldgExportReportExcel = function () {
    if (!window._ldgLastReportRows) return showToast('پہلے رپورٹ لائیں', 'warning');
    window.ldgExportExcel(window._ldgLastReportRows, 'مالیاتی_رپورٹ_' + new Date().toISOString().slice(0, 10) + '.xlsx', 'رپورٹ');
  };

  window.ldgViewEntryDetail = function (id) {
    var item = (JSON.parse(localStorage.getItem(DB.ledger)) || []).find(function (x) { return x.id === id; });
    if (!item) return;
    var html = '<div style="text-align:right;line-height:1.8;"><p><b>تاریخ:</b> ' + item.date + '</p><p><b>قسم:</b> ' + (item.type === 'Income' ? 'آمدن' : 'خرچ') + '</p><p><b>فنڈ:</b> ' + window.ldgFundName(item.fund) + '</p><p><b>رقم:</b> Rs ' + Number(item.amount).toLocaleString() + '</p><p><b>ذمہ دار:</b> ' + (item.responsiblePerson || '—') + '</p><p><b>شعبہ:</b> ' + (item.department || '—') + '</p><p><b>تفصیل:</b> ' + (item.details || '—') + '</p>';
    if (item.attachments && item.attachments.length) {
      html += '<p><b>دستاویزات:</b></p><ul style="padding-right:18px;">';
      item.attachments.forEach(function (a, i) {
        var href = a.url || a.dataBase64 || '#';
        html += '<li><a href="' + href + '" target="_blank" rel="noopener">' + (a.name || 'فائل ' + (i + 1)) + '</a></li>';
      });
      html += '</ul>';
    }
    html += '</div>';
    if (typeof showToast === 'function') showToast('تفصیل کھولی', 'info');
    var box = document.getElementById('ldg-entry-detail-modal-body');
    if (box) { box.innerHTML = html; var m = document.getElementById('ldg-entry-detail-modal'); if (m) { var h = m.querySelector('h3'); if (h) h.innerHTML = '<i class="fas fa-receipt"></i> اندراج کی تفصیل'; m.style.display = 'flex'; } }
  };

  window.ldgApplyEntryPeriod = function (preset) {
    var fromEl = document.getElementById('ldg-entry-from');
    var toEl = document.getElementById('ldg-entry-to');
    if (!fromEl || !toEl) return;
    window.ldgApplyReportPeriod(preset);
    fromEl.value = document.getElementById('rep-ldg-from') ? document.getElementById('rep-ldg-from').value : fromEl.value;
    toEl.value = document.getElementById('rep-ldg-to') ? document.getElementById('rep-ldg-to').value : toEl.value;
    window._ldgEntryPage = 1;
    window._ldgFsPageEndCursors = [];
    window.ldgRenderEntryList(1, 'reset');
  };

  // =========================================================
  // مرحلہ E: Firestore صفحہ بندی + آرکائیو + Excel درآمد
  // =========================================================
  window._ldgFsCursors = [];
  window._ldgFsPageEndCursors = [];
  window._ldgFsLastDoc = null;
  window._ldgFsHasNext = false;
  window._ldgImportWizard = null;

  window.ldgGetTenantLedgerRef = function () {
    var db = typeof window.getDbOrNull === 'function' ? window.getDbOrNull() : null;
    var uid = (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) ? firebase.auth().currentUser.uid : null;
    if (!db || !uid) return null;
    return db.collection('All_Madrasas').doc(uid).collection('LedgerEntries');
  };

  window.ldgCanUseFirestorePagination = function () {
    var s = window.ldgGetSettings();
    if (s.useFirestorePagination === false) return false;
    return !!window.ldgGetTenantLedgerRef() && (typeof navigator === 'undefined' || navigator.onLine);
  };

  window.ldgHasActiveEntryFilters = function () {
    if ((document.getElementById('ldg-entry-search') || {}).value && document.getElementById('ldg-entry-search').value.trim()) return true;
    if ((document.getElementById('ldg-entry-filter-type') || {}).value) return true;
    if ((document.getElementById('ldg-entry-filter-fund') || {}).value) return true;
    if ((document.getElementById('ldg-entry-filter-cat') || {}).value) return true;
    if ((document.getElementById('ldg-entry-filter-status') || {}).value) return true;
    if ((document.getElementById('ldg-entry-from') || {}).value) return true;
    if ((document.getElementById('ldg-entry-to') || {}).value) return true;
    if ((document.getElementById('ldg-entry-filter-dept') || {}).value && document.getElementById('ldg-entry-filter-dept').value.trim()) return true;
    if (Number((document.getElementById('ldg-entry-amt-min') || {}).value) > 0) return true;
    if (Number((document.getElementById('ldg-entry-amt-max') || {}).value) > 0) return true;
    return false;
  };

  window.ldgFetchFirestoreEntryPage = function (direction) {
    var ref = window.ldgGetTenantLedgerRef();
    if (!ref) return Promise.reject(new Error('Firestore نہیں'));
    var ps = window._ldgEntryPageSize || 50;
    if (direction === 'reset' || direction === 'first') {
      window._ldgEntryPage = 1;
      window._ldgFsPageEndCursors = [];
    } else if (direction === 'next') {
      window._ldgEntryPage = (window._ldgEntryPage || 1) + 1;
    } else if (direction === 'prev') {
      window._ldgEntryPage = Math.max(1, (window._ldgEntryPage || 1) - 1);
    } else if (!window._ldgEntryPage) {
      window._ldgEntryPage = 1;
    }
    var q = ref.orderBy('timestamp', 'desc');
    var endCursor = window._ldgFsPageEndCursors[window._ldgEntryPage - 2] || null;
    if (endCursor && window._ldgEntryPage > 1) q = q.startAfter(endCursor);
    return q.limit(ps + 1).get().then(function (snap) {
      var docs = [];
      snap.forEach(function (d) { docs.push(Object.assign({ id: d.id }, d.data())); });
      if (window.ldgGetSettings().hideArchived !== false) docs = docs.filter(function (x) { return !x.archived; });
      var hasNext = docs.length > ps;
      if (hasNext) docs = docs.slice(0, ps);
      window._ldgFsHasNext = hasNext;
      if (snap.docs.length >= 1) {
        var lastIdx = Math.min(ps - 1, snap.docs.length - 1);
        window._ldgFsPageEndCursors[window._ldgEntryPage - 1] = snap.docs[lastIdx];
      }
      return { rows: docs, hasNext: hasNext, hasPrev: window._ldgEntryPage > 1, mode: 'firestore', page: window._ldgEntryPage };
    });
  };

  function ldgGetFeeBridgePeriod() {
    var fromEl = document.getElementById('ldg-entry-from');
    var toEl = document.getElementById('ldg-entry-to');
    var fromD = fromEl ? fromEl.value : '';
    var toD = toEl ? toEl.value : '';
    if (!fromD && !toD) {
      var now = new Date();
      var mk = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
      fromD = mk + '-01';
      var lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      toD = mk + '-' + String(lastDay).padStart(2, '0');
    }
    return { fromD: fromD, toD: toD };
  }

  window.ldgGetActiveFeeCollectionsInPeriod = function (fromD, toD) {
    var collections = JSON.parse(localStorage.getItem('ems_fee_collections') || '[]');
    var rows = [];
    collections.forEach(function (c) {
      var amt = typeof window.finCollectionEffectiveAmount === 'function'
        ? window.finCollectionEffectiveAmount(c)
        : (c && !c.isVoid ? (Number(c.amount) || 0) : 0);
      if (!amt) return;
      var d = c.date || '';
      if (fromD && d < fromD) return;
      if (toD && d > toD) return;
      rows.push({ collection: c, amount: amt });
    });
    return rows;
  };

  window.ldgRenderFeeBridgeCard = function () {
    var card = document.getElementById('ldg-fee-bridge-card');
    if (!card) return;
    var period = ldgGetFeeBridgePeriod();
    var items = window.ldgGetActiveFeeCollectionsInPeriod(period.fromD, period.toD);
    var total = items.reduce(function (s, x) { return s + x.amount; }, 0);
    if (!items.length) {
      card.style.display = 'none';
      card.innerHTML = '';
      return;
    }
    var label = period.fromD === period.toD ? period.fromD : (period.fromD + ' — ' + period.toD);
    card.style.display = 'block';
    card.innerHTML = '<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;">' +
      '<div><div style="font-size:12px;color:#1d4ed8;font-weight:600;margin-bottom:4px;"><i class="fas fa-link"></i> خودکار فیس وصولی (عمومی فنڈ)</div>' +
      '<div style="font-size:13px;color:#475569;">منتخب مدت: <strong>' + label + '</strong> — ' + items.length + ' وصولیاں</div>' +
      '<div style="font-size:11px;color:#64748b;margin-top:4px;">یہ رقم فیس ماڈیول سے خودکار طور پر عمومی فنڈ میں شامل ہو چکی ہے — روزنامچہ میں دوبارہ درج نہ کریں۔</div></div>' +
      '<div style="text-align:left;"><div style="font-size:22px;font-weight:700;color:#15803d;">Rs ' + total.toLocaleString() + '</div>' +
      '<div style="font-size:11px;color:#16a34a;">Virtual Fee Bridge</div></div></div>';
  };

  function ldgBuildFeeBridgeRowHtml(total, count, label) {
    return '<tr class="ldg-fee-virtual-row" style="background:linear-gradient(90deg,#eff6ff,#f0fdf4);border:2px dashed #93c5fd;">' +
      '<td colspan="2"><i class="fas fa-magic" style="color:#2563eb;margin-left:6px;"></i><span style="color:#1d4ed8;font-weight:600;">خودکار فیس</span></td>' +
      '<td>' + window.ldgFundName('General') + '</td>' +
      '<td style="color:#15803d;font-weight:600;">فیس وصولی</td>' +
      '<td style="color:#15803d;font-weight:700;">Rs ' + Number(total).toLocaleString() + '</td>' +
      '<td colspan="5" style="font-size:12px;color:#475569;">' + count + ' فعال وصولیاں (' + label + ') — عمومی فنڈ میں خودکار شامل</td></tr>';
  }

  function ldgBuildEntryRowHtml(item) {
    var typeUrdu = item.type === 'Income' ? '<span style="color:#16a34a;">آمدن</span>' : '<span style="color:#dc2626;">خرچ</span>';
    var st = item.approvalStatus === 'pending' ? '<span style="color:#d97706;">زیرِ منظوری</span>' : (item.approvalStatus === 'rejected' ? '<span style="color:#94a3b8;">مسترد</span>' : '<span style="color:#16a34a;">منظور</span>');
    var att = (item.attachments && item.attachments.length) ? ' <i class="fas fa-paperclip"></i>' : '';
    var arch = item.archived ? ' <i class="fas fa-archive" title="آرکائیو"></i>' : '';
    return '<tr><td>' + item.date + '</td><td>' + typeUrdu + '</td><td>' + window.ldgFundName(item.fund) + '</td><td>' + (item.category || '—') + '</td><td>Rs ' + Number(item.amount).toLocaleString() + att + arch + '</td><td>' + st + '</td><td>' + (item.responsiblePerson || '—') + '</td><td>' + (item.department || '—') + '</td><td style="font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + (item.details || '') + '">' + (item.details || '—') + '</td><td><button class="btn btn-sm btn-outline" onclick="window.ldgViewEntryDetail(\'' + item.id + '\')" title="تفصیل"><i class="fas fa-eye"></i></button> <button class="btn btn-sm btn-outline" onclick="window.ldgOpenEditEntry(\'' + item.id + '\')" title="ترمیم"><i class="fas fa-edit"></i></button> <button class="btn btn-sm btn-outline" onclick="window.ldgDeleteEntry(\'' + item.id + '\')"><i class="fas fa-trash"></i></button></td></tr>';
  }

  window.ldgPaintEntryRows = function (pageRows, meta) {
    meta = meta || {};
    var tbody = document.getElementById('ldg-entry-list-tbody');
    if (!tbody) return;
    var pgEl = document.getElementById('ldg-entry-pagination');
    var scrollEl = tbody.closest('.table-responsive');
    window.ldgRenderFeeBridgeCard();
    var period = ldgGetFeeBridgePeriod();
    var feeItems = window.ldgGetActiveFeeCollectionsInPeriod(period.fromD, period.toD);
    var feeTotal = feeItems.reduce(function (s, x) { return s + x.amount; }, 0);
    var feeLabel = period.fromD === period.toD ? period.fromD : (period.fromD + ' — ' + period.toD);
    var feeRowHtml = feeItems.length ? ldgBuildFeeBridgeRowHtml(feeTotal, feeItems.length, feeLabel) : '';

    if (meta.mode === 'virtual') {
      window._ldgFilteredCache = pageRows || [];
      if (!window._ldgFilteredCache.length) {
        if (typeof window.emsVirtualTableDestroy === 'function') window.emsVirtualTableDestroy('ldg-entry');
        tbody.innerHTML = feeRowHtml || '<tr><td colspan="10" style="text-align:center;color:#94a3b8;">کوئی ریکارڈ نہیں</td></tr>';
        if (pgEl) pgEl.innerHTML = feeRowHtml ? '<span class="reg-pg-info">خودکار فیس وصولی اوپر دکھائی گئی</span>' : '';
        return;
      }
      if (pgEl) {
        pgEl.innerHTML = '<span class="reg-pg-info">کل <b>' + meta.total + '</b> اندراج — virtual scroll</span>';
      }
      if (scrollEl && typeof window.emsVirtualTableMount === 'function') {
        if (!scrollEl.style.maxHeight) scrollEl.style.maxHeight = '50vh';
        scrollEl.style.overflowY = 'auto';
        window.emsVirtualTableMount('ldg-entry', {
          scrollEl: scrollEl,
          tbody: tbody,
          rowHeight: 48,
          getData: function () { return window._ldgFilteredCache || []; },
          renderRow: function (i, item) {
            var tmp = document.createElement('tbody');
            tmp.innerHTML = ldgBuildEntryRowHtml(item);
            return tmp.firstElementChild;
          },
          emptyHtml: '<tr><td colspan="10" style="text-align:center;color:#94a3b8;">کوئی ریکارڈ نہیں</td></tr>'
        });
      }
      return;
    }

    if (!pageRows.length) {
      tbody.innerHTML = feeRowHtml || '<tr><td colspan="10" style="text-align:center;color:#94a3b8;">کوئی ریکارڈ نہیں</td></tr>';
    } else {
      tbody.innerHTML = feeRowHtml + pageRows.map(function (item) { return ldgBuildEntryRowHtml(item); }).join('');
    }
    if (pgEl) {
      var modeBadge = meta.mode === 'firestore' ? '<span class="reg-pg-info" style="background:#eff6ff;color:#2563eb;padding:2px 8px;border-radius:4px;font-size:11px;"><i class="fas fa-cloud"></i> Firestore</span> ' : '';
      if (meta.mode === 'firestore') {
        pgEl.innerHTML = modeBadge + '<span class="reg-pg-info">صفحہ ' + (meta.page || window._ldgEntryPage) + '</span> ' +
          (meta.hasPrev ? '<button class="btn btn-sm btn-outline" onclick="window.ldgRenderEntryList(null,\'prev\')">پچھلا</button> ' : '') +
          (meta.hasNext ? '<button class="btn btn-sm btn-outline" onclick="window.ldgRenderEntryList(null,\'next\')">اگلا</button>' : '');
      } else {
        pgEl.innerHTML = modeBadge + (meta.total ? '<span class="reg-pg-info">' + meta.total + ' ریکارڈ — صفحہ ' + meta.page + ' / ' + meta.pages + '</span> ' +
          (meta.page > 1 ? '<button class="btn btn-sm btn-outline" onclick="window.ldgRenderEntryList(' + (meta.page - 1) + ')">پچھلا</button> ' : '') +
          (meta.page < meta.pages ? '<button class="btn btn-sm btn-outline" onclick="window.ldgRenderEntryList(' + (meta.page + 1) + ')">اگلا</button>' : '') : '');
      }
    }
  };

  window.ldgGetArchiveData = function () {
    var d = JSON.parse(localStorage.getItem('ems_ledger_archive') || 'null');
    if (!d || !d.summaries) d = { summaries: [], meta: { lastArchiveAt: null } };
    return d;
  };

  window.ldgRenderArchivePanel = function () {
    var tbody = document.getElementById('ldg-archive-tbody');
    if (!tbody) return;
    var data = window.ldgGetArchiveData();
    if (!data.summaries.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">ابھی کوئی آرکائیو خلاصہ نہیں</td></tr>';
      return;
    }
    tbody.innerHTML = data.summaries.slice().reverse().map(function (s) {
      return '<tr><td>' + s.period + '</td><td>' + (s.entryCount || 0) + '</td><td style="color:#16a34a;">Rs ' + Number(s.totalIncome || 0).toLocaleString() + '</td><td style="color:#dc2626;">Rs ' + Number(s.totalExpense || 0).toLocaleString() + '</td><td>Rs ' + Number(s.net || 0).toLocaleString() + '</td><td style="font-size:12px;">' + (s.archivedBy || '—') + '<br>' + (s.archivedAt ? new Date(s.archivedAt).toLocaleDateString('ur-PK') : '') + '</td><td><button class="btn btn-sm btn-outline" onclick="window.ldgExportArchiveSummary(\'' + s.id + '\')" title="Excel"><i class="fas fa-file-excel"></i></button> <button class="btn btn-sm btn-outline" onclick="window.ldgRestoreArchiveMonth(\'' + s.period + '\')" title="بحال"><i class="fas fa-undo"></i></button></td></tr>';
    }).join('');
    var cnt = (JSON.parse(localStorage.getItem(DB.ledger)) || []).filter(function (x) { return x.archived; }).length;
    var el = document.getElementById('ldg-archived-count');
    if (el) el.innerText = String(cnt);
  };

  window.ldgArchiveMonth = function () {
    if (!window.ldgRequireEdit()) return;
    var monthEl = document.getElementById('ldg-archive-month');
    var month = monthEl ? monthEl.value : '';
    if (!month) return showToast('مہینہ منتخب کریں', 'error');
    if (!confirm('مہینہ ' + month + ' کے اندراجات آرکائیو کریں؟ (حذف نہیں — صرف چھپائیں)')) return;
    var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
    var slice = ledgerDB.filter(function (x) { return (x.date || '').startsWith(month) && !x.archived; });
    if (!slice.length) return showToast('اس مہینے میں اندراج نہیں', 'warning');
    var totalInc = 0, totalExp = 0;
    slice.forEach(function (x) {
      if (x.type === 'Income') totalInc += Number(x.amount || 0); else totalExp += Number(x.amount || 0);
      x.archived = true;
      x.archivedAt = Date.now();
      x.archivedPeriod = month;
    });
    var arch = window.ldgGetArchiveData();
    var summary = {
      id: generateID('ARCH'),
      period: month,
      type: 'monthly',
      entryCount: slice.length,
      totalIncome: totalInc,
      totalExpense: totalExp,
      net: totalInc - totalExp,
      archivedAt: Date.now(),
      archivedBy: window.ldgActorName()
    };
    arch.summaries.push(summary);
    arch.meta = { lastArchiveAt: Date.now(), lastPeriod: month };
    emsSaveKey(DB.ledger, JSON.stringify(ledgerDB));
    emsSaveKey('ems_ledger_archive', JSON.stringify(arch));
    window.ldgAuditLog('create', 'archive', summary.id, null, summary, 'آرکائیو: ' + month + ' (' + slice.length + ' اندراج)');
    window.ldgRenderArchivePanel();
    window.ldgRenderEntryList(1, 'reset');
    showToast(slice.length + ' اندراج آرکائیو — خلاصہ محفوظ', 'success');
  };

  window.ldgExportArchiveSummary = function (summaryId) {
    var s = window.ldgGetArchiveData().summaries.find(function (x) { return x.id === summaryId; });
    if (!s) return;
    window.ldgExportExcel([['مدت', 'اندارج', 'آمدن', 'خرچ', 'خالص', 'آرکائیو کنندہ'], [s.period, s.entryCount, s.totalIncome, s.totalExpense, s.net, s.archivedBy]], 'آرکائیو_' + s.period + '.xlsx', 'خلاصہ');
  };

  window.ldgRestoreArchiveMonth = function (period) {
    if (!window.ldgRequireEdit()) return;
    if (!confirm('مہینہ ' + period + ' کے آرکائیو شدہ اندراجات دوبارہ فہرست میں لائیں؟')) return;
    var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
    var before = window.ldgAuditSnapshot(ledgerDB.filter(function (x) { return x.archived && x.archivedPeriod === period; }));
    var count = 0;
    ledgerDB.forEach(function (x) {
      if (x.archived && x.archivedPeriod === period) {
        x.archived = false;
        delete x.archivedAt;
        delete x.archivedPeriod;
        count++;
      }
    });
    if (!count) return showToast('اس مدت کا کوئی آرکائیو شدہ اندراج نہیں', 'warning');
    emsSaveKey(DB.ledger, JSON.stringify(ledgerDB));
    window.ldgAuditLog('update', 'archive', period, before, { restored: count, period: period }, 'آرکائیو بحال: ' + period);
    window.ldgRenderArchivePanel();
    window.ldgRenderEntryList(1, 'reset');
    calculateLedgerBalances();
    showToast(count + ' اندراج بحال', 'success');
  };

  window.ldgViewArchivedEntries = function (period) {
    var rows = (JSON.parse(localStorage.getItem(DB.ledger)) || []).filter(function (x) {
      return x.archived && (!period || x.archivedPeriod === period);
    }).sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); }).slice(0, 100);
    var box = document.getElementById('ldg-entry-detail-modal-body');
    if (!box) return;
    if (!rows.length) {
      box.innerHTML = '<p style="color:#94a3b8;">کوئی آرکائیو شدہ اندراج نہیں</p>';
    } else {
      box.innerHTML = '<p style="font-size:13px;color:#64748b;">' + (period || 'تمام') + ' — ' + rows.length + ' ریکارڈ</p><div style="max-height:360px;overflow-y:auto;"><table class="data-table"><thead><tr><th>تاریخ</th><th>قسم</th><th>رقم</th><th>تفصیل</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr><td>' + r.date + '</td><td>' + (r.type === 'Income' ? 'آمدن' : 'خرچ') + '</td><td>Rs ' + Number(r.amount).toLocaleString() + '</td><td style="font-size:12px;">' + (r.details || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    document.getElementById('ldg-entry-detail-modal').querySelector('h3').innerHTML = '<i class="fas fa-archive"></i> آرکائیو شدہ اندراجات';
    document.getElementById('ldg-entry-detail-modal').style.display = 'flex';
  };

  window.ldgOpenImportWizard = function () {
    window._ldgImportWizard = { headers: [], rows: [], mapping: {} };
    var body = document.getElementById('ldg-import-wizard-body');
    if (body) body.innerHTML = '<p style="color:#64748b;">CSV یا Excel (.xlsx) اپ لوڈ کریں — اگلے مرحلے میں کالم میپنگ ہوگی۔</p><input type="file" id="ldg-import-wizard-file" accept=".csv,.xlsx,.xls" class="input-control" onchange="window.ldgImportWizardLoadFile(this)">';
    var m = document.getElementById('ldg-import-wizard-modal');
    if (m) m.style.display = 'flex';
  };

  window.ldgImportWizardLoadFile = function (input) {
    var file = input.files && input.files[0];
    if (!file) return;
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    var onData = function (headers, rows) {
      window._ldgImportWizard = { headers: headers, rows: rows, mapping: {} };
      window.ldgImportWizardShowMapping();
    };
    if (ext === 'xlsx' || ext === 'xls') {
      if (typeof XLSX === 'undefined') return showToast('Excel library نہیں', 'error');
      var reader = new FileReader();
      reader.onload = function (e) {
        var wb = XLSX.read(e.target.result, { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (data.length < 2) return showToast('فائل ناقص', 'error');
        onData(data[0].map(String), data.slice(1));
      };
      reader.readAsArrayBuffer(file);
    } else {
      var reader2 = new FileReader();
      reader2.onload = function (e) {
        var lines = (e.target.result || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
        if (lines.length < 2) return showToast('فائل ناقص', 'error');
        var headers = ldgParseCSVLine(lines[0]);
        var rows = lines.slice(1).map(ldgParseCSVLine);
        onData(headers, rows);
      };
      reader2.readAsText(file, 'UTF-8');
    }
    input.value = '';
  };

  window.ldgImportWizardShowMapping = function () {
    var w = window._ldgImportWizard;
    if (!w || !w.headers.length) return;
    var fields = [
      { key: 'date', label: 'تاریخ *' },
      { key: 'amount', label: 'رقم *' },
      { key: 'type', label: 'قسم (آمدن/خرچ)' },
      { key: 'fund', label: 'فنڈ' },
      { key: 'category', label: 'مد' },
      { key: 'details', label: 'تفصیل' },
      { key: 'dept', label: 'شعبہ' }
    ];
    var guess = function (label, patterns) {
      var i = w.headers.findIndex(function (h) {
        var s = String(h).toLowerCase();
        return patterns.some(function (p) { return s.indexOf(p) >= 0; });
      });
      return i >= 0 ? i : '';
    };
    w.mapping.date = guess('date', ['date', 'تاریخ']);
    w.mapping.amount = guess('amount', ['amount', 'رقم']);
    w.mapping.type = guess('type', ['type', 'قسم', 'آمدن']);
    w.mapping.fund = guess('fund', ['fund', 'فنڈ']);
    w.mapping.category = guess('cat', ['cat', 'مد']);
    w.mapping.details = guess('det', ['detail', 'تفصیل']);
    w.mapping.dept = guess('dept', ['dept', 'شعبہ']);
    var opts = w.headers.map(function (h, i) { return '<option value="' + i + '">' + h + '</option>'; }).join('');
    var html = '<p><b>' + w.rows.length + '</b> قطاریں ملیں — کالم میپ کریں:</p><div class="form-grid">';
    fields.forEach(function (f) {
      html += '<div class="input-group"><label>' + f.label + '</label><select id="ldg-map-' + f.key + '" class="input-control"><option value="">—</option>' + opts + '</select></div>';
    });
    html += '</div><div class="table-responsive" style="max-height:160px;margin-top:12px;"><table class="data-table"><thead><tr>' + w.headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>';
    w.rows.slice(0, 5).forEach(function (row) {
      html += '<tr>' + row.map(function (c) { return '<td style="font-size:11px;">' + String(c).slice(0, 40) + '</td>'; }).join('') + '</tr>';
    });
    html += '</tbody></table></div><button class="btn btn-primary" style="margin-top:12px;" onclick="window.ldgImportWizardRun()"><i class="fas fa-file-import"></i> درآمد شروع</button>';
    var body = document.getElementById('ldg-import-wizard-body');
    if (body) body.innerHTML = html;
    Object.keys(w.mapping).forEach(function (k) {
      var el = document.getElementById('ldg-map-' + k);
      if (el && w.mapping[k] !== '') el.value = String(w.mapping[k]);
    });
  };

  window.ldgImportWizardRun = function () {
    if (!window.ldgRequireEdit()) return;
    var w = window._ldgImportWizard;
    if (!w) return;
    var map = {};
    ['date', 'amount', 'type', 'fund', 'category', 'details', 'dept'].forEach(function (k) {
      var el = document.getElementById('ldg-map-' + k);
      map[k] = el && el.value !== '' ? Number(el.value) : -1;
    });
    if (map.date < 0 || map.amount < 0) return showToast('تاریخ اور رقم کالم لازمی', 'error');
    var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
    var funds = window.ldgGetFunds();
    var added = 0, errors = 0;
    w.rows.forEach(function (cells) {
      var amt = Number(String(cells[map.amount] || '').replace(/[^\d.-]/g, ''));
      var date = String(cells[map.date] || '').trim();
      if (!amt || !date) { errors++; return; }
      var typeRaw = map.type >= 0 ? String(cells[map.type] || '') : 'Expense';
      var type = /income|آمدن/i.test(typeRaw) ? 'Income' : 'Expense';
      var fundName = map.fund >= 0 ? String(cells[map.fund] || '').trim() : 'General';
      var fund = funds.find(function (f) { return f.id === fundName || f.name === fundName; });
      var entry = {
        id: generateID('LDG'),
        type: type,
        fund: fund ? fund.id : 'General',
        category: map.category >= 0 ? String(cells[map.category] || '').trim() : 'درآمد',
        amount: amt,
        date: date.length >= 10 ? date.slice(0, 10) : date,
        details: map.details >= 0 ? String(cells[map.details] || '').trim() : '',
        department: map.dept >= 0 ? String(cells[map.dept] || '').trim() : '',
        responsiblePerson: window.ldgActorName(),
        createdBy: window.ldgActorName(),
        timestamp: Date.now(),
        imported: true,
        approvalStatus: 'approved',
        approvedBy: window.ldgActorName(),
        approvedAt: Date.now()
      };
      if (window.ldgNeedsApproval(type, amt)) {
        entry.approvalStatus = 'pending';
        entry.approvalLevelRequired = window.ldgApprovalLevel(amt);
        entry.approvalStage = 0;
        delete entry.approvedBy;
        delete entry.approvedAt;
      }
      ledgerDB.push(entry);
      window.ldgAuditLog('create', 'ledger', entry.id, null, entry, 'Excel/CSV درآمد (wizard)');
      added++;
    });
    emsSaveKey(DB.ledger, JSON.stringify(ledgerDB));
    document.getElementById('ldg-import-wizard-modal').style.display = 'none';
    window._ldgImportWizard = null;
    window.refreshLedgerData();
    window.ldgRenderEntryList(1, 'reset');
    showToast(added + ' درآمد، ' + errors + ' نظرانداز', added ? 'success' : 'warning');
  };

  function ldgParseCSVLine(line) {
    var out = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  window.ldgImportEntriesCSV = function (input) {
    if (!window.ldgRequireEdit()) { if (input) input.value = ''; return; }
    var file = input && input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var lines = (e.target.result || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
      if (lines.length < 2) return showToast('فائل ناقص', 'error');
      var headers = ldgParseCSVLine(lines[0]).map(function (h) { return h.trim().toLowerCase(); });
      var typeI = headers.findIndex(function (h) { return h.indexOf('type') >= 0 || h.indexOf('قسم') >= 0 || h.indexOf('آمدن') >= 0; });
      var fundI = headers.findIndex(function (h) { return h.indexOf('fund') >= 0 || h.indexOf('فنڈ') >= 0; });
      var catI = headers.findIndex(function (h) { return h.indexOf('cat') >= 0 || h.indexOf('مد') >= 0; });
      var amtI = headers.findIndex(function (h) { return h.indexOf('amount') >= 0 || h.indexOf('رقم') >= 0; });
      var dateI = headers.findIndex(function (h) { return h.indexOf('date') >= 0 || h.indexOf('تاریخ') >= 0; });
      var detI = headers.findIndex(function (h) { return h.indexOf('detail') >= 0 || h.indexOf('تفصیل') >= 0; });
      if (amtI < 0 || dateI < 0) return showToast('رقم اور تاریخ کالم درکار', 'error');
      var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
      var added = 0, errors = 0, blocked = 0;
      var funds = window.ldgGetFunds();
      for (var li = 1; li < lines.length; li++) {
        var cells = ldgParseCSVLine(lines[li]);
        var amt = Number((cells[amtI] || '').replace(/[^\d.-]/g, ''));
        var date = (cells[dateI] || '').trim();
        if (!amt || !date) { errors++; continue; }
        var typeRaw = typeI >= 0 ? (cells[typeI] || '').trim() : 'Expense';
        var type = /income|آمدن/i.test(typeRaw) ? 'Income' : 'Expense';
        var category = catI >= 0 ? (cells[catI] || '').trim() : 'درآمد';
        var details = detI >= 0 ? (cells[detI] || '').trim() : '';
        if (typeof window.finIsManualFeeLedgerEntry === 'function' && window.finIsManualFeeLedgerEntry({ type: type, category: category, details: details })) {
          blocked++;
          continue;
        }
        var fundName = fundI >= 0 ? (cells[fundI] || '').trim() : 'General';
        var fund = funds.find(function (f) { return f.id === fundName || f.name === fundName; });
        var fundId = fund ? fund.id : 'General';
        var entry = {
          id: generateID('LDG'),
          type: type,
          fund: fundId,
          category: category,
          amount: amt,
          date: date,
          details: details,
          responsiblePerson: window.ldgActorName(),
          department: '',
          createdBy: window.ldgActorName(),
          timestamp: Date.now(),
          imported: true
        };
        ledgerDB.push(entry);
        window.ldgAuditLog('create', 'ledger', entry.id, null, entry, 'CSV درآمد');
        added++;
      }
      emsSaveKey(DB.ledger, JSON.stringify(ledgerDB));
      var msg = added + ' درآمد، ' + errors + ' نظرانداز';
      if (blocked) msg += '، ' + blocked + ' فیس (روزنامچہ میں نہیں)';
      showToast(msg, added ? 'success' : 'warning');
      window.refreshLedgerData();
    };
    reader.readAsText(file, 'UTF-8');
    input.value = '';
  };

  // =========================================================
  // اندراج + فہرست
  // =========================================================
  function calculateLedgerBalances() {
    var balances = window.ldgComputeFundBalances();
    var funds = window.ldgGetFunds();
    var strip = document.getElementById('ldg-stat-strip');
    if (strip) {
      strip.innerHTML = funds.map(function (f) {
        var v = balances[f.id] || 0;
        return '<div class="cmp-stat" style="border-top:3px solid ' + (f.color || '#64748b') + ';"><div class="cmp-stat-v">Rs ' + v.toLocaleString() + '</div><div class="cmp-stat-l">' + f.name + '</div></div>';
      }).join('');
    }
    var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
    var monthStr = new Date().toISOString().substring(0, 7);
    var monthExp = window.ldgSumMonth(ledgerDB, monthStr, 'Expense');
    var monthInc = window.ldgSumMonth(ledgerDB, monthStr, 'Income');
    if (document.getElementById('ldg-card-expense')) document.getElementById('ldg-card-expense').innerText = 'Rs ' + monthExp.toLocaleString();
    if (document.getElementById('ldg-card-income')) document.getElementById('ldg-card-income').innerText = 'Rs ' + monthInc.toLocaleString();
    if (document.getElementById('ldg-card-net')) document.getElementById('ldg-card-net').innerText = 'Rs ' + (monthInc - monthExp).toLocaleString();
    funds.slice(0, 3).forEach(function (f, idx) {
      var el = document.getElementById(['ldg-card-zakat', 'ldg-card-general', 'ldg-card-permanent'][idx]);
      if (el) el.innerText = 'Rs ' + (balances[f.id] || 0).toLocaleString();
    });
  }

  window.ldgRenderEntryList = function (page, direction) {
    if (page) window._ldgEntryPage = page;
    if (direction === 'reset') { window._ldgEntryPage = 1; window._ldgFsPageEndCursors = []; }
    var tbody = document.getElementById('ldg-entry-list-tbody');
    if (!tbody) return;
    if (window.ldgCanUseFirestorePagination() && !window.ldgHasActiveEntryFilters()) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#94a3b8;"><i class="fas fa-spinner fa-spin"></i> Firestore سے لوڈ...</td></tr>';
      window.ldgFetchFirestoreEntryPage(direction || 'reset').then(function (res) {
        window.ldgPaintEntryRows(res.rows, res);
      }).catch(function () {
        window.ldgRenderEntryListLocal(page);
      });
      return;
    }
    window.ldgRenderEntryListLocal(page);
  };

  window.ldgRenderEntryListLocal = function (page) {
    if (page) window._ldgEntryPage = page;
    var rows = window.ldgGetFilteredEntries('entry');
    var total = rows.length;
    if (typeof window.emsVirtualTableMount === 'function') {
      window.ldgPaintEntryRows(rows, { mode: 'virtual', total: total });
      return;
    }
    var ps = window._ldgEntryPageSize || 50;
    var pages = Math.max(1, Math.ceil(total / ps));
    if (window._ldgEntryPage > pages) window._ldgEntryPage = pages;
    var start = (window._ldgEntryPage - 1) * ps;
    var pageRows = rows.slice(start, start + ps);
    window.ldgPaintEntryRows(pageRows, { mode: 'local', total: total, page: window._ldgEntryPage, pages: pages, hasPrev: window._ldgEntryPage > 1, hasNext: window._ldgEntryPage < pages });
  };

  window.ldgDeleteEntry = function (id) {
    if (!window.ldgRequireEdit()) return;
    if (!confirm('یہ اندراج حذف کریں؟')) return;
    var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
    var item = ledgerDB.find(function (x) { return x.id === id; });
    ledgerDB = ledgerDB.filter(function (x) { return x.id !== id; });
    emsSaveKey(DB.ledger, JSON.stringify(ledgerDB));
    window.ldgAuditLog('delete', 'ledger', id, window.ldgAuditSnapshot(item), null, 'روزنامچہ حذف');
    window.refreshLedgerData();
    showToast('حذف ہو گیا', 'success');
  };

  window.ldgOpenEditEntry = function (id) {
    if (!window.ldgRequireEdit()) return;
    var item = (JSON.parse(localStorage.getItem(DB.ledger)) || []).find(function (x) { return x.id === id; });
    if (!item) return;
    window._ldgEditingEntryId = id;
    var set = function (elId, val) { var el = document.getElementById(elId); if (el) el.value = val != null ? val : ''; };
    set('ldg-edit-type', item.type);
    set('ldg-edit-fund', item.fund);
    set('ldg-edit-cat', item.category);
    set('ldg-edit-amount', item.amount);
    set('ldg-edit-date', item.date);
    set('ldg-edit-details', item.details);
    set('ldg-edit-responsible', item.responsiblePerson);
    set('ldg-edit-dept', item.department);
    var catSel = document.getElementById('ldg-edit-cat');
    if (catSel) {
      var cats = getMasterCategories().filter(function (c) { return c.type === item.type; });
      catSel.innerHTML = cats.map(function (c) { return '<option value="' + c.name + '">' + c.name + '</option>'; }).join('');
      catSel.value = item.category || '';
    }
    var m = document.getElementById('ldg-entry-edit-modal');
    if (m) m.style.display = 'flex';
  };

  window.ldgSaveEditedEntry = function () {
    if (!window.ldgRequireEdit()) return;
    var id = window._ldgEditingEntryId;
    if (!id) return;
    var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
    var item = ledgerDB.find(function (x) { return x.id === id; });
    if (!item) return;
    var before = window.ldgAuditSnapshot(item);
    var type = document.getElementById('ldg-edit-type').value;
    var amount = Number(document.getElementById('ldg-edit-amount').value);
    if (!amount || amount <= 0) return showToast('درست رقم درج کریں', 'error');
    var category = document.getElementById('ldg-edit-cat').value;
    var details = document.getElementById('ldg-edit-details').value.trim();
    if (typeof window.finIsManualFeeLedgerEntry === 'function' && window.finIsManualFeeLedgerEntry({ type: type, category: category, details: details })) {
      return showToast(window.finManualFeeLedgerBlockToast || 'فیس کی وصولی خودکار طور پر فنڈ میں شامل ہو جاتی ہے۔ براہ کرم اسے روزنامچہ میں دستی طور پر درج نہ کریں۔', 'warning');
    }
    item.type = type;
    item.fund = document.getElementById('ldg-edit-fund').value;
    item.category = category;
    item.amount = amount;
    item.date = document.getElementById('ldg-edit-date').value;
    item.details = details;
    item.responsiblePerson = document.getElementById('ldg-edit-responsible').value.trim() || window.ldgActorName();
    item.department = document.getElementById('ldg-edit-dept').value.trim();
    item.updatedBy = window.ldgActorName();
    item.updatedAt = Date.now();
    if (window.ldgNeedsApproval(type, amount)) {
      item.approvalStatus = 'pending';
      item.approvalLevelRequired = window.ldgApprovalLevel(amount);
      item.level1ApprovedBy = null;
      item.level1ApprovedAt = null;
      item.approvalStage = 0;
      item.approvedBy = null;
      item.approvedAt = null;
    } else if (item.approvalStatus === 'pending') {
      item.approvalStatus = 'approved';
      item.approvedBy = window.ldgActorName();
      item.approvedAt = Date.now();
      item.approvalLevelRequired = 0;
    }
    emsSaveKey(DB.ledger, JSON.stringify(ledgerDB));
    window.ldgAuditLog('update', 'ledger', id, before, window.ldgAuditSnapshot(item), 'روزنامچہ ترمیم');
    document.getElementById('ldg-entry-edit-modal').style.display = 'none';
    window._ldgEditingEntryId = null;
    calculateLedgerBalances();
    window.ldgRenderEntryList();
    window.ldgRenderApprovals();
    showToast(item.approvalStatus === 'pending' ? 'ترمیم محفوظ — دوبارہ منظوری درکار' : 'ترمیم محفوظ', 'success');
  };

  // =========================================================
  // ڈیش بورڈ + چارٹس
  // =========================================================
  window.ldgRenderDashboardCore = function () {
    if (typeof window.emsIsLedgerModuleActive === 'function' && !window.emsIsLedgerModuleActive()) return;
    calculateLedgerBalances();
    var ledgerDB = ldgApplyOptDeptFilter(JSON.parse(localStorage.getItem(DB.ledger)) || []);
    var monthIdx = ldgBuildLedgerMonthIndex(ledgerDB);
    var charts = document.getElementById('ldg-dash-charts');
    if (!charts) return;
    var balances = window.ldgComputeFundBalances();
    var fundSegs = window.ldgGetFunds().map(function (f) {
      return { label: f.name, value: Math.max(0, balances[f.id] || 0), color: f.color || '#64748b' };
    }).filter(function (s) { return s.value > 0; });
    var months = [];
    for (var i = 5; i >= 0; i--) {
      var d = new Date(); d.setMonth(d.getMonth() - i);
      var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      var bucket = monthIdx[key] || { income: 0, expense: 0 };
      months.push({ label: d.toLocaleDateString('ur-PK', { month: 'short' }), value: bucket.income - bucket.expense, income: bucket.income, expense: bucket.expense });
    }
    var donut = typeof window.emsDonutSVG === 'function' ? window.emsDonutSVG(fundSegs, fundSegs.reduce(function (s, x) { return s + x.value; }, 0), 'فنڈ') : '';
    var line = typeof window.emsLineChartSVG === 'function' ? window.emsLineChartSVG(months, '#2563eb') : '';
    var byCat = {};
    ledgerDB.filter(function (x) { return x.type === 'Expense' && window.ldgIsApproved(x); }).forEach(function (x) {
      byCat[x.category || 'دیگر'] = (byCat[x.category || 'دیگر'] || 0) + (x.amount || 0);
    });
    var catItems = Object.keys(byCat).slice(0, 8).map(function (c) { return { label: c, value: byCat[c] }; });
    var bar = typeof window.emsBarChartSVG === 'function' ? window.emsBarChartSVG(catItems) : '';
    var yearMonths = [];
    for (var yi = 11; yi >= 0; yi--) {
      var dd = new Date(); dd.setMonth(dd.getMonth() - yi);
      var k2 = dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0');
      var bucket2 = monthIdx[k2] || { income: 0, expense: 0 };
      yearMonths.push({
        label: dd.toLocaleDateString('ur-PK', { month: 'short' }),
        income: bucket2.income,
        expense: bucket2.expense
      });
    }
    var annualBar = '';
    if (typeof window.emsBarChartSVG === 'function') {
      var annualIncItems = yearMonths.map(function (m) { return { label: m.label, value: m.income, display: 'آمدن ' + m.income.toLocaleString() }; });
      var annualExpItems = yearMonths.map(function (m) { return { label: m.label, value: m.expense, display: 'خرچ ' + m.expense.toLocaleString() }; });
      annualBar = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;"><div><div style="font-size:11px;color:#16a34a;margin-bottom:4px;">آمدن</div>' + window.emsBarChartSVG(annualIncItems) + '</div><div><div style="font-size:11px;color:#dc2626;margin-bottom:4px;">خرچ</div>' + window.emsBarChartSVG(annualExpItems) + '</div></div>';
    }
    var payrollHist = JSON.parse(localStorage.getItem('ems_payroll_history') || '[]');
    var thisMonth = new Date().toISOString().slice(0, 7);
    var monthPayroll = payrollHist.filter(function (p) { return (p.month || '') === thisMonth; }).reduce(function (s, p) { return s + Number(p.netSalary || 0); }, 0);
    charts.innerHTML = '<div class="cmp-dash-card"><h4>فنڈ وار بیلنس</h4>' + donut + '</div>' +
      '<div class="cmp-dash-card cmp-dash-wide"><h4>6 ماہی خالص رقم</h4>' + line + '</div>' +
      '<div class="cmp-dash-card cmp-dash-wide"><h4>12 ماہی آمدن و خرچ (منظور شدہ)</h4>' + annualBar + '</div>' +
      '<div class="cmp-dash-card cmp-dash-wide"><h4>اخراجات (مد وار)</h4>' + bar + '</div>' +
      '<div class="cmp-dash-card"><h4>اس ماہ تنخواہ</h4><div style="font-size:28px;font-weight:800;color:#7c3aed;margin-top:12px;">Rs ' + monthPayroll.toLocaleString() + '</div></div>';
    var rem = document.getElementById('ldg-reminder-bar');
    if (rem) {
      var parts = [];
      var budgets = JSON.parse(localStorage.getItem('ems_ledger_budgets') || '[]');
      var over = budgets.filter(function (b) {
        var spent = ledgerDB.filter(function (x) {
          return x.type === 'Expense' && window.ldgIsApproved(x) && x.fund === b.fundId && x.category === b.category && (x.date || '').startsWith(b.year + '-' + String(b.month || 1).padStart(2, '0'));
        }).reduce(function (s, x) { return s + x.amount; }, 0);
        return b.amount > 0 && spent > b.amount;
      });
      if (over.length) parts.push('<div class="cmp-reminder"><i class="fas fa-exclamation-triangle"></i><span><b>' + over.length + '</b> بجٹ سے زیادہ اخراجات</span><button class="btn btn-sm btn-outline" onclick="switchLedgerTab(\'ledger-win-budget\', document.querySelector(\'#ldg-ribbon-menu [onclick*=budget]\'))">بجٹ</button></div>');
      var pending = ledgerDB.filter(function (x) { return x.approvalStatus === 'pending'; });
      if (pending.length) {
        var lvl2 = pending.filter(function (x) { return window.ldgGetEntryApprovalLevel(x) >= 2 && x.level1ApprovedBy; }).length;
        parts.push('<div class="cmp-reminder" style="background:#fffbeb;border-color:#fcd34d;color:#92400e;"><i class="fas fa-hourglass-half"></i><span><b>' + pending.length + '</b> منظوری منتظر' + (lvl2 ? ' (' + lvl2 + ' سطح 2)' : '') + '</span><button class="btn btn-sm btn-outline" onclick="switchLedgerTab(\'ledger-win-approvals\', document.querySelector(\'#ldg-ribbon-menu [onclick*=approvals]\'))">منظوری</button></div>');
      }
      var liabs = JSON.parse(localStorage.getItem('ems_ledger_liabilities') || '[]');
      var overdue = liabs.filter(function (l) { return l.status !== 'paid' && l.dueDate && l.dueDate < new Date().toISOString().slice(0, 10); });
      if (overdue.length) parts.push('<div class="cmp-reminder" style="background:#fef2f2;border-color:#fecaca;color:#991b1b;"><i class="fas fa-bell"></i><span><b>' + overdue.length + '</b> واجبات کی تاریخ گزر چکی</span><button class="btn btn-sm btn-outline" onclick="switchLedgerTab(\'ledger-win-liabilities\', document.querySelector(\'#ldg-ribbon-menu [onclick*=liabilities]\'))">واجبات</button></div>');
      rem.innerHTML = parts.join('');
      if (!parts.length) rem.innerHTML = '';
    }
  };

  window.ldgRenderDashboard = function () {
    if (typeof window.emsIsLedgerModuleActive === 'function' && !window.emsIsLedgerModuleActive()) return;
    var run = function () { window.ldgRenderDashboardCore(); };
    if (typeof window.emsDeferModuleWork === 'function') {
      window.emsDeferModuleWork(run, { idle: true, timeout: 400 });
    } else {
      run();
    }
  };

  // =========================================================
  // منظوری (Approval Workflow)
  // =========================================================
  window.ldgRenderApprovalsPager = function (total, page, pages) {
    var box = document.getElementById('ldg-approvals-pager');
    if (!box) return;
    if (total === 0) { box.innerHTML = ''; return; }
    var pageSize = typeof window.emsGetDomPageSize === 'function' ? window.emsGetDomPageSize() : 50;
    var start = (page - 1) * pageSize;
    var end = Math.min(start + pageSize, total);
    box.innerHTML = '<span class="reg-pg-info">' + (start + 1) + '–' + end + ' / ' + total + '</span>' +
      '<button class="reg-pg-btn" ' + (page <= 1 ? 'disabled' : '') + ' onclick="window.ldgApprovalsGoPage(' + (page - 1) + ')"><i class="fas fa-chevron-right"></i></button>' +
      '<span class="reg-pg-dots">صفحہ ' + page + ' / ' + pages + '</span>' +
      '<button class="reg-pg-btn" ' + (page >= pages ? 'disabled' : '') + ' onclick="window.ldgApprovalsGoPage(' + (page + 1) + ')"><i class="fas fa-chevron-left"></i></button>';
  };

  window.ldgApprovalsGoPage = function (p) {
    window._ldgApprovalPage = Math.max(1, p);
    window.ldgRenderApprovals();
  };

  window.ldgRenderApprovals = function () {
    if (typeof window.emsIsLedgerModuleActive === 'function' && !window.emsIsLedgerModuleActive()) return;
    var tbody = document.getElementById('ldg-approvals-tbody');
    if (!tbody) return;
    var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
    var pending = ledgerDB.filter(function (x) { return x.approvalStatus === 'pending'; }).sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    if (!pending.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#94a3b8;">کوئی زیرِ منظوری اندراج نہیں</td></tr>';
      window.ldgRenderApprovalsPager(0, 1, 1);
      return;
    }
    var pageSize = typeof window.emsGetDomPageSize === 'function' ? window.emsGetDomPageSize() : 50;
    var page = window._ldgApprovalPage || 1;
    var pages = Math.max(1, Math.ceil(pending.length / pageSize));
    if (page > pages) page = window._ldgApprovalPage = pages;
    var start = (page - 1) * pageSize;
    var pageRows = pending.slice(start, start + pageSize);
    tbody.innerHTML = pageRows.map(function (item) {
      var lvl = window.ldgGetEntryApprovalLevel(item);
      var stage = window.ldgGetApprovalStageLabel(item);
      var can = window.ldgCanApproveEntry(item);
      var btnLabel = (lvl >= 2 && item.level1ApprovedBy) ? 'سطح 2' : 'سطح 1';
      var btn = can.ok
        ? '<button class="btn btn-sm btn-success" onclick="window.ldgApproveEntry(\'' + item.id + '\')" title="' + btnLabel + ' منظور"><i class="fas fa-check"></i> ' + btnLabel + '</button>'
        : '<span style="font-size:11px;color:#94a3b8;" title="' + can.msg + '"><i class="fas fa-lock"></i></span>';
      return '<tr><td>' + item.date + '</td><td>' + window.ldgFundName(item.fund) + '</td><td>' + (item.category || '—') + '</td><td>Rs ' + Number(item.amount).toLocaleString() + '</td><td>سطح ' + lvl + '</td><td>' + stage + '</td><td>' + (item.createdBy || '—') + '</td><td style="font-size:12px;">' + (item.details || '—') + '</td><td>' + btn + ' <button class="btn btn-sm btn-outline" onclick="window.ldgRejectEntry(\'' + item.id + '\')"><i class="fas fa-times"></i></button></td></tr>';
    }).join('');
    window.ldgRenderApprovalsPager(pending.length, page, pages);
  };

  window.ldgApproveEntry = function (id) {
    var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
    var item = ledgerDB.find(function (x) { return x.id === id; });
    if (!item || item.approvalStatus !== 'pending') return;
    var check = window.ldgCanApproveEntry(item);
    if (!check.ok) return showToast(check.msg, 'warning');
    var before = window.ldgAuditSnapshot(item);
    var actor = window.ldgActorName();
    var req = window.ldgGetEntryApprovalLevel(item);
    if (req >= 2) {
      if (!item.level1ApprovedBy) {
        item.level1ApprovedBy = actor;
        item.level1ApprovedAt = Date.now();
        item.approvalStage = 1;
        window.ldgAuditLog('update', 'ledger', id, before, item, 'سطح 1 منظور — سطح 2 منتظر');
        showToast('سطح 1 منظور — اب دوسرے منتظم کی سطح 2 منظوری درکار', 'success');
      } else {
        item.approvalStatus = 'approved';
        item.approvedBy = actor;
        item.approvedAt = Date.now();
        item.approvalStage = 2;
        window.ldgAuditLog('update', 'ledger', id, before, item, 'سطح 2 منظور — مکمل');
        showToast('سطح 2 منظور — اندراج مکمل', 'success');
      }
    } else {
      item.approvalStatus = 'approved';
      item.approvedBy = actor;
      item.approvedAt = Date.now();
      item.approvalStage = 1;
      window.ldgAuditLog('update', 'ledger', id, before, item, 'منظور شد');
      showToast('منظور ہو گیا', 'success');
    }
    emsSaveKey(DB.ledger, JSON.stringify(ledgerDB));
    if (item.approvalStatus === 'approved') {
      window.ldgFinalizePayrollLedgerApproval(item);
    }
    window.ldgRenderApprovals();
    calculateLedgerBalances();
    window.ldgRenderDashboard();
    window.ldgRenderEntryList();
  };

  window.ldgRejectEntry = function (id) {
    if (!window.ldgRequireApproveModeration()) return;
    if (!confirm('یہ اندراج مسترد کریں؟')) return;
    var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
    var item = ledgerDB.find(function (x) { return x.id === id; });
    if (!item) return;
    var before = window.ldgAuditSnapshot(item);
    item.approvalStatus = 'rejected';
    item.rejectedBy = window.ldgActorName();
    item.rejectedAt = Date.now();
    window.ldgCancelPayrollOnLedgerReject(item);
    emsSaveKey(DB.ledger, JSON.stringify(ledgerDB));
    window.ldgAuditLog('update', 'ledger', id, before, item, 'مسترد');
    window.ldgRenderApprovals();
    showToast('مسترد', 'warning');
  };

  // =========================================================
  // واجبات (Liabilities)
  // =========================================================
  window.ldgGetLiabilities = function () {
    return JSON.parse(localStorage.getItem('ems_ledger_liabilities') || '[]');
  };

  window.ldgRenderLiabilities = function () {
    var tbody = document.getElementById('ldg-liabilities-tbody');
    if (!tbody) return;
    var list = window.ldgGetLiabilities();
    var today = new Date().toISOString().slice(0, 10);
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">کوئی واجبہ نہیں</td></tr>'; return; }
    tbody.innerHTML = list.map(function (l, idx) {
      var overdue = l.status !== 'paid' && l.dueDate && l.dueDate < today;
      var st = l.status === 'paid' ? '<span style="color:#16a34a;">ادا</span>' : (overdue ? '<span style="color:#dc2626;font-weight:bold;">تاخیر</span>' : '<span style="color:#d97706;">زیرِ التوا</span>');
      return '<tr><td><strong>' + (l.label || '—') + '</strong><br><small>' + (l.party || '') + '</small></td><td>Rs ' + Number(l.amount || 0).toLocaleString() + '</td><td>' + (l.dueDate || '—') + '</td><td>' + window.ldgFundName(l.fundId || 'General') + '</td><td>' + st + '</td><td style="font-size:12px;">' + (l.notes || '—') + '</td><td>' +
        (l.status !== 'paid' ? '<button class="btn btn-sm btn-success" onclick="window.ldgMarkLiabilityPaid(' + idx + ')"><i class="fas fa-check"></i></button> ' : '') +
        '<button class="btn btn-sm btn-outline" onclick="window.ldgDeleteLiability(' + idx + ')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
    var sumEl = document.getElementById('ldg-liabilities-total');
    if (sumEl) {
      var open = list.filter(function (l) { return l.status !== 'paid'; }).reduce(function (s, l) { return s + Number(l.amount || 0); }, 0);
      sumEl.innerText = 'Rs ' + open.toLocaleString();
    }
  };

  window.ldgAddLiability = function () {
    if (!window.ldgRequireEdit()) return;
    var label = (document.getElementById('ldg-liab-label') || {}).value;
    label = (label || '').trim();
    var amount = Number(document.getElementById('ldg-liab-amount') ? document.getElementById('ldg-liab-amount').value : 0);
    if (!label || !amount) return showToast('نام اور رقم درکار', 'error');
    var list = window.ldgGetLiabilities();
    var item = {
      id: generateID('LIAB'),
      label: label,
      party: document.getElementById('ldg-liab-party') ? document.getElementById('ldg-liab-party').value.trim() : '',
      amount: amount,
      dueDate: document.getElementById('ldg-liab-due') ? document.getElementById('ldg-liab-due').value : '',
      fundId: document.getElementById('ldg-liab-fund') ? document.getElementById('ldg-liab-fund').value : 'General',
      notes: document.getElementById('ldg-liab-notes') ? document.getElementById('ldg-liab-notes').value.trim() : '',
      status: 'open',
      createdAt: Date.now()
    };
    list.push(item);
    emsSaveKey('ems_ledger_liabilities', JSON.stringify(list));
    window.ldgAuditLog('create', 'liability', item.id, null, item, 'واجبہ شامل');
    document.getElementById('ldg-liab-label').value = '';
    document.getElementById('ldg-liab-amount').value = '';
    window.ldgRenderLiabilities();
    showToast('واجبہ محفوظ', 'success');
  };

  window.ldgMarkLiabilityPaid = function (idx) {
    if (!window.ldgRequireEdit()) return;
    var list = window.ldgGetLiabilities();
    var item = list[idx];
    if (!item) return;
    var before = window.ldgAuditSnapshot(item);
    var paidDate = new Date().toISOString().slice(0, 10);
    item.status = 'paid';
    item.paidDate = paidDate;
    item.paidBy = window.ldgActorName();
    var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
    var entryId = generateID('LDG-LIAB');
    var entry = {
      id: entryId,
      type: 'Expense',
      fund: item.fundId || 'General',
      category: 'واجبات / بل',
      amount: Number(item.amount) || 0,
      date: paidDate,
      details: 'واجبہ ادا: ' + (item.label || '') + (item.party ? ' — ' + item.party : '') + (item.notes ? ' (' + item.notes + ')' : ''),
      responsiblePerson: window.ldgActorName(),
      department: 'واجبات',
      createdBy: window.ldgActorName(),
      timestamp: Date.now(),
      approvalStatus: 'approved',
      approvedBy: window.ldgActorName(),
      approvedAt: Date.now(),
      liabilityId: item.id
    };
    ledgerDB.push(entry);
    item.ledgerEntryId = entryId;
    emsSaveKey(DB.ledger, JSON.stringify(ledgerDB));
    emsSaveKey('ems_ledger_liabilities', JSON.stringify(list));
    window.ldgAuditLog('update', 'liability', item.id, before, item, 'واجبہ ادا + روزنامچہ');
    window.ldgAuditLog('create', 'ledger', entryId, null, entry, 'واجبہ ادا: ' + item.label);
    calculateLedgerBalances();
    window.ldgRenderLiabilities();
    showToast('ادا شدہ — روزنامچہ میں اندراج', 'success');
  };

  window.ldgDeleteLiability = function (idx) {
    if (!window.ldgRequireEdit()) return;
    if (!confirm('حذف کریں؟')) return;
    var list = window.ldgGetLiabilities();
    var removed = list[idx];
    list.splice(idx, 1);
    emsSaveKey('ems_ledger_liabilities', JSON.stringify(list));
    window.ldgAuditLog('delete', 'liability', removed ? removed.id : '', removed, null, 'واجبہ حذف');
    window.ldgRenderLiabilities();
  };

  // =========================================================
  // بجٹ
  // =========================================================
  window.ldgRenderBudget = function () {
    var tbody = document.getElementById('ldg-budget-tbody');
    if (!tbody) return;
    var budgets = JSON.parse(localStorage.getItem('ems_ledger_budgets') || '[]');
    var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
    if (!budgets.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">کوئی بجٹ نہیں — نیچے شامل کریں</td></tr>'; return; }
    tbody.innerHTML = budgets.map(function (b, idx) {
      var prefix = b.year + '-' + String(b.month || 1).padStart(2, '0');
      var spent = ledgerDB.filter(function (x) {
        return x.type === 'Expense' && window.ldgIsApproved(x) && x.fund === b.fundId && x.category === b.category && (x.date || '').startsWith(prefix);
      }).reduce(function (s, x) { return s + x.amount; }, 0);
      var pct = b.amount > 0 ? Math.round((spent / b.amount) * 100) : 0;
      var st = spent > b.amount ? 'color:#dc2626;font-weight:bold;' : (pct > 80 ? 'color:#d97706;' : 'color:#16a34a;');
      return '<tr><td>' + window.ldgFundName(b.fundId) + '</td><td>' + b.category + '</td><td>' + (b.period || 'monthly') + '</td><td>Rs ' + b.amount.toLocaleString() + '</td><td style="' + st + '">Rs ' + spent.toLocaleString() + ' (' + pct + '%)</td><td>Rs ' + Math.max(0, b.amount - spent).toLocaleString() + '</td><td><button class="btn btn-sm btn-outline" onclick="window.ldgOpenEditBudget(' + idx + ')" title="ترمیم"><i class="fas fa-edit"></i></button> <button class="btn btn-sm btn-outline" onclick="window.ldgDeleteBudget(' + idx + ')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  };

  window.ldgDeleteBudget = function (idx) {
    if (!window.ldgRequireEdit()) return;
    var budgets = JSON.parse(localStorage.getItem('ems_ledger_budgets') || '[]');
    var removed = budgets[idx];
    budgets.splice(idx, 1);
    emsSaveKey('ems_ledger_budgets', JSON.stringify(budgets));
    window.ldgAuditLog('delete', 'budget', removed ? removed.id : '', removed, null, 'بجٹ حذف');
    window.ldgRenderBudget();
  };

  window.ldgOpenEditBudget = function (idx) {
    if (!window.ldgRequireEdit()) return;
    var budgets = JSON.parse(localStorage.getItem('ems_ledger_budgets') || '[]');
    var b = budgets[idx];
    if (!b) return;
    window._ldgEditingBudgetIdx = idx;
    document.getElementById('ldg-budget-fund').value = b.fundId || 'General';
    document.getElementById('ldg-budget-cat').value = b.category || '';
    document.getElementById('ldg-budget-amount').value = b.amount || 0;
    document.getElementById('ldg-budget-period').value = b.period || 'monthly';
    var monthVal = (b.year || new Date().getFullYear()) + '-' + String(b.month || 1).padStart(2, '0');
    if (document.getElementById('ldg-budget-month')) document.getElementById('ldg-budget-month').value = monthVal;
    var lbl = document.getElementById('ldg-budget-form-label');
    if (lbl) lbl.innerText = 'بجٹ ترمیم (#' + (idx + 1) + ')';
    var btn = document.getElementById('btn-save-budget');
    if (btn) btn.innerHTML = '<i class="fas fa-save"></i> ترمیم محفوظ';
    switchLedgerTab('ledger-win-budget', document.querySelector('#ldg-ribbon-menu [onclick*=budget]'));
    showToast('بجٹ فارم میں لوڈ — محفوظ کریں', 'info');
  };

  window.ldgCancelBudgetEdit = function () {
    window._ldgEditingBudgetIdx = null;
    document.getElementById('ldg-budget-cat').value = '';
    document.getElementById('ldg-budget-amount').value = '';
    var lbl = document.getElementById('ldg-budget-form-label');
    if (lbl) lbl.innerText = 'نیا بجٹ';
    var btn = document.getElementById('btn-save-budget');
    if (btn) btn.innerHTML = '<i class="fas fa-save"></i> بجٹ محفوظ';
  };

  // =========================================================
  // تنخواہ پروفائل + تاریخ
  // =========================================================
  window.ldgGetSalaryProfile = function (staffId) {
    var all = JSON.parse(localStorage.getItem('ems_full_salary') || '{}');
    return all[staffId] || { base: 0, allowances: {}, deductions: {}, bonus: 0 };
  };

  window.ldgSaveSalaryProfile = function () {
    if (!window.ldgRequireEdit()) return;
    var sid = document.getElementById('ldg-sal-staff') ? document.getElementById('ldg-sal-staff').value : '';
    if (!sid) return showToast('ملازم منتخب کریں', 'error');
    var all = JSON.parse(localStorage.getItem('ems_full_salary') || '{}');
    var before = all[sid] ? Object.assign({}, all[sid]) : null;
    all[sid] = {
      base: Number(document.getElementById('ldg-sal-base').value) || 0,
      allowances: {
        transport: Number(document.getElementById('ldg-sal-allow-transport').value) || 0,
        housing: Number(document.getElementById('ldg-sal-allow-housing').value) || 0,
        medical: Number(document.getElementById('ldg-sal-allow-medical').value) || 0
      },
      deductions: {
        advance: 0,
        other: Number(document.getElementById('ldg-sal-ded-other').value) || 0
      },
      bonus: Number(document.getElementById('ldg-sal-bonus').value) || 0
    };
    emsSaveKey('ems_full_salary', JSON.stringify(all));
    window.ldgAuditLog('update', 'salary', sid, before, all[sid], 'تنخواہ پروفائل');
    showToast('پروفائل محفوظ', 'success');
  };

  window.ldgLoadSalaryProfile = function () {
    var sid = document.getElementById('ldg-sal-staff') ? document.getElementById('ldg-sal-staff').value : '';
    if (!sid) return;
    var users = ldgGetUsers();
    var emp = users.find(function (u) { return u.id === sid; });
    var p = window.ldgGetSalaryProfile(sid);
    if (!p.base && emp) p.base = Number(emp.salary) || 0;
    document.getElementById('ldg-sal-base').value = p.base || 0;
    document.getElementById('ldg-sal-allow-transport').value = (p.allowances && p.allowances.transport) || 0;
    document.getElementById('ldg-sal-allow-housing').value = (p.allowances && p.allowances.housing) || 0;
    document.getElementById('ldg-sal-allow-medical').value = (p.allowances && p.allowances.medical) || 0;
    var advEl = document.getElementById('ldg-sal-ded-advance');
    if (advEl) {
      advEl.value = '0';
      advEl.disabled = true;
      advEl.title = 'پیشگی/قرض اب صرف ملازم واجبات (employee dues) سے کٹوتی ہوتی ہے';
    }
    document.getElementById('ldg-sal-ded-other').value = (p.deductions && p.deductions.other) || 0;
    document.getElementById('ldg-sal-bonus').value = p.bonus || 0;
    document.getElementById('ldg-sal-profile-area').style.display = 'block';
    var dueInfo = document.getElementById('ldg-sal-due-info');
    if (dueInfo && typeof window.ldgGetStaffDueBalance === 'function') {
      var bal = window.ldgGetStaffDueBalance(sid);
      dueInfo.innerHTML = bal > 0 ? '<p style="color:#d97706;font-size:13px;margin:8px 0 0;"><i class="fas fa-exclamation-circle"></i> باقی واجبہ: Rs ' + bal.toLocaleString() + ' — پے رول سے کٹوتی ہوگی</p>' : '<p style="color:#16a34a;font-size:13px;margin:8px 0 0;"><i class="fas fa-check"></i> کوئی کھلا واجبہ نہیں</p>';
    }
  };

  function ldgDaysInMonth(monthVal) {
    var parts = String(monthVal || '').split('-');
    if (parts.length < 2) return 30;
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    if (!y || !m) return 30;
    return new Date(y, m, 0).getDate();
  }

  function ldgEmpIdAliasSet(emp) {
    var set = Object.create(null);
    var ids = (typeof window.emsCollectUserIdAliases === 'function')
      ? window.emsCollectUserIdAliases(emp)
      : [emp.id];
    (ids || []).forEach(function (id) {
      if (id != null && id !== '') set[String(id)] = true;
    });
    if (emp && emp.id) set[String(emp.id)] = true;
    return set;
  }

  function ldgFilterEmpAttendance(attendanceDB, emp, monthVal) {
    var ids = ldgEmpIdAliasSet(emp);
    var yearPrefix = monthVal ? monthVal.substring(0, 4) : '';
    var monthStart = monthVal ? monthVal + '-01' : '';
    var monthRows = [];
    var yearLeaveCount = 0;
    var yearLeavesBeforeMonth = 0;
    (attendanceDB || []).forEach(function (a) {
      if (!a || !ids[a.studentId]) return;
      if (a.date && a.date.indexOf(monthVal) === 0) monthRows.push(a);
      if (yearPrefix && a.date && a.date.indexOf(yearPrefix) === 0 && a.status === 'رخصت') {
        yearLeaveCount++;
        if (monthStart && a.date < monthStart) yearLeavesBeforeMonth++;
      }
    });
    return { monthRows: monthRows, yearLeaveCount: yearLeaveCount, yearLeavesBeforeMonth: yearLeavesBeforeMonth };
  }

  function ldgLeaveQuotaPenaltyDays(monthLeaves, blackouts, yearLeavesBeforeMonth, allowedQuota) {
    allowedQuota = allowedQuota || 15;
    var deductionDays = 0;
    var runningYearLeaves = Number(yearLeavesBeforeMonth) || 0;
    monthLeaves.slice().sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); }).forEach(function (att) {
      var isBlackout = blackouts.some(function (b) { return att.date >= b.start && att.date <= b.end; });
      if (isBlackout) {
        deductionDays += 1;
        return;
      }
      runningYearLeaves += 1;
      if (runningYearLeaves > allowedQuota) deductionDays += 1;
    });
    return deductionDays;
  }

  function ldgComputePayrollRow(emp, monthVal, attendanceDB, blackouts, paidSalaries) {
    var profile = window.ldgGetSalaryProfile(emp.id);
    var baseSalary = profile.base || Number(emp.salary) || 0;
    var allowSum = Object.keys(profile.allowances || {}).reduce(function (s, k) { return s + Number(profile.allowances[k] || 0); }, 0);
    var dedFixed = Number((profile.deductions && profile.deductions.other) || 0);
    var bonus = Number(profile.bonus) || 0;
    var attSlice = ldgFilterEmpAttendance(attendanceDB, emp, monthVal);
    var empAttendance = attSlice.monthRows;
    var totalAbsents = empAttendance.filter(function (a) { return a.status === 'غیر حاضر'; }).length;
    var allowedQuota = 15;
    var monthLeaves = empAttendance.filter(function (a) { return a.status === 'رخصت'; });
    var leavePenaltyDays = ldgLeaveQuotaPenaltyDays(monthLeaves, blackouts, attSlice.yearLeavesBeforeMonth, allowedQuota);
    var deductionDays = totalAbsents + leavePenaltyDays;
    var daysInMonth = ldgDaysInMonth(monthVal);
    var dailyRateBase = baseSalary + allowSum;
    var absentDeduction = deductionDays > 0 ? Math.round((dailyRateBase / daysInMonth) * deductionDays) : 0;
    var gross = baseSalary + allowSum + bonus;
    var netBeforeDues = gross - dedFixed - absentDeduction;
    var dueCalc = typeof window.ldgComputeDueDeduction === 'function' ? window.ldgComputeDueDeduction(emp.id, netBeforeDues) : { total: 0, breakdown: [] };
    var netSalary = netBeforeDues - dueCalc.total;
    var shortfall = netSalary < 0 ? Math.abs(netSalary) : 0;
    var isPaid = window.ldgPayrollMonthAlreadyPaid(emp.id, monthVal);
    return {
      staffId: emp.id, name: emp.name, month: monthVal, baseSalary: baseSalary,
      allowances: allowSum, allowancesDetail: profile.allowances || {}, bonus: bonus,
      fixedDeductions: dedFixed, deductionsDetail: { other: dedFixed },
      absents: deductionDays, absentDeduction: absentDeduction,
      daysInMonth: daysInMonth, dailyRateBase: dailyRateBase,
      dueDeduction: dueCalc.total, dueBreakdown: dueCalc.breakdown,
      netSalary: netSalary, shortfall: shortfall, isPaid: isPaid,
      gross: gross, netBeforeDues: netBeforeDues
    };
  }

  // =========================================================
  // ملازم واجبات (پیشگی / قرض) — پے رول سے منسلک
  // =========================================================
  window.ldgGetPayrollHistory = function () {
    try { return JSON.parse(localStorage.getItem('ems_payroll_history') || '[]'); }
    catch (e) { return []; }
  };

  window.ldgPayrollRecordActive = function (rec) {
    if (!rec) return false;
    var st = rec.approvalStatus || (rec.duesApplied === false ? 'pending' : 'approved');
    return st !== 'rejected' && st !== 'cancelled';
  };

  window.ldgPayrollMonthAlreadyPaid = function (staffId, monthVal) {
    return window.ldgGetPayrollHistory().some(function (p) {
      return p.staffId === staffId
        && p.month === monthVal
        && (p.paymentType || 'monthly') === 'monthly'
        && window.ldgPayrollRecordActive(p);
    });
  };

  window.ldgFindPayrollHistoryById = function (histId) {
    return window.ldgGetPayrollHistory().find(function (h) { return h.id === histId; }) || null;
  };

  window.ldgSavePayrollHistory = function (list) {
    emsSaveKey('ems_payroll_history', JSON.stringify(list));
  };

  window.ldgFinalizePayrollLedgerApproval = function (ledgerEntry) {
    if (!ledgerEntry || !ledgerEntry.payrollHistId || ledgerEntry.payrollDuesApplied) return;
    var list = window.ldgGetPayrollHistory();
    var hist = list.find(function (h) { return h.id === ledgerEntry.payrollHistId; });
    if (!hist || hist.duesApplied) return;
    if (hist.dueBreakdown && hist.dueBreakdown.length) {
      window.ldgApplyPayrollDueDeductions(hist.dueBreakdown, hist.id);
    }
    hist.duesApplied = true;
    hist.approvalStatus = 'approved';
    ledgerEntry.payrollDuesApplied = true;
    window.ldgSavePayrollHistory(list);
    window.ldgRenderEmployeeDues();
    window.ldgRenderPayrollHistory();
    window.ldgAuditLog('update', 'payroll', hist.id, null, hist, 'منظوری — واجبات کٹوتی');
  };

  window.ldgCancelPayrollOnLedgerReject = function (ledgerEntry) {
    if (!ledgerEntry || !ledgerEntry.payrollHistId) return;
    var list = window.ldgGetPayrollHistory();
    var hist = list.find(function (h) { return h.id === ledgerEntry.payrollHistId; });
    if (!hist) return;
    var before = window.ldgAuditSnapshot(hist);
    hist.approvalStatus = 'cancelled';
    hist.cancelledAt = Date.now();
    hist.cancelledBy = window.ldgActorName();
    window.ldgSavePayrollHistory(list);
    window.ldgAuditLog('update', 'payroll', hist.id, before, hist, 'تنخواہ منظوری مسترد — ماہ دوبارہ ادا کیا جا سکتا ہے');
    window.ldgRenderPayrollHistory();
  };

  window.ldgGetEmployeeDues = function () {
    return JSON.parse(localStorage.getItem('ems_ledger_employee_dues') || '[]');
  };

  window.ldgGetStaffOpenDues = function (staffId) {
    return window.ldgGetEmployeeDues().filter(function (d) { return d.staffId === staffId && Number(d.remaining) > 0; });
  };

  window.ldgGetStaffDueBalance = function (staffId) {
    return window.ldgGetStaffOpenDues(staffId).reduce(function (s, d) { return s + Number(d.remaining || 0); }, 0);
  };

  window.ldgComputeDueDeduction = function (staffId, availableNet) {
    var cap = Number(availableNet);
    var salaryCapped = cap > 0;
    var dues = window.ldgGetStaffOpenDues(staffId);
    var total = 0;
    var breakdown = [];
    dues.forEach(function (d) {
      var remaining = Number(d.remaining) || 0;
      if (remaining <= 0) return;
      var scheduled = Number(d.monthlyDeduction) > 0
        ? Math.min(Number(d.monthlyDeduction), remaining)
        : remaining;
      var amt;
      if (salaryCapped) {
        if (total >= cap) return;
        amt = Math.min(scheduled, cap - total, remaining);
      } else {
        amt = Math.min(scheduled, remaining);
      }
      if (amt > 0) {
        breakdown.push({ dueId: d.id, amount: amt, label: d.type || 'advance' });
        total += amt;
      }
    });
    return { total: total, breakdown: breakdown };
  };

  window.ldgApplyPayrollDueDeductions = function (breakdown, payrollId) {
    if (!breakdown || !breakdown.length) return;
    var dues = window.ldgGetEmployeeDues();
    breakdown.forEach(function (b) {
      var d = dues.find(function (x) { return x.id === b.dueId; });
      if (!d) return;
      d.remaining = Math.max(0, Number(d.remaining) - Number(b.amount));
      if (!d.history) d.history = [];
      d.history.push({ date: new Date().toISOString().slice(0, 10), amount: b.amount, type: 'payroll_deduction', payrollId: payrollId });
    });
    emsSaveKey('ems_ledger_employee_dues', JSON.stringify(dues));
  };

  window.ldgDueTypeLabel = function (t) {
    return { advance: 'پیشگی', loan: 'قرض', other: 'دیگر' }[t] || t || '—';
  };

  window.ldgRenderEmployeeDues = function () {
    var tbody = document.getElementById('ldg-employee-dues-tbody');
    if (!tbody) return;
    var list = window.ldgGetEmployeeDues();
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">کوئی واجبہ نہیں</td></tr>'; return; }
    tbody.innerHTML = list.map(function (d, idx) {
      var rem = Number(d.remaining || 0);
      var st = rem <= 0 ? '<span style="color:#16a34a;">مکمل</span>' : '<span style="color:#d97706;">باقی Rs ' + rem.toLocaleString() + '</span>';
      return '<tr><td>' + (d.staffName || d.staffId) + '</td><td>' + window.ldgDueTypeLabel(d.type) + '</td><td>Rs ' + Number(d.totalAmount || 0).toLocaleString() + '</td><td>Rs ' + rem.toLocaleString() + '</td><td>' + (d.monthlyDeduction ? 'Rs ' + Number(d.monthlyDeduction).toLocaleString() : 'مکمل') + '</td><td>' + st + '</td><td>' +
        (rem > 0 ? '<button class="btn btn-sm btn-outline" onclick="window.ldgReceiveDuePayment(' + idx + ')" title="وصولی"><i class="fas fa-hand-holding-usd"></i></button> ' : '') +
        '<button class="btn btn-sm btn-outline" onclick="window.ldgDeleteEmployeeDue(' + idx + ')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
    var sumEl = document.getElementById('ldg-employee-dues-total');
    if (sumEl) {
      var open = list.reduce(function (s, d) { return s + Number(d.remaining || 0); }, 0);
      sumEl.innerText = 'Rs ' + open.toLocaleString();
    }
  };

  window.ldgAddEmployeeDue = function () {
    if (!window.ldgRequireEdit()) return;
    var sid = document.getElementById('ldg-due-staff') ? document.getElementById('ldg-due-staff').value : '';
    var amount = Number(document.getElementById('ldg-due-amount') ? document.getElementById('ldg-due-amount').value : 0);
    if (!sid || !amount) return showToast('ملازم اور رقم درکار', 'error');
    var users = ldgGetUsers();
    var emp = users.find(function (u) { return u.id === sid; });
    var list = window.ldgGetEmployeeDues();
    var item = {
      id: generateID('EDUE'),
      staffId: sid,
      staffName: emp ? emp.name : sid,
      type: document.getElementById('ldg-due-type') ? document.getElementById('ldg-due-type').value : 'advance',
      totalAmount: amount,
      remaining: amount,
      monthlyDeduction: Number(document.getElementById('ldg-due-monthly') ? document.getElementById('ldg-due-monthly').value : 0) || 0,
      notes: document.getElementById('ldg-due-notes') ? document.getElementById('ldg-due-notes').value.trim() : '',
      createdAt: Date.now(),
      history: [{ date: new Date().toISOString().slice(0, 10), amount: amount, type: 'issued', note: 'نیا واجبہ' }]
    };
    list.push(item);
    emsSaveKey('ems_ledger_employee_dues', JSON.stringify(list));
    window.ldgAuditLog('create', 'employee_due', item.id, null, item, 'ملازم واجبہ: ' + item.staffName);
    document.getElementById('ldg-due-amount').value = '';
    if (document.getElementById('ldg-due-notes')) document.getElementById('ldg-due-notes').value = '';
    window.ldgRenderEmployeeDues();
    showToast('ملازم واجبہ محفوظ', 'success');
  };

  window.ldgReceiveDuePayment = function (idx) {
    if (!window.ldgRequireEdit()) return;
    var list = window.ldgGetEmployeeDues();
    var item = list[idx];
    if (!item) return;
    var amt = prompt('وصولی کی رقم (باقی: Rs ' + item.remaining + '):', String(item.remaining));
    if (!amt) return;
    amt = Number(amt);
    if (!amt || amt <= 0) return showToast('درست رقم درج کریں', 'error');
    var before = Object.assign({}, item);
    item.remaining = Math.max(0, Number(item.remaining) - amt);
    if (!item.history) item.history = [];
    item.history.push({ date: new Date().toISOString().slice(0, 10), amount: amt, type: 'manual_payment', note: 'براہِ راست وصولی' });
    emsSaveKey('ems_ledger_employee_dues', JSON.stringify(list));
    window.ldgAuditLog('update', 'employee_due', item.id, before, item, 'واجبہ وصولی');
    window.ldgRenderEmployeeDues();
    showToast('وصولی محفوظ', 'success');
  };

  window.ldgDeleteEmployeeDue = function (idx) {
    if (!window.ldgRequireEdit()) return;
    if (!confirm('یہ واجبہ حذف کریں؟')) return;
    var list = window.ldgGetEmployeeDues();
    var removed = list[idx];
    list.splice(idx, 1);
    emsSaveKey('ems_ledger_employee_dues', JSON.stringify(list));
    window.ldgAuditLog('delete', 'employee_due', removed ? removed.id : '', removed, null, 'واجبہ حذف');
    window.ldgRenderEmployeeDues();
  };

  // =========================================================
  // خصوصی ادائیگیاں (بونس، عید، اوور ٹائم وغیرہ)
  // =========================================================
  window.ldgGetSpecialPayments = function () {
    return JSON.parse(localStorage.getItem('ems_payroll_special') || '[]');
  };

  window.ldgSpecialTypeLabel = function (t) {
    return { bonus: 'بونس', eid: 'عید / تہوار', overtime: 'اوور ٹائم', allowance: 'خصوصی الاؤنس', other: 'دیگر' }[t] || t || '—';
  };

  window.ldgRenderSpecialPayments = function () {
    var tbody = document.getElementById('ldg-special-payments-tbody');
    if (!tbody) return;
    var list = window.ldgGetSpecialPayments().slice().sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">کوئی خصوصی ادائیگی نہیں</td></tr>'; return; }
    tbody.innerHTML = list.slice(0, 80).map(function (p) {
      return '<tr><td>' + (p.date || '—') + '</td><td>' + (p.staffName || p.staffId) + '</td><td>' + window.ldgSpecialTypeLabel(p.type) + '</td><td>Rs ' + Number(p.amount || 0).toLocaleString() + '</td><td style="font-size:12px;">' + (p.notes || '—') + '</td><td><button class="btn btn-sm btn-outline" onclick="window.ldgDeleteSpecialPayment(\'' + p.id + '\')"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
  };

  window.ldgSaveSpecialPayment = function () {
    if (!window.ldgRequireEdit()) return;
    var sid = document.getElementById('ldg-spec-staff') ? document.getElementById('ldg-spec-staff').value : '';
    var amount = Number(document.getElementById('ldg-spec-amount') ? document.getElementById('ldg-spec-amount').value : 0);
    if (!sid || !amount) return showToast('ملازم اور رقم درکار', 'error');
    var users = ldgGetUsers();
    var emp = users.find(function (u) { return u.id === sid; });
    var type = document.getElementById('ldg-spec-type') ? document.getElementById('ldg-spec-type').value : 'bonus';
    var notes = document.getElementById('ldg-spec-notes') ? document.getElementById('ldg-spec-notes').value.trim() : '';
    var date = document.getElementById('ldg-spec-date') ? document.getElementById('ldg-spec-date').value : new Date().toISOString().slice(0, 10);
    var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
    var entryId = generateID('LDG-SPC');
    var details = 'خصوصی ادائیگی (' + window.ldgSpecialTypeLabel(type) + '): ' + (emp ? emp.name : sid) + (notes ? ' — ' + notes : '');
    var entry = {
      id: entryId, type: 'Expense', fund: 'General', category: 'طعام و تنخواہ',
      amount: amount, date: date, details: details,
      responsiblePerson: window.ldgActorName(), department: 'تنخواہ',
      createdBy: window.ldgActorName(), timestamp: Date.now(), approvalStatus: 'approved'
    };
    ledgerDB.push(entry);
    var rec = {
      id: generateID('SPC'), staffId: sid, staffName: emp ? emp.name : sid,
      type: type, amount: amount, date: date, month: date.slice(0, 7),
      notes: notes, ledgerEntryId: entryId, paidBy: window.ldgActorName(),
      paymentType: 'special', timestamp: Date.now()
    };
    var list = window.ldgGetSpecialPayments();
    list.push(rec);
    emsSaveKey(DB.ledger, JSON.stringify(ledgerDB));
    emsSaveKey('ems_payroll_special', JSON.stringify(list));
    window.ldgAuditLog('create', 'special_payment', rec.id, null, rec, details);
    window.ldgAuditLog('create', 'ledger', entryId, null, entry, 'خصوصی تنخواہ');
    document.getElementById('ldg-spec-amount').value = '';
    if (document.getElementById('ldg-spec-notes')) document.getElementById('ldg-spec-notes').value = '';
    calculateLedgerBalances();
    window.ldgRenderSpecialPayments();
    window.ldgRenderPayrollAnnualSummary();
    showToast('خصوصی ادائیگی محفوظ', 'success');
  };

  window.ldgDeleteSpecialPayment = function (id) {
    if (!window.ldgRequireEdit()) return;
    var list = window.ldgGetSpecialPayments();
    var rec = list.find(function (p) { return p.id === id; });
    if (!rec) return;
    if (!confirm('خصوصی ادائیگی اور منسلک روزنامچہ اندراج حذف کریں؟')) return;
    if (rec.ledgerEntryId) {
      var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
      var before = ledgerDB.find(function (x) { return x.id === rec.ledgerEntryId; });
      ledgerDB = ledgerDB.filter(function (x) { return x.id !== rec.ledgerEntryId; });
      emsSaveKey(DB.ledger, JSON.stringify(ledgerDB));
      if (before) window.ldgAuditLog('delete', 'ledger', rec.ledgerEntryId, before, null, 'خصوصی تنخواہ حذف');
      calculateLedgerBalances();
    }
    list = list.filter(function (p) { return p.id !== id; });
    emsSaveKey('ems_payroll_special', JSON.stringify(list));
    window.ldgAuditLog('delete', 'special_payment', id, rec, null, 'خصوصی ادائیگی حذف');
    window.ldgRenderSpecialPayments();
    window.ldgRenderPayrollAnnualSummary();
    showToast('خصوصی ادائیگی اور روزنامچہ اندراج حذف', 'warning');
  };

  // =========================================================
  // سالانہ تنخواہ خلاصہ
  // =========================================================
  window.ldgRenderPayrollAnnualSummary = function () {
    var tbody = document.getElementById('ldg-payroll-annual-tbody');
    var cards = document.getElementById('ldg-payroll-annual-cards');
    if (!tbody) return;
    var yearEl = document.getElementById('ldg-payroll-year');
    var year = yearEl ? (yearEl.value || new Date().getFullYear()) : new Date().getFullYear();
    if (yearEl && !yearEl.value) yearEl.value = String(new Date().getFullYear());
    var hist = JSON.parse(localStorage.getItem('ems_payroll_history') || '[]').filter(function (h) { return (h.month || '').startsWith(String(year)); });
    var special = window.ldgGetSpecialPayments().filter(function (p) { return (p.date || p.month || '').startsWith(String(year)); });
    var byStaff = {};
    hist.forEach(function (h) {
      if (!byStaff[h.staffId]) byStaff[h.staffId] = { name: h.staffName || h.staffId, months: 0, net: 0, base: 0, special: 0 };
      byStaff[h.staffId].months += 1;
      byStaff[h.staffId].net += Number(h.netSalary || 0);
      byStaff[h.staffId].base += Number(h.baseSalary || 0);
    });
    special.forEach(function (p) {
      if (!byStaff[p.staffId]) byStaff[p.staffId] = { name: p.staffName || p.staffId, months: 0, net: 0, base: 0, special: 0 };
      byStaff[p.staffId].special += Number(p.amount || 0);
    });
    var rows = Object.keys(byStaff).map(function (k) { return Object.assign({ staffId: k }, byStaff[k]); }).sort(function (a, b) { return b.net + b.special - (a.net + a.special); });
    window._ldgAnnualSummaryRows = [['ملازم', 'مہینے', 'بنیادی کل', 'ماہانہ خالص', 'خصوصی', 'کل ادا شدہ']];
    var totalNet = 0, totalSpecial = 0, totalAll = 0;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">' + year + ' میں کوئی ادائیگی نہیں</td></tr>';
    } else {
      tbody.innerHTML = rows.map(function (r) {
        var all = r.net + r.special;
        totalNet += r.net; totalSpecial += r.special; totalAll += all;
        window._ldgAnnualSummaryRows.push([r.name, r.months, r.base, r.net, r.special, all]);
        return '<tr><td><strong>' + r.name + '</strong></td><td>' + r.months + '</td><td>Rs ' + r.base.toLocaleString() + '</td><td>Rs ' + r.net.toLocaleString() + '</td><td>Rs ' + r.special.toLocaleString() + '</td><td style="font-weight:bold;color:#2563eb;">Rs ' + all.toLocaleString() + '</td></tr>';
      }).join('');
    }
    if (cards) {
      cards.innerHTML = '<div class="stat-card" style="background:#eff6ff;"><div class="stat-label">سال ' + year + ' — ماہانہ</div><div class="stat-value">Rs ' + totalNet.toLocaleString() + '</div></div>' +
        '<div class="stat-card" style="background:#f5f3ff;"><div class="stat-label">خصوصی ادائیگیاں</div><div class="stat-value">Rs ' + totalSpecial.toLocaleString() + '</div></div>' +
        '<div class="stat-card" style="background:#ecfdf5;"><div class="stat-label">کل تنخواہ + خصوصی</div><div class="stat-value">Rs ' + totalAll.toLocaleString() + '</div></div>' +
        '<div class="stat-card" style="background:#fff7ed;"><div class="stat-label">ملازم</div><div class="stat-value">' + rows.length + '</div></div>';
    }
  };

  window.ldgExportPayrollAnnualExcel = function () {
    if (!window._ldgAnnualSummaryRows) return showToast('پہلے خلاصہ دیکھیں', 'warning');
    var year = document.getElementById('ldg-payroll-year') ? document.getElementById('ldg-payroll-year').value : new Date().getFullYear();
    window.ldgExportExcel(window._ldgAnnualSummaryRows, 'تنخواہ_سال_' + year + '.xlsx', 'سالانہ');
  };

  window.ldgExportPayrollAnnualCSV = function () {
    if (!window._ldgAnnualSummaryRows) return showToast('پہلے خلاصہ دیکھیں', 'warning');
    var year = document.getElementById('ldg-payroll-year') ? document.getElementById('ldg-payroll-year').value : new Date().getFullYear();
    window.ldgDownloadCSV(window._ldgAnnualSummaryRows, 'تنخواہ_سال_' + year + '.csv');
  };

  // =========================================================
  // مکمل برانڈڈ تنخواہ پرچی
  // =========================================================
  window.ldgBuildPayslipBody = function (hist) {
    var users = ldgGetUsers();
    var emp = users.find(function (u) { return u.id === hist.staffId; });
    var role = emp ? (emp.type === 'teacher' ? 'استاد' : 'ملازم') : '—';
    var allowDetail = hist.allowancesDetail || {};
    var dedDetail = hist.deductionsDetail || {};
    var rows = [['بنیادی تنخواہ', hist.baseSalary || 0]];
    if (allowDetail.transport) rows.push(['ٹرانسپورٹ الاؤنس', allowDetail.transport]);
    if (allowDetail.housing) rows.push(['رہائش الاؤنس', allowDetail.housing]);
    if (allowDetail.medical) rows.push(['طبی الاؤنس', allowDetail.medical]);
    if (!allowDetail.transport && !allowDetail.housing && !allowDetail.medical && hist.allowances) rows.push(['کل الاؤنس', hist.allowances]);
    if (hist.bonus) rows.push(['بونس', hist.bonus]);
    rows.push(['مجموعی آمدن (gross)', hist.gross || ((hist.baseSalary || 0) + (hist.allowances || 0) + (hist.bonus || 0))]);
    if (hist.absentDeduction) rows.push(['غیر حاضری کٹوتی (' + (hist.absents || 0) + ' دن)', -hist.absentDeduction]);
    if (dedDetail.other) rows.push(['دیگر کٹوتی', -dedDetail.other]);
    else if (hist.fixedDeductions) rows.push(['ثابت کٹوتیاں', -hist.fixedDeductions]);
    if (hist.dueDeduction) rows.push(['ملازم واجبہ کٹوتی', -hist.dueDeduction]);
    var tableRows = rows.map(function (r) {
      var val = Number(r[1]);
      var color = val < 0 ? '#dc2626' : '#16a34a';
      return '<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">' + r[0] + '</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:left;font-weight:600;color:' + color + ';">Rs ' + Math.abs(val).toLocaleString() + (val < 0 ? ' (−)' : '') + '</td></tr>';
    }).join('');
    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin:12px 0;font-size:13px;">' +
      '<div><b>ملازم:</b> ' + (hist.staffName || hist.staffId) + '</div>' +
      '<div><b>شناختی نمبر:</b> ' + (hist.staffId || '—') + '</div>' +
      '<div><b>عہدہ:</b> ' + role + '</div>' +
      '<div><b>مہینہ:</b> ' + (hist.month || '—') + '</div>' +
      '<div><b>ادائیگی تاریخ:</b> ' + (hist.paidDate || '—') + '</div>' +
      '<div><b>ادا کنندہ:</b> ' + (hist.paidBy || '—') + '</div>' +
      '</div>' +
      '<table style="width:100%;border-collapse:collapse;margin:12px 0;border:1px solid #cbd5e1;"><thead><tr style="background:#f1f5f9;"><th style="padding:8px;text-align:right;">تفصیل</th><th style="padding:8px;text-align:left;">رقم</th></tr></thead><tbody>' + tableRows +
      '<tr style="background:#eff6ff;font-weight:800;"><td style="padding:10px;">خالص تنخواہ</td><td style="padding:10px;text-align:left;color:' + (Number(hist.netSalary || 0) < 0 ? '#dc2626' : '#1d4ed8') + ';">' +
      (Number(hist.netSalary || 0) < 0 ? '− Rs ' + Math.abs(Number(hist.netSalary)).toLocaleString() + ' (کمی)' : 'Rs ' + Number(hist.netSalary || 0).toLocaleString()) + '</td></tr></tbody></table>' +
      (hist.shortfall ? '<p style="font-size:12px;color:#dc2626;margin-top:8px;"><i class="fas fa-exclamation-triangle"></i> واجبہ کٹوتی سے کمی: Rs ' + Number(hist.shortfall).toLocaleString() + '</p>' : '') +
      (hist.paymentType === 'special' ? '<p style="font-size:12px;color:#7c3aed;"><i class="fas fa-star"></i> خصوصی ادائیگی</p>' : '');
  };

  window.ldgRenderPayrollHistory = function () {
    var tbody = document.getElementById('ldg-payroll-history-tbody');
    if (!tbody) return;
    var hist = JSON.parse(localStorage.getItem('ems_payroll_history') || '[]');
    if (typeof window.emsIsOptionalDeptFilterOn === 'function' && window.emsIsOptionalDeptFilterOn('ledger')) {
      var users = ldgGetUsers();
      var userMap = {};
      users.forEach(function (u) { if (u && u.id) userMap[u.id] = u; });
      hist = hist.filter(function (h) {
        var emp = userMap[h.staffId];
        return emp && typeof window.emsRecordMatchesDepartment === 'function' && window.emsRecordMatchesDepartment(emp);
      });
    }
    hist.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    if (!hist.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">کوئی تاریخ نہیں</td></tr>'; return; }
    tbody.innerHTML = hist.slice(0, 100).map(function (h) {
      var st = h.approvalStatus || (h.duesApplied === false ? 'pending' : 'approved');
      var stLbl = st === 'pending' ? '<span style="color:#d97706;font-size:11px;">زیرِ منظوری</span> ' : (st === 'cancelled' || st === 'rejected' ? '<span style="color:#94a3b8;font-size:11px;">' + st + '</span> ' : '');
      return '<tr><td>' + (h.month || '—') + '</td><td>' + (h.staffName || h.staffId) + '</td><td>Rs ' + Number(h.netSalary || 0).toLocaleString() + '</td><td>' + (h.paidDate || '—') + '</td><td>' + (h.paidBy || '—') + ' ' + stLbl + '</td><td><button class="btn btn-sm btn-outline" onclick="window.ldgPrintPayslip(\'' + h.id + '\',\'print\')" title="پرنٹ"><i class="fas fa-print"></i></button> <button class="btn btn-sm btn-outline" onclick="window.ldgPrintPayslip(\'' + h.id + '\',\'pdf\')" title="PDF"><i class="fas fa-file-pdf"></i></button></td></tr>';
    }).join('');
  };

  window.ldgPrintPayslip = function (histId, mode) {
    var hist = (JSON.parse(localStorage.getItem('ems_payroll_history') || '[]')).find(function (h) { return h.id === histId; });
    if (!hist) {
      hist = window.ldgGetSpecialPayments().find(function (p) { return p.id === histId; });
      if (hist) hist = Object.assign({}, hist, { netSalary: hist.amount, paymentType: 'special', paidDate: hist.date });
    }
    if (!hist) return;
    var box = document.getElementById('ldg-payslip-print');
    if (!box) return;
    var bh = document.getElementById('ldg-payslip-brand');
    if (bh && typeof window.attBrandHeaderHTML === 'function') bh.innerHTML = window.attBrandHeaderHTML();
    var body = document.getElementById('ldg-payslip-body');
    if (body) body.innerHTML = window.ldgBuildPayslipBody(hist);
    var bf = document.getElementById('ldg-payslip-brand-footer');
    if (bf && typeof window.attSignFooterHTML === 'function') bf.innerHTML = window.attSignFooterHTML();
    box.style.display = 'block';
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (mode === 'pdf' && typeof window.ldgExportPDF === 'function') window.ldgExportPDF('ldg-payslip-print', 'تنخواہ_پرچی_' + (hist.staffName || hist.staffId));
    else if (mode === 'print' && typeof window.printDiv === 'function') window.printDiv('ldg-payslip-print');
  };

  window.paySalaryInstant = function (staffId, silent) {
    if (!window.ldgRequireEdit()) return false;
    if (typeof window.emsPayrollSelfPaymentBlocked === 'function') {
      var selfBlock = window.emsPayrollSelfPaymentBlocked(staffId);
      if (selfBlock.blocked) {
        if (!silent) showToast(selfBlock.message, 'error');
        return false;
      }
    }
    var empData = window._ldgPayrollData ? window._ldgPayrollData.find(function (p) { return p.staffId === staffId; }) : null;
    if (!empData) {
      if (!silent) showToast('پہلے پے رول بنائیں', 'warning');
      return false;
    }
    if (window.ldgPayrollMonthAlreadyPaid(staffId, empData.month)) {
      if (!silent) showToast('اس ماہ کی تنخواہ پہلے ہی ادا کی جا چکی ہے!', 'error');
      return false;
    }
    var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
    var paidSalaries = window.ldgGetPayrollHistory();
    var entryId = generateID('LDG-SAL');
    var payAmount = Math.max(0, Number(empData.netSalary) || 0);
    var needsApproval = typeof window.emsPayrollRequiresMakerChecker === 'function'
      ? window.emsPayrollRequiresMakerChecker()
      : true;
    var details = 'تنخواہ: ' + empData.name + ' — ' + empData.month + ' (بنیادی: ' + empData.baseSalary + ', الاؤنس: ' + empData.allowances + ', بونس: ' + empData.bonus + ', کٹوتی: ' + (empData.fixedDeductions + empData.absentDeduction + (empData.dueDeduction || 0)) + ')';
    if (empData.shortfall) details += ' [کمی: Rs ' + empData.shortfall + ']';
    var entry = {
      id: entryId,
      type: 'Expense',
      fund: 'General',
      category: 'طعام و تنخواہ',
      amount: payAmount,
      date: new Date().toISOString().split('T')[0],
      details: details,
      responsiblePerson: window.ldgActorName(),
      department: 'تنخواہ',
      createdBy: window.ldgActorName(),
      timestamp: Date.now(),
      approvalStatus: needsApproval ? 'pending' : 'approved',
      approvalLevelRequired: needsApproval ? Math.max(1, window.ldgApprovalLevel(payAmount)) : 0,
      approvalLevel: needsApproval ? Math.max(1, window.ldgApprovalLevel(payAmount)) : 0,
      approvalStage: 0,
      payrollHistId: null,
      payrollDuesApplied: false
    };
    if (!needsApproval) {
      entry.approvedBy = window.ldgActorName();
      entry.approvedAt = Date.now();
    }
    var histRec = {
      id: generateID('PAY'),
      staffId: staffId,
      staffName: empData.name,
      month: empData.month,
      baseSalary: empData.baseSalary,
      allowances: empData.allowances,
      allowancesDetail: empData.allowancesDetail || {},
      bonus: empData.bonus,
      fixedDeductions: empData.fixedDeductions,
      deductionsDetail: empData.deductionsDetail || {},
      absentDeduction: empData.absentDeduction,
      absents: empData.absents,
      dueDeduction: empData.dueDeduction || 0,
      dueBreakdown: empData.dueBreakdown || [],
      deductions: empData.fixedDeductions + empData.absentDeduction + (empData.dueDeduction || 0),
      gross: empData.gross,
      netSalary: empData.netSalary,
      netBeforeDues: empData.netBeforeDues,
      shortfall: empData.shortfall || 0,
      daysInMonth: empData.daysInMonth,
      dailyRateBase: empData.dailyRateBase,
      paidDate: entry.date,
      paidBy: window.ldgActorName(),
      ledgerEntryId: entryId,
      details: details,
      paymentType: 'monthly',
      approvalStatus: needsApproval ? 'pending' : 'approved',
      duesApplied: !needsApproval,
      timestamp: Date.now()
    };
    entry.payrollHistId = histRec.id;
    ledgerDB.push(entry);
    paidSalaries.push(histRec);
    emsSaveKey(DB.ledger, JSON.stringify(ledgerDB));
    window.ldgSavePayrollHistory(paidSalaries);
    if (!needsApproval) {
      window.ldgApplyPayrollDueDeductions(empData.dueBreakdown, histRec.id);
      entry.payrollDuesApplied = true;
      histRec.duesApplied = true;
      window.ldgSavePayrollHistory(paidSalaries);
    }
    window.ldgAuditLog('create', 'payroll', histRec.id, null, histRec, needsApproval ? 'تنخواہ زیرِ منظوری' : 'تنخواہ ادا');
    window.ldgAuditLog('create', 'ledger', entryId, null, entry, needsApproval ? 'تنخواہ اخراج (زیرِ التواء)' : 'تنخواہ اخراج');
    empData.isPaid = true;
    var tdAction = document.querySelector('#sal-row-' + staffId + ' td:last-child');
    if (tdAction) {
      if (needsApproval) {
        tdAction.innerHTML = '<span style="background:#d97706;color:white;padding:4px 10px;border-radius:4px;font-weight:bold;"><i class="fas fa-hourglass-half"></i> زیرِ منظوری</span> <button class="btn btn-sm btn-outline" onclick="window.ldgPrintPayslip(\'' + histRec.id + '\',\'print\')"><i class="fas fa-print"></i></button>';
      } else {
        tdAction.innerHTML = '<span style="background:var(--success);color:white;padding:4px 10px;border-radius:4px;font-weight:bold;"><i class="fas fa-check-double"></i> ادا شدہ</span> <button class="btn btn-sm btn-outline" onclick="window.ldgPrintPayslip(\'' + histRec.id + '\',\'print\')"><i class="fas fa-print"></i></button>';
      }
    }
    calculateLedgerBalances();
    window.ldgRenderPayrollHistory();
    window.ldgRenderEmployeeDues();
    window.ldgRenderPayrollAnnualSummary();
    window.ldgRenderApprovals();
    if (typeof updateMasterDashboard === 'function') updateMasterDashboard();
    if (!silent) {
      showToast(needsApproval ? 'تنخواہ منظوری کے لیے بھیج دی گئی — روزنامچہ منظوری میں دیکھیں' : 'تنخواہ ادا اور ریکارڈ محفوظ', needsApproval ? 'warning' : 'success');
    }
    return true;
  };

  window.payAllPayroll = function () {
    if (!window.ldgRequireEdit()) return;
    if (!window._ldgPayrollData || !window._ldgPayrollData.length) return showToast('پہلے پے رول بنائیں', 'warning');
    var unpaid = window._ldgPayrollData.filter(function (p) { return !p.isPaid; });
    if (!unpaid.length) return showToast('سب کی تنخواہ ادا ہے', 'info');
    if (!confirm(unpaid.length + ' ملازمین کی تنخواہ ایک ساتھ ادا کریں؟')) return;
    var ok = 0;
    unpaid.forEach(function (p) {
      if (window.paySalaryInstant(p.staffId, true)) ok++;
    });
    calculateLedgerBalances();
    window.ldgRenderPayrollHistory();
    showToast(ok + ' ملازمین کی تنخواہ ادا ہو گئی', 'success');
  };

  // =========================================================
  // آڈIT لاگ UI (before/after تفصیل)
  // =========================================================
  window.ldgFormatAuditDiff = function (before, after) {
    if (!before && after) return '<p style="color:#16a34a;margin:0;">نیا ریکارڈ بنایا گیا</p>';
    if (before && !after) return '<p style="color:#dc2626;margin:0;">ریکارڈ حذف ہو گیا</p>';
    if (!before || !after) return '<p style="color:#94a3b8;margin:0;">—</p>';
    var labels = { date: 'تاریخ', type: 'قسم', fund: 'فنڈ', category: 'مد', amount: 'رقم', details: 'تفصیل', responsiblePerson: 'ذمہ دار', department: 'شعبہ', approvalStatus: 'حالت', netSalary: 'خالص تنخواہ', remaining: 'باقی', status: 'حالت' };
    var keys = Object.keys(labels);
    var rows = [];
    keys.forEach(function (k) {
      var b = before[k], a = after[k];
      if (String(b != null ? b : '') !== String(a != null ? a : '')) {
        rows.push('<tr><td>' + labels[k] + '</td><td style="color:#dc2626;">' + (b != null ? b : '—') + '</td><td style="color:#16a34a;">' + (a != null ? a : '—') + '</td></tr>');
      }
    });
    if (!rows.length) return '<p style="color:#64748b;margin:0;">کوئی واضح فیلڈ تبدیلی نہیں (یا صرف metadata)</p>';
    return '<table class="data-table" style="font-size:12px;"><thead><tr><th>فیلڈ</th><th>پہلے</th><th>بعد</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  };

  window.ldgViewAuditDetail = function (logId) {
    var logs = JSON.parse(localStorage.getItem('ems_ledger_audit_log') || '[]');
    var log = logs.find(function (l) { return l.id === logId; });
    if (!log) return;
    var html = '<div style="line-height:1.7;font-size:13px;">' +
      '<p><b>وقت:</b> ' + new Date(log.timestamp).toLocaleString('ur-PK') + '</p>' +
      '<p><b>صارف:</b> ' + log.userName + ' &nbsp; <b>عمل:</b> ' + log.action + ' &nbsp; <b>شعبہ:</b> ' + log.entity + '</p>' +
      '<p><b>خلاصہ:</b> ' + (log.summary || '—') + '</p>' +
      '<h4 style="margin:12px 0 6px;">تبدیلی (before → after)</h4>' +
      window.ldgFormatAuditDiff(log.before, log.after) + '</div>';
    var box = document.getElementById('ldg-audit-detail-body');
    if (box) box.innerHTML = html;
    var m = document.getElementById('ldg-audit-detail-modal');
    if (m) m.style.display = 'flex';
  };

  window.ldgExportAuditCSV = function () {
    var logs = JSON.parse(localStorage.getItem('ems_ledger_audit_log') || '[]').slice().reverse();
    var entityF = document.getElementById('ldg-audit-filter-entity') ? document.getElementById('ldg-audit-filter-entity').value : '';
    if (entityF) logs = logs.filter(function (l) { return l.entity === entityF; });
    var rows = [['وقت', 'صارف', 'عمل', 'شعبہ', 'خلاصہ', 'entityId']];
    logs.forEach(function (l) {
      rows.push([new Date(l.timestamp).toLocaleString('ur-PK'), l.userName, l.action, l.entity, l.summary || '', l.entityId || '']);
    });
    window.ldgDownloadCSV(rows, 'آڈٹ_لاگ_' + new Date().toISOString().slice(0, 10) + '.csv');
  };

  window._ldgAuditPage = 1;
  window._ldgAuditPageSize = 100;

  window.ldgRenderAuditLog = function (page) {
    if (page) window._ldgAuditPage = page;
    var tbody = document.getElementById('ldg-audit-tbody');
    if (!tbody) return;
    var q = (document.getElementById('ldg-audit-search') ? document.getElementById('ldg-audit-search').value : '').toLowerCase().trim();
    var entityF = document.getElementById('ldg-audit-filter-entity') ? document.getElementById('ldg-audit-filter-entity').value : '';
    var actionF = document.getElementById('ldg-audit-filter-action') ? document.getElementById('ldg-audit-filter-action').value : '';
    var allLogs = JSON.parse(localStorage.getItem('ems_ledger_audit_log') || '[]').slice().reverse();
    if (q) allLogs = allLogs.filter(function (l) { return (l.summary + ' ' + l.entity + ' ' + l.userName + ' ' + l.action + ' ' + (l.entityId || '')).toLowerCase().indexOf(q) >= 0; });
    if (entityF) allLogs = allLogs.filter(function (l) { return l.entity === entityF; });
    if (actionF) allLogs = allLogs.filter(function (l) { return l.action === actionF; });
    var total = allLogs.length;
    var ps = window._ldgAuditPageSize || 100;
    var pages = Math.max(1, Math.ceil(total / ps));
    if (window._ldgAuditPage > pages) window._ldgAuditPage = pages;
    var logs = allLogs.slice((window._ldgAuditPage - 1) * ps, window._ldgAuditPage * ps);
    var pgEl = document.getElementById('ldg-audit-pagination');
    if (pgEl) {
      pgEl.innerHTML = total ? '<span class="reg-pg-info">' + total + ' لاگ — صفحہ ' + window._ldgAuditPage + ' / ' + pages + '</span> ' +
        (window._ldgAuditPage > 1 ? '<button class="btn btn-sm btn-outline" onclick="window.ldgRenderAuditLog(' + (window._ldgAuditPage - 1) + ')">پچھلا</button> ' : '') +
        (window._ldgAuditPage < pages ? '<button class="btn btn-sm btn-outline" onclick="window.ldgRenderAuditLog(' + (window._ldgAuditPage + 1) + ')">اگلا</button>' : '') : '';
    }
    if (!logs.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">کوئی لاگ نہیں</td></tr>'; return; }
    tbody.innerHTML = logs.map(function (l) {
      var hasDiff = l.before || l.after;
      return '<tr><td>' + new Date(l.timestamp).toLocaleString('ur-PK') + '</td><td>' + l.userName + '</td><td>' + l.action + '</td><td>' + l.entity + '</td><td>' + (l.summary || '—') + '</td><td>' +
        (hasDiff ? '<button class="btn btn-sm btn-outline" onclick="window.ldgViewAuditDetail(\'' + l.id + '\')"><i class="fas fa-search-plus"></i></button>' : '—') + '</td></tr>';
    }).join('');
  };

  // =========================================================
  // سالانہ مالی جائزہ + فنڈ کارکردگی
  // =========================================================
  window.ldgGetApprovedEntriesInRange = function (fromD, toD) {
    var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
    return ledgerDB.filter(function (x) {
      if (!window.ldgIsApproved(x)) return false;
      if (fromD && (x.date || '') < fromD) return false;
      if (toD && (x.date || '') > toD) return false;
      return true;
    });
  };

  window.ldgRenderAnnualReview = function () {
    var yearEl = document.getElementById('ldg-annual-review-year');
    var year = yearEl ? (yearEl.value || new Date().getFullYear()) : new Date().getFullYear();
    if (yearEl && !yearEl.value) yearEl.value = String(new Date().getFullYear());
    var fromD = year + '-01-01';
    var toD = year + '-12-31';
    var prevFrom = (Number(year) - 1) + '-01-01';
    var prevTo = (Number(year) - 1) + '-12-31';
    var entries = window.ldgGetApprovedEntriesInRange(fromD, toD);
    var prevEntries = window.ldgGetApprovedEntriesInRange(prevFrom, prevTo);
    var inc = 0, exp = 0, prevInc = 0, prevExp = 0;
    entries.forEach(function (x) { if (x.type === 'Income') inc += Number(x.amount || 0); else exp += Number(x.amount || 0); });
    prevEntries.forEach(function (x) { if (x.type === 'Income') prevInc += Number(x.amount || 0); else prevExp += Number(x.amount || 0); });
    var payroll = JSON.parse(localStorage.getItem('ems_payroll_history') || '[]').filter(function (p) { return (p.month || '').startsWith(String(year)); }).reduce(function (s, p) { return s + Number(p.netSalary || 0); }, 0);
    var special = window.ldgGetSpecialPayments().filter(function (p) { return (p.date || '').startsWith(String(year)); }).reduce(function (s, p) { return s + Number(p.amount || 0); }, 0);
    var liabs = window.ldgGetLiabilities().filter(function (l) { return l.status !== 'paid'; }).reduce(function (s, l) { return s + Number(l.amount || 0); }, 0);
    var cards = document.getElementById('ldg-annual-review-cards');
    if (cards) {
      var net = inc - exp;
      var prevNet = prevInc - prevExp;
      var chg = prevNet ? Math.round(((net - prevNet) / Math.abs(prevNet)) * 100) : 0;
      cards.innerHTML = '<div class="stat-card" style="background:#ecfdf5;"><div class="stat-label">آمدن ' + year + '</div><div class="stat-value">Rs ' + inc.toLocaleString() + '</div><small>پچھلے سال: Rs ' + prevInc.toLocaleString() + '</small></div>' +
        '<div class="stat-card" style="background:#fef2f2;"><div class="stat-label">اخراجات ' + year + '</div><div class="stat-value">Rs ' + exp.toLocaleString() + '</div><small>پچھلے سال: Rs ' + prevExp.toLocaleString() + '</small></div>' +
        '<div class="stat-card" style="background:#eff6ff;"><div class="stat-label">خالص ' + year + '</div><div class="stat-value">Rs ' + net.toLocaleString() + '</div><small>تبدیلی: ' + (chg >= 0 ? '+' : '') + chg + '%</small></div>' +
        '<div class="stat-card" style="background:#f5f3ff;"><div class="stat-label">تنخواہ + خصوصی</div><div class="stat-value">Rs ' + (payroll + special).toLocaleString() + '</div></div>' +
        '<div class="stat-card" style="background:#fff7ed;"><div class="stat-label">کھلے واجبات</div><div class="stat-value">Rs ' + liabs.toLocaleString() + '</div></div>';
    }
    var fundBody = document.getElementById('ldg-annual-fund-tbody');
    if (fundBody) {
      var byFund = {};
      window.ldgGetFunds().forEach(function (f) { byFund[f.id] = { name: f.name, inc: 0, exp: 0 }; });
      entries.forEach(function (x) {
        if (!byFund[x.fund]) byFund[x.fund] = { name: window.ldgFundName(x.fund), inc: 0, exp: 0 };
        if (x.type === 'Income') byFund[x.fund].inc += Number(x.amount || 0); else byFund[x.fund].exp += Number(x.amount || 0);
      });
      var balances = window.ldgComputeFundBalances();
      window._ldgAnnualReviewRows = [['فنڈ', 'آمدن', 'خرچ', 'خالص', 'موجودہ بیلنس']];
      fundBody.innerHTML = Object.keys(byFund).map(function (fid) {
        var f = byFund[fid];
        var n = f.inc - f.exp;
        window._ldgAnnualReviewRows.push([f.name, f.inc, f.exp, n, balances[fid] || 0]);
        return '<tr><td><strong>' + f.name + '</strong></td><td style="color:#16a34a;">Rs ' + f.inc.toLocaleString() + '</td><td style="color:#dc2626;">Rs ' + f.exp.toLocaleString() + '</td><td style="font-weight:bold;">Rs ' + n.toLocaleString() + '</td><td>Rs ' + (balances[fid] || 0).toLocaleString() + '</td></tr>';
      }).join('');
    }
    var catBody = document.getElementById('ldg-annual-cat-tbody');
    if (catBody) {
      var byCat = {};
      entries.filter(function (x) { return x.type === 'Expense'; }).forEach(function (x) {
        byCat[x.category || 'دیگر'] = (byCat[x.category || 'دیگر'] || 0) + Number(x.amount || 0);
      });
      var top = Object.keys(byCat).map(function (c) { return { cat: c, amt: byCat[c] }; }).sort(function (a, b) { return b.amt - a.amt; }).slice(0, 10);
      catBody.innerHTML = top.length ? top.map(function (t) {
        return '<tr><td>' + t.cat + '</td><td>Rs ' + t.amt.toLocaleString() + '</td></tr>';
      }).join('') : '<tr><td colspan="2" style="text-align:center;color:#94a3b8;">—</td></tr>';
    }
    var brand = document.getElementById('ldg-annual-review-brand');
    if (brand && typeof window.attBrandHeaderHTML === 'function') brand.innerHTML = window.attBrandHeaderHTML();
  };

  window.ldgExportAnnualReviewExcel = function () {
    if (!window._ldgAnnualReviewRows) return showToast('پہلے جائزہ دیکھیں', 'warning');
    var year = document.getElementById('ldg-annual-review-year') ? document.getElementById('ldg-annual-review-year').value : new Date().getFullYear();
    window.ldgExportExcel(window._ldgAnnualReviewRows, 'سالانہ_جائزہ_' + year + '.xlsx', 'جائزہ');
  };

  window.ldgRenderFundPerformance = function () {
    var fromEl = document.getElementById('ldg-fund-perf-from');
    var toEl = document.getElementById('ldg-fund-perf-to');
    if (fromEl && !fromEl.value) { window.ldgApplyReportPeriod('year'); fromEl.value = document.getElementById('rep-ldg-from') ? document.getElementById('rep-ldg-from').value : (new Date().getFullYear() + '-01-01'); }
    if (toEl && !toEl.value) toEl.value = new Date().toISOString().slice(0, 10);
    var fromD = fromEl ? fromEl.value : '';
    var toD = toEl ? toEl.value : '';
    var entries = window.ldgGetApprovedEntriesInRange(fromD, toD);
    var funds = window.ldgGetFunds();
    var balances = window.ldgComputeFundBalances();
    var tbody = document.getElementById('ldg-fund-perf-tbody');
    var chartEl = document.getElementById('ldg-fund-perf-chart');
    if (!tbody) return;
    window._ldgFundPerfRows = [['فنڈ', 'آمدن', 'خرچ', 'خالص', 'موجودہ بیلنس', 'لین دین']];
    var chartItems = [];
    tbody.innerHTML = funds.map(function (f) {
      var inc = 0, exp = 0, count = 0;
      entries.filter(function (x) { return x.fund === f.id; }).forEach(function (x) {
        count++;
        if (x.type === 'Income') inc += Number(x.amount || 0); else exp += Number(x.amount || 0);
      });
      var net = inc - exp;
      chartItems.push({ label: f.name.slice(0, 12), value: Math.max(0, net), display: 'Rs ' + net.toLocaleString() });
      window._ldgFundPerfRows.push([f.name, inc, exp, net, balances[f.id] || 0, count]);
      return '<tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + (f.color || '#64748b') + ';margin-left:6px;"></span><strong>' + f.name + '</strong></td><td style="color:#16a34a;">Rs ' + inc.toLocaleString() + '</td><td style="color:#dc2626;">Rs ' + exp.toLocaleString() + '</td><td style="font-weight:bold;color:' + (net >= 0 ? '#2563eb' : '#dc2626') + ';">Rs ' + net.toLocaleString() + '</td><td>Rs ' + (balances[f.id] || 0).toLocaleString() + '</td><td>' + count + '</td></tr>';
    }).join('');
    if (chartEl && typeof window.emsBarChartSVG === 'function') {
      chartEl.innerHTML = window.emsBarChartSVG(chartItems);
    }
    var title = document.getElementById('ldg-fund-perf-title');
    if (title) title.innerText = 'مدت: ' + (fromD || 'ابتدا') + ' تا ' + (toD || 'آج');
  };

  window.ldgExportFundPerfExcel = function () {
    if (!window._ldgFundPerfRows) { window.ldgRenderFundPerformance(); }
    if (!window._ldgFundPerfRows) return;
    window.ldgExportExcel(window._ldgFundPerfRows, 'فنڈ_کارکردگی_' + new Date().toISOString().slice(0, 10) + '.xlsx', 'فنڈز');
  };

  window.ldgApplyReportPeriod = function (preset) {
    var fromEl = document.getElementById('rep-ldg-from');
    var toEl = document.getElementById('rep-ldg-to');
    if (!fromEl || !toEl) return;
    var now = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var iso = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    toEl.value = iso(now);
    if (preset === 'today') fromEl.value = iso(now);
    else if (preset === 'week') { var w = new Date(now); w.setDate(w.getDate() - 6); fromEl.value = iso(w); }
    else if (preset === 'month') fromEl.value = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-01';
    else if (preset === 'year') fromEl.value = now.getFullYear() + '-01-01';
  };

  window.ldgExportReportCSV = function () {
    if (!window._ldgLastReportRows) return showToast('پہلے رپورٹ لائیں', 'warning');
    window.ldgDownloadCSV(window._ldgLastReportRows, 'مالیاتی_رپورٹ.csv');
  };

  // =========================================================
  // refresh + event wiring
  // =========================================================
  window.refreshLedgerData = function (activeTabId) {
    if (typeof window.emsIsLedgerModuleActive === 'function' && !window.emsIsLedgerModuleActive()) return;
    activeTabId = activeTabId || window._ldgActiveTab || 'ledger-win-dashboard';
    window.ldgPopulateFundSelects();
    if (activeTabId === 'ledger-win-entry' || activeTabId === 'ledger-win-report') {
      updateLedgerCategoriesDropdown();
    }
    if (activeTabId === 'ledger-win-settings') {
      updateLedgerCategoriesDropdown();
      renderMasterCategoriesTable();
      renderBlackoutsTable();
    }
    if (activeTabId === 'ledger-win-entry' || activeTabId === 'ledger-win-dashboard') {
      calculateLedgerBalances();
      window.ldgRenderFundsTable();
    }
    if (activeTabId === 'ledger-win-entry') {
      var ef = document.getElementById('ldg-entry-filter-fund');
      if (ef && ef.options.length <= 1) {
        ef.innerHTML = '<option value="">تمام فنڈز</option>' + window.ldgGetFunds().map(function (f) { return '<option value="' + f.id + '">' + f.name + '</option>'; }).join('');
      }
      var ec = document.getElementById('ldg-entry-filter-cat');
      if (ec) {
        var cats = getMasterCategories();
        ec.innerHTML = '<option value="">تمام مدات</option>' + cats.map(function (c) { return '<option value="' + c.name + '">' + c.name + '</option>'; }).join('');
      }
    }
    if (activeTabId === 'ledger-win-salary' || activeTabId === 'ledger-win-settings') {
      window.ldgEnsureStaffDropdowns(false);
    }
    if (activeTabId === 'ledger-win-settings') {
      var s = window.ldgGetSettings();
      var chk = document.getElementById('ldg-set-require-approval');
      var th = document.getElementById('ldg-set-threshold');
      var th2 = document.getElementById('ldg-set-threshold2');
      if (chk) chk.checked = !!s.requireApproval;
      if (th) th.value = s.approvalThreshold || 25000;
      if (th2) th2.value = s.level2Threshold || 100000;
      var sto = document.getElementById('ldg-set-storage-only');
      var fsp = document.getElementById('ldg-set-fs-pagination');
      var har = document.getElementById('ldg-set-hide-archived');
      if (sto) sto.checked = !!s.storageOnlyAttachments;
      if (fsp) fsp.checked = s.useFirestorePagination !== false;
      if (har) har.checked = s.hideArchived !== false;
    }
  };

  document.getElementById('ldg-entry-type')?.addEventListener('change', updateLedgerCategoriesDropdown);
  if (document.getElementById('ldg-entry-date')) document.getElementById('ldg-entry-date').valueAsDate = new Date();
  if (document.getElementById('sal-month-select')) document.getElementById('sal-month-select').value = new Date().toISOString().substring(0, 7);
  if (document.getElementById('ldg-spec-date')) document.getElementById('ldg-spec-date').valueAsDate = new Date();
  if (document.getElementById('ldg-payroll-year')) document.getElementById('ldg-payroll-year').value = String(new Date().getFullYear());

  document.getElementById('ldg-entry-file')?.addEventListener('change', function (e) {
    currentUploadedLedgerFiles = [];
    Array.from(e.target.files || []).forEach(function (file) {
      var reader = new FileReader();
      reader.onload = function (ev) {
        currentUploadedLedgerFiles.push({ name: file.name, type: file.type, dataBase64: ev.target.result });
      };
      reader.readAsDataURL(file);
    });
  });

  document.getElementById('btn-add-master-cat')?.addEventListener('click', function () {
    if (!window.ldgRequireEdit()) return;
    var type = document.getElementById('master-cat-type').value;
    var name = document.getElementById('master-cat-name').value.trim();
    if (!name) return showToast('مد کا نام لکھیں!', 'error');
    var cats = getMasterCategories();
    if (cats.find(function (c) { return c.name === name && c.type === type; })) return showToast('پہلے سے موجود', 'warning');
    var item = { id: generateID('CAT'), name: name, type: type };
    cats.push(item);
    emsSaveKey('ems_ledger_master_categories', JSON.stringify(cats));
    window.ldgAuditLog('create', 'category', item.id, null, item, 'نئی مد');
    document.getElementById('master-cat-name').value = '';
    window.refreshLedgerData();
    showToast('مد شامل', 'success');
  });

  document.getElementById('btn-add-blackout')?.addEventListener('click', function () {
    if (!window.ldgRequireEdit()) return;
    var start = document.getElementById('blk-start-date').value;
    var end = document.getElementById('blk-end-date').value;
    if (!start || !end) return showToast('تاریخیں درج کریں', 'error');
    var blackouts = JSON.parse(localStorage.getItem('ems_ledger_blackouts')) || [];
    var item = { id: generateID('BLK'), start: start, end: end };
    blackouts.push(item);
    emsSaveKey('ems_ledger_blackouts', JSON.stringify(blackouts));
    window.ldgAuditLog('create', 'blackout', item.id, null, item, 'بلیک آؤٹ');
    document.getElementById('blk-start-date').value = '';
    document.getElementById('blk-end-date').value = '';
    window.refreshLedgerData();
    showToast('محفوظ', 'success');
  });

  document.getElementById('btn-save-ledger-entry')?.addEventListener('click', function () {
    if (!window.ldgRequireEdit()) return;
    var type = document.getElementById('ldg-entry-type').value;
    var fund = document.getElementById('ldg-entry-fund').value;
    var cat = document.getElementById('ldg-entry-cat').value;
    var amount = Number(document.getElementById('ldg-entry-amount').value);
    var date = document.getElementById('ldg-entry-date').value;
    var details = document.getElementById('ldg-entry-details').value.trim();
    var responsible = document.getElementById('ldg-entry-responsible') ? document.getElementById('ldg-entry-responsible').value.trim() : window.ldgActorName();
    var department = document.getElementById('ldg-entry-dept') ? document.getElementById('ldg-entry-dept').value.trim() : '';
    if (!amount || amount <= 0 || !date) return showToast('رقم اور تاریخ درست درج کریں!', 'error');
    if (typeof window.finIsManualFeeLedgerEntry === 'function' && window.finIsManualFeeLedgerEntry({ type: type, category: cat, details: details })) {
      return showToast(window.finManualFeeLedgerBlockToast || 'فیس کی وصولی خودکار طور پر فنڈ میں شامل ہو جاتی ہے۔ براہ کرم اسے روزنامچہ میں دستی طور پر درج نہ کریں۔', 'warning');
    }
    var entryId = generateID('LDG');
    var needsApproval = window.ldgNeedsApproval(type, amount);
    var btn = document.getElementById('btn-save-ledger-entry');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> محفوظ...'; }
    window.ldgUploadAttachments(currentUploadedLedgerFiles.slice(), entryId).then(function (attachments) {
      var ledgerDB = JSON.parse(localStorage.getItem(DB.ledger)) || [];
      var entry = {
        id: entryId,
        type: type,
        fund: fund,
        category: cat,
        amount: amount,
        date: date,
        details: details,
        responsiblePerson: responsible || window.ldgActorName(),
        department: department,
        createdBy: window.ldgActorName(),
        attachments: attachments,
        photoBase64: attachments[0] && attachments[0].dataBase64 && attachments[0].storage !== 'firebase' ? attachments[0].dataBase64 : '',
        timestamp: Date.now(),
        approvalStatus: needsApproval ? 'pending' : 'approved',
        approvalLevelRequired: needsApproval ? window.ldgApprovalLevel(amount) : 0,
        approvalLevel: needsApproval ? window.ldgApprovalLevel(amount) : 0,
        approvalStage: 0
      };
      if (!needsApproval) { entry.approvedBy = window.ldgActorName(); entry.approvedAt = Date.now(); }
      if (typeof window.emsStampDepartment === 'function') window.emsStampDepartment(entry);
      ledgerDB.push(entry);
      return emsSaveKey(DB.ledger, JSON.stringify(ledgerDB)).then(function () { return entry; });
    }).then(function (entry) {
      window.ldgAuditLog('create', 'ledger', entry.id, null, entry, type + ' Rs ' + amount + (entry.approvalStatus === 'pending' ? ' (زیرِ منظوری)' : ''));
      showToast(entry.approvalStatus === 'pending' ? 'منظوری کے لیے بھیج دیا گیا' : 'روزنامچہ میں محفوظ', 'success');
      document.getElementById('ldg-entry-amount').value = '';
      document.getElementById('ldg-entry-details').value = '';
      document.getElementById('ldg-entry-file').value = '';
      currentUploadedLedgerFiles = [];
      calculateLedgerBalances();
      window.ldgRenderEntryList();
      if (typeof updateMasterDashboard === 'function') updateMasterDashboard();
    }).catch(function (err) {
      showToast((err && err.message) || 'محفوظ نہیں ہو سکا', 'error');
    }).finally(function () {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> محفوظ کریں'; }
    });
  });

  document.getElementById('btn-generate-payroll')?.addEventListener('click', function () {
    var monthVal = document.getElementById('sal-month-select').value;
    if (!monthVal) return showToast('مہینہ منتخب کریں!', 'error');
    var users = ldgGetUsers();
    var staffType = document.querySelector('input[name="sal_staff_type"]:checked').value;
    var staffList = ldgGetPayrollStaff(users, staffType);
    var tbody = document.querySelector('#sal-payroll-table tbody');
    if (!staffList.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:red;">کوئی ملازم نہیں</td></tr>'; return; }
    var btn = document.getElementById('btn-generate-payroll');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> لوڈ...'; }
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#64748b;">حاضری ڈیٹا لوڈ ہو رہا ہے...</td></tr>';
    var blackouts = JSON.parse(localStorage.getItem('ems_ledger_blackouts') || '[]');
    var paidSalaries = JSON.parse(localStorage.getItem('ems_payroll_history') || '[]');
    var fetchAtt = (typeof window.emsFetchAttendanceForPayroll === 'function')
      ? window.emsFetchAttendanceForPayroll(monthVal)
      : Promise.resolve([]);
    fetchAtt.then(function (attendanceDB) {
      window._ldgPayrollData = [];
      tbody.innerHTML = '';
      staffList.forEach(function (emp) {
        var row = ldgComputePayrollRow(emp, monthVal, attendanceDB, blackouts, paidSalaries);
        window._ldgPayrollData.push(row);
        var dueBal = window.ldgGetStaffDueBalance(emp.id);
        var dueNote = dueBal > 0 ? ' <small style="color:#d97706;">(واجبہ: Rs ' + dueBal.toLocaleString() + ')</small>' : '';
        var existingPay = window.ldgGetPayrollHistory().find(function (p) {
          return p.staffId === emp.id && p.month === monthVal && (p.paymentType || 'monthly') === 'monthly' && window.ldgPayrollRecordActive(p);
        });
        var btnHtml;
        if (existingPay) {
          if ((existingPay.approvalStatus || '') === 'pending') {
            btnHtml = '<span style="background:#d97706;color:white;padding:4px 10px;border-radius:4px;font-weight:bold;"><i class="fas fa-hourglass-half"></i> زیرِ منظوری</span> <button class="btn btn-sm btn-outline" onclick="window.ldgPrintPayslip(\'' + existingPay.id + '\',\'print\')"><i class="fas fa-print"></i></button>';
          } else {
            btnHtml = '<span style="background:var(--success);color:white;padding:4px 10px;border-radius:4px;font-weight:bold;"><i class="fas fa-check-double"></i> ادا شدہ</span> <button class="btn btn-sm btn-outline" onclick="window.ldgPrintPayslip(\'' + existingPay.id + '\',\'print\')"><i class="fas fa-print"></i></button>';
          }
        } else {
          btnHtml = '<button class="btn btn-success" style="padding:6px 12px;" onclick="paySalaryInstant(\'' + emp.id + '\')"><i class="fas fa-check"></i> ادا کریں</button>';
        }
        var netCell = row.netSalary < 0
          ? '<span style="color:#dc2626;font-weight:bold;">− Rs ' + Math.abs(row.netSalary).toLocaleString() + '</span>'
          : '<span style="color:green;font-weight:bold;">Rs ' + row.netSalary.toLocaleString() + '</span>';
        tbody.innerHTML += '<tr id="sal-row-' + emp.id + '"><td><strong>' + emp.name + '</strong>' + dueNote + '<br><small>' + emp.id + '</small></td><td>Rs ' + row.baseSalary.toLocaleString() + '</td><td>Rs ' + row.allowances.toLocaleString() + '</td><td>' + row.absents + ' دن</td><td style="color:var(--danger);">Rs ' + (row.fixedDeductions + row.absentDeduction).toLocaleString() + '</td><td style="color:#d97706;">Rs ' + (row.dueDeduction || 0).toLocaleString() + '</td><td>' + netCell + '</td><td>' + btnHtml + '</td></tr>';
      });
      window.ldgRenderPayrollHistory();
      showToast('پے رول تیار (لائیو حاضری: ' + attendanceDB.length + ' ریکارڈ)', 'success');
    }).catch(function (err) {
      console.warn('emsFetchAttendanceForPayroll:', err);
      showToast('حاضری لوڈ نہیں ہو سکی — دوبارہ کوشش کریں', 'error');
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:red;">حاضری ڈیٹا لوڈ نہیں ہو سکا</td></tr>';
    }).finally(function () {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-calculator"></i> پے رول بنائیں'; }
    });
  });

  document.getElementById('btn-save-budget')?.addEventListener('click', function () {
    if (!window.ldgRequireEdit()) return;
    var fundId = document.getElementById('ldg-budget-fund').value;
    var cat = document.getElementById('ldg-budget-cat').value.trim();
    var amount = Number(document.getElementById('ldg-budget-amount').value);
    var period = document.getElementById('ldg-budget-period').value;
    var month = document.getElementById('ldg-budget-month') ? document.getElementById('ldg-budget-month').value : new Date().toISOString().slice(0, 7);
    if (!fundId || !cat || !amount) return showToast('تمام خانے بھریں', 'error');
    var parts = month.split('-');
    var budgets = JSON.parse(localStorage.getItem('ems_ledger_budgets') || '[]');
    var editIdx = window._ldgEditingBudgetIdx;
    if (editIdx != null && budgets[editIdx]) {
      var before = window.ldgAuditSnapshot(budgets[editIdx]);
      budgets[editIdx].fundId = fundId;
      budgets[editIdx].category = cat;
      budgets[editIdx].amount = amount;
      budgets[editIdx].period = period;
      budgets[editIdx].year = parts[0];
      budgets[editIdx].month = Number(parts[1]);
      budgets[editIdx].updatedAt = Date.now();
      budgets[editIdx].updatedBy = window.ldgActorName();
      emsSaveKey('ems_ledger_budgets', JSON.stringify(budgets));
      window.ldgAuditLog('update', 'budget', budgets[editIdx].id, before, window.ldgAuditSnapshot(budgets[editIdx]), 'بجٹ ترمیم');
      window.ldgCancelBudgetEdit();
      window.ldgRenderBudget();
      showToast('بجٹ اپڈیٹ', 'success');
      return;
    }
    var item = { id: generateID('BDG'), fundId: fundId, category: cat, amount: amount, period: period, year: parts[0], month: Number(parts[1]), createdAt: Date.now() };
    budgets.push(item);
    emsSaveKey('ems_ledger_budgets', JSON.stringify(budgets));
    window.ldgAuditLog('create', 'budget', item.id, null, item, 'بجٹ');
    window.ldgRenderBudget();
    showToast('بجٹ محفوظ', 'success');
  });

  document.getElementById('btn-fetch-ledger-report')?.addEventListener('click', function () {
    var fromDate = document.getElementById('rep-ldg-from').value;
    var toDate = document.getElementById('rep-ldg-to').value;
    var ledgerDB = window.ldgGetFilteredEntries('report');
    document.getElementById('rep-ldg-title-dates').innerText = 'تاریخ: ' + (fromDate || 'ابتدا') + ' تا ' + (toDate || 'آج');
    var brand = document.getElementById('ldg-report-brand-header');
    var brandF = document.getElementById('ldg-report-brand-footer');
    if (brand && typeof window.attBrandHeaderHTML === 'function') brand.innerHTML = window.attBrandHeaderHTML();
    if (brandF && typeof window.attSignFooterHTML === 'function') brandF.innerHTML = window.attSignFooterHTML();
    var tbody = document.getElementById('rep-ldg-tbody');
    tbody.innerHTML = '';
    if (!ledgerDB.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">کوئی ریکارڈ نہیں</td></tr>';
      document.getElementById('rep-ldg-total-income').innerText = 'Rs 0';
      document.getElementById('rep-ldg-total-expense').innerText = 'Rs 0';
      document.getElementById('rep-ldg-total-net').innerText = 'Rs 0';
      window._ldgLastReportRows = [['تاریخ', 'قسم', 'فنڈ', 'مد', 'تفصیل', 'ذمہ دار', 'رقم']];
      document.getElementById('ldg-printable-area').style.display = 'block';
      return;
    }
    var totalInc = 0, totalExp = 0;
    window._ldgLastReportRows = [['تاریخ', 'قسم', 'فنڈ', 'مد', 'تفصیل', 'ذمہ دار', 'رقم']];
    ledgerDB.sort(function (a, b) { return b.timestamp - a.timestamp; }).forEach(function (item) {
      var typeUrdu = item.type === 'Income' ? 'آمدن' : 'خرچ';
      var amt = item.amount || 0;
      if (item.type === 'Income') totalInc += amt; else totalExp += amt;
      tbody.innerHTML += '<tr><td>' + item.date + '</td><td>' + typeUrdu + '</td><td>' + window.ldgFundName(item.fund) + '</td><td>' + (item.category || '—') + '</td><td>' + (item.details || '—') + '</td><td>' + (item.responsiblePerson || '—') + '</td><td>Rs ' + amt.toLocaleString() + '</td></tr>';
      window._ldgLastReportRows.push([item.date, typeUrdu, window.ldgFundName(item.fund), item.category, item.details, item.responsiblePerson, amt]);
    });
    document.getElementById('rep-ldg-total-income').innerText = 'Rs ' + totalInc.toLocaleString();
    document.getElementById('rep-ldg-total-expense').innerText = 'Rs ' + totalExp.toLocaleString();
    document.getElementById('rep-ldg-total-net').innerText = 'Rs ' + (totalInc - totalExp).toLocaleString();
    document.getElementById('ldg-printable-area').style.display = 'block';
    showToast('رپورٹ تیار', 'success');
  });

  document.getElementById('ldg-rep-period')?.addEventListener('change', function () {
    if (this.value !== 'custom') window.ldgApplyReportPeriod(this.value);
  });

  if (typeof window.ldgApplyReportPeriod === 'function') window.ldgApplyReportPeriod('month');

  document.getElementById('tab-ledger')?.addEventListener('click', function () {
    ldgInitOptDeptFilter();
  });

  if (typeof window.emsRegisterDepartmentRefresh === 'function') {
    window.emsRegisterDepartmentRefresh('ledger', function () {
      if (typeof window.emsIsLedgerModuleActive === 'function' && !window.emsIsLedgerModuleActive()) return;
      window._ldgStaffDropdownGen = -1;
      ldgInitOptDeptFilter();
      if (typeof window.refreshLedgerData === 'function') window.refreshLedgerData(window._ldgActiveTab);
    });
  }

  ldgInitOptDeptFilter();
