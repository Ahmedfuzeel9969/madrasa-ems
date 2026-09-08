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

describe('Access key 12 digits', function () {
    it('generates 12 numeric digits only', function () {
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
        expect(key).toMatch(/^\d{12}$/);
        expect(key.length).toBe(12);
    });

    it('UI asks for 12 digits and generator matches', function () {
        const html = read('index.html');
        const ak = read('access-keys.js');
        expect(html).toContain('مثال: 482910374651');
        expect(html).toContain('12 ہندسے');
        expect(ak).toContain('ACCESS_KEY_LENGTH = 12');
        expect(ak).toContain("CHARSET = '0123456789'");
    });

    it('server hash treats 12-digit keys as digits', function () {
        const src = read('functions/lib/access-keys.js');
        expect(src).toContain('digits.length === 12');
    });
});
