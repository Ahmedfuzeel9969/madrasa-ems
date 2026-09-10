import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

describe('اساتذہ و والدین پورٹل — اختیار اور کلاؤڈ حفاظت', function () {
    it('غیر فعال عملہ سامنے اور Firestore دونوں جگہ مسترد ہوتا ہے', function () {
        const client = read('security-layer.js');
        const auth = read('auth.js');
        const rules = read('firestore.rules');
        expect(client.match(/\(perm\.status \|\| 'active'\) !== 'active'/g)?.length).toBeGreaterThanOrEqual(3);
        expect(auth).toContain("(perm.status || 'active') !== 'active'");
        expect(rules.match(/perm(?:\.get\('status', 'active'\)|\.status) == 'active'/g)?.length).toBeGreaterThanOrEqual(2);
        expect(rules).not.toContain("perm.get('status', 'active') != 'suspended'");
    });

    it('والدین پورٹل مقامی فہرست سے پہلے سرور سے بچے اور اختیارات لیتا ہے', function () {
        const source = read('parent-portal.js');
        const start = source.indexOf('window.initParentPortal = function');
        const block = source.slice(start, start + 2600);
        expect(block.indexOf('pullLinkedStudentsForParent(tenantId)')).toBeGreaterThan(-1);
        expect(block.indexOf('pullLinkedStudentsForParent(tenantId)')).toBeLessThan(block.indexOf('renderParentPortalCards'));
        expect(block).toContain('linkedData.studentIds');
        expect(block).toContain('window.CURRENT_PARENT_LINK = Object.assign');
        expect(block.indexOf('if (!studentIds.length)')).toBeGreaterThan(block.indexOf('pullLinkedStudentsForParent(tenantId)'));
    });

    it('اجازت کھڑکی اصل شعبہ وار نقشہ اور مربوط چیک خانے دکھاتی ہے', function () {
        const admin = read('admin-panel.js');
        const css = read('style.css');
        expect(admin).toContain('ap-software-permission-map');
        expect(admin).toContain('ap-perm-module-card');
        expect(admin).toContain('ap-parent-view-map');
        expect(admin).toContain('apGetOrderedStaffModules().map');
        expect(admin).toContain("newActions[m.id].view = true");
        expect(css).toContain('.ap-software-permission-map');
        expect(css).toContain('.ap-parent-view-card');
    });

    it('اختیار پہلے Firestore میں کامیاب ہوتا ہے، پھر مقامی نقل بدلی جاتی ہے', function () {
        const admin = read('admin-panel.js');
        expect(admin).toContain("apPushPermissionDoc('StaffPermissions', staffId, permission, { strict: true })");
        expect(admin).toContain("apPushPermissionDoc('ParentPermissions', studentId, permission, { strict: true })");
        expect(admin).toContain("apPushPermissionDoc('StaffPermissions', staffId, oldP, { strict: true })");
        expect(admin).toContain("apPushPermissionDoc('ParentPermissions', studentId, oldP, { strict: true })");
        expect(admin).toContain('فائر بیس نے تبدیلی قبول کر لی');
        expect(admin).not.toContain('اجازتیں مقامی محفوظ ہوئیں؛ کلاؤڈ سنک ناکام');
    });

    it('کنٹرول پینل بحالی صرف عملہ اور والدین اختیار نامے کھینچتی ہے', function () {
        const admin = read('admin-panel.js');
        const html = read('index.html');
        const start = admin.indexOf('window.apPullControlPanelFromCloud');
        const block = admin.slice(start, start + 4200);
        expect(block).toContain('window.EmsDirect.pullKey(DB_STAFF_PERM');
        expect(block).toContain('window.EmsDirect.pullKey(DB_PARENT_PERM');
        expect(block).not.toContain('attendance');
        expect(block).not.toContain('timetable');
        expect(block).toContain('ems_control_panel_before_cloud_pull_');
        expect(html).toContain('فائر بیس سے اختیارات لائیں');
    });

    it('محفوظ مشترک جیمیل سے پورٹل آزمائش میں غلط کھاتہ واضح روکا جاتا ہے', function () {
        const source = read('shared-portal-gateway.js');
        expect(source).toContain('ems_shared_portal_owner_test_v1');
        expect(source).toContain('اساتذہ پورٹل آزمائیں');
        expect(source).toContain('والدین پورٹل آزمائیں');
        expect(source).toContain('دوسرا گوگل اکاؤنٹ منتخب ہوا');
        expect(source).toContain('global.emsLaunchSharedPortalTest = launchOwnerPortalTest');
    });

    it('نیا نسخہ تمام متعلقہ لوڈروں میں یکساں ہے', function () {
        const tag = '20260911_portal_permissions_cloud_v1';
        expect(read('service-worker.js')).toContain(tag);
        expect(read('ems-sw-update.js')).toContain(tag);
        expect(read('ems-post-auth-loader.js')).toContain(tag);
        expect(read('ems-lazy-loader.js')).toContain(tag);
        expect(read('cloud/ems-cloud-manifest.js')).toContain(tag);
        expect(read('index.html')).toContain(tag);
    });
});

