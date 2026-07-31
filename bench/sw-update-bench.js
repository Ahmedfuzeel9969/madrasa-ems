(function () {
    'use strict';

    if (!('serviceWorker' in navigator)) {
        document.getElementById('bench-status').textContent = 'no serviceWorker';
        window.__swBenchReady = false;
        return;
    }

    function markReady(reg) {
        if (typeof window.emsSwUpdateBind === 'function') {
            window.emsSwUpdateBind(reg);
        }
        document.getElementById('bench-status').textContent = 'ready';
        window.__swBenchReady = true;
        window.__swReg = reg;
    }

    navigator.serviceWorker.register('./sw-update-test-worker.js').then(function (reg) {
        if (navigator.serviceWorker.controller) {
            markReady(reg);
            return;
        }
        navigator.serviceWorker.addEventListener('controllerchange', function onFirstControl() {
            navigator.serviceWorker.removeEventListener('controllerchange', onFirstControl);
            markReady(reg);
        });
    }).catch(function (err) {
        document.getElementById('bench-status').textContent = 'register failed: ' + (err && err.message);
        window.__swBenchReady = false;
    });
})();
