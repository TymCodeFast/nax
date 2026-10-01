const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('finder', {
  onOpen: (cb) => ipcRenderer.on('find-open', (_e, d) => cb(d)),
  onResult: (cb) => ipcRenderer.on('find-result', (_e, r) => cb(r)),
  query: (text, forward, findNext) => ipcRenderer.send('find-query', { text, forward, findNext }),
  close: () => ipcRenderer.send('find-close'),
});
