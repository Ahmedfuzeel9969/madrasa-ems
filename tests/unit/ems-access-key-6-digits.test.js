import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import { TextEncoder } from 'util';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

describe('Access key 6 digits + teacher unlock', function () {
    it('generates 6 numeric digits only', function () {
        const src = read('access-keys.js');
        const box = {
            crypto: {
                getRandomValues: function (arr) {
                    for (var i = 0; i < arr.length; i++) arr[i] = (i * 17 + 3) % 256;
                    return arr;
                },
                subtle: null
            },
            TextEncoder: TextEncoder,
            Uint8Array: Uint8Array,
            console: console
        };
        box.window = box;
        vm.runInNewContext(src, box);
        const key = box.emsGenerateAccessKey();
        expect(key).toMatch(/^\d{6}$/);
        expect(key.length).toBe(6);
    });

    it('UI asks for 6 digits', function () {
        const html = read('index.html');
        const ak = read('access-keys.js');
        expect(html).toContain('مثال: 482910');
        expect(html).toContain('maxlength="6"');
        expect(html).toContain('6 ہندسے');
        expect(ak).toContain('ACCESS_KEY_LENGTH = 6');
    });

    it('teacher unlock continues when modules missing (not hard deny)', function () {
        const auth = read('auth.js');
        const slice = auth.slice(auth.indexOf('emsAuthContinueAsTeacher'), auth.indexOf('emsAuthContinueAsParent'));
        expect(slice).toContain("perm.status === 'suspended'");
        expect(slice).not.toContain("emsShowAccessDenied(\n                        'کوئی Module Access نہیں'");
        expect(slice).toContain('ابھی کوئی ماڈیول تفویض نہیں');
    });

    it('teacher key verify falls back to local hash', function () {
        const src = read('access-keys.js');
        expect(src).toContain('confirm against StaffPermissions hash locally');
        expect(src).toContain('function localVerify');
    });
});
