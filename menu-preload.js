const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ctxmenu', {
  onShow: (cb) => ipcRenderer.on('menu-show', (_e, d) => cb(d)),
  onPlay: (cb) => ipcRenderer.on('menu-play', () => cb()),
  ready: () => ipcRenderer.send('menu-ready'),
  select: (idx) => ipcRenderer.send('menu-select', idx),
  close: () => ipcRenderer.send('menu-close'),
});
