const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");

const COLUMN_TYPES = new Set(["name", "text", "person", "status", "date"]);
const DEFAULT_STATUS_OPTIONS = ["Non iniziato", "In lavorazione", "Finito"];
const PRIORITY_OPTIONS = ["Bassa", "Media", "Alta"];
const LEGACY_STATUS_OPTIONS = [
  ["Da fare", "In svolgimento", "Fatto"],
  ["Por hacer", "En progreso", "Completado"],
  ["planned", "working", "done"],
  ["Planned", "Working", "Done"]
];

function createStarterWorkspace() {
  const today = new Date();
  const date = (offset) => {
    const due = new Date(today);
    due.setDate(due.getDate() + offset);
    return `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
  };
  const boardId = "board-starter";
  const groupId = "group-starter";
  const completedGroupId = "group-completed";
  const nameColumnId = "column-name";
  const personColumnId = "column-person";
  const statusColumnId = "column-status";
  const priorityColumnId = "column-priority";
  const deadlineColumnId = "column-deadline";
  return {
    activeBoardId: boardId,
    boards: [{
      id: boardId,
      name: "Nuova scheda",
      description: "Pianifica, organizza e segui le attività del tuo team.",
      columns: [
        { id: nameColumnId, name: "Elemento", type: "name", position: 0, options: [] },
        { id: personColumnId, name: "Persona", type: "person", position: 1, options: [] },
        { id: statusColumnId, name: "Stato", type: "status", position: 2, options: DEFAULT_STATUS_OPTIONS },
        { id: priorityColumnId, name: "Priorità", type: "status", role: "priority", position: 3, options: PRIORITY_OPTIONS },
        { id: deadlineColumnId, name: "Scadenza", type: "date", position: 4, options: [] }
      ],
      groups: [
        { id: groupId, name: "Gruppo 1", color: "#5b9df5", position: 0, kind: "active" },
        { id: completedGroupId, name: "Completate", color: "#36b681", position: 1, kind: "completed" }
      ],
      items: [
        { id: "item-starter-1", groupId, name: "Pianificare il progetto", position: 0, previousGroupId: "", cells: { [personColumnId]: "", [statusColumnId]: "In lavorazione", [priorityColumnId]: "Alta", [deadlineColumnId]: date(3) } },
        { id: "item-starter-2", groupId, name: "Preparare i materiali", position: 1, previousGroupId: "", cells: { [personColumnId]: "", [statusColumnId]: "Non iniziato", [priorityColumnId]: "Media", [deadlineColumnId]: date(7) } },
        { id: "item-starter-3", groupId: completedGroupId, name: "Definire gli obiettivi", position: 0, previousGroupId: groupId, cells: { [personColumnId]: "", [statusColumnId]: "Finito", [priorityColumnId]: "Bassa", [deadlineColumnId]: date(-2) } }
      ]
    }]
  };
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 200) {
    throw new TypeError(`${label} deve essere un testo compreso tra 1 e 200 caratteri.`);
  }
  return value.trim();
}

function requireId(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    throw new TypeError(`${label} non è valido.`);
  }
  return value;
}

class WorkspaceDatabase {
  constructor(filePath) {
    this.db = new DatabaseSync(filePath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS boards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS board_columns (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('name', 'text', 'person', 'status', 'date')),
        role TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL,
        options_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS task_groups (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        position INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'active' CHECK (kind IN ('active', 'completed'))
      );
      CREATE TABLE IF NOT EXISTS board_items (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        group_id TEXT NOT NULL REFERENCES task_groups(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        previous_group_id TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS item_cells (
        item_id TEXT NOT NULL REFERENCES board_items(id) ON DELETE CASCADE,
        column_id TEXT NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
        value TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (item_id, column_id)
      );
      CREATE TABLE IF NOT EXISTS workspace_metadata (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        active_board_id TEXT REFERENCES boards(id) ON DELETE SET NULL,
        initialized INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS board_items_board_position ON board_items(board_id, position);
      CREATE INDEX IF NOT EXISTS board_columns_board_position ON board_columns(board_id, position);
      CREATE INDEX IF NOT EXISTS task_groups_board_position ON task_groups(board_id, position);
    `);
    this.ensureColumn("board_columns", "role", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("task_groups", "kind", "TEXT NOT NULL DEFAULT 'active'");
    this.ensureColumn("board_items", "previous_group_id", "TEXT NOT NULL DEFAULT ''");
    const initialized = this.db.prepare("SELECT initialized FROM workspace_metadata WHERE id = 1").get();
    const boardCount = this.db.prepare("SELECT COUNT(*) AS count FROM boards").get().count;
    if (boardCount === 0 && !initialized) this.save(createStarterWorkspace());
    else if (boardCount > 0) this.migrateExistingBoards();
  }

  ensureColumn(table, column, definition) {
    const existing = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (!existing.some((entry) => entry.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  migrateExistingBoards() {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("UPDATE task_groups SET kind = 'completed' WHERE lower(trim(name)) = 'completate'");
      const boards = this.db.prepare("SELECT id FROM boards ORDER BY position").all();
      const selectColumns = this.db.prepare("SELECT id, type, role, options_json AS optionsJson FROM board_columns WHERE board_id = ?");
      const insertColumn = this.db.prepare(
        "INSERT INTO board_columns (id, board_id, name, type, role, position, options_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      const selectGroups = this.db.prepare("SELECT id, kind, name FROM task_groups WHERE board_id = ?");
      const insertGroup = this.db.prepare(
        "INSERT INTO task_groups (id, board_id, name, color, position, kind) VALUES (?, ?, ?, ?, ?, 'completed')"
      );
      for (const { id: boardId } of boards) {
        const columns = selectColumns.all(boardId);
        let count = this.db.prepare("SELECT COUNT(*) AS count FROM board_columns WHERE board_id = ?").get(boardId).count;
        const statusColumns = columns.filter((column) => column.type === "status" && column.role !== "priority");
        for (const column of statusColumns) {
          const options = JSON.parse(column.optionsJson);
          if (!LEGACY_STATUS_OPTIONS.some((legacy) => JSON.stringify(legacy) === JSON.stringify(options))) continue;
          this.db.prepare("UPDATE board_columns SET options_json = ? WHERE id = ?").run(JSON.stringify(DEFAULT_STATUS_OPTIONS), column.id);
          const statusCells = this.db.prepare("SELECT item_id AS itemId, value FROM item_cells WHERE column_id = ?").all(column.id);
          for (const cell of statusCells) {
            const translated = translateDefaultStatus(cell.value);
            if (translated) this.db.prepare("UPDATE item_cells SET value = ? WHERE item_id = ? AND column_id = ?").run(translated, cell.itemId, column.id);
          }
        }
        if (!columns.some((column) => column.type === "status" && column.role !== "priority")) {
          const columnId = `column-status-${randomUUID()}`;
          insertColumn.run(columnId, boardId, "Stato", "status", "", count++, JSON.stringify(DEFAULT_STATUS_OPTIONS));
        }
        if (!columns.some((column) => column.type === "status" && column.role === "priority")) {
          const columnId = `column-priority-${randomUUID()}`;
          insertColumn.run(columnId, boardId, "Priorità", "status", "priority", count++, JSON.stringify(PRIORITY_OPTIONS));
        }
        if (!columns.some((column) => column.type === "date")) {
          insertColumn.run(`column-deadline-${randomUUID()}`, boardId, "Scadenza", "date", "", count++, "[]");
        }
        let groups = selectGroups.all(boardId);
        const completedGroups = groups.filter((group) => group.kind === "completed");
        for (const duplicate of completedGroups.slice(1)) {
          this.db.prepare("UPDATE task_groups SET kind = 'active' WHERE id = ?").run(duplicate.id);
        }
        groups = selectGroups.all(boardId);
        if (!groups.some((group) => group.kind === "completed")) {
          const position = this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM task_groups WHERE board_id = ?").get(boardId).next;
          insertGroup.run(`group-completed-${randomUUID()}`, boardId, "Completate", "#36b681", position);
          groups = selectGroups.all(boardId);
        }
        if (!groups.some((group) => group.kind !== "completed")) {
          const position = this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM task_groups WHERE board_id = ?").get(boardId).next;
          this.db.prepare(
            "INSERT INTO task_groups (id, board_id, name, color, position, kind) VALUES (?, ?, 'Gruppo 1', '#5b9df5', ?, 'active')"
          ).run(`group-active-${randomUUID()}`, boardId, position);
        }
        const completedGroup = this.db.prepare(
          "SELECT id FROM task_groups WHERE board_id = ? AND kind = 'completed' ORDER BY position LIMIT 1"
        ).get(boardId);
        const statusColumn = this.db.prepare(
          "SELECT id FROM board_columns WHERE board_id = ? AND type = 'status' AND role <> 'priority' ORDER BY position LIMIT 1"
        ).get(boardId);
        if (completedGroup && statusColumn) {
          const items = this.db.prepare(
            "SELECT board_items.id, board_items.group_id AS groupId, item_cells.value AS status FROM board_items JOIN item_cells ON item_cells.item_id = board_items.id AND item_cells.column_id = ? WHERE board_items.board_id = ?"
          ).all(statusColumn.id, boardId);
          for (const item of items) {
            if (!["finito", "fatto", "completato", "completata", "done", "completed"].includes(normalizeStatus(item.status))) continue;
            this.db.prepare(
              "UPDATE board_items SET previous_group_id = CASE WHEN group_id = ? THEN previous_group_id ELSE group_id END, group_id = ? WHERE id = ?"
            ).run(completedGroup.id, completedGroup.id, item.id);
          }
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  load() {
    const boards = this.db.prepare("SELECT id, name, description FROM boards ORDER BY position, rowid").all();
    const columns = this.db.prepare(
      "SELECT id, board_id AS boardId, name, type, role, position, options_json AS optionsJson FROM board_columns ORDER BY position, rowid"
    ).all();
    const groups = this.db.prepare(
      "SELECT id, board_id AS boardId, name, color, position, kind FROM task_groups ORDER BY position, rowid"
    ).all();
    const items = this.db.prepare(
      "SELECT id, board_id AS boardId, group_id AS groupId, name, position, previous_group_id AS previousGroupId FROM board_items ORDER BY position, rowid"
    ).all();
    const cells = this.db.prepare(
      "SELECT item_id AS itemId, column_id AS columnId, value FROM item_cells ORDER BY rowid"
    ).all();
    const cellMaps = new Map(items.map((item) => [item.id, {}]));
    for (const cell of cells) Object.assign(cellMaps.get(cell.itemId), { [cell.columnId]: cell.value });

    const workspaceBoards = boards.map((board) => ({
      ...board,
      columns: columns.filter((column) => column.boardId === board.id).map((column) => ({
        id: column.id,
        name: column.name,
        type: column.type,
        role: column.role,
        position: column.position,
        options: JSON.parse(column.optionsJson)
      })),
      groups: groups.filter((group) => group.boardId === board.id).map(({ boardId, ...group }) => group),
      items: items.filter((item) => item.boardId === board.id).map(({ boardId, ...item }) => ({
        ...item,
        cells: cellMaps.get(item.id)
      }))
    }));
    const activeBoardId = this.db.prepare(
      "SELECT active_board_id AS activeBoardId FROM workspace_metadata WHERE id = 1"
    ).get()?.activeBoardId;
    return {
      activeBoardId: workspaceBoards.some((board) => board.id === activeBoardId)
        ? activeBoardId
        : (workspaceBoards[0]?.id ?? ""),
      boards: workspaceBoards
    };
  }

  save(workspace) {
    if (!workspace || !Array.isArray(workspace.boards) || workspace.boards.length > 100) {
      throw new TypeError("Lo spazio di lavoro non è valido.");
    }

    const boardIds = new Set();
    const columnIds = new Set();
    const groupIds = new Set();
    const itemIds = new Set();
    for (const board of workspace.boards) {
      requireId(board.id, "L'ID della scheda");
      requireText(board.name, "Il nome della scheda");
      if (boardIds.has(board.id)) throw new TypeError("L'ID della scheda è duplicato.");
      boardIds.add(board.id);
      if (!Array.isArray(board.columns) || board.columns.length > 50 ||
          !Array.isArray(board.groups) || board.groups.length > 200 ||
          !Array.isArray(board.items) || board.items.length > 10000) {
        throw new TypeError("Le colonne, i gruppi o gli elementi della scheda non sono validi.");
      }

      const nameColumns = board.columns.filter((column) => column.type === "name");
      if (nameColumns.length !== 1) throw new TypeError("Ogni scheda deve contenere una sola colonna Elemento.");

      for (const column of board.columns) {
        requireId(column.id, "L'ID della colonna");
        requireText(column.name, "Il nome della colonna");
        if (!COLUMN_TYPES.has(column.type) || columnIds.has(column.id) ||
            (column.role && column.role !== "priority") ||
            (column.role === "priority" && column.type !== "status")) {
          throw new TypeError("Il tipo o l'ID della colonna non è valido.");
        }
        columnIds.add(column.id);
        if (!Array.isArray(column.options) || column.options.some((option) => typeof option !== "string")) {
          throw new TypeError("Le opzioni della colonna non sono valide.");
        }
        if (column.role === "priority" && JSON.stringify(column.options) !== JSON.stringify(PRIORITY_OPTIONS)) {
          throw new TypeError("Le opzioni della priorità non sono valide.");
        }
      }

      const completedGroups = board.groups.filter((group) => group.kind === "completed");
      if (completedGroups.length !== 1) throw new TypeError("Ogni tabella deve contenere una sola sezione Completate.");
      if (!board.groups.some((group) => group.kind !== "completed")) {
        throw new TypeError("Ogni tabella deve contenere almeno un gruppo attivo.");
      }
      for (const group of board.groups) {
        requireId(group.id, "L'ID del gruppo");
        requireText(group.name, "Il nome del gruppo");
        if (groupIds.has(group.id) || !["active", "completed"].includes(group.kind)) throw new TypeError("Il gruppo non è valido.");
        groupIds.add(group.id);
      }

      const boardGroupIds = new Set(board.groups.map((group) => group.id));
      const boardColumnIds = new Set(board.columns.map((column) => column.id));
      for (const item of board.items) {
        requireId(item.id, "L'ID dell'elemento");
        requireText(item.name, "Il nome dell'elemento");
        if (itemIds.has(item.id) || !boardGroupIds.has(item.groupId) ||
            (item.previousGroupId && !boardGroupIds.has(item.previousGroupId)) ||
            !item.cells || typeof item.cells !== "object") {
          throw new TypeError("Un elemento della scheda non è valido.");
        }
        itemIds.add(item.id);
        for (const [columnId, value] of Object.entries(item.cells)) {
          if (!boardColumnIds.has(columnId) || typeof value !== "string" || value.length > 2000) {
            throw new TypeError("Una cella contiene dati non validi.");
          }
        }
      }
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("DELETE FROM boards");
      const insertBoard = this.db.prepare("INSERT INTO boards (id, name, description, position) VALUES (?, ?, ?, ?)");
      const insertColumn = this.db.prepare(
        "INSERT INTO board_columns (id, board_id, name, type, role, position, options_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      const insertGroup = this.db.prepare(
        "INSERT INTO task_groups (id, board_id, name, color, position, kind) VALUES (?, ?, ?, ?, ?, ?)"
      );
      const insertItem = this.db.prepare(
        "INSERT INTO board_items (id, board_id, group_id, name, position, previous_group_id) VALUES (?, ?, ?, ?, ?, ?)"
      );
      const insertCell = this.db.prepare(
        "INSERT INTO item_cells (item_id, column_id, value) VALUES (?, ?, ?)"
      );

      for (const [boardPosition, board] of workspace.boards.entries()) {
        insertBoard.run(board.id, board.name.trim(), String(board.description ?? ""), boardPosition);
        for (const [position, column] of board.columns.entries()) {
          insertColumn.run(column.id, board.id, column.name.trim(), column.type, column.role || "", position, JSON.stringify(column.options));
        }
        for (const [position, group] of board.groups.entries()) {
          insertGroup.run(group.id, board.id, group.name.trim(), group.color || "#5b9df5", position, group.kind);
        }
        for (const [position, item] of board.items.entries()) {
          insertItem.run(item.id, board.id, item.groupId, item.name.trim(), position, item.previousGroupId || "");
          for (const [columnId, value] of Object.entries(item.cells)) {
            insertCell.run(item.id, columnId, value);
          }
        }
      }
      const activeBoardId = boardIds.has(workspace.activeBoardId)
        ? workspace.activeBoardId
        : (workspace.boards[0]?.id ?? null);
      this.db.prepare(`
        INSERT INTO workspace_metadata (id, active_board_id, initialized) VALUES (1, ?, 1)
        ON CONFLICT(id) DO UPDATE SET active_board_id = excluded.active_board_id, initialized = 1
      `).run(activeBoardId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return true;
  }

  close() {
    this.db.close();
  }
}

function normalizeStatus(value) {
  return String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLocaleLowerCase("it");
}

function translateDefaultStatus(value) {
  const status = normalizeStatus(value);
  if (["non iniziato", "da fare", "por hacer", "planned"].includes(status)) return "Non iniziato";
  if (["in lavorazione", "in svolgimento", "en progreso", "working", "in progress"].includes(status)) return "In lavorazione";
  if (["finito", "fatto", "completato", "completado", "completada", "completed", "done"].includes(status)) return "Finito";
  return "";
}

module.exports = { WorkspaceDatabase, createStarterWorkspace, PRIORITY_OPTIONS, normalizeStatus, translateDefaultStatus };
