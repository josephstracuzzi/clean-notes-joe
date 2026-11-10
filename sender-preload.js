// ============================================================================
// Clean Notes Joe Sender - Preload Script (security bridge)
// ============================================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('senderAPI', {
    getInitial: () => ipcRenderer.invoke('get-initial'),
    setConfig: (changes) => ipcRenderer.send('set-config', changes),
    onState: (callback) => {
        const handler = (event, state) => callback(state);
        ipcRenderer.on('state', handler);
        return () => ipcRenderer.removeListener('state', handler);
    }
});
