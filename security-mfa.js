// ============================================================================
// EMS MFA — Phase 6 (enrollment, login challenge, compliance gate)
// Requires Firebase Auth + Identity Platform with TOTP MFA enabled
// ============================================================================
(function (global) {
    'use strict';

    var _pendingResolver = null;
    var _pendingTotpSecret = null;
    var _complianceState = { compliant: true, policy: null, status: null };

    function getDb() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    function getTenantId() {
        if (global.emsGetTenantId) return global.emsGetTenantId();
        var u = firebase.auth().currentUser;
        return u ? u.uid : null;
    }

    function toast(msg, type) {
        if (typeof global.showToast === 'function') global.showToast(msg, type);
        else if (typeof global.showTopAlert === 'function') global.showTopAlert(msg, type === 'error');
    }

    function openModal(id) {
        if (typeof global.openModal === 'function') global.openModal(id);
        else {
            var el = document.getElementById(id);
            if (el) el.style.display = 'flex';
        }
    }

    function closeModal(id) {
        if (typeof global.closeModal === 'function') global.closeModal(id);
        else {
            var el = document.getElementById(id);
            if (el) el.style.display = 'none';
        }
    }

    function getTotpGenerator() {
        if (typeof firebase === 'undefined' || !firebase.auth) return null;
        return firebase.auth.TotpMultiFactorGenerator || null;
    }

    global.emsIsMfaAvailable = function () {
        var user = firebase.auth().currentUser;
        return !!(user && user.multiFactor && getTotpGenerator());
    };

    global.emsGetMfaStatus = function () {
        var user = firebase.auth().currentUser;
        if (!user) return { enrolled: false, factors: 0, available: false, factorList: [] };
        var available = !!(user.multiFactor && typeof user.multiFactor.enrolledFactors !== 'undefined');
        var factors = available ? (user.multiFactor.enrolledFactors || []) : [];
        return {
            enrolled: factors.length > 0,
            factors: factors.length,
            available: available && !!getTotpGenerator(),
            factorIds: factors.map(function (f) { return f.factorId || f.uid || 'factor'; }),
            factorList: factors.map(function (f) {
                return {
                    uid: f.uid,
                    displayName: f.displayName || 'Authenticator',
                    factorId: f.factorId
                };
            })
        };
    };

    global.emsLoadMfaPolicy = function () {
        var db = getDb();
        var tenantId = getTenantId();
        if (!db || !tenantId) {
            return Promise.resolve({ requireMfaForAdmin: false, requireMfaForStaff: false, requireMfaForParent: false });
        }
        return db.collection('All_Madrasas').doc(tenantId).collection('SecuritySettings').doc('mfa')
            .get()
            .then(function (doc) {
                var d = doc.exists ? doc.data() : {};
                return {
                    requireMfaForAdmin: !!d.requireMfaForAdmin,
                    requireMfaForStaff: !!d.requireMfaForStaff,
                    requireMfaForParent: !!d.requireMfaForParent
                };
            })
            .catch(function () {
                return { requireMfaForAdmin: false, requireMfaForStaff: false, requireMfaForParent: false };
            });
    };

    global.emsSaveMfaPolicy = function (patch) {
        var db = getDb();
        var tenantId = getTenantId();
        if (!db || !tenantId) return Promise.reject(new Error('Firestore unavailable'));
        if (!global.isMadrasaAdmin || !global.isMadrasaAdmin()) {
            return Promise.reject(new Error('صرف ادارے کا منتظم MFA policy بدل سکتا ہے'));
        }
        var requireAdmin = typeof patch === 'boolean' ? patch : !!patch.requireMfaForAdmin;
        var requireStaff = typeof patch === 'object' && patch !== null ? !!patch.requireMfaForStaff : false;
        var requireParent = typeof patch === 'object' && patch !== null ? !!patch.requireMfaForParent : false;
        return db.collection('All_Madrasas').doc(tenantId).collection('SecuritySettings').doc('mfa')
            .set({
                requireMfaForAdmin: requireAdmin,
                requireMfaForStaff: requireStaff,
                requireMfaForParent: requireParent,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedBy: (firebase.auth().currentUser && firebase.auth().currentUser.email) || ''
            }, { merge: true });
    };

    global.emsCheckMfaComplianceForPortal = function (tenantId, portal) {
        if (typeof global.emsCallFunction !== 'function') {
            return Promise.resolve({ compliant: true, skipped: true });
        }
        if (!tenantId) {
            return Promise.resolve({ compliant: true, skipped: true });
        }
        return global.emsCallFunction('checkMfaCompliance', {
            tenantId: tenantId,
            portal: portal || 'admin'
        }).then(function (server) {
            return {
                compliant: !!(server && server.compliant),
                server: server || {},
                policy: {
                    requireMfaForAdmin: !!(server && server.required && server.isOwner),
                    requireMfaForStaff: !!(server && server.required && server.isStaff),
                    requireMfaForParent: !!(server && server.required && server.isParent)
                }
            };
        }).catch(function () {
            return { compliant: true, skipped: true };
        });
    };

    global.emsCheckMfaCompliance = function () {
        var baseCheck = global.emsLoadMfaPolicy().then(function (policy) {
            if (!policy.requireMfaForAdmin) {
                _complianceState = { compliant: true, policy: policy, status: global.emsGetMfaStatus() };
                return _complianceState;
            }
            if (!global.isMadrasaAdmin || !global.isMadrasaAdmin()) {
                _complianceState = { compliant: true, policy: policy, status: global.emsGetMfaStatus() };
                return _complianceState;
            }
            var st = global.emsGetMfaStatus();
            _complianceState = { compliant: st.enrolled, policy: policy, status: st };
            return _complianceState;
        });

        if (typeof global.emsCallFunction !== 'function') return baseCheck;

        var tenantId = getTenantId();
        if (!tenantId) return baseCheck;

        return global.emsCallFunction('checkMfaCompliance', { tenantId: tenantId })
            .then(function (server) {
                return baseCheck.then(function (local) {
                    if (server && typeof server.compliant === 'boolean') {
                        _complianceState = {
                            compliant: server.compliant,
                            policy: local.policy,
                            status: local.status,
                            server: server
                        };
                        return _complianceState;
                    }
                    return local;
                });
            })
            .catch(function () { return baseCheck; });
    };

    global.emsGetMfaComplianceState = function () {
        return _complianceState;
    };

    global.emsRequireMfaCompliance = function (actionLabel) {
        if (_complianceState.compliant) return true;
        if (_complianceState.server && _complianceState.server.sessionMfa === false && _complianceState.server.enrolled) {
            toast('MFA سیشن ختم — دوبارہ لاگ ان کریں (Authenticator کوڈ کے ساتھ)' + (actionLabel ? ' (' + actionLabel + ')' : ''), 'error');
            return false;
        }
        toast('MFA لازمی ہے — سسٹم سیٹنگز سے Authenticator فعال کریں' + (actionLabel ? ' (' + actionLabel + ')' : ''), 'error');
        if (typeof global.navigateToModule === 'function') {
            var tab = document.getElementById('tab-sys-settings');
            if (tab) global.navigateToModule(tab);
        }
        return false;
    };

    global.emsApplyMfaComplianceGate = function () {
        return global.emsCheckMfaCompliance().then(function (state) {
            var banner = document.getElementById('ems-mfa-compliance-banner');
            if (!banner) return state;
            if (state.compliant || !state.policy || !state.policy.requireMfaForAdmin) {
                banner.style.display = 'none';
                banner.innerHTML = '';
                return state;
            }
            banner.style.display = 'block';
            banner.innerHTML = '<i class="fas fa-shield-alt"></i> ادارے کے منتظم کے لیے دو مرحلہ تصدیق (MFA) لازمی ہے۔ ' +
                '<button type="button" class="btn btn-sm" style="margin-right:10px;background:#fff;color:#92400e;" onclick="window.emsOpenMfaEnrollment()">ابھی فعال کریں</button>';
            return state;
        });
    };

    global.emsReauthenticate = function (password) {
        var user = firebase.auth().currentUser;
        if (!user || !user.email) return Promise.reject(new Error('لاگ ان صارف نہیں ملا'));
        if (!password) return Promise.reject(new Error('پاسورڈ درج کریں'));
        var cred = firebase.auth.EmailAuthProvider.credential(user.email, password);
        return user.reauthenticateWithCredential(cred);
    };

    global.emsOpenMfaEnrollment = function () {
        if (!global.emsIsMfaAvailable()) {
            toast('MFA اس پروجیکٹ میں فعال نہیں — Firebase Console → Authentication → Multi-factor سے TOTP فعال کریں', 'error');
            return;
        }
        var passEl = document.getElementById('ems-mfa-reauth-pass');
        if (passEl) passEl.value = '';
        openModal('ems-mfa-reauth-modal');
    };

    global.emsStartTotpEnrollment = function () {
        var passEl = document.getElementById('ems-mfa-reauth-pass');
        var password = passEl ? passEl.value : '';
        var TotpGen = getTotpGenerator();
        var user = firebase.auth().currentUser;
        if (!TotpGen || !user) return Promise.reject(new Error('MFA دستیاب نہیں'));

        return global.emsReauthenticate(password).then(function () {
            closeModal('ems-mfa-reauth-modal');
            return user.multiFactor.getSession();
        }).then(function (session) {
            return TotpGen.generateSecret(session);
        }).then(function (secret) {
            _pendingTotpSecret = secret;
            var qrBox = document.getElementById('ems-mfa-qr-box');
            var secretBox = document.getElementById('ems-mfa-secret-text');
            var codeEl = document.getElementById('ems-mfa-enroll-code');
            if (codeEl) codeEl.value = '';
            if (qrBox) {
                try {
                    var qrUrl = secret.generateQrCodeUrl(user.email || 'admin', 'Madrasah EMS');
                    qrBox.innerHTML = '<img src="' + qrUrl + '" alt="QR Code" style="max-width:200px;border:1px solid #ddd;padding:8px;background:#fff;" />';
                } catch (e) {
                    qrBox.innerHTML = '<p style="color:#64748b;">QR نہیں بن سکا — نیچے secret key دستی داخل کریں</p>';
                }
            }
            if (secretBox && secret.secretKey) {
                secretBox.textContent = secret.secretKey;
            }
            openModal('ems-mfa-enroll-modal');
        }).catch(function (err) {
            toast('MFA شروع نہیں ہو سکا: ' + (err.message || err), 'error');
            throw err;
        });
    };

    global.emsFinishTotpEnrollment = function () {
        var TotpGen = getTotpGenerator();
        var user = firebase.auth().currentUser;
        var codeEl = document.getElementById('ems-mfa-enroll-code');
        var code = codeEl ? String(codeEl.value || '').trim() : '';
        if (!TotpGen || !user || !_pendingTotpSecret) {
            return Promise.reject(new Error('پہلے enrollment شروع کریں'));
        }
        if (!/^\d{6}$/.test(code)) {
            return Promise.reject(new Error('6 ہندسوں کا کوڈ درج کریں'));
        }
        var assertion = TotpGen.assertionForEnrollment(_pendingTotpSecret, code);
        return user.multiFactor.enroll(assertion, 'Authenticator App').then(function () {
            _pendingTotpSecret = null;
            closeModal('ems-mfa-enroll-modal');
            toast('دو مرحلہ تصدیق کامیابی سے فعال ہو گئی', 'success');
            if (global.emsLogSecurityEvent) {
                global.emsLogSecurityEvent('mfa_enrolled', { factors: 1 });
            }
            return global.emsApplyMfaComplianceGate().then(function () {
                if (typeof global.emsInitMfaUI === 'function') global.emsInitMfaUI();
            });
        });
    };

    global.emsUnenrollMfaFactor = function (factorUid) {
        var passEl = document.getElementById('ems-mfa-unenroll-pass');
        var password = passEl ? passEl.value : '';
        var user = firebase.auth().currentUser;
        if (!user || !factorUid) return Promise.reject(new Error('غلط درخواست'));
        return global.emsLoadMfaPolicy().then(function (policy) {
            if (policy.requireMfaForAdmin && global.isMadrasaAdmin && global.isMadrasaAdmin()) {
                return Promise.reject(new Error('MFA policy فعال ہے — پہلے policy بند کریں یا دوسرا factor رکھیں'));
            }
            return global.emsReauthenticate(password);
        }).then(function () {
            var factor = (user.multiFactor.enrolledFactors || []).find(function (f) { return f.uid === factorUid; });
            if (!factor) return Promise.reject(new Error('Factor نہیں ملا'));
            return user.multiFactor.unenroll(factor);
        }).then(function () {
            closeModal('ems-mfa-unenroll-modal');
            toast('MFA factor ہٹا دیا گیا', 'success');
            if (global.emsLogSecurityEvent) global.emsLogSecurityEvent('mfa_unenrolled', { factorUid: factorUid });
            if (typeof global.emsInitMfaUI === 'function') global.emsInitMfaUI();
        });
    };

    global.emsOpenUnenrollModal = function (factorUid) {
        var hidden = document.getElementById('ems-mfa-unenroll-uid');
        var passEl = document.getElementById('ems-mfa-unenroll-pass');
        if (hidden) hidden.value = factorUid || '';
        if (passEl) passEl.value = '';
        openModal('ems-mfa-unenroll-modal');
    };

    global.emsHandleMfaSignInError = function (error) {
        if (!error || error.code !== 'auth/multi-factor-auth-required') {
            return Promise.reject(error);
        }
        _pendingResolver = error.resolver;
        var hint = (_pendingResolver.hints && _pendingResolver.hints[0]) || null;
        var label = document.getElementById('ems-mfa-signin-label');
        var codeEl = document.getElementById('ems-mfa-signin-code');
        if (codeEl) codeEl.value = '';
        if (label) {
            label.textContent = hint && hint.displayName
                ? ('«' + hint.displayName + '» سے 6 ہندسوں کا کوڈ درج کریں')
                : 'Authenticator ایپ سے 6 ہندسوں کا کوڈ درج کریں';
        }
        openModal('ems-mfa-signin-modal');
        return Promise.resolve({ pending: true });
    };

    global.emsCompleteMfaSignIn = function () {
        var TotpGen = getTotpGenerator();
        var codeEl = document.getElementById('ems-mfa-signin-code');
        var code = codeEl ? String(codeEl.value || '').trim() : '';
        if (!_pendingResolver || !TotpGen) {
            return Promise.reject(new Error('MFA session نہیں ملا'));
        }
        if (!/^\d{6}$/.test(code)) {
            return Promise.reject(new Error('6 ہندسوں کا کوڈ درج کریں'));
        }
        var hint = (_pendingResolver.hints && _pendingResolver.hints[0]) || null;
        if (!hint) return Promise.reject(new Error('MFA hint نہیں ملا'));
        var assertion = TotpGen.assertionForSignIn(hint.uid, code);
        return _pendingResolver.resolveSignIn(assertion).then(function (cred) {
            _pendingResolver = null;
            closeModal('ems-mfa-signin-modal');
            return cred;
        });
    };

    global.emsCancelMfaSignIn = function () {
        _pendingResolver = null;
        closeModal('ems-mfa-signin-modal');
        return firebase.auth().signOut();
    };

    global.emsInitMfaUI = function () {
        var box = document.getElementById('ems-mfa-status-box');
        if (!box) return;

        var st = global.emsGetMfaStatus();
        global.emsLoadMfaPolicy().then(function (policy) {
            var html = '<div style="padding:12px; background:#f8fafc; border-radius:8px; border:1px solid #e2e8f0;">';
            html += '<h4 style="margin:0 0 8px;"><i class="fas fa-shield-alt"></i> دو مرحلہ تصدیق (MFA)</h4>';

            if (!st.available) {
                html += '<p style="color:#b45309;">⚠️ TOTP MFA دستیاب نہیں — Firebase Console → Authentication → Sign-in method → Multi-factor سے TOTP فعال کریں (Identity Platform)۔</p>';
            } else if (st.enrolled) {
                html += '<p style="color:#059669;">✅ ' + st.factors + ' Authenticator factor(s) فعال</p>';
                html += '<ul style="margin:8px 0;padding-right:20px;">';
                (st.factorList || []).forEach(function (f) {
                    html += '<li>' + (f.displayName || 'Authenticator') +
                        ' <button type="button" class="btn btn-outline btn-sm" onclick="window.emsOpenUnenrollModal(\'' + f.uid + '\')">ہٹائیں</button></li>';
                });
                html += '</ul>';
            } else {
                html += '<p style="color:#b45309;">⚠️ MFA فعال نہیں — لاگ ان کی extra سیکیورٹی کے لیے Authenticator ایپ منسلک کریں۔</p>';
                html += '<button type="button" class="btn btn-primary btn-sm" onclick="window.emsOpenMfaEnrollment()"><i class="fas fa-qrcode"></i> Authenticator منسلک کریں</button>';
            }

            if (global.isMadrasaAdmin && global.isMadrasaAdmin()) {
                html += '<hr style="margin:12px 0;border:none;border-top:1px solid #e2e8f0;" />';
                html += '<label style="display:flex; align-items:center; gap:8px; margin-top:6px;">';
                html += '<input type="checkbox" id="ems-mfa-require-admin" ' + (policy.requireMfaForAdmin ? 'checked' : '') + ' />';
                html += 'ادارے کے منتظم کے لیے MFA لازمی</label>';
                html += '<label style="display:flex; align-items:center; gap:8px; margin-top:6px;">';
                html += '<input type="checkbox" id="ems-mfa-require-staff" ' + (policy.requireMfaForStaff ? 'checked' : '') + ' />';
                html += 'Staff / Teacher کے لیے MFA لازمی</label>';
                html += '<label style="display:flex; align-items:center; gap:8px; margin-top:6px;">';
                html += '<input type="checkbox" id="ems-mfa-require-parent" ' + (policy.requireMfaForParent ? 'checked' : '') + ' />';
                html += 'Parent / والدین کے لیے MFA لازمی</label>';
                html += '<button type="button" class="btn btn-outline btn-sm" style="margin-top:10px;" onclick="window.emsSaveMfaPolicyUI()"><i class="fas fa-save"></i> policy محفوظ کریں</button>';
            }
            html += '</div>';
            box.innerHTML = html;
        });
    };

    global.emsRenderParentMfaBanner = function (container) {
        if (!container) return;
        var existing = document.getElementById('pp-mfa-banner');
        if (existing) existing.remove();
        var st = global.emsGetMfaStatus();
        if (!st.available) return;
        var div = document.createElement('div');
        div.id = 'pp-mfa-banner';
        div.style.cssText = 'margin-bottom:14px;padding:12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:13px;';
        if (st.enrolled) {
            div.innerHTML = '<i class="fas fa-shield-alt"></i> Authenticator MFA فعال ہے (' + st.factors + ' factor)';
        } else {
            div.innerHTML = '<i class="fas fa-shield-alt"></i> اضافی سیکیورٹی: ' +
                '<button type="button" class="btn btn-primary btn-sm" onclick="window.emsOpenMfaEnrollment()"><i class="fas fa-qrcode"></i> Authenticator منسلک کریں</button>';
        }
        container.insertBefore(div, container.firstChild);
    };

    global.emsSaveMfaPolicyUI = function () {
        var cbAdmin = document.getElementById('ems-mfa-require-admin');
        var cbStaff = document.getElementById('ems-mfa-require-staff');
        var cbParent = document.getElementById('ems-mfa-require-parent');
        var patch = {
            requireMfaForAdmin: cbAdmin ? cbAdmin.checked : false,
            requireMfaForStaff: cbStaff ? cbStaff.checked : false,
            requireMfaForParent: cbParent ? cbParent.checked : false
        };
        global.emsSaveMfaPolicy(patch).then(function () {
            toast('MFA policy محفوظ ہو گئی', 'success');
            if (global.emsLogSecurityEvent) {
                global.emsLogSecurityEvent('mfa_policy_updated', patch);
            }
            return global.emsApplyMfaComplianceGate();
        }).then(function () {
            if (typeof global.emsInitMfaUI === 'function') global.emsInitMfaUI();
        }).catch(function (err) {
            toast('MFA policy محفوظ نہیں ہو سکی: ' + err.message, 'error');
        });
    };

})(window);
