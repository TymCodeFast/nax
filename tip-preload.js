const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tipapi', {
  onShow: (cb) => ipcRenderer.on('tip-show', (_e, d) => cb(d)),
  onHide: (cb) => ipcRenderer.on('tip-hide', () => cb()),
  onLinkStatus: (cb) => ipcRenderer.on('link-status', (_e, d) => cb(d)),
});
