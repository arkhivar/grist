// A read-only student navigator: publish matching summary rows through Select By.
const filterSearch = document.getElementById('filter-search');
const filterClear = document.getElementById('filter-clear');
const filterCount = document.getElementById('filter-count');
const filterRecents = document.getElementById('filter-recents');
const filterRulesPanel = document.getElementById('filter-rules');
const filterSettingsPanel = document.getElementById('filter-settings');
const filterRulesButton = document.getElementById('btn-filter-rules');
const filterSettingsButton = document.getElementById('btn-filter-settings');
const filterNameSelect = document.getElementById('filter-name-column');
const filterMatchSelect = document.getElementById('filter-match');
const filterChannelInput = document.getElementById('filter-channel');
const filterRuleList = document.getElementById('filter-rule-list');
const filterStatus = document.getElementById('filter-status');
let filterRecords = [];
let filterRawRecords = [];
let filterColumns = [];
let filterTableId = '';
let filterConfig = { nameColumn: '', match: 'all', rules: [] };
let filterNavigationGroup = 'students';
let filterOptionsReady = false;
let filterDataReady = false;
let filterLoadRequest = 0;
let filterMetadataPromise = null;
let filterMetadataTableId = '';
let filterConnection = null;
let filterConnectionRequest = 0;
let filterRecentEntries = [];
let filterPendingVisits = [];
let filterPinnedKey = '';
let filterLatestSelection = null;
let filterSelectionRunning = false;
let filterLastSelection = '';
let filterDesiredCount = '';
let filterConfigSaveTimer = null;
let filterConfigSaveQueue = Promise.resolve();
let filterPendingConfigSaves = 0;
let filterToastTimer = null;
let filterLastVisitKey = '';
let filterLoadedStorageKey = null;
let filterNavigationSaveQueue = Promise.resolve();
let filterPendingNavigationSaves = 0;

function filterText(value) {
  if (value == null || value === 0) return '';
  if (Array.isArray(value)) {
    if (value[0] === 'R') return String(value[2] || '');
    if (value[0] === 'r') return filterText(value[2]);
    if (value[0] === 'L' || value[0] === 'l') return value.slice(1).map(filterText).join(', ');
    return value.map(filterText).join(', ');
  }
  return String(value);
}

function filterNormalize(value) {
  return filterText(value).normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function filterRawValue(value) {
  if (!Array.isArray(value)) return value;
  if (value[0] === 'l') return filterRawValue(value[1]);
  if (['d', 'D'].includes(value[0])) return value[1];
  if (value[0] === 'R') return value[2];
  if (value[0] === 'r') return value[2];
  if (value[0] === 'L') return value.slice(1);
  return value;
}

function filterColumn(column) {
  return filterColumns.find(item => item.id === column);
}

function filterBaseType(column) {
  return (filterColumn(column)?.type || 'Text').split(':')[0];
}

function filterStudentVisit(record) {
  const value = filterRawValue(record[filterConfig.nameColumn]);
  const type = filterColumn(filterConfig.nameColumn)?.type || 'Text';
  const target = /^(?:Ref|RefList):(.+)$/.exec(type);
  if (target) {
    const ids = (Array.isArray(value) ? value : [value]).map(Number)
      .filter(id => Number.isInteger(id) && id > 0);
    return ids.length === 1 ? { tableId: target[1], ids } : null;
  }
  const text = value == null ? '' : String(value);
  return text ? { text } : null;
}

function filterVisitKey(visit) {
  if (visit && typeof visit.tableId === 'string' && Array.isArray(visit.ids)
      && visit.ids.length === 1 && Number.isInteger(visit.ids[0]) && visit.ids[0] > 0)
    return JSON.stringify([visit.tableId, visit.ids[0]]);
  return visit && typeof visit.text === 'string' && visit.text
    ? JSON.stringify(['text', visit.text]) : '';
}

function filterRecordKey(record) {
  return filterVisitKey(filterStudentVisit(record));
}

function filterLabelForKey(key) {
  const raw = filterRawRecords.find(record => filterRecordKey(record) === key);
  const expanded = raw && filterRecords.find(record => record.id === raw.id);
  return expanded ? filterText(expanded[filterConfig.nameColumn]) : '';
}

function filterStorageKey() {
  return filterConnection && filterTableId && filterConfig.nameColumn
    ? `grist-student-recents:${filterConnection.scope}:${filterTableId}:${filterConfig.nameColumn}` : '';
}

function filterSaveRecents() {
  const key = filterStorageKey();
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(filterRecentEntries)); } catch (_) { /* Session history still works. */ }
}

function filterLoadRecents() {
  const key = filterStorageKey();
  if (key === filterLoadedStorageKey) { filterRenderRecents(); return; }
  filterLoadedStorageKey = key;
  filterRecentEntries = [];
  if (key) {
    try {
      const entries = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(entries)) {
        const seen = new Set();
        filterRecentEntries = entries.filter(entry => {
          const validKey = filterVisitKey(entry?.visit);
          if (!validKey || validKey !== entry.key || seen.has(validKey)) return false;
          seen.add(validKey);
          return true;
        }).slice(0, 5);
      }
    } catch (_) { /* Ignore unavailable storage and old malformed history. */ }
  }
  filterLastVisitKey = '';
  filterRenderRecents();
}

function filterReceiveVisit(visit) {
  if (!filterDataReady || !filterOptionsReady || !filterConnection) {
    filterPendingVisits = [visit];
    return;
  }
  const key = filterVisitKey(visit);
  if (!key || key === filterLastVisitKey
      || !filterRawRecords.some(record => filterRecordKey(record) === key)) return;
  filterLastVisitKey = key;
  filterRecentEntries = [{ key, visit }, ...filterRecentEntries.filter(entry => entry.key !== key)].slice(0, 5);
  filterSaveRecents();
  filterRenderRecents();
}

function filterRenderRecents() {
  const placeholder = document.getElementById('filter-empty-recents');
  const focusedKey = document.activeElement?.closest('.filter-chip')?.dataset.key;
  const visible = filterRecentEntries.filter(entry => filterLabelForKey(entry.key));
  const oldButtons = new Map([...filterRecents.querySelectorAll('button')].map(button => [button.dataset.key, button]));
  const buttons = visible.map(entry => {
    const button = oldButtons.get(entry.key) || document.createElement('button');
    button.type = 'button';
    button.className = 'filter-chip';
    button.dataset.key = entry.key;
    const label = filterLabelForKey(entry.key);
    button.textContent = label;
    button.title = `Show ${label}`;
    button.setAttribute('aria-label', `Show ${label}`);
    button.setAttribute('aria-pressed', String(filterPinnedKey === entry.key));
    button.onclick = () => {
      filterPinnedKey = entry.key;
      filterSearch.value = label;
      filterRecentEntries = [entry, ...filterRecentEntries.filter(item => item.key !== entry.key)];
      filterLastVisitKey = entry.key;
      filterSaveRecents();
      filterApply();
    };
    return button;
  });
  // Retain the actual button nodes so a live refresh does not discard keyboard focus.
  buttons.forEach((button, index) => {
    if (filterRecents.children[index] !== button) filterRecents.insertBefore(button, filterRecents.children[index] || null);
  });
  [...filterRecents.children].forEach(button => { if (button !== placeholder && !buttons.includes(button)) button.remove(); });
  placeholder.hidden = visible.length > 0;
  if (focusedKey && document.activeElement?.dataset.key !== focusedKey)
    buttons.find(button => button.dataset.key === focusedKey)?.focus();
}

function filterNotify(error) {
  const message = error?.message || String(error);
  filterStatus.textContent = message;
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  toast.classList.add('visible');
  clearTimeout(filterToastTimer);
  filterToastTimer = setTimeout(() => toast.classList.remove('visible'), 6000);
}

async function filterConnectNavigation() {
  const request = ++filterConnectionRequest;
  filterConnection?.close();
  filterConnection = null;
  filterLoadedStorageKey = null;
  filterPendingVisits = [];
  try {
    const connection = await studentNavigationConnect(filterNavigationGroup, filterReceiveVisit);
    if (request !== filterConnectionRequest) { connection?.close(); return; }
    filterConnection = connection;
    filterLoadRecents();
    if (!connection) filterStatus.textContent = 'Recent history needs browser storage and the linked Sprints widget.';
    filterPendingVisits.splice(0).forEach(filterReceiveVisit);
  } catch (error) { if (request === filterConnectionRequest) filterNotify(error); }
}

function filterOperators(column) {
  const type = filterBaseType(column);
  const common = [['is', 'is'], ['is_not', 'is not'], ['empty', 'is empty'], ['not_empty', 'is not empty']];
  if (type === 'Date' || type === 'DateTime')
    return [...common.slice(0, 2), ['lt', 'before'], ['lte', 'on or before'], ['gt', 'after'], ['gte', 'on or after'], ...common.slice(2)];
  if (type === 'Int' || type === 'Numeric')
    return [...common.slice(0, 2), ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ...common.slice(2)];
  if (type === 'Bool') return common;
  return [['contains', 'contains'], ['not_contains', 'does not contain'], ['starts', 'starts with'], ...common];
}

function filterRuleComplete(rule) {
  if (!filterColumn(rule.column) || !filterOperators(rule.column).some(([operator]) => operator === rule.operator)) return false;
  if (['empty', 'not_empty'].includes(rule.operator)) return true;
  if (!String(rule.value ?? '').trim()) return false;
  const type = filterBaseType(rule.column);
  if (['Numeric', 'Int'].includes(type)) return Number.isFinite(Number(rule.value));
  if (type === 'Date' || type === 'DateTime') return /^\d{4}-\d{2}-\d{2}$/.test(rule.value) && parseIsoDateSec(rule.value) != null;
  if (type === 'Bool') return rule.value === 'true' || rule.value === 'false';
  return true;
}

function filterRuleMatches(rule, record, raw) {
  const type = filterBaseType(rule.column);
  const value = filterRawValue(raw[rule.column]);
  const empty = value == null || value === '' || (Array.isArray(value) && !value.length)
    || (/^(Ref|RefList)$/.test(type) && value === 0);
  if (rule.operator === 'empty') return empty;
  if (rule.operator === 'not_empty') return !empty;
  if (empty) return rule.operator === 'is_not' || rule.operator === 'not_contains';
  let left, right;
  if (type === 'Date' || type === 'DateTime') {
    const sec = parseDateValueSec(value);
    if (sec == null || !Number.isFinite(sec)) return false;
    left = type === 'DateTime' ? dateTimeWallDate(sec).toISOString().slice(0, 10) : formatUtcDateSec(sec).slice(0, 10);
    right = rule.value;
  } else if (type === 'Int' || type === 'Numeric') {
    left = Number(value); right = Number(rule.value);
    if (!Number.isFinite(left)) return false;
  } else if (type === 'Bool') {
    if (value !== true && value !== false && value !== 0 && value !== 1) return false;
    left = value === true || value === 1; right = rule.value === 'true';
  } else {
    left = filterNormalize(record[rule.column]); right = filterNormalize(rule.value);
  }
  if (rule.operator === 'is') return left === right;
  if (rule.operator === 'is_not') return left !== right;
  if (rule.operator === 'contains') return left.includes(right);
  if (rule.operator === 'not_contains') return !left.includes(right);
  if (rule.operator === 'starts') return left.startsWith(right);
  if (rule.operator === 'gt') return left > right;
  if (rule.operator === 'gte') return left >= right;
  if (rule.operator === 'lt') return left < right;
  if (rule.operator === 'lte') return left <= right;
  return false;
}

async function filterPublishSelection() {
  if (filterSelectionRunning) return;
  filterSelectionRunning = true;
  while (filterLatestSelection) {
    const ids = filterLatestSelection;
    filterLatestSelection = null;
    const signature = JSON.stringify(ids);
    if (signature === filterLastSelection) continue;
    try {
      await grist.setSelectedRows(ids);
      filterLastSelection = signature;
      if (!filterLatestSelection) filterCount.textContent = filterDesiredCount;
    } catch (error) {
      filterNotify(error);
      if (!filterLatestSelection) filterCount.textContent = 'Filter failed';
    }
  }
  filterSelectionRunning = false;
}

function filterApply() {
  filterClear.disabled = !filterSearch.value && !filterPinnedKey;
  filterClear.hidden = filterClear.disabled;
  const completeRules = filterConfig.rules.filter(filterRuleComplete);
  filterRulesButton.querySelector('span').textContent = completeRules.length
    ? `Filter · ${completeRules.length}${filterPinnedKey ? ' paused' : ''}` : 'Filter';
  filterRulesButton.classList.toggle('active', completeRules.length > 0 && !filterPinnedKey);
  filterRenderRecents();
  if (!filterOptionsReady || !filterDataReady) return;
  if (!filterColumn(filterConfig.nameColumn)) {
    filterCount.textContent = 'Choose a name field';
    return;
  }
  const words = filterNormalize(filterSearch.value).split(' ').filter(Boolean);
  const expandedById = new Map(filterRecords.map(record => [record.id, record]));
  const matches = filterRawRecords.filter(raw => {
    if (filterPinnedKey) return filterRecordKey(raw) === filterPinnedKey;
    const record = expandedById.get(raw.id);
    if (!record) return false;
    if (!words.every(word => filterNormalize(record[filterConfig.nameColumn]).includes(word))) return false;
    const rules = completeRules.map(rule => filterRuleMatches(rule, record, raw));
    return !rules.length || (filterConfig.match === 'any' ? rules.some(Boolean) : rules.every(Boolean));
  }).map(record => record.id);
  filterDesiredCount = `${matches.length} / ${filterRawRecords.length}`;
  filterCount.textContent = filterDesiredCount;
  filterCount.setAttribute('aria-label', `${matches.length} of ${filterRawRecords.length} students`);
  filterLatestSelection = matches;
  filterPublishSelection();
}

function filterSaveConfig() {
  clearTimeout(filterConfigSaveTimer);
  filterConfigSaveTimer = setTimeout(() => {
    filterConfigSaveTimer = null;
    const snapshot = JSON.parse(JSON.stringify(filterConfig));
    filterPendingConfigSaves++;
    filterConfigSaveQueue = filterConfigSaveQueue.then(() => grist.setOption('studentFilter', snapshot))
      .catch(filterNotify).finally(() => filterPendingConfigSaves--);
  }, 180);
}

function filterEditRules() {
  filterPinnedKey = '';
  filterRuleList.dataset.state = JSON.stringify([filterColumns, filterConfig.rules, filterConfig.match]);
  filterApply();
  filterSaveConfig();
}

function filterMakeOption(value, label) {
  const option = document.createElement('option');
  option.value = value; option.textContent = label;
  return option;
}

function filterRenderRuleList(focusNew = false) {
  filterRuleList.replaceChildren();
  filterConfig.rules.forEach((rule, index) => {
    const row = document.createElement('div');
    row.className = 'filter-rule';
    const field = document.createElement('select');
    field.setAttribute('aria-label', `Filter ${index + 1} field`);
    filterColumns.forEach(column => field.appendChild(filterMakeOption(column.id, column.label)));
    field.value = rule.column;
    const operator = document.createElement('select');
    operator.setAttribute('aria-label', `Filter ${index + 1} condition`);
    filterOperators(rule.column).forEach(([value, label]) => operator.appendChild(filterMakeOption(value, label)));
    operator.value = rule.operator;
    const bool = filterBaseType(rule.column) === 'Bool';
    const input = document.createElement(bool ? 'select' : 'input');
    const date = ['Date', 'DateTime'].includes(filterBaseType(rule.column));
    if (bool) [['true', 'True'], ['false', 'False']].forEach(([value, label]) => input.appendChild(filterMakeOption(value, label)));
    else {
      input.type = date ? 'date' : 'text';
      if (['Numeric', 'Int'].includes(filterBaseType(rule.column))) input.inputMode = 'decimal';
      input.placeholder = date ? 'YYYY-MM-DD' : 'Value';
    }
    input.value = rule.value;
    input.hidden = ['empty', 'not_empty'].includes(rule.operator);
    input.setAttribute('aria-label', `Filter ${index + 1} value${date && filterBaseType(rule.column) === 'DateTime' ? ' (VLAT)' : ''}`);
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'btn-icon'; remove.textContent = '×';
    remove.title = 'Remove condition'; remove.setAttribute('aria-label', `Remove filter ${index + 1}`);
    field.onchange = () => {
      rule.column = field.value;
      rule.operator = filterOperators(rule.column)[0][0];
      rule.value = filterBaseType(rule.column) === 'Bool' ? 'true' : '';
      filterRenderRuleList(); filterEditRules();
    };
    operator.onchange = () => {
      rule.operator = operator.value;
      input.hidden = ['empty', 'not_empty'].includes(rule.operator);
      filterEditRules();
    };
    input.addEventListener(bool ? 'change' : 'input', () => { rule.value = input.value; filterEditRules(); });
    remove.onclick = () => {
      filterConfig.rules.splice(index, 1);
      filterRenderRuleList(); filterEditRules();
      (filterRuleList.querySelector('select') || document.getElementById('filter-add-rule')).focus();
    };
    row.append(field, operator, input, remove);
    filterRuleList.appendChild(row);
  });
  filterMatchSelect.value = filterConfig.match;
  if (!filterConfig.rules.length) {
    const hint = document.createElement('p'); hint.className = 'filter-help';
    hint.textContent = 'Add conditions to narrow the student list. Dates use VLAT for DateTime fields.';
    filterRuleList.appendChild(hint);
  }
  if (focusNew) filterRuleList.lastElementChild?.querySelector('select')?.focus();
  filterRuleList.dataset.state = JSON.stringify([filterColumns, filterConfig.rules, filterConfig.match]);
  filterPositionPanel(filterRulesPanel, filterRulesButton);
}

function filterPositionPanel(panel, button) {
  if (panel.hidden) return;
  const rect = button.getBoundingClientRect();
  const width = Math.min(panel === filterRulesPanel ? 490 : 330, Math.max(0, window.innerWidth - 16));
  panel.style.width = `${width}px`;
  panel.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
  const height = panel.getBoundingClientRect().height;
  panel.style.top = `${Math.max(8, Math.min(rect.bottom + 5, window.innerHeight - height - 8))}px`;
}

function filterClosePanel(panel, button, restoreFocus = false) {
  panel.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  if (restoreFocus) button.focus();
}

function filterTogglePanel(panel, button) {
  const show = panel.hidden;
  filterClosePanel(filterRulesPanel, filterRulesButton);
  filterClosePanel(filterSettingsPanel, filterSettingsButton);
  if (!show) return;
  panel.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  filterPositionPanel(panel, button);
  panel.querySelector('.filter-popover-body select, .filter-popover-body input, .filter-popover-body button')?.focus();
}

async function filterLoadMetadata(tableId) {
  const [tables, columns] = await Promise.all([
    grist.docApi.fetchTable('_grist_Tables'), grist.docApi.fetchTable('_grist_Tables_column'),
  ]);
  const tableIndex = tables.tableId.indexOf(tableId);
  if (tableIndex < 0) throw new Error(`Cannot read columns for ${tableId}`);
  const parentId = tables.id[tableIndex];
  const metadata = new Map();
  columns.id.forEach((_, index) => {
    if (columns.parentId[index] === parentId) metadata.set(columns.colId[index], {
      id: columns.colId[index], label: columns.label?.[index] || columns.colId[index], type: columns.type[index],
    });
  });
  return { tableId, metadata };
}

async function filterLoadRecords(records) {
  const request = ++filterLoadRequest;
  filterDataReady = false;
  filterCount.textContent = 'Loading…';
  try {
    const tableId = await grist.selectedTable.getTableId();
    if (request !== filterLoadRequest) return;
    if (filterMetadataTableId !== tableId) {
      filterMetadataPromise = null;
      filterMetadataTableId = tableId;
      filterLastSelection = '';
      filterPinnedKey = '';
    }
    if (!filterMetadataPromise) {
      const metadataPromise = filterLoadMetadata(tableId);
      filterMetadataPromise = metadataPromise;
      metadataPromise.catch(() => { if (filterMetadataPromise === metadataPromise) filterMetadataPromise = null; });
    }
    const [info, table] = await Promise.all([
      filterMetadataPromise,
      grist.viewApi.fetchSelectedTable({ cellFormat: 'typed', expandRefs: false }),
    ]);
    if (request !== filterLoadRequest) return;
    const allowed = new Set(records.map(record => record.id));
    filterTableId = info.tableId;
    filterRecords = records;
    filterRawRecords = table.id.map((id, index) => Object.fromEntries(
      Object.entries(table).map(([column, values]) => [column, values[index]])))
      .filter(record => allowed.has(record.id));
    const columnIds = Object.keys(table).filter(column => !['id', 'manualSort', 'group'].includes(column));
    filterColumns = columnIds.map(id => info.metadata.get(id) || { id, label: id, type: 'Text' });
    filterDataReady = true;
    filterReconcileConfig();
    filterLoadRecents();
    filterPendingVisits.splice(0).forEach(filterReceiveVisit);
    filterStatus.textContent = typeof BroadcastChannel === 'function'
      ? 'Search filters the linked student list. Recent students come from Sprints on this page.'
      : 'Search and filters are ready. This browser cannot share recent students with Sprints.';
    filterApply();
  } catch (error) {
    if (request !== filterLoadRequest) return;
    filterCount.textContent = 'Unable to load';
    filterNotify(error);
  }
}

function filterReconcileConfig() {
  if (!filterDataReady || !filterOptionsReady) return;
  if (!filterColumn(filterConfig.nameColumn)) {
    const student = filterColumns.find(column => /^(student|students|student_name|students_name)$/i.test(column.id));
    filterConfig.nameColumn = student?.id || filterColumns.find(column => ['Text', 'Ref', 'RefList', 'Choice'].includes(column.type.split(':')[0]))?.id || '';
  }
  filterConfig.rules = filterConfig.rules.filter(rule => filterColumn(rule.column));
  const schema = JSON.stringify(filterColumns);
  if (filterNameSelect.dataset.schema !== schema) {
    filterNameSelect.replaceChildren(filterMakeOption('', 'Choose a field'));
    filterColumns.forEach(column => filterNameSelect.appendChild(filterMakeOption(column.id, column.label)));
    filterNameSelect.dataset.schema = schema;
  }
  filterNameSelect.value = filterConfig.nameColumn;
  if (document.activeElement !== filterChannelInput) filterChannelInput.value = filterNavigationGroup;
  if (filterRuleList.dataset.state !== JSON.stringify([filterColumns, filterConfig.rules, filterConfig.match])) filterRenderRuleList();
}

filterSearch.addEventListener('input', () => { filterPinnedKey = ''; filterApply(); });
filterClear.onclick = () => { filterPinnedKey = ''; filterSearch.value = ''; filterApply(); filterSearch.focus(); };
filterSearch.addEventListener('keydown', event => {
  if (event.key === 'Escape' && (filterSearch.value || filterPinnedKey)) {
    event.preventDefault(); filterClear.click();
  }
});
filterRulesButton.onclick = () => filterTogglePanel(filterRulesPanel, filterRulesButton);
filterSettingsButton.onclick = () => filterTogglePanel(filterSettingsPanel, filterSettingsButton);
document.getElementById('filter-close-rules').onclick = () => filterClosePanel(filterRulesPanel, filterRulesButton, true);
document.getElementById('filter-settings-close').onclick = () => filterClosePanel(filterSettingsPanel, filterSettingsButton, true);
filterMatchSelect.onchange = () => { filterConfig.match = filterMatchSelect.value; filterEditRules(); };
document.getElementById('filter-add-rule').onclick = () => {
  const column = filterColumns.find(item => /^lastclass$/i.test(item.id))?.id || filterConfig.nameColumn;
  if (!column) return;
  filterConfig.rules.push({ column, operator: filterOperators(column)[0][0], value: '' });
  filterRenderRuleList(true); filterEditRules(); filterPositionPanel(filterRulesPanel, filterRulesButton);
};
document.getElementById('filter-reset-rules').onclick = () => {
  filterConfig.rules = []; filterRenderRuleList(); filterEditRules();
};
filterNameSelect.onchange = () => {
  filterConfig.nameColumn = filterNameSelect.value;
  filterPinnedKey = ''; filterLoadRecents(); filterApply(); filterSaveConfig();
};
filterChannelInput.onchange = () => {
  const value = studentNavigationGroup(filterChannelInput.value);
  filterChannelInput.value = value;
  if (value === filterNavigationGroup) return;
  filterNavigationGroup = value;
  filterPinnedKey = '';
  filterConnectNavigation();
  filterPendingNavigationSaves++;
  filterNavigationSaveQueue = filterNavigationSaveQueue.then(() => grist.setOption('navigationGroup', value))
    .catch(filterNotify).finally(() => filterPendingNavigationSaves--);
};
filterChannelInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); filterChannelInput.onchange(); }
  if (event.key === 'Escape') { event.preventDefault(); filterChannelInput.value = filterNavigationGroup; }
});
document.getElementById('filter-history-clear').onclick = () => {
  filterRecentEntries = []; filterLastVisitKey = ''; filterSaveRecents(); filterRenderRecents();
};
document.addEventListener('pointerdown', event => {
  if (!filterRulesPanel.contains(event.target) && !filterRulesButton.contains(event.target)) filterClosePanel(filterRulesPanel, filterRulesButton);
  if (!filterSettingsPanel.contains(event.target) && !filterSettingsButton.contains(event.target)) filterClosePanel(filterSettingsPanel, filterSettingsButton);
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!filterRulesPanel.hidden) { event.preventDefault(); event.stopPropagation(); filterClosePanel(filterRulesPanel, filterRulesButton, true); }
  if (!filterSettingsPanel.hidden) { event.preventDefault(); event.stopPropagation(); filterClosePanel(filterSettingsPanel, filterSettingsButton, true); }
});
window.addEventListener('resize', () => {
  filterPositionPanel(filterRulesPanel, filterRulesButton);
  filterPositionPanel(filterSettingsPanel, filterSettingsButton);
});
window.addEventListener('pagehide', () => filterConnection?.close());
document.getElementById('version-badge').textContent = `v${document.getElementById('app').dataset.widgetVersion}`;

grist.ready({ requiredAccess: 'full', allowSelectBy: true });
grist.onOptions(options => {
  const saved = options?.studentFilter;
  if (!filterConfigSaveTimer && !filterPendingConfigSaves) {
    filterConfig = {
      nameColumn: typeof saved?.nameColumn === 'string' ? saved.nameColumn : '',
      match: saved?.match === 'any' ? 'any' : 'all',
      rules: Array.isArray(saved?.rules) ? saved.rules.filter(rule => rule && typeof rule.column === 'string'
        && typeof rule.operator === 'string').map(rule => ({ column: rule.column, operator: rule.operator, value: String(rule.value ?? '') })).slice(0, 20) : [],
    };
  }
  const group = typeof options?.navigationGroup === 'string' && options.navigationGroup.trim()
    ? options.navigationGroup.trim() : 'students';
  const first = !filterOptionsReady;
  filterOptionsReady = true;
  filterReconcileConfig();
  if (first || (!filterPendingNavigationSaves && group !== filterNavigationGroup)) {
    filterNavigationGroup = group;
    if (document.activeElement !== filterChannelInput) filterChannelInput.value = group;
    filterConnectNavigation();
  }
  filterApply();
});
grist.onRecords(records => filterLoadRecords(records || []));
