// ============================================================================
// EMS Virtual Table — fixed-row virtual scroll (Phase 2 Sprint 3)
// ============================================================================
(function (global) {
    'use strict';

    var instances = Object.create(null);

    function clamp(n, min, max) {
        return Math.max(min, Math.min(max, n));
    }

    /**
     * @param {string} id unique instance id
     * @param {object} opts
     * @param {HTMLElement} opts.scrollEl overflow container
     * @param {HTMLElement} opts.tbody table tbody
     * @param {number} opts.rowHeight fixed row height px
     * @param {function(number):HTMLElement|string} opts.renderRow
     * @param {function():Array} opts.getData filtered row source
     */
    global.emsVirtualTableMount = function (id, opts) {
        if (!opts || !opts.scrollEl || !opts.tbody) return null;
        var rowHeight = opts.rowHeight || 56;
        var buffer = opts.buffer || 4;

        if (instances[id]) {
            instances[id].destroy();
        }

        var state = {
            id: id,
            scrollEl: opts.scrollEl,
            tbody: opts.tbody,
            rowHeight: rowHeight,
            buffer: buffer,
            renderRow: opts.renderRow,
            getData: opts.getData,
            raf: null
        };

        function paint() {
            state.raf = null;
            var data = typeof state.getData === 'function' ? state.getData() : [];
            var total = data.length;
            var scrollTop = state.scrollEl.scrollTop || 0;
            var viewH = state.scrollEl.clientHeight || 0;
            var minVisible = opts.minVisible || 12;
            var start = clamp(Math.floor(scrollTop / rowHeight) - buffer, 0, Math.max(0, total - 1));
            var visible = Math.max(minVisible, Math.ceil(viewH / rowHeight) + buffer * 2);
            var end = clamp(start + visible, 0, total);

            var topPad = start * rowHeight;
            var bottomPad = Math.max(0, (total - end) * rowHeight);

            state.tbody.innerHTML = '';
            if (total === 0) {
                if (typeof opts.emptyHtml === 'string') {
                    state.tbody.innerHTML = opts.emptyHtml;
                }
                return;
            }

            if (topPad > 0) {
                var trTop = document.createElement('tr');
                trTop.className = 'ems-vt-spacer';
                trTop.innerHTML = '<td colspan="99" style="height:' + topPad + 'px;padding:0;border:none;"></td>';
                state.tbody.appendChild(trTop);
            }

            for (var i = start; i < end; i++) {
                var row = state.renderRow(i, data[i]);
                if (typeof row === 'string') {
                    var tmp = document.createElement('tbody');
                    tmp.innerHTML = row.trim();
                    var tr = tmp.firstElementChild;
                    if (tr) state.tbody.appendChild(tr);
                } else if (row && row.nodeType === 1) {
                    state.tbody.appendChild(row);
                }
            }

            if (bottomPad > 0) {
                var trBot = document.createElement('tr');
                trBot.className = 'ems-vt-spacer';
                trBot.innerHTML = '<td colspan="99" style="height:' + bottomPad + 'px;padding:0;border:none;"></td>';
                state.tbody.appendChild(trBot);
            }

            if (typeof global.sysLayoutApplyTables === 'function') {
                global.sysLayoutApplyTables();
            }
        }

        function schedule() {
            if (state.raf) return;
            state.raf = global.requestAnimationFrame(paint);
        }

        state.scrollHandler = schedule;
        state.scrollEl.addEventListener('scroll', schedule, { passive: true });
        if (typeof global.ResizeObserver === 'function') {
            state.resizeObs = new global.ResizeObserver(schedule);
            state.resizeObs.observe(state.scrollEl);
        }
        state.destroy = function () {
            state.scrollEl.removeEventListener('scroll', schedule);
            if (state.resizeObs) state.resizeObs.disconnect();
            if (state.raf) global.cancelAnimationFrame(state.raf);
            delete instances[id];
        };
        state.paintNow = function () {
            if (state.raf) {
                global.cancelAnimationFrame(state.raf);
                state.raf = null;
            }
            paint();
        };
        state.refresh = schedule;

        instances[id] = state;
        schedule();
        return state;
    };

    /** @param {string} id @param {{ sync?: boolean }|boolean} [opts] sync=true → same-tick paint (mobile focus) */
    global.emsVirtualTableRefresh = function (id, opts) {
        var inst = instances[id];
        if (!inst) return;
        var sync = opts === true || (opts && opts.sync);
        if (sync && typeof inst.paintNow === 'function') {
            inst.paintNow();
            return;
        }
        if (typeof inst.refresh === 'function') inst.refresh();
    };

    global.emsVirtualTableDestroy = function (id) {
        if (instances[id]) instances[id].destroy();
    };
})(typeof window !== 'undefined' ? window : globalThis);
