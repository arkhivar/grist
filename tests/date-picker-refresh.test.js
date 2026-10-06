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
  const writeControl = { pending: null, error: null, attempts: 0 };
  let onOptions;
  let onRecords;
  const options = { groupBy: salary ? 'datetime::month' : 'sprint',
    rowSort: { column: '', direction: 'asc' } };
  const directRecords = () => attendance.id.map((id, index) => Object.fromEntries(
    Object.entries(attendance).map(([col, values]) => [col, values[index]])));
  const sendRecords = () => onRecords(salary ? [{ id: 7, A: 'VP' }] : directRecords());
  async function updateRow(id, fields, writeOptions) {
    writeControl.attempts++;
    assert.equal(writeOptions?.parseStrings, false, 'date writes must preserve UTC epoch seconds');
    const index = attendance.id.indexOf(id);
    assert(index >= 0, 'date writes must use the original Attendance ID, not the teacher ID');
    if (writeControl.pending) await writeControl.pending;
    if (writeControl.error) throw writeControl.error;
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
        for (const [kind, table, id, fields] of actions) {
          assert.equal(kind, 'UpdateRecord');
          assert.equal(table, 'All_att');
          await updateRow(id, fields, writeOptions);
        }
        return { retValues: [] };
      },
    },
  };
  const scripts = salary ? [
    'widgets/salaries/config.js', 'shared/dates.js', 'shared/core.js', 'widgets/salaries/attendance.js',
    'shared/references.js', 'widgets/salaries/expenses.js',
    'widgets/sprints/app.js', 'widgets/sprints/actions.js',
  ] : [
    'shared/dates.js', 'shared/core.js', 'shared/references.js', 'shared/navigation.js', 'widgets/sprints/app.js', 'widgets/sprints/actions.js',
  ];
  win.eval(scripts.map(read).join('\n;\n'));
  const cell = (col = 'datetime', id = 11) =>
    doc.querySelector(`td[data-cell-id="${id}"][data-cell-col="${col}"]`);
  const loaded = () => !salary || doc.getElementById('salary-payment-status').textContent === '1 payment';
  onOptions(options, { accessLevel: 'full' });
  sendRecords();
  await waitFor(() => cell()?.querySelector('.cell-edit-btn') && loaded(), 'date cell did not load');
  // Let the options metadata callback finish its independent render as well.
  await tick();
  return { dom, win, doc, salary, cell, attendance, updates, writeControl,
    options, onOptions, sendRecords, loaded };
}

function openPicker(h) {
  h.cell().click();
  if (h.doc.getElementById('cell-editor').hidden) h.cell().click();
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

    await test(`${widget}: picker uses an OK label and saves when clicking empty table space`,
      () => withFixture(widget, async h => {
        openPicker(h);
        assert.equal(h.doc.getElementById('btn-editor-save').textContent.trim(), 'OK',
          'date picker confirmation should use the neutral OK label');
        assert.equal(h.doc.getElementById('btn-editor-save').className,
          h.doc.getElementById('btn-editor-cancel').className,
          'OK must use the same neutral button style as Cancel');
        h.doc.getElementById('content').click();
        await waitFor(() => h.doc.getElementById('cell-editor').hidden
          && h.updates.length === 1 && h.loaded(), 'clicking empty table space did not save the date');
        assert.equal(h.updates[0].id, 11);
        assert.equal(h.updates[0].fields.datetime, sec('2026-08-30T23:30:00Z'));
        assert(h.cell().textContent.includes('2026-08-31 09:30'));
        if (h.salary) assert.equal(h.cell().closest('.group').dataset.groupLabel, 'August 2026');
      }));

    await test(`${widget}: clicking another cell saves the date and preserves that cell selection`,
      () => withFixture(widget, async h => {
        openPicker(h);
        h.cell('notes', 12).click();
        await waitFor(() => h.doc.getElementById('cell-editor').hidden
          && h.updates.length === 1 && h.loaded(), 'clicking another cell did not save the date');
        assert.equal(h.updates[0].id, 11);
        assert.equal(h.updates[0].fields.datetime, sec('2026-08-30T23:30:00Z'));
        assert(h.cell('notes', 12).classList.contains('cell-selected'),
          'the synchronous record refresh lost the clicked cell selection');
        assert.equal(h.doc.querySelector('td.cell-inline-editing'), null,
          'click-away accidentally opened the next cell editor');
      }));

    await test(`${widget}: duplicate click-away gestures produce one pending date write`,
      () => withFixture(widget, async h => {
        let completeWrite;
        h.writeControl.pending = new Promise(resolve => { completeWrite = resolve; });
        openPicker(h);
        h.doc.getElementById('content').click();
        assert.equal(h.writeControl.attempts, 1, 'first click-away did not start the date write');
        assert(h.doc.getElementById('btn-editor-save').disabled, 'pending date write did not disable OK');
        h.doc.getElementById('content').click();
        h.doc.getElementById('statsbar').click();
        h.cell('notes', 12).click();
        assert.equal(h.writeControl.attempts, 1, 'repeated click-away started duplicate date writes');
        completeWrite();
        await waitFor(() => h.doc.getElementById('cell-editor').hidden
          && h.updates.length === 1 && h.loaded(), 'pending click-away write did not complete');
        assert.equal(h.updates.length, 1);
      }));

    await test(`${widget}: failed click-away write preserves the date draft and reports the Grist error`,
      () => withFixture(widget, async h => {
        const originalValue = h.attendance.datetime[0];
        h.writeControl.error = new Error('Date update rejected by document rule');
        openPicker(h);
        h.doc.getElementById('content').click();
        await waitFor(() => h.writeControl.attempts === 1
          && !h.doc.getElementById('btn-editor-save').disabled
          && !h.doc.getElementById('cell-editor-error').hidden, 'failed date write was not reported');
        assert.equal(h.doc.getElementById('cell-editor').hidden, false, 'failure closed the date draft');
        assert.equal(h.doc.getElementById('cell-editor-datetime').value, '2026-08-31T09:30');
        assert(h.doc.getElementById('cell-editor-error').textContent.includes(
          'Date update rejected by document rule'), 'failure hid the real Grist error');
        assert.equal(h.attendance.datetime[0], originalValue, 'failed write changed the class date');
        assert.equal(h.updates.length, 0);
        h.writeControl.error = null;
        h.doc.getElementById('btn-editor-save').click();
        await waitFor(() => h.doc.getElementById('cell-editor').hidden
          && h.updates.length === 1 && h.loaded(), 'date draft could not be retried after failure');
        assert.equal(h.updates[0].fields.datetime, sec('2026-08-30T23:30:00Z'));
      }));

    await test(`${widget}: a failed pending write closes a hidden target and keeps the real error visible`,
      () => withFixture(widget, async h => {
        let completeWrite;
        h.writeControl.pending = new Promise(resolve => { completeWrite = resolve; });
        h.writeControl.error = new Error('Date update failed while its column was hidden');
        const originalValue = h.attendance.datetime[0];
        openPicker(h);
        h.doc.getElementById('content').click();
        assert.equal(h.writeControl.attempts, 1);
        // Independently delivered view settings can hide a target during a write.
        h.onOptions({ ...h.options, columnVisibility: { datetime: false } }, { accessLevel: 'full' });
        await waitFor(() => !h.cell(), 'the pending write fixture did not hide its target');
        completeWrite();
        await waitFor(() => h.doc.getElementById('cell-editor').hidden
          && h.doc.getElementById('toast').classList.contains('visible'),
        'failed save left a picker on a hidden target or lost its error');
        assert(h.doc.getElementById('toast').textContent.includes(
          'Date update failed while its column was hidden'), 'closed picker lost the real Grist error');
        assert.equal(h.attendance.datetime[0], originalValue);
        assert.equal(h.updates.length, 0);
      }));

    await test(`${widget}: a changed date consumes the group-header click until the write finishes`,
      () => withFixture(widget, async h => {
        openPicker(h);
        h.cell().closest('.group').querySelector('.group-header').click();
        await waitFor(() => h.doc.getElementById('cell-editor').hidden
          && h.updates.length === 1 && h.loaded(), 'group-header click did not save the chosen date');
        assert.equal(h.updates[0].fields.datetime, sec('2026-08-30T23:30:00Z'));
        const currentGroup = h.cell().closest('.group');
        assert(!currentGroup.classList.contains('collapsed'),
          'click-away also acted on the group during a pending date write');
        currentGroup.querySelector('.group-header').click();
        assert(currentGroup.classList.contains('collapsed'),
          'group-header action could not be retried after saving the date');
        assert.equal(h.updates.length, 1, 'retrying the group action wrote the date twice');
      }));

    await test(`${widget}: an unchanged date leaves the clicked group action usable`,
      () => withFixture(widget, async h => {
        h.cell().click();
        h.cell().click();
        const group = h.cell().closest('.group');
        group.querySelector('.group-header').click();
        assert.equal(h.doc.getElementById('cell-editor').hidden, true);
        assert(group.classList.contains('collapsed'), 'unchanged date consumed the group action');
        assert.equal(h.writeControl.attempts, 0);
        assert.equal(h.updates.length, 0);
      }));

    await test(`${widget}: Cancel and Escape discard chosen dates without writes`,
      () => withFixture(widget, async h => {
        const originalValue = h.attendance.datetime[0];
        openPicker(h);
        h.doc.getElementById('btn-editor-cancel').click();
        assert.equal(h.doc.getElementById('cell-editor').hidden, true, 'Cancel did not dismiss the picker');
        openPicker(h);
        h.doc.querySelector('.date-picker-day.selected').dispatchEvent(new h.win.KeyboardEvent('keydown', {
          key: 'Escape', bubbles: true, cancelable: true,
        }));
        assert.equal(h.doc.getElementById('cell-editor').hidden, true, 'Escape did not dismiss the picker');
        await tick();
        assert.equal(h.attendance.datetime[0], originalValue);
        assert.equal(h.writeControl.attempts, 0, 'cancelling attempted a date write');
        assert.equal(h.updates.length, 0);
      }));

    await test(`${widget}: clicking away from an unchanged date closes without a write`,
      () => withFixture(widget, async h => {
        h.cell().click();
        h.cell().click();
        assert.equal(h.doc.getElementById('cell-editor').hidden, false);
        h.doc.getElementById('content').click();
        await waitFor(() => h.doc.getElementById('cell-editor').hidden,
          'unchanged picker did not close on click-away');
        assert.equal(h.writeControl.attempts, 0, 'unchanged date attempted a write');
        assert.equal(h.updates.length, 0);
      }));
  }
  console.log(`===== ${passed} passed, ${failed} failed =====`);
  process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
