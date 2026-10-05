const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tipapi', {
  onShow: (cb) => ipcRenderer.on('tip-show', (_e, d) => cb(d)),
  onHide: (cb) => ipcRenderer.on('tip-hide', () => cb()),
  onLinkStatus: (cb) => ipcRenderer.on('link-status', (_e, d) => cb(d)),
  onDownloads: (cb) => ipcRenderer.on('dl-toasts', (_e, d) => cb(d)),
  mouse: (mode) => ipcRenderer.send('tip-mouse', mode), // 'on' | 'forward' | 'off'
  openDownloads: () => ipcRenderer.send('dl-toast-click'),
});
