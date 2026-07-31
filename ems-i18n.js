// ============================================================================
// EMS i18n — ملٹی لینگویج سپورٹ (اردو / English / العربية)
// Text-content mapping: HTML کو tag کیے بغیر فوری ترجمہ (اصل اردو محفوظ رہتی ہے)
// ============================================================================
(function (global) {
    'use strict';

    var KEY = 'ems_lang';

    // اردو (اصل) → { en, ar }
    var MAP = {
        // ---- مرکزی نیویگیشن ----
        'ڈیش بورڈ': { en: 'Dashboard', ar: 'لوحة التحكم' },
        'رجسٹریشن': { en: 'Registration', ar: 'التسجيل' },
        'حاضری': { en: 'Attendance', ar: 'الحضور' },
        'شکایات': { en: 'Complaints', ar: 'الشكاوى' },
        'امتحانات': { en: 'Exams', ar: 'الامتحانات' },
        'فیس سسٹم': { en: 'Fee System', ar: 'نظام الرسوم' },
        'مالیات و تنخواہ': { en: 'Finance & Salary', ar: 'المالية والرواتب' },
        'اعلانات و فیصلے': { en: 'Announcements', ar: 'الإعلانات' },
        'سسٹم سیٹنگز': { en: 'System Settings', ar: 'إعدادات النظام' },
        'ایڈمن پینل': { en: 'Admin Panel', ar: 'لوحة الإدارة' },
        'والدین پورٹل': { en: 'Parent Portal', ar: 'بوابة الأولياء' },
        'سپر ایڈمن پینل': { en: 'Super Admin Panel', ar: 'لوحة المشرف العام' },

        // ---- رجسٹریشن نیویگیشن ----
        'رجسٹریشن (اندراج و تقرری)': { en: 'Registration (Admission & Appointment)', ar: 'التسجيل (القبول والتعيين)' },
        'طلباء': { en: 'Students', ar: 'الطلاب' },
        'اساتذہ': { en: 'Teachers', ar: 'المعلمون' },
        'عملہ': { en: 'Staff', ar: 'الموظفون' },
        'برانڈنگ و دستخط': { en: 'Branding & Signatures', ar: 'الهوية والتواقيع' },
        'محفوظ ریکارڈ': { en: 'Saved Records', ar: 'السجلات المحفوظة' },
        'مسترد شدہ': { en: 'Rejected', ar: 'المرفوضة' },

        // ---- سیکشن ہیڈرز ----
        'ذاتی معلومات': { en: 'Personal Information', ar: 'المعلومات الشخصية' },
        'والد / سرپرست کی معلومات': { en: 'Guardian Information', ar: 'معلومات ولي الأمر' },
        'تعلیمی کوائف (عصری و دینی)': { en: 'Educational Details', ar: 'البيانات التعليمية' },
        'دفتری کارروائی (Office Use Only)': { en: 'Office Use Only', ar: 'للاستخدام المكتبي فقط' },
        'شرائط نامہ': { en: 'Terms & Conditions', ar: 'الشروط والأحكام' },

        // ---- عام فیلڈ لیبلز ----
        'طالب علم کا نام': { en: "Student's Name", ar: 'اسم الطالب' },
        'استاد کا نام': { en: "Teacher's Name", ar: 'اسم المعلم' },
        'ملازم کا نام': { en: "Employee's Name", ar: 'اسم الموظف' },
        'ولدیت': { en: "Father's Name", ar: 'اسم الأب' },
        'شناختی کارڈ / ب فارم نمبر': { en: 'CNIC / B-Form No.', ar: 'رقم الهوية' },
        'شناختی کارڈ نمبر': { en: 'CNIC No.', ar: 'رقم الهوية' },
        'موبائل نمبر': { en: 'Mobile Number', ar: 'رقم الجوال' },
        'تاریخ پیدائش': { en: 'Date of Birth', ar: 'تاريخ الميلاد' },
        'بلڈ گروپ': { en: 'Blood Group', ar: 'فصيلة الدم' },
        'مطلوبہ درجہ (کلاس)': { en: 'Required Class', ar: 'الصف المطلوب' },
        'شاخ / برانچ': { en: 'Branch', ar: 'الفرع' },
        'داخلہ نوعیت': { en: 'Admission Type', ar: 'نوع القبول' },
        'رہائشی نوعیت': { en: 'Residence Type', ar: 'نوع الإقامة' },
        'خط و کتابت کا موجودہ پتہ': { en: 'Mailing Address', ar: 'عنوان المراسلة' },
        'سرپرست کا نام': { en: "Guardian's Name", ar: 'اسم ولي الأمر' },
        'والد / سرپرست سے رشتہ': { en: 'Relation with Guardian', ar: 'صلة القرابة' },
        'سرپرست کا پیشہ': { en: "Guardian's Profession", ar: 'مهنة ولي الأمر' },
        'سرپرست کا موبائل نمبر': { en: "Guardian's Mobile", ar: 'جوال ولي الأمر' },
        'عہدہ (Designation)': { en: 'Designation', ar: 'المنصب' },
        'متعلقہ درجہ / شعبہ': { en: 'Department', ar: 'القسم' },
        'موجودہ پتہ': { en: 'Current Address', ar: 'العنوان الحالي' },
        'مستقل پتہ': { en: 'Permanent Address', ar: 'العنوان الدائم' },
        'آسامی (Position)': { en: 'Position', ar: 'الوظيفة' },
        'فارم نمبر': { en: 'Form No.', ar: 'رقم النموذج' },
        'تاریخ': { en: 'Date', ar: 'التاريخ' },
        'تصویر': { en: 'Photo', ar: 'الصورة' },

        // ---- بٹن ----
        'نصاب': { en: 'Curriculum', ar: 'المنهج' },
        'تربیت و نظم': { en: 'Training & Discipline', ar: 'التربية والانضباط' },
        'سائن آؤٹ': { en: 'Sign Out', ar: 'تسجيل الخروج' },
        'محفوظ کریں': { en: 'Save', ar: 'حفظ' },
        'منظور کریں': { en: 'Approve', ar: 'موافقة' },
        'مسترد کریں': { en: 'Reject', ar: 'رفض' },
        'تلاش کریں': { en: 'Search', ar: 'بحث' },
        'فلٹر': { en: 'Filter', ar: 'تصفية' },
        'رپورٹ': { en: 'Report', ar: 'تقرير' },
        'ڈیش بورڈ خلاصہ': { en: 'Dashboard Summary', ar: 'ملخص لوحة التحكم' },
        'آج کی حاضری': { en: "Today's Attendance", ar: 'حضور اليوم' },
        'واجبات الاداء': { en: 'Fee Dues', ar: 'الرسوم المستحقة' },
        'نیا اعلان': { en: 'New Announcement', ar: 'إعلان جديد' },
        'شکایت درج کریں': { en: 'File Complaint', ar: 'تقديم شكوى' },
        'لاگ ان': { en: 'Log In', ar: 'تسجيل الدخول' },
        'رجسٹر کریں': { en: 'Register', ar: 'تسجيل' },
        'بند کریں': { en: 'Close', ar: 'إغلاق' },
        'معلومات محفوظ کریں': { en: 'Save Information', ar: 'حفظ المعلومات' },
        'ٹیمپلیٹ محفوظ کریں': { en: 'Save Template', ar: 'حفظ القالب' },
        'کارڈ ڈیزائنر': { en: 'Card Designer', ar: 'مصمم البطاقة' },
        'PDF ڈاؤن لوڈ': { en: 'Download PDF', ar: 'تنزيل PDF' },

        // ---- برانڈنگ پینل ----
        'برانڈنگ و دستخط مینجمنٹ': { en: 'Branding & Signature Management', ar: 'إدارة الهوية والتواقيع' },
        'مدرسہ کی معلومات (دستاویز کا سرنامہ)': { en: 'Institute Info (Document Header)', ar: 'معلومات المعهد' },
        'لوگو، مہر و دستخط': { en: 'Logo, Seal & Signatures', ar: 'الشعار والختم والتواقيع' },
        'مدرسہ / جامعہ کا نام': { en: 'Institute Name', ar: 'اسم المعهد' },
        'مدرسہ کا لوگو': { en: 'Institute Logo', ar: 'شعار المعهد' },
        'مہر (Stamp)': { en: 'Seal (Stamp)', ar: 'الختم' },
        'دستخط مہتمم': { en: 'Director Signature', ar: 'توقيع المدير' },
        'پتہ': { en: 'Address', ar: 'العنوان' },
        'رابطہ نمبر': { en: 'Contact Number', ar: 'رقم الاتصال' }
    };

    var SELECTOR = [
        '.ribbon-tab',
        '.ems-lang-switch',
        '#module-admission .reg-topbar-title',
        '#module-admission .reg-tab',
        '#module-admission label',
        '#module-admission h2',
        '#module-admission h3',
        '#module-admission h4',
        '#module-admission button',
        '#module-attendance .reg-tab',
        '#module-attendance label',
        '#module-finance .reg-tab',
        '#module-finance label',
        '#module-exams .reg-tab',
        '#module-exams label',
        '#module-complaints .reg-tab',
        '#module-complaints label',
        '#module-dashboard h2',
        '#module-dashboard h3',
        '#module-dashboard label',
        '#id-card-modal button',
        '#card-designer-modal label',
        '#card-designer-modal h3',
        'button.ems-app-shell'
    ].join(', ');

    function iconPrefix(html) {
        var m = html.match(/^\s*<i\b[^>]*>\s*<\/i>\s*/i);
        return m ? m[0] : '';
    }
    function escTxt(s) {
        return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
    }

    function translateEl(el, lang) {
        if (el._i18nOrig === undefined) {
            el._i18nOrig = el.innerHTML;
            el._i18nKey = (el.textContent || '').trim();
        }
        if (lang === 'ur') { el.innerHTML = el._i18nOrig; return; }
        var tr = MAP[el._i18nKey];
        if (!tr || !tr[lang]) { el.innerHTML = el._i18nOrig; return; }
        el.innerHTML = iconPrefix(el._i18nOrig) + escTxt(tr[lang]);
    }

    function translatePlaceholders(lang) {
        document.querySelectorAll('#module-admission [placeholder]').forEach(function (el) {
            if (el._i18nPh === undefined) el._i18nPh = el.getAttribute('placeholder') || '';
            if (lang === 'ur') { if (el._i18nPh) el.setAttribute('placeholder', el._i18nPh); return; }
            var tr = MAP[el._i18nPh.trim()];
            el.setAttribute('placeholder', (tr && tr[lang]) ? tr[lang] : el._i18nPh);
        });
    }

    var listeners = [];
    var current = 'ur';

    function apply(lang) {
        current = lang;
        document.querySelectorAll(SELECTOR).forEach(function (el) { translateEl(el, lang); });
        translatePlaceholders(lang);
        var dir = (lang === 'en') ? 'ltr' : 'rtl';
        document.documentElement.setAttribute('lang', lang);
        document.documentElement.setAttribute('dir', dir);
        // سوئچر بٹن ہائی لائٹ
        document.querySelectorAll('.ems-lang-btn').forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-lang') === lang);
        });
        listeners.forEach(function (cb) { try { cb(lang); } catch (e) { } });
    }

    global.EmsI18n = {
        MAP: MAP,
        current: function () { return current; },
        setLang: function (lang) {
            if (['ur', 'en', 'ar'].indexOf(lang) < 0) lang = 'ur';
            try { localStorage.setItem(KEY, lang); } catch (e) { }
            apply(lang);
        },
        refresh: function () { apply(current); },
        onChange: function (cb) { if (typeof cb === 'function') listeners.push(cb); },
        onModuleOpen: function () { apply(current); },
        t: function (urText) {
            if (current === 'ur') return urText;
            var tr = MAP[urText];
            return (tr && tr[current]) ? tr[current] : urText;
        }
    };

    function init() {
        var saved = 'ur';
        try { saved = localStorage.getItem(KEY) || 'ur'; } catch (e) { }
        apply(saved);
        document.querySelectorAll('.ems-lang-btn[data-lang]').forEach(function (btn) {
            if (btn._i18nBound) return;
            btn._i18nBound = true;
            btn.addEventListener('click', function () {
                global.EmsI18n.setLang(btn.getAttribute('data-lang') || 'ur');
            });
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

})(window);
