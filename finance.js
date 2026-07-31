    // ================= 10. فیس سسٹم (Finance Module — Enterprise Grade) =================

  var FIN_DEFAULT_CATS = ['داخلہ فیس', 'ماہانہ فیس', 'سالانہ فیس', 'امتحانی فیس', 'کتابی فیس', 'رہائش فیس', 'طعام فیس', 'خصوصی چندہ', 'جرمانہ', 'رعایتی فیس', 'دیگر وصولیاں'];
  window._finColStudents = [];

  function emsSaveKey(key, val, opts) {
    var options = Object.assign({ mutation: true, autoDelta: true }, opts || {});
    var p = window.emsSaveModuleData
      ? window.emsSaveModuleData(key, val, options)
      : (localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val)), Promise.resolve());
    if (typeof window.emsLogAudit === 'function') {
      return Promise.resolve(p).then(function (res) {
        window.emsLogAudit('finance', 'save', key, { storageKey: key });
        return res;
      });
    }
    return p;
  }

  function finGetAllUsers() {
    if (typeof window.emsGetUsersSync === 'function') return window.emsGetUsersSync();
    if (typeof window.emsGetUsersMerged === 'function') return window.emsGetUsersMerged();
    return [];
  }

  function finGetStudents(users) {
    users = users || finGetAllUsers();
    var students = users.filter(function (u) { return u.type === 'student'; });
    if (typeof window.emsIsOptionalDeptFilterOn === 'function' && window.emsIsOptionalDeptFilterOn('finance')) {
      if (typeof window.emsFilterByDepartment === 'function') return window.emsFilterByDepartment(students);
    }
    return students;
  }

  function finGetFeeContext(force) {
    var gen = typeof window.emsReadRepoCacheGen === 'function' ? window.emsReadRepoCacheGen() : 0;
    if (!force && window._finFeeCtx && window._finFeeCtx.gen === gen) return window._finFeeCtx;
    var users = finGetAllUsers();
    window._finFeeCtx = {
      gen: gen,
      users: users,
      setups: JSON.parse(localStorage.getItem('ems_student_fee_setup') || '{}'),
      collections: finFilterCollections(
        typeof window.emsCacheGet === 'function'
          ? window.emsCacheGet('ems_fee_collections', [])
          : JSON.parse(localStorage.getItem('ems_fee_collections') || '[]'),
        users
      ),
      bills: window.finGetBills()
    };
    return window._finFeeCtx;
  }

  function finRefreshClassDropdowns(force) {
    if (typeof window.emsIsFinanceModuleActive === 'function' && !window.emsIsFinanceModuleActive()) return;
    var gen = typeof window.emsReadRepoCacheGen === 'function' ? window.emsReadRepoCacheGen() : 0;
    if (!force && window._finClassDropdownGen === gen) return;
    window._finClassDropdownGen = gen;
    var classes = typeof window.emsCollectClasses === 'function' ? window.emsCollectClasses() : [];
    document.querySelectorAll('.fin-dynamic-class').forEach(function (select) {
      var currentVal = select.value;
      var options = select.id === 'fin-rep-class' ? '<option value="all">تمام درجات</option>' : '<option value="">درجہ منتخب کریں...</option>';
      classes.forEach(function (c) { options += '<option value="' + c + '">' + c + '</option>'; });
      select.innerHTML = options;
      if (currentVal) select.value = currentVal;
    });
  }

  function finFilterCollections(collections, users) {
    if (typeof window.emsArchiveFilterFeeCollections === 'function') {
      collections = window.emsArchiveFilterFeeCollections(collections);
    }
    if (typeof window.emsFilterCollectionsByStudentDept === 'function') {
      return window.emsFilterCollectionsByStudentDept(collections, users || finGetAllUsers(), 'finance');
    }
    return collections;
  }

  function finInitOptDeptFilter() {
    if (typeof window.emsMountOptionalDeptFilter === 'function') {
      window.emsMountOptionalDeptFilter('fin-opt-dept-filter', 'finance', function () {
        if (typeof window.emsIsFinanceModuleActive === 'function' && !window.emsIsFinanceModuleActive()) return;
        window._finFeeCtx = null;
        if (typeof window.refreshFinanceData === 'function') window.refreshFinanceData(window._finActiveTab);
        if (window._finActiveTab === 'fee-win-dashboard' && typeof window.renderFinanceDashboard === 'function') window.renderFinanceDashboard();
        if (window._finActiveTab === 'fee-win-dues' && typeof window.finRenderDuesList === 'function') window.finRenderDuesList();
      });
    }
  }

  // =========================================================
  // نیویگیشن + ڈیفالٹ صفحہ
  // =========================================================
  window._finActiveTab = 'fee-win-dashboard';
  window._finDuesPage = 1;

  window.switchFinTab = function (tabId, btn) {
    if (typeof window.emsIsFinanceModuleActive === 'function' && !window.emsIsFinanceModuleActive()) return;
    if (typeof window.emsCloseAllModals === 'function') window.emsCloseAllModals();
    document.querySelectorAll('#module-finance .fee-tab-content').forEach(function (el) { el.style.display = 'none'; });
    var panel = document.getElementById(tabId);
    if (panel) panel.style.display = 'block';
    document.querySelectorAll('#fin-ribbon-menu .reg-tab').forEach(function (b) { b.classList.remove('active-sub-tab'); });
    if (btn) btn.classList.add('active-sub-tab');
    window._finActiveTab = tabId;
    if (typeof window.refreshFinanceData === 'function') window.refreshFinanceData(tabId);
    if (tabId === 'fee-win-dashboard' && typeof window.renderFinanceDashboard === 'function') {
      if (typeof window.emsDeferModuleWork === 'function') {
        window.emsDeferModuleWork(window.renderFinanceDashboard, { idle: true, timeout: 400 });
      } else {
        window.renderFinanceDashboard();
      }
    }
    if (tabId === 'fee-win-dues' && typeof window.finRenderDuesList === 'function') {
      if (typeof window.emsDeferModuleWork === 'function') {
        window.emsDeferModuleWork(window.finRenderDuesList, { idle: true, timeout: 400 });
      } else {
        window.finRenderDuesList();
      }
    }
    if (tabId === 'fee-win-bills') {
      var bm = document.getElementById('fin-bill-month');
      if (bm && !bm.value) bm.value = new Date().toISOString().slice(0, 7);
      if (typeof window.emsSlipLoadSettingsToUI === 'function') window.emsSlipLoadSettingsToUI();
      if (typeof window.finRenderBillsList === 'function') window.finRenderBillsList();
    }
  };

  window.emsOpenFinance = function () {
    if (typeof window.emsCloseAllModals === 'function') window.emsCloseAllModals();
    var btn = document.querySelector('#fin-ribbon-menu [onclick*="fee-win-dashboard"]');
    window.switchFinTab('fee-win-dashboard', btn);
  };

  if (!window._finSummaryHook) {
    window._finSummaryHook = true;
    window.emsOnFinanceSummaryUpdate = function () {
      if (typeof window.emsIsFinanceModuleActive === 'function' && !window.emsIsFinanceModuleActive()) return;
      var dash = document.getElementById('fee-win-dashboard');
      if (dash && dash.style.display !== 'none' && typeof window.renderFinanceDashboard === 'function') {
        window.renderFinanceDashboard();
      }
    };
  }

  // CSV برآمد (UTF-8 BOM)
  window.finDownloadCSV = function (rows, filename) {
    var csv = rows.map(function (r) {
      return r.map(function (cell) {
        var s = String(cell == null ? '' : cell);
        if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
        return s;
      }).join(',');
    }).join('\r\n');
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename || 'finance.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    if (typeof showToast === 'function') showToast('فائل برآمد: ' + (filename || 'finance.csv'), 'success');
  };

  // مرکزی مالی حساب (ہر طالب علم) — چالان + وصولی
  window.finGetBills = function () {
    return JSON.parse(localStorage.getItem('ems_fee_bills') || '[]');
  };

  /** Active (non-voided) fee collection */
  window.finIsCollectionActive = function (c) {
    return !!(c && !c.isVoid);
  };

  window.finCollectionEffectiveAmount = function (c) {
    return window.finIsCollectionActive(c) ? (Number(c.amount) || 0) : 0;
  };

  /** Income ledger rows that duplicate auto-posted fee collections (legacy or bypassed guard). */
  var FIN_MANUAL_FEE_LEDGER_RE = /فیس|fee|tuition|چالان/i;
  window.finIsManualFeeLedgerEntry = function (entry) {
    if (!entry || entry.type !== 'Income') return false;
    var text = ((entry.category || '') + ' ' + (entry.details || '')).trim();
    return FIN_MANUAL_FEE_LEDGER_RE.test(text);
  };
  window.finManualFeeLedgerBlockToast = 'فیس کی وصولی خودکار طور پر فنڈ میں شامل ہو جاتی ہے۔ براہ کرم اسے روزنامچہ میں دستی طور پر درج نہ کریں۔';

  /** Daily cash closure — reuses ledger blackout ranges (ems_ledger_blackouts) */
  window.finIsDateClosed = function (dateStr) {
    if (!dateStr) return false;
    var blackouts = JSON.parse(localStorage.getItem('ems_ledger_blackouts') || '[]');
    return blackouts.some(function (b) { return dateStr >= b.start && dateStr <= b.end; });
  };

  window.finRequireDateOpen = function (dateStr) {
    if (!window.finIsDateClosed(dateStr)) return true;
    if (typeof showToast === 'function') showToast('اس تاریخ کا روزنامچہ بند ہو چکا ہے', 'error');
    return false;
  };

  var FIN_RECURRING_CATS = ['ماہانہ فیس', 'رہائش فیس', 'طعام فیس', 'کتابی فیس'];

  /** Gross sum of all fee categories in a setup (before flat رعایت). */
  window.finSetupGross = function (setup) {
    setup = setup || {};
    var gross = 0;
    Object.keys(setup.fees || {}).forEach(function (k) { gross += Number(setup.fees[k] || 0); });
    if (!gross && setup.netPayable != null) {
      gross = Number(setup.netPayable) + (Number(setup.discount) || 0);
    }
    return gross;
  };

  window.finSetupDiscount = function (setup) {
    return Math.max(0, Number(setup && setup.discount) || 0);
  };

  /** Flat net payable — same formula as setup UI and challan discount base. */
  window.finSetupNetPayable = function (setup) {
    var gross = window.finSetupGross(setup);
    return Math.max(0, gross - window.finSetupDiscount(setup));
  };

  /**
   * Proportional share of flat discount for one category (setup + bill generation SSOT).
   * Rounds once per category so monthly + one-time bills align with netPayable.
   */
  window.finCategoryNetAmount = function (catAmount, setup) {
    catAmount = Number(catAmount) || 0;
    if (catAmount <= 0) return 0;
    var gross = window.finSetupGross(setup);
    var discount = window.finSetupDiscount(setup);
    if (!discount || gross <= 0) return catAmount;
    return Math.max(0, Math.round(catAmount - discount * (catAmount / gross)));
  };

  window.finGetMonthlyCharge = function (stdId, setup) {
    if (!setup) {
      var setups = JSON.parse(localStorage.getItem('ems_student_fee_setup')) || {};
      setup = setups[stdId];
      if (!setup) {
        var users = finGetAllUsers();
        var std = users.find(function (u) { return u.id === stdId; });
        if (std && std.class) {
          var cs = JSON.parse(localStorage.getItem('ems_class_fee_structure') || '{}');
          if (cs[std.class]) setup = cs[std.class];
        }
      }
    }
    setup = setup || { fees: {}, netPayable: 0, discount: 0 };
    var sum = 0;
    FIN_RECURRING_CATS.forEach(function (cat) {
      if (setup.fees && setup.fees[cat]) sum += Number(setup.fees[cat] || 0);
    });
    if (sum > 0) {
      return window.finCategoryNetAmount(sum, setup);
    }
    if (setup.netPayable != null) return Number(setup.netPayable) || 0;
    return window.finSetupNetPayable(setup);
  };

  window.finBuildPaidByStudentIndex = function (collections) {
    var map = Object.create(null);
    (collections || []).forEach(function (c) {
      if (!c || !c.studentId || !window.finIsCollectionActive(c)) return;
      map[c.studentId] = (map[c.studentId] || 0) + (Number(c.amount) || 0);
    });
    return map;
  };

  window.finBuildFeeIndexes = function (collections, bills) {
    var paidByStudent = Object.create(null);
    var lastPayByStudent = Object.create(null);
    var billsByStudent = Object.create(null);
    (collections || []).forEach(function (c) {
      if (!c || !c.studentId || !window.finIsCollectionActive(c)) return;
      paidByStudent[c.studentId] = (paidByStudent[c.studentId] || 0) + (Number(c.amount) || 0);
      if (!lastPayByStudent[c.studentId] || (Number(c.timestamp) || 0) > (Number(lastPayByStudent[c.studentId].timestamp) || 0)) {
        lastPayByStudent[c.studentId] = c;
      }
    });
    (bills || []).forEach(function (b) {
      if (!b || !b.studentId) return;
      if (!billsByStudent[b.studentId]) billsByStudent[b.studentId] = [];
      billsByStudent[b.studentId].push(b);
    });
    return { paidByStudent: paidByStudent, lastPayByStudent: lastPayByStudent, billsByStudent: billsByStudent };
  };

  /** Legacy O(n×m) — benchmark/test only; throws when EMS_DISABLE_LEGACY_ARREARS is true (default). */
  window.finComputeArrearsLegacyOnm = function (students, collections) {
    if (window.EMS_DISABLE_LEGACY_ARREARS !== false) {
      throw new Error('Legacy O(n×m) arrears path is disabled in live execution');
    }
    var total = 0;
    (students || []).forEach(function (std) {
      var paid = (collections || []).filter(function (c) { return c.studentId === std.id; })
        .reduce(function (s, c) { return s + (Number(c.amount) || 0); }, 0);
      total += paid;
    });
    return total;
  };

  window.finComputeStudent = function (stdId, users, setups, collections, bills, feeIndexes) {
    users = users || finGetAllUsers();
    setups = setups || JSON.parse(localStorage.getItem('ems_student_fee_setup')) || {};
    collections = collections || JSON.parse(localStorage.getItem('ems_fee_collections')) || [];
    bills = bills || window.finGetBills();
    feeIndexes = feeIndexes || null;
    var std = users.find(function (u) { return u.id === stdId; });
    var setup = setups[stdId];
    if (!setup && std && std.class) {
      var cs = JSON.parse(localStorage.getItem('ems_class_fee_structure') || '{}');
      if (cs[std.class]) setup = cs[std.class];
    }
    setup = setup || { fees: {}, discount: 0, netPayable: 0, discountType: '', discountReason: '' };
    var gross = window.finSetupGross(setup);
    var due = setup.netPayable != null ? Number(setup.netPayable) : window.finSetupNetPayable(setup);
    var monthlyCharge = window.finGetMonthlyCharge(stdId, setup);
    var stdBills = feeIndexes && feeIndexes.billsByStudent
      ? (feeIndexes.billsByStudent[stdId] || [])
      : bills.filter(function (b) { return b.studentId === stdId; });
    var totalBilled = stdBills.reduce(function (s, b) { return s + Number(b.amount || 0); }, 0);
    if (totalBilled === 0 && due > 0) totalBilled = due;
    var paid;
    var lastPay;
    if (feeIndexes && feeIndexes.paidByStudent) {
      paid = feeIndexes.paidByStudent[stdId] || 0;
      lastPay = feeIndexes.lastPayByStudent ? feeIndexes.lastPayByStudent[stdId] : null;
    } else {
      var stdCols = collections.filter(function (c) { return c.studentId === stdId && window.finIsCollectionActive(c); });
      paid = stdCols.reduce(function (s, c) { return s + Number(c.amount || 0); }, 0);
      lastPay = stdCols.slice().sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); })[0];
    }
    var arrears = Math.max(0, totalBilled - paid);
    var advanceBalance = Math.max(0, paid - totalBilled);
    var status = (totalBilled <= 0 && due <= 0) ? 'none'
      : (advanceBalance > 0 ? 'advance'
        : (arrears <= 0 ? 'paid' : (paid > 0 ? 'partial' : 'defaulter')));
    var monthsOverdue = monthlyCharge > 0 && arrears > 0 ? Math.ceil(arrears / monthlyCharge) : (arrears > 0 ? 1 : 0);
    return {
      std: std, setup: setup, gross: gross, due: due, monthlyCharge: monthlyCharge,
      totalBilled: totalBilled, paid: paid, arrears: arrears, advanceBalance: advanceBalance,
      lastPay: lastPay, status: status, monthsOverdue: monthsOverdue,
      hasConcession: !!(setup.discountType || setup.discount > 0),
      bills: stdBills, billCount: stdBills.length
    };
  };

  window.finExportPDF = function (elementId, title) {
    var fn = String(title || 'document').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'document';
    if (typeof window.finDownloadPDF === 'function') {
      window.finDownloadPDF(elementId, fn + '.pdf');
      return;
    }
    if (typeof window.printDiv !== 'function') return showToast('پرنٹ دستیاب نہیں', 'error');
    window.printDiv(elementId);
    if (typeof showToast === 'function') showToast((title || 'دستاویز') + ' — پرنٹ میں "Save as PDF" منتخب کریں', 'info');
  };

  window.finDownloadPDF = function (elementId, filename) {
    filename = filename || 'document.pdf';
    if (!/\.pdf$/i.test(filename)) filename += '.pdf';
    var el = document.getElementById(elementId);
    if (!el) return showToast('عنصر نہیں ملا', 'error');
    if (!window.html2canvas || !window.jspdf) {
      if (typeof window.printDiv === 'function') window.printDiv(elementId);
      return showToast('PDF لائبریری نہیں — پرنٹ استعمال کریں', 'warning');
    }
    if (typeof showToast === 'function') showToast('PDF تیار ہو رہی ہے...', 'info');
    html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false }).then(function (canvas) {
      var jsPDF = window.jspdf.jsPDF;
      var pdf = new jsPDF('p', 'mm', 'a4');
      var pageW = pdf.internal.pageSize.getWidth();
      var pageH = pdf.internal.pageSize.getHeight();
      var margin = 10;
      var imgW = pageW - margin * 2;
      var imgH = (canvas.height * imgW) / canvas.width;
      var imgData = canvas.toDataURL('image/png');
      var y = margin;
      var remaining = imgH;
      pdf.addImage(imgData, 'PNG', margin, y, imgW, imgH);
      remaining -= (pageH - margin * 2);
      while (remaining > 0) {
        pdf.addPage();
        y = margin - (imgH - remaining);
        pdf.addImage(imgData, 'PNG', margin, y, imgW, imgH);
        remaining -= (pageH - margin * 2);
      }
      pdf.save(filename);
      if (typeof showToast === 'function') showToast('PDF ڈاؤنلوڈ: ' + filename, 'success');
    }).catch(function () {
      if (typeof window.printDiv === 'function') window.printDiv(elementId);
      if (typeof showToast === 'function') showToast('PDF نہیں بن سکی — پرنٹ کھول دیا', 'warning');
    });
  };

  window.finApplyReportPeriod = function (preset) {
    var fromEl = document.getElementById('fin-rep-from');
    var toEl = document.getElementById('fin-rep-to');
    if (!fromEl || !toEl) return;
    var now = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var iso = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    toEl.value = iso(now);
    if (preset === 'today') {
      fromEl.value = iso(now);
    } else if (preset === 'week') {
      var w = new Date(now);
      w.setDate(w.getDate() - 6);
      fromEl.value = iso(w);
    } else if (preset === 'month') {
      fromEl.value = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-01';
    } else if (preset === 'year') {
      fromEl.value = now.getFullYear() + '-01-01';
    }
  };

  window.finRepDateRange = function () {
    var fromD = document.getElementById('fin-rep-from') ? document.getElementById('fin-rep-from').value : '';
    var toD = document.getElementById('fin-rep-to') ? document.getElementById('fin-rep-to').value : '';
    return { from: fromD, to: toD, fromMonth: fromD ? fromD.slice(0, 7) : '', toMonth: toD ? toD.slice(0, 7) : '' };
  };

  function finGetStudentSetup(std, setups) {
    var setup = setups[std.id];
    if (!setup && std.class) {
      var cs = JSON.parse(localStorage.getItem('ems_class_fee_structure') || '{}');
      if (cs[std.class]) setup = cs[std.class];
    }
    return setup || { fees: {}, netPayable: 0, discount: 0 };
  }

  function finGetOneTimeFees(setup) {
    var list = [];
    var admission = setup.fees && setup.fees['داخلہ فیس'] ? Number(setup.fees['داخلہ فیس']) : 0;
    if (admission > 0) {
      list.push({
        type: 'admission',
        label: 'داخلہ فیس',
        amount: window.finCategoryNetAmount(admission, setup)
      });
    }
    return list;
  }

  function finGenerateBillsForMonth(month, classFilter, bills, users, setups, collector) {
    var students = users.filter(function (u) { return u.type === 'student'; });
    if (classFilter) students = students.filter(function (s) { return s.class === classFilter; });
    var created = 0, skipped = 0;
    var now = Date.now();
    students.forEach(function (std) {
      var setup = finGetStudentSetup(std, setups);
      var hasAnyBill = bills.some(function (b) { return b.studentId === std.id; });
      if (!hasAnyBill) {
        finGetOneTimeFees(setup).forEach(function (ot) {
          if (bills.some(function (b) { return b.studentId === std.id && b.month === month && b.type === ot.type; })) {
            skipped++;
            return;
          }
          bills.push({
            id: generateID('BILL'),
            studentId: std.id,
            studentName: std.name,
            class: std.class,
            month: month,
            type: ot.type,
            label: month + ' — ' + ot.label,
            amount: ot.amount,
            generatedAt: now,
            generatedBy: collector
          });
          created++;
        });
      }
      var amount = window.finGetMonthlyCharge(std.id, setup);
      if (amount <= 0) { skipped++; return; }
      if (bills.some(function (b) { return b.studentId === std.id && b.month === month && b.type === 'monthly'; })) { skipped++; return; }
      bills.push({
        id: generateID('BILL'),
        studentId: std.id,
        studentName: std.name,
        class: std.class,
        month: month,
        type: 'monthly',
        label: month + ' ماہانہ چالان',
        amount: amount,
        generatedAt: now,
        generatedBy: collector
      });
      created++;
    });
    return { created: created, skipped: skipped, bills: bills };
  }

  function finParseCSVLine(line) {
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

  window.finImportCollectionsCSV = function (input) {
    if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('finance', 'edit')) {
      if (input) input.value = '';
      return;
    }
    var file = input && input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var text = (e.target.result || '').replace(/^\uFEFF/, '');
      var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
      if (lines.length < 2) { showToast('فائل خالی یا ناقص ہے', 'error'); return; }
      var headers = finParseCSVLine(lines[0]).map(function (h) { return h.replace(/^"|"$/g, '').trim().toLowerCase(); });
      var idIdx = headers.findIndex(function (h) { return h.indexOf('id') >= 0 || h.indexOf('آئی') >= 0; });
      var nameIdx = headers.findIndex(function (h) { return h.indexOf('نام') >= 0 || h.indexOf('name') >= 0; });
      var dateIdx = headers.findIndex(function (h) { return h.indexOf('date') >= 0 || h.indexOf('تاریخ') >= 0; });
      var amtIdx = headers.findIndex(function (h) { return h.indexOf('amount') >= 0 || h.indexOf('رقم') >= 0 || h.indexOf('وصول') >= 0; });
      var typeIdx = headers.findIndex(function (h) { return h.indexOf('payment') >= 0 || h.indexOf('ادائیگی') >= 0 || h.indexOf('قسم') >= 0; });
      if (idIdx < 0 && nameIdx < 0) { showToast('ID یا نام والا کالم درکار ہے', 'error'); return; }
      if (amtIdx < 0) { showToast('رقم والا کالم درکار ہے', 'error'); return; }
      var users = finGetAllUsers();
      var students = users.filter(function (u) { return u.type === 'student'; });
      var collections = JSON.parse(localStorage.getItem('ems_fee_collections')) || [];
      var added = 0, skipped = 0;
      var collector = window.finCollectorName();
      var today = new Date().toISOString().slice(0, 10);
      for (var li = 1; li < lines.length; li++) {
        var cells = finParseCSVLine(lines[li]);
        var sid = idIdx >= 0 ? (cells[idIdx] || '').trim() : '';
        var sname = nameIdx >= 0 ? (cells[nameIdx] || '').trim() : '';
        var amt = Number((cells[amtIdx] || '').replace(/[^\d.-]/g, ''));
        if (!amt || amt <= 0) { skipped++; continue; }
        var std = sid ? students.find(function (s) { return s.id === sid; }) : students.find(function (s) { return s.name === sname || (sname && s.name.indexOf(sname) >= 0); });
        if (!std) { skipped++; continue; }
        var date = dateIdx >= 0 && cells[dateIdx] ? cells[dateIdx].trim() : today;
        if (window.finIsDateClosed(date)) { skipped++; continue; }
        var payType = typeIdx >= 0 && cells[typeIdx] ? cells[typeIdx].trim() : 'درآمد';
        var now = new Date();
        collections.push({
          id: generateID('REC'),
          studentId: std.id,
          studentName: std.name,
          class: std.class,
          date: date,
          time: now.toLocaleTimeString('ur-PK', { hour: '2-digit', minute: '2-digit' }),
          amount: amt,
          paymentType: payType,
          collectedBy: collector,
          timestamp: now.getTime(),
          imported: true
        });
        added++;
      }
      if (added > 0) {
        emsSaveKey('ems_fee_collections', JSON.stringify(collections));
        showToast(added + ' وصولیاں درآمد، ' + skipped + ' نظرانداز', 'success');
        updateFinanceMiniDashboard();
        if (typeof window.renderFinanceDashboard === 'function') window.renderFinanceDashboard();
      } else showToast('کوئی درست ریکارڈ نہیں ملا', 'warning');
    };
    reader.readAsText(file, 'UTF-8');
    input.value = '';
  };

  window.finGenerateMonthlyBills = function () {
    if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('finance', 'edit')) return;
    var monthEl = document.getElementById('fin-bill-month');
    var month = monthEl ? monthEl.value : '';
    if (!month) return showToast('مہینہ منتخب کریں!', 'error');
    var classFilter = document.getElementById('fin-bill-class') ? document.getElementById('fin-bill-class').value : '';
    var users = finGetAllUsers();
    var setups = JSON.parse(localStorage.getItem('ems_student_fee_setup')) || {};
    var bills = window.finGetBills();
    var collector = window.finCollectorName();
    var result = finGenerateBillsForMonth(month, classFilter, bills, users, setups, collector);
    emsSaveKey('ems_fee_bills', JSON.stringify(result.bills));
    showToast(result.created + ' نئے چالان، ' + result.skipped + ' پہلے سے / خالی', 'success');
    window.finRenderBillsList();
    if (typeof window.renderFinanceDashboard === 'function') window.renderFinanceDashboard();
  };

  window.finGenerateMultiMonthBills = function () {
    if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('finance', 'edit')) return;
    var monthEl = document.getElementById('fin-bill-month');
    var endMonth = monthEl ? monthEl.value : '';
    if (!endMonth) return showToast('آخری مہینہ منتخب کریں!', 'error');
    var countEl = document.getElementById('fin-bill-backfill');
    var count = countEl ? Number(countEl.value) || 3 : 3;
    count = Math.min(Math.max(count, 1), 24);
    var classFilter = document.getElementById('fin-bill-class') ? document.getElementById('fin-bill-class').value : '';
    var users = finGetAllUsers();
    var setups = JSON.parse(localStorage.getItem('ems_student_fee_setup')) || {};
    var bills = window.finGetBills();
    var collector = window.finCollectorName();
    var months = [];
    var d = new Date(endMonth + '-01');
    for (var i = 0; i < count; i++) {
      months.unshift(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
      d.setMonth(d.getMonth() - 1);
    }
    var totalCreated = 0, totalSkipped = 0;
    months.forEach(function (m) {
      var r = finGenerateBillsForMonth(m, classFilter, bills, users, setups, collector);
      bills = r.bills;
      totalCreated += r.created;
      totalSkipped += r.skipped;
    });
    emsSaveKey('ems_fee_bills', JSON.stringify(bills));
    showToast(totalCreated + ' چالان (' + months.length + ' ماہ)، ' + totalSkipped + ' نظرانداز', 'success');
    window.finRenderBillsList();
    if (typeof window.renderFinanceDashboard === 'function') window.renderFinanceDashboard();
  };

  window.finDeleteBill = function (billId) {
    if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('finance', 'edit')) return;
    if (!confirm('یہ چالان حذف کریں؟')) return;
    var bills = window.finGetBills().filter(function (b) { return b.id !== billId; });
    emsSaveKey('ems_fee_bills', JSON.stringify(bills));
    window.finRenderBillsList();
    showToast('چالان حذف ہو گیا', 'success');
    if (typeof window.renderFinanceDashboard === 'function') window.renderFinanceDashboard();
  };

  window.finRenderBillsList = function () {
    var monthEl = document.getElementById('fin-bill-month');
    var month = monthEl ? monthEl.value : '';
    var clsF = document.getElementById('fin-bill-class') ? document.getElementById('fin-bill-class').value : '';
    var tbody = document.getElementById('fin-bills-tbody');
    var summary = document.getElementById('fin-bills-summary');
    if (!tbody) return;
    var bills = window.finGetBills();
    if (month) bills = bills.filter(function (b) { return b.month === month; });
    if (clsF) bills = bills.filter(function (b) { return b.class === clsF; });
    var totalAmt = bills.reduce(function (s, b) { return s + Number(b.amount || 0); }, 0);
    if (summary) {
      summary.innerHTML = '<div class="cmp-stat" style="border-top:3px solid #2563eb;"><div class="cmp-stat-v">' + bills.length + '</div><div class="cmp-stat-l">چالان</div></div>' +
        '<div class="cmp-stat" style="border-top:3px solid #16a34a;"><div class="cmp-stat-v">Rs ' + totalAmt.toLocaleString() + '</div><div class="cmp-stat-l">کل رقم</div></div>';
    }
    if (!bills.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#94a3b8;">کوئی چالان نہیں — مہینہ منتخب کر کے بنائیں</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    bills.sort(function (a, b) { return (a.studentName || '').localeCompare(b.studentName || ''); });
    var typeLabel = { monthly: 'ماہانہ', admission: 'داخلہ', onetime: 'یک بار' };
    bills.forEach(function (b) {
      var fin = window.finComputeStudent(b.studentId);
      var st = fin.arrears <= 0 ? '<span style="color:#16a34a;">ادا</span>' : '<span style="color:#dc2626;">بقایا</span>';
      var tl = typeLabel[b.type] || b.type || '—';
      tbody.innerHTML += '<tr><td>' + b.id + '</td><td>' + b.month + '</td><td>' + tl + '</td><td><strong>' + b.studentName + '</strong><br><small>' + b.studentId + '</small></td><td>' + (b.class || '—') + '</td><td>Rs ' + Number(b.amount).toLocaleString() + '</td><td>' + st + '</td><td style="white-space:nowrap;"><button class="btn btn-sm btn-secondary" onclick="window.emsSlipPrintChallan(\'' + b.id + '\')" title="سلپ پرنٹ"><i class="fas fa-print"></i></button> <button class="btn btn-sm btn-outline" onclick="window.finDeleteBill(\'' + b.id + '\')" title="حذف"><i class="fas fa-trash"></i></button></td></tr>';
    });
  };

  window.finExportBillsCSV = function () {
    var month = document.getElementById('fin-bill-month') ? document.getElementById('fin-bill-month').value : '';
    var clsF = document.getElementById('fin-bill-class') ? document.getElementById('fin-bill-class').value : '';
    var bills = window.finGetBills();
    if (month) bills = bills.filter(function (b) { return b.month === month; });
    if (clsF) bills = bills.filter(function (b) { return b.class === clsF; });
    var rows = [['چالان#', 'مہینہ', 'نام', 'ID', 'درجہ', 'رقم', 'بنایا']];
    bills.forEach(function (b) {
      rows.push([b.id, b.month, b.studentName, b.studentId, b.class, b.amount, b.generatedAt ? new Date(b.generatedAt).toLocaleDateString('ur-PK') : '']);
    });
    window.finDownloadCSV(rows, 'چالان_' + (month || 'تمام') + '.csv');
  };

  window.finPrintFilteredChallanSlips = function () {
    var month = document.getElementById('fin-bill-month') ? document.getElementById('fin-bill-month').value : '';
    var clsF = document.getElementById('fin-bill-class') ? document.getElementById('fin-bill-class').value : '';
    var bills = window.finGetBills();
    if (month) bills = bills.filter(function (b) { return b.month === month; });
    if (clsF) bills = bills.filter(function (b) { return b.class === clsF; });
    if (typeof window.emsSlipApplySettingsFromUI === 'function') window.emsSlipApplySettingsFromUI();
    if (typeof window.emsSlipPrintBatchChallans === 'function') {
      window.emsSlipPrintBatchChallans(bills);
    } else {
      showToast('سلپ ماڈیول لوڈ نہیں — فیس ٹیب دوبارہ کھولیں', 'error');
    }
  };

  window.finRenderStudentLedger = function (stdId) {
    var box = document.getElementById('fin-student-ledger');
    var tbody = document.getElementById('fin-ledger-tbody');
    if (!box || !tbody) return;
    if (!stdId) { box.style.display = 'none'; return; }
    var bills = window.finGetBills().filter(function (b) { return b.studentId === stdId; });
    var cols = JSON.parse(localStorage.getItem('ems_fee_collections') || '[]').filter(function (c) { return c.studentId === stdId; });
    var entries = [];
    bills.forEach(function (b) {
      entries.push({ sort: b.month, date: b.month, type: 'چالان', ref: b.id, debit: Number(b.amount || 0), credit: 0, collection: null });
    });
    cols.forEach(function (c) {
      entries.push({
        sort: c.date + (c.timestamp || ''),
        date: c.date,
        type: 'وصولی',
        ref: c.id,
        debit: 0,
        credit: Number(c.amount || 0),
        collection: c,
        isVoid: !!c.isVoid
      });
    });
    entries.sort(function (a, b) { return String(a.sort).localeCompare(String(b.sort)); });
    var fin = window.finComputeStudent(stdId);
    if (!entries.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;">ابھی کوئی چالان یا وصولی نہیں</td></tr>';
    } else {
      tbody.innerHTML = '';
      entries.forEach(function (e) {
        var voidBadge = e.isVoid
          ? ' <span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;font-size:11px;">منسوخ</span>'
          : '';
        var creditStyle = e.isVoid ? 'color:#94a3b8;text-decoration:line-through;' : 'color:#16a34a;';
        var actionCell = '—';
        if (e.collection && !e.isVoid) {
          actionCell = '<button type="button" class="btn btn-outline btn-sm" onclick="window.finVoidCollection(\'' + e.ref + '\', \'' + stdId + '\')" title="رسید منسوخ کریں"><i class="fas fa-ban"></i> منسوخ</button>';
        } else if (e.isVoid && e.collection && e.collection.voidReason) {
          actionCell = '<small style="color:#92400e;" title="' + String(e.collection.voidReason).replace(/"/g, '&quot;') + '">وجہ: ' + e.collection.voidReason + '</small>';
        }
        tbody.innerHTML += '<tr' + (e.isVoid ? ' style="opacity:0.75;background:#fffbeb;"' : '') + '><td>' + e.date + '</td><td>' + e.type + voidBadge + '</td><td>' + e.ref + '</td><td style="color:#dc2626;">' + (e.debit ? 'Rs ' + e.debit : '—') + '</td><td style="' + creditStyle + '">' + (e.credit ? 'Rs ' + e.credit : '—') + '</td><td>' + actionCell + '</td></tr>';
      });
      if (fin.arrears > 0) {
        tbody.innerHTML += '<tr style="font-weight:bold;background:#fef2f2;"><td colspan="5">موجودہ بقایا (Arrears)</td><td style="color:#dc2626;">Rs ' + fin.arrears.toLocaleString() + '</td></tr>';
      }
      if (fin.advanceBalance > 0) {
        tbody.innerHTML += '<tr style="font-weight:bold;background:#ecfdf5;"><td colspan="5">پیشگی بیلنس (Advance / Credit)</td><td style="color:#16a34a;">Rs ' + fin.advanceBalance.toLocaleString() + '</td></tr>';
      }
      if (fin.arrears <= 0 && fin.advanceBalance <= 0 && (fin.totalBilled > 0 || fin.paid > 0)) {
        tbody.innerHTML += '<tr style="font-weight:bold;background:#f8fafc;"><td colspan="5">حساب تسلیم شدہ</td><td style="color:#64748b;">Rs 0</td></tr>';
      }
    }
    box.style.display = 'block';
  };

  window.finVoidCollection = function (receiptId, stdId) {
    if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('finance', 'edit')) return;
    if (!receiptId) return;
    var reason = typeof window.prompt === 'function' ? window.prompt('منسوخی کی وجہ درج کریں (لازمی):') : '';
    if (!reason || !String(reason).trim()) {
      if (typeof showToast === 'function') showToast('منسوخی کی وجہ درج کرنا لازمی ہے', 'error');
      return;
    }
    var collections = JSON.parse(localStorage.getItem('ems_fee_collections') || '[]');
    var rec = collections.find(function (c) { return c.id === receiptId; });
    if (!rec) {
      if (typeof showToast === 'function') showToast('رسید نہیں ملی', 'error');
      return;
    }
    if (rec.isVoid) {
      if (typeof showToast === 'function') showToast('یہ رسید پہلے ہی منسوخ ہے', 'warning');
      return;
    }
    if (!window.finRequireDateOpen(rec.date)) return;
    rec.isVoid = true;
    rec.voidReason = String(reason).trim();
    rec.voidedBy = window.finCollectorName();
    rec.voidedAt = Date.now();
    emsSaveKey('ems_fee_collections', JSON.stringify(collections));
    if (typeof window.emsLogAudit === 'function') {
      window.emsLogAudit('finance', 'void', receiptId, { studentId: rec.studentId, voidReason: rec.voidReason, amount: rec.amount });
    }
    if (typeof showToast === 'function') showToast('رسید منسوخ ہو گئی — ریکارڈ محفوظ ہے', 'success');
    if (typeof updateFinanceMiniDashboard === 'function') updateFinanceMiniDashboard();
    if (typeof window.renderFinanceDashboard === 'function') window.renderFinanceDashboard();
    if (stdId) {
      if (typeof window.finRenderStudentLedger === 'function') window.finRenderStudentLedger(stdId);
      var stdSel = document.getElementById('fin-col-student');
      if (stdSel && stdSel.value === stdId) stdSel.dispatchEvent(new Event('change'));
    }
    var receiptEl = document.getElementById('fin-receipt-printable');
    if (receiptEl && receiptEl.style.display !== 'none' && window._finLastReceiptId === receiptId) {
      window.finShowReceipt(rec, { voided: true });
    }
  };

  window.finCollectorName = function () {
    if (typeof firebase !== 'undefined' && firebase.auth().currentUser) {
      return firebase.auth().currentUser.email || firebase.auth().currentUser.uid || 'عملہ';
    }
    return 'عملہ';
  };

  window.finShowReceipt = function (rec, finData) {
    finData = finData || {};
    window._finLastReceiptId = rec && rec.id;
    window._finLastReceiptStudentId = rec && rec.studentId;
    var bh = document.getElementById('fin-receipt-brand-header');
    var bf = document.getElementById('fin-receipt-brand-footer');
    if (bh && typeof window.attBrandHeaderHTML === 'function') bh.innerHTML = window.attBrandHeaderHTML();
    if (bf && typeof window.attSignFooterHTML === 'function') bf.innerHTML = window.attSignFooterHTML();
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.innerText = v; };
    var isVoid = !!(rec && rec.isVoid) || !!finData.voided;
    var arrears = finData.remaining != null ? Math.max(0, Number(finData.remaining) || 0) : 0;
    var advance = finData.advance != null ? Math.max(0, Number(finData.advance) || 0) : 0;
    set('rpt-receipt-no', 'رسید #: ' + rec.id + (isVoid ? ' (منسوخ)' : ''));
    set('rpt-date', rec.date);
    set('rpt-time', rec.time || '');
    set('rpt-student', rec.studentName);
    set('rpt-class', rec.class);
    set('rpt-id', rec.studentId);
    set('rpt-paytype', rec.paymentType || 'مکمل');
    set('rpt-collector', rec.collectedBy || window.finCollectorName());
    set('rpt-payable', finData.payable != null ? finData.payable : '—');
    set('rpt-received', rec.amount);
    set('rpt-remaining', arrears > 0 ? arrears : '—');
    var advRow = document.getElementById('rpt-advance-row');
    if (advRow) advRow.style.display = advance > 0 ? '' : 'none';
    set('rpt-advance', advance > 0 ? advance : '—');
    var voidBanner = document.getElementById('fin-receipt-void-banner');
    if (voidBanner) {
      if (isVoid) {
        voidBanner.style.display = 'block';
        voidBanner.innerHTML = '<strong style="color:#92400e;"><i class="fas fa-ban"></i> منسوخ شدہ رسید</strong>'
          + (rec.voidReason ? '<br><small>وجہ: ' + rec.voidReason + '</small>' : '')
          + (rec.voidedBy ? '<br><small>منسوخ کنندہ: ' + rec.voidedBy + '</small>' : '');
      } else {
        voidBanner.style.display = 'none';
        voidBanner.innerHTML = '';
      }
    }
    var voidBtn = document.getElementById('btn-void-receipt');
    if (voidBtn) voidBtn.style.display = (isVoid || !rec.id) ? 'none' : '';
    document.getElementById('fin-receipt-printable').style.display = 'block';
    if (typeof window.emsSlipEnhanceReceiptDOM === 'function') window.emsSlipEnhanceReceiptDOM(rec);
  };

    window.refreshFinanceData = function (activeTabId) {
      if (typeof window.emsIsFinanceModuleActive === 'function' && !window.emsIsFinanceModuleActive()) return;
      activeTabId = activeTabId || window._finActiveTab || 'fee-win-dashboard';
      finRefreshClassDropdowns(false);
      if (activeTabId === 'fee-win-settings' || activeTabId === 'fee-win-structure') {
        renderFeeCategories();
      }
      if (activeTabId === 'fee-win-dashboard') {
        updateFinanceMiniDashboard();
      }
  };



  document.getElementById('tab-finance')?.addEventListener('click', function () {
    if (typeof window.emsIsFinanceModuleActive === 'function' && !window.emsIsFinanceModuleActive()) return;
    finInitOptDeptFilter();
  });



  document.getElementById('btn-add-fin-cat')?.addEventListener('click', () => {

      if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('finance', 'edit')) return;

      let name = document.getElementById('fin-cat-name').value.trim();

      if(!name) return showToast("مد کا نام درج کریں!", "error");

      

      let cats = JSON.parse(localStorage.getItem('ems_fee_categories')) || ['ماہانہ فیس', 'داخلہ فیس'];

      if(!cats.includes(name)) {

          cats.push(name);

          emsSaveKey('ems_fee_categories', JSON.stringify(cats));

          document.getElementById('fin-cat-name').value = '';

          renderFeeCategories();

          showToast("فیس کی نئی مد محفوظ ہو گئی", "success");

      } else {

          showToast("یہ مد پہلے سے موجود ہے", "warning");

      }

  });



  window.renderFeeCategories = function() {

      let cats = JSON.parse(localStorage.getItem('ems_fee_categories'));
      if (!cats || !cats.length) {
        cats = FIN_DEFAULT_CATS.slice();
        emsSaveKey('ems_fee_categories', JSON.stringify(cats));
      }

      const tbody = document.querySelector('#fin-cats-table tbody');

      if(!tbody) return;

      tbody.innerHTML = '';

      cats.forEach(cat => {

          tbody.innerHTML += `<tr><td>${cat}</td><td><button class="icon-btn delete" onclick="deleteFeeCat('${cat}')"><i class="fas fa-trash"></i></button></td></tr>`;

      });

  };



  window.deleteFeeCat = function(name) {

      if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('finance', 'edit')) return;

      if(confirm("کیا آپ واقعی فیس کی یہ کیٹیگری ختم کرنا چاہتے ہیں؟")) {

          let cats = JSON.parse(localStorage.getItem('ems_fee_categories')) || [];

          emsSaveKey('ems_fee_categories', JSON.stringify(cats.filter(c => c !== name)));

          renderFeeCategories();

      }

  };



  document.getElementById('fin-setup-class')?.addEventListener('change', function() {

      const cls = this.value;

      const stdSelect = document.getElementById('fin-setup-student');

      if(!cls) { stdSelect.innerHTML = '<option value="">پہلے درجہ منتخب کریں</option>'; return; }

      function fillStudentOptions(students) {
        if (typeof window.emsFillSelectOptions === 'function') {
          window.emsFillSelectOptions(stdSelect, (students || []).map(function (s) {
            return { value: s.id, label: s.name + ' (' + s.id + ')' };
          }), { placeholder: 'طالب علم منتخب کریں...' });
        } else {
          stdSelect.innerHTML = '<option value="">طالب علم منتخب کریں...</option>';
          (students || []).slice(0, 50).forEach(function (s) {
            stdSelect.innerHTML += '<option value="' + s.id + '">' + s.name + ' (' + s.id + ')</option>';
          });
        }
      }

      if (typeof window.emsFetchStudentsLocalFirst === 'function') {
        window.emsFetchStudentsLocalFirst(cls).then(fillStudentOptions);
      } else if (typeof window.emsFetchStudentsForClass === 'function') {
        window.emsFetchStudentsForClass(cls).then(fillStudentOptions);
      } else {
        fillStudentOptions(finGetStudents(finGetAllUsers()).filter(function (u) { return u.class === cls; }).slice(0, 50));
      }

  });



  let currentSetupStudentId = null;

  document.getElementById('btn-load-student-setup')?.addEventListener('click', () => {

      const stdId = document.getElementById('fin-setup-student').value;

      if(!stdId) return showToast("طالب علم منتخب کریں", "error");

      currentSetupStudentId = stdId;

      var loadStd = typeof window.emsGetUserById === 'function'
        ? window.emsGetUserById(stdId)
        : Promise.resolve(finGetAllUsers().find(u => u.id === stdId));

      loadStd.then(function (std) {
      if (!std) return showToast("طالب علم نہیں ملا", "error");

      document.getElementById('fin-setup-student-name').innerText = `طالب علم: ${std.name} (${std.id})`;

      document.getElementById('fin-setup-area').style.display = 'block';



      const cats = JSON.parse(localStorage.getItem('ems_fee_categories')) || [];

      const setups = JSON.parse(localStorage.getItem('ems_student_fee_setup')) || {};

      const studentSetup = setups[stdId];
      var classStruct = JSON.parse(localStorage.getItem('ems_class_fee_structure') || '{}');
      var clsDefault = std && std.class && classStruct[std.class] ? classStruct[std.class] : null;
      const baseSetup = studentSetup || clsDefault || { fees: {}, discount: 0, discountType: '', discountReason: '' };



      const inputsContainer = document.getElementById('fin-setup-categories-inputs');

      inputsContainer.innerHTML = '';

      

      cats.forEach(cat => {

          let val = (baseSetup.fees && baseSetup.fees[cat]) || 0;

          inputsContainer.innerHTML += `

              <div class="input-group">

                  <label>${cat} (Rs)</label>

                  <input type="number" class="input-control fin-setup-val-inp" data-cat="${cat}" value="${val}">

              </div>

          `;

      });



      document.getElementById('fin-setup-discount').value = baseSetup.discount || 0;
      if (document.getElementById('fin-setup-discount-type')) document.getElementById('fin-setup-discount-type').value = baseSetup.discountType || '';
      if (document.getElementById('fin-setup-discount-reason')) document.getElementById('fin-setup-discount-reason').value = baseSetup.discountReason || '';

      calculateSetupNetTotal();



      document.querySelectorAll('.fin-setup-val-inp').forEach(inp => inp.addEventListener('input', calculateSetupNetTotal));

      document.getElementById('fin-setup-discount').addEventListener('input', calculateSetupNetTotal);

      });
  });



  function calculateSetupNetTotal() {

      var feesObj = {};
      document.querySelectorAll('.fin-setup-val-inp').forEach(function (inp) {
        feesObj[inp.getAttribute('data-cat')] = Number(inp.value) || 0;
      });
      var discount = Number(document.getElementById('fin-setup-discount').value) || 0;
      var net = window.finSetupNetPayable({ fees: feesObj, discount: discount });
      document.getElementById('fin-setup-net-total').innerText = net > 0 ? net : 0;

  }



  document.getElementById('btn-save-fin-setup')?.addEventListener('click', () => {

      if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('finance', 'edit')) return;

      if(!currentSetupStudentId) return;

      let setups = JSON.parse(localStorage.getItem('ems_student_fee_setup')) || {};

      let feesObj = {};

      

      document.querySelectorAll('.fin-setup-val-inp').forEach(inp => {

          feesObj[inp.getAttribute('data-cat')] = Number(inp.value) || 0;

      });



      setups[currentSetupStudentId] = {

          fees: feesObj,

          discount: Number(document.getElementById('fin-setup-discount').value) || 0,

          discountType: document.getElementById('fin-setup-discount-type') ? document.getElementById('fin-setup-discount-type').value : '',

          discountReason: document.getElementById('fin-setup-discount-reason') ? document.getElementById('fin-setup-discount-reason').value : '',

          netPayable: Number(document.getElementById('fin-setup-net-total').innerText) || window.finSetupNetPayable({
            fees: feesObj,
            discount: Number(document.getElementById('fin-setup-discount').value) || 0
          }),

          updatedAt: new Date().getTime()

      };



      emsSaveKey('ems_student_fee_setup', JSON.stringify(setups));

      showToast("طالب علم کا فیس شیڈول محفوظ ہو گیا!", "success");

  });



  document.getElementById('fin-col-class')?.addEventListener('change', function() {

      const cls = this.value;

      const stdSelect = document.getElementById('fin-col-student');

      if(!cls) { stdSelect.innerHTML = '<option value="">پہلے درجہ منتخب کریں</option>'; window._finColStudents = []; return; }

      function applyColStudents(students) {
        window._finColStudents = students || [];
        if (typeof window.emsFillSelectOptions === 'function') {
          window.emsFillSelectOptions(stdSelect, window._finColStudents.map(function (s) {
            return { value: s.id, label: s.name + ' (' + s.id + ')' };
          }), { placeholder: 'طالب علم منتخب کریں...' });
        } else {
          stdSelect.innerHTML = '<option value="">طالب علم منتخب کریں...</option>';
          window._finColStudents.slice(0, 50).forEach(function (s) {
            stdSelect.innerHTML += '<option value="' + s.id + '">' + s.name + ' (' + s.id + ')</option>';
          });
        }
      }

      if (typeof window.emsFetchStudentsLocalFirst === 'function') {
        window.emsFetchStudentsLocalFirst(cls).then(applyColStudents);
      } else if (typeof window.emsFetchStudentsForClass === 'function') {
        window.emsFetchStudentsForClass(cls).then(applyColStudents);
      } else {
        applyColStudents(finGetStudents(finGetAllUsers()).filter(function (u) { return u.class === cls; }).slice(0, 50));
      }

  });

  window.finFilterStudents = function (q) {
    var sel = document.getElementById('fin-col-student');
    if (!sel) return;
    q = (q || '').toLowerCase().trim();
    var filtered = (window._finColStudents || []).filter(function (s) {
      if (!q) return true;
      return (s.name + ' ' + s.id).toLowerCase().indexOf(q) >= 0;
    });
    if (typeof window.emsFillSelectOptions === 'function') {
      window.emsFillSelectOptions(sel, filtered.map(function (s) {
        return { value: s.id, label: s.name + ' (' + s.id + ')' };
      }), { placeholder: 'طالب علم منتخب کریں...' });
    } else {
      sel.innerHTML = '<option value="">طالب علم منتخب کریں...</option>';
      filtered.slice(0, 50).forEach(function (s) {
        sel.innerHTML += '<option value="' + s.id + '">' + s.name + ' (' + s.id + ')</option>';
      });
    }
  };



  if(document.getElementById('fin-col-date')) document.getElementById('fin-col-date').valueAsDate = new Date();



  let currentCollectionData = {};

  document.getElementById('fin-col-student')?.addEventListener('change', function() {

      const stdId = this.value;

      if(!stdId) { document.getElementById('fin-collection-panel').style.display = 'none'; if (typeof window.finRenderStudentLedger === 'function') window.finRenderStudentLedger(null); return; }

      var fin = window.finComputeStudent(stdId);

      document.getElementById('col-monthly-fee').innerText = 'Rs ' + fin.monthlyCharge;

      var tbEl = document.getElementById('col-total-billed');
      if (tbEl) tbEl.innerText = 'Rs ' + fin.totalBilled;

      document.getElementById('col-arrears').innerText = 'Rs ' + fin.arrears;

      var advEl = document.getElementById('col-advance');
      if (advEl) {
        if (fin.advanceBalance > 0) {
          advEl.innerText = 'Rs ' + fin.advanceBalance.toLocaleString();
          advEl.closest('.fin-advance-row').style.display = 'flex';
        } else {
          advEl.innerText = 'Rs 0';
          var advRow = advEl.closest('.fin-advance-row');
          if (advRow) advRow.style.display = 'none';
        }
      }

      var moEl = document.getElementById('col-months-overdue');
      if (moEl) moEl.innerText = fin.monthsOverdue > 0 ? fin.monthsOverdue + ' ماہ' : '—';

      document.getElementById('col-total-payable').innerText = 'Rs ' + fin.arrears;

      currentCollectionData = { studentId: stdId, name: this.options[this.selectedIndex].text, class: document.getElementById('fin-col-class').value, payable: fin.arrears, due: fin.totalBilled, paid: fin.paid, advance: fin.advanceBalance, monthlyCharge: fin.monthlyCharge };

      document.getElementById('fin-col-amount').value = fin.arrears > 0 ? fin.arrears : '';

      document.getElementById('fin-collection-panel').style.display = 'block';

      document.getElementById('fin-receipt-printable').style.display = 'none';

      if (typeof window.finRenderStudentLedger === 'function') window.finRenderStudentLedger(stdId);

  });



  document.getElementById('btn-save-collection')?.addEventListener('click', () => {

      if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('finance', 'edit')) return;

      let amount = Number(document.getElementById('fin-col-amount').value);

      let date = document.getElementById('fin-col-date').value;

      

      if(!amount || amount <= 0) return showToast("رقم درج کریں!", "error");

      if(!currentCollectionData.studentId) return;

      if (!window.finRequireDateOpen(date)) return;



      let collections = JSON.parse(localStorage.getItem('ems_fee_collections')) || [];

      let receiptId = generateID('REC');

      var now = new Date();

      var payType = document.getElementById('fin-col-paytype') ? document.getElementById('fin-col-paytype').value : 'مکمل';

      var collector = window.finCollectorName();

      

      collections.push({

          id: receiptId,

          studentId: currentCollectionData.studentId,

          studentName: currentCollectionData.name.split(' (')[0] || currentCollectionData.name,

          class: currentCollectionData.class,

          date: date,

          time: now.toLocaleTimeString('ur-PK', { hour: '2-digit', minute: '2-digit' }),

          amount: amount,

          paymentType: payType,

          collectedBy: collector,

          timestamp: now.getTime()

      });

      var lastCol = collections[collections.length - 1];
      var stdUser = finGetAllUsers().find(function (u) { return u.id === currentCollectionData.studentId; });
      if (typeof window.emsStampDepartment === 'function') {
        window.emsStampDepartment(lastCol, stdUser && stdUser.departmentId);
      }



      emsSaveKey('ems_fee_collections', JSON.stringify(collections));

      showToast("فیس کامیابی سے وصول ہو گئی!", "success");

      var newPaid = (currentCollectionData.paid || 0) + amount;
      var totalBilled = currentCollectionData.due || 0;
      var newArrears = Math.max(0, totalBilled - newPaid);
      var newAdvance = Math.max(0, newPaid - totalBilled);

      window.finShowReceipt(collections[collections.length - 1], {
        payable: currentCollectionData.payable,
        remaining: newArrears,
        advance: newAdvance
      });

      updateFinanceMiniDashboard();

      if (typeof window.renderFinanceDashboard === 'function') window.renderFinanceDashboard();

      document.getElementById('fin-col-student').dispatchEvent(new Event('change'));

  });



  document.getElementById('btn-load-bulk-fee')?.addEventListener('click', () => {

      const cls = document.getElementById('fin-bulk-class').value;

      const tbody = document.getElementById('fin-bulk-tbody');

      if(!cls) { showToast("درجہ منتخب کریں!", "error"); return; }

      function renderBulkRows(students) {
      const users = finGetAllUsers();
      const setups = typeof window.emsCacheGet === 'function'
        ? window.emsCacheGet('ems_student_fee_setup', {})
        : JSON.parse(localStorage.getItem('ems_student_fee_setup') || '{}');
      const collections = typeof window.emsCacheGet === 'function'
        ? window.emsCacheGet('ems_fee_collections', [])
        : JSON.parse(localStorage.getItem('ems_fee_collections') || '[]');
      const bills = typeof window.emsCacheGet === 'function'
        ? window.emsCacheGet('ems_fee_bills', [])
        : JSON.parse(localStorage.getItem('ems_fee_bills') || '[]');

      tbody.innerHTML = '';

      if(students.length === 0) {

          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">اس درجے میں کوئی طالب علم نہیں</td></tr>';

          return;

      }

      var feeIndexesBulk = window.finBuildFeeIndexes(collections, bills);

      students.forEach(std => {
          var fin = window.finComputeStudent(std.id, users, setups, collections, bills, feeIndexesBulk);

          tbody.innerHTML += `

              <tr class="bulk-fee-row" data-std-id="${std.id}" data-std-name="${std.name}" data-std-class="${std.class}" data-arrears="${fin.arrears}">

                  <td><strong>${std.name}</strong><br><small>${std.id}</small></td>

                  <td>Rs ${fin.monthlyCharge}</td>

                  <td style="color:var(--danger); font-weight:bold;">Rs ${fin.arrears}</td>

                  <td><input type="number" class="input-control pay-val" value="0" placeholder="رقم درج کریں" style="font-weight:bold; color:var(--success); width: 100px;"></td>

                  <td>

                      <button class="btn btn-outline btn-icon-only" onclick="sendWhatsApp('${std.phone || ''}', '${std.name}', ${fin.arrears})" title="بقایا جات کا واٹس ایپ کریں"><i class="fab fa-whatsapp" style="color:green; font-size:18px;"></i></button>

                      <button class="btn btn-outline btn-icon-only" onclick="sendSMS('${std.phone || ''}', '${std.name}', ${fin.arrears})" title="بقایا جات کا ایس ایم ایس"><i class="fas fa-sms" style="font-size:18px;"></i></button>

                  </td>

              </tr>

          `;

      });

      showToast("فہرست لوڈ ہو گئی! اب جزوی یا مکمل ادائیگیاں درج کریں۔", "success");

      }

      if (typeof window.emsFetchStudentsForClass === 'function') {
        window.emsFetchStudentsForClass(cls).then(renderBulkRows);
      } else {
        renderBulkRows(finGetStudents(finGetAllUsers()).filter(u => u.class === cls));
      }

  });



  window.sendWhatsApp = function(phone, name, arrears) {

      if(!phone) { showToast("اس طالب علم کا فون نمبر موجود نہیں!", "error"); return; }

      let msg = `محترم والدین ${name}،\nمدرسہ انتظامیہ کی جانب سے اطلاع ہے کہ طالب علم کے ذمے واجب الادا فیس ${arrears} روپے ہے۔ براہ کرم جلد از جلد ادا کریں۔ شکریہ۔`;

      window.open(`https://wa.me/92${phone.replace(/^0+/, '')}?text=${encodeURIComponent(msg)}`, '_blank');

  };



  window.sendSMS = function(phone, name, arrears) {

      if(!phone) { showToast("فون نمبر موجود نہیں!", "error"); return; }

      let msg = `Madrasa Fee Alert: Dear parents of ${name}, your pending fee is Rs ${arrears}. Kindly pay soon.`;

      window.open(`sms:${phone}?body=${encodeURIComponent(msg)}`, '_blank');

  };



  document.getElementById('btn-save-bulk-collection')?.addEventListener('click', () => {

      if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('finance', 'edit')) return;

      let collections = JSON.parse(localStorage.getItem('ems_fee_collections')) || [];

      let date = new Date().toISOString().split('T')[0];

      if (!window.finRequireDateOpen(date)) return;

      let savedCount = 0;

      var collector = window.finCollectorName();

      var now = new Date().getTime();



      document.querySelectorAll('.bulk-fee-row').forEach(row => {

          let stdId = row.getAttribute('data-std-id');

          let name = row.getAttribute('data-std-name');

          let cls = row.getAttribute('data-std-class');

          let paid = Number(row.querySelector('.pay-val').value);

          

          if(paid > 0) {

              collections.push({

                  id: generateID('REC'),

                  studentId: stdId,

                  studentName: name,

                  class: cls,

                  date: date,

                  time: new Date().toLocaleTimeString('ur-PK', { hour: '2-digit', minute: '2-digit' }),

                  amount: paid,

                  paymentType: paid >= Number(row.getAttribute('data-arrears') || 0) ? 'مکمل' : 'جزوی',

                  collectedBy: collector,

                  timestamp: now

              });

              savedCount++;

          }

      });



      if(savedCount > 0) {

          emsSaveKey('ems_fee_collections', JSON.stringify(collections));

          showToast(`${savedCount} طلبہ کی فیس کامیابی سے وصول کر لی گئی!`, "success");

          document.getElementById('btn-load-bulk-fee').click(); 

          if(typeof updateFinanceMiniDashboard === 'function') updateFinanceMiniDashboard();

      } else {

          showToast("کسی طالب علم کی وصولی کی رقم درج نہیں کی گئی!", "warning");

      }

  });



  function updateFinanceMiniDashboard() {
      if (typeof window.emsIsFinanceModuleActive === 'function' && !window.emsIsFinanceModuleActive()) return;
      var ctx = finGetFeeContext(false);
      var collections = ctx.collections;
      const totalCollected = collections.reduce(function (sum, c) { return sum + window.finCollectionEffectiveAmount(c); }, 0);
      if(document.getElementById('rep-total-collected')) document.getElementById('rep-total-collected').innerText = "Rs " + totalCollected.toLocaleString();
      var students = finGetStudents(ctx.users);
      var feeIndexes = window.finBuildFeeIndexes(ctx.collections, ctx.bills);
      var totalArrears = students.reduce(function (s, std) {
          return s + window.finComputeStudent(std.id, ctx.users, ctx.setups, ctx.collections, ctx.bills, feeIndexes).arrears;
      }, 0);
      if(document.getElementById('rep-total-arrears')) document.getElementById('rep-total-arrears').innerText = "Rs " + (totalArrears > 0 ? totalArrears.toLocaleString() : 0);
  }



  document.getElementById('btn-fetch-fin-report')?.addEventListener('click', () => {

      const repType = document.getElementById('fin-rep-type').value;

      const clsFilter = document.getElementById('fin-rep-class').value;

      const tbody = document.getElementById('fin-rep-tbody');

      const theadTr = document.getElementById('fin-rep-headers');

      

      document.getElementById('fin-report-title').style.display = 'block';



      if(repType === 'history') {

          document.getElementById('fin-report-title').innerText = "کشف الوصول (وصولی کی تاریخ)";

          theadTr.innerHTML = '<th>رسید نمبر</th><th>تاریخ</th><th>طالب علم</th><th>درجہ</th><th>وصول شدہ رقم</th><th>حالت</th>';

          

          let cols = JSON.parse(localStorage.getItem('ems_fee_collections')) || [];

          if(clsFilter !== 'all') cols = cols.filter(c => c.class === clsFilter);

          var fromD = document.getElementById('fin-rep-from') ? document.getElementById('fin-rep-from').value : '';
          var toD = document.getElementById('fin-rep-to') ? document.getElementById('fin-rep-to').value : '';
          if (fromD) cols = cols.filter(function (c) { return (c.date || '') >= fromD; });
          if (toD) cols = cols.filter(function (c) { return (c.date || '') <= toD; });

          

          tbody.innerHTML = '';

          if(cols.length === 0) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">کوئی ریکارڈ نہیں</td></tr>'; return; }

          

          cols.reverse().forEach(c => {

              var statusCell = c.isVoid
                ? '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:12px;">منسوخ</span>'
                : '<span style="color:#16a34a;">فعال</span>';
              var amtStyle = c.isVoid ? 'color:#94a3b8;text-decoration:line-through;' : 'color:green; font-weight:bold;';
              tbody.innerHTML += `<tr><td>${c.id}</td><td>${c.date}</td><td>${c.studentName}</td><td>${c.class}</td><td style="${amtStyle}">${c.amount}</td><td>${statusCell}</td></tr>`;

          });

          window._finLastReportRows = [['رسید', 'تاریخ', 'طالب علم', 'درجہ', 'رقم', 'حالت']].concat(cols.map(function (c) {
            return [c.id, c.date, c.studentName, c.class, c.amount, c.isVoid ? 'منسوخ' : 'فعال'];
          }));

      } 

      else if (repType === 'arrears') {

          document.getElementById('fin-report-title').innerText = "فہرست بقایا جات (Defaulters List)";

          theadTr.innerHTML = '<th>طالب علم / ID</th><th>درجہ</th><th>ماہانہ فیس</th><th>رعایت</th><th>بقایا جات</th><th>تاخیر</th>';

          

          const users = finGetAllUsers();

          const setups = JSON.parse(localStorage.getItem('ems_student_fee_setup')) || {};

          const collections = JSON.parse(localStorage.getItem('ems_fee_collections')) || [];

          const allBills = window.finGetBills ? window.finGetBills() : [];

          var range = window.finRepDateRange ? window.finRepDateRange() : { fromMonth: '', toMonth: '' };

          

          let students = users.filter(u => u.type === 'student');

          if(clsFilter !== 'all') students = students.filter(s => s.class === clsFilter);



          tbody.innerHTML = '';

          let hasData = false;

          var feeIndexesRep = window.finBuildFeeIndexes(collections, allBills);

          students.forEach(std => {

              var fin = window.finComputeStudent(std.id, users, setups, collections, allBills, feeIndexesRep);

              if (!(fin.totalBilled > 0 && fin.arrears > 0)) return;

              if (range.fromMonth || range.toMonth) {
                var stdBills = allBills.filter(function (b) { return b.studentId === std.id; });
                var inRange = stdBills.some(function (b) {
                  if (range.fromMonth && b.month < range.fromMonth) return false;
                  if (range.toMonth && b.month > range.toMonth) return false;
                  return true;
                });
                if (!inRange) return;
              }

                      hasData = true;

                      tbody.innerHTML += `<tr>

                          <td><strong>${std.name}</strong> <br><small>${std.id}</small></td>

                          <td>${std.class}</td>

                          <td>Rs ${fin.monthlyCharge}</td>

                          <td style="color:var(--accent);">${fin.setup.discount || 0}${fin.setup.discountType ? ' (' + fin.setup.discountType + ')' : ''}</td>

                          <td style="color:var(--danger); font-weight:bold; font-size:16px;">Rs ${fin.arrears}</td>

                          <td>${fin.monthsOverdue > 0 ? fin.monthsOverdue + ' ماہ' : '—'}</td>

                      </tr>`;

          });

          

          if(!hasData) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">اس مدت / درجے میں کوئی بقایا جات نہیں ہیں</td></tr>';

          else {
            window._finLastReportRows = [['نام', 'ID', 'درجہ', 'ماہانہ فیس', 'رعایت', 'بقایا', 'تاخیر']];
            students.forEach(function (std) {
              var fin = window.finComputeStudent(std.id, users, setups, collections, allBills, feeIndexesRep);
              if (!(fin.totalBilled > 0 && fin.arrears > 0)) return;
              if (range.fromMonth || range.toMonth) {
                var stdBills2 = allBills.filter(function (b) { return b.studentId === std.id; });
                var ok = stdBills2.some(function (b) {
                  if (range.fromMonth && b.month < range.fromMonth) return false;
                  if (range.toMonth && b.month > range.toMonth) return false;
                  return true;
                });
                if (!ok) return;
              }
              window._finLastReportRows.push([std.name, std.id, std.class, fin.monthlyCharge, fin.setup.discount || 0, fin.arrears, fin.monthsOverdue]);
            });
                  }

              }

          });

  // =========================================================
  // درجہ وار فیس ڈھانچہ
  // =========================================================
  document.getElementById('btn-load-class-structure')?.addEventListener('click', function () {
    var cls = document.getElementById('fin-struct-class').value;
    if (!cls) return showToast('درجہ منتخب کریں!', 'error');
    var cats = JSON.parse(localStorage.getItem('ems_fee_categories')) || FIN_DEFAULT_CATS;
    var structs = JSON.parse(localStorage.getItem('ems_class_fee_structure') || '{}');
    var st = structs[cls] || { fees: {} };
    var box = document.getElementById('fin-struct-inputs');
    box.innerHTML = cats.map(function (cat) {
      return '<div class="input-group"><label>' + cat + ' (Rs)</label><input type="number" class="input-control fin-struct-inp" data-cat="' + cat + '" value="' + ((st.fees && st.fees[cat]) || 0) + '"></div>';
    }).join('');
    document.getElementById('fin-struct-area').style.display = 'block';
  });

  document.getElementById('btn-save-class-structure')?.addEventListener('click', function () {
    if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('finance', 'edit')) return;
    var cls = document.getElementById('fin-struct-class').value;
    if (!cls) return;
    var fees = {};
    var sum = 0;
    document.querySelectorAll('.fin-struct-inp').forEach(function (inp) {
      var v = Number(inp.value) || 0;
      fees[inp.getAttribute('data-cat')] = v;
      sum += v;
    });
    var structs = JSON.parse(localStorage.getItem('ems_class_fee_structure') || '{}');
    structs[cls] = { fees: fees, netPayable: sum, updatedAt: new Date().getTime() };
    emsSaveKey('ems_class_fee_structure', JSON.stringify(structs));
    showToast('درجہ "' + cls + '" کا فیس ڈھانچہ محفوظ ہو گیا!', 'success');
  });

  function finRenderFinanceDashboardCore() {
    if (typeof window.emsIsFinanceModuleActive === 'function' && !window.emsIsFinanceModuleActive()) return;
    var dash = document.getElementById('fee-win-dashboard');
    if (dash && dash.style.display === 'none') return;
    var ctx = finGetFeeContext(false);
    var users = ctx.users;
    var collections = ctx.collections;
    var students = finGetStudents(users);
    var today = new Date().toISOString().slice(0, 10);
    var thisMonth = today.slice(0, 7);
    var monthSummary = typeof window.emsGetFinanceSummary === 'function'
      ? window.emsGetFinanceSummary(thisMonth) : null;
    var finSummaries = typeof window.emsGetFinanceSummaries === 'function'
      ? window.emsGetFinanceSummaries() : {};
    var todayCol = collections.filter(function (c) { return c.date === today && window.finIsCollectionActive(c); }).reduce(function (s, c) { return s + c.amount; }, 0);
    var monthCol = collections.filter(function (c) { return (c.date || '').slice(0, 7) === thisMonth && window.finIsCollectionActive(c); }).reduce(function (s, c) { return s + c.amount; }, 0);
    if (monthSummary && monthSummary.version >= 1) {
      monthCol = Number(monthSummary.totalCollected) || 0;
      if (monthSummary.todayDate === today) {
        todayCol = Number(monthSummary.todayCollected) || 0;
      }
    }
    var totalCol = collections.reduce(function (s, c) { return s + window.finCollectionEffectiveAmount(c); }, 0);
    var defaulters = 0, partial = 0, paid = 0, advance = 0, concession = 0, totalArrears = 0;
    var byClass = {};
    var feeIndexesDash = window.finBuildFeeIndexes(ctx.collections, ctx.bills);
    students.forEach(function (std) {
      var fin = window.finComputeStudent(std.id, users, ctx.setups, ctx.collections, ctx.bills, feeIndexesDash);
      totalArrears += fin.arrears;
      if (fin.hasConcession) concession++;
      if (fin.status === 'defaulter') defaulters++;
      else if (fin.status === 'partial') partial++;
      else if (fin.status === 'advance') advance++;
      else if (fin.status === 'paid') paid++;
      if (fin.paid > 0) byClass[std.class] = (byClass[std.class] || 0) + fin.paid;
    });
    var strip = document.getElementById('fin-stat-strip');
    if (strip) {
      var cards = [
        { l: 'کل وصولی', v: 'Rs ' + totalCol.toLocaleString(), c: '#16a34a', i: 'fa-coins' },
        { l: 'آج کی وصولی', v: 'Rs ' + todayCol.toLocaleString(), c: '#2563eb', i: 'fa-calendar-day' },
        { l: 'ماہانہ وصولی', v: 'Rs ' + monthCol.toLocaleString(), c: '#7c3aed', i: 'fa-calendar-alt' },
        { l: 'کل بقایا', v: 'Rs ' + totalArrears.toLocaleString(), c: '#dc2626', i: 'fa-exclamation-triangle' },
        { l: 'بقایا دار', v: defaulters, c: '#d97706', i: 'fa-user-times' }
      ];
      strip.innerHTML = cards.map(function (k) {
        return '<div class="cmp-stat" style="border-top:3px solid ' + k.c + ';"><div class="cmp-stat-ico" style="color:' + k.c + ';"><i class="fas ' + k.i + '"></i></div><div class="cmp-stat-v">' + k.v + '</div><div class="cmp-stat-l">' + k.l + '</div></div>';
      }).join('');
    }
    var remBar = document.getElementById('fin-reminder-bar');
    if (remBar) {
      if (defaulters > 0) {
        remBar.innerHTML = '<div class="cmp-reminder"><i class="fas fa-bell"></i><span><b>' + defaulters + '</b> طلبہ کے ذمے بقایا فیس — فوری توجہ درکار</span><button class="btn btn-sm btn-outline" onclick="switchFinTab(\'fee-win-dues\', document.querySelector(\'#fin-ribbon-menu [onclick*=dues]\'))">بقایا دیکھیں</button></div>';
      } else remBar.innerHTML = '';
    }
    var charts = document.getElementById('fin-dash-charts');
    if (charts) {
      var passSegs = [
        { label: 'مکمل ادا', value: paid, color: '#16a34a' },
        { label: 'پیشگی بیلنس', value: advance, color: '#2563eb' },
        { label: 'جزوی', value: partial, color: '#d97706' },
        { label: 'بقایا دار', value: defaulters, color: '#dc2626' },
        { label: 'رعایت یافتہ', value: concession, color: '#7c3aed' }
      ].filter(function (s) { return s.value > 0; });
      var months = [];
      for (var i = 5; i >= 0; i--) {
        var d = new Date(); d.setMonth(d.getMonth() - i);
        var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        var summaryVal = finSummaries[key] && finSummaries[key].version >= 1
          ? Number(finSummaries[key].totalCollected) || 0
          : collections.filter(function (c) { return (c.date || '').slice(0, 7) === key && window.finIsCollectionActive(c); }).reduce(function (s, c) { return s + c.amount; }, 0);
        months.push({ label: d.toLocaleDateString('ur-PK', { month: 'short' }), value: summaryVal });
      }
      var donut = (typeof window.emsDonutSVG === 'function') ? window.emsDonutSVG(passSegs, students.length, 'طلبہ') : '';
      var line = (typeof window.emsLineChartSVG === 'function') ? window.emsLineChartSVG(months, '#16a34a') : '';
      var classItems = Object.keys(byClass).map(function (c) { return { label: c, value: byClass[c], display: 'Rs ' + byClass[c].toLocaleString() }; });
      var barClass = (typeof window.emsBarChartSVG === 'function') ? window.emsBarChartSVG(classItems) : '';
      charts.innerHTML = '<div class="cmp-dash-card"><h4>ادائیگی کی حالت</h4>' + donut + '</div>' +
        '<div class="cmp-dash-card cmp-dash-wide"><h4>6 ماہی وصولی رجحان</h4>' + line + '</div>' +
        '<div class="cmp-dash-card cmp-dash-wide"><h4>درجہ وار وصولی</h4>' + barClass + '</div>';
    }
    updateFinanceMiniDashboard();
  }

  window.renderFinanceDashboard = function () {
    if (typeof window.emsIsFinanceModuleActive === 'function' && !window.emsIsFinanceModuleActive()) return;
    var run = function () { finRenderFinanceDashboardCore(); };
    if (typeof window.emsDeferModuleWork === 'function') {
      window.emsDeferModuleWork(run, { idle: true, timeout: 400 });
    } else {
      run();
    }
  };

  window.finRenderDuesPager = function (total, page, pages) {
    var box = document.getElementById('fin-dues-pager');
    if (!box) return;
    if (total === 0) { box.innerHTML = ''; return; }
    var pageSize = typeof window.emsGetDomPageSize === 'function' ? window.emsGetDomPageSize() : 50;
    var start = (page - 1) * pageSize;
    var end = Math.min(start + pageSize, total);
    box.innerHTML = '<span class="reg-pg-info">' + (start + 1) + '–' + end + ' / ' + total + ' ریکارڈ</span>' +
      '<button class="reg-pg-btn" ' + (page <= 1 ? 'disabled' : '') + ' onclick="window.finDuesGoPage(' + (page - 1) + ')"><i class="fas fa-chevron-right"></i></button>' +
      '<span class="reg-pg-dots">صفحہ ' + page + ' / ' + pages + '</span>' +
      '<button class="reg-pg-btn" ' + (page >= pages ? 'disabled' : '') + ' onclick="window.finDuesGoPage(' + (page + 1) + ')"><i class="fas fa-chevron-left"></i></button>';
  };

  window.finDuesGoPage = function (p) {
    window._finDuesPage = Math.max(1, p);
    window.finRenderDuesList();
  };

  window.finRenderDuesListCore = function () {
    if (typeof window.emsIsFinanceModuleActive === 'function' && !window.emsIsFinanceModuleActive()) return;
    var tbody = document.getElementById('fin-dues-tbody');
    if (!tbody) return;
    var ctx = finGetFeeContext(false);
    var users = ctx.users;
    var students = finGetStudents(users);
    var clsF = document.getElementById('fin-dues-class') ? document.getElementById('fin-dues-class').value : '';
    var statusF = document.getElementById('fin-dues-status') ? document.getElementById('fin-dues-status').value : '';
    var q = (document.getElementById('fin-dues-search') ? document.getElementById('fin-dues-search').value : '').toLowerCase().trim();
    if (clsF) students = students.filter(function (s) { return s.class === clsF; });
    var rows = [];
    var feeIndexes = window.finBuildFeeIndexes(ctx.collections, ctx.bills);
    students.forEach(function (std) {
      var fin = window.finComputeStudent(std.id, users, ctx.setups, ctx.collections, ctx.bills, feeIndexes);
      if (statusF === 'defaulter' && fin.status !== 'defaulter') return;
      if (statusF === 'partial' && fin.status !== 'partial') return;
      if (statusF === 'paid' && fin.status !== 'paid') return;
      if (statusF === 'concession' && !fin.hasConcession) return;
      if (q && (std.name + ' ' + std.id).toLowerCase().indexOf(q) < 0) return;
      if (fin.totalBilled <= 0 && fin.paid <= 0) return;
      var statusLabel = { paid: 'مکمل ادا', partial: 'جزوی', defaulter: 'بقایا دار', none: '—' }[fin.status] || fin.status;
      var lastD = fin.lastPay ? fin.lastPay.date : '—';
      rows.push({ std: std, fin: fin, statusLabel: statusLabel, lastD: lastD });
    });
    rows.sort(function (a, b) { return b.fin.arrears - a.fin.arrears; });
    window._finDuesRows = rows;

    if (typeof window.emsVirtualTableDestroy === 'function') window.emsVirtualTableDestroy('fin-dues');

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">کوئی ریکارڈ نہیں</td></tr>';
      window.finRenderDuesPager(0, 1, 1);
      return;
    }

    var pageSize = typeof window.emsGetDomPageSize === 'function' ? window.emsGetDomPageSize() : 50;
    var page = window._finDuesPage || 1;
    var pages = Math.max(1, Math.ceil(rows.length / pageSize));
    if (page > pages) page = window._finDuesPage = pages;
    var start = (page - 1) * pageSize;
    var pageRows = rows.slice(start, start + pageSize);

    tbody.innerHTML = '';
    pageRows.forEach(function (r) {
      tbody.innerHTML += '<tr><td><strong>' + r.std.name + '</strong><br><small>' + r.std.id + '</small></td><td>' + r.std.class + '</td><td>Rs ' + r.fin.totalBilled + '</td><td style="color:#16a34a;">Rs ' + r.fin.paid + '</td><td style="color:#dc2626;font-weight:bold;">Rs ' + r.fin.arrears + '</td><td>' + r.lastD + '</td><td>' + r.statusLabel + (r.fin.monthsOverdue > 0 ? ' (' + r.fin.monthsOverdue + 'م)' : '') + '</td></tr>';
    });
    window.finRenderDuesPager(rows.length, page, pages);
  };

  window.finRenderDuesList = function () {
    if (typeof window.emsIsFinanceModuleActive === 'function' && !window.emsIsFinanceModuleActive()) return;
    if (typeof window.emsDeferModuleWork === 'function') {
      window.emsDeferModuleWork(window.finRenderDuesListCore, { idle: true, timeout: 400 });
    } else {
      window.finRenderDuesListCore();
    }
  };

  var _finDuesSearchTimer = null;
  window.finDuesSearch = function () {
    if (_finDuesSearchTimer) clearTimeout(_finDuesSearchTimer);
    window._finDuesPage = 1;
    _finDuesSearchTimer = setTimeout(function () {
      window.finRenderDuesList();
    }, 300);
  };

  window.finExportDues = function () {
    var users = finGetAllUsers();
    var students = users.filter(function (u) { return u.type === 'student'; });
    var rows = [['نام', 'ID', 'درجہ', 'واجب', 'ادا شدہ', 'بقایا', 'آخری ادائیگی', 'حالت']];
    students.forEach(function (std) {
      var fin = window.finComputeStudent(std.id);
      if (fin.totalBilled <= 0 && fin.paid <= 0) return;
      rows.push([std.name, std.id, std.class, fin.totalBilled, fin.paid, fin.arrears, fin.lastPay ? fin.lastPay.date : '', fin.status]);
    });
    window.finDownloadCSV(rows, 'بقaya_فہرست.csv');
  };

  window._finLastReportRows = null;
  window.finExportReport = function () {
    if (!window._finLastReportRows) return showToast('پہلے رپورٹ لائیں!', 'warning');
    window.finDownloadCSV(window._finLastReportRows, 'مالیاتی_رپورٹ.csv');
  };

  document.getElementById('btn-generate-bills')?.addEventListener('click', function () { window.finGenerateMonthlyBills(); });
  document.getElementById('btn-generate-bills-multi')?.addEventListener('click', function () { window.finGenerateMultiMonthBills(); });
  document.getElementById('fin-bill-month')?.addEventListener('change', function () { window.finRenderBillsList(); });
  document.getElementById('fin-bill-class')?.addEventListener('change', function () { window.finRenderBillsList(); });
  document.getElementById('fin-rep-period')?.addEventListener('change', function () {
    if (this.value !== 'custom' && typeof window.finApplyReportPeriod === 'function') window.finApplyReportPeriod(this.value);
  });

  var finRepFrom = document.getElementById('fin-rep-from');
  var finRepTo = document.getElementById('fin-rep-to');
  if (typeof window.finApplyReportPeriod === 'function') window.finApplyReportPeriod('month');
  else {
    if (finRepFrom && !finRepFrom.value) finRepFrom.value = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    if (finRepTo && !finRepTo.value) finRepTo.valueAsDate = new Date();
  }

  if (typeof window.emsRegisterDepartmentRefresh === 'function') {
    window.emsRegisterDepartmentRefresh('finance', function () {
      if (typeof window.emsIsFinanceModuleActive === 'function' && !window.emsIsFinanceModuleActive()) return;
      window._finClassDropdownGen = -1;
      window._finFeeCtx = null;
      finInitOptDeptFilter();
      if (typeof window.refreshFinanceData === 'function') window.refreshFinanceData(window._finActiveTab);
    });
  }

  document.getElementById('btn-void-receipt')?.addEventListener('click', function () {
    if (!window._finLastReceiptId) return;
    window.finVoidCollection(window._finLastReceiptId, window._finLastReceiptStudentId);
  });

  finInitOptDeptFilter();

