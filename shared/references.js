// Shared Reference and Reference List editor for grouped-table widgets.
const referenceEditor = document.getElementById('salary-ref-editor');
const referenceSearch = document.getElementById('salary-ref-search');
const referenceOptions = document.getElementById('salary-ref-options');
const referenceStatus = document.getElementById('salary-ref-status');
const referenceClear = document.getElementById('salary-ref-clear');
const referenceSave = document.getElementById('salary-ref-save');
let referenceEditorContext = null;
let referenceEditorRequest = 0;
let referenceEditorSaving = false;
const referenceDisplayLabelsByColumn = new Map();

function referenceIds(value) {
  const raw = normalizeTypedCell(value);
  const values = Array.isArray(raw)
    ? (raw[0] === 'L' ? raw.slice(1) : raw) : [raw];
  return values.map(item => Number(normalizeTypedCell(item)))
    .filter(id => Number.isInteger(id) && id > 0);
}

async function fetchReferenceSourceRecord(recordId) {
  const record = typeof salaryFetchClassRecord === 'function'
    ? await salaryFetchClassRecord(recordId)
    : await grist.viewApi.fetchSelectedRecord(recordId, {
      cellFormat: 'typed', expandRefs: false,
    });
  if (!record) throw new Error(`Record ${recordId} is unavailable`);
  return record;
}

function referenceDisplayLabel(col, id) {
  if (id == null || id === 0) return '';
  return referenceDisplayLabelsByColumn.get(col)?.get(Number(id)) || String(id);
}

function closeReferenceEditor() {
  referenceEditorRequest++;
  if (referenceEditorContext?.anchor?.isConnected)
    referenceEditorContext.anchor.setAttribute('aria-expanded', 'false');
  referenceEditorContext = null;
  referenceEditor.hidden = true;
  referenceSearch.value = '';
  referenceOptions.replaceChildren();
  referenceStatus.textContent = '';
  referenceSave.hidden = true;
  referenceSearch.disabled = false;
  referenceClear.disabled = false;
  referenceSave.disabled = false;
}

function positionReferenceEditor() {
  if (!referenceEditorContext) return;
  const anchor = referenceEditorContext.anchor;
  if (!anchor?.isConnected) { closeReferenceEditor(); return; }
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 16);
  referenceEditor.style.width = `${width}px`;
  referenceEditor.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  const height = referenceEditor.getBoundingClientRect().height || 260;
  const below = rect.bottom + height + 6 <= window.innerHeight;
  referenceEditor.style.top = `${Math.max(8, below ? rect.bottom + 6 : rect.top - height - 6)}px`;
}

function reanchorReferenceEditor() {
  if (!referenceEditorContext) return;
  const { recordId, col } = referenceEditorContext;
  const anchor = [...content.querySelectorAll('button[data-edit-kind="reference"]')]
    .find(button => button.dataset.editId === String(recordId) && button.dataset.editCol === col);
  if (!anchor) { closeReferenceEditor(); return; }
  referenceEditorContext.anchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  positionReferenceEditor();
}

function renderReferenceOptions() {
  if (!referenceEditorContext) return;
  const query = referenceSearch.value.trim().toLocaleLowerCase();
  const matches = referenceEditorContext.choices.filter(choice =>
    choice.label.toLocaleLowerCase().includes(query) || String(choice.id).includes(query));
  const isList = referenceEditorContext.isList;
  referenceOptions.setAttribute('aria-multiselectable', String(isList));
  referenceOptions.replaceChildren();
  matches.slice(0, 80).forEach(choice => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'salary-ref-option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(isList
      ? referenceEditorContext.draftIds.has(choice.id) : choice.id === referenceEditorContext.currentId));
    option.textContent = `${choice.label}  #${choice.id}`;
    option.addEventListener('click', () => {
      if (!isList) { saveReference(choice.id, choice.label); return; }
      if (referenceEditorContext.draftIds.has(choice.id)) referenceEditorContext.draftIds.delete(choice.id);
      else referenceEditorContext.draftIds.add(choice.id);
      renderReferenceOptions();
    });
    referenceOptions.appendChild(option);
  });
  referenceStatus.textContent = matches.length > 80
    ? `${matches.length} matches · type to narrow` : `${matches.length} matches`;
  positionReferenceEditor();
}

async function referenceChoices(col, shared = null) {
  const refTable = String(columnTypes[col] || '').split(':')[1];
  if (!refTable) throw new Error(`Reference table is unknown for ${col}`);
  const [tables, columns, table] = await Promise.all([
    shared?.tables || grist.docApi.fetchTable('_grist_Tables'),
    shared?.columns || grist.docApi.fetchTable('_grist_Tables_column'),
    shared?.table || grist.docApi.fetchTable(refTable),
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
  if (!shared?.isCurrent || shared.isCurrent())
    referenceDisplayLabelsByColumn.set(col, new Map(choices.map(choice => [choice.id, choice.label])));
  return choices;
}

async function preloadReferenceChoices(cols, isCurrent) {
  if (!cols.length) return;
  // Share fetches within this load; opening an editor still reads fresh choices.
  const tables = grist.docApi.fetchTable('_grist_Tables');
  const columns = grist.docApi.fetchTable('_grist_Tables_column');
  const refTables = new Map();
  await Promise.allSettled(cols.map(col => {
    const tableId = String(columnTypes[col] || '').split(':')[1];
    if (tableId && !refTables.has(tableId))
      refTables.set(tableId, grist.docApi.fetchTable(tableId));
    return referenceChoices(col, { tables, columns, table: refTables.get(tableId), isCurrent });
  }));
}

async function openReferenceEditor(idStr, col, anchor) {
  closeReferenceEditor();
  const request = referenceEditorRequest;
  referenceEditorContext = {
    recordId: validRecordId(idStr), col, anchor, choices: [], currentId: 0,
    isList: columnTypes[col]?.startsWith('RefList:'), currentIds: [], draftIds: new Set(),
    loaded: false,
  };
  referenceEditor.hidden = false;
  referenceSave.hidden = !referenceEditorContext.isList;
  anchor?.setAttribute('aria-expanded', 'true');
  referenceStatus.textContent = 'Loading records…';
  referenceClear.disabled = true;
  referenceSave.disabled = true;
  positionReferenceEditor();
  referenceSearch.focus();
  try {
    const [choices, raw] = await Promise.all([
      referenceChoices(col, { isCurrent: () => request === referenceEditorRequest }),
      fetchReferenceSourceRecord(Number(idStr)),
    ]);
    if (request !== referenceEditorRequest || !referenceEditorContext) return;
    referenceEditorContext.choices = choices;
    if (referenceEditorContext.isList) {
      referenceEditorContext.currentIds = referenceIds(raw[col]);
      referenceEditorContext.draftIds = new Set(referenceEditorContext.currentIds);
    } else {
      referenceEditorContext.currentId = referenceIds(raw[col])[0] || 0;
    }
    referenceEditorContext.loaded = true;
    referenceClear.disabled = referenceEditorSaving;
    referenceSave.disabled = referenceEditorSaving;
    renderReferenceOptions();
  } catch (error) {
    if (request === referenceEditorRequest)
      referenceStatus.textContent = error.message || String(error);
  }
}

async function saveReference(id, label) {
  if (!referenceEditorContext?.loaded || cellHistoryBusy || referenceEditorSaving) return;
  const context = referenceEditorContext;
  const sourceRecords = allRecords;
  const { recordId, col, currentId } = context;
  if (id === currentId) { closeReferenceEditor(); return; }
  referenceSearch.disabled = true;
  referenceClear.disabled = true;
  referenceEditorSaving = true;
  referenceStatus.textContent = 'Saving…';
  try {
    await activeTableOps().update({ id: recordId, fields: { [col]: id } },
      { parseStrings: false });
    const record = sourceRecords === allRecords
      ? allRecords.find(item => Number(item.id) === recordId) : null;
    if (record) setReferenceDisplay(record, col, id ? [label] : []);
    rememberCellHistory('Edit reference', col, [{ id: recordId, before: currentId, after: id }]);
    const isCurrent = referenceEditorContext === context;
    if (isCurrent) closeReferenceEditor();
    if (sourceRecords === allRecords) render();
    if (isCurrent) requestAnimationFrame(focusSelectedCell);
  } catch (error) {
    if (referenceEditorContext === context)
      referenceStatus.textContent = actionErrorMessage('Edit reference', error);
    else showToast(actionErrorMessage('Edit reference', error));
  } finally {
    referenceEditorSaving = false;
    referenceSearch.disabled = false;
    referenceClear.disabled = Boolean(referenceEditorContext && !referenceEditorContext.loaded);
    referenceSave.disabled = Boolean(referenceEditorContext && !referenceEditorContext.loaded);
  }
}

async function saveReferenceList() {
  if (!referenceEditorContext?.isList || !referenceEditorContext.loaded
      || cellHistoryBusy || referenceEditorSaving) return;
  const context = referenceEditorContext;
  const sourceRecords = allRecords;
  const { recordId, col, currentIds, draftIds } = context;
  const nextIds = [...draftIds];
  if (currentIds.length === nextIds.length
      && currentIds.every((id, index) => id === nextIds[index])) {
    closeReferenceEditor();
    return;
  }
  referenceEditorSaving = true;
  referenceSearch.disabled = true;
  referenceClear.disabled = true;
  referenceSave.disabled = true;
  referenceStatus.textContent = 'Saving…';
  try {
    await activeTableOps().update({ id: recordId, fields: { [col]: ['L', ...nextIds] } },
      { parseStrings: false });
    const record = sourceRecords === allRecords
      ? allRecords.find(item => Number(item.id) === recordId) : null;
    if (record) setReferenceDisplay(record, col,
      nextIds.map(id => referenceDisplayLabel(col, id)));
    rememberCellHistory('Edit references', col, [{ id: recordId,
      before: ['L', ...currentIds], after: ['L', ...nextIds] }]);
    const isCurrent = referenceEditorContext === context;
    if (isCurrent) closeReferenceEditor();
    if (sourceRecords === allRecords) render();
    if (isCurrent) requestAnimationFrame(focusSelectedCell);
  } catch (error) {
    if (referenceEditorContext === context)
      referenceStatus.textContent = actionErrorMessage('Edit references', error);
    else showToast(actionErrorMessage('Edit references', error));
  } finally {
    referenceEditorSaving = false;
    referenceSearch.disabled = false;
    referenceClear.disabled = Boolean(referenceEditorContext && !referenceEditorContext.loaded);
    referenceSave.disabled = Boolean(referenceEditorContext && !referenceEditorContext.loaded);
  }
}

referenceSearch.addEventListener('input', renderReferenceOptions);
referenceSearch.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  const first = referenceOptions.querySelector('.salary-ref-option');
  if (first) { event.preventDefault(); first.click(); }
});
referenceClear.addEventListener('click', () => {
  if (!referenceEditorContext?.loaded || referenceEditorSaving) return;
  if (referenceEditorContext.isList) {
    referenceEditorContext.draftIds.clear();
    renderReferenceOptions();
  } else saveReference(0, '');
});
referenceSave.addEventListener('click', saveReferenceList);
document.addEventListener('pointerdown', event => {
  if (!referenceEditor.hidden && !referenceEditor.contains(event.target)
      && !referenceEditorContext?.anchor?.contains(event.target)) closeReferenceEditor();
}, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !referenceEditor.hidden) {
    event.preventDefault();
    closeReferenceEditor();
  }
});
window.addEventListener('resize', positionReferenceEditor);
