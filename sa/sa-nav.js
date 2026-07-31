/**
 * sa-nav.js — Two-tier Super Admin navigation (Main categories + Sub tabs)
 */
(function (global) {
    'use strict';

    var SA_CATEGORIES = {
        dashboard: {
            label: 'ڈیش بورڈ',
            icon: 'fa-chart-line',
            defaultPanel: 'sa-win-dashboard',
            tabs: [
                { panel: 'sa-win-dashboard', label: 'مانیٹرنگ و تجزیہ', icon: 'fa-tachometer-alt' }
            ]
        },
        operations: {
            label: 'آپریشنز',
            icon: 'fa-briefcase',
            defaultPanel: 'sa-win-tenants',
            tabs: [
                { panel: 'sa-win-tenants', label: 'مدرسے', icon: 'fa-mosque' },
                { panel: 'sa-win-billing', label: 'سبسکرپشن', icon: 'fa-file-invoice-dollar' },
                { panel: 'sa-win-users', label: 'صارفین', icon: 'fa-users' }
            ]
        },
        settings: {
            label: 'سیٹنگز',
            icon: 'fa-sliders-h',
            defaultPanel: 'sa-win-system',
            tabs: [
                { panel: 'sa-win-system', label: 'سسٹم کنٹرول', icon: 'fa-cogs' }
            ]
        },
        reports: {
            label: 'رپورٹس',
            icon: 'fa-clipboard-list',
            defaultPanel: 'sa-win-audit',
            tabs: [
                { panel: 'sa-win-audit', label: 'آڈٹ لاگ', icon: 'fa-history' },
                { panel: 'sa-win-admins', label: 'ایڈمنز', icon: 'fa-user-lock' },
                { panel: 'sa-win-security', label: 'سیکیورٹی', icon: 'fa-shield-alt' },
                { panel: 'sa-win-advisor', label: 'Platform Advisor', icon: 'fa-robot' }
            ]
        }
    };

    var PANEL_TO_CATEGORY = {};
    Object.keys(SA_CATEGORIES).forEach(function (catId) {
        SA_CATEGORIES[catId].tabs.forEach(function (tab) {
            PANEL_TO_CATEGORY[tab.panel] = catId;
        });
    });

    global.SA_ACTIVE_CATEGORY = 'dashboard';

    function esc(val) {
        if (global.EmsUtils && global.EmsUtils.sanitize) return global.EmsUtils.sanitize(val);
        return String(val == null ? '' : val);
    }

    function renderMainNav() {
        var main = document.getElementById('sa-main-nav');
        if (!main) return;
        var html = '';
        Object.keys(SA_CATEGORIES).forEach(function (catId) {
            var cat = SA_CATEGORIES[catId];
            var active = global.SA_ACTIVE_CATEGORY === catId ? ' active-sa-main' : '';
            html += '<button type="button" class="sa-main-tab' + active + '" data-sa-category="' + catId + '" onclick="window.saSwitchCategory(\'' + catId + '\', this)">';
            html += '<i class="fas ' + esc(cat.icon) + '"></i> ' + esc(cat.label);
            html += '</button>';
        });
        html += '<span class="reg-tabs-sep"></span>';
        html += '<button type="button" class="sa-main-tab sa-main-refresh" onclick="window.saRefreshAllPanels()"><i class="fas fa-sync-alt"></i> ریفریش</button>';
        main.innerHTML = html;
    }

    function renderSubNav(categoryId) {
        var menu = document.getElementById('sa-ribbon-menu');
        if (!menu) return;
        var cat = SA_CATEGORIES[categoryId];
        if (!cat) return;

        var html = '';
        cat.tabs.forEach(function (tab) {
            var active = global.SA_ACTIVE_PANEL === tab.panel ? ' active-sub-tab' : '';
            html += '<button type="button" class="reg-tab' + active + '" data-sa-panel="' + tab.panel + '" onclick="window.switchSaTab(\'' + tab.panel + '\', this)">';
            html += '<i class="fas ' + esc(tab.icon) + '"></i> ' + esc(tab.label);
            html += '</button>';
        });
        menu.innerHTML = html;

        if (global.SaCore && typeof global.SaCore.applyTabVisibility === 'function') {
            global.SaCore.applyTabVisibility();
        }
    }

    global.saSwitchCategory = function (categoryId, btn) {
        if (!SA_CATEGORIES[categoryId]) return;
        global.SA_ACTIVE_CATEGORY = categoryId;

        document.querySelectorAll('#sa-main-nav .sa-main-tab[data-sa-category]').forEach(function (el) {
            el.classList.remove('active-sa-main');
        });
        if (btn) btn.classList.add('active-sa-main');
        else {
            var fallback = document.querySelector('#sa-main-nav [data-sa-category="' + categoryId + '"]');
            if (fallback) fallback.classList.add('active-sa-main');
        }

        renderSubNav(categoryId);
        var cat = SA_CATEGORIES[categoryId];
        var targetPanel = cat.defaultPanel;
        var firstVisible = menuFirstVisiblePanel();
        if (firstVisible) targetPanel = firstVisible;

        var subBtn = document.querySelector('#sa-ribbon-menu [data-sa-panel="' + targetPanel + '"]');
        if (typeof global.saSwitchPanel === 'function') {
            global.saSwitchPanel(targetPanel, subBtn);
        }
    };

    function menuFirstVisiblePanel() {
        var menu = document.getElementById('sa-ribbon-menu');
        if (!menu) return null;
        var btn = menu.querySelector('[data-sa-panel]:not([style*="display: none"]):not([disabled])');
        return btn ? btn.getAttribute('data-sa-panel') : null;
    }

    global.saNavForPanel = function (panelId) {
        return PANEL_TO_CATEGORY[panelId] || 'dashboard';
    };

    global.saInitNavigation = function () {
        renderMainNav();
        var panel = global.SA_ACTIVE_PANEL || 'sa-win-dashboard';
        global.SA_ACTIVE_CATEGORY = PANEL_TO_CATEGORY[panel] || 'dashboard';
        renderSubNav(global.SA_ACTIVE_CATEGORY);

        document.querySelectorAll('#sa-main-nav .sa-main-tab[data-sa-category]').forEach(function (el) {
            el.classList.toggle('active-sa-main', el.getAttribute('data-sa-category') === global.SA_ACTIVE_CATEGORY);
        });
    };

    global.saSyncNavToPanel = function (panelId) {
        var cat = PANEL_TO_CATEGORY[panelId];
        if (!cat || cat === global.SA_ACTIVE_CATEGORY) return;
        global.SA_ACTIVE_CATEGORY = cat;
        document.querySelectorAll('#sa-main-nav .sa-main-tab[data-sa-category]').forEach(function (el) {
            el.classList.toggle('active-sa-main', el.getAttribute('data-sa-category') === cat);
        });
        renderSubNav(cat);
        var subBtn = document.querySelector('#sa-ribbon-menu [data-sa-panel="' + panelId + '"]');
        if (subBtn) {
            document.querySelectorAll('#sa-ribbon-menu .reg-tab[data-sa-panel]').forEach(function (b) {
                b.classList.remove('active-sub-tab');
            });
            subBtn.classList.add('active-sub-tab');
        }
    };

    global.SaNav = {
        categories: SA_CATEGORIES,
        panelToCategory: PANEL_TO_CATEGORY,
        renderMainNav: renderMainNav,
        renderSubNav: renderSubNav
    };
})(typeof window !== 'undefined' ? window : globalThis);
