#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const dom = new JSDOM(read('salaries.html'), {
  url: 'https://arkhivar.github.io/grist/salaries.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const win = dom.window;
const doc = win.document;
const sec = value => Date.parse(value) / 1000;
const attendance = {
  id: [1, 2, 3],
  datetime: [sec('2026-09-01T00:00:00Z'), sec('2026-09-02T00:00:00Z'), sec('2026-09-03T00:00:00Z')],
  performance: [['L', 7], ['L', 7, 8], ['L', 8]],
  wage: [100, 200, 300],
  notes: ['Only VP', 'Shared class', 'Only TR'],
};
const teachers = { id: [7, 8, 9], A: ['VP', 'TR', 'ZZ'] };
const transactions = {
  id: [101, 102, 103],
  performance: [7, 8, 9],
  datetime: [sec('2026-09-04T00:00:00Z'), sec('2026-09-05T00:00:00Z'), sec('2026-07-31T14:30:00Z')],
  amount: [300, 500, 75],
};
const calls = { fetches: [], updates: [] };
let onOptions;
let onRecords;
win.grist = {
  ready() {},
  onOptions(callback) { onOptions = callback; },
  onRecords(callback) { onRecords = callback; },
  setOption() {},
  selectedTable: { getTableId: async () => 'Performance' },
  viewApi: {},
  docApi: {
    async fetchTable(name) {
      calls.fetches.push(name);
      if (name === '_grist_Tables')
        return { id: [1, 2, 3], tableId: ['All_att', 'Performance', 'Transactions'] };
      if (name === '_grist_Tables_column')
        return {
          id: [11, 12, 13, 14, 21, 31],
          parentId: [1, 1, 1, 1, 2, 3],
          colId: ['datetime', 'performance', 'wage', 'notes', 'A', 'performance'],
          type: ['DateTime:Asia/Vladivostok', 'RefList:Performance', 'Numeric', 'Text', 'Text', 'Int'],
          visibleCol: [0, 21, 0, 0, 0, 0],
          isFormula: [false, false, false, false, false, false],
        };
      if (name === 'All_att') return attendance;
      if (name === 'Performance') return teachers;
      if (name === 'Transactions') return transactions;
      throw new Error(`Unexpected table ${name}`);
    },
    async applyUserActions(actions) {
      actions.forEach(([kind, table, id, fields]) => {
        assert.equal(kind, 'UpdateRecord');
        assert.equal(table, 'All_att', 'a teacher-linked class edit must write to Attendance');
        calls.updates.push({ table, id, fields });
        const index = attendance.id.indexOf(id);
        assert(index >= 0, 'a teacher ID was used as the Attendance row ID');
        Object.entries(fields).forEach(([col, value]) => { attendance[col][index] = value; });
      });
      return { retValues: [] };
    },
  },
};
win.eval([
  'widgets/salaries/config.js',
  'shared/core.js',
  'widgets/salaries/attendance.js',
  'shared/references.js',
  'widgets/salaries/expenses.js',
  'widgets/sprints/app.js',
  'widgets/sprints/actions.js',
].map(read).join('\n;\n'));

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitFor(condition, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await tick();
  }
  throw new Error(message || 'Timed out waiting for the teacher selection');
}
const status = () => doc.getElementById('salary-payment-status').textContent;
const classIds = () => [...doc.querySelectorAll('.group tr[data-record-id]')]
  .map(row => Number(row.dataset.recordId)).sort((a, b) => a - b);
const paymentIds = () => [...doc.querySelectorAll('.salary-payment-row')]
  .map(row => Number(row.dataset.expenseId)).sort((a, b) => a - b);
const month = label => [...doc.querySelectorAll('.group')]
  .find(card => card.dataset.groupLabel === label);
const selectTeacher = id => onRecords([{ id, A: teachers.A[teachers.id.indexOf(id)] }]);
const teacherPills = payment => {
  const cols = [...doc.querySelectorAll('#column-strip th[data-column]')].map(th => th.dataset.column);
  return [...payment.cells[cols.indexOf('performance') + 1].querySelectorAll('.cell-ref-pill')]
    .map(pill => pill.textContent);
};

async function main() {
  onOptions({}, { accessLevel: 'full' });

  // A teacher with payments but no classes must work even before any class rows load.
  selectTeacher(9);
  await waitFor(() => status() === '1 payment' && month('August 2026'),
    'the first teacher selection did not show its payment-only month');
  assert.deepEqual(classIds(), []);
  assert.deepEqual(paymentIds(), [103]);
  const paymentOnlyMonth = month('August 2026');
  assert.equal(paymentOnlyMonth.querySelector('.group-badge').textContent, '0');
  assert.equal(paymentOnlyMonth.querySelector('.group-badge').getAttribute('aria-label'), '0\u00a0classes');
  const paymentOnlyAdd = paymentOnlyMonth.querySelector('.group-add-row');
  assert(paymentOnlyAdd?.disabled,
    'a payment-only month must not create a class without a date or teacher');
  paymentOnlyAdd.click();
  assert.equal(calls.updates.length, 0);
  assert.equal(paymentOnlyMonth.querySelector('.group-sum[data-column="salary_received"]').textContent, '75');
  assert.equal(doc.getElementById('stat-records').textContent, '0');
  assert(doc.querySelector('#column-strip th[data-column="datetime"]'),
    'Attendance metadata must supply date columns before any classes have been selected');
  assert.equal(doc.getElementById('group-select').value, 'datetime::month');
  assert.deepEqual(teacherPills(paymentOnlyMonth.querySelector('.salary-payment-row')), ['ZZ']);
  assert(paymentOnlyMonth.querySelector('.salary-payment-date').textContent.includes('2026-08-01 00:30'),
    'Transactions.datetime did not use the Vladivostok month boundary');

  // A payment with no datetime remains visible in the empty month bucket.
  const paymentOnlyDateTime = transactions.datetime[2];
  transactions.datetime[2] = null;
  doc.getElementById('btn-refresh-payments').click();
  await waitFor(() => status() === '1 payment' && month('(empty)'));
  assert.equal(month('(empty)').querySelector('.salary-payment-date').textContent, '—');
  assert.equal(month('(empty)').querySelector('.group-sum[data-column="salary_received"]').textContent, '75');
  assert.deepEqual(paymentIds(), [103], 'an empty datetime discarded the teacher payment');
  transactions.datetime[2] = paymentOnlyDateTime;
  doc.getElementById('btn-refresh-payments').click();
  await waitFor(() => status() === '1 payment' && month('August 2026'));
  assert(!month('(empty)'), 'restoring payment datetime left a stale empty month');

  // Direct teacher rows select classes by raw references, including shared classes.
  selectTeacher(7);
  await waitFor(() => status() === '1 payment' && classIds().join(',') === '1,2');
  assert.deepEqual(classIds(), [1, 2], 'VP selection must include its shared class and exclude TR-only classes');
  assert.deepEqual(paymentIds(), [101], 'VP selection received another teacher\'s payment');
  assert.equal(month('September 2026').querySelector('.group-badge').textContent, '2');
  assert.equal(month('September 2026').querySelector('.group-sum[data-column="wage"]').textContent, '300');
  assert.deepEqual(teacherPills(doc.querySelector('.salary-payment-row')), ['VP']);
  assert(!month('August 2026'), 'the previous teacher\'s payment-only month survived selection change');
  const notesCell = doc.querySelector('[data-cell-id="1"][data-cell-col="notes"]');
  notesCell.click();
  notesCell.click();
  const input = doc.getElementById('cell-editor-text');
  assert.equal(input.closest('td'), notesCell, 'teacher-linked class Text editor must remain in its cell');
  input.value = 'Edited while linked to VP';
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await waitFor(() => calls.updates.some(update => update.id === 1 && update.fields.notes === input.value));
  assert.equal(attendance.notes[0], 'Edited while linked to VP');
  assert.equal(calls.updates[0].table, 'All_att');
  assert.equal(calls.updates[0].id, 1, 'editing used the selected Performance row ID');

  selectTeacher(8);
  await waitFor(() => status() === '1 payment' && classIds().join(',') === '2,3');
  assert.deepEqual(classIds(), [2, 3], 'TR selection must include the shared class and its own classes');
  assert.deepEqual(paymentIds(), [102]);
  assert.deepEqual(teacherPills(doc.querySelector('.salary-payment-row')), ['TR']);
  assert.equal(month('September 2026').querySelector('.group-sum[data-column="wage"]').textContent, '500');

  // A delayed class fetch for the previous teacher cannot replace a newer selection.
  const fetchTable = win.grist.docApi.fetchTable;
  let releaseOldFetch;
  let deferClasses = true;
  win.grist.docApi.fetchTable = name => {
    if (name !== 'All_att' || !deferClasses) return fetchTable(name);
    deferClasses = false;
    return new Promise(resolve => { releaseOldFetch = resolve; });
  };
  selectTeacher(7);
  await waitFor(() => releaseOldFetch);
  selectTeacher(8);
  await waitFor(() => status() === '1 payment' && classIds().join(',') === '2,3');
  releaseOldFetch(attendance);
  await tick();
  await tick();
  assert.deepEqual(classIds(), [2, 3], 'a stale VP class fetch replaced the latest TR selection');
  assert.deepEqual(paymentIds(), [102], 'a stale VP class fetch changed the payment selection');
  win.grist.docApi.fetchTable = fetchTable;

  onRecords([]);
  await waitFor(() => doc.querySelectorAll('.group').length === 0);
  assert.deepEqual(classIds(), []);
  assert.deepEqual(paymentIds(), [], 'empty linked selection kept the previous teacher\'s payments');
  assert.equal(status(), 'No teacher selected');
  assert.equal(calls.fetches.filter(name => name === 'Expenses').length, 0);
  console.log('PASS salaries selection: linked Performance rows, shared classes, payment-only teachers, class edits, stale loads, empty selection');
  win.close();
}

main().catch(error => { console.error(error); process.exitCode = 1; win.close(); });
