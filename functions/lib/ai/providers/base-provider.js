'use strict';

/**
 * Base LLM provider adapter — extend for Gemini, OpenAI, Claude, etc.
 */
class BaseProvider {
    constructor(options) {
        this.options = options || {};
    }

    get id() {
        return 'base';
    }

    get displayName() {
        return 'Base';
    }

    /**
     * @param {object} params
     * @param {string} params.systemPrompt
     * @param {string} params.userPrompt
     * @param {number} [params.maxOutputTokens]
     * @param {number} [params.temperature]
     * @returns {Promise<{ text: string, model: string, usage?: object }>}
     */
    async complete(params) {
        throw new Error('complete() not implemented for ' + this.id);
    }
}

module.exports = { BaseProvider };
