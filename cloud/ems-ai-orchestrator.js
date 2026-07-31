// ============================================================================
// EMS AI — Orchestrator: intent → SCP → gateway → render hook
// ============================================================================
(function (global) {
    'use strict';

    global.emsAiBuildContextPack = function (opts) {
        opts = opts || {};
        var intent = opts.intent || (global.emsAiResolveIntent && global.emsAiResolveIntent(opts).id);
        if (intent === 'student_performance') {
            if (!opts.studentId) return Promise.reject(new Error('studentId_required'));
            return global.emsAiBuildStudentContextPack(opts.studentId);
        }
        if (intent === 'class_compare') {
            var a = opts.classA || opts.classAName;
            var b = opts.classB || opts.classBName;
            if (!a || !b) return Promise.reject(new Error('classes_required'));
            return global.emsAiBuildClassCompareContextPack(a, b);
        }
        if (intent === 'institutional_deep_dive') {
            if (typeof global.emsAiBuildMacroContextPack !== 'function') {
                return Promise.reject(new Error('macro_builder_missing'));
            }
            return global.emsAiBuildMacroContextPack(opts);
        }
        return global.emsAiBuildInstitutionContextPack();
    };

    global.emsAiRunQuery = function (opts) {
        opts = opts || {};
        if (typeof global.emsAiCanUse === 'function' && !global.emsAiCanUse()) {
            return Promise.reject(new Error('ai_access_denied'));
        }

        var run = function () {
            var intentMeta = global.emsAiResolveIntent ? global.emsAiResolveIntent(opts) : { id: opts.intent };
            var intent = intentMeta.id || opts.intent;
            var question = String(opts.question || '').trim();
            if (!question && global.emsAiDefaultQuestion) {
                question = global.emsAiDefaultQuestion(intent, opts);
            }

            var guard = global.emsAiClientGuard ? global.emsAiClientGuard(question, intent) : { ok: true };
            if (!guard.ok) return Promise.reject(new Error(guard.message || 'guard_failed'));

            return global.emsAiBuildContextPack(Object.assign({}, opts, { intent: intent }))
                .then(function (pack) {
                    return global.emsAiAsk({
                        intent: intent,
                        question: question,
                        contextPack: pack,
                        provider: opts.provider
                    });
                });
        };

        if (typeof global.emsAiEnsureOnlineReady === 'function') {
            return global.emsAiEnsureOnlineReady().then(run);
        }
        if (typeof global.emsAiIsOnlineReady === 'function' && !global.emsAiIsOnlineReady()) {
            return Promise.reject(new Error('ai_offline'));
        }
        return run();
    };

    global.emsAiOpenPanel = function (opts) {
        opts = opts || {};
        var openUi = function () {
            if (typeof global.emsAiUiOpen === 'function') {
                global.emsAiUiOpen(opts);
            } else if (typeof global.showToast === 'function') {
                global.showToast('AI UI لوڈ نہیں — refresh کریں', 'error');
            }
        };
        if (typeof global.emsAiUiOpen === 'function') {
            openUi();
            return;
        }
        if (typeof global.emsEnsureAiClient === 'function') {
            global.emsEnsureAiClient().then(openUi).catch(function (err) {
                console.warn('[EMS AI] ensure client:', err);
                if (typeof global.showToast === 'function') {
                    global.showToast('AI ماڈیول لوڈ نہیں ہو سکا', 'error');
                }
            });
            return;
        }
        console.warn('[EMS AI] emsEnsureAiClient missing');
    };
})(typeof window !== 'undefined' ? window : globalThis);
