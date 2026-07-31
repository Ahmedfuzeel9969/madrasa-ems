/**
 * sa-billing.js — Billing, subscriptions, manual payments
 */
(function (global) {
    'use strict';

    function core() { return global.SaCore; }
    function esc(v) { return core() ? core().esc(v) : String(v || ''); }
    function toast(msg, type) { if (core()) core().toast(msg, type); }
    function db() { return core() ? core().db() : null; }

    function mergeTenant(uid, data) {
        if (typeof global.saMergeTenant === 'function') return global.saMergeTenant(uid, data);
        return global.SA_PENDING_EDITS[uid] || {};
    }

    function loadPlans() {
        var firestore = db();
        if (!firestore) return Promise.resolve([]);
        return firestore.collection('System_Settings').doc('BillingPlans').get().then(function (doc) {
            global.SA_BILLING_PLANS = doc.exists && doc.data().plans ? doc.data().plans : [
                { id: 'basic', name: 'Basic', price: 0 },
                { id: 'pro', name: 'Pro', price: 2500 },
                { id: 'enterprise', name: 'Enterprise', price: 5000 }
            ];
            var plansEl = document.getElementById('sa-plans-list');
            if (plansEl) {
                plansEl.innerHTML = global.SA_BILLING_PLANS.map(function (p) {
                    return '<div class="sa-plan-row"><strong>' + esc(p.name) + '</strong> — Rs ' +
                        (Number(p.price) || 0).toLocaleString() + '/ماہ</div>';
                }).join('');
            }
            return global.SA_BILLING_PLANS;
        });
    }

    function monthStartDate() {
        var now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    }

    function loadCollectedThisMonth() {
        var firestore = db();
        var el = document.getElementById('sa-billing-collected');
        if (!firestore || !el) return Promise.resolve();

        var start = monthStartDate();
        return firestore.collection('Platform_Payments')
            .where('status', '==', 'paid')
            .limit(200)
            .get()
            .then(function (snap) {
                var total = 0;
                snap.forEach(function (doc) {
                    var d = doc.data();
                    var paidAt = d.paidAt && d.paidAt.toDate ? d.paidAt.toDate() : null;
                    if (paidAt && paidAt >= start) total += Number(d.amount) || 0;
                });
                el.textContent = 'Rs ' + total.toLocaleString();
                return total;
            })
            .catch(function () {
                return firestore.collection('Platform_Config').doc('sa_payment_mirror').get()
                    .then(function (doc) {
                        var total = doc.exists && doc.data().collectedMonth ? Number(doc.data().collectedMonth) : 0;
                        el.textContent = 'Rs ' + total.toLocaleString() + ' (cache)';
                        return total;
                    });
            });
    }

    function loadPendingPayments() {
        var firestore = db();
        var tbody = document.getElementById('sa-pending-payments-tbody');
        if (!firestore || !tbody) return Promise.resolve();

        return firestore.collection('Platform_Payments')
            .where('status', 'in', ['pending', 'awaiting_approval'])
            .limit(30)
            .get()
            .catch(function () {
                return firestore.collection('Platform_Payments').limit(100000).get();
            })
            .then(function (snap) {
                var rows = [];
                snap.forEach(function (doc) {
                    var d = doc.data();
                    if (d.status !== 'pending' && d.status !== 'awaiting_approval') return;
                    rows.push({ id: doc.id, data: d });
                });
                if (!rows.length) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">کوئی زیر التوا ادائیگی نہیں</td></tr>';
                    return;
                }
                tbody.innerHTML = rows.map(function (row) {
                    var d = row.data;
                    return '<tr>' +
                        '<td>' + esc(d.tenantId || d.uid || '-') + '</td>' +
                        '<td>Rs ' + esc(Number(d.amount || 0).toLocaleString()) + '</td>' +
                        '<td>' + esc(d.plan || '-') + '</td>' +
                        '<td>' + esc(d.method || d.provider || '-') + '</td>' +
                        '<td>' + esc(d.reference || '-') + '</td>' +
                        '<td><button type="button" class="btn btn-success btn-sm" data-pay-id="' + esc(row.id) + '"><i class="fas fa-check"></i> منظور</button> ' +
                        '<button type="button" class="btn btn-danger btn-sm" data-reject-id="' + esc(row.id) + '"><i class="fas fa-times"></i></button></td>' +
                        '</tr>';
                }).join('');

                tbody.querySelectorAll('[data-pay-id]').forEach(function (btn) {
                    btn.onclick = function () {
                        global.saApprovePayment(btn.getAttribute('data-pay-id'));
                    };
                });
                tbody.querySelectorAll('[data-reject-id]').forEach(function (btn) {
                    btn.onclick = function () {
                        global.saRejectPayment(btn.getAttribute('data-reject-id'));
                    };
                });
            });
    }

    global.loadSaBilling = function () {
        if (!global.isSuperAdmin()) return;
        if (core() && !core().can('payments.view')) {
            toast('بلنگ دیکھنے کی اجازت نہیں۔', 'error');
            return;
        }

        var firestore = db();
        var loadTenants = (global.SA_TENANTS_CACHE || []).length >= 10
            ? Promise.resolve(global.SA_TENANTS_CACHE)
            : (firestore ? firestore.collection('All_Madrasas').orderBy('setupDate', 'desc').limit(100).get().then(function (snap) {
                var list = [];
                snap.forEach(function (doc) {
                    var m = doc.data();
                    if (core() && core().shouldSkipTenantInSaList && core().shouldSkipTenantInSaList(docSnap)) return;
                    list.push({ uid: doc.id, data: m });
                    mergeTenant(doc.id, m);
                });
                return list;
            }) : Promise.resolve([]));

        loadPlans().then(function () {
            return loadTenants;
        }).then(function (tenantList) {
            var tbody = document.getElementById('sa-billing-tbody');
            if (!tbody) return;

            var totalDue = 0;
            tbody.innerHTML = tenantList.map(function (t) {
                var m = t.data;
                var edit = mergeTenant(t.uid, m);
                var plan = edit.billingPlan || 'basic';
                var bSt = edit.billingStatus || 'pending';
                if (bSt === 'overdue') {
                    totalDue += core().getPlanPrice(plan, global.SA_BILLING_PLANS);
                }
                var uid = esc(t.uid);
                return '<tr data-uid="' + uid + '">' +
                    '<td>' + esc(m.madrasaName || '-') + '</td>' +
                    '<td><select class="input-control sa-bill-plan" data-uid="' + uid + '">' +
                    global.SA_BILLING_PLANS.map(function (p) {
                        return '<option value="' + esc(p.id) + '"' + (plan === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>';
                    }).join('') + '</select></td>' +
                    '<td><select class="input-control sa-bill-status" data-uid="' + uid + '">' +
                    '<option value="paid"' + (bSt === 'paid' ? ' selected' : '') + '>ادا شدہ</option>' +
                    '<option value="pending"' + (bSt === 'pending' ? ' selected' : '') + '>زیر التوا</option>' +
                    '<option value="overdue"' + (bSt === 'overdue' ? ' selected' : '') + '>بقایا</option>' +
                    '</select></td>' +
                    '<td><input type="date" class="input-control sa-bill-due" data-uid="' + uid + '" value="' + esc(edit.nextDueDate || '') + '"></td>' +
                    '<td><input type="text" class="input-control sa-bill-note" data-uid="' + uid + '" value="' + esc(edit.billingNote || '') + '" placeholder="نوٹ"></td>' +
                    '<td class="sa-bill-actions">' +
                    '<button type="button" class="btn btn-primary btn-sm" data-save-uid="' + uid + '"><i class="fas fa-save"></i></button> ' +
                    '<button type="button" class="btn btn-outline btn-sm" data-pay-uid="' + uid + '" title="دستی ادائیگی"><i class="fas fa-money-bill"></i></button> ' +
                    '<button type="button" class="btn btn-outline btn-sm" data-stripe-uid="' + uid + '" title="Stripe Checkout"><i class="fab fa-stripe"></i></button>' +
                    '</td></tr>';
            }).join('') || '<tr><td colspan="6" style="text-align:center;">کوئی مدرسہ نہیں</td></tr>';

            tbody.querySelectorAll('[data-save-uid]').forEach(function (btn) {
                btn.onclick = function () { global.saSaveBillingRow(btn.getAttribute('data-save-uid')); };
            });
            tbody.querySelectorAll('[data-pay-uid]').forEach(function (btn) {
                btn.onclick = function () { global.saShowRecordPaymentModal(btn.getAttribute('data-pay-uid')); };
            });
            tbody.querySelectorAll('[data-stripe-uid]').forEach(function (btn) {
                btn.onclick = function () { global.saInitiateStripeCheckout(btn.getAttribute('data-stripe-uid')); };
            });

            var dueEl = document.getElementById('sa-billing-total-due');
            if (dueEl) dueEl.textContent = 'Rs ' + totalDue.toLocaleString();

            return Promise.all([loadCollectedThisMonth(), loadPendingPayments()]);
        });
    };

    global.saAddPlan = function () {
        if (core() && !core().requirePermission('subscriptions.manage', 'پلان شامل')) return;
        var nameEl = document.getElementById('sa-new-plan-name');
        var priceEl = document.getElementById('sa-new-plan-price');
        var name = nameEl ? nameEl.value.trim() : '';
        var price = priceEl ? parseInt(priceEl.value, 10) : 0;
        if (!name) { toast('پلان کا نام درج کریں۔', 'error'); return; }

        var id = name.toLowerCase().replace(/\s+/g, '_');
        global.SA_BILLING_PLANS = global.SA_BILLING_PLANS || [];
        global.SA_BILLING_PLANS.push({ id: id, name: name, price: price || 0 });
        var firestore = db();
        if (!firestore) return;
        firestore.collection('System_Settings').doc('BillingPlans').set({ plans: global.SA_BILLING_PLANS }, { merge: true })
            .then(function () {
                toast('پلان شامل ہو گیا۔', 'success');
                if (nameEl) nameEl.value = '';
                if (priceEl) priceEl.value = '';
                global.loadSaBilling();
            });
    };

    global.saSaveBillingRow = function (uid) {
        if (core() && !core().requirePermission('subscriptions.manage', 'بلنگ محفوظ')) return;
        var edit = global.SA_PENDING_EDITS[uid];
        if (!edit) {
            var tenant = (global.SA_TENANTS_CACHE || []).find(function (t) { return t.uid === uid; });
            edit = mergeTenant(uid, tenant ? tenant.data : {});
        }
        var planEl = document.querySelector('.sa-bill-plan[data-uid="' + uid + '"]');
        var statusEl = document.querySelector('.sa-bill-status[data-uid="' + uid + '"]');
        var dueEl = document.querySelector('.sa-bill-due[data-uid="' + uid + '"]');
        var noteEl = document.querySelector('.sa-bill-note[data-uid="' + uid + '"]');
        edit.billingPlan = planEl ? planEl.value : edit.billingPlan;
        edit.billingStatus = statusEl ? statusEl.value : edit.billingStatus;
        edit.nextDueDate = dueEl ? dueEl.value : edit.nextDueDate;
        edit.billingNote = noteEl ? noteEl.value : edit.billingNote;

        var firestore = db();
        var tenant = (global.SA_TENANTS_CACHE || []).find(function (t) { return t.uid === uid; });
        firestore.collection('All_Madrasas').doc(uid).set({
            billingPlan: edit.billingPlan,
            billingStatus: edit.billingStatus,
            nextDueDate: edit.nextDueDate,
            billingNote: edit.billingNote
        }, { merge: true }).then(function () {
            return core().syncPlatformSubscription(uid, edit, tenant ? tenant.data : null);
        }).then(function () {
            return global.logSaAudit('update_billing', uid, tenant ? tenant.data.madrasaName : uid, 'بلنگ اپڈیٹ', edit);
        }).then(function () {
            toast('بلنگ محفوظ۔', 'success');
            if (core()) core().refreshDashboardFromCache();
            global.loadSaBilling();
        });
    };

    global.saShowRecordPaymentModal = function (tenantUid) {
        if (core() && !core().requirePermission('payments.manage', 'دستی ادائیگی')) return;
        var tenant = (global.SA_TENANTS_CACHE || []).find(function (t) { return t.uid === tenantUid; });
        var edit = global.SA_PENDING_EDITS[tenantUid] || {};
        var plan = edit.billingPlan || (tenant && tenant.data.billingPlan) || 'basic';
        var amount = core().getPlanPrice(plan, global.SA_BILLING_PLANS);

        var modal = document.getElementById('sa-payment-modal');
        if (!modal) return;
        document.getElementById('sa-pay-tenant-id').value = tenantUid;
        document.getElementById('sa-pay-tenant-name').textContent = tenant ? (tenant.data.madrasaName || tenantUid) : tenantUid;
        document.getElementById('sa-pay-amount').value = amount || '';
        document.getElementById('sa-pay-plan').value = plan;
        document.getElementById('sa-pay-reference').value = '';
        document.getElementById('sa-pay-note').value = '';
        modal.style.display = 'flex';
    };

    global.saSubmitManualPayment = function () {
        if (core() && !core().requirePermission('payments.manage', 'ادائیگی ریکارڈ')) return;
        var tenantId = document.getElementById('sa-pay-tenant-id').value;
        var amount = Number(document.getElementById('sa-pay-amount').value) || 0;
        var plan = document.getElementById('sa-pay-plan').value;
        var reference = document.getElementById('sa-pay-reference').value.trim();
        var note = document.getElementById('sa-pay-note').value.trim();
        if (!tenantId || amount <= 0) {
            toast('درست رقم اور مدرسہ درج کریں۔', 'error');
            return;
        }

        var payload = {
            provider: 'manual',
            tenantId: tenantId,
            uid: tenantId,
            amount: amount,
            currency: 'PKR',
            plan: plan,
            method: 'bank_transfer',
            reference: reference,
            note: note
        };

        var clientFallback = function () {
            var firestore = db();
            var id = 'manual_' + Date.now();
            var record = Object.assign({ status: 'awaiting_approval', createdAt: new Date().toISOString() }, payload);
            return firestore.collection('Platform_Config').doc('sa_payment_mirror').set({
                pending: firebase.firestore.FieldValue.arrayUnion(record)
            }, { merge: true }).then(function () {
                toast('ادائیگی ریکارڈ (offline mirror) — CF deploy پر مکمل sync ہوگی۔', 'warning');
                closeModal('sa-payment-modal');
            });
        };

        if (global.saApi && typeof global.saApi.callOrFallback === 'function') {
            global.saApi.callOrFallback('initiatePayment', payload, clientFallback).then(function (res) {
                toast('ادائیگی ریکارڈ — منظوری زیر التوا (' + (res.paymentId || '') + ')', 'success');
                closeModal('sa-payment-modal');
                global.loadSaBilling();
            }).catch(function (err) {
                toast('ادائیگی ناکام: ' + err.message, 'error');
            });
        } else {
            clientFallback();
        }
    };

    global.saApprovePayment = function (paymentId) {
        if (core() && !core().requirePermission('payments.manage', 'ادائیگی منظور')) return;
        global.saShowReasonModal('ادائیگی منظوری — وجہ', function (reason) {
            var clientFallback = function () {
                toast('Cloud Functions deploy نہیں — سرور-side منظوری دستیاب نہیں۔', 'error');
                return Promise.reject(new Error('CF_REQUIRED'));
            };
            if (global.saApi && typeof global.saApi.callOrFallback === 'function') {
                global.saApi.callOrFallback('approveManualPayment', { paymentId: paymentId, reason: reason }, clientFallback)
                    .then(function () {
                        toast('ادائیگی منظور ہو گئی۔', 'success');
                        global.loadSaBilling();
                        if (typeof global.saRefreshPlatformStats === 'function') global.saRefreshPlatformStats();
                        return global.logSaAudit('approve_payment', paymentId, paymentId, reason, {});
                    }).catch(function (err) {
                        if (err.message !== 'CF_REQUIRED') toast('منظوری ناکام: ' + err.message, 'error');
                    });
            }
        });
    };

    global.saRejectPayment = function (paymentId) {
        if (core() && !core().requirePermission('payments.manage', 'ادائیگی مسترد')) return;
        global.saShowReasonModal('ادائیگی مسترد — وجہ', function (reason) {
            var clientFallback = function () {
                toast('Cloud Functions ضروری — سرور-side مستردی دستیاب نہیں۔', 'error');
                return Promise.reject(new Error('CF_REQUIRED'));
            };
            if (global.saApi && typeof global.saApi.callOrFallback === 'function') {
                global.saApi.callOrFallback('rejectManualPayment', { paymentId: paymentId, reason: reason }, clientFallback)
                    .then(function () {
                        toast('ادائیگی مسترد ہو گئی۔', 'success');
                        global.loadSaBilling();
                        return global.logSaAudit('reject_payment', paymentId, paymentId, reason, {});
                    }).catch(function (err) {
                        if (err.message !== 'CF_REQUIRED') toast('مستردی ناکام: ' + err.message, 'error');
                    });
            }
        });
    };

    global.saInitiateStripeCheckout = function (tenantUid) {
        if (core() && !core().requirePermission('payments.manage', 'Stripe ادائیگی')) return;
        var tenant = (global.SA_TENANTS_CACHE || []).find(function (t) { return t.uid === tenantUid; });
        var edit = global.SA_PENDING_EDITS[tenantUid] || {};
        var plan = edit.billingPlan || (tenant && tenant.data.billingPlan) || 'pro';
        var amount = core().getPlanPrice(plan, global.SA_BILLING_PLANS);
        if (amount <= 0) { toast('اس پلان کی Stripe ادائیگی دستیاب نہیں', 'error'); return; }

        var payload = {
            provider: 'stripe',
            tenantId: tenantUid,
            uid: tenantUid,
            amount: amount,
            currency: 'usd',
            plan: plan,
            successUrl: window.location.href.split('#')[0] + '#superadmin',
            cancelUrl: window.location.href.split('#')[0] + '#superadmin'
        };

        var fallback = function () {
            toast('Stripe کے لیے Cloud Functions deploy ضروری (initiatePayment + Stripe keys)', 'error');
            return Promise.reject(new Error('CF_REQUIRED'));
        };

        if (global.saApi && typeof global.saApi.callOrFallback === 'function') {
            toast('Stripe Checkout تیار ہو رہا ہے...', 'warning');
            global.saApi.callOrFallback('initiatePayment', payload, fallback).then(function (res) {
                if (res && res.checkoutUrl) {
                    window.open(res.checkoutUrl, '_blank');
                    toast('Stripe Checkout کھل گیا — paymentId: ' + (res.paymentId || ''), 'success');
                } else {
                    toast('Checkout URL نہیں ملا — Stripe configure کریں', 'error');
                }
            }).catch(function (e) {
                if (e.message !== 'CF_REQUIRED') toast('Stripe ناکام: ' + e.message, 'error');
            });
        }
    };

})(window);
