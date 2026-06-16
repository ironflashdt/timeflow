// Préchargement Electron : signale au front qu'on est dans l'app de bureau
// (→ le front utilise la dictée vocale hors-ligne Vosk au lieu du moteur Google indisponible)
const { contextBridge, ipcRenderer } = require('electron');
let _navCb = null;
ipcRenderer.on('tf:navigate', (_e, view) => { try { if (_navCb) _navCb(String(view || '')); } catch (e) {} });
try {
  contextBridge.exposeInMainWorld('TIMEFLOW_DESKTOP', {
    electron: true,
    platform: process.platform,
    autostart: {
      get: () => ipcRenderer.invoke('autostart:get'),
      set: (enabled) => ipcRenderer.send('autostart:set', !!enabled)
    },
    onNavigate: (cb) => { _navCb = cb; }            // le popup demande à ouvrir une vue → on navigue
  });
} catch (e) {}
