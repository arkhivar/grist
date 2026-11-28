// Payment links belong to Transactions, independently of the selected Attendance table.
async function salaryReadPaymentPeriod(paymentId, col) {
  if (!salaryIsPaymentPeriodColumn(col)) throw new Error('Choose a payment period column');
  const field = salaryPaymentPeriodFields[col];
  const weekly = field === 'forWeek';
  const results = await Promise.allSettled([
    grist.docApi.fetchTable(WIDGET_CONFIG.expensesTableId),
    salaryFetchMonthRegistry(salaryFetchPeriodMetadata()),
    weekly ? grist.docApi.fetchTable('WeekRegistry') : null,
  ]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  const [ledger, periods, weeks] = results.map(result => result.value);
  const meta = salaryPaymentPeriodMeta(field, periods);
  if (!meta || meta.isFormula || !Array.isArray(ledger[field]))
    throw new Error(`${WIDGET_CONFIG.expensesTableId}.${field} must be a writable link to ${weekly ? 'WeekRegistry' : 'MonthRegistry'}`);
  const index = ledger.id.findIndex(id => Number(id) === paymentId);
  if (index < 0) throw new Error(`Payment #${paymentId} is unavailable`);
  const teachers = salaryRequireTeacherColumn(ledger, meta.tableId);
  const raw = normalizeTypedCell(ledger[field][index]);
  const list = meta.type.startsWith('RefList:');
  const reference = salaryPeriodReference(raw);
  // History uses writable Grist values and retains all IDs when repairing a multi-link.
  let value = raw;
  if (reference.empty) value = list ? ['L'] : 0;
  else if (list && Array.isArray(raw)) {
    const ids = raw[0] === 'L' ? raw.slice(1) : raw;
    if (ids.every(id => (typeof id === 'number' || typeof id === 'string')
        && Number.isInteger(Number(id)) && Number(id) > 0)) value = ['L', ...ids.map(Number)];
  } else if (reference.valid) value = list ? ['L', reference.id] : reference.id;
  return {
    tableId: meta.tableId, field, before: { type: meta.type, value },
    teacherIds: salaryReferenceIds(ledger[teachers][index]),
    registry: weekly ? salaryPeriodWeeksFromTable(weeks, periods.months, periods.tables, periods.columns)
      : periods.months,
  };
}

async function salaryPaymentPeriodEditInfo(paymentId, col) {
  const { registry, before, teacherIds } = await salaryReadPaymentPeriod(paymentId, col);
  if (!teacherIds.some(id => salarySelectedTeacherIds.has(id)))
    throw new Error('This payment is no longer in the selected salary records');
  const reference = salaryPeriodReference(before.value);
  const choices = [...registry.values()].filter(period => period.valid)
    .sort((a, b) => b.startSec - a.startSec || a.id - b.id)
    .map(({ id, label }) => ({ id, label }));
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

async function salaryWritePaymentPeriod(paymentId, col, expected, value, isCurrent, restoringOriginal = false) {
  const selection = salaryClassSelectionKey;
  const view = salaryPeriodView;
  const source = await salaryReadPaymentPeriod(paymentId, col);
  if (selection !== salaryClassSelectionKey || view !== salaryPeriodView || (isCurrent && !isCurrent()))
    throw new Error('The salary selection changed. Open the payment again.');
  if (isCurrent && !source.teacherIds.some(id => salarySelectedTeacherIds.has(id)))
    throw new Error('This payment is no longer in the selected salary records');
  if (source.before.type !== expected.type || JSON.stringify(source.before.value) !== JSON.stringify(expected.value))
    throw new Error('The payment period changed in Transactions. Refresh before editing it again.');
  if (!restoringOriginal) {
    const next = salaryPeriodReference(value);
    if (!next.empty && !source.registry.get(next.id)?.valid)
      throw new Error('The selected period is no longer available');
  }
  await grist.docApi.applyUserActions([
    ['UpdateRecord', source.tableId, paymentId, { [source.field]: value }],
  ], { parseStrings: false });

  // Re-read the ledger after acknowledgement. A user can switch teachers during the write.
  // An in-flight class load will fetch payments for its own selection when it finishes.
  if (selection === salaryClassSelectionKey && view === salaryPeriodView)
    salaryPendingPaymentReveal = { paymentId, view };
  salaryInvalidatePeriodRegistries();
  if (!salaryClassRowsLoading && (salarySelectedTeacherIds.size || allRecords.length))
    await salaryRefreshPayments(true);
}

async function salarySavePaymentPeriod(paymentId, col, before, newId, isCurrent) {
  if (cellHistoryBusy) throw new Error('Finish the current edit before assigning a payment period');
  if (!Number.isInteger(newId) || newId < 0) throw new Error('Choose a valid payment period');
  const value = before.type.startsWith('RefList:') ? (newId ? ['L', newId] : ['L']) : newId;
  if (cellValuesEqual(before.value, value)) return;
  cellHistoryBusy = true;
  updateCellHistoryControls();
  try {
    await salaryWritePaymentPeriod(paymentId, col, before, value, isCurrent);
    rememberHistoryEntry({ kind: 'salary-payment-period', label: `Edit payment ${salaryPaymentPeriodFields[col]}`,
      paymentId, col, type: before.type, before: before.value, after: value });
  } finally {
    cellHistoryBusy = false;
    updateCellHistoryControls();
  }
}
