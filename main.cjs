const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { autoUpdater } = require("electron-updater");
const { WorkspaceDatabase } = require("./database.cjs");
const { registerAutoUpdater } = require("./updater.cjs");

let database;
let updates;

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f5f6fa",
    title: "Wondy",
    icon: path.join(__dirname, "build", "icon.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const appPage = pathToFileURL(path.join(__dirname, "index.html")).href;
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== appPage) event.preventDefault();
  });
  window.once("ready-to-show", () => {
    void updates.start();
  });
  window.loadFile(path.join(__dirname, "index.html")).catch((error) => {
    console.error("Impossibile aprire la finestra principale di Wondy.", error);
    dialog.showErrorBox("Errore di avvio", "Wondy non riesce a caricare la propria interfaccia.");
  });
}

app.whenReady()
  .then(() => {
    app.setName("Wondy");
    app.setAppUserModelId("com.wondy.desktop");
    database = new WorkspaceDatabase(path.join(app.getPath("userData"), "wondy.sqlite"));
    updates = registerAutoUpdater({ app, autoUpdater, dialog, BrowserWindow });
    const appPage = pathToFileURL(path.join(__dirname, "index.html")).href;
    const isTrustedApp = (event) => event.senderFrame?.url === appPage;
    ipcMain.handle("workspace:load", () => database.load());
    ipcMain.handle("workspace:save", (_event, workspace) => database.save(workspace));
    ipcMain.handle("app:get-version", () => app.getVersion());
    ipcMain.handle("app:get-theme", (event) => {
      if (!isTrustedApp(event)) throw new Error("Richiesta del tema non autorizzata.");
      return database.getTheme();
    });
    ipcMain.handle("app:set-theme", (event, theme) => {
      if (!isTrustedApp(event)) throw new Error("Richiesta del tema non autorizzata.");
      return database.setTheme(theme);
    });
    ipcMain.handle("app:check-for-updates", (event) => {
      if (!isTrustedApp(event)) throw new Error("Richiesta di aggiornamento non autorizzata.");
      return updates.checkForUpdates({ userInitiated: true });
    });
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error) => {
    console.error("Impossibile avviare Wondy o inizializzare il database.", error);
    dialog.showErrorBox("Errore di avvio", "Wondy non riesce ad aprire il database dei dati locali.");
    app.exit(1);
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (updates) updates.dispose();
  if (database) database.close();
});
