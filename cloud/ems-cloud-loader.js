// ============================================================================
// Cloud stack loader — only when EMS_OFFLINE_ONLY is false
// ============================================================================
(function (global) {
    'use strict';

    var loaded = false;
    var loadPromise = null;

    function bust(src) {
        var m = global.EmsCloudManifest;
        var v = (m && m.cacheBust) ? m.cacheBust : '1';
        return src + (src.indexOf('?') >= 0 ? '&' : '?') + 'v=' + v;
    }

    function loadOne(src) {
        return new Promise(function (resolve, reject) {
            var el = document.createElement('script');
            el.src = bust(src);
            el.async = false;
            el.onload = function () { resolve(); };
            el.onerror = function () { reject(new Error('cloud script failed: ' + src)); };
            document.head.appendChild(el);
        });
    }

    function loadSequential(list) {
        return (list || []).reduce(function (chain, src) {
            return chain.then(function () { return loadOne(src); });
        }, Promise.resolve());
    }

    global.emsLoadCloudStack = function () {
        if (typeof global.emsIsCloudEnabled === 'function' && !global.emsIsCloudEnabled()) {
            return Promise.resolve({ skipped: true, reason: 'offline_only' });
        }
        if (loaded) return Promise.resolve({ ready: true, cached: true });
        if (loadPromise) return loadPromise;

        var manifest = global.EmsCloudManifest;
        if (!manifest) {
            return Promise.reject(new Error('EmsCloudManifest missing'));
        }

        loadPromise = loadSequential(manifest.vendor)
            .then(function () { return loadSequential(manifest.boot); })
            .then(function () { return loadSequential(manifest.foundation); })
            .then(function () {
                return Promise.all((manifest.core || []).map(function (src) {
                    return loadOne(src);
                }));
            })
            .then(function () {
                loaded = true;
                try {
                    global.dispatchEvent(new CustomEvent('ems:cloud-stack-ready'));
                } catch (e) { /* ignore */ }
                return { ready: true, scripts: (manifest.foundation || []).length + (manifest.core || []).length };
            })
            .catch(function (err) {
                loadPromise = null;
                throw err;
            });
        return loadPromise;
    };

    global.emsLoadCloudDeferred = function () {
        if (typeof global.emsIsCloudEnabled === 'function' && !global.emsIsCloudEnabled()) {
            return Promise.resolve({ skipped: true });
        }
        var manifest = global.EmsCloudManifest;
        if (!manifest || !manifest.deferred || !manifest.deferred.length) {
            return Promise.resolve({ scripts: 0 });
        }
        return Promise.all(manifest.deferred.map(function (src) { return loadOne(src); }))
            .then(function () { return { scripts: manifest.deferred.length }; });
    };

    global.emsCloudLazyScripts = function (modId) {
        var manifest = global.EmsCloudManifest;
        if (!manifest || !manifest.lazy) return [];
        return manifest.lazy[modId] || [];
    };
})(typeof window !== 'undefined' ? window : globalThis);
