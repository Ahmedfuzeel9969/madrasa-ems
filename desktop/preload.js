// ============================================================================
// Madrasa EMS Desktop — preload (Phase A5)
// Exposes safe desktop API to the web app renderer.
// ============================================================================
'use strict';

var path = require('path');
var fs = require('fs');
var os = require('os');
var { contextBridge, ipcRenderer } = require('electron');

function getUserDataDir() {
    try {
        return path.join(os.homedir(), 'Documents', 'MadrasaEMS_Data');
    } catch (eDir) {
        return path.join(__dirname, '..', 'MadrasaEMS_Data');
    }
}

function readBootSessionSync() {
    try {
        var fp = path.join(getUserDataDir(), 'ems-desktop-session.json');
        if (!fs.existsSync(fp)) return null;
        var snap = JSON.parse(fs.readFileSync(fp, 'utf8'));
        return snap && snap.tenantId ? snap : null;
    } catch (eRead) {
        return null;
    }
}

var bootSessionFromDisk = readBootSessionSync();

var desktopOfflineOnly = true;
try {
    var cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    desktopOfflineOnly = cfg.offlineOnly !== false;
} catch (eCfg) { /* default true */ }

contextBridge.exposeInMainWorld('EMS_DESKTOP_OFFLINE_ONLY', desktopOfflineOnly);
contextBridge.exposeInMainWorld('EMS_DESKTOP_UNLIMITED', true);
contextBridge.exposeInMainWorld('EMS_DESKTOP_WHATSAPP_MODE', true);
if (bootSessionFromDisk) {
    contextBridge.exposeInMainWorld('EMS_BOOT_SESSION_FROM_DISK', bootSessionFromDisk);
}

contextBridge.exposeInMainWorld('emsDesktop', {
    isDesktop: true,
    offlineOnly: desktopOfflineOnly,
    unlimitedCache: true,
    persistLogin: true,
    platform: process.platform,
    versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome
    },
    getAppInfo: function () {
        return ipcRenderer.invoke('ems-desktop:get-info');
    },
    switchBundle: function (mode) {
        return ipcRenderer.invoke('ems-desktop:switch-bundle', mode);
    },
    manualSync: function () {
        return ipcRenderer.invoke('ems-desktop:manual-sync');
    },
    reloadApp: function () {
        return ipcRenderer.invoke('ems-desktop:reload');
    },
    saveBootSession: function (snap) {
        return ipcRenderer.invoke('ems-desktop:save-boot-session', snap);
    },
    readBootSession: function () {
        return ipcRenderer.invoke('ems-desktop:read-boot-session');
    }
});

// ---------------------------------------------------------------------------
// Native durable DB bridge — the Repository (ems-repository.js) auto-selects
// this backend when window.emsNativeDb.isNative === true. Real OS files, immune
// to renderer "Clear Site Data". Same contract as the browser IndexedDB backend.
// ---------------------------------------------------------------------------
contextBridge.exposeInMainWorld('emsNativeDb', {
    isNative: true,
    info: function () { return ipcRenderer.invoke('ems-db:info'); },
    put: function (collection, record) { return ipcRenderer.invoke('ems-db:put', collection, record); },
    bulkPut: function (collection, records) { return ipcRenderer.invoke('ems-db:bulkPut', collection, records); },
    get: function (collection, id) { return ipcRenderer.invoke('ems-db:get', collection, id); },
    remove: function (collection, id) { return ipcRenderer.invoke('ems-db:remove', collection, id); },
    clear: function (collection) { return ipcRenderer.invoke('ems-db:clear', collection); },
    all: function (collection) { return ipcRenderer.invoke('ems-db:all', collection); },
    count: function (collection, filter, search) { return ipcRenderer.invoke('ems-db:count', collection, filter, search); },
    page: function (collection, opts) { return ipcRenderer.invoke('ems-db:page', collection, opts); }
});
