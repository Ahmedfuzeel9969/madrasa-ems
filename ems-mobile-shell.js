// ============================================================================
// EMS Mobile Shell — major-module ⋮ menu + contextual submodule bar
// Desktop ribbon / RBAC / business logic unchanged.
// Source of truth: DOM ribbon tabs + isModuleTabAllowed + sysLayout MODULE_MENUS
// ============================================================================
(function (global) {
    'use strict';

    var NAV_STORE_PREFIX = 'ems_mobile_nav_v1';
    var activeMajorTabId = 'tab-dashboard';
    var menuOpen = false;

    /** Inventory status for deliverables / gating (presentation only). */
    var MODULE_STATUS = {
        dashboard: 'working',
        admission: 'working',
        attendance: 'working',
        curriculum: 'working',
        training: 'working',
        complaints: 'working',
        exams: 'working',
        finance: 'working',
        ledger: 'working',
        announcements: 'working',
        'ai-studio': 'partial',
        'sys-settings': 'working',
        'admin-panel': 'working',
        'parent-portal': 'working',
        'guest-demo': 'partial',
        superadmin: 'working'
    };

    function isPhoneLayout() {
        return typeof window.matchMedia === 'function'
            && window.matchMedia('(max-width: 768px)').matches;
    }

    function modIdFromTabId(tabId) {
        if (!tabId || tabId.indexOf('tab-') !== 0) return '';
        return tabId.slice(4);
    }

    function tabIdFromModId(modId) {
        return 'tab-' + modId;
    }

    function authUid() {
        try {
            if (global.firebase && global.firebase.auth) {
                var u = global.firebase.auth().currentUser;
                if (u && u.uid) return u.uid;
            }
        } catch (e) { /* ignore */ }
        try {
            if (typeof global.emsReadOfflineSession === 'function') {
                var s = global.emsReadOfflineSession();
                if (s && s.authUid) return s.authUid;
            }
        } catch (e2) { /* ignore */ }
        return '';
    }

    function madrasaId() {
        return global.CURRENT_MADRASA_TENANT_ID
            || (global.CURRENT_MADRASA_DATA && global.CURRENT_MADRASA_DATA.madrasaId)
            || '';
    }

    function navStorageKey() {
        var uid = authUid() || 'anon';
        var mid = madrasaId() || 'none';
        return NAV_STORE_PREFIX + ':' + uid + ':' + mid;
    }

    function readNavState() {
        try {
            var raw = localStorage.getItem(navStorageKey());
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function writeNavState(majorTabId, subPanelId) {
        if (!authUid() && !madrasaId()) return;
        try {
            localStorage.setItem(navStorageKey(), JSON.stringify({
                majorTabId: majorTabId || '',
                subPanelId: subPanelId || '',
                savedAt: Date.now()
            }));
        } catch (e) { /* ignore */ }
    }

    function clearForeignNavKeys() {
        /* Keep only current scope key; drop stale scopes after account switch. */
        try {
            var keep = navStorageKey();
            var doomed = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf(NAV_STORE_PREFIX + ':') === 0 && k !== keep) doomed.push(k);
            }
            doomed.forEach(function (k) { localStorage.removeItem(k); });
        } catch (e) { /* ignore */ }
    }

    function isTabPermitted(tabEl) {
        if (!tabEl) return false;
        if (tabEl.style.display === 'none') return false;
        var modId = modIdFromTabId(tabEl.id);
        if (!modId) return false;
        if (typeof global.isModuleTabAllowed === 'function') {
            try {
                if (!global.isModuleTabAllowed(modId)) return false;
            } catch (e) { /* fall through to DOM visibility */ }
        }
        var status = MODULE_STATUS[modId] || 'working';
        if (status === 'unavailable' || status === 'placeholder') return false;
        var view = document.getElementById('module-' + modId);
        if (!view && modId !== 'dashboard') {
            /* dashboard uses module-dashboard */
            return false;
        }
        return true;
    }

    function ribbonOrder() {
        if (typeof global.sysLayoutGetConfig === 'function') {
            try {
                var cfg = global.sysLayoutGetConfig();
                if (cfg && cfg.ribbon && cfg.ribbon.order && cfg.ribbon.order.length) {
                    return cfg.ribbon.order.slice();
                }
            } catch (e) { /* ignore */ }
        }
        return [
            'dashboard', 'admission', 'attendance', 'curriculum', 'training',
            'complaints', 'exams', 'finance', 'ledger', 'announcements',
            'ai-studio', 'sys-settings', 'admin-panel', 'parent-portal', 'superadmin'
        ];
    }

    function labelForTab(tabEl, modId) {
        if (typeof global.sysLayoutGetRibbonLabels === 'function') {
            var L = global.sysLayoutGetRibbonLabels();
            if (L && L[modId]) return L[modId];
        }
        if (!tabEl) return modId;
        var clone = tabEl.cloneNode(true);
        var icons = clone.querySelectorAll('i');
        for (var i = 0; i < icons.length; i++) icons[i].remove();
        return (clone.textContent || '').replace(/\s+/g, ' ').trim() || modId;
    }

    function iconClassForTab(tabEl) {
        if (!tabEl) return 'fas fa-cube';
        var ic = tabEl.querySelector('i');
        if (ic && ic.className) return ic.className;
        return 'fas fa-cube';
    }

    /** Build permitted major modules from live ribbon + RBAC (not a hardcoded four). */
    function listPermittedMajorModules() {
        var order = ribbonOrder();
        var seen = Object.create(null);
        var out = [];
        function pushMod(modId) {
            if (!modId || seen[modId]) return;
            var tab = document.getElementById(tabIdFromModId(modId));
            if (!tab || !isTabPermitted(tab)) return;
            seen[modId] = true;
            out.push({
                modId: modId,
                tabId: tab.id,
                label: labelForTab(tab, modId),
                iconClass: iconClassForTab(tab),
                status: MODULE_STATUS[modId] || 'working',
                hasSubs: !!getModuleMenuSelector(modId)
            });
        }
        order.forEach(pushMod);
        /* Any extra ribbon tabs not in layout order (e.g. ai-studio). */
        document.querySelectorAll('.ribbon-tab[id^="tab-"]').forEach(function (tab) {
            pushMod(modIdFromTabId(tab.id));
        });
        return out;
    }

    function getModuleMenuSelector(modId) {
        if (typeof global.sysLayoutGetModuleMenus === 'function') {
            var map = global.sysLayoutGetModuleMenus();
            if (map && map[modId]) return map[modId];
        }
        return null;
    }

    function listSubmodules(modId) {
        var sel = getModuleMenuSelector(modId);
        if (!sel) return [];
        var menu = document.querySelector(sel);
        if (!menu) return [];
        var btns = menu.querySelectorAll('button.reg-tab');
        var items = [];
        btns.forEach(function (btn) {
            /* Own visibility only — parent .reg-topbar is display:none on phone by design.
               getComputedStyle would falsely treat every tab as hidden and empty the strip. */
            if (btn.style.display === 'none') return;
            if (btn.getAttribute('hidden') != null) return;
            if (btn.getAttribute('aria-hidden') === 'true') return;
            var label = (btn.textContent || '').replace(/\s+/g, ' ').trim();
            if (!label) return;
            var panelId = '';
            var oc = btn.getAttribute('onclick') || '';
            var m = oc.match(/['"]([a-z0-9_-]+)['"]/i);
            if (m) panelId = m[1];
            var ic = btn.querySelector('i');
            items.push({
                label: label,
                panelId: panelId,
                iconClass: ic ? ic.className : 'fas fa-circle',
                el: btn,
                active: btn.classList.contains('active-sub-tab')
            });
        });
        return items;
    }

    function clickTab(tabId) {
        var tab = document.getElementById(tabId);
        if (!tab || !isTabPermitted(tab)) return false;
        if (typeof global.navigateToModule === 'function') {
            try {
                global.navigateToModule(tab);
                return true;
            } catch (e) { /* fall back */ }
        }
        tab.click();
        return true;
    }

    function menuTriggerBtn() {
        return document.getElementById('ems-mobile-more-btn')
            || document.querySelector('#ems-mobile-bottom-nav [data-bnav="more"]');
    }

    function closeModulesMenu() {
        menuOpen = false;
        var pop = document.getElementById('ems-mobile-modules-menu');
        var backdrop = document.getElementById('ems-mobile-modules-backdrop');
        if (pop) {
            pop.classList.remove('open');
            pop.setAttribute('aria-hidden', 'true');
        }
        if (backdrop) {
            backdrop.classList.remove('open');
            backdrop.setAttribute('aria-hidden', 'true');
        }
        var trigger = menuTriggerBtn();
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('ems-mobile-modules-open');
    }

    function positionModulesMenu() {
        var pop = document.getElementById('ems-mobile-modules-menu');
        var btn = menuTriggerBtn();
        if (!pop) return;
        var margin = 12;
        var maxW = Math.min(320, window.innerWidth - margin * 2);
        pop.style.width = 'max-content';
        pop.style.minWidth = '240px';
        pop.style.maxWidth = maxW + 'px';
        pop.style.maxHeight = '70vh';
        /* Anchor above bottom «مزید» (single menu entry). */
        if (btn) {
            var rect = btn.getBoundingClientRect();
            var estimatedH = Math.min(window.innerHeight * 0.7, 420);
            var top = Math.max(margin, rect.top - estimatedH - 8);
            pop.style.top = top + 'px';
            var right = Math.max(margin, window.innerWidth - rect.right);
            pop.style.right = right + 'px';
            pop.style.left = 'auto';
            pop.style.bottom = 'auto';
        } else {
            pop.style.bottom = 'calc(72px + env(safe-area-inset-bottom, 0px))';
            pop.style.top = 'auto';
            pop.style.right = margin + 'px';
            pop.style.left = 'auto';
        }
        requestAnimationFrame(function () {
            var pr = pop.getBoundingClientRect();
            if (pr.left < margin) {
                pop.style.right = Math.max(margin, window.innerWidth - pr.width - margin) + 'px';
            }
            if (pr.top < margin) {
                pop.style.top = margin + 'px';
            }
            if (btn) {
                var br = btn.getBoundingClientRect();
                if (pr.bottom > br.top - 4) {
                    pop.style.top = Math.max(margin, br.top - pr.height - 8) + 'px';
                }
            }
        });
    }

    function addMenuSection(list, title) {
        var sec = document.createElement('div');
        sec.className = 'ems-mm-section';
        sec.textContent = title;
        list.appendChild(sec);
    }

    function addMenuSep(list) {
        var sep = document.createElement('div');
        sep.className = 'ems-mm-sep';
        sep.setAttribute('role', 'separator');
        list.appendChild(sep);
    }

    function addUtilityItem(list, opts) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ems-mm-item' + (opts.danger ? ' ems-mm-danger' : '');
        btn.setAttribute('role', 'menuitem');
        btn.innerHTML = '<i class="' + opts.icon + '" aria-hidden="true"></i>'
            + '<span class="ems-mm-label">' + escapeHtml(opts.label) + '</span>';
        btn.addEventListener('click', function () {
            closeModulesMenu();
            if (typeof opts.onClick === 'function') opts.onClick();
        });
        list.appendChild(btn);
    }

    function triggerCloudSync() {
        var btn = document.getElementById('btn-global-cloud-sync')
            || document.getElementById('btn-dash-global-sync');
        if (btn) {
            btn.click();
            return;
        }
        if (typeof global.emsGlobalCloudSync === 'function') {
            try { global.emsGlobalCloudSync(); return; } catch (e) { /* ignore */ }
        }
        if (typeof global.showToast === 'function') {
            global.showToast('سنک دستیاب نہیں', 'warning');
        }
    }

    function triggerLogout() {
        if (typeof global.logoutUser === 'function') {
            global.logoutUser();
            return;
        }
        var btn = document.getElementById('ems-ribbon-logout');
        if (btn) btn.click();
    }

    function renderModulesMenu() {
        var list = document.getElementById('ems-mobile-modules-list');
        if (!list) return;
        list.innerHTML = '';

        addMenuSection(list, 'عمل');
        addUtilityItem(list, {
            icon: 'fas fa-search',
            label: 'تلاش',
            onClick: focusSearch
        });
        addUtilityItem(list, {
            icon: 'fas fa-sitemap',
            label: 'شعبہ تبدیل کریں',
            onClick: openDeptPicker
        });
        addUtilityItem(list, {
            icon: 'fas fa-bell',
            label: 'اطلاعات',
            onClick: openAlerts
        });
        addUtilityItem(list, {
            icon: 'fas fa-cloud-upload-alt',
            label: 'کلاؤڈ سنک',
            onClick: triggerCloudSync
        });
        addUtilityItem(list, {
            icon: 'fas fa-cogs',
            label: 'ترتیبات',
            onClick: function () { selectMajorModule('tab-sys-settings'); }
        });
        addUtilityItem(list, {
            icon: 'fas fa-sign-out-alt',
            label: 'سائن آؤٹ',
            danger: true,
            onClick: triggerLogout
        });

        addMenuSep(list);
        addMenuSection(list, 'ماڈیولز');

        var modules = listPermittedMajorModules();
        if (!modules.length) {
            var empty = document.createElement('p');
            empty.className = 'ems-mm-empty';
            empty.textContent = 'کوئی ماڈیول دستیاب نہیں';
            list.appendChild(empty);
            return;
        }
        modules.forEach(function (m) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ems-mm-item' + (m.tabId === activeMajorTabId ? ' active' : '');
            btn.setAttribute('role', 'menuitem');
            btn.setAttribute('data-tab', m.tabId);
            if (m.status === 'partial') btn.setAttribute('data-status', 'partial');
            btn.innerHTML = '<i class="' + m.iconClass + '" aria-hidden="true"></i>'
                + '<span class="ems-mm-label">' + escapeHtml(m.label) + '</span>'
                + (m.status === 'partial'
                    ? '<span class="ems-mm-badge">جزوی</span>'
                    : (m.hasSubs ? '<i class="fas fa-chevron-left ems-mm-arrow" aria-hidden="true"></i>' : ''));
            btn.addEventListener('click', function () {
                selectMajorModule(m.tabId);
            });
            list.appendChild(btn);
        });
    }

    function escapeHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/"/g, '&quot;');
    }

    function openModulesMenu() {
        if (!isPhoneLayout()) return;
        renderModulesMenu();
        menuOpen = true;
        var pop = document.getElementById('ems-mobile-modules-menu');
        var backdrop = document.getElementById('ems-mobile-modules-backdrop');
        if (backdrop) {
            backdrop.classList.add('open');
            backdrop.setAttribute('aria-hidden', 'false');
        }
        if (pop) {
            pop.classList.add('open');
            pop.setAttribute('aria-hidden', 'false');
        }
        var trigger = menuTriggerBtn();
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
        document.body.classList.add('ems-mobile-modules-open');
        positionModulesMenu();
    }

    function toggleModulesMenu() {
        if (menuOpen) closeModulesMenu();
        else openModulesMenu();
    }

    function updateHeaderTitle(tabId) {
        var titleEl = document.getElementById('ems-mobile-current-module');
        if (!titleEl) return;
        var modId = modIdFromTabId(tabId);
        var tab = document.getElementById(tabId);
        titleEl.textContent = labelForTab(tab, modId) || 'مرکزی صفحہ';
    }

    function renderSubmoduleBar(tabId) {
        var bar = document.getElementById('ems-mobile-subnav');
        if (!bar) return;
        var modId = modIdFromTabId(tabId);
        bar.innerHTML = '';
        var subs = listSubmodules(modId);
        if (!subs.length) {
            bar.hidden = true;
            bar.setAttribute('aria-hidden', 'true');
            document.documentElement.classList.remove('ems-mobile-has-subnav');
            return;
        }
        bar.hidden = false;
        bar.setAttribute('aria-hidden', 'false');
        document.documentElement.classList.add('ems-mobile-has-subnav');
        subs.forEach(function (s) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'ems-msub-item' + (s.active ? ' active' : '');
            b.setAttribute('data-panel', s.panelId || '');
            b.innerHTML = '<i class="' + s.iconClass + '" aria-hidden="true"></i><span>' + escapeHtml(s.label) + '</span>';
            b.addEventListener('click', function () {
                if (s.el) s.el.click();
                bar.querySelectorAll('.ems-msub-item').forEach(function (x) { x.classList.remove('active'); });
                b.classList.add('active');
                writeNavState(activeMajorTabId, s.panelId || '');
            });
            bar.appendChild(b);
        });
    }

    function setActiveBottomNav(key) {
        var nav = document.getElementById('ems-mobile-bottom-nav');
        if (!nav) return;
        nav.querySelectorAll('.ems-bnav-item').forEach(function (btn) {
            var k = btn.getAttribute('data-bnav');
            btn.classList.toggle('active', k === key);
        });
    }

    function selectMajorModule(tabId, opts) {
        opts = opts || {};
        closeModulesMenu();
        if (!clickTab(tabId)) {
            if (tabId !== 'tab-dashboard') selectMajorModule('tab-dashboard', { restore: false });
            return;
        }
        activeMajorTabId = tabId;
        updateHeaderTitle(tabId);
        renderSubmoduleBar(tabId);
        setActiveBottomNav('more');
        writeNavState(tabId, opts.subPanelId || '');
        if (opts.subPanelId) {
            setTimeout(function () {
                var subs = listSubmodules(modId);
                var hit = null;
                for (var i = 0; i < subs.length; i++) {
                    if (subs[i].panelId === opts.subPanelId) { hit = subs[i]; break; }
                }
                if (hit && hit.el) {
                    hit.el.click();
                    renderSubmoduleBar(tabId);
                }
            }, 80);
        }
    }

    function focusSearch() {
        var candidates = [
            '#reg-search-input', '#reg-search input', '.reg-search input',
            '#att-search', 'input[type="search"]', '.ems-global-search input'
        ];
        for (var i = 0; i < candidates.length; i++) {
            var el = document.querySelector(candidates[i]);
            if (el && el.offsetParent !== null) {
                el.focus();
                try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
                return;
            }
        }
        /* Fall back: open registration then focus search */
        if (clickTab('tab-admission')) {
            activeMajorTabId = 'tab-admission';
            updateHeaderTitle('tab-admission');
            renderSubmoduleBar('tab-admission');
            setTimeout(function () {
                var el2 = document.querySelector('#reg-search-input, .reg-search input');
                if (el2) el2.focus();
            }, 120);
        } else if (typeof global.showToast === 'function') {
            global.showToast('تلاش دستیاب نہیں', 'warning');
        }
    }

    function openDeptPicker() {
        var sel = document.getElementById('ems-dept-select');
        var wrap = document.getElementById('ems-dept-selector-wrap');
        if (sel) {
            try { sel.focus(); sel.click(); } catch (e) { /* ignore */ }
            if (wrap) wrap.classList.add('ems-dept-mobile-flash');
            return;
        }
        if (typeof global.showToast === 'function') {
            global.showToast('شعبہ منتخب نہیں', 'warning');
        }
    }

    function openAlerts() {
        selectMajorModule('tab-announcements');
    }

    function wireChrome() {
        var header = document.getElementById('ems-mobile-app-header');
        if (header && header.getAttribute('data-wired') !== '1') {
            header.setAttribute('data-wired', '1');
        }
        var backdrop = document.getElementById('ems-mobile-modules-backdrop');
        if (backdrop && backdrop.getAttribute('data-wired') !== '1') {
            backdrop.setAttribute('data-wired', '1');
            backdrop.addEventListener('click', closeModulesMenu);
        }
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && menuOpen) closeModulesMenu();
        });

        /* Android hardware back: close More menu first; otherwise exit app */
        try {
            var CapApp = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.App;
            if (CapApp && typeof CapApp.addListener === 'function'
                && document.documentElement.getAttribute('data-ems-back-wired') !== '1') {
                document.documentElement.setAttribute('data-ems-back-wired', '1');
                CapApp.addListener('backButton', function () {
                    if (isPhoneLayout() && menuOpen) {
                        closeModulesMenu();
                        return;
                    }
                    if (typeof CapApp.exitApp === 'function') CapApp.exitApp();
                });
            }
        } catch (eBack) { /* ignore */ }

        var nav = document.getElementById('ems-mobile-bottom-nav');
        if (nav && nav.getAttribute('data-wired') !== '1') {
            nav.setAttribute('data-wired', '1');
            nav.addEventListener('click', function (e) {
                var btn = e.target.closest('.ems-bnav-item');
                if (!btn) return;
                var key = btn.getAttribute('data-bnav');
                if (key === 'more') {
                    setActiveBottomNav('more');
                    toggleModulesMenu();
                }
            });
        }

        document.querySelectorAll('.ribbon-tab').forEach(function (tab) {
            if (tab.getAttribute('data-ems-mobile-hook') === '1') return;
            tab.setAttribute('data-ems-mobile-hook', '1');
            tab.addEventListener('click', function () {
                if (!isPhoneLayout()) return;
                activeMajorTabId = tab.id;
                updateHeaderTitle(tab.id);
                renderSubmoduleBar(tab.id);
                closeModulesMenu();
                setActiveBottomNav('more');
                writeNavState(tab.id, '');
            });
        });
    }

    function wireHomeShortcuts() {
        var home = document.getElementById('ems-mobile-home');
        if (!home || home.getAttribute('data-wired') === '1') return;
        home.setAttribute('data-wired', '1');
        home.addEventListener('click', function (e) {
            var t = e.target.closest('[data-tab]');
            if (!t) return;
            var id = t.getAttribute('data-tab');
            if (id) selectMajorModule(id);
        });
    }

    function syncMobileKpis() {
        var pairs = [
            ['dash-total-students', 'ems-m-kpi-students'],
            ['dash-total-teachers', 'ems-m-kpi-teachers'],
            ['dash-att-present', 'ems-m-kpi-present'],
            ['dash-fin-net', 'ems-m-kpi-balance']
        ];
        pairs.forEach(function (p) {
            var src = document.getElementById(p[0]);
            var dst = document.getElementById(p[1]);
            if (src && dst) dst.textContent = src.textContent || '0';
        });
        var nameEl = document.getElementById('ems-m-home-name');
        if (nameEl) {
            var m = (global.CURRENT_MADRASA_DATA && global.CURRENT_MADRASA_DATA.madrasaName)
                || 'تعلیمی ادارہ';
            nameEl.textContent = m;
        }
    }

    function ensureFilterDetailsMode() {
        var d = document.getElementById('ems-dash-filter-details');
        if (!d) return;
        if (isPhoneLayout()) d.removeAttribute('open');
        else d.setAttribute('open', '');
    }

    function restoreNavState() {
        if (!isPhoneLayout()) return;
        clearForeignNavKeys();
        var st = readNavState();
        if (!st || !st.majorTabId) {
            updateHeaderTitle(activeMajorTabId);
            renderSubmoduleBar(activeMajorTabId);
            return;
        }
        var tab = document.getElementById(st.majorTabId);
        if (!tab || !isTabPermitted(tab)) {
            selectMajorModule('tab-dashboard');
            return;
        }
        selectMajorModule(st.majorTabId, { subPanelId: st.subPanelId || '' });
    }

    function boot() {
        wireChrome();
        wireHomeShortcuts();
        syncMobileKpis();
        ensureFilterDetailsMode();
        if (isPhoneLayout()) {
            document.documentElement.classList.add('ems-phone-shell');
            updateHeaderTitle(activeMajorTabId);
            renderSubmoduleBar(activeMajorTabId);
        } else {
            document.documentElement.classList.remove('ems-phone-shell');
            document.documentElement.classList.remove('ems-mobile-has-subnav');
            closeModulesMenu();
        }
    }

    function onAuthReady() {
        if (!isPhoneLayout()) return;
        setTimeout(restoreNavState, 300);
    }

    global.emsSyncMobileHomeKpis = syncMobileKpis;
    global.emsMobileClickTab = clickTab;
    global.emsMobileOpenModulesMenu = openModulesMenu;
    global.emsMobileCloseModulesMenu = closeModulesMenu;
    global.emsMobileListPermittedModules = listPermittedMajorModules;
    global.emsMobileSelectMajor = selectMajorModule;
    global.emsMobileModuleStatus = MODULE_STATUS;

    var _origUpdate = null;
    function hookDashboardUpdates() {
        if (typeof global.updateMasterDashboard === 'function' && !global.updateMasterDashboard.__emsMobileHooked) {
            _origUpdate = global.updateMasterDashboard;
            global.updateMasterDashboard = function () {
                var r = _origUpdate.apply(this, arguments);
                try { syncMobileKpis(); } catch (e) { /* ignore */ }
                return r;
            };
            global.updateMasterDashboard.__emsMobileHooked = true;
        }
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                boot();
                setTimeout(hookDashboardUpdates, 500);
                setInterval(syncMobileKpis, 4000);
                setTimeout(onAuthReady, 1200);
            });
        } else {
            boot();
            setTimeout(hookDashboardUpdates, 500);
            setInterval(syncMobileKpis, 4000);
            setTimeout(onAuthReady, 1200);
        }
        if (typeof window !== 'undefined' && window.matchMedia) {
            try {
                window.matchMedia('(max-width: 768px)').addEventListener('change', boot);
            } catch (eMq) { /* older WebView */ }
        }
        window.addEventListener('resize', function () {
            if (menuOpen) positionModulesMenu();
        });
        document.addEventListener('ems-auth-ready', onAuthReady);
        document.addEventListener('ems-tenant-ready', onAuthReady);
    }
})(typeof window !== 'undefined' ? window : globalThis);
