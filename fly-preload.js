const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fly', {
  onLoad: (cb) => ipcRenderer.on('fly-load', (_e, d) => cb(d)),
  ready: () => ipcRenderer.send('fly-ready'),
  onPlay: (cb) => ipcRenderer.on('fly-play', () => cb()),
  onClose: (cb) => ipcRenderer.on('fly-close', () => cb()),
  hover: (inside) => ipcRenderer.send('fly-hover', !!inside),
  click: (o) => ipcRenderer.send('fly-click', o),
  edit: (id) => ipcRenderer.send('fly-edit', id),
  openAll: (favId) => ipcRenderer.send('fly-open-all', favId),
  resize: (h) => ipcRenderer.send('fly-resize', h),
  removeItem: (o) => ipcRenderer.send('fly-remove-item', o),
});
