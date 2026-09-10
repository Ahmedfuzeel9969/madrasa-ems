// ============================================================================
// EMS Shared Portal Gateway — محفوظ مشترک Gmail شناختی دروازہ
//
// یہ فائل صرف سامنے والے حصے کی بنیاد ہے۔ اصل اختیار Cloud Functions،
// custom token claims اور Firestore Rules کے پاس رہے گا۔ اسے auth boot میں
// جوڑنے سے پہلے متعلقہ callable functions deploy اور feature flag فعال کریں۔
// ============================================================================
(function (global) {
    'use strict';

    var FEATURE_FLAG = 'EMS_SHARED_PORTAL_GATEWAY_ENABLED';
    var EXCHANGE_KEY = 'ems_shared_portal_exchange_v1';
    var LOOP_KEY = 'ems_shared_portal_loop_v1';
    var LOOP_WINDOW_MS = 5 * 60 * 1000;
    var LOOP_LIMIT = 3;
    var RENEW_LEAD_MS = 5 * 60 * 1000;
    var RENEW_RETRY_MS = 30 * 1000;
    var CONFIG_VERSION = 1;
    var GATEWAY_ID = 'ems-shared-portal-gateway';
    var STYLE_ID = 'ems-shared-portal-gateway-style';

    var MODES = Object.freeze({
        INDIVIDUAL: 'individual',
        SINGLE: 'single',
        SEPARATE: 'separate'
    });

    var PORTALS = Object.freeze({
        TEACHER: 'teacher',
        STUDENT: 'student',
        PARENT: 'parent'
    });

    var DEFAULT_CALLABLES = Object.freeze({
        getConfig: 'getSharedPortalGatewayConfig',
        saveConfig: 'configureSharedPortalGateway',
        resolve: 'resolveSharedPortalGateway',
        exchange: 'exchangeSharedPortalToken',
        renew: 'renewSharedPortalSession'
    });

    var state = {
        rawGatewayUid: '',
        rawGatewayEmail: '',
        challengeId: '',
        portal: '',
        resolution: null,
        interceptPromise: null,
        exchangePromise: null,
        principalVerificationPromise: null,
        renewPromise: null,
        renewTimer: null,
        expiryTimer: null,
        ownerControllers: []
    };

    function isFeatureEnabled() {
        return global[FEATURE_FLAG] === true;
    }

    function normalizeCallableName(value, fallback) {
        value = String(value || '').trim();
        return /^[A-Za-z][A-Za-z0-9_]{1,79}$/.test(value) ? value : fallback;
    }

    function getCallableNames() {
        var overrides = global.EMS_SHARED_PORTAL_CALLABLES || {};
        return {
            getConfig: normalizeCallableName(overrides.getConfig, DEFAULT_CALLABLES.getConfig),
            saveConfig: normalizeCallableName(overrides.saveConfig, DEFAULT_CALLABLES.saveConfig),
            resolve: normalizeCallableName(overrides.resolve, DEFAULT_CALLABLES.resolve),
            exchange: normalizeCallableName(overrides.exchange, DEFAULT_CALLABLES.exchange),
            renew: normalizeCallableName(overrides.renew, DEFAULT_CALLABLES.renew)
        };
    }

    function getAuth() {
        if (typeof firebase === 'undefined' || !firebase.auth) return null;
        try { return firebase.auth(); } catch (e) { return null; }
    }

    function getCurrentUser() {
        var auth = getAuth();
        return auth ? auth.currentUser : null;
    }

    function getTenantId() {
        if (typeof global.emsGetTenantId === 'function') {
            var resolved = global.emsGetTenantId();
            if (resolved) return resolved;
        }
        return global.CURRENT_MADRASA_TENANT_ID || '';
    }

    function callFunction(name, payload) {
        if (typeof global.emsCallFunction === 'function') {
            return global.emsCallFunction(name, payload || {});
        }
        if (typeof firebase === 'undefined' || !firebase.functions) {
            return Promise.reject(makeError('functions-unavailable'));
        }
        try {
            return firebase.functions().httpsCallable(name)(payload || {}).then(function (result) {
                return result ? result.data : null;
            });
        } catch (e) {
            return Promise.reject(e);
        }
    }

    function makeError(code, message) {
        var err = new Error(message || code || 'unknown');
        err.code = code || 'unknown';
        return err;
    }

    function normalizedErrorCode(err) {
        var code = String((err && err.code) || '').toLowerCase();
        if (code.indexOf('/') !== -1) code = code.split('/').pop();
        return code.replace(/_/g, '-');
    }

    function urduError(err, context) {
        var code = normalizedErrorCode(err);
        // Callable functions already return carefully worded Urdu validation
        // reasons. Keep those reasons visible to the owner instead of replacing
        // them with a generic sentence that makes a deliberate safety rejection
        // look like a broken Save button.
        var serverMessage = String((err && err.message) || '').trim();
        var safeServerCodes = [
            'invalid-argument', 'failed-precondition', 'already-exists',
            'aborted', 'permission-denied', 'resource-exhausted'
        ];
        if (safeServerCodes.indexOf(code) !== -1
            && serverMessage
            && serverMessage !== code
            && serverMessage.length <= 320
            && /[\u0600-\u06ff]/.test(serverMessage)) {
            return serverMessage;
        }
        var map = {
            'unauthenticated': 'آپ کا لاگ اِن سیشن ختم ہو گیا ہے۔ دوبارہ گوگل سے داخل ہوں۔',
            'permission-denied': 'آپ کو یہ ترتیب دیکھنے یا بدلنے کی اجازت نہیں ہے۔',
            'invalid-argument': 'درج کی گئی معلومات درست یا مکمل نہیں ہیں۔',
            'failed-precondition': 'محفوظ مشترک داخلے کی ضروری سروری ترتیب ابھی مکمل نہیں ہے۔',
            'already-exists': 'یہ مشترک گوگل کھاتہ پہلے ہی کسی دوسرے ادارے کے ساتھ منسلک ہے۔',
            'aborted': 'ترتیب اس دوران بدل گئی ہے۔ دوبارہ لوڈ کرکے پھر محفوظ کریں۔',
            'not-found': 'درج کردہ شناختی نمبر اس پورٹل میں نہیں ملا۔',
            'principal-not-found': 'اس شناختی نمبر کا فعال رکن نہیں ملا۔ منتظم سے رابطہ کریں۔',
            'access-key-invalid': 'شناختی نمبر یا رسائی کلید درست نہیں ہے۔',
            'invalid-access-key': 'شناختی نمبر یا رسائی کلید درست نہیں ہے۔',
            'resource-exhausted': 'بہت زیادہ کوششیں ہو چکی ہیں۔ کچھ دیر بعد دوبارہ کوشش کریں۔',
            'too-many-attempts': 'بہت زیادہ کوششیں ہو چکی ہیں۔ کچھ دیر بعد دوبارہ کوشش کریں۔',
            'deadline-exceeded': 'سرور نے مقررہ وقت میں جواب نہیں دیا۔ دوبارہ کوشش کریں۔',
            'unavailable': 'سرور سے محفوظ رابطہ قائم نہیں ہو سکا۔ انٹرنیٹ دیکھ کر دوبارہ کوشش کریں۔',
            'functions-unavailable': 'محفوظ داخلے کی سروری خدمت دستیاب نہیں ہے۔',
            'gateway-email-mismatch': 'یہ گوگل اکاؤنٹ اس مشترک پورٹل کے لیے مقرر نہیں ہے۔',
            'owner-email-forbidden': 'مدرسے کے مالک کا گوگل اکاؤنٹ مشترک پورٹل کے لیے استعمال نہیں ہو سکتا۔',
            'student-portal-unavailable': 'طالب علم پورٹل ابھی فعال نہیں ہے۔',
            'token-missing': 'سرور نے محفوظ سیشن جاری نہیں کیا۔ منتظم سے رابطہ کریں۔',
            'token-identity-mismatch': 'محفوظ سیشن کی شناخت درست نہیں نکلی؛ داخلہ روک دیا گیا ہے۔',
            'token-claims-invalid': 'محفوظ سیشن کے اختیارات نامکمل ہیں؛ داخلہ روک دیا گیا ہے۔',
            'pending-local-writes': 'اس آلے پر ادارے کی غیر بھیجی ہوئی تبدیلیاں موجود ہیں۔ پہلے اصل منتظم/صارف سے ہم وقت سازی مکمل کریں۔',
            'isolation-failed': 'اس آلے کے پچھلے صارف کا مقامی ذخیرہ محفوظ طور پر الگ نہیں ہو سکا۔ دوسری کھلی کھڑکیاں بند کر کے دوبارہ کوشش کریں۔',
            'exchange-loop': 'محفوظ داخلے کی بار بار کوشش روک دی گئی ہے۔ گوگل اکاؤنٹ بدل کر دوبارہ کوشش کریں۔'
        };
        if (map[code]) return map[code];
        if (context === 'config-load') return 'مشترک پورٹل کی ترتیب لوڈ نہیں ہو سکی۔';
        if (context === 'config-save') return 'مشترک پورٹل کی ترتیب محفوظ نہیں ہو سکی۔';
        if (context === 'resolve') return 'گوگل اکاؤنٹ کی محفوظ شناخت مکمل نہیں ہو سکی؛ رسائی روک دی گئی ہے۔';
        return 'محفوظ داخلہ مکمل نہیں ہو سکا۔ دوبارہ کوشش کریں یا منتظم سے رابطہ کریں۔';
    }

    function notify(message, type) {
        if (typeof global.showToast === 'function') {
            global.showToast(String(message || ''), type || 'info');
            return;
        }
        if (typeof global.showTopAlert === 'function') {
            global.showTopAlert(String(message || ''), type === 'error');
        }
    }

    function readSessionJson(key) {
        try {
            var raw = sessionStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function writeSessionJson(key, value) {
        try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }

    function removeSessionKey(key) {
        try { sessionStorage.removeItem(key); } catch (e) { /* ignore */ }
    }

    function getExchangeMarker() {
        var marker = readSessionJson(EXCHANGE_KEY);
        if (!marker || !marker.at || Date.now() - marker.at > LOOP_WINDOW_MS) {
            removeSessionKey(EXCHANGE_KEY);
            return null;
        }
        return marker;
    }

    function setExchangeMarker(marker) {
        marker = marker || {};
        marker.at = Date.now();
        marker.version = CONFIG_VERSION;
        writeSessionJson(EXCHANGE_KEY, marker);
    }

    function incrementLoopGuard(rawUid, portal) {
        var now = Date.now();
        var key = String(rawUid || '') + '|' + String(portal || '');
        var loop = readSessionJson(LOOP_KEY);
        if (!loop || loop.key !== key || !loop.startedAt || now - loop.startedAt > LOOP_WINDOW_MS) {
            loop = { key: key, startedAt: now, count: 0 };
        }
        loop.count = Number(loop.count || 0) + 1;
        loop.lastAt = now;
        writeSessionJson(LOOP_KEY, loop);
        return loop.count <= LOOP_LIMIT;
    }

    function clearLoopGuard() {
        removeSessionKey(LOOP_KEY);
    }

    function normalizeEmail(value) {
        var email = String(value || '').trim().toLowerCase();
        var match = email.match(/^([^@\s]{1,64})@([^@\s]{1,253})$/);
        if (!match) return email;
        var local = match[1];
        var domain = match[2] === 'googlemail.com' ? 'gmail.com' : match[2];
        if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '');
        return local + '@' + domain;
    }

    function validEmail(value) {
        value = normalizeEmail(value);
        return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    function normalizePersonId(value) {
        value = String(value || '');
        if (typeof value.normalize === 'function') value = value.normalize('NFKC');
        return value.trim();
    }

    function normalizeDigits(value) {
        var map = {
            '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
            '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
            '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
            '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
        };
        return String(value || '').replace(/[۰-۹٠-٩]/g, function (ch) { return map[ch] || ch; });
    }

    function validatePersonId(value) {
        value = normalizePersonId(value);
        if (!value || value.length > 80) return false;
        return !/[\u0000-\u001f\u007f\\/]/.test(value);
    }

    function validateAccessKey(value) {
        value = normalizeDigits(value).replace(/\s+/g, '');
        return /^\d{6}$/.test(value) || /^\d{12}$/.test(value);
    }

    function portalLabel(portal) {
        if (portal === PORTALS.TEACHER) return 'اساتذہ و عملہ پورٹل';
        if (portal === PORTALS.PARENT) return 'والدین پورٹل';
        if (portal === PORTALS.STUDENT) return 'طلبہ پورٹل';
        return 'مشترک پورٹل';
    }

    function personIdLabel(portal) {
        if (portal === PORTALS.TEACHER) return 'استاد یا عملہ کا شناختی نمبر';
        if (portal === PORTALS.PARENT) return 'والدین کا شناختی نمبر یا مقررہ طالب علم نمبر';
        if (portal === PORTALS.STUDENT) return 'طالب علم کا شناختی نمبر';
        return 'ذاتی شناختی نمبر';
    }

    function studentPortalAvailable() {
        return typeof global.emsIsStudentPortalAvailable === 'function'
            && global.emsIsStudentPortalAvailable() === true;
    }

    function intendedPortal() {
        return typeof global.emsGetIntendedPortal === 'function'
            ? global.emsGetIntendedPortal()
            : global.EMS_INTENDED_PORTAL;
    }

    function validPortal(portal) {
        return portal === PORTALS.TEACHER || portal === PORTALS.PARENT || portal === PORTALS.STUDENT;
    }

    function setShellLocked(locked) {
        if (!document.body) return;
        document.body.classList.toggle('ems-shared-portal-gateway-locked', !!locked);
        if (locked) {
            document.body.classList.add('ems-locked');
            document.body.classList.remove('ems-authenticated');
            document.querySelectorAll('.ems-app-shell').forEach(function (shell) {
                shell.setAttribute('data-ems-shared-gateway-hidden', '1');
                shell.style.display = 'none';
            });
        }
    }

    function markRawGateway(user, resolution, portal) {
        state.rawGatewayUid = String((user && user.uid) || '');
        state.rawGatewayEmail = normalizeEmail(user && user.email);
        state.challengeId = String((resolution && resolution.challengeId) || '');
        state.portal = portal || '';
        state.resolution = resolution || {};
        global.EMS_SHARED_PORTAL_RAW_GATEWAY = true;
        global.EMS_SHARED_PORTAL_EXCHANGE_IN_PROGRESS = false;
        setShellLocked(true);
    }

    function clearRawGatewayState() {
        state.rawGatewayUid = '';
        state.rawGatewayEmail = '';
        state.challengeId = '';
        state.portal = '';
        state.resolution = null;
        state.interceptPromise = null;
        state.exchangePromise = null;
        state.principalVerificationPromise = null;
        global.EMS_SHARED_PORTAL_RAW_GATEWAY = false;
        global.EMS_SHARED_PORTAL_EXCHANGE_IN_PROGRESS = false;
    }

    function isRawGatewayUser(user) {
        return !!(global.EMS_SHARED_PORTAL_RAW_GATEWAY
            && user
            && state.rawGatewayUid
            && user.uid === state.rawGatewayUid);
    }

    /**
     * ہر profile/tenant/data load سے پہلے یہ hook لازماً چلائیں۔
     * false کا مطلب ہے کہ موجودہ raw مشترک Gmail کو کسی ادارے کا data نہ دیں۔
     */
    function canLoadAppData(user) {
        user = user || getCurrentUser();
        if (!user) return false;
        if (global.EMS_SHARED_PORTAL_EXCHANGE_IN_PROGRESS === true) return false;
        return !isRawGatewayUser(user);
    }

    function assertNoPendingTenantWrites(tenantId) {
        if (!tenantId || typeof global.emsOfflineListQueueAll !== 'function') {
            return Promise.resolve(true);
        }
        return Promise.resolve(global.emsOfflineListQueueAll()).then(function (rows) {
            var pending = (rows || []).some(function (row) {
                return String((row && row.tenantId) || '') === String(tenantId);
            });
            if (pending) throw makeError('pending-local-writes');
            return true;
        });
    }

    function tenantBusinessCacheKey(key, tenantId) {
        key = String(key || '');
        tenantId = String(tenantId || '');
        return !!tenantId && (
            key.indexOf('ems_t_' + tenantId + '__') === 0
            || key.indexOf('att_rec_' + tenantId + '_') === 0
            || key.indexOf('ems_repo_' + tenantId) === 0
            || key.indexOf('ems_cache_' + tenantId) === 0
            || key.indexOf('ems_dashboard_' + tenantId) === 0
        );
    }

    function purgeTenantBusinessCaches(tenantId) {
        var removals = [];
        try {
            var keys = [];
            for (var i = 0; i < global.localStorage.length; i++) {
                keys.push(global.localStorage.key(i));
            }
            keys.filter(function (key) {
                return tenantBusinessCacheKey(key, tenantId);
            }).forEach(function (key) {
                if (global._emsOriginalRemoveItem) {
                    global._emsOriginalRemoveItem.call(global.localStorage, key);
                } else {
                    global.localStorage.removeItem(key);
                }
            });
        } catch (eLocal) {
            return Promise.reject(makeError('isolation-failed'));
        }

        if (typeof global.emsIdbKvKeys === 'function'
            && typeof global.emsIdbKvDelete === 'function') {
            removals.push(Promise.resolve(global.emsIdbKvKeys()).then(function (keys) {
                return Promise.all((keys || []).filter(function (key) {
                    return tenantBusinessCacheKey(key, tenantId);
                }).map(function (key) {
                    return global.emsIdbKvDelete(key);
                }));
            }));
        }
        if (typeof global.emsClearOfflineSession === 'function') global.emsClearOfflineSession();
        return Promise.all(removals);
    }

    function clearFirestoreActorCache() {
        if (typeof firebase === 'undefined' || !firebase.firestore) return Promise.resolve();
        var firestore;
        try { firestore = firebase.firestore(); } catch (e) { return Promise.reject(makeError('isolation-failed')); }
        var pending = typeof firestore.waitForPendingWrites === 'function'
            ? firestore.waitForPendingWrites()
            : Promise.resolve();
        return pending.then(function () {
            return typeof firestore.terminate === 'function' ? firestore.terminate() : null;
        }).then(function () {
            return typeof firestore.clearPersistence === 'function' ? firestore.clearPersistence() : null;
        }).catch(function () {
            throw makeError('isolation-failed');
        });
    }

    function prepareActorIsolation(tenantId) {
        return assertNoPendingTenantWrites(tenantId).then(function () {
            return purgeTenantBusinessCaches(tenantId);
        }).then(clearFirestoreActorCache);
    }

    function prepareSharedPortalLogout() {
        var principal = global.EMS_SHARED_PORTAL_PRINCIPAL;
        if (!principal || !principal.tenantId) return Promise.resolve(true);
        var flush = typeof global.emsOfflineFlushAll === 'function'
            ? Promise.resolve(global.emsOfflineFlushAll({ manual: true }))
            : Promise.resolve();
        return flush.then(function () {
            return prepareActorIsolation(principal.tenantId);
        });
    }

    function clearPrincipalTimers() {
        if (state.renewTimer) clearTimeout(state.renewTimer);
        if (state.expiryTimer) clearTimeout(state.expiryTimer);
        state.renewTimer = null;
        state.expiryTimer = null;
    }

    function expireSharedPrincipal() {
        clearPrincipalTimers();
        setShellLocked(true);
        var principal = global.EMS_SHARED_PORTAL_PRINCIPAL;
        showBlockedGateway(
            'محفوظ نشست کی مدت مکمل',
            'جاری تبدیلیوں کو محفوظ کرنے کی کوشش کی جا رہی ہے۔ اس کے بعد ذاتی نمبر اور کلید سے دوبارہ داخل ہوں۔',
            false
        );
        if (!principal) return;
        prepareSharedPortalLogout().then(function () {
            var auth = getAuth();
            return auth ? auth.signOut() : null;
        }).then(function () {
            global.location.reload();
        }).catch(function () {
            showBlockedGateway(
                'نشست بند — مقامی تبدیلیاں محفوظ ہیں',
                'انٹرنیٹ یا ہم وقت سازی مکمل نہ ہونے کی وجہ سے سائن آؤٹ روکا گیا ہے۔ یہ آلہ بند نہ کریں اور منتظم سے رابطہ کریں۔',
                false
            );
        });
    }

    function renewPrincipalSession(user, principal) {
        if (state.renewPromise) return state.renewPromise;
        if (!user || !principal) return Promise.reject(makeError('unauthenticated'));
        var remainingAbsolute = Number(principal.absoluteExpiresAtMs || 0) - Date.now();
        if (remainingAbsolute <= RENEW_LEAD_MS) return Promise.resolve({ absoluteLimit: true });
        var flush = typeof global.emsOfflineFlushAll === 'function'
            ? Promise.resolve(global.emsOfflineFlushAll({ manual: true }))
            : Promise.resolve();
        state.renewPromise = flush.then(function () {
            return callFunction(getCallableNames().renew, {});
        }).then(function () {
            return user.getIdToken(true);
        }).then(function () {
            state.principalVerificationPromise = null;
            return verifyPrincipalClaims(user, principal.portal, user.uid);
        }).finally(function () {
            state.renewPromise = null;
        });
        return state.renewPromise;
    }

    function schedulePrincipalLifecycle(user, principal) {
        clearPrincipalTimers();
        var now = Date.now();
        var expiresAtMs = Number(principal && principal.expiresAtMs) || 0;
        var absoluteExpiresAtMs = Number(principal && principal.absoluteExpiresAtMs) || expiresAtMs;
        if (!expiresAtMs || expiresAtMs <= now) {
            expireSharedPrincipal();
            return;
        }
        state.expiryTimer = setTimeout(expireSharedPrincipal, Math.max(0, expiresAtMs - now + 250));
        var renewAt = expiresAtMs - RENEW_LEAD_MS;
        if (absoluteExpiresAtMs - now <= RENEW_LEAD_MS) return;
        state.renewTimer = setTimeout(function attemptRenewal() {
            renewPrincipalSession(user, principal).catch(function () {
                var remaining = expiresAtMs - Date.now();
                if (remaining > RENEW_RETRY_MS + 1000) {
                    state.renewTimer = setTimeout(attemptRenewal, RENEW_RETRY_MS);
                }
            });
        }, Math.max(1000, renewAt - now));
    }

    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent =
            '.ems-spg-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(15,23,42,.76);backdrop-filter:blur(4px);direction:rtl}' +
            '.ems-spg-card{width:min(520px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.35);padding:22px;color:#0f172a;font-family:inherit}' +
            '.ems-spg-title{margin:0 0 6px;font-size:21px;color:#0f766e}' +
            '.ems-spg-subtitle{margin:0 0 16px;color:#475569;line-height:1.8;font-size:13px}' +
            '.ems-spg-label{display:block;margin:12px 0 5px;font-weight:700;font-size:13px}' +
            '.ems-spg-input{box-sizing:border-box;width:100%;border:1px solid #cbd5e1;border-radius:9px;padding:11px 12px;font:inherit;background:#fff;color:#0f172a}' +
            '.ems-spg-input:focus{outline:3px solid rgba(13,148,136,.18);border-color:#0d9488}' +
            '.ems-spg-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:16px}' +
            '.ems-spg-btn{border:0;border-radius:9px;padding:10px 15px;font:inherit;font-weight:700;cursor:pointer}' +
            '.ems-spg-btn:disabled{opacity:.55;cursor:not-allowed}' +
            '.ems-spg-primary{background:#0f766e;color:#fff}' +
            '.ems-spg-secondary{background:#e2e8f0;color:#334155}' +
            '.ems-spg-status{min-height:22px;margin:10px 0 0;font-size:13px;line-height:1.7;color:#475569}' +
            '.ems-spg-status[data-kind="error"]{color:#b91c1c}' +
            '.ems-spg-status[data-kind="success"]{color:#047857}' +
            '.ems-spg-note{padding:10px 12px;border:1px solid #99f6e4;border-radius:9px;background:#f0fdfa;color:#115e59;font-size:12px;line-height:1.8}' +
            '.ems-spg-config{direction:rtl;border:1px solid #cbd5e1;border-radius:14px;padding:16px;background:#fff}' +
            '.ems-spg-config h3{margin:0 0 7px;color:#0f766e}' +
            '.ems-spg-modes{display:grid;gap:8px;margin:14px 0}' +
            '.ems-spg-mode{display:flex;align-items:flex-start;gap:8px;padding:10px;border:1px solid #dbeafe;border-radius:9px;background:#f8fafc}' +
            '.ems-spg-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}' +
            '.ems-spg-field[hidden]{display:none!important}' +
            '.ems-spg-muted{color:#64748b;font-size:12px;line-height:1.7}' +
            '@media (max-width:520px){.ems-spg-card{padding:17px;border-radius:14px}.ems-spg-actions .ems-spg-btn{flex:1}}';
        document.head.appendChild(style);
    }

    function node(tag, className, textValue) {
        var el = document.createElement(tag);
        if (className) el.className = className;
        if (textValue != null) el.textContent = String(textValue);
        return el;
    }

    function setStatus(el, message, kind) {
        if (!el) return;
        el.textContent = String(message || '');
        el.setAttribute('data-kind', kind || 'info');
    }

    function removeGateway() {
        var existing = document.getElementById(GATEWAY_ID);
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    }

    function signOutRawGateway() {
        removeGateway();
        removeSessionKey(EXCHANGE_KEY);
        clearLoopGuard();
        var auth = getAuth();
        global.EMS_EXPLICIT_SIGNOUT = true;
        var done = auth ? auth.signOut().catch(function () { /* still clear local gate */ }) : Promise.resolve();
        return done.then(function () {
            clearRawGatewayState();
            if (typeof global.emsClearTenantContext === 'function') {
                global.emsClearTenantContext();
            }
            if (typeof global.emsShowLanding === 'function') global.emsShowLanding();
        });
    }

    function showBlockedGateway(title, detail, allowRetry) {
        ensureStyles();
        removeGateway();
        setShellLocked(true);

        var overlay = node('div', 'ems-spg-overlay');
        overlay.id = GATEWAY_ID;
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', GATEWAY_ID + '-title');

        var card = node('section', 'ems-spg-card');
        var heading = node('h2', 'ems-spg-title', title || 'محفوظ داخلہ روک دیا گیا');
        heading.id = GATEWAY_ID + '-title';
        card.appendChild(heading);
        card.appendChild(node('p', 'ems-spg-subtitle', detail || 'منتظم سے رابطہ کریں۔'));

        var actions = node('div', 'ems-spg-actions');
        if (allowRetry) {
            var retry = node('button', 'ems-spg-btn ems-spg-primary', 'دوبارہ کوشش کریں');
            retry.type = 'button';
            retry.addEventListener('click', function () {
                removeGateway();
                state.interceptPromise = null;
                maybeIntercept(getCurrentUser(), { force: true });
            });
            actions.appendChild(retry);
        }
        var back = node('button', 'ems-spg-btn ems-spg-secondary', 'گوگل اکاؤنٹ تبدیل کریں');
        back.type = 'button';
        back.addEventListener('click', signOutRawGateway);
        actions.appendChild(back);
        card.appendChild(actions);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        back.focus();
    }

    function validateResolution(resolution) {
        if (!resolution || resolution.matched !== true) return { matched: false };
        var challengeId = String(resolution.challengeId || '').trim();
        if (!challengeId || challengeId.length > 300) {
            throw makeError('failed-precondition');
        }
        var allowed = Array.isArray(resolution.allowedPortals) ? resolution.allowedPortals : [];
        allowed = allowed.filter(validPortal);
        return {
            matched: true,
            challengeId: challengeId,
            allowedPortals: allowed,
            tenantId: String(resolution.tenantId || '').trim(),
            institutionName: String(resolution.institutionName || resolution.madrasaName || '').slice(0, 160),
            expiresAt: Number(resolution.expiresAt || 0)
        };
    }

    function renderGatewayPrompt(user, resolution, portal) {
        ensureStyles();
        removeGateway();

        var overlay = node('div', 'ems-spg-overlay');
        overlay.id = GATEWAY_ID;
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', GATEWAY_ID + '-title');

        var card = node('section', 'ems-spg-card');
        var titleText = portalLabel(portal) + ' — ذاتی تصدیق';
        var heading = node('h2', 'ems-spg-title', titleText);
        heading.id = GATEWAY_ID + '-title';
        card.appendChild(heading);

        var institution = resolution.institutionName ? ('ادارہ: ' + resolution.institutionName + '۔ ') : '';
        card.appendChild(node(
            'p',
            'ems-spg-subtitle',
            institution + 'گوگل اکاؤنٹ مشترک ہے؛ آپ کی اصل شناخت ذاتی نمبر اور رسائی کلید سے ہوگی۔'
        ));
        card.appendChild(node(
            'div',
            'ems-spg-note',
            'مشترک گوگل اکاؤنٹ سے براہِ راست ادارے کا کوئی ڈیٹا نہیں کھولا جاتا۔ کامیاب ذاتی تصدیق کے بعد سرور الگ، محدود اور قابلِ حساب سیشن جاری کرے گا۔'
        ));

        var form = node('form', 'ems-spg-form');
        form.noValidate = true;

        var idLabel = node('label', 'ems-spg-label', personIdLabel(portal));
        idLabel.setAttribute('for', GATEWAY_ID + '-person');
        var idInput = node('input', 'ems-spg-input');
        idInput.id = GATEWAY_ID + '-person';
        idInput.type = 'text';
        idInput.maxLength = 80;
        idInput.autocomplete = 'username';
        idInput.setAttribute('dir', 'ltr');
        idInput.setAttribute('aria-required', 'true');

        var keyLabel = node('label', 'ems-spg-label', 'ذاتی رسائی کلید');
        keyLabel.setAttribute('for', GATEWAY_ID + '-key');
        var keyInput = node('input', 'ems-spg-input');
        keyInput.id = GATEWAY_ID + '-key';
        keyInput.type = 'password';
        keyInput.inputMode = 'numeric';
        keyInput.maxLength = 12;
        keyInput.autocomplete = 'one-time-code';
        keyInput.setAttribute('dir', 'ltr');
        keyInput.setAttribute('aria-required', 'true');

        var status = node('p', 'ems-spg-status');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');

        var actions = node('div', 'ems-spg-actions');
        var submit = node('button', 'ems-spg-btn ems-spg-primary', 'محفوظ طور پر داخل ہوں');
        submit.type = 'submit';
        var back = node('button', 'ems-spg-btn ems-spg-secondary', 'گوگل اکاؤنٹ تبدیل کریں');
        back.type = 'button';
        back.addEventListener('click', signOutRawGateway);
        actions.appendChild(submit);
        actions.appendChild(back);

        form.appendChild(idLabel);
        form.appendChild(idInput);
        form.appendChild(keyLabel);
        form.appendChild(keyInput);
        form.appendChild(status);
        form.appendChild(actions);
        card.appendChild(form);
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        function setBusy(busy) {
            submit.disabled = !!busy;
            back.disabled = !!busy;
            idInput.disabled = !!busy;
            keyInput.disabled = !!busy;
            submit.textContent = busy ? 'تصدیق جاری ہے…' : 'محفوظ طور پر داخل ہوں';
        }

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            var personId = normalizePersonId(idInput.value);
            var accessKey = normalizeDigits(keyInput.value).replace(/\s+/g, '');

            if (!validatePersonId(personId)) {
                setStatus(status, 'درست شناختی نمبر درج کریں۔', 'error');
                idInput.focus();
                return;
            }
            if (!validateAccessKey(accessKey)) {
                setStatus(status, 'رسائی کلید 6 یا 12 ہندسوں کی ہونی چاہیے۔', 'error');
                keyInput.focus();
                return;
            }

            // کلید DOM سے فوراً ہٹا دیں؛ اسے storage یا log میں کبھی محفوظ نہ کریں۔
            keyInput.value = '';
            setBusy(true);
            setStatus(status, 'سرور ذاتی شناخت اور اختیار کی تصدیق کر رہا ہے…', 'info');

            exchangeSession(user, portal, personId, accessKey).then(function () {
                setStatus(status, 'تصدیق کامیاب؛ آپ کا محدود سیشن کھل رہا ہے…', 'success');
            }).catch(function (err) {
                setBusy(false);
                setStatus(status, urduError(err, 'exchange'), 'error');
                keyInput.focus();
            });
        });

        idInput.focus();
    }

    function verifyPrincipalClaims(user, expectedPortal, expectedUid) {
        if (!user || !user.uid || (expectedUid && user.uid !== expectedUid)) {
            return Promise.reject(makeError('token-identity-mismatch'));
        }
        if (!user.getIdTokenResult) {
            return Promise.reject(makeError('token-claims-invalid'));
        }
        if (state.principalVerificationPromise) return state.principalVerificationPromise;

        state.principalVerificationPromise = user.getIdTokenResult(true).then(function (result) {
            var claims = (result && result.claims) || {};
            var claimPortal = String(claims.portal || claims.emsPortal || '');
            var principalId = String(claims.principalId || claims.emsPrincipalId || '');
            var tenantId = String(claims.tenantId || claims.emsTenantId || '');
            var sessionId = String(claims.sessionId || claims.portalSessionId || '');
            var expiresAtMs = Number(claims.sessionExpiresAtMs || 0);
            var absoluteExpiresAtMs = Number(claims.sessionAbsoluteExpiresAtMs || expiresAtMs);
            if (claims.emsSharedPortalPrincipal !== true
                || !tenantId
                || !principalId
                || !sessionId
                || expiresAtMs <= Date.now()
                || (expectedPortal && claimPortal !== expectedPortal)) {
                throw makeError('token-claims-invalid');
            }
            global.EMS_SHARED_PORTAL_PRINCIPAL = {
                uid: user.uid,
                tenantId: tenantId,
                portal: claimPortal,
                principalId: principalId,
                sessionId: sessionId,
                sessionVersion: Number(claims.sessionVersion || claims.emsSessionVersion || 0),
                expiresAtMs: expiresAtMs,
                absoluteExpiresAtMs: absoluteExpiresAtMs
            };
            schedulePrincipalLifecycle(user, global.EMS_SHARED_PORTAL_PRINCIPAL);
            global.EMS_SHARED_PORTAL_RAW_GATEWAY = false;
            global.EMS_SHARED_PORTAL_EXCHANGE_IN_PROGRESS = false;
            setExchangeMarker({
                stage: 'principal',
                expectedUid: user.uid,
                portal: claimPortal,
                tenantId: tenantId
            });
            clearLoopGuard();
            removeGateway();
            return { handled: false, principal: true, portal: claimPortal, tenantId: tenantId };
        }).catch(function (err) {
            state.principalVerificationPromise = null;
            var auth = getAuth();
            if (auth) auth.signOut().catch(function () { /* ignore */ });
            showBlockedGateway('محفوظ سیشن مسترد', urduError(err, 'exchange'), false);
            throw err;
        });
        return state.principalVerificationPromise;
    }

    function exchangeSession(rawUser, portal, personId, accessKey) {
        if (state.exchangePromise) return state.exchangePromise;
        if (!rawUser || !isRawGatewayUser(rawUser)) {
            return Promise.reject(makeError('unauthenticated'));
        }
        if (!incrementLoopGuard(rawUser.uid, portal)) {
            showBlockedGateway('بہت زیادہ کوششیں', urduError(makeError('exchange-loop')), false);
            return Promise.reject(makeError('exchange-loop'));
        }

        var auth = getAuth();
        if (!auth || typeof auth.signInWithCustomToken !== 'function') {
            return Promise.reject(makeError('functions-unavailable'));
        }
        global.EMS_SHARED_PORTAL_EXCHANGE_IN_PROGRESS = true;

        var callables = getCallableNames();
        state.exchangePromise = assertNoPendingTenantWrites(
            state.resolution && state.resolution.tenantId
        ).then(function () {
            return callFunction(callables.exchange, {
                version: CONFIG_VERSION,
                challengeId: state.challengeId,
                portal: portal,
                personId: personId,
                accessKey: accessKey
            });
        }).then(function (response) {
            // مقامی حوالہ بھی جلد ختم کریں؛ response یا marker میں کلید شامل نہیں ہوتی۔
            accessKey = '';
            response = response || {};
            var token = String(response.customToken || '');
            var customUid = String(response.customUid || response.principalUid || '');
            var responsePortal = String(response.portal || portal);
            if (!token || !customUid) throw makeError('token-missing');
            if (responsePortal !== portal) throw makeError('token-identity-mismatch');

            setExchangeMarker({
                stage: 'token-issued',
                gatewayUid: rawUser.uid,
                expectedUid: customUid,
                portal: portal,
                sessionId: String(response.sessionId || '')
            });

            if (state.resolution && state.resolution.tenantId
                && String(response.tenantId || '') !== String(state.resolution.tenantId)) {
                throw makeError('token-identity-mismatch');
            }
            return prepareActorIsolation(response.tenantId).then(function () {
                global.EMS_SHARED_PORTAL_RELOAD_REQUIRED = true;
                return auth.signInWithCustomToken(token);
            }).then(function (credential) {
                token = '';
                var principalUser = credential && credential.user;
                if (!principalUser || principalUser.uid !== customUid) {
                    throw makeError('token-identity-mismatch');
                }
                return verifyPrincipalClaims(principalUser, portal, customUid).then(function (result) {
                    setTimeout(function () { global.location.reload(); }, 0);
                    return result;
                });
            });
        }).then(function (result) {
            state.exchangePromise = null;
            clearRawGatewayState();
            return result;
        }).catch(function (err) {
            accessKey = '';
            state.exchangePromise = null;
            global.EMS_SHARED_PORTAL_EXCHANGE_IN_PROGRESS = false;
            throw err;
        });
        return state.exchangePromise;
    }

    function resolveGateway(user, portal) {
        var callables = getCallableNames();
        return callFunction(callables.resolve, {
            version: CONFIG_VERSION,
            portal: portal || ''
        }).then(validateResolution);
    }

    function maybeResumePrincipal(user, portal) {
        var marker = getExchangeMarker();
        if (marker && marker.expectedUid && user.uid === marker.expectedUid
            && (marker.stage === 'token-issued' || marker.stage === 'principal')) {
            return verifyPrincipalClaims(user, marker.portal || portal, marker.expectedUid);
        }
        if (!user || !user.getIdTokenResult) return Promise.resolve(null);
        return user.getIdTokenResult(false).then(function (result) {
            var claims = (result && result.claims) || {};
            if (claims.emsSharedPortalPrincipal !== true) return null;
            return verifyPrincipalClaims(
                user,
                String(claims.portal || claims.portalRole || ''),
                user.uid
            );
        });
    }

    /**
     * auth.js integration:
     * await emsSharedPortalMaybeIntercept(user)؛ handled=true ہو تو معمول کا boot نہ چلائیں۔
     */
    function maybeIntercept(user, options) {
        options = options || {};
        if (!isFeatureEnabled()) return Promise.resolve({ handled: false, disabled: true });
        if (!user || !user.uid) return Promise.resolve({ handled: false });

        var portal = intendedPortal();
        var resume = maybeResumePrincipal(user, portal);
        return resume.then(function (principalResult) {
            if (principalResult) {
                if (global.EMS_SHARED_PORTAL_RELOAD_REQUIRED === true) {
                    return { handled: true, principal: true, reloading: true };
                }
                return principalResult;
            }
            if (state.interceptPromise && !options.force) return state.interceptPromise;

            state.interceptPromise = resolveGateway(user, portal).then(function (resolution) {
                state.interceptPromise = null;
                if (!resolution.matched) return { handled: false, matched: false };

                markRawGateway(user, resolution, portal);

                if (!validPortal(portal)) {
                    showBlockedGateway(
                        'پورٹل درست منتخب نہیں ہوا',
                        'یہ مشترک گوگل اکاؤنٹ انتظامیہ پورٹل نہیں کھول سکتا۔ پہلے اساتذہ، طلبہ یا والدین پورٹل منتخب کریں۔',
                        false
                    );
                    return { handled: true, blocked: true, reason: 'portal-not-selected' };
                }
                if (resolution.allowedPortals.length && resolution.allowedPortals.indexOf(portal) < 0) {
                    showBlockedGateway(
                        'اس پورٹل کی اجازت نہیں',
                        'یہ مشترک گوگل اکاؤنٹ ' + portalLabel(portal) + ' کے لیے مقرر نہیں ہے۔',
                        false
                    );
                    return { handled: true, blocked: true, reason: 'portal-not-allowed' };
                }
                if (portal === PORTALS.STUDENT && !studentPortalAvailable()) {
                    showBlockedGateway(
                        'طالب علم پورٹل ابھی دستیاب نہیں',
                        'اس کا مشترک گوگل اکاؤنٹ ترتیب میں محفوظ رہ سکتا ہے، مگر طالب علم پورٹل فعال ہونے تک کسی طالب علم کا ڈیٹا نہیں کھلے گا۔',
                        false
                    );
                    return { handled: true, blocked: true, reason: 'student-unavailable' };
                }

                renderGatewayPrompt(user, resolution, portal);
                return { handled: true, matched: true, awaitingPerson: true };
            }).catch(function (err) {
                state.interceptPromise = null;
                // feature فعال ہونے پر resolver failure کو fail-closed رکھیں۔
                markRawGateway(user, {}, portal);
                showBlockedGateway(
                    'محفوظ شناخت مکمل نہیں ہوئی',
                    urduError(err, 'resolve'),
                    normalizedErrorCode(err) === 'unavailable' || normalizedErrorCode(err) === 'deadline-exceeded'
                );
                return { handled: true, blocked: true, error: normalizedErrorCode(err) || 'resolve-failed' };
            });
            return state.interceptPromise;
        });
    }

    function defaultConfig() {
        return {
            version: CONFIG_VERSION,
            mode: MODES.INDIVIDUAL,
            singleEmail: '',
            emails: { teacher: '', student: '', parent: '' }
        };
    }

    function normalizeConfig(input) {
        input = input && input.config ? input.config : (input || {});
        var cfg = defaultConfig();
        var mode = String(input.mode || '');
        cfg.mode = mode === MODES.SINGLE || mode === MODES.SEPARATE ? mode : MODES.INDIVIDUAL;
        cfg.singleEmail = normalizeEmail(input.singleEmail);
        var emails = input.emails || {};
        cfg.emails.teacher = normalizeEmail(emails.teacher || input.teacherEmail);
        cfg.emails.student = normalizeEmail(emails.student || input.studentEmail);
        cfg.emails.parent = normalizeEmail(emails.parent || input.parentEmail);
        return cfg;
    }

    function validateConfig(config, ownerEmail) {
        config = normalizeConfig(config);
        ownerEmail = normalizeEmail(ownerEmail);
        var activeEmails = [];

        if (config.mode === MODES.SINGLE) {
            if (!validEmail(config.singleEmail)) {
                throw makeError('invalid-argument', 'مشترک گوگل ای میل درست درج کریں۔');
            }
            activeEmails = [config.singleEmail];
        }
        if (config.mode === MODES.SEPARATE) {
            activeEmails = [config.emails.teacher, config.emails.student, config.emails.parent];
            if (!activeEmails.every(validEmail)) {
                throw makeError('invalid-argument', 'تینوں پورٹل کے درست گوگل ای میل درج کریں۔');
            }
            if (new Set(activeEmails).size !== activeEmails.length) {
                throw makeError('invalid-argument', 'الگ ترتیب میں تینوں گوگل ای میل ایک دوسرے سے مختلف ہونے چاہییں۔');
            }
        }
        if (ownerEmail && activeEmails.indexOf(ownerEmail) !== -1) {
            throw makeError('owner-email-forbidden');
        }
        return config;
    }

    function isStrictOwner() {
        // Backend ownership is uid-bound; a platform role alone must not edit
        // another institution's shared gateway configuration.
        return global.CURRENT_USER_TENANT_ROLE === 'owner';
    }

    function loadOwnerConfig(tenantId) {
        tenantId = tenantId || getTenantId();
        if (!tenantId) return Promise.reject(makeError('failed-precondition'));
        return callFunction(getCallableNames().getConfig, {
            version: CONFIG_VERSION,
            tenantId: tenantId
        }).then(normalizeConfig);
    }

    function saveOwnerConfig(config, tenantId) {
        var user = getCurrentUser();
        if (!isFeatureEnabled()) return Promise.reject(makeError('failed-precondition'));
        tenantId = tenantId || getTenantId();
        if (!user || !tenantId) return Promise.reject(makeError('unauthenticated'));
        if (!isStrictOwner()) return Promise.reject(makeError('permission-denied'));
        var clean;
        try { clean = validateConfig(config, user.email); }
        catch (e) { return Promise.reject(e); }

        return callFunction(getCallableNames().saveConfig, {
            version: CONFIG_VERSION,
            tenantId: tenantId,
            config: clean
        }).then(function (response) {
            return normalizeConfig(response && response.config ? response.config : clean);
        });
    }

    function resolveMount(target) {
        if (typeof target === 'string') return document.getElementById(target);
        return target && target.nodeType === 1 ? target : null;
    }

    function makeEmailField(id, labelText) {
        var wrap = node('div', 'ems-spg-field');
        wrap.setAttribute('data-field', id);
        var label = node('label', 'ems-spg-label', labelText);
        var input = node('input', 'ems-spg-input');
        input.type = 'email';
        input.id = id;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.maxLength = 254;
        input.setAttribute('dir', 'ltr');
        label.setAttribute('for', id);
        wrap.appendChild(label);
        wrap.appendChild(input);
        return { wrap: wrap, input: input };
    }

    function renderOwnerConfig(target, options) {
        options = options || {};
        var mount = resolveMount(target);
        if (!mount) throw makeError('invalid-argument', 'ترتیب دکھانے کی جگہ نہیں ملی۔');
        ensureStyles();

        while (mount.firstChild) mount.removeChild(mount.firstChild);
        var box = node('section', 'ems-spg-config');
        box.setAttribute('aria-labelledby', 'ems-spg-config-title');
        var title = node('h3', '', 'پورٹل کے مشترک گوگل اکاؤنٹس');
        title.id = 'ems-spg-config-title';
        box.appendChild(title);
        box.appendChild(node(
            'p',
            'ems-spg-muted',
            'ہر فرد کا الگ گوگل اکاؤنٹ رکھیں، ایک مخصوص گوگل اکاؤنٹ تینوں پورٹل کے لیے رکھیں، یا تینوں پورٹل کے الگ مشترک اکاؤنٹس مقرر کریں۔ مشترک اکاؤنٹ کے لیے ایسا الگ گوگل ای میل رکھیں جو کسی ادارے کے مالک، استاد، عملے، طالب علم یا والدین کی ذاتی شناخت کے طور پر پہلے سے استعمال نہ ہو۔'
        ));

        var modeWrap = node('div', 'ems-spg-modes');
        var modeInputs = {};
        [
            { value: MODES.INDIVIDUAL, title: 'ہر فرد کا الگ گوگل اکاؤنٹ', desc: 'موجودہ طریقہ؛ ہر استاد، طالب علم یا والدین اپنی ذاتی گوگل شناخت استعمال کریں گے۔' },
            { value: MODES.SINGLE, title: 'ایک مشترک گوگل اکاؤنٹ', desc: 'اساتذہ، طلبہ اور والدین ایک مخصوص گوگل اکاؤنٹ سے شروع کریں گے، پھر ذاتی نمبر اور کلید دیں گے۔' },
            { value: MODES.SEPARATE, title: 'تین الگ مشترک گوگل اکاؤنٹس', desc: 'اساتذہ و عملہ، طلبہ اور والدین کے پورٹل کے لیے الگ الگ مخصوص گوگل اکاؤنٹ ہوگا۔' }
        ].forEach(function (item, index) {
            var label = node('label', 'ems-spg-mode');
            var radio = node('input');
            radio.type = 'radio';
            radio.name = 'ems-spg-config-mode';
            radio.value = item.value;
            radio.id = 'ems-spg-mode-' + item.value;
            if (index === 0) radio.checked = true;
            var words = node('span');
            var strong = node('strong', '', item.title);
            var desc = node('span', 'ems-spg-muted', item.desc);
            desc.style.display = 'block';
            words.appendChild(strong);
            words.appendChild(desc);
            label.appendChild(radio);
            label.appendChild(words);
            modeWrap.appendChild(label);
            modeInputs[item.value] = radio;
        });
        box.appendChild(modeWrap);

        var fields = node('div', 'ems-spg-fields');
        var single = makeEmailField('ems-spg-single-email', 'تینوں پورٹل کا مشترک گوگل ای میل');
        var teacher = makeEmailField('ems-spg-teacher-email', 'اساتذہ و عملہ پورٹل کا گوگل ای میل');
        var student = makeEmailField('ems-spg-student-email', 'طلبہ پورٹل کا گوگل ای میل');
        var parent = makeEmailField('ems-spg-parent-email', 'والدین پورٹل کا گوگل ای میل');
        fields.appendChild(single.wrap);
        fields.appendChild(teacher.wrap);
        fields.appendChild(student.wrap);
        fields.appendChild(parent.wrap);
        box.appendChild(fields);

        var studentNote = node(
            'p',
            'ems-spg-muted',
            studentPortalAvailable()
                ? 'طلبہ پورٹل فعال ہے۔ ہر طالب علم کی ذاتی رسائی کلید پھر بھی لازم ہوگی۔'
                : 'طلبہ پورٹل ابھی فعال نہیں؛ اس کا گوگل ای میل پیشگی محفوظ ہوگا مگر پورٹل کھلنے تک طلبہ کا ڈیٹا دستیاب نہیں ہوگا۔'
        );
        box.appendChild(studentNote);

        var status = node('p', 'ems-spg-status');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        box.appendChild(status);

        var actions = node('div', 'ems-spg-actions');
        var save = node('button', 'ems-spg-btn ems-spg-primary', 'ترتیب محفوظ کریں');
        save.type = 'button';
        var reload = node('button', 'ems-spg-btn ems-spg-secondary', 'دوبارہ لوڈ کریں');
        reload.type = 'button';
        actions.appendChild(save);
        actions.appendChild(reload);
        box.appendChild(actions);
        mount.appendChild(box);

        function selectedMode() {
            if (modeInputs[MODES.SINGLE].checked) return MODES.SINGLE;
            if (modeInputs[MODES.SEPARATE].checked) return MODES.SEPARATE;
            return MODES.INDIVIDUAL;
        }

        function updateFieldVisibility() {
            var mode = selectedMode();
            single.wrap.hidden = mode !== MODES.SINGLE;
            teacher.wrap.hidden = mode !== MODES.SEPARATE;
            student.wrap.hidden = mode !== MODES.SEPARATE;
            parent.wrap.hidden = mode !== MODES.SEPARATE;
            single.input.disabled = mode !== MODES.SINGLE;
            teacher.input.disabled = mode !== MODES.SEPARATE;
            student.input.disabled = mode !== MODES.SEPARATE;
            parent.input.disabled = mode !== MODES.SEPARATE;
        }

        function readForm() {
            return {
                version: CONFIG_VERSION,
                mode: selectedMode(),
                singleEmail: single.input.value,
                emails: {
                    teacher: teacher.input.value,
                    student: student.input.value,
                    parent: parent.input.value
                }
            };
        }

        function writeForm(config) {
            config = normalizeConfig(config);
            Object.keys(modeInputs).forEach(function (key) {
                modeInputs[key].checked = key === config.mode;
            });
            single.input.value = config.singleEmail;
            teacher.input.value = config.emails.teacher;
            student.input.value = config.emails.student;
            parent.input.value = config.emails.parent;
            updateFieldVisibility();
        }

        function setBusy(busy) {
            save.disabled = !!busy;
            reload.disabled = !!busy;
            Object.keys(modeInputs).forEach(function (key) { modeInputs[key].disabled = !!busy; });
            [single.input, teacher.input, student.input, parent.input].forEach(function (input) {
                if (busy) input.disabled = true;
            });
            if (!busy) updateFieldVisibility();
        }

        function load() {
            if (!isFeatureEnabled()) {
                setBusy(true);
                setStatus(status, 'محفوظ مشترک پورٹل کی سروری سہولت ابھی فعال نہیں کی گئی۔', 'error');
                return Promise.resolve(defaultConfig());
            }
            setBusy(true);
            setStatus(status, 'ترتیب لوڈ ہو رہی ہے…', 'info');
            return loadOwnerConfig(options.tenantId).then(function (config) {
                writeForm(config);
                setStatus(status, 'موجودہ ترتیب لوڈ ہو گئی۔', 'success');
                return config;
            }).catch(function (err) {
                setStatus(status, urduError(err, 'config-load'), 'error');
                throw err;
            }).finally(function () {
                setBusy(false);
            });
        }

        function saveConfig() {
            var clean;
            try {
                clean = validateConfig(readForm(), (getCurrentUser() || {}).email);
            } catch (err) {
                setStatus(status, err.message && err.message !== err.code ? err.message : urduError(err, 'config-save'), 'error');
                return Promise.reject(err);
            }
            setBusy(true);
            setStatus(status, 'ترتیب محفوظ اور سرور سے تصدیق ہو رہی ہے…', 'info');
            return saveOwnerConfig(clean, options.tenantId).then(function (saved) {
                writeForm(saved);
                setStatus(status, 'مشترک پورٹل کی ترتیب محفوظ ہو گئی۔', 'success');
                notify('مشترک پورٹل کی ترتیب محفوظ ہو گئی۔', 'success');
                if (typeof options.onSaved === 'function') options.onSaved(saved);
                return saved;
            }).catch(function (err) {
                setStatus(status, urduError(err, 'config-save'), 'error');
                throw err;
            }).finally(function () {
                setBusy(false);
            });
        }

        Object.keys(modeInputs).forEach(function (key) {
            modeInputs[key].addEventListener('change', updateFieldVisibility);
        });
        save.addEventListener('click', function () { saveConfig().catch(function () { /* UI has error */ }); });
        reload.addEventListener('click', function () { load().catch(function () { /* UI has error */ }); });
        updateFieldVisibility();

        var controller = {
            element: box,
            load: load,
            save: saveConfig,
            getValue: function () { return normalizeConfig(readForm()); },
            setValue: writeForm,
            destroy: function () {
                var index = state.ownerControllers.indexOf(controller);
                if (index >= 0) state.ownerControllers.splice(index, 1);
                if (box.parentNode) box.parentNode.removeChild(box);
            }
        };
        state.ownerControllers.push(controller);
        if (options.autoLoad !== false) load().catch(function () { /* visible status is enough */ });
        return controller;
    }

    function resetGatewaySession(options) {
        options = options || {};
        removeGateway();
        removeSessionKey(EXCHANGE_KEY);
        clearLoopGuard();
        clearPrincipalTimers();
        clearRawGatewayState();
        global.EMS_SHARED_PORTAL_PRINCIPAL = null;
        if (options.signOut === true) return signOutRawGateway();
        return Promise.resolve();
    }

    // صاف اور محدود عالمی API — integration فائلیں انہی hooks کو استعمال کریں۔
    global.emsSharedPortalMaybeIntercept = maybeIntercept;
    global.emsSharedPortalCanLoadAppData = canLoadAppData;
    global.emsSharedPortalIsRawGatewayUser = isRawGatewayUser;
    global.emsSharedPortalSignOutRawGateway = signOutRawGateway;
    global.emsSharedPortalResetGatewaySession = resetGatewaySession;
    global.emsSharedPortalPrepareLogout = prepareSharedPortalLogout;
    global.emsRenderSharedPortalConfig = renderOwnerConfig;
    global.emsLoadSharedPortalConfig = loadOwnerConfig;
    global.emsSaveSharedPortalConfig = saveOwnerConfig;

    global.EmsSharedPortalGateway = Object.freeze({
        version: CONFIG_VERSION,
        modes: MODES,
        portals: PORTALS,
        callableNames: getCallableNames,
        formatError: urduError,
        normalizeEmail: normalizeEmail,
        enabled: isFeatureEnabled,
        maybeIntercept: maybeIntercept,
        canLoadAppData: canLoadAppData,
        isRawGatewayUser: isRawGatewayUser,
        renderOwnerConfig: renderOwnerConfig,
        loadOwnerConfig: loadOwnerConfig,
        saveOwnerConfig: saveOwnerConfig,
        prepareLogout: prepareSharedPortalLogout,
        reset: resetGatewaySession
    });

})(window);
