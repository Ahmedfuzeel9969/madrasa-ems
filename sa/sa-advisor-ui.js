/**
 * sa-advisor-ui.js — Super Admin Platform Advisor (Phase 2 staging)
 * Read-only software advice — no code changes, no deploy actions.
 */
(function (global) {
    'use strict';

    var _status = null;
    var _busy = false;

    function esc(val) {
        if (global.EmsUtils && global.EmsUtils.sanitize) return global.EmsUtils.sanitize(val);
        return String(val == null ? '' : val)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function toast(msg, level) {
        if (typeof global.saToast === 'function') global.saToast(msg, level || 'info');
    }

    function setBusy(on) {
        _busy = !!on;
        var btn = document.getElementById('sa-advisor-ask-btn');
        var ta = document.getElementById('sa-advisor-question');
        if (btn) btn.disabled = on;
        if (ta) ta.disabled = on;
        var ind = document.getElementById('sa-advisor-loading');
        if (ind) ind.style.display = on ? 'inline' : 'none';
    }

    function renderStatusBar(data) {
        var el = document.getElementById('sa-advisor-status-bar');
        if (!el || !data) return;
        var adv = data.advisor || {};
        var lim = data.limits || {};
        var cmi = data.cmi || {};
        var modeLabel = adv.mode === 'staging' ? 'Staging' : (adv.mode === 'production' ? 'Production' : 'Disabled');
        var modeClass = adv.allowed ? (adv.mode === 'staging' ? 'sa-advisor-staging' : 'sa-advisor-live') : 'sa-advisor-off';

        el.innerHTML =
            '<span class="sa-advisor-pill ' + modeClass + '"><i class="fas fa-robot"></i> ' + esc(modeLabel) + '</span>' +
            '<span class="sa-advisor-stat">روزانہ: ' + esc(lim.adminUsed) + '/' + esc((lim.adminUsed || 0) + (lim.adminRemaining || 0)) + '</span>' +
            '<span class="sa-advisor-stat">بجٹ: $' + esc((lim.costUsdEst || 0).toFixed(2)) + ' / $' + esc(lim.monthlyCostCapUsd || 50) + '</span>' +
            (cmi.synced
                ? '<span class="sa-advisor-stat">CMI v' + esc(cmi.cmiVersion || '?') + ' @ ' + esc((cmi.gitSha || '').slice(0, 7)) + '</span>'
                : '<span class="sa-advisor-stat sa-advisor-warn"><i class="fas fa-exclamation-triangle"></i> CMI sync pending</span>');
    }

    function renderCitations(citations) {
        var box = document.getElementById('sa-advisor-citations');
        if (!box) return;
        if (!citations || !citations.length) {
            box.innerHTML = '<p style="color:#64748b;font-size:13px;">کوئی verified citation نہیں۔</p>';
            return;
        }
        var html = '<ul class="sa-advisor-cite-list">';
        citations.forEach(function (c) {
            html += '<li><span class="sa-advisor-cite-type">' + esc(c.type) + '</span> ';
            html += '<strong>' + esc(c.label || c.id) + '</strong>';
            if (c.path) html += ' <code>' + esc(c.path) + '</code>';
            html += '</li>';
        });
        html += '</ul>';
        box.innerHTML = html;
    }

    function renderAnswer(text) {
        var el = document.getElementById('sa-advisor-answer');
        if (!el) return;
        var safe = esc(text || '').replace(/\n/g, '<br>');
        el.innerHTML = safe || '<em style="color:#94a3b8;">جواب یہاں ظاہر ہوگا...</em>';
    }

    function renderMeta(res) {
        var el = document.getElementById('sa-advisor-meta');
        if (!el || !res) return;
        var parts = [];
        if (res.cacheHit) parts.push('<span class="sa-advisor-meta-tag"><i class="fas fa-bolt"></i> Cache hit (free)</span>');
        if (res.pscBytes) parts.push('<span class="sa-advisor-meta-tag">PSC ' + esc(res.pscBytes) + ' B</span>');
        if (res.model) parts.push('<span class="sa-advisor-meta-tag">' + esc(res.provider || 'gemini') + ' / ' + esc(res.model) + '</span>');
        el.innerHTML = parts.join(' ');
    }

    global.loadSaAdvisorPanel = function () {
        if (!global.isSuperAdmin || !global.isSuperAdmin()) return;
        if (!global.saApi || typeof global.saApi.call !== 'function') {
            renderStatusBar(null);
            toast('Cloud Functions unavailable — advisor needs backend deploy.', 'error');
            return;
        }
        global.saApi.call('saAdvisorGetStatus', {}).then(function (data) {
            _status = data;
            renderStatusBar(data);
            if (data && data.advisor && !data.advisor.allowed) {
                toast('Platform Advisor disabled — stagingEnabled must be true.', 'warn');
            }
        }).catch(function (err) {
            toast((err && err.message) || 'Status load failed', 'error');
        });
    };

    global.saAdvisorAsk = function () {
        if (_busy) return;
        if (!global.isSuperAdmin || !global.isSuperAdmin()) return;
        var ta = document.getElementById('sa-advisor-question');
        var question = ta ? String(ta.value || '').trim() : '';
        if (!question) {
            toast('سوال لکھیں۔', 'warn');
            return;
        }
        var moduleSel = document.getElementById('sa-advisor-module');
        var langSel = document.getElementById('sa-advisor-language');
        var payload = {
            question: question,
            moduleId: moduleSel ? moduleSel.value : '',
            language: langSel ? langSel.value : 'ur'
        };

        setBusy(true);
        renderAnswer('');
        renderCitations([]);
        document.getElementById('sa-advisor-meta').innerHTML = '';

        global.saApi.call('saAdvisorAsk', payload).then(function (res) {
            renderAnswer(res.answer);
            renderCitations(res.citations);
            renderMeta(res);
            if (res.cacheHit) toast('Cache hit — rate limit not consumed.', 'info');
            return global.saApi.call('saAdvisorGetStatus', {});
        }).then(function (data) {
            if (data) {
                _status = data;
                renderStatusBar(data);
            }
        }).catch(function (err) {
            var msg = (err && err.message) || 'Advisor request failed';
            renderAnswer('❌ ' + msg);
            toast(msg, 'error');
        }).finally(function () {
            setBusy(false);
        });
    };

    global.initSaAdvisorUi = function () {
        var style = document.getElementById('sa-advisor-styles');
        if (!style) {
            style = document.createElement('style');
            style.id = 'sa-advisor-styles';
            style.textContent = [
                '.sa-advisor-wrap{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:16px}',
                '.sa-advisor-status{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px}',
                '.sa-advisor-pill{padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600}',
                '.sa-advisor-staging{background:#fef3c7;color:#92400e}',
                '.sa-advisor-live{background:#dcfce7;color:#166534}',
                '.sa-advisor-off{background:#fee2e2;color:#991b1b}',
                '.sa-advisor-stat{font-size:12px;color:#475569}',
                '.sa-advisor-warn{color:#b45309}',
                '.sa-advisor-answer{background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:14px;min-height:120px;line-height:1.6;font-size:14px}',
                '.sa-advisor-cite-list{margin:0;padding-left:18px;font-size:13px}',
                '.sa-advisor-cite-type{display:inline-block;background:#e0e7ff;color:#3730a3;font-size:11px;padding:1px 6px;border-radius:4px;margin-right:4px}',
                '.sa-advisor-meta-tag{display:inline-block;font-size:11px;background:#f1f5f9;padding:2px 8px;border-radius:4px;margin-right:6px;color:#475569}',
                '.sa-advisor-disclaimer{font-size:12px;color:#64748b;margin-top:10px}'
            ].join('');
            document.head.appendChild(style);
        }
    };
})(window);
