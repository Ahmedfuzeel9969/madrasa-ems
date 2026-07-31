// ============================================================================
// Registration Mobile Usability — Sprint 6
// Viewport helpers, section navigation, mobile list cards, touch-friendly UX
// ============================================================================
(function (global) {
    'use strict';

    var BP_MOBILE = 768;
    var BP_TABLET = 992;
    var BP_SMALL = 480;

    function getViewport() {
        var w = global.innerWidth || 1024;
        return {
            width: w,
            isSmallPhone: w <= BP_SMALL,
            isMobile: w <= BP_MOBILE,
            isTablet: w > BP_MOBILE && w <= BP_TABLET,
            isTouch: !!(global.matchMedia && global.matchMedia('(pointer: coarse)').matches)
                || ('ontouchstart' in global)
        };
    }

    function applyBodyClasses() {
        var doc = global.document;
        if (!doc || !doc.body) return;
        var vp = getViewport();
        doc.body.classList.toggle('ems-reg-mobile', vp.isMobile);
        doc.body.classList.toggle('ems-reg-tablet', vp.isTablet);
        doc.body.classList.toggle('ems-reg-small-phone', vp.isSmallPhone);
        doc.body.classList.toggle('ems-reg-touch', vp.isTouch);
    }

    function buildSectionNav(panel) {
        if (!panel || panel._regSecNavBuilt) return;
        var heads = panel.querySelectorAll('.reg-acc-head');
        if (!heads.length) return;

        var nav = document.createElement('nav');
        nav.className = 'reg-sec-nav';
        nav.setAttribute('aria-label', 'Form sections');

        Array.prototype.forEach.call(heads, function (h) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'reg-sec-nav-btn';
            var label = (h.textContent || '').replace(/\s+/g, ' ').trim();
            btn.textContent = label.length > 28 ? label.slice(0, 26) + '…' : label;
            btn.title = label;
            btn.addEventListener('click', function () {
                var item = h.closest('.reg-acc-item');
                if (item && !item.classList.contains('open')) item.classList.add('open');
                try {
                    h.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } catch (e) {
                    h.scrollIntoView(true);
                }
            });
            nav.appendChild(btn);
        });

        var card = panel.querySelector('.premium-card');
        if (card) {
            var shell = card.querySelector('.reg-form-shell');
            if (shell && shell.nextSibling) {
                card.insertBefore(nav, shell.nextSibling);
            } else {
                var header = card.querySelector('.reg-form-header');
                if (header && header.nextSibling) {
                    card.insertBefore(nav, header.nextSibling);
                } else {
                    card.insertBefore(nav, card.firstChild);
                }
            }
        }
        panel._regSecNavBuilt = true;
    }

    function buildAllSectionNavs() {
        var panels = global.document.querySelectorAll('#module-admission .reg-panel');
        Array.prototype.forEach.call(panels, buildSectionNav);
    }

    function toggleListContainers(mobile) {
        var savedCards = global.document.getElementById('reg-list-cards');
        var savedTable = global.document.querySelector('#reg-list-panel .reg-desktop-table');
        var rejCards = global.document.getElementById('reg-rejected-cards');
        var rejTable = global.document.querySelector('#reg-rejected-panel .reg-desktop-table');

        if (savedCards) savedCards.hidden = !mobile;
        if (savedTable) savedTable.hidden = !!mobile;
        if (rejCards) rejCards.hidden = !mobile;
        if (rejTable) rejTable.hidden = !!mobile;
    }

    function syncSavedList(users) {
        var cardsEl = global.document.getElementById('reg-list-cards');
        if (!cardsEl) return;
        var vp = getViewport();
        toggleListContainers(vp.isMobile);
        if (!vp.isMobile) {
            cardsEl.innerHTML = '';
            return;
        }
        if (!users || !users.length) {
            cardsEl.innerHTML = '<p class="reg-m-empty">کوئی ریکارڈ موجود نہیں</p>';
            return;
        }
        if (typeof global.renderRegMobileCardHtml !== 'function') return;
        cardsEl.innerHTML = users.map(function (u) {
            return global.renderRegMobileCardHtml(u);
        }).join('');
        if (typeof global.emsRegApplyTableActionGuards === 'function') {
            global.emsRegApplyTableActionGuards(cardsEl);
        }
    }

    function syncRejectedList(users) {
        var cardsEl = global.document.getElementById('reg-rejected-cards');
        if (!cardsEl) return;
        var vp = getViewport();
        if (!vp.isMobile) {
            cardsEl.innerHTML = '';
            return;
        }
        if (!users || !users.length) {
            cardsEl.innerHTML = '<p class="reg-m-empty">کوئی مسترد شدہ ریکارڈ موجود نہیں</p>';
            return;
        }
        if (typeof global.renderRegRejectedMobileCardHtml !== 'function') return;
        cardsEl.innerHTML = users.map(function (u) {
            return global.renderRegRejectedMobileCardHtml(u);
        }).join('');
        if (typeof global.emsRegApplyTableActionGuards === 'function') {
            global.emsRegApplyTableActionGuards(cardsEl);
        }
    }

    function onViewportChange() {
        applyBodyClasses();
        if (typeof global.renderRegTable === 'function' && global.currentRegType === 'list') {
            global.renderRegTable();
        }
        if (typeof global.renderRejectedTable === 'function' && global.currentRegType === 'rejected') {
            global.renderRejectedTable();
        }
    }

    var _resizeTimer = null;
    function debouncedResize() {
        if (_resizeTimer) clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(onViewportChange, 120);
    }

    function init() {
        applyBodyClasses();
        buildAllSectionNavs();
        if (typeof global.addEventListener === 'function') {
            global.addEventListener('resize', debouncedResize);
            global.addEventListener('orientationchange', debouncedResize);
        }
    }

    global.emsRegMobileGetViewport = getViewport;
    global.emsRegMobileApplyClasses = applyBodyClasses;
    global.emsRegMobileBuildSectionNav = buildSectionNav;
    global.emsRegMobileBuildAllSectionNavs = buildAllSectionNavs;
    global.emsRegMobileSyncSavedList = syncSavedList;
    global.emsRegMobileSyncRejectedList = syncRejectedList;
    global.emsRegMobileInit = init;
    global.emsRegMobileIsMobile = function () { return getViewport().isMobile; };

    if (global.document && global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
