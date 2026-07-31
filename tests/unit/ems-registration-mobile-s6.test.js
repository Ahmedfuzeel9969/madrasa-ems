import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadMobileModule(width) {
    var g = {
        innerWidth: width || 1024,
        document: {
            body: { classList: { _c: new Set(), toggle: function (k, v) { if (v) this._c.add(k); else this._c.delete(k); }, contains: function (k) { return this._c.has(k); } } },
            readyState: 'complete',
            querySelectorAll: function () { return []; },
            getElementById: function () { return null; },
            addEventListener: function () {}
        },
        addEventListener: function () {},
        matchMedia: function (q) {
            return { matches: q.indexOf('coarse') >= 0 };
        }
    };
    var ctx = { global: g, window: g, globalThis: g, document: g.document, setTimeout: setTimeout, clearTimeout: clearTimeout };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'ems-registration-mobile.js'), 'utf8'), ctx);
    return g;
}

describe('Sprint 6 — Registration mobile usability', function () {
    it('mobile module exposes viewport and list sync API', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-registration-mobile.js'), 'utf8');
        expect(src).toContain('emsRegMobileGetViewport');
        expect(src).toContain('emsRegMobileSyncSavedList');
        expect(src).toContain('emsRegMobileBuildSectionNav');
        expect(src).toContain('emsRegMobileIsMobile');
    });

    it('lazy loader loads mobile module before admission.js', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-lazy-loader.js'), 'utf8');
        var mobile = src.indexOf('ems-registration-mobile.js');
        var admission = src.indexOf("'admission.js'");
        expect(mobile).toBeGreaterThan(-1);
        expect(admission).toBeGreaterThan(mobile);
    });

    it('detects mobile viewport at 768px and below', function () {
        var desktop = loadMobileModule(1200);
        expect(desktop.emsRegMobileGetViewport().isMobile).toBe(false);
        var phone = loadMobileModule(390);
        expect(phone.emsRegMobileGetViewport().isMobile).toBe(true);
        expect(phone.emsRegMobileGetViewport().isSmallPhone).toBe(true);
    });

    it('detects tablet viewport between 769 and 992', function () {
        var tablet = loadMobileModule(820);
        var vp = tablet.emsRegMobileGetViewport();
        expect(vp.isMobile).toBe(false);
        expect(vp.isTablet).toBe(true);
    });

    it('style.css includes Sprint 6 mobile registration rules', function () {
        var css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
        expect(css).toContain('Registration Mobile Usability (Sprint 6)');
        expect(css).toContain('.reg-form-header');
        expect(css).toContain('.reg-mobile-cards');
        expect(css).toContain('.reg-sec-nav');
        expect(css).toContain('.reg-m-action-btn');
        expect(css).toContain('min-height:44px');
    });

    it('index.html uses mobile-friendly form headers and card containers', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('reg-form-header');
        expect(html).toContain('reg-photo-drop');
        expect(html).toContain('capture="environment"');
        expect(html).toContain('id="reg-list-cards"');
        expect(html).toContain('id="reg-rejected-cards"');
        expect(html).toContain('reg-decision-block');
    });

    it('admission.js exposes mobile card renderers', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(src).toContain('renderRegMobileCardHtml');
        expect(src).toContain('renderRegRejectedMobileCardHtml');
        expect(src).toContain('emsRegMobileSyncSavedList');
        expect(src).toContain('reg-m-action-btn');
    });

    it('parent portal uses mobile card layout classes', function () {
        var src = fs.readFileSync(path.join(ROOT, 'parent-portal.js'), 'utf8');
        expect(src).toContain('pp-student-card');
        expect(src).toContain('pp-view-grid');
    });

    it('registration-ui.js builds section nav on open', function () {
        var src = fs.readFileSync(path.join(ROOT, 'registration-ui.js'), 'utf8');
        expect(src).toContain('emsRegMobileBuildAllSectionNavs');
    });

    it('mobile card HTML includes labeled touch actions', function () {
        var admissionSrc = fs.readFileSync(path.join(ROOT, 'admission.js'), 'utf8');
        expect(admissionSrc).toContain('reg-m-card');
        expect(admissionSrc).toContain('data-reg-perm');
        expect(admissionSrc).toMatch(/ترمیم|کارڈ|خط/);
    });
});
