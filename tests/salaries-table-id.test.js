#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitFor(condition) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await tick();
  }
  throw new Error('Timed out loading renamed Attendance table');
}

async function fixture(mode, tableId = 'ALL_ATT', tableIds = [tableId, 'Performance', 'Transactions', 'Salary_summary']) {
  const dom = new JSDOM(read('salaries.html'), {
    url: 'https://arkhivar.github.io/grist/salaries.html',
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const win = dom.window;
  const doc = win.document;
  const attendance = {
    id: [11, 12, 13], datetime: [1790812800, 1790899200, 1790985600],
    performance: [['L', 7], ['L', 7, 8], ['L', 8]],
    wage: [100, 200, 300], notes: ['First class', 'Shared class', 'Other teacher'],
  };
  const summary = { id: [91], group: [['L', 11, 12]], performance: [['L', 7]] };
  const sourceId = mode === 'teacher' ? 'Performance'
    : mode === 'named-summary' ? 'Salary_summary' : tableId;
  const selected = mode === 'teacher' ? [{ id: 7, A: 'vp' }]
    : mode === 'direct' ? [Object.fromEntries(Object.entries(attendance).map(([col, values]) => [col, values[0]]))]
    : [{ id: 91, group: summary.group[0], performance: summary.performance[0] }];
  const calls = { fetches: [], actions: [] };
  let onOptions;
  let onRecords;
  win.grist = {
    ready(value) { assert.equal(value.requiredAccess, 'full'); },
    onOptions(callback) { onOptions = callback; },
    onRecords(callback) { onRecords = callback; },
    setOption() {},
    selectedTable: { getTableId: async () => sourceId },
    docApi: {
      async fetchTable(name) {
        calls.fetches.push(name);
        if (name === '_grist_Tables')
          return { id: tableIds.map((_, index) => index + 1), tableId: tableIds };
        if (name === '_grist_Tables_column')
          return { id: [11, 12, 13, 14, 21, 41, 42], parentId: [1, 1, 1, 1, 2, 4, 4],
            colId: ['datetime', 'performance', 'wage', 'notes', 'A', 'group', 'performance'],
            type: ['DateTime:Asia/Vladivostok', 'RefList:Performance', 'Numeric', 'Text', 'Text',
              `RefList:${tableId}`, 'RefList:Performance'],
            isFormula: [false, false, false, false, false, true, true],
            visibleCol: [0, 21, 0, 0, 0, 0, 21] };
        if (name === tableId) return attendance;
        if (name === 'Performance') return { id: [7, 8], A: ['vp', 'tr'] };
        if (name === 'Transactions') return {
          id: [101, 102], performance: [7, 8], datetime: [1790812800, 1790812800], amount: [300, 400],
        };
        if (name === 'Salary_summary') return summary;
        throw new Error(`Unexpected table fetch: ${name}`);
      },
      async applyUserActions(actions, options) {
        actions.forEach(action => {
          assert.equal(action[1], tableId, 'a class write used the stale or ambiguous table ID');
          calls.actions.push({ action: JSON.parse(JSON.stringify(action)), options });
          if (action[0] === 'UpdateRecord') {
            const index = attendance.id.indexOf(action[2]);
            assert(index >= 0, 'a summary or teacher ID was written as a class ID');
            Object.entries(action[3]).forEach(([col, value]) => { attendance[col][index] = value; });
          }
        });
        return { retValues: [99] };
      },
    },
  };
  win.eval([
    'widgets/salaries/config.js', 'shared/dates.js', 'shared/core.js',
    'widgets/salaries/attendance.js', 'shared/references.js', 'widgets/salaries/expenses.js',
    'widgets/sprints/app.js', 'widgets/sprints/actions.js',
  ].map(read).join('\n;\n'));
  onOptions({}, { accessLevel: 'full' });
  onRecords(selected);
  return { win, doc, calls, attendance, onRecords, selected,
    status: () => doc.getElementById('salary-payment-status').textContent };
}

async function checkLoading(mode, tableId = 'ALL_ATT', tableIds) {
  const h = await fixture(mode, tableId, tableIds);
  try {
    await waitFor(() => h.status() === '1 payment');
    const ids = [...h.doc.querySelectorAll('tr[data-record-id]')]
      .map(row => Number(row.dataset.recordId)).sort((a, b) => a - b);
    assert.deepEqual(ids, mode === 'direct' ? [11] : [11, 12]);
    assert.deepEqual([...h.doc.querySelectorAll('.salary-payment-row')].map(row => Number(row.dataset.expenseId)), [101]);
    assert.deepEqual([...h.doc.querySelector('[data-cell-id="11"][data-cell-col="performance"]')
      .querySelectorAll('.cell-ref-pill')].map(pill => pill.textContent), ['vp']);
    const notes = h.doc.querySelector('[data-cell-id="11"][data-cell-col="notes"]');
    notes.click();
    notes.click();
    const input = h.doc.getElementById('cell-editor-text');
    assert.equal(input.closest('td'), notes);
    input.value = 'Edited after table rename';
    input.dispatchEvent(new h.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => h.calls.actions.length === 1 && input.hidden);
    assert.deepEqual(h.calls.actions[0].action, ['UpdateRecord', tableId, 11, { notes: 'Edited after table rename' }]);
    assert.equal(h.calls.actions[0].options.parseStrings, false);
    assert.equal(h.attendance.notes[0], 'Edited after table rename');
    const raw = await h.win.eval('salaryFetchClassRecord(11)');
    assert.equal(raw.id, 11);
    assert.deepEqual(Array.from(raw.performance), ['L', 7]);
    const ops = h.win.eval('salaryTableOperations()');
    assert.equal(await ops.getTableId(), tableId);
    assert.equal((await ops.create({ fields: { notes: 'New class' } }, { parseStrings: false })).id, 99);
    await ops.destroy([99]);
    assert.deepEqual(h.calls.actions.slice(1).map(call => call.action), [
      ['AddRecord', tableId, null, { notes: 'New class' }], ['RemoveRecord', tableId, 99],
    ]);
    assert(!h.calls.fetches.includes('All_att') || tableId === 'All_att', 'old table ID was fetched');
    console.log(`PASS salaries table ID: ${mode}, ${tableId}`);
  } finally { h.win.close(); }
}

async function main() {
  for (const mode of ['summary', 'named-summary', 'teacher', 'direct']) await checkLoading(mode);
  await checkLoading('teacher', 'All_att', ['All_att', 'Performance', 'Transactions', 'Salary_summary', 'ALL_ATT']);
  const h = await fixture('summary', 'ALL_ATT', ['ALL_ATT', 'Performance', 'Transactions', 'Salary_summary', 'all_att']);
  try {
    await waitFor(() => h.status().includes('Attendance table ID is ambiguous'));
    assert.equal(h.doc.querySelectorAll('tr[data-record-id]').length, 0);
    assert(h.doc.getElementById('toast').textContent.includes('ALL_ATT, all_att'));
    await assert.rejects(h.win.eval('salaryTableOperations().update({id: 11, fields: {notes: "Unsafe"}})'),
      /Attendance table ID is ambiguous/);
    assert.equal(h.calls.actions.length, 0, 'ambiguous table metadata allowed a write');
    console.log('PASS salaries table ID: ambiguous capitalization reports an error and blocks writes');
  } finally { h.win.close(); }
  console.log('6 Salaries table ID checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
