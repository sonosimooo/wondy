const STATUS_COLORS = ["#858b99", "#edb34e", "#36b681", "#6f8de8", "#ea8585", "#a082dc"];
const GROUP_COLORS = ["#5b9df5", "#44bd91", "#ffba62", "#a082dc", "#ea8585", "#40a5a9"];
const PRIORITY_OPTIONS = ["Bassa", "Media", "Alta"];
let state = null;
let activeStatusFilter = "";
let alphabeticalSort = false;
let toastTimeout = 0;
let updateBusy = false;

const ui = {
  navigation: document.querySelector("#board-navigation"),
  title: document.querySelector("#board-title"),
  description: document.querySelector("#board-description"),
  breadcrumb: document.querySelector("#breadcrumb-board"),
  view: document.querySelector("#board-view"),
  search: document.querySelector("#search-input"),
  statusFilter: document.querySelector("#status-filter"),
  appVersion: document.querySelector("#app-version"),
  appUpdateStatus: document.querySelector("#app-update-status"),
  checkUpdates: document.querySelector("#check-updates-button"),
  toast: document.querySelector("#toast"),
  boardDialog: document.querySelector("#board-dialog"),
  boardForm: document.querySelector("#board-form"),
  columnDialog: document.querySelector("#column-dialog"),
  columnForm: document.querySelector("#column-form")
};

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function board() {
  return state.boards.find((entry) => entry.id === state.activeBoardId) || state.boards[0];
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function button(className, text, label, action) {
  const node = element("button", className, text);
  node.type = "button";
  node.setAttribute("aria-label", label);
  if (action) node.addEventListener("click", action);
  return node;
}

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLabel(value) {
  return String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLocaleLowerCase("it");
}

function isCompletedStatus(value) {
  return ["finito", "fatto", "completato", "completata", "done", "completed"].includes(normalizeLabel(value));
}

function statusColorClass(value) {
  const status = normalizeLabel(value);
  if (isCompletedStatus(value)) return "state-completed";
  if (status.includes("lavor") || status.includes("svolg") || status.includes("corso") || status.includes("progress") || status.includes("progres")) {
    return "state-in-progress";
  }
  if (status.includes("inizi") || status.includes("da fare") || status.includes("pending") || status.includes("todo")) {
    return "state-not-started";
  }
  return "state-not-started";
}

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => ui.toast.classList.remove("visible"), 2800);
}

async function saveOrRestore(previous, message) {
  try {
    await window.wondy.saveWorkspace(state);
    render();
    if (message) toast(message);
    return true;
  } catch (error) {
    console.error("Impossibile salvare le modifiche della tabella.", error);
    state = previous;
    render();
    toast("Errore di salvataggio: le modifiche non sono state applicate.");
    return false;
  }
}

async function mutate(change, message = "") {
  const previous = deepCopy(state);
  try {
    change();
    return await saveOrRestore(previous, message);
  } catch (error) {
    console.error("Impossibile modificare la tabella.", error);
    state = previous;
    render();
    toast(error instanceof Error ? error.message : "Impossibile completare l'operazione.");
    return false;
  }
}

function render() {
  if (!state?.boards?.length) {
    ui.title.textContent = "Le tue tabelle";
    ui.description.textContent = "Crea la tua prima tabella per organizzare il lavoro.";
    ui.breadcrumb.textContent = "Nessuna tabella";
    ui.navigation.replaceChildren();
    ui.view.replaceChildren();
    return;
  }
  const current = board();
  state.activeBoardId = current.id;
  ui.title.textContent = current.name;
  ui.description.textContent = current.description || "Organizza il lavoro del tuo team in un unico posto.";
  ui.breadcrumb.textContent = current.name;
  renderNavigation();
  renderFilter(current);
  renderGroups(current);
}

function renderNavigation() {
  ui.navigation.replaceChildren();
  for (const entry of state.boards) {
    const item = button(`board-link${entry.id === state.activeBoardId ? " selected" : ""}`, "", `Apri la tabella ${entry.name}`, async () => {
      const previousBoardId = state.activeBoardId;
      state.activeBoardId = entry.id;
      try {
        await window.wondy.saveWorkspace(state);
        render();
      } catch (error) {
        state.activeBoardId = previousBoardId;
        render();
        console.error("Impossibile salvare la tabella attiva.", error);
        toast("Impossibile aprire la tabella. Riprova.");
      }
    });
    item.append(element("span", "board-link-icon", "▤"), element("span", "board-link-name", entry.name));
    ui.navigation.append(item);
  }
}

function availableStatuses(current) {
  return [...new Set(current.columns
    .filter((column) => column.type === "status" && column.role !== "priority")
    .flatMap((column) => column.options))];
}

function renderFilter(current) {
  const previousValue = activeStatusFilter;
  const options = availableStatuses(current);
  if (!options.includes(activeStatusFilter)) activeStatusFilter = "";
  ui.statusFilter.replaceChildren(new Option("Tutti", ""));
  for (const status of options) ui.statusFilter.add(new Option(status, status));
  ui.statusFilter.value = options.includes(previousValue) ? previousValue : "";
}

function matchesSearch(item, current) {
  const query = ui.search.value.trim().toLocaleLowerCase("it");
  if (!query) return true;
  const values = [item.name, ...Object.values(item.cells)];
  return values.some((value) => String(value).toLocaleLowerCase("it").includes(query));
}

function filteredItems(items, current) {
  const matching = items.filter((item) =>
    matchesSearch(item, current) &&
    (!activeStatusFilter || Object.entries(item.cells).some(([columnId, value]) =>
      current.columns.some((column) => column.id === columnId && column.type === "status" && column.role !== "priority") && value === activeStatusFilter
    ))
  );
  if (alphabeticalSort) matching.sort((first, second) => first.name.localeCompare(second.name, "it"));
  return matching;
}

function renderGroups(current) {
  ui.view.replaceChildren();
  if (current.columns.filter((column) => column.type === "name").length !== 1) {
    ui.view.append(element("div", "empty-state", "La tabella non è valida. Riaprila per ripristinare le colonne."));
    return;
  }
  for (const group of current.groups) {
    ui.view.append(renderGroup(group, current));
  }
  if (current.groups.length === 0) {
    const empty = element("div", "empty-state");
    empty.append(element("strong", "", "Nessun gruppo"), element("span", "", "Crea un gruppo per aggiungere elementi."));
    ui.view.append(empty);
  }
}

function renderGroup(group, current) {
  const isCompletedGroup = group.kind === "completed";
  const section = element("section", `task-group${isCompletedGroup ? " is-completed-group" : ""}`);
  const header = element("div", "group-header");
  const disclosure = button("group-disclosure", "⌄", `Comprimi il gruppo ${group.name}`, () => {
    const table = section.querySelector(".table-wrap");
    table.hidden = !table.hidden;
    disclosure.textContent = table.hidden ? "›" : "⌄";
    disclosure.setAttribute("aria-expanded", String(!table.hidden));
  });
  const accent = element("span", "group-accent");
  accent.style.backgroundColor = group.color;
  const title = element("h2", "group-title", group.name);
  const visible = filteredItems(current.items.filter((item) => item.groupId === group.id), current);
  const count = element("span", "group-count", String(visible.length));
  const groupActions = element("div", "group-actions");
  if (!isCompletedGroup) {
    groupActions.append(
      button("icon-button", "＋", `Aggiungi un elemento a ${group.name}`, () => addRow(group.id)),
      button("icon-button group-more", "···", `Rinomina o elimina il gruppo ${group.name}`, async () => manageGroup(group))
    );
  }
  header.append(disclosure, accent, title, count, groupActions);
  section.append(header, createTable(group, current, visible));
  return section;
}

function createTable(group, current, items) {
  const wrapper = element("div", "table-wrap");
  const table = element("table", "task-table");
  const head = document.createElement("thead");
  const headingRow = document.createElement("tr");
  const nameColumn = current.columns.find((column) => column.type === "name");
  for (const column of current.columns) {
    const cell = document.createElement("th");
    cell.scope = "col";
    if (column.id === nameColumn.id) {
      const heading = element("div", "column-heading");
      heading.append(element("span", "column-heading-text", column.name));
      heading.append(button("column-menu", "···", "Gestisci la colonna Elemento", () => manageColumn(column)));
      cell.append(heading);
    } else {
      const heading = element("div", "column-heading");
      heading.append(element("span", "column-type-icon", columnIcon(column)), element("span", "column-heading-text", column.name));
      heading.append(button("column-menu", "···", `Rinomina o rimuovi la colonna ${column.name}`, () => manageColumn(column)));
      cell.append(heading);
    }
    headingRow.append(cell);
  }
  const addColumnHeader = document.createElement("th");
  addColumnHeader.className = "add-column-cell";
  addColumnHeader.scope = "col";
  addColumnHeader.append(button("add-column-button", "＋", "Aggiungi una colonna", openColumnDialog));
  headingRow.append(addColumnHeader);
  head.append(headingRow);

  const body = document.createElement("tbody");
  for (const item of items) {
    const row = document.createElement("tr");
    row.dataset.itemId = item.id;
    if (group.kind === "completed") row.className = "completed-item";
    for (const column of current.columns) {
      const cell = document.createElement("td");
      cell.dataset.type = column.role === "priority" ? "priority" : column.type;
      if (column.type === "name") {
        const content = element("div", "item-name-content");
        const marker = element("span", "item-marker", "");
        marker.style.backgroundColor = group.color;
        const input = document.createElement("input");
        input.className = "item-name-input";
        input.dataset.itemId = item.id;
        input.type = "text";
        input.value = item.name;
        input.maxLength = 200;
        input.setAttribute("aria-label", "Nome dell'elemento");
        input.addEventListener("change", () => updateItemName(item, input.value));
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") input.blur();
        });
        content.append(marker, input, button("delete-item-button", "×", `Elimina ${item.name}`, () => deleteItem(item)));
        cell.append(content);
      } else {
        cell.append(renderCell(item, column));
      }
      row.append(cell);
    }
    const removeAction = document.createElement("td");
    removeAction.className = "row-action-cell";
    row.append(removeAction);
    body.append(row);
  }
  if (items.length === 0) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = current.columns.length + 1;
    emptyCell.className = "group-empty";
    emptyCell.textContent = ui.search.value || activeStatusFilter
      ? "Nessun elemento corrisponde ai filtri."
      : group.kind === "completed" ? "Nessun elemento completato." : "Questo gruppo è vuoto.";
    emptyRow.append(emptyCell);
    body.append(emptyRow);
  }
  if (group.kind !== "completed") {
    const addRow = document.createElement("tr");
    const addCell = document.createElement("td");
    addCell.colSpan = current.columns.length + 1;
    const addButton = button("add-item-in-group", "＋ Aggiungi un elemento", `Aggiungi un elemento a ${group.name}`, () => addRowForGroup(group.id));
    addCell.append(addButton);
    addRow.append(addCell);
    body.append(addRow);
  }
  table.append(head, body);
  wrapper.append(table);
  return wrapper;
}

function columnIcon(column) {
  if (column.role === "priority") return "◆";
  return { text: "T", person: "♙", status: "●", date: "▦" }[column.type] || "T";
}

function renderCell(item, column) {
  const cellValue = item.cells[column.id] || "";
  if (column.type === "status") {
    if (column.role === "priority") return renderPriority(item, column, cellValue);
    const select = document.createElement("select");
    select.className = "status-select";
    select.setAttribute("aria-label", `${column.name} per ${item.name}`);
    select.add(makeStateOption("Seleziona stato", ""));
    for (const option of column.options) select.add(makeStateOption(option, option, column.options));
    select.value = cellValue;
    select.addEventListener("change", () => updateCell(item, column, select.value));
    colorStatus(select, cellValue, column.options);
    return select;
  }
  if (column.type === "date") {
    const container = element("div", "deadline-cell");
    const isCompleted = board().groups.some((group) => group.id === item.groupId && group.kind === "completed");
    const deadline = describeDeadline(cellValue, isCompleted);
    if (deadline) {
      const wheel = element("span", "deadline-wheel");
      wheel.style.setProperty("--deadline-progress", `${deadline.progress}%`);
      wheel.style.setProperty("--deadline-color", deadline.color);
      wheel.setAttribute("role", "img");
      wheel.setAttribute("aria-label", deadline.description);
      wheel.title = deadline.description;
      container.append(wheel);
    }
    const input = document.createElement("input");
    input.type = "date";
    input.className = "cell-input date-input";
    input.value = cellValue;
    input.setAttribute("aria-label", `${column.name} per ${item.name}`);
    if (deadline) input.title = deadline.description;
    input.addEventListener("change", () => updateCell(item, column, input.value));
    container.append(input);
    return container;
  }
  const input = document.createElement("input");
  input.type = "text";
  input.className = `cell-input${column.type === "person" ? " person-input" : ""}`;
  input.value = cellValue;
  input.maxLength = 200;
  input.placeholder = column.type === "person" ? "Assegna persona" : "—";
  input.setAttribute("aria-label", `${column.name} per ${item.name}`);
  input.addEventListener("change", () => updateCell(item, column, input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
  });
  return input;
}

function colorStatus(select, value, options) {
  const colorIndex = getStatusColorIndex(value, options);
  const colorClass = statusColorClass(value);
  select.className = `status-select ${colorClass}${value ? "" : " is-empty"}`;
  select.style.setProperty("--status-color", value ? STATUS_COLORS[colorIndex] : "#f0f0f3");
}

function getStatusColorIndex(value, options) {
  const colorClass = statusColorClass(value);
  if (colorClass === "state-in-progress") return 1;
  if (colorClass === "state-completed") return 2;
  const index = options.indexOf(value);
  return Math.max(0, index < 0 ? 0 : index % 3);
}

function makeStateOption(label, value, options = []) {
  const option = new Option(label, value);
  if (value) {
    option.style.backgroundColor = STATUS_COLORS[getStatusColorIndex(value, options)];
    option.style.color = "#fff";
  }
  return option;
}

function priorityClass(value) {
  const priority = normalizeLabel(value);
  if (priority === "alta" || priority === "high" || priority === "elevata") return "priority-high";
  if (priority === "media" || priority === "medium") return "priority-medium";
  if (priority === "bassa" || priority === "low") return "priority-low";
  return "priority-empty";
}

function renderPriority(item, column, value) {
  const select = document.createElement("select");
  select.className = `priority-select ${priorityClass(value)}`;
  select.setAttribute("aria-label", `${column.name} per ${item.name}`);
  select.add(makeStateOption("Seleziona priorità", ""));
  for (const option of column.options) select.add(makePriorityOption(option));
  select.value = value;
  select.addEventListener("change", () => updateCell(item, column, select.value));
  return select;
}

function makePriorityOption(value) {
  const option = new Option(value, value);
  const color = { Bassa: "#62c6ed", Media: "#319bd7", Alta: "#12629c" }[value];
  if (color) {
    option.style.backgroundColor = color;
    option.style.color = "#fff";
  }
  return option;
}

function describeDeadline(value, completed = false) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  const due = new Date(year, month - 1, day);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysRemaining = Math.round((due.getTime() - today.getTime()) / 86400000);
  const progress = Math.max(0, Math.min(100, Math.round((1 - daysRemaining / 14) * 100)));
  const overdue = daysRemaining < 0;
  const dueDescription = overdue
    ? `Scadenza superata da ${Math.abs(daysRemaining)} giorni`
    : daysRemaining === 0
      ? "Scade oggi"
      : daysRemaining === 1
        ? "Scade domani"
        : `Scade fra ${daysRemaining} giorni`;
  const description = completed ? `Elemento completato · ${dueDescription}` : dueDescription;
  return {
    progress: completed ? 100 : progress,
    description,
    color: completed ? "#9aa0ab" : overdue ? "#d75b65" : daysRemaining <= 3 ? "#e5a041" : "#32ad7c"
  };
}

async function updateCell(item, column, value) {
  await mutate(() => {
    item.cells[column.id] = value;
    if (column.type !== "status" || column.role === "priority") return;
    const current = board();
    const statusColumn = current.columns.find((entry) => entry.type === "status" && entry.role !== "priority");
    if (column.id !== statusColumn?.id) return;
    const completedGroup = current.groups.find((group) => group.kind === "completed");
    if (!completedGroup) throw new Error("Non è stata trovata la sezione Completate.");
    if (isCompletedStatus(value)) {
      if (item.groupId !== completedGroup.id) {
        item.previousGroupId = item.groupId;
        item.groupId = completedGroup.id;
      }
    } else if (item.groupId === completedGroup.id) {
      const activeGroups = current.groups.filter((group) => group.kind !== "completed");
      const returnGroup = activeGroups.find((group) => group.id === item.previousGroupId) || activeGroups[0];
      if (!returnGroup) throw new Error("Aggiungi un gruppo prima di riaprire l'elemento.");
      item.groupId = returnGroup.id;
      item.previousGroupId = "";
    }
  });
}

async function updateItemName(item, value) {
  const name = value.trim();
  if (!name) {
    render();
    toast("Il nome dell'elemento non può essere vuoto.");
    return;
  }
  if (name === item.name) return;
  await mutate(() => {
    item.name = name;
  }, "Elemento aggiornato");
}

async function addRow(groupId) {
  const current = board();
  const group = current.groups.find((entry) => entry.id === groupId);
  if (!group || group.kind === "completed") {
    toast("Gli elementi nuovi vanno aggiunti a un gruppo attivo.");
    return;
  }
  const nameColumn = current.columns.find((column) => column.type === "name");
  const initialCells = Object.fromEntries(current.columns
    .filter((column) => column.type !== "name")
    .map((column) => {
      if (column.role === "priority") {
        return [column.id, column.options.find((option) => normalizeLabel(option) === "media") || ""];
      }
      if (column.type === "status") {
        return [column.id, column.options.find((option) => statusColorClass(option) === "state-not-started") || ""];
      }
      return [column.id, ""];
    }));
  const entry = {
    id: createId("item"),
    groupId,
    name: "Nuovo elemento",
    position: current.items.length,
    previousGroupId: "",
    cells: initialCells
  };
  await mutate(() => current.items.push(entry), "Elemento aggiunto");
  const field = ui.view.querySelector(`.item-name-input[data-item-id="${entry.id}"]`);
  if (field && nameColumn) {
    field.focus();
    field.select();
  }
}

async function addRowForGroup(groupId) {
  await addRow(groupId);
}

async function deleteItem(item) {
  if (!window.confirm(`Vuoi eliminare "${item.name}"?`)) return;
  await mutate(() => {
    const current = board();
    current.items = current.items.filter((entry) => entry.id !== item.id);
  }, "Elemento eliminato");
}

async function addGroup() {
  const current = board();
  const number = current.groups.length + 1;
  const name = window.prompt("Nome del nuovo gruppo:", `Gruppo ${number}`);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return toast("Inserisci il nome del gruppo.");
  await mutate(() => current.groups.push({
    id: createId("group"),
    name: trimmed,
    color: GROUP_COLORS[current.groups.length % GROUP_COLORS.length],
    position: current.groups.length,
    kind: "active"
  }), "Gruppo creato");
}

async function manageGroup(group) {
  if (group.kind === "completed") {
    toast("La sezione Completate è fissa e non può essere rinominata o eliminata.");
    return;
  }
  const action = window.prompt(`Modifica "${group.name}": inserisci un nuovo nome oppure scrivi ELIMINA per rimuoverlo.`);
  if (action === null) return;
  if (action.trim().toLocaleLowerCase("it") === "elimina") {
    if (board().groups.filter((entry) => entry.kind !== "completed").length <= 1) {
      toast("Mantieni almeno un gruppo attivo nella tabella.");
      return;
    }
    if (!window.confirm(`Eliminare il gruppo "${group.name}" e tutti i suoi elementi?`)) return;
    await mutate(() => {
      const current = board();
      current.groups = current.groups.filter((entry) => entry.id !== group.id);
      current.items = current.items.filter((item) => item.groupId !== group.id);
      for (const item of current.items) {
        if (item.previousGroupId === group.id) item.previousGroupId = current.groups.find((entry) => entry.kind !== "completed")?.id || "";
      }
    }, "Gruppo eliminato");
    return;
  }
  const name = action.trim();
  if (!name) return toast("Il nome del gruppo non può essere vuoto.");
  await mutate(() => {
    board().groups.find((entry) => entry.id === group.id).name = name;
  }, "Gruppo rinominato");
}

function manageColumn(column) {
  if (column.type === "name") {
    const name = window.prompt("Nome della colonna degli elementi:", column.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return toast("Il nome della colonna non può essere vuoto.");
    mutate(() => {
      board().columns.find((entry) => entry.id === column.id).name = trimmed;
    }, "Colonna rinominata");
    return;
  }
  const action = window.prompt(`Modifica "${column.name}": inserisci un nuovo nome oppure scrivi ELIMINA per rimuovere la colonna.`);
  if (action === null) return;
  if (action.trim().toLocaleLowerCase("it") === "elimina") {
    if (!window.confirm(`Eliminare la colonna "${column.name}" e i relativi valori?`)) return;
    mutate(() => {
      const current = board();
      current.columns = current.columns.filter((entry) => entry.id !== column.id);
      for (const item of current.items) delete item.cells[column.id];
    }, "Colonna eliminata");
    return;
  }
  const name = action.trim();
  if (!name) return toast("Il nome della colonna non può essere vuoto.");
  mutate(() => {
    board().columns.find((entry) => entry.id === column.id).name = name;
  }, "Colonna rinominata");
}

function openColumnDialog() {
  ui.columnForm.reset();
  document.querySelector("#status-options").value = "Non iniziato\nIn lavorazione\nFinito";
  document.querySelector("#status-options-field").hidden = true;
  ui.columnDialog.showModal();
  document.querySelector("#column-name").focus();
}

async function createColumn(event) {
  event.preventDefault();
  if (!ui.columnForm.reportValidity()) return;
  const values = new FormData(ui.columnForm);
  const name = String(values.get("name")).trim();
  const requestedType = String(values.get("type"));
  const role = requestedType === "priority" ? "priority" : "";
  const type = role === "priority" ? "status" : requestedType;
  const options = role === "priority"
    ? [...PRIORITY_OPTIONS]
    : type === "status"
    ? String(values.get("options")).split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
    : [];
  if (!name) return toast("Inserisci il nome della colonna.");
  if (type === "status" && options.length < 2) return toast("Aggiungi almeno due opzioni di stato.");
  if (type === "status" && new Set(options).size !== options.length) return toast("Le opzioni di stato non possono essere ripetute.");

  const current = board();
  if (current.columns.length >= 50) return toast("Una tabella può contenere al massimo 50 colonne.");
  if (role === "priority" && current.columns.some((column) => column.role === "priority")) {
    return toast("Questa tabella ha già una colonna Priorità.");
  }
  const column = { id: createId("column"), name, type, role, position: current.columns.length, options };
  for (const item of current.items) item.cells[column.id] = "";
  const saved = await mutate(() => current.columns.push(column), "Colonna aggiunta");
  if (saved) ui.columnDialog.close();
}

function showStatusOptions() {
  const statusField = document.querySelector("#status-options-field");
  statusField.hidden = !["status", "priority"].includes(document.querySelector("#column-type").value);
  const label = statusField.querySelector(".field-label");
  if (document.querySelector("#column-type").value === "priority") {
    label.firstChild.textContent = "Livelli di priorità ";
    document.querySelector("#status-options").value = PRIORITY_OPTIONS.join("\n");
    document.querySelector("#status-options").readOnly = true;
  } else {
    label.firstChild.textContent = "Opzioni degli stati ";
    document.querySelector("#status-options").value = "Non iniziato\nIn lavorazione\nFinito";
    document.querySelector("#status-options").readOnly = false;
  }
}

function openBoardDialog() {
  ui.boardForm.reset();
  ui.boardDialog.showModal();
  document.querySelector("#board-name").focus();
}

async function createBoard(event) {
  event.preventDefault();
  if (!ui.boardForm.reportValidity()) return;
  const values = new FormData(ui.boardForm);
  const name = String(values.get("name")).trim();
  if (!name) return toast("Inserisci il nome della tabella.");
  const columnId = createId("column");
  const statusColumnId = createId("column");
  const priorityColumnId = createId("column");
  const deadlineColumnId = createId("column");
  const nameColumnId = createId("column");
  const entry = {
    id: createId("board"),
    name,
    description: String(values.get("description")).trim(),
    columns: [
      { id: nameColumnId, name: "Elemento", type: "name", role: "", position: 0, options: [] },
      { id: columnId, name: "Persona", type: "person", role: "", position: 1, options: [] },
      { id: statusColumnId, name: "Stato", type: "status", role: "", position: 2, options: ["Non iniziato", "In lavorazione", "Finito"] },
      { id: priorityColumnId, name: "Priorità", type: "status", role: "priority", position: 3, options: [...PRIORITY_OPTIONS] },
      { id: deadlineColumnId, name: "Scadenza", type: "date", role: "", position: 4, options: [] }
    ],
    groups: [
      { id: createId("group"), name: "Gruppo 1", color: GROUP_COLORS[state.boards.length % GROUP_COLORS.length], position: 0, kind: "active" },
      { id: createId("group"), name: "Completate", color: "#36b681", position: 1, kind: "completed" }
    ],
    items: []
  };
  const saved = await mutate(() => {
    state.boards.push(entry);
    state.activeBoardId = entry.id;
  }, "Tabella creata");
  if (saved) ui.boardDialog.close();
}

async function renameBoard() {
  const current = board();
  const name = window.prompt("Nome della tabella:", current.name);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return toast("Il nome della tabella non può essere vuoto.");
  await mutate(() => {
    current.name = trimmed;
  }, "Tabella rinominata");
}

async function manageBoard() {
  const current = board();
  const action = window.prompt(`Gestisci "${current.name}": inserisci un nuovo nome oppure scrivi ELIMINA per rimuovere la tabella.`);
  if (action === null) return;
  if (action.trim().toLocaleLowerCase("it") === "elimina") {
    await deleteBoard();
    return;
  }
  const name = action.trim();
  if (!name) return toast("Il nome della tabella non può essere vuoto.");
  await mutate(() => {
    board().name = name;
  }, "Tabella rinominata");
}

async function deleteBoard() {
  const current = board();
  if (state.boards.length === 1) {
    toast("Non puoi eliminare l'ultima tabella. Creane un'altra prima.");
    return;
  }
  if (!window.confirm(`Eliminare la tabella "${current.name}" e tutti i suoi dati?`)) return;
  await mutate(() => {
    state.boards = state.boards.filter((entry) => entry.id !== current.id);
    state.activeBoardId = state.boards[0].id;
  }, "Tabella eliminata");
}

document.querySelector("#add-board-button").addEventListener("click", openBoardDialog);
document.querySelector("#sidebar-add-board-button").addEventListener("click", openBoardDialog);
document.querySelector("#add-row-button").addEventListener("click", () => {
  const current = board();
  if (current.groups.length === 0) return toast("Aggiungi un gruppo prima di creare un elemento.");
  addRow(current.groups[0].id);
});
document.querySelector("#board-add-row-button").addEventListener("click", () => {
  const current = board();
  if (current.groups.length === 0) return toast("Aggiungi un gruppo prima di creare un elemento.");
  addRow(current.groups[0].id);
});
document.querySelector("#add-group-button").addEventListener("click", addGroup);
document.querySelector("#rename-board-button").addEventListener("click", manageBoard);
document.querySelector("#rename-board-action").addEventListener("click", renameBoard);
document.querySelector("#column-type").addEventListener("change", showStatusOptions);
ui.columnForm.addEventListener("submit", createColumn);
ui.boardForm.addEventListener("submit", createBoard);
ui.search.addEventListener("input", () => renderGroups(board()));
ui.checkUpdates.addEventListener("click", async () => {
  ui.checkUpdates.disabled = true;
  ui.appUpdateStatus.textContent = "Avvio del controllo degli aggiornamenti…";
  try {
    const result = await window.wondy.checkForUpdates();
    if (result?.status === "checking" || result?.status === "available") {
      ui.appUpdateStatus.textContent = "Controllo avviato. Ti avviseremo quando sarà disponibile un aggiornamento.";
    } else if (result?.status === "downloaded") {
      ui.appUpdateStatus.textContent = `Wondy ${result.version} è pronto da installare.`;
    } else if (result?.status === "error") {
      ui.appUpdateStatus.textContent = "Controllo non riuscito. Riprova tra poco.";
    } else if (result?.status === "unavailable-in-development") {
      ui.appUpdateStatus.textContent = "Gli aggiornamenti sono disponibili nell'app installata.";
    }
  } catch (error) {
    console.error("Impossibile avviare il controllo aggiornamenti dalla schermata.", error);
    ui.appUpdateStatus.textContent = "Impossibile avviare il controllo. Riprova.";
  } finally {
    ui.checkUpdates.disabled = updateBusy;
  }
});
if (window.wondy?.onUpdateStatus) {
  window.wondy.onUpdateStatus(({ status, message, progress }) => {
    ui.appUpdateStatus.textContent = typeof message === "string" ? message : "";
    updateBusy = status === "downloading" || status === "installing";
    ui.checkUpdates.textContent = status === "downloading" && Number.isFinite(progress)
      ? `Download ${progress}%`
      : status === "installing"
        ? "Riavvio…"
        : "Controlla gli aggiornamenti";
    ui.checkUpdates.disabled = updateBusy;
  });
}
ui.statusFilter.addEventListener("change", () => {
  activeStatusFilter = ui.statusFilter.value;
  renderGroups(board());
});
document.querySelector("#sort-button").addEventListener("click", (event) => {
  alphabeticalSort = !alphabeticalSort;
  event.currentTarget.setAttribute("aria-pressed", String(alphabeticalSort));
  event.currentTarget.classList.toggle("toolbar-button-active", alphabeticalSort);
  event.currentTarget.lastChild.textContent = alphabeticalSort ? " Ordine originale" : " Ordina per nome";
  renderGroups(board());
});
document.querySelectorAll("[data-close-dialog]").forEach((closeButton) => {
  closeButton.addEventListener("click", () => closeButton.closest("dialog").close());
});
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});
window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("it") === "k") {
    event.preventDefault();
    ui.search.focus();
  }
});

async function initialize() {
  if (!window.wondy) {
    document.body.replaceChildren(element("main", "startup-error", "Impossibile collegarsi al database di Wondy. Chiudi e riapri l'applicazione."));
    throw new Error("L'API sicura del database non è disponibile.");
  }
  try {
    state = await window.wondy.loadWorkspace();
    try {
      const version = await window.wondy.getVersion();
      if (typeof version === "string" && /^\d+\.\d+\.\d+/.test(version)) {
        ui.appVersion.textContent = `Wondy versione ${version}`;
      }
    } catch (error) {
      console.error("Impossibile leggere la versione di Wondy.", error);
    }
    if (!state?.boards?.length) {
      ui.title.textContent = "Le tue tabelle";
      ui.description.textContent = "Crea la tua prima tabella per organizzare il lavoro.";
    }
    render();
  } catch (error) {
    console.error("Impossibile caricare il database di Wondy.", error);
    document.body.replaceChildren(element("main", "startup-error", "Impossibile aprire il database. Verifica di poter scrivere nella cartella dati dell'app e riavvia Wondy."));
  }
}

initialize();
