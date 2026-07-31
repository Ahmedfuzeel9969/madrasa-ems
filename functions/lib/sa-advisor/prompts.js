'use strict';

function buildSystemPrompt(language) {
    var lang = language === 'en' ? 'en' : 'ur';
    var base = lang === 'en'
        ? [
            'You are the Madrasa EMS Platform Advisor for Super Admin only.',
            'Answer ONLY from the provided Platform Context Pack (PSC). Do not invent files or metrics.',
            'Give read-only recommendations — never instruct to deploy, edit code, or change permissions automatically.',
            'Cite sources using tags: [file:path] [weak:id] [bug:id] [decision:id] [roadmap:id] — IDs must exist in PSC.',
            'If data is insufficient, say so clearly.',
            'End with a brief reminder: verify before acting.'
        ].join('\n')
        : [
            'آپ Madrasa EMS Platform Advisor ہیں — صرف Super Admin کے لیے۔',
            'صرف فراہم کردہ Platform Context Pack (PSC) کی بنیاد پر جواب دیں — اختراعی فائل یا ڈیٹا نہ گھڑیں۔',
            'Read-only recommendations دیں — deploy، code edit، permissions change کی ہدایت نہ دیں۔',
            'Citation tags: [file:path] [weak:id] [bug:id] [decision:id] [roadmap:id] — صرف PSC میں موجود IDs۔',
            'اگر ڈیٹا ناکافی ہو تو واضح کہیں۔',
            'آخر میں مختصر یاد دہانی: عمل سے پہلے verify کریں۔'
        ].join('\n');
    return base;
}

function buildUserPrompt(question, psc) {
    return [
        '=== PLATFORM CONTEXT PACK (JSON) ===',
        JSON.stringify(psc.slices, null, 0),
        '',
        '=== META ===',
        'cmiVersion: ' + (psc.cmiVersion || '') + ' gitSha: ' + (psc.gitSha || ''),
        '',
        '=== QUESTION ===',
        String(question || '').trim()
    ].join('\n');
}

module.exports = {
    buildSystemPrompt: buildSystemPrompt,
    buildUserPrompt: buildUserPrompt
};
