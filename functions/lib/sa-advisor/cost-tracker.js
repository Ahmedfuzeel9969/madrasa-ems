'use strict';

function estimateTokens(text) {
    return Math.ceil(String(text || '').length / 4);
}

function estimateCostUsd(inputTokens, outputTokens) {
    var inCost = (inputTokens / 1000000) * 0.075;
    var outCost = (outputTokens / 1000000) * 0.30;
    return Math.round((inCost + outCost) * 10000) / 10000;
}

function usageFromResult(psc, question, answer, usageMetadata) {
    if (usageMetadata) {
        var inT = Number(usageMetadata.promptTokenCount) || 0;
        var outT = Number(usageMetadata.candidatesTokenCount || usageMetadata.totalTokenCount) || 0;
        if (!inT) inT = estimateTokens(JSON.stringify(psc) + question);
        if (!outT) outT = estimateTokens(answer);
        return {
            input: inT,
            output: outT,
            costUsd: estimateCostUsd(inT, outT)
        };
    }
    var inT2 = estimateTokens(JSON.stringify(psc) + question);
    var outT2 = estimateTokens(answer);
    return {
        input: inT2,
        output: outT2,
        costUsd: estimateCostUsd(inT2, outT2)
    };
}

module.exports = {
    estimateTokens: estimateTokens,
    estimateCostUsd: estimateCostUsd,
    usageFromResult: usageFromResult
};
