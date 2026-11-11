// ============================================================================
// Clean Notes Joe - Main Process
// Owns the show state (deck, slide, source, settings) and sends it to the operator console and
// the fullscreen output. Same structure as Playback Joe: context isolation, sandboxed pages,
// a preload bridge, and IPC accepted only from the window it belongs to.
// ============================================================================

const { app, BrowserWindow, ipcMain, dialog, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { readPresentation } = require('./pptx');
const { LiveFollower } = require('./live');
const { NetReceiver, DISCOVERY_PORT } = require('./network');
const os = require('os');
const crypto = require('crypto');

// Single instance: a second launch focuses the running console instead. The lock belongs to the settings
// folder, so that is fixed whatever the command line says (--user-data-dir would otherwise allow a second copy).
// CNJ_PROFILE is a test hook for a separate folder.
app.setPath('userData', process.env.CNJ_PROFILE || path.join(app.getPath('appData'), 'clean-notes-joe'));
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.exit(0);

app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});

const APP_ICON = path.join(__dirname, 'icon.png');
let mainWindow = null;
let outputWindow = null;

// ---------------------------------------------------------------------------
// Settings (userData/settings.json)
// ---------------------------------------------------------------------------
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_SETTINGS = {
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif',
    fontSize: 56,          // points at 1080p, used when AUTO-FIT is off
    bold: false,
    uppercase: false,
    color: '#ffffff',
    background: '#000000',
    align: 'left',
    lineSpacing: 1.3,
    paraSpacing: 0.5,      // gap after each paragraph, in lines
    margin: 6,             // side margin, % of width
    centerVertical: false,
    mirror: false,
    autoFit: true,
    fitMin: 36,
    fitMax: 96,
    autoScroll: true,
    scrollWpm: 140,        // reading pace in words per minute; the scroll ends as the last word is reached
    scrollDelay: 3,        // seconds after a slide change before scrolling starts
    showSlideNumber: true,
    showClock: true,
    showTimer: false,
    headerSize: 5,         // header bar (slide number / timer / clock), % of screen height
    headerColor: 'auto',   // 'auto' follows the notes colour, or a #rrggbb
    headerFont: 'notes',   // 'notes' = the notes font (fixed-width digits), 'mono' = monospace
    emptyText: '— NO NOTES —',
    globalKeys: true
};

// Each setting's allowed values, so a hand-edited or old settings file can't break the output
const SETTING_RULES = {
    fontFamily: v => typeof v === 'string' && v.length > 0 && v.length < 300,
    fontSize: v => Number.isFinite(v) && v >= 10 && v <= 300,
    bold: v => typeof v === 'boolean',
    uppercase: v => typeof v === 'boolean',
    color: v => /^#[0-9a-f]{6}$/i.test(v),
    background: v => /^#[0-9a-f]{6}$/i.test(v),
    align: v => ['left', 'center', 'right', 'justify'].includes(v),
    lineSpacing: v => Number.isFinite(v) && v >= 0.9 && v <= 3,
    paraSpacing: v => Number.isFinite(v) && v >= 0 && v <= 3,
    margin: v => Number.isFinite(v) && v >= 0 && v <= 40,
    centerVertical: v => typeof v === 'boolean',
    mirror: v => typeof v === 'boolean',
    autoFit: v => typeof v === 'boolean',
    fitMin: v => Number.isFinite(v) && v >= 10 && v <= 300,
    fitMax: v => Number.isFinite(v) && v >= 10 && v <= 300,
    autoScroll: v => typeof v === 'boolean',
    scrollWpm: v => Number.isFinite(v) && v >= 40 && v <= 400,
    scrollDelay: v => Number.isFinite(v) && v >= 0 && v <= 60,
    showSlideNumber: v => typeof v === 'boolean',
    showClock: v => typeof v === 'boolean',
    showTimer: v => typeof v === 'boolean',
    headerSize: v => Number.isFinite(v) && v >= 3 && v <= 20,
    headerColor: v => v === 'auto' || /^#[0-9a-f]{6}$/i.test(v),
    headerFont: v => ['notes', 'mono'].includes(v),
    emptyText: v => typeof v === 'string' && v.length <= 200,
    globalKeys: v => typeof v === 'boolean'
};

function cleanSettings(changes) {
    const out = {};
    if (!changes || typeof changes !== 'object') return out;
    for (const [k, v] of Object.entries(changes)) {
        if (SETTING_RULES[k] && SETTING_RULES[k](v)) out[k] = v;
    }
    return out;
}

function loadSettingsFile() {
    try {
        const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        return (data && typeof data === 'object') ? data : {};
    } catch (err) {
        return {};
    }
}

let saveTimer = null;
function saveSettingsSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSettingsNow, 400);
}

function saveSettingsNow() {
    saveTimer = null;
    try {
        const tmpPath = settingsPath + '.tmp';
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        const data = {
            uiScale: uiScaleLevel,
            display: settings,
            source: state.source,
            network: netConfig,
            outputOpen: !!outputWindow && !outputWindow.isDestroyed(),
            outputDisplayId: outputDisplayId
        };
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
        fs.renameSync(tmpPath, settingsPath);
    } catch (err) {
        console.error('Failed to save settings:', err);
    }
}

const savedFile = loadSettingsFile();
let settings = { ...DEFAULT_SETTINGS, ...cleanSettings(savedFile.display) };
let outputDisplayId = Number.isFinite(savedFile.outputDisplayId) ? savedFile.outputDisplayId : null;

// Operator interface size (SIZE button), as in Playback Joe. The output window is never scaled.
const UI_SCALES = { 1: 0.85, 2: 1, 3: 1.15 };
const isUiScale = (level) => [1, 2, 3].includes(level);
let uiScaleLevel = isUiScale(savedFile.uiScale) ? savedFile.uiScale : 2;

// The minimum window scales with the interface, so the page always has at least 1100x700 to lay out in
function applyUiScale(level) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const zoom = UI_SCALES[level];
    mainWindow.webContents.setZoomFactor(zoom);
    const bounds = mainWindow.getBounds();
    const { workArea } = screen.getDisplayMatching(bounds);
    const minWidth = Math.min(Math.round(1100 * zoom), workArea.width);
    const minHeight = Math.min(Math.round(700 * zoom), workArea.height);
    mainWindow.setMinimumSize(minWidth, minHeight);
    if (mainWindow.isMaximized() || mainWindow.isFullScreen()) return;
    if (bounds.width < minWidth || bounds.height < minHeight) {
        const width = Math.max(bounds.width, minWidth);
        const height = Math.max(bounds.height, minHeight);
        mainWindow.setBounds({
            x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width)),
            y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height)),
            width,
            height
        });
    }
}

// ---------------------------------------------------------------------------
// Show state
// ---------------------------------------------------------------------------
let deck = { file: null, name: '', slides: [], error: null };
const SOURCES = ['file', 'live', 'network'];
const state = {
    source: savedFile.source === 'network' ? 'network' : savedFile.source === 'live' && LiveFollower.isSupported() ? 'live' : 'file',
    index: 0,
    count: 0,
    title: '',
    notes: '',
    key: '',                       // changes whenever a different slide is shown
    slideStartedAt: Date.now(),
    showStartedAt: Date.now(),
    paused: false,
    live: { status: 'off', message: '', name: '' },
    liveSupported: LiveFollower.isSupported(),
    platform: process.platform
};
let liveNotes = null;              // notes straight from PowerPoint (Windows live mode)
let liveTitle = null;

function send(win, channel, ...args) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function outputInfo() {
    const open = !!outputWindow && !outputWindow.isDestroyed();
    let size = { width: 1920, height: 1080 };
    if (open) {
        const b = outputWindow.getContentBounds();
        size = { width: b.width, height: b.height };
    } else {
        const d = targetDisplay();
        if (d) size = { width: d.bounds.width, height: d.bounds.height };
    }
    return { open, fullscreen: open && outputWindow.isFullScreen(), ...size };
}

function displayList() {
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map((d, i) => ({
        id: d.id,
        label: `${i + 1}: ${d.bounds.width}x${d.bounds.height}${d.id === primary.id ? ' (MAIN)' : ''}`,
        primary: d.id === primary.id
    }));
}

function publicState() {
    return { ...state, output: outputInfo(), displays: displayList(), outputDisplayId, deckName: deck.name, deckFile: deck.file, net: netSnapshot() };
}

function broadcastState() {
    const s = publicState();
    send(mainWindow, 'state', s);
    send(outputWindow, 'state', s);
}

function broadcastSettings() {
    send(mainWindow, 'settings', settings);
    send(outputWindow, 'settings', settings);
}

function sendDeck() {
    send(mainWindow, 'deck', deck);
}

function notifyOperator(message) {
    send(mainWindow, 'log', message);
}

// Works out the slide being shown from the deck, the index and (in live mode) PowerPoint
function refreshCurrent(forceNewSlide = false) {
    const slide = deck.slides[state.index];
    const followsAnother = (state.source === 'live' && state.live.status === 'ok') || state.source === 'network';
    state.count = followsAnother ? state.count : deck.slides.length;
    state.notes = liveNotes !== null ? liveNotes : (slide ? slide.notes : '');
    state.title = liveTitle || (slide ? slide.title : '');
    const key = `${state.source}|${deck.file || deck.name || state.live.name}|${state.index}`;
    if (key !== state.key || forceNewSlide) {
        state.key = key + (forceNewSlide ? '|' + Date.now() : '');
        state.slideStartedAt = Date.now();
    }
    broadcastState();
}

// ---------------------------------------------------------------------------
// Deck loading and watching
// ---------------------------------------------------------------------------
let watchedFile = null;

function watchDeck(file) {
    if (watchedFile === file) return;
    if (watchedFile) fs.unwatchFile(watchedFile);
    watchedFile = file;
    if (!file) return;
    fs.watchFile(file, { interval: 1000 }, (cur, prev) => {
        if (cur.mtimeMs !== prev.mtimeMs && cur.size > 0) {
            // PowerPoint writes the file in steps; give it a moment to finish
            setTimeout(() => loadDeck(file, { keepIndex: true, quiet: true }), 600);
        }
    });
}

function loadDeck(file, { keepIndex = false, quiet = false } = {}) {
    try {
        const { slides } = readPresentation(file);
        const refreshed = deck.file === file; // the same file read again: REFRESH, or saved in PowerPoint
        deck = { file, name: path.basename(file), slides, error: null };
        netConfig.lastLocalFile = file;
        if (!keepIndex) state.index = Math.max(0, slides.findIndex(s => !s.hidden)); // the first slide the show would start on
        state.index = Math.max(0, Math.min(state.index, slides.length - 1));
        watchDeck(file);
        sendDeck();
        refreshCurrent();
        saveSettingsSoon();
        if (refreshed) send(mainWindow, 'deck-refreshed', { at: Date.now() });
        if (refreshed && quiet) notifyOperator(`REFRESHED ${deck.name.toUpperCase()} (SAVED): ${slides.length} SLIDES, ${slides.filter(s => s.notes).length} WITH NOTES`);
        if (!quiet) notifyOperator(`${refreshed ? 'REFRESHED' : 'LOADED'} ${deck.name.toUpperCase()}: ${slides.length} SLIDES, ${slides.filter(s => s.notes).length} WITH NOTES`);
        return true;
    } catch (err) {
        if (!quiet) {
            notifyOperator(`COULD NOT OPEN ${path.basename(file).toUpperCase()}: ${String(err.message || err).toUpperCase()}`);
        }
        return false;
    }
}

// Lets go of the loaded file: stops watching it and forgets it, so it isn't reopened at the next launch
function clearDeck() {
    if (state.source !== 'file' || !deck.file) return;
    const name = deck.name;
    deck = { file: null, name: '', slides: [], error: null };
    netConfig.lastLocalFile = null;
    state.index = 0;
    watchDeck(null);
    sendDeck();
    refreshCurrent();
    saveSettingsSoon();
    notifyOperator(`CLEARED ${name.toUpperCase()}`);
}

function goTo(index) {
    if (state.source !== 'file') return; // PowerPoint drives the slide in live and network mode
    if (!deck.slides.length) return;
    const i = Math.max(0, Math.min(index, deck.slides.length - 1));
    if (i === state.index) return;
    state.index = i;
    refreshCurrent();
}

// NEXT / PREV and the keys step over hidden slides, as PowerPoint's slideshow does (clicking one still shows it)
function step(dir) {
    const slides = deck.slides;
    for (let i = state.index + dir; i >= 0 && i < slides.length; i += dir) {
        if (!slides[i].hidden) return goTo(i);
    }
}

// First / last slide that isn't hidden (or the very first / last if they all are)
function goToEnd(dir) {
    const slides = deck.slides;
    const order = slides.map((s, i) => i);
    if (dir > 0) order.reverse();
    const i = order.find(n => !slides[n].hidden);
    goTo(i !== undefined ? i : (dir > 0 ? slides.length - 1 : 0));
}

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------
const live = new LiveFollower(onLiveUpdate);

function onLiveUpdate(s) {
    if (state.source !== 'live') return;
    if (s.state === 'ok') {
        state.live = { status: 'ok', message: '', name: s.name };
        if (s.file !== deck.file) {
            // PowerPoint switched to another presentation. An unsaved or non-.pptx one has no file to
            // read, so the slide list stays empty (on Windows its notes still come from PowerPoint).
            const readable = s.file && /\.pptx$/i.test(s.file) && fs.existsSync(s.file);
            if (!readable || !loadDeck(s.file, { keepIndex: true, quiet: true })) {
                deck = { file: s.file || null, name: s.name, slides: [], error: null };
                watchDeck(null);
                sendDeck();
            }
        }
        state.index = Math.max(0, s.index - 1);
        state.count = s.count;
        liveNotes = typeof s.notes === 'string' ? s.notes : null;
        liveTitle = typeof s.title === 'string' && s.title ? s.title : null;
        refreshCurrent();
    } else {
        // Report what PowerPoint is doing. With PowerPoint closed, no presentation open, Protected View or
        // PowerPoint out of reach, the old deck goes (as in the Sender); a busy moment keeps the last slide.
        const message = {
            'not-running': 'WAITING FOR POWERPOINT',
            unreachable: "POWERPOINT IS OPEN BUT CAN'T BE REACHED (IS ONE OF THEM RUNNING AS ADMINISTRATOR?)",
            'no-presentation': 'NO PRESENTATION OPEN IN POWERPOINT',
            protected: 'PROTECTED VIEW: CLICK ENABLE EDITING IN POWERPOINT',
            busy: state.live.status === 'ok' ? 'POWERPOINT IS BUSY' : 'WAITING FOR POWERPOINT',
            unsupported: s.message || 'LOCAL NEEDS POWERPOINT ON WINDOWS',
            error: s.message || 'POWERPOINT CONNECTION ERROR'
        }[s.state] || 'WAITING FOR POWERPOINT';
        if (s.state === 'busy' && state.live.status === 'ok') return; // end-of-show black screen etc.
        state.live = { status: s.state, message, name: state.live.name };
        if (s.state === 'error') notifyOperator(message);
        if (['not-running', 'no-presentation', 'protected', 'unreachable'].includes(s.state)) {
            liveNotes = null;
            liveTitle = null;
            state.live.name = '';
            state.index = 0;
            if (deck.file || deck.name || deck.slides.length) emptyDeck();
            refreshCurrent();
        } else {
            broadcastState();
        }
    }
}

function emptyDeck() {
    deck = { file: null, name: '', slides: [], error: null };
    watchDeck(null);
    sendDeck();
}

function setSource(source) {
    if (!SOURCES.includes(source)) return;
    if (source === 'live' && !LiveFollower.isSupported()) return;
    const previous = state.source;
    const leavingFollow = previous !== source && (previous === 'network' || previous === 'live');
    state.source = source;
    liveNotes = null;
    liveTitle = null;
    if (source === 'live') {
        state.live = { status: 'not-running', message: 'WAITING FOR POWERPOINT', name: '' };
        live.start();
    } else {
        live.stop();
        state.live = { status: 'off', message: '', name: '' };
    }
    if (source === 'network') {
        // Only what the paired PC sends is shown: never a deck that was loaded on this PC
        emptyDeck();
        startReceiver();
        applyReceiver();
    } else {
        stopReceiver();
        if (source === 'live') {
            // Only what PowerPoint has open is shown: never the deck last opened in FILE
            if (previous !== 'live') emptyDeck();
            state.index = 0;
        } else if (leavingFollow) {
            // The slide list came from PowerPoint or the other PC; go back to the last deck opened here
            deck = { file: null, name: '', slides: [], error: null };
            if (netConfig.lastLocalFile && fs.existsSync(netConfig.lastLocalFile)) loadDeck(netConfig.lastLocalFile, { quiet: true });
            else sendDeck();
        }
        state.index = Math.max(0, Math.min(state.index, deck.slides.length - 1));
    }
    refreshCurrent();
    saveSettingsSoon();
}

// ---------------------------------------------------------------------------
// Network: show the notes a paired PowerPoint PC sends (it runs Clean Notes Joe Sender)
// ---------------------------------------------------------------------------
const NET_ROLES = ['main', 'backup'];
const savedNet = (savedFile.network && typeof savedFile.network === 'object') ? savedFile.network : {};
const netConfig = {
    machineId: typeof savedNet.machineId === 'string' && savedNet.machineId ? savedNet.machineId : crypto.randomUUID(),
    code: typeof savedNet.code === 'string' ? savedNet.code.slice(0, 32) : '',
    target: cleanTarget(savedNet.target),
    lastLocalFile: typeof savedNet.lastLocalFile === 'string' ? savedNet.lastLocalFile : null
};
// Test hook: a separate discovery port so test runs don't see real senders
const NET_DISCOVERY = Number(process.env.CNJ_DISCOVERY_PORT) || DISCOVERY_PORT;

let receiver = null;
let receiverDeckKey = null; // null = nothing applied yet, so the first update always sets the slide list

function cleanTarget(t) {
    if (!t || typeof t !== 'object') return null;
    const out = {};
    if (typeof t.id === 'string' && /^[\w-]{1,64}$/.test(t.id)) out.id = t.id;
    if (typeof t.name === 'string') out.name = t.name.slice(0, 100);
    if (NET_ROLES.includes(t.role)) out.role = t.role;
    if (typeof t.address === 'string' && /^[A-Za-z0-9.\-:]{1,253}$/.test(t.address)) out.address = t.address;
    if (Number.isInteger(t.port) && t.port > 0 && t.port < 65536) out.port = t.port;
    return out.id || out.address ? out : null;
}

function netSnapshot() {
    return {
        code: netConfig.code,
        receiver: receiver ? receiver.snapshot() : { set: !!netConfig.target, name: netConfig.target ? netConfig.target.name || netConfig.target.address || '' : '', role: netConfig.target ? netConfig.target.role || '' : '', address: netConfig.target ? netConfig.target.address || '' : '', status: 'off', discovered: [] }
    };
}

function startReceiver() {
    if (receiver) return;
    receiver = new NetReceiver({ id: netConfig.machineId, name: os.hostname().toUpperCase().slice(0, 40), code: netConfig.code, target: netConfig.target, discoveryPort: NET_DISCOVERY });
    receiver.on('change', applyReceiver);
    receiver.on('target', t => { netConfig.target = cleanTarget(t); saveSettingsSoon(); });
    let lastStatus = null;
    receiver.on('change', () => {
        const st = receiver && receiver.status;
        if (st === lastStatus) return;
        const who = receiver.snapshot().name || 'THE PAIRED PC';
        if (st === 'lost') notifyOperator(`CONNECTION TO ${who.toUpperCase()} LOST. SHOWING THE LAST NOTES AND RECONNECTING.`);
        else if (st === 'connected' && lastStatus === 'lost') notifyOperator(`RECONNECTED TO ${who.toUpperCase()}.`);
        else if (st === 'bad-code') notifyOperator(`${who.toUpperCase()} REFUSED THE CONNECTION: THE SHOW CODES DON'T MATCH.`);
        lastStatus = st;
    });
    receiverDeckKey = null;
    receiver.start();
}

function stopReceiver() {
    if (!receiver) return;
    receiver.stop();
    receiver = null;
}

// Show what the paired PC sends
function applyReceiver() {
    if (state.source !== 'network' || !receiver) { broadcastState(); return; }
    const d = receiver.deck;
    const key = d ? d.name + '|' + d.hash : '';
    if (key !== receiverDeckKey) {
        receiverDeckKey = key;
        deck = { file: null, name: d ? d.name : '', slides: d ? d.slides : [], error: null };
        watchDeck(null);
        sendDeck();
    }
    const l = receiver.live;
    if (l) {
        state.index = l.index;
        state.count = l.count;
        liveNotes = l.notes;
        liveTitle = l.title || null;
    } else {
        // Nothing received yet: show no notes (an empty string, so nothing falls back to a local deck)
        state.index = 0;
        state.count = 0;
        liveNotes = '';
        liveTitle = null;
    }
    refreshCurrent();
}

function setNetwork(changes) {
    if (!changes || typeof changes !== 'object') return;
    if (typeof changes.code === 'string') netConfig.code = changes.code.replace(/[^\w-]/g, '').slice(0, 32);
    if (receiver) receiver.setCode(netConfig.code);
    saveSettingsSoon();
    broadcastState();
}

function pairWith(target) {
    netConfig.target = cleanTarget(target);
    if (receiver) receiver.setTarget(netConfig.target);
    saveSettingsSoon();
    broadcastState();
}

// ---------------------------------------------------------------------------
// Output window placement (same rules as Playback Joe, plus a chosen display)
// ---------------------------------------------------------------------------
function targetDisplay() {
    const displays = screen.getAllDisplays();
    const chosen = displays.find(d => d.id === outputDisplayId);
    if (chosen) return chosen;
    const primary = screen.getPrimaryDisplay();
    return displays.find(d => d.id !== primary.id) || primary;
}

// Dual display (or a chosen display that isn't the console's): fullscreen there.
// Single display: a 16:9 window in the top-right corner, so it doesn't cover the console.
function getOutputLayout() {
    const display = targetDisplay();
    const primary = screen.getPrimaryDisplay();
    const single = screen.getAllDisplays().length === 1;
    if (!single && !(display.id === primary.id && outputDisplayId === null)) {
        return { fullscreen: true, display, bounds: { ...display.bounds } };
    }
    const workArea = display.workArea;
    const width = Math.min(854, workArea.width);
    const height = Math.round(width * 9 / 16);
    return { fullscreen: false, display, bounds: { x: workArea.x + workArea.width - width, y: workArea.y, width, height } };
}

function moveOutputTo(win, layout) {
    const apply = () => {
        if (win.isDestroyed()) return;
        win.setBounds(layout.bounds);
        if (layout.fullscreen) win.setFullScreen(true);
        broadcastState();
    };
    if (win.isFullScreen()) {
        win.once('leave-full-screen', () => setTimeout(apply, 250));
        win.setFullScreen(false);
    } else {
        apply();
    }
}

function placeOutput() {
    if (outputWindow && !outputWindow.isDestroyed()) moveOutputTo(outputWindow, getOutputLayout());
}

let displayChangeTimer = null;
function watchDisplays() {
    const onChange = () => {
        if (displayChangeTimer) clearTimeout(displayChangeTimer);
        displayChangeTimer = setTimeout(() => {
            displayChangeTimer = null;
            const win = outputWindow;
            if (win && !win.isDestroyed()) {
                const layout = getOutputLayout();
                const current = screen.getDisplayMatching(win.getBounds());
                if (!(current.id === layout.display.id && win.isFullScreen() === layout.fullscreen)) {
                    notifyOperator(layout.fullscreen ? 'DISPLAY CONNECTED. OUTPUT MOVED TO IT IN FULLSCREEN.' : 'OUTPUT DISPLAY DISCONNECTED. OUTPUT MOVED TO A WINDOW ON THIS SCREEN.');
                    moveOutputTo(win, layout);
                }
            }
            broadcastState();
        }, 1000);
    };
    screen.on('display-added', onChange);
    screen.on('display-removed', onChange);
    screen.on('display-metrics-changed', onChange);
}

let outputRestarts = [];
function createOutputWindow() {
    const layout = getOutputLayout();
    const win = new BrowserWindow({
        title: 'CLEAN NOTES JOE ' + app.getVersion() + ' - OUTPUT',
        frame: false,
        autoHideMenuBar: true,
        backgroundColor: settings.background,
        icon: APP_ICON,
        fullscreen: layout.fullscreen,
        ...layout.bounds,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false, // keep auto-scroll smooth when the output isn't focused
            preload: path.join(__dirname, 'preload.js')
        }
    });
    outputWindow = win;
    win.loadFile(path.join(__dirname, 'output.html'));

    const report = () => broadcastState();
    win.on('enter-full-screen', report);
    win.on('leave-full-screen', () => setTimeout(report, 150));
    win.on('resized', report);

    win.webContents.on('did-finish-load', () => {
        send(win, 'settings', settings);
        broadcastState();
    });

    // If the output page crashes it is replaced (at most 3 times a minute)
    win.webContents.on('render-process-gone', (event, details) => {
        if (details.reason === 'clean-exit' || win !== outputWindow) return;
        const now = Date.now();
        outputRestarts = outputRestarts.filter(t => now - t < 60000);
        outputWindow = null;
        if (!win.isDestroyed()) win.destroy();
        if (outputRestarts.length >= 3) {
            notifyOperator('OUTPUT WINDOW CRASHED AGAIN. PRESS OUTPUT TO REOPEN IT.');
            broadcastState();
            return;
        }
        outputRestarts.push(now);
        notifyOperator('OUTPUT WINDOW CRASHED AND HAS BEEN RESTARTED.');
        setImmediate(() => { if (!outputWindow) createOutputWindow(); });
    });

    win.on('closed', () => {
        if (outputWindow === win) outputWindow = null;
        broadcastState();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
    });
}

function toggleOutput() {
    if (outputWindow && !outputWindow.isDestroyed()) {
        const w = outputWindow;
        outputWindow = null;
        w.close();
    } else {
        createOutputWindow();
    }
    saveSettingsSoon();
    broadcastState();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
}

// ---------------------------------------------------------------------------
// Actions shared by the console's buttons, its keys and the global shortcuts
// ---------------------------------------------------------------------------
// Scrolling is run by the output window when it is open, otherwise by the console's preview
function scrollCommand(cmd) {
    if (outputWindow && !outputWindow.isDestroyed()) send(outputWindow, 'scroll-command', cmd);
    else send(mainWindow, 'scroll-command', cmd);
}

function setPaused(paused) {
    state.paused = paused;
    broadcastState();
}

function bumpSize(delta) {
    const changes = settings.autoFit
        ? { fitMax: Math.min(300, Math.max(10, settings.fitMax + delta)), fitMin: Math.min(300, Math.max(10, settings.fitMin + delta)) }
        : { fontSize: Math.min(300, Math.max(10, settings.fontSize + delta)) };
    applySettings(changes);
}

function applySettings(changes) {
    const clean = cleanSettings(changes);
    if (!Object.keys(clean).length) return;
    const hadGlobalKeys = settings.globalKeys;
    settings = { ...settings, ...clean };
    if (settings.fitMin > settings.fitMax) {
        if ('fitMin' in clean) settings.fitMax = settings.fitMin; else settings.fitMin = settings.fitMax;
    }
    if (settings.globalKeys !== hadGlobalKeys) registerGlobalKeys();
    if (outputWindow && !outputWindow.isDestroyed() && 'background' in clean) outputWindow.setBackgroundColor(settings.background);
    broadcastSettings();
    saveSettingsSoon();
}

function runAction(action) {
    switch (action) {
        case 'next': step(1); break;
        case 'prev': step(-1); break;
        case 'first': goToEnd(-1); break;
        case 'last': goToEnd(1); break;
        case 'scroll-down': scrollCommand({ type: 'by', value: 90 }); break;
        case 'scroll-up': scrollCommand({ type: 'by', value: -90 }); break;
        case 'page-down': scrollCommand({ type: 'page', value: 1 }); break;
        case 'page-up': scrollCommand({ type: 'page', value: -1 }); break;
        case 'top': scrollCommand({ type: 'top' }); break;
        case 'toggle-pause': setPaused(!state.paused); break;
        case 'bigger': bumpSize(4); break;
        case 'smaller': bumpSize(-4); break;
        case 'toggle-output': toggleOutput(); break;
        case 'reset-timer': state.slideStartedAt = Date.now(); broadcastState(); break;
    }
}

// Global shortcuts work while PowerPoint (or anything else) has focus. Ctrl+Alt (Ctrl+Option on a
// Mac) so they never take the plain keys a clicker or PowerPoint uses.
const GLOBAL_KEYS = {
    'CommandOrControl+Alt+Right': 'next',
    'CommandOrControl+Alt+Left': 'prev',
    'CommandOrControl+Alt+Down': 'scroll-down',
    'CommandOrControl+Alt+Up': 'scroll-up',
    'CommandOrControl+Alt+Space': 'toggle-pause',
    'CommandOrControl+Alt+Home': 'top',
    'CommandOrControl+Alt+=': 'bigger',
    'CommandOrControl+Alt+-': 'smaller'
};

function registerGlobalKeys() {
    globalShortcut.unregisterAll();
    if (!settings.globalKeys) return;
    const failed = [];
    for (const [accel, action] of Object.entries(GLOBAL_KEYS)) {
        try {
            if (!globalShortcut.register(accel, () => runAction(action))) failed.push(accel);
        } catch (err) {
            failed.push(accel);
        }
    }
    if (failed.length) notifyOperator(`GLOBAL KEYS IN USE BY ANOTHER APP: ${failed.join(', ').toUpperCase()}`);
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
function createWindow() {
    const primary = screen.getPrimaryDisplay();
    if (savedFile.outputOpen !== false) createOutputWindow();
    watchDisplays();

    // Created hidden at its final size and shown once the first frame is painted: showing it at the default
    // size and then resizing left a white box in the window for a moment at launch
    const workArea = primary.workArea;
    mainWindow = new BrowserWindow({
        title: 'CLEAN NOTES JOE ' + app.getVersion() + ' - OPERATOR',
        icon: APP_ICON,
        autoHideMenuBar: true,
        backgroundColor: '#121212',
        show: false,
        x: workArea.x,
        y: workArea.y,
        width: Math.min(1280, workArea.width),
        height: Math.min(900, workArea.height),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            zoomFactor: UI_SCALES[uiScaleLevel],
            preload: path.join(__dirname, 'preload.js')
        }
    });
    // Shown see-through first: Windows draws a window white until its first frame arrives
    mainWindow.once('ready-to-show', () => {
        mainWindow.setOpacity(0);
        mainWindow.show();
        setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setOpacity(1); }, 120);
    });
    applyUiScale(uiScaleLevel);
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
    // Chromium can bring back an older zoom on load, so the saved size is set again here
    mainWindow.webContents.on('did-finish-load', () => mainWindow.webContents.setZoomFactor(UI_SCALES[uiScaleLevel]));

    mainWindow.on('closed', () => {
        mainWindow = null;
        if (outputWindow && !outputWindow.isDestroyed()) outputWindow.close();
        app.quit();
    });

    // Starts with nothing loaded; only a deck named on the command line is opened (in FILE)
    const argFile = process.argv.slice(app.isPackaged ? 1 : 2).find(a => /\.pptx$/i.test(a) && fs.existsSync(a));
    mainWindow.webContents.once('did-finish-load', () => {
        if (argFile) {
            state.source = 'file';
            loadDeck(path.resolve(argFile));
        }
        if (state.source !== 'file') setSource(state.source);
        registerGlobalKeys();
    });
}

// The bundled test deck, where the LOAD dialog starts when there's no last deck. Packaged builds ship it as an
// extraResource; the portable .exe unpacks to a new temp folder on every launch, so it is copied to userData
// first and offered from there (as Playback Joe does with its starter clips).
const STARTER_DECK = 'Clean Notes Joe Test Deck.pptx';
function starterDeck() {
    const bundled = app.isPackaged
        ? path.join(process.resourcesPath, 'test_decks', STARTER_DECK)
        : path.join(__dirname, 'test_decks', STARTER_DECK);
    if (!fs.existsSync(bundled)) return null;
    if (!app.isPackaged) return bundled;
    try {
        const stable = path.join(app.getPath('userData'), 'test_decks', STARTER_DECK);
        fs.mkdirSync(path.dirname(stable), { recursive: true });
        if (!fs.existsSync(stable) || fs.statSync(stable).size !== fs.statSync(bundled).size) fs.copyFileSync(bundled, stable);
        return stable;
    } catch (err) {
        console.error('Failed to copy the test deck:', err);
        return bundled;
    }
}

if (gotSingleInstanceLock) app.whenReady().then(createWindow);

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    live.stop();
    if (receiver) receiver.stop();
    if (saveTimer) { clearTimeout(saveTimer); saveSettingsNow(); }
});

app.on('window-all-closed', () => app.quit());

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function fromOperator(event) {
    return !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
}

function fromOutput(event) {
    return !!outputWindow && !outputWindow.isDestroyed() && event.sender === outputWindow.webContents;
}

ipcMain.handle('get-initial', (event) => {
    if (!fromOperator(event) && !fromOutput(event)) return null;
    return { version: app.getVersion(), uiScale: uiScaleLevel, state: publicState(), settings, deck: fromOperator(event) ? deck : null, defaults: DEFAULT_SETTINGS };
});

ipcMain.handle('open-deck', async (event) => {
    if (!fromOperator(event)) return false;
    // Starts in the folder of the last deck, or else beside the test deck
    const last = netConfig.lastLocalFile && fs.existsSync(netConfig.lastLocalFile) ? netConfig.lastLocalFile : starterDeck();
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Open PowerPoint deck',
        defaultPath: last ? path.dirname(last) : undefined,
        properties: ['openFile'],
        filters: [{ name: 'PowerPoint', extensions: ['pptx'] }]
    });
    if (result.canceled || !result.filePaths.length) return false;
    if (state.source !== 'file') setSource('file');
    return loadDeck(result.filePaths[0]);
});

ipcMain.on('set-ui-scale', (event, level) => {
    if (!fromOperator(event) || !isUiScale(level)) return;
    uiScaleLevel = level;
    applyUiScale(level);
    saveSettingsSoon();
});

ipcMain.on('reload-deck', (event) => {
    if (fromOperator(event) && deck.file) loadDeck(deck.file, { keepIndex: true });
});

ipcMain.on('clear-deck', (event) => {
    if (fromOperator(event)) clearDeck();
});

ipcMain.on('set-source', (event, source) => {
    if (fromOperator(event) && SOURCES.includes(source)) setSource(source);
});

ipcMain.on('set-network', (event, changes) => {
    if (fromOperator(event)) setNetwork(changes);
});

ipcMain.on('pair', (event, target) => {
    if (fromOperator(event)) pairWith(target);
});

ipcMain.on('go-to', (event, index) => {
    if (fromOperator(event) && Number.isInteger(index)) goTo(index);
});

ipcMain.on('action', (event, action) => {
    if ((fromOperator(event) || fromOutput(event)) && typeof action === 'string') runAction(action);
});

ipcMain.on('set-paused', (event, paused) => {
    if (fromOperator(event)) setPaused(!!paused);
});

ipcMain.on('scroll-command', (event, cmd) => {
    if (!fromOperator(event) || !cmd || typeof cmd !== 'object') return;
    if (cmd.type === 'to' && Number.isFinite(cmd.value)) scrollCommand({ type: 'to', value: Math.min(1, Math.max(0, cmd.value)) });
    else if (cmd.type === 'top') scrollCommand({ type: 'top' });
});

ipcMain.on('set-settings', (event, changes) => {
    if (fromOperator(event)) applySettings(changes);
});

ipcMain.on('reset-settings', (event) => {
    if (!fromOperator(event)) return;
    settings = { ...DEFAULT_SETTINGS, globalKeys: settings.globalKeys };
    broadcastSettings();
    saveSettingsSoon();
});

ipcMain.on('toggle-output', (event) => {
    if (fromOperator(event)) toggleOutput();
});

ipcMain.on('toggle-fullscreen', (event) => {
    if (!fromOperator(event) || !outputWindow || outputWindow.isDestroyed()) return;
    outputWindow.setFullScreen(!outputWindow.isFullScreen());
    mainWindow.focus();
});

ipcMain.on('set-output-display', (event, id) => {
    if (!fromOperator(event)) return;
    outputDisplayId = screen.getAllDisplays().some(d => d.id === id) ? id : null;
    saveSettingsSoon();
    placeOutput();
    broadcastState();
});

// The output reports its scroll position so the console's preview and scroll bar can follow it
ipcMain.on('scroll-status', (event, status) => {
    if (!fromOutput(event) || !status) return;
    send(mainWindow, 'scroll-status', {
        offset: Number(status.offset) || 0,
        max: Number(status.max) || 0,
        fontPt: Number(status.fontPt) || 0,
        phase: String(status.phase || '')
    });
});
