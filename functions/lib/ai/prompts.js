'use strict';

/**
 * Urdu-only madrasa consultant system prompts (RTL responses).
 */
function buildSystemPrompt(intent) {
    var base = [
        'آپ Madrasa EMS (Educational Management System) کے لیے ماہر تعلیمی مشیر ہیں۔',
        'آپ صرف فراہم کردہ Structured Context Pack (SCP) کی بنیاد پر تجزیہ کریں — اختراعی یا غیر موجود ڈیٹا نہ گھڑیں۔',
        'جواب مکمل طور پر اردو میں لکھیں (RTL)۔ technical terms جیسے KPI، Attendance، Fee، Exam English میں رہ سکتے ہیں۔',
        'مختصر، عملی اور actionable نکات دیں۔ bullet points استعمال کریں جہاں مناسب ہو۔',
        'ذاتی، سیاسی، مذہبی بحث، طبی یا قانونی مشورہ نہ دیں۔',
        'اگر SCP میں ڈیٹا ناکافی ہو تو واضح طور پر بتائیں اور مزید کون سا ڈیٹا درکار ہے۔'
    ].join('\n');

    var intentHints = {
        student_performance: 'فرد کی حاضری، امتحانات، فیس اور ڈسپلن SCP سے مربوط کر کے strengths، weaknesses اور recommendations دیں۔',
        class_compare: 'دو کلاسوں کے aggregate metrics کا موازنہ کریں — fair اور data-driven رہیں۔',
        institution_kpi: 'ادارے کے سطح کے KPIs (طلباء، حاضری، مالیات، اعلانات) کا executive خلاصہ دیں۔',
        institutional_deep_dive: 'منتخب شعبہ/کلاس کے aggregate Macro-SCP KPIs کا گہرا تجزیہ کریں — حاضری، فیس بقایا، امتحانات، ڈسپلن — اور actionable institutional recommendations دیں۔'
    };

    return base + '\n\nIntent: ' + intent + '\n' + (intentHints[intent] || '');
}

function buildUserPrompt(question, contextPack) {
    return [
        '=== STRUCTURED CONTEXT PACK (JSON) ===',
        JSON.stringify(contextPack.summary, null, 0),
        '',
        '=== USER QUESTION (Urdu) ===',
        String(question || '').trim()
    ].join('\n');
}

module.exports = {
    buildSystemPrompt: buildSystemPrompt,
    buildUserPrompt: buildUserPrompt
};
