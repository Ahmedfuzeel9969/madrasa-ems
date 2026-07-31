'use strict';

const functions = require('firebase-functions');
const { requireString } = require('../guard');
const { assertTenantStaffAccess } = require('./tenant-access');
const { validateContextPack, validateQuestion } = require('./context-schema');
const { assertOnDomainQuestion, sanitizeModelOutput } = require('./guardrails');
const { buildSystemPrompt, buildUserPrompt } = require('./prompts');
const { resolveProvider, DEFAULT_PROVIDER } = require('./router');
const { writeAiAudit } = require('./audit');

/**
 * AI Gateway — authoritative server-side callable.
 * API keys never touch the client; only Structured Context Packs are accepted.
 */
exports.aiAsk = functions.https.onCall(async (data, context) => {
    data = data || {};
    var tenantId = requireString(data.tenantId, 'tenantId');
    var question = requireString(data.question, 'question');
    var intent = requireString(data.intent, 'intent');
    var contextPack = data.contextPack;

    var actor = await assertTenantStaffAccess(context, tenantId);

    var qCheck = validateQuestion(question);
    if (!qCheck.ok) {
        throw new functions.https.HttpsError('invalid-argument', 'سوال درست نہیں: ' + qCheck.reason);
    }

    var scpCheck = validateContextPack(contextPack);
    if (!scpCheck.ok) {
        throw new functions.https.HttpsError('invalid-argument', 'Context Pack invalid: ' + scpCheck.reason);
    }

    if (contextPack.tenantId && contextPack.tenantId !== tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId mismatch in SCP');
    }

    var domainCheck = assertOnDomainQuestion(question, intent);
    if (!domainCheck.ok) {
        throw new functions.https.HttpsError('failed-precondition', domainCheck.messageUr);
    }

    var providerId = data.provider || DEFAULT_PROVIDER;
    var ip = (context.rawRequest && context.rawRequest.ip) || '';

    try {
        var provider = await resolveProvider(tenantId, providerId);
        var systemPrompt = buildSystemPrompt(intent);
        var userPrompt = buildUserPrompt(question, contextPack);

        var result = await provider.complete({
            systemPrompt: systemPrompt,
            userPrompt: userPrompt,
            maxOutputTokens: 2048,
            temperature: 0.35
        });

        var answer = sanitizeModelOutput(result.text);

        await writeAiAudit(tenantId, {
            action: 'ai.ask',
            intent: intent,
            actorUid: actor.uid,
            actorEmail: (context.auth.token && context.auth.token.email) || '',
            provider: provider.id,
            model: result.model,
            questionPreview: question,
            scpBytes: scpCheck.bytes,
            responseChars: answer.length,
            ok: true,
            ip: ip
        });

        return {
            ok: true,
            answer: answer,
            provider: provider.id,
            model: result.model,
            intent: intent,
            language: 'ur'
        };
    } catch (err) {
        await writeAiAudit(tenantId, {
            action: 'ai.ask',
            intent: intent,
            actorUid: actor.uid,
            actorEmail: (context.auth.token && context.auth.token.email) || '',
            provider: providerId,
            questionPreview: question,
            scpBytes: scpCheck.bytes,
            ok: false,
            errorCode: err.code || err.message,
            ip: ip
        });

        if (err.code === 'ai_disabled') {
            throw new functions.https.HttpsError('failed-precondition', 'AI Assistant اس ادارے کے لیے بند ہے۔');
        }
        if (err.code === 'ai_key_missing') {
            throw new functions.https.HttpsError('failed-precondition', 'AI server key configure نہیں — admin سے رابطہ کریں۔');
        }

        functions.logger.error('[AI] aiAsk failed', { tenantId: tenantId, err: err.message });
        throw new functions.https.HttpsError('internal', 'AI جواب تیار نہیں ہو سکا۔ بعد میں کوشش کریں۔');
    }
});

/**
 * Lightweight status probe — no secrets exposed.
 */
exports.getAiAssistantStatus = functions.https.onCall(async (data, context) => {
    data = data || {};
    var tenantId = requireString(data.tenantId, 'tenantId');
    await assertTenantStaffAccess(context, tenantId);

    var enabled = true;
    var defaultProvider = DEFAULT_PROVIDER;
    var modelHint = 'gemini-2.5-flash';

    try {
        var admin = require('firebase-admin');
        var snap = await admin.firestore()
            .collection('All_Madrasas').doc(tenantId)
            .collection('SystemSettings_Config').doc('ai_config').get();
        if (snap.exists) {
            var cfg = snap.data() || {};
            if (cfg.enabled === false) enabled = false;
            if (cfg.defaultProvider) defaultProvider = cfg.defaultProvider;
            if (cfg.providers && cfg.providers.gemini && cfg.providers.gemini.model) {
                modelHint = cfg.providers.gemini.model;
            }
        }
    } catch (e) { /* ignore */ }

    return {
        ok: true,
        enabled: enabled,
        defaultProvider: defaultProvider,
        modelHint: modelHint,
        phase: 1,
        allowedIntents: ['student_performance', 'class_compare', 'institution_kpi']
    };
});
