#!/usr/bin/env node
'use strict';

// Attendance may rename datetime independently of the Transactions ledger.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const sec = value => Date.parse(value) / 1000;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitFor(condition, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) { await tick(); return; }
    await tick();
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function fixture(widget, { dateColumn = 'start', both = false, extraStart = false, options = {},
  recordsFirst = false, deferMetadata = false } = {}) {
  const salary = widget === 'salaries';
  const html = read(`${widget}.html`);
  const dom = new JSDOM(html, { url: `https://arkhivar.github.io/grist/${widget}.html`,
    runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  const doc = win.document;
  const attendance = {
    id: [11, 12, 13],
    [dateColumn]: ['2026-09-01T01:00:00Z', '2026-09-03T01:00:00Z', '2026-09-02T01:00:00Z'].map(sec),
    end: ['2026-09-01T02:00:00Z', '2026-09-03T02:00:00Z', '2026-09-02T02:00:00Z'].map(sec),
    per: [['L', 7], ['L', 7], ['L', 7]],
    notes: ['Oldest', 'Newest', 'Middle'], wage: [100, 200, 300],
    sprint: ['Sprint 01', 'Sprint 01', 'Sprint 01'],
  };
  if (both) attendance.datetime = [0, 1, 2].map(index => sec(`2026-09-0${index + 1}T01:00:00Z`));
  if (extraStart) attendance.Start = [0, 1, 2].map(index => sec(`2026-09-0${index + 1}T01:00:00Z`));
  const transactions = { id: [101], performance: [['L', 7]],
    datetime: [sec('2026-09-04T00:00:00Z')], amount: [50], notes: ['Salary payment'] };
  const calls = { options: [], writes: [], metadata: 0 };
  const fields = Object.keys(attendance).filter(col => col !== 'id');
  const types = fields.map(col => [dateColumn, 'datetime', 'Start', 'end'].includes(col)
    ? 'DateTime:Asia/Vladivostok' : col === 'per' ? 'RefList:PERFORMANCE'
      : col === 'wage' ? 'Numeric' : 'Text');
  let onOptions;
  let onRecords;
  let releaseMetadata;
  const metadataGate = deferMetadata ? new Promise(resolve => { releaseMetadata = resolve; }) : null;
  function records() {
    onRecords(salary ? [{ id: 7, A: 'vp' }] : attendance.id.map((id, index) =>
      Object.fromEntries(Object.entries(attendance).map(([col, values]) => [col, values[index]]))));
  }
  async function write(id, values, writeOptions) {
    assert.equal(writeOptions?.parseStrings, false, 'DateTime writes must preserve UTC epoch seconds');
    const index = attendance.id.indexOf(id);
    assert(index >= 0, 'date write used a teacher or summary ID instead of the original class ID');
    Object.entries(values).forEach(([col, value]) => {
      assert(Object.hasOwn(attendance, col), `write used a stale column ID: ${col}`);
      attendance[col][index] = value;
    });
    calls.writes.push({ table: 'ALL_ATT', id, fields: plain(values), options: plain(writeOptions) });
    records();
  }
  win.grist = {
    ready(value) { assert.equal(value.requiredAccess, 'full'); },
    onOptions(callback) { onOptions = callback; },
    onRecords(callback) { onRecords = callback; },
    setOption(key, value) { calls.options.push([key, plain(value)]); },
    selectedTable: {
      getTableId: async () => salary ? 'PERFORMANCE' : 'ALL_ATT',
      update: async (record, writeOptions) => write(record.id, record.fields, writeOptions),
    },
    docApi: {
      async fetchTable(name) {
        if (name === '_grist_Tables') return { id: [1, 2, 3],
          tableId: ['ALL_ATT', 'PERFORMANCE', 'Transactions'] };
        if (name === '_grist_Tables_column') {
          calls.metadata++;
          if (metadataGate) await metadataGate;
          return { id: [...fields.map((_, index) => 100 + index), 21],
            parentId: [...fields.map(() => 1), 2], colId: [...fields, 'A'],
            type: [...types, 'Text'], isFormula: [...fields.map(() => false), false],
            visibleCol: [...fields.map(col => col === 'per' ? 21 : 0), 0] };
        }
        if (name === 'ALL_ATT') return attendance;
        if (name === 'PERFORMANCE') return { id: [7], A: ['vp'] };
        if (name === 'Transactions') return transactions;
        throw new Error(`Unexpected table: ${name}`);
      },
      async applyUserActions(actions, writeOptions) {
        for (const [kind, table, id, values] of actions) {
          assert.equal(kind, 'UpdateRecord');
          assert.equal(table, 'ALL_ATT');
          await write(id, values, writeOptions);
        }
        return { retValues: [] };
      },
    },
  };
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
    .map(match => match[1]).filter(src => !/^https?:/.test(src)).map(src => src.split('?')[0]);
  win.eval(scripts.map(read).join('\n;\n') + `
    window.datePreferenceState = () => ({ order: [...columnOrder], widths: { ...columnWidths },
      visibility: { ...columnVisibility }, editable: [...editableColumns],
      groupBy, rowSort: { ...rowSort } });
  `);
  function applyOptions(value = options) { onOptions(value, { accessLevel: 'full' }); }
  if (recordsFirst) { records(); applyOptions(); } else { applyOptions(); records(); }
  const cell = (col = dateColumn, id = 11) => doc.querySelector(`td[data-cell-id="${id}"][data-cell-col="${col}"]`);
  return { win, doc, calls, attendance, cell, records, applyOptions,
    releaseMetadata() { releaseMetadata?.(); },
    state: () => plain(win.datePreferenceState()),
    order: () => [...doc.querySelectorAll('tr[data-record-id]')].map(row => Number(row.dataset.recordId)),
    async loaded() {
      await waitFor(() => doc.querySelectorAll('tr[data-record-id]').length === 3
        && (!salary || doc.getElementById('salary-payment-status').textContent === '1 payment'), `${widget} dates and payments`);
    },
  };
}

let passed = 0;
let failed = 0;
async function test(name, check) {
  try { await check(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack || error}`); }
}
async function withFixture(widget, config, check) {
  const h = fixture(widget, config);
  try { await check(h); } finally { h.win.close(); }
}

async function main() {
  for (const widget of ['sprints', 'salaries']) {
    await test(`${widget}: start defaults to newest first and end remains a DateTime field`, () =>
      withFixture(widget, {}, async h => {
        await h.loaded();
        assert.deepEqual(h.order(), [12, 13, 11]);
        assert.equal(h.doc.getElementById('row-sort-select').value, 'start');
        assert.equal(h.doc.getElementById('row-sort-direction').value, 'desc');
        assert.deepEqual(h.calls.options.filter(([key]) => key === 'rowSort').map(([, value]) => value),
          [{ column: 'start', direction: 'desc' }]);
        assert(h.cell('start').textContent.includes('2026-09-01 11:00 (Tue)'));
        assert(h.cell('end').textContent.includes('2026-09-01 12:00 (Tue)'));
        assert(h.cell('start').querySelector('.cell-edit-btn'));
        assert(h.cell('end').querySelector('.cell-edit-btn'), 'end must use the normal DateTime picker');
        if (widget === 'salaries') {
          assert.equal(h.doc.getElementById('group-select').value, 'start::month');
          const date = h.doc.querySelector('.salary-payment-date');
          assert(date.textContent.includes('2026-09-04 10:00 (Fri)'));
          const payment = date.parentElement;
          const headers = [...h.doc.querySelectorAll('#column-strip th[data-column]')].map(th => th.dataset.column);
          assert.equal(payment.children[headers.indexOf('start') + 1], date,
            'Transactions.datetime must appear under the renamed Attendance start header');
          assert.equal(payment.children[headers.indexOf('end') + 1].textContent, '',
            'a transaction has no class end time');
        }
        assert.equal(h.calls.writes.length, 0, 'displaying date columns must not rewrite records');
      }));

    for (const recordsFirst of [false, true]) {
      await test(`${widget}: saved datetime preferences migrate to start with ${recordsFirst ? 'records' : 'options'} first`, () => {
        const options = { groupBy: 'datetime::month', rowSort: JSON.stringify({ column: 'datetime', direction: 'asc' }),
          columnOrder: JSON.stringify(['notes', 'datetime', 'wage', 'end']),
          columnWidths: { datetime: 246, notes: 120 },
          columnVisibility: { datetime: false }, editableColumns: JSON.stringify(['notes', 'datetime']) };
        return withFixture(widget, { options, recordsFirst, deferMetadata: true }, async h => {
          await waitFor(() => h.calls.metadata > 0, 'deferred metadata read');
          h.releaseMetadata();
          await h.loaded();
          const saved = h.state();
          assert.equal(saved.groupBy, 'start::month');
          assert.deepEqual(saved.rowSort, { column: 'start', direction: 'asc' });
          assert.deepEqual(h.order(), [11, 13, 12]);
          assert.deepEqual(saved.order.filter(col => ['notes', 'start', 'wage', 'end', 'datetime'].includes(col)),
            ['notes', 'start', 'wage', 'end']);
          assert.equal(saved.widths.start, 246);
          assert.equal(saved.widths.datetime, undefined);
          assert.equal(saved.visibility.start, false);
          assert.equal(saved.visibility.datetime, undefined);
          assert(saved.editable.includes('start'));
          assert(!saved.editable.includes('datetime'));
          assert.equal(h.cell('start'), null, 'an explicitly hidden renamed date field became visible');
          assert.equal(h.calls.writes.length, 0);
          h.applyOptions({ ...options, columnVisibility: { datetime: true } });
          await waitFor(() => h.cell('start'), 'visible migrated start');
          assert.equal(h.doc.querySelector('#column-strip col[data-column="start"]').style.width, '246px');
        });
      });
    }

    await test(`${widget}: explicit start layout settings win over obsolete datetime aliases`, () =>
      withFixture(widget, { options: {
        groupBy: 'start::month', rowSort: { column: 'start', direction: 'asc' },
        columnOrder: ['datetime', 'notes', 'start', 'wage', 'end'],
        columnWidths: { datetime: 246, start: 154 },
        columnVisibility: { datetime: false, start: true }, editableColumns: ['start', 'datetime'],
      } }, async h => {
        await h.loaded();
        const saved = h.state();
        assert.deepEqual(saved.order.filter(col => ['notes', 'start', 'wage', 'end', 'datetime'].includes(col)),
          ['notes', 'start', 'wage', 'end']);
        assert.equal(saved.widths.start, 154);
        assert.equal(saved.visibility.start, true);
        assert.equal(saved.editable.filter(col => col === 'start').length, 1);
        assert(!saved.editable.includes('datetime'));
        assert.equal(h.doc.querySelector('#column-strip col[data-column="start"]').style.width, '154px');
        assert.deepEqual(h.order(), [11, 13, 12]);
      }));

    await test(`${widget}: legacy datetime remains supported and has exact priority when both fields exist`, async () => {
      for (const config of [{ dateColumn: 'datetime' }, { both: true }]) {
        await withFixture(widget, config, async h => {
          await h.loaded();
          assert.equal(h.doc.getElementById('row-sort-select').value, 'datetime');
          assert.deepEqual(h.order(), config.both ? [13, 12, 11] : [12, 13, 11]);
          assert(h.cell('datetime').textContent.includes('2026-09-01 11:00 (Tue)'));
        });
      }
    });

    await test(`${widget}: start matching is exact first, then case-insensitive`, async () => {
      for (const config of [{ extraStart: true }, { dateColumn: 'Start' }]) {
        await withFixture(widget, config, async h => {
          await h.loaded();
          assert.equal(h.doc.getElementById('row-sort-select').value, config.dateColumn || 'start');
          assert.deepEqual(h.order(), [12, 13, 11]);
        });
      }
    });

    await test(`${widget}: start and end pickers write original class IDs with UTC values`, () =>
      withFixture(widget, {}, async h => {
        await h.loaded();
        for (const [col, time, expected] of [
          ['start', '09:30', sec('2026-08-30T23:30:00Z')],
          ['end', '10:30', sec('2026-08-31T00:30:00Z')],
        ]) {
          const cell = h.cell(col);
          cell.click();
          if (h.doc.getElementById('cell-editor').hidden) cell.click();
          assert.equal(h.doc.getElementById('cell-editor').hidden, false);
          h.doc.querySelector('.date-picker-day[data-date="2026-08-31"]').click();
          h.doc.querySelector(`.date-picker-time-option[data-time="${time}"]`).click();
          const before = h.calls.writes.length;
          h.doc.getElementById('btn-editor-save').click();
          await waitFor(() => h.calls.writes.length === before + 1
            && h.doc.getElementById('cell-editor').hidden, `${col} picker save`);
          assert.deepEqual(h.calls.writes.at(-1), { table: 'ALL_ATT', id: 11,
            fields: { [col]: expected }, options: { parseStrings: false } });
          await h.loaded();
        }
        assert.equal(h.attendance.end[0] - h.attendance.start[0], 3600);
      }));
  }
  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
