// ============================================================================
// EMS AI Analytics Studio — Deep Dive UI shell (Urdu RTL)
// Phase 2 foundation
// ============================================================================
(function (global) {
    'use strict';

    var state = {
        mounted: false,
        loading: false,
        departmentId: '',
        className: '__all__',
        dateRange: '3m',
        domains: {
            attendance: true,
            fees: true,
            exams: true,
            discipline: true
        }
    };

    function injectStyles() {
        if (document.getElementById('ems-ai-studio-styles')) return;
        var css = [
            '#module-ai-studio { direction: rtl; }',
            '.ems-ai-studio-wrap { padding: 16px 20px 28px; max-width: 960px; margin: 0 auto; }',
            '.ems-ai-studio-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;',
            'padding: 18px 20px; margin-bottom: 16px; box-shadow: 0 4px 14px rgba(15,23,42,.04); }',
            '.ems-ai-studio-card h3 { margin: 0 0 14px; font-size: 16px; color: #0f172a; }',
            '.ems-ai-studio-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }',
            '.ems-ai-studio-label { display: block; font-size: 12px; color: #64748b; margin-bottom: 6px; }',
            '.ems-ai-studio-domains { display: flex; flex-wrap: wrap; gap: 10px 16px; margin-top: 4px; }',
            '.ems-ai-studio-domains label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }',
            '.ems-ai-studio-prompt { width: 100%; min-height: 110px; resize: vertical; }',
            '.ems-ai-studio-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 14px; }',
            '.ems-ai-studio-result { white-space: pre-wrap; line-height: 1.75; color: #1e293b; font-size: 14px; }',
            '.ems-ai-studio-meta { font-size: 11px; color: #64748b; margin-top: 10px; }',
            '.ems-ai-studio-kpi-preview { font-size: 12px; color: #475569; background: #f8fafc;',
            'border: 1px dashed #cbd5e1; border-radius: 8px; padding: 10px 12px; margin-top: 10px; }',
            '.ems-ai-studio-badge { display: inline-block; font-size: 11px; background: #eef2ff; color: #4338ca;',
            'padding: 2px 8px; border-radius: 999px; margin-right: 6px; }',
            '.ems-ai-studio-offline { padding: 10px 12px; background: #fef2f2; border: 1px solid #fecaca;',
            'border-radius: 8px; color: #b91c1c; font-size: 12px; margin-bottom: 12px; }'
        ].join('');
        var el = document.createElement('style');
        el.id = 'ems-ai-studio-styles';
        el.textContent = css;
        document.head.appendChild(el);
    }

    function rootEl() {
        return document.getElementById('ems-ai-studio-root');
    }

    function departmentOptions() {
        var list = typeof global.emsListDepartments === 'function' ? global.emsListDepartments() : [];
        return list.map(function (d) {
            return '<option value="' + d.id + '">' + (d.labelUr || d.label) + '</option>';
        }).join('');
    }

    function classOptions(deptId) {
        var classes = typeof global.emsAiListStudioClasses === 'function'
            ? global.emsAiListStudioClasses(deptId)
            : [];
        var html = '<option value="__all__">تمام کلاسیں</option>';
        classes.forEach(function (cls) {
            html += '<option value="' + cls.replace(/"/g, '&quot;') + '">' + cls + '</option>';
        });
        return html;
    }

    function syncClassSelect() {
        var deptSel = document.getElementById('ems-ai-studio-dept');
        var classSel = document.getElementById('ems-ai-studio-class');
        if (!deptSel || !classSel) return;
        var prev = classSel.value || '__all__';
        classSel.innerHTML = classOptions(deptSel.value);
        var opts = Array.prototype.slice.call(classSel.options).map(function (o) { return o.value; });
        classSel.value = opts.indexOf(prev) >= 0 ? prev : '__all__';
        state.className = classSel.value;
    }

    function readFormState() {
        var deptSel = document.getElementById('ems-ai-studio-dept');
        var classSel = document.getElementById('ems-ai-studio-class');
        var rangeSel = document.getElementById('ems-ai-studio-range');
        state.departmentId = deptSel ? deptSel.value : '';
        state.className = classSel ? classSel.value : '__all__';
        state.dateRange = rangeSel ? rangeSel.value : '3m';
        state.domains = {
            attendance: !!document.getElementById('ems-ai-dom-att') && document.getElementById('ems-ai-dom-att').checked,
            fees: !!document.getElementById('ems-ai-dom-fee') && document.getElementById('ems-ai-dom-fee').checked,
            exams: !!document.getElementById('ems-ai-dom-exam') && document.getElementById('ems-ai-dom-exam').checked,
            discipline: !!document.getElementById('ems-ai-dom-disc') && document.getElementById('ems-ai-dom-disc').checked
        };
    }

    function updateOnlineBanner() {
        var banner = document.getElementById('ems-ai-studio-offline');
        var btn = document.getElementById('ems-ai-studio-submit');
        if (!banner) return;
        var ready = typeof global.emsAiIsOnlineReady === 'function' && global.emsAiIsOnlineReady();
        if (ready) {
            banner.style.display = 'none';
            if (btn && !state.loading) btn.disabled = false;
        } else {
            banner.style.display = 'block';
            if (btn && !state.loading) btn.disabled = true;
        }
    }

    function renderKpiPreview() {
        var box = document.getElementById('ems-ai-studio-kpi-preview');
        if (!box || typeof global.emsAiBuildMacroContextPack !== 'function') return;
        readFormState();
        if (!state.domains.attendance && !state.domains.fees && !state.domains.exams && !state.domains.discipline) {
            box.textContent = 'کم از کم ایک ڈیٹا ڈومین منتخب کریں۔';
            return;
        }
        global.emsAiBuildMacroContextPack({
            departmentId: state.departmentId,
            className: state.className,
            dateRange: state.dateRange,
            domains: state.domains
        }).then(function (pack) {
            var s = pack.summary || {};
            var parts = [];
            parts.push('طلباء: ' + ((s.headcounts && s.headcounts.studentsInScope) || 0));
            if (s.attendance) parts.push('حاضری: ' + s.attendance.ratePct + '%');
            if (s.finance) parts.push('بقایا: Rs ' + (s.finance.totalArrears || 0).toLocaleString());
            if (s.exams) parts.push('اوسط امتحان: ' + (s.exams.avgPercentage || 0) + '%');
            if (s.discipline) parts.push('شکایات: ' + (s.discipline.totalComplaints || 0));
            box.innerHTML = '<span class="ems-ai-studio-badge">Macro-SCP Preview</span>' + parts.join(' · ');
        }).catch(function () {
            box.textContent = 'Preview دستیاب نہیں — شعبہ منتخب کریں۔';
        });
    }

    function renderShell() {
        var root = rootEl();
        if (!root || state.mounted) return;
        injectStyles();

        var defaultDept = typeof global.emsGetDepartmentId === 'function'
            ? global.emsGetDepartmentId()
            : 'boys_dars';
        state.departmentId = defaultDept;

        root.innerHTML =
            '<div class="ems-ai-studio-wrap">' +
            '<div class="reg-topbar" style="margin-bottom:16px;border-radius:12px;">' +
            '<div class="reg-topbar-title"><i class="fas fa-brain"></i> AI تجزیات — Deep Dive</div>' +
            '<div style="font-size:12px;color:#64748b;margin-top:4px;">شعبہ / کلاس کی سطح پر جامع KPIs — raw طلباء ڈیٹا AI کو نہیں بھیجا جاتا</div>' +
            '</div>' +
            '<div id="ems-ai-studio-offline" class="ems-ai-studio-offline" style="display:none;">⚠ آن لائن موڈ اور Cloud Functions درکار ہیں</div>' +
            '<div class="ems-ai-studio-card">' +
            '<h3><i class="fas fa-sliders-h"></i> تجزیے کی ترتیب</h3>' +
            '<div class="ems-ai-studio-grid">' +
            '<div><label class="ems-ai-studio-label">شعبہ (Department)</label>' +
            '<select id="ems-ai-studio-dept" class="input-control">' + departmentOptions() + '</select></div>' +
            '<div><label class="ems-ai-studio-label">کلاس</label>' +
            '<select id="ems-ai-studio-class" class="input-control">' + classOptions(defaultDept) + '</select></div>' +
            '<div><label class="ems-ai-studio-label">تاریخ کی حد</label>' +
            '<select id="ems-ai-studio-range" class="input-control">' +
            '<option value="1m">آخری 1 ماہ</option>' +
            '<option value="3m" selected>آخری 3 ماہ</option>' +
            '<option value="all">تمام وقت</option>' +
            '</select></div>' +
            '</div>' +
            '<div style="margin-top:14px;"><span class="ems-ai-studio-label">ڈیٹا ڈومین</span>' +
            '<div class="ems-ai-studio-domains">' +
            '<label><input type="checkbox" id="ems-ai-dom-att" checked> حاضری</label>' +
            '<label><input type="checkbox" id="ems-ai-dom-fee" checked> فیس</label>' +
            '<label><input type="checkbox" id="ems-ai-dom-exam" checked> امتحانات</label>' +
            '<label><input type="checkbox" id="ems-ai-dom-disc" checked> ڈسپلن / شکایات</label>' +
            '</div></div>' +
            '<div id="ems-ai-studio-kpi-preview" class="ems-ai-studio-kpi-preview">Macro-SCP preview لوڈ ہو رہا ہے…</div>' +
            '</div>' +
            '<div class="ems-ai-studio-card">' +
            '<h3><i class="fas fa-comment-dots"></i> اپنا سوال / ہدایت</h3>' +
            '<label class="ems-ai-studio-label">تجزیاتی سوال (اردو)</label>' +
            '<textarea id="ems-ai-studio-question" class="input-control ems-ai-studio-prompt" ' +
            'placeholder="مثال: اس شعبے کی حاضری، فیس بقایا اور امتحانی کارکردگی کا جامع تجزیہ کریں اور 5 عملی اقدامات تجویز کریں۔"></textarea>' +
            '<div class="ems-ai-studio-actions">' +
            '<button type="button" class="btn btn-primary" id="ems-ai-studio-submit">' +
            '<i class="fas fa-wand-magic-sparkles"></i> جامع تجزیہ حاصل کریں</button>' +
            '<button type="button" class="btn btn-outline" id="ems-ai-studio-preview-btn">' +
            '<i class="fas fa-eye"></i> KPI Preview</button>' +
            '</div></div>' +
            '<div class="ems-ai-studio-card" id="ems-ai-studio-result-card" style="display:none;">' +
            '<h3><i class="fas fa-lightbulb"></i> AI تجزیہ</h3>' +
            '<div id="ems-ai-studio-result" class="ems-ai-studio-result"></div>' +
            '<div id="ems-ai-studio-result-meta" class="ems-ai-studio-meta"></div>' +
            '</div></div>';

        var deptSel = document.getElementById('ems-ai-studio-dept');
        if (deptSel) {
            deptSel.value = defaultDept;
            deptSel.addEventListener('change', function () {
                syncClassSelect();
                renderKpiPreview();
            });
        }
        ['ems-ai-studio-class', 'ems-ai-studio-range'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('change', renderKpiPreview);
        });
        ['ems-ai-dom-att', 'ems-ai-dom-fee', 'ems-ai-dom-exam', 'ems-ai-dom-disc'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('change', renderKpiPreview);
        });

        document.getElementById('ems-ai-studio-submit').onclick = submitInsight;
        document.getElementById('ems-ai-studio-preview-btn').onclick = renderKpiPreview;

        state.mounted = true;
        updateOnlineBanner();
        renderKpiPreview();
    }

    function setLoading(on) {
        state.loading = !!on;
        var btn = document.getElementById('ems-ai-studio-submit');
        if (btn) {
            btn.disabled = on || !(typeof global.emsAiIsOnlineReady === 'function' && global.emsAiIsOnlineReady());
            btn.innerHTML = on
                ? '<i class="fas fa-spinner fa-spin"></i> تجزیہ جاری…'
                : '<i class="fas fa-wand-magic-sparkles"></i> جامع تجزیہ حاصل کریں';
        }
    }

    function submitInsight() {
        readFormState();
        var questionEl = document.getElementById('ems-ai-studio-question');
        var question = questionEl ? String(questionEl.value || '').trim() : '';

        if (!state.domains.attendance && !state.domains.fees && !state.domains.exams && !state.domains.discipline) {
            if (typeof global.showToast === 'function') {
                global.showToast('کم از کم ایک ڈیٹا ڈومین منتخب کریں', 'error');
            }
            return;
        }
        if (!question && typeof global.emsAiDefaultQuestion === 'function') {
            question = global.emsAiDefaultQuestion('institutional_deep_dive', state);
        }
        if (!question) {
            if (typeof global.showToast === 'function') {
                global.showToast('براہ کرم سوال لکھیں', 'error');
            }
            return;
        }

        var run = function () {
            setLoading(true);
            var resultCard = document.getElementById('ems-ai-studio-result-card');
            var resultBox = document.getElementById('ems-ai-studio-result');
            var metaBox = document.getElementById('ems-ai-studio-result-meta');
            if (resultCard) resultCard.style.display = 'block';
            if (resultBox) resultBox.textContent = 'تجزیہ تیار ہو رہا ہے…';
            if (metaBox) metaBox.textContent = '';

            global.emsAiRunQuery({
                intent: 'institutional_deep_dive',
                question: question,
                departmentId: state.departmentId,
                className: state.className,
                dateRange: state.dateRange,
                domains: state.domains
            }).then(function (res) {
                if (resultBox) resultBox.textContent = (res && res.answer) ? res.answer : '(کوئی جواب نہیں)';
                if (metaBox && res) {
                    metaBox.textContent = [
                        res.provider || 'gemini',
                        res.model || '',
                        res.latencyMs ? (res.latencyMs + 'ms') : ''
                    ].filter(Boolean).join(' · ');
                }
            }).catch(function (err) {
                var msg = (err && err.message) ? err.message : String(err);
                if (resultBox) resultBox.textContent = 'خرابی: ' + msg;
                if (typeof global.showToast === 'function') {
                    global.showToast('AI تجزیہ ناکام: ' + msg, 'error');
                }
            }).then(function () {
                setLoading(false);
            });
        };

        if (typeof global.emsEnsureAiClient === 'function') {
            global.emsEnsureAiClient().then(run).catch(function (err) {
                if (typeof global.showToast === 'function') {
                    global.showToast('AI کلائنٹ لوڈ نہیں: ' + (err && err.message), 'error');
                }
            });
        } else {
            run();
        }
    }

    global.emsAiStudioInit = function () {
        if (typeof global.emsAiCanUse === 'function' && !global.emsAiCanUse()) {
            var root = rootEl();
            if (root) {
                root.innerHTML = '<div class="ems-ai-studio-wrap"><div class="ems-ai-studio-offline">' +
                    'AI تجزیات صرف منتظم / عملے کے لیے دستیاب ہے۔</div></div>';
            }
            return;
        }
        renderShell();
        updateOnlineBanner();
    };

    global.emsAiStudioRefresh = function () {
        if (!state.mounted) {
            global.emsAiStudioInit();
            return;
        }
        syncClassSelect();
        updateOnlineBanner();
        renderKpiPreview();
    };

    global.addEventListener('ems:ai-client-ready', updateOnlineBanner);
})(typeof window !== 'undefined' ? window : globalThis);
