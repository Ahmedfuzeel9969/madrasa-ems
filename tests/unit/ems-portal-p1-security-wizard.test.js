import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CACHE = '20260908_portal_p1_security_wizard_v1';

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

describe('Portal P1 — security harden + parent wizard', function () {
    it('C12: staff role skips owner/admin fallback in checkStaffModuleAccess', function () {
        const src = read('security-layer.js');
        expect(src).toContain("CURRENT_USER_TENANT_ROLE === 'staff'");
        expect(src).toContain('P1/C12');
        expect(src).toContain('if (isStaffRole) return false');

        const auth = read('auth.js');
        const start = auth.indexOf('window.isMadrasaAdmin = function');
        expect(start).toBeGreaterThan(-1);
        const slice = auth.slice(start, start + 900);
        expect(slice).toContain("CURRENT_USER_TENANT_ROLE === 'staff'");
        expect(slice).toContain("CURRENT_USER_TENANT_ROLE === 'parent'");
    });

    it('C12 runtime: staff without grant cannot use CURRENT_MADRASA_DATA fallback', function () {
        const src = read('security-layer.js');
        const sandbox = {
            window: null,
            document: { addEventListener: function () {}, body: {} },
            firebase: {
                auth: function () { return { currentUser: null }; },
                functions: undefined
            },
            localStorage: {
                _data: {},
                getItem: function (k) { return this._data[k] || null; },
                setItem: function (k, v) { this._data[k] = String(v); }
            },
            console: console
        };
        sandbox.window = sandbox;
        sandbox.global = sandbox;
        sandbox.CURRENT_USER_TENANT_ROLE = 'staff';
        sandbox.CURRENT_MADRASA_DATA = { madrasaName: 'X' };
        sandbox.CURRENT_STAFF_LINK = {};
        sandbox.isSuperAdmin = function () { return false; };
        sandbox.isMadrasaAdmin = function () { return true; }; // should be ignored for staff
        vm.runInNewContext(src, sandbox);
        expect(sandbox.checkStaffModuleAccess('attendance', 'view')).toBe(false);
    });

    it('C7/C8: identity-gate fail-closed + no teacher/parent session short-circuit', function () {
        const src = read('identity-gate.js');
        expect(src).toContain('continueOrHaltOnSecurityFail');
        expect(src).toContain('policyRequiresMfa');
        expect(src).toContain('sessionAccessKeyOk');
        expect(src).toContain('accessKeyVerified');
        expect(src).toContain('P1/C7');
        const teacher = src.slice(src.indexOf('function handleTeacher'), src.indexOf('function handleParent'));
        expect(teacher).not.toMatch(/if \(global\.emsIsIdentityVerified\(user\)\) \{\s*completeTeacher/);
        const parent = src.slice(src.indexOf('function handleParent'), src.indexOf('global.emsRunIdentityGate'));
        expect(parent).not.toMatch(/if \(global\.emsIsIdentityVerified\(user\)\) \{\s*completeParent/);
        expect(src).toMatch(/proceedTeacherMfaGate[\s\S]{0,900}loadFailed/);
        expect(src).toMatch(/proceedParentMfaGate[\s\S]{0,900}loadFailed/);
        const trustedTeacher = src.slice(src.indexOf('function proceedTeacherTrustedGate'), src.indexOf('function proceedTeacherKeyGate'));
        expect(trustedTeacher).toContain('continueOrHaltOnSecurityFail(user, true');
        const trustedParent = src.slice(src.indexOf('function proceedParentTrustedGate'), src.indexOf('function proceedParentMfaGate'));
        expect(trustedParent).toContain('continueOrHaltOnSecurityFail(user, true');
    });

    it('C8: MFA CF failure returns loadFailed not fake compliant', function () {
        const src = read('security-mfa.js');
        expect(src).toContain('loadFailed: true');
        expect(src).toContain('emsGetCachedMfaPolicy');
        expect(src).not.toMatch(/catch\(function \(\) \{\s*return \{ compliant: true, skipped: true \}/);
    });

    it('C9: parent activate wizard Link + Views + Key', function () {
        const src = read('admin-panel.js');
        expect(src).toContain('apActivateParentWizard');
        expect(src).toContain('والدین فعال کریں (Link + Views + Key)');
        expect(src).toContain('wizard_activate');
        const html = read('index.html');
        expect(html).toContain('والدین فعال کریں');
    });

    it('cache bust matches P1 tag', function () {
        expect(read('ems-post-auth-loader.js')).toContain("CACHE_BUST = '" + CACHE + "'");
        expect(read('ems-lazy-loader.js')).toContain("CACHE_BUST = '" + CACHE + "'");
        expect(read('index.html')).toContain('auth.js?v=' + CACHE);
    });
});
