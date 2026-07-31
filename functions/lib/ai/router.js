'use strict';

const { GeminiProvider } = require('./providers/gemini-provider');
const { OpenAiProvider } = require('./providers/openai-provider');
const { AnthropicProvider } = require('./providers/anthropic-provider');
const { resolveProviderKey } = require('./key-vault');

var PROVIDERS = {
    gemini: GeminiProvider,
    openai: OpenAiProvider,
    anthropic: AnthropicProvider
};

var DEFAULT_PROVIDER = 'gemini';

/**
 * Resolve LLM provider instance for tenant — adapter pattern for multi-LLM future.
 */
async function resolveProvider(tenantId, providerId) {
    var id = providerId || DEFAULT_PROVIDER;
    var Ctor = PROVIDERS[id];
    if (!Ctor) {
        throw new Error('Unknown AI provider: ' + id);
    }
    var vault = await resolveProviderKey(tenantId, id);
    return new Ctor({ apiKey: vault.key, model: vault.model });
}

function listProviders() {
    return Object.keys(PROVIDERS);
}

module.exports = {
    DEFAULT_PROVIDER: DEFAULT_PROVIDER,
    resolveProvider: resolveProvider,
    listProviders: listProviders
};
