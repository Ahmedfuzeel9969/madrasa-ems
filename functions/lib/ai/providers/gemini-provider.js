'use strict';

const { BaseProvider } = require('./base-provider');

var DEFAULT_MODEL = 'gemini-2.5-flash';
var FALLBACK_MODEL = 'gemini-2.0-flash';
var API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Google Gemini provider — default MVP adapter for Firebase ecosystem.
 */
class GeminiProvider extends BaseProvider {
    constructor(options) {
        super(options);
        this.apiKey = options.apiKey;
        this.model = options.model || DEFAULT_MODEL;
    }

    get id() {
        return 'gemini';
    }

    get displayName() {
        return 'Google Gemini';
    }

    async complete(params) {
        if (!this.apiKey) {
            throw new Error('GEMINI_API_KEY not configured');
        }
        var systemPrompt = params.systemPrompt || '';
        var userPrompt = params.userPrompt || '';
        var maxOutputTokens = params.maxOutputTokens || 2048;
        var temperature = typeof params.temperature === 'number' ? params.temperature : 0.4;

        var body = {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
                maxOutputTokens: maxOutputTokens,
                temperature: temperature
            }
        };

        var modelsToTry = [this.model];
        if (this.model !== FALLBACK_MODEL) modelsToTry.push(FALLBACK_MODEL);

        var lastErr = null;
        for (var i = 0; i < modelsToTry.length; i++) {
            var model = modelsToTry[i];
            try {
                var result = await this._callModel(model, body);
                return { text: result.text, model: model, usage: result.usage };
            } catch (err) {
                lastErr = err;
                if (err.status !== 404 && err.status !== 400) break;
            }
        }
        throw lastErr || new Error('Gemini request failed');
    }

    async _callModel(model, body) {
        var url = API_BASE + '/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(this.apiKey);
        var res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        var json = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            var msg = (json.error && json.error.message) || res.statusText || 'Gemini API error';
            var err = new Error(msg);
            err.status = res.status;
            throw err;
        }
        var parts = json.candidates && json.candidates[0] && json.candidates[0].content
            && json.candidates[0].content.parts;
        var text = '';
        if (Array.isArray(parts)) {
            text = parts.map(function (p) { return p.text || ''; }).join('').trim();
        }
        if (!text) {
            throw new Error('Gemini returned empty response');
        }
        return {
            text: text,
            usage: json.usageMetadata || null
        };
    }
}

module.exports = { GeminiProvider, DEFAULT_MODEL, FALLBACK_MODEL };
