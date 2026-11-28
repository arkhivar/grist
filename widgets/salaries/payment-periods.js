// A single period column has separate Attendance and Transactions edit targets.
function salaryOpenRecordPeriod(id, col, anchor) {
  const selection = salaryClassSelectionKey, view = salaryPeriodView;
  const field = salaryIsPaymentPeriodColumn(col) ? salaryPaymentPeriodFields[col] : col;
  return openReferenceEditor(id, col, anchor, {
    load: salaryRecordPeriodEditInfo, save: salarySaveRecordPeriod,
    isCurrent: () => selection === salaryClassSelectionKey && view === salaryPeriodView && isColumnVisible(field),
    isLoading: () => salaryClassRowsLoading || salaryRefreshButton.disabled,
  });
}

async function salaryReadPeriodChoices(tableId, field, reads = {}) {
  const weekly = field === 'forWeek';
  reads.periodMonths ||= salaryFetchMonthRegistry(salaryFetchPeriodMetadata());
  const results = await Promise.allSettled([
    reads.periodMonths,
    weekly ? grist.docApi.fetchTable('WeekRegistry') : null,
  ]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  const [periods, weeks] = results.map(result => result.value);
  const meta = salaryRecordPeriodMeta(tableId, field, periods);
  if (!meta || (meta.isFormula && !salaryIsEmptyClassPeriodFormula(meta.tableId, field, meta.type, meta.formula)))
    throw new Error(`${tableId}.${field} must be a writable link to ${weekly ? 'WeekRegistry' : 'MonthRegistry'}`);
  const registry = weekly ? salaryPeriodWeeksFromTable(weeks, periods.months, periods.tables, periods.columns)
    : periods.months;
  const choices = [...registry.values()].filter(period => period.valid)
    .sort((a, b) => b.startSec - a.startSec || a.id - b.id)
    .map(period => ({ id: period.id, label: period.label, alias: period.isoKey }));
  return { registry, meta, choices };
}

function salaryPeriodHistoryValue(rawValue, type) {
  const raw = normalizeTypedCell(rawValue);
  const list = type.startsWith('RefList');
  const reference = salaryPeriodReference(raw);
  // History retains the original value when an edit repairs a malformed or multi-link cell.
  if (reference.empty) return list ? ['L'] : 0;
  if (list && Array.isArray(raw)) {
    const ids = raw[0] === 'L' ? raw.slice(1) : raw;
    if (ids.every(id => (typeof id === 'number' || typeof id === 'string')
        && Number.isInteger(Number(id)) && Number(id) > 0)) return ['L', ...ids.map(Number)];
    return raw;
  }
  return reference.valid ? (list ? ['L', reference.id] : reference.id) : raw;
}

async function salaryReadRecordPeriod(recordId, col) {
  const payment = salaryIsPaymentPeriodColumn(col);
  if (!payment && !salaryClassPeriodField(col)) throw new Error('Choose a payroll period column');
  const field = payment ? salaryPaymentPeriodFields[col] : col;
  const tableId = payment ? WIDGET_CONFIG.expensesTableId : await salaryResolveClassTableId();
  const results = await Promise.allSettled([
    grist.docApi.fetchTable(tableId), salaryReadPeriodChoices(tableId, field),
  ]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  const [table, { registry, meta, choices }] = results.map(result => result.value);
  if (!Array.isArray(table[field])) throw new Error(`${tableId}.${field} is unavailable`);
  const index = table.id.findIndex(id => Number(id) === recordId);
  if (index < 0) throw new Error(`${tableId} record #${recordId} is unavailable`);
  const teachers = payment || salaryClassesSelectedByTeacher
    ? salaryRequireTeacherColumn(table, tableId) : salaryTeacherColumn(table);
  const value = salaryPeriodHistoryValue(table[field][index], meta.type);
  return {
    tableId: meta.tableId, field, before: { type: meta.type, value },
    teacherIds: salaryReferenceIds(table[teachers]?.[index]),
    registry, choices,
  };
}

function salaryRequireCurrentPeriodRow(recordId, col, teacherIds) {
  const payment = salaryIsPaymentPeriodColumn(col);
  if (!payment && !allRecords.some(row => Number(row.id) === recordId))
    throw new Error('This class is no longer in the selected salary records');
  if ((payment || salaryClassesSelectedByTeacher) && !teacherIds.some(id => salarySelectedTeacherIds.has(id)))
    throw new Error(`This ${payment ? 'payment' : 'class'} is no longer in the selected salary records`);
}

async function salaryRecordPeriodEditInfo(recordId, col) {
  const { choices, before, teacherIds } = await salaryReadRecordPeriod(recordId, col);
  salaryRequireCurrentPeriodRow(recordId, col, teacherIds);
  const reference = salaryPeriodReference(before.value);
  return { choices, currentId: reference.valid ? reference.id : null, before };
}

function salaryRevealPaymentPeriod(paymentId) {
  if (salaryPayrollActive()) {
    for (const parent of getGroups()) {
      const leaf = parent.children.find(group => group.payments.some(row => Number(row.id) === paymentId));
      if (!leaf) continue;
      const parentClosed = collapsed.delete(parent.key);
      const leafClosed = collapsed.delete(leaf.key);
      if (parentClosed || leafClosed) salarySavePayrollCollapse();
      return;
    }
  } else {
    for (const [month, payments] of salaryPaymentsByMonth) {
      if (payments.some(row => Number(row.id) === paymentId)) {
        collapsed.delete(month);
        return;
      }
    }
  }
}

async function salaryReloadClassPeriods(revealClassId = null) {
  // A completed write supersedes class snapshots requested before Grist acknowledged it.
  if (revealClassId != null)
    salaryPendingPeriodReveal = { recordId: revealClassId, source: 'class', view: salaryPeriodView };
  salaryRefreshButton.disabled = true;
  let payments;
  await salaryLoadClassColumns(salaryLastSelectedRecords, records => {
    applyIncomingRecords(records, false);
    payments = salaryRefreshPayments(true);
  });
  await payments;
}

async function salaryWriteRecordPeriod(recordId, col, expected, value, isCurrent, restoringOriginal = false) {
  const selection = salaryClassSelectionKey;
  const view = salaryPeriodView;
  const source = await salaryReadRecordPeriod(recordId, col);
  if (selection !== salaryClassSelectionKey || view !== salaryPeriodView || (isCurrent && !isCurrent()))
    throw new Error('The salary selection changed. Open the row again.');
  if (isCurrent) salaryRequireCurrentPeriodRow(recordId, col, source.teacherIds);
  if (source.before.type !== expected.type || JSON.stringify(source.before.value) !== JSON.stringify(expected.value))
    throw new Error(`The period changed in ${source.tableId}. Refresh before editing it again.`);
  if (!restoringOriginal) {
    const next = salaryPeriodReference(value);
    if (!next.empty && !source.registry.get(next.id)?.valid)
      throw new Error('The selected period is no longer available');
  }
  await grist.docApi.applyUserActions([
    ['UpdateRecord', source.tableId, recordId, { [source.field]: value }],
  ], { parseStrings: false });
  await salaryRefreshAfterPeriodWrite(recordId, col, selection, view);
}

async function salaryRefreshAfterPeriodWrite(recordId, col, selection, view) {
  // The teacher or view can change while the write is in flight.
  const payment = salaryIsPaymentPeriodColumn(col);
  if (selection === salaryClassSelectionKey && view === salaryPeriodView)
    salaryPendingPeriodReveal = { recordId, source: payment ? 'payment' : 'class', view };
  salaryInvalidatePeriodRegistries();
  if (!payment) await salaryReloadClassPeriods();
  else if (!salaryClassRowsLoading && (salarySelectedTeacherIds.size || allRecords.length))
    await salaryRefreshPayments(true);
}

async function salarySaveRecordPeriod(recordId, col, before, newId, isCurrent) {
  if (cellHistoryBusy) throw new Error('Finish the current edit before assigning a period');
  if (!Number.isInteger(newId) || newId < 0) throw new Error('Choose a valid period');
  const value = before.type.startsWith('RefList:') ? (newId ? ['L', newId] : ['L']) : newId;
  if (cellValuesEqual(before.value, value)) return;
  cellHistoryBusy = true;
  updateCellHistoryControls();
  try {
    await salaryWriteRecordPeriod(recordId, col, before, value, isCurrent);
    const label = salaryIsPaymentPeriodColumn(col) ? `Edit payment ${salaryPaymentPeriodFields[col]}` : `Edit class ${col}`;
    rememberHistoryEntry({ kind: 'salary-record-period', label, recordId, col,
      type: before.type, before: before.value, after: value });
  } finally {
    cellHistoryBusy = false;
    updateCellHistoryControls();
  }
}
