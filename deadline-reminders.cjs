const REMINDER_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const REMINDER_TYPES = ["tomorrow", "today", "overdue"];

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function notificationContent(type, reminders) {
  const titles = {
    tomorrow: ["Scadenza domani", "Scadenze domani"],
    today: ["Scadenza di oggi", "Scadenze di oggi"],
    overdue: ["Attività scaduta", "Attività scadute"]
  };
  const title = titles[type][reminders.length === 1 ? 0 : 1];
  const names = reminders.slice(0, 3).map((reminder) => reminder.itemName);
  const remaining = reminders.length - names.length;
  const taskList = names.join(", ");
  const suffix = remaining > 0 ? ` e altre ${remaining}` : "";
  const body = type === "tomorrow"
    ? `${taskList}${suffix} · la scadenza è domani.`
    : type === "today"
      ? `${taskList}${suffix} · la scadenza è oggi.`
      : `${taskList}${suffix} · ${reminders.length === 1 ? "l'attività è scaduta." : "le attività sono scadute."}`;
  return { title, body };
}

function registerDeadlineReminders({
  database,
  Notification,
  BrowserWindow,
  logger = console,
  now = () => new Date(),
  intervalMs = REMINDER_CHECK_INTERVAL_MS,
  onOpenReminder = () => {}
}) {
  let interval;
  let checking = false;
  let started = false;
  let disposed = false;
  let supportWarningShown = false;

  function sendStatus(message) {
    const window = BrowserWindow.getAllWindows().find((entry) => !entry.isDestroyed());
    window?.webContents.send("app:reminder-status", message);
  }

  async function check() {
    if (checking || disposed) return 0;
    checking = true;
    try {
      if (!Notification.isSupported()) {
        if (!supportWarningShown) {
          supportWarningShown = true;
          logger.error("Le notifiche desktop non sono disponibili su questo dispositivo.");
          sendStatus("Le notifiche di scadenza non sono disponibili su questo dispositivo.");
        }
        return 0;
      }

      const reminders = database.getPendingDeadlineReminders(localDate(now()));
      for (const type of REMINDER_TYPES) {
        const dueReminders = reminders.filter((reminder) => reminder.reminderType === type);
        if (dueReminders.length === 0) continue;

        const content = notificationContent(type, dueReminders);
        const notification = new Notification(content);
        notification.on("click", () => onOpenReminder(dueReminders[0]));
        notification.show();
        database.markDeadlineRemindersSent(dueReminders, now().toISOString());
      }
      return reminders.length;
    } catch (error) {
      logger.error("Impossibile controllare o notificare le scadenze di Wondy.", error);
      sendStatus("Impossibile controllare le notifiche delle scadenze. Riprova riaprendo Wondy.");
      throw error;
    } finally {
      checking = false;
    }
  }

  function start() {
    if (started || disposed) return Promise.resolve(0);
    started = true;
    interval = setInterval(() => {
      void check().catch((error) => logger.error("Il controllo periodico delle scadenze non è riuscito.", error));
    }, intervalMs);
    interval.unref?.();
    return check();
  }

  return {
    check,
    start,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(interval);
    }
  };
}

module.exports = { registerDeadlineReminders, REMINDER_CHECK_INTERVAL_MS, notificationContent };
