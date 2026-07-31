// ============================================================================
// EMS AI — Intent router (Phase 1: 3 analytical intents)
// ============================================================================
(function (global) {
    'use strict';

    var INTENTS = {
        student_performance: {
            id: 'student_performance',
            labelUr: 'طالب علم کی کارکردگی',
            icon: 'fa-user-graduate',
            needsStudent: true
        },
        class_compare: {
            id: 'class_compare',
            labelUr: 'کلاس موازنہ',
            icon: 'fa-balance-scale',
            needsClasses: true
        },
        institution_kpi: {
            id: 'institution_kpi',
            labelUr: 'ادارے کے KPIs',
            icon: 'fa-chart-pie',
            needsStudent: false
        },
        institutional_deep_dive: {
            id: 'institutional_deep_dive',
            labelUr: 'جامع ادارہ جاتی تجزیہ',
            icon: 'fa-microscope',
            needsStudent: false,
            studioOnly: true
        }
    };

    global.emsAiIntents = INTENTS;

    global.emsAiResolveIntent = function (opts) {
        opts = opts || {};
        if (opts.intent && INTENTS[opts.intent]) return INTENTS[opts.intent];
        if (opts.studentId) return INTENTS.student_performance;
        if (opts.classA && opts.classB) return INTENTS.class_compare;
        return INTENTS.institution_kpi;
    };

    global.emsAiDefaultQuestion = function (intentId, scope) {
        scope = scope || {};
        if (intentId === 'student_performance') {
            return 'اس طالب علم کی حاضری، امتحانات، فیس اور ڈسپلن کا مختصر تجزیہ کریں اور بہتری کے 3 عملی مشورے دیں۔';
        }
        if (intentId === 'class_compare') {
            return 'کلاس ' + (scope.classA || 'A') + ' اور ' + (scope.classB || 'B') + ' کا حاضری اور امتحانی کارکردگی کا موازنہ کریں۔';
        }
        if (intentId === 'institutional_deep_dive') {
            var dept = scope.departmentId || '';
            var cls = scope.className && scope.className !== '__all__' ? scope.className : 'تمام کلاسیں';
            return 'شعبہ ' + dept + ' (' + cls + ') کے aggregate KPIs (حاضری، فیس، امتحانات، ڈسپلن) کا جامع تجزیہ کریں اور 5 priority actions تجویز کریں۔';
        }
        return 'ادارے کے موجودہ KPIs (طلباء، حاضری، مالیات) کا executive خلاصہ اور 3 priority actions بتائیں۔';
    };
})(typeof window !== 'undefined' ? window : globalThis);
