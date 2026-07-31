// ============================================================================
// Madrasa EMS Desktop — Electron main process (Phase A5: local dist bundle)
// Firebase Google Auth: OAuth popups stay inside Electron (not external browser).
// Persistent session: partition persist:madrasa-ems + LOCAL auth persistence in auth.js
// Packaged builds serve dist/ from 127.0.0.1 — no remote hosting dependency for UI shell.
// ============================================================================
'use strict';

var path = require('path');
var fs = require('fs');
var http = require('http');
var { app, BrowserWindow, ipcMain, Menu, shell, nativeTheme, dialog, session, globalShortcut } = require('electron');

// ---------------------------------------------------------------------------
// Permanent local data — Documents\MadrasaEMS_Data (regent34 / Option A)
// Must run before app.ready and before any app.getPath('userData') usage.
// Portable builds otherwise store IndexedDB under %TEMP% and lose data on exit.
// ---------------------------------------------------------------------------
var USER_DATA_DIR = path.join(app.getPath('documents'), 'MadrasaEMS_Data');
try {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
} catch (mkdirErr) {
    console.warn('[Madrasa EMS] could not create userData dir:', mkdirErr && mkdirErr.message);
}
app.setPath('userData', USER_DATA_DIR);
app.commandLine.appendSwitch('user-data-dir', USER_DATA_DIR);

var CONFIG_PATH = path.join(__dirname, 'config.json');
var AUTH_PARTITION = 'persist:madrasa-ems';
var LOG_PATH = path.join(app.getPath('userData'), 'desktop-startup.log');
var PORT_FILE = path.join(app.getPath('userData'), 'local-server-port.json');
var BOOT_SESSION_FILE = path.join(app.getPath('userData'), 'ems-desktop-session.json');
var IS_DEBUG = process.env.EMS_DESKTOP_DEBUG === '1';
var MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

var config = {
    appName: 'Madrasa EMS',
    appUrl: 'https://madrasa-mangment-app.web.app/?desktop=1&v=20260626regent63',
    preferLocalBundle: true,
    enableDevTools: true,
    localServerHost: '127.0.0.1',
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 640
};

var mainWindow = null;
var localStaticServer = null;
var localStaticPort = null;
var quitFlushInProgress = false;
var bundleState = {
    mode: 'unknown',
    url: '',
    builtAt: null,
    fileCount: 0
};

/** Single instance — lower memory, no duplicate app windows. */
var gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    try {
        fs.appendFileSync(LOG_PATH, new Date().toISOString() + ' BLOCKED: another instance already running\n', 'utf8');
    } catch (e) { /* ignore */ }
    try {
        dialog.showErrorBox(
            'Madrasa EMS',
            'Another copy of Madrasa EMS is already running.\n\nCheck the taskbar or close it in Task Manager, then try again.'
        );
    } catch (dialogErr) { /* ignore */ }
    app.quit();
    process.exit(0);
} else {
    app.on('second-instance', function () {
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

/** Packaged build: fewer renderer spares, less idle RAM. */
if (app.isPackaged && !IS_DEBUG) {
    app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,Translate');
    app.commandLine.appendSwitch('renderer-process-limit', '1');
}

function logStartup(message) {
    var line = new Date().toISOString() + ' ' + message + '\n';
    try {
        fs.appendFileSync(LOG_PATH, line, 'utf8');
    } catch (e) { /* ignore */ }
    if (IS_DEBUG) {
        console.log(message);
    }
}

function loadConfig() {
    try {
        config = Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
    } catch (e) {
        logStartup('config.json not loaded, using defaults: ' + (e && e.message));
    }
}

function getDistRoot() {
    return path.join(__dirname, '..', 'dist');
}

function distIndexPath() {
    return path.join(getDistRoot(), 'index.html');
}

function readBundleMeta(distRoot) {
    try {
        var metaPath = path.join(distRoot, '.desktop-bundle.json');
        if (fs.existsSync(metaPath)) {
            return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        }
    } catch (e) { /* ignore */ }
    return null;
}

function resolveBundleModePreference() {
    if (process.env.EMS_DESKTOP_URL) return 'custom';
    if (process.env.EMS_DESKTOP_REMOTE === '1') return 'remote';
    if (process.env.EMS_DESKTOP_LOCAL === '1') return 'local';
    if (config.preferLocalBundle === false) return 'remote';
    if (app.isPackaged) return 'local';
    if (fs.existsSync(distIndexPath())) return 'local';
    return 'remote';
}

function stopLocalStaticServer() {
    if (localStaticServer) {
        try { localStaticServer.close(); } catch (e) { /* ignore */ }
        localStaticServer = null;
        localStaticPort = null;
    }
}

function safeDistFile(distRoot, urlPath) {
    var rel = urlPath.replace(/^\/+/, '').split('?')[0].split('#')[0];
    if (!rel || rel.indexOf('..') >= 0) return null;
    var filePath = path.normalize(path.join(distRoot, rel));
    var rootNorm = path.normalize(distRoot + path.sep);
    if (!filePath.startsWith(rootNorm) && filePath !== path.normalize(distRoot)) {
        return null;
    }
    return filePath;
}

function readPersistedLocalPort() {
    try {
        var raw = fs.readFileSync(PORT_FILE, 'utf8');
        var parsed = JSON.parse(raw);
        if (parsed && parsed.port) return Number(parsed.port) || null;
    } catch (e) { /* first launch */ }
    return null;
}

function writePersistedLocalPort(port) {
    try {
        fs.writeFileSync(PORT_FILE, JSON.stringify({ port: port, savedAt: Date.now() }), 'utf8');
    } catch (e) {
        logStartup('could not persist local server port: ' + (e && e.message));
    }
}

function resolveLocalServerPort() {
    var fromEnv = process.env.EMS_DESKTOP_PORT ? parseInt(process.env.EMS_DESKTOP_PORT, 10) : null;
    if (fromEnv && fromEnv > 0) return fromEnv;
    var saved = readPersistedLocalPort();
    if (saved && saved > 0) return saved;
    return config.localServerPort || 17654;
}

function startLocalStaticServer(distRoot) {
    stopLocalStaticServer();
    var host = config.localServerHost || '127.0.0.1';
    var basePort = resolveLocalServerPort();

    return new Promise(function (resolve, reject) {
        var server = http.createServer(function (req, res) {
            try {
                var parsed = new URL(req.url, 'http://' + host);
                var urlPath = parsed.pathname || '/';
                if (urlPath === '/') urlPath = '/index.html';
                var filePath = safeDistFile(distRoot, urlPath);
                if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('Not found');
                    return;
                }
                var ext = path.extname(filePath).toLowerCase();
                res.writeHead(200, {
                    'Content-Type': MIME[ext] || 'application/octet-stream',
                    'Cache-Control': 'no-cache, must-revalidate'
                });
                fs.createReadStream(filePath).pipe(res);
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Server error');
            }
        });

        function attemptListen(port, triesLeft) {
            server.removeAllListeners('error');
            server.on('error', function (err) {
                if (err && err.code === 'EADDRINUSE' && triesLeft > 0) {
                    logStartup('local port ' + port + ' busy — trying ' + (port + 1));
                    attemptListen(port + 1, triesLeft - 1);
                    return;
                }
                reject(err);
            });
            server.listen(port, host, function () {
                localStaticServer = server;
                localStaticPort = server.address().port;
                writePersistedLocalPort(localStaticPort);
                var url = 'http://' + host + ':' + localStaticPort + '/index.html?desktop=1&localBundle=1';
                logStartup('local bundle server on ' + url + ' (stable port=' + localStaticPort + ')');
                resolve(url);
            });
        }

        attemptListen(basePort, 20);
    });
}

function prepareBundle(modePref) {
    modePref = modePref || resolveBundleModePreference();
    if (modePref === 'custom') {
        bundleState = {
            mode: 'custom',
            url: process.env.EMS_DESKTOP_URL,
            builtAt: null,
            fileCount: 0
        };
        return Promise.resolve(bundleState);
    }
    if (modePref === 'remote') {
        stopLocalStaticServer();
        bundleState = {
            mode: 'remote',
            url: config.appUrl,
            builtAt: null,
            fileCount: 0
        };
        return Promise.resolve(bundleState);
    }

    var distRoot = getDistRoot();
    var indexPath = path.join(distRoot, 'index.html');
    if (!fs.existsSync(indexPath)) {
        logStartup('local dist missing at ' + indexPath + ' — falling back to remote');
        stopLocalStaticServer();
        bundleState = {
            mode: 'remote-fallback',
            url: config.appUrl,
            builtAt: null,
            fileCount: 0
        };
        return Promise.resolve(bundleState);
    }

    var meta = readBundleMeta(distRoot);
    return startLocalStaticServer(distRoot).then(function (url) {
        bundleState = {
            mode: 'local',
            url: url,
            builtAt: meta && meta.builtAt ? meta.builtAt : null,
            fileCount: meta && meta.fileCount ? meta.fileCount : 0
        };
        logStartup('local bundle server on ' + url + ' builtAt=' + (bundleState.builtAt || 'unknown'));
        return bundleState;
    });
}

function appOrigin() {
    try {
        if (bundleState.url) return new URL(bundleState.url).origin;
    } catch (e) { /* ignore */ }
    try {
        return new URL(config.appUrl).origin;
    } catch (e2) {
        return 'https://madrasa-mangment-app.web.app';
    }
}

function isOAuthUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return /accounts\.google\.com|googleapis\.com|google\.com\/signin|firebaseapp\.com|\/__\/auth\//i.test(url);
}

function isAppUrl(url) {
    if (!url) return false;
    if (url.indexOf('file://') === 0) return true;
    var origin = appOrigin();
    if (url.indexOf(origin) === 0) return true;
    if (bundleState.mode === 'local' && /^https?:\/\/127\.0\.0\.1:\d+/i.test(url)) return true;
    if (bundleState.mode === 'local' && config.localServerHost && url.indexOf('http://' + config.localServerHost + ':') === 0) return true;
    try {
        return new URL(url).origin === new URL(config.appUrl).origin;
    } catch (e) {
        return false;
    }
}

function devToolsEnabled() {
    return IS_DEBUG || config.enableDevTools !== false;
}

function toggleMainDevTools() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
    } else {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
}

function registerDevToolsShortcuts() {
    if (!devToolsEnabled()) return;
    try {
        globalShortcut.register('CommandOrControl+Shift+I', toggleMainDevTools);
        globalShortcut.register('F12', toggleMainDevTools);
    } catch (shortcutErr) {
        logStartup('DevTools shortcut registration failed: ' + (shortcutErr && shortcutErr.message));
    }
}

function flushRendererLocalDataBeforeQuit() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return Promise.resolve({ ok: false, reason: 'no_window' });
    }
    var wc = mainWindow.webContents;
    if (!wc || wc.isDestroyed()) {
        return Promise.resolve({ ok: false, reason: 'no_webcontents' });
    }
    return wc.executeJavaScript(
        '(function(){'
        + 'var chain=Promise.resolve();'
        + 'if(typeof emsRegRepoAwaitPersistIdle==="function"){chain=emsRegRepoAwaitPersistIdle();}'
        + 'return chain.then(function(){'
        + 'if(typeof emsPersistOfflineSession==="function"){emsPersistOfflineSession();}'
        + 'if(typeof emsRegRepoFlushAllToIdb==="function"){return emsRegRepoFlushAllToIdb({allowShrink:false});}'
        + 'if(typeof emsRegRepoPersistToIdb==="function"){return emsRegRepoPersistToIdb({allowShrink:false});}'
        + 'return {saved:false};'
        + '});'
        + '})()',
        true
    ).catch(function (err) {
        logStartup('quit flush failed: ' + (err && err.message));
        return { ok: false, error: err && err.message };
    });
}

function mainWebContents() {
    return mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
}

function isMainWebContents(contents) {
    var main = mainWebContents();
    return !!contents && !!main && contents.id === main.id;
}

function baseWebPreferences() {
    return {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
        partition: AUTH_PARTITION,
        backgroundThrottling: true,
        enableWebSQL: false,
        v8CacheOptions: 'code',
        devTools: devToolsEnabled(),
        webgl: true,
        enableBlinkFeatures: '',
        disableBlinkFeatures: 'Auxclick'
    };
}

function authPopupWindowOptions() {
    return {
        width: 600,
        height: 820,
        minWidth: 480,
        minHeight: 640,
        autoHideMenuBar: true,
        // Non-modal: user must switch to phone for Google 2FA "Yes" — modal blocks that flow.
        modal: false,
        parent: undefined,
        backgroundColor: '#ffffff',
        show: false,
        alwaysOnTop: false,
        webPreferences: baseWebPreferences()
    };
}

function handleOAuthWindowOpen(details) {
    if (isOAuthUrl(details.url)) {
        return {
            action: 'allow',
            overrideBrowserWindowOptions: authPopupWindowOptions()
        };
    }
    if (details.url && /^https?:\/\//i.test(details.url)) {
        shell.openExternal(details.url);
    }
    return { action: 'deny' };
}

function closeAuthPopupDelayed(contents, delayMs) {
    if (!contents || contents.isDestroyed()) return;
    setTimeout(function () {
        if (!contents.isDestroyed()) contents.close();
    }, delayMs || 3000);
}

function wireAuthNavigation(contents) {
    if (!contents || isMainWebContents(contents)) return;

    contents.on('will-navigate', function (event, url) {
        if (isMainWebContents(contents)) return;
        if (isAppUrl(url)) {
            event.preventDefault();
            var main = mainWebContents();
            if (main && !main.isDestroyed()) {
                main.loadURL(url);
            }
            // Let Firebase popup finish postMessage handshake before closing.
            closeAuthPopupDelayed(contents, 3500);
        }
    });

    contents.on('did-navigate', function (event, url) {
        if (isMainWebContents(contents)) return;
        if (isAppUrl(url)) {
            closeAuthPopupDelayed(contents, 3500);
        }
    });
}

function stripCoopHeaders(headers) {
    if (!headers) return headers;
    var next = Object.assign({}, headers);
    Object.keys(next).forEach(function (key) {
        if (/^cross-origin-(opener|embedder)-policy$/i.test(key)) {
            delete next[key];
        }
    });
    return next;
}

function configurePersistentSession() {
    var ses = session.fromPartition(AUTH_PARTITION);
    // Google OAuth popups fail when COOP blocks window.closed / postMessage back to opener.
    ses.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, function (details, callback) {
        callback({
            responseHeaders: stripCoopHeaders(details.responseHeaders)
        });
    });
    ses.setPermissionRequestHandler(function (webContents, permission, callback) {
        if (permission === 'notifications' || permission === 'media') {
            return callback(false);
        }
        callback(true);
    });
    ses.setPermissionCheckHandler(function (webContents, permission) {
        if (permission === 'notifications' || permission === 'media') {
            return false;
        }
        return true;
    });
    logStartup('auth session partition ready: ' + AUTH_PARTITION);
}

function showFatalError(title, message) {
    logStartup('FATAL: ' + title + ' — ' + message);
    dialog.showErrorBox(title, message + '\n\nLog: ' + LOG_PATH);
}

function loadMainUrl(url) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    logStartup('loading ' + url);
    mainWindow.loadURL(url);
}

function switchBundleMode(mode) {
    return prepareBundle(mode).then(function (state) {
        loadMainUrl(state.url);
        buildMenu();
        return state;
    });
}

function buildMenu() {
    var viewSubmenu = [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        {
            label: 'Use Local Bundle',
            accelerator: 'CmdOrCtrl+Shift+L',
            click: function () { switchBundleMode('local'); }
        },
        {
            label: 'Use Online Version',
            accelerator: 'CmdOrCtrl+Shift+O',
            click: function () { switchBundleMode('remote'); }
        },
        { type: 'separator' },
        { role: 'toggleDevTools', visible: devToolsEnabled() },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
    ];

    var bundleLabel = bundleState.mode === 'local'
        ? 'Bundle: Local (' + (bundleState.fileCount || '?') + ' files)'
        : 'Bundle: Online';

    var template = [
        {
            label: 'Madrasa EMS',
            submenu: [
                {
                    label: bundleLabel,
                    enabled: false
                },
                {
                    label: 'Manual Sync',
                    accelerator: 'CmdOrCtrl+Shift+S',
                    click: function () {
                        if (mainWindow) {
                            mainWindow.webContents.executeJavaScript(
                                'typeof emsHybridSyncManual==="function"?emsHybridSyncManual():Promise.resolve()',
                                true
                            );
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: function () { if (mainWindow) mainWindow.reload(); }
                },
                { role: 'quit' }
            ]
        },
        {
            label: 'View',
            submenu: viewSubmenu
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Open Data Folder',
                    click: function () { shell.openPath(app.getPath('userData')); }
                },
                {
                    label: 'Open Startup Log',
                    click: function () { shell.openPath(LOG_PATH); }
                },
                {
                    label: 'Open in Browser',
                    click: function () { shell.openExternal(config.appUrl); }
                }
            ]
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(startUrl) {
    logStartup('createWindow() start');

    mainWindow = new BrowserWindow({
        title: config.appName,
        width: config.width,
        height: config.height,
        minWidth: config.minWidth,
        minHeight: config.minHeight,
        show: true,
        center: true,
        autoHideMenuBar: !IS_DEBUG,
        backgroundColor: '#f8fafc',
        webPreferences: Object.assign({}, baseWebPreferences(), {
            preload: path.join(__dirname, 'preload.js')
        })
    });

    mainWindow.once('ready-to-show', function () {
        logStartup('main window ready-to-show');
        mainWindow.show();
        mainWindow.focus();
        if (IS_DEBUG && devToolsEnabled()) {
            mainWindow.webContents.openDevTools({ mode: 'detach' });
        }
    });

    mainWindow.webContents.on('did-fail-load', function (event, errorCode, errorDescription, validatedURL) {
        logStartup('did-fail-load code=' + errorCode + ' url=' + validatedURL + ' desc=' + errorDescription);
        if (!mainWindow.isDestroyed()) {
            mainWindow.show();
        }
        showFatalError(
            'Madrasa EMS — page load failed',
            'Could not load:\n' + validatedURL + '\n\n' + errorDescription + ' (' + errorCode + ')'
        );
    });

    mainWindow.webContents.on('render-process-gone', function (event, details) {
        logStartup('render-process-gone reason=' + details.reason);
        showFatalError('Madrasa EMS — renderer crashed', details.reason || 'unknown');
    });

    mainWindow.on('page-title-updated', function (event) {
        event.preventDefault();
    });

    loadMainUrl(startUrl || bundleState.url || config.appUrl);

    mainWindow.webContents.setWindowOpenHandler(handleOAuthWindowOpen);

    mainWindow.webContents.on('will-navigate', function (event, url) {
        if (isOAuthUrl(url)) return;
        if (!isAppUrl(url) && /^https?:\/\//i.test(url)) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    mainWindow.on('closed', function () {
        logStartup('main window closed');
        mainWindow = null;
    });
}

process.on('uncaughtException', function (error) {
    showFatalError('Madrasa EMS — startup error', error && error.message ? error.message : String(error));
});

app.on('web-contents-created', function (event, contents) {
    contents.setWindowOpenHandler(handleOAuthWindowOpen);
    contents.on('did-create-window', function (childWindow) {
        childWindow.once('ready-to-show', function () {
            if (!childWindow.isDestroyed()) childWindow.show();
        });
    });
    setImmediate(function () {
        wireAuthNavigation(contents);
    });
});

app.whenReady().then(function () {
    loadConfig();
    configurePersistentSession();
    logStartup('app ready, version=' + app.getVersion() + ' packaged=' + app.isPackaged + ' userData=' + app.getPath('userData') + ' idbProfile=' + path.join(app.getPath('userData'), 'Partitions', 'persist_madrasa-ems'));
    return prepareBundle().then(function (state) {
        buildMenu();
        registerDevToolsShortcuts();
        createWindow(state.url);
        app.on('activate', function () {
            if (BrowserWindow.getAllWindows().length === 0) {
                prepareBundle().then(function (s) { createWindow(s.url); });
            }
        });
    });
}).catch(function (error) {
    showFatalError('Madrasa EMS — app init failed', error && error.message ? error.message : String(error));
});

app.on('will-quit', function () {
    try { globalShortcut.unregisterAll(); } catch (e) { /* ignore */ }
});

app.on('before-quit', function (event) {
    stopLocalStaticServer();
    if (quitFlushInProgress) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    event.preventDefault();
    quitFlushInProgress = true;
    logStartup('before-quit: flushing local IDB…');
    Promise.race([
        flushRendererLocalDataBeforeQuit(),
        new Promise(function (resolve) { setTimeout(resolve, 7000); })
    ]).then(function (res) {
        logStartup('before-quit flush done: ' + JSON.stringify(res || {}));
    }).finally(function () {
        quitFlushInProgress = false;
        app.exit(0);
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

function desktopInfoPayload() {
    return {
        appName: config.appName,
        appUrl: bundleState.url || config.appUrl,
        remoteUrl: config.appUrl,
        platform: process.platform,
        theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
        version: app.getVersion(),
        logPath: LOG_PATH,
        userDataPath: app.getPath('userData'),
        authPartition: AUTH_PARTITION,
        persistLogin: true,
        bundleMode: bundleState.mode,
        bundleBuiltAt: bundleState.builtAt,
        bundleFileCount: bundleState.fileCount,
        localServerPort: localStaticPort,
        stableLocalPort: readPersistedLocalPort() || config.localServerPort || 17654,
        bootSessionPath: BOOT_SESSION_FILE,
        preferLocalBundle: config.preferLocalBundle !== false,
        offlineOnly: config.offlineOnly !== false,
        isPackaged: app.isPackaged
    };
}

ipcMain.handle('ems-desktop:flush-local-data', function () {
    return flushRendererLocalDataBeforeQuit();
});

ipcMain.handle('ems-desktop:get-info', function () {
    return desktopInfoPayload();
});

ipcMain.handle('ems-desktop:save-boot-session', function (event, snap) {
    try {
        if (!snap || !snap.tenantId) return { ok: false, reason: 'no_tenant' };
        fs.writeFileSync(BOOT_SESSION_FILE, JSON.stringify(snap), 'utf8');
        logStartup('boot session saved tenant=' + snap.tenantId);
        return { ok: true };
    } catch (e) {
        logStartup('boot session save failed: ' + (e && e.message));
        return { ok: false, error: e && e.message };
    }
});

ipcMain.handle('ems-desktop:read-boot-session', function () {
    try {
        if (!fs.existsSync(BOOT_SESSION_FILE)) return null;
        return JSON.parse(fs.readFileSync(BOOT_SESSION_FILE, 'utf8'));
    } catch (e) {
        return null;
    }
});

ipcMain.handle('ems-desktop:switch-bundle', function (event, mode) {
    return switchBundleMode(mode === 'remote' ? 'remote' : 'local');
});

ipcMain.handle('ems-desktop:manual-sync', function () {
    if (!mainWindow) return { ok: false };
    return mainWindow.webContents.executeJavaScript(
        'typeof emsHybridSyncManual==="function"?emsHybridSyncManual().then(function(r){return{ok:true,detail:r}}):Promise.resolve({ok:false})',
        true
    );
});

ipcMain.handle('ems-desktop:reload', function () {
    if (mainWindow) mainWindow.reload();
    return { ok: true };
});

// ---------------------------------------------------------------------------
// Native durable DB (Repository backend). createNativeDb() auto-selects the
// engine: Option B (better-sqlite3, default — scales to 1,000,000+ records) and
// falls back to Option A (fs-JSON) only if the native module is unavailable.
// Both store data under userData (Documents\MadrasaEMS_Data) — a real on-disk
// database file immune to renderer "Clear Site Data". The renderer contract
// (window.emsRepo → emsNativeDb over IPC) is identical for either engine.
// ---------------------------------------------------------------------------
var nativeDb = null;
function getNativeDb() {
    if (!nativeDb) {
        try {
            nativeDb = require('./native-db.js').createNativeDb(app.getPath('userData'));
            logStartup('native-db ready engine=' + nativeDb.engine + ' dir=' + nativeDb.baseDir);
        } catch (e) {
            logStartup('native-db init FAILED: ' + (e && e.message));
            throw e;
        }
    }
    return nativeDb;
}

ipcMain.handle('ems-db:info', function () {
    var db = getNativeDb();
    return { isNative: true, engine: db.engine, baseDir: db.baseDir };
});
ipcMain.handle('ems-db:put', function (e, c, r) { return getNativeDb().put(c, r); });
ipcMain.handle('ems-db:bulkPut', function (e, c, rs) { return getNativeDb().bulkPut(c, rs); });
ipcMain.handle('ems-db:get', function (e, c, id) { return getNativeDb().get(c, id); });
ipcMain.handle('ems-db:remove', function (e, c, id) { return getNativeDb().remove(c, id); });
ipcMain.handle('ems-db:clear', function (e, c) { return getNativeDb().clear(c); });
ipcMain.handle('ems-db:all', function (e, c) { return getNativeDb().all(c); });
ipcMain.handle('ems-db:count', function (e, c, filter, search) { return getNativeDb().count(c, filter, search); });
ipcMain.handle('ems-db:page', function (e, c, opts) { return getNativeDb().page(c, opts); });
