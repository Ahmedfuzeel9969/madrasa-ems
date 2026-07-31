// ============================================================================
// EMS Smart Import Layer — profiles, snapshots, validation (additive)
// Works alongside ems-import-wizard.js; does not replace it.
// ============================================================================
(function (global) {
    'use strict';

    function IE() { return global.EmsImportExport; }
    function toast(m, t) { if (global.showToast) global.showToast(m, t || 'success'); }

    global.emsSmartRefreshSnapshotUi = function () {
        var btn = document.getElementById('smart-restore-snapshot-btn');
        var hint = document.getElementById('smart-snapshot-hint');
        if (!IE() || !btn) return;
        var has = IE().hasSnapshot && IE().hasSnapshot();
        btn.style.display = has ? 'inline-flex' : 'none';
        if (hint) hint.textContent = has ? 'آخری امپورٹ سے پہلے کا snapshot دستیاب ہے' : '';
    };

    global.emsSmartRestoreSnapshot = function () {
        if (!IE() || typeof IE().restoreSnapshot !== 'function') return;
        if (!confirm('کیا آپ واقعی آخری snapshot پر واپس جانا چاہتے ہیں؟')) return;
        var res = IE().restoreSnapshot();
        if (res.ok) {
            toast('بحال: ' + res.count + ' ریکارڈ (' + (res.at || '').slice(0, 10) + ')');
            if (typeof global.emsRenderImportHistory === 'function') global.emsRenderImportHistory();
            global.emsSmartRefreshSnapshotUi();
        } else {
            toast('Snapshot نہیں ملا', 'warning');
        }
    };

    global.emsSmartSaveProfile = function (name, type, map) {
        if (!IE() || typeof IE().saveMappingProfile !== 'function') return null;
        var saved = IE().saveMappingProfile(name, type, map);
        toast('Profile محفوظ: ' + saved.name);
        return saved;
    };

    global.emsSmartLoadProfiles = function (type) {
        if (!IE() || typeof IE().loadMappingProfiles !== 'function') return [];
        return IE().loadMappingProfiles(type);
    };

    global.emsSmartRenderPanel = function () {
        var box = document.getElementById('smart-import-panel');
        if (!box) return;
        box.innerHTML =
            '<p style="color:#64748b;font-size:13px;margin:0 0 12px;">Advanced — 7-step wizard، field matching، conflict resolution، master data۔</p>' +
            '<button type="button" class="btn btn-primary" style="width:100%;padding:12px 26px;margin-bottom:10px;" onclick="window.openImportWizard()">' +
            '<i class="fas fa-wand-magic-sparkles"></i> Smart Import Wizard کھولیں</button>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
            '<button type="button" id="smart-restore-snapshot-btn" class="btn btn-outline btn-sm" style="display:none;" onclick="window.emsSmartRestoreSnapshot()">' +
            '<i class="fas fa-rotate-left"></i> Snapshot بحال کریں</button>' +
            '<span id="smart-snapshot-hint" style="font-size:11px;color:#64748b;"></span></div>' +
            '<p style="font-size:11px;color:#94a3b8;margin-top:10px;">Wizard: profiles، templates، duplicate merge (Step 5)۔ 400+ rows → Cloud bulk import۔</p>';
        global.emsSmartRefreshSnapshotUi();
    };

    // Wizard step 3: optional profile load/save hooks
    global.emsSmartWizardProfileBar = function (containerId, type, currentMap) {
        var el = document.getElementById(containerId);
        if (!el || !IE()) return;
        var profiles = global.emsSmartLoadProfiles(type);
        var opts = '<option value="">— Profile لوڈ —</option>' +
            profiles.map(function (p) { return '<option value="' + p.name + '">' + p.name + '</option>'; }).join('');
        el.innerHTML =
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center;">' +
            '<select id="iw-profile-load" class="input-control" style="max-width:180px;font-size:12px;">' + opts + '</select>' +
            '<button type="button" class="btn btn-outline btn-sm" onclick="window.emsSmartWizardLoadProfile(\'' + type + '\')"><i class="fas fa-folder-open"></i></button>' +
            '<input type="text" id="iw-profile-save-name" placeholder="Profile نام" class="input-control" style="max-width:120px;font-size:12px;">' +
            '<button type="button" class="btn btn-outline btn-sm" onclick="window.emsSmartWizardSaveProfile(\'' + type + '\')"><i class="fas fa-save"></i></button>' +
            '</div>';
        global._emsWizardMapRef = currentMap;
    };

    global.emsSmartWizardLoadProfile = function (type) {
        var sel = document.getElementById('iw-profile-load');
        if (!sel || !sel.value) return;
        var profiles = global.emsSmartLoadProfiles(type);
        var p = profiles.find(function (x) { return x.name === sel.value; });
        if (!p || !p.map) return;
        document.querySelectorAll('.iw-mapsel').forEach(function (s) {
            var idx = s.getAttribute('data-idx');
            if (p.map[idx]) s.value = p.map[idx];
        });
        toast('Profile لوڈ: ' + p.name);
    };

    global.emsSmartWizardSaveProfile = function (type) {
        var nameEl = document.getElementById('iw-profile-save-name');
        var name = (nameEl && nameEl.value) ? nameEl.value.trim() : '';
        if (!name) { toast('Profile نام درج کریں', 'warning'); return; }
        var m = {};
        document.querySelectorAll('.iw-mapsel').forEach(function (s) {
            if (s.value) m[s.getAttribute('data-idx')] = s.value;
        });
        global.emsSmartSaveProfile(name, type, m);
    };

})(window);
