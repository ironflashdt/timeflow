// Préchargement du WIDGET COMPAGNON (fenêtre flottante always-on-top)
const { contextBridge, ipcRenderer } = require('electron');
try {
  contextBridge.exposeInMainWorld('TF_COMPANION', {
    setExpanded: (b) => ipcRenderer.send('companion:expand', !!b),
    openMain:    (view) => ipcRenderer.send('companion:openMain', view),
    drag:        (dx, dy) => ipcRenderer.send('companion:drag', dx, dy),
    dragEnd:     () => ipcRenderer.send('companion:dragEnd'),
    onShape:     (cb) => ipcRenderer.on('companion:shape', (_e, d) => { try { cb(d); } catch (_) {} })
  });
} catch (e) {}
