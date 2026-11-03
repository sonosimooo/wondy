const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 12 * 1000;

function registerAutoUpdater({ app, autoUpdater, dialog, BrowserWindow, logger = console }) {
  let checkPromise = null;
  let manualCheckPending = false;
  let downloading = false;
  let failureDialogShown = false;
  let downloadedVersion = "";
  let disposed = false;
  let initialCheck;
  let periodicCheck;

  function showMessage(options) {
    const window = BrowserWindow.getAllWindows().find((entry) => !entry.isDestroyed());
    return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
  }

  function sendStatus(status, message, progress) {
    const window = BrowserWindow.getAllWindows().find((entry) => !entry.isDestroyed());
    if (!window) return;
    window.webContents.send("app:update-status", {
      status,
      message,
      ...(Number.isFinite(progress) ? { progress: Math.max(0, Math.min(100, Math.round(progress))) } : {})
    });
  }

  function reportError(message, error, notify = false) {
    logger.error(message, error);
    sendStatus("error", "Impossibile controllare gli aggiornamenti.");
    if (notify) {
      const errorDetail = error instanceof Error ? error.message : String(error ?? "Errore non specificato.");
      void showMessage({
        type: "error",
        title: "Aggiornamento non riuscito",
        message: "Wondy non è riuscito a completare l'aggiornamento.",
        detail: `Riprova tra poco. Dettaglio: ${errorDetail.slice(0, 500)}`
      }).catch((dialogError) => logger.error("Impossibile visualizzare l'errore di aggiornamento.", dialogError));
    }
  }

  async function promptToInstall(version) {
    const result = await showMessage({
      type: "info",
      title: "Aggiornamento pronto",
      message: `Wondy ${version} è pronto per essere installato.`,
      detail: "L'applicazione si riavvierà per completare l'aggiornamento. I tuoi dati personali resteranno invariati.",
      buttons: ["Installa e riavvia", "Più tardi"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (result.response !== 0) return;
    sendStatus("installing", "Riavvio per completare l'aggiornamento…");
    autoUpdater.quitAndInstall(false, true);
  }

  async function downloadAvailableUpdate(info) {
    if (downloading || downloadedVersion === info.version) return;
    downloading = true;
    failureDialogShown = false;
    sendStatus("downloading", `Download di Wondy ${info.version} in corso…`, 0);

    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      downloading = false;
      if (!failureDialogShown) reportError("Impossibile scaricare l'aggiornamento di Wondy.", error, true);
    }
  }

  async function handleAvailableUpdate(info) {
    manualCheckPending = false;
    sendStatus("available", `È disponibile Wondy ${info.version}.`);
    try {
      const result = await showMessage({
        type: "info",
        title: "Nuova versione disponibile",
        message: `Wondy ${info.version} è disponibile.`,
        detail: "Vuoi scaricare l'aggiornamento adesso? Potrai installarlo quando il download sarà terminato. I tuoi dati rimangono salvati.",
        buttons: ["Scarica aggiornamento", "Più tardi"],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
      if (result.response === 0) await downloadAvailableUpdate(info);
    } catch (error) {
      reportError("Impossibile gestire l'aggiornamento disponibile.", error, true);
    }
  }

  function handleDownloadedUpdate(info) {
    downloading = false;
    downloadedVersion = info.version;
    sendStatus("ready", `Wondy ${info.version} è pronto da installare.`);
    void promptToInstall(info.version).catch((error) => {
      reportError("Impossibile mostrare la richiesta di installazione.", error);
    });
  }

  function handleProgress(progress) {
    const percent = Number(progress?.percent);
    if (!Number.isFinite(percent)) return;
    sendStatus("downloading", `Download dell'aggiornamento: ${Math.round(percent)}%.`, percent);
  }

  function handleUpdateUnavailable(info) {
    sendStatus("up-to-date", "Wondy è aggiornato.");
    if (!manualCheckPending) return;
    manualCheckPending = false;
    void showMessage({
      type: "info",
      title: "Wondy è aggiornato",
      message: `Stai già utilizzando Wondy ${info.version}.`,
      buttons: ["OK"],
      defaultId: 0,
      noLink: true
    }).catch((error) => logger.error("Impossibile visualizzare lo stato degli aggiornamenti.", error));
  }

  function handleUpdateError(error) {
    const showDialog = manualCheckPending || downloading;
    manualCheckPending = false;
    if (downloading) failureDialogShown = true;
    reportError("Errore durante il controllo o il download degli aggiornamenti di Wondy.", error, showDialog);
  }

  async function checkForUpdates({ userInitiated = false } = {}) {
    if (!app.isPackaged) {
      if (userInitiated) {
        await showMessage({
          type: "info",
          title: "Aggiornamenti non disponibili",
          message: "Gli aggiornamenti saranno disponibili nella versione installata di Wondy."
        });
      }
      return { status: "unavailable-in-development" };
    }

    if (downloadedVersion) {
      if (userInitiated) await promptToInstall(downloadedVersion);
      return { status: "downloaded", version: downloadedVersion };
    }
    if (userInitiated) manualCheckPending = true;
    if (checkPromise) return checkPromise;

    sendStatus("checking", "Controllo degli aggiornamenti…");
    checkPromise = autoUpdater.checkForUpdates()
      .then((result) => ({ status: result?.isUpdateAvailable ? "available" : "checking", version: result?.updateInfo?.version }))
      .catch((error) => {
        manualCheckPending = false;
        reportError("Impossibile controllare gli aggiornamenti di Wondy.", error, userInitiated);
        return { status: "error" };
      })
      .finally(() => {
        checkPromise = null;
      });
    return checkPromise;
  }

  if (!app.isPackaged) {
    return { checkForUpdates, dispose() {} };
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("update-available", handleAvailableUpdate);
  autoUpdater.on("update-not-available", handleUpdateUnavailable);
  autoUpdater.on("download-progress", handleProgress);
  autoUpdater.on("update-downloaded", handleDownloadedUpdate);
  autoUpdater.on("error", handleUpdateError);

  initialCheck = setTimeout(() => {
    void checkForUpdates().catch((error) => reportError("Impossibile avviare il controllo degli aggiornamenti.", error));
  }, INITIAL_CHECK_DELAY_MS);
  periodicCheck = setInterval(() => {
    void checkForUpdates().catch((error) => reportError("Impossibile avviare il controllo degli aggiornamenti.", error));
  }, UPDATE_CHECK_INTERVAL_MS);
  initialCheck.unref?.();
  periodicCheck.unref?.();

  return {
    checkForUpdates,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(initialCheck);
      clearInterval(periodicCheck);
      autoUpdater.removeListener("update-available", handleAvailableUpdate);
      autoUpdater.removeListener("update-not-available", handleUpdateUnavailable);
      autoUpdater.removeListener("download-progress", handleProgress);
      autoUpdater.removeListener("update-downloaded", handleDownloadedUpdate);
      autoUpdater.removeListener("error", handleUpdateError);
    }
  };
}

module.exports = { registerAutoUpdater, INITIAL_CHECK_DELAY_MS, UPDATE_CHECK_INTERVAL_MS };
