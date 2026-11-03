const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { registerAutoUpdater } = require("../updater.cjs");

function createUpdater() {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => ({ isUpdateAvailable: false, updateInfo: { version: "0.0.1" } });
  updater.downloadUpdate = async () => [];
  updater.quitAndInstall = () => {};
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  return updater;
}

function createDependencies({ isPackaged = false, response = 1 } = {}) {
  const updater = createUpdater();
  const messages = [];
  const errors = [];
  const dependencies = {
    app: { isPackaged },
    autoUpdater: updater,
    dialog: {
      showMessageBox: async (...args) => {
        messages.push(args.at(-1));
        return { response };
      }
    },
    BrowserWindow: { getAllWindows: () => [] },
    logger: { error: (...args) => errors.push(args) }
  };
  return { ...dependencies, messages, errors };
}

test("development builds report updates as unavailable without contacting the updater", async () => {
  const dependencies = createDependencies();
  const updater = dependencies.autoUpdater;
  let checks = 0;
  updater.checkForUpdates = async () => {
    checks += 1;
  };

  const updates = registerAutoUpdater(dependencies);
  assert.deepEqual(await updates.checkForUpdates({ userInitiated: true }), { status: "unavailable-in-development" });
  assert.equal(checks, 0);
  assert.equal(dependencies.messages.length, 1);
  updates.dispose();
});

test("packaged builds check manually and report a failed update request", async () => {
  const dependencies = createDependencies({ isPackaged: true });
  dependencies.autoUpdater.checkForUpdates = async () => {
    throw new Error("offline");
  };
  const updates = registerAutoUpdater(dependencies);

  assert.deepEqual(await updates.checkForUpdates({ userInitiated: true }), { status: "error" });
  assert.equal(dependencies.errors.length, 1);
  assert.equal(dependencies.messages[0].title, "Aggiornamento non riuscito");
  assert.match(dependencies.messages[0].detail, /offline/);
  updates.dispose();
});

test("packaged builds disable automatic downloads and remove updater listeners on dispose", () => {
  const dependencies = createDependencies({ isPackaged: true });
  const updates = registerAutoUpdater(dependencies);

  assert.equal(dependencies.autoUpdater.autoDownload, false);
  assert.equal(dependencies.autoUpdater.autoInstallOnAppQuit, false);
  assert.equal(dependencies.autoUpdater.listenerCount("update-available"), 1);
  updates.dispose();
  updates.dispose();
  assert.equal(dependencies.autoUpdater.listenerCount("update-available"), 0);
});

test("packaged builds check immediately when the app starts and only once", async () => {
  const dependencies = createDependencies({ isPackaged: true });
  let checks = 0;
  dependencies.autoUpdater.checkForUpdates = async () => {
    checks += 1;
    return { isUpdateAvailable: false, updateInfo: { version: "0.0.3" } };
  };
  const updates = registerAutoUpdater(dependencies);

  assert.deepEqual(await updates.start(), { status: "checking", version: "0.0.3" });
  assert.deepEqual(await updates.start(), { status: "already-started" });
  assert.equal(checks, 1);
  updates.dispose();
});

test("startup update prompt lets the user defer without downloading", async () => {
  const dependencies = createDependencies({ isPackaged: true, response: 1 });
  let downloads = 0;
  dependencies.autoUpdater.checkForUpdates = async () => {
    dependencies.autoUpdater.emit("update-available", { version: "0.0.3" });
    return { isUpdateAvailable: true, updateInfo: { version: "0.0.3" } };
  };
  dependencies.autoUpdater.downloadUpdate = async () => {
    downloads += 1;
  };
  const updates = registerAutoUpdater(dependencies);

  await updates.start();
  await new Promise(setImmediate);
  assert.equal(dependencies.messages[0].title, "Aggiornamento disponibile");
  assert.deepEqual(dependencies.messages[0].buttons, ["Aggiorna ora", "Rimanda"]);
  assert.equal(downloads, 0);
  updates.dispose();
});

test("confirming the startup update prompt starts the update download", async () => {
  const dependencies = createDependencies({ isPackaged: true, response: 0 });
  let downloads = 0;
  dependencies.autoUpdater.checkForUpdates = async () => {
    dependencies.autoUpdater.emit("update-available", { version: "0.0.3" });
    return { isUpdateAvailable: true, updateInfo: { version: "0.0.3" } };
  };
  dependencies.autoUpdater.downloadUpdate = async () => {
    downloads += 1;
  };
  const updates = registerAutoUpdater(dependencies);

  await updates.start();
  await new Promise(setImmediate);
  assert.equal(downloads, 1);
  updates.dispose();
});
