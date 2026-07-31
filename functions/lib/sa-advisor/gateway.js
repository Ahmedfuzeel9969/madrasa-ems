'use strict';

const functions = require('firebase-functions');
const { requireString } = require('../guard');
const { assertSuperAdminAccess } = require('./access');
const { DEFAULT_CONFIG, isAdvisorAllowed } = require('./config');
const { loadCmiBundle, loadAdvisorConfig } = require('./cmi-store');
const { retrieveSlices } = require('./retrieve');
const { buildPSC } = require('./psc-builder');
const { buildSystemPrompt, buildUserPrompt } = require('./prompts');
const { validateQuestion, sanitizeOutput } = require('./guardrails');
const { cacheKey, getCachedAnswer, setCachedAnswer, ttlHoursForDomains } = require('./cache');
const { checkRateLimits, recordUsage, getLimitsSummary } = require('./rate-limits');
const { writeSaAudit } = require('./audit');
const { usageFromResult } = require('./cost-tracker');
const { mergeAndValidateCitations, stripInvalidCitationTags } = require('./citations');
const { resolvePlatformGeminiKey, resolvePlatformModel } = require('./platform-key-vault');
const { GeminiProvider } = require('../ai/providers/gemini-provider');

function mergeConfig(raw) {
    return Object.assign({}, DEFAULT_CONFIG, raw || {});
}

async function resolveConfig() {
    var raw = await loadAdvisorConfig();
    return mergeConfig(raw);
}

function clientIp(context) {
    return (context.rawRequest && context.rawRequest.ip) || '';
}

exports.saAdvisorAsk = functions.https.onCall(async function (data, context) {
    data = data || {};
    var started = Date.now();
    var actor = await assertSuperAdminAccess(context);
    var cfg = await resolveConfig();
    var allowed = isAdvisorAllowed(cfg);

    if (!allowed.ok) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            'Platform Advisor فی الحال بند ہے (staging/production approval required).'
        );
    }

    var question = requireString(data.question, 'question');
    var moduleId = data.moduleId ? String(data.moduleId).trim() : '';
    var language = data.language === 'en' ? 'en' : 'ur';
    var ip = clientIp(context);

    var qCheck = validateQuestion(question);
    if (!qCheck.ok) {
        await writeSaAudit({
            action: 'sa.advisor.ask',
            actorUid: actor.uid,
            actorEmail: actor.email,
            questionPreview: question,
            moduleId: moduleId,
            language: language,
            ok: false,
            errorCode: 'invalid_question:' + qCheck.reason,
            advisorMode: allowed.mode,
            ip: ip,
            durationMs: Date.now() - started
        });
        throw new functions.https.HttpsError('invalid-argument', 'سوال درست نہیں: ' + qCheck.reason);
    }

    var bundle;
    try {
        bundle = await loadCmiBundle(false);
    } catch (err) {
        await writeSaAudit({
            action: 'sa.advisor.ask',
            actorUid: actor.uid,
            actorEmail: actor.email,
            questionPreview: question,
            moduleId: moduleId,
            language: language,
            ok: false,
            errorCode: err.code || 'cmi_missing',
            advisorMode: allowed.mode,
            ip: ip,
            durationMs: Date.now() - started
        });
        throw new functions.https.HttpsError(
            'failed-precondition',
            'CMI cloud index نہیں ملا — npm run cmi:build && npm run cmi:sync-firestore چلائیں۔'
        );
    }

    var meta = bundle.meta || {};
    var key = cacheKey(question, meta, { moduleId: moduleId, language: language });
    var cached = await getCachedAnswer(key);

    if (cached && cached.answer) {
        await writeSaAudit({
            action: 'sa.advisor.ask',
            actorUid: actor.uid,
            actorEmail: actor.email,
            questionPreview: question,
            moduleId: moduleId,
            language: language,
            cmiVersion: meta.cmiVersion,
            gitSha: meta.gitSha,
            pscBytes: cached.pscBytes || 0,
            retrievedFileIds: cached.retrievedFileIds || [],
            citationCount: (cached.citations || []).length,
            cacheHit: true,
            provider: cached.provider || 'gemini',
            model: cached.model || cfg.defaultModel,
            tokensEst: { input: 0, output: 0 },
            costEstUsd: 0,
            domains: cached.domains || [],
            ok: true,
            advisorMode: allowed.mode,
            ip: ip,
            durationMs: Date.now() - started
        });

        return {
            ok: true,
            answer: cached.answer,
            citations: cached.citations || [],
            cacheHit: true,
            advisorMode: allowed.mode,
            cmiVersion: meta.cmiVersion,
            gitSha: meta.gitSha,
            pscBytes: cached.pscBytes || 0,
            provider: cached.provider || 'gemini',
            model: cached.model || cfg.defaultModel
        };
    }

    await checkRateLimits(actor.uid, cfg, { cacheHit: false });

    var slices = retrieveSlices(bundle, question, { moduleId: moduleId });
    var psc = buildPSC(question, slices, cfg.maxPscBytes || DEFAULT_CONFIG.maxPscBytes);
    var retrievedFileIds = (psc.slices.files || []).map(function (f) { return f.fileId; });

    try {
        var keyInfo = await resolvePlatformGeminiKey();
        var model = cfg.defaultModel || (await resolvePlatformModel());
        var provider = new GeminiProvider({ apiKey: keyInfo.key, model: model });

        var result = await provider.complete({
            systemPrompt: buildSystemPrompt(language),
            userPrompt: buildUserPrompt(question, psc),
            maxOutputTokens: cfg.maxOutputTokens || 2048,
            temperature: 0.35
        });

        var rawAnswer = result.text || '';
        var cleaned = stripInvalidCitationTags(rawAnswer, psc);
        var answer = sanitizeOutput(cleaned);
        var citations = mergeAndValidateCitations(psc, answer);
        var usage = usageFromResult(psc, question, answer, result.usage);

        await recordUsage(usage.input + usage.output, usage.costUsd);

        var ttl = ttlHoursForDomains(slices.domains);
        await setCachedAnswer(key, {
            answer: answer,
            citations: citations,
            pscBytes: psc.bytes,
            retrievedFileIds: retrievedFileIds,
            domains: slices.domains,
            provider: provider.id,
            model: result.model,
            cmiVersion: meta.cmiVersion,
            gitSha: meta.gitSha
        }, ttl);

        await writeSaAudit({
            action: 'sa.advisor.ask',
            actorUid: actor.uid,
            actorEmail: actor.email,
            questionPreview: question,
            moduleId: moduleId,
            language: language,
            cmiVersion: meta.cmiVersion,
            gitSha: meta.gitSha,
            pscBytes: psc.bytes,
            retrievedFileIds: retrievedFileIds,
            citationCount: citations.length,
            cacheHit: false,
            provider: provider.id,
            model: result.model,
            tokensEst: { input: usage.input, output: usage.output },
            costEstUsd: usage.costUsd,
            domains: slices.domains,
            ok: true,
            advisorMode: allowed.mode,
            ip: ip,
            durationMs: Date.now() - started
        });

        return {
            ok: true,
            answer: answer,
            citations: citations,
            cacheHit: false,
            advisorMode: allowed.mode,
            cmiVersion: meta.cmiVersion,
            gitSha: meta.gitSha,
            pscBytes: psc.bytes,
            provider: provider.id,
            model: result.model,
            usage: usage
        };
    } catch (err) {
        await writeSaAudit({
            action: 'sa.advisor.ask',
            actorUid: actor.uid,
            actorEmail: actor.email,
            questionPreview: question,
            moduleId: moduleId,
            language: language,
            cmiVersion: meta.cmiVersion,
            gitSha: meta.gitSha,
            pscBytes: psc.bytes,
            retrievedFileIds: retrievedFileIds,
            cacheHit: false,
            ok: false,
            errorCode: err.code || err.message,
            advisorMode: allowed.mode,
            ip: ip,
            durationMs: Date.now() - started
        });

        if (err.code === 'advisor_key_missing') {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Platform Gemini key Secret Manager میں configure نہیں — platform-gemini-advisor-key'
            );
        }
        if (err.code === 'psc_too_large') {
            throw new functions.https.HttpsError('invalid-argument', 'Context pack 32KB سے بڑا — سوال مختصر کریں۔');
        }

        functions.logger.error('[SA Advisor] saAdvisorAsk failed', { err: err.message });
        throw new functions.https.HttpsError('internal', 'Platform Advisor جواب تیار نہیں ہو سکا۔');
    }
});

exports.saAdvisorGetStatus = functions.https.onCall(async function (data, context) {
    data = data || {};
    var actor = await assertSuperAdminAccess(context);
    var cfg = await resolveConfig();
    var allowed = isAdvisorAllowed(cfg);
    var limits = await getLimitsSummary(actor.uid, cfg);

    var cmi = { synced: false };
    try {
        var bundle = await loadCmiBundle(false);
        cmi = {
            synced: true,
            cmiVersion: bundle.meta && bundle.meta.cmiVersion,
            gitSha: bundle.meta && bundle.meta.gitSha,
            fileCount: bundle.meta && bundle.meta.fileCount,
            syncedAt: bundle.meta && bundle.meta.syncedAt
        };
    } catch (e) {
        cmi.error = e.code || 'cmi_missing';
    }

    return {
        ok: true,
        advisor: {
            enabled: cfg.enabled === true,
            stagingEnabled: cfg.stagingEnabled === true,
            productionEnabled: cfg.productionEnabled === true,
            allowed: allowed.ok,
            mode: allowed.mode,
            monthlyCostCapUsd: cfg.monthlyCostCapUsd,
            cacheHitsFree: cfg.cacheHitsFree !== false,
            maxPscBytes: cfg.maxPscBytes
        },
        limits: limits,
        cmi: cmi
    };
});
