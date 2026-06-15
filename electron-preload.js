// Préchargement Electron : signale au front qu'on est dans l'app de bureau
// (→ le front utilise la dictée vocale hors-ligne Vosk au lieu du moteur Google indisponible)
const { contextBridge, ipcRenderer } = require('electron');
try {
  contextBridge.exposeInMainWorld('TIMEFLOW_DESKTOP', {
    electron: true,
    platform: process.platform,
    autostart: {
      get: () => ipcRenderer.invoke('autostart:get'),
      set: (enabled) => ipcRenderer.send('autostart:set', !!enabled)
    }
  });
} catch (e) {}
