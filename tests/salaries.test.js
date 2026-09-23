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
let selectedRecordsForFetch = [];
const calls = { ready: [], options: [], updates: [] };
let expenses = {
  id: [11, 12, 13, 14],
  performance: [7, 7, 8, 7],
  date: ['2026-07-31T14:30:00Z', '2026-07-31T13:30:00Z', '2026-08-15T03:00:00Z', '2026-09-02T00:00:00Z'],
  amount: [100, 50, 200, 20],
};
win.grist = {
  ready(options) { calls.ready.push(options); },
  onOptions(callback) { onOptions = callback; },
  onRecords(callback) { onRecords = records => {
    selectedRecordsForFetch = records;
    callback(records);
  }; },
  setOption(key, value) { calls.options.push([key, value]); },
  selectedTable: {
    getTableId: async () => 'Attendance',
    update: async update => { calls.updates.push(update); },
  },
  viewApi: {
    fetchSelectedTable: async options => {
      assert.equal(options.includeColumns, 'normal');
      assert.equal(options.format, 'rows');
      return selectedRecordsForFetch.map(record => ({
        ...record,
        students: 'A. Student', weekday: 'Tue', notes: true,
        count: -100, sprint: 'Sprint 07', group: 'Relentless',
      }));
    },
    fetchSelectedRecord: async id => ({
      id, students: ['R', 'A. Student', 21], performance: ['R', 'VP', 7],
    }),
  },
  docApi: { fetchTable: async name => {
    if (name === '_grist_Tables')
      return { id: [1, 2], tableId: ['Attendance', 'Students'] };
    if (name === '_grist_Tables_column')
      return { id: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
        parentId: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
        colId: ['group', 'performance', 'datetime', 'wage', 'rate',
          'students', 'weekday', 'notes', 'count', 'sprint', 'Name'],
        type: ['Ref:Attendance', 'Ref:Teachers', 'DateTime:Asia/Vladivostok',
          'Numeric', 'Numeric', 'Ref:Students', 'Text', 'Bool', 'Numeric',
          'Ref:Sprints', 'Text'],
        visibleCol: [0, 0, 0, 0, 0, 20, 0, 0, 0, 0, 0],
        isFormula: [false, false, false, true, false, false, false, false, true, false, false] };
    if (name === 'Attendance')
      return { id: [1, 2, 3, 4, 5, 6], performance: [7, 7, 7, 7, 7, 8] };
    if (name === 'Students')
      return { id: [21, 22], Name: ['A. Student', 'B. Student'] };
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

const records = [
  { id: 1, group: 3456, performance: 'VP', datetime: '2026-07-31T14:30:00Z', wage: -100, rate: 10 },
  { id: 2, group: 3457, performance: 'VP', datetime: Date.parse('2026-08-15T03:00:00Z') / 1000, wage: -200, rate: 20 },
  { id: 3, group: 3564, performance: 'VP', datetime: { toString: () => '2026-07-31T13:30:00Z' }, wage: -50, rate: 30 },
];
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

  // onRecords is already scoped by Grist's linked teacher selection.
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

  onRecords([{ id: 6, group: 4000, performance: 'TR', datetime: '2026-08-15T03:00:00Z', wage: 200, rate: 10 }]);
  await waitFor(() => doc.getElementById('salary-payment-status').textContent === '1 payment');
  assert(month('August 2026').querySelector('[data-expense-id="13"]'));
  assert.equal(expenseGrip(13).getAttribute('aria-pressed'), 'false', 'teacher change leaves no stale selection');
  assert.equal(doc.querySelectorAll('.salary-payment-row').length, 1);
  const fetchSelectedTable = win.grist.viewApi.fetchSelectedTable;
  let releaseOldFetch;
  win.grist.viewApi.fetchSelectedTable = options => {
    win.grist.viewApi.fetchSelectedTable = fetchSelectedTable;
    return new Promise(resolve => { releaseOldFetch = resolve; });
  };
  onRecords(records.slice(0, 1));
  onRecords([{ id: 6, group: 4000, performance: 'TR', datetime: '2026-08-15T03:00:00Z', wage: 200, rate: 10 }]);
  releaseOldFetch([{ ...records[0], students: 'Wrong teacher' }]);
  await waitFor(() => doc.getElementById('salary-payment-status').textContent === '1 payment'
    && doc.querySelector('[data-cell-id="6"][data-cell-col="students"]'));
  assert(!doc.querySelector('[data-cell-id="1"]'), 'stale teacher fetch replaced the latest selection');
  onRecords([]);
  assert.equal(cards().length, 0);
  assert(doc.querySelector('.empty-title').textContent.includes('No classes'));

  // A typed DateTime column remains selectable when this teacher has no dates yet.
  onRecords([{ id: 4, group: 3565, performance: 'VP', datetime: null, wage: 75, rate: 15 }]);
  assert.equal(doc.getElementById('group-select').value, 'datetime::month');
  assert(cards().some(card => card.dataset.groupLabel === '(empty)'));

  // A source with no class date explains the actual table/selection problem.
  onRecords([{ id: 5, performance: 'VP', wage: -1425 }]);
  assert.equal(doc.querySelector('.empty-title').textContent, 'No Date/DateTime column available');
  assert(doc.querySelector('.empty-sub').textContent.includes('Source: Attendance'));
  onOptions({ groupBy: 'datetime::month' }, { accessLevel: 'full' });
  await tick();
  assert.equal(doc.querySelector('.empty-title').textContent, 'No Date/DateTime column available');
  console.log('PASS salaries: complete Attendance columns, editing, linked payments, VLAT months, refresh, cache keys');
  win.close();
}

main().catch(error => { console.error(error); process.exitCode = 1; win.close(); });
