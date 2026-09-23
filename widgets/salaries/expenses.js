// Salary payments are read from Expenses and matched by the raw Performance
// reference ID. The selected class rows are still supplied by Grist's link.
let salaryPaymentsByMonth = new Map();
let salaryPaymentsLoaded = false;
let salaryPaymentRequest = 0;
let salaryClassColumnsRequest = 0;
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
  const teacherLabel = classRecords[0]?.performance ?? allRecords[0]?.performance ?? '';
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
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function salaryLoadClassColumns(selectedRecords, apply) {
  const request = ++salaryClassColumnsRequest;
  if (!selectedRecords.length) return;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const fetched = await grist.viewApi.fetchSelectedTable({
        format: 'rows', includeColumns: 'normal', expandRefs: true,
      });
      if (request !== salaryClassColumnsRequest) return;
      if (!Array.isArray(fetched)) throw new Error('Selected Attendance rows are unavailable');
      const byId = new Map(fetched.map(row => [String(row.id), row]));
      if (byId.size === selectedRecords.length
          && selectedRecords.every(row => byId.has(String(row.id)))) {
        // The full selected-table read supplies expanded Reference labels as well as hidden columns.
        apply(selectedRecords.map(row => ({ ...row, ...byId.get(String(row.id)) })));
        return;
      }
      // The linked selection can settle just after onRecords; retry once.
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    throw new Error('Selected Attendance rows changed while loading');
  } catch (error) {
    if (request !== salaryClassColumnsRequest) return;
    showToast(`Load Attendance columns failed: ${error.message || String(error)}`);
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

    const teacherIds = new Set();
    classes.id.forEach((id, index) => {
      if (!classIds.has(Number(id))) return;
      const teacherId = salaryRawRef(classes.performance[index]);
      if (teacherId != null) teacherIds.add(teacherId);
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
