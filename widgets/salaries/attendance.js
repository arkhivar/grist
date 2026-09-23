// Reference editing for the extra Attendance columns in the salary view.
const salaryAttendanceOps = {
  getTableId: async () => WIDGET_CONFIG.classTableId,
  update: async (updates, options) => {
    const rows = Array.isArray(updates) ? updates : [updates];
    return grist.docApi.applyUserActions(rows.map(row =>
      ['UpdateRecord', WIDGET_CONFIG.classTableId, row.id, row.fields]), options);
  },
  create: async (record, options) => {
    const result = await grist.docApi.applyUserActions([
      ['AddRecord', WIDGET_CONFIG.classTableId, null, record.fields],
    ], options);
    return { id: result?.retValues?.[0] };
  },
  destroy: async ids => grist.docApi.applyUserActions(ids.map(id =>
    ['RemoveRecord', WIDGET_CONFIG.classTableId, id])),
};

function salaryTableOperations() {
  return salaryAttendanceOps;
}

async function salaryFetchClassRecord(recordId) {
  const table = await grist.docApi.fetchTable(WIDGET_CONFIG.classTableId);
  const index = (table.id || []).findIndex(id => Number(id) === Number(recordId));
  if (index < 0) throw new Error(`Attendance record ${recordId} is unavailable`);
  return Object.fromEntries(Object.entries(table).map(([col, values]) =>
    [col, Array.isArray(values) ? values[index] : undefined]));
}

const salaryRefEditor = document.getElementById('salary-ref-editor');
const salaryRefSearch = document.getElementById('salary-ref-search');
const salaryRefOptions = document.getElementById('salary-ref-options');
const salaryRefStatus = document.getElementById('salary-ref-status');
const salaryRefClear = document.getElementById('salary-ref-clear');
let salaryRefContext = null;
let salaryRefRequest = 0;
let salaryRefSaving = false;
const salaryRefLabels = new Map();

function salaryRefDisplay(col, id) {
  if (id == null || id === 0) return '';
  return salaryRefLabels.get(col)?.get(Number(id)) || String(id);
}

function closeSalaryRefEditor() {
  salaryRefRequest++;
  if (salaryRefContext?.anchor?.isConnected)
    salaryRefContext.anchor.setAttribute('aria-expanded', 'false');
  salaryRefContext = null;
  salaryRefEditor.hidden = true;
  salaryRefSearch.value = '';
  salaryRefOptions.replaceChildren();
  salaryRefStatus.textContent = '';
}

function positionSalaryRefEditor() {
  if (!salaryRefContext) return;
  const anchor = salaryRefContext.anchor;
  if (!anchor?.isConnected) { closeSalaryRefEditor(); return; }
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 16);
  salaryRefEditor.style.width = `${width}px`;
  salaryRefEditor.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  const height = salaryRefEditor.getBoundingClientRect().height || 260;
  const below = rect.bottom + height + 6 <= window.innerHeight;
  salaryRefEditor.style.top = `${Math.max(8, below ? rect.bottom + 6 : rect.top - height - 6)}px`;
}

function salaryReanchorRefEditor() {
  if (!salaryRefContext) return;
  const { recordId, col } = salaryRefContext;
  const anchor = [...content.querySelectorAll('button[data-edit-kind="reference"]')]
    .find(button => button.dataset.editId === String(recordId) && button.dataset.editCol === col);
  if (!anchor) { closeSalaryRefEditor(); return; }
  salaryRefContext.anchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  positionSalaryRefEditor();
}

function renderSalaryRefOptions() {
  if (!salaryRefContext) return;
  const query = salaryRefSearch.value.trim().toLocaleLowerCase();
  const matches = salaryRefContext.choices.filter(choice =>
    choice.label.toLocaleLowerCase().includes(query) || String(choice.id).includes(query));
  salaryRefOptions.replaceChildren();
  matches.slice(0, 80).forEach(choice => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'salary-ref-option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(choice.id === salaryRefContext.currentId));
    option.textContent = `${choice.label}  #${choice.id}`;
    option.addEventListener('click', () => saveSalaryRef(choice.id, choice.label));
    salaryRefOptions.appendChild(option);
  });
  salaryRefStatus.textContent = matches.length > 80
    ? `${matches.length} matches · type to narrow` : `${matches.length} matches`;
  positionSalaryRefEditor();
}

async function salaryRefChoices(col) {
  const refTable = String(columnTypes[col] || '').split(':')[1];
  if (!refTable) throw new Error(`Reference table is unknown for ${col}`);
  const [tables, columns, table] = await Promise.all([
    grist.docApi.fetchTable('_grist_Tables'),
    grist.docApi.fetchTable('_grist_Tables_column'),
    grist.docApi.fetchTable(refTable),
  ]);
  const tableIndex = (tables.tableId || []).indexOf(selectedTableId);
  const tableRef = tables.id?.[tableIndex];
  const sourceIndex = (columns.colId || []).findIndex((id, index) =>
    id === col && columns.parentId[index] === tableRef);
  const visibleId = columns.visibleCol?.[sourceIndex];
  const visibleIndex = (columns.id || []).indexOf(visibleId);
  const visibleCol = columns.colId?.[visibleIndex];
  const labelCol = visibleCol && Array.isArray(table[visibleCol]) ? visibleCol
    : ['Name', 'name', 'label', 'Label'].find(id => Array.isArray(table[id]));
  const choices = (table.id || []).map((id, index) => ({
    id: Number(id),
    label: labelCol && table[labelCol][index] != null && table[labelCol][index] !== ''
      ? String(table[labelCol][index]) : String(id),
  }));
  choices.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  salaryRefLabels.set(col, new Map(choices.map(choice => [choice.id, choice.label])));
  return choices;
}

async function openSalaryRefEditor(idStr, col, anchor) {
  closeSalaryRefEditor();
  const request = salaryRefRequest;
  salaryRefContext = {
    recordId: validRecordId(idStr), col, anchor, choices: [], currentId: 0,
  };
  salaryRefEditor.hidden = false;
  anchor?.setAttribute('aria-expanded', 'true');
  salaryRefStatus.textContent = 'Loading records…';
  positionSalaryRefEditor();
  salaryRefSearch.focus();
  try {
    const [choices, raw] = await Promise.all([
      salaryRefChoices(col),
      salaryFetchClassRecord(Number(idStr)),
    ]);
    if (request !== salaryRefRequest || !salaryRefContext) return;
    salaryRefContext.choices = choices;
    salaryRefContext.currentId = Number(normalizeTypedCell(raw[col])) || 0;
    renderSalaryRefOptions();
  } catch (error) {
    if (request === salaryRefRequest)
      salaryRefStatus.textContent = error.message || String(error);
  }
}

async function saveSalaryRef(id, label) {
  if (!salaryRefContext || cellHistoryBusy || salaryRefSaving) return;
  const { recordId, col, currentId } = salaryRefContext;
  if (id === currentId) { closeSalaryRefEditor(); return; }
  salaryRefSearch.disabled = true;
  salaryRefClear.disabled = true;
  salaryRefSaving = true;
  salaryRefStatus.textContent = 'Saving…';
  try {
    await salaryTableOperations().update({ id: recordId, fields: { [col]: id } },
      { parseStrings: false });
    const record = allRecords.find(item => Number(item.id) === recordId);
    if (record) record[col] = label;
    rememberCellHistory('Edit reference', col, [{ id: recordId, before: currentId, after: id }]);
    closeSalaryRefEditor();
    render();
    requestAnimationFrame(focusSelectedCell);
  } catch (error) {
    salaryRefStatus.textContent = actionErrorMessage('Edit reference', error);
  } finally {
    salaryRefSaving = false;
    salaryRefSearch.disabled = false;
    salaryRefClear.disabled = false;
  }
}

salaryRefSearch.addEventListener('input', renderSalaryRefOptions);
salaryRefSearch.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  const first = salaryRefOptions.querySelector('.salary-ref-option');
  if (first) { event.preventDefault(); first.click(); }
});
salaryRefClear.addEventListener('click', () => saveSalaryRef(0, ''));
document.addEventListener('pointerdown', event => {
  if (!salaryRefEditor.hidden && !salaryRefEditor.contains(event.target)
      && !salaryRefContext?.anchor?.contains(event.target)) closeSalaryRefEditor();
}, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !salaryRefEditor.hidden) {
    event.preventDefault();
    closeSalaryRefEditor();
  }
});
window.addEventListener('resize', positionSalaryRefEditor);
