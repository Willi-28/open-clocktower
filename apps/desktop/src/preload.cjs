/**
 * Preload bridge: exposes a tiny, safe desktop API to the launcher page.
 *
 * Only the launcher HTML uses this. Once the window navigates to the game UI
 * (served locally), the existing React frontend runs exactly as in the browser
 * and never touches this bridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  status: () => ipcRenderer.invoke('desktop:status'),
  createRoom: (options) => ipcRenderer.invoke('desktop:createRoom', options),
  joinRoom: (lobbyId) => ipcRenderer.invoke('desktop:joinRoom', lobbyId),
  connectCustom: (url) => ipcRenderer.invoke('desktop:connectCustom', url),
  leaveRoom: () => ipcRenderer.invoke('desktop:leaveRoom'),
  onAutojoin: (callback) => ipcRenderer.on('desktop:autojoin', (_event, lobbyId) => callback(lobbyId)),
});
