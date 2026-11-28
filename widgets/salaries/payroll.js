// Payroll-specific view preferences and shared registry edits. Attendance cell
// editing, selection, clipboard and history remain in the grouped-table app.
let salaryPeriodOptionPending = 0;
let salaryPeriodCollapseConfigured = false;
let salaryPeriodCollapsePending = 0;
const salarySeenPeriodGroups = new Set();
const salarySavedPeriodCollapsed = new Set();

function salaryApplyPeriodOptions(options) {
  const previous = salaryPeriodView;
  if (!salaryPeriodOptionPending && Object.hasOwn(options || {}, 'salaryPeriodView'))
    salaryPeriodView = options.salaryPeriodView === 'payroll' ? 'payroll' : 'calendar';
  if (!salaryPeriodCollapsePending && Object.hasOwn(options || {}, 'salaryPeriodCollapsed')) {
    try {
      const keys = typeof options.salaryPeriodCollapsed === 'string'
        ? JSON.parse(options.salaryPeriodCollapsed) : options.salaryPeriodCollapsed;
      if (Array.isArray(keys)) {
        salaryPeriodCollapseConfigured = true;
        salarySavedPeriodCollapsed.clear();
        [...collapsed].filter(key => key.startsWith('payroll-')).forEach(key => collapsed.delete(key));
        keys.filter(key => typeof key === 'string' && key.startsWith('payroll-'))
          .forEach(key => { collapsed.add(key); salarySavedPeriodCollapsed.add(key); });
      }
    } catch (_) { /* Leave the current collapse state when an option is malformed. */ }
  }
  salarySyncPeriodControls();
  return previous !== salaryPeriodView;
}

async function salaryChangePeriodView(value) {
  const next = value === 'payroll' ? 'payroll' : 'calendar';
  if (next === salaryPeriodView) return;
  salaryClosePeriodEditor();
  salaryPeriodView = next;
  cellRangeEnd = null;
  salarySyncPeriodControls();
  render();
  ++salaryPeriodOptionPending;
  const save = Promise.resolve().then(() => grist.setOption('salaryPeriodView', next))
    .catch(error => showToast(`Save salary view failed: ${error.message || String(error)}`))
    .finally(() => { --salaryPeriodOptionPending; });
  await Promise.allSettled([save, salaryRefreshPayments()]);
}

function salarySavePayrollCollapse() {
  if (!salaryPayrollActive()) return;
  salaryPeriodCollapseConfigured = true;
  const keys = [...collapsed].filter(key => key.startsWith('payroll-'));
  salarySavedPeriodCollapsed.clear();
  keys.forEach(key => salarySavedPeriodCollapsed.add(key));
  ++salaryPeriodCollapsePending;
  Promise.resolve().then(() => grist.setOption('salaryPeriodCollapsed', JSON.stringify(keys)))
    .catch(error => showToast(`Save collapsed periods failed: ${error.message || String(error)}`))
    .finally(() => { --salaryPeriodCollapsePending; });
}

function salaryPreparePayrollGroups(parents) {
  // Calendar grouping initializes independently and may clear shared collapse
  // state after options arrive. Keep payroll preferences separate from it.
  if (salaryPeriodCollapseConfigured) {
    [...collapsed].filter(key => key.startsWith('payroll-')).forEach(key => collapsed.delete(key));
    salarySavedPeriodCollapsed.forEach(key => collapsed.add(key));
  }
  parents.forEach(parent => parent.children.forEach(group => {
    if (salarySeenPeriodGroups.has(group.key)) return;
    salarySeenPeriodGroups.add(group.key);
    if (!salaryPeriodCollapseConfigured) collapsed.add(group.key);
  }));
}

function salaryRevealChangedPayrollRows(changes, defaultCol) {
  if (!salaryPayrollActive()) return false;
  const col = dateTimeStartColumn(allColumns);
  const movedIds = changes.filter(change => (change.col || defaultCol) === col
    && salaryPeriodDateSec(change.before) !== salaryPeriodDateSec(change.after))
    .map(change => String(change.id));
  if (!movedIds.length) return false;
  cellRangeEnd = null;
  queueMoveAnimations(movedIds);
  if (!selectedCell || !movedIds.includes(selectedCell.recordId)) return false;
  for (const parent of getGroups()) {
    const leaf = parent.children.find(group => group.records.some(record => String(record.id) === selectedCell.recordId));
    if (!leaf) continue;
    collapsed.delete(parent.key);
    collapsed.delete(leaf.key);
    salarySavePayrollCollapse();
    return true;
  }
  return false;
}

async function salaryCheckClassPeriodHistory(changes, defaultCol, isUndo) {
  const assignments = changes.filter(change => salaryClassPeriodField(change.col || defaultCol));
  const fields = [...new Set(assignments.map(change => change.col || defaultCol))];
  const ids = [...new Set(assignments.map(change => change.id))];
  const reads = {};
  const results = await Promise.allSettled([
    referenceWriteRecords(ids),
    ...fields.map(field => salaryReadPeriodChoices(selectedTableId, field, reads)),
  ]);
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  const [rows, ...choices] = results.map(result => result.value);
  for (const change of assignments) {
    const field = change.col || defaultCol;
    const { meta, registry } = choices[fields.indexOf(field)];
    const row = rows.get(change.id);
    if (!Object.hasOwn(row, field)) throw new Error(`The class field ${field} is unavailable`);
    const current = salaryPeriodHistoryValue(row[field], meta.type);
    const expected = isUndo ? change.after : change.before;
    if (meta.type !== columnTypes[field] || JSON.stringify(current) !== JSON.stringify(expected))
      throw new Error(`The class ${field} assignment changed. Refresh before using Undo or Redo.`);
    if (!isUndo) {
      const next = salaryPeriodReference(change.after);
      if (!next.empty && !registry.get(next.id)?.valid)
        throw new Error('The selected period is no longer available');
    }
  }
}

function salaryLessonAddContext(group) {
  const weekly = salaryPayrollActive();
  const col = weekly ? dateTimeStartColumn(allColumns) : parseGroupBy(groupBy).col;
  const type = columnBaseType(writableColumnTypes[col]);
  const monthStart = weekly ? salaryPeriodMonths.get(group.monthId)?.sortKey : group.sortKey;
  const teacherColumn = salaryTeacherColumn(columnTypes);
  let reason = '';
  if (monthStart == null) reason = 'Choose a month before adding a lesson';
  else if (!metadataLoaded || !['DateTime', 'Date'].includes(type))
    reason = 'A writable class date is required to add a lesson';
  else if (salarySelectedTeacherIds.size !== 1)
    reason = 'Select one teacher or staff member before adding a lesson';
  else if (!writableColumnIds.includes(teacherColumn))
    reason = 'A writable class teacher field is required to add a lesson';
  if (reason) return { enabled: false, reason };

  const first = new Date(monthStart);
  const lastDay = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0) / 1000;
  const value = type === 'DateTime' ? parseDateTimeWallSec(formatUtcDateSec(lastDay)) : lastDay;
  if (value == null) return { enabled: false, reason: 'The last day of this month is outside the supported date range' };
  const fields = { [col]: value };
  function assignReference(field, id) {
    fields[field] = columnTypes[field]?.startsWith('RefList:') ? ['L', id] : id;
  }
  assignReference(teacherColumn, [...salarySelectedTeacherIds][0]);
  if (weekly) {
    let week = group.monthEndWeek;
    if (group.weekId && group.weekId !== week?.id
        && salaryClassPeriodField('forWeek') && writableColumnIds.includes('forWeek')) {
      assignReference('forWeek', group.weekId);
      week = salaryPeriodWeeks.get(group.weekId);
    }
    if (!week?.monthValid || week.monthId !== group.monthId) {
      if (!salaryClassPeriodField('forMonth') || !writableColumnIds.includes('forMonth'))
        return { enabled: false, reason: 'A writable class forMonth link is required to add a lesson to this payroll month' };
      assignReference('forMonth', group.monthId);
    }
  }
  return { enabled: true, col, type, fields };
}

async function salaryWriteWeekMonth(weekId, monthId, expected = null, selection = null) {
  await salaryLoadPeriodRegistries(true);
  if (selection != null && (selection !== salaryClassSelectionKey || !salaryPayrollActive()))
    throw new Error('The selection changed. Open the week month picker again.');
  const week = salaryPeriodWeeks.get(Number(weekId));
  const month = salaryPeriodMonths.get(Number(monthId));
  if (!week?.valid || !week.monthValid) throw new Error('The week has invalid registry data; correct it in WeekRegistry');
  if (monthId !== 0 && !month?.valid) throw new Error('The selected month is no longer available');
  const before = week.monthId;
  if (expected != null && before !== expected)
    throw new Error('This week’s month changed outside this edit. Refresh before using Undo or Redo.');
  if (before !== monthId) {
    await grist.docApi.applyUserActions([
      ['UpdateRecord', 'WeekRegistry', Number(weekId), { forMonth: monthId }],
    ], { parseStrings: false });
    const current = salaryPeriodWeeks.get(Number(weekId));
    if (current) { current.monthId = monthId; current.monthValid = true; current.invalidReason = ''; }
  }
  cellRangeEnd = null;
  collapsed.delete(monthId ? `payroll-month:${monthId}` : 'payroll-unassigned');
  return before;
}

async function salarySetWeekMonth(rawWeekId, rawMonthId) {
  const weekId = Number(rawWeekId), monthId = Number(rawMonthId);
  if (!Number.isInteger(weekId) || weekId <= 0 || !Number.isInteger(monthId) || monthId < 0)
    throw new Error('Choose a valid week and month');
  if (cellHistoryBusy) throw new Error('Finish the current edit before assigning a month');
  const selection = salaryClassSelectionKey;
  cellHistoryBusy = true;
  updateCellHistoryControls();
  try {
    const before = await salaryWriteWeekMonth(weekId, monthId, null, selection);
    if (before !== monthId) rememberHistoryEntry({ kind: 'salary-week-month',
      label: 'Assign week month', weekId, before, after: monthId });
    salarySavePayrollCollapse();
    render();
  } catch (error) {
    if (document.getElementById('salary-month-picker')?.hidden)
      showToast(`Assign week month failed: ${error.message || String(error)}`);
    throw error;
  } finally {
    cellHistoryBusy = false;
    updateCellHistoryControls();
  }
}
