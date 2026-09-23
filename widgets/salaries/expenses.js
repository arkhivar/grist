// Salary payments are read from Expenses and matched by the raw Performance
// reference ID. Linked summary group lists select original All_att class rows.
let salaryPaymentsByMonth = new Map();
let salaryPaymentsLoaded = false;
let salaryPaymentRequest = 0;
let salaryClassColumnsRequest = 0;
let salarySelectedTeacherIds = new Set();
const selectedSalaryExpenseIds = new Set();
let salaryExpenseAnchorId = null;
const salaryRefreshButton = document.getElementById('btn-refresh-payments');
const salaryPaymentStatus = document.getElementById('salary-payment-status');
const salaryNumber = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });

function salaryAmount(value) {
  return salaryNumber.format(value);
}

function salaryPaymentRowsFor(key) {
  return salaryPaymentsByMonth.get(key) || [];
}

function salaryAddPaymentGroups(groups) {
  if (!salaryPaymentsLoaded) return;
  for (const key of salaryPaymentsByMonth.keys()) {
    if (groups.has(key)) continue;
    const empty = key === '\x00__empty__';
    groups.set(key, {
      key,
      label: empty ? null : bucketLabel(Number(key), 'month'),
      sortKey: empty ? null : Number(key),
      writeValue: null,
      records: [],
    });
  }
}

function salaryGroupTotalsHtml(group) {
  const wage = sumColumn(group.records, 'wage');
  const payments = salaryPaymentRowsFor(group.key);
  const received = payments.reduce((total, row) =>
    total + (Number.isFinite(row.amount) ? row.amount : 0), 0);
  const incomeLabel = wage == null ? '—' : salaryAmount(wage);
  const receivedLabel = salaryPaymentsLoaded ? salaryAmount(received) : '—';
  const matched = salaryPaymentsLoaded && wage != null
    && Math.abs(Math.abs(wage) - received) < 0.005;
  return '<span class="group-sums">'
    + `<span class="group-sum salary-income-sum" data-column="wage"`
    + ` title="Class income: ${esc(incomeLabel)}" aria-label="Class income: ${esc(incomeLabel)}">${esc(incomeLabel)}</span>`
    + `<span class="group-sum salary-received-sum${matched ? ' salary-matched' : ''}"`
    + ` data-column="${esc(WIDGET_CONFIG.receivedColumn)}"`
    + ` title="Salary received: ${esc(receivedLabel)}${matched ? ' · amounts match' : ''}"`
    + ` aria-label="Salary received: ${esc(receivedLabel)}${matched ? '; amounts match' : ''}">`
    + `${esc(receivedLabel)}</span>`
    + '</span>';
}

function salaryColumnLabel(col) {
  if (col === 'wage') return 'income';
  if (col === WIDGET_CONFIG.receivedColumn) return 'expenses';
  return col;
}

function salaryPaymentRowsHtml(cols, key, classRecords) {
  const payments = salaryPaymentRowsFor(key);
  const dateColumn = parseGroupBy(groupBy).col;
  const teacherLabel = salarySelectedTeacherIds.size
    ? [...salarySelectedTeacherIds].map(id => salaryRefDisplay('performance', id)).join(', ')
    : classRecords[0]?.performance ?? allRecords[0]?.performance ?? '';
  return payments.map(row => `<tr class="salary-payment-row${selectedSalaryExpenseIds.has(String(row.id)) ? ' row-selected' : ''}" data-expense-id="${esc(row.id)}"`
    + ` title="Salary payment from Expenses #${esc(row.id)}">`
    + `<td class="row-grip-cell"><button type="button" class="row-grip salary-expense-grip"`
    + ` data-expense-id="${esc(row.id)}" draggable="false"`
    + ` aria-pressed="${String(selectedSalaryExpenseIds.has(String(row.id)))}"`
    + ` aria-label="Select salary payment ${esc(row.id)}"`
    + ` title="Select salary payment">${gripIconHtml()}</button></td>`
    + cols.map(col => {
      if (col === dateColumn)
        return `<td class="salary-payment-date"><span class="cell-num">${esc(row.dateLabel)}</span></td>`;
      if (col === 'performance') return `<td>${esc(teacherLabel)}</td>`;
      if (col === WIDGET_CONFIG.receivedColumn)
        return `<td class="salary-payment-amount"><span class="cell-num">${Number.isFinite(row.amount) ? esc(salaryAmount(row.amount)) : '—'}</span></td>`;
      return '<td></td>';
    }).join('')
    + '<td class="row-actions"></td></tr>').join('');
}

function salaryRefreshExpenseSelection() {
  content.querySelectorAll('.salary-expense-grip[data-expense-id]').forEach(grip => {
    const selected = selectedSalaryExpenseIds.has(grip.dataset.expenseId);
    grip.setAttribute('aria-pressed', String(selected));
    grip.closest('tr')?.classList.toggle('row-selected', selected);
  });
}

function salaryClearExpenseSelection() {
  if (!selectedSalaryExpenseIds.size) return;
  selectedSalaryExpenseIds.clear();
  salaryExpenseAnchorId = null;
  salaryRefreshExpenseSelection();
}

content.addEventListener('click', event => {
  const grip = event.target.closest('.salary-expense-grip[data-expense-id]');
  if (!grip) return;
  event.preventDefault();
  event.stopPropagation();
  const id = grip.dataset.expenseId;
  if (selectedIds.size) {
    selectedIds.clear();
    selectionAnchorId = null;
    finishSelectionChange();
  }
  const additive = event.ctrlKey || event.metaKey;
  if (event.shiftKey) {
    const orderedIds = [...content.querySelectorAll('.salary-expense-grip[data-expense-id]')]
      .filter(button => !button.closest('.group.collapsed'))
      .map(button => button.dataset.expenseId);
    const targetIndex = orderedIds.indexOf(id);
    if (targetIndex < 0) return;
    let anchorIndex = orderedIds.indexOf(salaryExpenseAnchorId);
    if (anchorIndex < 0) {
      salaryExpenseAnchorId = id;
      anchorIndex = targetIndex;
    }
    if (!additive) selectedSalaryExpenseIds.clear();
    orderedIds.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
      .forEach(expenseId => selectedSalaryExpenseIds.add(expenseId));
  } else if (additive) {
    if (selectedSalaryExpenseIds.has(id)) selectedSalaryExpenseIds.delete(id);
    else selectedSalaryExpenseIds.add(id);
    salaryExpenseAnchorId = id;
  } else {
    const alreadySoleSelected = selectedSalaryExpenseIds.size === 1
      && selectedSalaryExpenseIds.has(id);
    selectedSalaryExpenseIds.clear();
    if (!alreadySoleSelected) selectedSalaryExpenseIds.add(id);
    salaryExpenseAnchorId = alreadySoleSelected ? null : id;
  }
  salaryRefreshExpenseSelection();
});

function salaryRawRef(value) {
  const id = Number(Array.isArray(value) && value[0] === 'R' ? value[2] : value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function salaryGroupIds(value) {
  if (!Array.isArray(value)) return [];
  if (value[0] === 'l') return salaryGroupIds(value[1]);
  if (value[0] === 'r')
    return (Array.isArray(value[2]) ? value[2] : []).map(salaryRawRef).filter(id => id != null);
  if (value[0] !== 'L') return [];
  return value.slice(1).map(salaryRawRef).filter(id => id != null);
}

function salaryReferenceIds(value) {
  const single = salaryRawRef(value);
  return single == null ? salaryGroupIds(value) : [single];
}

function salaryDisplayClassCell(col, value) {
  if (Array.isArray(value) && value[0] === 'l')
    return salaryDisplayClassCell(col, value[1]);
  const type = columnTypes[col] || '';
  if (type.startsWith('Ref:')) {
    const id = salaryRawRef(value);
    return id == null ? '' : salaryRefDisplay(col, id);
  }
  if (type.startsWith('RefList:'))
    return salaryGroupIds(value).map(id => salaryRefDisplay(col, id)).join(', ');
  if (Array.isArray(value) && (value[0] === 'D' || value[0] === 'd'))
    return value[1];
  return value;
}

async function salaryLoadClassColumns(selectedRecords, apply) {
  const request = ++salaryClassColumnsRequest;
  ++salaryPaymentRequest;
  salaryPaymentsByMonth = new Map();
  salaryPaymentsLoaded = false;
  salarySelectedTeacherIds = new Set();
  salaryPaymentStatus.textContent = selectedRecords.length ? 'Loading classes…' : 'No teacher selected';
  if (!selectedRecords.length) { apply([]); return; }
  try {
    const sourceId = await grist.selectedTable.getTableId();
    await getWritableColumnIds();
    // Some Grist builds report the source table ID for a summary section.
    // The selected records still carry the summary's group RefList in that case.
    const linkedRows = sourceId === WIDGET_CONFIG.classTableId
      && selectedRecords.some(row => salaryGroupIds(row.group).length);
    const [source, classes] = await Promise.all([
      linkedRows ? { id: selectedRecords.map(row => row.id),
        group: selectedRecords.map(row => row.group),
        performance: selectedRecords.map(row => row.performance) }
        : sourceId === WIDGET_CONFIG.classTableId ? null : grist.docApi.fetchTable(sourceId),
      grist.docApi.fetchTable(WIDGET_CONFIG.classTableId),
    ]);
    if (request !== salaryClassColumnsRequest) return;
    if (!Array.isArray(classes.id)) throw new Error('Attendance rows are unavailable');
    let classIds;
    if (!source) classIds = selectedRecords.map(row => salaryRawRef(row.id));
    else {
      if (!Array.isArray(source.id) || !Array.isArray(source.group))
        throw new Error(`${sourceId}.group must link to Attendance rows`);
      const sourceById = new Map(source.id.map((id, index) => [Number(id), index]));
      const teacherIds = new Set();
      classIds = selectedRecords.flatMap(row => {
        const index = sourceById.get(Number(row.id));
        if (index != null && Array.isArray(source.performance))
          salaryReferenceIds(source.performance[index]).forEach(id => teacherIds.add(id));
        return index == null ? [] : salaryGroupIds(source.group[index]);
      });
      salarySelectedTeacherIds = teacherIds;
    }
    const selectedIds = new Set(classIds.filter(id => id != null));
    if (source && !selectedIds.size)
      throw new Error(`${sourceId}.group has no Attendance rows for this selection`);
    const refCols = Object.keys(columnTypes).filter(col =>
      columnTypes[col].startsWith('Ref:') || columnTypes[col].startsWith('RefList:'));
    await Promise.allSettled(refCols.map(col => salaryRefChoices(col)));
    if (request !== salaryClassColumnsRequest) return;
    if (source && !salarySelectedTeacherIds.size) {
      const labels = salaryRefLabels.get('performance');
      selectedRecords.forEach(row => {
        const label = String(row.performance ?? '');
        labels?.forEach((value, id) => {
          if (value === label) salarySelectedTeacherIds.add(id);
        });
      });
    }
    const cols = Object.keys(columnTypes).filter(col => Array.isArray(classes[col]));
    const records = classes.id.flatMap((id, index) => {
      if (!selectedIds.has(Number(id))) return [];
      const record = { id: Number(id) };
      cols.forEach(col => { record[col] = salaryDisplayClassCell(col, classes[col][index]); });
      return [record];
    });
    apply(records);
  } catch (error) {
    if (request !== salaryClassColumnsRequest) return;
    apply([]);
    const message = error.message || String(error);
    salaryPaymentStatus.textContent = `Classes unavailable: ${message}`;
    showToast(`Load Attendance classes failed: ${message}`);
  }
}

async function salaryRefreshPayments() {
  const request = ++salaryPaymentRequest;
  const classIds = new Set(allRecords.map(record => Number(record.id)));
  salaryPaymentsByMonth = new Map();
  salaryPaymentsLoaded = false;
  salaryRefreshButton.disabled = true;
  salaryPaymentStatus.textContent = classIds.size ? 'Loading payments…' : 'No teacher selected';
  if (!classIds.size) {
    salaryClearExpenseSelection();
    salaryRefreshButton.disabled = false;
    return;
  }
  render();

  try {
    await getWritableColumnIds();
    const [classes, expenses] = await Promise.all([
      grist.docApi.fetchTable(selectedTableId),
      grist.docApi.fetchTable(WIDGET_CONFIG.expensesTableId),
    ]);
    if (request !== salaryPaymentRequest) return;
    if (!Array.isArray(classes.id) || !Array.isArray(classes.performance))
      throw new Error(`${selectedTableId}.performance is unavailable`);
    if (!Array.isArray(expenses.id) || !Array.isArray(expenses.performance)
        || !Array.isArray(expenses.date) || !Array.isArray(expenses.amount))
      throw new Error(`${WIDGET_CONFIG.expensesTableId} must have performance, date, and amount columns`);

    const teacherIds = new Set(salarySelectedTeacherIds);
    if (!teacherIds.size) classes.id.forEach((id, index) => {
      if (classIds.has(Number(id)))
        salaryReferenceIds(classes.performance[index]).forEach(teacherId => teacherIds.add(teacherId));
    });
    if (!teacherIds.size)
      throw new Error(`No Performance reference found in the selected ${selectedTableId} classes`);

    const months = new Map();
    expenses.id.forEach((id, index) => {
      if (!teacherIds.has(salaryRawRef(expenses.performance[index]))) return;
      const sec = parseDateValueSec(expenses.date[index]);
      const key = sec == null ? '\x00__empty__'
        : String(bucketStartMs(dateTimeWallDate(sec).getTime() / 1000, 'month'));
      const row = {
        id, sec,
        dateLabel: sec == null ? '—' : formatDateTimeSec(sec),
        amount: expenses.amount[index] == null || expenses.amount[index] === ''
          ? null : Number(expenses.amount[index]),
      };
      if (!months.has(key)) months.set(key, []);
      months.get(key).push(row);
    });
    months.forEach(rows => rows.sort((a, b) => (b.sec ?? -Infinity) - (a.sec ?? -Infinity)
      || Number(b.id) - Number(a.id)));
    salaryPaymentsByMonth = months;
    salaryPaymentsLoaded = true;
    const presentIds = new Set([...months.values()].flat().map(row => String(row.id)));
    selectedSalaryExpenseIds.forEach(id => {
      if (!presentIds.has(id)) selectedSalaryExpenseIds.delete(id);
    });
    if (!selectedSalaryExpenseIds.size) salaryExpenseAnchorId = null;
    const count = [...months.values()].reduce((total, rows) => total + rows.length, 0);
    salaryPaymentStatus.textContent = `${count} ${count === 1 ? 'payment' : 'payments'}`;
  } catch (error) {
    if (request !== salaryPaymentRequest) return;
    const message = error && error.message ? error.message : String(error);
    salaryPaymentStatus.textContent = `Payments unavailable: ${message}`;
    showToast(`Load payments failed: ${message}`);
  } finally {
    if (request === salaryPaymentRequest) {
      salaryRefreshButton.disabled = false;
      render();
    }
  }
}

salaryRefreshButton.addEventListener('click', () => salaryRefreshPayments());
