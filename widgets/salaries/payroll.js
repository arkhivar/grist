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

function salaryPayrollAddContext(group) {
  if (!salaryPayrollActive()) return null;
  const col = dateTimeStartColumn(allColumns);
  const type = columnBaseType(writableColumnTypes[col]);
  let reason = group?.addRowDisabledReason || '';
  if (!reason && (!metadataLoaded || !writableColumnIds.includes(col) || type !== 'DateTime'))
    reason = 'A writable start DateTime is required to add work records';
  const teacherColumn = salaryTeacherColumn(columnTypes);
  if (!reason && (salarySelectedTeacherIds.size !== 1 || !writableColumnIds.includes(teacherColumn)))
    reason = 'Select one teacher or staff member before adding a work record';
  const sample = group?.records[0];
  const value = sample && salaryPeriodDateSec(sample[col]);
  if (!reason && value == null) reason = 'Add the first work record in Attendance or Calendar';
  return { enabled: !reason, col, type, value: value ?? null, reason };
}

function salaryPayrollNewRowFields() {
  if (!salaryPayrollActive()) return {};
  if (salarySelectedTeacherIds.size !== 1) throw new Error('Select one teacher or staff member first');
  const col = salaryTeacherColumn(columnTypes);
  const id = [...salarySelectedTeacherIds][0];
  return { [col]: columnTypes[col]?.startsWith('RefList:') ? ['L', id] : id };
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
