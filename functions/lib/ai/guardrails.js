'use strict';

var OFF_DOMAIN_PATTERNS = [
    /\b(politics|election|vote for|سیاست|انتخابات)\b/i,
    /\b(hack|exploit|malware|phishing|password crack)\b/i,
    /\b(medical diagnosis|prescription|دوائی|تشخیص)\b/i,
    /\b(lawyer|legal advice|وکیل|قانونی مشورہ)\b/i,
    /\b(write my essay|homework for me|کاپی)\b/i,
    /\b(stock market|crypto|bitcoin|forex)\b/i
];

var ALLOWED_DOMAIN_HINTS = [
    'طالب', 'student', 'class', 'کلاس', 'حاضری', 'attendance', 'فیس', 'fee',
    'امتحان', 'exam', 'result', 'نتیجہ', 'ڈسپلن', 'discipline', 'شکایت',
    'complaint', 'مدرسہ', 'ادارہ', 'institution', 'teacher', 'استاد',
    'performance', 'کارکردگی', 'KPI', 'رپورٹ', 'report', '360', 'تعلیم',
    'curriculum', 'نصاب', 'finance', 'مالی', 'بقایا', 'arrears', 'حاضری'
];

/**
 * Layer 2 guardrails — server-side domain filter + response safety checks.
 */
function assertOnDomainQuestion(question, intent) {
    var q = String(question || '').trim();
    if (!q) {
        return { ok: false, messageUr: 'سوال خالی ہے۔' };
    }
    for (var i = 0; i < OFF_DOMAIN_PATTERNS.length; i++) {
        if (OFF_DOMAIN_PATTERNS[i].test(q)) {
            return {
                ok: false,
                messageUr: 'یہ سوال Madrasa EMS کے دائرہ کار سے باہر ہے۔ صرف تعلیمی، انتظامی اور طلباء کے تجزیاتی سوالات پوچھیں۔'
            };
        }
    }
    // Intent-aware leniency: institution/class/student intents carry implicit domain
    if (intent && ['student_performance', 'class_compare', 'institution_kpi', 'institutional_deep_dive'].indexOf(intent) >= 0) {
        return { ok: true };
    }
    var lower = q.toLowerCase();
    var hasHint = ALLOWED_DOMAIN_HINTS.some(function (h) {
        return lower.indexOf(String(h).toLowerCase()) >= 0;
    });
    if (!hasHint && q.length > 40) {
        return {
            ok: false,
            messageUr: 'براہ کرم Madrasa EMS سے متعلق تعلیمی یا انتظامی سوال پوچھیں۔'
        };
    }
    return { ok: true };
}

function sanitizeModelOutput(text) {
    var out = String(text || '').trim();
    // Strip accidental API key / bearer patterns
    out = out.replace(/\bsk-[a-zA-Z0-9]{20,}\b/g, '[redacted]');
    out = out.replace(/\bAIza[0-9A-Za-z\-_]{20,}\b/g, '[redacted]');
    return out;
}

module.exports = {
    assertOnDomainQuestion: assertOnDomainQuestion,
    sanitizeModelOutput: sanitizeModelOutput
};
