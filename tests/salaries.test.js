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
const calls = { ready: [], options: [], updates: [] };
let summary = { id: [91, 92, 93, 94], group: [
  ['L', 1, 2, 3], ['L', 6], ['L', 4], ['L', 5],
] };
const attendance = {
  id: [1, 2, 3, 4, 5, 6],
  datetime: [['D', Date.parse('2026-07-31T14:30:00Z') / 1000, 'Asia/Vladivostok'],
    Date.parse('2026-08-15T03:00:00Z') / 1000, '2026-07-31T13:30:00Z',
    null, null, Date.parse('2026-08-15T03:00:00Z') / 1000],
  performance: [7, 7, 7, 7, 7, 8],
  group: [31, 31, 31, 31, 31, 31],
  students: [21, 21, 21, 21, 21, 21],
  weekday: ['Tue', 'Sat', 'Fri', '', '', 'Sat'],
  notes: [true, true, true, true, true, true],
  count: [-100, -200, -50, 75, -1425, 200],
  wage: [-100, -200, -50, 75, -1425, 200],
  rate: [10, 20, 30, 15, 15, 10],
  sprint: [41, 41, 41, 41, 41, 41],
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
    getTableId: async () => 'All_att',
  },
  viewApi: {},
  docApi: { applyUserActions: async actions => {
    actions.forEach(([kind, table, id, fields]) => {
      assert.equal(table, 'Attendance', 'class edits must target original Attendance rows');
      if (kind === 'UpdateRecord') {
        calls.updates.push({ id, fields });
        const index = attendance.id.indexOf(id);
        Object.entries(fields).forEach(([col, value]) => { attendance[col][index] = value; });
      }
    });
    return { retValues: [] };
  }, fetchTable: async name => {
    if (name === '_grist_Tables')
      return { id: [1, 2, 3, 4, 5], tableId: ['Attendance', 'Students', 'Performance', 'Groups', 'Sprints'] };
    if (name === '_grist_Tables_column')
      return { id: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
        parentId: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 4, 5],
        colId: ['group', 'performance', 'datetime', 'wage', 'rate',
          'students', 'weekday', 'notes', 'count', 'sprint', 'Name', 'Name', 'Name', 'Name'],
        type: ['Ref:Groups', 'Ref:Performance', 'DateTime:Asia/Vladivostok',
          'Numeric', 'Numeric', 'Ref:Students', 'Text', 'Bool', 'Numeric',
          'Ref:Sprints', 'Text', 'Text', 'Text', 'Text'],
        visibleCol: [22, 21, 0, 0, 0, 20, 0, 0, 0, 23, 0, 0, 0, 0],
        isFormula: [false, false, false, true, false, false, false, false, true, false, false, false, false, false] };
    if (name === 'All_att') return summary;
    if (name === 'Attendance')
      return attendance;
    if (name === 'Students')
      return { id: [21, 22], Name: ['A. Student', 'B. Student'] };
    if (name === 'Performance') return { id: [7, 8], Name: ['VP', 'TR'] };
    if (name === 'Groups') return { id: [31], Name: ['Relentless'] };
    if (name === 'Sprints') return { id: [41], Name: ['Sprint 07'] };
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

async function main() {
  // Grist delivers options, records, and metadata independently.
  onOptions({ sortMode: 'alpha-asc',
    columnOrder: ['datetime', 'wage', 'salary_received', 'performance', 'group'] },
  { accessLevel: 'full' });
  onRecords(records);
  await waitFor(() => doc.getElementById('salary-payment-status').textContent === '3 payments');
  await waitFor(() => doc.querySelector('[data-column="students"]'));
  assert.equal(calls.ready[0].requiredAccess, 'full');
  assert(calls.options.some(([key, value]) => key === 'groupBy' && value === 'datetime::month'));
  assert.equal(doc.getElementById('group-select').value, 'datetime::month');
  assert.deepEqual([...doc.querySelectorAll('#group-select option')].map(option => option.value), ['', 'datetime::month']);
  assert.equal(cards().length, 3);
  assert.equal(cards()[0].dataset.groupLabel, 'July 2026');
  assert.equal(month('August 2026').querySelector('.group-badge').textContent, '2');
  const headers = [...month('August 2026').querySelectorAll('tfoot th[data-column]')]
    .map(cell => cell.dataset.column);
  assert(headers.includes('datetime'), 'monthly date is missing from the row columns');
  assert.deepEqual(headers.slice(0, 5),
    ['datetime', 'wage', 'salary_received', 'performance', 'group'],
    'saved column order changed when new fields arrived');
  for (const column of ['students', 'weekday', 'notes', 'count', 'performance', 'group', 'sprint'])
    assert(headers.includes(column), `${column} is missing from the row columns`);
  assert(doc.querySelector('[data-cell-id="1"][data-cell-col="group"]')
    .textContent.includes('Relentless'), 'reference display text was replaced by a row ID');
  assert.equal(doc.querySelector('[data-cell-col="count"]').getAttribute('data-cell-writable'), 'false');
  assert(doc.querySelector('[data-edit-col="datetime"]'), 'class DateTime is not editable');
  assert(doc.querySelector('[data-edit-col="weekday"]'), 'class text is not editable');
  assert(doc.querySelector('[data-edit-col="students"]'), 'class reference is not editable');
  assert(doc.querySelector('[data-edit-col="rate"]'), 'writable number is not editable');
  assert(!doc.querySelector('[data-edit-col="wage"]'), 'formula wage became editable');
  const weekdayCell = doc.querySelector('[data-cell-id="1"][data-cell-col="weekday"]');
  weekdayCell.click();
  weekdayCell.click();
  assert.equal(doc.getElementById('cell-editor').hidden, false);
  doc.getElementById('cell-editor-text').value = 'Wed';
  doc.getElementById('btn-editor-save').click();
  await waitFor(() => calls.updates.some(update => update.fields?.weekday === 'Wed'));
  await waitFor(() => doc.getElementById('cell-editor').hidden);
  const notesCell = doc.querySelector('[data-cell-id="1"][data-cell-col="notes"]');
  notesCell.click();
  notesCell.click();
  await waitFor(() => calls.updates.some(update => update.fields?.notes === false));
  await waitFor(() => doc.querySelector('[data-cell-id="1"][data-cell-col="notes"]') !== notesCell);
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
  assert(doc.querySelector('[data-cell-id="1"][data-cell-col="students"]').textContent.includes('B. Student'));
  doc.getElementById('btn-undo').click();
  await waitFor(() => doc.querySelector('[data-cell-id="1"][data-cell-col="students"]')
    ?.textContent.includes('A. Student'));
  assert(calls.updates.some(update => update.fields?.students === 21));
  doc.getElementById('btn-redo').click();
  await waitFor(() => doc.querySelector('[data-cell-id="1"][data-cell-col="students"]')
    ?.textContent.includes('B. Student'));
  assert.equal(headers.indexOf('salary_received'), headers.indexOf('wage') + 1);
  assert.equal(month('August 2026').querySelector('[data-column="wage"] .column-name').textContent, 'income');
  assert.equal(month('August 2026').querySelector('[data-column="salary_received"] .column-name').textContent, 'expenses');
  assert(month('August 2026').querySelector('td[data-cell-col="datetime"]').textContent.includes('2026-08-01 00:30'));
  assert(!doc.getElementById('content').textContent.includes('D, '), 'encoded DateTime leaked into class cells');
  assert(!doc.getElementById('content').textContent.includes('L, '), 'encoded RefList leaked into class cells');
  assert.equal(month('August 2026').querySelector('.group-sum[data-column="wage"]').textContent, '-300');
  assert.equal(month('August 2026').querySelector('.group-sum[data-column="salary_received"]').textContent, '100');
  assert.equal(month('July 2026').querySelector('.group-sum[data-column="wage"]').textContent, '-50');
  assert(month('July 2026').querySelector('.salary-matched'));
  assert.equal(month('September 2026').querySelector('.group-badge').textContent, '0');
  assert.equal(month('September 2026').querySelector('.group-sum[data-column="salary_received"]').textContent, '20');
  assert.equal(doc.querySelectorAll('.salary-payment-row').length, 3);
  assert(!month('August 2026').querySelector('[data-expense-id="13"]'));
  assert(!doc.querySelector('.salary-payments-heading'));
  const payment = month('August 2026').querySelector('.salary-payment-row');
  const dateIndex = headers.indexOf('datetime') + 1;
  const receivedIndex = headers.indexOf('salary_received') + 1;
  assert(payment.cells[dateIndex].textContent.includes('2026-08-01 00:30'));
  assert.equal(payment.cells[receivedIndex].textContent, '100');
  assert.equal(payment.querySelectorAll('td.data-cell').length, 0, 'payment rows entered class edit history');
  assert.equal(payment.closest('table'), month('August 2026').querySelector('[data-record-id="1"]').closest('table'));
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
  console.log('PASS salaries: complete Attendance columns, editing, linked payments, VLAT months, refresh, cache keys');
  win.close();
}

main().catch(error => { console.error(error); process.exitCode = 1; win.close(); });
