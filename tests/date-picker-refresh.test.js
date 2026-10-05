#!/usr/bin/env node
'use strict';

// DateTime popovers must survive the same refreshes as the shared cell editors.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const sec = value => Date.parse(value) / 1000;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function waitFor(condition, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await tick();
  }
  throw new Error(message || 'Timed out waiting for the date picker');
}

async function fixture(widget) {
  const salary = widget === 'salaries';
  const dom = new JSDOM(read(`${widget}.html`), {
    url: `https://arkhivar.github.io/grist/${widget}.html`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  const doc = win.document;
  const attendance = {
    id: [11, 12],
    datetime: [sec('2026-09-01T00:00:00Z'), sec('2026-09-02T00:00:00Z')],
    performance: [['L', 7], ['L', 7]],
    wage: [100, 200],
    notes: ['First class', 'Second class'],
    sprint: ['Sprint 01', 'Sprint 01'],
  };
  const teachers = { id: [7], A: ['VP'] };
  const transactions = {
    id: [101], performance: [7], datetime: [sec('2026-09-04T00:00:00Z')], amount: [50],
  };
  const updates = [];
  let onOptions;
  let onRecords;
  const options = { groupBy: salary ? 'datetime::month' : 'sprint',
    rowSort: { column: '', direction: 'asc' } };
  const directRecords = () => attendance.id.map((id, index) => Object.fromEntries(
    Object.entries(attendance).map(([col, values]) => [col, values[index]])));
  const sendRecords = () => onRecords(salary ? [{ id: 7, A: 'VP' }] : directRecords());
  function updateRow(id, fields, writeOptions) {
    assert.equal(writeOptions?.parseStrings, false, 'date writes must preserve UTC epoch seconds');
    const index = attendance.id.indexOf(id);
    assert(index >= 0, 'date writes must use the original Attendance ID, not the teacher ID');
    updates.push({ table: 'All_att', id, fields, options: writeOptions });
    Object.entries(fields).forEach(([col, value]) => { attendance[col][index] = value; });
    // Grist can deliver fresh records before the update promise resolves.
    sendRecords();
  }
  win.grist = {
    ready(value) { assert.equal(value.requiredAccess, 'full'); },
    onOptions(callback) { onOptions = callback; },
    onRecords(callback) { onRecords = callback; },
    setOption() {},
    selectedTable: {
      getTableId: async () => salary ? 'Performance' : 'All_att',
      update: async (record, writeOptions) => updateRow(record.id, record.fields, writeOptions),
    },
    viewApi: {},
    docApi: {
      async fetchTable(name) {
        if (name === '_grist_Tables')
          return { id: [1, 2, 3], tableId: ['All_att', 'Performance', 'Transactions'] };
        if (name === '_grist_Tables_column')
          return {
            id: [11, 12, 13, 14, 15, 21],
            parentId: [1, 1, 1, 1, 1, 2],
            colId: ['datetime', 'performance', 'wage', 'notes', 'sprint', 'A'],
            type: ['DateTime:Asia/Vladivostok', 'RefList:Performance', 'Numeric', 'Text', 'Text', 'Text'],
            visibleCol: [0, 21, 0, 0, 0, 0],
            isFormula: [false, false, false, false, false, false],
          };
        if (name === 'All_att') return attendance;
        if (name === 'Performance') return teachers;
        if (name === 'Transactions') return transactions;
        throw new Error(`Unexpected table ${name}`);
      },
      async applyUserActions(actions, writeOptions) {
        actions.forEach(([kind, table, id, fields]) => {
          assert.equal(kind, 'UpdateRecord');
          assert.equal(table, 'All_att');
          updateRow(id, fields, writeOptions);
        });
        return { retValues: [] };
      },
    },
  };
  const scripts = salary ? [
    'widgets/salaries/config.js', 'shared/core.js', 'widgets/salaries/attendance.js',
    'shared/references.js', 'widgets/salaries/expenses.js',
    'widgets/sprints/app.js', 'widgets/sprints/actions.js',
  ] : [
    'shared/core.js', 'shared/references.js', 'widgets/sprints/app.js', 'widgets/sprints/actions.js',
  ];
  win.eval(scripts.map(read).join('\n;\n'));
  const cell = () => doc.querySelector('td[data-cell-id="11"][data-cell-col="datetime"]');
  const loaded = () => !salary || doc.getElementById('salary-payment-status').textContent === '1 payment';
  onOptions(options, { accessLevel: 'full' });
  sendRecords();
  await waitFor(() => cell()?.querySelector('.cell-edit-btn') && loaded(), 'date cell did not load');
  // Let the options metadata callback finish its independent render as well.
  await tick();
  return { dom, win, doc, salary, cell, attendance, updates, options, onOptions, sendRecords, loaded };
}

function openPicker(h) {
  h.cell().click();
  h.cell().click();
  assert.equal(h.doc.getElementById('cell-editor').hidden, false, 'the second click must open the picker');
  h.doc.querySelector('.date-picker-day[data-date="2026-08-31"]').click();
  h.doc.querySelector('.date-picker-time-option[data-time="09:30"]').click();
  assert.equal(h.doc.getElementById('cell-editor-datetime').value, '2026-08-31T09:30');
}

async function withFixture(widget, check) {
  const h = await fixture(widget);
  try { await check(h); } finally { h.dom.window.close(); }
}

let passed = 0;
let failed = 0;
async function test(name, check) {
  try {
    await check();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.stack || error}`);
  }
}

async function main() {
  for (const widget of ['sprints', 'salaries']) {
    await test(`${widget}: picker survives record and option refreshes, then saves its VLAT draft`,
      () => withFixture(widget, async h => {
        openPicker(h);
        const oldAnchor = h.cell().querySelector('.cell-edit-btn');
        h.sendRecords();
        await waitFor(() => h.loaded() && h.cell().querySelector('.cell-edit-btn') !== oldAnchor,
          'record refresh did not rebuild the date cell');
        h.onOptions(h.options, { accessLevel: 'full' });
        await tick();
        h.doc.getElementById('content').dispatchEvent(new h.win.Event('scroll'));
        h.win.dispatchEvent(new h.win.Event('resize'));
        const picker = h.doc.getElementById('cell-editor');
        assert.equal(picker.hidden, false, 'refresh and repositioning discarded the open picker');
        assert.equal(h.doc.getElementById('cell-editor-datetime').value, '2026-08-31T09:30',
          'refresh discarded the chosen date or time');
        assert.equal(h.cell().querySelector('.cell-edit-btn').getAttribute('aria-expanded'), 'true',
          'picker did not reanchor to the refreshed date cell');
        assert.equal(h.updates.length, 0, 'a refresh saved an unfinished date draft');
        h.doc.getElementById('btn-editor-save').click();
        await waitFor(() => picker.hidden && h.updates.length === 1 && h.loaded(),
          'the refreshed date picker did not save');
        assert.equal(h.updates[0].id, 11);
        assert.equal(h.updates[0].table, 'All_att');
        assert.equal(h.updates[0].fields.datetime, sec('2026-08-30T23:30:00Z'));
        assert(h.cell().textContent.includes('2026-08-31 09:30'));
        if (h.salary)
          assert.equal(h.cell().closest('.group').dataset.groupLabel, 'August 2026',
            'the edited class did not move into its VLAT month');
      }));

    await test(`${widget}: removing the picker target closes its draft without writing`,
      () => withFixture(widget, async h => {
        openPicker(h);
        Object.values(h.attendance).forEach(values => values.shift());
        h.sendRecords();
        await waitFor(() => !h.cell() && h.loaded(), 'removed class remained visible');
        assert.equal(h.doc.getElementById('cell-editor').hidden, true,
          'removed date cell left a stale picker open');
        h.doc.getElementById('btn-editor-save').click();
        assert.equal(h.updates.length, 0, 'removed date target was written');
      }));

    await test(`${widget}: hiding the picker column closes its draft without writing`,
      () => withFixture(widget, async h => {
        openPicker(h);
        h.onOptions({ ...h.options, columnVisibility: { datetime: false } }, { accessLevel: 'full' });
        await waitFor(() => !h.cell(), 'date column was not hidden');
        assert.equal(h.doc.getElementById('cell-editor').hidden, true,
          'hidden date column left a stale picker open');
        h.doc.getElementById('btn-editor-save').click();
        assert.equal(h.updates.length, 0, 'hidden date target was written');
      }));
  }
  console.log(`===== ${passed} passed, ${failed} failed =====`);
  process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
