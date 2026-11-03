const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { registerDeadlineReminders, REMINDER_CHECK_INTERVAL_MS } = require("../deadline-reminders.cjs");

class TestNotification extends EventEmitter {
  static isSupported() {
    return true;
  }

  constructor(options) {
    super();
    this.options = options;
    TestNotification.sent.push(this);
  }

  show() {}
}

function createReminder(itemId, reminderType) {
  return {
    itemId,
    boardId: "board-1",
    boardName: "Progetto",
    itemName: `Attività ${itemId}`,
    groupName: "Gruppo 1",
    columnId: "deadline-1",
    columnName: "Scadenza",
    dueDate: "2026-11-04",
    reminderType
  };
}

function setup(reminders = []) {
  TestNotification.sent = [];
  const sent = [];
  const statuses = [];
  const errors = [];
  const opened = [];
  const dependencies = {
    database: {
      getPendingDeadlineReminders: (today) => {
        assert.equal(today, "2026-11-03");
        return reminders;
      },
      markDeadlineRemindersSent: (batch, at) => sent.push({ batch, at })
    },
    Notification: TestNotification,
    BrowserWindow: {
      getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (...args) => statuses.push(args) } }]
    },
    logger: { error: (...args) => errors.push(args) },
    now: () => new Date(2026, 10, 3, 12, 0, 0),
    intervalMs: REMINDER_CHECK_INTERVAL_MS,
    onOpenReminder: (reminder) => opened.push(reminder)
  };
  return {
    service: registerDeadlineReminders(dependencies),
    sent,
    statuses,
    errors,
    opened
  };
}

test("deadline reminders notify once per category and record what was shown", async () => {
  const testSetup = setup([
    createReminder("a", "tomorrow"),
    createReminder("b", "tomorrow"),
    createReminder("c", "today"),
    createReminder("d", "overdue")
  ]);

  assert.equal(await testSetup.service.check(), 4);
  assert.equal(TestNotification.sent.length, 3);
  assert.equal(testSetup.sent.length, 3);
  assert.deepEqual(TestNotification.sent.map(({ options }) => options.title), [
    "Scadenze domani",
    "Scadenza di oggi",
    "Attività scaduta"
  ]);
  assert.match(TestNotification.sent[0].options.body, /Attività a, Attività b/);
  testSetup.service.dispose();
});

test("clicking a reminder opens its activity in Wondy's calendar", async () => {
  const testSetup = setup([createReminder("a", "today")]);
  await testSetup.service.check();
  TestNotification.sent[0].emit("click");
  assert.equal(testSetup.opened[0].itemId, "a");
  testSetup.service.dispose();
});

test("notification failures remain visible and do not mark reminders as sent", async () => {
  class FailingNotification extends TestNotification {
    show() {
      throw new Error("notification denied");
    }
  }
  const testSetup = setup([createReminder("a", "today")]);
  testSetup.service.dispose();
  const service = registerDeadlineReminders({
    database: {
      getPendingDeadlineReminders: () => [createReminder("a", "today")],
      markDeadlineRemindersSent: () => assert.fail("Un promemoria non notificato non deve risultare inviato.")
    },
    Notification: FailingNotification,
    BrowserWindow: {
      getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (...args) => testSetup.statuses.push(args) } }]
    },
    logger: { error: (...args) => testSetup.errors.push(args) },
    now: () => new Date(2026, 10, 3, 12, 0, 0)
  });

  await assert.rejects(service.check(), /notification denied/);
  assert.equal(testSetup.errors.length, 1);
  assert.match(testSetup.statuses[0][1], /Impossibile controllare/);
  service.dispose();
});
