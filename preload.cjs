const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wondy", Object.freeze({
  loadWorkspace: () => ipcRenderer.invoke("workspace:load"),
  saveWorkspace: (workspace) => ipcRenderer.invoke("workspace:save", workspace),
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  getTheme: () => ipcRenderer.invoke("app:get-theme"),
  setTheme: (theme) => ipcRenderer.invoke("app:set-theme", theme),
  checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
  onUpdateStatus: (callback) => {
    if (typeof callback !== "function") throw new TypeError("È necessario specificare un callback valido.");
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("app:update-status", listener);
    return () => ipcRenderer.removeListener("app:update-status", listener);
  },
  onReminderStatus: (callback) => {
    if (typeof callback !== "function") throw new TypeError("È necessario specificare un callback valido.");
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("app:reminder-status", listener);
    return () => ipcRenderer.removeListener("app:reminder-status", listener);
  },
  onOpenCalendarReminder: (callback) => {
    if (typeof callback !== "function") throw new TypeError("È necessario specificare un callback valido.");
    const listener = (_event, reminder) => callback(reminder);
    ipcRenderer.on("app:open-calendar-reminder", listener);
    return () => ipcRenderer.removeListener("app:open-calendar-reminder", listener);
  }
}));
