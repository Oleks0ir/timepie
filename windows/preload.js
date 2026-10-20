const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('timepie', {
  load: () => ipcRenderer.invoke('store:load'),
  save: (json) => ipcRenderer.invoke('store:save', json),
  contextMenu: (items) => ipcRenderer.invoke('menu:context', items),
  onUndo: (fn) => ipcRenderer.on('undo', fn),
  loadFriends: () => ipcRenderer.invoke('friends:load'),
  saveFriends: (json) => ipcRenderer.invoke('friends:save', json),
  openPage: (url) => ipcRenderer.invoke('open:page', url),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
});
