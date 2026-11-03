const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { WorkspaceDatabase } = require("../database.cjs");

test("salva e ripristina schede vuote, colonne personalizzate, gruppi e celle", (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "wondy-database-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const file = path.join(directory, "workspace.sqlite");
  const database = new WorkspaceDatabase(file);
  const workspace = {
    activeBoardId: "empty",
    boards: [
      {
        id: "project",
        name: "Progetto",
        description: "Tabella di prova",
        columns: [
          { id: "element", name: "Elemento", type: "name", role: "", position: 0, options: [] },
          { id: "state", name: "Avanzamento", type: "status", role: "", position: 1, options: ["Non iniziato", "In lavorazione", "Finito"] },
          { id: "priority", name: "Priorità", type: "status", role: "priority", position: 2, options: ["Bassa", "Media", "Alta"] },
          { id: "deadline", name: "Scadenza", type: "date", role: "", position: 3, options: [] }
        ],
        groups: [
          { id: "tasks", name: "Gruppo personalizzato", color: "#5b9df5", position: 0, kind: "active" },
          { id: "tasks-completed", name: "Completate", color: "#36b681", position: 1, kind: "completed" }
        ],
        items: [{
          id: "task",
          groupId: "tasks",
          name: "Prima attività",
          position: 0,
          previousGroupId: "",
          cells: { state: "In lavorazione", priority: "Alta", deadline: "2026-11-03" }
        }]
      },
      {
        id: "empty",
        name: "Tabella vuota",
        description: "",
        columns: [
          { id: "empty-element", name: "Elemento", type: "name", role: "", position: 0, options: [] },
          { id: "empty-state", name: "Stato", type: "status", role: "", position: 1, options: ["Non iniziato", "In lavorazione", "Finito"] },
          { id: "empty-priority", name: "Priorità", type: "status", role: "priority", position: 2, options: ["Bassa", "Media", "Alta"] },
          { id: "empty-deadline", name: "Scadenza", type: "date", role: "", position: 3, options: [] }
        ],
        groups: [
          { id: "empty-group", name: "Gruppo 1", color: "#44bd91", position: 0, kind: "active" },
          { id: "empty-completed", name: "Completate", color: "#36b681", position: 1, kind: "completed" }
        ],
        items: []
      }
    ]
  };

  assert.equal(database.save(workspace), true);
  database.close();

  const reopened = new WorkspaceDatabase(file);
  assert.deepEqual(reopened.load(), workspace);
  assert.throws(() => reopened.save({
    ...workspace,
    boards: [{ ...workspace.boards[0], columns: [] }]
  }), /una sola colonna Elemento/);
  assert.deepEqual(reopened.load(), workspace);
  reopened.close();
});

test("una nuova installazione crea una scheda di esempio con stati modificabili", (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "wondy-database-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));

  const workspace = database.load();
  assert.equal(workspace.boards.length, 1);
  assert.deepEqual(workspace.boards[0].columns.map((column) => column.name), ["Elemento", "Stato", "Priorità", "Scadenza"]);
  assert.equal(workspace.boards[0].items.length, 3);
  assert.deepEqual(workspace.boards[0].columns[1].options, ["Non iniziato", "In lavorazione", "Finito"]);
  assert.deepEqual(workspace.boards[0].columns[2].options, ["Bassa", "Media", "Alta"]);
  assert.equal(workspace.boards[0].groups.filter((group) => group.kind === "completed").length, 1);
  assert.equal(workspace.boards[0].items.find((item) => item.name === "Definire gli obiettivi").groupId, "group-completed");
  const emptyBoard = {
    id: "blank-board",
    name: "Tabella vuota",
    description: "",
    columns: [
      { id: "blank-column", name: "Elemento", type: "name", role: "", position: 0, options: [] },
      { id: "blank-status", name: "Stato", type: "status", role: "", position: 1, options: ["Non iniziato", "In lavorazione", "Finito"] },
      { id: "blank-priority", name: "Priorità", type: "status", role: "priority", position: 2, options: ["Bassa", "Media", "Alta"] },
      { id: "blank-deadline", name: "Scadenza", type: "date", role: "", position: 3, options: [] }
    ],
    groups: [
      { id: "blank-group", name: "Gruppo 1", color: "#44bd91", position: 0, kind: "active" },
      { id: "blank-completed", name: "Completate", color: "#36b681", position: 1, kind: "completed" }
    ],
    items: []
  };
  database.save({ activeBoardId: emptyBoard.id, boards: [workspace.boards[0], emptyBoard] });
  database.close();

  const reopened = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  const persisted = reopened.load();
  assert.equal(persisted.boards.length, 2);
  assert.equal(persisted.activeBoardId, emptyBoard.id);
  assert.deepEqual(persisted.boards[1].items, []);
  reopened.save({ activeBoardId: "", boards: [] });
  reopened.close();

  const afterEmpty = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  assert.deepEqual(afterEmpty.load(), { activeBoardId: "", boards: [] });
  afterEmpty.close();
});

test("salva la modalità scelta e la mantiene dopo aver riaperto il database", (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "wondy-theme-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "workspace.sqlite");
  const database = new WorkspaceDatabase(file);

  assert.equal(database.getTheme(), "light");
  assert.equal(database.setTheme("dark"), true);
  assert.equal(database.getTheme(), "dark");
  assert.throws(() => database.setTheme("system"), /tema deve essere/);
  database.close();

  const reopened = new WorkspaceDatabase(file);
  assert.equal(reopened.getTheme(), "dark");
  reopened.close();
});

test("trova e memorizza i promemoria per le scadenze senza ripeterli", (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "wondy-reminders-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = new WorkspaceDatabase(path.join(directory, "workspace.sqlite"));
  const workspace = database.load();
  const board = workspace.boards[0];
  const activeGroup = board.groups.find((group) => group.kind === "active");
  const completedGroup = board.groups.find((group) => group.kind === "completed");
  const deadlineColumn = board.columns.find((column) => column.type === "date");
  const makeItem = (id, name, groupId, dueDate) => ({
    id,
    groupId,
    name,
    position: board.items.length,
    previousGroupId: "",
    cells: Object.fromEntries(board.columns
      .filter((column) => column.type !== "name")
      .map((column) => [column.id, column.id === deadlineColumn.id ? dueDate : ""]))
  });
  board.items = [
    makeItem("reminder-overdue", "Attività scaduta", activeGroup.id, "2026-11-02"),
    makeItem("reminder-today", "Attività di oggi", activeGroup.id, "2026-11-03"),
    makeItem("reminder-tomorrow", "Attività di domani", activeGroup.id, "2026-11-04"),
    makeItem("reminder-future", "Attività futura", activeGroup.id, "2026-11-05"),
    makeItem("reminder-completed", "Attività completata", completedGroup.id, "2026-11-02")
  ];
  database.save(workspace);

  const reminders = database.getPendingDeadlineReminders("2026-11-03");
  assert.deepEqual(reminders.map(({ itemId, reminderType }) => [itemId, reminderType]), [
    ["reminder-overdue", "overdue"],
    ["reminder-today", "today"],
    ["reminder-tomorrow", "tomorrow"]
  ]);
  database.markDeadlineRemindersSent(reminders, "2026-11-03T08:00:00.000Z");
  assert.deepEqual(database.getPendingDeadlineReminders("2026-11-03"), []);

  board.items.find((item) => item.id === "reminder-tomorrow").cells[deadlineColumn.id] = "2026-11-06";
  database.save(workspace);
  assert.deepEqual(database.getPendingDeadlineReminders("2026-11-05").map(({ itemId, reminderType }) => [
    itemId,
    reminderType
  ]), [
    ["reminder-today", "overdue"],
    ["reminder-future", "today"],
    ["reminder-tomorrow", "tomorrow"]
  ]);
  assert.throws(() => database.getPendingDeadlineReminders("2026-02-30"), /data di controllo/);
  database.close();
});

test("aggiorna un database esistente conservando gli elementi", (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "wondy-migration-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "workspace.sqlite");
  const legacy = new (require("node:sqlite").DatabaseSync)(file);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE boards (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL);
    CREATE TABLE board_columns (id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('name','text','person','status','date')), position INTEGER NOT NULL, options_json TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE task_groups (id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, name TEXT NOT NULL, color TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE board_items (id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, group_id TEXT NOT NULL REFERENCES task_groups(id) ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE TABLE item_cells (item_id TEXT NOT NULL REFERENCES board_items(id) ON DELETE CASCADE, column_id TEXT NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE, value TEXT NOT NULL DEFAULT '', PRIMARY KEY(item_id, column_id));
    INSERT INTO boards VALUES ('existing-board', 'La mia tabella', '', 0);
    INSERT INTO board_columns VALUES ('existing-name', 'existing-board', 'Elemento', 'name', 0, '[]');
    INSERT INTO board_columns VALUES ('existing-person', 'existing-board', 'Persona', 'person', 1, '[]');
    INSERT INTO board_columns VALUES ('existing-status', 'existing-board', 'Stato', 'status', 2, '["Por hacer","En progreso","Completado"]');
    INSERT INTO board_columns VALUES ('existing-assignee', 'existing-board', 'Responsabile', 'person', 3, '[]');
    INSERT INTO task_groups VALUES ('existing-group', 'existing-board', 'Attività', '#5b9df5', 0);
    INSERT INTO board_items VALUES ('existing-item', 'existing-board', 'existing-group', 'Conserva questa riga', 0);
    INSERT INTO board_items VALUES ('existing-done-item', 'existing-board', 'existing-group', 'Riga completata', 1);
    INSERT INTO item_cells VALUES ('existing-item', 'existing-status', 'En progreso');
    INSERT INTO item_cells VALUES ('existing-done-item', 'existing-status', 'Completado');
    INSERT INTO item_cells VALUES ('existing-item', 'existing-person', 'Persona precedente');
    INSERT INTO item_cells VALUES ('existing-item', 'existing-assignee', 'Ada');
  `);
  legacy.close();

  const upgraded = new WorkspaceDatabase(file);
  const workspace = upgraded.load();
  assert.equal(upgraded.getTheme(), "light");
  const existingBoard = workspace.boards[0];
  assert.equal(existingBoard.name, "La mia tabella");
  assert.equal(existingBoard.columns.some((column) => column.id === "existing-person"), false);
  assert.equal(existingBoard.columns.find((column) => column.id === "existing-assignee").name, "Responsabile");
  assert.equal(existingBoard.items.find((item) => item.id === "existing-item").cells["existing-person"], undefined);
  assert.equal(existingBoard.items.find((item) => item.id === "existing-item").cells["existing-assignee"], "Ada");
  assert.deepEqual(existingBoard.columns.map((column) => column.position), [0, 1, 2, 3, 4]);
  assert.equal(existingBoard.items[0].name, "Conserva questa riga");
  assert.deepEqual(existingBoard.columns.find((column) => column.id === "existing-status").options, ["Non iniziato", "In lavorazione", "Finito"]);
  assert.equal(existingBoard.columns.some((column) => column.role === "priority"), true);
  assert.equal(existingBoard.columns.some((column) => column.name === "Scadenza"), true);
  assert.equal(existingBoard.groups.filter((group) => group.kind === "completed").length, 1);
  assert.equal(existingBoard.items[0].groupId, "existing-group");
  assert.equal(existingBoard.items[0].previousGroupId, "");
  const completedItem = existingBoard.items.find((item) => item.id === "existing-done-item");
  assert.equal(completedItem.groupId, existingBoard.groups.find((group) => group.kind === "completed").id);
  assert.equal(completedItem.previousGroupId, "existing-group");
  assert.equal(completedItem.cells["existing-status"], "Finito");
  upgraded.close();
});
