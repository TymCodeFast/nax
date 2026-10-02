const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fly', {
  onLoad: (cb) => ipcRenderer.on('fly-load', (_e, d) => cb(d)),
  hover: (inside) => ipcRenderer.send('fly-hover', !!inside),
  click: (o) => ipcRenderer.send('fly-click', o),
  edit: (id) => ipcRenderer.send('fly-edit', id),
});
