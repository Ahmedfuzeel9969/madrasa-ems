/**
 * sa-charts.js — Super Admin analytics graphics (SVG, dashboard-pro style)
 */
(function (global) {
    'use strict';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function last6Months() {
        var arr = [], now = new Date();
        for (var i = 5; i >= 0; i--) {
            var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            arr.push({
                key: d.toISOString().substring(0, 7),
                label: d.toLocaleDateString('ur-PK', { month: 'short', year: '2-digit' })
            });
        }
        return arr;
    }

    function tenantGrowthSeries(cache) {
        cache = cache || [];
        var months = last6Months();
        var counts = {};
        months.forEach(function (m) { counts[m.key] = 0; });
        cache.forEach(function (t) {
            var d = (t.data && t.data.setupDate) ? String(t.data.setupDate).substring(0, 7) : '';
            if (counts[d] != null) counts[d]++;
        });
        return months.map(function (m) {
            return { label: m.label, value: counts[m.key] || 0, display: counts[m.key] || 0 };
        });
    }

    function planDistribution(cache) {
        cache = cache || [];
        var map = {};
        cache.forEach(function (t) {
            var edit = global.SA_PENDING_EDITS && global.SA_PENDING_EDITS[t.uid];
            var plan = (edit && edit.billingPlan) || (t.data && t.data.billingPlan) || 'basic';
            map[plan] = (map[plan] || 0) + 1;
        });
        var keys = Object.keys(map).sort();
        if (!keys.length) keys = ['basic'];
        return keys.map(function (k, i) {
            return {
                label: k,
                value: map[k],
                color: ['#8e44ad', '#2980b9', '#27ae60', '#e67e22', '#e74c3c'][i % 5]
            };
        });
    }

    function renderStatusDonut(metrics) {
        var el = document.getElementById('sa-chart-status');
        if (!el || typeof global.emsDonutSVG !== 'function') return;
        metrics = metrics || {};
        var active = metrics.active || 0;
        var suspended = metrics.suspended || 0;
        var other = Math.max(0, (metrics.total || 0) - active - suspended);
        el.innerHTML = global.emsDonutSVG([
            { label: 'فعال', value: active, color: '#27ae60' },
            { label: 'معطل', value: suspended, color: '#e74c3c' },
            { label: 'دیگر', value: other, color: '#94a3b8' }
        ], metrics.total || 0, 'کل');
    }

    function renderGrowthBars(cache) {
        var el = document.getElementById('sa-chart-growth');
        if (!el || typeof global.emsBarChartSVG !== 'function') return;
        el.innerHTML = global.emsBarChartSVG(tenantGrowthSeries(cache), {});
    }

    function renderPlanBars(cache) {
        var el = document.getElementById('sa-chart-plans');
        if (!el || typeof global.emsBarChartSVG !== 'function') return;
        el.innerHTML = global.emsBarChartSVG(planDistribution(cache), {});
    }

    function renderSparkCards(metrics) {
        var wrap = document.getElementById('sa-spark-row');
        if (!wrap) return;
        metrics = metrics || {};
        var items = [
            { icon: 'fa-mosque', color: '#2980b9', label: 'کل نیٹ ورک', val: metrics.total || 0 },
            { icon: 'fa-check-circle', color: '#27ae60', label: 'فعال', val: metrics.active || 0 },
            { icon: 'fa-ban', color: '#e74c3c', label: 'معطل', val: metrics.suspended || 0 },
            { icon: 'fa-hourglass-half', color: '#f39c12', label: 'ٹرائل ختم', val: metrics.trialExpiring || 0 },
            { icon: 'fa-credit-card', color: '#8e44ad', label: 'بقaya', val: metrics.overdue || 0 },
            { icon: 'fa-user-plus', color: '#0f766e', label: 'نئے (ماہ)', val: metrics.newMonth || 0 }
        ];
        wrap.innerHTML = items.map(function (it) {
            return '<div class="sa-spark-card">' +
                '<div class="sa-spark-icon" style="background:' + it.color + '22;color:' + it.color + '"><i class="fas ' + it.icon + '"></i></div>' +
                '<div class="sa-spark-body"><span class="sa-spark-val">' + esc(it.val) + '</span><span class="sa-spark-lbl">' + esc(it.label) + '</span></div>' +
                '</div>';
        }).join('');
    }

    function renderAll(cache, metrics) {
        if (global.SaCore && !metrics) {
            metrics = global.SaCore.computeTenantMetrics(cache || global.SA_TENANTS_CACHE || []);
        }
        renderSparkCards(metrics);
        renderStatusDonut(metrics);
        renderGrowthBars(cache || global.SA_TENANTS_CACHE || []);
        renderPlanBars(cache || global.SA_TENANTS_CACHE || []);
    }

    global.SaCharts = {
        render: renderAll,
        renderFromMetrics: function (m) { renderAll(global.SA_TENANTS_CACHE, m); }
    };
})(window);
