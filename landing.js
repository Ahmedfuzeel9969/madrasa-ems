// ============================================================================
// EMS Landing Page — portal selection, i18n (ur/en/ar), branding
// ============================================================================
(function (global) {
    'use strict';

    var LANG_KEY = 'ems_lang';
    var FORCE_CONTACT_PHONE = '0332 3105802';
    var FORCE_WHATSAPP_HREF = 'https://wa.me/923323105802';
    var LANDING_FEATURES_UR = [
        'طلبہ انتظام',
        'حاضری',
        'امتحانات و مالیات',
        'والدین و اساتذہ پورٹل',
        'موبائل و ویب رسائی',
        'آف لائن کام کرنے کی صلاحیت',
        'کلاؤڈ آٹو سنک (ڈیٹا بیک اپ)',
        'مکمل سیکیورٹی اور رول بیسڈ رسائی',
        '...اور مزید بے شمار خصوصیات!'
    ];

    var PORTAL_META = {
        admin: { icon: 'fa-user-shield', theme: 'admin', title: { ur: 'EMS — انتظامیہ', en: 'EMS — Admin', ar: 'EMS — الإدارة' } },
        teacher: { icon: 'fa-chalkboard-teacher', theme: 'teacher', title: { ur: 'EMS — اساتذہ', en: 'EMS — Teachers', ar: 'EMS — المعلمون' } },
        parent: { icon: 'fa-user-friends', theme: 'parent', title: { ur: 'EMS — والدین', en: 'EMS — Parents', ar: 'EMS — الأولياء' } },
        student: { icon: 'fa-user-graduate', theme: 'student', title: { ur: 'EMS — طلبہ', en: 'EMS — Students', ar: 'EMS — الطلاب' } }
    };

    var STR = {
        tagline: {
            ur: 'تعلیمی و انتظامی نظام — محفوظ، تیز اور پیشہ ورانہ',
            en: 'Educational management — secure, fast and professional',
            ar: 'نظام تعليمي وإداري — آمن وسريع واحترافي'
        },
        systemName: {
            ur: 'ایڈوانسڈ تعلیمی مینجمنٹ سسٹم (EMS)',
            en: 'Advanced Educational Management System (EMS)',
            ar: 'نظام الإدارة التعليمية المتقدم (EMS)'
        },
        portalHeading: {
            ur: 'اپنا پورٹل منتخب کریں',
            en: 'Choose your portal',
            ar: 'اختر بوابتك'
        },
        adminTitle: { ur: 'انتظامیہ', en: 'Administration', ar: 'الإدارة' },
        adminDesc: {
            ur: 'مکمل اختیارات: رجسٹریشن، حاضری، امتحانات، مالیات، رپورٹس و سیٹنگز',
            en: 'Full access: registration, attendance, exams, finance, reports and settings',
            ar: 'وصول كامل: التسجيل والحضور والامتحانات والمالية والتقارير'
        },
        teacherTitle: { ur: 'اساتذہ', en: 'Teachers', ar: 'المعلمون' },
        teacherDesc: {
            ur: 'حاضری، نصاب، امتحانات، اعلانات اور تدریسی اندراج',
            en: 'Attendance, curriculum, exams, announcements and daily teaching logs',
            ar: 'الحضور والمنهج والامتحانات والإعلانات والسجلات اليومية'
        },
        parentTitle: { ur: 'والدین', en: 'Parents', ar: 'أولياء الأمور' },
        studentTitle: { ur: 'طالب علم / طالبات', en: 'Students', ar: 'الطلاب' },
        studentDesc: {
            ur: 'اپنی حاضری، نتائج، نصاب اور اعلانات — جلد دستیاب',
            en: 'Your attendance, results, curriculum and announcements — coming soon',
            ar: 'حضورك ونتائجك ومنهجك — قريباً'
        },
        studentSoon: { ur: 'جلد آ رہا ہے', en: 'Coming soon', ar: 'قريباً' },
        studentSoonTitle: { ur: 'طالب علم پورٹل', en: 'Student Portal', ar: 'بوابة الطلاب' },
        studentSoonMsg: {
            ur: 'طالب علم پورٹل جلد ہی دستیاب ہوگا (Coming Soon)',
            en: 'Student Portal will be available soon (Coming Soon)',
            ar: 'بوابة الطلاب ستكون متاحة قريباً'
        },
        studentSoonOk: { ur: 'ٹھیک ہے', en: 'OK', ar: 'حسناً' },
        parentDesc: {
            ur: 'صرف اپنے بچے کی حاضری، نتائج، فیس اور اعلانات',
            en: 'View only your child\'s attendance, results, fees and announcements',
            ar: 'عرض حضور ونتائج ورسوم وإعلانات طفلك فقط'
        },
        secureAccess: { ur: 'محفوظ رسائی', en: 'Secure access', ar: 'وصول آمن' },
        aboutTitle: { ur: 'ہمارے بارے میں', en: 'About us', ar: 'من نحن' },
        aboutText: {
            ur: 'یہ نظام مدرسوں اور تعلیمی اداروں کے لیے جدید انتظامی حل فراہم کرتا ہے۔ طلبہ، اساتذہ، مالیات اور والدین — سب ایک محفوظ پلیٹ فارم پر۔',
            en: 'A modern management platform for madrasas and educational institutes — students, staff, finance and parents on one secure system.',
            ar: 'منصة إدارية حديثة للمدارس — الطلاب والموظفون والمالية وأولياء الأمور على نظام واحد آمن.'
        },
        contactTitle: { ur: 'رابطہ کریں', en: 'Contact', ar: 'اتصل بنا' },
        phoneLabel: { ur: 'واٹس ایپ', en: 'WhatsApp', ar: 'واتساب' },
        defaultContactPhone: { ur: '0332 3105802', en: '0332 3105802', ar: '0332 3105802' },
        featuresTitle: { ur: 'نظام کی خصوصیات', en: 'System features', ar: 'مميزات النظام' },
        features: {
            ur: [
                'طلبہ انتظام',
                'حاضری',
                'امتحانات و مالیات',
                'والدین و اساتذہ پورٹل',
                'موبائل و ویب رسائی',
                'آف لائن کام کرنے کی صلاحیت',
                'کلاؤڈ آٹو سنک (ڈیٹا بیک اپ)',
                'مکمل سیکیورٹی اور رول بیسڈ رسائی',
                '...اور مزید بے شمار خصوصیات!'
            ],
            en: [
                'Student management',
                'Attendance',
                'Exams & finance',
                'Parent & teacher portals',
                'Mobile & web access',
                'Offline capability',
                'Cloud auto-sync (data backup)',
                'Full security & role-based access',
                '...and many more features!'
            ],
            ar: [
                'إدارة الطلاب',
                'الحضور',
                'الامتحانات والمالية',
                'بوابات الأولياء والمعلمين',
                'الويب والجوال',
                'العمل دون اتصال',
                'مزامنة سحابية تلقائية (نسخ احتياطي)',
                'أمان كامل وصلاحيات حسب الدور',
                '...والمزيد من المميزات!'
            ]
        },
        footer: {
            ur: '© تعلیمی مینجمنٹ سسٹم — تمام حقوق محفوظ',
            en: '© Educational Management System — All rights reserved',
            ar: '© نظام الإدارة التعليمية — جميع الحقوق محفوظة'
        },
        loginPrompt: {
            ur: 'محفوظ لاگ اِن — Google Sign-In',
            en: 'Secure sign-in — Google Sign-In',
            ar: 'تسجيل دخول آمن — Google'
        },
        loginBtn: { ur: 'لاگ اِن', en: 'Log in', ar: 'تسجيل الدخول' },
        signupBtn: { ur: 'نیا اکاؤنٹ (انتظامیہ)', en: 'New account (Admin)', ar: 'حساب جديد (الإدارة)' },
        googleBtn: { ur: 'گوگل سے لاگ ان', en: 'Sign in with Google', ar: 'Google تسجيل' },
        emailToggle: { ur: 'ای میل / پاسورڈ سے لاگ ان', en: 'Login with Email', ar: 'تسجيل بالبريد' },
        googleBackToggle: { ur: 'گوگل سے لاگ ان', en: 'Back to Google Sign-In', ar: 'Google تسجيل' },
        forgotPass: { ur: 'پاسورڈ بھول گئے؟', en: 'Forgot password?', ar: 'نسيت كلمة المرور؟' },
        backLanding: { ur: '← واپس', en: '← Back', ar: '→ رجوع' },
        portalBadge: {
            admin: { ur: 'انتظامیہ پورٹل', en: 'Admin Portal', ar: 'بوابة الإدارة' },
            teacher: { ur: 'اساتذہ پورٹل', en: 'Teacher Portal', ar: 'بوابة المعلمين' },
            parent: { ur: 'والدین پورٹل', en: 'Parent Portal', ar: 'بوابة الأولياء' },
            student: { ur: 'طالب علم پورٹل', en: 'Student Portal', ar: 'بوابة الطلاب' }
        },
        loginLoading: { ur: 'لاگ ان جاری ہے…', en: 'Signing in…', ar: 'جاري تسجيل الدخول…' },
        accessKeyHint: {
            ur: '12 حروف/ ہندسے — جیسے منتظم نے بھیجی (A–Z, 0–9)',
            en: '12 characters — as issued by admin (A–Z, 0–9)',
            ar: '12 حرفاً — كما أصدرها المشرف'
        },
        accessKeyPlaceholder: {
            ur: 'مثال: AB12CD34EF56',
            en: 'Example: AB12CD34EF56',
            ar: 'مثال: AB12CD34EF56'
        },
        profileSetupTitle: { ur: 'مدرسہ پروفائل بنائیں', en: 'Create Madrasa Profile', ar: 'إنشاء ملف المدرسة' },
        profileSetupSubtitle: {
            ur: 'انتظامیہ پورٹل — پہلی بار رجسٹریشن',
            en: 'Admin Portal — first-time registration',
            ar: 'بوابة الإدارة — التسجيل لأول مرة'
        },
        profileSetupSave: {
            ur: 'پروفائل محفوظ کریں اور شروع کریں',
            en: 'Save profile and get started',
            ar: 'حفظ الملف والبدء'
        },
        profilePh: {
            madrasaName: { ur: 'مدرسہ / ادارے کا مکمل نام *', en: 'Full madrasa / institute name *', ar: 'الاسم الكامل للمدرسة *' },
            principalName: { ur: 'مہتمم / منتظم کا نام *', en: 'Principal / admin name *', ar: 'اسم المدير *' },
            phone: { ur: 'موبائل / واٹس ایپ نمبر *', en: 'Mobile / WhatsApp number *', ar: 'رقم الجوال *' },
            city: { ur: 'شہر', en: 'City', ar: 'المدينة' },
            country: { ur: 'ملک', en: 'Country', ar: 'البلد' },
            subdomain: { ur: 'مطلوبہ سب ڈومین (اختیاری)', en: 'Preferred subdomain (optional)', ar: 'النطاق الفرعي (اختياري)' }
        },
        profileType: {
            placeholder: { ur: 'مدرسہ کی قسم (اختیاری)', en: 'Madrasa type (optional)', ar: 'نوع المدرسة (اختياري)' },
            hifz: { ur: 'حفظ', en: 'Hifz', ar: 'حفظ' },
            nazira: { ur: 'ناظرہ', en: 'Nazira', ar: 'ناظرة' },
            dars: { ur: 'درس نظامی', en: 'Dars-e-Nizami', ar: 'درس نظامی' },
            mixed: { ur: 'مشترکہ', en: 'Mixed', ar: 'مختلط' }
        },
        defaultMadrasa: { ur: 'تعلیمی ادارہ', en: 'Educational Institute', ar: 'المعهد التعليمي' },
        parentBarTitle: { ur: 'والدین پورٹل', en: 'Parent Portal', ar: 'بوابة الأولياء' }
    };

    var currentLang = 'ur';
    var currentPortal = null;

    function t(key, sub) {
        var node = STR[key];
        if (!node) return key;
        if (sub && node[sub]) return node[sub][currentLang] || node[sub].ur;
        if (Array.isArray(node[currentLang])) return node[currentLang];
        return node[currentLang] || node.ur || key;
    }

    function getLang() {
        try { return localStorage.getItem(LANG_KEY) || 'ur'; } catch (e) { return 'ur'; }
    }

    function applyLang(lang) {
        currentLang = lang;
        var landing = document.getElementById('ems-landing');
        var dir = lang === 'en' ? 'ltr' : 'rtl';
        if (landing) landing.setAttribute('dir', dir);
        document.documentElement.setAttribute('lang', lang);
        document.documentElement.setAttribute('dir', dir);

        document.querySelectorAll('.ems-lang-btn').forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-lang') === lang);
        });

        var map = {
            'ems-landing-tagline': t('tagline'),
            'ems-landing-system': t('systemName'),
            'ems-portal-heading': t('portalHeading'),
            'ems-about-title': t('aboutTitle'),
            'ems-about-text': t('aboutText'),
            'ems-contact-title': t('contactTitle'),
            'ems-features-title': t('featuresTitle'),
            'ems-landing-footer-text': t('footer'),
            'ems-login-subtitle': t('loginPrompt'),
            'ems-parent-bar-title': t('parentBarTitle')
        };
        Object.keys(map).forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.textContent = map[id];
        });

        var cards = [
            { sel: '.ems-portal-card.admin h3', key: 'adminTitle' },
            { sel: '.ems-portal-card.admin .ems-portal-desc', key: 'adminDesc' },
            { sel: '.ems-portal-card.admin .ems-portal-en', text: 'Admin Portal' },
            { sel: '.ems-portal-card.teacher h3', key: 'teacherTitle' },
            { sel: '.ems-portal-card.teacher .ems-portal-desc', key: 'teacherDesc' },
            { sel: '.ems-portal-card.teacher .ems-portal-en', text: 'Teacher Portal' },
            { sel: '.ems-portal-card.parent h3', key: 'parentTitle' },
            { sel: '.ems-portal-card.parent .ems-portal-desc', key: 'parentDesc' },
            { sel: '.ems-portal-card.parent .ems-portal-en', text: 'Parent Portal' },
            { sel: '.ems-portal-card.student h3', key: 'studentTitle' },
            { sel: '.ems-portal-card.student .ems-portal-desc', key: 'studentDesc' },
            { sel: '.ems-portal-card.student .ems-portal-en', text: 'Student Portal' }
        ];
        cards.forEach(function (c) {
            var el = document.querySelector(c.sel);
            if (!el) return;
            el.textContent = c.key ? t(c.key) : c.text;
        });

        document.querySelectorAll('.ems-portal-secure span').forEach(function (el) {
            var card = el.closest('.ems-portal-card');
            if (card && card.classList.contains('student')) {
                el.textContent = t('studentSoon');
            } else {
                el.textContent = t('secureAccess');
            }
        });

        var featList = document.getElementById('ems-features-list');
        if (featList) {
            applyLandingFeaturesList(lang);
        }

        applyLandingContactForce();

        var btnLogin = document.getElementById('btn-auth-login');
        var btnSignup = document.getElementById('btn-auth-signup');
        var btnGoogle = document.getElementById('btn-auth-google');
        var linkReset = document.getElementById('link-auth-reset');
        var btnBack = document.getElementById('ems-login-back');
        if (btnLogin) btnLogin.textContent = t('loginBtn');
        if (btnSignup) btnSignup.textContent = t('signupBtn');
        if (btnGoogle) {
            btnGoogle.innerHTML = '<i class="fab fa-google"></i> ' + t('googleBtn');
        }
        var btnShowEmail = document.getElementById('btn-auth-show-email');
        if (btnShowEmail) btnShowEmail.textContent = t('emailToggle');
        if (linkReset) linkReset.textContent = t('forgotPass');
        if (btnBack) btnBack.textContent = t('backLanding');

        if (currentPortal) updateLoginPortalChrome(currentPortal);

        applyProfileSetupLang(lang);

        if (global.EmsI18n && typeof global.EmsI18n.setLang === 'function') {
            global.EmsI18n.setLang(lang);
        }
    }

    function applyLandingFeaturesList(lang) {
        lang = lang || currentLang;
        var featList = document.getElementById('ems-features-list');
        if (!featList) return;
        var items = (STR.features && STR.features[lang]) || STR.features.ur || LANDING_FEATURES_UR;
        if (!items || !items.length) items = LANDING_FEATURES_UR;
        featList.innerHTML = items.map(function (item) {
            return '<li>' + item + '</li>';
        }).join('');
    }

    function applyLandingContactForce() {
        var phoneEl = document.getElementById('ems-contact-phone');
        var waLink = document.getElementById('ems-contact-whatsapp-link');
        if (phoneEl) phoneEl.textContent = FORCE_CONTACT_PHONE;
        if (waLink) {
            waLink.setAttribute('href', FORCE_WHATSAPP_HREF);
            waLink.style.display = '';
        }
    }

    global.emsApplyLandingContactForce = applyLandingContactForce;
    global.emsApplyLandingFeaturesList = applyLandingFeaturesList;

    function applyProfileSetupLang(lang) {
        lang = lang || currentLang;
        var gw = document.getElementById('profile-setup-gateway');
        if (gw) {
            gw.setAttribute('dir', lang === 'en' ? 'ltr' : 'rtl');
        }
        var map = {
            'profile-setup-title': t('profileSetupTitle'),
            'profile-setup-subtitle': t('profileSetupSubtitle')
        };
        Object.keys(map).forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.textContent = map[id];
        });
        var ph = STR.profilePh;
        var setPh = function (id, key) {
            var el = document.getElementById(id);
            if (el && ph[key]) el.placeholder = ph[key][lang] || ph[key].ur;
        };
        setPh('setup-madrasa-name', 'madrasaName');
        setPh('setup-principal-name', 'principalName');
        setPh('setup-phone', 'phone');
        setPh('setup-city', 'city');
        setPh('setup-country', 'country');
        setPh('setup-subdomain', 'subdomain');
        var typeSel = document.getElementById('setup-madrasa-type');
        if (typeSel && typeSel.options.length >= 5) {
            typeSel.options[0].text = t('profileType', 'placeholder');
            typeSel.options[1].text = t('profileType', 'hifz');
            typeSel.options[2].text = t('profileType', 'nazira');
            typeSel.options[3].text = t('profileType', 'dars');
            typeSel.options[4].text = t('profileType', 'mixed');
        }
        var saveBtn = document.getElementById('btn-auth-save-profile');
        if (saveBtn) saveBtn.textContent = t('profileSetupSave');
        var soonTitle = document.getElementById('ems-student-soon-title');
        var soonMsg = document.getElementById('ems-student-soon-msg');
        var soonClose = document.getElementById('ems-student-soon-close');
        if (soonTitle) soonTitle.textContent = t('studentSoonTitle');
        if (soonMsg) soonMsg.textContent = t('studentSoonMsg');
        if (soonClose) soonClose.textContent = t('studentSoonOk');
        var keyHint = document.getElementById('ems-access-key-format-hint');
        if (keyHint) keyHint.textContent = t('accessKeyHint');
        var keyInput = document.getElementById('ems-access-key-input');
        if (keyInput) keyInput.placeholder = t('accessKeyPlaceholder');
        var loadingText = document.getElementById('ems-login-loading-text');
        if (loadingText) loadingText.textContent = t('loginLoading');
    }

    function updateLoginPortalChrome(portal) {
        var meta = PORTAL_META[portal] || PORTAL_META.admin;
        var badge = document.getElementById('ems-login-portal-badge');
        var iconWrap = document.getElementById('ems-login-portal-icon');
        var titleEl = document.getElementById('ems-login-portal-title');
        var loginBox = document.getElementById('ems-login-box');
        var labels = STR.portalBadge[portal];
        var badgeText = labels ? labels[currentLang] || labels.ur : portal;

        if (badge) badge.innerHTML = '<i class="fas ' + meta.icon + '"></i> ' + badgeText;
        if (iconWrap) iconWrap.innerHTML = '<i class="fas ' + meta.icon + '"></i>';
        if (titleEl) titleEl.textContent = meta.title[currentLang] || meta.title.ur;
        if (loginBox) {
            ['admin', 'teacher', 'parent', 'student'].forEach(function (p) {
                loginBox.classList.remove('ems-login-box--' + p);
            });
            loginBox.classList.add('ems-login-box--' + meta.theme);
        }
    }

    global.emsUpdateLoginPortalChrome = updateLoginPortalChrome;

    function setLandingAuthLoading(loading) {
        var grid = document.getElementById('ems-portal-grid');
        var panel = document.getElementById('ems-login-panel');
        var loginBox = document.getElementById('ems-login-box');
        if (grid) grid.classList.toggle('ems-portal-grid--loading', !!loading);
        if (panel) panel.classList.toggle('ems-login-panel--loading', !!loading);
        if (loginBox) loginBox.classList.toggle('ems-login-box--loading', !!loading);
        document.querySelectorAll('.ems-portal-card').forEach(function (card) {
            card.classList.toggle('ems-portal-card--disabled', !!loading);
            card.setAttribute('aria-disabled', loading ? 'true' : 'false');
        });
    }

    global.emsSetLandingAuthLoading = function (loading) {
        setLandingAuthLoading(!!loading);
    };

    global.emsClearLandingAuthLoading = function () {
        setLandingAuthLoading(false);
    };

    function handlePortalCardClick(portal) {
        if (portal === 'student') {
            if (typeof global.emsShowStudentPortalComingSoon === 'function') {
                global.emsShowStudentPortalComingSoon();
            }
            return;
        }
        openLogin(portal);
    }

    global.emsLandingRefreshBranding = function () {
        var nameEl = document.getElementById('ems-landing-madrasa-name');
        var phoneEl = document.getElementById('ems-contact-phone');
        var waLink = document.getElementById('ems-contact-whatsapp-link');
        var logoImg = document.getElementById('ems-landing-logo');
        var logoIcon = document.getElementById('ems-landing-logo-icon');

        var branding = global.EmsBranding && global.EmsBranding.get ? global.EmsBranding.get() : {};
        var madrasaData = global.CURRENT_MADRASA_DATA || {};

        var name = branding.madrasaName || madrasaData.madrasaName || t('defaultMadrasa');

        if (nameEl) nameEl.textContent = name;
        applyLandingContactForce();

        var logo = branding.logo || '';
        if (logo && logoImg) {
            logoImg.src = logo;
            logoImg.style.display = 'block';
            if (logoIcon) logoIcon.style.display = 'none';
        } else if (logoImg) {
            logoImg.style.display = 'none';
            if (logoIcon) logoIcon.style.display = 'block';
        }

        var parentBarName = document.getElementById('ems-parent-bar-madrasa');
        if (parentBarName) parentBarName.textContent = name;
    };

    function showGoogleLoginView() {
        var googleOnly = document.getElementById('ems-login-google-only');
        var emailFields = document.getElementById('ems-login-email-fields');
        if (googleOnly) googleOnly.style.display = 'block';
        if (emailFields) emailFields.style.display = 'none';
    }

    function showEmailLoginView() {
        var googleOnly = document.getElementById('ems-login-google-only');
        var emailFields = document.getElementById('ems-login-email-fields');
        if (googleOnly) googleOnly.style.display = 'none';
        if (emailFields) emailFields.style.display = 'block';
    }

    function applyLoginAuthMethodVisibility(portal) {
        var toggleEmail = document.getElementById('btn-auth-show-email');
        var signupBtn = document.getElementById('btn-auth-signup');
        var emailAllowed = typeof global.emsEmailPasswordLoginAllowed === 'function'
            && global.emsEmailPasswordLoginAllowed();

        showGoogleLoginView();

        if (toggleEmail) {
            toggleEmail.style.display = emailAllowed ? 'block' : 'none';
            toggleEmail.textContent = t('emailToggle');
        }
        if (signupBtn) {
            signupBtn.style.display = (portal === 'admin' && emailAllowed) ? '' : 'none';
        }
    }

    global.emsApplyLoginAuthMethodVisibility = applyLoginAuthMethodVisibility;

    function openLogin(portal) {
        currentPortal = portal;
        if (typeof global.emsSetIntendedPortal === 'function') {
            global.emsSetIntendedPortal(portal);
        }
        updateLoginPortalChrome(portal);
        var panel = document.getElementById('ems-login-panel');
        if (panel) panel.style.display = 'flex';
        showGoogleLoginView();

        var btnGoogle = document.getElementById('btn-auth-google');
        var btnGoogleAlt = document.getElementById('btn-auth-google-alt');
        if (btnGoogle) {
            btnGoogle.innerHTML = '<i class="fab fa-google"></i> ' + t('googleBtn');
        }
        if (btnGoogleAlt) {
            btnGoogleAlt.innerHTML = '<i class="fab fa-google"></i> ' + t('googleBtn');
        }

        var refreshPolicy = typeof global.emsRefreshLoginSsoPolicy === 'function'
            ? global.emsRefreshLoginSsoPolicy(portal)
            : Promise.resolve();
        refreshPolicy.then(function () {
            applyLoginAuthMethodVisibility(portal);
            if (typeof global.emsRenderOrgSsoLoginHint === 'function') {
                global.emsRenderOrgSsoLoginHint();
            }
        }).catch(function () {
            applyLoginAuthMethodVisibility(portal);
        });

        if (typeof global.emsUpdateOfflineContinueButton === 'function') {
            global.emsUpdateOfflineContinueButton();
        }
    }

    function closeLogin() {
        var panel = document.getElementById('ems-login-panel');
        if (panel) panel.style.display = 'none';
        global.emsClearLandingAuthLoading();
    }

    function bindEvents() {
        document.querySelectorAll('.ems-portal-card').forEach(function (card) {
            card.addEventListener('click', function () {
                if (card.classList.contains('ems-portal-card--disabled')) return;
                handlePortalCardClick(card.getAttribute('data-portal'));
            });
            card.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (card.classList.contains('ems-portal-card--disabled')) return;
                    handlePortalCardClick(card.getAttribute('data-portal'));
                }
            });
        });

        document.querySelectorAll('.ems-lang-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var lang = btn.getAttribute('data-lang');
                try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* ignore */ }
                applyLang(lang);
            });
        });

        var backBtn = document.getElementById('ems-login-back');
        if (backBtn) {
            backBtn.addEventListener('click', function (e) {
                e.preventDefault();
                closeLogin();
            });
        }

        var panel = document.getElementById('ems-login-panel');
        if (panel) {
            panel.addEventListener('click', function (e) {
                if (e.target === panel) closeLogin();
            });
        }

        var btnShowEmail = document.getElementById('btn-auth-show-email');
        if (btnShowEmail) {
            btnShowEmail.addEventListener('click', function (e) {
                e.preventDefault();
                showEmailLoginView();
            });
        }

        var studentClose = document.getElementById('ems-student-soon-close');
        if (studentClose) {
            studentClose.addEventListener('click', function () {
                if (typeof global.emsHideStudentPortalComingSoon === 'function') {
                    global.emsHideStudentPortalComingSoon();
                }
            });
        }
        var studentOverlay = document.getElementById('ems-student-coming-soon');
        if (studentOverlay) {
            studentOverlay.addEventListener('click', function (e) {
                if (e.target === studentOverlay && typeof global.emsHideStudentPortalComingSoon === 'function') {
                    global.emsHideStudentPortalComingSoon();
                }
            });
        }

        ['btn-auth-google', 'btn-auth-google-alt', 'btn-auth-login'].forEach(function (id) {
            var btn = document.getElementById(id);
            if (btn) {
                btn.addEventListener('click', function () {
                    global.emsSetLandingAuthLoading(true);
                });
            }
        });
    }

    global.emsApplyProfileSetupLang = function (lang) {
        applyProfileSetupLang(lang);
    };

    function initLanding() {
        applyLang(getLang());
        bindEvents();
        global.emsLandingRefreshBranding();
        if (global.EmsBranding && global.EmsBranding.onChange) {
            global.EmsBranding.onChange(function () {
                global.emsLandingRefreshBranding();
                applyLandingContactForce();
                applyLandingFeaturesList(getLang());
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLanding);
    } else {
        initLanding();
    }

})(window);
