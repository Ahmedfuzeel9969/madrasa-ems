    // ================= 9. امتحانات (Exams - Final Pro Plan) =================

  function emsSaveKey(key, val, opts) {
    var options = Object.assign({ mutation: true, autoDelta: true }, opts || {});
    var p = window.emsSaveModuleData
      ? window.emsSaveModuleData(key, val, options)
      : (localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val)), Promise.resolve());
    if (typeof window.emsLogAudit === 'function') {
      return Promise.resolve(p).then(function (res) {
        window.emsLogAudit('exams', 'save', key, { storageKey: key });
        return res;
      });
    }
    return p;
  }

  function exmGetUsers() {
    var users = typeof window.emsGetUsersSync === 'function'
      ? window.emsGetUsersSync()
      : (typeof window.emsGetUsersMerged === 'function' ? window.emsGetUsersMerged() : []);
    if (typeof window.emsFilterByDepartment === 'function') {
      return window.emsFilterByDepartment(users);
    }
    return users;
  }

  // =========================================================
  // Phase B — RBAC, result lock, role helpers
  // =========================================================
  var EXM_LOCKS_KEY = 'ems_exam_locks';

  window.exmIsAdminOrOwner = function () {
    if (typeof window.isSuperAdmin === 'function' && window.isSuperAdmin()) return true;
    if (typeof window.isMadrasaAdmin === 'function' && window.isMadrasaAdmin()) return true;
    if (typeof window.emsIsTenantOwner === 'function' && window.emsIsTenantOwner()) return true;
    return false;
  };

  window.exmIsTeacherOnly = function () {
    if (window.exmIsAdminOrOwner()) return false;
    return !!(typeof window.emsIsStaffUser === 'function' && window.emsIsStaffUser());
  };

  window.exmGetCurrentTeacherName = function () {
    var staff = typeof window.emsGetStaffRecordForCurrentUser === 'function'
      ? window.emsGetStaffRecordForCurrentUser()
      : null;
    if (staff && staff.name) return String(staff.name).trim();
    if (window.CURRENT_USER_DISPLAY_NAME) return String(window.CURRENT_USER_DISPLAY_NAME).trim();
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
      var u = firebase.auth().currentUser;
      return String(u.displayName || u.email || u.uid || '').trim();
    }
    return '';
  };

  function exmTeacherNamesMatch(assigned, current) {
    if (!assigned || !current) return false;
    return String(assigned).trim().toLowerCase() === String(current).trim().toLowerCase();
  }

  function exmReadLocks() {
    try {
      return JSON.parse(localStorage.getItem(EXM_LOCKS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function exmLockStorageKey(examName, cls) {
    return String(examName || '').trim() + '||' + String(cls || '').trim();
  }

  window.exmIsExamLocked = function (examName, cls) {
    if (!examName || !cls) return false;
    var locks = exmReadLocks();
    var entry = locks[exmLockStorageKey(examName, cls)];
    return !!(entry && entry.locked);
  };

  function exmIsMarksContextLocked() {
    var examName = (document.getElementById('mrk-exam-name') || {}).value;
    var cls = (document.getElementById('mrk-class') || {}).value;
    return window.exmIsExamLocked(examName, cls);
  }

  window.exmCanEditBookColumn = function (book) {
    if (exmIsMarksContextLocked()) return false;
    if (window.exmIsAdminOrOwner()) return true;
    if (!window.exmIsTeacherOnly()) return true;
    var current = window.exmGetCurrentTeacherName();
    if (!book || !book.teacher) return false;
    return exmTeacherNamesMatch(book.teacher, current);
  };

  window.exmUpdateLockUi = function () {
    var marksExam = (document.getElementById('mrk-exam-name') || {}).value;
    var marksCls = (document.getElementById('mrk-class') || {}).value;
    var resExam = (document.getElementById('res-exam-name') || {}).value;
    var resCls = (document.getElementById('res-class') || {}).value;

    var marksLocked = window.exmIsExamLocked(marksExam, marksCls);
    var marksBadge = document.getElementById('exm-marks-lock-badge');
    if (marksBadge) marksBadge.style.display = marksLocked ? 'flex' : 'none';

    var resBadge = document.getElementById('exm-result-lock-badge');
    if (resBadge) resBadge.style.display = window.exmIsExamLocked(resExam, resCls) ? 'flex' : 'none';

    var toolbar = document.getElementById('exm-lock-toolbar');
    var toggleBtn = document.getElementById('btn-exm-lock-toggle');
    var lockMeta = document.getElementById('exm-lock-meta');
    if (toolbar) toolbar.style.display = window.exmIsAdminOrOwner() ? 'flex' : 'none';

    if (toggleBtn) {
      var resLocked = window.exmIsExamLocked(resExam, resCls);
      toggleBtn.disabled = !resExam || !resCls;
      toggleBtn.innerHTML = resLocked
        ? '<i class="fas fa-unlock"></i> نتیجہ کھولیں (Unlock)'
        : '<i class="fas fa-lock"></i> نتیجہ لاک کریں';
      toggleBtn.className = resLocked ? 'btn btn-warning' : 'btn btn-danger';
    }

    if (lockMeta) {
      var entry = exmReadLocks()[exmLockStorageKey(resExam, resCls)];
      if (entry && entry.locked) {
        var when = entry.lockedAt ? new Date(entry.lockedAt).toLocaleString('ur-PK') : '—';
        lockMeta.textContent = 'لاک: ' + (entry.lockedBy || '—') + ' | ' + when;
        lockMeta.style.display = 'block';
      } else {
        lockMeta.style.display = 'none';
      }
    }

    window.exmApplyMarksLockUi();
  };

  window.exmApplyMarksLockUi = function () {
    var locked = exmIsMarksContextLocked();
    var saveBtn = document.getElementById('btn-save-all-marks');
    var importBtn = document.getElementById('btn-import-marks');
    var frBtn = document.getElementById('btn-find-replace');
    var frMarks = document.getElementById('fr-marks');

    if (saveBtn) {
      saveBtn.disabled = locked;
      saveBtn.title = locked ? 'یہ نتیجہ لاک ہو چکا ہے' : '';
    }
    if (importBtn) importBtn.disabled = locked;
    if (frBtn) frBtn.disabled = locked;
    if (frMarks) frMarks.disabled = locked;

    document.querySelectorAll('.mark-val-input').forEach(function (inp) {
      var subject = inp.getAttribute('data-subject');
      var book = currentClassTemplateBooks.find(function (b) { return b.name === subject; });
      var canEdit = window.exmCanEditBookColumn(book);
      inp.disabled = !canEdit;
      inp.readOnly = !canEdit;
      if (!canEdit) {
        inp.title = locked ? 'یہ نتیجہ لاک ہو چکا ہے' : 'آپ اس مضمون کے مجاز استاد نہیں';
      }
    });
  };

  window.exmToggleExamLock = function () {
    if (!window.exmIsAdminOrOwner()) {
      return showToast('صرف ایڈمن نتیجہ لاک / کھول سکتا ہے', 'error');
    }
    var examName = (document.getElementById('res-exam-name') || {}).value;
    var cls = (document.getElementById('res-class') || {}).value;
    if (!examName || !cls) return showToast('امتحان اور درجہ منتخب کریں!', 'error');

    var locks = exmReadLocks();
    var key = exmLockStorageKey(examName, cls);
    if (locks[key] && locks[key].locked) {
      if (!confirm('کیا آپ واقعی اس درجے کا نتیجہ کھولنا چاہتے ہیں؟ نمبرات دوبارہ تبدیل ہو سکیں گے۔')) return;
      delete locks[key];
      emsSaveKey(EXM_LOCKS_KEY, JSON.stringify(locks));
      showToast('نتیجہ کھولا گیا — نمبرات اب تبدیل ہو سکتے ہیں', 'success');
    } else {
      if (!confirm('لاک کے بعد کوئی بھی (بشمول ایڈمن) نمبرات تبدیل نہیں کر سکے گا جب تک آپ دوبارہ نہ کھولیں۔')) return;
      locks[key] = {
        locked: true,
        lockedAt: Date.now(),
        lockedBy: window.exmGetCurrentTeacherName() || 'ایڈمن'
      };
      emsSaveKey(EXM_LOCKS_KEY, JSON.stringify(locks));
      showToast('نتیجہ کامیابی سے لاک ہو گیا', 'success');
    }
    window.exmUpdateLockUi();
    if (currentGridData.length) renderMarksGrid();
  };

    // printDiv lives in ems-utils.js (global); keep fallback if exams loads first in tests.
    if (typeof window.printDiv !== 'function') {
      window.printDiv = function (divId) {
        var el = document.getElementById(divId);
        if (!el) return;
        if (typeof window.showToast === 'function') window.showToast('پرنٹ ایریا نہیں ملا', 'error');
      };
    }

  // =========================================================
  // جدید نیویگیشن + ڈیفالٹ صفحہ + ماڈیول علیحدگی (مرحلہ 1)
  // =========================================================
  window._exmDropdownGen = -1;
  window._exmActiveTab = 'exam-win-settings';
  window._exmLazyPickersBound = false;

  window.exmEnsureLazyPickers = function () {
    if (window._exmLazyPickersBound) return;
    window._exmLazyPickersBound = true;
    var resClass = document.getElementById('res-class');
    var resStudent = document.getElementById('res-student');
    if (typeof window.emsBindLazyStudentSelect === 'function' && resClass && resStudent) {
      window.emsBindLazyStudentSelect(resStudent, resClass, { moduleActive: window.emsIsExamsModuleActive });
    }
  };

  window.switchExamTab = function (tabId, btn) {
    if (typeof window.emsIsExamsModuleActive === 'function' && !window.emsIsExamsModuleActive()) return;
    if (typeof window.emsCloseAllModals === 'function') window.emsCloseAllModals();
    document.querySelectorAll('#module-exams .exam-tab-content').forEach(function (el) { el.style.display = 'none'; });
    var panel = document.getElementById(tabId);
    if (panel) panel.style.display = 'block';
    document.querySelectorAll('#exam-ribbon-menu .reg-tab').forEach(function (b) { b.classList.remove('active-sub-tab'); });
    if (btn) btn.classList.add('active-sub-tab');
    window._exmActiveTab = tabId;
    if (typeof window.refreshExamData === 'function') window.refreshExamData(tabId);
  };

  window.emsOpenExams = function () {
    if (typeof window.emsCloseAllModals === 'function') window.emsCloseAllModals();
    var firstBtn = document.querySelector('#exam-ribbon-menu [onclick*="exam-win-settings"]');
    window.switchExamTab('exam-win-settings', firstBtn);
  };

  window.refreshExamData = function (activeTabId) {
      if (typeof window.emsIsExamsModuleActive === 'function' && !window.emsIsExamsModuleActive()) return;
      activeTabId = activeTabId || window._exmActiveTab || 'exam-win-settings';

      if (typeof window.curSyncFromLibrary === 'function') window.curSyncFromLibrary();

      var gen = typeof window.emsReadRepoCacheGen === 'function' ? window.emsReadRepoCacheGen() : 0;
      if (window._exmDropdownGen !== gen) {
          window._exmDropdownGen = gen;
          if (typeof window.emsFillClassSelects === 'function') {
              window.emsFillClassSelects('.exm-dynamic-class');
          }
          document.querySelectorAll('.exm-dynamic-student').forEach(function (select) {
              select.innerHTML = '<option value="">پہلے درجہ منتخب کریں…</option>';
          });
          document.querySelectorAll('.exm-dynamic-teacher').forEach(function (select) {
              select._emsStaffLazyLoaded = false;
              select.innerHTML = '<option value="">…</option>';
          });
      }

      window.exmEnsureLazyPickers();
      document.querySelectorAll('.exm-dynamic-teacher').forEach(function (select) {
          if (typeof window.emsBindLazyStaffSelect === 'function' && !select._emsStaffLazyLoaded) {
              window.emsBindLazyStaffSelect(select, 'teacher', {
                  moduleActive: window.emsIsExamsModuleActive,
                  valueField: 'name',
                  placeholder: 'استاد منتخب کریں...'
              });
          }
      });

      if (activeTabId === 'exam-win-settings' || activeTabId === 'exam-win-marks' || activeTabId === 'exam-win-schedule') {
          renderSettingsData();
          renderQuickAccessTabs();
      }
      if (typeof window.examUpdateTplScopePreview === 'function') window.examUpdateTplScopePreview();
      if (typeof window.exmUpdateLockUi === 'function') window.exmUpdateLockUi();
  };

  /** نصاب شعبے سے امتحانی حصہ — خودکار لنک */
  window.examResolveCurTerm = function (examName) {
      var n = String(examName || '');
      if (/پہلی|اول|first|half\s*1|\bh1\b/i.test(n)) return 'half1';
      if (/دوسری|second|half\s*2|\bh2\b/i.test(n)) return 'half2';
      if (/ششما/i.test(n) && /دوس/i.test(n)) return 'half2';
      if (/ششما/i.test(n)) return 'half1';
      if (/سالان|annual|\byear\b/i.test(n)) return 'annual';
      return 'annual';
  };

  window.examGetCurScopeForBook = function (bookName, examName) {
      if (typeof window.curGetExamScope !== 'function') return null;
      return window.curGetExamScope(bookName, window.examResolveCurTerm(examName));
  };

  window.examFormatCurScope = function (scopeObj) {
      if (typeof window.curFormatScopeText === 'function') return window.curFormatScopeText(scopeObj);
      if (!scopeObj || !scopeObj.scope) return '—';
      var sc = scopeObj.scope;
      if (scopeObj.examNote) return scopeObj.examNote;
      if (!sc.toPage) return '—';
      return 'ص ' + sc.fromPage + '–' + sc.toPage + ' / س ' + sc.fromLine + '–' + sc.toLine;
  };

  window.examUpdateTplScopePreview = function () {
      var bookSel = document.getElementById('tpl-book-select');
      var examSel = document.getElementById('sch-exam-name');
      var book = bookSel ? bookSel.value : '';
      var examName = examSel ? examSel.value : 'سالانہ امتحان';
      var box = document.getElementById('tpl-cur-scope-preview');
      var txt = document.getElementById('tpl-cur-scope-text');
      if (!box || !txt) return;
      if (!book) { box.style.display = 'none'; return; }
      box.style.display = 'block';
      var scopeObj = window.examGetCurScopeForBook(book, examName);
      if (scopeObj && scopeObj.scope && scopeObj.scope.toPage) {
          txt.textContent = window.examFormatCurScope(scopeObj);
      } else {
          txt.textContent = 'نصاب میں درج نہیں — شعبۂ نصاب میں منصوبہ بندی کریں';
      }
  };

  document.getElementById('tpl-book-select')?.addEventListener('change', window.examUpdateTplScopePreview);
  document.getElementById('sch-exam-name')?.addEventListener('change', window.examUpdateTplScopePreview);

  function renderSettingsData() {

      let examTypes = JSON.parse(localStorage.getItem('ems_exam_types')) || ['ماہانہ امتحان', 'ششماہی امتحان', 'سالانہ امتحان'];

      emsSaveKey('ems_exam_types', JSON.stringify(examTypes));

      

      const typeTbody = document.querySelector('#table-exam-names tbody');

      if(typeTbody) {

          typeTbody.innerHTML = '';

          examTypes.forEach(type => {

              typeTbody.innerHTML += `<tr><td>${type}</td><td><button class="icon-btn edit" onclick="editExamType('${type}')"><i class="fas fa-edit"></i></button> <button class="icon-btn delete" onclick="deleteExamType('${type}')"><i class="fas fa-trash"></i></button></td></tr>`;

          });

      }

      document.querySelectorAll('.exm-dynamic-examnames').forEach(sel => {

          let v = sel.value; sel.innerHTML = ''; examTypes.forEach(t => sel.innerHTML += `<option value="${t}">${t}</option>`); sel.value = v;

      });



      let libBooks = JSON.parse(localStorage.getItem('ems_library_books')) || [];

      const libTbody = document.querySelector('#table-lib-books tbody');

      if(libTbody) {

          libTbody.innerHTML = '';

          libBooks.forEach(book => {

              libTbody.innerHTML += `<tr><td>${book}</td><td><button class="icon-btn edit" onclick="editLibBook('${book}')"><i class="fas fa-edit"></i></button> <button class="icon-btn delete" onclick="deleteLibBook('${book}')"><i class="fas fa-trash"></i></button></td></tr>`;

          });

      }

      document.querySelectorAll('.exm-dynamic-lib').forEach(sel => {

          let v = sel.value; sel.innerHTML = '<option value="">لائبریری سے کتابیں...</option>'; libBooks.forEach(b => sel.innerHTML += `<option value="${b}">${b}</option>`); sel.value = v;

      });

  }



  document.getElementById('btn-add-exam-name')?.addEventListener('click', () => {

      let name = document.getElementById('set-exam-name').value.trim();

      if(!name) return;

      let types = JSON.parse(localStorage.getItem('ems_exam_types')) || [];

      if(!types.includes(name)) { types.push(name); emsSaveKey('ems_exam_types', JSON.stringify(types)); document.getElementById('set-exam-name').value = ''; refreshExamData(); }

  });

  window.deleteExamType = function(name) { if(confirm("حذف کریں؟")) { let types = JSON.parse(localStorage.getItem('ems_exam_types')); emsSaveKey('ems_exam_types', JSON.stringify(types.filter(t => t !== name))); refreshExamData(); } };

  window.editExamType = function(oldName) { let newName = prompt("نیا نام لکھیں:", oldName); if(newName && newName.trim() !== '') { let types = JSON.parse(localStorage.getItem('ems_exam_types')); types[types.indexOf(oldName)] = newName.trim(); emsSaveKey('ems_exam_types', JSON.stringify(types)); refreshExamData(); } };



  document.getElementById('btn-add-lib-book')?.addEventListener('click', () => {

      let name = document.getElementById('set-lib-book').value.trim();

      if(!name) return;

      let books = JSON.parse(localStorage.getItem('ems_library_books')) || [];

      if(!books.includes(name)) { books.push(name); emsSaveKey('ems_library_books', JSON.stringify(books)); document.getElementById('set-lib-book').value = ''; refreshExamData(); }

  });

  window.deleteLibBook = function(name) { if(confirm("حذف کریں؟")) { let books = JSON.parse(localStorage.getItem('ems_library_books')); emsSaveKey('ems_library_books', JSON.stringify(books.filter(b => b !== name))); refreshExamData(); } };

  window.editLibBook = function(oldName) { let newName = prompt("نیا نام لکھیں:", oldName); if(newName && newName.trim() !== '') { let books = JSON.parse(localStorage.getItem('ems_library_books')); books[books.indexOf(oldName)] = newName.trim(); emsSaveKey('ems_library_books', JSON.stringify(books)); refreshExamData(); } };



  function renderQuickAccessTabs() {

      const tabsContainer = document.getElementById('quick-access-tabs');

      if(!tabsContainer) return;

      const templates = JSON.parse(localStorage.getItem('ems_exam_templates')) || [];

      tabsContainer.innerHTML = '';

      templates.forEach(tpl => { tabsContainer.innerHTML += `<button class="btn btn-outline" style="padding:6px 12px; border-radius:20px;" onclick="loadTemplateForClass('${tpl.class}')">${tpl.class}</button>`; });

  }



  window.loadTemplateForClass = function(cls) { document.getElementById('tpl-class-select').value = cls; renderTemplateTable(cls); };

  document.getElementById('tpl-class-select')?.addEventListener('change', function() { renderTemplateTable(this.value); });



  document.getElementById('btn-add-tpl-book')?.addEventListener('click', () => {

      const cls = document.getElementById('tpl-class-select').value;

      const bookName = document.getElementById('tpl-book-select').value;

      const marks = parseInt(document.getElementById('tpl-book-marks').value) || 100;

      const date = document.getElementById('tpl-book-date').value;

      const time = document.getElementById('tpl-book-time').value.trim();

      const room = (document.getElementById('tpl-book-room')?.value || '').trim();

      const invigilator = (document.getElementById('tpl-book-invig')?.value || '').trim();

      const teacher = (document.getElementById('tpl-book-teacher')?.value || '').trim();

      const paperType = document.getElementById('tpl-book-type')?.value || 'تحریری';



      if(!cls || !bookName) return showToast("درجہ اور کتاب کا انتخاب لازمی ہے!", "error");



      let templates = JSON.parse(localStorage.getItem('ems_exam_templates')) || [];

      let classTpl = templates.find(t => t.class === cls);

      if(!classTpl) { classTpl = { class: cls, books: [], customHeader: '', fontSize: 16, textAlign: 'right', showBorder: true }; templates.push(classTpl); }

      

      if(!classTpl.books.find(b => b.name === bookName)) {

          var curScope = window.examFormatCurScope(window.examGetCurScopeForBook(bookName, 'سالانہ امتحان'));

          classTpl.books.push({ id: generateID('B'), name: bookName, marks: marks, date: date, time: time, room: room, invigilator: invigilator, teacher: teacher, paperType: paperType, curScope: curScope });

          emsSaveKey('ems_exam_templates', JSON.stringify(templates));

          showToast("شیٹ میں کتاب شامل کر دی گئی!", "success");

          renderTemplateTable(cls); renderQuickAccessTabs();

      } else { showToast("یہ کتاب اس درجے کی شیٹ میں پہلے سے ہے!", "warning"); }

  });



  window.renderTemplateTable = function(cls) {

      const tbody = document.querySelector('#tpl-books-table tbody');

      if(!tbody) return;

      let templates = JSON.parse(localStorage.getItem('ems_exam_templates')) || [];

      let classTpl = templates.find(t => t.class === cls);

      

      tbody.innerHTML = '';

      if(!classTpl || classTpl.books.length === 0) { tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;">اس درجے کی شیٹ میں کوئی کتاب نہیں</td></tr>'; return; }

      var examName = (document.getElementById('sch-exam-name') || {}).value || 'سالانہ امتحان';

      classTpl.books.forEach(book => {

          var scopeTxt = window.examFormatCurScope(window.examGetCurScopeForBook(book.name, examName)) || book.curScope || '—';

          tbody.innerHTML += `<tr><td><strong>${classTpl.class}</strong></td><td>${book.name}</td><td style="font-size:12px;color:#5b21b6;">${scopeTxt}</td><td>${book.marks}</td><td>${book.date || '-'}</td><td>${book.time || '-'}</td><td>${book.room || '-'}</td><td>${book.invigilator || '-'}</td><td>${book.teacher || '-'}</td><td>${book.paperType || 'تحریری'}</td>

                              <td><button class="icon-btn delete" onclick="deleteTplBook('${classTpl.class}', '${book.id}')"><i class="fas fa-trash"></i></button></td></tr>`;

      });

  };



  window.deleteTplBook = function(cls, bookId) {

      if(confirm("کیا آپ واقعی شیٹ سے یہ کتاب ہٹانا چاہتے ہیں؟")) {

          let templates = JSON.parse(localStorage.getItem('ems_exam_templates')) || [];

          let classTpl = templates.find(t => t.class === cls);

          if(classTpl) { classTpl.books = classTpl.books.filter(b => b.id !== bookId); emsSaveKey('ems_exam_templates', JSON.stringify(templates)); renderTemplateTable(cls); }

      }

  };



  let activeSchClass = "";
  const SCH_DAYS_URDU = ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'];

  window.examBuildScheduleRows = function (aggregate, cls, examName) {
      let templates = JSON.parse(localStorage.getItem('ems_exam_templates')) || [];
      let rows = [];
      let src = aggregate ? templates : templates.filter(t => t.class === cls);
      examName = examName || (document.getElementById('sch-exam-name') || {}).value || 'سالانہ امتحان';
      src.forEach(tpl => {
          (tpl.books || []).forEach(book => {
              var scopeTxt = window.examFormatCurScope(window.examGetCurScopeForBook(book.name, examName)) || book.curScope || '—';
              rows.push({ cls: tpl.class, name: book.name, marks: book.marks, date: book.date || '', time: book.time || '', room: book.room || '', invigilator: book.invigilator || '', teacher: book.teacher || '', paperType: book.paperType || 'تحریری', curScope: scopeTxt });
          });
      });
      // تاریخ کے لحاظ سے ترتیب (خالی تاریخ آخر میں)
      rows.sort((a, b) => {
          if (!a.date) return 1; if (!b.date) return -1;
          return a.date.localeCompare(b.date);
      });
      return rows;
  };

  document.getElementById('btn-generate-schedule')?.addEventListener('click', () => {

      const examName = document.getElementById('sch-exam-name').value;
      const aggregate = document.getElementById('sch-aggregate')?.checked;
      const cls = document.getElementById('sch-class-select').value;
      activeSchClass = aggregate ? '' : cls;

      if(!aggregate && !cls) return showToast("درجہ منتخب کریں یا 'اجتماعی نقشہ' پر نشان لگائیں!", "error");

      let rows = window.examBuildScheduleRows(aggregate, cls, examName);
      if(rows.length === 0) return showToast("ماسٹر شیٹ میں کوئی کتاب نہیں ملی!", "error");

      let templates = JSON.parse(localStorage.getItem('ems_exam_templates')) || [];
      let classTpl = templates.find(t => t.class === cls) || { customHeader: '', fontSize: 16, textAlign: 'right', showBorder: true };

      document.getElementById('sch-format-toolbar').style.display = 'flex';
      document.getElementById('sch-printable-area').style.display = 'block';

      // مدرسہ برانڈنگ ہیڈر/فوٹر خودکار
      var bh = document.getElementById('sch-brand-header');
      if (bh && typeof window.attBrandHeaderHTML === 'function') bh.innerHTML = window.attBrandHeaderHTML();
      var bf = document.getElementById('sch-brand-footer');
      if (bf && typeof window.attSignFooterHTML === 'function') bf.innerHTML = window.attSignFooterHTML();

      document.getElementById('sch-custom-header').value = classTpl.customHeader || '';
      document.getElementById('sch-print-header').innerText = classTpl.customHeader || '';
      document.getElementById('sch-border-toggle').checked = classTpl.showBorder !== false;

      const table = document.getElementById('sch-print-table');
      table.style.textAlign = classTpl.textAlign || 'right';
      table.style.fontSize = (classTpl.fontSize || 16) + 'px';
      table.style.fontFamily = classTpl.fontFamily || "'Noto Nastaliq Urdu', serif";
      table.style.color = classTpl.textColor || '#1e293b';
      table.border = classTpl.showBorder !== false ? "1" : "0";
      var thead = document.getElementById('sch-print-thead');
      if (thead) thead.style.background = classTpl.headColor || '#eef2f6';
      if (document.getElementById('sch-font-family')) document.getElementById('sch-font-family').value = classTpl.fontFamily || "'Noto Nastaliq Urdu', serif";
      if (document.getElementById('sch-head-color')) document.getElementById('sch-head-color').value = classTpl.headColor || '#eef2f6';
      if (document.getElementById('sch-text-color')) document.getElementById('sch-text-color').value = classTpl.textColor || '#1e293b';

      document.getElementById('sch-print-title').innerText = aggregate ? `${examName} — اجتماعی نقشہ (تمام درجات)` : `${examName} - ${cls}`;

      // ہیڈر کالم (اجتماعی صورت میں درجہ کالم شامل)
      if (thead) {
          thead.innerHTML = '<tr>' + (aggregate ? '<th>درجہ</th>' : '') + '<th>تاریخ</th><th>دن</th><th>وقت</th><th>کتاب / پرچہ</th><th>نصاب حصہ</th><th>استاد</th><th>کمرہ</th><th>نگران</th><th>نوعیت</th></tr>';
      }

      const tbody = document.getElementById('sch-print-tbody');
      tbody.innerHTML = '';
      rows.forEach(r => {
          let dayName = "-";
          if(r.date) { let d = new Date(r.date); dayName = SCH_DAYS_URDU[d.getDay()]; }
          tbody.innerHTML += '<tr>' + (aggregate ? `<td><strong>${r.cls}</strong></td>` : '') +
              `<td>${r.date || 'طے نہیں'}</td><td>${dayName}</td><td>${r.time || '-'}</td><td><strong>${r.name}</strong></td><td style="font-size:12px;color:#5b21b6;">${r.curScope || '—'}</td><td>${r.teacher || '-'}</td><td>${r.room || '-'}</td><td>${r.invigilator || '-'}</td><td>${r.paperType || 'تحریری'}</td></tr>`;
      });
      showToast("نقشہ تیار ہے! آپ فارمیٹنگ و رنگ کے ٹولز استعمال کر سکتے ہیں۔", "success");

  });

  window.changeSchFormat = function(type, val) {
      const table = document.getElementById('sch-print-table');
      const thead = document.getElementById('sch-print-thead');
      if(type === 'align') table.style.textAlign = val;
      if(type === 'size') { let curr = parseInt(table.style.fontSize) || 16; table.style.fontSize = (curr + (val*2)) + 'px'; }
      if(type === 'border') table.border = val ? "1" : "0";
      if(type === 'font') table.style.fontFamily = val;
      if(type === 'headcolor' && thead) thead.style.background = val;
      if(type === 'textcolor') table.style.color = val;
  };

  // امتحانی نقشہ → Excel/CSV برآمد
  window.examExportSchedule = function () {
      const aggregate = document.getElementById('sch-aggregate')?.checked;
      const cls = document.getElementById('sch-class-select').value;
      const examName = document.getElementById('sch-exam-name').value || 'امتحان';
      let rows = window.examBuildScheduleRows(aggregate, cls, examName);
      if (!rows.length) return showToast("پہلے نقشہ بنائیں!", "error");
      let header = (aggregate ? ['درجہ'] : []).concat(['تاریخ', 'دن', 'وقت', 'کتاب', 'نصاب حصہ', 'استاد', 'کمرہ', 'نگران', 'نوعیت']);
      let data = rows.map(r => {
          let day = r.date ? SCH_DAYS_URDU[new Date(r.date).getDay()] : '-';
          return (aggregate ? [r.cls] : []).concat([r.date || '', day, r.time || '', r.name, r.curScope || '—', r.teacher || '', r.room || '', r.invigilator || '', r.paperType || '']);
      });
      window.examDownloadCSV([header].concat(data), `نقشہ_${examName}.csv`);
  };



  document.getElementById('sch-custom-header')?.addEventListener('input', function() { document.getElementById('sch-print-header').innerText = this.value; });



  window.saveSchTemplate = function() {

      if(!activeSchClass) return;

      let templates = JSON.parse(localStorage.getItem('ems_exam_templates')) || [];

      let classTpl = templates.find(t => t.class === activeSchClass);

      if(classTpl) {

          const table = document.getElementById('sch-print-table');
          classTpl.customHeader = document.getElementById('sch-custom-header').value;
          classTpl.textAlign = table.style.textAlign;
          classTpl.fontSize = parseInt(table.style.fontSize);
          classTpl.showBorder = document.getElementById('sch-border-toggle').checked;
          classTpl.fontFamily = document.getElementById('sch-font-family')?.value || table.style.fontFamily;
          classTpl.headColor = document.getElementById('sch-head-color')?.value || '#eef2f6';
          classTpl.textColor = document.getElementById('sch-text-color')?.value || '#1e293b';
          emsSaveKey('ems_exam_templates', JSON.stringify(templates));
          showToast("فارمیٹنگ، رنگ اور ہیڈر ماسٹر شیٹ میں محفوظ ہو گئے!", "success");

      } else {
          showToast("اجتماعی نقشے کی سیٹنگ محفوظ نہیں ہوتی — درجہ منتخب کر کے محفوظ کریں۔", "warning");
      }

  };

  // =========================================================
  // CSV/Excel برآمد کا مشترکہ helper (BOM کے ساتھ تاکہ اردو درست کھلے)
  // =========================================================
  window.examDownloadCSV = function (rows, filename) {
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
      a.href = url; a.download = filename || 'export.csv';
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
      if (typeof showToast === 'function') showToast('فائل برآمد ہو گئی: ' + (filename || 'export.csv'), 'success');
  };

  // =========================================================
  // Phase A: marks math — cap, absent (AB), %, grade, ranking
  // =========================================================
  var EXM_PASS_PERCENT = 40;

  function exmIsAbsentMark(val) {
      if (val == null) return false;
      if (val === 'AB') return true;
      var s = String(val).trim();
      if (s === '') return false;
      return /^ab$/i.test(s) || s === 'غ' || /غیر\s*حاضر/i.test(s);
  }

  function exmDisplayMark(val) {
      if (val == null || val === '') return '-';
      if (exmIsAbsentMark(val)) return 'غیر حاضر';
      return val;
  }

  function exmGetBookMax(bookName) {
      var b = currentClassTemplateBooks.find(function (x) { return x.name === bookName; });
      return b ? (Number(b.marks) || 0) : 100;
  }

  /** Normalize raw cell → number (clamped) or 'AB'. Empty → 'AB'. */
  function exmNormalizeMarkRaw(raw, maxMarks) {
      if (raw == null) return 'AB';
      var s = String(raw).trim();
      if (s === '') return 'AB';
      if (/^ab$/i.test(s) || s === 'غ' || /غیر\s*حاضر/i.test(s)) return 'AB';
      var n = Number(s);
      if (isNaN(n)) return 'AB';
      if (n < 0) n = 0;
      var max = Number(maxMarks);
      if (isNaN(max) || max <= 0) return 0;
      if (n > max) n = max;
      return n;
  }

  function exmSumMarks(marks) {
      var sum = 0;
      if (!marks) return 0;
      Object.keys(marks).forEach(function (k) {
          var v = marks[k];
          if (exmIsAbsentMark(v)) return;
          var n = Number(v);
          if (!isNaN(n)) sum += n;
      });
      return sum;
  }

  function exmCalcPercentage(totalObtained, totalPossible) {
      var obt = Number(totalObtained) || 0;
      var poss = Number(totalPossible) || 0;
      if (poss <= 0) return 0;
      var pct = (obt / poss) * 100;
      return isNaN(pct) || !isFinite(pct) ? 0 : pct;
  }

  function exmGradeFromPercentage(percentage) {
      var pct = Number(percentage) || 0;
      if (pct >= 90) return 'ممتاز مرتفع';
      if (pct >= 80) return 'ممتاز';
      if (pct >= 60) return 'جید جدا';
      if (pct >= 50) return 'جید';
      if (pct >= EXM_PASS_PERCENT) return 'مقبول';
      return 'راسب';
  }

  function exmIsPassingResult(res) {
      if (!res) return false;
      if (String(res.grade || '').includes('راسب')) return false;
      var pct = parseFloat(res.percentage);
      if (isNaN(pct)) pct = exmCalcPercentage(res.totalObtained, res.grandTotal);
      return pct >= EXM_PASS_PERCENT;
  }

  function exmAssignPositions(classResults) {
      var posMap = ['اول', 'دوم', 'سوم', 'چہارم', 'پنجم', 'ششم', 'ہفتم', 'ہشتم', 'نہم', 'دہم'];
      var passing = classResults.filter(exmIsPassingResult);
      var uniqueScores = [];
      passing.forEach(function (r) {
          var t = Number(r.totalObtained) || 0;
          if (uniqueScores.indexOf(t) < 0) uniqueScores.push(t);
      });
      uniqueScores.sort(function (a, b) { return b - a; });
      classResults.forEach(function (res) {
          if (!exmIsPassingResult(res)) {
              res.positionStr = 'راسب';
              return;
          }
          var rankNum = uniqueScores.indexOf(Number(res.totalObtained) || 0);
          res.positionStr = rankNum < 10 ? posMap[rankNum] : String(rankNum + 1);
      });
  }

  /** Branded کشف النتیجہ HTML — shared with parent portal print */
  window.exmBuildStudentCardHtml = function (res, examName) {
      if (!res) return '<p style="text-align:center;color:red;">نتيجہ دستیاب نہیں</p>';
      examName = examName || res.examName || 'امتحان';
      var templates = JSON.parse(localStorage.getItem('ems_exam_templates') || '[]');
      var tplBooks = (templates.find(function (t) { return t.class === res.class; }) || {}).books || [];
      var brandHeader = (typeof window.attBrandHeaderHTML === 'function') ? window.attBrandHeaderHTML() : '';
      var brandFooter = (typeof window.attSignFooterHTML === 'function') ? window.attSignFooterHTML() : '';
      var gradeColor = String(res.grade || '').includes('راسب') ? 'red' : 'green';
      var photoHtml = res.studentPhoto
          ? '<img src="' + res.studentPhoto + '" style="width:90px; height:90px; border-radius:8px; border:2px solid #ccc; object-fit:cover;">'
          : '<i class="fas fa-user-circle fa-4x" style="color:#bdc3c7;"></i>';
      var positionStr = res.positionStr || '—';
      var html = '<div style="border: 4px double #2c3e50; padding: 30px; text-align: right; max-width: 800px; margin: 0 auto; background: #fffaf0; position:relative;">' +
          brandHeader +
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 20px;">' +
          '<div>' + photoHtml + '</div>' +
          '<div style="text-align:center;"><h1 style="color:#2c3e50; font-family:\'Noto Nastaliq Urdu\', serif; font-size:32px; margin:0;">کشف النتیجہ</h1>' +
          '<h3 style="color:#7f8c8d; margin-top:5px;">' + examName + '</h3></div>' +
          '<div style="text-align:center; border:1px solid #cbd5e1; border-radius:8px; padding:8px 12px; background:#fff;">' +
          '<div style="font-size:11px; color:#94a3b8;">رول نمبر</div>' +
          '<div style="font-weight:bold; font-size:18px; color:#2c3e50;">' + (res.studentId || '') + '</div></div></div>' +
          '<div style="display:flex; justify-content:space-between; border-top:2px solid #2c3e50; border-bottom:2px solid #2c3e50; padding:10px 0; font-size:18px; font-weight:bold;">' +
          '<div>نام: <span style="color:var(--accent);">' + (res.studentName || '') + '</span></div>' +
          '<div>درجہ: <span style="color:var(--accent);">' + (res.class || '') + '</span></div>' +
          '<div>رول نمبر: <span style="color:var(--accent);">' + (res.studentId || '') + '</span></div></div>' +
          '<table style="width:100%; border-collapse: collapse; margin-top:20px; text-align:right;" border="1">' +
          '<thead style="background:#2c3e50; color:white;"><tr><th style="padding:8px;">مضمون / کتاب</th>' +
          '<th style="text-align:center; padding:8px;">کل نمبر</th><th style="text-align:center; padding:8px;">حاصل کردہ</th></tr></thead><tbody>';
      tplBooks.forEach(function (book) {
          var bookTotal = book.marks || 100;
          var obtained = exmDisplayMark(res.marks && res.marks[book.name]);
          html += '<tr><td style="padding:8px;"><strong>' + book.name + '</strong></td>' +
              '<td style="text-align:center; padding:8px;">' + bookTotal + '</td>' +
              '<td style="text-align:center; font-size:18px; padding:8px; font-weight:bold;">' + obtained + '</td></tr>';
      });
      if (!tplBooks.length && res.marks) {
          Object.keys(res.marks).forEach(function (book) {
              html += '<tr><td style="padding:8px;"><strong>' + book + '</strong></td>' +
                  '<td style="text-align:center; padding:8px;">100</td>' +
                  '<td style="text-align:center; font-size:18px; padding:8px; font-weight:bold;">' +
                  exmDisplayMark(res.marks[book]) + '</td></tr>';
          });
      }
      html += '</tbody></table>' +
          '<div style="display:flex; justify-content:space-around; margin-top:30px; background:#eef2f6; padding:15px; border:1px solid #2c3e50; border-radius:8px;">' +
          '<div style="text-align:center;"><strong>کل نمبرات</strong><br><span style="font-size:24px;">' + (res.grandTotal || '—') + '</span></div>' +
          '<div style="text-align:center;"><strong>حاصل کردہ</strong><br><span style="font-size:24px; color:var(--accent); font-weight:bold;">' + (res.totalObtained || '—') + '</span></div>' +
          '<div style="text-align:center;"><strong>فیصد</strong><br><span style="font-size:24px;">' + (res.percentage != null ? res.percentage : '—') + '%</span></div>' +
          '<div style="text-align:center;"><strong>درجہ (گریڈ)</strong><br><span style="font-size:22px; color:' + gradeColor + '; font-weight:bold;">' + (res.grade || '—') + '</span></div>' +
          '<div style="text-align:center;"><strong>پوزیشن</strong><br><span style="font-size:26px; color:var(--warning); font-weight:bold;">' + positionStr + '</span></div>' +
          '</div>' + brandFooter + '</div>';
      return html;
  };

  window.exmPrintStudentCard = function (res, examName, targetId) {
      targetId = targetId || 'pp-result-print-area';
      var area = document.getElementById(targetId) || document.getElementById('result-printable-area');
      if (!area) return false;
      area.innerHTML = window.exmBuildStudentCardHtml(res, examName);
      area.style.display = 'block';
      if (typeof window.printDiv === 'function') {
          window.printDiv(area.id);
      } else {
          window.print();
      }
      return true;
  };

  function exmNormalizeRowMarks(marks) {
      var out = {};
      currentClassTemplateBooks.forEach(function (b) {
          out[b.name] = exmNormalizeMarkRaw(marks && marks[b.name], b.marks);
      });
      return out;
  }

  function exmMergeMarksForSave(rowMarks, existingMarks) {
      var out = {};
      existingMarks = existingMarks || {};
      currentClassTemplateBooks.forEach(function (b) {
          if (window.exmCanEditBookColumn(b)) {
              out[b.name] = exmNormalizeMarkRaw(rowMarks && rowMarks[b.name], b.marks);
          } else if (existingMarks[b.name] !== undefined) {
              out[b.name] = existingMarks[b.name];
          } else if (!window.exmIsTeacherOnly()) {
              out[b.name] = exmNormalizeMarkRaw(rowMarks && rowMarks[b.name], b.marks);
          }
      });
      return out;
  }

  function exmMarkSortValue(v) {
      if (exmIsAbsentMark(v)) return -1;
      return Number(v) || 0;
  }

  let currentGridData = []; 

  let currentTotalPossibleMarks = 0;

  let currentClassTemplateBooks = [];

  

  document.getElementById('btn-generate-mark-sheet')?.addEventListener('click', () => {

      const examName = document.getElementById('mrk-exam-name').value;

      const cls = document.getElementById('mrk-class').value;



      if(!cls) return showToast("درجہ منتخب کرنا لازمی ہے!", "error");



      let templates = JSON.parse(localStorage.getItem('ems_exam_templates')) || [];

      let classTpl = templates.find(t => t.class === cls);

      if(!classTpl || classTpl.books.length === 0) return showToast("اس درجے کی ماسٹر شیٹ میں کوئی کتاب نہیں ہے۔", "error");



      currentClassTemplateBooks = classTpl.books;

      const users = exmGetUsers();

      const students = users.filter(u => u.type === 'student' && u.class === cls);



      if(students.length === 0) return showToast("اس درجے میں کوئی طالب علم رجسٹرڈ نہیں!", "error");



      const theadTr = document.getElementById('mrk-entry-headers');

      

      let headerHTML = '<th>طالب علم کا نام / ID</th>';

      currentTotalPossibleMarks = 0;

      

      const frBookSelect = document.getElementById('fr-book');

      const sortBookSelect = document.getElementById('mrk-sort-book');

      frBookSelect.innerHTML = '<option value="">کتاب منتخب کریں...</option>';

      sortBookSelect.innerHTML = '<option value="">کتاب منتخب کریں...</option>';



      classTpl.books.forEach(b => { 

          headerHTML += `<th>${b.name} <br><small>(${b.marks})</small></th>`; 

          currentTotalPossibleMarks += b.marks;

          frBookSelect.innerHTML += `<option value="${b.name}">${b.name}</option>`;

          sortBookSelect.innerHTML += `<option value="${b.name}">${b.name}</option>`;

      });

      headerHTML += '<th>کل نمبر</th><th>حاصل کردہ</th>';

      theadTr.innerHTML = headerHTML;



      const dbMarks = JSON.parse(localStorage.getItem(DB.exams)) || [];

      const frStudentSelect = document.getElementById('fr-student');

      frStudentSelect.innerHTML = '<option value="">طالب علم تلاش کریں...</option>';



      currentGridData = students.map(std => {

          let existingRecord = dbMarks.find(m => m.examName === examName && m.class === cls && m.studentId === std.id);

          frStudentSelect.innerHTML += `<option value="${std.id}">${std.name} (${std.id})</option>`;

          return {

              student: std,

              marks: existingRecord ? (existingRecord.marks || {}) : {},

              totalObtained: existingRecord ? exmSumMarks(existingRecord.marks || {}) : 0,

          };

      });



      document.getElementById('mrk-filters-area').style.display = 'block';

      document.getElementById('btn-save-all-marks').style.display = 'inline-flex';
      if (document.getElementById('btn-export-marks')) document.getElementById('btn-export-marks').style.display = 'inline-flex';
      if (document.getElementById('btn-import-marks')) document.getElementById('btn-import-marks').style.display = 'inline-flex';

      

      currentGridData.sort((a, b) => a.student.id.localeCompare(b.student.id));

      renderMarksGrid(); 

      if (typeof window.exmUpdateLockUi === 'function') window.exmUpdateLockUi();

      showToast("ایکسل گرڈ تیار ہے!", "success");

  });



  function renderMarksGrid() {

      const tbody = document.getElementById('mrk-entry-tbody');
      if (!tbody) return;
      const scrollEl = tbody.closest('.table-responsive');

      if (!currentGridData.length) {
          if (typeof window.emsVirtualTableDestroy === 'function') window.emsVirtualTableDestroy('mrk-entry');
          tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">کوئی طالب علم نہیں</td></tr>';
          return;
      }

      function bindMarkInputs(tr, index) {
          tr.querySelectorAll('.mark-val-input').forEach(function (input) {
              function syncRowFromInputs() {
                  if (input.disabled) return;
                  tr.querySelectorAll('.mark-val-input').forEach(function (inp) {
                      if (inp.disabled) return;
                      var subject = inp.getAttribute('data-subject');
                      var max = exmGetBookMax(subject);
                      var normalized = exmNormalizeMarkRaw(inp.value, max);
                      currentGridData[index].marks[subject] = normalized;
                      if (normalized === 'AB') {
                          inp.value = String(inp.value).trim() === '' ? '' : 'AB';
                      } else if (String(normalized) !== String(inp.value).trim()) {
                          inp.value = normalized;
                      }
                  });
                  currentGridData[index].totalObtained = exmSumMarks(currentGridData[index].marks);
                  var totEl = tr.querySelector('.row-obtained-total');
                  if (totEl) totEl.innerText = currentGridData[index].totalObtained;
              }
              input.addEventListener('input', syncRowFromInputs);
              input.addEventListener('blur', syncRowFromInputs);
          });
      }

      function renderMarkRow(index, row) {
          var tr = document.createElement('tr');
          tr.className = 'mark-entry-row';
          tr.setAttribute('data-index', index);
          tr.setAttribute('data-std-id', row.student.id);
          var trHTML = '<td><strong>' + row.student.name + '</strong> <br><small>' + row.student.id + '</small></td>';
          currentClassTemplateBooks.forEach(function (b) {
              var val = row.marks[b.name];
              var displayVal = '';
              if (val !== undefined && val !== null) {
                  displayVal = exmIsAbsentMark(val) ? 'AB' : val;
              }
              var canEdit = window.exmCanEditBookColumn(b);
              var lockHint = exmIsMarksContextLocked() ? 'یہ نتیجہ لاک ہو چکا ہے' : 'آپ اس مضمون کے مجاز استاد نہیں';
              var disAttr = canEdit ? '' : ' disabled readonly';
              var titleAttr = canEdit ? 'خالی، AB، یا غ = غیر حاضر' : lockHint;
              trHTML += '<td><input type="text" class="input-control mark-val-input" data-subject="' + b.name + '" data-max="' + b.marks + '" value="' + displayVal + '" placeholder="AB" title="' + titleAttr + '"' + disAttr + ' style="width: 70px; text-align:center;"></td>';
          });
          trHTML += '<td style="font-weight:bold;">' + currentTotalPossibleMarks + '</td>' +
              '<td class="row-obtained-total" style="font-weight:bold; color:var(--accent); font-size:16px;">' + row.totalObtained + '</td>';
          tr.innerHTML = trHTML;
          bindMarkInputs(tr, index);
          return tr;
      }

      if (scrollEl && typeof window.emsVirtualTableMount === 'function') {
          scrollEl.style.maxHeight = scrollEl.style.maxHeight || '58vh';
          scrollEl.style.overflowY = 'auto';
          window.emsVirtualTableMount('mrk-entry', {
              scrollEl: scrollEl,
              tbody: tbody,
              rowHeight: 52,
              getData: function () { return currentGridData; },
              renderRow: function (i, row) { return renderMarkRow(i, row); },
              emptyHtml: '<tr><td colspan="3" style="text-align:center;">کوئی طالب علم نہیں</td></tr>'
          });
          if (typeof window.exmApplyMarksLockUi === 'function') window.exmApplyMarksLockUi();
          return;
      }

      tbody.innerHTML = '';
      currentGridData.forEach(function (row, index) {
          tbody.appendChild(renderMarkRow(index, row));
      });
      if (typeof window.exmApplyMarksLockUi === 'function') window.exmApplyMarksLockUi();
  }



  document.getElementById('btn-find-replace')?.addEventListener('click', () => {

      const stdId = document.getElementById('fr-student').value;

      const bookName = document.getElementById('fr-book').value;

      const newMarks = document.getElementById('fr-marks').value;



      if(!stdId || !bookName || newMarks === '') return showToast("تمام خانے پُر کریں!", "error");

      if (exmIsMarksContextLocked()) return showToast("یہ نتیجہ لاک ہو چکا ہے — ترمیم ممنوع", "error");

      var bookTpl = currentClassTemplateBooks.find(function (b) { return b.name === bookName; });
      if (!window.exmCanEditBookColumn(bookTpl)) return showToast("آپ اس مضمون کے نمبرات تبدیل نہیں کر سکتے", "error");



      let studentIndex = currentGridData.findIndex(r => r.student.id === stdId);

      if(studentIndex !== -1) {

          var bookMax = exmGetBookMax(bookName);
          currentGridData[studentIndex].marks[bookName] = exmNormalizeMarkRaw(newMarks, bookMax);
          currentGridData[studentIndex].totalObtained = exmSumMarks(currentGridData[studentIndex].marks);

          renderMarksGrid(); document.getElementById('fr-marks').value = ''; showToast("نمبر کامیابی سے تبدیل کر دیے گئے!", "success");

      }

  });



  document.getElementById('mrk-search-input')?.addEventListener('input', function() {

      const term = this.value.toLowerCase();

      document.querySelectorAll('#mrk-entry-tbody tr').forEach(row => { row.style.display = row.cells[0].innerText.toLowerCase().includes(term) ? '' : 'none'; });

  });



  document.getElementById('mrk-sort-select')?.addEventListener('change', function() {

      const sortType = this.value;

      if(sortType === 'name_asc') currentGridData.sort((a, b) => a.student.name.localeCompare(b.student.name, 'ur'));

      else if(sortType === 'id_asc') currentGridData.sort((a, b) => a.student.id.localeCompare(b.student.id));

      else if(sortType === 'total_desc') currentGridData.sort((a, b) => b.totalObtained - a.totalObtained);

      renderMarksGrid(); 

  });



  document.getElementById('mrk-sort-book')?.addEventListener('change', function() {

      const bookName = this.value;

      if(bookName) {

          currentGridData.sort((a, b) => exmMarkSortValue(b.marks[bookName]) - exmMarkSortValue(a.marks[bookName]));

          renderMarksGrid(); showToast(`${bookName} کے ٹاپرز اوپر آ گئے ہیں!`, "success");

      }

  });



  document.getElementById('btn-save-all-marks')?.addEventListener('click', () => {

      if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('exams', 'edit')) return;

      const examName = document.getElementById('mrk-exam-name').value;

      const cls = document.getElementById('mrk-class').value;

      if (window.exmIsExamLocked(examName, cls)) {
          return showToast("یہ نتیجہ لاک ہو چکا ہے — محفوظ نہیں ہو سکتا", "error");
      }

      let dbMarks = JSON.parse(localStorage.getItem(DB.exams)) || [];



      currentGridData.forEach(row => {

          var existingRecord = dbMarks.find(function (m) {
              return m.examName === examName && m.class === cls && m.studentId === row.student.id;
          });
          var existingMarks = existingRecord ? (existingRecord.marks || {}) : {};
          var normalizedMarks = exmMergeMarksForSave(row.marks, existingMarks);

          var totalObtained = exmSumMarks(normalizedMarks);
          var percentage = exmCalcPercentage(totalObtained, currentTotalPossibleMarks);
          var grade = exmGradeFromPercentage(percentage);

          let recordObj = {

              id: generateID('RES'), examName: examName, class: cls, studentId: row.student.id,

              studentName: row.student.name, studentPhoto: (typeof window.emsGetUserPhotoSrc === 'function' ? window.emsGetUserPhotoSrc(row.student) : (row.student.photoBase64 || row.student.photoUrl || '')),

              marks: normalizedMarks, totalObtained: totalObtained, grandTotal: currentTotalPossibleMarks,

              percentage: percentage.toFixed(1), grade: grade, timestamp: new Date().getTime()

          };

          if (typeof window.emsStampDepartment === 'function') {
              window.emsStampDepartment(recordObj, row.student.departmentId);
          }

          row.marks = normalizedMarks;
          row.totalObtained = totalObtained;

          let existingIndex = dbMarks.findIndex(m => m.examName === examName && m.class === cls && m.studentId === row.student.id);

          if (existingIndex !== -1) {
              recordObj.id = dbMarks[existingIndex].id;
              dbMarks[existingIndex] = recordObj;
          } else {
              dbMarks.push(recordObj);
          }

      });

      emsSaveKey(DB.exams, JSON.stringify(dbMarks));

      showToast("تمام نمبرات محفوظ کر لیے گئے!", "success");

  });



  document.getElementById('res-type')?.addEventListener('change', function() {

      document.getElementById('res-student-container').style.display = (this.value === 'student_card') ? 'flex' : 'none';

  });



  document.getElementById('btn-fetch-result')?.addEventListener('click', () => {

      const examName = document.getElementById('res-exam-name').value;

      const resType = document.getElementById('res-type').value;

      const cls = document.getElementById('res-class').value;

      const stdId = document.getElementById('res-student').value;

      const printArea = document.getElementById('result-printable-area');



      if(!cls) return showToast("پہلے درجہ منتخب کریں!", "error");

      if(resType === 'student_card' && !stdId) return showToast("طالب علم کا انتخاب لازمی ہے!", "error");



      const dbMarks = JSON.parse(localStorage.getItem(DB.exams)) || [];

      let classResults = dbMarks.filter(m => m.examName === examName && m.class === cls);



      if(classResults.length === 0) { printArea.innerHTML = '<h3 style="text-align:center; color:red;">اس امتحان کا کوئی رزلٹ موجود نہیں!</h3>'; printArea.style.display = 'block'; return; }

      exmAssignPositions(classResults);

      classResults.sort((a, b) => b.totalObtained - a.totalObtained);



      let html = '';

      let templates = JSON.parse(localStorage.getItem('ems_exam_templates')) || [];

      let tplBooks = templates.find(t => t.class === cls)?.books || [];



      var brandHeader = (typeof window.attBrandHeaderHTML === 'function') ? window.attBrandHeaderHTML() : '';
      var brandFooter = (typeof window.attSignFooterHTML === 'function') ? window.attSignFooterHTML() : '';

      if(resType === 'class_summary') {

          html += brandHeader;

          html += `<h3 style="text-align:center; margin-top: 0; color:#7f8c8d;">کشف النتیجہ (درجہ وار)</h3>`;

          html += `<p style="text-align:center; font-weight:bold;">امتحان: ${examName} | درجہ: ${cls}</p>`;

          

          html += `<table style="width:100%; border-collapse: collapse; margin-top:20px; text-align:right;" border="1">

                      <thead style="background:#eef2f6;"><tr><th>پوزیشن</th><th>نام / ID</th>`;

          tplBooks.forEach(b => { html += `<th>${b.name}</th>`; });

          html += `<th>کل نمبر</th><th>حاصل کردہ</th><th>فیصد</th><th>درجہ (Grade)</th></tr></thead><tbody>`;

          

          classResults.forEach(res => {

              let gradeColor = res.grade.includes('راسب') ? 'red' : 'green';

              html += `<tr>

                          <td style="font-weight:bold; text-align:center; color:var(--warning); font-size:16px;">${res.positionStr}</td>

                          <td><strong>${res.studentName}</strong> <br><small>${res.studentId}</small></td>`;

              tplBooks.forEach(b => { html += `<td>${exmDisplayMark(res.marks[b.name])}</td>`; });

              html += `<td>${res.grandTotal}</td><td style="font-weight:bold;">${res.totalObtained}</td><td>${res.percentage}%</td><td style="color:${gradeColor}; font-weight:bold;">${res.grade}</td></tr>`;

          });

          html += `</tbody></table>`;

          html += brandFooter;

      } 

      else if (resType === 'student_card') {

          let res = classResults.find(r => r.studentId === stdId);

          if(!res) { printArea.innerHTML = '<p>اس طالب علم کا رزلٹ موجود نہیں!</p>'; printArea.style.display='block'; return; }

          html += window.exmBuildStudentCardHtml(res, examName);

      }

      printArea.innerHTML = html; printArea.style.display = 'block';
      var rsw = document.getElementById('res-search-wrap');
      if (rsw) { rsw.style.display = (resType === 'class_summary') ? 'flex' : 'none'; var ri = document.getElementById('res-search'); if (ri) ri.value = ''; }
      showToast("رزلٹ اور پری ویو تیار ہو گیا!", "success");

  });

  // =========================================================
  // مرحلہ 3: نمبرات گرڈ برآمد + ذہین درآمد + نتائج برآمد
  // =========================================================
  window.examExportMarksGrid = function () {
      if (!currentGridData || !currentGridData.length) return showToast("پہلے گرڈ تیار کریں!", "error");
      var bookNames = currentClassTemplateBooks.map(function (b) { return b.name; });
      var header = ['ID', 'نام'].concat(bookNames).concat(['کل ممکن', 'حاصل کردہ']);
      var data = currentGridData.map(function (row) {
          var line = [row.student.id, row.student.name];
          bookNames.forEach(function (bn) {
              var v = row.marks[bn];
              line.push(v != null ? (exmIsAbsentMark(v) ? 'AB' : v) : '');
          });
          line.push(currentTotalPossibleMarks, row.totalObtained);
          return line;
      });
      var cls = document.getElementById('mrk-class').value || 'درجہ';
      window.examDownloadCSV([header].concat(data), 'نمبرات_' + cls + '.csv');
  };

  // ذہین CSV درآمد — کالم خودکار شناخت (ID/نام + کتاب کے نام)
  window.examImportMarksCSV = function (input) {
      var file = input.files && input.files[0];
      if (!file) return;
      if (exmIsMarksContextLocked()) {
          showToast("یہ نتیجہ لاک ہو چکا ہے — درآمد ممنوع", "error");
          input.value = '';
          return;
      }
      var reader = new FileReader();
      reader.onload = function (e) {
          try {
              var text = String(e.target.result).replace(/^\uFEFF/, '');
              var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
              if (lines.length < 2) { showToast("فائل خالی یا ناقص ہے!", "error"); return; }
              var parse = function (line) {
                  var out = [], cur = '', q = false;
                  for (var i = 0; i < line.length; i++) {
                      var c = line[i];
                      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
                      else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
                  }
                  out.push(cur); return out;
              };
              var headers = parse(lines[0]).map(function (h) { return h.trim(); });
              // کالم شناخت
              var idCol = headers.findIndex(function (h) { return /^id$|آئی|شناخت|roll|رول/i.test(h); });
              var nameCol = headers.findIndex(function (h) { return /name|نام/i.test(h); });
              if (idCol < 0 && nameCol < 0) { showToast("ID یا نام کا کالم نہیں ملا!", "error"); return; }
              var bookNames = currentClassTemplateBooks.map(function (b) { return b.name; });
              // ہر کتاب کے لیے متعلقہ کالم
              var bookColMap = {};
              bookNames.forEach(function (bn) {
                  var ci = headers.findIndex(function (h) { return h === bn; });
                  if (ci >= 0) bookColMap[bn] = ci;
              });
              var matched = 0, missing = 0, unknownBooks = bookNames.filter(function (bn) { return bookColMap[bn] == null; });
              for (var r = 1; r < lines.length; r++) {
                  var cells = parse(lines[r]);
                  var sid = idCol >= 0 ? (cells[idCol] || '').trim() : '';
                  var sname = nameCol >= 0 ? (cells[nameCol] || '').trim() : '';
                  var gi = currentGridData.findIndex(function (g) {
                      return (sid && g.student.id === sid) || (!sid && sname && g.student.name === sname);
                  });
                  if (gi < 0) { missing++; continue; }
                  bookNames.forEach(function (bn) {
                      if (bookColMap[bn] != null) {
                          var bookTpl = currentClassTemplateBooks.find(function (b) { return b.name === bn; });
                          if (!window.exmCanEditBookColumn(bookTpl)) return;
                          var rawCell = (cells[bookColMap[bn]] || '').trim();
                          var bookMax = bookTpl ? bookTpl.marks : 100;
                          currentGridData[gi].marks[bn] = exmNormalizeMarkRaw(rawCell, bookMax);
                      }
                  });
                  currentGridData[gi].totalObtained = exmSumMarks(currentGridData[gi].marks);
                  matched++;
              }
              renderMarksGrid();
              var msg = matched + " طلبہ کے نمبرات درآمد ہوئے۔";
              if (missing) msg += " " + missing + " قطاریں میل نہیں کھائیں۔";
              if (unknownBooks.length) msg += " غیر شناخت شدہ کتب: " + unknownBooks.join('، ');
              showToast(msg, missing || unknownBooks.length ? "warning" : "success");
          } catch (err) {
              console.error(err); showToast("درآمد میں خرابی: " + err.message, "error");
          }
          input.value = '';
      };
      reader.readAsText(file, 'UTF-8');
  };

  // محفوظ شدہ نتائج برآمد (منتخب امتحان/درجہ)
  window.examExportResults = function () {
      var examName = document.getElementById('res-exam-name').value;
      var cls = document.getElementById('res-class').value;
      var dbMarks = JSON.parse(localStorage.getItem(DB.exams)) || [];
      var list = dbMarks.filter(function (m) { return m.examName === examName && (!cls || m.class === cls); });
      if (!list.length) return showToast("منتخب امتحان کا کوئی نتیجہ موجود نہیں!", "error");
      var allBooks = [];
      list.forEach(function (r) { Object.keys(r.marks || {}).forEach(function (b) { if (allBooks.indexOf(b) < 0) allBooks.push(b); }); });
      var header = ['درجہ', 'ID', 'نام'].concat(allBooks).concat(['کل ممکن', 'حاصل کردہ', 'فیصد', 'درجہ بندی']);
      var data = list.sort(function (a, b) { return b.totalObtained - a.totalObtained; }).map(function (r) {
          var line = [r.class, r.studentId, r.studentName];
          allBooks.forEach(function (b) {
              var v = r.marks[b];
              line.push(v != null ? (exmIsAbsentMark(v) ? 'AB' : v) : '');
          });
          line.push(r.grandTotal, r.totalObtained, r.percentage + '%', r.grade);
          return line;
      });
      window.examDownloadCSV([header].concat(data), 'نتائج_' + (examName || 'امتحان') + '.csv');
  };

  // =========================================================
  // مرحلہ 4: کارکردگی کا تجزیہ و شماریات
  // =========================================================
  window.renderExamAnalysis = function () {
      var box = document.getElementById('exam-analysis-content');
      if (!box) return;
      var examName = document.getElementById('ana-exam-name').value;
      var cls = document.getElementById('ana-class').value;
      var dbMarks = JSON.parse(localStorage.getItem(DB.exams)) || [];
      var list = dbMarks.filter(function (m) { return (!examName || m.examName === examName) && (!cls || m.class === cls); });
      if (!list.length) { box.innerHTML = '<p style="color:#dc2626;">منتخب کسوٹی پر کوئی نتیجہ موجود نہیں۔</p>'; return; }

      var pass = list.filter(function (r) { return !String(r.grade).includes('راسب'); }).length;
      var fail = list.length - pass;
      var avg = (list.reduce(function (s, r) { return s + parseFloat(r.percentage || 0); }, 0) / list.length).toFixed(1);

      // درجہ بندی تقسیم
      var gradeColors = { 'ممتاز مرتفع': '#16a34a', 'ممتاز': '#22c55e', 'جید جدا': '#0891b2', 'جید': '#3b82f6', 'مقبول': '#d97706', 'راسب': '#dc2626' };
      var gradeSegs = Object.keys(gradeColors).map(function (g) {
          return { label: g, value: list.filter(function (r) { return r.grade === g; }).length, color: gradeColors[g] };
      }).filter(function (s) { return s.value > 0; });

      // درجہ وار اوسط
      var byClass = {};
      list.forEach(function (r) { (byClass[r.class] = byClass[r.class] || []).push(parseFloat(r.percentage || 0)); });
      var classItems = Object.keys(byClass).map(function (c) {
          var arr = byClass[c]; var a = arr.reduce(function (s, x) { return s + x; }, 0) / arr.length;
          return { label: c, value: Math.round(a), display: Math.round(a) + '%' };
      });

      // مضمون وار اوسط
      var bookSum = {}, bookCnt = {}, bookMax = {};
      list.forEach(function (r) {
          Object.keys(r.marks || {}).forEach(function (b) {
              if (exmIsAbsentMark(r.marks[b])) return;
              bookSum[b] = (bookSum[b] || 0) + Number(r.marks[b] || 0); bookCnt[b] = (bookCnt[b] || 0) + 1;
          });
      });
      var tpls = JSON.parse(localStorage.getItem('ems_exam_templates')) || [];
      tpls.forEach(function (t) { (t.books || []).forEach(function (b) { bookMax[b.name] = b.marks; }); });
      var bookItems = Object.keys(bookSum).map(function (b) {
          var avgB = bookSum[b] / bookCnt[b]; var mx = bookMax[b] || 100;
          var pct = Math.round((avgB / mx) * 100);
          return { label: b, value: pct, display: pct + '%' };
      }).sort(function (a, b) { return b.value - a.value; });

      // استاد وار کارکردگی (ماسٹر شیٹ میں مضمون → استاد منسلک)
      var bookTeacher = {};
      tpls.forEach(function (t) {
          if (cls && t.class !== cls) return;
          (t.books || []).forEach(function (b) {
              if (b.teacher) bookTeacher[b.name] = b.teacher;
          });
      });
      var tObt = {}, tMax = {};
      list.forEach(function (r) {
          Object.keys(r.marks || {}).forEach(function (bn) {
              if (exmIsAbsentMark(r.marks[bn])) return;
              var teacher = bookTeacher[bn];
              if (!teacher) return;
              tObt[teacher] = (tObt[teacher] || 0) + Number(r.marks[bn] || 0);
              tMax[teacher] = (tMax[teacher] || 0) + (bookMax[bn] || 100);
          });
      });
      var teacherItems = Object.keys(tObt).map(function (t) {
          var pct = tMax[t] ? Math.round((tObt[t] / tMax[t]) * 100) : 0;
          return { label: t, value: pct, display: pct + '%' };
      }).sort(function (a, b) { return b.value - a.value; });

      var passSegs = [{ label: 'کامیاب', value: pass, color: '#16a34a' }, { label: 'ناکام', value: fail, color: '#dc2626' }];

      // سال بہ سال موازنہ (timestamp سے سال اخذ کر کے اوسط فیصد)
      var byYear = {};
      list.forEach(function (r) {
          var y = r.timestamp ? new Date(r.timestamp).getFullYear() : (new Date().getFullYear());
          (byYear[y] = byYear[y] || []).push(parseFloat(r.percentage || 0));
      });
      var yearKeys = Object.keys(byYear).sort();
      var yearItems = yearKeys.map(function (y) {
          var arr = byYear[y]; var a = arr.reduce(function (s, x) { return s + x; }, 0) / arr.length;
          return { label: String(y), value: Math.round(a) };
      });

      var donutGrade = (typeof window.emsDonutSVG === 'function') ? window.emsDonutSVG(gradeSegs, list.length, 'کل طلبہ') : '';
      var donutPass = (typeof window.emsDonutSVG === 'function') ? window.emsDonutSVG(passSegs, Math.round((pass / list.length) * 100) + '%', 'کامیابی') : '';
      var barClass = (typeof window.emsBarChartSVG === 'function') ? window.emsBarChartSVG(classItems) : '';
      var barBook = (typeof window.emsBarChartSVG === 'function') ? window.emsBarChartSVG(bookItems) : '';
      var barTeacher = (teacherItems.length && typeof window.emsBarChartSVG === 'function') ? window.emsBarChartSVG(teacherItems)
          : '<p style="color:#94a3b8;">استاد وار تجزیے کے لیے ماسٹر شیٹ میں ہر کتاب کے ساتھ "مضمون کا استاد" منتخب کریں۔</p>';
      var lineYear = (yearItems.length > 1 && typeof window.emsLineChartSVG === 'function') ? window.emsLineChartSVG(yearItems, '#7c3aed')
          : '<p style="color:#94a3b8;">سال بہ سال موازنے کے لیے کم از کم دو مختلف سالوں کا ریکارڈ درکار ہے۔</p>';

      box.innerHTML =
          '<div class="cmp-stat-strip" style="margin-bottom:16px;">' +
            statCard('کل طلبہ', list.length, '#2563eb', 'fa-users') +
            statCard('اوسط فیصد', avg + '%', '#7c3aed', 'fa-percent') +
            statCard('کامیاب', pass, '#16a34a', 'fa-check') +
            statCard('ناکام', fail, '#dc2626', 'fa-times') +
          '</div>' +
          '<div class="cmp-dash-grid">' +
            '<div class="cmp-dash-card"><h4>درجہ بندی کی تقسیم</h4>' + donutGrade + '</div>' +
            '<div class="cmp-dash-card"><h4>کامیابی / ناکامی</h4>' + donutPass + '</div>' +
            '<div class="cmp-dash-card cmp-dash-wide"><h4>درجہ وار اوسط کارکردگی</h4>' + barClass + '</div>' +
            '<div class="cmp-dash-card cmp-dash-wide"><h4>مضمون وار اوسط (کمزور مضامین کی نشاندہی)</h4>' + barBook + '</div>' +
            '<div class="cmp-dash-card cmp-dash-wide"><h4>استاد وار اوسط کارکردگی</h4>' + barTeacher + '</div>' +
            '<div class="cmp-dash-card cmp-dash-wide"><h4>سال بہ سال موازنہ (اوسط فیصد)</h4>' + lineYear + '</div>' +
          '</div>';

      function statCard(l, v, c, i) {
          return '<div class="cmp-stat" style="border-top:3px solid ' + c + ';"><div class="cmp-stat-ico" style="color:' + c + ';"><i class="fas ' + i + '"></i></div><div class="cmp-stat-v">' + v + '</div><div class="cmp-stat-l">' + l + '</div></div>';
      }
  };

  document.getElementById('btn-run-analysis')?.addEventListener('click', window.renderExamAnalysis);

  // مرحلہ 6: نتائج کی فوری تلاش (درجہ وار چارٹ کی قطاروں پر)
  window.examResultSearch = function (val) {
      var term = (val || '').toLowerCase().trim();
      var rows = document.querySelectorAll('#result-printable-area table tbody tr');
      rows.forEach(function (tr) {
          tr.style.display = (!term || tr.innerText.toLowerCase().indexOf(term) >= 0) ? '' : 'none';
      });
  };

  // =========================================================
  // ترقی و تنزلی کا نظام (Promotion) — نکتہ 2
  // =========================================================
  window._promoRows = [];

  document.getElementById('btn-load-promote')?.addEventListener('click', function () {
      var examName = document.getElementById('promo-exam-name').value;
      var fromClass = document.getElementById('promo-from-class').value;
      if (!fromClass) return showToast("موجودہ درجہ منتخب کریں!", "error");
      var dbMarks = JSON.parse(localStorage.getItem(DB.exams)) || [];
      var users = exmGetUsers();
      var students = users.filter(function (u) { return u.type === 'student' && u.class === fromClass; });
      if (!students.length) return showToast("اس درجے میں کوئی طالب علم نہیں!", "error");

      window._promoRows = students.map(function (std) {
          var res = dbMarks.find(function (m) { return m.examName === examName && m.class === fromClass && m.studentId === std.id; });
          var passing = res ? !String(res.grade).includes('راسب') : false;
          return {
              id: std.id, name: std.name,
              totalObtained: res ? res.totalObtained : '-',
              percentage: res ? res.percentage : '-',
              grade: res ? res.grade : 'نتیجہ نہیں',
              passing: passing,
              selected: passing
          };
      });
      window.promoRenderTable();
      document.getElementById('promo-toolbar').style.display = 'flex';
      showToast(students.length + " طلبہ کی فہرست تیار — کامیاب طلبہ خودکار منتخب ہیں۔", "success");
  });

  window.promoRenderTable = function () {
      var tbody = document.querySelector('#promo-table tbody');
      if (!tbody) return;
      var scrollEl = tbody.closest('.table-responsive');
      var rows = window._promoRows || [];

      if (!rows.length) {
          if (typeof window.emsVirtualTableDestroy === 'function') window.emsVirtualTableDestroy('promo-table');
          tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8;">کوئی ریکارڈ نہیں</td></tr>';
          window.promoUpdateCount();
          return;
      }

      function renderPromoRow(i, r) {
          var gradeColor = String(r.grade).includes('راسب') ? '#dc2626' : (r.grade === 'نتیجہ نہیں' ? '#94a3b8' : '#16a34a');
          var resultTag = r.passing ? '<span style="color:#16a34a; font-weight:bold;">کامیاب</span>' : (r.grade === 'نتیجہ نہیں' ? '<span style="color:#94a3b8;">—</span>' : '<span style="color:#dc2626; font-weight:bold;">ناکام</span>');
          var tr = document.createElement('tr');
          tr.innerHTML =
              '<td style="text-align:center;"><input type="checkbox" ' + (r.selected ? 'checked' : '') + ' onchange="window.promoToggle(' + i + ', this.checked)"></td>' +
              '<td><strong>' + r.name + '</strong><br><small>' + r.id + '</small></td>' +
              '<td>' + r.totalObtained + '</td>' +
              '<td>' + (r.percentage !== '-' ? r.percentage + '%' : '-') + '</td>' +
              '<td style="color:' + gradeColor + '; font-weight:bold;">' + r.grade + '</td>' +
              '<td>' + resultTag + '</td>';
          return tr;
      }

      if (scrollEl && typeof window.emsVirtualTableMount === 'function') {
          scrollEl.style.maxHeight = scrollEl.style.maxHeight || '58vh';
          scrollEl.style.overflowY = 'auto';
          window.emsVirtualTableMount('promo-table', {
              scrollEl: scrollEl,
              tbody: tbody,
              rowHeight: 48,
              getData: function () { return window._promoRows || []; },
              renderRow: renderPromoRow,
              emptyHtml: '<tr><td colspan="6" style="text-align:center; color:#94a3b8;">کوئی ریکارڈ نہیں</td></tr>'
          });
          window.promoUpdateCount();
          return;
      }

      tbody.innerHTML = '';
      rows.forEach(function (r, i) { tbody.appendChild(renderPromoRow(i, r)); });
      window.promoUpdateCount();
  };

  window.promoToggle = function (i, checked) { if (window._promoRows[i]) window._promoRows[i].selected = checked; window.promoUpdateCount(); };
  window.promoSelectAll = function (val) { window._promoRows.forEach(function (r) { r.selected = val; }); window.promoRenderTable(); };
  window.promoSelectPassing = function () { window._promoRows.forEach(function (r) { r.selected = r.passing; }); window.promoRenderTable(); };
  window.promoUpdateCount = function () {
      var n = window._promoRows.filter(function (r) { return r.selected; }).length;
      var el = document.getElementById('promo-count');
      if (el) el.innerText = n + ' / ' + window._promoRows.length + ' منتخب';
  };

  window.promoApply = async function () {
      var fromClass = document.getElementById('promo-from-class').value;
      var toClass = document.getElementById('promo-to-class').value;
      var selected = window._promoRows.filter(function (r) { return r.selected; });
      if (!toClass) return showToast("اگلا درجہ (ترقی) منتخب کریں!", "error");
      if (toClass === fromClass) return showToast("موجودہ اور اگلا درجہ ایک جیسا نہیں ہو سکتا!", "error");
      if (!selected.length) return showToast("کم از کم ایک طالب علم منتخب کریں!", "error");
      if (typeof window.emsRequireStaffAction === 'function' && !window.emsRequireStaffAction('exams', 'edit')) return;
      if (!confirm(selected.length + " طلبہ کو '" + fromClass + "' سے '" + toClass + "' میں ترقی دی جائے؟")) return;

      var ts = new Date().getTime();
      var fdb = window.EMS_FIRESTORE_DB;
      var uid = (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) ? firebase.auth().currentUser.uid : null;

      if (fdb && uid) {
          // فائر بیس میں merge — onSnapshot خودکار localStorage اپڈیٹ کرے گا
          try {
              var col = fdb.collection('All_Madrasas').doc(uid).collection('Registrations');
              var batch = fdb.batch();
              selected.forEach(function (r) {
                  batch.set(col.doc(r.id), { class: toClass, prevClass: fromClass, promotedAt: ts, promotedFrom: fromClass }, { merge: true });
              });
              await batch.commit();
          } catch (err) {
              console.error('Promotion cloud save failed', err);
              showToast("کلاؤڈ میں محفوظ نہیں ہو سکا: " + err.message, "error");
              return;
          }
      } else {
          // آف لائن fallback — مقامی ریکارڈ اپڈیٹ
          var users = exmGetUsers();
          var map = {}; selected.forEach(function (r) { map[r.id] = true; });
          users.forEach(function (u) { if (u.type === 'student' && map[u.id]) { u.prevClass = u.class; u.class = toClass; u.promotedAt = ts; } });
          emsSaveKey(DB.users, JSON.stringify(users));
      }

      showToast(selected.length + " طلبہ کو کامیابی سے ترقی دے دی گئی!", "success");
      // فہرست تازہ کریں
      setTimeout(function () {
          if (typeof window.refreshExamData === 'function') window.refreshExamData();
          document.getElementById('btn-load-promote').click();
      }, 600);
  };

if (typeof window.emsRegisterDepartmentRefresh === 'function') {
  window.emsRegisterDepartmentRefresh('exams', function () {
    if (typeof window.emsIsExamsModuleActive === 'function' && !window.emsIsExamsModuleActive()) return;
    window._exmDropdownGen = -1;
    if (typeof window.refreshExamData === 'function') window.refreshExamData(window._exmActiveTab);
  });
}

['mrk-exam-name', 'mrk-class', 'res-exam-name', 'res-class'].forEach(function (selId) {
  var el = document.getElementById(selId);
  if (el) el.addEventListener('change', function () {
    if (typeof window.exmUpdateLockUi === 'function') window.exmUpdateLockUi();
  });
});

document.getElementById('btn-exm-lock-toggle')?.addEventListener('click', function () {
  if (typeof window.exmToggleExamLock === 'function') window.exmToggleExamLock();
});