// ============================================================================
// Clean Notes Joe - Preload Script (security bridge between the pages and the main process)
// ============================================================================

const { contextBridge, ipcRenderer } = require('electron');

function listen(channel) {
    return (callback) => {
        const handler = (event, ...args) => callback(...args);
        ipcRenderer.on(channel, handler);
        return () => ipcRenderer.removeListener(channel, handler);
    };
}

contextBridge.exposeInMainWorld('notesAPI', {
    getInitial: () => ipcRenderer.invoke('get-initial'),
    setUiScale: (level) => ipcRenderer.send('set-ui-scale', level),

    // Console commands
    openDeck: () => ipcRenderer.invoke('open-deck'),
    reloadDeck: () => ipcRenderer.send('reload-deck'),
    clearDeck: () => ipcRenderer.send('clear-deck'),
    setSource: (source) => ipcRenderer.send('set-source', source),
    setNetwork: (changes) => ipcRenderer.send('set-network', changes),
    pair: (target) => ipcRenderer.send('pair', target),
    goTo: (index) => ipcRenderer.send('go-to', index),
    action: (name) => ipcRenderer.send('action', name),
    setPaused: (paused) => ipcRenderer.send('set-paused', paused),
    scrollCommand: (cmd) => ipcRenderer.send('scroll-command', cmd),
    setSettings: (changes) => ipcRenderer.send('set-settings', changes),
    resetSettings: () => ipcRenderer.send('reset-settings'),
    toggleOutput: () => ipcRenderer.send('toggle-output'),
    toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
    setOutputDisplay: (id) => ipcRenderer.send('set-output-display', id),

    // Output reports
    sendScrollStatus: (status) => ipcRenderer.send('scroll-status', status),

    // Events from the main process
    onState: listen('state'),
    onSettings: listen('settings'),
    onDeck: listen('deck'),
    onDeckRefreshed: listen('deck-refreshed'),
    onLog: listen('log'),
    onScrollCommand: listen('scroll-command'),
    onScrollStatus: listen('scroll-status')
});
