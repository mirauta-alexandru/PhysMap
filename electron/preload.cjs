const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('physmapDesktop', {
  isDesktop: true,
  listDisplays: () => ipcRenderer.invoke('physmap:list-displays'),
  closeOutput: () => ipcRenderer.invoke('physmap:close-output'),
  getUpdateState: () => ipcRenderer.invoke('physmap:update-state'),
  checkForUpdates: () => ipcRenderer.invoke('physmap:check-update'),
  downloadUpdate: () => ipcRenderer.invoke('physmap:download-update'),
  installUpdate: () => ipcRenderer.invoke('physmap:install-update'),
  onDisplaysChanged: (callback) => {
    const listener = (_event, displays) => callback(displays);
    ipcRenderer.on('physmap:displays-changed', listener);
    return () => ipcRenderer.removeListener('physmap:displays-changed', listener);
  },
  onOutputClosed: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('physmap:output-closed', listener);
    return () => ipcRenderer.removeListener('physmap:output-closed', listener);
  },
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('physmap:update-state', listener);
    return () => ipcRenderer.removeListener('physmap:update-state', listener);
  },
});
