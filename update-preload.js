const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('updateapi', {
  onState: (cb) => ipcRenderer.on('update-state', (_e, s) => cb(s)),
  download: () => ipcRenderer.send('update-download'),
  install: () => ipcRenderer.send('update-install'),
  dismiss: () => ipcRenderer.send('update-dismiss'),
});
