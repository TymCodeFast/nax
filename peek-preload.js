const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('peek', {
  onLoad: (cb) => ipcRenderer.on('peek-load', (_e, d) => cb(d)),
  ready: () => ipcRenderer.send('peek-ready'),
  onPlay: (cb) => ipcRenderer.on('peek-play', () => cb()),
  onClose: (cb) => ipcRenderer.on('peek-close', () => cb()),
  hover: (inside) => ipcRenderer.send('peek-hover', !!inside),
  openFull: () => ipcRenderer.send('peek-open-full'),
  gmailFeed: () => ipcRenderer.invoke('gmail-feed'),
  openMail: (link) => ipcRenderer.send('gmail-open', link),
  chatFeed: (force) => ipcRenderer.invoke('chat-feed', force),
  openChat: (groupId) => ipcRenderer.send('chat-open', groupId),
});
