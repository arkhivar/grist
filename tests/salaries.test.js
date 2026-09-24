#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('salaries.html');
const version = /WIDGET_VERSION = '([^']+)'/.exec(read('shared/core.js'))[1];
const assets = [...html.matchAll(/(?:src|href)="([^"]+\?v=([^"]+))"/g)]
  .filter(match => !match[1].startsWith('https://'));
assert.equal(assets.length, 8);
assert(assets.every(match => match[2] === version), 'salaries asset versions differ');
assert(html.includes('widgets/salaries/config.js'));

const dom = new JSDOM(html, {
  url: 'https://arkhivar.github.io/grist/salaries.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const win = dom.window;
const doc = win.document;
let onOptions;
let onRecords;
let selectedSourceId = 'All_att_summary_performance';
const calls = { ready: [], options: [], updates: [] };
let summary = { id: [91, 92, 93, 94], performance: [7, 8, 7, 7], group: [
  ['L', 1, 2, 3], ['L', 6], ['L', 4], ['L', 5],
] };
const attendance = {
  id: [1, 2, 3, 4, 5, 6],
  datetime: [['D', Date.parse('2026-07-31T14:30:00Z') / 1000, 'Asia/Vladivostok'],
    Date.parse('2026-08-15T03:00:00Z') / 1000, '2026-07-31T13:30:00Z',
    null, null, Date.parse('2026-08-15T03:00:00Z') / 1000],
  performance: [['L', 7], ['L', 7, 8], ['L', 7], ['L', 7], ['L', 7], ['L', 8]],
  group2: [31, 31, 31, 31, 31, 31],
  group3: [['L', 31, 32], null, null, null, null, null],
  students: [21, 21, 21, 21, 21, 21],
  weekday: ['Tue', 'Sat', 'Fri', '', '', 'Sat'],
  notes: ['First note', '', '', '', '', ''],
  count: [-100, -200, -50, 75, -1425, 200],
  wage: [-100, -200, -50, 75, -1425, 200],
  sprint: ['Sprint 07', 'Sprint 07', 'Sprint 07', '', '', 'Sprint 07'],
};
let expenses = {
  id: [11, 12, 13, 14],
  performance: [7, 7, 8, 7],
  date: ['2026-07-31T14:30:00Z', '2026-07-31T13:30:00Z', '2026-08-15T03:00:00Z', '2026-09-02T00:00:00Z'],
  amount: [100, 50, 200, 20],
};
win.grist = {
  ready(options) { calls.ready.push(options); },
  onOptions(callback) { onOptions = callback; },
  onRecords(callback) { onRecords = callback; },
  setOption(key, value) { calls.options.push([key, value]); },
  selectedTable: {
    getTableId: async () => selectedSourceId,
  },
  viewApi: {},
  docApi: { applyUserActions: async actions => {
    actions.forEach(([kind, table, id, fields]) => {
      assert.equal(table, 'All_att', 'class edits must target original class rows');
      if (kind === 'UpdateRecord') {
        calls.updates.push({ id, fields });
        const index = attendance.id.indexOf(id);
        Object.entries(fields).forEach(([col, value]) => { attendance[col][index] = value; });
      }
    });
    return { retValues: [] };
  }, fetchTable: async name => {
    if (name === '_grist_Tables')
      return { id: [1, 2, 3, 4, 5], tableId: ['All_att', 'FolksBase', 'Performance', 'Groups', 'All_att_summary_performance'] };
    if (name === '_grist_Tables_column')
      return { id: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
        parentId: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 4],
        colId: ['group2', 'performance', 'datetime', 'wage', 'count',
          'students', 'weekday', 'notes', 'group3', 'sprint', 'Name', 'Name', 'Name'],
        type: ['Ref:Groups', 'RefList:Performance', 'DateTime:Asia/Vladivostok',
          'Numeric', 'Numeric', 'Ref:FolksBase', 'Text', 'Text', 'RefList:Groups',
          'Choice', 'Text', 'Text', 'Text'],
        visibleCol: [22, 21, 0, 0, 0, 20, 0, 0, 22, 0, 0, 0, 0],
        isFormula: [false, false, false, false, false, false, true, false, false, false, false, false, false] };
    if (name === 'All_att_summary_performance') return summary;
    if (name === 'All_att') return attendance;
    if (name === 'FolksBase')
      return { id: [21, 22], Name: ['A. Student', 'B. Student'] };
    if (name === 'Performance') return { id: [7, 8], Name: ['VP', 'TR'] };
    if (name === 'Groups') return { id: [31, 32], Name: ['Relentless', 'North, <Team>'] };
    if (name === 'Expenses') {
      if (expenses instanceof Error) throw expenses;
      return expenses;
    }
    throw new Error(`Unexpected table ${name}`);
  } },
};

win.eval([
  'widgets/salaries/config.js',
  'shared/core.js',
  'widgets/salaries/expenses.js',
  'widgets/sprints/app.js',
  'widgets/sprints/actions.js',
  'widgets/salaries/attendance.js',
].map(read).join('\n;\n'));

const records = [{ id: 91, group: ['L', 1, 2, 3], performance: 'VP' }];
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitFor(condition) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await tick();
  }
  throw new Error('Timed out waiting for salary payments');
}
const cards = () => [...doc.querySelectorAll('.group')];
const month = label => cards().find(card => card.dataset.groupLabel === label);
const refPills = (id, col) => [...doc.querySelectorAll(
  `[data-cell-id="${id}"][data-cell-col="${col}"] .cell-ref-pill`)]
  .map(pill => pill.textContent);

async function main() {
  // Grist delivers options, records, and metadata independently.
  onOptions({ sortMode: 'alpha-asc',
    columnOrder: ['datetime', 'wage', 'salary_received', 'performance', 'group2'],
    columnVisibility: { salary_received: false } },
  { accessLevel: 'full' });
  onRecords(records);
  await waitFor(() => doc.getElementById('salary-payment-status').textContent === '3 payments');
  await waitFor(() => doc.querySelector('[data-column="students"]'));
  assert(!doc.querySelector('#column-strip th[data-column="salary_received"]'),
    'visibility option delivered before records did not hide expenses');
  assert(!month('August 2026').querySelector('.group-sum[data-column="salary_received"]'),
    'hidden expenses subtotal still floats in the month header');
  const columnsButton = doc.getElementById('btn-columns');
  const columnsPanel = doc.getElementById('column-control');
  assert(columnsButton && columnsPanel, 'salary toolbar column control is missing');
  columnsButton.click();
  assert(!columnsPanel.hidden && columnsButton.getAttribute('aria-expanded') === 'true',
    'salary column control did not open');
  assert(!columnsPanel.querySelector('input[type="search"]'), 'column search was not requested');
  const receivedRow = () => columnsPanel.querySelector('.column-control-row[data-column="salary_received"]');
  assert(receivedRow(), 'synthetic expenses column is missing from the control');
  assert(receivedRow().textContent.includes('expenses'), 'synthetic column lacks its salary label');
  assert.equal(receivedRow().querySelector('.column-control-toggle').checked, false);
  const controlOrder = () => [...columnsPanel.querySelectorAll('.column-control-row')]
    .map(row => row.dataset.column);
  const beforeOrder = controlOrder();
  const receivedPosition = beforeOrder.indexOf('salary_received');
  assert(receivedPosition >= 0 && receivedPosition < beforeOrder.length - 1,
    'hidden expenses column cannot be moved down');
  const orderSaveCount = calls.options.length;
  receivedRow().querySelector('.column-control-grip').dispatchEvent(new win.KeyboardEvent('keydown',
    { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
  await waitFor(() => calls.options.slice(orderSaveCount).some(([key]) => key === 'columnOrder'));
  assert.equal(controlOrder()[receivedPosition + 1], 'salary_received',
    'hidden expenses column did not move down');
  assert(!doc.querySelector('#column-strip th[data-column="salary_received"]'),
    'moving a hidden column made it visible');
  const movedGrip = receivedRow().querySelector('.column-control-grip');
  movedGrip.dispatchEvent(new win.KeyboardEvent('keydown',
    { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true }));
  await waitFor(() => controlOrder()[receivedPosition] === 'salary_received');
  const visibilitySaveCount = calls.options.length;
  const receivedToggle = receivedRow().querySelector('.column-control-toggle');
  receivedToggle.click();
  await waitFor(() => calls.options.slice(visibilitySaveCount)
    .some(([key, value]) => key === 'columnVisibility' && value.salary_received === true));
  assert(doc.querySelector('#column-strip th[data-column="salary_received"]'),
    'restored expenses column is absent from the fixed header');
  assert(month('August 2026').querySelector('.group-sum[data-column="salary_received"]'),
    'restored expenses subtotal is absent from the month header');
  columnsButton.click();
  assert(columnsPanel.hidden, 'salary column control did not close');
  assert.equal(calls.ready[0].requiredAccess, 'full');
  assert(calls.options.some(([key, value]) => key === 'groupBy' && value === 'datetime::month'));
  assert.equal(doc.getElementById('group-select').value, 'datetime::month');
  assert.deepEqual([...doc.querySelectorAll('#group-select option')].map(option => option.value), ['', 'datetime::month']);
  assert.equal(cards().length, 3);
  assert.equal(cards()[0].dataset.groupLabel, 'July 2026');
  const augustHeader = month('August 2026').querySelector('.group-header');
  const augustBadge = augustHeader.querySelector('.group-badge');
  assert.equal(augustBadge.textContent, '2');
  assert.equal(augustHeader.querySelector('.group-label').nextElementSibling, augustBadge,
    'salary count should follow the month label');
  assert.equal(augustBadge.nextElementSibling, augustHeader.querySelector('.group-sums'),
    'salary count should precede the month totals');
  assert.equal(augustBadge.getAttribute('aria-label'), '2\u00a0classes');
  const headers = [...doc.querySelectorAll('#column-strip thead th[data-column]')]
    .map(cell => cell.dataset.column);
  assert(doc.querySelector('.toolbar #statsbar.visible'), 'salary counts were not moved into the toolbar');
  assert(doc.querySelector('#content + #column-scrollbar:not([hidden])'),
    'the scrollbar should sit below the scrolling view');
  assert.equal(doc.querySelector('#column-scrollbar .column-scrollbar-width').style.width,
    doc.querySelector('#column-strip .rec-table').style.width,
    'the salary scrollbar does not cover every displayed column');
  assert.equal(doc.querySelectorAll('.group tfoot .column-name').length, 0,
    'month cards still repeat column headers');
  assert(doc.querySelector('#column-strip .column-resize-handle[aria-label="Resize column datetime"]'),
    'fixed header has no column resize control');
  assert(headers.includes('datetime'), 'monthly date is missing from the row columns');
  assert.deepEqual(headers.slice(0, 5),
    ['datetime', 'wage', 'salary_received', 'performance', 'group2'],
    'saved column order changed when new fields arrived');
  for (const column of ['students', 'weekday', 'notes', 'count', 'performance', 'group2', 'group3', 'sprint'])
    assert(headers.includes(column), `${column} is missing from the row columns`);
  assert(doc.querySelector('[data-cell-id="1"][data-cell-col="group2"]')
    .textContent.includes('Relentless'), 'reference display text was replaced by a row ID');
  assert.deepEqual(refPills(1, 'group2'), ['Relentless'], 'single Reference needs one pill');
  assert.deepEqual(refPills(1, 'students'), ['A. Student'], 'linked student needs one pill');
  assert.deepEqual(refPills(1, 'group3'), ['Relentless', 'North, <Team>'],
    'Reference List labels with commas must stay separate pills');
  const group3Cell = doc.querySelector('[data-cell-id="1"][data-cell-col="group3"]');
  assert(group3Cell.querySelector('.cell-ref-list'), 'Reference List has no pill container');
  assert(!group3Cell.querySelector('team'), 'Reference label was parsed as HTML');
  assert.equal(doc.querySelector('[data-cell-id="2"][data-cell-col="group3"] .cell-ref-pill'), null,
    'empty Reference List gained a pill');
  assert(doc.querySelector('[data-cell-id="2"][data-cell-col="group3"] .cell-null'),
    'empty Reference List lost its empty-cell marker');
  assert.equal(doc.querySelector('[data-cell-id="1"][data-cell-col="notes"] .cell-ref-pill'), null,
    'plain text was rendered as a linked record');
  assert.equal(doc.querySelector('[data-cell-col="weekday"]').getAttribute('data-cell-writable'), 'false');
  assert(doc.querySelector('[data-edit-col="datetime"]'), 'class DateTime is not editable');
  assert(!doc.querySelector('[data-edit-col="weekday"]'), 'formula weekday became editable');
  assert(doc.querySelector('[data-edit-col="students"]'), 'class reference is not editable');
  assert(doc.querySelector('[data-edit-col="count"]'), 'writable number is not editable');
  assert(doc.querySelector('[data-edit-col="wage"]'), 'writable wage is not editable');
  const notesCell = doc.querySelector('[data-cell-id="1"][data-cell-col="notes"]');
  notesCell.click();
  notesCell.click();
  assert.equal(doc.getElementById('cell-editor').hidden, false);
  doc.getElementById('cell-editor-text').value = 'Updated note';
  doc.getElementById('btn-editor-save').click();
  await waitFor(() => calls.updates.some(update => update.fields?.notes === 'Updated note'));
  await waitFor(() => doc.getElementById('cell-editor').hidden);
  const studentCell = doc.querySelector('[data-cell-id="1"][data-cell-col="students"]');
  studentCell.click();
  studentCell.click();
  await waitFor(() => [...doc.querySelectorAll('.salary-ref-option')]
    .some(option => option.textContent.includes('B. Student')));
  [...doc.querySelectorAll('.salary-ref-option')]
    .find(option => option.textContent.includes('B. Student')).click();
  await waitFor(() => calls.updates.some(update => update.fields?.students === 22));
  await waitFor(() => doc.querySelector('[data-cell-id="1"][data-cell-col="students"]')
    ?.textContent.includes('B. Student'));
  assert.deepEqual(refPills(1, 'students'), ['B. Student'], 'edited Reference lost its pill');
  doc.getElementById('btn-undo').click();
  await waitFor(() => doc.querySelector('[data-cell-id="1"][data-cell-col="students"]')
    ?.textContent.includes('A. Student'));
  assert.deepEqual(refPills(1, 'students'), ['A. Student'], 'undo lost the Reference pill');
  assert(calls.updates.some(update => update.fields?.students === 21));
  doc.getElementById('btn-redo').click();
  await waitFor(() => doc.querySelector('[data-cell-id="1"][data-cell-col="students"]')
    ?.textContent.includes('B. Student'));
  assert.deepEqual(refPills(1, 'students'), ['B. Student'], 'redo lost the Reference pill');
  const teacherCell = doc.querySelector('[data-cell-id="1"][data-cell-col="performance"]');
  teacherCell.click();
  teacherCell.click();
  await waitFor(() => [...doc.querySelectorAll('.salary-ref-option')]
    .some(option => option.textContent.includes('TR')));
  [...doc.querySelectorAll('.salary-ref-option')]
    .find(option => option.textContent.includes('TR')).click();
  assert.equal(doc.getElementById('salary-ref-save').hidden, false);
  doc.getElementById('salary-ref-save').click();
  await waitFor(() => calls.updates.some(update => update.id === 1
    && JSON.stringify(update.fields?.performance) === JSON.stringify(['L', 7, 8])));
  await waitFor(() => refPills(1, 'performance').length === 2);
  assert.deepEqual(refPills(1, 'performance'), ['VP', 'TR'],
    'edited Reference List needs separate pills');
  doc.getElementById('btn-undo').click();
  await waitFor(() => refPills(1, 'performance').length === 1);
  assert.deepEqual(refPills(1, 'performance'), ['VP'], 'undo lost Reference List pill');
  doc.getElementById('btn-redo').click();
  await waitFor(() => refPills(1, 'performance').length === 2);
  assert.deepEqual(refPills(1, 'performance'), ['VP', 'TR'],
    'redo lost separate Reference List pills');
  assert.equal(headers.indexOf('salary_received'), headers.indexOf('wage') + 1);
  assert.equal(doc.querySelector('#column-strip [data-column="wage"] .column-name').textContent, 'income');
  assert.equal(doc.querySelector('#column-strip [data-column="salary_received"] .column-name').textContent, 'expenses');
  assert(month('August 2026').querySelector('td[data-cell-col="datetime"]').textContent.includes('2026-08-01 00:30'));
  assert(!doc.getElementById('content').textContent.includes('D, '), 'encoded DateTime leaked into class cells');
  assert(!doc.getElementById('content').textContent.includes('L, '), 'encoded RefList leaked into class cells');
  assert.equal(month('August 2026').querySelector('.group-sum[data-column="wage"]').textContent, '-300');
  assert.equal(month('August 2026').querySelector('.group-sum[data-column="salary_received"]').textContent, '100');
  assert.equal(month('July 2026').querySelector('.group-sum[data-column="wage"]').textContent, '-50');
  assert(month('July 2026').querySelector('.salary-matched'));
  assert.equal(month('September 2026').querySelector('.group-badge').textContent, '0');
  assert.equal(month('September 2026').querySelector('.group-badge').getAttribute('aria-label'),
    '0\u00a0classes', 'payment-only month needs an accessible zero-class count');
  assert.equal(month('September 2026').querySelector('.group-sum[data-column="salary_received"]').textContent, '20');
  assert.equal(doc.querySelectorAll('.salary-payment-row').length, 3);
  assert(!month('August 2026').querySelector('[data-expense-id="13"]'));
  assert(!doc.querySelector('.salary-payments-heading'));
  const payment = month('August 2026').querySelector('.salary-payment-row');
  const dateIndex = headers.indexOf('datetime') + 1;
  const performanceIndex = headers.indexOf('performance') + 1;
  const receivedIndex = headers.indexOf('salary_received') + 1;
  assert(payment.cells[dateIndex].textContent.includes('2026-08-01 00:30'));
  assert.equal(payment.cells[receivedIndex].textContent, '100');
  assert.deepEqual([...payment.cells[performanceIndex].querySelectorAll('.cell-ref-pill')]
    .map(pill => pill.textContent), ['VP'], 'payment teacher needs a linked-record pill');
  assert.equal(payment.cells[performanceIndex].querySelector('[data-edit-kind]'), null,
    'payment teacher became editable');
  assert.equal(payment.querySelectorAll('td.data-cell').length, 0, 'payment rows entered class edit history');
  assert.equal(payment.closest('table'), month('August 2026').querySelector('[data-record-id="1"]').closest('table'));
  onRecords([records[0], { id: 92, group: ['L', 6], performance: 'TR' }]);
  await waitFor(() => doc.getElementById('salary-payment-status').textContent === '4 payments'
    && month('August 2026')?.querySelector('[data-expense-id="13"]'));
  const paymentTeacher = id => [...doc.querySelector(`[data-expense-id="${id}"]`)
    .cells[performanceIndex].querySelectorAll('.cell-ref-pill')].map(pill => pill.textContent);
  assert.deepEqual(paymentTeacher(11), ['VP'], 'VP payment picked up another selected teacher');
  assert.deepEqual(paymentTeacher(13), ['TR'], 'TR payment picked up another selected teacher');
  onRecords(records);
  await waitFor(() => doc.getElementById('salary-payment-status').textContent === '3 payments'
    && !doc.querySelector('[data-expense-id="13"]'));
  const expenseGrip = id => doc.querySelector(`.salary-expense-grip[data-expense-id="${id}"]`);
  assert(expenseGrip(11), 'payment row has no selector grip');
  assert.equal(expenseGrip(11).hasAttribute('data-id'), false, 'payment grip can trigger class actions');
  assert.equal(expenseGrip(11).getAttribute('draggable'), 'false');
  expenseGrip(11).click();
  assert.equal(expenseGrip(11).getAttribute('aria-pressed'), 'true');
  assert(expenseGrip(11).closest('tr').classList.contains('row-selected'));
  assert.equal(doc.getElementById('sel-bar').classList.contains('visible'), false);
  expenseGrip(11).click();
  assert.equal(expenseGrip(11).getAttribute('aria-pressed'), 'false', 'second click must unselect');
  expenseGrip(11).click();
  expenseGrip(12).dispatchEvent(new win.MouseEvent('click', { bubbles: true, ctrlKey: true }));
  assert.equal(expenseGrip(11).getAttribute('aria-pressed'), 'true');
  assert.equal(expenseGrip(12).getAttribute('aria-pressed'), 'true');
  expenseGrip(14).dispatchEvent(new win.MouseEvent('click', { bubbles: true, shiftKey: true }));
  assert.equal(doc.querySelectorAll('.salary-expense-grip[aria-pressed="true"]').length, 3,
    'Shift-click selects the visible payment range');
  doc.querySelector('.row-grip[data-id="1"]').click();
  assert.equal(expenseGrip(11).getAttribute('aria-pressed'), 'false', 'class selection clears payments');
  assert.equal(expenseGrip(12).getAttribute('aria-pressed'), 'false');
  expenseGrip(11).click();
  assert.equal(doc.querySelector('.row-grip[data-id="1"]').getAttribute('aria-pressed'), 'false',
    'payment selection clears class action selection');
  doc.getElementById('btn-refresh-payments').click();
  await waitFor(() => doc.getElementById('salary-payment-status').textContent === '3 payments');
  assert.equal(expenseGrip(11).getAttribute('aria-pressed'), 'true', 'selection survives refresh');
  assert.equal(doc.getElementById('stat-records').textContent, '3');
  assert(doc.getElementById('statsbar').textContent.includes('classes'));

  const groupToggle = () => doc.querySelector('#column-strip th.col-grip #btn-toggle-groups');
  assert(!doc.getElementById('btn-expand') && !doc.getElementById('btn-collapse'),
    'obsolete toolbar expand/collapse buttons remain');
  assert(groupToggle(), 'group toggle is missing from the fixed header grip cell');
  const groupCaret = cards()[0].querySelector('.group-header .chevron');
  const toggleCaret = groupToggle().querySelector('svg');
  assert.equal(toggleCaret.querySelectorAll('polyline').length, 1,
    'fixed-strip toggle should use one caret, not a double chevron');
  assert(!toggleCaret.querySelector('path'), 'fixed-strip toggle still has the old double chevron');
  assert.equal(toggleCaret.querySelector('polyline').getAttribute('points'),
    groupCaret.querySelector('polyline').getAttribute('points'), 'toggle and group caret geometry');
  assert.equal(toggleCaret.getAttribute('viewBox'), groupCaret.getAttribute('viewBox'),
    'toggle and group caret viewport');
  assert.equal(toggleCaret.getAttribute('stroke-width'), groupCaret.getAttribute('stroke-width'),
    'toggle and group caret stroke');
  assert(cards().every(card => !card.classList.contains('collapsed')),
    'salary groups should start open');
  assert(!groupToggle().classList.contains('all-collapsed'), 'initial toggle should show the collapse action');
  assert.equal(groupToggle().getAttribute('aria-label'), 'Collapse all');
  assert.equal(groupToggle().title, 'Collapse all');
  try {
    groupToggle().click();
    assert(cards().every(card => card.classList.contains('collapsed')),
      'salary toggle did not collapse every month');
    assert(cards().every(card => card.querySelector('.group-header').getAttribute('aria-expanded') === 'false'),
      'collapsed months still announce expanded bodies');
    assert(groupToggle().classList.contains('all-collapsed'), 'collapsed toggle should show the expand action');
    assert.equal(groupToggle().getAttribute('aria-label'), 'Expand all');
    assert.equal(groupToggle().title, 'Expand all');
    groupToggle().click();
    assert(cards().every(card => !card.classList.contains('collapsed')),
      'salary toggle did not expand every month');
    assert(cards().every(card => card.querySelector('.group-header').getAttribute('aria-expanded') === 'true'),
      'expanded months still announce collapsed bodies');
    assert(!groupToggle().classList.contains('all-collapsed'), 'expanded toggle should show the collapse action');
    month('August 2026').querySelector('.group-header').click();
    assert(cards().some(card => card.classList.contains('collapsed'))
      && cards().some(card => !card.classList.contains('collapsed')),
    'individual month header did not create mixed state');
    assert.equal(groupToggle().getAttribute('aria-label'), 'Collapse all',
      'mixed-state toggle should offer to collapse all');
    groupToggle().click();
    assert(cards().every(card => card.classList.contains('collapsed')),
      'mixed-state toggle did not collapse the remaining open months');
  } finally {
    cards().filter(card => card.classList.contains('collapsed'))
      .forEach(card => card.querySelector('.group-header').click());
  }
  assert(cards().every(card => !card.classList.contains('collapsed')),
    'toggle check left salary months collapsed');

  const header = month('August 2026').querySelector('.group-header');
  header.click();
  assert.equal(header.getAttribute('aria-expanded'), 'false');
  assert(month('August 2026').classList.contains('collapsed'));

  // The linked All_att summary row selects its original Attendance rows.
  summary.group[0] = ['L', 1];
  onRecords(records.slice(0, 1));
  await waitFor(() => doc.getElementById('salary-payment-status').textContent === '3 payments');
  assert.equal(cards().length, 3);
  assert.equal(month('August 2026').querySelector('.group-sum[data-column="wage"]').textContent, '-100');
  assert(month('August 2026').classList.contains('collapsed'));

  expenses = { ...expenses, amount: [125, 50, 200, 20] };
  doc.getElementById('btn-refresh-payments').click();
  await waitFor(() => month('August 2026').querySelector('.group-sum[data-column="salary_received"]').textContent === '125');
  const savedExpenses = expenses;
  expenses = new Error('Expenses table blocked');
  doc.getElementById('btn-refresh-payments').click();
  await waitFor(() => doc.getElementById('salary-payment-status').textContent.includes('Expenses table blocked'));
  assert.equal(month('August 2026').querySelector('.group-sum[data-column="salary_received"]').textContent, '—');
  expenses = savedExpenses;
  doc.getElementById('btn-refresh-payments').click();
  await waitFor(() => doc.getElementById('salary-payment-status').textContent === '3 payments');

  onRecords([{ id: 92, group: ['L', 6], performance: 'TR' }]);
  await waitFor(() => doc.getElementById('salary-payment-status').textContent === '1 payment');
  assert(month('August 2026').querySelector('[data-expense-id="13"]'));
  const teacherPayment = month('August 2026').querySelector('[data-expense-id="13"]');
  assert.deepEqual([...teacherPayment.cells[performanceIndex].querySelectorAll('.cell-ref-pill')]
    .map(pill => pill.textContent), ['TR'], 'payment pill shows a different teacher');
  const classScroll = month('August 2026').querySelector('.scroll-inner');
  classScroll.scrollLeft = 64;
  classScroll.dispatchEvent(new win.Event('scroll'));
  const bottomScroll = doc.getElementById('column-scrollbar');
  const headerScroll = doc.querySelector('#column-strip .scroll-inner');
  assert.equal(headerScroll.scrollLeft, 64,
    'salary header does not track a month table scroll');
  assert.equal(bottomScroll.scrollLeft, 64, 'bottom scrollbar does not track a month table scroll');
  bottomScroll.scrollLeft = 24;
  bottomScroll.dispatchEvent(new win.Event('scroll'));
  assert.equal(headerScroll.scrollLeft, 24, 'salary header does not track the bottom scrollbar');
  assert.equal(classScroll.scrollLeft, 24, 'salary month does not track the bottom scrollbar');
  doc.querySelector('.toolbar').dispatchEvent(new win.WheelEvent('wheel',
    { bubbles: true, cancelable: true, shiftKey: true, deltaY: 40 }));
  assert.equal(bottomScroll.scrollLeft, 64, 'Shift+wheel over the toolbar cannot reveal columns');
  assert.equal(headerScroll.scrollLeft, 64, 'salary header did not follow Shift+wheel');
  assert.equal(classScroll.scrollLeft, 64, 'salary rows did not follow Shift+wheel over the toolbar');
  assert.equal(expenseGrip(13).getAttribute('aria-pressed'), 'false', 'teacher change leaves no stale selection');
  assert.equal(doc.querySelectorAll('.salary-payment-row').length, 1);
  const fetchTable = win.grist.docApi.fetchTable;
  let releaseOldFetch;
  win.grist.docApi.fetchTable = name => {
    if (name !== 'All_att') return fetchTable(name);
    win.grist.docApi.fetchTable = fetchTable;
    return new Promise(resolve => { releaseOldFetch = resolve; });
  };
  onRecords(records.slice(0, 1));
  await waitFor(() => releaseOldFetch);
  onRecords([{ id: 92, group: ['L', 6], performance: 'TR' }]);
  releaseOldFetch({ id: [91], group: [['L', 1]] });
  await waitFor(() => doc.getElementById('salary-payment-status').textContent === '1 payment'
    && doc.querySelector('[data-cell-id="6"][data-cell-col="students"]'));
  assert(!doc.querySelector('[data-cell-id="1"]'), 'stale teacher fetch replaced the latest selection');
  onRecords([]);
  await waitFor(() => cards().length === 0);
  assert(doc.querySelector('.empty-title').textContent.includes('No classes'));

  // A typed DateTime column remains selectable when this teacher has no dates yet.
  onRecords([{ id: 93, group: ['L', 4], performance: 'VP' }]);
  await waitFor(() => cards().some(card => card.dataset.groupLabel === '(empty)'));
  assert.equal(doc.getElementById('group-select').value, 'datetime::month');
  assert(cards().some(card => card.dataset.groupLabel === '(empty)'));

  summary.group[3] = ['L'];
  onRecords([{ id: 94, group: ['L'], performance: 'VP' }]);
  await waitFor(() => doc.getElementById('salary-payment-status').textContent.includes('has no Attendance rows'));
  assert.equal(cards().length, 0);
  // A summary widget may report its source table ID while onRecords carries group links.
  selectedSourceId = 'All_att';
  onRecords([{ id: 92, group: ['L', 6], performance: 'TR' }]);
  await waitFor(() => doc.getElementById('salary-payment-status').textContent === '1 payment');
  assert(month('August 2026').querySelector('[data-expense-id="13"]'));
  console.log('PASS salaries: complete Attendance columns, editing, linked payments, VLAT months, refresh, cache keys');
  win.close();
}

main().catch(error => { console.error(error); process.exitCode = 1; win.close(); });
