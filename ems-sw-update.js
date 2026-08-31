// ============================================================================
// EMS Service Worker Update — prevent mixed-version sessions (Phase 4 P3)
// ============================================================================
(function (global) {
    'use strict';

    /** Must match service-worker.js EMS_SW_BUILD_TAG on each deploy. */
  global.EMS_BUILD_TAG = '20260831_smart_register_colors_v11';

    var _state = {
        bound: false,
        hadController: !!(global.navigator && global.navigator.serviceWorker && global.navigator.serviceWorker.controller),
        refreshing: false,
        pendingTag: null,
        bannerShown: false,
        reloadScheduled: false
    };

    function qs(id) {
        return global.document ? global.document.getElementById(id) : null;
    }

    function removeBanner() {
        var el = qs('ems-sw-update-banner');
        if (el && el.parentNode) el.parentNode.removeChild(el);
        _state.bannerShown = false;
    }

    function showUpdateBanner(opts) {
        opts = opts || {};
        if (_state.bannerShown || !global.document || !global.document.body) return;
        _state.bannerShown = true;
        var bar = global.document.createElement('div');
        bar.id = 'ems-sw-update-banner';
        bar.setAttribute('role', 'alert');
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#1e3a5f;color:#fff;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.25);';
        var text = global.document.createElement('span');
        text.textContent = opts.message || 'نیا ورژن دستیاب ہے — براہ کرم صفحہ دوبارہ لوڈ کریں تاکہ تمام tabs یکساں رہیں۔';
        var btn = global.document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'ابھی ری لوڈ کریں';
        btn.style.cssText = 'background:#f59e0b;color:#111827;border:none;border-radius:6px;padding:8px 12px;cursor:pointer;font-weight:700;';
        btn.addEventListener('click', function () {
            global.emsSwUpdateReloadNow('user_banner');
        });
        bar.appendChild(text);
        bar.appendChild(btn);
        global.document.body.appendChild(bar);
    }

    function postMessageToController(msg) {
        return new Promise(function (resolve) {
            try {
                if (!global.navigator || !global.navigator.serviceWorker || !global.navigator.serviceWorker.controller) {
                    resolve(null);
                    return;
                }
                var channel = new global.MessageChannel();
                channel.port1.onmessage = function (ev) { resolve(ev.data || null); };
                global.navigator.serviceWorker.controller.postMessage(msg, [channel.port2]);
                global.setTimeout(function () { resolve(null); }, 1500);
            } catch (e) {
                resolve(null);
            }
        });
    }

    function fetchActiveSwBuildTag() {
        return postMessageToController({ type: 'ems-get-build-tag' }).then(function (data) {
            return data && data.tag ? String(data.tag) : null;
        });
    }

    function fetchWorkerBuildTag(worker) {
        return new Promise(function (resolve) {
            try {
                if (!worker) {
                    resolve(null);
                    return;
                }
                var channel = new global.MessageChannel();
                channel.port1.onmessage = function (ev) {
                    resolve(ev.data && ev.data.tag ? String(ev.data.tag) : null);
                };
                worker.postMessage({ type: 'ems-get-build-tag' }, [channel.port2]);
                global.setTimeout(function () { resolve(null); }, 1500);
            } catch (e) {
                resolve(null);
            }
        });
    }

    global.emsSwUpdateReloadNow = function (reason) {
        if (_state.refreshing) return;
        _state.refreshing = true;
        removeBanner();
        try {
            if (typeof global.emsBootMark === 'function') {
                global.emsBootMark('sw-update-reload', reason || 'manual');
            }
        } catch (eMark) { /* ignore */ }
        global.location.reload();
    };

    global.emsSwUpdateHandleControllerChange = function () {
        if (_state.refreshing) return Promise.resolve({ skipped: 'refreshing' });
        if (!_state.hadController) {
            _state.hadController = !!(global.navigator && global.navigator.serviceWorker && global.navigator.serviceWorker.controller);
            return Promise.resolve({ skipped: 'first_controller' });
        }
        return fetchActiveSwBuildTag().then(function (swTag) {
            if (swTag && swTag === global.EMS_BUILD_TAG) {
                return { skipped: 'tag_match', swTag: swTag };
            }
            if (!swTag) {
                return { skipped: 'no_sw_tag' };
            }
            showUpdateBanner({ message: 'سافٹ ویئر اپ ڈیٹ مکمل — mixed version روکنے کے لیے ری لوڈ ہو رہا ہے…' });
            global.setTimeout(function () {
                global.emsSwUpdateReloadNow('controllerchange');
            }, 500);
            return { reloadScheduled: true, swTag: swTag };
        });
    };

    global.emsSwUpdateTestSetHadController = function (value) {
        _state.hadController = !!value;
    };

    global.emsSwUpdateTestNotifyInstalledTag = function (newTag) {
        if (newTag && newTag !== global.EMS_BUILD_TAG) {
            _state.pendingTag = newTag;
            showUpdateBanner();
        }
    };

    function onUpdateFound(reg) {
        var worker = reg.installing || reg.waiting;
        if (!worker) return;
        worker.addEventListener('statechange', function () {
            if (worker.state !== 'installed') return;
            if (!global.navigator.serviceWorker.controller) return;
            fetchWorkerBuildTag(worker).then(function (newTag) {
                if (newTag && newTag !== global.EMS_BUILD_TAG) {
                    _state.pendingTag = newTag;
                    showUpdateBanner();
                }
            });
        });
    }

    global.emsSwUpdateBind = function (reg) {
        if (_state.bound || !reg || !global.navigator || !global.navigator.serviceWorker) return;
        _state.bound = true;
        _state.hadController = !!global.navigator.serviceWorker.controller;

        global.navigator.serviceWorker.addEventListener('controllerchange', function () {
            global.emsSwUpdateHandleControllerChange();
        });

        if (reg.waiting && global.navigator.serviceWorker.controller) {
            onUpdateFound(reg);
        }
        reg.addEventListener('updatefound', function () {
            onUpdateFound(reg);
        });
    };

    global.emsSwUpdateGetState = function () {
        return {
            buildTag: global.EMS_BUILD_TAG,
            bound: _state.bound,
            hadController: _state.hadController,
            refreshing: _state.refreshing,
            pendingTag: _state.pendingTag,
            controllerchangeBound: _state.bound
        };
    };
})(typeof window !== 'undefined' ? window : globalThis);
