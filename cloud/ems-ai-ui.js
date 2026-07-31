// ============================================================================
// EMS AI — Floating FAB + panel UI (Urdu RTL)
// ============================================================================
(function (global) {
    'use strict';

    var state = {
        open: false,
        loading: false,
        intent: 'institution_kpi',
        studentId: '',
        classA: '',
        classB: ''
    };

    function injectStyles() {
        if (document.getElementById('ems-ai-styles')) return;
        var css = [
            '#ems-ai-fab-root { position: fixed; bottom: 24px; left: 24px; z-index: 99990; direction: rtl; }',
            '.ems-ai-fab { width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;',
            'background: linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; font-size:22px;',
            'box-shadow: 0 8px 24px rgba(99,102,241,.45); transition: transform .2s; }',
            '.ems-ai-fab:hover { transform: scale(1.06); }',
            '.ems-ai-panel { display:none; position:fixed; bottom:92px; left:24px; width:min(420px,calc(100vw - 32px));',
            'max-height:min(70vh,560px); background:#fff; border-radius:14px; border:1px solid #e2e8f0;',
            'box-shadow:0 16px 40px rgba(15,23,42,.18); flex-direction:column; overflow:hidden; z-index:99991; direction:rtl; }',
            '.ems-ai-panel.open { display:flex; }',
            '.ems-ai-head { padding:14px 16px; background:#f8fafc; border-bottom:1px solid #e2e8f0; font-weight:bold; }',
            '.ems-ai-body { padding:12px 16px; overflow-y:auto; flex:1; }',
            '.ems-ai-foot { padding:12px 16px; border-top:1px solid #e2e8f0; background:#fafafa; }',
            '.ems-ai-intent-btn { margin:4px 0; width:100%; text-align:right; }',
            '.ems-ai-answer { white-space:pre-wrap; line-height:1.7; font-size:14px; color:#1e293b; }',
            '.ems-ai-meta { font-size:11px; color:#64748b; margin-top:8px; }',
            '.ems-ai-hidden { display:none !important; }',
            '.ems-ai-offline-banner { margin-top:10px; padding:8px 10px; background:#fef2f2; border:1px solid #fecaca;',
            'border-radius:8px; color:#b91c1c; font-size:12px; text-align:center; }'
        ].join('');
        var el = document.createElement('style');
        el.id = 'ems-ai-styles';
        el.textContent = css;
        document.head.appendChild(el);
    }

    function rootEl() {
        return document.getElementById('ems-ai-fab-root');
    }

    function renderShell() {
        var root = rootEl();
        if (!root || root.dataset.mounted) return;
        injectStyles();
        root.innerHTML =
            '<button type="button" class="ems-ai-fab" id="ems-ai-fab-btn" title="AI مشیر (Beta)" aria-label="AI Assistant">' +
            '<i class="fas fa-robot"></i></button>' +
            '<div class="ems-ai-panel" id="ems-ai-panel" role="dialog" aria-label="AI Assistant Panel">' +
            '<div class="ems-ai-head"><i class="fas fa-robot"></i> Madrasa AI مشیر <span style="font-size:11px;color:#64748b;">(Beta)</span></div>' +
            '<div class="ems-ai-body">' +
            '<label style="font-size:12px;color:#64748b;">تجزیے کی قسم</label>' +
            '<div id="ems-ai-intent-btns"></div>' +
            '<div id="ems-ai-scope-fields" style="margin-top:10px;"></div>' +
            '<label style="font-size:12px;color:#64748b;display:block;margin-top:12px;">سوال (اردو)</label>' +
            '<textarea id="ems-ai-question" class="input-control" rows="3" placeholder="تعلیمی یا انتظامی سوال لکھیں..." style="width:100%;resize:vertical;"></textarea>' +
            '<div id="ems-ai-answer-box" class="ems-ai-hidden" style="margin-top:12px;padding:10px;background:#f1f5f9;border-radius:8px;">' +
            '<div class="ems-ai-answer" id="ems-ai-answer-text"></div>' +
            '<div class="ems-ai-meta" id="ems-ai-answer-meta"></div></div>' +
            '</div>' +
            '<div class="ems-ai-foot">' +
            '<div id="ems-ai-online-banner" class="ems-ai-offline-banner ems-ai-hidden">⚠ آن لائن موڈ اور Cloud Functions درکار ہیں</div>' +
            '<button type="button" class="btn btn-primary" id="ems-ai-submit" style="width:100%;"><i class="fas fa-paper-plane"></i> تجزیہ حاصل کریں</button>' +
            '</div></div>';
        root.dataset.mounted = '1';

        document.getElementById('ems-ai-fab-btn').onclick = togglePanel;
        document.getElementById('ems-ai-submit').onclick = submitQuery;
        renderIntentButtons();
        renderScopeFields();
        updateOnlineBanner();
    }

    function updateOnlineBanner() {
        var banner = document.getElementById('ems-ai-online-banner');
        var btn = document.getElementById('ems-ai-submit');
        if (!banner) return;
        var ready = typeof global.emsAiIsOnlineReady === 'function' && global.emsAiIsOnlineReady();
        if (ready) {
            banner.classList.add('ems-ai-hidden');
            if (btn && !state.loading) btn.disabled = false;
        } else {
            banner.classList.remove('ems-ai-hidden');
            if (btn && !state.loading) btn.disabled = true;
        }
    }

    global.emsAiUiRefreshOnlineState = updateOnlineBanner;

    function renderIntentButtons() {
        var box = document.getElementById('ems-ai-intent-btns');
        if (!box || !global.emsAiIntents) return;
        box.innerHTML = '';
        Object.keys(global.emsAiIntents).forEach(function (key) {
            var meta = global.emsAiIntents[key];
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-secondary ems-ai-intent-btn' + (state.intent === key ? ' active' : '');
            btn.innerHTML = '<i class="fas ' + meta.icon + '"></i> ' + meta.labelUr;
            btn.onclick = function () {
                state.intent = key;
                renderIntentButtons();
                renderScopeFields();
                if (global.emsAiDefaultQuestion) {
                    document.getElementById('ems-ai-question').value = global.emsAiDefaultQuestion(key, state);
                }
            };
            box.appendChild(btn);
        });
    }

    function renderScopeFields() {
        var box = document.getElementById('ems-ai-scope-fields');
        if (!box) return;
        box.innerHTML = '';
        if (state.intent === 'student_performance') {
            box.innerHTML = '<label style="font-size:12px;color:#64748b;">طالب علم ID</label>' +
                '<input type="text" id="ems-ai-student-id" class="input-control" value="' + (state.studentId || '') + '" placeholder="رجسٹریشن ID" style="width:100%;direction:ltr;text-align:left;" />';
        } else if (state.intent === 'class_compare') {
            box.innerHTML =
                '<label style="font-size:12px;color:#64748b;">کلاس A</label><input id="ems-ai-class-a" class="input-control" value="' + (state.classA || '') + '" style="width:100%;margin-bottom:6px;" />' +
                '<label style="font-size:12px;color:#64748b;">کلاس B</label><input id="ems-ai-class-b" class="input-control" value="' + (state.classB || '') + '" style="width:100%;" />';
        }
    }

    function togglePanel() {
        state.open = !state.open;
        var panel = document.getElementById('ems-ai-panel');
        if (panel) panel.classList.toggle('open', state.open);
        if (state.open) updateOnlineBanner();
    }

    function setLoading(on) {
        state.loading = on;
        var btn = document.getElementById('ems-ai-submit');
        if (btn) {
            btn.disabled = on;
            btn.innerHTML = on
                ? '<i class="fas fa-spinner fa-spin"></i> تجزیہ جاری ہے...'
                : '<i class="fas fa-paper-plane"></i> تجزیہ حاصل کریں';
        }
    }

    function showAnswer(data) {
        var box = document.getElementById('ems-ai-answer-box');
        var text = document.getElementById('ems-ai-answer-text');
        var meta = document.getElementById('ems-ai-answer-meta');
        if (!box || !text) return;
        box.classList.remove('ems-ai-hidden');
        text.textContent = data.answer || '';
        if (meta) {
            meta.textContent = (data.provider || 'gemini') + ' / ' + (data.model || '') + ' — اردو RTL';
        }
    }

    function submitQuery() {
        if (state.loading) return;
        var qEl = document.getElementById('ems-ai-question');
        var question = qEl ? qEl.value : '';
        var opts = { intent: state.intent, question: question };

        if (state.intent === 'student_performance') {
            var sidEl = document.getElementById('ems-ai-student-id');
            opts.studentId = (sidEl && sidEl.value) || state.studentId;
            if (!opts.studentId) {
                if (typeof global.showToast === 'function') global.showToast('طالب علم ID درج کریں', 'warning');
                return;
            }
        } else if (state.intent === 'class_compare') {
            opts.classA = (document.getElementById('ems-ai-class-a') || {}).value || state.classA;
            opts.classB = (document.getElementById('ems-ai-class-b') || {}).value || state.classB;
            if (!opts.classA || !opts.classB) {
                if (typeof global.showToast === 'function') global.showToast('دونوں کلاسیں درج کریں', 'warning');
                return;
            }
        }

        setLoading(true);
        var chain = typeof global.emsAiEnsureOnlineReady === 'function'
            ? global.emsAiEnsureOnlineReady()
            : Promise.resolve();
        chain.then(function () {
            updateOnlineBanner();
            return global.emsAiRunQuery(opts);
        }).then(function (res) {
            showAnswer(res || {});
            if (typeof global.showToast === 'function') global.showToast('AI تجزیہ تیار', 'success');
        }).catch(function (err) {
            var msg = (err && err.message) || 'unknown';
            if (msg === 'ai_access_denied') msg = 'AI Assistant: اجازت نہیں (صرف Admin/Staff)';
            if (msg === 'ai_offline') msg = 'آن لائن موڈ اور Cloud Functions درکار ہیں';
            if (msg === 'functions_unavailable') msg = 'Cloud Functions دستیاب نہیں';
            if (typeof global.showToast === 'function') global.showToast(msg, 'error');
            updateOnlineBanner();
        }).finally(function () {
            setLoading(false);
            updateOnlineBanner();
        });
    }

    global.emsAiUiOpen = function (opts) {
        opts = opts || {};
        renderShell();
        if (opts.intent) state.intent = opts.intent;
        if (opts.studentId) state.studentId = opts.studentId;
        if (opts.classA) state.classA = opts.classA;
        if (opts.classB) state.classB = opts.classB;
        renderIntentButtons();
        renderScopeFields();
        if (opts.prefillQuestion) {
            var q = document.getElementById('ems-ai-question');
            if (q) q.value = opts.prefillQuestion;
        } else if (global.emsAiDefaultQuestion) {
            var q2 = document.getElementById('ems-ai-question');
            if (q2 && !q2.value) q2.value = global.emsAiDefaultQuestion(state.intent, state);
        }
        state.open = true;
        var panel = document.getElementById('ems-ai-panel');
        if (panel) panel.classList.add('open');
        updateOnlineBanner();
    };

    global.emsAiUiInit = function () {
        var root = rootEl();
        if (!root) return;
        if (typeof global.emsAiCanUse === 'function' && !global.emsAiCanUse()) {
            root.classList.add('ems-ai-hidden');
            return;
        }
        root.classList.remove('ems-ai-hidden');
        root.setAttribute('aria-hidden', 'false');
        renderShell();
    };

    function boot() {
        var refresh = function () {
            if (typeof global.emsAiUiInit === 'function') global.emsAiUiInit();
            if (typeof global.emsAiUiRefreshOnlineState === 'function') {
                global.emsAiUiRefreshOnlineState();
            }
        };
        global.addEventListener('ems:ai-client-ready', refresh);
        global.addEventListener('ems:post-auth-ready', refresh);
        global.addEventListener('ems:post-auth-deferred-ready', refresh);
        global.addEventListener('ems:cloud-stack-ready', refresh);
        global.addEventListener('ems:online-mode-enabled', refresh);
        if (typeof global.addEventListener === 'function') {
            global.addEventListener('online', refresh);
        }
    }

    boot();
})(typeof window !== 'undefined' ? window : globalThis);
