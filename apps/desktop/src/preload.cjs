/**
 * Preload bridge for the desktop client.
 *
 * The frontend uses this to connect to a self-hosted server from the local
 * address-bar shell and to close the frameless fullscreen window. Everything is
 * inert in the browser/Docker build, where window.desktop is undefined, so the
 * frontend stays unchanged for normal use.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  // { url } -> validates the server, then loads the local setup screen.
  connect: (options) => ipcRenderer.invoke('desktop:connect', options),
  changeServer: () => ipcRenderer.invoke('desktop:change-server'),
  close: () => ipcRenderer.invoke('desktop:close'),
});
