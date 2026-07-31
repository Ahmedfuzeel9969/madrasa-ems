import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadShell(opts) {
    opts = opts || {};
    var tabs = opts.tabs || {
        'tab-dashboard': { id: 'tab-dashboard', display: '', text: ' ڈیش بورڈ ', icon: 'fas fa-chart-pie' },
        'tab-admission': { id: 'tab-admission', display: '', text: ' رجسٹریشن ', icon: 'fas fa-user-plus' },
        'tab-attendance': { id: 'tab-attendance', display: '', text: ' حاضری ', icon: 'fas fa-calendar-check' },
        'tab-superadmin': { id: 'tab-superadmin', display: 'none', text: ' سپر ایڈمن ', icon: 'fas fa-user-shield' },
        'tab-finance': { id: 'tab-finance', display: '', text: ' فیس سسٹم ', icon: 'fas fa-money-bill-wave' }
    };
    var allowed = opts.allowed || {
        dashboard: true, admission: true, attendance: true, finance: true, superadmin: false
    };
    var store = Object.create(null);
    var clicked = [];
    var modulesListEl = { innerHTML: '', appendChild: function (c) { this._kids = this._kids || []; this._kids.push(c); } };
    var subnavEl = {
        hidden: true, innerHTML: '',
        setAttribute: function () {},
        querySelectorAll: function () { return []; },
        appendChild: function (c) { this._kids = this._kids || []; this._kids.push(c); }
    };
    var titleEl = { textContent: '' };
    var menuEl = {
        classList: { _c: new Set(), add: function (k) { this._c.add(k); }, remove: function (k) { this._c.delete(k); }, contains: function (k) { return this._c.has(k); } },
        style: {},
        setAttribute: function () {},
        getBoundingClientRect: function () { return { left: 40, width: 260, top: 80, bottom: 400, right: 300 }; }
    };
    var btnEl = {
        getBoundingClientRect: function () { return { top: 40, bottom: 88, left: 300, right: 348, width: 48, height: 48 }; },
        setAttribute: function () {},
        getAttribute: function () { return null; }
    };
    var backdropEl = {
        classList: { _c: new Set(), add: function (k) { this._c.add(k); }, remove: function (k) { this._c.delete(k); } },
        setAttribute: function () {},
        getAttribute: function () { return null; },
        addEventListener: function () {}
    };

    function makeTab(meta) {
        return {
            id: meta.id,
            style: { display: meta.display },
            textContent: meta.text,
            classList: { contains: function () { return false; } },
            querySelector: function () {
                return { className: meta.icon };
            },
            cloneNode: function () {
                return {
                    textContent: meta.text,
                    querySelectorAll: function () { return []; }
                };
            },
            click: function () { clicked.push(meta.id); },
            getAttribute: function () { return null; },
            setAttribute: function () {},
            addEventListener: function () {}
        };
    }

    var tabNodes = {};
    Object.keys(tabs).forEach(function (id) { tabNodes[id] = makeTab(tabs[id]); });

    var g = {
        innerWidth: 390,
        innerHeight: 800,
        localStorage: {
            getItem: function (k) { return store[k] || null; },
            setItem: function (k, v) { store[k] = String(v); },
            removeItem: function (k) { delete store[k]; },
            key: function (i) { return Object.keys(store)[i] || null; },
            get length() { return Object.keys(store).length; }
        },
        CURRENT_MADRASA_TENANT_ID: opts.tenantId || 'madrasa_a',
        CURRENT_MADRASA_DATA: { madrasaName: 'ٹیسٹ' },
        firebase: { auth: function () { return { currentUser: { uid: opts.uid || 'uid_a' } }; } },
        isModuleTabAllowed: function (modId) { return !!allowed[modId]; },
        navigateToModule: function (tab) { clicked.push(tab.id); },
        sysLayoutGetConfig: function () {
            return { ribbon: { order: ['dashboard', 'admission', 'attendance', 'finance', 'superadmin'], hidden: [] } };
        },
        sysLayoutGetRibbonLabels: function () {
            return { dashboard: 'ڈیش بورڈ', admission: 'رجسٹریشن', attendance: 'حاضری', finance: 'فیس', superadmin: 'سپر ایڈمن' };
        },
        sysLayoutGetModuleMenus: function () {
            return { admission: '#reg-ribbon-menu', attendance: '#att-ribbon-menu' };
        },
        matchMedia: function (q) {
            return {
                matches: String(q).indexOf('768') >= 0,
                addEventListener: function () {}
            };
        },
        requestAnimationFrame: function (fn) { fn(); },
        addEventListener: function () {},
        document: {
            readyState: 'complete',
            documentElement: { classList: { _c: new Set(), add: function (k) { this._c.add(k); }, remove: function (k) { this._c.delete(k); }, contains: function (k) { return this._c.has(k); } } },
            body: { classList: { add: function () {}, remove: function () {} } },
            getElementById: function (id) {
                if (tabNodes[id]) return tabNodes[id];
                if (id === 'ems-mobile-modules-list') return modulesListEl;
                if (id === 'ems-mobile-subnav') return subnavEl;
                if (id === 'ems-mobile-current-module') return titleEl;
                if (id === 'ems-mobile-modules-menu') return menuEl;
                if (id === 'ems-mobile-more-btn') return btnEl;
                if (id === 'ems-mobile-modules-backdrop') return backdropEl;
                if (id === 'ems-mobile-app-header') return { getAttribute: function () { return '1'; }, setAttribute: function () {} };
                if (id === 'ems-mobile-bottom-nav') return {
                    getAttribute: function () { return '1'; },
                    setAttribute: function () {},
                    querySelectorAll: function () { return []; },
                    addEventListener: function () {}
                };
                if (id === 'ems-mobile-home') return { getAttribute: function () { return '1'; }, setAttribute: function () {}, addEventListener: function () {} };
                if (id === 'ems-dash-filter-details') return { removeAttribute: function () {}, setAttribute: function () {} };
                if (id.indexOf('module-') === 0) return { id: id };
                return null;
            },
            querySelector: function (sel) {
                if (sel === '#reg-ribbon-menu') {
                    return {
                        querySelectorAll: function () {
                            return [
                                {
                                    style: { display: '' }, textContent: 'طلباء', classList: { contains: function () { return true; } },
                                    getAttribute: function (n) { return n === 'onclick' ? "switchRegTab('reg-student-panel', this)" : null; },
                                    querySelector: function () { return { className: 'fas fa-user' }; },
                                    click: function () { clicked.push('sub-student'); }
                                },
                                {
                                    style: { display: 'none' }, textContent: 'مخفی', classList: { contains: function () { return false; } },
                                    getAttribute: function () { return null; },
                                    querySelector: function () { return null; }
                                }
                            ];
                        }
                    };
                }
                return null;
            },
            querySelectorAll: function (sel) {
                if (sel === '.ribbon-tab[id^="tab-"]' || sel === '.ribbon-tab') {
                    return Object.keys(tabNodes).map(function (k) { return tabNodes[k]; });
                }
                return [];
            },
            addEventListener: function () {},
            createElement: function (tag) {
                var el = {
                    tagName: tag,
                    style: {},
                    className: '',
                    innerHTML: '',
                    textContent: '',
                    children: [],
                    setAttribute: function (k, v) { this['data-' + k] = v; },
                    getAttribute: function (k) { return this['data-' + k] || null; },
                    addEventListener: function (type, fn) { this['on' + type] = fn; },
                    appendChild: function (c) { this.children.push(c); },
                    classList: {
                        _c: new Set(),
                        add: function (k) { this._c.add(k); },
                        remove: function (k) { this._c.delete(k); },
                        toggle: function (k, on) { if (on) this._c.add(k); else this._c.delete(k); },
                        contains: function (k) { return this._c.has(k); }
                    }
                };
                return el;
            }
        }
    };
    g.window = g;
    g.globalThis = g;
    g.document.defaultView = g;
    var ctx = { window: g, global: g, globalThis: g, document: g.document, localStorage: g.localStorage, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval, requestAnimationFrame: g.requestAnimationFrame };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'ems-mobile-shell.js'), 'utf8'), ctx);
    return { g: g, clicked: clicked, modulesListEl: modulesListEl, titleEl: titleEl, store: store, subnavEl: subnavEl };
}

describe('Mobile navigation redesign — three-dot + submodules', function () {
    it('shell builds modules from ribbon/RBAC, not a hardcoded four', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-mobile-shell.js'), 'utf8');
        expect(src).toContain('listPermittedMajorModules');
        expect(src).toContain('isModuleTabAllowed');
        expect(src).toContain('sysLayoutGetModuleMenus');
        expect(src).not.toMatch(/MORE_TABS\s*=\s*\[/);
        expect(src).toContain('ems_mobile_nav_v1');
    });

    it('index: no Home, no visible module title; More only + subnav strip', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('id="ems-mobile-subnav"');
        expect(html).toContain('id="ems-mobile-modules-menu"');
        expect(html).toContain('id="ems-mobile-more-btn"');
        expect(html).toContain('data-bnav="more"');
        expect(html).not.toContain('data-bnav="home"');
        expect(html).not.toContain('id="ems-mobile-modules-btn"');
        expect(html).not.toContain('id="ems-mobile-more-sheet"');
        expect(html).not.toContain('data-bnav="search"');
        expect(html).not.toContain('data-bnav="dept"');
        expect(html).not.toContain('data-bnav="alerts"');
        var headerBlock = html.slice(
            html.indexOf('id="ems-mobile-app-header"'),
            html.indexOf('class="main-content ems-app-shell"')
        );
        expect(headerBlock).toContain('hidden');
        expect(headerBlock).not.toContain('fa-ellipsis');
        var bnavBlock = html.slice(
            html.indexOf('id="ems-mobile-bottom-nav"'),
            html.indexOf('id="ems-mobile-modules-backdrop"')
        );
        expect(bnavBlock).toContain('data-bnav="more"');
        expect(bnavBlock).not.toContain('data-bnav="home"');
        expect((bnavBlock.match(/data-bnav=/g) || []).length).toBe(1);
    });

    it('layout builder exports MODULE_MENUS for mobile SSOT', function () {
        var src = fs.readFileSync(path.join(ROOT, 'sys-layout-builder.js'), 'utf8');
        expect(src).toContain('sysLayoutGetModuleMenus');
        expect(src).toContain('sysLayoutGetRibbonLabels');
    });

    it('lists only permitted modules (hides superadmin when disallowed)', function () {
        var env = loadShell();
        var list = env.g.emsMobileListPermittedModules();
        var ids = list.map(function (m) { return m.modId; });
        expect(ids).toContain('dashboard');
        expect(ids).toContain('admission');
        expect(ids).toContain('attendance');
        expect(ids).toContain('finance');
        expect(ids).not.toContain('superadmin');
    });

    it('selecting a major module navigates and fills submodule strip', function () {
        var env = loadShell();
        env.g.emsMobileSelectMajor('tab-admission');
        expect(env.clicked).toContain('tab-admission');
        expect(env.subnavEl.hidden).toBe(false);
        expect((env.subnavEl._kids || []).length).toBeGreaterThan(0);
    });

    it('builds submodule strip from live tabs even when parent topbar is CSS-hidden', function () {
        var env = loadShell();
        /* Simulate phone-hidden ancestor: getComputedStyle would say display:none */
        env.g.getComputedStyle = function () { return { display: 'none' }; };
        env.g.emsMobileSelectMajor('tab-admission');
        expect(env.subnavEl.hidden).toBe(false);
        expect((env.subnavEl._kids || []).length).toBeGreaterThan(0);
        expect(env.g.document.documentElement.classList.contains('ems-mobile-has-subnav')).toBe(true);
    });

    it('Dashboard hides submodule strip; submodule chip clicks live tab (no blank route)', function () {
        var env = loadShell();
        env.g.emsMobileSelectMajor('tab-dashboard');
        expect(env.subnavEl.hidden).toBe(true);
        expect(env.g.document.documentElement.classList.contains('ems-mobile-has-subnav')).toBe(false);

        env.g.emsMobileSelectMajor('tab-admission');
        expect(env.subnavEl.hidden).toBe(false);
        var chip = (env.subnavEl._kids || [])[0];
        expect(chip).toBeTruthy();
        expect(typeof chip.onclick).toBe('function');
        chip.onclick({ preventDefault: function () {} });
        expect(env.clicked).toContain('sub-student');
    });

    it('More is sole major-module entry; MODULE_MENUS cover key modules with horizontal strip CSS', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('id="ems-mobile-more-btn"');
        expect(html).not.toContain('id="ems-mobile-modules-btn"');
        var headerBlock = html.slice(
            html.indexOf('id="ems-mobile-app-header"'),
            html.indexOf('class="main-content ems-app-shell"')
        );
        expect(headerBlock).not.toContain('fa-ellipsis');

        var layout = fs.readFileSync(path.join(ROOT, 'sys-layout-builder.js'), 'utf8');
        [
            "#reg-ribbon-menu", "#att-ribbon-menu", "#cmp-ribbon-menu", "#exam-ribbon-menu",
            "#cur-ribbon-menu", "#tar-ribbon-menu", "#fin-ribbon-menu", "#ldg-ribbon-menu",
            "#ann-ribbon-menu", "#sys-ribbon-menu", "#sa-ribbon-menu"
        ].forEach(function (sel) {
            expect(layout).toContain(sel);
        });
        expect(layout).toContain("'sys-settings': '#sys-ribbon-menu'");
        expect(layout).toContain("superadmin: '#sa-ribbon-menu'");

        var css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
        expect(css).toContain('overflow-x: auto');
        expect(css).toContain('overflow-y: hidden');
        expect(css).toContain('white-space: nowrap');
        expect(css).toContain('scroll-behavior: smooth');
        expect(css).toContain('-webkit-overflow-scrolling: touch');
    });

    it('scopes nav persistence by uid + madrasaId', function () {
        var env = loadShell({ uid: 'uid_a', tenantId: 'madrasa_a' });
        env.g.emsMobileSelectMajor('tab-attendance');
        var key = 'ems_mobile_nav_v1:uid_a:madrasa_a';
        expect(env.store[key]).toBeTruthy();
        var parsed = JSON.parse(env.store[key]);
        expect(parsed.majorTabId).toBe('tab-attendance');
    });

    it('CSS keeps modules popover compact (not full-screen sheet)', function () {
        var css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
        expect(css).toContain('ems-mobile-modules-menu');
        expect(css).toContain('max-width: min(320px');
        expect(css).toContain('max-height: 70vh');
        expect(css).toContain('ems-mobile-subnav');
        expect(css).not.toContain('ems-mobile-more-sheet');
    });

    it('Phase 1 workspace: hides ribbon and docks subnav above bottom nav', function () {
        var css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
        var shell = fs.readFileSync(path.join(ROOT, 'ems-mobile-shell.js'), 'utf8');
        expect(css).toMatch(/html\.ems-phone-shell\s+\.ribbon-wrapper\s*\{[^}]*display:\s*none/s);
        expect(css).toContain('body.ems-authenticated .ribbon-wrapper');
        expect(css).toContain('bottom: calc(52px + env(safe-area-inset-bottom');
        expect(css).toMatch(/\.ems-mobile-app-header\s*\{[^}]*display:\s*none\s*!important/s);
        expect(shell).not.toContain("key === 'home'");
        expect(shell).not.toContain("setActiveBottomNav('home')");
        expect(css).toContain('overflow-x: auto');
        expect(css).toContain('scroll-behavior: smooth');
        expect(css).toContain('-webkit-overflow-scrolling: touch');
        expect(css).toContain('flex-shrink: 0');
        expect(css).toContain('min-height: 44px');
        expect(css).not.toContain('.ems-mobile-modules-btn');
        expect(shell).not.toContain('getComputedStyle(btn)');
        expect(shell).toContain('parent .reg-topbar is display:none on phone');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        var headerIdx = html.indexOf('id="ems-mobile-app-header"');
        var subIdx = html.indexOf('id="ems-mobile-subnav"');
        var bnavIdx = html.indexOf('id="ems-mobile-bottom-nav"');
        expect(headerIdx).toBeGreaterThan(-1);
        expect(subIdx).toBeGreaterThan(headerIdx);
        expect(bnavIdx).toBeGreaterThan(subIdx);
        expect(shell).toContain('کلاؤڈ سنک');
        expect(shell).toContain('سائن آؤٹ');
        expect(shell).toContain('شعبہ تبدیل کریں');
        expect(shell).toContain("label: 'تلاش'");
        expect(shell).toContain("label: 'اطلاعات'");
        expect(shell).toContain('ems-mobile-more-btn');
        expect(shell).not.toContain('ems-mobile-modules-btn');
        expect(shell).not.toContain("key === 'search'");
        expect(shell).not.toContain("key === 'dept'");
        expect(shell).not.toContain("key === 'alerts'");
    });
});
