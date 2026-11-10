// ============================================================================
// Clean Notes Joe Sender - Main Process
// Runs on a PowerPoint PC: follows PowerPoint and sends the current slide and notes to the notes PCs
// paired with it. Starts sending as soon as it opens. Shares live.js (PowerPoint), network.js (sync)
// and pptx.js (slide list) with Clean Notes Joe, so the two can't drift apart.
// ============================================================================

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { readPresentation } = require('./pptx');
const { LiveFollower } = require('./live');
const { NetSender, deckHash, DEFAULT_PORT, DISCOVERY_PORT } = require('./network');
// Read here: when run straight from its script, app.getVersion() doesn't find package.json
const VERSION = require('./package.json').version;

// Its own settings folder and single-instance lock, separate from Clean Notes Joe's (also when run
// from the source folder with `npm run start:sender`, where both would otherwise share one)
app.setName('Clean Notes Joe Sender');
if (!app.commandLine.hasSwitch('user-data-dir')) {
    app.setPath('userData', path.join(app.getPath('appData'), 'clean-notes-joe-sender'));
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.exit(0);

let win = null;
// Opening it again while it's in the tray brings the window back
app.on('second-instance', () => showWindow());

// ---------------------------------------------------------------------------
// Settings (userData/settings.json)
// ---------------------------------------------------------------------------
const ROLES = ['main', 'backup'];
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const defaultName = () => os.hostname().toUpperCase().replace(/[^\w .\-]/g, '').slice(0, 40) || 'POWERPOINT PC';

function loadConfig() {
    let d = {};
    try { d = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) || {}; } catch (e) { /* first launch */ }
    return {
        machineId: typeof d.machineId === 'string' && d.machineId ? d.machineId : crypto.randomUUID(),
        name: typeof d.name === 'string' && d.name ? d.name.slice(0, 40) : defaultName(),
        role: ROLES.includes(d.role) ? d.role : 'main',
        code: typeof d.code === 'string' ? d.code.slice(0, 32) : ''
    };
}

const config = loadConfig();

function saveConfig() {
    try {
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath + '.tmp', JSON.stringify(config, null, 2), 'utf-8');
        fs.renameSync(settingsPath + '.tmp', settingsPath);
    } catch (err) {
        console.error('Failed to save settings:', err);
    }
}
saveConfig(); // keeps the machine id stable from the first launch

// ---------------------------------------------------------------------------
// PowerPoint -> what gets sent
// ---------------------------------------------------------------------------
const ppt = {
    status: 'not-running',   // ok | not-running | no-presentation | busy | error | unsupported
    message: 'WAITING FOR POWERPOINT',
    name: '', file: null, index: 0, count: 0, title: '', notes: ''
};
let deck = { file: null, name: '', slides: [] };
let watchedFile = null;

function loadDeck(file) {
    try {
        deck = { file, name: path.basename(file), slides: readPresentation(file).slides };
    } catch (err) {
        deck = { file, name: path.basename(file), slides: [] };
    }
    if (watchedFile !== file) {
        if (watchedFile) fs.unwatchFile(watchedFile);
        watchedFile = file;
        // Saved in PowerPoint: re-read so the notes PCs' slide lists stay current
        fs.watchFile(file, { interval: 1000 }, (cur, prev) => {
            if (cur.mtimeMs !== prev.mtimeMs && cur.size > 0) setTimeout(() => { loadDeck(file); push(); }, 600);
        });
    }
}

function clearDeck(name) {
    if (watchedFile) fs.unwatchFile(watchedFile);
    watchedFile = null;
    deck = { file: null, name: name || '', slides: [] };
}

const MESSAGES = {
    'not-running': 'WAITING FOR POWERPOINT',
    unreachable: "CAN'T REACH POWERPOINT",
    'no-presentation': 'NO PRESENTATION OPEN IN POWERPOINT',
    busy: 'POWERPOINT IS BUSY',
    unsupported: 'NEEDS POWERPOINT ON WINDOWS',
    error: 'POWERPOINT ERROR'
};
// What to do about it, shown in the big area under the bar
const DETAILS = {
    'not-running': 'OPEN YOUR PRESENTATION IN POWERPOINT',
    unreachable: "POWERPOINT IS OPEN BUT THIS APP CAN'T REACH IT. THIS HAPPENS WHEN ONE OF THEM RUNS AS ADMINISTRATOR AND THE OTHER DOESN'T: START BOTH NORMALLY (OR BOTH AS ADMINISTRATOR).",
    'no-presentation': 'OPEN YOUR PRESENTATION IN POWERPOINT',
    busy: 'CLOSE ANY DIALOG OPEN IN POWERPOINT',
    unsupported: 'CLEAN NOTES JOE SENDER NEEDS MICROSOFT POWERPOINT ON WINDOWS'
};

function onPowerPoint(s) {
    if (s.state === 'ok') {
        if (s.file !== deck.file) {
            const readable = s.file && /\.pptx$/i.test(s.file) && fs.existsSync(s.file);
            if (readable) loadDeck(s.file); else clearDeck(s.name);
        }
        const slide = deck.slides[s.index - 1];
        Object.assign(ppt, {
            status: 'ok', message: '', name: s.name, file: s.file || null,
            index: Math.max(0, s.index - 1), count: s.count,
            // Windows gives the notes and title straight from PowerPoint (unsaved edits included)
            title: s.title || (slide ? slide.title : ''),
            notes: typeof s.notes === 'string' ? s.notes : (slide ? slide.notes : '')
        });
    } else {
        // End-of-show black screen or a dialog open: keep sending the last slide
        if (s.state === 'busy' && ppt.status === 'ok') return;
        ppt.status = s.state;
        ppt.message = MESSAGES[s.state] || 'WAITING FOR POWERPOINT';
        ppt.detail = s.message || DETAILS[s.state] || '';
    }
    push();
}

// Test hook: CNJ_FAKE_POWERPOINT=<deck.pptx> pretends PowerPoint shows that deck; fakeGo(n) changes slide
function createFollower() {
    const fakeFile = process.env.CNJ_FAKE_POWERPOINT;
    if (!fakeFile) return new LiveFollower(onPowerPoint);
    let index = 1;
    const emit = () => {
        const slides = readPresentation(fakeFile).slides;
        index = Math.max(1, Math.min(index, slides.length));
        onPowerPoint({ state: 'ok', file: path.resolve(fakeFile), name: path.basename(fakeFile), index, count: slides.length });
    };
    global.fakeGo = (n) => { index = n; emit(); };
    global.fakeQuit = () => onPowerPoint({ state: 'not-running' });
    global.fakeState = (st) => onPowerPoint(st);
    return { start: () => setTimeout(emit, 300), stop: () => {} };
}

const follower = createFollower();

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------
const sender = new NetSender({
    id: config.machineId, name: config.name, role: config.role, code: config.code,
    port: Number(process.env.CNJ_PORT) || DEFAULT_PORT,
    discoveryPort: Number(process.env.CNJ_DISCOVERY_PORT) || DISCOVERY_PORT
});
sender.on('change', () => broadcast());

function push() {
    sender.setDeck({ name: deck.name, slides: deck.slides, hash: deckHash(deck.slides) });
    sender.setLive({
        // The notes PCs know these states; anything else is reported as an error
        status: ['ok', 'not-running', 'no-presentation', 'busy'].includes(ppt.status) ? ppt.status : (ppt.status === 'unreachable' ? 'not-running' : 'error'),
        name: ppt.name, index: ppt.index, count: ppt.count, title: ppt.title, notes: ppt.notes
    });
    broadcast();
}

function publicState() {
    return {
        version: VERSION,
        config: { name: config.name, role: config.role, code: config.code },
        ppt: { ...ppt, deckName: deck.name, slides: deck.slides.length },
        net: sender.snapshot()
    };
}

function broadcast() {
    if (win && !win.isDestroyed()) win.webContents.send('state', publicState());
    updateTray();
}

// ---------------------------------------------------------------------------
// System tray: minimizing hides the window to the tray and the Sender keeps sending
// ---------------------------------------------------------------------------
let tray = null;
let quitting = false;

function statusLine() {
    const n = sender.snapshot();
    if (n.error) return 'NOT SENDING: ' + n.error;
    const count = n.clients.length;
    const pptText = ppt.status === 'ok' ? `SLIDE ${ppt.index + 1} / ${ppt.count}` : ppt.message;
    return (count ? `SENDING TO ${count}` : 'READY, NO NOTES PCS CONNECTED') + ' · ' + pptText;
}

function showWindow() {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}

function quitSender() {
    quitting = true;
    app.quit();
}

function createTray() {
    if (tray) return;
    try {
        const image = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 });
        tray = new Tray(image);
        tray.on('click', showWindow);
        tray.on('double-click', showWindow);
        updateTray();
    } catch (err) {
        console.error('No system tray:', err);
        tray = null;
    }
}

let lastTrayText = '';
function updateTray() {
    if (!tray) return;
    const text = `CLEAN NOTES JOE SENDER · ${config.name} (${config.role === 'main' ? 'MAIN' : 'BACKUP'})\n${statusLine()}`;
    if (text === lastTrayText) return;
    lastTrayText = text;
    tray.setToolTip(text.slice(0, 127)); // Windows limits tray tooltips to 127 characters
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: statusLine(), enabled: false },
        { type: 'separator' },
        { label: 'Show Clean Notes Joe Sender', click: showWindow },
        { label: 'Quit (stops sending)', click: quitSender }
    ]));
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
    win = new BrowserWindow({
        title: 'CLEAN NOTES JOE SENDER ' + VERSION,
        icon: path.join(__dirname, 'icon.png'),
        autoHideMenuBar: true,
        backgroundColor: '#121212',
        // Started compact, then fitted exactly to the content by the page (fit-window)
        width: 480,
        height: 600,
        useContentSize: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false,
            preload: path.join(__dirname, 'sender-preload.js')
        }
    });
    const workArea = screen.getPrimaryDisplay().workArea;
    win.setPosition(workArea.x + 40, workArea.y + 40);
    win.loadFile(path.join(__dirname, 'sender.html'));
    // Minimize: hide to the tray (where there is one), so the window can't be closed by accident from the taskbar
    win.on('minimize', (event) => {
        if (!tray) return;
        event.preventDefault();
        win.hide();
    });
    // The X asks first: closing stops the notes PCs getting notes
    win.on('close', (event) => {
        if (quitting) return;
        event.preventDefault();
        const choice = dialog.showMessageBoxSync(win, {
            type: 'warning',
            title: 'Clean Notes Joe Sender',
            message: 'Stop sending notes?',
            detail: 'Quitting disconnects every notes PC paired with this PC. To keep sending, minimize to the tray instead.',
            buttons: tray ? ['Minimize to tray', 'Quit sender', 'Cancel'] : ['Minimize', 'Quit sender', 'Cancel'],
            defaultId: 0,
            cancelId: 2,
            noLink: true
        });
        if (choice === 0) { if (tray) win.hide(); else win.minimize(); }
        else if (choice === 1) quitSender();
    });
    win.on('closed', () => { win = null; quitSender(); });
}

if (gotSingleInstanceLock) {
    app.whenReady().then(() => {
        createWindow();
        createTray();
        sender.start();
        follower.start();
        push();
    });
}

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
    if (tray) { tray.destroy(); tray = null; }
    follower.stop();
    sender.stop();
});
app.on('window-all-closed', () => app.quit());

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
const fromWindow = (event) => !!win && !win.isDestroyed() && event.sender === win.webContents;

ipcMain.handle('get-initial', (event) => (fromWindow(event) ? publicState() : null));

ipcMain.on('fit-window', (event, width, height) => {
    if (!fromWindow(event) || !Number.isFinite(width) || !Number.isFinite(height)) return;
    const w = Math.round(Math.min(Math.max(width, 400), 1000));
    const h = Math.round(Math.min(Math.max(height, 400), 1200));
    win.setContentSize(w, h);
    // The minimum is the fitted size (setMinimumSize counts the window frame too)
    const [outerW, outerH] = win.getSize();
    const [innerW, innerH] = win.getContentSize();
    win.setMinimumSize(w + outerW - innerW, h + outerH - innerH);
});

ipcMain.on('set-config', (event, changes) => {
    if (!fromWindow(event) || !changes || typeof changes !== 'object') return;
    if (typeof changes.name === 'string') config.name = changes.name.replace(/[^\w .\-]/g, '').trim().toUpperCase().slice(0, 40) || defaultName();
    if (ROLES.includes(changes.role)) config.role = changes.role;
    if (typeof changes.code === 'string') config.code = changes.code.replace(/[^\w-]/g, '').slice(0, 32);
    sender.configure({ name: config.name, role: config.role, code: config.code });
    saveConfig();
    broadcast();
});
