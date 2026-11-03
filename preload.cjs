const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wondy", Object.freeze({
  loadWorkspace: () => ipcRenderer.invoke("workspace:load"),
  saveWorkspace: (workspace) => ipcRenderer.invoke("workspace:save", workspace),
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
  onUpdateStatus: (callback) => {
    if (typeof callback !== "function") throw new TypeError("È necessario specificare un callback valido.");
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("app:update-status", listener);
    return () => ipcRenderer.removeListener("app:update-status", listener);
  }
}));
