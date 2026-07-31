'use strict';

var PSC_MAX_BYTES = 32 * 1024;
var DEFAULT_CONFIG = Object.freeze({
    enabled: false,
    stagingEnabled: false,
    productionEnabled: false,
    queriesPerAdminPerDay: 30,
    queriesPlatformPerDay: 100,
    monthlyCostCapUsd: 50,
    monthlyTokenBudget: 500000,
    hardStopAtCap: true,
    maxPscBytes: PSC_MAX_BYTES,
    maxOutputTokens: 2048,
    cacheHitsFree: true,
    defaultModel: 'gemini-2.5-flash'
});

function isAdvisorAllowed(cfg) {
    cfg = cfg || {};
    if (cfg.enabled === true) return { ok: true, mode: 'production' };
    if (cfg.stagingEnabled === true) return { ok: true, mode: 'staging' };
    return { ok: false, mode: 'disabled' };
}

module.exports = {
    PSC_MAX_BYTES: PSC_MAX_BYTES,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    isAdvisorAllowed: isAdvisorAllowed
};
