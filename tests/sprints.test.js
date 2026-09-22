#!/usr/bin/env node
/*
 * sprints.test.js — self-contained jsdom test suite for the grist
 * grouped-view widget (sprints.html + shared/core.js + widgets/sprints/app.js
 * + widgets/sprints/actions.js).
 *
 * No test framework: plain assertions, PASS/FAIL lines, non-zero exit on
 * failure. Run with:  npm test   (or: node tests/sprints.test.js)
 *
 * Important: the widget is built as classic scripts that share the global
 * lexical scope. Top-level `const`/`let` do NOT leak between separate
 * window.eval() calls, so the three sources are concatenated into ONE
 * window.eval() — exactly like three <script> tags sharing a realm.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ── Tiny test runner ─────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEq(actual, expected, msg) {
  if (actual !== expected)
    throw new Error(`${msg || 'values differ'} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}: ${err && err.message ? err.message : err}`);
  }
}

const flush = () => new Promise(r => setTimeout(r, 0));
async function waitFor(cond, what) {
  for (let i = 0; i < 100; i++) {
    if (cond()) return;
    await flush();
  }
  throw new Error(`timed out waiting for ${what}`);
}

// Everything runs inside main(): top-level await would make Node treat this
// CommonJS file as an ES module (auto module detection in Node ≥ 20.19).
async function main() {

// ── Syntax check of the widget sources (node --check) ────────
await test('syntax: node --check shared/core.js / widgets/sprints/app.js / widgets/sprints/actions.js', async () => {
  for (const f of ['shared/core.js', 'widgets/sprints/app.js', 'widgets/sprints/actions.js'])
    execFileSync(process.execPath, ['--check', path.join(ROOT, f)]);
});

// ── Build the DOM and evaluate the widget ────────────────────
const html = read('sprints.html');
const dom = new JSDOM(html, {
  url: 'https://arkhivar.github.io/grist/sprints.html',
  runScripts: 'outside-only',     // we evaluate the widget ourselves
  pretendToBeVisual: true,        // provides requestAnimationFrame
});
const win = dom.window;
const doc = win.document;

// Grist API mock — records every mutating call.
const calls = { ready: [], setOption: [], create: [], update: [], destroy: [] };
let onRecordsCb = null;
let onOptionsCb = null;

const RECORDS = [
  { id: 1, date: '2026-07-16T00:00:00.000Z', C: true,  students: 'V..Petrichenko', weekday: 'Thu', count: -1425, performance: 'TR', sprint: 'Sprint 13', startsAt: '2026-07-16T13:45:30.000Z' },
  { id: 2, date: '2026-07-12T23:45:00.000Z', C: false, students: 'A..Sidorov',     weekday: 'Sun', count: -1425, performance: 'TR', sprint: 'Sprint 13' },
  { id: 3, date: Date.parse('2026-07-12T23:45:00Z') / 1000, C: true, students: 'I..Petrov', weekday: 'Sun', count: 5, performance: 'OK', sprint: 'Sprint 14' },
  { id: 4, date: '2026-07-16T00:00:00.000Z\u200E', C: false, students: 'M..Kuznetsov', weekday: 'Thu', count: 7, performance: 'TR', sprint: 'Sprint 14' }, // trailing LRM
  { id: 5, date: '2026-07-1\u00AD6T00:00:00.000Z', C: true, students: 'S..Orlov', weekday: 'Thu', count: 3, performance: 'TR', sprint: 'Sprint 14' },        // soft hyphen
  { id: 6, date: { toString: () => '2026-07-16T00:00:00.000Z' }, C: false, students: 'P..Volkov', weekday: 'Thu', count: null, performance: 'TR', sprint: 'Sprint 15' }, // object-wrapped ISO
];

win.grist = {
  ready(opts) { calls.ready.push(opts); },
  onRecords(cb) { onRecordsCb = cb; },
  onOptions(cb) { onOptionsCb = cb; },
  setOption(k, v) { calls.setOption.push([k, v]); },
  selectedTable: {
    getTableId: async () => 'Table1',
    create: async (...a) => { calls.create.push(a); return { id: 99 }; },
    update: async (...a) => { calls.update.push(a); },
    destroy: async (...a) => { calls.destroy.push(a); },
  },
  docApi: {
    fetchTable: async name => {
      if (name === '_grist_Tables')
        return { id: [1], tableId: ['Table1'] };
      if (name === '_grist_Tables_column')
        return {
          id: [10, 11, 12, 13, 14, 15, 16, 17],
          colId: ['date', 'C', 'students', 'weekday', 'count', 'performance', 'sprint', 'startsAt'],
          parentId: [1, 1, 1, 1, 1, 1, 1, 1],
          type: ['Date', 'Bool', 'Text', 'Text', 'Int', 'Text', 'Text', 'DateTime'],
          isFormula: [false, false, false, false, false, false, false, false],
        };
      throw new Error(`unexpected fetchTable: ${name}`);
    },
  },
  viewApi: {
    fetchSelectedRecord: async id => {
      const rec = RECORDS.find(r => r.id === id);
      return rec ? { ...rec } : null;
    },
  },
};

// ONE eval: the three classic scripts share the global lexical scope.
win.eval(
  read('shared/core.js') + '\n;\n' +
  read('widgets/sprints/app.js') + '\n;\n' +
  read('widgets/sprints/actions.js')
);

// ── Helpers against the live DOM ─────────────────────────────
function click(el, mods = {}) {
  assert(el, 'click target missing');
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true, ...mods }));
}
function clipboardEvent(type, store) {
  const event = new win.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    setData(format, value) { store[format] = String(value); },
    getData(format) { return store[format] || ''; },
  } });
  return event;
}
function pointerEvent(type, pointerId, options = {}) {
  const event = new win.MouseEvent(type, { bubbles: true, cancelable: true, ...options });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}
function grip(id) {
  const g = doc.querySelector(`.row-grip[data-id="${id}"]`);
  assert(g, `grip for record ${id} not found`);
  return g;
}
function cellEl(rowId, colName) {
  const row = doc.querySelector(`tr[data-record-id="${rowId}"]`);
  assert(row, `row for record ${rowId} not found`);
  const table = row.closest('table');
  const footers = [...table.querySelectorAll('tfoot th[data-column]')];
  const idx = footers.findIndex(th => th.dataset.column === colName);
  assert(idx >= 0, `column "${colName}" not in table footer`);
  return row.querySelectorAll('td')[idx + 1]; // +1: grip cell comes first
}
function cellText(rowId, colName) {
  return cellEl(rowId, colName).textContent;
}

// ── Drive the Grist lifecycle ────────────────────────────────
assert(typeof onRecordsCb === 'function', 'grist.onRecords callback not registered');
assert(typeof onOptionsCb === 'function', 'grist.onOptions callback not registered');
onRecordsCb(RECORDS);
onOptionsCb({}, { accessLevel: 'full' });   // settings arg: only accessLevel is read
assertEq(calls.ready.length, 1, 'grist.ready call count');
assertEq(calls.ready[0] && calls.ready[0].requiredAccess, 'full', 'grist.ready access level');
// Wait until table metadata (getWritableColumnIds) has loaded: the editable
// fields section switches from "Loading…" to real checkboxes once it arrives.
await waitFor(
  () => doc.querySelectorAll('#editable-col-list .editable-col-option').length > 0,
  'table metadata load');

// Group by `sprint` through the toolbar select's change handler.
const groupSelect = doc.getElementById('group-select');
assert([...groupSelect.options].some(o => o.value === 'sprint'),
  '"sprint" option missing from #group-select');
groupSelect.value = 'sprint';
groupSelect.dispatchEvent(new win.Event('change', { bubbles: true }));
await flush();

// ── A. Date rendering ────────────────────────────────────────
await test('A1: object-wrapped ISO value renders as a date in .cell-num', async () => {
  const cell = cellEl(6, 'date');
  const num = cell.querySelector('.cell-num');
  assert(num, 'date cell is not wrapped in .cell-num');
  assertEq(num.textContent, '2026-07-16', 'object-wrapped ISO date');
});

await test('A2: plain ISO strings — midnight stays compact, time is kept', async () => {
  assertEq(cellText(1, 'date'), '2026-07-16', 'midnight ISO');
  assertEq(cellText(2, 'date'), '2026-07-12 23:45', 'ISO with time');
});

await test('A3: ISO strings polluted with invisible chars still format', async () => {
  assertEq(cellText(4, 'date'), '2026-07-16', 'trailing U+200E LRM');
  assertEq(cellText(5, 'date'), '2026-07-16', 'embedded U+00AD soft hyphen');
});

await test('A4: epoch number at non-midnight time in a date-like column formats', async () => {
  assertEq(cellText(3, 'date'), '2026-07-12 23:45', 'epoch seconds');
});

await test('A5: ordinary text and plain numbers are untouched', async () => {
  assertEq(cellText(1, 'performance'), 'TR', 'text value');
  assertEq(cellText(1, 'students'), 'V..Petrichenko', 'name value');
  const countCell = cellEl(1, 'count');
  assert(countCell.querySelector('.cell-num'), 'count cell lacks .cell-num');
  assertEq(countCell.textContent, '-1425', 'plain number (no thousand separator)');
});

// ── B. Selection (grip model) ────────────────────────────────
await test('B6: plain grip click selects one row and clears previous selection', async () => {
  click(grip(1));
  assertEq(grip(1).getAttribute('aria-pressed'), 'true', 'grip 1 pressed');
  click(grip(2));
  assertEq(grip(1).getAttribute('aria-pressed'), 'false', 'grip 1 cleared');
  assertEq(grip(2).getAttribute('aria-pressed'), 'true', 'grip 2 pressed');
});

await test('B7: ctrl-click adds to the selection; #sel-bar shows count 2', async () => {
  click(grip(1), { ctrlKey: true });
  assertEq(grip(1).getAttribute('aria-pressed'), 'true', 'grip 1 pressed');
  assertEq(grip(2).getAttribute('aria-pressed'), 'true', 'grip 2 still pressed');
  const bar = doc.getElementById('sel-bar');
  assert(bar.classList.contains('visible'), '#sel-bar is not visible');
  assertEq(doc.getElementById('sel-count-txt').textContent, '2 selected', 'selection count');
});

await test('B8: Clear button empties the selection and hides the bar', async () => {
  click(doc.getElementById('btn-sel-clear'));
  assert(!doc.getElementById('sel-bar').classList.contains('visible'), '#sel-bar still visible');
  assertEq(grip(1).getAttribute('aria-pressed'), 'false', 'grip 1');
  assertEq(grip(2).getAttribute('aria-pressed'), 'false', 'grip 2');
});

// ── C. Row actions ───────────────────────────────────────────
await test('C9: dup click → selectedTable.create with fields minus id/manualSort', async () => {
  const before = calls.create.length;
  click(doc.querySelector('button[data-act="dup"][data-id="1"]'));
  await waitFor(() => calls.create.length === before + 1, 'selectedTable.create');
  const [arg] = calls.create[calls.create.length - 1];
  const { id, manualSort, ...expected } = RECORDS[0];
  assertEq(JSON.stringify(arg.fields), JSON.stringify(expected), 'duplicate fields');
});

await test('C10: del is a two-step arm → confirm → selectedTable.destroy([id])', async () => {
  const btn = doc.querySelector('button[data-act="del"][data-id="1"]');
  assert(btn, 'delete button missing');
  const before = calls.destroy.length;
  click(btn); // first click arms only
  assert(btn.classList.contains('armed'), 'button did not get .armed');
  assertEq(btn.textContent, '?', 'armed button label');
  assertEq(calls.destroy.length, before, 'destroy fired on first click');
  click(btn); // second click executes
  await waitFor(() => calls.destroy.length === before + 1, 'selectedTable.destroy');
  const [ids] = calls.destroy[calls.destroy.length - 1];
  assertEq(JSON.stringify(ids), JSON.stringify([1]), 'destroy ids');
});

// ── D. Aggregates ────────────────────────────────────────────
await test('D11: footer replaces the header and shows the numeric sum (-2850)', async () => {
  const card = [...doc.querySelectorAll('.group')]
    .find(c => c.dataset.groupLabel === 'Sprint 13');
  assert(card, 'group "Sprint 13" not found');
  assert(!card.querySelector('thead'), 'obsolete table header is still present');
  assert(!card.querySelector('.group-select-grip'), 'obsolete group select-all grip is still present');
  const sum = card.querySelector('tfoot .footer-aggregate[data-column="count"]');
  assert(sum, 'no .footer-aggregate for column "count" in the group footer');
  assertEq(sum.textContent, '-2850', 'sum of -1425 + -1425');
});

await test('D12: group footer plus creates a row seeded with its group value', async () => {
  const card = [...doc.querySelectorAll('.group')]
    .find(c => c.dataset.groupLabel === 'Sprint 13');
  const addButton = card && card.querySelector('tfoot .group-add-row');
  assert(addButton, 'group footer add-row button missing');
  assert(!addButton.disabled, 'group footer add-row button is disabled');
  assert(addButton.querySelector('.add-row-icon'), 'add-row plus icon missing');
  const before = calls.create.length;
  click(addButton);
  await waitFor(() => calls.create.length === before + 1, 'group footer row create');
  const [arg, options] = calls.create[calls.create.length - 1];
  assertEq(JSON.stringify(arg.fields), JSON.stringify({ sprint: 'Sprint 13' }),
    'new row grouping field');
  assertEq(options && options.parseStrings, false, 'new row parseStrings option');

  const added = {
    id: 99, date: null, C: false, students: '', weekday: '', count: null,
    performance: '', sprint: 'Sprint 13', startsAt: null,
  };
  onRecordsCb([...RECORDS, added]);
  await flush();
  const row = doc.querySelector('tr[data-record-id="99"]');
  assert(row, 'newly created row was not rendered');
  assert(row.classList.contains('row-enter'), 'newly created row lacks its entry animation');
  onRecordsCb(RECORDS);
  await flush();
});

// ── E. Diagnostics ───────────────────────────────────────────
await test('E13: diagnostics lists the date column as date-like: yes', async () => {
  click(doc.getElementById('btn-settings'));
  assert(doc.getElementById('settings-panel').classList.contains('open'),
    'settings panel did not open');
  const rows = [...doc.querySelectorAll('#diag-list .diag-row')];
  const dateRow = rows.find(r => r.textContent.startsWith('date ·'));
  assert(dateRow, 'no diagnostics row for the "date" column');
  assert(dateRow.textContent.includes('date-like: yes'),
    `date column not reported date-like — row: ${dateRow.textContent}`);
});

// ── F. Field editors ─────────────────────────────────────────
await test('F14: long-text editor is a compact, anchored, non-blocking popover', async () => {
  const studentsToggle = [...doc.querySelectorAll('#editable-col-list input[type="checkbox"]')]
    .find(input => input.value === 'students');
  assert(studentsToggle, 'students editable-field toggle missing');
  studentsToggle.checked = true;
  studentsToggle.dispatchEvent(new win.Event('change', { bubbles: true }));
  await flush();
  const editButton = cellEl(1, 'students').querySelector('.cell-edit-btn');
  assert(editButton, 'long-text edit button missing');
  assert(!editButton.querySelector('.cell-edit-pencil'),
    'redundant long-text pencil is still present');
  assertEq(editButton.getAttribute('aria-expanded'), 'false', 'initial text popover state');
  click(editButton);
  assert(doc.getElementById('cell-editor').hidden, 'first click opened the long-text editor');
  assert(cellEl(1, 'students').classList.contains('cell-selected'),
    'first click did not select the long-text cell');
  click(editButton);
  await flush();
  assert(!doc.getElementById('cell-editor').hidden, 'long-text editor did not open');
  assert(doc.getElementById('cell-editor').classList.contains('popover-mode'),
    'long-text editor did not use non-blocking popover mode');
  assert(!doc.querySelector('.cell-editor-header'), 'obsolete editor header is still present');
  assertEq(doc.getElementById('cell-editor-dialog').getAttribute('aria-modal'), null,
    'long-text popover incorrectly reports itself as modal');
  assertEq(doc.getElementById('cell-editor-dialog').getAttribute('aria-label'),
    'Edit text: students', 'long-text popover accessible label');
  const dateTimePanel = doc.getElementById('cell-editor-datetime-panel');
  assert(dateTimePanel.hidden, 'DateTime panel is not hidden in the long-text editor');
  assertEq(win.getComputedStyle(dateTimePanel).display, 'none',
    'hidden DateTime panel is forced visible by popover styles');
  assertEq(editButton.getAttribute('aria-expanded'), 'true', 'open text popover state');
  assert(doc.getElementById('cell-editor-dialog').style.left,
    'long-text popover was not horizontally positioned');
  assert(doc.getElementById('cell-editor-dialog').style.top,
    'long-text popover was not vertically positioned');
  doc.getElementById('content').dispatchEvent(new win.Event('scroll'));
  assert(!doc.getElementById('cell-editor').hidden,
    'table scrolling incorrectly dismissed the long-text popover');
  click(doc.getElementById('statsbar'));
  assert(doc.getElementById('cell-editor').hidden, 'outside click did not dismiss text popover');
  assertEq(editButton.getAttribute('aria-expanded'), 'false', 'dismissed text popover state');
});

await test('F15: DateTime cell has no pencil and opens a Monday-first calendar', async () => {
  const editButton = cellEl(1, 'startsAt').querySelector('.cell-edit-btn');
  assert(editButton, 'DateTime edit button missing');
  assertEq(editButton.dataset.editKind, 'datetime', 'DateTime edit kind');
  assert(!editButton.querySelector('.cell-edit-pencil'), 'redundant DateTime pencil is still present');
  assertEq(editButton.getAttribute('aria-expanded'), 'false', 'initial popover state');
  click(editButton);
  assert(doc.getElementById('cell-editor').hidden, 'first click opened the DateTime editor');
  assert(cellEl(1, 'startsAt').classList.contains('cell-selected'),
    'first click did not select the DateTime cell');
  click(editButton);
  await flush();
  assert(!doc.getElementById('cell-editor').hidden, 'DateTime editor did not open');
  assert(doc.getElementById('cell-editor').classList.contains('popover-mode'),
    'DateTime editor did not use non-blocking popover mode');
  assertEq(doc.getElementById('cell-editor-dialog').getAttribute('aria-modal'), null,
    'DateTime popover incorrectly reports itself as modal');
  assert(!doc.querySelector('.cell-editor-header'),
    'obsolete editor header is still present');
  assertEq(doc.getElementById('cell-editor-dialog').getAttribute('aria-label'),
    'Edit date and time: startsAt', 'DateTime popover accessible label');
  const footerActions = doc.getElementById('date-picker-footer-actions');
  assert(!footerActions.hidden, 'DateTime quick actions are hidden');
  assert(footerActions.closest('.cell-editor-footer'),
    'Today/Clear actions are not in the shared editor footer');
  assert(!doc.querySelector('.date-picker-quick-actions'),
    'obsolete dedicated quick-action row is still present');
  assertEq(editButton.getAttribute('aria-expanded'), 'true', 'open popover state');
  assert(doc.getElementById('cell-editor-dialog').style.left,
    'DateTime popover was not horizontally positioned');
  assert(doc.getElementById('cell-editor-dialog').style.top,
    'DateTime popover was not vertically positioned');
  assertEq(doc.getElementById('date-picker-month').textContent, 'July 2026', 'visible month');
  const weekdays = [...doc.querySelectorAll('.date-picker-weekdays span')]
    .map(span => span.textContent).join(',');
  assertEq(weekdays, 'Mon,Tue,Wed,Thu,Fri,Sat,Sun', 'weekday order');
  assertEq(doc.querySelectorAll('.date-picker-day').length, 42, 'calendar cell count');
  const selected = doc.querySelector('.date-picker-day.selected');
  assertEq(selected && selected.dataset.date, '2026-07-16', 'selected date');
  const timeValues = [...doc.querySelectorAll('.date-picker-time-option')]
    .map(option => option.dataset.time);
  assert(timeValues.includes('09:00') && timeValues.includes('09:30'), 'half-hour time options missing');
  assert(timeValues.every(value => /^\d{2}:\d{2}$/.test(value)), 'time option contains seconds');
  click(doc.getElementById('statsbar'));
  assert(doc.getElementById('cell-editor').hidden, 'outside click did not dismiss the popover');
  assertEq(editButton.getAttribute('aria-expanded'), 'false', 'dismissed popover state');
  click(editButton);
  await flush();
});

await test('F16: custom picker saves the selected UTC date and time', async () => {
  const before = calls.update.length;
  click(doc.querySelector('.date-picker-time-option[data-time="09:30"]'));
  click(doc.querySelector('.date-picker-day[data-date="2026-07-20"]'));
  click(doc.getElementById('btn-editor-save'));
  await waitFor(() => calls.update.length === before + 1, 'selectedTable.update');
  await flush();
  const [record, options] = calls.update[calls.update.length - 1];
  assertEq(record.id, 1, 'updated record id');
  assertEq(record.fields.startsAt,
    Date.parse('2026-07-20T09:30:00Z') / 1000, 'saved UTC epoch seconds');
  assertEq(options && options.parseStrings, false, 'DateTime parseStrings option');
  assertEq(cellText(1, 'startsAt'), '2026-07-20 09:30', 'updated DateTime rendering');
});

// ── G. Smoke ─────────────────────────────────────────────────
await test('G17: sprints.html loads all three widget scripts', async () => {
  for (const f of ['shared/core.js', 'widgets/sprints/app.js', 'widgets/sprints/actions.js'])
    assert(html.includes(`<script src="${f}?`), `sprints.html missing script tag for ${f}`);
});

await test('G18: live badge and every cache key use the same release version', async () => {
  const versions = [...html.matchAll(/(?:src|href)="(?:shared\/base\.css|shared\/core\.js|widgets\/sprints\/(?:app|actions)\.js)\?v=([^"&]+)/g)]
    .map(match => match[1]);
  assertEq(versions.length, 4, 'versioned asset count');
  assert(versions.every(version => version === versions[0]), 'asset cache keys differ');
  assertEq(doc.getElementById('version-badge').textContent, `v${versions[0]}`, 'version badge');
});

await test('H19: toolbar history buttons undo and redo a saved cell edit', async () => {
  const undo = doc.getElementById('btn-undo');
  const redo = doc.getElementById('btn-redo');
  assert(undo.querySelector('svg') && redo.querySelector('svg'), 'history arrow icons missing');
  assert(!undo.disabled, 'Undo did not enable after the DateTime edit');
  assert(undo.title.includes('Edit DateTime'), 'Undo tooltip does not name the edit');
  assert(redo.disabled, 'Redo enabled before an undo');

  let before = calls.update.length;
  click(undo);
  await waitFor(() => calls.update.length === before + 1, 'toolbar undo');
  await flush();
  assertEq(calls.update[calls.update.length - 1][0].fields.startsAt,
    Date.parse('2026-07-16T13:45:00Z') / 1000, 'undo DateTime value');
  assertEq(cellText(1, 'startsAt'), '2026-07-16 13:45', 'undo rendering');
  assert(!redo.disabled, 'Redo did not enable after undo');

  before = calls.update.length;
  click(redo);
  await waitFor(() => calls.update.length === before + 1, 'toolbar redo');
  await flush();
  assertEq(calls.update[calls.update.length - 1][0].fields.startsAt,
    Date.parse('2026-07-20T09:30:00Z') / 1000, 'redo DateTime value');
  assertEq(cellText(1, 'startsAt'), '2026-07-20 09:30', 'redo rendering');
  assert(redo.disabled, 'Redo stayed enabled after replaying the latest edit');
});

const copiedCellData = {};

await test('I20: Ctrl+C / Ctrl+V copies a typed cell value', async () => {
  const source = cellEl(1, 'students');
  click(source.querySelector('.cell-edit-btn'));
  source.dispatchEvent(clipboardEvent('copy', copiedCellData));
  assertEq(copiedCellData['text/plain'], 'V..Petrichenko', 'copied cell text');

  const destination = cellEl(2, 'students');
  click(destination.querySelector('.cell-edit-btn'));
  const before = calls.update.length;
  destination.dispatchEvent(clipboardEvent('paste', copiedCellData));
  await waitFor(() => calls.update.length === before + 1, 'cell paste update');
  const [record, options] = calls.update[calls.update.length - 1];
  assertEq(record.id, 2, 'paste destination record');
  assertEq(record.fields.students, 'V..Petrichenko', 'pasted typed value');
  assertEq(options && options.parseStrings, false, 'paste parseStrings option');
  await flush();
});

await test('I21: paste is blocked between incompatible column types', async () => {
  const destination = cellEl(1, 'C');
  click(destination);
  const before = calls.update.length;
  destination.dispatchEvent(clipboardEvent('paste', copiedCellData));
  await flush();
  assertEq(calls.update.length, before, 'incompatible paste wrote a value');
  assert(doc.getElementById('toast').textContent.includes('cannot be pasted'),
    'incompatible paste did not explain the type mismatch');
});

await test('I22: fill supports Ctrl/Cmd+Z, Ctrl/Cmd+Y, and Ctrl/Cmd+Shift+Z', async () => {
  const source = cellEl(1, 'students');
  click(source.querySelector('.cell-edit-btn'));
  const handle = source.querySelector('.cell-fill-handle');
  const target = cellEl(3, 'students');
  assert(handle, 'fill handle missing');
  const originalElementFromPoint = doc.elementFromPoint;
  doc.elementFromPoint = () => target;
  const before = calls.update.length;
  handle.dispatchEvent(pointerEvent('pointerdown', 42, { clientX: 10, clientY: 10 }));
  win.dispatchEvent(pointerEvent('pointermove', 42, { clientX: 10, clientY: 30 }));
  win.dispatchEvent(pointerEvent('pointerup', 42, { clientX: 10, clientY: 30 }));
  doc.elementFromPoint = originalElementFromPoint;
  await waitFor(() => calls.update.length === before + 1, 'fill range update');
  const [records, options] = calls.update[calls.update.length - 1];
  assert(Array.isArray(records), 'fill update was not batched');
  assertEq(JSON.stringify(records.map(record => record.id)), JSON.stringify([3, 4, 5]),
    'filled record range');
  assert(records.every(record => record.fields.students === 'V..Petrichenko'),
    'fill did not copy the source value');
  assertEq(options && options.parseStrings, false, 'fill parseStrings option');
  await flush();

  let shortcutBefore = calls.update.length;
  cellEl(1, 'students').dispatchEvent(new win.KeyboardEvent('keydown', {
    key: 'z', ctrlKey: true, bubbles: true, cancelable: true,
  }));
  await waitFor(() => calls.update.length === shortcutBefore + 1, 'Ctrl+Z fill undo');
  await flush();
  assertEq(cellText(3, 'students'), 'I..Petrov', 'Ctrl+Z restored the first filled value');
  assertEq(cellText(4, 'students'), 'M..Kuznetsov', 'Ctrl+Z restored the middle filled value');
  assertEq(cellText(5, 'students'), 'S..Orlov', 'Ctrl+Z restored the last filled value');

  shortcutBefore = calls.update.length;
  cellEl(3, 'students').dispatchEvent(new win.KeyboardEvent('keydown', {
    key: 'y', ctrlKey: true, bubbles: true, cancelable: true,
  }));
  await waitFor(() => calls.update.length === shortcutBefore + 1, 'Ctrl+Y fill redo');
  await flush();
  assertEq(cellText(3, 'students'), 'V..Petrichenko', 'Ctrl+Y did not redo the fill');

  shortcutBefore = calls.update.length;
  cellEl(3, 'students').dispatchEvent(new win.KeyboardEvent('keydown', {
    key: 'z', ctrlKey: true, bubbles: true, cancelable: true,
  }));
  await waitFor(() => calls.update.length === shortcutBefore + 1, 'second fill undo');
  await flush();
  shortcutBefore = calls.update.length;
  cellEl(3, 'students').dispatchEvent(new win.KeyboardEvent('keydown', {
    key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
  }));
  await waitFor(() => calls.update.length === shortcutBefore + 1, 'Ctrl+Shift+Z fill redo');
  await flush();
  assertEq(cellText(5, 'students'), 'V..Petrichenko', 'Ctrl+Shift+Z did not redo the fill');
});

await test('I23: arrow keys move the selected cell and Escape clears it', async () => {
  const start = cellEl(1, 'weekday');
  click(start);
  start.dispatchEvent(new win.KeyboardEvent('keydown', {
    key: 'ArrowRight', bubbles: true, cancelable: true,
  }));
  assert(cellEl(1, 'count').classList.contains('cell-selected'),
    'ArrowRight did not move to the next column');

  const current = cellEl(1, 'count');
  current.dispatchEvent(new win.KeyboardEvent('keydown', {
    key: 'ArrowDown', bubbles: true, cancelable: true,
  }));
  const next = cellEl(2, 'count');
  assert(next.classList.contains('cell-selected'),
    'ArrowDown did not move to the next visible row');
  next.dispatchEvent(new win.KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  }));
  assert(!doc.querySelector('.cell-selected'), 'Escape did not clear the cell selection');
});

await test('J24: resized column width is saved to and restored from Grist options', async () => {
  const handle = doc.querySelector('th[data-column="students"] .column-resize-handle');
  assert(handle, 'students resize handle missing');
  const before = calls.setOption.length;
  handle.dispatchEvent(new win.KeyboardEvent('keydown', {
    key: 'ArrowRight', bubbles: true, cancelable: true,
  }));
  await waitFor(
    () => calls.setOption.slice(before).some(([key]) => key === 'columnWidths'),
    'columnWidths option save');
  const widthSave = calls.setOption.slice(before).find(([key]) => key === 'columnWidths');
  assert(widthSave && widthSave[1] && typeof widthSave[1] === 'object',
    'column widths were not saved as a native options object');
  const savedWidth = widthSave[1].students;
  assert(Number.isFinite(savedWidth), 'saved students width is not numeric');

  onOptionsCb({ columnWidths: { students: savedWidth } }, { accessLevel: 'full' });
  await waitFor(
    () => doc.querySelector('col[data-column="students"]')?.style.width === `${savedWidth}px`,
    'saved column width restore');
  assertEq(doc.querySelector('col[data-column="students"]').style.width,
    `${savedWidth}px`, 'restored students width');
});

// ── Summary ──────────────────────────────────────────────────
console.log(`===== ${passed} passed, ${failed} failed =====`);
process.exitCode = failed ? 1 : 0;

}

main().catch(err => {
  console.log(`FAIL harness: ${err && err.stack ? err.stack : err}`);
  console.log(`===== ${passed} passed, ${failed + 1} failed =====`);
  process.exitCode = 1;
});
