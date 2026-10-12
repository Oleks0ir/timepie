const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('timepie', {
  load: () => ipcRenderer.invoke('store:load'),
  save: (json) => ipcRenderer.invoke('store:save', json),
  contextMenu: (items) => ipcRenderer.invoke('menu:context', items),
  onUndo: (fn) => ipcRenderer.on('undo', fn),
});
