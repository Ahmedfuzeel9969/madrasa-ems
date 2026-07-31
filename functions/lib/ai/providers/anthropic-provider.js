'use strict';

const { BaseProvider } = require('./base-provider');

/**
 * Anthropic Claude adapter stub — wire API key via key-vault when enabling Phase 2+.
 */
class AnthropicProvider extends BaseProvider {
    get id() {
        return 'anthropic';
    }

    get displayName() {
        return 'Anthropic Claude';
    }

    async complete() {
        throw new Error('Anthropic provider not enabled in Phase 1 MVP');
    }
}

module.exports = { AnthropicProvider };
