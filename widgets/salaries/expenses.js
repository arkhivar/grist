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
  const earned = wage == null ? 0 : Math.abs(wage);
  const payments = salaryPaymentRowsFor(group.key);
  const received = payments.reduce((total, row) =>
    total + (Number.isFinite(row.amount) ? row.amount : 0), 0);
  const receivedLabel = salaryPaymentsLoaded ? salaryAmount(received) : '—';
  const matched = salaryPaymentsLoaded && earned > 0 && Math.abs(earned - received) < 0.005;
  return `<span class="salary-totals" aria-label="Earned ${esc(salaryAmount(earned))}; received ${esc(receivedLabel)}">`
    + `<span><span class="salary-total-label">Earned</span> <strong>${esc(salaryAmount(earned))}</strong></span>`
    + `<span><span class="salary-total-label">Received</span> <strong>${esc(receivedLabel)}</strong></span>`
    + (matched ? '<span class="salary-match" title="Earned and received match" aria-label="Amounts match">✓</span>' : '')
    + '</span>';
}

function salaryPaymentSectionHtml(key) {
  const payments = salaryPaymentRowsFor(key);
  const rows = payments.map(row => `<tr>`
    + `<td>${esc(row.dateLabel)}</td>`
    + `<td class="salary-payment-amount">${Number.isFinite(row.amount) ? esc(salaryAmount(row.amount)) : '—'}</td>`
    + `<td class="salary-payment-id">#${esc(row.id)}</td>`
    + `</tr>`).join('');
  const body = !salaryPaymentsLoaded
    ? '<p class="salary-payment-empty">Payments are loading or unavailable.</p>'
    : payments.length
      ? `<div class="salary-payment-scroll"><table><thead><tr><th>Date (VLAT)</th><th>Amount</th><th>Expense</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<p class="salary-payment-empty">No payments recorded for this month.</p>';
  return `<section class="salary-payments" aria-label="Salary payments">`
    + `<div class="salary-payments-heading">Payments <span class="group-badge">${payments.length}</span></div>`
    + body + '</section>';
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
