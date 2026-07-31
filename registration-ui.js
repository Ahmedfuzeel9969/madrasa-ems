// ============================================================================
// Registration UI — Enterprise Layout Layer (Phase 2 / regent36)
// - مربوط نیویگیشن + ڈیفالٹ "طلباء" صفحہ
// - فل-اسکرین کے لیے سیکشنز کو Accordion میں تبدیل (کم اسکرولنگ)
// - HTML کو توڑے بغیر runtime پر ساخت بہتر بناتا ہے (محفوظ)
// ============================================================================
(function (global) {
    'use strict';

    var _registrationOpenedOnce = false;

    function applyListPagerFallback() {
        if (typeof global.regListApplyPager === 'function') {
            global.regListApplyPager(0);
        } else if (typeof global.regListBuildDesktopRecoveryButtons === 'function') {
            var pagerEl = document.getElementById('reg-list-pager');
            if (pagerEl) pagerEl.innerHTML = global.regListBuildDesktopRecoveryButtons();
        }
    }

    function refreshListIfActive() {
        if (typeof global.emsIsAdmissionModuleActive === 'function' && !global.emsIsAdmissionModuleActive()) {
            return;
        }
        var regType = global.currentRegType;
        if (regType !== 'list') return;
        if (typeof global.emsGuardRegistrationListRender === 'function') {
            global.emsGuardRegistrationListRender(global.renderRegTable);
        } else if (typeof global.renderRegTable === 'function') {
            global.renderRegTable();
        } else {
            applyListPagerFallback();
        }
    }

    function buildAccordions(panel) {
        if (!panel || panel._accBuilt) return;
        var heads = Array.prototype.slice.call(panel.querySelectorAll('h3'));
        var madeAny = false;
        heads.forEach(function (h, idx) {
            var grid = h.nextElementSibling;
            var between = [];
            while (grid && (!grid.classList || !grid.classList.contains('form-grid'))) {
                if (grid.nodeType === 1) between.push(grid);
                grid = grid.nextElementSibling;
            }
            if (!grid || !grid.classList.contains('form-grid')) return;

            var item = document.createElement('div');
            item.className = 'reg-acc-item';
            h.parentNode.insertBefore(item, h);

            h.classList.add('reg-acc-head');
            var caret = document.createElement('i');
            caret.className = 'fas fa-chevron-down reg-acc-caret';
            h.appendChild(caret);

            item.appendChild(h);
            between.forEach(function (el) { item.appendChild(el); });
            item.appendChild(grid);
            grid.classList.add('reg-acc-body');

            h.addEventListener('click', function () { item.classList.toggle('open'); });
            if (idx === 0) item.classList.add('open');
            madeAny = true;
        });
        if (madeAny) panel._accBuilt = true;
    }

    function buildAllAccordions() {
        document.querySelectorAll('#module-admission .reg-panel').forEach(buildAccordions);
    }

    function formatCombinedName(name, fname) {
        name = (name || '').trim();
        fname = (fname || '').trim();
        if (!fname) return name;
        if (!name) return 'ولد ' + fname;
        return name + ' ولد ' + fname;
    }

    function parseCombinedName(combined) {
        combined = (combined || '').trim();
        var marker = ' ولد ';
        var idx = combined.indexOf(marker);
        if (idx >= 0) {
            return {
                name: combined.slice(0, idx).trim(),
                fname: combined.slice(idx + marker.length).trim()
            };
        }
        return { name: combined, fname: '' };
    }

    function syncCombinedToHidden(prefix) {
        var combined = document.getElementById(prefix + '-name-with-fname');
        var nameEl = document.getElementById(prefix + '-name');
        var fnameEl = document.getElementById(prefix + '-fname');
        if (!combined || !nameEl || !fnameEl) return;
        var parsed = parseCombinedName(combined.value);
        nameEl.value = parsed.name;
        fnameEl.value = parsed.fname;
    }

    function updateCombinedFromHidden(prefix) {
        var combined = document.getElementById(prefix + '-name-with-fname');
        var nameEl = document.getElementById(prefix + '-name');
        var fnameEl = document.getElementById(prefix + '-fname');
        if (!combined || !nameEl || !fnameEl) return;
        combined.value = formatCombinedName(nameEl.value, fnameEl.value);
    }

    function initCombinedNameFields() {
        ['stu', 'tch', 'stf'].forEach(function (prefix) {
            var combined = document.getElementById(prefix + '-name-with-fname');
            if (!combined || combined._emsCombinedBound) return;
            combined.addEventListener('input', function () { syncCombinedToHidden(prefix); });
            combined.addEventListener('blur', function () { syncCombinedToHidden(prefix); });
            combined._emsCombinedBound = true;
        });
    }

    var _photoPickerPrefix = null;

    function closePhotoPicker() {
        var menu = document.getElementById('reg-photo-picker-menu');
        if (menu) menu.hidden = true;
        _photoPickerPrefix = null;
    }

    function openPhotoPicker(prefix) {
        _photoPickerPrefix = prefix;
        var menu = document.getElementById('reg-photo-picker-menu');
        if (menu) menu.hidden = false;
    }

    function initPhotoPickers() {
        var menu = document.getElementById('reg-photo-picker-menu');
        if (!menu || menu._emsPickerBound) return;

        document.querySelectorAll('.reg-photo-picker-trigger').forEach(function (trigger) {
            if (trigger._emsPickerBound) return;
            trigger.addEventListener('click', function (e) {
                e.preventDefault();
                var group = trigger.closest('[data-reg-prefix]');
                if (!group) return;
                openPhotoPicker(group.getAttribute('data-reg-prefix'));
            });
            trigger.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    trigger.click();
                }
            });
            trigger._emsPickerBound = true;
        });

        var btnCamera = document.getElementById('reg-photo-picker-camera');
        var btnGallery = document.getElementById('reg-photo-picker-gallery');
        var btnCancel = document.getElementById('reg-photo-picker-cancel');

        if (btnCamera) {
            btnCamera.addEventListener('click', function () {
                if (!_photoPickerPrefix) return;
                var input = document.getElementById(_photoPickerPrefix + '-photo-upload-camera');
                closePhotoPicker();
                if (input) input.click();
            });
        }
        if (btnGallery) {
            btnGallery.addEventListener('click', function () {
                if (!_photoPickerPrefix) return;
                var input = document.getElementById(_photoPickerPrefix + '-photo-upload-gallery');
                closePhotoPicker();
                if (input) input.click();
            });
        }
        if (btnCancel) btnCancel.addEventListener('click', closePhotoPicker);
        menu.addEventListener('click', function (e) {
            if (e.target === menu) closePhotoPicker();
        });

        menu._emsPickerBound = true;
    }

    function initRegistrationFormUi() {
        initCombinedNameFields();
        initPhotoPickers();
    }

    global.emsRegFormatCombinedName = formatCombinedName;
    global.emsRegParseCombinedName = parseCombinedName;
    global.emsRegSyncCombinedName = syncCombinedToHidden;
    global.emsRegUpdateCombinedName = updateCombinedFromHidden;
    global.emsRegInitFormUi = initRegistrationFormUi;

    function setAllOpen(open) {
        var activePanel = document.querySelector('#module-admission .reg-panel:not([style*="display: none"])') ||
            document.getElementById('reg-student-panel');
        if (!activePanel) return;
        activePanel.querySelectorAll('.reg-acc-item').forEach(function (it) {
            it.classList.toggle('open', !!open);
        });
    }

    function scanAdmissionUiOnce() {
        var root = document.getElementById('module-admission');
        if (!root || root._emsUiScanned) return;
        if (global.EmsUI && typeof global.EmsUI.scan === 'function') {
            global.EmsUI.scan(root);
            root._emsUiScanned = true;
        }
    }

    function openRegistration() {
        applyListPagerFallback();

        var repoCount = typeof global.emsRegRepoGetCount === 'function'
            ? global.emsRegRepoGetCount()
            : (typeof global.emsRegRepoGetList === 'function' ? global.emsRegRepoGetList().length : 0);
        var skipSync = _registrationOpenedOnce && repoCount > 0;

        var finishOpen = function () {
            if (!_registrationOpenedOnce) {
                buildAllAccordions();
                _registrationOpenedOnce = true;
            }
            initRegistrationFormUi();
            if (typeof global.emsRegMobileBuildAllSectionNavs === 'function') {
                global.emsRegMobileBuildAllSectionNavs();
            }
            if (typeof global.emsRegMobileApplyClasses === 'function') {
                global.emsRegMobileApplyClasses();
            }
            var stuBtn = document.querySelector('#reg-ribbon-menu [onclick*="reg-student-panel"]');
            if (typeof global.switchRegTab === 'function' && stuBtn) {
                var anyActive = document.querySelector('#reg-ribbon-menu .active-sub-tab');
                if (!anyActive || anyActive === stuBtn) {
                    global.switchRegTab('reg-student-panel', stuBtn);
                }
            }
            refreshListIfActive();
            if (typeof global.emsDeferModuleWork === 'function') {
                global.emsDeferModuleWork(scanAdmissionUiOnce, { idle: true });
            } else {
                scanAdmissionUiOnce();
            }
            if (global.EmsI18n && typeof global.EmsI18n.refresh === 'function') {
                global.EmsI18n.refresh();
            }
            if (global.EMS_REG_DRAFTS_ENABLED === true && typeof global.emsRegDraftInit === 'function') {
                global.emsRegDraftInit();
            }
        };

        if (skipSync) {
            finishOpen();
            return;
        }

        var syncPromise = typeof global.emsLoadRegistrationListForUI === 'function'
            ? global.emsLoadRegistrationListForUI({ force: false })
            : (typeof global.emsEnsureRegistrationSync === 'function'
                ? global.emsEnsureRegistrationSync()
                : Promise.resolve());
        syncPromise.then(function (res) {
            if (typeof global.emsPipelineDebug === 'function') {
                global.emsPipelineDebug('registration_ui_open', {
                    recordCount: res && res.count != null ? res.count : repoCount,
                    source: res && res.source,
                    skipSync: skipSync
                });
            }
            finishOpen();
        }).catch(function (err) {
            console.warn('[EMS] registration open sync:', err);
            finishOpen();
        });
    }

    global.emsOpenRegistration = openRegistration;
    global.emsBuildRegAccordions = buildAllAccordions;
    global.emsRegAccordionAll = setAllOpen;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            buildAllAccordions();
            initRegistrationFormUi();
        });
    } else {
        buildAllAccordions();
        initRegistrationFormUi();
    }

    function onRepoHydrated() {
        if (typeof global.emsIsAdmissionModuleActive === 'function' && !global.emsIsAdmissionModuleActive()) {
            return;
        }
        refreshListIfActive();
        if (typeof global.emsIsDashboardModuleActive === 'function' && global.emsIsDashboardModuleActive()) {
            if (typeof global.updateMasterDashboard === 'function') {
                try { global.updateMasterDashboard(); } catch (e) { /* ignore */ }
            }
        }
    }

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('ems:users-changed', onRepoHydrated);
        global.addEventListener('ems:repo-hydrated', onRepoHydrated);
        global.addEventListener('ems:registration-ready', onRepoHydrated);
    }

})(window);
