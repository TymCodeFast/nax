const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('suggestui', {
  onRender: (cb) => ipcRenderer.on('suggest-render', (_e, d) => cb(d)),
  ready: () => ipcRenderer.send('suggest-ready'),
  onPlay: (cb) => ipcRenderer.on('suggest-play', () => cb()),
  onClose: (cb) => ipcRenderer.on('suggest-close', () => cb()),
  hover: (idx) => ipcRenderer.send('suggest-hover', idx),
  choose: (idx) => ipcRenderer.send('suggest-choose', idx),
});
