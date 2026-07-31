'use strict';

const { BaseProvider } = require('./base-provider');

/**
 * OpenAI adapter stub — wire API key via key-vault when enabling Phase 2+.
 */
class OpenAiProvider extends BaseProvider {
    get id() {
        return 'openai';
    }

    get displayName() {
        return 'OpenAI';
    }

    async complete() {
        throw new Error('OpenAI provider not enabled in Phase 1 MVP');
    }
}

module.exports = { OpenAiProvider };
