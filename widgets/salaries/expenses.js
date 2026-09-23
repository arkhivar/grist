// Salary payments are read from Expenses and matched by the raw Performance
// reference ID. The selected class rows are still supplied by Grist's link.
let salaryPaymentsByMonth = new Map();
let salaryPaymentsLoaded = false;
let salaryPaymentRequest = 0;
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
  return payments.map(row => `<tr class="salary-payment-row" data-expense-id="${esc(row.id)}"`
    + ` title="Salary payment from Expenses #${esc(row.id)}">`
    + '<td class="row-grip-cell"></td>'
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

function salaryRawRef(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function salaryRefreshPayments() {
  const request = ++salaryPaymentRequest;
  const classIds = new Set(allRecords.map(record => Number(record.id)));
  salaryPaymentsByMonth = new Map();
  salaryPaymentsLoaded = false;
  salaryRefreshButton.disabled = true;
  salaryPaymentStatus.textContent = classIds.size ? 'Loading payments…' : 'No teacher selected';
  if (!classIds.size) return;
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
