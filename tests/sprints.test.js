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
const calls = { ready: [], setOption: [], create: [], update: [], destroy: [], actions: [] };
let createdGroupValue = null;
let createdFields = {};
let createdExists = true;
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
    applyUserActions: async (actions, options) => {
      calls.actions.push([actions, options]);
      assertEq(actions[0][1], 'Table1', 'destination table');
      if (actions[0][0] === 'AddRecord') {
        createdExists = true;
        createdGroupValue = actions[0][3].sprint;
        createdFields = actions[0][3];
      }
      if (actions[0][0] === 'RemoveRecord') createdExists = false;
      return { retValues: [99] };
    },
    fetchTable: async name => {
      if (name === 'Table1' && !createdExists) return { id: [] };
      if (name === 'Table1') return { id: [99], ...Object.fromEntries(
        Object.entries(createdFields).map(([col, value]) => [col, [value]])) };
      if (name === '_grist_Tables')
        return { id: [1], tableId: ['Table1'] };
      if (name === '_grist_Tables_column')
        return {
          id: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
          colId: ['date', 'C', 'students', 'weekday', 'count', 'performance', 'sprint', 'startsAt', 'rate', 'total'],
          parentId: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          type: ['Date', 'Bool', 'Text', 'Text', 'Int', 'Text', 'Text', 'DateTime:Asia/Vladivostok', 'Numeric', 'Numeric'],
          isFormula: [false, false, false, false, false, false, false, false, false, true],
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
  const headers = [...doc.querySelectorAll('#column-strip thead th[data-column]')];
  const idx = headers.findIndex(th => th.dataset.column === colName);
  assert(idx >= 0, `column "${colName}" not in the fixed header`);
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

await test('B8a: clicking the sole selected grip again clears selection', async () => {
  click(grip(1));
  assertEq(grip(1).getAttribute('aria-pressed'), 'true', 'grip selected');
  click(grip(1));
  assertEq(grip(1).getAttribute('aria-pressed'), 'false', 'grip deselected');
  assert(!doc.getElementById('sel-bar').classList.contains('visible'), 'selection bar still visible');
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
await test('D11: sums stay in the group header when expanded and collapsed', async () => {
  const card = [...doc.querySelectorAll('.group')]
    .find(c => c.dataset.groupLabel === 'Sprint 13');
  assert(card, 'group "Sprint 13" not found');
  assert(!card.querySelector('thead'), 'column headers are repeated inside a group');
  assert(!card.querySelector('.group-select-grip'), 'obsolete group select-all grip is still present');
  const sum = card.querySelector('.group-header .group-sum[data-column="count"]');
  assert(sum, 'numeric sum missing from group header');
  assert(!card.querySelector('tfoot .footer-aggregate'), 'sum remains in footer');
  assert(!card.querySelector('tfoot .column-name'), 'footer labels are still repeated');
  assert(doc.querySelector('#column-strip thead .column-name'), 'fixed column headers missing');
  assert(doc.querySelector('.toolbar #statsbar.visible'), 'record counts were not moved into the toolbar');
  assertEq(sum.textContent, '-2850', 'sum of -1425 + -1425');
  click(card.querySelector('.group-header'));
  assert(card.classList.contains('collapsed'), 'group did not collapse');
  assertEq(sum.textContent, '-2850', 'collapsed header sum');
  click(card.querySelector('.group-header'));
});

await test('D12: group footer plus creates a row seeded with its group value', async () => {
  const card = [...doc.querySelectorAll('.group')]
    .find(c => c.dataset.groupLabel === 'Sprint 13');
  const addButton = card && card.querySelector('tfoot .group-add-row');
  assert(addButton, 'group footer add-row button missing');
  assert(!addButton.disabled, 'group footer add-row button is disabled');
  assert(addButton.querySelector('.add-row-icon'), 'add-row plus icon missing');
  const before = calls.actions.length;
  click(addButton);
  await waitFor(() => calls.actions.length === before + 1 && !addButton.disabled, 'verified group footer row create');
  const [actions, options] = calls.actions[calls.actions.length - 1];
  assertEq(JSON.stringify(actions[0][3]), JSON.stringify({ sprint: 'Sprint 13' }),
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
await test('D: empty-group creation and failed assignment verification', async () => {
  onRecordsCb([...RECORDS, { ...RECORDS[0], id: 98, sprint: null }]);
  const emptyButton = [...doc.querySelectorAll('.group-add-row')]
    .find(button => button.getAttribute('aria-label') === 'Add row to (empty)');
  assert(emptyButton, 'empty group add button missing');
  const before = calls.actions.length;
  click(emptyButton);
  await waitFor(() => calls.actions.length === before + 1 && !emptyButton.disabled, 'empty group creation');
  assertEq(createdGroupValue, null, 'empty group value');
  onRecordsCb(RECORDS);
  const originalFetch = win.grist.docApi.fetchTable;
  win.grist.docApi.fetchTable = async name => name === 'Table1'
    ? { id: [99], sprint: [''] } : originalFetch(name);
  try {
    const button = [...doc.querySelectorAll('.group-add-row')]
      .find(item => item.getAttribute('aria-label') === 'Add row to Sprint 13');
    click(button);
    await waitFor(() => doc.getElementById('toast').textContent.includes('did not retain'), 'failed assignment warning');
    assert(!doc.getElementById('toast').classList.contains('success'), 'false success reported');
    assert(!button.disabled, 'failed create left add button disabled');
  } finally {
    win.grist.docApi.fetchTable = originalFetch;
  }
});

await test('D: linked student and sprint are both saved, using the raw reference ID', async () => {
  const originalFetch = win.grist.viewApi.fetchSelectedRecord;
  try {
    onRecordsCb(RECORDS.filter(rec => rec.id === 1));
    win.grist.viewApi.fetchSelectedRecord = async (id, options) => {
      assertEq(options.expandRefs, false, 'student reference must not be expanded');
      assertEq(options.cellFormat, 'typed', 'student fetch format');
      return { ...RECORDS[0], students: ['R', 'Students', 42] };
    };
    const button = doc.querySelector('.group-add-row');
    const before = calls.actions.length;
    click(button);
    await waitFor(() => calls.actions.length === before + 1 && !button.disabled, 'linked row creation');
    assertEq(createdFields.sprint, 'Sprint 13', 'sprint inherited');
    assertEq(createdFields.students, 42, 'raw student reference inherited');
    assert(!Object.prototype.hasOwnProperty.call(createdFields, 'count'), 'unrelated fields copied');
    assert(doc.getElementById('toast').classList.contains('success'), 'verified creation not reported');
  } finally {
    win.grist.viewApi.fetchSelectedRecord = originalFetch;
    onRecordsCb(RECORDS);
  }
});

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
    'Edit date and time: startsAt (VLAT)', 'DateTime popover accessible label');
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

await test('F16: custom picker converts selected VLAT date and time to UTC storage', async () => {
  const before = calls.update.length;
  click(doc.querySelector('.date-picker-time-option[data-time="09:30"]'));
  click(doc.querySelector('.date-picker-day[data-date="2026-07-20"]'));
  click(doc.getElementById('btn-editor-save'));
  await waitFor(() => calls.update.length === before + 1, 'selectedTable.update');
  await flush();
  const [record, options] = calls.update[calls.update.length - 1];
  assertEq(record.id, 1, 'updated record id');
  assertEq(record.fields.startsAt,
    Date.parse('2026-07-19T23:30:00Z') / 1000, 'saved UTC epoch seconds');
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
  assertEq(cellText(1, 'startsAt'), '2026-07-16 23:45', 'undo rendering');
  assert(!redo.disabled, 'Redo did not enable after undo');

  before = calls.update.length;
  click(redo);
  await waitFor(() => calls.update.length === before + 1, 'toolbar redo');
  await flush();
  assertEq(calls.update[calls.update.length - 1][0].fields.startsAt,
    Date.parse('2026-07-19T23:30:00Z') / 1000, 'redo DateTime value');
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

await test('K: Shift-click selects, copies and pastes a three-row block with one undo', async () => {
  click(cellEl(3, 'weekday'));
  click(cellEl(5, 'weekday'), { shiftKey: true });
  assertEq(doc.querySelectorAll('td.cell-selected').length, 3, 'three selected cells');
  assert(cellEl(3, 'weekday').classList.contains('range-top'), 'top border missing');
  assert(cellEl(5, 'weekday').classList.contains('range-bottom'), 'bottom border missing');
  const data = {};
  cellEl(3, 'weekday').dispatchEvent(clipboardEvent('copy', data));
  assertEq(data['text/plain'], 'Sun\nThu\nThu', 'range clipboard order');
  const original = [3, 4, 5].map(id => cellText(id, 'performance'));
  click(cellEl(3, 'performance'));
  let before = calls.actions.length;
  cellEl(3, 'performance').dispatchEvent(clipboardEvent('paste', data));
  await waitFor(() => calls.actions.length === before + 1 && !doc.getElementById('btn-undo').disabled, 'range paste');
  assertEq(calls.actions[before][0].length, 3, 'one bundle of three writes');
  assertEq([3, 4, 5].map(id => cellText(id, 'performance')).join(','), 'Sun,Thu,Thu', 'pasted block');
  before = calls.actions.length;
  click(doc.getElementById('btn-undo'));
  await waitFor(() => calls.actions.length === before + 1 && !doc.getElementById('btn-redo').disabled, 'range undo');
  assertEq(JSON.stringify([3, 4, 5].map(id => cellText(id, 'performance'))), JSON.stringify(original), 'whole block restored');
  before = calls.actions.length;
  click(doc.getElementById('btn-redo'));
  await waitFor(() => calls.actions.length === before + 1 && !doc.getElementById('btn-undo').disabled, 'range redo');
  assertEq([3, 4, 5].map(id => cellText(id, 'performance')).join(','), 'Sun,Thu,Thu', 'whole block redone');
});

await test('K: rectangular TSV paste validates all cells before any write', async () => {
  click(cellEl(3, 'weekday'));
  const before = calls.actions.length;
  cellEl(3, 'weekday').dispatchEvent(clipboardEvent('paste', { 'text/plain': 'Monday\t10\nTuesday\tnot-a-number' }));
  await flush();
  assertEq(calls.actions.length, before, 'invalid block partially saved');
  cellEl(3, 'weekday').dispatchEvent(clipboardEvent('paste', { 'text/plain': 'Monday\t10\nTuesday\t20' }));
  await waitFor(() => calls.actions.length === before + 1 && !doc.getElementById('btn-undo').disabled, 'two-column paste');
  assertEq(doc.querySelectorAll('td.cell-selected').length, 4, '2x2 selection');
  assertEq(cellText(4, 'count'), '20', 'numeric TSV value');
  const data = {};
  cellEl(3, 'weekday').dispatchEvent(clipboardEvent('copy', data));
  assertEq(data['text/plain'], 'Monday\t10\nTuesday\t20', '2x2 clipboard');
});

await test('K: Shift+arrows and right-button dragging extend selection without editing', async () => {
  click(cellEl(3, 'weekday'));
  cellEl(3, 'weekday').dispatchEvent(new win.KeyboardEvent('keydown', {
    key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true,
  }));
  assertEq(doc.querySelectorAll('td.cell-selected').length, 2, 'keyboard extension');
  const previousHit = doc.elementFromPoint;
  doc.elementFromPoint = () => cellEl(5, 'performance');
  cellEl(3, 'weekday').dispatchEvent(pointerEvent('pointerdown', 80, { button: 2 }));
  win.dispatchEvent(pointerEvent('pointermove', 80, { button: 2, buttons: 2, clientX: 50, clientY: 50 }));
  win.dispatchEvent(pointerEvent('pointerup', 80, { button: 2 }));
  doc.elementFromPoint = previousHit;
  assertEq(doc.querySelectorAll('td.cell-selected').length, 9, 'dragged 3x3 rectangle');
  assert(doc.getElementById('cell-editor').hidden, 'drag opened editor');
  const menu = new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  cellEl(5, 'performance').dispatchEvent(menu);
  assert(menu.defaultPrevented, 'drag spawned native context menu');
  assert(doc.getElementById('row-context-menu').hidden, 'drag opened row actions');
  await new Promise(resolve => setTimeout(resolve, 410));
});

await test('K: created rows can be undone and redone with the same ID and student', async () => {
  onRecordsCb(RECORDS.filter(record => record.id === 1));
  let before = calls.actions.length;
  const button = doc.querySelector('.group-add-row');
  click(button);
  await waitFor(() => calls.actions.length === before + 1 && !button.disabled, 'undoable creation');
  assert(doc.getElementById('btn-undo').title.includes('Add row'), 'creation absent from history');
  const fields = { ...createdFields };
  before = calls.actions.length;
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
  await waitFor(() => calls.actions.length === before + 1 && !doc.getElementById('btn-redo').disabled, 'creation undo');
  assertEq(JSON.stringify(calls.actions[before][0][0]), JSON.stringify(['RemoveRecord', 'Table1', 99]), 'undo removed created ID');
  before = calls.actions.length;
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }));
  await waitFor(() => calls.actions.length === before + 1 && !doc.getElementById('btn-undo').disabled, 'creation redo');
  const action = calls.actions[before][0][0];
  assertEq(action[2], 99, 'redo retained row ID');
  assertEq(action[3].students, fields.students, 'redo restored student');
  assertEq(action[3].sprint, fields.sprint, 'redo restored sprint');
  onRecordsCb(RECORDS);
});

await test('K: quoted spreadsheet cells preserve tabs and line breaks', async () => {
  click(cellEl(3, 'students'));
  const before = calls.actions.length;
  cellEl(3, 'students').dispatchEvent(clipboardEvent('paste', {
    'text/plain': '"Line one\nLine two"\t"Tab\tinside"\r\n',
  }));
  await waitFor(() => calls.actions.length === before + 1 && !doc.getElementById('btn-undo').disabled, 'quoted TSV paste');
  assertEq(cellText(3, 'students'), 'Line one\nLine two', 'multiline text');
  assertEq(cellText(3, 'weekday'), 'Tab\tinside', 'embedded tab');
});

// ── L. Selection-aware context menu ──────────────────────────
const rowMenu = doc.getElementById('row-context-menu');
const menuDuplicate = rowMenu.querySelector('[data-row-command="duplicate"]');
const menuDelete = rowMenu.querySelector('[data-row-command="delete"]');
function contextMenu(target) {
  const event = new win.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: 1000, clientY: 700,
  });
  target.dispatchEvent(event);
  assert(event.defaultPrevented, 'native menu not suppressed');
}

await test('L: rectangular selection duplicates each covered row exactly once', async () => {
  click(cellEl(3, 'weekday'));
  click(cellEl(5, 'performance'), { shiftKey: true });
  contextMenu(cellEl(4, 'count'));
  assert(!rowMenu.hidden, 'row menu hidden');
  assertEq(doc.getElementById('row-context-label').textContent, '3 whole rows', 'scope label');
  assertEq(doc.querySelectorAll('td.cell-selected').length, 9, 'menu collapsed the range');
  const before = calls.create.length;
  click(menuDuplicate);
  await waitFor(() => calls.create.length === before + 3 && !doc.getElementById('btn-sel-dup').disabled, 'range duplication');
  assertEq(calls.create.slice(before).map(([record]) => record.fields.students).join(','),
    RECORDS.slice(2, 5).map(record => record.students).join(','), 'duplicated source rows');
  assert(rowMenu.hidden, 'menu remained open after duplicate');
});

await test('L: range deletion takes one click and ignores repeat clicks', async () => {
  contextMenu(cellEl(4, 'count'));
  const before = calls.destroy.length;
  click(menuDelete);
  assertEq(calls.destroy.length, before + 1, 'first click did not delete immediately');
  assert(rowMenu.hidden, 'menu remained open after deletion');
  click(menuDelete);
  await waitFor(() => calls.destroy.length === before + 1 && !doc.getElementById('btn-sel-dup').disabled, 'range deletion');
  assertEq(JSON.stringify(calls.destroy[before][0]), '[3,4,5]', 'wrong deletion scope');
  assertEq(doc.querySelectorAll('td.cell-selected').length, 0, 'deleted range stayed selected');
});

await test('L: grip multiselection is retained; right-click outside selects only that row', async () => {
  click(grip(1));
  click(grip(2), { ctrlKey: true });
  contextMenu(grip(1));
  assertEq(doc.getElementById('row-context-label').textContent, '2 whole rows', 'grip selection scope');
  assertEq(doc.querySelectorAll('.row-grip[aria-pressed="true"]').length, 2, 'grip selection changed');
  const gripDeleteBefore = calls.destroy.length;
  click(menuDelete);
  await waitFor(() => calls.destroy.length === gripDeleteBefore + 1 && !doc.getElementById('btn-sel-dup').disabled, 'grip deletion');
  assertEq(JSON.stringify(calls.destroy[gripDeleteBefore][0]), '[1,2]', 'grip deletion scope');
  click(grip(1));
  click(grip(2), { ctrlKey: true });
  contextMenu(cellEl(6, 'weekday'));
  assertEq(doc.getElementById('row-context-label').textContent, '1 whole row', 'outside selection scope');
  assertEq(doc.querySelectorAll('.row-grip[aria-pressed="true"]').length, 0, 'unrelated grips remained selected');
  assert(cellEl(6, 'weekday').classList.contains('cell-selected'), 'right-click did not select target');
  const before = calls.destroy.length;
  click(menuDelete);
  await waitFor(() => calls.destroy.length === before + 1 && !doc.getElementById('btn-sel-dup').disabled, 'single deletion');
  assertEq(JSON.stringify(calls.destroy[before][0]), '[6]', 'outside selection deleted other rows');
});

await test('L: menu supports keyboard navigation, Escape, and passive dismissal', async () => {
  const target = cellEl(1, 'weekday');
  target.focus();
  target.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
  assert(!rowMenu.hidden, 'Shift+F10 did not open menu');
  assertEq(doc.activeElement, menuDuplicate, 'initial menu focus');
  menuDuplicate.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assertEq(doc.activeElement, menuDelete, 'ArrowDown menu focus');
  menuDelete.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert(rowMenu.hidden, 'Escape did not close menu');
  assertEq(doc.activeElement, target, 'Escape did not restore cell focus');
  contextMenu(target);
  doc.body.dispatchEvent(pointerEvent('pointerdown', 100));
  assert(rowMenu.hidden, 'outside click did not close menu');
  contextMenu(target);
  target.closest('.group-body').dispatchEvent(new win.Event('scroll'));
  assert(rowMenu.hidden, 'scroll did not close menu');
  contextMenu(target);
  onRecordsCb(RECORDS);
  assert(rowMenu.hidden, 'Grist refresh left stale row actions visible');
});

await test('L: mouse-down context menus wait for release without breaking right-drag selection', async () => {
  const target = cellEl(1, 'weekday');
  target.dispatchEvent(pointerEvent('pointerdown', 101, { button: 2 }));
  contextMenu(target);
  assert(rowMenu.hidden, 'menu opened before right-button release');
  win.dispatchEvent(pointerEvent('pointerup', 101, { button: 2 }));
  assert(!rowMenu.hidden, 'plain right-click did not open menu on release');
  target.dispatchEvent(pointerEvent('pointerdown', 102, { button: 2 }));
  contextMenu(target);
  const previousHit = doc.elementFromPoint;
  doc.elementFromPoint = () => cellEl(2, 'weekday');
  win.dispatchEvent(pointerEvent('pointermove', 102, { buttons: 2 }));
  win.dispatchEvent(pointerEvent('pointerup', 102, { button: 2 }));
  doc.elementFromPoint = previousHit;
  assert(rowMenu.hidden, 'right drag opened deferred menu');
  assertEq(doc.querySelectorAll('td.cell-selected').length, 2, 'right drag failed to extend range');
  await new Promise(resolve => setTimeout(resolve, 410));
});

await test('L: failed delete preserves selection and displays the real Grist error', async () => {
  contextMenu(cellEl(1, 'weekday'));
  const originalDestroy = win.grist.selectedTable.destroy;
  win.grist.selectedTable.destroy = async () => { throw new Error('Access denied by row rule'); };
  try {
    click(menuDelete);
    await waitFor(() => !doc.getElementById('btn-sel-dup').disabled, 'failed delete completion');
    assert(doc.getElementById('toast').textContent.includes('Access denied by row rule'), 'real error hidden');
    assertEq(doc.querySelectorAll('td.cell-selected').length, 2, 'failure cleared selection');
  } finally {
    win.grist.selectedTable.destroy = originalDestroy;
  }
});

// ── M. Numeric editing, alignment, and Vladivostok time ───────
function openEditor(rowId, col) {
  const cell = cellEl(rowId, col);
  cell.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  click(cell);
  click(cell);
}

function numberKey(key, options = {}) {
  const event = new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  doc.getElementById('cell-editor-number').dispatchEvent(event);
  return event;
}

await test('M: inline number validates Int values, saves numbers, and supports undo/redo', async () => {
  openEditor(1, 'count');
  const input = doc.getElementById('cell-editor-number');
  assert(!input.hidden, 'numeric input hidden');
  assert(doc.getElementById('cell-editor').hidden, 'number opened a popover');
  assertEq(input.closest('td'), cellEl(1, 'count'), 'number input is not inside the cell');
  const original = input.value;
  const before = calls.update.length;
  for (const invalid of ['1.5', 'NaN', 'Infinity', '0xff']) {
    input.value = invalid;
    numberKey('Enter');
    await flush();
    assertEq(calls.update.length, before, 'invalid number saved');
    assertEq(input.getAttribute('aria-invalid'), 'true', 'validation feedback missing');
  }
  input.value = '-825';
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await waitFor(() => calls.update.length === before + 1 && input.hidden, 'number save');
  assertEq(calls.update[before][0].fields.count, -825, 'number was saved as text');
  assertEq(cellText(1, 'count'), '-825', 'number rendering');
  click(doc.getElementById('btn-undo'));
  await waitFor(() => calls.update.length === before + 2 && !doc.getElementById('btn-redo').disabled, 'number undo');
  assertEq(cellText(1, 'count'), original, 'number undo value');
  click(doc.getElementById('btn-redo'));
  await waitFor(() => calls.update.length === before + 3 && !doc.getElementById('btn-undo').disabled, 'number redo');
  assertEq(cellText(1, 'count'), '-825', 'number redo value');
});

await test('M: Numeric allows decimals and empty values; formula numbers stay read-only', async () => {
  onRecordsCb(RECORDS.map(record => ({ ...record, rate: 1.25, total: 8.5 })));
  openEditor(1, 'rate');
  const input = doc.getElementById('cell-editor-number');
  let before = calls.update.length;
  input.value = '-12.75';
  numberKey('Enter');
  await waitFor(() => calls.update.length === before + 1 && input.hidden, 'decimal save');
  assertEq(calls.update[before][0].fields.rate, -12.75, 'decimal value');
  openEditor(1, 'rate');
  input.value = '';
  before = calls.update.length;
  numberKey('Enter');
  await waitFor(() => calls.update.length === before + 1 && input.hidden, 'number clear');
  assertEq(calls.update[before][0].fields.rate, null, 'empty number became zero');
  assert(!cellEl(1, 'total').querySelector('.cell-edit-btn'), 'formula cell got an editor');
  assert(cellEl(1, 'total').title.includes('Read-only'), 'read-only explanation missing');
  onRecordsCb(RECORDS);
});

await test('M: number cancel and Grist errors do not lose the entered value', async () => {
  openEditor(1, 'count');
  const input = doc.getElementById('cell-editor-number');
  const before = calls.update.length;
  input.value = '99';
  numberKey('Escape');
  assertEq(calls.update.length, before, 'Cancel saved a value');
  openEditor(1, 'count');
  const originalUpdate = win.grist.selectedTable.update;
  win.grist.selectedTable.update = async () => { throw new Error('Number edit denied by ACL'); };
  try {
    input.value = '99';
    numberKey('Enter');
    await waitFor(() => !doc.getElementById('btn-editor-save').disabled, 'failed numeric save');
    assertEq(input.value, '99', 'failed save lost draft');
    assert(doc.getElementById('cell-editor-error').textContent.includes('Number edit denied by ACL'), 'real API error hidden');
  } finally {
    win.grist.selectedTable.update = originalUpdate;
    numberKey('Escape');
  }
});

await test('M: DateTime displays VLAT for epochs, ISO strings and wrappers without shifting Date columns', async () => {
  const values = [Date.parse('2026-07-17T08:00:00Z') / 1000,
    '2026-07-17T08:00:00Z', { toString: () => '2026-07-17T08:00:00Z' }];
  onRecordsCb(RECORDS.map((record, i) => ({ ...record, startsAt: values[i % 3] })));
  for (const id of [1, 2, 3]) assertEq(cellText(id, 'startsAt'), '2026-07-17 18:00', 'VLAT transport rendering');
  assertEq(cellText(1, 'date'), '2026-07-16', 'Date-only column shifted');
  const copy = {};
  click(cellEl(1, 'startsAt'));
  cellEl(1, 'startsAt').dispatchEvent(clipboardEvent('copy', copy));
  assertEq(copy['text/plain'], '2026-07-17 18:00', 'clipboard did not use displayed time');
  for (const text of ['2026-07-18 00:30', '2026-07-17T14:30:00Z', '2026-07-18T00:30:00+10:00']) {
    cellEl(1, 'startsAt').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    cellEl(2, 'startsAt').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    onRecordsCb(RECORDS.map(record => ({ ...record, startsAt: '2026-07-17T08:00:00Z' })));
    click(cellEl(2, 'startsAt'));
    const before = calls.update.length;
    cellEl(2, 'startsAt').dispatchEvent(clipboardEvent('paste', { 'text/plain': text }));
    await waitFor(() => calls.update.length === before + 1 && !doc.getElementById('btn-undo').disabled, 'VLAT paste');
    assertEq(calls.update[before][0].fields.startsAt, Date.parse('2026-07-17T14:30:00Z') / 1000, 'paste applied wrong offset');
    assertEq(cellText(2, 'startsAt'), '2026-07-18 00:30', 'pasted wall time');
  }
  click(doc.getElementById('btn-editor-cancel'));
  onRecordsCb(RECORDS);
});

await test('M: empty picker and Today use the VLAT date across a UTC month boundary', async () => {
  const originalNow = win.Date.now;
  win.Date.now = () => Date.parse('2090-07-31T15:15:00Z');
  try {
    openEditor(2, 'startsAt');
    assertEq(doc.getElementById('date-picker-month').textContent, 'August 2090', 'empty picker month');
    assert(!doc.querySelector('.date-picker-day.selected'), 'empty date selected epoch 1970');
    click(doc.getElementById('date-picker-today'));
    assertEq(doc.querySelector('.date-picker-day.selected').dataset.date, '2090-08-01', 'VLAT Today');
    assertEq(doc.querySelector('.date-picker-time-option.selected').dataset.time, '01:00', 'VLAT current time');
  } finally {
    win.Date.now = originalNow;
    click(doc.getElementById('btn-editor-cancel'));
  }
});

await test('M: header sums align to the fixed header, including after horizontal scrolling', async () => {
  const card = cellEl(1, 'count').closest('.group');
  const header = card.querySelector('.group-header');
  const footer = doc.querySelector('#column-strip th[data-column="count"]');
  const sum = card.querySelector('.group-sum[data-column="count"]');
  const originalHeaderRect = header.getBoundingClientRect;
  const originalFooterRect = footer.getBoundingClientRect;
  header.getBoundingClientRect = () => ({ left: 10 });
  footer.style.paddingLeft = '10px';
  let left = 300;
  footer.getBoundingClientRect = () => ({ left, width: 104 });
  try {
    win.dispatchEvent(new win.Event('resize'));
    await new Promise(resolve => win.requestAnimationFrame(resolve));
    assertEq(sum.style.left, '300px', 'sum is centered instead of content-aligned');
    left = 180;
    card.querySelector('.scroll-inner').scrollLeft = 120;
    card.querySelector('.scroll-inner').dispatchEvent(new win.Event('scroll'));
    await new Promise(resolve => win.requestAnimationFrame(resolve));
    assertEq(sum.style.left, '180px', 'sum did not follow horizontal scroll');
    assertEq(doc.querySelector('#column-strip .scroll-inner').scrollLeft, 120,
      'fixed header did not follow group horizontal scroll');
  } finally {
    header.getBoundingClientRect = originalHeaderRect;
    footer.getBoundingClientRect = originalFooterRect;
    footer.style.paddingLeft = '';
  }
});

await test('M: DateTime day grouping uses local calendar boundaries', async () => {
  onRecordsCb(RECORDS.slice(0, 2).map((record, i) => ({ ...record,
    startsAt: i ? '2026-07-31T14:30:00Z' : '2026-07-31T13:30:00Z' })));
  groupSelect.value = 'startsAt::day';
  groupSelect.dispatchEvent(new win.Event('change', { bubbles: true }));
  assertEq(doc.querySelectorAll('.group').length, 2, 'two VLAT days combined into one UTC day');
  assert(doc.getElementById('content').textContent.includes('Aug'), 'next-month group label missing');
  groupSelect.value = 'sprint';
  groupSelect.dispatchEvent(new win.Event('change', { bubbles: true }));
  onRecordsCb(RECORDS);
});

// ── N. Independent row sorting ───────────────────────────────
const rowSortColumnControl = doc.getElementById('row-sort-select');
const rowSortDirectionControl = doc.getElementById('row-sort-direction');
function rowIds(groupLabel) {
  const card = [...doc.querySelectorAll('.group')].find(el => el.dataset.groupLabel === groupLabel);
  return [...card.querySelectorAll('tbody tr')].map(row => Number(row.dataset.recordId));
}
async function setRowSort(column, direction = 'asc') {
  rowSortColumnControl.value = column;
  rowSortDirectionControl.value = direction;
  rowSortColumnControl.dispatchEvent(new win.Event('change', { bubbles: true }));
  await flush();
}
const sortRecords = RECORDS.map((record, i) => ({ ...record, sprint: i < 5 ? 'Sprint 14' : 'Sprint 15',
  startsAt: [Date.parse('2026-07-21T08:00:00Z') / 1000, '2026-07-07T08:00:00Z',
    { toString: () => '2026-07-17T18:00:00+10:00' }, '2026-07-07T08:00:00Z', null, 'invalid'][i],
  count: [10, -2, 2, 10, null, 0][i], students: ['Student 10', 'Student 2', 'Student 1', 'Student 2', '', 'Other'][i] }));

await test('N: DateTime row sorting handles transport formats, ties, blanks, and independent group order', async () => {
  onRecordsCb(sortRecords);
  const mutations = calls.update.length + calls.create.length + calls.destroy.length + calls.actions.length;
  await setRowSort('startsAt');
  assertEq(JSON.stringify(rowIds('Sprint 14')), '[2,4,3,1,5]', 'ascending chronological rows');
  assertEq(rowSortDirectionControl.options[0].textContent, 'Oldest first', 'date direction label');
  await setRowSort('startsAt', 'desc');
  assertEq(JSON.stringify(rowIds('Sprint 14')), '[1,3,2,4,5]', 'descending rows with stable ties and empty last');
  doc.getElementById('sort-select').value = 'alpha-asc';
  doc.getElementById('sort-select').dispatchEvent(new win.Event('change', { bubbles: true }));
  assertEq(doc.querySelector('.group').dataset.groupLabel, 'Sprint 14', 'group sort failed');
  assertEq(JSON.stringify(rowIds('Sprint 14')), '[1,3,2,4,5]', 'group sorting changed row direction');
  assertEq(calls.update.length + calls.create.length + calls.destroy.length + calls.actions.length, mutations, 'sorting rewrote data');
  assertEq(sortRecords.map(r => r.id).join(','), '1,2,3,4,5,6', 'sorting mutated input order');
});

await test('N: numeric and natural text ordering; Grist order restores the incoming sequence', async () => {
  await setRowSort('count');
  assertEq(JSON.stringify(rowIds('Sprint 14')), '[2,3,1,4,5]', 'numeric rather than lexical order');
  await setRowSort('count', 'desc');
  assertEq(JSON.stringify(rowIds('Sprint 14')), '[1,4,3,2,5]', 'descending numeric order');
  await setRowSort('students');
  assertEq(JSON.stringify(rowIds('Sprint 14')), '[3,2,4,1,5]', 'natural text order');
  await setRowSort('');
  assert(rowSortDirectionControl.disabled, 'Grist order has an active direction');
  assertEq(JSON.stringify(rowIds('Sprint 14')), '[1,2,3,4,5]', 'original Grist order not restored');
});

await test('N: row sorting persists and survives options arriving before the chosen column', async () => {
  await setRowSort('startsAt', 'desc');
  const saved = calls.setOption.filter(([key]) => key === 'rowSort').at(-1)[1];
  assertEq(JSON.stringify(saved), '{"column":"startsAt","direction":"desc"}', 'persisted row sort');
  onRecordsCb(sortRecords.map(({ startsAt, ...record }) => record));
  onOptionsCb({ rowSort: saved }, { accessLevel: 'full' });
  await flush();
  assert(rowSortDirectionControl.disabled, 'missing sort column still enabled');
  assertEq(JSON.stringify(rowIds('Sprint 14')), '[1,2,3,4,5]', 'missing column scrambled rows');
  onRecordsCb(sortRecords);
  assertEq(rowSortColumnControl.value, 'startsAt', 'sort column was forgotten');
  assertEq(rowSortDirectionControl.value, 'desc', 'sort direction was forgotten');
  assertEq(JSON.stringify(rowIds('Sprint 14')), '[1,3,2,4,5]', 'saved sort not applied to arriving records');
  onOptionsCb({ rowSort: '{broken' }, { accessLevel: 'full' });
  await flush();
  assertEq(rowSortColumnControl.value, '', 'malformed option not safely reset');
});

await test('N: ranges copy in displayed order; changing sorting keeps only the active cell', async () => {
  await setRowSort('count');
  click(cellEl(2, 'count'));
  click(cellEl(1, 'count'), { shiftKey: true });
  assertEq(doc.querySelectorAll('td.cell-selected').length, 3, 'sorted range selection');
  const copied = {};
  cellEl(2, 'count').dispatchEvent(clipboardEvent('copy', copied));
  assertEq(copied['text/plain'], '-2\n2\n10', 'range clipboard used source order');
  await setRowSort('count', 'desc');
  assertEq(doc.querySelectorAll('td.cell-selected').length, 1, 'sort silently changed range contents');
  assert(cellEl(2, 'count').classList.contains('cell-selected'), 'sort lost active cell');
});

await test('N: editing the sorted field repositions the row and undo restores it', async () => {
  await setRowSort('count');
  openEditor(1, 'count');
  doc.getElementById('cell-editor-number').value = '-20';
  const before = calls.update.length;
  numberKey('Enter');
  await waitFor(() => calls.update.length === before + 1 && doc.getElementById('cell-editor-number').hidden, 'sorted number edit');
  assertEq(JSON.stringify(rowIds('Sprint 14')), '[1,2,3,4,5]', 'edited row did not move');
  click(doc.getElementById('btn-undo'));
  await waitFor(() => calls.update.length === before + 2 && !doc.getElementById('btn-redo').disabled, 'sorted edit undo');
  assertEq(JSON.stringify(rowIds('Sprint 14')), '[2,3,1,4,5]', 'undo failed to re-sort');
});

await test('N: rapid sort saves are serialized and failures surface the real error', async () => {
  const originalSetOption = win.grist.setOption;
  let finishSave;
  const received = [];
  win.grist.setOption = (key, value) => {
    if (key !== 'rowSort') return originalSetOption(key, value);
    received.push(value);
    if (received.length === 1) return new Promise(resolve => { finishSave = resolve; });
  };
  try {
    await setRowSort('startsAt', 'asc');
    await setRowSort('startsAt', 'desc');
    assertEq(received.length, 1, 'sort saves ran concurrently');
    onOptionsCb({ rowSort: received[0] }, { accessLevel: 'full' });
    assertEq(rowSortDirectionControl.value, 'desc', 'stale echo overwrote current direction');
    finishSave();
    await waitFor(() => received.length === 2, 'queued row sort save');
    await flush();
    assertEq(received[1].direction, 'desc', 'newest preference not saved last');
    win.grist.setOption = async () => { throw new Error('Options save rejected'); };
    await setRowSort('count');
    await flush();
    assert(doc.getElementById('toast').textContent.includes('Options save rejected'), 'save error was swallowed');
  } finally {
    if (finishSave) finishSave();
    win.grist.setOption = originalSetOption;
  }
});

// ── O. Non-disruptive notifications ──────────────────────────
await test('O: copying uses a persistent toast outside the table without moving focus or selection', async () => {
  const toast = doc.getElementById('toast');
  const target = cellEl(3, 'weekday');
  click(target);
  target.focus();
  const groups = [...doc.querySelectorAll('.group')];
  const children = [...doc.getElementById('content').children];
  target.dispatchEvent(clipboardEvent('copy', {}));
  assertEq(toast.parentElement.id, 'app', 'toast is not outside scrollable content');
  assertEq(toast.textContent, '1 cell copied', 'copy feedback');
  assert(toast.classList.contains('visible'), 'toast did not appear');
  assertEq(toast.getAttribute('role'), 'status', 'success announcement role');
  assertEq(toast.getAttribute('aria-live'), 'polite', 'success announcement priority');
  assertEq(toast.getAttribute('aria-atomic'), 'true', 'partial announcement risk');
  assertEq(doc.activeElement, target, 'toast stole focus');
  assert(target.classList.contains('cell-selected'), 'toast lost cell selection');
  assert(children.every((child, i) => doc.getElementById('content').children[i] === child), 'toast altered table flow');
  assert(groups.every((group, i) => doc.querySelectorAll('.group')[i] === group), 'toast rebuilt the table');
  onRecordsCb(sortRecords);
  assertEq(doc.getElementById('toast'), toast, 'record refresh replaced the live region');
});

await test('O: notifications reuse one toast, reset dismissal, and keep errors assertive', async () => {
  const toast = doc.getElementById('toast');
  const originalSetTimeout = win.setTimeout;
  const originalClearTimeout = win.clearTimeout;
  const scheduled = new Map();
  const cleared = new Set();
  let nextId = -100;
  win.setTimeout = (callback, delay, ...args) => {
    if (delay !== 4000) return originalSetTimeout(callback, delay, ...args);
    scheduled.set(--nextId, callback);
    return nextId;
  };
  win.clearTimeout = id => {
    if (scheduled.has(id)) cleared.add(id);
    else originalClearTimeout(id);
  };
  try {
    const data = {};
    click(cellEl(3, 'weekday'));
    cellEl(3, 'weekday').dispatchEvent(clipboardEvent('copy', data));
    const firstTimer = nextId;
    click(cellEl(3, 'C'));
    cellEl(3, 'C').dispatchEvent(clipboardEvent('paste', data));
    await flush();
    assert(cleared.has(firstTimer), 'old timer could hide the new notification');
    assertEq(doc.querySelectorAll('#toast').length, 1, 'notifications stacked');
    assertEq(toast.getAttribute('role'), 'alert', 'error role lost');
    assertEq(toast.getAttribute('aria-live'), 'assertive', 'error priority lost');
    assert(!toast.classList.contains('success'), 'error retained success styling');
    assert(toast.textContent.includes('cannot be pasted'), 'error message lost');
    scheduled.get(nextId)();
    assert(!toast.classList.contains('visible'), 'toast failed to dismiss');
    assert(toast.isConnected, 'dismissal removed the live region');
  } finally {
    win.setTimeout = originalSetTimeout;
    win.clearTimeout = originalClearTimeout;
  }
});

// ── P. Spreadsheet-style typing ─────────────────────────────
function cellKey(id, col, key, options = {}) {
  const event = new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  cellEl(id, col).dispatchEvent(event);
  return event;
}

await test('P: typing replaces a selected number inline; Escape restores it without a write', async () => {
  onRecordsCb(RECORDS);
  cellKey(1, 'count', 'Escape');
  click(cellEl(1, 'count'));
  const before = calls.update.length;
  const original = cellText(1, 'count');
  const key = cellKey(1, 'count', '-');
  const input = doc.getElementById('cell-editor-number');
  assert(key.defaultPrevented, 'typed key would also trigger native button behavior');
  assertEq(input.value, '-', 'typing appended to old value');
  assertEq(doc.activeElement, input, 'next keystroke would miss input');
  assert(doc.getElementById('cell-editor').hidden, 'number opened a popup');
  numberKey('Escape');
  assertEq(cellText(1, 'count'), original, 'Escape altered number');
  assertEq(calls.update.length, before, 'typing or cancel wrote to Grist');
  assertEq(doc.activeElement, cellEl(1, 'count'), 'Escape lost cell focus');
});

await test('P: inline arrows, clipboard and pointer selection remain native', async () => {
  const original = cellText(1, 'count');
  openEditor(1, 'count');
  const input = doc.getElementById('cell-editor-number');
  assertEq(input.value, original, 'second click replaced existing number');
  assert(!numberKey('ArrowLeft').defaultPrevented, 'arrow intercepted');
  assert(!numberKey('z', { ctrlKey: true }).defaultPrevented, 'native text undo intercepted');
  const copy = clipboardEvent('copy', {});
  input.dispatchEvent(copy);
  assert(!copy.defaultPrevented, 'copy intercepted inside input');
  const paste = clipboardEvent('paste', { 'text/plain': '75' });
  input.dispatchEvent(paste);
  assert(!paste.defaultPrevented, 'paste intercepted inside input');
  const pointer = new win.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
  input.dispatchEvent(pointer);
  assert(!pointer.defaultPrevented, 'caret click intercepted by cell range selection');
  const context = new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  input.dispatchEvent(context);
  assert(!context.defaultPrevented, 'text context menu replaced by row actions');
  numberKey('Escape');
});

await test('P: Tab saves and moves; clicking another cell saves without losing its selection', async () => {
  openEditor(1, 'count');
  const input = doc.getElementById('cell-editor-number');
  input.value = '123';
  let before = calls.update.length;
  numberKey('Tab');
  await waitFor(() => input.hidden && calls.update.length === before + 1, 'Tab save');
  assertEq(doc.activeElement, cellEl(1, 'performance'), 'Tab did not move right');
  openEditor(1, 'count');
  input.value = '456';
  before = calls.update.length;
  click(cellEl(2, 'count'));
  await waitFor(() => input.hidden && calls.update.length === before + 1, 'outside click save');
  assertEq(calls.update[before][0].fields.count, 456, 'outside click saved wrong value');
  assert(cellEl(2, 'count').classList.contains('cell-selected'), 'save lost destination selection');
});

await test('P: Grist refresh preserves the numeric draft, focus and caret', async () => {
  openEditor(1, 'count');
  const input = doc.getElementById('cell-editor-number');
  input.value = '-789';
  input.setSelectionRange(2, 3);
  onRecordsCb(RECORDS.map(record => ({ ...record })));
  assertEq(doc.getElementById('cell-editor-number'), input, 'refresh replaced input');
  assertEq(input.closest('td'), cellEl(1, 'count'), 'refresh detached input');
  assertEq(input.value, '-789', 'refresh lost draft');
  assertEq(doc.activeElement, input, 'refresh lost focus');
  assertEq(input.selectionStart, 2, 'refresh lost caret start');
  assertEq(input.selectionEnd, 3, 'refresh lost caret end');
  numberKey('Escape');
});

await test('P: formula cells and keyboard modifiers never start replacement editing', async () => {
  onRecordsCb(RECORDS.map(record => ({ ...record, total: 8.5 })));
  click(cellEl(1, 'total'));
  cellKey(1, 'total', '9');
  assert(doc.getElementById('cell-editor-number').hidden, 'formula became editable');
  click(cellEl(1, 'count'));
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
    cellKey(1, 'count', 'a', options);
    assert(doc.getElementById('cell-editor-number').hidden, 'shortcut began a draft');
  }
});

await test('P: typing opens long text with the first character; second click preserves contents', async () => {
  onOptionsCb({ editableColumns: JSON.stringify(['performance']) }, { accessLevel: 'full' });
  onRecordsCb(RECORDS);
  click(cellEl(1, 'performance'));
  cellKey(1, 'performance', 'H');
  const text = doc.getElementById('cell-editor-text');
  assert(!doc.getElementById('cell-editor').hidden, 'text editor did not open');
  assertEq(text.value, 'H', 'first character lost or appended');
  assertEq(doc.activeElement, text, 'fast follow-up typing would be lost');
  text.value = 'Hello\nworld';
  const before = calls.update.length;
  text.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  await waitFor(() => calls.update.length === before + 1 && doc.getElementById('cell-editor').hidden, 'typed text save');
  assertEq(calls.update[before][0].fields.performance, 'Hello\nworld', 'text draft not saved');
  openEditor(1, 'performance');
  assertEq(text.value, 'Hello\nworld', 'second click replaced existing text');
  click(doc.getElementById('btn-editor-cancel'));
});

await test('Q: fixed header supports saved keyboard reordering', async () => {
  const strip = doc.getElementById('column-strip');
  assert(!strip.hidden, 'fixed column strip is hidden');
  const before = [...strip.querySelectorAll('th[data-column]')].map(th => th.dataset.column);
  const index = before.indexOf('students');
  assert(index >= 0 && index < before.length - 1, 'students has no next column');
  const saveCount = calls.setOption.length;
  const header = strip.querySelector('th[data-column="students"]');
  header.focus();
  header.dispatchEvent(new win.KeyboardEvent('keydown', {
    key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true,
  }));
  await waitFor(() => calls.setOption.slice(saveCount).some(([key]) => key === 'columnOrder'),
    'fixed header order save');
  const after = [...strip.querySelectorAll('th[data-column]')].map(th => th.dataset.column);
  assertEq(after[index], before[index + 1], 'next column did not move left');
  assertEq(after[index + 1], 'students', 'students did not move right');
  assertEq(doc.activeElement.dataset.column, 'students', 'header focus was lost after reorder');
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
