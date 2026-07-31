/**
 * ============================================================================
 * Payments — Provider-agnostic payment architecture
 * ----------------------------------------------------------------------------
 * A thin abstraction lets us add providers without touching core logic.
 * Built-in providers:
 *   - ManualProvider : bank transfer / cash, requires admin approval
 *   - StripeProvider : online checkout + webhook confirmation
 *
 * To add a provider later: implement the interface methods and register it
 * in the PROVIDERS map. Nothing else changes.
 * ============================================================================
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const guard = require('./guard');
const logger = require('./logger');
const stats = require('./stats');

const COL_PAYMENTS = 'Platform_Payments';
const COL_INVOICES = 'Platform_Invoices';

function db() { return admin.firestore(); }

function lazyStripe() {
    const cfg = (functions.config && functions.config().stripe) || {};
    const key = cfg.secret || process.env.STRIPE_SECRET;
    if (!key) return null;
    // eslint-disable-next-line global-require
    const Stripe = require('stripe');
    return Stripe(key);
}

/**
 * Common: create a payment record in 'pending' state.
 */
async function createPaymentRecord(record) {
    const ref = await db().collection(COL_PAYMENTS).add({
        provider: record.provider,
        uid: record.uid,
        tenantId: record.tenantId || '',
        amount: record.amount,
        currency: record.currency || 'PKR',
        plan: record.plan || '',
        status: 'pending',
        method: record.method || '',
        reference: record.reference || '',
        note: record.note || '',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return ref.id;
}

/**
 * Common: mark a payment as paid and generate an invoice.
 */
async function settlePayment(paymentId, extra) {
    const payRef = db().collection(COL_PAYMENTS).doc(paymentId);
    await payRef.set(Object.assign({
        status: 'paid',
        paidAt: admin.firestore.FieldValue.serverTimestamp()
    }, extra || {}), { merge: true });

    const pay = (await payRef.get()).data() || {};
    const invoiceRef = await db().collection(COL_INVOICES).add({
        paymentId: paymentId,
        uid: pay.uid || '',
        tenantId: pay.tenantId || '',
        amount: pay.amount || 0,
        currency: pay.currency || 'PKR',
        plan: pay.plan || '',
        provider: pay.provider || '',
        issuedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const tenantId = pay.tenantId || pay.uid || '';
    if (tenantId) {
        const patch = {
            billingStatus: 'paid',
            lastPaymentAt: admin.firestore.FieldValue.serverTimestamp()
        };
        if (pay.plan) patch.billingPlan = pay.plan;
        await db().collection('All_Madrasas').doc(tenantId).set(patch, { merge: true });
    }

    return invoiceRef.id;
}

/* ------------------------------- Providers ------------------------------- */

const ManualProvider = {
    id: 'manual',
    /** Record an offline payment awaiting admin approval. */
    async initiate(caller, data) {
        const paymentId = await createPaymentRecord({
            provider: 'manual',
            uid: data.uid || caller.uid,
            tenantId: data.tenantId,
            amount: Number(data.amount) || 0,
            currency: data.currency,
            plan: data.plan,
            method: data.method || 'bank_transfer',
            reference: data.reference || '',
            note: data.note || ''
        });
        return { paymentId, requiresApproval: true };
    }
};

const StripeProvider = {
    id: 'stripe',
    /** Create a Stripe Checkout session. */
    async initiate(caller, data) {
        const stripe = lazyStripe();
        if (!stripe) {
            throw new functions.https.HttpsError('failed-precondition', 'Stripe ابھی configure نہیں ہوا۔');
        }
        const paymentId = await createPaymentRecord({
            provider: 'stripe',
            uid: data.uid || caller.uid,
            tenantId: data.tenantId,
            amount: Number(data.amount) || 0,
            currency: data.currency || 'usd',
            plan: data.plan,
            method: 'card'
        });
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: (data.currency || 'usd').toLowerCase(),
                    product_data: { name: data.plan || 'Subscription' },
                    unit_amount: Math.round((Number(data.amount) || 0) * 100)
                },
                quantity: 1
            }],
            success_url: data.successUrl || 'https://example.com/success',
            cancel_url: data.cancelUrl || 'https://example.com/cancel',
            client_reference_id: paymentId,
            metadata: { paymentId, uid: data.uid || caller.uid }
        });
        await db().collection(COL_PAYMENTS).doc(paymentId).set({
            stripeSessionId: session.id
        }, { merge: true });
        return { paymentId, checkoutUrl: session.url };
    }
};

const PROVIDERS = {
    manual: ManualProvider,
    stripe: StripeProvider
};

/* ------------------------------- Callables ------------------------------- */

/**
 * Callable: initiate a payment via any registered provider.
 * data = { provider, amount, currency, plan, uid, tenantId, ... }
 */
const initiatePayment = functions.https.onCall(async (data, context) => {
    const caller = await guard.requirePermission(context, 'payments.manage');
    const providerId = guard.requireString(data && data.provider, 'provider');
    const provider = PROVIDERS[providerId];
    if (!provider) {
        throw new functions.https.HttpsError('invalid-argument', 'نامعلوم provider: ' + providerId);
    }
    const result = await provider.initiate(caller, data || {});
    await logger.audit({
        action: 'payments.initiate',
        actorUid: caller.uid,
        actorEmail: caller.email,
        targetUid: (data && data.uid) || caller.uid,
        details: { provider: providerId, amount: data && data.amount, plan: data && data.plan },
        ip: caller.ip
    });
    return Object.assign({ ok: true, provider: providerId }, result);
});

/**
 * Callable: approve a manual payment (requires payments.manage).
 * data = { paymentId, reason }
 */
const approveManualPayment = functions.https.onCall(async (data, context) => {
    const caller = await guard.requirePermission(context, 'payments.manage');
    const paymentId = guard.requireString(data && data.paymentId, 'paymentId');
    const invoiceId = await settlePayment(paymentId, { approvedBy: caller.email });
    try {
        const computed = await stats.computeStats();
        await stats.persistStats(computed);
    } catch (e) { /* stats refresh non-blocking */ }
    await logger.audit({
        action: 'payments.approve_manual',
        actorUid: caller.uid,
        actorEmail: caller.email,
        reason: (data && data.reason) || '',
        details: { paymentId, invoiceId },
        ip: caller.ip
    });
    return { ok: true, invoiceId };
});

/**
 * Callable: reject a pending manual payment.
 * data = { paymentId, reason }
 */
const rejectManualPayment = functions.https.onCall(async (data, context) => {
    const caller = await guard.requirePermission(context, 'payments.manage');
    const paymentId = guard.requireString(data && data.paymentId, 'paymentId');
    const payRef = db().collection(COL_PAYMENTS).doc(paymentId);
    const payDoc = await payRef.get();
    if (!payDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'ادائیگی نہیں ملی۔');
    }
    const pay = payDoc.data();
    if (pay.status === 'paid') {
        throw new functions.https.HttpsError('failed-precondition', 'ادا شدہ ادائیگی مسترد نہیں ہو سکتی۔');
    }
    await payRef.set({
        status: 'rejected',
        rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
        rejectedBy: caller.email,
        rejectReason: (data && data.reason) || ''
    }, { merge: true });
    await logger.audit({
        action: 'payments.reject_manual',
        actorUid: caller.uid,
        actorEmail: caller.email,
        reason: (data && data.reason) || '',
        details: { paymentId },
        ip: caller.ip
    });
    return { ok: true };
});

/**
 * Callable: refund a payment (requires payments.refund).
 * data = { paymentId, reason }
 */
const refundPayment = functions.https.onCall(async (data, context) => {
    const caller = await guard.requirePermission(context, 'payments.refund');
    const paymentId = guard.requireString(data && data.paymentId, 'paymentId');
    const payRef = db().collection(COL_PAYMENTS).doc(paymentId);
    const pay = (await payRef.get()).data();
    if (!pay) throw new functions.https.HttpsError('not-found', 'ادائیگی نہیں ملی۔');

    if (pay.provider === 'stripe' && pay.stripePaymentIntent) {
        const stripe = lazyStripe();
        if (stripe) await stripe.refunds.create({ payment_intent: pay.stripePaymentIntent });
    }
    await payRef.set({
        status: 'refunded',
        refundedAt: admin.firestore.FieldValue.serverTimestamp(),
        refundedBy: caller.email
    }, { merge: true });
    await logger.audit({
        action: 'payments.refund',
        actorUid: caller.uid,
        actorEmail: caller.email,
        reason: (data && data.reason) || '',
        details: { paymentId },
        ip: caller.ip
    });
    return { ok: true };
});

/**
 * HTTPS webhook: Stripe payment confirmation.
 * Verifies the signature, then settles the matching payment record.
 */
const stripeWebhook = functions.https.onRequest(async (req, res) => {
    const stripe = lazyStripe();
    const cfg = (functions.config && functions.config().stripe) || {};
    const webhookSecret = cfg.webhook || process.env.STRIPE_WEBHOOK;
    if (!stripe || !webhookSecret) {
        res.status(503).send('Stripe not configured');
        return;
    }
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], webhookSecret);
    } catch (err) {
        await logger.logError('stripeWebhook.verify', err, {});
        res.status(400).send('Invalid signature');
        return;
    }
    try {
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const paymentId = session.client_reference_id || (session.metadata && session.metadata.paymentId);
            if (paymentId) {
                await settlePayment(paymentId, { stripePaymentIntent: session.payment_intent });
            }
        }
        res.status(200).send('ok');
    } catch (err) {
        await logger.logError('stripeWebhook.handle', err, { type: event.type });
        res.status(500).send('handler error');
    }
});

module.exports = {
    initiatePayment,
    approveManualPayment,
    rejectManualPayment,
    refundPayment,
    stripeWebhook,
    PROVIDERS
};
